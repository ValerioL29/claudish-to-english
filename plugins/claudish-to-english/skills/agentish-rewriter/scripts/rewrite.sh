#!/usr/bin/env bash
# One explicit rewrite through the existing CLI provider layer. Reads source
# text on stdin and prints only a successful result. The parent agent owns file
# selection, semantic review, and saving; this script never edits the source.
# Usage: bash rewrite.sh PROVIDER MODEL [INSTRUCTIONS_FILE] < source.txt
set -uo pipefail

fail() { printf 'agentish-rewriter: %s\n' "$*" >&2; exit 1; }
[ "$#" -ge 2 ] && [ "$#" -le 3 ] || fail 'usage: rewrite.sh PROVIDER MODEL [INSTRUCTIONS_FILE] < source.txt'
case "$1" in codex|agy|opencode) ;; *) fail 'provider must be codex, agy, or opencode' ;; esac
[ -n "$2" ] || fail 'an explicit model is required'
LLM_TIMEOUT="${CLAUDISH_TIMEOUT:-150}"
case "$LLM_TIMEOUT" in ''|*[!0-9]*) fail 'CLAUDISH_TIMEOUT must be a positive integer' ;; esac
[ "$LLM_TIMEOUT" -gt 0 ] || fail 'CLAUDISH_TIMEOUT must be a positive integer'

SELF_DIR="$(cd "$(dirname "$0")" && pwd)" || exit 1
dbg() { :; }
. "$SELF_DIR/providers.sh" || fail 'cannot load providers.sh'
# Explicit invocation wins over every automatic-hook setting, including a
# persisted /claudish model override. Never substitute another model on error.
PROVIDER="$1"
MODEL="$2"
sys="$(cat "$SELF_DIR/../references/rewrite.md")" || fail 'cannot read rewrite instructions'
if [ "$#" -eq 3 ]; then
  extra="$(cat -- "$3")" || fail 'cannot read instructions file'
  sys="$sys"$'\n\n'"Additional user instructions:"$'\n'"$extra"
fi
source_text="$(cat)" || fail 'cannot read source text'
[[ "$source_text" =~ [^[:space:]] ]] || fail 'source text is empty'
llm_complete "$sys" "$source_text"
[ "$llm_rc" -eq 0 ] || fail "${err:-$PROVIDER failed (exit $llm_rc)}"
[[ "$rewrite" =~ [^[:space:]] ]] || fail 'model returned an empty rewrite'
printf '%s\n' "$rewrite"
