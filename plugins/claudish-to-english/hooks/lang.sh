#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Output-language resolver for claudish-to-english. Sourced by rewrite.sh,
# rewrite-md.sh, claudish-ctl.sh and session-notice.sh — not executed directly.
#
# Two languages exist here: English and 简体中文. claudish_language [CWD] prints
# one of those two canonical names, or nothing — and nothing means "no language
# was configured", which leaves the rewrite in whatever language the text it
# rewrites is already written in. The rewrite direction (中→英 or 英→中) is
# therefore whatever the prompt ends up saying: a configured target, or the
# text's own language.
# First non-empty source wins:
#   1. ~/.claude/claudish-lang               /claudish language en|zh (flag file)
#   2. CLAUDISH_LANG                         explicit override. Set but EMPTY
#                                            ignores the settings below and
#                                            keeps the text's own language.
#   3. <cwd>/.claude/settings.local.json     .language
#   4. <cwd>/.claude/settings.json           .language
#   5. ~/.claude/settings.json               .language
#
# 3-5 read the same `language` key Claude Code itself reads to build the
# "# Language" block of its system prompt, in the same precedence order. So a
# session already answering in Chinese gets its rewrite in Chinese, with
# nothing extra to configure.
#
# Every value is normalised through _claudish_lang_clean, which accepts the
# usual spellings of the two languages and maps ANYTHING else to empty. That is
# also the sanitiser: a project's .claude/settings.json travels with the
# repository and is not necessarily the local user's own text, and the value
# lands in a prompt and in an on-screen label — but only one of two fixed
# strings can ever come out of here, so no foreign byte reaches either.
# Every failure — no jq, unreadable or malformed JSON, missing or non-string
# key — comes back as an empty string, never an error.
# ---------------------------------------------------------------------------

# Map a user-facing spelling to the canonical name, or to empty. Whitespace is
# dropped and ASCII case folded first ("Simplified Chinese", "zh-CN", "英文").
# tr's byte-wise case fold is safe on UTF-8: every byte of a multibyte character
# is >= 0x80, outside A-Z.
_claudish_lang_clean() {
  case "$(printf '%s' "${1:-}" | tr -d '[:space:]' | tr 'A-Z' 'a-z')" in
    en|eng|english|英文|英语)                                   printf 'English' ;;
    zh|zh-cn|zh-hans|cn|chinese|simplifiedchinese|中文|简体中文|汉语) printf '简体中文' ;;
  esac
  return 0
}

claudish_language() {
  # Runtime override written by /claudish (claudish-ctl.sh): a file re-read on
  # every message, so a `/claudish language X` switch takes effect mid-session
  # where the frozen CLAUDISH_LANG env cannot. It sits ABOVE the env and the
  # settings files for the same reason the off-file sits above CLAUDISH_ENABLED
  # — only a per-message file can be flipped without relaunching. `/claudish
  # language default` removes it and restores the resolution below. The file
  # persists across sessions (like the off-file).
  _cl_file="${CLAUDISH_LANG_FILE:-${HOME:-}/.claude/claudish-lang}"
  if [ -f "$_cl_file" ]; then
    _cl_rv="$(_claudish_lang_clean "$(head -c 64 "$_cl_file" 2>/dev/null)")"
    if [ -n "$_cl_rv" ]; then printf '%s' "$_cl_rv"; return 0; fi
  fi

  # An explicitly set CLAUDISH_LANG always wins, including an explicitly EMPTY
  # one — the escape hatch for keeping each message's own language on a session
  # whose settings name one.
  if [ -n "${CLAUDISH_LANG+x}" ]; then
    _claudish_lang_clean "$CLAUDISH_LANG"
    return 0
  fi

  _cl_cwd="${1:-$PWD}"
  for _cl_f in "$_cl_cwd/.claude/settings.local.json" \
               "$_cl_cwd/.claude/settings.json" \
               "${HOME:-}/.claude/settings.json"; do
    [ -r "$_cl_f" ] || continue
    # Guard the type: a `language` that is not a string (null, number, object)
    # must read as "unset", not as its jq stringification.
    _cl_v="$(jq -r 'if (.language | type) == "string" then .language else empty end' \
             "$_cl_f" 2>/dev/null)"
    _cl_v="$(_claudish_lang_clean "$_cl_v")"
    if [ -n "$_cl_v" ]; then printf '%s' "$_cl_v"; return 0; fi
  done
  return 0
}
