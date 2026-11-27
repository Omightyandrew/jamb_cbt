-- ============================================================================
-- ExamPilot Referral V1 Migration: Withdrawal Fee & Net Payout Adjustment
-- File: supabase/migrations/20261008010000_referral_payout_withdrawal_fee.sql
--
-- Adds fee_amount (fixed ₦120 = 12000 kobo) and net_amount (gross - fee)
-- to public.referral_payouts and updates request_referral_payout() RPC.
-- Preserves existing tables, commission calculations, and attribution logic.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. ALTER TABLE: public.referral_payouts
-- Add fee_amount and net_amount columns with server-authoritative integrity
-- ----------------------------------------------------------------------------
ALTER TABLE public.referral_payouts 
    ADD COLUMN IF NOT EXISTS fee_amount bigint NOT NULL DEFAULT 12000;

ALTER TABLE public.referral_payouts 
    ADD COLUMN IF NOT EXISTS net_amount bigint;

-- For existing completed/pending/processing/rejected records (if any),
-- preserve historical amounts and compute net_amount = amount - fee_amount
UPDATE public.referral_payouts 
SET net_amount = amount - fee_amount 
WHERE net_amount IS NULL;

-- Enforce NOT NULL on net_amount
ALTER TABLE public.referral_payouts 
    ALTER COLUMN net_amount SET NOT NULL;

-- Add integrity constraints on fee and net calculation
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_referral_payouts_net_amount'
    ) THEN
        ALTER TABLE public.referral_payouts
            ADD CONSTRAINT chk_referral_payouts_net_amount
            CHECK (net_amount = amount - fee_amount);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_referral_payouts_fee_amount'
    ) THEN
        ALTER TABLE public.referral_payouts
            ADD CONSTRAINT chk_referral_payouts_fee_amount
            CHECK (fee_amount = 12000);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_referral_payouts_net_positive'
    ) THEN
        ALTER TABLE public.referral_payouts
            ADD CONSTRAINT chk_referral_payouts_net_positive
            CHECK (net_amount > 0);
    END IF;
END $$;


-- ----------------------------------------------------------------------------
-- 2. RPC: Atomic Payout Request with Server-Authoritative Fee & Net Payout
-- Calculates gross from ledger, deducts ₦120 (12,000 kobo) fee,
-- records net payout, and serializes per-user concurrency via advisory lock.
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
    v_fee_amount CONSTANT bigint := 12000; -- Fixed ₦120 fee in kobo
    v_net_amount bigint;
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
    -- Note: Gross amount is debited from balance because referrer pays the ₦120 fee.
    -- Rejected payouts are automatically excluded from debits.
    SELECT COALESCE(SUM(commission_amount), 0) INTO v_total_earned
    FROM public.referral_commissions
    WHERE referrer_user_id = v_user_id;

    SELECT COALESCE(SUM(amount), 0) INTO v_total_debited
    FROM public.referral_payouts
    WHERE user_id = v_user_id AND status IN ('pending', 'processing', 'completed');

    v_available := v_total_earned - v_total_debited;

    -- 5. Enforce minimum gross available threshold of ₦1,200 (120,000 kobo)
    IF v_available < 120000 THEN
        RETURN jsonb_build_object(
            'success', false,
            'message', 'Available balance (₦' || (v_available / 100)::text || ') is below the ₦1,200 minimum payout threshold.'
        );
    END IF;

    -- 6. Server-authoritative fee and net calculation
    v_net_amount := v_available - v_fee_amount;

    -- 7. Insert atomic payout record with immutable bank snapshot, fee_amount, and net_amount
    INSERT INTO public.referral_payouts (
        user_id,
        amount,
        fee_amount,
        net_amount,
        status,
        bank_name,
        account_number,
        account_name
    )
    VALUES (
        v_user_id,
        v_available,
        v_fee_amount,
        v_net_amount,
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
        'fee_amount', v_fee_amount,
        'net_amount', v_net_amount,
        'message', 'Payout request of ₦' || (v_available / 100)::text || ' (Net: ₦' || (v_net_amount / 100)::text || ' after ₦120 fee) submitted successfully.'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.request_referral_payout() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_referral_payout() TO authenticated;

COMMIT;
