-- ExamPilot Phase 7: Notifications Foundation
-- 1. Extends public.notifications with category, event_type, event_key, expires_at
-- 2. Creates public.notification_reads for multi-device read synchronization
--    with student-scoped RLS
-- 3. Adds public.cleanup_expired_notifications() for 7-day retention cleanup

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. EXTEND public.notifications
-- -----------------------------------------------------------------------------

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'personal',
  ADD COLUMN IF NOT EXISTS event_type text,
  ADD COLUMN IF NOT EXISTS event_key text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Add category validation only if the constraint does not already exist
-- specifically on public.notifications.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t
      ON t.oid = c.conrelid
    JOIN pg_namespace n
      ON n.oid = t.relnamespace
    WHERE c.conname = 'notifications_category_check'
      AND t.relname = 'notifications'
      AND n.nspname = 'public'
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_category_check
      CHECK (category IN ('personal', 'community', 'announcement'));
  END IF;
END $$;

-- Existing notifications retain their original 7-day lifetime.
-- IMPORTANT: this uses each notification's own created_at timestamp.
UPDATE public.notifications
SET expires_at = created_at + interval '7 days'
WHERE expires_at IS NULL;

-- New notifications receive a 7-day expiry by default.
ALTER TABLE public.notifications
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '7 days'),
  ALTER COLUMN expires_at SET NOT NULL;

-- Prevent duplicate automatic notifications when event_key is supplied.
-- NULL event_key values remain allowed for manual/admin notifications.
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_event_key_unique
  ON public.notifications (event_key)
  WHERE event_key IS NOT NULL;

-- Supporting indexes for notification filtering and expiry cleanup.
CREATE INDEX IF NOT EXISTS idx_notifications_category
  ON public.notifications (category);

CREATE INDEX IF NOT EXISTS idx_notifications_expires_at
  ON public.notifications (expires_at);

-- -----------------------------------------------------------------------------
-- 2. SERVER-SIDE READ STATE TRACKING
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.notification_reads (
  notification_id bigint NOT NULL
    REFERENCES public.notifications(id)
    ON DELETE CASCADE,

  user_id uuid NOT NULL
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  read_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notification_reads_pkey
    PRIMARY KEY (notification_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_reads_user_id
  ON public.notification_reads (user_id);

ALTER TABLE public.notification_reads
  ENABLE ROW LEVEL SECURITY;

-- Students can read only their own read receipts.
DROP POLICY IF EXISTS "notification_reads_select_own"
  ON public.notification_reads;

CREATE POLICY "notification_reads_select_own"
ON public.notification_reads
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Students can create only their own read receipts.
DROP POLICY IF EXISTS "notification_reads_insert_own"
  ON public.notification_reads;

CREATE POLICY "notification_reads_insert_own"
ON public.notification_reads
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Students can update only their own read receipts.
DROP POLICY IF EXISTS "notification_reads_update_own"
  ON public.notification_reads;

CREATE POLICY "notification_reads_update_own"
ON public.notification_reads
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Students can delete only their own read receipts.
DROP POLICY IF EXISTS "notification_reads_delete_own"
  ON public.notification_reads;

CREATE POLICY "notification_reads_delete_own"
ON public.notification_reads
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 3. EXPIRY CLEANUP FUNCTION
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cleanup_expired_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.notifications
  WHERE expires_at <= now();

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RETURN deleted_count;
END;
$$;

-- Do not expose cleanup execution to normal/public callers.
REVOKE ALL
  ON FUNCTION public.cleanup_expired_notifications()
  FROM PUBLIC;

GRANT EXECUTE
  ON FUNCTION public.cleanup_expired_notifications()
  TO service_role;

COMMIT;
