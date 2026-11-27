-- ExamPilot UTME Challenge 2027: Rollback for Phase 2A
-- File: supabase/rollbacks/rollback_20261124_utme_challenge_phase2a.sql
-- Strictly reverses Phase 2A hardening and student functions.
-- Removes ONLY objects and constraints introduced in:
--   - 20261124010000_utme_challenge_phase2a_hardening.sql
--   - 20261124020000_utme_challenge_phase2a_student_functions.sql
-- Does NOT touch Phase 1 foundation tables, existing ExamPilot tables, or user data.

BEGIN;

-- ============================================================================
-- 1. DROP PHASE 2A STUDENT RPCs & INTERNAL FUNCTIONS
-- ============================================================================
DROP FUNCTION IF EXISTS public.utme_challenge_get_leaderboard(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.utme_challenge_submit_attempt(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.utme_challenge_save_answers(uuid, uuid, jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.utme_challenge_start_attempt(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.utme_challenge_get_overview() CASCADE;
DROP FUNCTION IF EXISTS public.utme_challenge_register(text, text[]) CASCADE;
DROP FUNCTION IF EXISTS public.utme_challenge_grade_attempt_internal(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.utme_challenge_is_premium_internal(uuid) CASCADE;

-- ============================================================================
-- 2. DROP ATTEMPTS IMMUTABILITY TRIGGER & TRIGGER FUNCTION
-- ============================================================================
DROP TRIGGER IF EXISTS utme_challenge_attempts_protect_trg ON public.utme_challenge_attempts CASCADE;
DROP FUNCTION IF EXISTS public.utme_challenge_protect_attempt_integrity() CASCADE;

-- ============================================================================
-- 3. REVERT ATTEMPTS -> REGISTRATIONS FOREIGN KEY CONSTRAINT TO RESTRICT
-- ============================================================================
ALTER TABLE public.utme_challenge_attempts
  DROP CONSTRAINT IF EXISTS utme_challenge_attempt_reg_fk;

ALTER TABLE public.utme_challenge_attempts
  ADD CONSTRAINT utme_challenge_attempt_reg_fk
  FOREIGN KEY (registration_id, season_id, user_id)
  REFERENCES public.utme_challenge_registrations(id, season_id, user_id)
  ON DELETE RESTRICT;

COMMIT;
