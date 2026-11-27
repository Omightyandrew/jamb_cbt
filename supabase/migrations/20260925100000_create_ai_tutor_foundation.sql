-- ExamPilot Phase 3B AI Tutor foundation.
-- Stores only premium conversation history and server-enforced usage state.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_usage_daily (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  successful_requests integer NOT NULL DEFAULT 0,
  pending_requests integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, usage_date),
  CONSTRAINT ai_usage_daily_successful_nonnegative CHECK (successful_requests >= 0),
  CONSTRAINT ai_usage_daily_pending_nonnegative CHECK (pending_requests >= 0)
);

CREATE TABLE IF NOT EXISTS public.ai_quota_reservations (
  request_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz,
  CONSTRAINT ai_quota_reservations_status_valid CHECK (status IN ('pending', 'success', 'failed'))
);

CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exam_id uuid REFERENCES public.exams(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'AI Tutor',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.ai_conversations'::regclass
      AND conname = 'ai_conversations_max_retention'
  ) THEN
    ALTER TABLE public.ai_conversations
      ADD CONSTRAINT ai_conversations_max_retention
      CHECK (expires_at <= created_at + interval '10 days');
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_messages_role_valid CHECK (role IN ('user', 'assistant')),
  CONSTRAINT ai_messages_content_not_blank CHECK (btrim(content) <> ''),
  CONSTRAINT ai_messages_content_size CHECK (char_length(content) <= 12000)
);

CREATE INDEX IF NOT EXISTS ai_usage_daily_date_idx
  ON public.ai_usage_daily (usage_date);
CREATE INDEX IF NOT EXISTS ai_quota_reservations_user_date_idx
  ON public.ai_quota_reservations (user_id, usage_date);
CREATE INDEX IF NOT EXISTS ai_conversations_user_expiry_idx
  ON public.ai_conversations (user_id, expires_at);
CREATE INDEX IF NOT EXISTS ai_messages_conversation_created_idx
  ON public.ai_messages (conversation_id, created_at);

ALTER TABLE public.ai_usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_quota_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;

-- Usage and reservation rows are gateway-owned. Students never write quota state directly.
REVOKE ALL ON public.ai_usage_daily FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ai_quota_reservations FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE ON public.ai_conversations FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS ai_conversations_select_own ON public.ai_conversations;
CREATE POLICY ai_conversations_select_own
  ON public.ai_conversations FOR SELECT TO authenticated
  USING (auth.uid() = user_id AND expires_at > now());

DROP POLICY IF EXISTS ai_conversations_insert_own ON public.ai_conversations;
DROP POLICY IF EXISTS ai_conversations_update_own ON public.ai_conversations;

DROP POLICY IF EXISTS ai_conversations_delete_own ON public.ai_conversations;
CREATE POLICY ai_conversations_delete_own
  ON public.ai_conversations FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS ai_messages_select_own ON public.ai_messages;
CREATE POLICY ai_messages_select_own
  ON public.ai_messages FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.ai_conversations conversation
      WHERE conversation.id = ai_messages.conversation_id
        AND conversation.user_id = auth.uid()
        AND conversation.expires_at > now()
    )
  );

-- Message writes are performed by the gateway service role after a successful provider response.
REVOKE ALL ON public.ai_messages FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reserve_ai_quota(
  p_request_id uuid,
  p_user_id uuid,
  p_usage_date date,
  p_quota integer
)
RETURNS TABLE (allowed boolean, successful_requests integer, pending_requests integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_row public.ai_usage_daily;
BEGIN
  IF p_quota IS NULL OR p_quota <= 0 THEN
    RAISE EXCEPTION 'AI quota must be positive';
  END IF;

  INSERT INTO public.ai_usage_daily (user_id, usage_date)
  VALUES (p_user_id, p_usage_date)
  ON CONFLICT (user_id, usage_date) DO NOTHING;

  IF EXISTS (
    SELECT 1 FROM public.ai_quota_reservations
    WHERE request_id = p_request_id
  ) THEN
    RETURN QUERY SELECT false, 0, 0;
    RETURN;
  END IF;

  UPDATE public.ai_usage_daily
  SET pending_requests = pending_requests + 1,
      updated_at = now()
  WHERE user_id = p_user_id
    AND usage_date = p_usage_date
    AND successful_requests + pending_requests < p_quota
  RETURNING * INTO updated_row;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT false, usage.successful_requests, usage.pending_requests
    FROM public.ai_usage_daily usage
    WHERE usage.user_id = p_user_id
      AND usage.usage_date = p_usage_date;
    RETURN;
  END IF;

  INSERT INTO public.ai_quota_reservations (request_id, user_id, usage_date)
  VALUES (p_request_id, p_user_id, p_usage_date);

  RETURN QUERY SELECT true, updated_row.successful_requests, updated_row.pending_requests;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_ai_quota(
  p_request_id uuid,
  p_success boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reservation public.ai_quota_reservations;
BEGIN
  SELECT * INTO reservation
  FROM public.ai_quota_reservations
  WHERE request_id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR reservation.status <> 'pending' THEN
    RETURN false;
  END IF;

  UPDATE public.ai_usage_daily
  SET pending_requests = GREATEST(0, pending_requests - 1),
      successful_requests = successful_requests + CASE WHEN p_success THEN 1 ELSE 0 END,
      updated_at = now()
  WHERE user_id = reservation.user_id
    AND usage_date = reservation.usage_date;

  UPDATE public.ai_quota_reservations
  SET status = CASE WHEN p_success THEN 'success' ELSE 'failed' END,
      finalized_at = now()
  WHERE request_id = p_request_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_expired_ai_conversations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.ai_conversations
  WHERE expires_at <= now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  DELETE FROM public.ai_quota_reservations
  WHERE created_at < now() - interval '1 day';
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_ai_quota(uuid, uuid, date, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_ai_quota(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_expired_ai_conversations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reserve_ai_quota(uuid, uuid, date, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_ai_quota(uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_ai_conversations() TO service_role;

-- Supabase projects with pg_cron enabled get automatic hourly cleanup.
-- The Edge Function also calls the cleanup function defensively on each request.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.schedule(
        'exampilot-ai-tutor-cleanup',
        '0 * * * *',
        'SELECT public.cleanup_expired_ai_conversations();'
      );
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END IF;
END;
$$;

COMMIT;
