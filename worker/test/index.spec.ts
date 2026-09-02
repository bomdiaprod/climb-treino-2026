import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const API_ORIGIN = "https://bomdiaprod.github.io";

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "treino-A-1788343200000",
    session: "A",
    startedAt: "2026-09-02T08:00:00.000Z",
    completedAt: "2026-09-02T08:45:00.000Z",
    durationMinutes: 45,
    logText: "Sessão A — teste",
    state: { warm: [0, 1], "barra-fixa": { d: [0, 1, 2], kg: "" } },
    ...overrides,
  };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return SELF.fetch("https://api.example/v1/workouts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: API_ORIGIN,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("Treino CLIMB 2026 API", () => {
  it("exposes a minimal health check", async () => {
    const response = await SELF.fetch("https://api.example/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      project: "climb-treino-2026",
    });
  });

  it("answers the browser preflight only for the published app", async () => {
    const response = await SELF.fetch("https://api.example/v1/workouts", {
      method: "OPTIONS",
      headers: {
        Origin: API_ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(API_ORIGIN);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
  });

  it("stores a valid workout as pending", async () => {
    const payload = validPayload();
    const response = await post(payload);

    expect(response.status).toBe(201);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(API_ORIGIN);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      id: payload.id,
      duplicate: false,
    });

    const row = await env.DB.prepare(
      "SELECT id, project, session, duration_minutes, log_text, status, payload_json FROM workouts WHERE id = ?",
    ).bind(payload.id).first();
    expect(row).toEqual({
      id: payload.id,
      project: "climb-treino-2026",
      session: payload.session,
      duration_minutes: payload.durationMinutes,
      log_text: payload.logText,
      status: "pending",
      payload_json: JSON.stringify(payload),
    });
  });

  it("treats a retried id as success without duplicating it", async () => {
    const payload = validPayload({
      id: "treino-B-1788343200001",
      session: "B",
    });
    expect((await post(payload)).status).toBe(201);

    const retry = await post(payload);
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toEqual({
      ok: true,
      id: payload.id,
      duplicate: true,
    });

    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM workouts WHERE id = ?",
    ).bind(payload.id).first<number>("count");
    expect(count).toBe(1);
  });

  it.each([
    ["unknown session", { session: "D" }],
    ["invalid timestamp", { completedAt: "hoje" }],
    ["negative duration", { durationMinutes: -1 }],
    ["empty log", { logText: "" }],
    ["non-object state", { state: [] }],
  ])("rejects %s", async (_name, overrides) => {
    const response = await post(validPayload(overrides));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ ok: false });
  });

  it("rejects writes from any other origin", async () => {
    const response = await post(validPayload(), {
      Origin: "https://attacker.example",
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("requires JSON", async () => {
    const response = await post(validPayload(), {
      "Content-Type": "text/plain",
    });

    expect(response.status).toBe(415);
  });

  it("rejects bodies above 16 KiB before parsing them", async () => {
    const response = await post(validPayload({ logText: "x".repeat(17_000) }));

    expect(response.status).toBe(413);
  });

  it("does not expose a public read endpoint", async () => {
    const response = await SELF.fetch("https://api.example/v1/workouts");

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST, OPTIONS");
  });
});
