import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

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
  },
};

export async function legacyPlugin() {
  const definition = await rewriteCommand();
  return {
    config: async (config) => {
      config.command ??= {};
      config.command["agentish-rewriter"] ??= definition;
    },
  };
}
