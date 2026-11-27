-- ExamPilot: Add push delivery tracking to notifications

BEGIN;

ALTER TABLE public.notifications
ADD COLUMN IF NOT EXISTS push_delivered_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_notifications_pending_push
ON public.notifications (event_type, event_key)
WHERE push_delivered_at IS NULL;

COMMIT;
