#!/usr/bin/env bash
# Shared with the self-contained Codex plugin and the agentish-rewriter skill.
# Keep this entry point so the Claude hooks and their fail-open behavior stay intact.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/plugins/claudish-to-english/skills/agentish-rewriter/scripts/providers.sh"
