-- ============================================================================
-- ExamPilot Referral V1 Migration
-- File: supabase/migrations/20261008000000_create_referral_v1.sql
--
-- Creates the 5 dedicated tables and server-authoritative RPCs for Referral V1.
-- Keeps existing tables (Student_profiles, subscriptions, payment_transactions)
-- 100% frozen and unmodified.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. TABLE: public.student_referral_codes
-- Owns the unique 1:1 referral code for each student.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_referral_codes (
    id bigserial PRIMARY KEY,
    user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    referral_code text UNIQUE NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_referral_code_format CHECK (
        length(referral_code) >= 3 AND length(referral_code) <= 32
    ),
    CONSTRAINT chk_referral_code_uppercase CHECK (
        referral_code = upper(referral_code)
    )
);

CREATE INDEX IF NOT EXISTS idx_student_referral_codes_user_id 
    ON public.student_referral_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_student_referral_codes_code 
    ON public.student_referral_codes(upper(referral_code));

ALTER TABLE public.student_referral_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "student_referral_codes_read_own" ON public.student_referral_codes;
CREATE POLICY "student_referral_codes_read_own"
    ON public.student_referral_codes
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "student_referral_codes_admin_all" ON public.student_referral_codes;
CREATE POLICY "student_referral_codes_admin_all"
    ON public.student_referral_codes
    FOR ALL
    TO authenticated
    USING (
        coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin')
        OR coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
    )
    WITH CHECK (
        coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin')
        OR coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
    );


-- ----------------------------------------------------------------------------
-- 2. TABLE: public.referral_attributions
-- Immutable binding between referred student and referrer.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referral_attributions (
    id bigserial PRIMARY KEY,
    referred_user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    referrer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    referral_code text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_no_self_referral CHECK (referred_user_id <> referrer_user_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_attributions_referrer 
    ON public.referral_attributions(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referral_attributions_referred 
    ON public.referral_attributions(referred_user_id);

ALTER TABLE public.referral_attributions ENABLE ROW LEVEL SECURITY;

-- Referrer can see people they referred
DROP POLICY IF EXISTS "referral_attributions_read_referrer" ON public.referral_attributions;
CREATE POLICY "referral_attributions_read_referrer"
    ON public.referral_attributions
    FOR SELECT
    TO authenticated
    USING (auth.uid() = referrer_user_id);

-- Referred student can see their own attribution
DROP POLICY IF EXISTS "referral_attributions_read_referred" ON public.referral_attributions;
CREATE POLICY "referral_attributions_read_referred"
    ON public.referral_attributions
    FOR SELECT
    TO authenticated
    USING (auth.uid() = referred_user_id);

-- Admin full access
DROP POLICY IF EXISTS "referral_attributions_admin_all" ON public.referral_attributions;
CREATE POLICY "referral_attributions_admin_all"
    ON public.referral_attributions
    FOR ALL
    TO authenticated
    USING (
        coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin')
        OR coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
    )
    WITH CHECK (
        coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin')
        OR coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
    );


-- ----------------------------------------------------------------------------
-- 3. TABLE: public.referral_payouts
-- Records payout requests and preserves immutable snapshot of bank details.
-- Students cannot directly INSERT; payouts must be requested via RPC.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referral_payouts (
    id bigserial PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    amount bigint NOT NULL CHECK (amount >= 120000), -- ₦1,200 min threshold in kobo
    status text NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'processing', 'completed', 'rejected')
    ),
    bank_name text NOT NULL,
    account_number text NOT NULL,
    account_name text NOT NULL,
    processed_at timestamptz,
    admin_notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_payouts_user_id 
    ON public.referral_payouts(user_id);
CREATE INDEX IF NOT EXISTS idx_referral_payouts_status 
    ON public.referral_payouts(status);

ALTER TABLE public.referral_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "referral_payouts_read_own" ON public.referral_payouts;
CREATE POLICY "referral_payouts_read_own"
    ON public.referral_payouts
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Direct client INSERT is deliberately removed for students.
-- Payouts must be created atomically via public.request_referral_payout() RPC.
DROP POLICY IF EXISTS "referral_payouts_insert_own" ON public.referral_payouts;

DROP POLICY IF EXISTS "referral_payouts_admin_all" ON public.referral_payouts;
CREATE POLICY "referral_payouts_admin_all"
    ON public.referral_payouts
    FOR ALL
    TO authenticated
    USING (
        coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin')
        OR coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
    )
    WITH CHECK (
        coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin')
        OR coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
    );


-- ----------------------------------------------------------------------------
-- 4. TABLE: public.referral_commissions
-- Auditable ledger of 20% commission on verified first purchases only.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referral_commissions (
    id bigserial PRIMARY KEY,
    referrer_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    referred_user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    payment_transaction_id bigint REFERENCES public.payment_transactions(id) ON DELETE RESTRICT,
    payment_reference text UNIQUE NOT NULL,
    purchase_amount bigint NOT NULL,
    commission_amount bigint NOT NULL,
    status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'paid')),
    payout_id bigint REFERENCES public.referral_payouts(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_commissions_referrer 
    ON public.referral_commissions(referrer_user_id);
CREATE INDEX IF NOT EXISTS idx_referral_commissions_referred 
    ON public.referral_commissions(referred_user_id);
CREATE INDEX IF NOT EXISTS idx_referral_commissions_status 
    ON public.referral_commissions(status);

ALTER TABLE public.referral_commissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "referral_commissions_read_referrer" ON public.referral_commissions;
CREATE POLICY "referral_commissions_read_referrer"
    ON public.referral_commissions
    FOR SELECT
    TO authenticated
    USING (auth.uid() = referrer_user_id);

DROP POLICY IF EXISTS "referral_commissions_admin_all" ON public.referral_commissions;
CREATE POLICY "referral_commissions_admin_all"
    ON public.referral_commissions
    FOR ALL
    TO authenticated
    USING (
        coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin')
        OR coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
    )
    WITH CHECK (
        coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin')
        OR coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
    );


-- ----------------------------------------------------------------------------
-- 5. TABLE: public.referral_payout_accounts
-- Stores student's current bank payout details protected by RLS.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referral_payout_accounts (
    id bigserial PRIMARY KEY,
    user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    bank_name text NOT NULL,
    bank_code text,
    account_number text NOT NULL CHECK (length(trim(account_number)) >= 10),
    account_name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_payout_accounts_user_id 
    ON public.referral_payout_accounts(user_id);

ALTER TABLE public.referral_payout_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "referral_payout_accounts_read_own" ON public.referral_payout_accounts;
CREATE POLICY "referral_payout_accounts_read_own"
    ON public.referral_payout_accounts
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "referral_payout_accounts_insert_own" ON public.referral_payout_accounts;
CREATE POLICY "referral_payout_accounts_insert_own"
    ON public.referral_payout_accounts
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "referral_payout_accounts_update_own" ON public.referral_payout_accounts;
CREATE POLICY "referral_payout_accounts_update_own"
    ON public.referral_payout_accounts
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "referral_payout_accounts_admin_all" ON public.referral_payout_accounts;
CREATE POLICY "referral_payout_accounts_admin_all"
    ON public.referral_payout_accounts
    FOR ALL
    TO authenticated
    USING (
        coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin')
        OR coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
    )
    WITH CHECK (
        coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') IN ('admin', 'super_admin')
        OR coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') IN ('admin', 'super_admin')
    );


-- ----------------------------------------------------------------------------
-- 6. RPC: Server-Authoritative Referral Code Generator
-- Guarantees persistent, collision-free codes for all students.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_or_create_student_referral_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_existing_code text;
    v_candidate text;
    v_chars text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; -- Crockford base32
    v_i integer;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required to obtain referral code';
    END IF;

    -- Return existing code if one already exists
    SELECT referral_code INTO v_existing_code
    FROM public.student_referral_codes
    WHERE user_id = v_user_id;

    IF v_existing_code IS NOT NULL THEN
        RETURN v_existing_code;
    END IF;

    -- Collision-retry loop
    LOOP
        v_candidate := 'EP';
        FOR v_i IN 1..6 LOOP
            v_candidate := v_candidate || substr(v_chars, floor(random() * length(v_chars) + 1)::integer, 1);
        END LOOP;

        BEGIN
            INSERT INTO public.student_referral_codes (user_id, referral_code)
            VALUES (v_user_id, v_candidate)
            RETURNING referral_code INTO v_existing_code;

            EXIT; -- Success, break loop
        EXCEPTION WHEN unique_violation THEN
            -- Check if another concurrent transaction assigned a code to this user
            SELECT referral_code INTO v_existing_code
            FROM public.student_referral_codes
            WHERE user_id = v_user_id;

            IF v_existing_code IS NOT NULL THEN
                EXIT;
            END IF;
            -- Otherwise the candidate collided; loop and try a new random code
        END;
    END LOOP;

    RETURN v_existing_code;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_student_referral_code() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_create_student_referral_code() TO authenticated;


-- ----------------------------------------------------------------------------
-- 7. RPC: Atomic Payout Request with Per-User Concurrency Lock
-- Mathematically prevents double-spends and unauthorized amounts.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_referral_payout()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_total_earned bigint;
    v_total_debited bigint;
    v_available bigint;
    v_bank public.referral_payout_accounts%ROWTYPE;
    v_payout_id bigint;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Authentication required');
    END IF;

    -- 1. Acquire transaction-level advisory lock on user's UUID hash
    -- Serializes concurrent payout requests for the exact same student
    PERFORM pg_advisory_xact_lock(hashtext(v_user_id::text));

    -- 2. Check for any existing pending or processing payout request
    IF EXISTS (
        SELECT 1 FROM public.referral_payouts
        WHERE user_id = v_user_id AND status IN ('pending', 'processing')
    ) THEN
        RETURN jsonb_build_object('success', false, 'message', 'You already have a payout request currently in progress.');
    END IF;

    -- 3. Verify saved bank details
    SELECT * INTO v_bank
    FROM public.referral_payout_accounts
    WHERE user_id = v_user_id;

    IF v_bank.account_number IS NULL OR trim(v_bank.account_number) = '' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Please save your bank payout details before requesting a payout.');
    END IF;

    -- 4. Authoritative Ledger Calculation:
    -- Total Earned = SUM(commissions)
    -- Total Debited = SUM(payouts WHERE status IN ('pending', 'processing', 'completed'))
    -- Rejected payouts are automatically excluded from debits
    SELECT COALESCE(SUM(commission_amount), 0) INTO v_total_earned
    FROM public.referral_commissions
    WHERE referrer_user_id = v_user_id;

    SELECT COALESCE(SUM(amount), 0) INTO v_total_debited
    FROM public.referral_payouts
    WHERE user_id = v_user_id AND status IN ('pending', 'processing', 'completed');

    v_available := v_total_earned - v_total_debited;

    -- 5. Enforce minimum available threshold of ₦1,200 (120,000 kobo)
    IF v_available < 120000 THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Available balance (₦' || (v_available / 100)::text || ') is below the ₦1,200 minimum payout threshold.'
        );
    END IF;

    -- 6. Insert atomic payout record with immutable bank snapshot
    INSERT INTO public.referral_payouts (
        user_id,
        amount,
        status,
        bank_name,
        account_number,
        account_name
    )
    VALUES (
        v_user_id,
        v_available,
        'pending',
        v_bank.bank_name,
        v_bank.account_number,
        v_bank.account_name
    )
    RETURNING id INTO v_payout_id;

    RETURN jsonb_build_object(
        'success', true,
        'payout_id', v_payout_id,
        'amount', v_available,
        'message', 'Payout request of ₦' || (v_available / 100)::text || ' submitted successfully.'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.request_referral_payout() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_referral_payout() TO authenticated;


-- ----------------------------------------------------------------------------
-- 8. RPC: Bind Referral Attribution (Resilient to email confirmation)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bind_referral_attribution(
    p_referral_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_clean_code text;
    v_referrer_id uuid;
    v_existing_id bigint;
    v_inserted_id bigint;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Authentication required');
    END IF;

    -- Check if already attributed (first attribution is permanent and immutable)
    SELECT id INTO v_existing_id
    FROM public.referral_attributions
    WHERE referred_user_id = v_user_id;

    IF v_existing_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_bound', true,
            'bound', false,
            'message', 'Referral attribution is already established and cannot be changed.'
        );
    END IF;

    v_clean_code := upper(trim(COALESCE(p_referral_code, '')));
    IF v_clean_code = '' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Referral code cannot be blank');
    END IF;

    -- Resolve referrer
    SELECT user_id INTO v_referrer_id
    FROM public.student_referral_codes
    WHERE upper(referral_code) = v_clean_code;

    IF v_referrer_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'message', 'Invalid referral code');
    END IF;

    -- Prevent self-referral
    IF v_referrer_id = v_user_id THEN
        RETURN jsonb_build_object('success', false, 'message', 'Self-referral is not allowed');
    END IF;

    -- Insert authoritative attribution
    INSERT INTO public.referral_attributions (
        referred_user_id,
        referrer_user_id,
        referral_code
    )
    VALUES (
        v_user_id,
        v_referrer_id,
        v_clean_code
    )
    ON CONFLICT (referred_user_id) DO NOTHING
    RETURNING id INTO v_inserted_id;

    IF v_inserted_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'bound', true,
            'message', 'Referral attribution established successfully'
        );
    ELSE
        RETURN jsonb_build_object(
            'success', true,
            'already_bound', true,
            'bound', false,
            'message', 'Referral attribution is already established and cannot be changed.'
        );
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.bind_referral_attribution(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bind_referral_attribution(text) TO authenticated;


-- ----------------------------------------------------------------------------
-- 9. TRIGGER: Automatic Attribution on auth.users INSERT
-- Uses NEW.id directly with non-blocking warning logging.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user_referral_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
    v_raw_code text;
    v_clean_code text;
    v_referrer_id uuid;
BEGIN
    v_raw_code := NEW.raw_user_meta_data ->> 'referral_code';
    IF v_raw_code IS NOT NULL THEN
        v_clean_code := upper(trim(v_raw_code));
        IF v_clean_code <> '' THEN
            SELECT user_id INTO v_referrer_id
            FROM public.student_referral_codes
            WHERE upper(referral_code) = v_clean_code;

            IF v_referrer_id IS NOT NULL AND v_referrer_id <> NEW.id THEN
                INSERT INTO public.referral_attributions (
                    referred_user_id,
                    referrer_user_id,
                    referral_code
                )
                VALUES (
                    NEW.id,
                    v_referrer_id,
                    v_clean_code
                )
                ON CONFLICT (referred_user_id) DO NOTHING;
            END IF;
        END IF;
    END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Log warning for diagnostics without exposing sensitive data or failing user creation
    RAISE WARNING 'handle_new_user_referral_trigger notice for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_referral ON auth.users;
CREATE TRIGGER on_auth_user_referral
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user_referral_trigger();

COMMIT;
