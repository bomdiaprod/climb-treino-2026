import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const validRow = [
  "treino-A-1788343200000",
  "climb-treino-2026",
  "A",
  "2026-09-02T08:00:00.000Z",
  "2026-09-02T08:45:00.000Z",
  45,
  "Sessão A — teste",
  '{"source":"test"}',
];

async function insert(values = validRow): Promise<D1Result> {
  return env.DB.prepare(`
    INSERT INTO workouts
      (id, project, session, started_at, completed_at, duration_minutes, log_text, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(...values).run();
}

describe("workouts schema", () => {
  it("stores one valid pending workout and rejects a duplicate id", async () => {
    await insert();

    const row = await env.DB.prepare(
      "SELECT id, project, session, status FROM workouts WHERE id = ?",
    ).bind(validRow[0]).first();
    expect(row).toEqual({
      id: "treino-A-1788343200000",
      project: "climb-treino-2026",
      session: "A",
      status: "pending",
    });
    await expect(insert()).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it("rejects sessions outside A, B and C", async () => {
    const invalid = [...validRow];
    invalid[0] = "treino-D-1788343200001";
    invalid[2] = "D";
    await expect(insert(invalid)).rejects.toThrow(/CHECK constraint failed/);
  });

  it("rejects an unknown processing status", async () => {
    await expect(env.DB.prepare(`
      INSERT INTO workouts
        (id, project, session, started_at, completed_at, duration_minutes, log_text, payload_json, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(...validRow, "unknown").run()).rejects.toThrow(/CHECK constraint failed/);
  });
});
