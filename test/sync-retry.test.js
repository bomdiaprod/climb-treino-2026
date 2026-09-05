const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const AcademiaLog = require("../academia-log.js");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const start = html.indexOf("const WORKOUT_API =");
const end = html.indexOf("/* fila: persiste", start);
assert.ok(start >= 0 && end > start, "the app's sync section must be present");
const syncSource = html.slice(start, end);

const settle = () => new Promise(resolve => setImmediate(resolve));

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

function fakeClock() {
  const timers = new Map();
  let now = 0;
  let nextId = 0;
  return {
    setTimeout(callback, delay = 0) {
      const id = ++nextId;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    async advance(milliseconds) {
      const target = now + milliseconds;
      for (;;) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        const [id, timer] = next;
        timers.delete(id);
        now = timer.at;
        timer.callback();
        await settle();
      }
      now = target;
      await settle();
    },
  };
}

function response(status, body) {
  return { status, json: async () => body };
}

function harness(fetchHandler, { online = true } = {}) {
  const storage = memoryStorage();
  const clock = fakeClock();
  const status = { textContent: "", dataset: {} };
  const navigator = { onLine: online };
  const calls = [];
  const context = vm.createContext({
    AcademiaLog,
    AbortController,
    localStorage: storage,
    navigator,
    document: { getElementById: () => status },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    fetch(url, options) {
      const call = { url, options, payload: JSON.parse(options.body) };
      calls.push(call);
      return fetchHandler(call, calls.length);
    },
  });
  vm.runInContext(syncSource, context, { filename: "index.html:workout-sync" });
  const item = AcademiaLog.createWorkoutPayload({
    session: "A",
    state: { t0: 1_788_343_200_000, t1: 1_788_345_900_000 },
    logText: "Sessão A — Barra fixa 4/4",
  });
  AcademiaLog.enqueueWorkout(storage, item);
  return {
    item, storage, clock, status, navigator, calls,
    sync: () => context.syncWorkouts(),
    pending: () => AcademiaLog.listPending(storage),
    failCompletion: vm.runInContext(`message => {
      completionError = message;
      paintSyncStatus(completionError, "error");
    }`, context),
  };
}

test("a 503 is retried automatically and the confirmed workout is removed", async () => {
  const app = harness(({ payload }, attempt) => Promise.resolve(attempt === 1
    ? response(503, { ok: false })
    : response(201, { ok: true, id: payload.id })));

  await app.sync();
  assert.equal(app.calls.length, 1);
  assert.equal(app.pending().length, 1);
  assert.notEqual(app.status.dataset.state, "saved");

  await app.clock.advance(4999);
  assert.equal(app.calls.length, 1, "do not retry immediately in a tight loop");
  await app.clock.advance(1);
  assert.equal(app.calls.length, 2, "retry without an online event or user interaction");
  assert.deepEqual(app.calls[1].payload, app.calls[0].payload);
  assert.equal(app.pending().length, 0);
  assert.equal(app.status.dataset.state, "saved");
});

test("an acknowledgement for a different ID cannot delete the pending workout", async () => {
  const app = harness(({ payload }, attempt) => Promise.resolve(response(201, {
    ok: true,
    id: attempt === 1 ? "treino-B-1788343200001" : payload.id,
  })));

  await app.sync();
  assert.deepEqual(app.pending(), [app.item]);
  assert.notEqual(app.status.dataset.state, "saved");
  await app.clock.advance(5000);
  assert.equal(app.calls.length, 2);
  assert.equal(app.pending().length, 0);
  assert.equal(app.status.dataset.state, "saved");
});

test("a hanging request is aborted and does not block the next automatic attempt", async () => {
  let aborted = false;
  const app = harness(({ payload, options }, attempt) => {
    if (attempt > 1) return Promise.resolve(response(201, { ok: true, id: payload.id }));
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        aborted = true;
        const error = new Error("request aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    });
  });

  const firstAttempt = app.sync();
  await app.clock.advance(14999);
  assert.equal(aborted, false);
  assert.equal(app.pending().length, 1);
  await app.clock.advance(1);
  await firstAttempt;
  assert.equal(aborted, true);
  assert.notEqual(app.status.dataset.state, "saved");

  await app.clock.advance(5000);
  assert.equal(app.calls.length, 2);
  assert.equal(app.pending().length, 0);
  assert.equal(app.status.dataset.state, "saved");
});

test("offline workouts stay stored without POSTs and resume when connection returns", async () => {
  const app = harness(({ payload }) => Promise.resolve(response(201, {
    ok: true, id: payload.id,
  })), { online: false });

  await app.sync();
  await app.clock.advance(5000);
  assert.equal(app.calls.length, 0);
  assert.deepEqual(app.pending(), [app.item]);
  assert.notEqual(app.status.dataset.state, "saved");

  app.navigator.onLine = true;
  await app.clock.advance(10000);
  assert.equal(app.calls.length, 1);
  assert.equal(app.pending().length, 0);
  assert.equal(app.status.dataset.state, "saved");
});

test("sending alone does not remove a workout or claim it was saved", async () => {
  let acknowledge;
  const app = harness(() => new Promise(resolve => { acknowledge = resolve; }));

  const sending = app.sync();
  await settle();
  assert.equal(app.calls.length, 1);
  assert.deepEqual(app.pending(), [app.item]);
  assert.equal(app.status.dataset.state, "sending");

  acknowledge(response(201, { ok: true, id: app.item.id }));
  await sending;
  assert.equal(app.pending().length, 0);
  assert.equal(app.status.dataset.state, "saved");
});

test("a completion failure remains visible after an empty sync or another successful upload", async () => {
  const app = harness(({ payload }) => Promise.resolve(response(201, {
    ok: true, id: payload.id,
  })));
  await app.sync();
  assert.equal(app.status.dataset.state, "saved");
  assert.equal(app.pending().length, 0);

  const failure = "Não consegui salvar este treino. A fila não avançou.";
  app.failCompletion(failure);
  await app.sync();
  assert.equal(app.calls.length, 1, "an empty outbox requires no upload");
  assert.equal(app.status.textContent, failure);
  assert.equal(app.status.dataset.state, "error");

  const otherWorkout = AcademiaLog.createWorkoutPayload({
    session: "B",
    state: { t0: 1_788_429_600_000, t1: 1_788_432_300_000 },
    logText: "Sessão B — Agachamento 3/3",
  });
  AcademiaLog.enqueueWorkout(app.storage, otherWorkout);
  await app.sync();
  assert.equal(app.calls.length, 2);
  assert.equal(app.calls[1].payload.id, otherWorkout.id);
  assert.equal(app.pending().length, 0, "the unrelated workout still synchronizes");
  assert.equal(app.status.textContent, failure);
  assert.equal(app.status.dataset.state, "error");
});
