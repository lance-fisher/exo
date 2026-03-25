# System Inheritance Rules

## Overview

When a new branch is created from the baseline, it must inherit the correct files, rules, and conventions. Not everything should be blindly copied. This document defines the inheritance model.

## Inheritance Modes

### A. Direct Copy
Files that every new branch physically receives during initialization via git branching. Since branches in git inherit the full tree, "direct copy" means these files are expected to be present and used as-is.

### B. Central Reference
Files that should remain in the baseline and be referenced by path rather than duplicated. Branches should read these from the baseline (main branch) rather than maintaining local copies.

### C. Template Instantiation
Files that generate branch-local versions. Templates live in `.baseline/templates/` and are instantiated with branch-specific values during branch creation.

### D. Optional Import
Files relevant only to certain branch types. The branch creator decides whether to include them based on the branch purpose.

### E. Prohibited Inheritance
Files that must never automatically flow into new branches because they are sensitive, baseline-specific, or irrelevant to derivative work.

## Inheritance Map Summary

| File/Directory | Mode | Notes |
|---|---|---|
| `exo/` | A: Direct Copy | Core source code - inherited via git branch |
| `examples/` | A: Direct Copy | Example code - inherited via git branch |
| `tinychat/` | A: Direct Copy | Chat interface - inherited via git branch |
| `main.py` | A: Direct Copy | Entry point |
| `setup.py` | A: Direct Copy | Package setup |
| `pyproject.toml` | A: Direct Copy | Tool configuration |
| `ruff.toml` | A: Direct Copy | Linter configuration |
| `.pylintrc` | A: Direct Copy | Lint rules |
| `.gitignore` | A: Direct Copy | Git ignore rules |
| `LICENSE` | A: Direct Copy | License file |
| `README.md` | A: Direct Copy | Project documentation |
| `.circleci/` | D: Optional | CI config - only for branches that modify CI |
| `docs/` | A: Direct Copy | Documentation assets |
| `.baseline/BASELINE_SYSTEM.md` | B: Central Reference | Read from baseline, do not modify in branches |
| `.baseline/BRANCHING_POLICY.md` | B: Central Reference | Read from baseline, do not modify in branches |
| `.baseline/RISK_TIER_MODEL.md` | B: Central Reference | Read from baseline, do not modify in branches |
| `.baseline/SYSTEM_INHERITANCE_RULES.md` | B: Central Reference | This file - read from baseline |
| `.baseline/inheritance_map.json` | B: Central Reference | Machine-readable map |
| `.baseline/baseline_manifest.json` | B: Central Reference | Baseline inventory |
| `.baseline/templates/` | C: Template Source | Templates for branch creation |
| `.baseline/elevated/` | E: Prohibited | Elevated-risk zone - never auto-inherited |
| `.baseline/scripts/` | D: Optional | Branch creation tools |
| `.baseline/branches/` | E: Prohibited | Branch registry - baseline-only |
| `CLAUDE.md` | B: Central Reference | Session entrypoint |
| `extra/` | D: Optional | Extra utilities |
| `format.py` | A: Direct Copy | Code formatter |
| `lint.sh` | A: Direct Copy | Lint script |
| `install.sh` | A: Direct Copy | Install script |

## Branch-Local Overrides

Branches may create local override files that take precedence over baseline rules within that branch:

- `BRANCH_RULES.md` - Branch-specific rules that override baseline defaults
- `BRANCH_IDENTITY.md` - Branch metadata and purpose
- `branch_manifest.json` - Machine-readable branch metadata
- `LOCAL_OVERRIDES.md` - Explicit documentation of what differs from baseline

## Override Precedence

1. Branch-local rules (highest priority within the branch)
2. Baseline governance rules (default)
3. Git repository conventions (lowest - implicit)

## How Future Sessions Should Use This

1. Read `.baseline/inheritance_map.json` for machine-readable inheritance data
2. Determine branch type and risk tier
3. Apply inheritance rules accordingly
4. Create branch-local governance files from templates
5. Document any deviations in `LOCAL_OVERRIDES.md`
