@echo off
REM =============================================
REM  Step 3 of 4: Extract Projects to Own Repos
REM  Creates new GitHub repos for 6 misplaced
REM  projects that were pushed as exo branches
REM =============================================
setlocal enabledelayedexpansion

echo.
echo  ========================================
echo   Step 3/4: Extract Projects to Own Repos
echo  ========================================
echo.
echo  This will create 6 new GitHub repositories
echo  from branches that contain separate projects:
echo.
echo    1. harmony-medspa     (medspa booking system)
echo    2. trading-bot        (Polymarket bot)
echo    3. mission-control    (project management)
echo    4. frontier-bastion   (RTS game prototype)
echo    5. project-dashboard  (Python dashboard)
echo    6. scls               (AI memory system)
echo.
echo  Each project will get its own repo under
echo  your lance-fisher GitHub account.
echo.

REM Check gh is available
where gh >nul 2>nul
if errorlevel 1 (
    echo  ERROR: GitHub CLI not found.
    echo  Please run 2-install-github-cli.bat first.
    echo.
    echo  Press any key to close...
    pause >nul
    exit /b 1
)

REM Check gh is authenticated
gh auth status >nul 2>nul
if errorlevel 1 (
    echo  ERROR: Not logged in to GitHub.
    echo  Please run 2-install-github-cli.bat first.
    echo.
    echo  Press any key to close...
    pause >nul
    exit /b 1
)

echo  Press any key to start extraction...
pause >nul

set EXO_REPO=https://github.com/lance-fisher/exo.git
set TEMP_DIR=%TEMP%\exo-extract
set PROJECTS_HOME=D:\ProjectsHome
set SUCCESS=0
set FAIL=0

REM Create temp working directory
if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%"
mkdir "%TEMP_DIR%"

REM ── Project 1: Harmony Medspa ──
echo.
echo  [1/6] Harmony Medspa...
echo    Creating repo...
gh repo create harmony-medspa --public --description "Production medspa booking system with React Native and NestJS" 2>nul
echo    Cloning branch...
git clone -b claude/medspa-mobile-app-AKyo6 "%EXO_REPO%" "%TEMP_DIR%\harmony-medspa" 2>nul
if exist "%TEMP_DIR%\harmony-medspa\.git" (
    cd /d "%TEMP_DIR%\harmony-medspa"
    git remote remove origin 2>nul
    git remote add origin https://github.com/lance-fisher/harmony-medspa.git
    git branch -m main 2>nul
    echo    Pushing to new repo...
    git push -u origin main 2>nul
    if not errorlevel 1 (
        echo    [OK] harmony-medspa created
        set /a SUCCESS+=1
    ) else (
        echo    [WARN] Push failed - repo may already have content
        set /a FAIL+=1
    )
) else (
    echo    [SKIP] Branch not found or clone failed
    set /a FAIL+=1
)

REM ── Project 2: Trading Bot ──
echo.
echo  [2/6] Trading Bot...
echo    Creating repo...
gh repo create trading-bot --public --description "Polymarket prediction market trading bot" 2>nul
echo    Cloning branch...
git clone -b claude/start-new-project-06bsC "%EXO_REPO%" "%TEMP_DIR%\trading-bot" 2>nul
if exist "%TEMP_DIR%\trading-bot\.git" (
    cd /d "%TEMP_DIR%\trading-bot"
    git remote remove origin 2>nul
    git remote add origin https://github.com/lance-fisher/trading-bot.git
    git branch -m main 2>nul
    echo    Pushing to new repo...
    git push -u origin main 2>nul
    if not errorlevel 1 (
        echo    [OK] trading-bot created
        set /a SUCCESS+=1
    ) else (
        echo    [WARN] Push failed - repo may already have content
        set /a FAIL+=1
    )
) else (
    echo    [SKIP] Branch not found or clone failed
    set /a FAIL+=1
)

REM ── Project 3: Mission Control ──
echo.
echo  [3/6] Mission Control...
echo    Creating repo...
gh repo create mission-control --public --description "Next.js project management dashboard" 2>nul
echo    Cloning branch...
git clone -b claude/review-images-new-project-d1qDw "%EXO_REPO%" "%TEMP_DIR%\mission-control" 2>nul
if exist "%TEMP_DIR%\mission-control\.git" (
    cd /d "%TEMP_DIR%\mission-control"
    git remote remove origin 2>nul
    git remote add origin https://github.com/lance-fisher/mission-control.git
    git branch -m main 2>nul
    echo    Pushing to new repo...
    git push -u origin main 2>nul
    if not errorlevel 1 (
        echo    [OK] mission-control created
        set /a SUCCESS+=1
    ) else (
        echo    [WARN] Push failed - repo may already have content
        set /a FAIL+=1
    )
) else (
    echo    [SKIP] Branch not found or clone failed
    set /a FAIL+=1
)

REM ── Project 4: Frontier Bastion (RTS Game) ──
echo.
echo  [4/6] Frontier Bastion...
echo    Creating repo...
gh repo create frontier-bastion --public --description "Web-based C&C-inspired real-time strategy game" 2>nul
echo    Cloning branch...
git clone -b claude/rts-game-prototype-FmTk4 "%EXO_REPO%" "%TEMP_DIR%\frontier-bastion" 2>nul
if exist "%TEMP_DIR%\frontier-bastion\.git" (
    cd /d "%TEMP_DIR%\frontier-bastion"
    git remote remove origin 2>nul
    git remote add origin https://github.com/lance-fisher/frontier-bastion.git
    git branch -m main 2>nul
    echo    Pushing to new repo...
    git push -u origin main 2>nul
    if not errorlevel 1 (
        echo    [OK] frontier-bastion created
        set /a SUCCESS+=1
    ) else (
        echo    [WARN] Push failed - repo may already have content
        set /a FAIL+=1
    )
) else (
    echo    [SKIP] Branch not found or clone failed
    set /a FAIL+=1
)

REM ── Project 5: Project Dashboard ──
echo.
echo  [5/6] Project Dashboard...
echo    Creating repo...
gh repo create project-dashboard --public --description "Python project management dashboard" 2>nul
echo    Cloning branch...
git clone -b claude/project-dashboard-hub-O2Sx0 "%EXO_REPO%" "%TEMP_DIR%\project-dashboard" 2>nul
if exist "%TEMP_DIR%\project-dashboard\.git" (
    cd /d "%TEMP_DIR%\project-dashboard"
    git remote remove origin 2>nul
    git remote add origin https://github.com/lance-fisher/project-dashboard.git
    git branch -m main 2>nul
    echo    Pushing to new repo...
    git push -u origin main 2>nul
    if not errorlevel 1 (
        echo    [OK] project-dashboard created
        set /a SUCCESS+=1
    ) else (
        echo    [WARN] Push failed - repo may already have content
        set /a FAIL+=1
    )
) else (
    echo    [SKIP] Branch not found or clone failed
    set /a FAIL+=1
)

REM ── Project 6: SCLS ──
echo.
echo  [6/6] SCLS...
echo    Creating repo...
gh repo create scls --public --description "Scratchpad Continual Learning System - AI memory and session tooling" 2>nul
echo    Cloning branch...
git clone -b claude/init-scls-uOi0s "%EXO_REPO%" "%TEMP_DIR%\scls" 2>nul
if exist "%TEMP_DIR%\scls\.git" (
    cd /d "%TEMP_DIR%\scls"
    git remote remove origin 2>nul
    git remote add origin https://github.com/lance-fisher/scls.git
    git branch -m main 2>nul
    echo    Pushing to new repo...
    git push -u origin main 2>nul
    if not errorlevel 1 (
        echo    [OK] scls created
        set /a SUCCESS+=1
    ) else (
        echo    [WARN] Push failed - repo may already have content
        set /a FAIL+=1
    )
) else (
    echo    [SKIP] Branch not found or clone failed
    set /a FAIL+=1
)

REM ── Delete old branches from exo ──
echo.
echo  ----------------------------------------
echo  Cleaning up old branches from exo...
echo  ----------------------------------------

for %%B in (claude/medspa-mobile-app-AKyo6 claude/start-new-project-06bsC claude/review-images-new-project-d1qDw claude/rts-game-prototype-FmTk4 claude/project-dashboard-hub-O2Sx0 claude/init-scls-uOi0s) do (
    echo  Deleting exo branch %%B...
    cd /d "%TEMP_DIR%"
    git clone --bare "%EXO_REPO%" exo-bare 2>nul
    cd exo-bare
    git push origin --delete %%B 2>nul
    if not errorlevel 1 (
        echo    [OK] Deleted
    ) else (
        echo    [SKIP] Already deleted or protected
    )
    cd /d "%TEMP_DIR%"
    rmdir /s /q exo-bare 2>nul
)

REM Clean up temp directory
cd /d "%USERPROFILE%"
rmdir /s /q "%TEMP_DIR%" 2>nul

echo.
echo  ========================================
echo  Extraction Results: %SUCCESS% created, %FAIL% skipped
echo  ========================================
echo.
echo  New repos (check github.com/lance-fisher):
echo    - harmony-medspa
echo    - trading-bot
echo    - mission-control
echo    - frontier-bastion
echo    - project-dashboard
echo    - scls
echo.

REM Mark step 3 complete
echo step3=complete>> "%USERPROFILE%\Desktop\.cleanup-progress.txt"

echo  Step 3 complete!
echo  Now run: 4-doctor-and-cleanup.bat
echo.
echo  Press any key to close...
pause >nul
