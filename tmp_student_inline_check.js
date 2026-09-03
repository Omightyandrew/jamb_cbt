


/* ========================================
   SUPABASE CONFIGURATION
======================================== */

const SUPABASE_URL =
    "https://afdnfqmsjmpwlvhloopy.supabase.co";

const SUPABASE_ANON_KEY =
       "sb_publishable_LQlMraaULDTdAKeYysPWkA_a8CKvA1V";


const supabaseClient =
    window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY
    );


/* ========================================
   STUDENT VARIABLES
======================================== */

let studentName = "";

let studentUsername = "";

let subscribed = false;

let subscriptionDate = null;


/* ========================================
   MESSAGE
======================================== */

function showMessage(
    elementId,
    message,
    type
) {

    const element =
        document.getElementById(
            elementId
        );


    if (!element) {

        return;

    }


    element.textContent =
        message;


    element.className =
        "message show " +
        type;

}


/* ========================================
   SHOW LOGIN
======================================== */

function hideStudentBoxes() {
    ["loginBox","registerBox","forgotPasswordBox","resetPasswordBox"].forEach(id => document.getElementById(id)?.classList.add("hidden"));
}

function showLogin() {
    hideStudentBoxes();
    document.getElementById("loginBox")?.classList.remove("hidden");
}

function showForgotPassword() {
    hideStudentBoxes();
    document.getElementById("forgotPasswordBox")?.classList.remove("hidden");
    const email=document.getElementById("loginEmail")?.value?.trim()||"";
    if(email) document.getElementById("forgotEmail").value=email;
}

/* ========================================
   SHOW REGISTER
======================================== */

function showRegister() {
    hideStudentBoxes();
    document.getElementById("registerBox")?.classList.remove("hidden");
}

function openTermsModal() {
   const modal = document.getElementById("termsModal");
   if (!modal) return;
   modal.classList.remove("hidden");
}

function closeTermsModal() {
   const modal = document.getElementById("termsModal");
   if (!modal) return;
   modal.classList.add("hidden");
}

document.getElementById("termsModal")?.addEventListener("click", function(event) {
   if (event.target === event.currentTarget) {
       closeTermsModal();
   }
});

document.addEventListener("keydown", function(event) {
   if (event.key === "Escape") {
       closeTermsModal();
   }
});

/* ========================================
   FORGOT PASSWORD / RESET PASSWORD
======================================== */
async function checkPasswordRecovery() {
    const isRecovery = (window.location.hash || "").includes("type=recovery") || (window.location.search || "").includes("type=recovery");
    if (!isRecovery) return false;
    const { data, error } = await supabaseClient.auth.getSession();
    if (error || !data?.session) {
        showLogin();
        showMessage("loginMessage", "This password reset link is invalid or expired. Please request a new one.", "error");
        return true;
    }
    hideStudentBoxes();
    document.getElementById("resetPasswordBox")?.classList.remove("hidden");
    return true;
}

document.getElementById("forgotPasswordForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const email=document.getElementById("forgotEmail").value.trim();
    const btn=document.getElementById("forgotPasswordButton");
    btn.disabled=true; btn.textContent="Sending...";
    try {
        const redirectTo=window.location.origin+window.location.pathname;
        const {error}=await supabaseClient.auth.resetPasswordForEmail(email,{redirectTo});
        if(error) throw error;
        showMessage("forgotPasswordMessage","Reset link sent. Check your email and open the link to continue.","success");
    } catch(error) {
        showMessage("forgotPasswordMessage",error.message||"Could not send reset link.","error");
    } finally { btn.disabled=false; btn.textContent="Send Reset Link"; }
});

document.getElementById("resetPasswordForm")?.addEventListener("submit", async e => {
    e.preventDefault();
    const password=document.getElementById("newPassword").value;
    const confirm=document.getElementById("confirmNewPassword").value;
    const btn=document.getElementById("resetPasswordButton");
    if(password.length<6) return showMessage("resetPasswordMessage","Password must be at least 6 characters.","error");
    if(password!==confirm) return showMessage("resetPasswordMessage","The passwords do not match.","error");
    btn.disabled=true; btn.textContent="Updating...";
    try {
        const {data}=await supabaseClient.auth.getSession();
        if(!data?.session) throw new Error("Reset session is missing or expired. Request a new reset link.");
        const {error}=await supabaseClient.auth.updateUser({password});
        if(error) throw error;
        showMessage("resetPasswordMessage","Password updated successfully. You can now log in.","success");
        setTimeout(()=>{ showLogin(); showMessage("loginMessage","Password updated successfully. Please log in.","success"); },1200);
    } catch(error) {
        showMessage("resetPasswordMessage",error.message||"Could not update password.","error");
    } finally { btn.disabled=false; btn.textContent="Update Password"; }
});

/* ========================================
   SAVE STUDENT PROFILE
======================================== */

async function saveStudentProfile(
    user,
    fullName,
    username,
    email
) {

    try {

        if (!user?.id) {
            console.log("Profile save skipped: missing user ID.");
            return false;
        }

        const {
            data: sessionData,
            error: sessionError
        } = await supabaseClient.auth.getSession();

        if (sessionError || !sessionData?.session || sessionData.session.user.id !== user.id) {
            console.log("Profile save skipped until the user has an authenticated session.");
            return false;
        }

        const {
            error
        } =
            await supabaseClient
                .from("Student_profiles")
                .upsert(
                    {
                        id:
                            user.id,

                        Full_name:
                            fullName,

                        Username:
                            username,

                        email:
                            email

                    },
                    {
                        onConflict:
                            "id"
                    }
                );


        if (error) {

            console.log(
                "Save profile error:",
                error
            );

            return false;

        }


        return true;

    }

    catch (error) {

        console.log(
            "Profile save error:",
            error
        );

        return false;

    }

}


/* ========================================
   LOGIN
======================================== */

document
    .getElementById("loginForm")
    .addEventListener(
        "submit",
        async function(event) {

            event.preventDefault();


            const email =
                document
                    .getElementById(
                        "loginEmail"
                    )
                    .value
                    .trim();


            const password =
                document
                    .getElementById(
                        "loginPassword"
                    )
                    .value;


            try {

                showMessage(
                    "loginMessage",
                    "Logging in...",
                    "success"
                );


                const {
                    data,
                    error
                } =
                    await supabaseClient.auth.signInWithPassword(
                        {
                            email:
                                email,

                            password:
                                password
                        }
                    );


                if (error) {

                    showMessage(
                        "loginMessage",
                        error.message,
                        "error"
                    );

                    return;

                }


                if (!data.user) {

                    showMessage(
                        "loginMessage",
                        "Login failed. Please try again.",
                        "error"
                    );

                    return;

                }


                await loadStudentProfile(
                    data.user
                );


                window.location.href =
                    "dashboard.html";

            }

            catch (error) {

                console.log(
                    "Login error:",
                    error
                );


                showMessage(
                    "loginMessage",
                    error.message ||
                    "Login failed.",
                    "error"
                );

            }

        }
    );


/* ========================================
   REGISTER
======================================== */

document
    .getElementById("registerForm")
    .addEventListener(
        "submit",
        async function(event) {

            event.preventDefault();


            const fullName =
                document
                    .getElementById(
                        "registerName"
                    )
                    .value
                    .trim();


            const username =
                document
                    .getElementById(
                        "registerUsername"
                    )
                    .value
                    .trim();


            const email =
                document
                    .getElementById(
                        "registerEmail"
                    )
                    .value
                    .trim();


            const password =
                document
                    .getElementById(
                        "registerPassword"
                    )
                    .value;

            const termsChecked =
                document
                    .getElementById(
                        "termsAgreement"
                    )
                    .checked;

            if (!termsChecked) {
                showMessage(
                    "registerMessage",
                    "Please agree to the Terms & Policies before creating your account.",
                    "error"
                );
                document.getElementById("termsAgreement")?.focus();
                return;
            }

            try {

                showMessage(
                    "registerMessage",
                    "Creating your account...",
                    "success"
                );


                const {
                    data,
                    error
                } =
                    await supabaseClient.auth.signUp(
                        {
                            email:
                                email,

                            password:
                                password,

                            options: {

                                data: {

                                    full_name:
                                        fullName,

                                    username:
                                        username

                                }

                            }

                        }
                    );


                if (error) {

                    showMessage(
                        "registerMessage",
                        error.message,
                        "error"
                    );

                    return;

                }


                if (!data.user) {

                    showMessage(
                        "registerMessage",
                        "Account could not be created.",
                        "error"
                    );

                    return;

                }


                if (data.session) {
                    const saved =
                        await saveStudentProfile(
                            data.user,
                            fullName,
                            username,
                            email
                        );

                    if (!saved) {
                        showMessage(
                            "registerMessage",
                            "Account created, but the profile could not be saved. Please sign in once your account is confirmed and try again.",
                            "error"
                        );
                        return;
                    }

                    studentName = fullName;
                    studentUsername = username;

                    localStorage.setItem("studentName", studentName);
                    localStorage.setItem("studentUsername", studentUsername);

                    window.location.href = "dashboard.html";
                    return;
                }

                showMessage(
                    "registerMessage",
                    "Account created successfully. Please check your email to confirm your account, then login.",
                    "success"
                );


            }

            catch (error) {

                console.log(
                    "Registration error:",
                    error
                );


                showMessage(
                    "registerMessage",
                    error.message ||
                    "Registration failed.",
                    "error"
                );

            }

        }
    );


/* ========================================
   LOAD STUDENT PROFILE
======================================== */

async function loadStudentProfile(user) {

    try {

        let {
            data: profile,
            error
        } =
            await supabaseClient
                .from("Student_profiles")
                .select("*")
                .eq(
                    "id",
                    user.id
                )
                .maybeSingle();


        if (error) {

            console.log(
                "Profile read error:",
                error
            );

        }


        if (!profile) {

            const fullName =
                user.user_metadata?.full_name ||
                user.email ||
                "Student";


            const username =
                user.user_metadata?.username ||
                (
                    user.email
                        ? user.email.split("@")[0]
                        : "student"
                );


            await saveStudentProfile(
                user,
                fullName,
                username,
                user.email
            );


            profile = {

                Full_name:
                    fullName,

                Username:
                    username,

                email:
                    user.email

            };

        }


        studentName =
            profile.Full_name ||
            user.user_metadata?.full_name ||
            user.email ||
            "Student";


        studentUsername =
            profile.Username ||
            user.user_metadata?.username ||
            (
                user.email
                    ? user.email.split("@")[0]
                    : "student"
            );


        localStorage.setItem(
            "studentName",
            studentName
        );


        localStorage.setItem(
            "studentUsername",
            studentUsername
        );


    }

    catch (error) {

        console.log(
            "Load profile error:",
            error
        );

    }

}/* ========================================
   LOAD SUBSCRIPTION STATUS
======================================== */

async function loadSubscriptionStatus() {

    try {

        const {
            data: sessionData,
            error: sessionError
        } =
            await supabaseClient.auth.getSession();


        if (
            sessionError ||
            !sessionData.session
        ) {

            subscribed = false;

            subscriptionDate = null;

            return false;

        }


        const user =
            sessionData.session.user;


        /*
         * IMPORTANT:
         * This reads the Subscription table.
         *
         * Keep the table/column names the
         * same as the ones already working
         * in your Supabase project.
         */

        const {
            data: subscription,
            error
        } =
            await supabaseClient
                .from("subscriptions")
                .select("*")
                .eq(
                    "user_id",
                    user.id
                )
                .maybeSingle();


        if (error) {

            console.log(
                "Subscription read error:",
                error
            );

            subscribed = false;

            subscriptionDate = null;

            return false;

        }


        if (!subscription) {

            subscribed = false;

            subscriptionDate = null;

            localStorage.removeItem(
                "studentSubscribed"
            );

            return false;

        }


        /*
         * Check possible subscription status.
         */

        const status =
            String(
                subscription.status ||
                ""
            ).toLowerCase();


        const expiresAt =
            subscription.expires_at ||
            subscription.expiry_date ||
            subscription.expiration_date ||
            null;


        let isActive = false;


        if (status === "active") {

            isActive = true;

        }


        /*
         * If an expiry date exists,
         * make sure it has not expired.
         */

        if (expiresAt) {

            const expiryTime =
                new Date(
                    expiresAt
                ).getTime();


            if (
                !Number.isNaN(
                    expiryTime
                )
            ) {

                if (
                    expiryTime <=
                    Date.now()
                ) {

                    isActive = false;

                }

            }

        }


        subscribed =
            isActive;


        subscriptionDate =
            expiresAt;


        if (subscribed) {

            localStorage.setItem(
                "studentSubscribed",
                "true"
            );

        }

        else {

            localStorage.removeItem(
                "studentSubscribed"
            );

        }


        return subscribed;

    }

    catch (error) {

        console.log(
            "Load subscription error:",
            error
        );


        subscribed = false;

        subscriptionDate = null;

        return false;

    }

}



/* ========================================
   SHOW SUBSCRIPTION PAGE
======================================== */

function showSubscription() {

    const studentPage =
        document.getElementById(
            "studentPage"
        );


    if (!studentPage) {

        return;

    }


    studentPage.innerHTML = `

        <div class="subscription-page">

            <div class="subscription-box">

                <h2>
                    Practice Subscription
                </h2>


                <p>
                    Choose your subscription plan.
                </p>


                <!-- 30 DAYS -->

                <div class="subscription-plan">

                    <h3>
                        30 Days
                    </h3>


                    <p>
                        ₦1,500 for 30 days
                    </p>


                    <button
                        type="button"
                        onclick="payFor30Days()"
                    >
                        Pay ₦1,500
                    </button>

                </div>


                <!-- 1 YEAR -->

                <div class="subscription-plan">

                    <h3>
                        1 Year
                    </h3>


                    <p>
                        ₦4,000 for 1 year — unlimited CBT practice
                    </p>


                    <button
                        type="button"
                        onclick="payFor1Year()"
                    >
                        Pay ₦4,000
                    </button>

                </div>


                <button
                    type="button"
                    class="secondary-button"
                    onclick="returnToDashboard()"
                >
                    Back to Dashboard
                </button>

            </div>

        </div>

    `;

}



/* ========================================
   RETURN TO DASHBOARD
======================================== */

function returnToDashboard() {

    window.location.href =
        "dashboard.html";

}



/* ========================================
   PAY FOR 30 DAYS
======================================== */

function payFor30Days() {

    payWithPaystack(
        1500,
        30
    );

}



/* ========================================
   PAY FOR 1 YEAR
======================================== */

function payFor1Year() {

    payWithPaystack(
        4000,
        365
    );

}



/* ========================================
   START FREE PRACTICE
======================================== */

function startFreePractice() {

    localStorage.setItem(
        "freePractice",
        "true"
    );


    localStorage.removeItem(
        "studentPractice"
    );


    window.location.href =
        "subject.html";

}



/* ========================================
   START FULL PRACTICE
======================================== */

async function startPractice() {

    const isSubscribed =
        await loadSubscriptionStatus();


    if (!isSubscribed) {

        alert(
            "Your full practice subscription is not active. You can still use the 10 free questions."
        );


        showSubscription();

        return;

    }


    localStorage.setItem(
        "studentPractice",
        "true"
    );


    localStorage.removeItem(
        "freePractice"
    );


    localStorage.setItem(
        "studentSubscribed",
        "true"
    );


    window.location.href =
        "subject.html";

}



/* ========================================
   LOGOUT
======================================== */

async function logout() {

    const confirmLogout =
        confirm(
            "Are you sure you want to logout?"
        );


    if (!confirmLogout) {

        return;

    }


    try {

        const {
            error
        } =
            await supabaseClient.auth.signOut();


        if (error) {

            console.log(
                "Supabase logout error:",
                error
            );

        }

    }

    catch (error) {

        console.log(
            "Logout error:",
            error
        );

    }


    localStorage.removeItem(
        "studentName"
    );


    localStorage.removeItem(
        "studentUsername"
    );


    localStorage.removeItem(
        "studentPractice"
    );


    localStorage.removeItem(
        "studentSubscribed"
    );


    localStorage.removeItem(
        "freePractice"
    );


    studentName =
        "";


    studentUsername =
        "";


    subscribed =
        false;


    subscriptionDate =
        null;


    window.location.href =
        "student.html";

}



/* ========================================
   PAYSTACK PAYMENT
======================================== */

async function payWithPaystack(
    amount,
    durationDays
) {

    try {

        const {
            data: sessionData,
            error: sessionError
        } =
            await supabaseClient.auth.getSession();


        if (
            sessionError ||
            !sessionData.session
        ) {

            alert(
                "Please login again before subscribing."
            );

            window.location.href =
                "student.html";

            return;

        }


        const user =
            sessionData.session.user;


        if (!user.email) {

            alert(
                "Your account does not have an email address."
            );

            return;

        }


        if (
            typeof PaystackPop ===
            "undefined"
        ) {

            alert(
                "Paystack did not load. Please refresh the page."
            );

            return;

        }


        const reference =
            "JAMB_" +
            Date.now() +
            "_" +
            Math.floor(
                Math.random() * 100000
            );

        const amountKobo = Math.round(
            Number(amount) * 100
        );

        if (!Number.isFinite(amountKobo) || amountKobo <= 0) {
            alert("Invalid payment amount.");
            return;
        }


        /*
         * Use the same Paystack TEST public key
         * that was already working in your project.
         */

        const paystackPublicKey =
            "pk_live_d8f44cfe7a9e237bf9fbae3483da2e2c0e77305e";


        const paystack =
            new PaystackPop();


        paystack.newTransaction({

            key:
                paystackPublicKey,

            email:
                user.email,

            amount:
                amountKobo,

            currency:
                "NGN",

            reference:
                reference,

            metadata: {

                user_id:
                    user.id,

                plan_days:
                    durationDays

            },


            onSuccess:
                async function(transaction) {

                    alert(
                        "Payment successful. Verifying payment..."
                    );


                    await completeSubscription(
                        user.id,
                        durationDays,
                        transaction.reference
                    );

                },


            onCancel:
                function() {

                    alert(
                        "Payment window closed."
                    );

                },


            onError:
                function(error) {

                    console.log(
                        "Paystack transaction error:",
                        error
                    );


                    alert(
                        "Paystack payment error: " +
                        (
                            error?.message ||
                            "Unknown error"
                        )
                    );

                }

        });

    }

    catch (error) {

        console.log(
            "Paystack error:",
            error
        );


        alert(
            "Something went wrong: " +
            (
                error?.message ||
                "Unknown error"
            )
        );

    }

}/* ========================================
   COMPLETE SUBSCRIPTION
======================================== */

async function completeSubscription(
    userId,
    durationDays,
    reference
) {

    try {

        console.log(
            "Starting payment verification..."
        );


        const {
            data,
            error
        } =
            await supabaseClient.functions.invoke(
                "Paystack_payment",
                {
                    body: {

                        user_id:
                            userId,

                        reference:
                            reference,

                        plan_days:
                            durationDays

                    }
                }
            );


        console.log(
            "Edge Function response:",
            data
        );


        if (error) {

            console.log(
                "Edge Function error:",
                error
            );


            alert(
                "Payment was successful, but verification failed.\n\n" +
                (
                    error.message ||
                    "Please try again."
                )
            );


            return;

        }


        if (
            !data ||
            !data.success
        ) {

            console.log(
                "Verification response:",
                data
            );


            alert(
                "Payment was verified, but the subscription could not be activated.\n\n" +
                (
                    data?.message ||
                    "Unknown error."
                )
            );


            return;

        }


        subscribed =
            true;


        subscriptionDate =
            data.expires_at ||
            null;


        localStorage.setItem(
            "studentSubscribed",
            "true"
        );


        alert(
            "Payment successful! Your subscription is now active."
        );


        /*
         * Go back to the separate dashboard.
         */

        window.location.href =
            "dashboard.html";

    }

    catch (error) {

        console.log(
            "Subscription completion error:",
            error
        );


        alert(
            "Payment was successful, but something went wrong while activating your subscription.\n\n" +
            (
                error?.message ||
                "Unknown error."
            )
        );

    }

}



/* ========================================
   CHECK EXISTING LOGIN
======================================== */

async function checkLogin() {

    try {

        const {
            data,
            error
        } =
            await supabaseClient.auth.getSession();


        if (error) {

            console.log(
                "Session error:",
                error
            );


            showLogin();

            return;

        }


        /*
         * No active session.
         */

        if (!data.session) {

            showLogin();

            return;

        }


        /*
         * User is already logged in.
         * Load the profile and go directly
         * to the separate dashboard.
         */

        const user =
            data.session.user;


        await loadStudentProfile(
            user
        );


        await loadSubscriptionStatus();


        window.location.href =
            "dashboard.html";

    }

    catch (error) {

        console.log(
            "Check login error:",
            error
        );


        showLogin();

    }

}



/* ========================================
   START APPLICATION
======================================== */

(async function(){
    const recovering = await checkPasswordRecovery();
    if (!recovering) await checkLogin();
})();

