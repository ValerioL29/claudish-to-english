// Offline lifecycle check: node tests/panel.mjs
import assert from "node:assert/strict";
import { watchAnswers, panelName } from "../opencode/panel.mjs";

const handlers = new Map();
const published = [];
const opened = [];
let route = { type: "session", sessionID: "parent" };
let info = { location: { directory: "/scratch" } };
let messages = [];
let calls = 0;
let worker = async () => "Rewrite.";
let workerSignal;
const context = {
  location: { directory: "/other-project" },
  data: {
    on: (name, callback) => {
      handlers.set(name, callback);
      return () => handlers.delete(name);
    },
    session: {
      get: () => info,
      message: { sync: async () => {}, list: () => messages },
    },
  },
  ui: {
    router: { current: () => route },
    panel: { open: (name) => opened.push(name) },
  },
};
const stop = watchAnswers(context, (id, text) => published.push({ id, text }), async (text, cwd, signal) => {
  calls++;
  workerSignal = signal;
  assert.equal(cwd, "/scratch");
  assert.equal(text, "Original.\n\nSecond part.");
  return worker();
});
const event = (type, sessionID = "parent") => handlers.get(`session.execution.${type}`)?.({ data: { sessionID } });
const answer = {
  type: "assistant", time: { completed: 1 },
  content: [{ type: "reasoning", text: "Private." }, { type: "text", text: "Original." },
    { type: "tool", text: "Tool output." }, { type: "text", text: "Second part." }],
};
messages = [answer];
const original = JSON.stringify(messages);
await event("succeeded");
assert.deepEqual(published.at(-1), { id: "parent", text: "Rewrite." });
assert.deepEqual(opened, [panelName]);
assert.equal(JSON.stringify(messages), original);
await event("succeeded");
assert.equal(calls, 1); // A repeated completion cannot spawn a second worker.

for (const invalid of [[], [{ type: "user" }], [{ ...answer, error: {} }],
  [{ ...answer, time: {} }], [{ ...answer, content: [] }],
  [{ ...answer, content: [{ type: "text", text: "<!-- claudish:original -->\nAlready rewritten." }] }]]) {
  event("started");
  messages = invalid;
  await event("succeeded");
}
messages = [answer];
event("started");
context.location.directory = "/scratch";
await event("succeeded", "background");
info = { parentID: "other" };
await event("succeeded");
info = undefined;
await event("succeeded");
info = {};
const get = context.data.session.get;
context.data.session.get = () => { throw new Error("Lookup failed"); };
await event("succeeded");
context.data.session.get = get;
route = { type: "home" };
await event("succeeded");
route = { type: "session", sessionID: "parent" };
assert.equal(calls, 1);

let release;
worker = () => new Promise((resolve) => { release = resolve; });
const pending = event("succeeded");
await Promise.resolve();
assert.equal(workerSignal.aborted, false);
event("started");
assert.equal(workerSignal.aborted, true);
release("Stale rewrite.");
await pending;
assert.equal(published.at(-1).text, "");
assert.equal(opened.length, 1);

worker = async () => { throw new Error("CLI failed"); };
await event("succeeded"); // Must fail open.
event("started");
worker = async () => "";
await event("succeeded");
assert.equal(opened.length, 1);

event("started");
worker = () => new Promise((resolve) => { release = resolve; });
const background = event("succeeded");
await Promise.resolve();
route = { type: "session", sessionID: "other" };
release("Ready in the previous session.");
await background;
assert.equal(opened.length, 1); // Never take focus from a different session.
assert.deepEqual(published.at(-1), { id: "parent", text: "Ready in the previous session." });
route = { type: "session", sessionID: "parent" };

event("started");
worker = () => new Promise((resolve) => { release = resolve; });
const unloading = event("succeeded");
await Promise.resolve();
stop();
assert.equal(workerSignal.aborted, true);
const count = published.length;
release("Too late.");
await unloading;
assert.equal(published.length, count);
assert.equal(handlers.size, 0);
console.log("PASS: OpenCode 2 panel filtering, duplicate events, stale results, failures, disposal, and transcript preservation");
