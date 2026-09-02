const PROJECT = "climb-treino-2026";
const APP_ORIGIN = "https://bomdiaprod.github.io";
const MAX_BODY_BYTES = 16 * 1024;
const ALLOWED_METHODS = "POST, OPTIONS";

type Session = "A" | "B" | "C";

interface WorkoutPayload {
  id: string;
  session: Session;
  startedAt: string;
  completedAt: string;
  durationMinutes: number;
  logText: string;
  state: Record<string, unknown>;
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": APP_ORIGIN,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(
  value: unknown,
  status: number,
  options: { cors?: boolean; headers?: HeadersInit } = {},
): Response {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  if (options.cors) {
    for (const [name, headerValue] of Object.entries(corsHeaders())) {
      headers.set(name, headerValue);
    }
  }
  return new Response(JSON.stringify(value), { status, headers });
}

function error(message: string, status: number, cors = false): Response {
  return json({ ok: false, error: message }, status, { cors });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function validateWorkout(value: unknown): WorkoutPayload | null {
  if (!isRecord(value)) return null;

  const session = value.session;
  if (session !== "A" && session !== "B" && session !== "C") return null;
  if (
    typeof value.id !== "string" ||
    !new RegExp(`^treino-${session}-\\d{10,}$`).test(value.id)
  ) return null;
  if (!isIsoTimestamp(value.startedAt) || !isIsoTimestamp(value.completedAt)) return null;
  if (Date.parse(value.startedAt) > Date.parse(value.completedAt)) return null;
  if (
    typeof value.durationMinutes !== "number" ||
    !Number.isInteger(value.durationMinutes) ||
    value.durationMinutes < 0 ||
    value.durationMinutes > 1_440
  ) return null;
  if (
    typeof value.logText !== "string" ||
    value.logText.trim().length === 0 ||
    value.logText.length > 12_000
  ) return null;
  if (!isRecord(value.state)) return null;

  return {
    id: value.id,
    session,
    startedAt: value.startedAt,
    completedAt: value.completedAt,
    durationMinutes: value.durationMinutes,
    logText: value.logText,
    state: value.state,
  };
}

async function createWorkout(request: Request, env: Env): Promise<Response> {
  if (request.headers.get("Origin") !== APP_ORIGIN) {
    return error("origin_not_allowed", 403);
  }

  const contentType = request.headers.get("Content-Type")?.split(";", 1)[0].trim();
  if (contentType !== "application/json") {
    return error("json_required", 415, true);
  }

  const rawBody = await request.arrayBuffer();
  if (rawBody.byteLength > MAX_BODY_BYTES) {
    return error("body_too_large", 413, true);
  }

  let submitted: unknown;
  try {
    submitted = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return error("invalid_json", 400, true);
  }

  const workout = validateWorkout(submitted);
  if (!workout) {
    return error("invalid_workout", 422, true);
  }

  try {
    const result = await env.DB.prepare(`
      INSERT INTO workouts
        (id, project, session, started_at, completed_at, duration_minutes, log_text, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).bind(
      workout.id,
      PROJECT,
      workout.session,
      workout.startedAt,
      workout.completedAt,
      workout.durationMinutes,
      workout.logText,
      JSON.stringify(submitted),
    ).run();

    const duplicate = (result.meta.changes ?? 0) === 0;
    console.log(JSON.stringify({
      event: "workout_ingested",
      id: workout.id,
      session: workout.session,
      duplicate,
    }));

    return json(
      { ok: true, id: workout.id, duplicate },
      duplicate ? 200 : 201,
      { cors: true },
    );
  } catch (cause) {
    console.error(JSON.stringify({
      event: "workout_ingest_failed",
      id: workout.id,
      session: workout.session,
      error: cause instanceof Error ? cause.name : "UnknownError",
    }));
    return error("storage_failed", 500, true);
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/health" && request.method === "GET") {
      return json({ ok: true, project: PROJECT }, 200);
    }

    if (pathname !== "/v1/workouts") {
      return error("not_found", 404);
    }

    if (request.method === "OPTIONS") {
      if (request.headers.get("Origin") !== APP_ORIGIN) {
        return error("origin_not_allowed", 403);
      }
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method !== "POST") {
      return json(
        { ok: false, error: "method_not_allowed" },
        405,
        { headers: { Allow: ALLOWED_METHODS } },
      );
    }

    return createWorkout(request, env);
  },
} satisfies ExportedHandler<Env>;
