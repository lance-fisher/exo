@echo off
REM =============================================
REM  Deploy Cleanup Scripts to ProjectsHome
REM  Copies the 4 numbered scripts to
REM  D:\ProjectsHome\github-cleanup\
REM =============================================
setlocal

set TARGET=D:\ProjectsHome\github-cleanup

echo.
echo  ========================================
echo   Deploy GitHub Cleanup Scripts
echo  ========================================
echo.
echo  This will copy 4 scripts to:
echo    %TARGET%\
echo.
echo    1-cleanup-stale-branches.bat
echo       Deletes old merged branches from exo
echo.
echo    2-install-github-cli.bat
echo       Installs GitHub CLI for Step 3
echo.
echo    3-extract-projects.bat
echo       Creates 6 new repos from exo branches
echo.
echo    4-doctor-and-cleanup.bat
echo       Health check + removes all scripts
echo.
echo  After running all 4 in order, they will
echo  self-delete. Only a health report remains.
echo.
echo  Press any key to deploy...
pause >nul

set SCRIPT_DIR=%~dp0

REM Create target folder
mkdir "%TARGET%" 2>nul

echo.
echo  Copying scripts to %TARGET%...

copy /y "%SCRIPT_DIR%1-cleanup-stale-branches.bat" "%TARGET%\" >nul
if not errorlevel 1 (
    echo    [OK] 1-cleanup-stale-branches.bat
) else (
    echo    [FAIL] Could not copy script 1
)

copy /y "%SCRIPT_DIR%2-install-github-cli.bat" "%TARGET%\" >nul
if not errorlevel 1 (
    echo    [OK] 2-install-github-cli.bat
) else (
    echo    [FAIL] Could not copy script 2
)

copy /y "%SCRIPT_DIR%3-extract-projects.bat" "%TARGET%\" >nul
if not errorlevel 1 (
    echo    [OK] 3-extract-projects.bat
) else (
    echo    [FAIL] Could not copy script 3
)

copy /y "%SCRIPT_DIR%4-doctor-and-cleanup.bat" "%TARGET%\" >nul
if not errorlevel 1 (
    echo    [OK] 4-doctor-and-cleanup.bat
) else (
    echo    [FAIL] Could not copy script 4
)

copy /y "%SCRIPT_DIR%doctor-coordination.json" "%TARGET%\" >nul
if not errorlevel 1 (
    echo    [OK] doctor-coordination.json
)

copy /y "%SCRIPT_DIR%README.txt" "%TARGET%\" >nul
if not errorlevel 1 (
    echo    [OK] README.txt
)

echo.
echo  ========================================
echo   Scripts deployed!
echo  ========================================
echo.
echo  Open D:\ProjectsHome\github-cleanup\
echo  and run them in order:
echo    1. Double-click 1-cleanup-stale-branches.bat
echo    2. Double-click 2-install-github-cli.bat
echo    3. Double-click 3-extract-projects.bat
echo    4. Double-click 4-doctor-and-cleanup.bat
echo.
echo  Script 4 will clean up the folder and
echo  leave only the health report on Desktop.
echo.
echo  Press any key to close...
pause >nul
