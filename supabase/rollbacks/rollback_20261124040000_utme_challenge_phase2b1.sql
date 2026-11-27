-- ExamPilot UTME Challenge 2027: Rollback for Phase 2B-1
-- File: supabase/rollbacks/rollback_20261124040000_utme_challenge_phase2b1.sql
-- Strictly reverses Phase 2B-1 admin database functions and foundation index.
-- Removes ONLY objects introduced in:
--   - 20261124040000_utme_challenge_phase2b1_admin_functions.sql
-- Does NOT touch Phase 1 foundation tables, Phase 2A functions, or user data.

BEGIN;

-- ============================================================================
-- 1. DROP ADMIN READ FUNCTIONS
-- ============================================================================
DROP FUNCTION IF EXISTS public.utme_challenge_admin_question_pool_summary(integer) CASCADE;
DROP FUNCTION IF EXISTS public.utme_challenge_admin_question_pool_summary() CASCADE;
DROP FUNCTION IF EXISTS public.utme_challenge_admin_list_questions(text, text, integer, integer) CASCADE;
DROP FUNCTION IF EXISTS public.utme_challenge_admin_round_overview(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.utme_challenge_admin_list_rounds(uuid) CASCADE;

-- ============================================================================
-- 2. DROP ROUND LIFECYCLE & PAPER MANAGEMENT FUNCTIONS
-- ============================================================================
DROP FUNCTION IF EXISTS public.utme_challenge_admin_unschedule_round(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.utme_challenge_admin_freeze_and_schedule_round(uuid, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.utme_challenge_admin_freeze_and_schedule_round(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.utme_challenge_admin_build_round_paper(uuid) CASCADE;

-- ============================================================================
-- 3. DROP QUESTION BANK MANAGEMENT FUNCTIONS
-- ============================================================================
DROP FUNCTION IF EXISTS public.utme_challenge_admin_set_question_status(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.utme_challenge_admin_update_question(uuid, text, text, jsonb, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.utme_challenge_admin_add_question(text, text, text, jsonb, text, text) CASCADE;

-- ============================================================================
-- 4. DROP ROUND CONFIGURATION FUNCTIONS
-- ============================================================================
DROP FUNCTION IF EXISTS public.utme_challenge_admin_set_round_subjects(uuid, jsonb) CASCADE;
DROP FUNCTION IF EXISTS public.utme_challenge_admin_update_round(uuid, text, timestamptz, timestamptz, timestamptz, timestamptz, integer, integer) CASCADE;
DROP FUNCTION IF EXISTS public.utme_challenge_admin_create_round(uuid, integer, text, timestamptz, timestamptz, timestamptz, timestamptz, integer, integer) CASCADE;

-- ============================================================================
-- 5. DROP SEASON MANAGEMENT & ADMIN GATEWAY
-- ============================================================================
DROP FUNCTION IF EXISTS public.utme_challenge_admin_upsert_season(uuid, integer, text, boolean) CASCADE;
DROP FUNCTION IF EXISTS public.utme_challenge_require_admin_internal() CASCADE;

-- ============================================================================
-- 6. DROP PARTIAL UNIQUE INDEX ON ACTIVE SEASONS
-- ============================================================================
DROP INDEX IF EXISTS public.utme_challenge_seasons_one_active_idx CASCADE;

COMMIT;
