@echo off
REM =============================================
REM  Step 4 of 4: Project Doctor + Self-Cleanup
REM  Verifies all projects are healthy, then
REM  removes all numbered scripts from Desktop
REM =============================================
setlocal enabledelayedexpansion

echo.
echo  ========================================
echo   Step 4/4: Project Doctor + Cleanup
echo  ========================================
echo.
echo  This script will:
echo    1. Verify your GitHub repos are accessible
echo    2. Check local project directories
echo    3. Validate project configurations
echo    4. Write a health report
echo    5. Remove all cleanup scripts from Desktop
echo.
echo  Press any key to start the health check...
pause >nul

set PROJECTS_HOME=D:\ProjectsHome
set REPORT=%USERPROFILE%\Desktop\project-health-report.txt
set PASS=0
set WARN=0
set FAIL=0

echo.> "%REPORT%"
echo ============================================>> "%REPORT%"
echo  Project Health Report>> "%REPORT%"
echo  Generated: %DATE% %TIME%>> "%REPORT%"
echo ============================================>> "%REPORT%"
echo.>> "%REPORT%"

REM ── Check GitHub CLI ──
echo.
echo  [Check] GitHub CLI...
where gh >nul 2>nul
if not errorlevel 1 (
    echo    [OK] GitHub CLI installed
    echo [PASS] GitHub CLI installed>> "%REPORT%"
    set /a PASS+=1

    gh auth status >nul 2>nul
    if not errorlevel 1 (
        echo    [OK] GitHub CLI authenticated
        echo [PASS] GitHub CLI authenticated>> "%REPORT%"
        set /a PASS+=1
    ) else (
        echo    [WARN] GitHub CLI not authenticated
        echo [WARN] GitHub CLI not authenticated - run: gh auth login>> "%REPORT%"
        set /a WARN+=1
    )
) else (
    echo    [WARN] GitHub CLI not installed
    echo [WARN] GitHub CLI not installed - run: winget install GitHub.cli>> "%REPORT%"
    set /a WARN+=1
)

REM ── Check Git ──
echo.
echo  [Check] Git...
where git >nul 2>nul
if not errorlevel 1 (
    echo    [OK] Git installed
    echo [PASS] Git installed>> "%REPORT%"
    set /a PASS+=1
) else (
    echo    [FAIL] Git not found
    echo [FAIL] Git not installed>> "%REPORT%"
    set /a FAIL+=1
)

REM ── Check ProjectsHome directory ──
echo.
echo  [Check] ProjectsHome directory...
if exist "%PROJECTS_HOME%" (
    echo    [OK] %PROJECTS_HOME% exists
    echo [PASS] ProjectsHome directory exists>> "%REPORT%"
    set /a PASS+=1
) else (
    echo    [WARN] %PROJECTS_HOME% not found
    echo [WARN] ProjectsHome directory not found at %PROJECTS_HOME%>> "%REPORT%"
    set /a WARN+=1
)

REM ── Check ProjectHub ──
echo.
echo  [Check] ProjectHub...
if exist "%PROJECTS_HOME%\project-hub\server.py" (
    echo    [OK] ProjectHub server.py found
    echo [PASS] ProjectHub server.py exists>> "%REPORT%"
    set /a PASS+=1
) else (
    echo    [WARN] ProjectHub server.py not found
    echo [WARN] ProjectHub server.py not found - may need setup>> "%REPORT%"
    set /a WARN+=1
)
if exist "%PROJECTS_HOME%\project-hub\config.json" (
    echo    [OK] ProjectHub config.json found
    echo [PASS] ProjectHub config.json exists>> "%REPORT%"
    set /a PASS+=1
) else (
    echo    [WARN] ProjectHub config.json not found
    echo [WARN] ProjectHub config.json not found>> "%REPORT%"
    set /a WARN+=1
)

REM ── Check Distributed Claude Agents ──
echo.
echo  [Check] Distributed Claude Agents...
if exist "%PROJECTS_HOME%\distributed-claude-agents" (
    echo    [OK] Project directory found
    echo [PASS] Distributed Claude Agents directory exists>> "%REPORT%"
    set /a PASS+=1

    if exist "%PROJECTS_HOME%\distributed-claude-agents\docker-compose.yml" (
        echo    [OK] docker-compose.yml found
        echo [PASS] docker-compose.yml present>> "%REPORT%"
        set /a PASS+=1
    )
    if exist "%PROJECTS_HOME%\distributed-claude-agents\Makefile" (
        echo    [OK] Makefile found
        echo [PASS] Makefile present>> "%REPORT%"
        set /a PASS+=1
    )
    if exist "%PROJECTS_HOME%\distributed-claude-agents\project-hub.json" (
        echo    [OK] project-hub.json found
        echo [PASS] project-hub.json present>> "%REPORT%"
        set /a PASS+=1
    )
) else (
    echo    [INFO] Not yet cloned locally
    echo [INFO] Distributed Claude Agents not yet cloned - run setup-windows.bat>> "%REPORT%"
    set /a WARN+=1
)

REM ── Check GitHub repos (if gh available) ──
where gh >nul 2>nul
if not errorlevel 1 (
    gh auth status >nul 2>nul
    if not errorlevel 1 (
        echo.
        echo  [Check] GitHub repositories...
        echo.>> "%REPORT%"
        echo --- GitHub Repositories --->> "%REPORT%"

        REM Check exo repo and its main branch
        echo    Checking exo repo...
        gh repo view lance-fisher/exo >nul 2>nul
        if not errorlevel 1 (
            echo    [OK] lance-fisher/exo accessible
            echo [PASS] lance-fisher/exo - accessible>> "%REPORT%"
            set /a PASS+=1
        ) else (
            echo    [FAIL] lance-fisher/exo not accessible
            echo [FAIL] lance-fisher/exo - not accessible>> "%REPORT%"
            set /a FAIL+=1
        )

        REM Check each extracted project repo
        for %%R in (harmony-medspa trading-bot mission-control frontier-bastion project-dashboard scls) do (
            echo    Checking %%R...
            gh repo view lance-fisher/%%R >nul 2>nul
            if not errorlevel 1 (
                echo    [OK] lance-fisher/%%R accessible
                echo [PASS] lance-fisher/%%R - accessible>> "%REPORT%"
                set /a PASS+=1
            ) else (
                echo    [INFO] lance-fisher/%%R not found
                echo [INFO] lance-fisher/%%R - not yet created ^(run Step 3 first^)>> "%REPORT%"
                set /a WARN+=1
            )
        )

        REM Check exo branches
        echo.
        echo  [Check] Remaining exo branches...
        echo.>> "%REPORT%"
        echo --- Remaining exo Branches --->> "%REPORT%"

        for /f "tokens=*" %%B in ('gh api repos/lance-fisher/exo/branches --jq ".[].name" 2^>nul') do (
            echo    %%B
            echo   %%B>> "%REPORT%"
        )
    )
)

REM ── Check local project directories ──
echo.
echo  [Check] Local project directories...
echo.>> "%REPORT%"
echo --- Local Projects in %PROJECTS_HOME% --->> "%REPORT%"

if exist "%PROJECTS_HOME%" (
    for /d %%D in ("%PROJECTS_HOME%\*") do (
        echo    Found: %%~nxD
        echo   %%~nxD>> "%REPORT%"

        if exist "%%D\project-hub.json" (
            echo      Has project-hub.json
            echo     ^^ has project-hub.json>> "%REPORT%"
        )
        if exist "%%D\package.json" (
            echo      Has package.json
        )
        if exist "%%D\.git" (
            echo      Is a git repo
        )
    )
)

REM ── Summary ──
echo.
echo.>> "%REPORT%"
echo ============================================>> "%REPORT%"
echo  Summary: %PASS% passed, %WARN% warnings, %FAIL% failures>> "%REPORT%"
echo ============================================>> "%REPORT%"
echo.>> "%REPORT%"

if %FAIL% GTR 0 (
    echo  ACTION NEEDED: Fix the failures listed above>> "%REPORT%"
)
if %WARN% GTR 0 (
    echo  Some items need attention - see warnings above>> "%REPORT%"
)
if %FAIL%==0 if %WARN%==0 (
    echo  All checks passed! Your projects are healthy.>> "%REPORT%"
)

echo  Report saved to: %REPORT%>> "%REPORT%"

echo.
echo  ========================================
echo   Health Check Results
echo  ========================================
echo.
echo   Passed:   %PASS%
echo   Warnings: %WARN%
echo   Failures: %FAIL%
echo.
echo  Full report saved to Desktop:
echo    project-health-report.txt
echo.

REM ── Write doctor coordination file ──
set COORD=%USERPROFILE%\Desktop\.doctor-results.json
echo {> "%COORD%"
echo   "timestamp": "%DATE% %TIME%",>> "%COORD%"
echo   "pass": %PASS%,>> "%COORD%"
echo   "warn": %WARN%,>> "%COORD%"
echo   "fail": %FAIL%,>> "%COORD%"
echo   "status": "complete",>> "%COORD%"
echo   "report": "project-health-report.txt">> "%COORD%"
echo }>> "%COORD%"

REM ── Self-cleanup: remove all numbered scripts ──
echo.
echo  ----------------------------------------
echo  Cleaning up scripts from Desktop...
echo  ----------------------------------------
echo.

REM Delete the progress tracking file
del /f /q "%USERPROFILE%\Desktop\.cleanup-progress.txt" 2>nul

REM Delete scripts 1-3
del /f /q "%USERPROFILE%\Desktop\1-cleanup-stale-branches.bat" 2>nul
if not errorlevel 1 echo    Removed 1-cleanup-stale-branches.bat
del /f /q "%USERPROFILE%\Desktop\2-install-github-cli.bat" 2>nul
if not errorlevel 1 echo    Removed 2-install-github-cli.bat
del /f /q "%USERPROFILE%\Desktop\3-extract-projects.bat" 2>nul
if not errorlevel 1 echo    Removed 3-extract-projects.bat

echo.
echo  NOTE: The health report (project-health-report.txt)
echo  is kept on your Desktop for reference.
echo.
echo  ========================================
echo   All done! GitHub is organized and
echo   projects have been checked.
echo  ========================================
echo.
echo  Press any key to close (this script
echo  will also delete itself)...
pause >nul

REM Self-delete (must be last command)
(goto) 2>nul & del "%~f0"
