@echo off
REM =============================================
REM  GitHub Cleanup - All In One
REM  Just double-click this file. That's it.
REM =============================================
setlocal enabledelayedexpansion

echo.
echo  ========================================
echo   GitHub Cleanup for lance-fisher/exo
echo  ========================================
echo.
echo  This will organize your GitHub:
echo    - Delete 6 stale/merged branches
echo    - Install GitHub CLI if needed
echo    - Extract 6 projects to their own repos
echo    - Run a health check on everything
echo.
echo  Press any key to start, or close to cancel...
pause >nul

set TEMP_DIR=%TEMP%\exo-cleanup
set EXO_REPO=https://github.com/lance-fisher/exo.git
set PROJECTS_HOME=D:\ProjectsHome
set REPORT=%PROJECTS_HOME%\project-health-report.txt

REM ══════════════════════════════════════════
REM  STEP 1: Delete stale branches
REM ══════════════════════════════════════════
echo.
echo  ========================================
echo   Step 1/4: Cleaning stale branches...
echo  ========================================
echo.

if exist "%TEMP_DIR%" rmdir /s /q "%TEMP_DIR%"
mkdir "%TEMP_DIR%"

echo  Cloning exo repo (bare)...
git clone --bare "%EXO_REPO%" "%TEMP_DIR%\exo-bare" 2>nul
if errorlevel 1 (
    echo  ERROR: Could not clone. Check internet and git.
    echo  Press any key to exit...
    pause >nul
    exit /b 1
)

cd /d "%TEMP_DIR%\exo-bare"

for %%B in (astra cline main update/pip copilot/fix claude/start-new-project-yELXE) do (
    echo  Deleting branch %%B...
    git push origin --delete %%B 2>nul
    if errorlevel 1 (
        echo    [SKIP] %%B
    ) else (
        echo    [OK] %%B deleted
    )
)

cd /d "%USERPROFILE%"
echo.
echo  Step 1 done.

REM ══════════════════════════════════════════
REM  STEP 2: Ensure GitHub CLI is ready
REM ══════════════════════════════════════════
echo.
echo  ========================================
echo   Step 2/4: Checking GitHub CLI...
echo  ========================================
echo.

where gh >nul 2>nul
if errorlevel 1 (
    echo  GitHub CLI not found. Installing...
    winget install GitHub.cli --accept-package-agreements --accept-source-agreements 2>nul
    if errorlevel 1 (
        echo.
        echo  Auto-install failed. Opening download page...
        start https://cli.github.com/
        echo.
        echo  Install GitHub CLI from the page that opened,
        echo  then re-run this script.
        echo  Press any key to exit...
        pause >nul
        exit /b 1
    )
    echo  Installed!
    echo.
)

gh auth status >nul 2>nul
if errorlevel 1 (
    echo  Need to log in to GitHub.
    echo  A browser will open. Follow the prompts.
    echo.
    echo  Press any key to start login...
    pause >nul
    gh auth login --hostname github.com --git-protocol https --web
    if errorlevel 1 (
        echo  Login failed. Re-run this script to try again.
        pause >nul
        exit /b 1
    )
) else (
    echo  GitHub CLI ready and authenticated.
)

echo.
echo  Step 2 done.

REM ══════════════════════════════════════════
REM  STEP 3: Extract projects to own repos
REM ══════════════════════════════════════════
echo.
echo  ========================================
echo   Step 3/4: Extracting projects...
echo  ========================================
echo.
echo  Creating 6 new repos from exo branches.
echo  This may take a few minutes.
echo.

REM ── harmony-medspa ──
echo  [1/6] harmony-medspa...
gh repo create harmony-medspa --public --description "Medspa booking system with React Native and NestJS" 2>nul
if exist "%TEMP_DIR%\harmony-medspa" rmdir /s /q "%TEMP_DIR%\harmony-medspa"
git clone -b claude/medspa-mobile-app-AKyo6 "%EXO_REPO%" "%TEMP_DIR%\harmony-medspa" 2>nul
if exist "%TEMP_DIR%\harmony-medspa\.git" (
    cd /d "%TEMP_DIR%\harmony-medspa"
    git remote set-url origin https://github.com/lance-fisher/harmony-medspa.git
    git branch -m main 2>nul
    git push -u origin main 2>nul
    if not errorlevel 1 ( echo    [OK] ) else ( echo    [WARN] push failed )
) else ( echo    [SKIP] branch not found )

REM ── trading-bot ──
echo  [2/6] trading-bot...
gh repo create trading-bot --public --description "Polymarket prediction market trading bot" 2>nul
if exist "%TEMP_DIR%\trading-bot" rmdir /s /q "%TEMP_DIR%\trading-bot"
git clone -b claude/start-new-project-06bsC "%EXO_REPO%" "%TEMP_DIR%\trading-bot" 2>nul
if exist "%TEMP_DIR%\trading-bot\.git" (
    cd /d "%TEMP_DIR%\trading-bot"
    git remote set-url origin https://github.com/lance-fisher/trading-bot.git
    git branch -m main 2>nul
    git push -u origin main 2>nul
    if not errorlevel 1 ( echo    [OK] ) else ( echo    [WARN] push failed )
) else ( echo    [SKIP] branch not found )

REM ── mission-control ──
echo  [3/6] mission-control...
gh repo create mission-control --public --description "Next.js project management dashboard" 2>nul
if exist "%TEMP_DIR%\mission-control" rmdir /s /q "%TEMP_DIR%\mission-control"
git clone -b claude/review-images-new-project-d1qDw "%EXO_REPO%" "%TEMP_DIR%\mission-control" 2>nul
if exist "%TEMP_DIR%\mission-control\.git" (
    cd /d "%TEMP_DIR%\mission-control"
    git remote set-url origin https://github.com/lance-fisher/mission-control.git
    git branch -m main 2>nul
    git push -u origin main 2>nul
    if not errorlevel 1 ( echo    [OK] ) else ( echo    [WARN] push failed )
) else ( echo    [SKIP] branch not found )

REM ── frontier-bastion ──
echo  [4/6] frontier-bastion...
gh repo create frontier-bastion --public --description "Web-based RTS game inspired by Command and Conquer" 2>nul
if exist "%TEMP_DIR%\frontier-bastion" rmdir /s /q "%TEMP_DIR%\frontier-bastion"
git clone -b claude/rts-game-prototype-FmTk4 "%EXO_REPO%" "%TEMP_DIR%\frontier-bastion" 2>nul
if exist "%TEMP_DIR%\frontier-bastion\.git" (
    cd /d "%TEMP_DIR%\frontier-bastion"
    git remote set-url origin https://github.com/lance-fisher/frontier-bastion.git
    git branch -m main 2>nul
    git push -u origin main 2>nul
    if not errorlevel 1 ( echo    [OK] ) else ( echo    [WARN] push failed )
) else ( echo    [SKIP] branch not found )

REM ── project-dashboard ──
echo  [5/6] project-dashboard...
gh repo create project-dashboard --public --description "Python project management dashboard" 2>nul
if exist "%TEMP_DIR%\project-dashboard" rmdir /s /q "%TEMP_DIR%\project-dashboard"
git clone -b claude/project-dashboard-hub-O2Sx0 "%EXO_REPO%" "%TEMP_DIR%\project-dashboard" 2>nul
if exist "%TEMP_DIR%\project-dashboard\.git" (
    cd /d "%TEMP_DIR%\project-dashboard"
    git remote set-url origin https://github.com/lance-fisher/project-dashboard.git
    git branch -m main 2>nul
    git push -u origin main 2>nul
    if not errorlevel 1 ( echo    [OK] ) else ( echo    [WARN] push failed )
) else ( echo    [SKIP] branch not found )

REM ── scls ──
echo  [6/6] scls...
gh repo create scls --public --description "Scratchpad Continual Learning System - AI memory and session tooling" 2>nul
if exist "%TEMP_DIR%\scls" rmdir /s /q "%TEMP_DIR%\scls"
git clone -b claude/init-scls-uOi0s "%EXO_REPO%" "%TEMP_DIR%\scls" 2>nul
if exist "%TEMP_DIR%\scls\.git" (
    cd /d "%TEMP_DIR%\scls"
    git remote set-url origin https://github.com/lance-fisher/scls.git
    git branch -m main 2>nul
    git push -u origin main 2>nul
    if not errorlevel 1 ( echo    [OK] ) else ( echo    [WARN] push failed )
) else ( echo    [SKIP] branch not found )

REM Delete the old exo branches now that they're extracted
echo.
echo  Cleaning extracted branches from exo...
cd /d "%TEMP_DIR%\exo-bare"
for %%B in (claude/medspa-mobile-app-AKyo6 claude/start-new-project-06bsC claude/review-images-new-project-d1qDw claude/rts-game-prototype-FmTk4 claude/project-dashboard-hub-O2Sx0 claude/init-scls-uOi0s) do (
    git push origin --delete %%B 2>nul
    if not errorlevel 1 ( echo    [OK] %%B removed from exo ) else ( echo    [SKIP] %%B )
)

cd /d "%USERPROFILE%"
echo.
echo  Step 3 done.

REM ══════════════════════════════════════════
REM  STEP 4: Health check
REM ══════════════════════════════════════════
echo.
echo  ========================================
echo   Step 4/4: Health check...
echo  ========================================
echo.

set PASS=0
set WARN=0
set FAIL=0

echo.> "%REPORT%"
echo ============================================>> "%REPORT%"
echo  Project Health Report>> "%REPORT%"
echo  Generated: %DATE% %TIME%>> "%REPORT%"
echo ============================================>> "%REPORT%"
echo.>> "%REPORT%"

REM Check tools
where git >nul 2>nul
if not errorlevel 1 (
    echo  [OK] Git installed
    echo [PASS] Git installed>> "%REPORT%"
    set /a PASS+=1
) else (
    echo  [FAIL] Git not found
    echo [FAIL] Git not installed>> "%REPORT%"
    set /a FAIL+=1
)

where gh >nul 2>nul
if not errorlevel 1 (
    echo  [OK] GitHub CLI installed
    echo [PASS] GitHub CLI installed>> "%REPORT%"
    set /a PASS+=1
) else (
    echo  [WARN] GitHub CLI not found
    echo [WARN] GitHub CLI not installed>> "%REPORT%"
    set /a WARN+=1
)

REM Check repos
echo.>> "%REPORT%"
echo --- GitHub Repositories --->> "%REPORT%"

echo  Checking GitHub repos...
gh repo view lance-fisher/exo >nul 2>nul
if not errorlevel 1 (
    echo  [OK] lance-fisher/exo
    echo [PASS] lance-fisher/exo accessible>> "%REPORT%"
    set /a PASS+=1
) else (
    echo  [FAIL] lance-fisher/exo
    echo [FAIL] lance-fisher/exo not accessible>> "%REPORT%"
    set /a FAIL+=1
)

for %%R in (harmony-medspa trading-bot mission-control frontier-bastion project-dashboard scls) do (
    gh repo view lance-fisher/%%R >nul 2>nul
    if not errorlevel 1 (
        echo  [OK] lance-fisher/%%R
        echo [PASS] lance-fisher/%%R accessible>> "%REPORT%"
        set /a PASS+=1
    ) else (
        echo  [INFO] lance-fisher/%%R not found
        echo [INFO] lance-fisher/%%R not created>> "%REPORT%"
        set /a WARN+=1
    )
)

REM Check remaining exo branches
echo.>> "%REPORT%"
echo --- Remaining exo Branches --->> "%REPORT%"
echo.
echo  Remaining exo branches:
for /f "tokens=*" %%B in ('gh api repos/lance-fisher/exo/branches --jq ".[].name" 2^>nul') do (
    echo    %%B
    echo   %%B>> "%REPORT%"
)

REM Check local dirs
echo.>> "%REPORT%"
echo --- Local Projects --->> "%REPORT%"
if exist "%PROJECTS_HOME%" (
    echo.
    echo  Local projects in %PROJECTS_HOME%:
    for /d %%D in ("%PROJECTS_HOME%\*") do (
        echo    %%~nxD
        echo   %%~nxD>> "%REPORT%"
    )
)

echo.>> "%REPORT%"
echo ============================================>> "%REPORT%"
echo  Summary: %PASS% passed, %WARN% warnings, %FAIL% failures>> "%REPORT%"
echo ============================================>> "%REPORT%"

REM Clean up temp
rmdir /s /q "%TEMP_DIR%" 2>nul

echo.
echo  ========================================
echo   ALL DONE!
echo  ========================================
echo.
echo   Passed:   %PASS%
echo   Warnings: %WARN%
echo   Failures: %FAIL%
echo.
echo  Health report saved to:
echo    %REPORT%
echo.
echo  Press any key to close (this script
echo  will delete itself)...
pause >nul

REM Self-delete
(goto) 2>nul & del "%~f0"
