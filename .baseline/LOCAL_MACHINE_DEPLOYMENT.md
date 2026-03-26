# Local Machine Deployment Guide

## Target Environment

- **Local Path:** `D:\ProjectsHome\exo`
- **Platform:** Windows
- **Master Baseline:** `D:\ProjectsHome` (parent ecosystem)
- **This Project:** One baseline-governed repository within the ecosystem

## Deployment Steps

### Step 1: Clone to Local Machine

```powershell
cd D:\ProjectsHome
git clone https://github.com/lance-fisher/exo.git
cd exo
```

### Step 2: Fetch the Baseline Architecture Branch

```powershell
git fetch origin claude/baseline-branch-architecture-Up7HI
git checkout claude/baseline-branch-architecture-Up7HI
```

Or, if you want the architecture merged into main:

```powershell
git checkout main
git merge origin/claude/baseline-branch-architecture-Up7HI
```

### Step 3: Verify the Baseline Framework

```powershell
# Confirm all governance files exist
dir .baseline\
dir .baseline\templates\
dir .baseline\elevated\
dir .baseline\scripts\
dir .baseline\branches\

# Confirm CLAUDE.md exists
dir CLAUDE.md
```

### Step 4: Test the Branch Creation Script

```powershell
python .baseline\scripts\create_branch.py --dry-run --name test --type feature --purpose "Test branch creation"
```

### Step 5: Install Dependencies (Optional)

```powershell
pip install -e .
```

## Integration with D:\ProjectsHome Ecosystem

This repository is designed to function as **one project within a larger `D:\ProjectsHome` ecosystem**. The baseline architecture supports this by:

1. **Self-contained governance** - All `.baseline/` files use relative paths. No absolute path dependencies.
2. **Cross-platform scripts** - `create_branch.py` uses `os.path` for platform-agnostic path handling.
3. **Portable manifests** - All JSON manifests use relative paths from repo root.
4. **No system-level dependencies** - The governance framework requires only Python and Git.

## Ecosystem-Level Integration

If `D:\ProjectsHome` has its own governance layer (e.g., a root-level `CLAUDE.md`, `PROJECTS_HOME_GOVERNANCE.md`, or similar), this project's `.baseline/` framework is designed to coexist:

- The repo-level `CLAUDE.md` governs this project specifically
- The repo-level `.baseline/` governs branching within this project
- A parent-level governance file at `D:\ProjectsHome\CLAUDE.md` (if it exists) governs the broader ecosystem
- There is no conflict - project-level rules apply within the project directory

## D:\ProjectsHome Directory Layout (Expected)

```
D:\ProjectsHome\
  CLAUDE.md                    # (Optional) Ecosystem-level session guidance
  PROJECTS_HOME_GOVERNANCE.md  # (Optional) Ecosystem governance
  exo\                         # This repository
    CLAUDE.md                  # Project-level session guidance
    .baseline\                 # Branch architecture framework
    exo\                       # Source code
    ...
  other-project\               # Other projects in the ecosystem
  ...
```

## Path Conventions

All paths within this project are **relative to the repository root**. This ensures:
- Works identically on Linux (`/home/user/exo/`) and Windows (`D:\ProjectsHome\exo\`)
- No hardcoded absolute paths in governance files, manifests, or scripts
- Clone to any location and it works immediately

## PowerShell Equivalents

The branch creation script works on Windows via Python. For PowerShell convenience:

```powershell
# Create a feature branch
python .baseline\scripts\create_branch.py --name my-feature --type feature --purpose "Description"

# Create an elevated branch
python .baseline\scripts\create_branch.py --name my-bot --type elevated --purpose "Bot system" --risk-tier 4

# Dry run (preview only)
python .baseline\scripts\create_branch.py --dry-run --name test --type experiment --purpose "Testing"
```

## Resuming a Claude Code Session on Local Machine

When you resume a Claude Code session inside `D:\ProjectsHome\exo`:

1. Claude Code reads `CLAUDE.md` automatically
2. It will see the baseline architecture instructions
3. It will know to consult `.baseline/CLAUDE_CODE_ENTRYPOINT.md`
4. It will follow branch-first governance
5. All the framework files are in place and self-referencing

No additional setup is needed beyond cloning and checking out the branch.
