GitHub Cleanup Scripts
======================

These scripts organize your GitHub by cleaning up the lance-fisher/exo
repository and extracting misplaced projects into their own repos.

HOW TO USE
----------
1. On your Windows machine, navigate to this directory
2. Double-click: deploy-to-desktop.bat
3. This copies 4 numbered scripts to your Desktop
4. Run them in order by double-clicking each one:

   Script 1: Deletes 6 stale/merged branches from exo
   Script 2: Installs GitHub CLI (needed for Script 3)
   Script 3: Extracts 6 projects into their own repos
   Script 4: Runs a health check, then deletes all scripts

After running all 4, only a health report file remains on Desktop.

WHAT GETS CREATED
-----------------
Six new GitHub repos under your account:
  - lance-fisher/harmony-medspa
  - lance-fisher/trading-bot
  - lance-fisher/mission-control
  - lance-fisher/frontier-bastion
  - lance-fisher/project-dashboard
  - lance-fisher/scls

WHAT GETS DELETED
-----------------
Stale branches from lance-fisher/exo:
  - astra, cline, main, update/pip, copilot/fix
  - claude/start-new-project-yELXE

Project branches from lance-fisher/exo (after extraction):
  - claude/medspa-mobile-app-AKyo6
  - claude/start-new-project-06bsC
  - claude/review-images-new-project-d1qDw
  - claude/rts-game-prototype-FmTk4
  - claude/project-dashboard-hub-O2Sx0
  - claude/init-scls-uOi0s

WHAT STAYS
----------
  - master (upstream exo default branch)
  - claude/distributed-claude-agents-oR46c (active project)
