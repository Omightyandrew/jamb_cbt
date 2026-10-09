(function () {
  "use strict";

  async function normalizedError(error) {
    const context = error && error.context;
    let status = Number.isInteger(context?.status) ? context.status : null;
    let payload = null;

    if (context && typeof context.clone === "function") {
      try {
        payload = await context.clone().json();
      } catch (_) {
        payload = null;
      }
    }

    const backendError = payload && typeof payload.error === "object"
      ? payload.error
      : null;
    const rawMessage = typeof backendError?.message === "string"
      ? backendError.message
      : typeof payload?.message === "string"
        ? payload.message
        : (typeof payload?.error === "string" ? payload.error : null);
    const backendCode = typeof backendError?.code === "string"
      ? backendError.code
      : (typeof payload?.code === "string" ? payload.code : null);

    let message;
    if (status === 401) {
      message = rawMessage || "Authentication is required.";
    } else if (status === 403) {
      const isTechnical = !rawMessage || /Mock access (is )?not permitted/i.test(rawMessage);
      message = isTechnical ? "An active Premium subscription is required." : rawMessage;
    } else if (status === 409) {
      message = rawMessage || "The Mock attempt state has changed.";
    } else if (status === 422) {
      const isTechnical = !rawMessage || /error:|violat|syntax|relation|null value|pl\/pgsql|constraint|internal/i.test(rawMessage);
      message = (!isTechnical && rawMessage !== "The request is not valid for this Mock operation.")
        ? rawMessage
        : "The selected subject combination is not permitted for JAMB.";
    } else {
      message = (rawMessage && !/error:|violat|syntax|relation|null value|pl\/pgsql|constraint/i.test(rawMessage))
        ? rawMessage
        : "Mock is temporarily unavailable.";
    }

    return {
      status,
      code: backendCode || (status === 422 ? "invalid_combination" : status === 403 ? "forbidden" : "request_failed"),
      message,
      rawMessage: rawMessage || undefined
    };
  }

  async function invoke(action, payload) {
    const client = window.supabaseClient;
    if (!client || !client.functions || typeof client.functions.invoke !== "function") {
      return {
        data: null,
        error: {
          status: null,
          code: "client_unavailable",
          message: "Mock is unavailable. Please try again online."
        }
      };
    }

    try {
      const { data, error } = await client.functions.invoke("mock-exam", {
        body: { action, ...payload }
      });
      if (error) {
        return { data: null, error: await normalizedError(error) };
      }
      return { data, error: null };
    } catch (_) {
      return {
        data: null,
        error: {
          status: null,
          code: "network_error",
          message: "Mock is unavailable. Check your connection and try again."
        }
      };
    }
  }

  window.MockExamApi = Object.freeze({
    startMock: function ({ startIdempotencyKey, selectedSubjects } = {}) {
      return invoke("start", {
        start_idempotency_key: startIdempotencyKey,
        selected_subjects: selectedSubjects
      });
    },
    resumeMock: function (attemptId) {
      return invoke("resume", { attempt_id: attemptId });
    },
    saveMockAnswer: function ({ attemptId, position, choice, requestId, expectedRevision } = {}) {
      return invoke("save_answer", {
        attempt_id: attemptId,
        position,
        choice,
        request_id: requestId,
        expected_revision: expectedRevision
      });
    },
    submitMock: function (attemptId) {
      return invoke("submit", { attempt_id: attemptId });
    },
    getMockResult: function (attemptId) {
      return invoke("result", { attempt_id: attemptId });
    }
  });
})();