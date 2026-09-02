(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AcademiaLog = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function workoutId({ session, startedAt }) {
    return `treino-${session}-${startedAt}`;
  }

  function buildInboxEntry({ id, completedAt, log }) {
    return [
      "",
      `### ${completedAt} · ${id}`,
      "",
      "- Estado: pendente",
      "- Origem: app Academia CLIMB",
      "",
      "```text",
      log,
      "```",
      "",
    ].join("\n");
  }

  function buildObsidianAppendUri({ vault, file, content, returnUrl }) {
    const params = new URLSearchParams({ vault, file, content });
    params.set("append", "");
    params.set("silent", "");
    if (returnUrl) params.set("x-success", returnUrl);
    return `obsidian://new?${params.toString()}`;
  }

  return { workoutId, buildInboxEntry, buildObsidianAppendUri };
});
