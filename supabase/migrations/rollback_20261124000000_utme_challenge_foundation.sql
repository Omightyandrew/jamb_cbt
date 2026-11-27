-- ExamPilot UTME Challenge 2027: Rollback for Phase 1 Database Foundation
-- Migration: rollback_20261124000000_utme_challenge_foundation.sql
-- Strictly reverses 20261124000000_utme_challenge_foundation.sql.
-- Drops ONLY objects created by the foundation migration in safe dependency order.
-- Does NOT drop or modify any existing ExamPilot tables, views, functions, or data.

BEGIN;

-- ============================================================================
-- 1. DROP UTME CHALLENGE TABLES (REVERSE DEPENDENCY ORDER)
-- ============================================================================
DROP TABLE IF EXISTS public.utme_challenge_leaderboard_entries CASCADE;
DROP TABLE IF EXISTS public.utme_challenge_cron_logs CASCADE;
DROP TABLE IF EXISTS public.utme_challenge_answer_idempotency CASCADE;
DROP TABLE IF EXISTS public.utme_challenge_attempt_answers CASCADE;
DROP TABLE IF EXISTS public.utme_challenge_attempts CASCADE;
DROP TABLE IF EXISTS public.utme_challenge_round_questions CASCADE;
DROP TABLE IF EXISTS public.utme_challenge_round_subjects CASCADE;
DROP TABLE IF EXISTS public.utme_challenge_rounds CASCADE;
DROP TABLE IF EXISTS public.utme_challenge_question_bank CASCADE;
DROP TABLE IF EXISTS public.utme_challenge_registrations CASCADE;
DROP TABLE IF EXISTS public.utme_challenge_seasons CASCADE;

-- ============================================================================
-- 2. DROP UTME CHALLENGE TRIGGER FUNCTIONS
-- ============================================================================
DROP FUNCTION IF EXISTS public.utme_challenge_protect_round_config() CASCADE;
DROP FUNCTION IF EXISTS public.utme_challenge_protect_round_subjects() CASCADE;
DROP FUNCTION IF EXISTS public.utme_challenge_protect_frozen_questions() CASCADE;
DROP FUNCTION IF EXISTS public.utme_challenge_set_updated_at() CASCADE;
DROP FUNCTION IF EXISTS public.utme_challenge_validate_registration() CASCADE;

COMMIT;
