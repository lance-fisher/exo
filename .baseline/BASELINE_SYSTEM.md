# Baseline System Definition

## Identity

- **Baseline Name:** exo
- **Baseline Root:** Repository root (relative — works at any clone location)
- **Local Deployment Target:** `D:\ProjectsHome\exo` (within the `D:\ProjectsHome` ecosystem)
- **Baseline Type:** Protected master baseline
- **Status:** Active, protected, non-destructive

## Purpose

This repository serves as the **protected master baseline** for the exo project ecosystem. It is the canonical parent system from which all future derivative work (branches, forks, experiments, bots, automation layers, and elevated-risk systems) must derive.

## Core Principles

1. **The baseline is protected.** No speculative cleanup, broad refactors, or destructive modifications without explicit authorization.
2. **Branch by default.** All new work (projects, bots, experiments, automation) must be created as derivative branches, not as uncontrolled modifications to the baseline.
3. **Inherit intelligently.** Branches should consult the inheritance map (`.baseline/inheritance_map.json`) to determine what to copy, reference, or template from the baseline.
4. **Non-destructive by default.** Additive changes are preferred. Deletions require explicit instruction.
5. **Isolate elevated-risk work.** Powerful, invasive, or system-integrated work goes into the elevated-risk zone (`.baseline/elevated/`).

## What This Baseline Contains

- The complete exo distributed AI inference codebase
- Project configuration (pyproject.toml, setup.py, ruff.toml, .pylintrc)
- CI/CD configuration (.circleci/)
- Documentation (docs/, README.md)
- Examples (examples/)
- The baseline branch architecture framework (.baseline/)

## What Future Sessions Must Do First

1. Read `CLAUDE.md` at the repository root
2. Consult `.baseline/BASELINE_SYSTEM.md` (this file)
3. Review `.baseline/inheritance_map.json` for inheritance rules
4. Determine whether the work requires a new branch
5. Determine the appropriate risk tier (see `RISK_TIER_MODEL.md`)
6. Use the branch creation guide or script if creating a new branch
7. Never modify the master baseline directly without explicit authorization

## Ecosystem Context and Root Governance Supremacy

This project operates within `D:\ProjectsHome` as one repository in a broader local ecosystem. The `D:\ProjectsHome` root directory contains **established, authoritative root-level governance files** (including the root `CLAUDE.md` and other root rules files). These root files are the **supreme authority** for all work conducted within the ecosystem.

### Absolute Rules Regarding Root Governance

1. **Root governance files must never be altered, overwritten, replaced, renamed, minimized, or removed** by any action taken within this project or any of its branches.
2. **Root governance files may only ever be added to**, and only in ways that enhance security, privacy, and protection of data and personal information (including data on the local device).
3. **Root governance takes precedence** over all project-level and branch-level rules. If a conflict exists, root governance wins unconditionally.
4. **No session, branch, script, or automation** operating within this project has authority to alter root-level governance.
5. **Future Claude Code sessions** must read and obey root governance before consulting project-level files.

### Governance Hierarchy

```
Root governance (D:\ProjectsHome\CLAUDE.md + root rules files)   ← AUTHORITATIVE
  └─ Project governance (exo\CLAUDE.md + exo\.baseline\)         ← SUPPLEMENTAL
       └─ Branch-local governance (BRANCH_RULES.md, etc.)        ← SCOPED TO BRANCH
```

The governance framework uses relative paths and works on any platform. See `.baseline/LOCAL_MACHINE_DEPLOYMENT.md` for deployment instructions and `.baseline/ecosystem_integration.json` for machine-readable integration data.

## Governance

See also:
- `.baseline/BRANCHING_POLICY.md` - Branch-first rules
- `.baseline/RISK_TIER_MODEL.md` - Risk tier definitions
- `.baseline/SYSTEM_INHERITANCE_RULES.md` - Inheritance logic
- `.baseline/BRANCH_CREATION_GUIDE.md` - How to create branches
- `.baseline/GIT_BRANCHING_POLICY.md` - Git-safe operations
- `.baseline/CLAUDE_CODE_ENTRYPOINT.md` - Future session guidance
- `.baseline/LOCAL_MACHINE_DEPLOYMENT.md` - Local machine deployment guide
- `.baseline/ecosystem_integration.json` - Machine-readable ecosystem integration data
