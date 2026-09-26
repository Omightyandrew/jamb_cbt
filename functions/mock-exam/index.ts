import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const allowedOrigins = (Deno.env.get("MOCK_ALLOWED_ORIGINS") || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const defaultOrigins = [
  "https://exampilot.com.ng",
  "https://www.exampilot.com.ng"
];

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Mock API configuration is incomplete.");
}

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

type JsonObject = Record<string, unknown>;

class MockApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") || "";
  const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  const permittedOrigins = allowedOrigins.length ? allowedOrigins : defaultOrigins;
  const isAllowed = permittedOrigins.includes(origin) || (!allowedOrigins.length && isLocalOrigin);

  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };

  if (origin && isAllowed) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function jsonResponse(
  request: Request,
  status: number,
  body: JsonObject
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json"
    }
  });
}

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonObject;
}

function hasOwn(value: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function requireUuid(value: unknown, field: string): string {
  if (!isUuid(value)) {
    throw new MockApiError(400, "invalid_request", `${field} must be a UUID.`);
  }
  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new MockApiError(400, "invalid_request", `${field} must be a non-empty string.`);
  }
  return value.trim();
}

function requireAttemptId(input: JsonObject): string {
  return requireUuid(input.attempt_id, "attempt_id");
}

function assertSafeValue(condition: boolean): asserts condition {
  if (!condition) {
    throw new MockApiError(500, "unsafe_backend_payload", "Mock response could not be safely returned.");
  }
}

function safeQuestion(value: unknown): JsonObject {
  const question = asObject(value);
  assertSafeValue(question !== null);
  assertSafeValue(Number.isInteger(question.position) && Number(question.position) > 0);
  assertSafeValue(typeof question.subject === "string");
  assertSafeValue(typeof question.question === "string");
  assertSafeValue(
    Array.isArray(question.options) &&
      question.options.length === 4 &&
      question.options.every((option) => typeof option === "string")
  );
  assertSafeValue(
    question.selected_answer === null ||
      ["A", "B", "C", "D"].includes(String(question.selected_answer))
  );
  assertSafeValue(Number.isInteger(question.answer_revision) && Number(question.answer_revision) >= 0);

  return {
    position: question.position,
    subject: question.subject,
    question: question.question,
    options: question.options,
    selected_answer: question.selected_answer,
    answer_revision: question.answer_revision
  };
}

const resultMetrics = [
  "correct",
  "wrong",
  "unanswered",
  "score",
  "max_score",
  "percentage"
] as const;

function safeSubjectSummary(value: unknown): JsonObject {
  const summary = asObject(value);
  assertSafeValue(summary !== null);

  const safeSummary: JsonObject = {};
  for (const [subject, rawMetrics] of Object.entries(summary)) {
    const metrics = asObject(rawMetrics);
    assertSafeValue(subject.trim() !== "" && metrics !== null);

    const safeMetrics: JsonObject = {};
    for (const metric of resultMetrics) {
      if (!hasOwn(metrics, metric)) continue;
      assertSafeValue(typeof metrics[metric] === "number" && Number.isFinite(metrics[metric]));
      safeMetrics[metric] = metrics[metric];
    }
    safeSummary[subject] = safeMetrics;
  }
  return safeSummary;
}

function safeFinalResult(payload: JsonObject): JsonObject {
  const result = asObject(payload.result);
  assertSafeValue(payload.status === "submitted" && result !== null);

  for (const field of ["score", "max_score", "percentage"]) {
    assertSafeValue(typeof result[field] === "number" && Number.isFinite(result[field]));
  }
  for (const field of ["correct", "wrong", "unanswered"]) {
    assertSafeValue(Number.isInteger(result[field]) && Number(result[field]) >= 0);
  }
  assertSafeValue(typeof result.submitted_at === "string");
  assertSafeValue(result.completion_reason === "manual" || result.completion_reason === "deadline");

  return {
    attempt_id: payload.attempt_id,
    status: "submitted",
    submitted_at: result.submitted_at,
    completion_reason: result.completion_reason,
    score: result.score,
    max_score: result.max_score,
    correct: result.correct,
    wrong: result.wrong,
    unanswered: result.unanswered,
    percentage: result.percentage,
    per_subject_summary: safeSubjectSummary(result.per_subject_summary)
  };
}

function safeAttemptPayload(value: unknown): JsonObject {
  const payload = asObject(value);
  assertSafeValue(payload !== null);
  assertSafeValue(isUuid(payload.attempt_id));
  assertSafeValue(["in_progress", "submitted"].includes(String(payload.status)));
  assertSafeValue(typeof payload.started_at === "string");
  assertSafeValue(typeof payload.expires_at === "string");
  assertSafeValue(payload.submitted_at === null || typeof payload.submitted_at === "string");
  assertSafeValue(Array.isArray(payload.questions));

  const result = payload.result === null
    ? null
    : safeFinalResult({
      attempt_id: payload.attempt_id,
      status: payload.status,
      result: payload.result
    });

  return {
    attempt_id: payload.attempt_id,
    status: payload.status,
    started_at: payload.started_at,
    expires_at: payload.expires_at,
    submitted_at: payload.submitted_at,
    questions: payload.questions.map(safeQuestion),
    result
  };
}

function safeActionPayload(action: string, value: unknown): JsonObject {
  if (action === "result") {
    const payload = asObject(value);
    assertSafeValue(payload !== null);
    return safeFinalResult(payload);
  }

  if (action === "save_answer") {
    const response = asObject(value);
    assertSafeValue(response !== null && typeof response.accepted === "boolean");

    const safeResponse: JsonObject = {
      accepted: response.accepted
    };
    if (typeof response.idempotent_retry === "boolean") {
      safeResponse.idempotent_retry = response.idempotent_retry;
    }
    if (response.reason === "already_finalized" || response.reason === "deadline_passed") {
      safeResponse.reason = response.reason;
    }
    if (Number.isInteger(response.answer_revision)) {
      safeResponse.answer_revision = response.answer_revision;
    }
    if (response.attempt !== undefined) {
      safeResponse.attempt = safeAttemptPayload(response.attempt);
    }
    return safeResponse;
  }

  return safeAttemptPayload(value);
}

function publicRpcError(error: { code?: string }): MockApiError {
  switch (error.code) {
    case "22023":
    case "23514":
      return new MockApiError(422, "invalid_request", "The request is not valid for this Mock operation.");
    case "23505":
    case "40001":
    case "55000":
      return new MockApiError(409, "conflict", "The Mock attempt state has changed. Refresh and retry.");
    case "P0002":
      return new MockApiError(404, "not_found", "Mock attempt was not found.");
    case "42501":
      return new MockApiError(403, "forbidden", "Mock access is not permitted.");
    default:
      return new MockApiError(500, "mock_unavailable", "Mock is temporarily unavailable.");
  }
}

async function getVerifiedUser(request: Request) {
  const authorization = request.headers.get("Authorization") || "";
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  if (!match) return null;

  const { data, error } = await adminClient.auth.getUser(match[1]);
  if (error || !data.user) return null;
  return data.user;
}

async function callRpc<T extends JsonObject>(name: string, args: JsonObject): Promise<T> {
  const { data, error } = await adminClient.rpc(name, args);
  if (error) {
    console.error("Mock RPC failed.", { function: name, code: error.code || "unknown" });
    throw publicRpcError(error);
  }
  return data as T;
}

function parseStartSubjects(value: unknown): string[] {
  if (!Array.isArray(value) || value.length !== 4) {
    throw new MockApiError(400, "invalid_request", "selected_subjects must contain exactly four subjects.");
  }
  if (!value.every((subject) => typeof subject === "string" && subject.trim() !== "")) {
    throw new MockApiError(400, "invalid_request", "selected_subjects entries must be non-empty strings.");
  }
  return value.map((subject) => (subject as string).trim());
}

async function handleAction(userId: string, input: JsonObject): Promise<JsonObject> {
  const action = input.action;
  if (typeof action !== "string" || !["start", "resume", "save_answer", "submit", "result"].includes(action)) {
    throw new MockApiError(400, "invalid_request", "Unsupported Mock action.");
  }

  if (action === "start") {
    const startIdempotencyKey = requireUuid(input.start_idempotency_key, "start_idempotency_key");
    const selectedSubjects = parseStartSubjects(input.selected_subjects);
    const data = await callRpc<JsonObject>("start_mock_attempt", {
      p_user_id: userId,
      p_start_idempotency_key: startIdempotencyKey,
      p_selected_subjects: selectedSubjects
    });
    return safeActionPayload(action, data);
  }

  const attemptId = requireAttemptId(input);

  if (action === "resume") {
    const data = await callRpc<JsonObject>("resume_mock_attempt", {
      p_user_id: userId,
      p_attempt_id: attemptId
    });
    return safeActionPayload(action, data);
  }

  if (action === "save_answer") {
    const position = input.position;
    const expectedRevision = input.expected_revision;
    const requestId = requireUuid(input.request_id, "request_id");
    if (!Number.isInteger(position) || Number(position) <= 0) {
      throw new MockApiError(400, "invalid_request", "position must be a positive integer.");
    }
    if (!Number.isInteger(expectedRevision) || Number(expectedRevision) < 0) {
      throw new MockApiError(400, "invalid_request", "expected_revision must be a non-negative integer.");
    }
    if (typeof input.choice !== "string" || !["A", "B", "C", "D"].includes(input.choice)) {
      throw new MockApiError(400, "invalid_request", "choice must be A, B, C, or D.");
    }

    const data = await callRpc<JsonObject>("save_mock_answer", {
      p_user_id: userId,
      p_attempt_id: attemptId,
      p_position: position,
      p_choice: input.choice,
      p_request_id: requestId,
      p_expected_revision: expectedRevision
    });
    return safeActionPayload(action, data);
  }

  if (action === "submit") {
    const data = await callRpc<JsonObject>("submit_mock_attempt", {
      p_user_id: userId,
      p_attempt_id: attemptId
    });
    return safeActionPayload(action, data);
  }

  const data = await callRpc<JsonObject>("resume_mock_attempt", {
    p_user_id: userId,
    p_attempt_id: attemptId
  });
  const payload = asObject(data);
  if (!payload || payload.status !== "submitted") {
    throw new MockApiError(409, "not_submitted", "The Mock result is not available until submission.");
  }
  return safeActionPayload("result", data);
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin") || "";
  const headers = corsHeaders(request);
  if (origin && !headers["Access-Control-Allow-Origin"]) {
    return jsonResponse(request, 403, { error: "Origin is not allowed.", code: "origin_not_allowed" });
  }

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers });
  }
  if (request.method !== "POST") {
    return jsonResponse(request, 405, { error: "POST is required.", code: "method_not_allowed" });
  }

  const user = await getVerifiedUser(request);
  if (!user) {
    return jsonResponse(request, 401, { error: "Authentication is required.", code: "unauthenticated" });
  }

  let input: JsonObject;
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).length > 16000) {
      return jsonResponse(request, 413, { error: "Request is too large.", code: "request_too_large" });
    }
    const parsed: unknown = JSON.parse(body);
    const object = asObject(parsed);
    if (!object) {
      return jsonResponse(request, 400, { error: "A JSON object is required.", code: "invalid_request" });
    }
    input = object;
  } catch (_) {
    return jsonResponse(request, 400, { error: "A valid JSON request is required.", code: "invalid_request" });
  }

  if (hasOwn(input, "user_id") || hasOwn(input, "p_user_id")) {
    return jsonResponse(request, 400, { error: "User identity must not be supplied in the request.", code: "invalid_request" });
  }

  try {
    const payload = await handleAction(user.id, input);
    return jsonResponse(request, 200, { data: payload, error: null });
  } catch (error) {
    if (error instanceof MockApiError) {
      return jsonResponse(request, error.status, {
        data: null,
        error: { code: error.code, message: error.message }
      });
    }

    console.error("Mock API request failed.");
    return jsonResponse(request, 500, {
      data: null,
      error: { code: "mock_unavailable", message: "Mock is temporarily unavailable." }
    });
  }
});