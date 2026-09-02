(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AcademiaLog = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const OUTBOX_KEY = "climb-treino-2026::outbox";

  function read(storage) {
    try {
      const value = storage.getItem(OUTBOX_KEY);
      const parsed = JSON.parse(value || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function write(storage, outbox) {
    storage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
  }

  function createWorkoutPayload({ session, state, logText, now = Date.now() }) {
    const snapshot = state && typeof state === "object"
      ? JSON.parse(JSON.stringify(state))
      : {};
    const fallback = Number.isFinite(now) ? now : Date.now();
    const completedMs = Number.isFinite(snapshot.t1) ? snapshot.t1 : fallback;
    const startedMs = Number.isFinite(snapshot.t0) ? snapshot.t0 : completedMs;
    const safeCompletedMs = Math.max(startedMs, completedMs);

    return {
      id: `treino-${session}-${startedMs}`,
      session,
      startedAt: new Date(startedMs).toISOString(),
      completedAt: new Date(safeCompletedMs).toISOString(),
      durationMinutes: Math.max(0, Math.round((safeCompletedMs - startedMs) / 60_000)),
      logText,
      state: snapshot,
    };
  }

  function enqueueWorkout(storage, payload) {
    const outbox = read(storage);
    if (!outbox.some((item) => item && item.id === payload.id)) {
      outbox.push(payload);
      write(storage, outbox);
    }
    return outbox.length;
  }

  function pendingCount(storage) {
    return read(storage).length;
  }

  async function flushOutbox(storage, send) {
    const queued = read(storage);
    let sent = 0;

    for (const payload of queued) {
      let confirmed = false;
      try {
        const result = await send(payload);
        confirmed = result && result.ok === true;
      } catch (error) {
        confirmed = false;
      }

      if (confirmed) {
        const current = read(storage);
        write(storage, current.filter((item) => item && item.id !== payload.id));
        sent += 1;
      }
    }

    return { sent, pending: pendingCount(storage) };
  }

  return {
    OUTBOX_KEY,
    createWorkoutPayload,
    enqueueWorkout,
    flushOutbox,
    pendingCount,
  };
});
