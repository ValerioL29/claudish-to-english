# claudish-to-english

<p align="center">
  <img
    src="https://github.com/gvzdv/claudish-to-english/releases/download/assets/comparison.png"
    width="820"
    alt="Side-by-side comparison: a dense, jargon-heavy Claude message labeled 'Claudish' on the left, and its plain-English rewrite on the right">
</p>

A plain-language rewriting plugin for **Claude Code, Codex, and OpenCode**.
Claude Code, Codex, and OpenCode 1 support automatic rewriting. All three hosts
can rewrite an answer or Markdown document on demand with **Agentish Rewriter**,
using the model you choose. This is a simplified personal fork of
[gvzdv/claudish-to-english](https://github.com/gvzdv/claudish-to-english):

- **Providers are headless CLIs only** — `codex exec` (default), `agy -p`, or
  `opencode run`. No API keys, no base URLs, no local model server: whatever
  the CLI is already logged into serves the rewrite.
- **Two languages** — English and 简体中文. The rewrite is either a plain
  version in the message's own language, or a 中→英 / 英→中 rewrite when a
  target language is set. Nothing else is configurable there.

The Claude display hook is **display-only**: Claude's own reasoning and the saved transcript keep the
original text — only what you read on screen changes. An optional second hook
rewrites **Markdown files** (opt-in, off by default). Codex shows automatic
rewrites in a separate hook message. OpenCode 1 saves appended rewrites alongside
the original text; they become part of subsequent conversation context.

> Every hook fails **open** — if anything goes wrong (CLI missing, timeout,
> error), you keep the original text. The plugin can never swallow or
> corrupt an answer.

---

## Requirements

- A supported host: Claude Code, Codex with plugin support, or OpenCode.
- `bash` and `jq` for automatic rewriting and the OpenCode CLI provider.
- One of the CLIs, installed and logged in: [`codex`](https://github.com/openai/codex)
  (default), `agy` (Antigravity CLI), or [`opencode`](https://opencode.ai).
  Native sub-agent rewriting uses the host's available models; a headless CLI
  is needed when the host cannot select the requested model itself.

## Install

### Claude Code

```shell
/plugin marketplace add ValerioL29/claudish-to-english
/plugin install claudish-to-english@valeriol29-plugins
```

Try it for one session without installing: `claude --plugin-dir /path/to/claudish-to-english`.
Run `/reload-plugins` after edits; if it does not load, check the `/plugin` **Errors** tab.

### Codex

From this checkout:

```shell
codex plugin marketplace add .
codex plugin add claudish-to-english@personal
```

Start a new session, then select `$agentish-rewriter` in the
[Codex skill picker](https://learn.chatgpt.com/docs/build-skills). The
Codex package contains the skill, shared rewrite engine, and a `Stop` hook.
Review and trust the plugin's hook definition in Codex to enable automatic
rewriting; installing a plugin alone does not trust its hooks. See
[Codex plugin hooks](https://learn.chatgpt.com/docs/hooks#plugin-hooks).
Its marketplace is `.agents/plugins/marketplace.json`.

### OpenCode

Keep this checkout on disk. From its root, link the adapter into OpenCode's
native plugin directory. For **OpenCode 2** (tested with 2.0.2):

```shell
opencode_config_dir="${OPENCODE_CONFIG_DIR:-${XDG_CONFIG_HOME:-$HOME/.config}/opencode}"
mkdir -p "$opencode_config_dir/plugins"
ln -s "$PWD/opencode/claudish-to-english.mjs" "$opencode_config_dir/plugins/claudish-to-english.js"
```

For **OpenCode 1**, use the legacy adapter in that last command instead:

```shell
ln -s "$PWD/opencode/claudish-to-english-v1.mjs" "$opencode_config_dir/plugins/claudish-to-english.js"
```

Restart OpenCode. The plugin registers `/agentish-rewriter`; OpenCode 1 also
enables automatic rewriting. It preserves an existing user command with that
name. Keep the adapter and `plugins/` directory
together. The commands above refuse to overwrite an existing installation.
No npm package or build step is required.

OpenCode 2 registers a command with an execution callback that submits the skill
instructions and request to the existing session. OpenCode 1 uses its
[plugin config hook](https://opencode.ai/docs/plugins/) and
[custom command templates](https://opencode.ai/docs/commands/).

## Automatic rewriting across hosts

Automatic rewriting is enabled by default in the supported adapters once the
host loads and, for Codex, trusts the hooks. It uses the configured CLI provider
and model. The existing 200-character prose threshold still applies; set `CLAUDISH_MIN_CHARS=1` to
include short answers.

| Host | Automatic behavior | Saved conversation |
|---|---|---|
| Claude Code | `MessageDisplay`: append or replace the displayed answer | Original unchanged |
| Codex | `Stop`: append a rewrite via `systemMessage`, rendered as a hook warning/event | Original unchanged; rewrite is outside model context |
| OpenCode 1 | `experimental.text.complete`: append to each completed text part | Original plus rewrite |
| OpenCode 2.0.2 | On-demand command; no supported completed-text/display transform | Earlier messages unchanged |

Codex and OpenCode 1 use **append only**: their adapters do not suppress the
original stream. OpenCode 1's rewrites are persisted and can influence later
answers. Its [completion hook updates the saved text part](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/session/processor.ts).
OpenCode 2.0.2 lacks this hook. Its `session.synthetic` API queues model input,
even with `resume: false`; a live isolated-server check confirmed that it does
not append to the visible conversation. Automatic rewriting is therefore
unavailable in that adapter. Use `/agentish-rewriter` on OpenCode 2.
The `/claudish` dashboard, session-start notice, and automatic Markdown-file hook
remain Claude-specific; on-demand Markdown rewriting works in all three hosts.

Set environment variables before launching the host (or its server), for example:

```shell
CLAUDISH_PROVIDER=codex CLAUDISH_MODEL=gpt-5.6-luna CLAUDISH_LANG=zh codex
CLAUDISH_PROVIDER=codex CLAUDISH_MODEL=gpt-5.6-luna CLAUDISH_STYLE=tldr opencode # OpenCode 1 automatic rewriting
```

Restart an existing OpenCode background service when changing its environment.
The adapters share `CLAUDISH_ENABLED`, `CLAUDISH_OFF_FILE`, style, language,
provider, model, custom prompt, threshold, and timeout settings with Claude.
Existing `~/.claude/claudish-*` flags therefore affect all hosts; use the `*_FILE`
overrides for independent settings. Codex/OpenCode 1 keep the source language
unless a language flag or `CLAUDISH_LANG` is set; they do not read Claude's
project language setting. They fail silently on rewrite errors.

Worker CLIs receive an internal recursion guard to prevent nested automatic
rewrites. OpenCode 1 also skips native sub-agent sessions. Answers beginning with `<!-- claudish:original -->` skip automatic rewriting;
the on-demand skill adds this Markdown comment to its final result.

## Agentish Rewriter

In Claude Code and OpenCode:

```text
/agentish-rewriter Please rewrite the last answer using a gpt-5.6-luna sub-agent.
/agentish-rewriter Please rewrite 'file.md' using opencode with model anthropic/claude-sonnet-4-6.
```

Claude plugin skills may use the qualified name
`/claudish-to-english:agentish-rewriter`. In Codex, use its native skill syntax:

```text
$agentish-rewriter Please rewrite the last answer using a gpt-5.6-luna sub-agent.
$agentish-rewriter Please rewrite 'file.md' using codex with model gpt-5.6-luna.
```

Replace the example model with one available to your host or logged-in CLI.
The skill selects that model through the native sub-agent tool when supported;
otherwise it starts a separate `codex`, `opencode`, or `agy` CLI session. It
asks if the model/provider is unspecified or ambiguous and never silently
substitutes a different model. Explicit model choices override persisted
`/claudish model` settings. The worker receives the source text and rewrite
instructions; the parent checks the result before returning or saving it.

Answer requests return the rewritten answer. Document requests create
`file.plain.md` by default, preserving YAML frontmatter; request an overwrite
or another destination explicitly. Existing destinations require an explicit
replacement request. Provider failures leave the source unchanged.

The skill instructs the worker to preserve meaning, technical terminology, qualifications, numbers,
code, links, and Markdown structure. Add `in English` or `in 简体中文` to change
the output language. The automatic hooks' style/language toggles do not control
this explicit skill. Native delegation depends on the host's available tools
and models; schema and offline checks do not establish rewrite quality.

For scripts, the same runner reads stdin and emits only a successful rewrite:

```shell
bash plugins/claudish-to-english/skills/agentish-rewriter/scripts/rewrite.sh \
  codex YOUR_MODEL < file.md
```

An optional third argument is a file containing additional rewrite instructions.
`CLAUDISH_TIMEOUT` defaults to 150 seconds for this runner. Inspect its exit
status and output before saving; never redirect it over the input file.

---

## Configuring the Claude hooks

Two layers, and they complement each other:

- **`/claudish`** — live toggles that take effect on the next message: on/off,
  display mode, style, language, model.
- **`CLAUDISH_*` env vars** — durable defaults, set in the `env` block of
  `~/.claude/settings.json` (not in the plugin's own `hooks.json`, which is
  overwritten on update). Hooks are subprocesses of Claude Code and inherit
  them; restart Claude Code after editing.

```json
{
  "env": {
    "CLAUDISH_PROVIDER": "codex",
    "CLAUDISH_MODEL": "gpt-5.6-luna",
    "CLAUDISH_EFFORT": "low",
    "CLAUDISH_LANG": "zh"
  }
}
```

Precedence everywhere is **`/claudish` flag file > env var > settings file >
built-in default**. Flag files exist because env vars are frozen at session
launch; a flag file is re-read on every message.

To confirm the hook is firing, set `CLAUDISH_DEBUG=1` and watch
`"$TMPDIR"/claudish-to-english/debug.log`.

### `/claudish`

```
/claudish              dashboard: each setting, its value, and where it comes from
/claudish on | off     resume / pause rewrites (off also pauses the Markdown hook)
/claudish append       original, then the rewrite below it (default)
/claudish replace      rewrite only
/claudish style X      tldr | 5y (explain like I'm five) | caveman; bare = plain rewrite
/claudish language X   en | zh (any usual spelling); bare = back to session/settings
/claudish model X      model name passed to the CLI; bare = the CLI's own default
/claudish last         reprint the ORIGINAL of the last message
/claudish cycle        off → append → replace → off
/claudish reset        clear every override
```

Overrides **persist across sessions** (they are files under `~/.claude/`). The
dashboard marks each active one with ⚠ and a `SessionStart` notice lists them
when a new session opens.

---

## Providers

| `CLAUDISH_PROVIDER` | Command run | Notes |
|---|---|---|
| `codex` (default) | `codex exec --sandbox read-only --ephemeral -o … -` | Prompt on stdin, run outside the project. Model via `-m`, effort via `-c model_reasoning_effort=`. |
| `agy` | `agy --disable-slash-commands --output-format text -p "<prompt>"` | Model via `--model`, effort via `--effort`. |
| `opencode` | `opencode run --format json` | Prompt on stdin, text events only. Model via `-m provider/model`. No effort flag. |

`CLAUDISH_MODEL` is passed through as-is, so it has to be a name **that CLI**
understands. Empty means the CLI's configured default. `CLAUDISH_EFFORT=low` is
worth setting: a per-message rewrite does not need a coding agent's reasoning
budget, and the call sits inside a 60 s hook timeout. The CLIs are told not to
use tools; the sandbox flags are the backstop.

**Privacy:** every rewritten assistant message (and, with the Markdown hook on,
file contents) goes to whatever backend that CLI talks to.

---

## Output language

Only English and 简体中文 exist. With nothing configured, the rewrite keeps the
language of the message it rewrites. Set a target to translate as it
simplifies — English messages come back in Chinese with `zh`, Chinese messages
in English with `en`:

| Source (first set wins) | Example |
|---|---|
| `/claudish language zh` | flag file `~/.claude/claudish-lang` |
| `CLAUDISH_LANG` (env) | `"CLAUDISH_LANG": "zh"` |
| `<project>/.claude/settings.local.json` | `"language": "简体中文"` |
| `<project>/.claude/settings.json` | `"language": "简体中文"` |
| `~/.claude/settings.json` | `"language": "English"` |

Accepted spellings: `en`, `English`, `英文`, `英语` · `zh`, `zh-CN`, `Chinese`,
`Simplified Chinese`, `中文`, `简体中文`, `汉语`. Anything else reads as unset.
`CLAUDISH_LANG` set but **empty** ignores the settings key.

The on-screen label follows the target: 💬 说**人话**： for Chinese, 💬 In plain
**English**: otherwise (styles have their own: 📌 摘要 / TL;DR, 👶, 🦴).

---

## Customizing the rewrite prompt

Style presets (`tldr`, `5y`, `caveman`) replace the base prompt; the language
line and the voice framing (“I” is the assistant, “you” is the user) still
apply. For full control point `CLAUDISH_PROMPT_FILE` (display hook) or
`CLAUDISH_MD_PROMPT_FILE` (Markdown hook) at a file: its contents **replace**
the whole prompt, language line included, so state the direction you want in
it. The voice framing and the user-question context are still appended. An
empty or unreadable file falls back to the built-in prompt.

---

## How the display hook works

Claude Code fires `MessageDisplay` **once per streamed chunk**. The hook buffers
every `delta` under `$TMPDIR/claudish-to-english/<session>/<message>/` and calls
the CLI once, on the final chunk, with the whole message plus the original user
question as context only. `append` streams the original and adds the rewrite
below; `replace` suppresses the stream and shows only the rewrite (on failure it
re-shows the full original).

## Markdown file rewrite (optional)

`rewrite-md.sh` (`PostToolUse` on Write/Edit) rewrites `*.md` files under
`CLAUDISH_MD_DIR` — unset means off. `CLAUDISH_MD_MODE=sibling` (default) writes
`NAME.plain.md` next to the original; `overwrite` replaces it in place with an
idempotency marker. YAML frontmatter is re-attached verbatim, writes are atomic,
and on any failure the file is left exactly as written.

---

## Configuration (env vars)

| Var | Default | Meaning |
|---|---|---|
| `CLAUDISH_ENABLED` | `1` | Master switch, read at session start. |
| `CLAUDISH_OFF_FILE` | `~/.claude/claudish-off` | Exists → rewrites paused (live). |
| `CLAUDISH_MODE` / `_MODE_FILE` | `append` / `~/.claude/claudish-mode` | Claude: `append` or `replace`. Other automatic adapters always append. |
| `CLAUDISH_STYLE` / `_STYLE_FILE` | unset / `~/.claude/claudish-style` | `tldr`, `5y`, `caveman`. |
| `CLAUDISH_LANG` / `_LANG_FILE` | unset / `~/.claude/claudish-lang` | `en` or `zh`; Claude falls back to its settings `language` key; other adapters keep the source language. |
| `CLAUDISH_PROVIDER` | `codex` | `codex`, `agy`, or `opencode`. |
| `CLAUDISH_MODEL` / `_MODEL_FILE` | unset / `~/.claude/claudish-model` | Model name passed to the CLI; empty = its default. |
| `CLAUDISH_EFFORT` | unset | `low` / `medium` / `high` for the rewrite only (codex, agy). `CLAUDISH_CODEX_EFFORT` still works as an alias. |
| `CLAUDISH_PROMPT_FILE` / `CLAUDISH_MD_PROMPT_FILE` | unset | Replacement prompt for the display / Markdown hook. |
| `CLAUDISH_MIN_CHARS` | `200` | Skip messages/files whose prose (code stripped) is shorter. |
| `CLAUDISH_TIMEOUT` / `CLAUDISH_MD_TIMEOUT` | `45` / `150` | CLI call timeout per hook (seconds); keep below the 60 s / 180 s hook timeouts in `hooks/hooks.json`. |
| `CLAUDISH_STUB` | `0` | `1` = deterministic stub instead of the CLI (mechanics testing). |
| `CLAUDISH_DEBUG` | `0` | `1` = Claude hook log in `$TMPDIR/claudish-to-english/`; other adapters clean their temporary logs. |
| `CLAUDISH_NOTICE` | `1` | Once-per-session notice when a rewrite is skipped (CLI missing, timeout, error); also gates the `SessionStart` override notice. |
| `CLAUDISH_MD_DIR` / `_MD_MODE` / `_MD_SUFFIX` | unset / `sibling` / `plain` | Markdown hook opt-in directory, mode, sibling infix. |

---

## Layout

```
claudish-to-english/
├── .claude-plugin/         # plugin.json, marketplace.json
├── .agents/plugins/        # Codex marketplace
├── plugins/claudish-to-english/ # self-contained Codex plugin + shared skill
├── opencode/               # OpenCode commands + v1 automatic rewriting
├── commands/claudish.md    # /claudish slash command
├── hooks/hooks.json        # SessionStart / MessageDisplay / PostToolUse wiring
├── rewrite.sh              # entry point to the shared display engine
├── rewrite-md.sh           # Markdown-file rewrite hook (opt-in)
├── claudish-ctl.sh         # flag-file switcher + dashboard behind /claudish
├── session-notice.sh       # SessionStart: announces leftover overrides
├── providers.sh            # compatibility entry point to the shared provider runner
├── lang.sh                 # en|zh resolver, sourced by both hooks and the ctl
├── tests/check.mjs         # offline integration check: node tests/check.mjs
└── CHANGELOG.md
```

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)**: testing without a CLI
(`CLAUDISH_STUB=1`), the rule that outranks everything (every hook must **fail
open**), and the traps that have bitten before. Add changelog entries under
`## [Unreleased]`.

## License

MIT — see [LICENSE](LICENSE). Original work © Mike Gvozdev.
