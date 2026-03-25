# Branch Creation Guide

## Quick Start

### Option 1: Using the Bootstrap Script

```bash
python .baseline/scripts/create_branch.py \
  --name my-feature \
  --type feature \
  --purpose "Add support for new model architecture" \
  --risk-tier 1
```

### Option 2: Manual Branch Creation

1. Create the branch from `main`:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b feature/my-feature
   ```

2. Create branch identity files (copy from templates):
   ```bash
   cp .baseline/templates/BRANCH_IDENTITY_TEMPLATE.md BRANCH_IDENTITY.md
   cp .baseline/templates/branch_manifest_template.json branch_manifest.json
   ```

3. Edit `BRANCH_IDENTITY.md` and `branch_manifest.json` with branch-specific values.

4. Commit the branch identity files:
   ```bash
   git add BRANCH_IDENTITY.md branch_manifest.json
   git commit -m "Initialize branch identity for feature/my-feature"
   ```

## Branch Types

| Type | Prefix | Risk Tier | Description |
|---|---|---|---|
| `feature` | `feature/` | 1 | Standard feature development |
| `fix` | `fix/` | 1 | Bug fixes |
| `docs` | `docs/` | 0 | Documentation only |
| `experiment` | `experiment/` | 1-2 | Experimental work |
| `bot` | `bot/` | 3 | Bot or agent system |
| `auto` | `auto/` | 2 | Automation / CI changes |
| `elevated` | `elevated/` | 4 | High-authority / invasive system |
| `claude` | `claude/` | 1-2 | Claude Code session work |

## Decision Checklist

Before creating a branch, determine:

- [ ] **Branch name** - descriptive, following naming conventions
- [ ] **Branch type** - from the table above
- [ ] **Purpose** - one-sentence description of what the branch will do
- [ ] **Risk tier** - 0-4 based on the Risk Tier Model
- [ ] **Git-backed?** - will this become a separate repository?
- [ ] **Needs local overrides?** - does this branch need to override baseline rules?
- [ ] **Elevated zone?** - does this belong in `.baseline/elevated/`?

## For Elevated-Risk Branches (Tier 3-4)

Elevated-risk branches require additional steps:

1. Use the elevated branch template:
   ```bash
   cp .baseline/elevated/elevated_branch_manifest_template.json branch_manifest.json
   ```

2. Document the authority requirements in `BRANCH_IDENTITY.md`

3. Ensure the branch manifest clearly labels:
   - Risk tier (3 or 4)
   - External integrations
   - Required permissions
   - Potential impact scope

4. Tier 4 branches should be developed in isolation and require explicit approval before any merge to baseline.

## For Claude Code Sessions

When a Claude Code session needs to create a branch:

1. Read `CLAUDE.md` and `.baseline/CLAUDE_CODE_ENTRYPOINT.md`
2. Determine the appropriate branch type and risk tier
3. Use the script or follow manual steps above
4. Always create branch identity files
5. Never modify baseline governance files without authorization
