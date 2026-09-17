#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Provider layer for claudish-to-english. Shared by the Claude hooks (through
# the root providers.sh shim) and the on-demand skill — not executed directly.
#
# Every provider is a coding-agent CLI run headless, one shot, on the local
# machine: no API keys, no base URLs, no HTTP. Whatever the CLI is already
# logged into (and whichever model it is configured for) serves the rewrite.
#
# One function does the work: llm_complete SYSTEM USER runs one prompt through
# the configured CLI and sets these globals:
#   rewrite   the completion text ("" on any failure)
#   llm_rc    0 ok; 127 CLI not on PATH; 28 timed out; 2 bad CLAUDISH_PROVIDER;
#             the CLI's own exit code otherwise
#   err       one-line error text ("" when none; the tail of stderr on a
#             non-zero exit)
# It always returns 0 — fail-open stays the caller's job, and every failure
# here comes back as an empty $rewrite, never an exit.
# llm_notice_why then maps a failure onto NOTICE_WHY, a one-line reason fit for
# the once-per-session setup notice ("" when the skip should stay silent — an
# empty completion with a clean exit).
#
# Providers (CLAUDISH_PROVIDER):
#   codex     (default) `codex exec`, --sandbox read-only, --ephemeral, run
#             outside any repo so the agent has nothing to look at. The reply
#             is taken from -o (stdout carries progress noise).
#   agy       `agy -p` (Antigravity CLI). --disable-slash-commands so a "/word"
#             in the message is never expanded as a command.
#   opencode  `opencode run --format json`. Only text events become the rewrite;
#             progress, reasoning, and error events never become document prose.
#
# Config:
#   CLAUDISH_MODEL    model passed to the CLI (-m / --model). Empty = the CLI's
#                     own configured default. Provider-agnostic, so the value
#                     must be a name THAT CLI understands (opencode wants
#                     provider/model).
#   CLAUDISH_EFFORT   reasoning effort for the rewrite only: codex takes it as
#                     -c model_reasoning_effort=X, agy as --effort X (low|
#                     medium|high); opencode has no such flag and ignores it.
#                     "low" keeps a per-message rewrite at seconds even when
#                     the CLI's coding default is a high-effort tier.
#                     CLAUDISH_CODEX_EFFORT (the upstream name) still works.
#
# The caller must define dbg() and set LLM_TIMEOUT before calling llm_complete,
# and may set TIMEOUT_HINT to customize llm_notice_why's timed-out advice.
# ---------------------------------------------------------------------------

PROVIDER="${CLAUDISH_PROVIDER:-codex}"
MODEL="${CLAUDISH_MODEL:-}"
EFFORT="${CLAUDISH_EFFORT:-${CLAUDISH_CODEX_EFFORT:-}}"

# Runtime model override written by /claudish (claudish-ctl.sh): a file re-read
# on every message, so a `/claudish model X` switch takes effect mid-session
# where the frozen CLAUDISH_MODEL env cannot. It wins over the env resolved
# above; `/claudish model default` removes it and restores that. Sanitised to
# the characters model names use — the value lands on a command line.
_model_file="${CLAUDISH_MODEL_FILE:-${HOME:-}/.claude/claudish-model}"
if [ -f "$_model_file" ]; then
  _mf="$(head -c 128 "$_model_file" 2>/dev/null | tr -cd 'A-Za-z0-9:._/-' | head -c 64)"
  [ -n "$_mf" ] && MODEL="$_mf"
fi

llm_complete() {
  _sys="$1"; _user="$2"
  rewrite=""; llm_rc=0; err=""
  case "$PROVIDER" in
    codex|agy|opencode) ;;
    *) llm_rc=2; err="unknown CLAUDISH_PROVIDER '$PROVIDER' (use codex, agy, or opencode)"; dbg "$err"; return 0 ;;
  esac
  if ! command -v "$PROVIDER" >/dev/null 2>&1; then
    dbg "$PROVIDER: CLI not found"; llm_rc=127; return 0
  fi
  if [ "$PROVIDER" = opencode ] && ! command -v jq >/dev/null 2>&1; then
    llm_rc=1; err='jq is required for OpenCode output'; return 0
  fi
  _out="$(mktemp "${TMPDIR:-/tmp}/claudish-out.XXXXXX" 2>/dev/null)" || { llm_rc=1; err="mktemp failed"; return 0; }
  _errf="$(mktemp "${TMPDIR:-/tmp}/claudish-err.XXXXXX" 2>/dev/null)" || { rm -f "$_out"; llm_rc=1; err="mktemp failed"; return 0; }
  # If the hook is killed mid-call the files must not linger in TMPDIR.
  trap 'rm -f "$_out" "$_errf" 2>/dev/null' EXIT

  # None of these CLIs has a separate system channel, so the system prompt is
  # prepended. They are coding agents with tools, and the message may mention
  # files and commands, so they are told up front that this is a pure text
  # task — the sandbox flags are the backstop, not the plan.
  _prompt="$_sys

Do not run commands, read files, or use any tools: answer directly from the text below.

$_user"

  # Codex and OpenCode accept stdin, avoiding the argv size limit on Markdown
  # documents. Each gets only this prompt, never the hook's consumed stdin.
  # Backgrounded because stock macOS has no timeout(1).
  case "$PROVIDER" in
    codex)
      codex exec --sandbox read-only --skip-git-repo-check --ephemeral --color never \
        -C "${TMPDIR:-/tmp}" ${MODEL:+-m "$MODEL"} \
        ${EFFORT:+-c "model_reasoning_effort=${EFFORT}"} \
        -o "$_out" - <<<"$_prompt" >/dev/null 2>"$_errf" &
      ;;
    agy)
      # -p takes the prompt as ITS value; every other flag must come before it.
      # ponytail: agy uses argv; use codex/opencode for documents above ARG_MAX.
      agy --disable-slash-commands --output-format text \
        ${MODEL:+--model "$MODEL"} ${EFFORT:+--effort "$EFFORT"} \
        -p "$_prompt" </dev/null >"$_out" 2>"$_errf" &
      ;;
    opencode)
      (cd "${TMPDIR:-/tmp}" && OPENCODE_PERMISSION='{"*":"deny"}' \
        exec opencode run --format json ${MODEL:+-m "$MODEL"}) \
        <<<"$_prompt" >"$_out" 2>"$_errf" &
      ;;
  esac
  _pid=$!
  _t=0
  while kill -0 "$_pid" 2>/dev/null; do
    if [ "$_t" -ge "$LLM_TIMEOUT" ]; then
      kill -TERM "$_pid" 2>/dev/null; wait "$_pid" 2>/dev/null
      llm_rc=28
      rm -f "$_out" "$_errf" 2>/dev/null
      dbg "$PROVIDER timed out after ${LLM_TIMEOUT}s"
      return 0
    fi
    sleep 1; _t=$((_t + 1))
  done
  wait "$_pid"; llm_rc=$?
  rewrite="$(cat "$_out" 2>/dev/null)"
  if [ "$llm_rc" = 0 ] && [ "$PROVIDER" = opencode ]; then
    rewrite="$(jq -rs '
      if any(.[]; .type == "error") then error("OpenCode reported an error")
      else [.[] | select(.type == "text") | .part.text // empty] | join("\n\n") end
    ' "$_out" 2>"$_errf")" || llm_rc=1
  fi
  if [ "$llm_rc" != "0" ]; then
    err="$(tail -c 400 "$_errf" 2>/dev/null | tr -s '[:space:]' ' ')"
    err="${err:-$PROVIDER exited $llm_rc}"
    rewrite=""
  fi
  rm -f "$_out" "$_errf" 2>/dev/null
  dbg "$PROVIDER model=${MODEL:-cli-default} rc=$llm_rc rewrite_bytes=${#rewrite} err=${err:-none}"
  return 0
}

llm_notice_why() {
  # shellcheck disable=SC2034  # NOTICE_WHY is read by the sourcing scripts
  NOTICE_WHY=""
  case "${llm_rc:-0}" in
    127) NOTICE_WHY="the $PROVIDER CLI is not on PATH (install it or pick another CLAUDISH_PROVIDER), so rewrites are off" ;;
    28)  NOTICE_WHY="the rewrite timed out after ${LLM_TIMEOUT}s — ${TIMEOUT_HINT:-raise the timeout}" ;;
    0)   ;;  # clean exit, empty completion: stay silent
    *)   NOTICE_WHY="${err:-$PROVIDER exited $llm_rc}" ;;
  esac
}
