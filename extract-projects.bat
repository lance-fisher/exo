@echo off
REM =============================================
REM  Extract Misplaced Projects from exo Repo
REM  Creates new GitHub repos for each project
REM  that was accidentally pushed as a branch
REM =============================================

echo.
echo  ========================================
echo   Extract Projects from exo Branches
echo  ========================================
echo.
echo  This script extracts 6 separate projects
echo  from exo branches into their own repos.
echo.
echo  PREREQUISITE: Install GitHub CLI (gh)
echo    winget install GitHub.cli
echo    gh auth login
echo.
pause

set EXO_REPO=https://github.com/lance-fisher/exo.git
set TEMP_DIR=%TEMP%\exo-extract
set PROJECTS_HOME=D:\ProjectsHome

REM Create temp working directory
mkdir "%TEMP_DIR%" 2>nul

REM ── Project 1: Harmony Medspa ──
echo.
echo [1/6] Extracting Harmony Medspa...
echo   Creating repo lance-fisher/harmony-medspa...
gh repo create harmony-medspa --public --description "Production medspa booking system with React Native and NestJS" 2>nul
cd /d "%TEMP_DIR%"
git clone -b claude/medspa-mobile-app-AKyo6 "%EXO_REPO%" harmony-medspa 2>nul
cd harmony-medspa
git remote remove origin
git remote add origin https://github.com/lance-fisher/harmony-medspa.git
git branch -m main 2>nul
git push -u origin main 2>nul
echo   Done.

REM ── Project 2: Trading Bot ──
echo.
echo [2/6] Extracting Trading Bot...
gh repo create trading-bot --public --description "Polymarket prediction market trading bot" 2>nul
cd /d "%TEMP_DIR%"
git clone -b claude/start-new-project-06bsC "%EXO_REPO%" trading-bot 2>nul
cd trading-bot
git remote remove origin
git remote add origin https://github.com/lance-fisher/trading-bot.git
git branch -m main 2>nul
git push -u origin main 2>nul
echo   Done.

REM ── Project 3: Mission Control ──
echo.
echo [3/6] Extracting Mission Control...
gh repo create mission-control --public --description "Next.js project management dashboard" 2>nul
cd /d "%TEMP_DIR%"
git clone -b claude/review-images-new-project-d1qDw "%EXO_REPO%" mission-control 2>nul
cd mission-control
git remote remove origin
git remote add origin https://github.com/lance-fisher/mission-control.git
git branch -m main 2>nul
git push -u origin main 2>nul
echo   Done.

REM ── Project 4: Frontier Bastion (RTS Game) ──
echo.
echo [4/6] Extracting Frontier Bastion...
gh repo create frontier-bastion --public --description "Web-based C&C-inspired real-time strategy game" 2>nul
cd /d "%TEMP_DIR%"
git clone -b claude/rts-game-prototype-FmTk4 "%EXO_REPO%" frontier-bastion 2>nul
cd frontier-bastion
git remote remove origin
git remote add origin https://github.com/lance-fisher/frontier-bastion.git
git branch -m main 2>nul
git push -u origin main 2>nul
echo   Done.

REM ── Project 5: Project Dashboard ──
echo.
echo [5/6] Extracting Project Dashboard...
gh repo create project-dashboard --public --description "Python project management dashboard" 2>nul
cd /d "%TEMP_DIR%"
git clone -b claude/project-dashboard-hub-O2Sx0 "%EXO_REPO%" project-dashboard 2>nul
cd project-dashboard
git remote remove origin
git remote add origin https://github.com/lance-fisher/project-dashboard.git
git branch -m main 2>nul
git push -u origin main 2>nul
echo   Done.

REM ── Project 6: SCLS ──
echo.
echo [6/6] Extracting SCLS...
gh repo create scls --public --description "Scratchpad Continual Learning System - AI memory and session tooling" 2>nul
cd /d "%TEMP_DIR%"
git clone -b claude/init-scls-uOi0s "%EXO_REPO%" scls 2>nul
cd scls
git remote remove origin
git remote add origin https://github.com/lance-fisher/scls.git
git branch -m main 2>nul
git push -u origin main 2>nul
echo   Done.

REM ── Clean up old branches from exo ──
echo.
echo Cleaning up old branches from exo repo...
cd /d "%PROJECTS_HOME%\distributed-claude-agents"
git push origin --delete claude/medspa-mobile-app-AKyo6 2>nul
git push origin --delete claude/start-new-project-06bsC 2>nul
git push origin --delete claude/review-images-new-project-d1qDw 2>nul
git push origin --delete claude/rts-game-prototype-FmTk4 2>nul
git push origin --delete claude/project-dashboard-hub-O2Sx0 2>nul
git push origin --delete claude/init-scls-uOi0s 2>nul

REM ── Clean up temp directory ──
echo Cleaning up temp files...
rmdir /s /q "%TEMP_DIR%" 2>nul

echo.
echo  ========================================
echo   Extraction complete!
echo  ========================================
echo.
echo  New repos created on GitHub:
echo    lance-fisher/harmony-medspa
echo    lance-fisher/trading-bot
echo    lance-fisher/mission-control
echo    lance-fisher/frontier-bastion
echo    lance-fisher/project-dashboard
echo    lance-fisher/scls
echo.
echo  Old branches removed from exo repo.
echo  Your exo repo is now clean.
echo.
pause
