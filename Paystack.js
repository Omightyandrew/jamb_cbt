// ======================================================
// PAYSTACK.JS
// JAMB CBT SUBSCRIPTION PAYMENT
// ======================================================


// ======================================================
// 1. PAYSTACK TEST PUBLIC KEY
// ======================================================

const PAYSTACK_PUBLIC_KEY =
    "pk_live_d8f44cfe7a9e237bf9fbae3483da2e2c0e77305e";


// ======================================================
// 2. SUPABASE EDGE FUNCTION NAME
// ======================================================

const PAYSTACK_FUNCTION =
    "Paystack_payment";


// ======================================================
// 3. CHECK PAYSTACK
// ======================================================

console.log("================================");
console.log("PAYSTACK.JS LOADED");
console.log("PaystackPop:", typeof PaystackPop);
console.log("================================");


// ======================================================
// 4. 30 DAYS
// ₦1,500
// ======================================================

function payFor30Days() {

    console.log("30 DAYS PAYMENT SELECTED");

    startPaystackPayment(
        1500,
        30
    );

}


// ======================================================
// 5. 1 YEAR
// ₦4,000
// ======================================================

function payFor1Year() {

    console.log("1 YEAR PAYMENT SELECTED");

    startPaystackPayment(
        4000,
        365
    );

}


// ======================================================
// 6. START PAYMENT
// ======================================================

async function startPaystackPayment(
    amountNaira,
    durationDays
) {

    console.log("================================");
    console.log("STARTING PAYSTACK PAYMENT");
    console.log("Amount:", amountNaira);
    console.log("Days:", durationDays);
    console.log("================================");


    try {

        // ----------------------------------------------
        // CHECK PAYSTACK LIBRARY
        // ----------------------------------------------

        if (
            typeof PaystackPop ===
            "undefined"
        ) {

            console.error(
                "PaystackPop is undefined."
            );

            alert(
                "Paystack did not load.\n\n" +
                "Please refresh the page and try again."
            );

            return;

        }


        // ----------------------------------------------
        // CHECK SUPABASE
        // ----------------------------------------------

        if (
            typeof supabaseClient ===
            "undefined"
        ) {

            console.error(
                "supabaseClient is undefined."
            );

            alert(
                "Supabase is not loaded.\n\n" +
                "Please refresh the page."
            );

            return;

        }


        // ----------------------------------------------
        // CHECK LOGIN
        // ----------------------------------------------

        const {
            data: userData,
            error: userError
        } =
            await supabaseClient.auth.getUser();


        if (userError) {

            console.error(
                "User error:",
                userError
            );

            alert(
                "Could not get your account.\n\n" +
                "Please login again."
            );

            return;

        }


        const user =
            userData?.user;


        if (!user) {

            alert(
                "Please login again before making payment."
            );

            return;

        }


        // ----------------------------------------------
        // CHECK EMAIL
        // ----------------------------------------------

        if (!user.email) {

            alert(
                "Your account does not have an email address."
            );

            return;

        }


        console.log(
            "Logged-in user:",
            user.id
        );

        console.log(
            "Email:",
            user.email
        );


        // ----------------------------------------------
        // CONVERT NAIRA TO KOBO
        // ----------------------------------------------

        const amountKobo =
            Math.round(
                Number(amountNaira) * 100
            );


        if (
            !Number.isFinite(amountKobo) ||
            amountKobo <= 0
        ) {

            alert(
                "Invalid payment amount."
            );

            return;

        }


        // ----------------------------------------------
        // CREATE UNIQUE REFERENCE
        // ----------------------------------------------

        const reference =
            "JAMB-" +
            Date.now() +
            "-" +
            Math.floor(
                Math.random() * 1000000
            );


        console.log(
            "Payment reference:",
            reference
        );


        // ----------------------------------------------
        // CREATE PAYSTACK POPUP
        // ----------------------------------------------

        const paystack =
            new PaystackPop();


        console.log(
            "Paystack popup created."
        );


        // ----------------------------------------------
        // OPEN PAYSTACK PAYMENT
        // ----------------------------------------------

        paystack.newTransaction({

            key:
                PAYSTACK_PUBLIC_KEY,

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
                    Number(durationDays),

                amount_naira:
                    Number(amountNaira)

            },


            // ==========================================
            // PAYMENT LOADED
            // ==========================================

            onLoad:
                function(response) {

                    console.log(
                        "PAYSTACK PAYMENT WINDOW LOADED"
                    );

                    console.log(
                        response
                    );

                },


            // ==========================================
            // PAYMENT SUCCESS
            // ==========================================

            onSuccess:
                async function(transaction) {

                    console.log(
                        "================================"
                    );

                    console.log(
                        "PAYMENT SUCCESS"
                    );

                    console.log(
                        transaction
                    );

                    console.log(
                        "================================"
                    );


                    const paymentReference =
                        transaction?.reference ||
                        reference;


                    alert(
                        "Payment successful!\n\n" +
                        "Verifying payment..."
                    );


                    await verifyPayment(

                        user.id,

                        Number(durationDays),

                        paymentReference,

                        amountKobo

                    );

                },


            // ==========================================
            // PAYMENT CANCELLED
            // ==========================================

            onCancel:
                function() {

                    console.log(
                        "PAYMENT CANCELLED"
                    );


                    alert(
                        "Payment was cancelled."
                    );

                },


            // ==========================================
            // PAYSTACK ERROR
            // ==========================================

            onError:
                function(error) {

                    console.error(
                        "PAYSTACK ERROR:",
                        error
                    );


                    const message =
                        error?.message ||
                        "Unknown Paystack error.";


                    alert(
                        "Paystack payment error:\n\n" +
                        message
                    );

                }

        });


    }

    catch (error) {

        console.error(
            "START PAYMENT ERROR:",
            error
        );


        alert(
            "Could not start payment.\n\n" +
            (
                error?.message ||
                String(error)
            )
        );

    }

}


// ======================================================
// 7. VERIFY PAYMENT
// ======================================================

async function verifyPayment(

    userId,

    durationDays,

    reference,

    amountKobo

) {

    console.log("================================");
    console.log("VERIFYING PAYMENT");
    console.log("User:", userId);
    console.log("Days:", durationDays);
    console.log("Reference:", reference);
    console.log("Amount:", amountKobo);
    console.log("================================");


    try {

        // ----------------------------------------------
        // CHECK SUPABASE
        // ----------------------------------------------

        if (
            typeof supabaseClient ===
            "undefined"
        ) {

            alert(
                "Supabase is not available."
            );

            return;

        }


        // ----------------------------------------------
        // CALL SUPABASE EDGE FUNCTION
        // ----------------------------------------------

        console.log(
            "Calling Edge Function:",
            PAYSTACK_FUNCTION
        );


        const {
            data,
            error
        } =
            await supabaseClient.functions.invoke(

                PAYSTACK_FUNCTION,

                {

                    body: {

                        user_id:
                            userId,

                        reference:
                            reference,

                        plan_days:
                            Number(durationDays),

                        amount:
                            Number(amountKobo)

                    }

                }

            );


        console.log(
            "Edge Function data:",
            data
        );


        console.log(
            "Edge Function error:",
            error
        );


        // ----------------------------------------------
        // EDGE FUNCTION ERROR
        // ----------------------------------------------

        if (error) {

            console.error(
                "EDGE FUNCTION ERROR:",
                error
            );


            alert(
                "Payment was successful, but verification failed.\n\n" +
                (
                    error.message ||
                    "Supabase could not verify the payment."
                )
            );


            return;

        }


        // ----------------------------------------------
        // SERVER RESPONSE ERROR
        // ----------------------------------------------

        if (
            !data ||
            data.success !== true
        ) {

            console.error(
                "SERVER VERIFICATION FAILED:",
                data
            );


            alert(

                "Payment verification failed.\n\n" +

                (
                    data?.message ||
                    "The server could not activate your subscription."
                )

            );


            return;

        }


        // ----------------------------------------------
        // PAYMENT VERIFIED
        // ----------------------------------------------

        console.log(
            "================================"
        );

        console.log(
            "PAYMENT VERIFIED SUCCESSFULLY"
        );

        console.log(
            "Expiry:",
            data.expiry_date
        );

        console.log(
            "================================"
        );


        // ----------------------------------------------
        // UPDATE GLOBAL VARIABLES
        // ----------------------------------------------

        if (
            typeof subscribed !==
            "undefined"
        ) {

            subscribed =
                true;

        }


        if (
            typeof subscriptionDate !==
            "undefined"
        ) {

            subscriptionDate =
                data.expiry_date;

        }


        // ----------------------------------------------
        // SAVE LOCAL STATUS
        // ----------------------------------------------

        localStorage.setItem(
            "studentSubscribed",
            "true"
        );


        localStorage.setItem(
            "subscriptionDate",
            data.expiry_date || ""
        );


        localStorage.setItem(
            "paymentReference",
            reference
        );


        localStorage.setItem(
            "subscriptionPlanDays",
            String(durationDays)
        );


        // ----------------------------------------------
        // SUCCESS MESSAGE
        // ----------------------------------------------

        alert(
            "Payment successful!\n\n" +
            "Your subscription is now active."
        );


        // ----------------------------------------------
        // RETURN TO DASHBOARD
        // ----------------------------------------------

        if (
            typeof showDashboard ===
            "function"
        ) {

            await showDashboard();

        }

        else {

            window.location.reload();

        }

    }

    catch (error) {

        console.error(
            "VERIFY PAYMENT ERROR:",
            error
        );


        alert(
            "Payment verification error.\n\n" +
            (
                error?.message ||
                String(error)
            )
        );

    }

}


// ======================================================
// 8. FUNCTION TESTS
// ======================================================

console.log(
    "payFor30Days:",
    typeof payFor30Days
);


console.log(
    "payFor1Year:",
    typeof payFor1Year
);


console.log(
    "startPaystackPayment:",
    typeof startPaystackPayment
);


console.log(
    "verifyPayment:",
    typeof verifyPayment
);


// ======================================================
// END PAYSTACK.JS
// ======================================================