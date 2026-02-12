#!/usr/bin/env bash
# PreCompact Hook: Auto-generate handover document before context compaction
#
# This hook runs automatically before Claude Code compacts its conversation
# context. It signals Claude to generate/update the handover document so
# that critical session context is preserved in .claude/handover.md before
# any conversation history is lost to compaction.

echo "Session context is about to be compacted. Before proceeding, generate a handover document by following the instructions in .claude/commands/handover.md — write the output to .claude/handover.md so the next session (or post-compaction context) can pick up where we left off."
