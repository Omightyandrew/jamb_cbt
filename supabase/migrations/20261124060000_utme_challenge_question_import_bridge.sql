-- ============================================================================
-- ExamPilot UTME Challenge: Question Bank Import Bridge
-- Migration: 20261124060000_utme_challenge_question_import_bridge.sql
--
-- STRICTLY ADDITIVE & NON-DESTRUCTIVE:
--   - Does NOT alter, drop, or rewrite existing records in public."Questions".
--   - Does NOT alter existing primary keys or foreign keys in utme_challenge_question_bank.
--   - Adds nullable source_question_id bigint with UNIQUE constraint for 100% provenance and deduplication.
--   - Strictly scopes to JAMB via authoritative exam_id foreign key (no legacy text fallback).
--   - Strict allowlist answer normalization (no unanchored regex or substring extraction).
--   - Implements dynamic preview RPC and idempotent import RPC with identical eligibility rules.
--   - Imported questions strictly default to status = 'draft'.
--   - Enforces administrative authorization via public.utme_challenge_require_admin_internal().
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. PROVENANCE COLUMN & UNIQUE CONSTRAINT
-- ============================================================================
ALTER TABLE public.utme_challenge_question_bank
  ADD COLUMN IF NOT EXISTS source_question_id bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.utme_challenge_question_bank'::regclass
      AND conname = 'utme_challenge_qb_source_qid_unique'
  ) THEN
    ALTER TABLE public.utme_challenge_question_bank
      ADD CONSTRAINT utme_challenge_qb_source_qid_unique
      UNIQUE (source_question_id);
  END IF;
END
$$;

-- Index for provenance lookups and joins
CREATE INDEX IF NOT EXISTS utme_challenge_qb_source_qid_idx
  ON public.utme_challenge_question_bank (source_question_id);


-- ============================================================================
-- 2. CANONICAL SUBJECT MAPPING HELPER (STRICT)
-- Maps source subject variants unambiguously to the 13 approved UTME Challenge subjects.
-- Returns NULL for any unapproved or ambiguous subject.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.utme_challenge_map_source_subject(p_subject text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_subject IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN CASE
    WHEN upper(btrim(p_subject)) IN ('ENGLISH', 'ENGLISH LANGUAGE', 'USE OF ENGLISH') THEN 'English'
    WHEN upper(btrim(p_subject)) IN ('MATHEMATICS', 'GENERAL MATHEMATICS') THEN 'Mathematics'
    WHEN upper(btrim(p_subject)) IN ('PHYSICS') THEN 'Physics'
    WHEN upper(btrim(p_subject)) IN ('CHEMISTRY') THEN 'Chemistry'
    WHEN upper(btrim(p_subject)) IN ('BIOLOGY') THEN 'Biology'
    WHEN upper(btrim(p_subject)) IN ('GOVERNMENT') THEN 'Government'
    WHEN upper(btrim(p_subject)) IN ('LITERATURE IN ENGLISH', 'LITERATURE-IN-ENGLISH', 'LITERATURE') THEN 'Literature in English'
    WHEN upper(btrim(p_subject)) IN ('ECONOMICS') THEN 'Economics'
    WHEN upper(btrim(p_subject)) IN ('COMMERCE') THEN 'Commerce'
    WHEN upper(btrim(p_subject)) IN ('ACCOUNTING', 'FINANCIAL ACCOUNTING', 'PRINCIPLES OF ACCOUNTS') THEN 'Accounting'
    WHEN upper(btrim(p_subject)) IN ('GEOGRAPHY') THEN 'Geography'
    WHEN upper(btrim(p_subject)) IN ('CRS', 'CHRISTIAN RELIGIOUS STUDIES') THEN 'CRS'
    WHEN upper(btrim(p_subject)) IN ('HISTORY') THEN 'History'
    ELSE NULL
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_map_source_subject(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_map_source_subject(text) TO authenticated;


-- ============================================================================
-- 3. STRICT ANSWER NORMALIZATION HELPER
-- Accepts ONLY exact approved formats after trimming and uppercase conversion.
-- Strictly rejects unanchored letters, numeric 1-4, and descriptive text.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.utme_challenge_normalize_source_answer(p_answer text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_answer IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN CASE
    WHEN upper(btrim(p_answer)) IN ('A', 'OPTION A', 'OPTION_A', 'OPTIONA') THEN 'A'
    WHEN upper(btrim(p_answer)) IN ('B', 'OPTION B', 'OPTION_B', 'OPTIONB') THEN 'B'
    WHEN upper(btrim(p_answer)) IN ('C', 'OPTION C', 'OPTION_C', 'OPTIONC') THEN 'C'
    WHEN upper(btrim(p_answer)) IN ('D', 'OPTION D', 'OPTION_D', 'OPTIOND') THEN 'D'
    ELSE NULL
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_normalize_source_answer(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_normalize_source_answer(text) TO authenticated;


-- ============================================================================
-- 4. PREVIEW IMPORT RPC (READ-ONLY)
-- Dynamically calculates candidates, eligibility, exclusions, and per-subject counts.
-- Shares exact eligibility rules with the import RPC.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.utme_challenge_admin_preview_question_import(
  p_test_type text DEFAULT 'all',
  p_subject text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin_uid uuid;
  v_jamb_exam_id uuid;
  v_test_type text;
  v_target_subject text;
  v_rec record;

  -- Overall counters
  v_total_candidates integer := 0;
  v_already_imported integer := 0;
  v_eligible_new integer := 0;
  v_eligible_total integer := 0;
  v_total_disqualified integer := 0;

  v_disq_unsupported_subject integer := 0;
  v_disq_invalid_text integer := 0;
  v_disq_incomplete_options integer := 0;
  v_disq_duplicate_options integer := 0;
  v_disq_invalid_answer integer := 0;

  -- Per-subject aggregation
  v_subjects_json jsonb := '[]'::jsonb;
  v_subj_name text;
  v_approved_subjects text[] := ARRAY[
    'English', 'Mathematics', 'Physics', 'Chemistry', 'Biology',
    'Government', 'Literature in English', 'Economics', 'Commerce',
    'Accounting', 'Geography', 'CRS', 'History'
  ];

  -- Subject breakdown tracking
  v_stat_total jsonb := '{}'::jsonb;
  v_stat_already jsonb := '{}'::jsonb;
  v_stat_eligible_new jsonb := '{}'::jsonb;
  v_stat_disqualified jsonb := '{}'::jsonb;
  v_stat_disq_text jsonb := '{}'::jsonb;
  v_stat_disq_opts jsonb := '{}'::jsonb;
  v_stat_disq_ans jsonb := '{}'::jsonb;

  v_current_bank_counts jsonb := '{}'::jsonb;
  v_current_approved_counts jsonb := '{}'::jsonb;
  v_row record;

  v_is_eligible boolean;
  v_is_already boolean;
  v_disq_reason text;
  v_opt_a text;
  v_opt_b text;
  v_opt_c text;
  v_opt_d text;
BEGIN
  -- 1. Enforce admin authentication
  v_admin_uid := public.utme_challenge_require_admin_internal();

  -- 2. Validate test_type parameter
  v_test_type := lower(btrim(COALESCE(p_test_type, 'all')));
  IF v_test_type NOT IN ('all', 'practice', 'past') THEN
    RAISE EXCEPTION 'INVALID_TEST_TYPE'
      USING HINT = 'p_test_type must be "all", "practice", or "past".';
  END IF;

  -- 3. Validate subject parameter if provided
  IF p_subject IS NOT NULL AND btrim(p_subject) <> '' THEN
    v_target_subject := public.utme_challenge_map_source_subject(p_subject);
    IF v_target_subject IS NULL THEN
      RAISE EXCEPTION 'UNKNOWN_SUBJECT'
        USING HINT = format('Subject "%s" is not in the recognized 13 UTME subjects list.', p_subject);
    END IF;
  ELSE
    v_target_subject := NULL;
  END IF;

  -- 4. Resolve authoritative JAMB exam identity
  SELECT id INTO v_jamb_exam_id
  FROM public.exams
  WHERE code = 'JAMB';

  IF v_jamb_exam_id IS NULL THEN
    RAISE EXCEPTION 'JAMB_EXAM_NOT_FOUND'
      USING HINT = 'The JAMB exam record is missing from public.exams.';
  END IF;

  -- 5. Pre-load current UTME Challenge Question Bank counts
  FOR v_row IN
    SELECT
      subject,
      count(*) AS total_count,
      count(*) FILTER (WHERE status = 'approved') AS approved_count
    FROM public.utme_challenge_question_bank
    GROUP BY subject
  LOOP
    v_current_bank_counts := v_current_bank_counts || jsonb_build_object(v_row.subject, v_row.total_count);
    v_current_approved_counts := v_current_approved_counts || jsonb_build_object(v_row.subject, v_row.approved_count);
  END LOOP;

  -- 6. Evaluate all candidate questions in public."Questions"
  FOR v_rec IN
    SELECT
      q.id AS source_id,
      q."Subject" AS raw_subject,
      public.utme_challenge_map_source_subject(q."Subject") AS canonical_subject,
      q."Question" AS question_text,
      q."Option_a" AS opt_a,
      q."Option_b" AS opt_b,
      q."Option_c" AS opt_c,
      q."Option_d" AS opt_d,
      q."Correct_Answer" AS raw_answer,
      public.utme_challenge_normalize_source_answer(q."Correct_Answer") AS normalized_answer,
      q.test_type,
      (qb.id IS NOT NULL) AS is_already_imported
    FROM public."Questions" q
    LEFT JOIN public.utme_challenge_question_bank qb ON qb.source_question_id = q.id
    WHERE q.exam_id = v_jamb_exam_id
      AND q.is_active = true
      AND (
        (v_test_type = 'all' AND q.test_type IN ('practice', 'past'))
        OR (v_test_type <> 'all' AND q.test_type = v_test_type)
      )
  LOOP
    -- Filter by target subject if specified
    IF v_target_subject IS NOT NULL AND (v_rec.canonical_subject IS NULL OR v_rec.canonical_subject <> v_target_subject) THEN
      CONTINUE;
    END IF;

    v_total_candidates := v_total_candidates + 1;
    v_is_already := v_rec.is_already_imported;
    v_is_eligible := true;
    v_disq_reason := NULL;

    -- A. Check subject mapping
    IF v_rec.canonical_subject IS NULL THEN
      v_is_eligible := false;
      v_disq_reason := 'unsupported_subject';
      v_disq_unsupported_subject := v_disq_unsupported_subject + 1;
    END IF;

    -- B. Check question text (at least 10 non-whitespace characters)
    IF v_is_eligible THEN
      IF length(regexp_replace(COALESCE(v_rec.question_text, ''), '\s+', '', 'g')) < 10 THEN
        v_is_eligible := false;
        v_disq_reason := 'invalid_question_text';
        v_disq_invalid_text := v_disq_invalid_text + 1;
      END IF;
    END IF;

    -- C. Check options (all 4 usable, non-blank, case-insensitively distinct)
    IF v_is_eligible THEN
      v_opt_a := btrim(COALESCE(v_rec.opt_a, ''));
      v_opt_b := btrim(COALESCE(v_rec.opt_b, ''));
      v_opt_c := btrim(COALESCE(v_rec.opt_c, ''));
      v_opt_d := btrim(COALESCE(v_rec.opt_d, ''));

      IF v_opt_a = '' OR v_opt_b = '' OR v_opt_c = '' OR v_opt_d = '' THEN
        v_is_eligible := false;
        v_disq_reason := 'incomplete_options';
        v_disq_incomplete_options := v_disq_incomplete_options + 1;
      ELSIF lower(v_opt_a) = lower(v_opt_b) OR lower(v_opt_a) = lower(v_opt_c) OR lower(v_opt_a) = lower(v_opt_d)
         OR lower(v_opt_b) = lower(v_opt_c) OR lower(v_opt_b) = lower(v_opt_d)
         OR lower(v_opt_c) = lower(v_opt_d) THEN
        v_is_eligible := false;
        v_disq_reason := 'duplicate_options';
        v_disq_duplicate_options := v_disq_duplicate_options + 1;
      END IF;
    END IF;

    -- D. Check answer key (strictly in canonical allowlist)
    IF v_is_eligible THEN
      IF v_rec.normalized_answer IS NULL THEN
        v_is_eligible := false;
        v_disq_reason := 'invalid_answer_key';
        v_disq_invalid_answer := v_disq_invalid_answer + 1;
      END IF;
    END IF;

    -- Tally overall metrics (Validation evaluated FIRST for exact parity)
    IF v_is_eligible THEN
      v_eligible_total := v_eligible_total + 1;
      IF v_is_already THEN
        v_already_imported := v_already_imported + 1;
      ELSE
        v_eligible_new := v_eligible_new + 1;
      END IF;
    ELSE
      v_total_disqualified := v_total_disqualified + 1;
    END IF;

    -- Tally per-subject metrics (for supported subjects)
    IF v_rec.canonical_subject IS NOT NULL THEN
      v_subj_name := v_rec.canonical_subject;

      v_stat_total := jsonb_set(
        v_stat_total,
        ARRAY[v_subj_name],
        to_jsonb(COALESCE((v_stat_total ->> v_subj_name)::integer, 0) + 1)
      );

      IF v_is_eligible THEN
        IF v_is_already THEN
          v_stat_already := jsonb_set(
            v_stat_already,
            ARRAY[v_subj_name],
            to_jsonb(COALESCE((v_stat_already ->> v_subj_name)::integer, 0) + 1)
          );
        ELSE
          v_stat_eligible_new := jsonb_set(
            v_stat_eligible_new,
            ARRAY[v_subj_name],
            to_jsonb(COALESCE((v_stat_eligible_new ->> v_subj_name)::integer, 0) + 1)
          );
        END IF;
      ELSE
        v_stat_disqualified := jsonb_set(
          v_stat_disqualified,
          ARRAY[v_subj_name],
          to_jsonb(COALESCE((v_stat_disqualified ->> v_subj_name)::integer, 0) + 1)
        );
        IF v_disq_reason = 'invalid_question_text' THEN
          v_stat_disq_text := jsonb_set(
            v_stat_disq_text,
            ARRAY[v_subj_name],
            to_jsonb(COALESCE((v_stat_disq_text ->> v_subj_name)::integer, 0) + 1)
          );
        ELSIF v_disq_reason IN ('incomplete_options', 'duplicate_options') THEN
          v_stat_disq_opts := jsonb_set(
            v_stat_disq_opts,
            ARRAY[v_subj_name],
            to_jsonb(COALESCE((v_stat_disq_opts ->> v_subj_name)::integer, 0) + 1)
          );
        ELSIF v_disq_reason = 'invalid_answer_key' THEN
          v_stat_disq_ans := jsonb_set(
            v_stat_disq_ans,
            ARRAY[v_subj_name],
            to_jsonb(COALESCE((v_stat_disq_ans ->> v_subj_name)::integer, 0) + 1)
          );
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- 7. Build structured per-subject breakdown array
  FOREACH v_subj_name IN ARRAY v_approved_subjects
  LOOP
    IF v_target_subject IS NOT NULL AND v_subj_name <> v_target_subject THEN
      CONTINUE;
    END IF;

    v_subjects_json := v_subjects_json || jsonb_build_object(
      'subject', v_subj_name,
      'total_in_source', COALESCE((v_stat_total ->> v_subj_name)::integer, 0),
      'already_imported', COALESCE((v_stat_already ->> v_subj_name)::integer, 0),
      'eligible_new', COALESCE((v_stat_eligible_new ->> v_subj_name)::integer, 0),
      'disqualified', COALESCE((v_stat_disqualified ->> v_subj_name)::integer, 0),
      'disqualification_breakdown', jsonb_build_object(
        'invalid_text', COALESCE((v_stat_disq_text ->> v_subj_name)::integer, 0),
        'invalid_options', COALESCE((v_stat_disq_opts ->> v_subj_name)::integer, 0),
        'invalid_answer', COALESCE((v_stat_disq_ans ->> v_subj_name)::integer, 0)
      ),
      'current_bank_total', COALESCE((v_current_bank_counts ->> v_subj_name)::integer, 0),
      'current_bank_approved', COALESCE((v_current_approved_counts ->> v_subj_name)::integer, 0)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'test_type_filter', v_test_type,
    'subject_filter', v_target_subject,
    'summary', jsonb_build_object(
      'total_candidates_scanned', v_total_candidates,
      'already_imported', v_already_imported,
      'eligible_total', v_eligible_total,
      'eligible_new', v_eligible_new,
      'total_disqualified', v_total_disqualified,
      'disqualification_breakdown', jsonb_build_object(
        'unsupported_subject', v_disq_unsupported_subject,
        'invalid_question_text', v_disq_invalid_text,
        'incomplete_options', v_disq_incomplete_options,
        'duplicate_options', v_disq_duplicate_options,
        'invalid_answer_key', v_disq_invalid_answer
      )
    ),
    'subjects', v_subjects_json
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_admin_preview_question_import(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_admin_preview_question_import(text, text) TO authenticated;


-- ============================================================================
-- 5. IDEMPOTENT QUESTION IMPORT RPC
-- Imports eligible JAMB questions into public.utme_challenge_question_bank.
-- Guaranteed non-destructive:
--   - Uses ON CONFLICT (source_question_id) DO NOTHING.
--   - Never modifies existing destination records.
--   - Imported records strictly default to status = 'draft'.
--   - Serialized via transaction-level advisory lock.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.utme_challenge_admin_import_questions(
  p_test_type text DEFAULT 'all',
  p_subject text DEFAULT NULL,
  p_limit integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin_uid uuid;
  v_jamb_exam_id uuid;
  v_test_type text;
  v_target_subject text;
  v_limit integer;
  v_rec record;

  v_imported_count integer := 0;
  v_skipped_already_count integer := 0;
  v_disqualified_count integer := 0;
  v_total_processed integer := 0;

  v_is_eligible boolean;
  v_clean_topic text;
  v_clean_explanation text;
  v_opt_a text;
  v_opt_b text;
  v_opt_c text;
  v_opt_d text;

  v_imported_by_subject jsonb := '{}'::jsonb;
  v_subj_name text;
BEGIN
  -- 1. Enforce admin authentication
  v_admin_uid := public.utme_challenge_require_admin_internal();

  -- 2. Validate parameters
  v_test_type := lower(btrim(COALESCE(p_test_type, 'all')));
  IF v_test_type NOT IN ('all', 'practice', 'past') THEN
    RAISE EXCEPTION 'INVALID_TEST_TYPE'
      USING HINT = 'p_test_type must be "all", "practice", or "past".';
  END IF;

  IF p_subject IS NOT NULL AND btrim(p_subject) <> '' THEN
    v_target_subject := public.utme_challenge_map_source_subject(p_subject);
    IF v_target_subject IS NULL THEN
      RAISE EXCEPTION 'UNKNOWN_SUBJECT'
        USING HINT = format('Subject "%s" is not in the recognized 13 UTME subjects list.', p_subject);
    END IF;
  ELSE
    v_target_subject := NULL;
  END IF;

  IF p_limit IS NOT NULL THEN
    IF p_limit <= 0 THEN
      RAISE EXCEPTION 'INVALID_LIMIT'
        USING HINT = 'p_limit must be a positive integer.';
    END IF;
    v_limit := p_limit;
  ELSE
    v_limit := NULL;
  END IF;

  -- 3. Serialize imports via transaction advisory lock
  PERFORM pg_advisory_xact_lock(hashtext('utme_challenge_import_lock'));

  -- 4. Resolve authoritative JAMB exam identity
  SELECT id INTO v_jamb_exam_id
  FROM public.exams
  WHERE code = 'JAMB';

  IF v_jamb_exam_id IS NULL THEN
    RAISE EXCEPTION 'JAMB_EXAM_NOT_FOUND'
      USING HINT = 'The JAMB exam record is missing from public.exams.';
  END IF;

  -- 5. Process candidate questions
  FOR v_rec IN
    SELECT
      q.id AS source_id,
      q."Subject" AS raw_subject,
      public.utme_challenge_map_source_subject(q."Subject") AS canonical_subject,
      q."Question" AS question_text,
      q."Option_a" AS opt_a,
      q."Option_b" AS opt_b,
      q."Option_c" AS opt_c,
      q."Option_d" AS opt_d,
      q."Correct_Answer" AS raw_answer,
      public.utme_challenge_normalize_source_answer(q."Correct_Answer") AS normalized_answer,
      q."Topic" AS topic,
      q."Explanation" AS explanation,
      q.test_type,
      (qb.id IS NOT NULL) AS is_already_imported
    FROM public."Questions" q
    LEFT JOIN public.utme_challenge_question_bank qb ON qb.source_question_id = q.id
    WHERE q.exam_id = v_jamb_exam_id
      AND q.is_active = true
      AND (
        (v_test_type = 'all' AND q.test_type IN ('practice', 'past'))
        OR (v_test_type <> 'all' AND q.test_type = v_test_type)
      )
    ORDER BY q.id ASC
  LOOP
    -- Filter by target subject if specified
    IF v_target_subject IS NOT NULL AND (v_rec.canonical_subject IS NULL OR v_rec.canonical_subject <> v_target_subject) THEN
      CONTINUE;
    END IF;

    -- Stop if batch limit reached
    IF v_limit IS NOT NULL AND v_imported_count >= v_limit THEN
      EXIT;
    END IF;

    v_total_processed := v_total_processed + 1;
    v_is_eligible := true;

    -- A. Validate subject
    IF v_rec.canonical_subject IS NULL THEN
      v_is_eligible := false;
    END IF;

    -- B. Validate question text (at least 10 non-whitespace characters)
    IF v_is_eligible THEN
      IF length(regexp_replace(COALESCE(v_rec.question_text, ''), '\s+', '', 'g')) < 10 THEN
        v_is_eligible := false;
      END IF;
    END IF;

    -- C. Validate options
    IF v_is_eligible THEN
      v_opt_a := btrim(COALESCE(v_rec.opt_a, ''));
      v_opt_b := btrim(COALESCE(v_rec.opt_b, ''));
      v_opt_c := btrim(COALESCE(v_rec.opt_c, ''));
      v_opt_d := btrim(COALESCE(v_rec.opt_d, ''));

      IF v_opt_a = '' OR v_opt_b = '' OR v_opt_c = '' OR v_opt_d = '' THEN
        v_is_eligible := false;
      ELSIF lower(v_opt_a) = lower(v_opt_b) OR lower(v_opt_a) = lower(v_opt_c) OR lower(v_opt_a) = lower(v_opt_d)
         OR lower(v_opt_b) = lower(v_opt_c) OR lower(v_opt_b) = lower(v_opt_d)
         OR lower(v_opt_c) = lower(v_opt_d) THEN
        v_is_eligible := false;
      END IF;
    END IF;

    -- D. Validate answer key
    IF v_is_eligible THEN
      IF v_rec.normalized_answer IS NULL THEN
        v_is_eligible := false;
      END IF;
    END IF;

    -- 1. If not eligible, increment disqualified count and skip (Identical to preview)
    IF NOT v_is_eligible THEN
      v_disqualified_count := v_disqualified_count + 1;
      CONTINUE;
    END IF;

    -- 2. If eligible, check if already imported
    IF v_rec.is_already_imported THEN
      v_skipped_already_count := v_skipped_already_count + 1;
      CONTINUE;
    END IF;

    -- 3. Prepare sanitized topic and explanation for insertion
    v_clean_topic := NULLIF(btrim(COALESCE(v_rec.topic, '')), '');
    IF v_clean_topic IS NULL THEN
      v_clean_topic := 'General ' || v_rec.canonical_subject;
    END IF;
    v_clean_explanation := NULLIF(btrim(COALESCE(v_rec.explanation, '')), '');

    -- 4. Insert with idempotent conflict handling
    INSERT INTO public.utme_challenge_question_bank (
      subject,
      topic,
      question_text,
      options,
      correct_option,
      explanation,
      status,
      usage_count,
      created_by,
      source_question_id
    ) VALUES (
      v_rec.canonical_subject,
      v_clean_topic,
      btrim(v_rec.question_text),
      jsonb_build_array(v_opt_a, v_opt_b, v_opt_c, v_opt_d),
      v_rec.normalized_answer,
      v_clean_explanation,
      'draft',
      0,
      v_admin_uid,
      v_rec.source_id
    )
    ON CONFLICT (source_question_id) DO NOTHING;

    -- Verify insertion occurred
    IF FOUND THEN
      v_imported_count := v_imported_count + 1;
      v_subj_name := v_rec.canonical_subject;
      v_imported_by_subject := jsonb_set(
        v_imported_by_subject,
        ARRAY[v_subj_name],
        to_jsonb(COALESCE((v_imported_by_subject ->> v_subj_name)::integer, 0) + 1)
      );
    ELSE
      v_skipped_already_count := v_skipped_already_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'imported_count', v_imported_count,
    'skipped_already_imported_count', v_skipped_already_count,
    'disqualified_count', v_disqualified_count,
    'total_candidates_processed', v_total_processed,
    'imported_by_subject', v_imported_by_subject
  );
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_admin_import_questions(text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.utme_challenge_admin_import_questions(text, text, integer) TO authenticated;

COMMIT;
