-- ExamPilot UTME Challenge 2027: Phase 1 Database Foundation
-- Migration: 20261124000000_utme_challenge_foundation.sql
-- Strictly additive. Does not alter or drop any existing ExamPilot tables, views, or functions.

BEGIN;

-- ============================================================================
-- 1. UTME CHALLENGE SEASONS
-- ============================================================================
CREATE TABLE public.utme_challenge_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year integer NOT NULL UNIQUE CHECK (year >= 2026),
  title text NOT NULL CHECK (btrim(title) <> ''),
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX utme_challenge_seasons_active_idx 
  ON public.utme_challenge_seasons (is_active);

-- ============================================================================
-- 2. UTME CHALLENGE REGISTRATIONS
-- One registration per student per season.
-- Enforces: 4 distinct subjects, English compulsory, 3 distinct electives from the 13 approved.
-- Combination key derived for leaderboard grouping.
-- Display name validated to 2-30 characters after trimming.
-- Direct INSERT/UPDATE/DELETE revoked; registration managed via Phase 2 RPC.
-- ============================================================================
CREATE TABLE public.utme_challenge_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES public.utme_challenge_seasons(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT 'Candidate' CHECK (length(btrim(display_name)) BETWEEN 2 AND 30),
  selected_subjects text[] NOT NULL,
  combination_key text NOT NULL,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT utme_challenge_reg_user_season_unique UNIQUE (season_id, user_id),
  CONSTRAINT utme_challenge_reg_composite_identity UNIQUE (id, season_id, user_id),
  CONSTRAINT utme_challenge_reg_four_subjects CHECK (cardinality(selected_subjects) = 4),
  CONSTRAINT utme_challenge_reg_has_english CHECK ('English' = ANY(selected_subjects))
);

CREATE INDEX utme_challenge_registrations_user_idx 
  ON public.utme_challenge_registrations (user_id);
CREATE INDEX utme_challenge_registrations_combo_idx 
  ON public.utme_challenge_registrations (season_id, combination_key);

-- Trigger: Validate accredited subjects, uniqueness, non-empty text, and derive combination_key
CREATE OR REPLACE FUNCTION public.utme_challenge_validate_registration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_allowed constant text[] := ARRAY[
    'English', 'Mathematics', 'Physics', 'Chemistry', 'Biology',
    'Government', 'Literature in English', 'Economics', 'Commerce',
    'Accounting', 'Geography', 'CRS', 'History'
  ];
  v_subj text;
  v_cleaned text[] := ARRAY[]::text[];
  v_sorted text[];
BEGIN
  -- Prevent modifications if subject choices are locked
  IF TG_OP = 'UPDATE' THEN
    IF OLD.locked_at IS NOT NULL AND NEW.selected_subjects IS DISTINCT FROM OLD.selected_subjects THEN
      RAISE EXCEPTION 'Registration subjects are locked and cannot be modified.';
    END IF;
  END IF;

  -- Validate each subject
  FOREACH v_subj IN ARRAY NEW.selected_subjects
  LOOP
    IF v_subj IS NULL OR btrim(v_subj) = '' THEN
      RAISE EXCEPTION 'Subject name cannot be null, empty, or whitespace.';
    END IF;
    IF NOT (btrim(v_subj) = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'Subject "%" is not one of the 13 approved UTME Challenge subjects.', v_subj;
    END IF;
    IF btrim(v_subj) = ANY(v_cleaned) THEN
      RAISE EXCEPTION 'Duplicate subject "%" in subject combination.', v_subj;
    END IF;
    v_cleaned := array_append(v_cleaned, btrim(v_subj));
  END LOOP;

  IF cardinality(v_cleaned) <> 4 THEN
    RAISE EXCEPTION 'Candidate must register exactly 4 subjects.';
  END IF;

  IF NOT ('English' = ANY(v_cleaned)) THEN
    RAISE EXCEPTION 'Use of English is compulsory.';
  END IF;

  NEW.selected_subjects := v_cleaned;

  -- Derive canonical sorted combination key (e.g. "Accounting|Economics|English|Mathematics")
  SELECT array_agg(s ORDER BY s) INTO v_sorted FROM unnest(v_cleaned) s;
  NEW.combination_key := array_to_string(v_sorted, '|');

  RETURN NEW;
END;
$$;

CREATE TRIGGER utme_challenge_reg_validation_trg
BEFORE INSERT OR UPDATE ON public.utme_challenge_registrations
FOR EACH ROW EXECUTE FUNCTION public.utme_challenge_validate_registration();

-- ============================================================================
-- 3. UTME CHALLENGE QUESTION BANK
-- Private question repository isolated from public Questions tables.
-- ============================================================================
CREATE TABLE public.utme_challenge_question_bank (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL CHECK (subject IN (
    'English', 'Mathematics', 'Physics', 'Chemistry', 'Biology',
    'Government', 'Literature in English', 'Economics', 'Commerce',
    'Accounting', 'Geography', 'CRS', 'History'
  )),
  topic text,
  question_text text NOT NULL CHECK (btrim(question_text) <> ''),
  options jsonb NOT NULL,
  correct_option text NOT NULL CHECK (correct_option IN ('A', 'B', 'C', 'D')),
  explanation text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected', 'archived')),
  usage_count integer NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  last_used_round_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT utme_challenge_qb_options_is_array CHECK (
    jsonb_typeof(options) = 'array' AND jsonb_array_length(options) = 4
  ),
  CONSTRAINT utme_challenge_qb_composite_identity UNIQUE (id, subject)
);

CREATE INDEX utme_challenge_qb_subject_status_idx 
  ON public.utme_challenge_question_bank (subject, status);

-- ============================================================================
-- 4. UTME CHALLENGE ROUNDS
-- Admin-configurable registration and testing windows, duration, and grace period.
-- ============================================================================
CREATE TABLE public.utme_challenge_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES public.utme_challenge_seasons(id) ON DELETE CASCADE,
  round_number integer NOT NULL CHECK (round_number >= 1),
  title text NOT NULL CHECK (btrim(title) <> ''),
  registration_opens_at timestamptz NOT NULL,
  registration_closes_at timestamptz NOT NULL,
  start_window_opens_at timestamptz NOT NULL,
  start_window_closes_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 60 CHECK (duration_minutes BETWEEN 10 AND 180),
  grace_period_seconds integer NOT NULL DEFAULT 30 CHECK (grace_period_seconds BETWEEN 0 AND 300),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'open', 'closed', 'finalized')),
  is_questions_frozen boolean NOT NULL DEFAULT false,
  frozen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT utme_challenge_round_season_num_unique UNIQUE (season_id, round_number),
  CONSTRAINT utme_challenge_round_composite_identity UNIQUE (id, season_id),
  CONSTRAINT utme_challenge_round_reg_window CHECK (registration_closes_at > registration_opens_at),
  CONSTRAINT utme_challenge_round_start_window CHECK (start_window_closes_at >= start_window_opens_at),
  CONSTRAINT utme_challenge_round_reg_before_start CHECK (registration_closes_at <= start_window_opens_at)
);

CREATE INDEX utme_challenge_rounds_status_idx 
  ON public.utme_challenge_rounds (status);

-- ============================================================================
-- 5. UTME CHALLENGE ROUND SUBJECTS
-- Independent question count per eligible subject.
-- ============================================================================
CREATE TABLE public.utme_challenge_round_subjects (
  round_id uuid NOT NULL REFERENCES public.utme_challenge_rounds(id) ON DELETE CASCADE,
  subject text NOT NULL CHECK (subject IN (
    'English', 'Mathematics', 'Physics', 'Chemistry', 'Biology',
    'Government', 'Literature in English', 'Economics', 'Commerce',
    'Accounting', 'Geography', 'CRS', 'History'
  )),
  question_count integer NOT NULL CHECK (question_count BETWEEN 1 AND 50),
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, subject)
);

-- ============================================================================
-- 6. UTME CHALLENGE ROUND QUESTIONS
-- Fixed, shared question set per subject per round with pre-materialized snapshot.
-- Complete snapshot constraint requiring all 4 essential keys and 4 options.
-- Note: utme_challenge_rq_subject_fk uses ON DELETE NO ACTION so cascade deletions of draft rounds succeed.
-- ============================================================================
CREATE TABLE public.utme_challenge_round_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES public.utme_challenge_rounds(id) ON DELETE CASCADE,
  subject text NOT NULL,
  subject_position integer NOT NULL CHECK (subject_position >= 1),
  question_id uuid NOT NULL,
  question_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT utme_challenge_rq_round_pos_unique UNIQUE (round_id, subject, subject_position),
  CONSTRAINT utme_challenge_rq_round_q_unique UNIQUE (round_id, question_id),
  CONSTRAINT utme_challenge_rq_composite_identity UNIQUE (id, round_id, subject),
  CONSTRAINT utme_challenge_rq_subject_fk FOREIGN KEY (round_id, subject)
    REFERENCES public.utme_challenge_round_subjects(round_id, subject) ON DELETE NO ACTION,
  CONSTRAINT utme_challenge_rq_question_bank_fk FOREIGN KEY (question_id, subject)
    REFERENCES public.utme_challenge_question_bank(id, subject) ON DELETE RESTRICT,
  CONSTRAINT utme_challenge_rq_snapshot_valid CHECK (
    question_snapshot ?& ARRAY['question_text', 'options', 'correct_option', 'explanation'] AND
    jsonb_typeof(question_snapshot -> 'options') = 'array' AND
    jsonb_array_length(question_snapshot -> 'options') = 4
  )
);

CREATE INDEX utme_challenge_rq_round_subj_idx 
  ON public.utme_challenge_round_questions (round_id, subject);

-- ============================================================================
-- 7. UTME CHALLENGE ATTEMPTS
-- One attempt per user per round.
-- Deadline is strictly started_at + duration_minutes (full duration guaranteed).
-- Stores real score columns for tie-breaking.
-- ============================================================================
CREATE TABLE public.utme_challenge_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL,
  season_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  registration_id uuid NOT NULL,
  selected_subjects text[] NOT NULL,
  total_questions_assigned integer NOT NULL CHECK (total_questions_assigned > 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  submitted_at timestamptz,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'expired')),
  raw_score integer DEFAULT NULL,
  percentage numeric(5, 2) DEFAULT NULL,
  english_percentage numeric(5, 2) DEFAULT NULL,
  total_correct integer DEFAULT NULL,
  subject_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  finalize_fail_count integer NOT NULL DEFAULT 0 CHECK (finalize_fail_count >= 0),
  last_finalize_error text,
  configuration_snapshot jsonb NOT NULL,
  client_user_agent text,
  CONSTRAINT utme_challenge_attempt_user_round_unique UNIQUE (round_id, user_id),
  CONSTRAINT utme_challenge_attempt_composite_identity UNIQUE (id, round_id),
  CONSTRAINT utme_challenge_attempt_expiry_order CHECK (expires_at >= started_at),
  CONSTRAINT utme_challenge_attempt_round_fk FOREIGN KEY (round_id, season_id)
    REFERENCES public.utme_challenge_rounds(id, season_id) ON DELETE RESTRICT,
  CONSTRAINT utme_challenge_attempt_reg_fk FOREIGN KEY (registration_id, season_id, user_id)
    REFERENCES public.utme_challenge_registrations(id, season_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX utme_challenge_attempts_user_round_idx 
  ON public.utme_challenge_attempts (user_id, round_id);
CREATE INDEX utme_challenge_attempts_status_expiry_idx 
  ON public.utme_challenge_attempts (status, expires_at);

-- ============================================================================
-- 8. UTME CHALLENGE ATTEMPT ANSWERS
-- Composite foreign keys ensure an answer matches attempt's round and subject.
-- Pre-created at attempt start to ensure 100% complete denominator.
-- ============================================================================
CREATE TABLE public.utme_challenge_attempt_answers (
  attempt_id uuid NOT NULL,
  round_id uuid NOT NULL,
  round_question_id uuid NOT NULL,
  subject text NOT NULL,
  candidate_position integer NOT NULL CHECK (candidate_position >= 1),
  selected_option text CHECK (selected_option IN ('A', 'B', 'C', 'D')),
  client_seq integer NOT NULL DEFAULT 0 CHECK (client_seq >= 0),
  server_version integer NOT NULL DEFAULT 1 CHECK (server_version >= 1),
  answered_at timestamptz,
  is_correct boolean,
  PRIMARY KEY (attempt_id, round_question_id),
  CONSTRAINT utme_challenge_ans_attempt_fk FOREIGN KEY (attempt_id, round_id)
    REFERENCES public.utme_challenge_attempts(id, round_id) ON DELETE CASCADE,
  CONSTRAINT utme_challenge_ans_round_q_fk FOREIGN KEY (round_question_id, round_id, subject)
    REFERENCES public.utme_challenge_round_questions(id, round_id, subject) ON DELETE RESTRICT,
  CONSTRAINT utme_challenge_ans_candidate_pos_unique UNIQUE (attempt_id, candidate_position)
);

CREATE INDEX utme_challenge_attempt_answers_attempt_idx 
  ON public.utme_challenge_attempt_answers (attempt_id);

-- ============================================================================
-- 9. UTME CHALLENGE ANSWER IDEMPOTENCY
-- Durable request deduping per attempt.
-- ============================================================================
CREATE TABLE public.utme_challenge_answer_idempotency (
  attempt_id uuid NOT NULL REFERENCES public.utme_challenge_attempts(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  payload_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (attempt_id, request_id)
);

-- ============================================================================
-- 10. UTME CHALLENGE CRON LOGS
-- Observability and telemetry for scheduled finalization worker.
-- ============================================================================
CREATE TABLE public.utme_challenge_cron_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('success', 'failed', 'partial')),
  attempts_found integer NOT NULL DEFAULT 0,
  attempts_finalized integer NOT NULL DEFAULT 0,
  attempts_failed integer NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL DEFAULT 0,
  error_details text,
  executed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX utme_challenge_cron_logs_executed_idx 
  ON public.utme_challenge_cron_logs (executed_at DESC);

-- ============================================================================
-- 11. UTME CHALLENGE LEADERBOARD ENTRIES
-- Partitioned strictly by round and four-subject combination key.
-- Tie-breaking: english_percentage DESC, total_correct DESC. Shared ranks allowed.
-- Direct table access revoked for students; queried via Phase 2 RPC function.
-- ============================================================================
CREATE TABLE public.utme_challenge_leaderboard_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES public.utme_challenge_rounds(id) ON DELETE CASCADE,
  combination_key text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  final_percentage numeric(5, 2) NOT NULL,
  english_percentage numeric(5, 2) NOT NULL,
  total_correct integer NOT NULL,
  rank integer NOT NULL CHECK (rank >= 1),
  generated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT utme_challenge_ldb_round_combo_user_unique UNIQUE (round_id, combination_key, user_id)
);

CREATE INDEX utme_challenge_ldb_round_combo_rank_idx 
  ON public.utme_challenge_leaderboard_entries (round_id, combination_key, rank);

-- ============================================================================
-- 12. UPDATED_AT TRIGGER FUNCTION & TRIGGERS
-- Generic trigger ensuring accurate updated_at timestamps on core entities.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.utme_challenge_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER utme_challenge_seasons_updated_at_trg
BEFORE UPDATE ON public.utme_challenge_seasons
FOR EACH ROW EXECUTE FUNCTION public.utme_challenge_set_updated_at();

CREATE TRIGGER utme_challenge_registrations_updated_at_trg
BEFORE UPDATE ON public.utme_challenge_registrations
FOR EACH ROW EXECUTE FUNCTION public.utme_challenge_set_updated_at();

CREATE TRIGGER utme_challenge_qb_updated_at_trg
BEFORE UPDATE ON public.utme_challenge_question_bank
FOR EACH ROW EXECUTE FUNCTION public.utme_challenge_set_updated_at();

CREATE TRIGGER utme_challenge_rounds_updated_at_trg
BEFORE UPDATE ON public.utme_challenge_rounds
FOR EACH ROW EXECUTE FUNCTION public.utme_challenge_set_updated_at();

-- ============================================================================
-- 13. IMMUTABILITY & ANTI-TAMPER TRIGGERS
-- ============================================================================

-- A. Prevent INSERT, UPDATE, or DELETE on round questions once round is frozen or attempts exist
-- Branches explicitly on TG_OP. Reads NEW only for INSERT/UPDATE, and OLD only for UPDATE/DELETE.
CREATE OR REPLACE FUNCTION public.utme_challenge_protect_frozen_questions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_round_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_round_id := NEW.round_id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_round_id := OLD.round_id;
  ELSIF TG_OP = 'DELETE' THEN
    v_round_id := OLD.round_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.utme_challenge_rounds r
    WHERE r.id = v_round_id AND (
      r.is_questions_frozen = true OR 
      r.status IN ('scheduled', 'open', 'closed', 'finalized') OR 
      EXISTS (
        SELECT 1 FROM public.utme_challenge_attempts a WHERE a.round_id = v_round_id
      )
    )
  ) THEN
    RAISE EXCEPTION 'Cannot insert, modify, or delete questions for round "%" once frozen or attempts exist.', v_round_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

CREATE TRIGGER utme_challenge_round_questions_immutability_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.utme_challenge_round_questions
FOR EACH ROW EXECUTE FUNCTION public.utme_challenge_protect_frozen_questions();

-- B. Prevent updating or deleting round subjects once frozen or attempts exist
-- Branches explicitly on TG_OP. Reads NEW only for INSERT/UPDATE, and OLD only for UPDATE/DELETE.
CREATE OR REPLACE FUNCTION public.utme_challenge_protect_round_subjects()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_round_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_round_id := NEW.round_id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_round_id := OLD.round_id;
  ELSIF TG_OP = 'DELETE' THEN
    v_round_id := OLD.round_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.utme_challenge_rounds r
    WHERE r.id = v_round_id AND (
      r.is_questions_frozen = true OR 
      EXISTS (
        SELECT 1 FROM public.utme_challenge_attempts a WHERE a.round_id = v_round_id
      )
    )
  ) THEN
    RAISE EXCEPTION 'Cannot modify round subjects once the round is frozen or attempts exist.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

CREATE TRIGGER utme_challenge_round_subjects_immutability_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.utme_challenge_round_subjects
FOR EACH ROW EXECUTE FUNCTION public.utme_challenge_protect_round_subjects();

-- C. Prevent modifying round configuration once frozen or attempts exist,
--    and block unfreezing questions or regressing round status once attempts exist.
CREATE OR REPLACE FUNCTION public.utme_challenge_protect_round_config()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_has_attempts boolean;
  v_old_rank integer;
  v_new_rank integer;
BEGIN
  -- Check if any attempt exists for this round
  SELECT EXISTS (
    SELECT 1 FROM public.utme_challenge_attempts a WHERE a.round_id = OLD.id
  ) INTO v_has_attempts;

  -- 1. If attempts exist, questions cannot be unfrozen
  IF v_has_attempts AND OLD.is_questions_frozen = true AND NEW.is_questions_frozen = false THEN
    RAISE EXCEPTION 'Cannot unfreeze questions for round "%" once attempts exist.', OLD.id;
  END IF;

  -- 2. If attempts exist, round status cannot regress
  IF v_has_attempts AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_old_rank := CASE OLD.status
      WHEN 'draft' THEN 1
      WHEN 'scheduled' THEN 2
      WHEN 'open' THEN 3
      WHEN 'closed' THEN 4
      WHEN 'finalized' THEN 5
      ELSE 0
    END;
    v_new_rank := CASE NEW.status
      WHEN 'draft' THEN 1
      WHEN 'scheduled' THEN 2
      WHEN 'open' THEN 3
      WHEN 'closed' THEN 4
      WHEN 'finalized' THEN 5
      ELSE 0
    END;
    IF v_new_rank < v_old_rank THEN
      RAISE EXCEPTION 'Cannot regress status of round "%" from "%" to "%" once attempts exist.', OLD.id, OLD.status, NEW.status;
    END IF;
  END IF;

  -- 3. Core schedule and duration cannot change if questions are frozen or attempts exist
  IF OLD.is_questions_frozen = true OR v_has_attempts THEN
    IF (OLD.season_id <> NEW.season_id OR
        OLD.round_number <> NEW.round_number OR
        OLD.registration_opens_at <> NEW.registration_opens_at OR
        OLD.registration_closes_at <> NEW.registration_closes_at OR
        OLD.start_window_opens_at <> NEW.start_window_opens_at OR
        OLD.start_window_closes_at <> NEW.start_window_closes_at OR
        OLD.duration_minutes <> NEW.duration_minutes OR
        OLD.grace_period_seconds <> NEW.grace_period_seconds) THEN
      RAISE EXCEPTION 'Cannot modify core schedule, duration, or settings for a frozen round or a round with attempts.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER utme_challenge_round_config_immutability_trg
BEFORE UPDATE ON public.utme_challenge_rounds
FOR EACH ROW EXECUTE FUNCTION public.utme_challenge_protect_round_config();

-- ============================================================================
-- 14. ROW LEVEL SECURITY (RLS) & PRIVILEGE HARDENING
-- ============================================================================

-- A. Enable RLS on all 11 UTME Challenge tables
ALTER TABLE public.utme_challenge_seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utme_challenge_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utme_challenge_question_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utme_challenge_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utme_challenge_round_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utme_challenge_round_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utme_challenge_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utme_challenge_attempt_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utme_challenge_answer_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utme_challenge_cron_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utme_challenge_leaderboard_entries ENABLE ROW LEVEL SECURITY;

-- B. Explicit REVOKE ALL on every table from PUBLIC, anon, and authenticated
REVOKE ALL ON TABLE public.utme_challenge_seasons FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.utme_challenge_registrations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.utme_challenge_question_bank FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.utme_challenge_rounds FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.utme_challenge_round_subjects FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.utme_challenge_round_questions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.utme_challenge_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.utme_challenge_attempt_answers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.utme_challenge_answer_idempotency FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.utme_challenge_cron_logs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.utme_challenge_leaderboard_entries FROM PUBLIC, anon, authenticated;

-- C. Explicit narrow read grants for candidates (students) and anon
-- TABLE PRIVILEGES, NOT ONLY POLICIES, NOW PROTECT QUESTION BANK AND ANSWER KEYS.
-- Tables holding questions, answers, and audit logs have ZERO grants to authenticated or anon.
-- Postgres rejects client-originated queries at the table privilege layer before RLS is even checked.
-- Direct writes for both students and admins are completely revoked at the table privilege level.
-- All admin operations, question curation, round management, registration, and test taking
-- will execute strictly via Phase 2 SECURITY DEFINER RPCs and the service role.
GRANT SELECT ON TABLE public.utme_challenge_seasons TO authenticated, anon;
GRANT SELECT ON TABLE public.utme_challenge_rounds TO authenticated;
GRANT SELECT ON TABLE public.utme_challenge_registrations TO authenticated;
GRANT SELECT ON TABLE public.utme_challenge_attempts TO authenticated;

-- ============================================================================
-- 15. RLS POLICIES (DEFENSE-IN-DEPTH LAYER)
-- NOTE: Administrative policies provide a secondary security perimeter for contexts
--       where an authenticated session might execute privileged queries.
-- All admin checks verify JWT app_metadata claims:
--   COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin') OR
--   COALESCE(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
-- ============================================================================

-- Seasons Policies
CREATE POLICY "utme_challenge_seasons_read_all"
  ON public.utme_challenge_seasons FOR SELECT
  TO authenticated, anon
  USING (is_active = true);

CREATE POLICY "utme_challenge_seasons_admin_all"
  ON public.utme_challenge_seasons FOR ALL
  TO authenticated
  USING (
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin') OR
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
  )
  WITH CHECK (
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin') OR
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
  );

-- Registrations Policies (Candidates read own registration only; direct INSERT/UPDATE/DELETE revoked)
CREATE POLICY "utme_challenge_registrations_select_own"
  ON public.utme_challenge_registrations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Question Bank Policies (Admin Only via verified JWT role)
CREATE POLICY "utme_challenge_qb_admin_all"
  ON public.utme_challenge_question_bank FOR ALL
  TO authenticated
  USING (
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin') OR
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
  )
  WITH CHECK (
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin') OR
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
  );

-- Rounds Policies
CREATE POLICY "utme_challenge_rounds_select_visible"
  ON public.utme_challenge_rounds FOR SELECT
  TO authenticated
  USING (status IN ('scheduled', 'open', 'closed', 'finalized'));

CREATE POLICY "utme_challenge_rounds_admin_all"
  ON public.utme_challenge_rounds FOR ALL
  TO authenticated
  USING (
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin') OR
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
  )
  WITH CHECK (
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin') OR
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
  );

-- Round Subjects Policies (Admin Only direct access)
CREATE POLICY "utme_challenge_round_subjects_admin_all"
  ON public.utme_challenge_round_subjects FOR ALL
  TO authenticated
  USING (
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin') OR
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
  )
  WITH CHECK (
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin') OR
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
  );

-- Round Questions Policies (Admin Only direct access; students access via sanitized RPC in Phase 2)
CREATE POLICY "utme_challenge_rq_admin_all"
  ON public.utme_challenge_round_questions FOR ALL
  TO authenticated
  USING (
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin') OR
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
  )
  WITH CHECK (
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin') OR
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
  );

-- Attempts Policies (Candidates read own attempts only; direct write access revoked)
CREATE POLICY "utme_challenge_attempts_select_own"
  ON public.utme_challenge_attempts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "utme_challenge_attempts_admin_select"
  ON public.utme_challenge_attempts FOR SELECT
  TO authenticated
  USING (
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin') OR
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
  );

-- Cron Logs Policies (Admin Only)
CREATE POLICY "utme_challenge_cron_logs_admin_all"
  ON public.utme_challenge_cron_logs FOR ALL
  TO authenticated
  USING (
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin') OR
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
  )
  WITH CHECK (
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin') OR
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
  );

-- Leaderboard Entries Policies (Direct candidate SELECT revoked; Admin all)
CREATE POLICY "utme_challenge_ldb_admin_all"
  ON public.utme_challenge_leaderboard_entries FOR ALL
  TO authenticated
  USING (
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin') OR
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
  )
  WITH CHECK (
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin') OR
    COALESCE(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
  );

-- ============================================================================
-- 16. PHASE 2 ARCHITECTURE & RULES
-- ============================================================================
/*
PHASE 2 IMPLEMENTATION RULES:
1. Freeze Flow Lifecycle:
   - Administrators curate questions into utme_challenge_round_questions while the round
     is in 'draft' status and is_questions_frozen = false.
   - Once question allocation across all round subjects is verified, the admin RPC freezes the round:
     sets is_questions_frozen = true and frozen_at = clock_timestamp().
   - From that exact moment onwards, database triggers permanently block any INSERT, UPDATE, or
     DELETE on utme_challenge_round_questions and utme_challenge_round_subjects.
   - The round can then safely transition to 'scheduled' and 'open'.

2. Attempt Start & Subject Locking:
   - When a student initiates a challenge round via the start attempt RPC:
     a) Verifies student registration exists for the season and round status = 'open'.
     b) Atomically updates public.utme_challenge_registrations to set locked_at = clock_timestamp().
        This permanently freezes the candidate's chosen four subjects for the remainder of the season.
     c) Instantiates the attempt row in public.utme_challenge_attempts with exact expires_at.
     d) Pre-creates all answers in public.utme_challenge_attempt_answers with NULL selected_option
        to guarantee a 100% complete denominator.
     e) Delivers a sanitized question payload to the candidate (stripping correct_option and explanation).

3. Strict Security Definer Function Standards:
   - All student and admin mutations MUST execute through SECURITY DEFINER PostgreSQL functions.
   - Every function MUST declare SET search_path = pg_catalog, public to defeat search path injection.
   - Every function MUST execute an explicit:
       REVOKE ALL ON FUNCTION public.<function_name> FROM PUBLIC, anon, authenticated;
     and selectively GRANT EXECUTE only to the authorized role ('authenticated' for students, or
     checked internally via JWT role claims for admins).
*/

-- ============================================================================
-- 17. POST-RUN VERIFICATION CHECKLIST (MANUAL VALIDATION ONLY - DO NOT EXECUTE)
-- ============================================================================
/*
POST-RUN VERIFICATION CHECKLIST:
Execute the following verification checks in Supabase SQL Editor or psql to confirm security posture:

1. utme_challenge_seasons:
   - anon:
     * SELECT FROM utme_challenge_seasons WHERE is_active = true -> SUCCEEDS (only active rows returned).
     * SELECT FROM utme_challenge_seasons WHERE is_active = false -> SUCCEEDS with 0 rows (RLS filtered).
     * INSERT / UPDATE / DELETE -> FAILS (42501 permission denied).
   - student (authenticated non-admin):
     * SELECT -> SUCCEEDS (active rows only).
     * INSERT / UPDATE / DELETE -> FAILS (42501 permission denied).
   - admin (authenticated with JWT role or service_role):
     * Direct SELECT -> SUCCEEDS.
     * Direct INSERT / UPDATE / DELETE -> FAILS for authenticated (table privilege revoked); SUCCEEDS for service_role or Phase 2 RPC.

2. utme_challenge_registrations:
   - anon:
     * SELECT -> FAILS (42501 permission denied).
     * INSERT / UPDATE / DELETE -> FAILS (42501 permission denied).
   - student:
     * SELECT -> SUCCEEDS (returns own row where auth.uid() = user_id; returns 0 rows for other users).
     * INSERT / UPDATE / DELETE -> FAILS (42501 permission denied; must use Phase 2 RPC).
   - admin / service_role:
     * SELECT / INSERT / UPDATE / DELETE via service_role or Phase 2 RPC -> SUCCEEDS.

3. utme_challenge_question_bank:
   - anon:
     * SELECT / INSERT / UPDATE / DELETE -> FAILS (42501 permission denied).
   - student:
     * SELECT / INSERT / UPDATE / DELETE -> FAILS (42501 permission denied). Table privileges fully revoked.
   - admin / service_role:
     * Direct query from authenticated -> FAILS (42501 permission denied); SUCCEEDS via service_role or Phase 2 RPC.

4. utme_challenge_rounds:
   - anon:
     * SELECT -> FAILS (42501 permission denied).
   - student:
     * SELECT -> SUCCEEDS (returns only rows with status IN ('scheduled', 'open', 'closed', 'finalized')).
     * SELECT draft rounds -> SUCCEEDS with 0 rows (RLS filtered).
     * INSERT / UPDATE / DELETE -> FAILS (42501 permission denied).
   - admin / service_role:
     * Status regression or unfreezing questions on rounds with attempts -> FAILS with trigger exception.
     * Mutations via Phase 2 RPC or service_role -> SUCCEEDS.

5. utme_challenge_round_subjects:
   - anon:
     * SELECT / INSERT / UPDATE / DELETE -> FAILS (42501 permission denied).
   - student:
     * SELECT / INSERT / UPDATE / DELETE -> FAILS (42501 permission denied).
   - admin / service_role:
     * Direct mutation from authenticated -> FAILS (table privilege revoked); SUCCEEDS via service_role or Phase 2 RPC.
     * Mutations when round is frozen or attempts exist -> FAILS with trigger exception.

6. utme_challenge_round_questions:
   - anon:
     * SELECT / INSERT / UPDATE / DELETE -> FAILS (42501 permission denied).
   - student:
     * SELECT / INSERT / UPDATE / DELETE -> FAILS (42501 permission denied). Answer keys completely shielded.
   - admin / service_role:
     * Direct mutation from authenticated -> FAILS (table privilege revoked); SUCCEEDS via service_role or Phase 2 RPC.
     * INSERT / UPDATE / DELETE when round is frozen or attempts exist -> FAILS with trigger exception.
     * Cascade deletion when draft round is deleted -> SUCCEEDS (NO ACTION constraint deferred to statement completion).

7. utme_challenge_attempts:
   - anon:
     * SELECT / INSERT / UPDATE / DELETE -> FAILS (42501 permission denied).
   - student:
     * SELECT -> SUCCEEDS (own attempts only where auth.uid() = user_id).
     * INSERT / UPDATE / DELETE -> FAILS (42501 permission denied; must use Phase 2 RPC).
   - admin / service_role:
     * SELECT all attempts -> SUCCEEDS via policy utme_challenge_attempts_admin_select or service_role.

8. utme_challenge_attempt_answers:
   - anon:
     * SELECT / INSERT / UPDATE / DELETE -> FAILS (42501 permission denied).
   - student:
     * SELECT / INSERT / UPDATE / DELETE -> FAILS (42501 permission denied; access exclusively through Phase 2 RPC).
   - admin / service_role:
     * Query / mutation via service_role or Phase 2 RPC -> SUCCEEDS.

9. utme_challenge_answer_idempotency:
   - anon / student:
     * SELECT / INSERT / UPDATE / DELETE -> FAILS (42501 permission denied).
   - admin / service_role:
     * Managed exclusively via Phase 2 submit answer RPC.

10. utme_challenge_cron_logs:
    - anon / student:
      * SELECT / INSERT / UPDATE / DELETE -> FAILS (42501 permission denied).
    - admin / service_role:
      * Direct authenticated query -> FAILS (42501 permission denied); service_role worker -> SUCCEEDS.

11. utme_challenge_leaderboard_entries:
    - anon:
      * SELECT / INSERT / UPDATE / DELETE -> FAILS (42501 permission denied).
    - student:
      * SELECT direct table -> FAILS (42501 permission denied; student queries exclusively through Phase 2 leaderboard RPC).
      * INSERT / UPDATE / DELETE -> FAILS (42501 permission denied).
    - admin / service_role:
      * Query / refresh via service_role or Phase 2 RPC -> SUCCEEDS.
*/

COMMIT;
