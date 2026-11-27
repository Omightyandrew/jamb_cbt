-- ============================================================================
-- ExamPilot Referral V1 Migration: Admin Referral Payout Management
-- File: supabase/migrations/20261008020000_admin_referral_payout_management.sql
--
-- 1. Updates RLS policy on public.referral_payouts & referral_payout_accounts
--    to recognize administrators via either JWT app_metadata role OR
--    Student_profiles.is_admin = true (matching ExamPilot dual-admin pattern).
-- 2. Creates secure RPC: public.admin_update_referral_payout_status()
--    - Authorizes admin/super_admin or Student_profiles.is_admin
--    - Validates payout record existence
--    - Enforces valid status transitions:
--        pending -> processing
--        pending -> completed
--        processing -> completed
--        pending -> rejected
--        processing -> rejected
--    - Prevents double-processing: completed or rejected payouts cannot be altered
--    - Automatically sets processed_at = now() for completed / rejected
--    - Stores optional admin notes and updates updated_at timestamp
--    - Preserves all financial amounts and bank detail snapshots immutably
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Update RLS Policies for Dual Admin Authorization (JWT + Student_profiles)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "referral_payouts_admin_all" ON public.referral_payouts;
CREATE POLICY "referral_payouts_admin_all"
    ON public.referral_payouts
    FOR ALL
    TO authenticated
    USING (
        coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin')
        OR coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
        OR EXISTS (
            SELECT 1 FROM public."Student_profiles"
            WHERE id = auth.uid() AND is_admin = true
        )
    )
    WITH CHECK (
        coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin')
        OR coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
        OR EXISTS (
            SELECT 1 FROM public."Student_profiles"
            WHERE id = auth.uid() AND is_admin = true
        )
    );

DROP POLICY IF EXISTS "referral_payout_accounts_admin_all" ON public.referral_payout_accounts;
CREATE POLICY "referral_payout_accounts_admin_all"
    ON public.referral_payout_accounts
    FOR ALL
    TO authenticated
    USING (
        coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin')
        OR coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
        OR EXISTS (
            SELECT 1 FROM public."Student_profiles"
            WHERE id = auth.uid() AND is_admin = true
        )
    )
    WITH CHECK (
        coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin')
        OR coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
        OR EXISTS (
            SELECT 1 FROM public."Student_profiles"
            WHERE id = auth.uid() AND is_admin = true
        )
    );


-- ----------------------------------------------------------------------------
-- 2. RPC: public.admin_update_referral_payout_status
-- Server-authoritative status transition and note recording for Admin.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_referral_payout_status(
    p_payout_id bigint,
    p_new_status text,
    p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_admin_id uuid := auth.uid();
    v_is_admin boolean := false;
    v_payout public.referral_payouts%ROWTYPE;
    v_clean_status text;
    v_clean_notes text;
BEGIN
    -- 1. Verify caller authentication
    IF v_admin_id IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'unauthenticated',
            'message', 'Authentication required'
        );
    END IF;

    -- 2. Verify admin authorization: check JWT app_metadata OR Student_profiles.is_admin
    IF (
        COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin')
        OR COALESCE(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
    ) THEN
        v_is_admin := true;
    ELSE
        SELECT (is_admin = true) INTO v_is_admin
        FROM public."Student_profiles"
        WHERE id = v_admin_id;
    END IF;

    IF NOT COALESCE(v_is_admin, false) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'unauthorized',
            'message', 'Administrator privilege required to update referral payout'
        );
    END IF;

    -- 3. Validate payout record exists
    SELECT * INTO v_payout
    FROM public.referral_payouts
    WHERE id = p_payout_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'not_found',
            'message', 'Payout record not found'
        );
    END IF;

    -- 4. Clean and validate target status
    v_clean_status := lower(trim(COALESCE(p_new_status, '')));
    v_clean_notes := NULLIF(trim(COALESCE(p_notes, '')), '');

    IF v_clean_status NOT IN ('processing', 'completed', 'rejected') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'invalid_status',
            'message', 'Invalid status. Allowed targets are: processing, completed, rejected'
        );
    END IF;

    -- 5. Prevent modifying already finalized payouts (idempotency & double-spend protection)
    IF v_payout.status = 'completed' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'already_completed',
            'message', 'Payout #' || p_payout_id || ' has already been marked completed and cannot be modified again'
        );
    END IF;

    IF v_payout.status = 'rejected' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'already_rejected',
            'message', 'Payout #' || p_payout_id || ' has already been rejected and cannot be modified'
        );
    END IF;

    -- 6. Validate transition rules:
    -- pending -> processing
    -- pending -> completed
    -- processing -> completed
    -- pending -> rejected
    -- processing -> rejected
    IF v_payout.status = 'pending' AND v_clean_status NOT IN ('processing', 'completed', 'rejected') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'invalid_transition',
            'message', 'Cannot transition payout from pending to ' || v_clean_status
        );
    END IF;

    IF v_payout.status = 'processing' AND v_clean_status NOT IN ('completed', 'rejected') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'invalid_transition',
            'message', 'Cannot transition payout from processing to ' || v_clean_status
        );
    END IF;

    -- 7. Execute authoritative update
    UPDATE public.referral_payouts
    SET
        status = v_clean_status,
        admin_notes = COALESCE(v_clean_notes, admin_notes),
        processed_at = CASE
            WHEN v_clean_status IN ('completed', 'rejected') THEN now()
            ELSE processed_at
        END,
        updated_at = now()
    WHERE id = p_payout_id;

    RETURN jsonb_build_object(
        'success', true,
        'payout_id', p_payout_id,
        'old_status', v_payout.status,
        'new_status', v_clean_status,
        'message', 'Payout #' || p_payout_id || ' status successfully updated to ' || v_clean_status
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_referral_payout_status(bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_referral_payout_status(bigint, text, text) TO authenticated;

COMMIT;

