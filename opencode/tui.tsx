import { Plugin } from "@opencode/plugin/tui";
import { Show } from "solid-js";
import { panelName, watchAnswers } from "./panel.mjs";

export default Plugin.define({
  id: "claudish-to-english.panel",
  setup(context) {
    const [state, update] = context.storage.memory("rewrites", { initial: {} });
    const stop = watchAnswers(context, (id, text) => update((draft) => { draft[id] = text; }));
    // Keymaps need the renderer's provider and must register inside a slot.
    const command = context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [{
            id: panelName,
            title: "Show plain-language rewrite",
            group: "Claudish",
            palette: true,
            slash: { name: "agentish-panel" },
            run: () => { context.ui.panel.open(panelName); },
          }],
        }));
        return null;
      },
    });

    function RewritePanel({ panel }) {
      context.keymap.layer(() => ({
        commands: [
          { bind: "escape", run: panel.close },
          { bind: "f", run: panel.toggleFullscreen },
        ],
      }));
      return (
        <box flexDirection="column" flexGrow={1} padding={1} gap={1}>
          <text fg={context.theme.text.default}>Plain-language rewrite</text>
          <scrollbox flexGrow={1} focused={panel.focused}>
            <text wrapMode="word">{state[panel.sessionID] || "No rewrite available for the current turn."}</text>
          </scrollbox>
          <text fg={context.theme.text.muted}>Esc: close · f: fullscreen</text>
        </box>
      );
    }
    const slot = context.ui.slot({
      append: "session.panel",
      render: (panel) => <Show when={panel.name === panelName}><RewritePanel panel={panel} /></Show>,
    });
    return () => { stop(); command(); slot(); context.ui.panel.close(); };
  },
});
