@echo off
REM =============================================
REM  GitHub Repository Cleanup Script
REM  Run this from your exo repo directory
REM  on your Windows machine
REM =============================================

echo.
echo  ========================================
echo   GitHub Repo Cleanup for lance-fisher/exo
echo  ========================================
echo.
echo  This will:
echo    - Delete 5 already-merged stale branches
echo    - Delete 1 dead-end branch
echo    - Leave main and active work branches intact
echo.

cd /d D:\ProjectsHome\distributed-claude-agents
if %errorlevel% neq 0 (
    echo Could not find project directory.
    echo Run this from your exo repo directory instead.
    pause
    exit /b 1
)

echo Step 1: Fetching latest from GitHub...
git fetch --all --prune

echo.
echo Step 2: Deleting MERGED branches (already in main, safe to remove)...
echo.

echo   Deleting origin/astra (merged via PR #157)...
git push origin --delete astra 2>nul
if %errorlevel%==0 (echo     Done.) else (echo     Already deleted or error.)

echo   Deleting origin/better_downloads (merged via PR #138)...
git push origin --delete better_downloads 2>nul
if %errorlevel%==0 (echo     Done.) else (echo     Already deleted or error.)

echo   Deleting origin/circleci-project-setup (merged, 98 commits behind)...
git push origin --delete circleci-project-setup 2>nul
if %errorlevel%==0 (echo     Done.) else (echo     Already deleted or error.)

echo   Deleting origin/exo_interfaces (merged, 35 commits behind)...
git push origin --delete exo_interfaces 2>nul
if %errorlevel%==0 (echo     Done.) else (echo     Already deleted or error.)

echo   Deleting origin/refactor_model_download (merged, 40 commits behind)...
git push origin --delete refactor_model_download 2>nul
if %errorlevel%==0 (echo     Done.) else (echo     Already deleted or error.)

echo.
echo Step 3: Deleting DEAD-END branch...
echo.

echo   Deleting origin/exo_aware_prompt (1 commit, 173 behind main, unsalvageable)...
git push origin --delete exo_aware_prompt 2>nul
if %errorlevel%==0 (echo     Done.) else (echo     Already deleted or error.)

echo.
echo Step 4: Pruning local tracking references...
git remote prune origin

echo.
echo  ========================================
echo   Cleanup complete!
echo  ========================================
echo.
echo  Remaining branches:
git branch -r
echo.
echo  The following branches contain separate projects
echo  that should become their own repos (see github-reorg-guide.md):
echo.
echo    claude/init-scls-uOi0s          - AI Memory System (SCLS)
echo    claude/medspa-mobile-app-AKyo6  - Harmony Medspa App
echo    claude/project-dashboard-hub    - Project Dashboard
echo    claude/review-images-new-project - Mission Control
echo    claude/rts-game-prototype       - Frontier Bastion (RTS Game)
echo    claude/start-new-project-06bsC  - Trading Bot
echo.
pause
