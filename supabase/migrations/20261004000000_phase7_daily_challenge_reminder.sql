-- ExamPilot Phase 7: Daily Challenge Reminder
-- Automatically generates at most one personal notification per eligible student
-- for today's Daily Challenge.
--
-- Authoritative completion is checked against public.challenge_attempts.
-- Idempotency is enforced by unique partial index on event_key:
--   challenge_reminder:<user_id>:<YYYY-MM-DD>

BEGIN;

CREATE OR REPLACE FUNCTION public.generate_daily_challenge_reminders(
  p_challenge_date date DEFAULT (now() AT TIME ZONE 'Africa/Lagos')::date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_inserted_count integer := 0;
  v_today_str text;
BEGIN
  -- 1. Format the Africa/Lagos challenge date as YYYY-MM-DD
  v_today_str := to_char(p_challenge_date, 'YYYY-MM-DD');

  -- 2. Identify eligible students and insert reminder notifications:
  --    - Exists in Student_profiles
  --    - Not an admin (COALESCE(is_admin, false) = false)
  --    - Has NOT completed today's challenge in challenge_attempts
  --    - Idempotency: ON CONFLICT DO NOTHING on event_key guarantees at most 1 reminder/day
  WITH eligible_students AS (
    SELECT sp.id AS user_id
    FROM public."Student_profiles" sp
    WHERE COALESCE(sp.is_admin, false) = false
      AND NOT EXISTS (
        SELECT 1
        FROM public.challenge_attempts ca
        WHERE ca.user_id = sp.id
          AND ca.challenge_date = p_challenge_date
      )
  ),
  inserted_reminders AS (
    INSERT INTO public.notifications (
      title,
      message,
      target_type,
      target_user_id,
      category,
      event_type,
      event_key,
      destination_url,
      expires_at
    )
    SELECT
      '⚡ Daily Challenge Reminder' AS title,
      'Keep your streak alive! Today''s Daily Challenge is waiting for you. Test your knowledge and climb the leaderboard.' AS message,
      'specific' AS target_type,
      es.user_id AS target_user_id,
      'personal' AS category,
      'challenge_reminder' AS event_type,
      'challenge_reminder:' || es.user_id::text || ':' || v_today_str AS event_key,
      './challenge.html' AS destination_url,
      now() + interval '7 days' AS expires_at
    FROM eligible_students es
    ON CONFLICT (event_key) WHERE event_key IS NOT NULL DO NOTHING
    RETURNING id
  )
  SELECT count(*) INTO v_inserted_count FROM inserted_reminders;

  RETURN v_inserted_count;
END;
$$;

-- Secure execution: callable only by service_role (background jobs / Edge Functions)
REVOKE ALL
  ON FUNCTION public.generate_daily_challenge_reminders(date)
  FROM PUBLIC;

GRANT EXECUTE
  ON FUNCTION public.generate_daily_challenge_reminders(date)
  TO service_role;

COMMIT;
