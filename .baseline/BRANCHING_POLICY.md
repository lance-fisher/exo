# Branching Policy

## Default Rule

**All new work must be created as a derivative branch, not as a direct modification to the master baseline.**

This applies to:
- New features
- Bug fixes (via feature branches)
- Experiments and prototypes
- Bot systems
- Automation layers
- Agent systems
- Orchestration tools
- GitHub-backed projects
- Any system with elevated authority or invasive behavior

## What Constitutes the Master Baseline

The `main` branch of this repository is the master baseline. Direct pushes to `main` should only occur through reviewed pull requests or explicit authorization.

## Branch Naming Conventions

| Branch Type | Pattern | Example |
|---|---|---|
| Feature | `feature/<name>` | `feature/new-inference-engine` |
| Bug fix | `fix/<name>` | `fix/grpc-timeout` |
| Experiment | `experiment/<name>` | `experiment/llama4-support` |
| Bot/Agent | `bot/<name>` | `bot/auto-benchmarker` |
| Automation | `auto/<name>` | `auto/nightly-tests` |
| Elevated-risk | `elevated/<name>` | `elevated/system-orchestrator` |
| Claude Code | `claude/<name>` | `claude/baseline-branch-architecture` |

## Branch Lifecycle

1. **Create** - Use `.baseline/scripts/create_branch.py` or follow `.baseline/BRANCH_CREATION_GUIDE.md`
2. **Develop** - Work within the branch. Consult inheritance map for baseline references.
3. **Review** - Submit PR for integration back to baseline (if appropriate)
4. **Merge or Archive** - Completed work merges; abandoned work is archived

## Branch Isolation Rules

- Branches must not modify `.baseline/` governance files without explicit authorization
- Branches may create branch-local overrides via their own `BRANCH_RULES.md`
- Elevated-risk branches must be clearly labeled (see `RISK_TIER_MODEL.md`)
- Branch-local secrets, configs, and credentials must never leak to the baseline

## What Branches Inherit

See `.baseline/SYSTEM_INHERITANCE_RULES.md` and `.baseline/inheritance_map.json` for the complete inheritance specification.

## Prohibited Actions

- Direct modifications to the master baseline without authorization
- Embedding elevated-risk systems directly into the baseline
- Pushing unreviewed changes to `main`
- Deleting baseline files from within a branch
- Committing secrets or credentials to any branch
