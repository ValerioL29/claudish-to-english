# Contributing

Claude and Codex hooks and the OpenCode 1 adapter share a rewrite engine and
CLI runner with the portable Agentish Rewriter skill. OpenCode 2.0.2 supports
the on-demand command only.
Codex loads the package under `plugins/claudish-to-english/`; OpenCode uses the
adapters under `opencode/`. Keep changes compatible with each caller and add a
changelog entry.

- [Ground rules](#ground-rules)
- [Setting up](#setting-up)
- [Testing a change](#testing-a-change)
- [Traps specific to this repo](#traps-specific-to-this-repo)
- [Opening a pull request](#opening-a-pull-request)
- [Cutting a release (maintainer)](#cutting-a-release-maintainer)

---

## Ground rules

**Every hook must fail open.** This is the one rule that outranks everything
else. On *any* problem — provider down, timeout, no `jq`, malformed payload,
missing file — a hook must emit nothing and `exit 0`, which leaves Claude's
original text on screen. A display hook that can swallow or corrupt an
assistant's answer is worse than no plugin at all. If you are unsure whether
your change preserves this, say so in the PR and it will get checked.

**The Claude display hook is display-only.** Claude's own reasoning and the saved transcript
always keep the original text. Nothing you add should change what Claude
actually said, or write to the transcript. The Codex Stop hook likewise leaves
model context unchanged. OpenCode 1 retains the original and appends the rewrite to the saved text part. On-demand
rewrites return a new answer or save a document.

**Contributors do not bump the version and do not create tags.** Add your entry
under `## [Unreleased]` in `CHANGELOG.md` and leave it there. The maintainer
cuts releases (see [below](#cutting-a-release-maintainer)). This keeps every
release a single deliberate commit instead of a scatter of half-bumps.

---

## Setting up

You need `bash` and `jq`. For an end-to-end run you also need one of the
CLIs (`codex`, `agy`, `opencode`) logged in — but for most work you do **not**: `CLAUDISH_STUB=1` replaces the LLM
call with a deterministic string, which is enough to test all the display
mechanics.

To try your working copy as a real plugin, point a scratch project's
`.claude/settings.json` at your checkout and disable the published one so you
are not running two copies at once:

```jsonc
{
  "enabledPlugins": { "claudish-to-english@valeriol29-plugins": false },
  "env": { "CLAUDISH_STUB": "1", "CLAUDISH_MIN_CHARS": "50", "CLAUDISH_DEBUG": "1" },
  "hooks": {
    "MessageDisplay": [
      { "hooks": [ { "type": "command", "command": "/abs/path/to/rewrite.sh", "timeout": 60 } ] }
    ]
  }
}
```

Without that `enabledPlugins: false`, both your copy and the installed plugin
fire on the same message and whichever writes last wins — a genuinely confusing
way to lose an afternoon.

`CLAUDISH_DEBUG=1` writes to `${TMPDIR:-/tmp}/claudish-to-english/debug.log`.

---

## Testing a change

Run `node tests/check.mjs` for the offline integration check. It uses temporary
CLI doubles to verify model selection, input transport, error handling, and
automatic adapters without using credentials or invoking a paid model. The OpenCode
adapters are checked against their native registration interfaces. Real model
output and native sub-agent execution still need separate live verification.

You can also run hooks with synthetic payloads; they read JSON on stdin and
write JSON on stdout.

**Syntax check everything you touched:**

```bash
for f in *.sh plugins/claudish-to-english/hooks/*.sh plugins/claudish-to-english/skills/agentish-rewriter/scripts/*.sh; do
  bash -n "$f" || exit 1
done
node --check opencode/claudish-to-english.mjs
node --check opencode/claudish-to-english-v1.mjs
```

**Drive the display hook end to end.** Point `TMPDIR` at a scratch directory and
send the `*_FILE` variables somewhere nonexistent so your own
`~/.claude/claudish-*` flag files do not leak into the test:

```bash
BODY=$(python3 -c "print('This is a long assistant message. '*20)")
jq -nc --arg d "$BODY" \
  '{message_id:"m1",session_id:"s1",index:0,final:true,delta:$d,cwd:"/tmp"}' \
| CLAUDISH_STUB=1 CLAUDISH_STYLE=caveman \
  CLAUDISH_STYLE_FILE=/nonexistent CLAUDISH_LANG_FILE=/nonexistent \
  CLAUDISH_OFF_FILE=/nonexistent CLAUDISH_NOTICE=0 TMPDIR=/tmp/claudish-test \
  bash rewrite.sh | jq -r '.hookSpecificOutput.displayContent'
```

**Prove it still fails open.** Each of these must print nothing and exit 0:

```bash
printf 'not json'                        | bash rewrite.sh; echo "rc=$?"
printf ''                                | bash rewrite.sh; echo "rc=$?"
printf '{"session_id":"s","final":true}' | bash rewrite.sh; echo "rc=$?"   # no message_id
```

**If you touched anything user-visible on screen, check it in a real session**
rather than only in the JSON. The terminal renderer is not a pass-through — see
the ANSI trap below.

---

## Traps specific to this repo

These are all real regressions that have happened. They are cheap to avoid and
expensive to find.

### A new style preset touches four readers, not one

`CLAUDISH_STYLE` / the style flag file are validated by an allowlist in **four**
places. Miss one and the failure is silent:

| File | What it does with the value |
|---|---|
| `plugins/claudish-to-english/hooks/rewrite.sh` | picks the system prompt and the on-screen label |
| `claudish-ctl.sh` | `current_style`, `style_source`, the dashboard, `/claudish style` validation and its error text |
| `session-notice.sh` | warns at session start that a persisted style is still active |
| `commands/claudish.md` | `description` and `argument-hint` |

Plus `README.md` and `CHANGELOG.md`. The `caveman` preset shipped with
`session-notice.sh` missed, so a style set by `/claudish style` persisted across
sessions with nothing on screen to say so.

### Never emit ANSI escape codes

`displayContent` is rendered as **markdown**, so use `**bold**` for emphasis —
not `\033[1;93m`. Raw ANSI is a bad idea here for three separate reasons:

- The 16-colour codes are palette *indices*. A terminal theme may map them onto
  a grey or onto the background, so the accent can silently vanish (Solarized
  maps four of the bright slots to monotones).
- The escapes leak as literal bytes into `claude -p` output piped to a file.
- The hook has **no tty on any file descriptor** — `[ -t 1 ]` is always false
  and `/dev/tty` cannot be opened — so it cannot detect either condition and
  degrade.

The renderer honours SGR codes but strips other control sequences, so this is
about legibility and piped output, not safety.

### `allowed-tools` quoting in `commands/claudish.md`

The correct line is:

```
allowed-tools: Bash("${CLAUDE_PLUGIN_ROOT}/claudish-ctl.sh":*)
```

The quote closes **after** the path. If you see
`Bash("${CLAUDE_PLUGIN_ROOT}"/claudish-ctl.sh:*)` — quote before the slash —
that is the bug: the injected command quotes the whole path, so the rule's
prefix never matches and every `/claudish` call fails with
`Shell command permission check failed`, with no permission prompt to fall back
on. This has regressed twice, once through a merge conflict resolution. Do not
"fix" it back.

### Untrusted config values must go through `lang.sh`

The `language` key is read from `.claude/settings*.json`, and a project's
settings file travels with the repository — it is not necessarily the local
user's own text. Anything that reaches a prompt or the screen goes through
`_claudish_lang_clean`, which folds control characters to spaces and caps the
value at three words / 30 codepoints. Do not print a raw config value.

### Both hooks share `providers.sh` and `lang.sh`

`rewrite.sh` and `rewrite-md.sh` source both; `claudish-ctl.sh` also sources the
provider settings for its dashboard. The root `providers.sh` loads the canonical
runner in `plugins/claudish-to-english/skills/agentish-rewriter/scripts/` so the
Codex package is self-contained. A change affects the on-demand runner and both
hooks. The canonical display engine and language resolver live under
`plugins/claudish-to-english/hooks/`; root scripts preserve Claude's entry points.
`automatic.sh` adapts completed text to the engine and returns only the appended
suffix. The Codex variant wraps it in `systemMessage` and never blocks or
continues a turn. A missing shared file must leave original content intact.

Set `CLAUDISH_INTERNAL=1` for nested worker processes. Every automatic adapter
must honor it so a rewrite does not recursively rewrite its own answer.

---

## Opening a pull request

1. Branch from `main`.
2. Make the change; keep the surrounding comment style — this codebase explains
   *why*, not *what*, and the comments are load-bearing documentation.
3. Add a `CHANGELOG.md` entry under `## [Unreleased]`, using
   `### Added` / `### Changed` / `### Fixed`. Create the `## [Unreleased]`
   heading if it is not there. **Do not** touch `.claude-plugin/plugin.json`.
4. Update `README.md` if you changed anything user-facing — env vars have a row
   in the [Configuration](README.md#configuration-env-vars) table.
5. Open the PR. The template will prompt you through the checklist.

Small, focused PRs get reviewed faster. Two unrelated changes are two PRs.

---

## Cutting a release (maintainer)

Versioning is [SemVer](https://semver.org) at `0.x`:

- **MINOR** for a new user-facing feature — a style preset, a provider, a new
  env var.
- **PATCH** for fixes only, nothing new. (0.7.1.)

Three files carry the release version: `.claude-plugin/plugin.json`,
`plugins/claudish-to-english/.codex-plugin/plugin.json`, and `CHANGELOG.md`.
The marketplace manifests do not pin one.

With Claude Code, run `/release <version>` and it does all of this. By hand:

```bash
# 1. branch
git switch -c release/0.9.0 origin/main

# 2. CHANGELOG.md: "## [Unreleased]"  ->  "## [0.9.0] - YYYY-MM-DD"

# 3. CHANGELOG.md link refs at the bottom: add the new version, repoint Unreleased
#    [Unreleased]: https://github.com/ValerioL29/claudish-to-english/compare/v0.9.0...HEAD
#    [0.9.0]:      https://github.com/ValerioL29/claudish-to-english/compare/v0.8.0...v0.9.0

# 4. Both Claude and Codex plugin.json files: bump "version" together

# 5. commit, push, PR, review, merge
git commit -am "chore: v0.9.0 — <one-line summary>"
gh pr create --base main --title "chore: v0.9.0 — <summary>"

# 6. tag the MERGE COMMIT (not the bump commit), then push the tag
git switch main && git pull --ff-only
git tag v0.9.0 <merge-commit-sha>
git push origin v0.9.0

# 7. GitHub release, notes taken from the CHANGELOG section
gh release create v0.9.0 --title "v0.9.0 — <summary>" --notes-file <section>
```

Two details that are easy to get wrong:

- **Tag the merge commit**, not the `chore:` bump commit. Tagging the bump leaves
  the release-branch commits dangling in `compare/vX...HEAD` next cycle.
- **Every heading needs a link ref.** After editing, check that the set of
  `## [x]` headings and the set of `[x]:` refs at the bottom agree.

Sanity check before merging a release PR:

```bash
jq -r .version .claude-plugin/plugin.json      # matches the new heading
grep -c '^## \[' CHANGELOG.md                  # one more than last release
for f in *.sh; do bash -n "$f" || echo FAIL; done
```
