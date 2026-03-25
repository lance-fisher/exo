# Git Branching Policy

## Core Rule

The `main` branch is the protected master baseline. All Git operations must respect this protection.

## Safe Git Operations

### Creating a Branch
```bash
git checkout main
git pull origin main
git checkout -b <type>/<name>
```

### Pushing a Branch
```bash
git push -u origin <type>/<name>
```

### Creating a Pull Request
- Always target `main` as the base branch
- Include branch identity context in the PR description
- Reference the risk tier if Tier 2+

## Prohibited Git Operations (Without Authorization)

- `git push --force` to `main`
- `git reset --hard` on `main`
- Rewriting history on `main`
- Deleting `main`
- Direct commits to `main` (use PRs)

## Repository Initialization for Sub-Projects

If a branch needs to become a separate repository:

1. The branch should be self-contained in a subdirectory
2. Use `git subtree` or create a new repository - do NOT convert the baseline
3. Track parentage in the branch manifest:
   ```json
   {
     "parent_baseline": "exo",
     "parent_branch": "main",
     "repo_intent": "standalone"
   }
   ```

## .gitignore Management

- The baseline `.gitignore` covers standard Python project patterns
- Branches may add to `.gitignore` but should not remove baseline entries
- Branch-local secrets/credentials: add to `.gitignore` immediately
- Never commit `.env`, credentials, API keys, or tokens

## Branch-to-Repository Traceability

When a branch becomes a standalone repository:

1. Create a `PARENT_BASELINE_REFERENCE.txt` in the new repo:
   ```
   Parent Baseline: exo
   Source Branch: feature/my-feature
   Forked Date: YYYY-MM-DD
   Baseline Commit: <commit-hash>
   ```

2. Document in the branch manifest:
   ```json
   {
     "repo_status": "standalone",
     "forked_from_commit": "<hash>"
   }
   ```

## Secrets and Configuration

- Use `.env.example` files as templates (never commit actual `.env`)
- Use placeholder values in committed configs
- Document required environment variables in branch README or identity files
- Never commit credentials, tokens, or API keys to any branch
