import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret"
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const adminClient = createClient(supabaseUrl, serviceRoleKey);
const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "";
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const cronSecret = Deno.env.get("DAILY_REMINDER_CRON_SECRET") || "";

function configureVapid() {
  if (!vapidSubject || !vapidPublicKey || !vapidPrivateKey) {
    throw new Error("Web Push VAPID configuration is incomplete.");
  }
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

function isAdmin(user: any) {
  const role = String(user?.app_metadata?.role || user?.app_metadata?.admin_role || "").toLowerCase();
  return role === "admin" || role === "super_admin";
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST" && request.method !== "GET") return json(405, { error: "POST or GET is required." });

  try {
    // 1. Authorize: Either valid x-cron-secret header OR an authenticated admin user
    let authorized = false;
    const providedSecret = request.headers.get("x-cron-secret");

    // Cron authentication attempt
    if (providedSecret !== null) {
      if (!cronSecret || cronSecret.trim() === "") {
        console.error("Scheduler invocation attempted but DAILY_REMINDER_CRON_SECRET is not configured on server.");
        return json(500, { error: "Configuration error: DAILY_REMINDER_CRON_SECRET is not configured on server." });
      }
      if (providedSecret === cronSecret) {
        authorized = true;
      }
    }

    if (!authorized) {
      const authorization = request.headers.get("Authorization");
      if (authorization) {
        const token = authorization.replace(/^Bearer\s+/i, "");
        const { data: { user }, error: userError } = await adminClient.auth.getUser(token);
        if (!userError && user) {
          authorized = isAdmin(user);
          if (!authorized) {
            const { data: profile } = await adminClient.from("Student_profiles")
              .select("is_admin").eq("id", user.id).maybeSingle();
            authorized = profile?.is_admin === true;
          }
        }
      }
    }

    if (!authorized) {
      return json(401, { error: "Unauthorized. Valid scheduler secret or administrator session required." });
    }

    // 2. Execute database reminder generation RPC (Africa/Lagos challenge date by default)
    // generate_daily_challenge_reminders is idempotent (ON CONFLICT on event_key)
    const { data: insertedCount, error: rpcError } = await adminClient.rpc("generate_daily_challenge_reminders");
    if (rpcError) {
      console.error("generate_daily_challenge_reminders RPC failed:", rpcError);
      throw rpcError;
    }

    // 3. Compute today's Africa/Lagos date string to identify eligible recipients
    const todayLagos = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Lagos",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());

    // 4. Retrieve notifications created for today's reminder that have not yet had a push delivered
    let todayNotifications: any[] = [];
    let hasPushDeliveredAtColumn = true;

    const { data: pendingNotifs, error: notifError } = await adminClient
      .from("notifications")
      .select("id, target_user_id, title, message, destination_url, push_delivered_at")
      .eq("event_type", "challenge_reminder")
      .ilike("event_key", `challenge_reminder:%:${todayLagos}`)
      .is("push_delivered_at", null);

    if (notifError) {
      // Graceful fallback if push_delivered_at column migration has not yet been applied
      if (notifError.code === "PGRST204" || notifError.message?.includes("push_delivered_at")) {
        hasPushDeliveredAtColumn = false;
        const { data: fallbackNotifs, error: fallbackError } = await adminClient
          .from("notifications")
          .select("id, target_user_id, title, message, destination_url")
          .eq("event_type", "challenge_reminder")
          .ilike("event_key", `challenge_reminder:%:${todayLagos}`);
        if (fallbackError) throw fallbackError;
        todayNotifications = fallbackNotifs || [];
      } else {
        throw notifError;
      }
    } else {
      todayNotifications = pendingNotifs || [];
    }

    if (!todayNotifications || todayNotifications.length === 0) {
      return json(200, {
        success: true,
        inserted_in_db: insertedCount || 0,
        recipients: 0,
        delivered: 0,
        message: "No pending reminder push notifications for today."
      });
    }

    // 5. Gather target user IDs
    const userIds = Array.from(new Set(
      todayNotifications
        .map((n: any) => n.target_user_id)
        .filter(Boolean)
    ));

    if (userIds.length === 0) {
      return json(200, {
        success: true,
        inserted_in_db: insertedCount || 0,
        recipients: 0,
        delivered: 0,
        message: "No user IDs associated with today's reminders."
      });
    }

    // 6. Query active Web Push subscriptions for these students
    const { data: subscriptions, error: subsError } = await adminClient
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth")
      .in("user_id", userIds);

    if (subsError) throw subsError;

    if (!subscriptions || subscriptions.length === 0) {
      return json(200, {
        success: true,
        inserted_in_db: insertedCount || 0,
        subscribers_found: 0,
        delivered: 0,
        message: "Daily Challenge in-app reminders created; no push subscriptions registered for eligible students."
      });
    }

    // 7. Deliver Web Push payloads
    configureVapid();

    const notifMap = new Map();
    todayNotifications.forEach((n: any) => {
      notifMap.set(n.target_user_id, n);
    });

    let delivered = 0;
    const expired: string[] = [];
    const successfulNotifIds = new Set<string>();

    for (const sub of subscriptions) {
      const notif = notifMap.get(sub.user_id) || todayNotifications[0];
      const payload = JSON.stringify({
        id: notif.id,
        title: notif.title || "⚡ Daily Challenge Reminder",
        body: notif.message || "Keep your streak alive! Today's Daily Challenge is waiting for you.",
        url: notif.destination_url || "./challenge.html"
      });

      try {
        await webpush.sendNotification({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth }
        }, payload);
        delivered++;
        if (notif.id) {
          successfulNotifIds.add(notif.id);
        }
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          expired.push(sub.id);
        } else {
          console.error("Scheduled reminder push delivery failed for subscription", sub.id, err?.statusCode);
        }
      }
    }

    // 8. Record delivery timestamp on successfully pushed notifications to prevent duplicate pushes on retry
    if (hasPushDeliveredAtColumn && successfulNotifIds.size > 0) {
      const deliveredIds = Array.from(successfulNotifIds);
      const { error: updateError } = await adminClient
        .from("notifications")
        .update({ push_delivered_at: new Date().toISOString() })
        .in("id", deliveredIds);

      if (updateError) {
        console.error("Failed to update push_delivered_at timestamp:", updateError);
      }
    }

    // 9. Clean up expired endpoints
    if (expired.length > 0) {
      await adminClient.from("push_subscriptions").delete().in("id", expired);
    }

    return json(200, {
      success: true,
      inserted_in_db: insertedCount || 0,
      eligible_students: userIds.length,
      subscribers_found: subscriptions.length,
      delivered,
      removed_expired: expired.length,
      challenge_date: todayLagos
    });
  } catch (error: any) {
    console.error("daily-challenge-reminder dispatcher error:", error);
    return json(500, { error: error?.message || "Internal error dispatching daily challenge reminder." });
  }
});

