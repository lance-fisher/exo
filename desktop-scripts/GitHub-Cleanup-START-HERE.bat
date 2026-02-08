@echo off
REM =============================================
REM  GitHub Cleanup Launcher
REM  Drop this on your Desktop. Double-click it.
REM  It deploys the scripts and opens the folder.
REM =============================================
setlocal

set TARGET=D:\ProjectsHome\github-cleanup
set REPO_SCRIPTS=D:\ProjectsHome\distributed-claude-agents\desktop-scripts

echo.
echo  ========================================
echo   GitHub Cleanup Launcher
echo  ========================================
echo.

REM Find the source scripts
if not exist "%REPO_SCRIPTS%" (
    REM Try alternate location if repo was cloned differently
    set REPO_SCRIPTS=%~dp0
)

if not exist "%REPO_SCRIPTS%\1-cleanup-stale-branches.bat" (
    echo  ERROR: Could not find cleanup scripts.
    echo  Make sure the exo repo is cloned to:
    echo    D:\ProjectsHome\distributed-claude-agents\
    echo.
    echo  Press any key to close...
    pause >nul
    exit /b 1
)

REM Create target folder and copy scripts
mkdir "%TARGET%" 2>nul

echo  Deploying scripts to %TARGET%...
echo.

copy /y "%REPO_SCRIPTS%\1-cleanup-stale-branches.bat" "%TARGET%\" >nul
copy /y "%REPO_SCRIPTS%\2-install-github-cli.bat" "%TARGET%\" >nul
copy /y "%REPO_SCRIPTS%\3-extract-projects.bat" "%TARGET%\" >nul
copy /y "%REPO_SCRIPTS%\4-doctor-and-cleanup.bat" "%TARGET%\" >nul
copy /y "%REPO_SCRIPTS%\doctor-coordination.json" "%TARGET%\" >nul
copy /y "%REPO_SCRIPTS%\README.txt" "%TARGET%\" >nul

echo  [OK] Scripts deployed!
echo.
echo  Opening folder now...
echo  Run scripts 1 through 4 in order.
echo  Script 4 cleans everything up when done.
echo.

REM Open the folder in Explorer
start "" explorer "%TARGET%"

REM Self-delete this launcher from Desktop
echo  This launcher will now remove itself.
echo  Press any key to close...
pause >nul
(goto) 2>nul & del "%~f0"
