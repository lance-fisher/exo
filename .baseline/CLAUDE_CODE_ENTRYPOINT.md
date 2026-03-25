# Claude Code Session Entrypoint

## First Steps for Every Session

1. **Read `CLAUDE.md`** at the repository root for project-specific guidance.
2. **Read this file** to understand the baseline architecture.
3. **Determine your task scope** - is it a modification to the baseline or derivative work?

## Understanding This System

This repository uses a **branch-first baseline architecture**:

- The `main` branch is the **protected master baseline**
- All new work must be created as **derivative branches**
- Branches inherit rules and structure from the baseline intelligently
- Elevated-risk work is isolated in `.baseline/elevated/`

## Key Files to Consult

| File | Purpose |
|---|---|
| `CLAUDE.md` | Project rules, coding standards, session guidance |
| `.baseline/BASELINE_SYSTEM.md` | Master baseline definition |
| `.baseline/BRANCHING_POLICY.md` | How branches work |
| `.baseline/RISK_TIER_MODEL.md` | Risk tier definitions (0-4) |
| `.baseline/SYSTEM_INHERITANCE_RULES.md` | What branches inherit |
| `.baseline/inheritance_map.json` | Machine-readable inheritance data |
| `.baseline/baseline_manifest.json` | Baseline inventory |
| `.baseline/BRANCH_CREATION_GUIDE.md` | How to create branches |
| `.baseline/GIT_BRANCHING_POLICY.md` | Git safety rules |

## Decision Tree

```
Is this a new project, bot, experiment, or system?
  YES -> Create a derivative branch (see BRANCH_CREATION_GUIDE.md)
    Is it high-risk (Tier 3-4)?
      YES -> Use elevated branch template, isolate appropriately
      NO  -> Use standard branch template
  NO -> Is this a modification to existing baseline code?
    YES -> Create a feature/fix branch, submit PR
    NO  -> Read-only operation, no branch needed
```

## Rules for Claude Code Sessions

1. **Never modify baseline governance files** (`.baseline/`) without explicit authorization
2. **Always work on a branch** - never commit directly to `main`
3. **Consult the inheritance map** before deciding what files to create or modify
4. **Determine risk tier** before building any automation, bot, or agent system
5. **Create branch identity files** when starting a new branch
6. **Preserve the baseline** - additive changes only, no destructive operations
7. **Document deviations** - if you override a baseline rule, document it in `LOCAL_OVERRIDES.md`

## Coding Standards (From Baseline)

- **Indent:** 2 spaces
- **Max line length:** 200
- **Formatter:** black
- **Linter:** ruff + pylint
- **Import sorter:** isort (profile=black)

## When in Doubt

- Read the baseline governance files
- Choose the more conservative option
- Branch instead of modify
- Ask the user for clarification
- Never assume elevated authority without explicit authorization
