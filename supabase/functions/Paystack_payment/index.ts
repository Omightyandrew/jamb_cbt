import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-paystack-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getExpectedAmount(planDays: number): number | null {
  if (planDays === 30) return 150000;
  if (planDays === 365) return 400000;
  return null;
}

function getPlanName(planDays: number): string {
  return planDays >= 365 ? "1_year" : "30_days";
}

function getPlanDaysFromAmount(amountKobo: number, fees = 0): number | null {
  const net = fees > 0 ? (amountKobo - fees) : amountKobo;
  if (net === 150000 || (amountKobo >= 150000 && amountKobo < 350000)) return 30;
  if (net === 400000 || amountKobo >= 350000) return 365;
  return null;
}

function matchesPlanAmount(receivedAmount: number, fees: number, planDays: number): boolean {
  const expectedBase = getExpectedAmount(planDays);
  if (expectedBase === null) return false;

  // 1. Exact match on total base amount
  if (receivedAmount === expectedBase) return true;

  // 2. Exact match on net after fees
  if (fees > 0 && (receivedAmount - fees) === expectedBase) return true;

  // 3. Tolerance range for customer-bearer processing fees
  if (planDays === 30 && receivedAmount >= 150000 && receivedAmount <= 180000) return true;
  if (planDays === 365 && receivedAmount >= 400000 && receivedAmount <= 450000) return true;

  return false;
}

function calculateSubscriptionExpiry(existingExpiry: string | null, planDays: number): string {
  const now = new Date();
  let baseDate = now;
  if (existingExpiry) {
    const currentExpiry = new Date(existingExpiry);
    // Only stack onto existing expiry if it is actively in the FUTURE
    if (!Number.isNaN(currentExpiry.getTime()) && currentExpiry > now) {
      baseDate = currentExpiry;
    }
  }
  const expiry = new Date(baseDate.getTime());
  expiry.setDate(expiry.getDate() + planDays);
  return expiry.toISOString();
}

async function verifyPaystackSignature(
  rawBody: string,
  signature: string | null,
  secretKey: string
): Promise<boolean> {
  if (!signature || !secretKey) return false;
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secretKey),
      { name: "HMAC", hash: "SHA-512" },
      false,
      ["sign"]
    );
    const signatureBuffer = await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(rawBody)
    );
    const hashArray = Array.from(new Uint8Array(signatureBuffer));
    const computedHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    return computedHash.toLowerCase() === signature.trim().toLowerCase();
  } catch (err) {
    console.error("Signature verification error:", err);
    return false;
  }
}

function isServiceRoleToken(token: string, envServiceRoleKey: string | undefined): boolean {
  if (!token) return false;
  if (envServiceRoleKey && token === envServiceRoleKey) return true;
  if (token.startsWith("sb_secret_")) return true;
  try {
    const parts = token.split(".");
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1]));
      if (payload.role === "service_role") return true;
    }
  } catch (_) {}
  return false;
}

interface FulfillmentParams {
  supabaseAdmin: any;
  userId: string;
  reference: string;
  paystackTransactionId: string | null;
  amount: number;
  currency: string;
  status: string;
  channel: string | null;
  planDays: number;
  planName: string;
  customerEmail: string | null;
  gatewayResponse: string | null;
  paidAt: string | null;
  source: "webhook" | "client_callback" | "manual";
  rawMetadata?: any;
}

interface ReferralFulfillmentParams {
  supabaseAdmin: any;
  referredUserId: string;
  transactionId: number | string | null;
  reference: string;
  amount: number;
  planDays: number;
}

async function processReferralCommission({
  supabaseAdmin,
  referredUserId,
  transactionId,
  reference,
  amount,
  planDays,
}: ReferralFulfillmentParams) {
  try {
    // 1. Check if the paying user was referred by an active attribution
    const { data: attribution, error: attrErr } = await supabaseAdmin
      .from("referral_attributions")
      .select("referrer_user_id, referral_code")
      .eq("referred_user_id", referredUserId)
      .maybeSingle();

    if (attrErr) {
      console.warn("Could not check referral attribution:", attrErr);
      return;
    }

    if (!attribution || !attribution.referrer_user_id) {
      // User was not referred
      return;
    }

    // Prevent self-referral
    if (attribution.referrer_user_id === referredUserId) {
      console.warn(`Self-referral detected for user ${referredUserId}. Commission skipped.`);
      return;
    }

    // 2. Check if a commission has already been recorded for this referred student
    const { data: existingComm, error: commCheckErr } = await supabaseAdmin
      .from("referral_commissions")
      .select("id")
      .eq("referred_user_id", referredUserId)
      .maybeSingle();

    if (commCheckErr) {
      console.warn("Error checking existing referral commission:", commCheckErr);
    }

    if (existingComm) {
      console.log(`Referral commission for referred user ${referredUserId} already recorded. Skipping.`);
      return;
    }

    // 3. Authoritative first-purchase gate via payment_transactions ledger:
    // If user has any prior successful transaction with another reference, this is a renewal (no commission)
    const { data: priorTx, error: priorErr } = await supabaseAdmin
      .from("payment_transactions")
      .select("id, reference")
      .eq("user_id", referredUserId)
      .eq("status", "success")
      .neq("reference", reference);

    if (priorErr) {
      console.warn("Error checking prior payment transactions:", priorErr);
    }

    if (priorTx && priorTx.length > 0) {
      console.log(`User ${referredUserId} has prior successful payment transactions. Renewal detected: no commission.`);
      return;
    }

    // 4. Calculate exactly 20% commission on the subscription base price (excluding gateway/bearer fees)
    const baseAmount = getExpectedAmount(planDays);
    if (baseAmount === null) {
      console.warn(`Unrecognized planDays (${planDays}) for referral commission on reference ${reference}. Skipping.`);
      return;
    }

    const commissionAmount = Math.round(baseAmount * 0.20);
    if (commissionAmount <= 0) {
      return;
    }

    // 5. Insert into referral_commissions
    const { error: insertCommErr } = await supabaseAdmin
      .from("referral_commissions")
      .insert({
        referrer_user_id: attribution.referrer_user_id,
        referred_user_id: referredUserId,
        payment_transaction_id: transactionId ? Number(transactionId) : null,
        payment_reference: reference,
        purchase_amount: amount,
        commission_amount: commissionAmount,
        status: "available",
      });

    if (insertCommErr) {
      if (insertCommErr.code === "23505") {
        console.log(`Referral commission for reference ${reference} already exists (concurrent/idempotent duplicate).`);
      } else {
        console.error("Failed to insert referral commission (reconcilable from payment_transactions):", insertCommErr);
      }
    } else {
      console.log(`🎉 Referral commission of ${commissionAmount} kobo recorded for referrer ${attribution.referrer_user_id}`);
    }
  } catch (err) {
    console.error("Referral processing error (reconcilable from payment_transactions):", err);
  }
}

async function fulfillPayment({
  supabaseAdmin,
  userId,
  reference,
  paystackTransactionId,
  amount,
  currency,
  status,
  channel,
  planDays,
  planName,
  customerEmail,
  gatewayResponse,
  paidAt,
  source,
  rawMetadata,
}: FulfillmentParams) {
  // 1. Check idempotency in payment_transactions table
  const { data: existingTx, error: txCheckErr } = await supabaseAdmin
    .from("payment_transactions")
    .select("*")
    .eq("reference", reference)
    .maybeSingle();

  if (txCheckErr) {
    console.error("Error checking payment_transactions:", txCheckErr);
  }

  if (existingTx) {
    console.log(`Payment reference ${reference} already fulfilled. Returning idempotent success.`);
    const { data: currentSub } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    return {
      success: true,
      already_processed: true,
      message: "This payment has already been verified and applied. No changes were made.",
      transaction: existingTx,
      subscription: currentSub,
    };
  }

  // 2. Insert into payment_transactions (auditable ledger)
  const { data: insertedTx, error: txInsertErr } = await supabaseAdmin
    .from("payment_transactions")
    .insert({
      user_id: userId,
      reference,
      paystack_transaction_id: paystackTransactionId ? String(paystackTransactionId) : null,
      amount,
      currency,
      status,
      channel,
      plan_days: planDays,
      plan_name: planName,
      customer_email: customerEmail,
      gateway_response: gatewayResponse,
      paid_at: paidAt || new Date().toISOString(),
      source,
      raw_metadata: rawMetadata || null,
    })
    .select()
    .maybeSingle();

  if (txInsertErr) {
    // Unique violation means a concurrent call just recorded it
    if (txInsertErr.code === "23505") {
      console.log(`Concurrent insert conflict on reference ${reference}. Returning existing.`);
      const { data: currentSub } = await supabaseAdmin
        .from("subscriptions")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      return {
        success: true,
        already_processed: true,
        message: "This payment was processed concurrently.",
        subscription: currentSub,
      };
    }
    console.error("Failed to insert payment_transactions row:", txInsertErr);
    throw new Error(`Failed to record transaction: ${txInsertErr.message}`);
  }

  // 3. Retrieve current subscription to calculate new expiry
  const { data: existingSub, error: subFetchErr } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (subFetchErr) {
    console.error("Error fetching subscription:", subFetchErr);
    throw new Error(`Failed to check existing subscription: ${subFetchErr.message}`);
  }

  const newExpiresAt = calculateSubscriptionExpiry(existingSub?.expires_at || null, planDays);

  const subData = {
    user_id: userId,
    status: "subscribed",
    plan: planName,
    expires_at: newExpiresAt,
    payment_reference: reference,
    amount,
    updated_at: new Date().toISOString(),
  };

  let savedSub;
  if (existingSub) {
    const { data: updatedSub, error: updateErr } = await supabaseAdmin
      .from("subscriptions")
      .update(subData)
      .eq("id", existingSub.id)
      .eq("user_id", userId)
      .select()
      .single();

    if (updateErr) {
      console.error("Error updating subscription:", updateErr);
      throw new Error(`Failed to update subscription: ${updateErr.message}`);
    }
    savedSub = updatedSub;
  } else {
    const { data: newSub, error: insertErr } = await supabaseAdmin
      .from("subscriptions")
      .insert(subData)
      .select()
      .single();

    if (insertErr) {
      console.error("Error inserting subscription:", insertErr);
      throw new Error(`Failed to create subscription: ${insertErr.message}`);
    }
    savedSub = newSub;
  }

  // 4b. Referral V1: Authoritative commission processing on first purchase (non-blocking)
  try {
    await processReferralCommission({
      supabaseAdmin,
      referredUserId: userId,
      transactionId: insertedTx?.id || null,
      reference,
      amount,
      planDays,
    });
  } catch (refErr) {
    console.error("Referral processing non-blocking failure:", refErr);
  }

  // 5. Phase 7: Non-blocking in-app subscription notifications (authoritative fulfillment must not fail)
  try {
    // 5a. Safely resolve student's public display name for community notification
    let displayName = "A fellow student";
    try {
      const { data: profile } = await supabaseAdmin
        .from("Student_profiles")
        .select("Full_name, Username")
        .eq("id", userId)
        .maybeSingle();

      const rawUsername = typeof profile?.Username === "string" ? profile.Username.trim() : "";
      const rawFullName = typeof profile?.Full_name === "string" ? profile.Full_name.trim() : "";

      if (rawUsername) {
        displayName = `@${rawUsername.replace(/^@+/, "")}`;
      } else if (rawFullName) {
        const firstName = rawFullName.split(/\s+/)[0];
        if (firstName) {
          displayName = firstName;
        }
      }
    } catch (profileErr) {
      console.warn("Could not load student profile for notification display name:", profileErr);
    }

    // 5b. Private Notification: specific to activating user
    try {
      const { error: privateNotifErr } = await supabaseAdmin
        .from("notifications")
        .insert({
          title: "🎉 Welcome to ExamPilot Premium!",
          message: "Your Premium access is now active. Enjoy unlimited CBT practice, AI tutoring, and full library access.",
          target_type: "specific",
          target_user_id: userId,
          category: "personal",
          event_type: "subscription_activated",
          event_key: `sub_private:${reference}`,
          destination_url: "./dashboard.html",
        });

      if (privateNotifErr) {
        if (privateNotifErr.code === "23505") {
          console.log(`Private subscription notification for reference ${reference} already exists (idempotent duplicate).`);
        } else {
          console.error("Error creating private subscription notification:", privateNotifErr);
        }
      }
    } catch (privErr) {
      console.error("Private subscription notification insert error:", privErr);
    }

    // 5c. Community Notification: broadcast to all students
    try {
      const { error: commNotifErr } = await supabaseAdmin
        .from("notifications")
        .insert({
          title: "🎉 New Premium Member!",
          message: `🎉 ${displayName} just joined ExamPilot Premium! Taking exam preparation to the next level. 🚀`,
          target_type: "all",
          target_user_id: null,
          category: "community",
          event_type: "community_subscription",
          event_key: `sub_community:${reference}`,
          destination_url: "./dashboard.html",
        });

      if (commNotifErr) {
        if (commNotifErr.code === "23505") {
          console.log(`Community subscription notification for reference ${reference} already exists (idempotent duplicate).`);
        } else {
          console.error("Error creating community subscription notification:", commNotifErr);
        }
      }
    } catch (commErr) {
      console.error("Community subscription notification insert error:", commErr);
    }
  } catch (notifErr) {
    console.error("Subscription notification dispatch failed (non-blocking):", notifErr);
  }

  return {
    success: true,
    already_processed: false,
    message: "Payment verified and subscription activated successfully.",
    user_id: userId,
    reference,
    plan: planName,
    plan_days: planDays,
    expires_at: savedSub.expires_at,
    subscription: savedSub,
    transaction: insertedTx,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { success: false, message: "Only POST requests are allowed." },
      405
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const paystackSecretKey = Deno.env.get("PAYSTACK_SECRET_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return jsonResponse({ success: false, message: "Server configuration missing." }, 500);
    }
    if (!paystackSecretKey) {
      return jsonResponse({ success: false, message: "Payment configuration missing." }, 500);
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    // Read the raw body as text for signature verification and parsing
    const rawBody = await req.text();
    let body: any = {};
    try {
      body = JSON.parse(rawBody);
    } catch {
      return jsonResponse({ success: false, message: "Invalid JSON payload." }, 400);
    }

    const paystackSignature = req.headers.get("x-paystack-signature");

    // =========================================================================
    // PATH 1: PAYSTACK WEBHOOK (PRIMARY FULFILLMENT PATH)
    // =========================================================================
    if (paystackSignature) {
      const isValidSignature = await verifyPaystackSignature(
        rawBody,
        paystackSignature,
        paystackSecretKey
      );

      if (!isValidSignature) {
        console.warn("Paystack webhook signature verification failed.");
        return jsonResponse({ success: false, message: "Invalid webhook signature." }, 401);
      }

      const event = body?.event;
      if (event !== "charge.success") {
        console.log(`Received Paystack event '${event}'. Ignored.`);
        return jsonResponse({ status: "ignored", event }, 200);
      }

      const txData = body?.data;
      if (!txData || txData.status !== "success") {
        return jsonResponse({ status: "ignored", message: "Transaction not successful." }, 200);
      }

      const reference = typeof txData.reference === "string" ? txData.reference.trim() : "";
      if (!reference) {
        return jsonResponse({ success: false, message: "Webhook missing reference." }, 400);
      }

      const amount = Number(txData.amount);
      const fees = Number(txData.fees || 0);
      const currency = String(txData.currency || "NGN").toUpperCase();
      const customerEmail = txData.customer?.email || null;
      let planDays = Number(txData.metadata?.plan_days);
      if (!Number.isInteger(planDays) || planDays <= 0) {
        const deducedDays = getPlanDaysFromAmount(amount, fees);
        planDays = deducedDays || 30;
      }
      if (!matchesPlanAmount(amount, fees, planDays)) {
        return jsonResponse(
          {
            success: false,
            message: "Payment amount does not match subscription plan.",
            expected_amount: getExpectedAmount(planDays),
            received_amount: amount,
            fees,
          },
          400
        );
      }
      const planName = getPlanName(planDays);

      // Resolve user_id: check metadata first, fallback to customer email
      let userId = typeof txData.metadata?.user_id === "string" ? txData.metadata.user_id.trim() : "";
      if (!userId && customerEmail) {
        const { data: usersData, error: userLookupErr } = await supabaseAdmin.auth.admin.listUsers();
        if (!userLookupErr && usersData?.users) {
          const matchedUser = usersData.users.find(
            (u: any) => u.email?.toLowerCase() === customerEmail.toLowerCase()
          );
          if (matchedUser) {
            userId = matchedUser.id;
          }
        }
      }

      if (!userId) {
        console.error(`Webhook received for email ${customerEmail} but user could not be found.`);
        return jsonResponse({ success: false, message: "User not found for payment." }, 400);
      }

      const result = await fulfillPayment({
        supabaseAdmin,
        userId,
        reference,
        paystackTransactionId: txData.id ? String(txData.id) : null,
        amount,
        currency,
        status: txData.status,
        channel: txData.channel || null,
        planDays,
        planName,
        customerEmail,
        gatewayResponse: txData.gateway_response || null,
        paidAt: txData.paid_at || null,
        source: "webhook",
        rawMetadata: txData.metadata || null,
      });

      return jsonResponse(result, 200);
    }

    // =========================================================================
    // PATH 2: CLIENT ON-SUCCESS CALLBACK / VERIFY (BACKUP & RECOVERY PATH)
    // =========================================================================
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
    const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    const token = tokenMatch ? tokenMatch[1].trim() : "";

    if (!token) {
      return jsonResponse(
        { success: false, message: "Authentication required to verify payment." },
        401
      );
    }

    const bodyUserId = typeof body?.user_id === "string" ? body.user_id.trim() : "";
    const reference = typeof body?.reference === "string" ? body.reference.trim() : "";
    let planDays = Number(body?.plan_days);

    if (!reference) {
      return jsonResponse({ success: false, message: "Payment reference is missing." }, 400);
    }

    // Check whether the token is service_role key or student user JWT
    let authenticatedUserId: string | null = null;
    let isServiceRole = false;

    if (isServiceRoleToken(token, supabaseServiceRoleKey)) {
      isServiceRole = true;
      authenticatedUserId = bodyUserId;
    } else {
      const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
      if (authError || !authData?.user?.id) {
        return jsonResponse(
          { success: false, message: "Your session could not be verified. Please log in again." },
          401
        );
      }
      authenticatedUserId = authData.user.id;
    }

    if (!authenticatedUserId) {
      return jsonResponse({ success: false, message: "Valid user ID is required." }, 400);
    }

    if (!isServiceRole && bodyUserId && bodyUserId !== authenticatedUserId) {
      return jsonResponse(
        { success: false, message: "The supplied user ID does not match the authenticated account." },
        403
      );
    }

    const userId = authenticatedUserId;

    // Check if already fulfilled first to avoid unnecessary Paystack API call
    const { data: existingTx } = await supabaseAdmin
      .from("payment_transactions")
      .select("*")
      .eq("reference", reference)
      .maybeSingle();

    if (existingTx) {
      const { data: currentSub } = await supabaseAdmin
        .from("subscriptions")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      return jsonResponse({
        success: true,
        already_processed: true,
        message: "This payment has already been verified and applied. No changes were made.",
        user_id: userId,
        reference,
        plan: existingTx.plan_name,
        plan_days: existingTx.plan_days,
        expires_at: currentSub?.expires_at || null,
        expiry_date: currentSub?.expires_at || null,
        subscription: currentSub,
        transaction: existingTx,
      }, 200);
    }

    // Call Paystack API to verify transaction status
    let paystackResponse: Response;
    try {
      paystackResponse = await fetch(
        "https://api.paystack.co/transaction/verify/" + encodeURIComponent(reference),
        {
          method: "GET",
          headers: {
            Authorization: "Bearer " + paystackSecretKey,
            "Content-Type": "application/json",
          },
        }
      );
    } catch (err) {
      return jsonResponse(
        {
          success: false,
          message: "Could not connect to Paystack.",
          error: err instanceof Error ? err.message : String(err),
        },
        502
      );
    }

    let paystackData: any;
    try {
      paystackData = await paystackResponse.json();
    } catch {
      return jsonResponse(
        { success: false, message: "Paystack returned an invalid response." },
        502
      );
    }

    if (!paystackResponse.ok || paystackData?.status !== true) {
      return jsonResponse(
        {
          success: false,
          message: "Paystack could not verify this payment.",
          paystack_message: paystackData?.message || null,
        },
        400
      );
    }

    const tx = paystackData?.data;
    if (!tx || tx.status !== "success") {
      return jsonResponse(
        {
          success: false,
          message: "Payment was not successful.",
          payment_status: tx?.status || null,
        },
        400
      );
    }

    if (tx.reference !== reference) {
      return jsonResponse(
        { success: false, message: "Payment reference does not match." },
        400
      );
    }

    const verifiedAmount = Number(tx.amount);
    const fees = Number(tx.fees || 0);
    if (!Number.isInteger(planDays) || planDays <= 0) {
      const deducedDays = getPlanDaysFromAmount(verifiedAmount, fees);
      planDays = deducedDays || 30;
    }

    if (!matchesPlanAmount(verifiedAmount, fees, planDays)) {
      return jsonResponse(
        {
          success: false,
          message: "Payment amount does not match subscription plan.",
          expected_amount: getExpectedAmount(planDays),
          received_amount: verifiedAmount,
          fees,
          plan_days: planDays,
        },
        400
      );
    }

    if (String(tx.currency || "").toUpperCase() !== "NGN") {
      return jsonResponse({ success: false, message: "Invalid payment currency." }, 400);
    }

    const planName = getPlanName(planDays);

    const result = await fulfillPayment({
      supabaseAdmin,
      userId,
      reference,
      paystackTransactionId: tx.id ? String(tx.id) : null,
      amount: verifiedAmount,
      currency: "NGN",
      status: tx.status,
      channel: tx.channel || null,
      planDays,
      planName,
      customerEmail: tx.customer?.email || null,
      gatewayResponse: tx.gateway_response || null,
      paidAt: tx.paid_at || null,
      source: isServiceRole ? "manual" : "client_callback",
      rawMetadata: tx.metadata || null,
    });

    return jsonResponse({
      ...result,
      expiry_date: result.expires_at,
    }, 200);

  } catch (error) {
    console.error("Paystack_payment error:", error);
    return jsonResponse(
      {
        success: false,
        message: "Unexpected server error.",
        error: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});
