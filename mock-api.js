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
    const message = typeof backendError?.message === "string"
      ? backendError.message
      : status === 401
        ? "Authentication is required."
        : status === 403
          ? "Mock access is not permitted."
          : status === 409
            ? "The Mock attempt state has changed."
            : "Mock is temporarily unavailable.";

    return {
      status,
      code: typeof backendError?.code === "string" ? backendError.code : "request_failed",
      message
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