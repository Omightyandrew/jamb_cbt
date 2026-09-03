(function () {
  const PREMIUM_SUPABASE_URL = 'https://afdnfqmsjmpwlvhloopy.supabase.co';
  const PREMIUM_SUPABASE_KEY = 'sb_publishable_LQlMraaULDTdAKeYysPWkA_a8CKvA1V';

  function isPremiumSubscriptionRecord(row) {
    if (!row) return false;
    const status = String(row.status ?? row.subscription_status ?? row.plan_status ?? row.payment_status ?? '').trim().toLowerCase();
    const expiresAt = row.expires_at ?? row.expiresAt ?? row.current_period_end ?? row.ends_at ?? null;
    const isStatusActive = ['active', 'paid', 'premium', 'subscribed', 'success', 'successful', 'succeeded', 'completed'].includes(status);

    let notExpired = true;
    if (expiresAt) {
      const expiry = new Date(expiresAt);
      notExpired = !Number.isNaN(expiry.getTime()) ? expiry > new Date() : true;
    }

    return isStatusActive && notExpired;
  }

  function openProtectedFeatureUpgrade(featureName, featureKey) {
    const dashboardUrl = new URL('dashboard.html', window.location.href);
    dashboardUrl.searchParams.set('upgrade', '1');
    if (featureKey) dashboardUrl.searchParams.set('feature', featureKey);
    const destination = dashboardUrl.toString();

    document.documentElement.innerHTML = `
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width,initial-scale=1.0">
          <title>Premium access required</title>
          <style>
            :root { color-scheme: light; }
            * { box-sizing: border-box; }
            body {
              margin: 0;
              min-height: 100vh;
              display: grid;
              place-items: center;
              background: linear-gradient(180deg, #f4faf6 0%, #edf6f0 100%);
              font-family: Arial, Helvetica, sans-serif;
              color: #16362a;
            }
            .access-card {
              width: min(92vw, 460px);
              padding: 30px 24px 24px;
              border-radius: 22px;
              background: #fff;
              border: 1px solid #dfeae4;
              box-shadow: 0 18px 40px rgba(12, 45, 34, .08);
              text-align: center;
            }
            .lock-icon {
              width: 64px; height: 64px; margin: 0 auto 18px; border-radius: 50%;
              display: grid; place-items: center; font-size: 30px; background: #edf7ef; color: #0d774c;
            }
            .eyebrow {
              margin: 0 0 8px; color: #0d774c; font-size: 12px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase;
            }
            h1 {
              margin: 0 0 10px; font-size: clamp(28px, 5vw, 36px); line-height: 1.1;
            }
            p {
              margin: 0 0 18px; color: #53655f; line-height: 1.6; font-size: 15px;
            }
            .premium-button,
            .secondary-button {
              display: inline-flex; align-items: center; justify-content: center; width: 100%; min-height: 48px; padding: 0 18px; border-radius: 14px; border: none; cursor: pointer; font-weight: 700; font-size: 15px; text-decoration: none;
            }
            .premium-button {
              background: #0a7a4a; color: white;
            }
            .secondary-button {
              margin-top: 10px; background: #edf5f0; color: #184a36;
            }
          </style>
        </head>
        <body>
          <main class="access-card">
            <div class="lock-icon">🔒</div>
            <p class="eyebrow">Premium required</p>
            <h1>${featureName || 'Premium access required'}</h1>
            <p>This premium study feature is available to premium students only. Upgrade to continue.</p>
            <button class="premium-button" type="button" id="premiumAccessUpgrade">Upgrade to Premium</button>
            <a class="secondary-button" href="dashboard.html">Back to Dashboard</a>
          </main>
          <script>
            const premiumAccessButton = document.getElementById('premiumAccessUpgrade');
            if (premiumAccessButton) {
              premiumAccessButton.addEventListener('click', () => {
                window.location.href = ${JSON.stringify(destination)};
              });
            }
          </script>
        </body>
      </html>
    `;
  }

  async function getSupabaseClient() {
    if (window.supabase) {
      return window.supabase.createClient(PREMIUM_SUPABASE_URL, PREMIUM_SUPABASE_KEY);
    }
    if (typeof supabase !== 'undefined') {
      return supabase;
    }
    return null;
  }

  window.ensurePremiumFeatureAccess = async function ({ featureName = 'This feature', featureKey = '' } = {}) {
    const client = await getSupabaseClient();
    if (!client) {
      openProtectedFeatureUpgrade(featureName, featureKey);
      return false;
    }

    try {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError || !sessionData?.session) {
        const loginUrl = 'student.html';
        const page = `
          <!doctype html>
          <html lang="en">
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width,initial-scale=1.0">
              <title>Login required</title>
              <style>
                * { box-sizing: border-box; }
                body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: linear-gradient(180deg, #f5faf7 0%, #edf4f0 100%); font-family: Arial, Helvetica, sans-serif; color: #153b2c; }
                .access-card { width: min(92vw, 430px); padding: 28px 22px; border-radius: 20px; background: #fff; border: 1px solid #dfeae3; box-shadow: 0 18px 40px rgba(10, 40, 30, .08); text-align: center; }
                .lock-icon { width: 62px; height: 62px; margin: 0 auto 16px; border-radius: 50%; display: grid; place-items: center; background: #edf7ef; font-size: 28px; }
                .eyebrow { margin: 0 0 8px; font-size: 12px; letter-spacing: .12em; color: #0a7a4a; font-weight: 800; text-transform: uppercase; }
                h1 { margin: 0 0 10px; font-size: clamp(28px, 4vw, 34px); }
                p { margin: 0 0 18px; color: #53655f; line-height: 1.6; }
                .premium-button, .secondary-button { display: inline-flex; align-items: center; justify-content: center; width: 100%; min-height: 46px; border-radius: 12px; border: none; cursor: pointer; font-weight: 700; text-decoration: none; }
                .premium-button { background: #0a7a4a; color: #fff; }
                .secondary-button { margin-top: 10px; background: #edf5f0; color: #173f31; }
              </style>
            </head>
            <body>
              <main class="access-card">
                <div class="lock-icon">🔒</div>
                <p class="eyebrow">Login required</p>
                <h1>Student login needed</h1>
                <p>Please sign in to continue with ${featureName}.</p>
                <button class="premium-button" type="button" id="premiumAccessLogin">Go to Student Login</button>
                <a class="secondary-button" href="student.html">Open login</a>
              </main>
              <script>
                const button = document.getElementById('premiumAccessLogin');
                if (button) button.addEventListener('click', () => { window.location.href = ${JSON.stringify(loginUrl)}; });
              </script>
            </body>
          </html>
        `;
        document.documentElement.innerHTML = page;
        return false;
      }

      const { data: subRows, error: subError } = await client
        .from('subscriptions')
        .select('*')
        .eq('user_id', sessionData.session.user.id)
        .order('id', { ascending: false });

      if (subError) throw subError;

      const isPremium = Array.isArray(subRows) && subRows.some(isPremiumSubscriptionRecord);
      if (!isPremium) {
        openProtectedFeatureUpgrade(featureName, featureKey);
        return false;
      }

      return true;
    } catch (error) {
      console.warn('Premium feature access check failed:', error);
      openProtectedFeatureUpgrade(featureName, featureKey);
      return false;
    }
  };
})();
