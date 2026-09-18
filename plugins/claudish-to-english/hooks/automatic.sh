#!/usr/bin/env bash
# Adapt a completed answer to the shared engine. Always append; the original
# has already been displayed. Codex expects JSON, OpenCode needs just the suffix.
set -uo pipefail
[ "${CLAUDISH_INTERNAL:-0}" != 1 ] || exit 0
command -v jq >/dev/null 2>&1 || exit 0
case "${1:-}" in codex|opencode) host="$1" ;; *) exit 0 ;; esac
work="$(mktemp -d "${TMPDIR:-/tmp}/claudish-auto.XXXXXX" 2>/dev/null)" || exit 0
trap 'rm -rf "$work"' EXIT
engine="$(cd "$(dirname "$0")" && pwd)/rewrite.sh"
[ -r "$engine" ] || exit 0

# No host IDs or document text become filesystem paths or shell arguments.
jq -e --arg host "$host" '
  (if $host == "codex" then
    select(.hook_event_name == "Stop" and .stop_hook_active != true)
    | .last_assistant_message
  else .text end) as $text
  | select(($text | type) == "string")
  | select(($text | length) > 0)
  | select($text | startswith("<!-- claudish:original -->") | not)
  | {session_id:"automatic", message_id:"answer", index:0, final:true,
     delta:$text, cwd:.cwd}
' > "$work/input.json" 2>/dev/null || exit 0

# Reuse prompts, language/style/model flags, threshold, and fail-open behavior.
# Other hosts do not inherit Claude project language settings by accident.
CLAUDISH_MODE=append CLAUDISH_MODE_FILE=/dev/null CLAUDISH_NOTICE=0 \
  CLAUDISH_LANG="${CLAUDISH_LANG-}" TMPDIR="$work" \
  bash "$engine" < "$work/input.json" > "$work/result.json" 2>/dev/null || exit 0
jq -ej --slurpfile input "$work/input.json" '
  .hookSpecificOutput.displayContent
  | select(type == "string")
  | select(startswith($input[0].delta))
  | .[($input[0].delta | length):]
  | select(length > 0)
' "$work/result.json" > "$work/rewrite.txt" 2>/dev/null || exit 0
[ -s "$work/rewrite.txt" ] || exit 0
if [ "$host" = codex ]; then
  jq -n --rawfile text "$work/rewrite.txt" '{systemMessage:$text}' 2>/dev/null || true
else
  cat "$work/rewrite.txt"
fi
exit 0
