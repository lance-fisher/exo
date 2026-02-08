# GitHub Repository Organization Guide

## The Problem

Your `lance-fisher/exo` repo currently has 14 branches. Most of them are
unrelated projects that the iPhone Claude app created as branches instead
of separate repositories. This makes the repo messy and hard to navigate.

## Current State (Before Cleanup)

### Branches to DELETE (already merged into main, no work lost)

| Branch | Reason | Status |
|--------|--------|--------|
| `astra` | Merged via PR #157 | Safe to delete |
| `better_downloads` | Merged via PR #138 | Safe to delete |
| `circleci-project-setup` | Merged, 98 commits behind | Safe to delete |
| `exo_interfaces` | Merged, 35 commits behind | Safe to delete |
| `refactor_model_download` | Merged, 40 commits behind | Safe to delete |
| `exo_aware_prompt` | 1 commit, 173 behind, dead end | Safe to delete |

### Branches to KEEP in exo repo

| Branch | Purpose |
|--------|---------|
| `main` | Primary branch, the actual exo project |
| `claude/distributed-claude-agents-oR46c` | Distributed Claude Agents (this project) |

### Branches that are SEPARATE PROJECTS (should become their own repos)

These are complete, standalone projects that have nothing to do with exo.
They ended up here because the iPhone Claude app pushes to whatever repo
it has access to.

| Branch | Project Name | What It Is | Files | Lines |
|--------|-------------|------------|-------|-------|
| `claude/medspa-mobile-app-AKyo6` | Harmony Skin and Wellness | Full-stack medspa booking app (NestJS + React Native + Prisma) | 112 | 13,976 |
| `claude/start-new-project-06bsC` | Trading Bot | Polymarket prediction market trading bot (Docker, strategies, tests) | 44 | 8,042 |
| `claude/review-images-new-project-d1qDw` | Mission Control | Next.js project management app (Convex, global search, sidebar) | 40 | 8,790 |
| `claude/rts-game-prototype-FmTk4` | Frontier Bastion | Web-based C&C-style RTS game (TypeScript, Vite, ECS architecture) | 34 | 5,662 |
| `claude/project-dashboard-hub-O2Sx0` | Project Dashboard Hub | Python project management dashboard (aiohttp server + SPA) | 2 | 1,404 |
| `claude/init-scls-uOi0s` | SCLS | Scratchpad Continual Learning System (AI memory/session tooling) | 16 | 1,054 |

## How to Extract a Branch into Its Own Repo

For each project above, run these commands on your Windows machine:

```bash
# Example: extracting the medspa app

# 1. Create the new repo on GitHub (do this on github.com or with gh CLI)
#    Go to github.com/new and create "harmony-medspa"

# 2. Clone the exo repo and check out the branch
cd D:\ProjectsHome
git clone https://github.com/lance-fisher/exo.git harmony-medspa-temp
cd harmony-medspa-temp
git checkout claude/medspa-mobile-app-AKyo6

# 3. Remove the exo origin and add the new repo as origin
git remote remove origin
git remote add origin https://github.com/lance-fisher/harmony-medspa.git

# 4. Push to the new repo as main
git branch -m main
git push -u origin main

# 5. Clean up the temp clone
cd ..
rmdir /s /q harmony-medspa-temp

# 6. Delete the old branch from exo
cd D:\ProjectsHome\distributed-claude-agents
git push origin --delete claude/medspa-mobile-app-AKyo6
```

Repeat for each project, substituting the branch name and new repo name.

## Recommended New Repo Names

| Current Branch | New Repo Name | Description for GitHub |
|---------------|---------------|----------------------|
| `claude/medspa-mobile-app-AKyo6` | `harmony-medspa` | Production medspa booking system with React Native and NestJS |
| `claude/start-new-project-06bsC` | `trading-bot` | Polymarket prediction market trading bot |
| `claude/review-images-new-project-d1qDw` | `mission-control` | Next.js project management dashboard |
| `claude/rts-game-prototype-FmTk4` | `frontier-bastion` | Web-based real-time strategy game |
| `claude/project-dashboard-hub-O2Sx0` | `project-dashboard` | Python project management dashboard |
| `claude/init-scls-uOi0s` | `scls` | Scratchpad Continual Learning System |

## After Cleanup

Your exo repo will have only:
- `main` -- the actual exo distributed AI inference project
- `claude/distributed-claude-agents-oR46c` -- the Distributed Claude Agents system

And you'll have 6 new repos, each containing one clean project.

## Preventing This in the Future

The iPhone Claude app tends to push to whatever repo it has access to.
To prevent project mixing:

1. Before starting a new project on iPhone Claude, create the repo first
   on github.com (or ask Claude to create it)
2. Each project gets its own repo from the start
3. Use ProjectHub (`python server.py` at localhost:8090) to track all
   projects across repos in one dashboard

## Quick Cleanup Script

Run `github-cleanup.bat` from this project directory to delete the 6
stale/merged branches automatically. The separate-project branches
need manual extraction (instructions above).
