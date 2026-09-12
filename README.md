# claudish-to-english

<p align="center">
  <img
    src="https://github.com/gvzdv/claudish-to-english/releases/download/assets/comparison.png"
    width="820"
    alt="Side-by-side comparison: a dense, jargon-heavy Claude message labeled 'Claudish' on the left, and its plain-English rewrite on the right">
</p>

A Claude Code plugin that shows a **plain-language rewrite** of each assistant
message. This is a simplified personal fork of
[gvzdv/claudish-to-english](https://github.com/gvzdv/claudish-to-english):

- **Providers are headless CLIs only** — `codex exec` (default), `agy -p`, or
  `opencode run`. No API keys, no base URLs, no local model server: whatever
  the CLI is already logged into serves the rewrite.
- **Two languages** — English and 简体中文. The rewrite is either a plain
  version in the message's own language, or a 中→英 / 英→中 rewrite when a
  target language is set. Nothing else is configurable there.

It is **display-only**: Claude's own reasoning and the saved transcript keep the
original text — only what you read on screen changes. An optional second hook
rewrites **Markdown files** (opt-in, off by default).

> Every hook fails **open** — if anything goes wrong (CLI missing, timeout,
> error), you simply see Claude's original text. The plugin can never swallow or
> corrupt an answer.

---

## Requirements

- Claude Code with `MessageDisplay` hook support, `bash`, `jq`.
- One of the CLIs, installed and logged in: [`codex`](https://github.com/openai/codex)
  (default), `agy` (Antigravity CLI), or [`opencode`](https://opencode.ai).
  `opencode` support follows its documented flags but has not been exercised
  on the maintainer's machine.

## Install

```shell
/plugin marketplace add ValerioL29/claudish-to-english
/plugin install claudish-to-english@valeriol29-plugins
```

Try it for one session without installing: `claude --plugin-dir /path/to/claudish-to-english`.
Run `/reload-plugins` after edits; if it does not load, check the `/plugin` **Errors** tab.

---

## Configuring

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
| `codex` (default) | `codex exec --sandbox read-only --ephemeral -o … "<prompt>"` | Run outside any repo. Model via `-m`, effort via `-c model_reasoning_effort=`. |
| `agy` | `agy --disable-slash-commands --output-format text -p "<prompt>"` | Model via `--model`, effort via `--effort`. |
| `opencode` | `opencode run "<prompt>"` | Model via `-m provider/model`. No effort flag. |

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
| `CLAUDISH_MODE` / `_MODE_FILE` | `append` / `~/.claude/claudish-mode` | `append` or `replace`. |
| `CLAUDISH_STYLE` / `_STYLE_FILE` | unset / `~/.claude/claudish-style` | `tldr`, `5y`, `caveman`. |
| `CLAUDISH_LANG` / `_LANG_FILE` | unset / `~/.claude/claudish-lang` | `en` or `zh`; unset falls back to the settings `language` key, then the message's own language. |
| `CLAUDISH_PROVIDER` | `codex` | `codex`, `agy`, or `opencode`. |
| `CLAUDISH_MODEL` / `_MODEL_FILE` | unset / `~/.claude/claudish-model` | Model name passed to the CLI; empty = its default. |
| `CLAUDISH_EFFORT` | unset | `low` / `medium` / `high` for the rewrite only (codex, agy). `CLAUDISH_CODEX_EFFORT` still works as an alias. |
| `CLAUDISH_PROMPT_FILE` / `CLAUDISH_MD_PROMPT_FILE` | unset | Replacement prompt for the display / Markdown hook. |
| `CLAUDISH_MIN_CHARS` | `200` | Skip messages/files whose prose (code stripped) is shorter. |
| `CLAUDISH_TIMEOUT` / `CLAUDISH_MD_TIMEOUT` | `45` / `150` | CLI call timeout per hook (seconds); keep below the 60 s / 180 s hook timeouts in `hooks/hooks.json`. |
| `CLAUDISH_STUB` | `0` | `1` = deterministic stub instead of the CLI (mechanics testing). |
| `CLAUDISH_DEBUG` | `0` | `1` = log to `$TMPDIR/claudish-to-english/`. |
| `CLAUDISH_NOTICE` | `1` | Once-per-session notice when a rewrite is skipped (CLI missing, timeout, error); also gates the `SessionStart` override notice. |
| `CLAUDISH_MD_DIR` / `_MD_MODE` / `_MD_SUFFIX` | unset / `sibling` / `plain` | Markdown hook opt-in directory, mode, sibling infix. |

---

## Layout

```
claudish-to-english/
├── .claude-plugin/         # plugin.json, marketplace.json
├── commands/claudish.md    # /claudish slash command
├── hooks/hooks.json        # SessionStart / MessageDisplay / PostToolUse wiring
├── rewrite.sh              # display-rewrite hook
├── rewrite-md.sh           # Markdown-file rewrite hook (opt-in)
├── claudish-ctl.sh         # flag-file switcher + dashboard behind /claudish
├── session-notice.sh       # SessionStart: announces leftover overrides
├── providers.sh            # codex / agy / opencode, sourced by both hooks
├── lang.sh                 # en|zh resolver, sourced by both hooks and the ctl
└── CHANGELOG.md
```

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)**: testing without a CLI
(`CLAUDISH_STUB=1`), the rule that outranks everything (every hook must **fail
open**), and the traps that have bitten before. Add changelog entries under
`## [Unreleased]`.

## License

MIT — see [LICENSE](LICENSE). Original work © Mike Gvozdev.
