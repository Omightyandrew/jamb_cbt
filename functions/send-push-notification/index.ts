import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const adminClient = createClient(supabaseUrl, serviceRoleKey);
const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "";
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY") || "";

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
  if (request.method !== "POST") return json(405, { error: "POST is required." });

  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) return json(401, { error: "Authentication is required." });
    const token = authorization.replace(/^Bearer\s+/i, "");
    const { data: { user }, error: userError } = await adminClient.auth.getUser(token);
    if (userError || !user) return json(401, { error: "Invalid or expired session." });

    let authorized = isAdmin(user);
    if (!authorized) {
      const { data: profile } = await adminClient.from("Student_profiles")
        .select("is_admin").eq("id", user.id).maybeSingle();
      authorized = profile?.is_admin === true;
    }
    if (!authorized) return json(403, { error: "Administrator access is required." });

    const input = await request.json();
    const title = String(input.title || "").trim();
    const message = String(input.message || "").trim();
    const targetType = ["all", "premium", "free", "specific"].includes(input.target_type)
      ? input.target_type : "all";
    const targetUserId = targetType === "specific" ? String(input.target_user_id || "").trim() : null;
    const destinationUrl = String(input.destination_url || "./dashboard.html").trim() || "./dashboard.html";
    if (!title || !message || (targetType === "specific" && !targetUserId)) {
      return json(400, { error: "Title, message, and a specific student ID when needed are required." });
    }

    configureVapid();

    const { data: notification, error: notificationError } = await adminClient.from("notifications")
      .insert({
        title, message, target_type: targetType, target_user_id: targetUserId,
        created_by: user.id, destination_url: destinationUrl
      }).select().single();
    if (notificationError) throw notificationError;

    const { data: subscriptions, error: subscriptionsError } = await adminClient
      .from("push_subscriptions").select("*");
    if (subscriptionsError) throw subscriptionsError;

    let premiumUserIds = new Set<string>();
    if (targetType === "premium" || targetType === "free") {
      const { data: premiumRows } = await adminClient.from("subscriptions")
        .select("user_id,status,expires_at");
      premiumUserIds = new Set((premiumRows || []).filter((row: any) => {
        const status = String(row.status || "").toLowerCase();
        return ["active", "paid", "premium", "subscribed", "success", "successful", "succeeded", "completed"].includes(status)
          && (!row.expires_at || new Date(row.expires_at) > new Date());
      }).map((row: any) => String(row.user_id)));
    }

    const recipients = (subscriptions || []).filter((subscription: any) => {
      if (targetType === "specific") return subscription.user_id === targetUserId;
      if (targetType === "premium") return premiumUserIds.has(String(subscription.user_id));
      if (targetType === "free") return !premiumUserIds.has(String(subscription.user_id));
      return true;
    });

    const payload = JSON.stringify({ id: notification.id, title, body: message, url: destinationUrl });
    let delivered = 0;
    const expired: string[] = [];
    for (const subscription of recipients) {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth }
        }, payload);
        delivered++;
      } catch (error: any) {
        if (error?.statusCode === 404 || error?.statusCode === 410) expired.push(subscription.id);
        else console.error("Push delivery failed.", { subscriptionId: subscription.id, status: error?.statusCode });
      }
    }
    if (expired.length) {
      await adminClient.from("push_subscriptions").delete().in("id", expired);
    }
    return json(200, { notification_id: notification.id, recipients: recipients.length, delivered, removed: expired.length });
  } catch (error: any) {
    console.error("send-push-notification failed.", error);
    return json(500, { error: error?.message || "Notification delivery failed." });
  }
});
