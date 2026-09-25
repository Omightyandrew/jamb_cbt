(function () {
    "use strict";

    var DB_NAME = "exampilot-offline";
    var DB_VERSION = 4;
    var STORE_NAME = "questionSets";
    var CONFIGURATION_STORE_NAME = "cbtConfigurations";
    var CREDENTIALS_STORE_NAME = "offlineCredentials";
    var MAX_CACHED_SETS = 8;
    var MAX_QUESTIONS_PER_SET = 120;

    function migrateSchema(database, upgradeTransaction) {
        var store;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
            store = database.createObjectStore(STORE_NAME, {
                keyPath: "key"
            });
            store.createIndex("cachedAt", "cachedAt", {
                unique: false
            });
            store.createIndex("testType", "testType", {
                unique: false
            });
        } else {
            store = upgradeTransaction
                .objectStore(STORE_NAME);
        }
        if (!store.indexNames.contains("examCode")) {
            store.createIndex("examCode", "examCode", {
                unique: false
            });
        }
        var cursorRequest = store.openCursor();
        cursorRequest.onsuccess = function (event) {
            var cursor = event.target.result;
            if (!cursor) {
                return;
            }

            var record = cursor.value;
            if (!record.examCode && typeof record.key === "string") {
                record.examCode = "JAMB";
                record.key = "JAMB::" + record.key;
                cursor.update(record);
            }

            cursor.continue();
        };
        if (!database.objectStoreNames.contains(CREDENTIALS_STORE_NAME)) {
            database.createObjectStore(CREDENTIALS_STORE_NAME, {
                keyPath: "email"
            });
        }
        if (!database.objectStoreNames.contains(CONFIGURATION_STORE_NAME)) {
            database.createObjectStore(CONFIGURATION_STORE_NAME, {
                keyPath: "key"
            });
        }
    }

    function openDatabase() {
        return new Promise(function (resolve, reject) {
            if (!("indexedDB" in window)) {
                reject(new Error("IndexedDB is not available in this browser."));
                return;
            }

            var request = window.indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = function () {
                migrateSchema(request.result, request.transaction);
            };

            request.onsuccess = function () {
                resolve(request.result);
            };

            request.onerror = function () {
                reject(request.error || new Error("Could not open offline question storage."));
            };

            request.onblocked = function () {
                console.warn("[IndexedDB] Database open blocked. Close other ExamPilot tabs.");
            };
        });
    }

    // Authoritative shared IndexedDB opener for offline components
    window.ExamPilotOfflineDB = window.ExamPilotOfflineDB || {
        DB_NAME: DB_NAME,
        DB_VERSION: DB_VERSION,
        open: openDatabase,
        migrate: migrateSchema
    };

    function transactionRequest(mode, operation) {
        return openDatabase().then(function (database) {
            return new Promise(function (resolve, reject) {
                var transaction = database.transaction(STORE_NAME, mode);
                var store = transaction.objectStore(STORE_NAME);
                var request;

                try {
                    request = operation(store);
                } catch (error) {
                    database.close();
                    reject(error);
                    return;
                }

                transaction.oncomplete = function () {
                    database.close();
                    resolve(request && request.result);
                };

                transaction.onerror = function () {
                    database.close();
                    reject(transaction.error || new Error("Offline question storage request failed."));
                };
            });
        });
    }

    function normalizeTestType(testType) {
        return testType === "past" ? "past" : "practice";
    }

    function normalizeSubject(subject) {
        return String(subject || "").trim();
    }

    function normalizeExamCode(examCode) {
        return String(examCode || "JAMB").trim().toUpperCase();
    }

    function makeKey(examCode, subject, testType) {
        return normalizeExamCode(examCode) +
            "::" +
            normalizeTestType(testType) +
            "::" +
            normalizeSubject(subject).toLowerCase();
    }

    function isQuestion(value) {
        return value &&
            typeof value.question === "string" &&
            Array.isArray(value.options) &&
            value.options.length === 4;
    }

    function sanitizeQuestion(question, subject, testType) {
        if (!isQuestion(question)) {
            return null;
        }

        return {
            id: question.id ?? null,
            question: question.question,
            options: question.options.map(function (option) {
                return String(option ?? "");
            }),
            answer: String(question.answer ?? ""),
            subject: normalizeSubject(question.subject || subject),
            testType: normalizeTestType(question.testType || testType),
            topic: String(question.topic ?? ""),
            explanation: String(question.explanation ?? ""),
            year: question.year ?? null,
            source: String(question.source ?? ""),
            import_key: String(question.import_key ?? "")
        };
    }

    function enforceLimit() {
        return transactionRequest("readwrite", function (store) {
            var request = store.getAll();
            request.onsuccess = function () {
                var records = request.result || [];
                records.sort(function (left, right) {
                    return left.cachedAt - right.cachedAt;
                });

                var excess = records.length - MAX_CACHED_SETS;
                for (var index = 0; index < excess; index += 1) {
                    store.delete(records[index].key);
                }
            };
            return request;
        });
    }

    function saveSet(examCode, subject, testType, questions, version) {
        var normalizedExamCode = normalizeExamCode(examCode);
        var normalizedSubject = normalizeSubject(subject);
        var normalizedType = normalizeTestType(testType);
        var safeQuestions = (Array.isArray(questions) ? questions : [])
            .slice(0, MAX_QUESTIONS_PER_SET)
            .map(function (question) {
                return sanitizeQuestion(question, normalizedSubject, normalizedType);
            })
            .filter(Boolean);

        if (!normalizedSubject || !safeQuestions.length) {
            return Promise.resolve(false);
        }

        return transactionRequest("readwrite", function (store) {
            return store.put({
                key: makeKey(normalizedExamCode, normalizedSubject, normalizedType),
                examCode: normalizedExamCode,
                subject: normalizedSubject,
                testType: normalizedType,
                datasetVersion: version || null,
                cachedAt: Date.now(),
                questions: safeQuestions
            });
        }).then(function () {
            return enforceLimit().then(function () {
                return true;
            });
        });
    }

    function getSet(examCode, subject, testType) {
        return transactionRequest("readonly", function (store) {
            return store.get(makeKey(examCode, subject, testType));
        });
    }

    function getSets(testType) {
        var normalizedType = normalizeTestType(testType);
        return transactionRequest("readonly", function (store) {
            return store.getAll();
        }).then(function (records) {
            return (records || []).filter(function (record) {
                return record.testType === normalizedType;
            });
        });
    }

    function configurationRequest(mode, operation) {
        return openDatabase().then(function (database) {
            return new Promise(function (resolve, reject) {
                var transaction = database.transaction(CONFIGURATION_STORE_NAME, mode);
                var store = transaction.objectStore(CONFIGURATION_STORE_NAME);
                var request;

                try {
                    request = operation(store);
                } catch (error) {
                    database.close();
                    reject(error);
                    return;
                }

                transaction.oncomplete = function () {
                    database.close();
                    resolve(request && request.result);
                };

                transaction.onerror = function () {
                    database.close();
                    reject(transaction.error || new Error("Offline configuration storage request failed."));
                };
            });
        });
    }

    function configurationKey(examCode, testType) {
        return normalizeExamCode(examCode) + "::" + normalizeTestType(testType);
    }

    function saveConfiguration(exam, testType, configuration) {
        var examCode = normalizeExamCode(exam && exam.code);
        var normalizedType = normalizeTestType(testType);
        if (!exam || !exam.id || !exam.name || !configuration || !configuration.id) {
            return Promise.reject(new Error("Cannot cache an incomplete CBT configuration."));
        }

        return configurationRequest("readwrite", function (store) {
            return store.put({
                key: configurationKey(examCode, normalizedType),
                exam: {
                    id: exam.id,
                    code: examCode,
                    name: exam.name
                },
                testType: normalizedType,
                configuration: JSON.parse(JSON.stringify(configuration)),
                cachedAt: Date.now()
            });
        }).then(function () {
            return true;
        });
    }

    function getConfiguration(examCode, testType) {
        return configurationRequest("readonly", function (store) {
            return store.get(configurationKey(examCode, testType));
        });
    }

    function showOfflineNotice() {
        if (document.getElementById("offlineQuestionNotice")) {
            return;
        }

        var notice = document.createElement("div");
        notice.id = "offlineQuestionNotice";
        notice.textContent = "Offline mode - using saved questions";
        notice.setAttribute("role", "status");
        notice.style.cssText =
            "position:fixed;top:12px;left:50%;transform:translateX(-50%);" +
            "z-index:2147483647;padding:7px 12px;border-radius:999px;" +
            "font:12px Arial,sans-serif;background:#53657a;color:#fff;" +
            "box-shadow:0 2px 8px rgba(20,33,61,.18)";
        document.body.appendChild(notice);
    }

    window.OfflineQuestionStore = {
        saveSet: saveSet,
        getSet: getSet,
        getSets: getSets,
        saveConfiguration: saveConfiguration,
        getConfiguration: getConfiguration,
        showOfflineNotice: showOfflineNotice,
        maxCachedSets: MAX_CACHED_SETS,
        maxQuestionsPerSet: MAX_QUESTIONS_PER_SET
    };
}());
