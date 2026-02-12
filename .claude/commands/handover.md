Generate a handover document for the next Claude Code session.

Review the full conversation history and create a structured handover file at `.claude/handover.md` with the following sections:

## Instructions

1. **Analyze the session**: Review everything discussed, decided, implemented, and discovered in this session.
2. **Write the handover document** to `.claude/handover.md` with this structure:

```markdown
# Session Handover

## Summary
A 2-3 sentence overview of what was accomplished this session.

## What Was Done
- Bullet list of completed work with file paths where relevant
- Include specific changes made (not vague descriptions)

## Key Decisions
- Decisions made during this session and the reasoning behind them
- Any trade-offs that were considered

## Current State
- What is working
- What is broken or incomplete
- Any failing tests or known issues

## Next Steps
- Prioritized list of what should be done next
- Include enough context that a fresh session can pick up immediately

## Open Questions
- Unresolved questions or ambiguities
- Things that need user input or further investigation

## Important Context
- Non-obvious things a new session needs to know
- Gotchas, workarounds, or quirks discovered
- Key file paths and their roles relevant to the current work
```

3. **Be specific**: Reference actual file paths, function names, error messages, and concrete details. Avoid vague summaries.
4. **Be concise**: Every line should carry useful information. No filler.
5. After writing the file, confirm it was created and give a brief summary of its contents.
