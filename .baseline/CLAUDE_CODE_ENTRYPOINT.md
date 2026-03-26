# Claude Code Session Entrypoint

## First Steps for Every Session

1. **Obey root governance first** — The root-level governance files at `D:\ProjectsHome` (including the root `CLAUDE.md` and all root rules files) are authoritative. Read and follow them before anything below. They must never be altered, overwritten, minimized, or replaced — only ever added to in ways that enhance security, privacy, and data protection.
2. **Read `CLAUDE.md`** at the repository root for project-specific guidance.
3. **Read this file** to understand the baseline architecture.
4. **Determine your task scope** — is it a modification to the baseline or derivative work?

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

1. **Root governance is supreme** — never alter, overwrite, minimize, or replace any root-level governance files at `D:\ProjectsHome`. They may only be added to, and only to enhance security, privacy, and data protection.
2. **Never modify baseline governance files** (`.baseline/`) without explicit authorization
3. **Always work on a branch** — never commit directly to `main`
4. **Consult the inheritance map** before deciding what files to create or modify
5. **Determine risk tier** before building any automation, bot, or agent system
6. **Create branch identity files** when starting a new branch
7. **Preserve the baseline** — additive changes only, no destructive operations
8. **Document deviations** — if you override a baseline rule, document it in `LOCAL_OVERRIDES.md`
9. **Protect local data** — never expose, commit, or transmit personal information, credentials, local file paths containing user data, or any sensitive content from the local device

## Coding Standards (From Baseline)

- **Indent:** 2 spaces
- **Max line length:** 200
- **Formatter:** black
- **Linter:** ruff + pylint
- **Import sorter:** isort (profile=black)

## Local Machine Context

This project is intended to live at `D:\ProjectsHome\exo` as part of a broader local ecosystem. All governance paths are relative to the repo root — no absolute paths are hardcoded. See `.baseline/LOCAL_MACHINE_DEPLOYMENT.md` for deployment details and `.baseline/ecosystem_integration.json` for machine-readable integration data.

## When in Doubt

- Read the baseline governance files
- Choose the more conservative option
- Branch instead of modify
- Ask the user for clarification
- Never assume elevated authority without explicit authorization
