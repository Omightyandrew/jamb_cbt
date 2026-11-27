-- Migration: Create payment_transactions table for auditable, idempotent payment tracking
-- and harden subscription fulfillment.

CREATE TABLE IF NOT EXISTS public.payment_transactions (
    id bigserial PRIMARY KEY,
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    reference text UNIQUE NOT NULL,
    paystack_transaction_id text,
    amount bigint NOT NULL,
    currency text NOT NULL DEFAULT 'NGN',
    status text NOT NULL,
    channel text,
    plan_days integer NOT NULL DEFAULT 30,
    plan_name text NOT NULL DEFAULT '30_days',
    customer_email text,
    gateway_response text,
    paid_at timestamptz,
    source text NOT NULL DEFAULT 'webhook',
    raw_metadata jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index on reference and user_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_payment_transactions_reference ON public.payment_transactions(reference);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_user_id ON public.payment_transactions(user_id);

-- Enable RLS
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

-- Students can view their own payment transactions
DROP POLICY IF EXISTS "payment_transactions_read_own" ON public.payment_transactions;
CREATE POLICY "payment_transactions_read_own"
ON public.payment_transactions
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Admins can view all payment transactions
DROP POLICY IF EXISTS "payment_transactions_admin_all" ON public.payment_transactions;
CREATE POLICY "payment_transactions_admin_all"
ON public.payment_transactions
FOR ALL
TO authenticated
USING (
  coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('admin', 'super_admin')
  or coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') in ('admin', 'super_admin')
)
WITH CHECK (
  coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('admin', 'super_admin')
  or coalesce(auth.jwt() -> 'app_metadata' ->> 'admin_role', '') in ('admin', 'super_admin')
);
