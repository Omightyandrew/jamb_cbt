/**
 * ExamPilot — Offline Authentication Module
 * ==========================================
 * Secure, locally encrypted offline credential with
 * password-verified offline re-login.
 *
 * Architecture:
 *   Password → PBKDF2-SHA-256 (200,000 iterations)
 *   → AES-GCM-256 key → encrypted identity blob
 *
 * Stored:
 *   email, salt, iv, ciphertext, enrolledAt,
 *   credentialVersion, algorithm, iterations
 *
 * Never stored:
 *   plaintext password
 *   derived key
 *   password verifier
 *   Supabase access/refresh tokens
 */

(function () {
    "use strict";

    var DB_NAME            = "exampilot-offline";
    var DB_VERSION         = 2;
    var STORE_NAME         = "offlineCredentials";
    var PBKDF2_ITERATIONS  = 200000;
    var CREDENTIAL_VERSION = 1;


    /* ------------------------------------------------------------------ */
    /* Hex helpers                                                         */
    /* ------------------------------------------------------------------ */

    function hexEncode(buffer) {
        return Array.prototype.map.call(
            new Uint8Array(buffer),
            function (b) {
                return b.toString(16).padStart(2, "0");
            }
        ).join("");
    }

    function hexDecode(hex) {
        var bytes = new Uint8Array(hex.length / 2);

        for (var i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
        }

        return bytes.buffer;
    }


    /* ------------------------------------------------------------------ */
    /* IndexedDB                                                           */
    /* ------------------------------------------------------------------ */

    function migrateAuthoritativeSchema(database) {
        if (!database.objectStoreNames.contains("questionSets")) {
            var questionStore = database.createObjectStore("questionSets", {
                keyPath: "key"
            });

            questionStore.createIndex("cachedAt", "cachedAt", {
                unique: false
            });

            questionStore.createIndex("testType", "testType", {
                unique: false
            });
        }

        if (!database.objectStoreNames.contains(STORE_NAME)) {
            database.createObjectStore(STORE_NAME, {
                keyPath: "email"
            });
        }
    }

    function openDatabase() {
        if (
            window.ExamPilotOfflineDB &&
            typeof window.ExamPilotOfflineDB.open === "function"
        ) {
            return window.ExamPilotOfflineDB.open();
        }

        return new Promise(function (resolve, reject) {
            if (!("indexedDB" in window)) {
                reject(
                    new Error("IndexedDB is not available in this browser.")
                );
                return;
            }

            var request = window.indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = function () {
                migrateAuthoritativeSchema(request.result);
            };

            request.onsuccess = function () {
                resolve(request.result);
            };

            request.onerror = function () {
                reject(
                    request.error ||
                    new Error("Could not open offline auth storage.")
                );
            };

            request.onblocked = function () {
                console.warn(
                    "[OfflineAuth] Database open blocked. Close other ExamPilot tabs."
                );
            };
        });
    }

    if (!window.ExamPilotOfflineDB) {
        window.ExamPilotOfflineDB = {
            DB_NAME: DB_NAME,
            DB_VERSION: DB_VERSION,
            open: openDatabase,
            migrate: migrateAuthoritativeSchema
        };
    }


    /* ------------------------------------------------------------------ */
    /* Web Crypto                                                          */
    /* ------------------------------------------------------------------ */

    function deriveKey(password, salt) {
        var enc = new TextEncoder();

        return crypto.subtle.importKey(
            "raw",
            enc.encode(password),
            "PBKDF2",
            false,
            ["deriveKey"]
        ).then(function (keyMaterial) {
            return crypto.subtle.deriveKey(
                {
                    name: "PBKDF2",
                    salt: salt instanceof Uint8Array
                        ? salt
                        : new Uint8Array(salt),
                    iterations: PBKDF2_ITERATIONS,
                    hash: "SHA-256"
                },
                keyMaterial,
                {
                    name: "AES-GCM",
                    length: 256
                },
                false,
                ["encrypt", "decrypt"]
            );
        });
    }


    /* ------------------------------------------------------------------ */
    /* Enrolment                                                           */
    /* ------------------------------------------------------------------ */

    function enroll(email, password, userId, displayName, username) {
        var normalEmail = String(email || "").trim().toLowerCase();
        var safeDisplay = String(displayName || "");
        var safeUser = String(username || "");

        if (!normalEmail || !password || !userId) {
            console.warn(
                "[OfflineAuth] Enrollment skipped: required identity data missing."
            );
            return Promise.resolve(false);
        }

        if (!window.crypto || !window.crypto.subtle) {
            console.warn(
                "[OfflineAuth] Web Crypto API not available; enrollment skipped."
            );
            return Promise.resolve(false);
        }

        var salt = crypto.getRandomValues(
            new Uint8Array(32)
        );

        var iv = crypto.getRandomValues(
            new Uint8Array(12)
        );

        return deriveKey(password, salt)
            .then(function (key) {
                var plaintext = new TextEncoder().encode(
                    JSON.stringify({
                        v: CREDENTIAL_VERSION,
                        userId: String(userId),
                        email: normalEmail,
                        displayName: safeDisplay,
                        username: safeUser
                    })
                );

                return crypto.subtle.encrypt(
                    {
                        name: "AES-GCM",
                        iv: iv
                    },
                    key,
                    plaintext
                );
            })
            .then(function (ciphertext) {
                var record = {
                    email: normalEmail,
                    salt: hexEncode(salt),
                    iv: hexEncode(iv),
                    ciphertext: hexEncode(ciphertext),
                    enrolledAt: new Date().toISOString(),
                    credentialVersion: CREDENTIAL_VERSION,
                    algorithm: "PBKDF2-SHA256-AES-GCM-256",
                    iterations: PBKDF2_ITERATIONS
                };

                return openDatabase().then(function (db) {
                    return new Promise(function (resolve, reject) {
                        var tx;

                        try {
                            tx = db.transaction(
                                STORE_NAME,
                                "readwrite"
                            );

                            var store = tx.objectStore(STORE_NAME);

                            store.put(record);

                            tx.oncomplete = function () {
                                db.close();
                                resolve(true);
                            };

                            tx.onerror = function () {
                                var error =
                                    tx.error ||
                                    new Error(
                                        "Could not save offline credential."
                                    );

                                db.close();
                                reject(error);
                            };

                            tx.onabort = function () {
                                var error =
                                    tx.error ||
                                    new Error(
                                        "Offline credential transaction was aborted."
                                    );

                                db.close();
                                reject(error);
                            };
                        } catch (err) {
                            try {
                                db.close();
                            } catch (closeErr) {}

                            reject(err);
                        }
                    });
                });
            })
            .catch(function (err) {
                console.warn(
                    "[OfflineAuth] Enrollment failed:",
                    err
                );

                return false;
            });
    }


    /* ------------------------------------------------------------------ */
    /* Verify and decrypt                                                  */
    /* ------------------------------------------------------------------ */

    function verifyAndDecrypt(email, password) {
        var normalEmail = String(email || "").trim().toLowerCase();

        if (!normalEmail || !password) {
            return Promise.resolve(null);
        }

        if (!window.crypto || !window.crypto.subtle) {
            return Promise.resolve(null);
        }

        return openDatabase()
            .then(function (db) {
                return new Promise(function (resolve, reject) {
                    var tx;
                    var record = null;

                    try {
                        tx = db.transaction(
                            STORE_NAME,
                            "readonly"
                        );

                        var store = tx.objectStore(STORE_NAME);
                        var req = store.get(normalEmail);

                        /*
                         * IMPORTANT:
                         * Capture the IDB request result in onsuccess.
                         * Do not depend on req.result from tx.oncomplete.
                         */
                        req.onsuccess = function () {
                            record = req.result || null;
                        };

                        req.onerror = function () {
                            reject(
                                req.error ||
                                new Error(
                                    "Could not read offline credential."
                                )
                            );
                        };

                        tx.oncomplete = function () {
                            db.close();
                            resolve(record);
                        };

                        tx.onerror = function () {
                            var error =
                                tx.error ||
                                new Error(
                                    "Could not read offline credential."
                                );

                            db.close();
                            reject(error);
                        };

                        tx.onabort = function () {
                            var error =
                                tx.error ||
                                new Error(
                                    "Offline credential transaction was aborted."
                                );

                            db.close();
                            reject(error);
                        };
                    } catch (err) {
                        try {
                            db.close();
                        } catch (closeErr) {}

                        reject(err);
                    }
                });
            })
            .then(function (record) {
                if (!record) {
                    return null;
                }

                var salt = new Uint8Array(
                    hexDecode(record.salt)
                );

                var iv = new Uint8Array(
                    hexDecode(record.iv)
                );

                var ciphertext = hexDecode(
                    record.ciphertext
                );

                var savedIterations =
                    record.iterations ||
                    PBKDF2_ITERATIONS;

                return crypto.subtle.importKey(
                    "raw",
                    new TextEncoder().encode(password),
                    "PBKDF2",
                    false,
                    ["deriveKey"]
                )
                    .then(function (keyMaterial) {
                        return crypto.subtle.deriveKey(
                            {
                                name: "PBKDF2",
                                salt: salt,
                                iterations: savedIterations,
                                hash: "SHA-256"
                            },
                            keyMaterial,
                            {
                                name: "AES-GCM",
                                length: 256
                            },
                            false,
                            ["decrypt"]
                        );
                    })
                    .then(function (key) {
                        return crypto.subtle.decrypt(
                            {
                                name: "AES-GCM",
                                iv: iv
                            },
                            key,
                            ciphertext
                        );
                    })
                    .then(function (plaintext) {
                        return JSON.parse(
                            new TextDecoder().decode(
                                plaintext
                            )
                        );
                    })
                    .catch(function () {
                        /*
                         * Wrong password and corrupted/invalid
                         * ciphertext intentionally produce the
                         * same authentication result.
                         */
                        return null;
                    });
            })
            .catch(function (err) {
                console.warn(
                    "[OfflineAuth] Verify failed:",
                    err
                );

                return null;
            });
    }


    /* ------------------------------------------------------------------ */
    /* Check credential existence                                          */
    /* ------------------------------------------------------------------ */

    function hasCredential(email) {
        var normalEmail = String(email || "").trim().toLowerCase();

        if (!normalEmail) {
            return Promise.resolve(false);
        }

        return openDatabase()
            .then(function (db) {
                return new Promise(function (resolve) {
                    var tx;
                    var count = 0;

                    try {
                        tx = db.transaction(
                            STORE_NAME,
                            "readonly"
                        );

                        var store = tx.objectStore(STORE_NAME);
                        var req = store.count(normalEmail);

                        /*
                         * IMPORTANT:
                         * Capture count through the request's
                         * success event.
                         */
                        req.onsuccess = function () {
                            count = req.result || 0;
                        };

                        req.onerror = function () {
                            try {
                                db.close();
                            } catch (closeErr) {}

                            resolve(false);
                        };

                        tx.oncomplete = function () {
                            db.close();
                            resolve(count > 0);
                        };

                        tx.onerror = function () {
                            db.close();
                            resolve(false);
                        };

                        tx.onabort = function () {
                            db.close();
                            resolve(false);
                        };
                    } catch (err) {
                        try {
                            db.close();
                        } catch (closeErr) {}

                        resolve(false);
                    }
                });
            })
            .catch(function () {
                return false;
            });
    }


    /* ------------------------------------------------------------------ */
    /* Remove offline credential                                           */
    /* ------------------------------------------------------------------ */

    function revokeDevice(email) {
        var normalEmail = String(email || "").trim().toLowerCase();

        if (!normalEmail) {
            return Promise.resolve(false);
        }

        return openDatabase()
            .then(function (db) {
                return new Promise(function (resolve, reject) {
                    var tx;

                    try {
                        tx = db.transaction(
                            STORE_NAME,
                            "readwrite"
                        );

                        var store = tx.objectStore(STORE_NAME);

                        store.delete(normalEmail);

                        tx.oncomplete = function () {
                            db.close();
                            resolve(true);
                        };

                        tx.onerror = function () {
                            var error =
                                tx.error ||
                                new Error(
                                    "Could not remove offline credential."
                                );

                            db.close();
                            reject(error);
                        };

                        tx.onabort = function () {
                            var error =
                                tx.error ||
                                new Error(
                                    "Offline credential transaction was aborted."
                                );

                            db.close();
                            reject(error);
                        };
                    } catch (err) {
                        try {
                            db.close();
                        } catch (closeErr) {}

                        reject(err);
                    }
                });
            })
            .catch(function (err) {
                console.warn(
                    "[OfflineAuth] Revoke failed:",
                    err
                );

                return false;
            });
    }


    /* ------------------------------------------------------------------ */
    /* Public API                                                          */
    /* ------------------------------------------------------------------ */

    window.OfflineAuth = {
        enroll: enroll,
        verifyAndDecrypt: verifyAndDecrypt,
        hasCredential: hasCredential,
        revokeDevice: revokeDevice
    };

}());