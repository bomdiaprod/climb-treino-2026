(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AcademiaLog = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const OUTBOX_KEY = "climb-treino-2026::outbox";
  const OUTBOX_PREFIX = `${OUTBOX_KEY}::`;

  function storageKey(id) {
    return `${OUTBOX_PREFIX}${id}`;
  }

  function migrateLegacyOutbox(storage) {
    const legacy = storage.getItem(OUTBOX_KEY);
    if (!legacy) return;

    let parsed;
    try { parsed = JSON.parse(legacy); } catch (error) { return; }
    if (!Array.isArray(parsed) || parsed.some(item =>
      !item || typeof item !== "object" || typeof item.id !== "string"
    )) return;

    for (const payload of parsed) {
      const key = storageKey(payload.id);
      if (storage.getItem(key) !== null) continue;
      const serialized = JSON.stringify(payload);
      storage.setItem(key, serialized);
      if (storage.getItem(key) !== serialized) {
        throw new Error("Legacy workout did not persist in durable storage");
      }
    }
    storage.removeItem(OUTBOX_KEY);
    if (storage.getItem(OUTBOX_KEY) !== null) {
      throw new Error("Legacy outbox cleanup did not persist");
    }
  }

  function listPending(storage) {
    migrateLegacyOutbox(storage);
    const queued = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key || !key.startsWith(OUTBOX_PREFIX)) continue;
      try {
        const parsed = JSON.parse(storage.getItem(key) || "null");
        if (parsed && typeof parsed === "object" && typeof parsed.id === "string") {
          queued.push(parsed);
        }
      } catch (error) {
        // A corrupt record stays untouched so manual recovery remains possible.
      }
    }
    return queued.sort((a, b) =>
      String(a.completedAt).localeCompare(String(b.completedAt)) ||
      String(a.id).localeCompare(String(b.id))
    );
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
    const key = storageKey(payload.id);
    const serialized = JSON.stringify(payload);
    const existing = storage.getItem(key);
    if (existing === serialized) return pendingCount(storage);

    storage.setItem(key, serialized);
    if (storage.getItem(key) !== serialized) {
      throw new Error("Workout did not persist in durable storage");
    }
    return pendingCount(storage);
  }

  function pendingCount(storage) {
    return listPending(storage).length;
  }

  function isQueuedSession(current, queued) {
    return current === queued;
  }

  function classifyHttpResult(status, body) {
    if (status >= 200 && status < 300 && body && body.ok === true) return body;
    return {
      ok: false,
      retryable: status === 408 || status === 429 || status >= 500,
      status,
    };
  }

  async function flushOutbox(storage, send) {
    const queued = listPending(storage);
    let sent = 0;
    let rejected = 0;

    for (const payload of queued) {
      let confirmed = false;
      try {
        const result = await send(payload);
        confirmed = result && result.ok === true;
        if (!confirmed && result && result.retryable === false) rejected += 1;
      } catch (error) {
        confirmed = false;
      }

      if (confirmed) {
        const key = storageKey(payload.id);
        try {
          storage.removeItem(key);
          if (storage.getItem(key) === null) sent += 1;
        } catch (error) {
          // The confirmed item remains for an idempotent retry on the next flush.
        }
      }
    }

    return { sent, pending: pendingCount(storage), rejected };
  }

  return {
    OUTBOX_KEY,
    classifyHttpResult,
    createWorkoutPayload,
    enqueueWorkout,
    flushOutbox,
    isQueuedSession,
    listPending,
    pendingCount,
  };
});
