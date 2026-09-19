import { automaticRewrite } from "./claudish-to-english.mjs";

export const panelName = "claudish-to-english.rewrite";

// Only observe successful turns in the visible root session. No prompt,
// synthetic message, or transcript mutation is needed for a local UI panel.
export function watchAnswers(context, publish, rewrite = automaticRewrite) {
  const requests = new Map();
  let disposed = false;
  const visible = (id) => {
    const route = context.ui.router.current();
    return route.type === "session" && route.sessionID === id;
  };
  const started = context.data.on("session.execution.started", ({ data }) => {
    requests.get(data.sessionID)?.abort();
    requests.delete(data.sessionID); // Invalidate a previous turn's pending result.
    publish(data.sessionID, "");
  });
  const completed = context.data.on("session.execution.succeeded", async ({ data }) => {
    const id = data.sessionID;
    try {
      if (disposed || process.env.CLAUDISH_INTERNAL === "1" || !visible(id)) return;
      const info = context.data.session.get(id);
      if (!info || info.parentID) return;
      // Mark before awaiting so replayed events cannot start duplicate workers.
      if (requests.has(id)) return;
      const request = new AbortController();
      requests.set(id, request);
      await context.data.session.message.sync(id);
      if (disposed || requests.get(id) !== request) return;
      const messages = context.data.session.message.list(id) ?? [];
      const last = messages.findLast((message) => message.type === "assistant" || message.type === "user");
      if (last?.type !== "assistant" || last.error || !last.time?.completed) return;
      const text = last.content.filter((part) => part.type === "text").map((part) => part.text).join("\n\n");
      if (!text.trim() || text.startsWith("<!-- claudish:original -->")) return;
      const result = await rewrite(text, info.location?.directory ?? context.location?.directory, request.signal);
      if (disposed || requests.get(id) !== request) return;
      publish(id, result.trim());
      if (result.trim() && visible(id)) context.ui.panel.open(panelName);
    } catch { /* A lookup, CLI, or UI failure leaves the original answer intact. */ }
  });
  return () => {
    disposed = true;
    started();
    completed();
    for (const request of requests.values()) request.abort();
    requests.clear();
  };
}
