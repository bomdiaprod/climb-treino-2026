const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

function completionHandler() {
  const start = html.indexOf('document.getElementById("adv").addEventListener');
  const end = html.indexOf("/* ---- log ---- */", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return html.slice(start, end);
}

test("the old direct Obsidian write path is absent", () => {
  assert.equal(html.includes("obsidian://"), false);
  assert.equal(html.includes("buildObsidianAppendUri"), false);
});

test("view-only navigation returns before ending or recording a session", () => {
  const handler = completionHandler();
  const guard = handler.indexOf("AcademiaLog.isQueuedSession");
  const endSession = handler.indexOf("endSess()");

  assert.ok(guard >= 0);
  assert.ok(guard < endSession);
  assert.match(handler.slice(guard, endSession), /render\(\);\s+return;/);
});

test("durable enqueue succeeds before the queue advances", () => {
  const handler = completionHandler();
  const enqueue = handler.indexOf("AcademiaLog.enqueueWorkout(localStorage, payload)");
  const failureReturn = handler.indexOf("A fila não avançou", enqueue);
  const advance = handler.indexOf("qi = (qi + 1)", enqueue);

  assert.ok(enqueue >= 0);
  assert.ok(failureReturn > enqueue);
  assert.ok(advance > failureReturn);
  assert.match(handler.slice(failureReturn, advance), /return;/);
});

test("the app exposes recovery for queued records and classifies HTTP failures", () => {
  assert.match(html, /id="copy-pending"/);
  assert.match(html, /AcademiaLog\.classifyHttpResult\(response\.status, body\)/);
  assert.match(html, /AcademiaLog\.listPending\(localStorage\)/);
});
