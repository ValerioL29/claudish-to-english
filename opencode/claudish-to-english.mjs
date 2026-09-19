import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

// The Bash engine owns configuration and fail-open behavior. Bound its output
// and lifetime here too, so a broken child cannot stall answer completion.
export function automaticRewrite(text, cwd, signal) {
  if (signal?.aborted || process.env.CLAUDISH_INTERNAL === "1" || typeof text !== "string") return Promise.resolve("");
  const hook = fileURLToPath(new URL("../plugins/claudish-to-english/hooks/automatic.sh", import.meta.url));
  return new Promise((resolve) => {
    const child = spawn("bash", [hook, "opencode"], {
      detached: true, stdio: ["pipe", "pipe", "ignore"],
    });
    const chunks = [];
    let bytes = 0, failed = false;
    // Bash launches the provider as a descendant. A separate process group lets
    // cancellation reach the CLI too, while SIGTERM allows shell cleanup traps.
    const terminate = (signal) => {
      failed = true;
      if (child.pid) try { process.kill(-child.pid, signal); } catch { /* Already exited. */ }
    };
    const cancel = () => terminate("SIGTERM");
    const timer = setTimeout(() => terminate("SIGKILL"), 60000);
    const finish = (error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      resolve(error || failed || signal?.aborted ? "" : Buffer.concat(chunks).toString("utf8"));
    };
    signal?.addEventListener("abort", cancel, { once: true });
    child.on("error", finish);
    child.on("close", (code) => finish(code !== 0));
    child.stdout.on("data", (chunk) => {
      if (failed) return;
      bytes += chunk.length;
      if (bytes > 8 * 1024 * 1024) return terminate("SIGKILL");
      chunks.push(chunk);
    });
    child.stdin.on("error", () => {}); // A missing engine may close stdin early.
    child.stdin.end(JSON.stringify({ text, cwd }));
  });
}

// Register an on-demand command in the parent session so “last answer” remains
// available. The skill delegates only after capturing the source and model.
async function rewriteCommand() {
  const skillDirectory = fileURLToPath(
    new URL("../plugins/claudish-to-english/skills/agentish-rewriter/", import.meta.url),
  );
  const skill = await readFile(`${skillDirectory}SKILL.md`, "utf8");
  return {
    description: "Rewrite an answer or Markdown using your chosen model",
    subtask: false,
    template: `Skill directory: ${skillDirectory}\n\n${skill.replace(/^---\n[\s\S]*?\n---\n/, "")}\n\nUser request: $ARGUMENTS`,
  };
}

// OpenCode 2 uses a command transform. Keep the v1 adapter separate so each
// host receives its own native plugin export without additional dependencies.
export default {
  id: "claudish-to-english",
  async setup({ command, session }) {
    if ((await command.list()).data.some((item) => item.name === "agentish-rewriter")) return;
    const definition = await rewriteCommand();
    await command.transform((draft) => {
      draft.add({
        name: "agentish-rewriter",
        description: definition.description,
        async execute({ prompt, sessionID, delivery }) {
          await session.prompt({
            ...prompt,
            sessionID,
            text: definition.template.replaceAll("$ARGUMENTS", () => prompt.text),
            delivery,
          });
        },
      });
    });
    // The separate ./tui entry handles automatic display-only rewrites.
    // Keep server commands usable in headless and web clients too.
  },
};

export async function legacyPlugin({ directory, client } = {}) {
  const definition = await rewriteCommand();
  return {
    config: async (config) => {
      config.command ??= {};
      config.command["agentish-rewriter"] ??= definition;
    },
    "experimental.text.complete": async (input, output) => {
      if (process.env.CLAUDISH_INTERNAL === "1") return;
      try {
        // Native sub-agent results must retain the explicitly selected model's
        // output; only the parent session's answer gets an automatic rewrite.
        const info = await client.session.get({ path: { id: input.sessionID } });
        if (!info.data || info.data.parentID) return;
        const rewrite = await automaticRewrite(output.text, directory);
        if (rewrite) output.text += rewrite;
      } catch { /* Fail open on session lookup and rewrite errors. */ }
    },
  };
}
