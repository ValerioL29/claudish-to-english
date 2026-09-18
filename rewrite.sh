#!/usr/bin/env bash
# Keep the Claude entry point while sharing the engine with other hosts.
engine="$(cd "$(dirname "$0")" && pwd)/plugins/claudish-to-english/hooks/rewrite.sh"
[ -r "$engine" ] || exit 0
exec bash "$engine" "$@"
