// Offline integration check: node tests/check.mjs
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync, mkdirSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import plugin from "../opencode/claudish-to-english-v1.mjs";
import pluginV2 from "../opencode/claudish-to-english.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "agentish-check-"));
try {
  let sessionInfo = {};
  const hooks = await plugin({ directory: scratch, client: {
    session: { get: async () => ({ data: sessionInfo }) },
  } });
  const config = { command: { existing: { template: "Keep me" } } };
  await hooks.config(config);
  const command = config.command["agentish-rewriter"];
  assert.equal(command.subtask, false); // Parent must capture “last answer”.
  assert.ok(command.template.endsWith("User request: $ARGUMENTS"));
  assert.ok(!command.template.includes("description: Rewrite a previous"));
  assert.equal(config.command.existing.template, "Keep me");
  config.command["agentish-rewriter"] = { template: "User override" };
  await hooks.config(config);
  assert.equal(config.command["agentish-rewriter"].template, "User override");
  let registered, forwarded;
  const context = {
    command: {
      list: async () => ({ data: [] }),
      transform: async (callback) => callback({ add: (item) => { registered = item; } }),
    },
    session: { prompt: async (input) => { forwarded = input; } },
  };
  await pluginV2.setup(context);
  assert.equal(registered.name, "agentish-rewriter");
  await registered.execute({ prompt: { text: 'Rewrite last answer; keep "$&" literal.', files: [] }, sessionID: "parent", delivery: "queued" });
  assert.equal(forwarded.sessionID, "parent");
  assert.equal(forwarded.delivery, "queued");
  assert.ok(forwarded.text.endsWith('User request: Rewrite last answer; keep "$&" literal.'));
  const existing = registered;
  context.command.list = async () => ({ data: [{ name: "agentish-rewriter" }] });
  await pluginV2.setup(context);
  assert.equal(registered, existing);

  const marketplace = JSON.parse(readFileSync(join(root, ".agents/plugins/marketplace.json")));
  const packageRoot = resolve(root, marketplace.plugins[0].source.path);
  const manifest = JSON.parse(readFileSync(join(packageRoot, ".codex-plugin/plugin.json")));
  assert.equal(manifest.name, marketplace.plugins[0].name);
  assert.equal(manifest.version, JSON.parse(readFileSync(join(root, ".claude-plugin/plugin.json"))).version);
  const skillRoot = join(packageRoot, "skills/agentish-rewriter");
  const runner = join(skillRoot, "scripts/rewrite.sh");
  const bin = join(scratch, "bin");
  mkdirSync(bin);
  const mock = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const input = fs.readFileSync(0, "utf8");
fs.writeFileSync(process.env.MOCK_CAPTURE, JSON.stringify({ args, input, cwd: process.cwd(), internal: process.env.CLAUDISH_INTERNAL }));
if (process.env.MOCK_MODE === "fail") { console.error("unsupported model"); process.exit(3); }
if (process.env.MOCK_MODE === "timeout") { setInterval(() => {}, 1000); }
else if (args.includes("--format")) {
  if (process.env.MOCK_MODE === "malformed") console.log("not JSON");
  else {
    console.log(JSON.stringify({ type: "reasoning", part: { text: "private reasoning" } }));
    if (process.env.MOCK_MODE !== "empty") console.log(JSON.stringify({ type: "text", part: { text: "Clear prose." } }));
    if (process.env.MOCK_MODE === "event-error") console.log(JSON.stringify({ type: "error", error: { message: "failed" } }));
  }
} else if (args.includes("-o")) {
  fs.writeFileSync(args[args.indexOf("-o") + 1], process.env.MOCK_MODE === "empty" ? "" : "Clear prose.");
} else console.log("Clear prose.");
`;
  for (const name of ["codex", "opencode", "agy"]) {
    writeFileSync(join(bin, name), mock);
    chmodSync(join(bin, name), 0o755);
  }
  const modelFile = join(scratch, "model");
  writeFileSync(modelFile, "stale-hook-model");
  const env = {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: scratch,
    CLAUDISH_MODEL: "old-env-model", CLAUDISH_MODEL_FILE: modelFile,
    CLAUDISH_TIMEOUT: "5", CLAUDISH_NOTICE: "0", CLAUDISH_MIN_CHARS: "1",
    CLAUDISH_OFF_FILE: join(scratch, "off"), CLAUDISH_STYLE_FILE: join(scratch, "style"),
    CLAUDISH_LANG_FILE: join(scratch, "lang"), CLAUDISH_MODE_FILE: join(scratch, "mode"),
    CLAUDISH_ENABLED: "1", CLAUDISH_MODE: "append", CLAUDISH_STUB: "0",
    MOCK_CAPTURE: join(scratch, "capture.json"), MOCK_MODE: "success",
  };
  const run = (file, args, input, overrides = {}) => spawnSync("bash", [file, ...args], {
    cwd: scratch, input, encoding: "utf8", env: { ...env, ...overrides }, timeout: 10000,
  });
  const input = '中文 $HOME `touch nope` $(touch nope)\n' + "Source sentence. ".repeat(20000);
  const instructions = join(scratch, "instructions.txt");
  writeFileSync(instructions, "Keep the evidence qualifiers.");
  for (const provider of ["codex", "opencode", "agy"]) {
    const result = run(runner, [provider, "exact/model#variant", instructions], provider === "agy" ? "Source." : input);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "Clear prose.\n");
    const captured = JSON.parse(readFileSync(env.MOCK_CAPTURE));
    assert.equal(captured.internal, "1");
    const flag = provider === "agy" ? "--model" : "-m";
    assert.equal(captured.args[captured.args.indexOf(flag) + 1], "exact/model#variant");
    const prompt = provider === "agy" ? captured.args.at(-1) : captured.input;
    assert.ok(prompt.includes("Keep the evidence qualifiers."));
    assert.ok(prompt.includes(provider === "agy" ? "Source." : input));
  }
  for (const [provider, mode] of [["codex", "fail"], ["codex", "empty"], ["opencode", "malformed"], ["opencode", "event-error"], ["opencode", "empty"], ["codex", "timeout"]]) {
    const result = run(runner, [provider, "chosen-model"], "Source.", { MOCK_MODE: mode, CLAUDISH_TIMEOUT: "1" });
    assert.equal(result.status, 1, `${provider}/${mode}: ${result.stderr}`);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("agentish-rewriter:"));
  }
  for (const args of [[], ["invalid", "model"], ["codex", ""]]) {
    assert.equal(run(runner, args, "Source.").status, 1);
  }
  assert.equal(run(runner, ["codex", "model"], " \n\t").status, 1);
  assert.equal(run(runner, ["codex", "model"], "Source.", { CLAUDISH_TIMEOUT: "wrong" }).status, 1);

  // The original hooks still reach the same provider and fail open.
  for (const payload of ["not json", "", '{"session_id":"s","final":true}']) {
    const result = run(join(root, "rewrite.sh"), [], payload);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
  }
  const payload = JSON.stringify({ message_id: "m", session_id: "s", index: 0, final: true, delta: "Original prose.", cwd: scratch });
  const display = run(join(root, "rewrite.sh"), [], payload, { CLAUDISH_PROVIDER: "codex" });
  assert.equal(display.status, 0, display.stderr);
  assert.ok(JSON.parse(display.stdout).hookSpecificOutput.displayContent.includes("Clear prose."));
  const document = join(scratch, "file.md");
  const original = "---\ntitle: Example\n---\n\nOriginal prose.\n";
  writeFileSync(document, original);
  const mdPayload = JSON.stringify({ session_id: "s", cwd: scratch, tool_input: { file_path: document } });
  for (const mode of ["fail", "success"]) {
    const result = run(join(root, "rewrite-md.sh"), [], mdPayload, {
      CLAUDISH_PROVIDER: "codex", CLAUDISH_MD_DIR: scratch, CLAUDISH_MD_MODE: "sibling", MOCK_MODE: mode,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(document, "utf8"), original);
    if (mode === "fail") assert.equal(existsSync(join(scratch, "file.plain.md")), false);
  }
  assert.equal(readFileSync(join(scratch, "file.plain.md"), "utf8"), "---\ntitle: Example\n---\n\nClear prose.\n");

  const automatic = join(packageRoot, "hooks/automatic.sh");
  const stop = { hook_event_name: "Stop", last_assistant_message: "Original prose.", cwd: scratch };
  const auto = (data, overrides = {}) => run(automatic, ["codex"], JSON.stringify(data), {
    CLAUDISH_PROVIDER: "codex", ...overrides,
  });
  // A persisted replace setting cannot suppress an already displayed answer.
  writeFileSync(env.CLAUDISH_MODE_FILE, "replace");
  const notice = JSON.parse(auto(stop).stdout);
  assert.ok(notice.systemMessage.includes("Clear prose."));
  assert.ok(!notice.systemMessage.includes("Original prose."));
  assert.deepEqual(Object.keys(notice), ["systemMessage"]); // Never continue the turn.
  for (const overrides of [{ MOCK_MODE: "fail" }, { MOCK_MODE: "empty" }, { CLAUDISH_INTERNAL: "1" }, { CLAUDISH_ENABLED: "0" }, { CLAUDISH_MIN_CHARS: "200" }]) {
    const result = auto(stop, overrides);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
  }
  for (const data of [{}, { ...stop, stop_hook_active: true }, { ...stop, last_assistant_message: "<!-- claudish:original -->\nAlready clear." }]) {
    assert.equal(auto(data).stdout, "");
  }
  assert.equal(run(automatic, ["codex"], "not json").stdout, "");
  assert.equal(run(automatic, ["opencode"], JSON.stringify({ text: "Original prose." }), { CLAUDISH_STUB: "1" }).status, 0);
  const translated = JSON.parse(auto(stop, { CLAUDISH_LANG: "zh", CLAUDISH_STYLE: "tldr" }).stdout);
  assert.ok(translated.systemMessage.includes("摘要"));
  assert.ok(JSON.parse(readFileSync(env.MOCK_CAPTURE)).input.includes("简体中文"));
  assert.equal(auto(stop, { MOCK_MODE: "timeout", CLAUDISH_TIMEOUT: "1" }).stdout, "");
  assert.equal(run(join(root, "rewrite.sh"), [], payload, { CLAUDISH_INTERNAL: "1" }).stdout, "");
  assert.equal(run(join(root, "rewrite-md.sh"), [], mdPayload, { CLAUDISH_INTERNAL: "1", CLAUDISH_MD_DIR: scratch }).stdout, "");

  // An installed Codex package cannot depend on files outside its root.
  const detached = join(scratch, "detached plugin");
  cpSync(packageRoot, detached, { recursive: true });
  const definition = JSON.parse(readFileSync(join(detached, "hooks/hooks.json"))).hooks.Stop[0].hooks[0];
  const installed = spawnSync("bash", ["-c", definition.command], {
    input: JSON.stringify(stop), encoding: "utf8", timeout: 10000,
    env: { ...env, PLUGIN_ROOT: detached, CLAUDISH_STUB: "1" },
  });
  assert.equal(installed.status, 0, installed.stderr);
  assert.ok(JSON.parse(installed.stdout).systemMessage.includes("STUB-SIMPLIFIED"));

  // Exercise the OpenCode 1 completion hook through its real child process.
  const savedEnv = { ...process.env };
  Object.assign(process.env, env, { CLAUDISH_PROVIDER: "codex" });
  try {
    const output = { text: "Original prose." };
    await hooks["experimental.text.complete"]({}, output);
    assert.ok(output.text.startsWith("Original prose."));
    assert.ok(output.text.endsWith("Clear prose."));
    process.env.MOCK_MODE = "fail";
    const unchanged = { text: "Original prose." };
    await hooks["experimental.text.complete"]({}, unchanged);
    assert.equal(unchanged.text, "Original prose.");
    process.env.MOCK_MODE = "success";
    sessionInfo = { parentID: "parent-session" };
    await hooks["experimental.text.complete"]({}, unchanged);
    assert.equal(unchanged.text, "Original prose.");
    sessionInfo = {};
    process.env.CLAUDISH_INTERNAL = "1";
    await hooks["experimental.text.complete"]({}, unchanged);
    assert.equal(unchanged.text, "Original prose.");
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
  }
  console.log("PASS: registration, providers, recursion guards, failures, Claude hooks, and automatic Codex/OpenCode adapters");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
