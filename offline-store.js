(function () {
    "use strict";

    var DB_NAME = "exampilot-offline";
    var DB_VERSION = 1;
    var STORE_NAME = "questionSets";
    var MAX_CACHED_SETS = 8;
    var MAX_QUESTIONS_PER_SET = 120;

    function openDatabase() {
        return new Promise(function (resolve, reject) {
            if (!("indexedDB" in window)) {
                reject(new Error("IndexedDB is not available in this browser."));
                return;
            }

            var request = window.indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = function () {
                var database = request.result;
                if (!database.objectStoreNames.contains(STORE_NAME)) {
                    var store = database.createObjectStore(STORE_NAME, {
                        keyPath: "key"
                    });
                    store.createIndex("cachedAt", "cachedAt", {
                        unique: false
                    });
                    store.createIndex("testType", "testType", {
                        unique: false
                    });
                }
            };

            request.onsuccess = function () {
                resolve(request.result);
            };

            request.onerror = function () {
                reject(request.error || new Error("Could not open offline question storage."));
            };
        });
    }

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

    function makeKey(subject, testType) {
        return normalizeTestType(testType) + "::" + normalizeSubject(subject).toLowerCase();
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

    function saveSet(subject, testType, questions, version) {
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
                key: makeKey(normalizedSubject, normalizedType),
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

    function getSet(subject, testType) {
        return transactionRequest("readonly", function (store) {
            return store.get(makeKey(subject, testType));
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
        showOfflineNotice: showOfflineNotice,
        maxCachedSets: MAX_CACHED_SETS,
        maxQuestionsPerSet: MAX_QUESTIONS_PER_SET
    };
}());
