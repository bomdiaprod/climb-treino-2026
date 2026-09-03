const test = require("node:test");
const assert = require("node:assert/strict");
const {
  OUTBOX_KEY,
  classifyHttpResult,
  createWorkoutPayload,
  enqueueWorkout,
  flushOutbox,
  isQueuedSession,
  listPending,
  pendingCount,
} = require("../academia-log.js");

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, String(value)); },
    keys() { return [...values.keys()]; },
  };
}

function payload(id, session = "A") {
  return {
    id,
    session,
    startedAt: "2026-09-02T08:00:00.000Z",
    completedAt: "2026-09-02T08:45:00.000Z",
    durationMinutes: 45,
    logText: `Sessão ${session}`,
    state: { warm: [0, 1] },
  };
}

test("createWorkoutPayload derives a stable ID and timestamps from the session state", () => {
  const state = {
    t0: 1_788_343_200_000,
    t1: 1_788_345_900_000,
    warm: [0, 1],
  };

  assert.deepEqual(createWorkoutPayload({ session: "A", state, logText: "Sessão A" }), {
    id: "treino-A-1788343200000",
    session: "A",
    startedAt: "2026-09-02T10:00:00.000Z",
    completedAt: "2026-09-02T10:45:00.000Z",
    durationMinutes: 45,
    logText: "Sessão A",
    state,
  });
});

test("createWorkoutPayload records zero minutes when the timer was never started", () => {
  const created = createWorkoutPayload({
    session: "C",
    state: {},
    logText: "Sessão C",
    now: 1_788_343_200_000,
  });

  assert.equal(created.id, "treino-C-1788343200000");
  assert.equal(created.startedAt, created.completedAt);
  assert.equal(created.durationMinutes, 0);
});

test("enqueueWorkout persists once and de-duplicates by stable ID", () => {
  const storage = memoryStorage();
  const item = payload("treino-A-1788343200000");

  assert.equal(enqueueWorkout(storage, item), 1);
  assert.equal(enqueueWorkout(storage, item), 1);
  assert.deepEqual(listPending(storage), [item]);
  assert.deepEqual(storage.keys(), [`${OUTBOX_KEY}::${item.id}`]);
});

test("enqueueWorkout replaces corrupt outbox JSON with a valid queue", () => {
  const item = payload("treino-A-1788343200001");
  const key = `${OUTBOX_KEY}::${item.id}`;
  const storage = memoryStorage({ [key]: "{broken" });

  assert.equal(enqueueWorkout(storage, item), 1);
  assert.deepEqual(JSON.parse(storage.getItem(key)), item);
});

test("enqueueWorkout surfaces a durable storage failure", () => {
  const storage = memoryStorage();
  storage.setItem = () => { throw new Error("quota exceeded"); };

  assert.throws(
    () => enqueueWorkout(storage, payload("treino-A-1788343200010")),
    /quota exceeded/,
  );
});

test("enqueueWorkout verifies that the item really persisted", () => {
  const storage = memoryStorage();
  storage.setItem = () => {};

  assert.throws(
    () => enqueueWorkout(storage, payload("treino-A-1788343200011")),
    /persist/i,
  );
});

test("separate per-workout keys preserve writes from two tabs", () => {
  const storage = memoryStorage();
  const first = payload("treino-A-1788343200012");
  const second = payload("treino-B-1788343200013", "B");

  enqueueWorkout(storage, first);
  enqueueWorkout(storage, second);

  assert.deepEqual(listPending(storage), [first, second]);
  assert.deepEqual(storage.keys().sort(), [
    `${OUTBOX_KEY}::${first.id}`,
    `${OUTBOX_KEY}::${second.id}`,
  ]);
});

test("listPending migrates the earlier single-array outbox without losing items", () => {
  const first = payload("treino-A-1788343200015");
  const second = payload("treino-B-1788343200016", "B");
  const storage = memoryStorage({ [OUTBOX_KEY]: JSON.stringify([first, second]) });

  assert.deepEqual(listPending(storage), [first, second]);
  assert.equal(storage.getItem(OUTBOX_KEY), null);
  assert.equal(pendingCount(storage), 2);
});

test("flushOutbox removes a confirmed item", async () => {
  const storage = memoryStorage();
  const item = payload("treino-A-1788343200002");
  enqueueWorkout(storage, item);

  const result = await flushOutbox(storage, async () => ({ ok: true }));

  assert.deepEqual(result, { sent: 1, pending: 0, rejected: 0 });
  assert.equal(pendingCount(storage), 0);
});

test("flushOutbox retains items after rejection or a negative response", async () => {
  const storage = memoryStorage();
  enqueueWorkout(storage, payload("treino-A-1788343200003"));
  enqueueWorkout(storage, payload("treino-B-1788343200004", "B"));
  let calls = 0;

  const result = await flushOutbox(storage, async () => {
    calls += 1;
    if (calls === 1) throw new Error("offline");
    return { ok: false };
  });

  assert.deepEqual(result, { sent: 0, pending: 2, rejected: 0 });
  assert.equal(pendingCount(storage), 2);
});

test("flushOutbox sends in insertion order and preserves only a partial failure", async () => {
  const storage = memoryStorage();
  const ids = [
    "treino-A-1788343200005",
    "treino-B-1788343200006",
    "treino-C-1788343200007",
  ];
  enqueueWorkout(storage, payload(ids[0]));
  enqueueWorkout(storage, payload(ids[1], "B"));
  enqueueWorkout(storage, payload(ids[2], "C"));
  const seen = [];

  const result = await flushOutbox(storage, async (item) => {
    seen.push(item.id);
    return { ok: item.id !== ids[1] };
  });

  assert.deepEqual(seen, ids);
  assert.deepEqual(result, { sent: 2, pending: 1, rejected: 0 });
  assert.deepEqual(listPending(storage).map((item) => item.id), [ids[1]]);
});

test("flushOutbox never removes a workout enqueued while a send is in flight", async () => {
  const storage = memoryStorage();
  const first = payload("treino-A-1788343200008");
  const later = payload("treino-B-1788343200009", "B");
  enqueueWorkout(storage, first);

  const result = await flushOutbox(storage, async () => {
    enqueueWorkout(storage, later);
    return { ok: true };
  });

  assert.deepEqual(result, { sent: 1, pending: 1, rejected: 0 });
  assert.deepEqual(listPending(storage), [later]);
});

test("flushOutbox reports a permanent rejection and keeps it recoverable", async () => {
  const storage = memoryStorage();
  const item = payload("treino-C-1788343200014", "C");
  enqueueWorkout(storage, item);

  const result = await flushOutbox(storage, async () => ({
    ok: false,
    retryable: false,
  }));

  assert.deepEqual(result, { sent: 0, pending: 1, rejected: 1 });
  assert.deepEqual(listPending(storage), [item]);
});

test("only the session at the head of the queue is a workout completion", () => {
  assert.equal(isQueuedSession("B", "B"), true);
  assert.equal(isQueuedSession("C", "B"), false);
});

test("HTTP results distinguish accepted, retryable and permanent responses", () => {
  assert.deepEqual(classifyHttpResult(201, { ok: true, id: "x" }), { ok: true, id: "x" });
  assert.deepEqual(classifyHttpResult(422, { ok: false }), {
    ok: false,
    retryable: false,
    status: 422,
  });
  assert.deepEqual(classifyHttpResult(429, null), {
    ok: false,
    retryable: true,
    status: 429,
  });
  assert.deepEqual(classifyHttpResult(503, null), {
    ok: false,
    retryable: true,
    status: 503,
  });
});
