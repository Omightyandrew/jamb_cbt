-- ExamPilot UTME Challenge 2027: Phase 2A Hardening
-- Migration: 20261124010000_utme_challenge_phase2a_hardening.sql
-- Strictly additive/corrective to the Phase 1 foundation.
-- Does NOT modify any existing ExamPilot tables, views, or functions.

BEGIN;

-- ============================================================================
-- 1. REVOKE DIRECT EXECUTE ON FOUNDATION TRIGGER FUNCTIONS
-- Trigger functions must execute strictly via trigger invocations, never directly
-- called via PostgREST RPC by public, anonymous, or authenticated clients.
-- ============================================================================
REVOKE ALL ON FUNCTION public.utme_challenge_validate_registration() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.utme_challenge_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.utme_challenge_protect_frozen_questions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.utme_challenge_protect_round_subjects() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.utme_challenge_protect_round_config() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 2. CHANGE ATTEMPTS -> REGISTRATIONS FOREIGN KEY CONSTRAINT TO NO ACTION
-- Explanation: When a user account is deleted in auth.users, cascade deletion
-- propagates to both utme_challenge_registrations and utme_challenge_attempts
-- within a single SQL statement.
-- With ON DELETE RESTRICT, PostgreSQL enforces the constraint immediately as
-- each row is deleted, triggering an immediate referential violation if the
-- registration row is processed before the referencing attempt row.
-- Changing to ON DELETE NO ACTION causes PostgreSQL to verify the constraint at
-- the end of the SQL statement (statement-level enforcement), allowing the
-- cascading deletion of both referencing attempts and referenced registrations
-- to complete cleanly without unexpected blocks.
-- Note: DEFERRABLE would defer checking to transaction commit; NO ACTION checks
-- at the end of the SQL statement, which is the exact behavior needed for
-- cascading user deletions.
-- ============================================================================
ALTER TABLE public.utme_challenge_attempts
  DROP CONSTRAINT IF EXISTS utme_challenge_attempt_reg_fk;

ALTER TABLE public.utme_challenge_attempts
  ADD CONSTRAINT utme_challenge_attempt_reg_fk
  FOREIGN KEY (registration_id, season_id, user_id)
  REFERENCES public.utme_challenge_registrations(id, season_id, user_id)
  ON DELETE NO ACTION;

-- ============================================================================
-- 3. ATTEMPT IMMUTABILITY & ANTI-TAMPER TRIGGER
-- Blocks changes to id, user_id, round_id, season_id, registration_id,
-- selected_subjects, started_at, expires_at, and total_questions_assigned after insert.
-- Blocks any status change away from 'submitted' or 'expired' (reopening final attempts is prohibited).
-- Uses TG_OP-safe logic, explicit search_path, and revoked execute permissions.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.utme_challenge_protect_attempt_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- A. Structural parameters and timers are immutable post-creation
    IF NEW.id <> OLD.id OR
       NEW.user_id <> OLD.user_id OR
       NEW.round_id <> OLD.round_id OR
       NEW.season_id <> OLD.season_id OR
       NEW.registration_id <> OLD.registration_id OR
       NEW.selected_subjects <> OLD.selected_subjects OR
       NEW.started_at <> OLD.started_at OR
       NEW.expires_at <> OLD.expires_at OR
       NEW.total_questions_assigned <> OLD.total_questions_assigned THEN
      RAISE EXCEPTION 'Immutable attempt fields (id, user_id, round_id, season_id, registration_id, subjects, timers, question count) cannot be modified.';
    END IF;

    -- B. Finalized attempts ('submitted' or 'expired') can never reopen or regress status
    IF OLD.status IN ('submitted', 'expired') AND NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'Attempt "%" is finalized with status "%" and cannot be modified or reopened.', OLD.id, OLD.status;
    END IF;

    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.utme_challenge_protect_attempt_integrity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS utme_challenge_attempts_protect_trg ON public.utme_challenge_attempts;
CREATE TRIGGER utme_challenge_attempts_protect_trg
BEFORE UPDATE ON public.utme_challenge_attempts
FOR EACH ROW EXECUTE FUNCTION public.utme_challenge_protect_attempt_integrity();

COMMIT;
