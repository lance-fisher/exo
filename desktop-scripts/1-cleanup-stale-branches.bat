@echo off
REM =============================================
REM  Step 1 of 4: Clean Up Stale Branches
REM  Deletes merged/abandoned branches from exo
REM =============================================
setlocal

echo.
echo  ========================================
echo   Step 1/4: Clean Up Stale Branches
echo  ========================================
echo.
echo  This will delete 6 stale/merged branches
echo  from your lance-fisher/exo repository.
echo  These branches are either already merged
echo  or contain dead-end work.
echo.
echo  Branches to delete:
echo    - origin/astra (merged)
echo    - origin/cline (merged)
echo    - origin/main (merged)
echo    - origin/update/pip (merged)
echo    - origin/copilot/fix (merged)
echo    - origin/claude/start-new-project-yELXE (dead-end)
echo.
echo  Press any key to continue, or close this
echo  window to cancel...
pause >nul

set REPO_DIR=%TEMP%\exo-cleanup
set REPO_URL=https://github.com/lance-fisher/exo.git

echo.
echo  Preparing...

REM Clone a minimal copy to work with
if exist "%REPO_DIR%" rmdir /s /q "%REPO_DIR%"
git clone --bare "%REPO_URL%" "%REPO_DIR%" 2>nul
if errorlevel 1 (
    echo.
    echo  ERROR: Could not clone repository.
    echo  Make sure you have internet and git is installed.
    echo  Press any key to exit...
    pause >nul
    exit /b 1
)

cd /d "%REPO_DIR%"

echo.
echo  Deleting stale branches...
echo.

set SUCCESS=0
set FAIL=0

for %%B in (astra cline main update/pip copilot/fix claude/start-new-project-yELXE) do (
    echo  Deleting %%B...
    git push origin --delete %%B 2>nul
    if errorlevel 1 (
        echo    [SKIP] %%B - may already be deleted or protected
        set /a FAIL+=1
    ) else (
        echo    [OK] %%B deleted
        set /a SUCCESS+=1
    )
)

echo.
echo  ----------------------------------------
echo  Results: %SUCCESS% deleted, %FAIL% skipped
echo  ----------------------------------------

REM Clean up temp dir
cd /d "%USERPROFILE%"
rmdir /s /q "%REPO_DIR%" 2>nul

REM Mark step 1 complete
echo step1=complete> "%USERPROFILE%\Desktop\.cleanup-progress.txt"

echo.
echo  Step 1 complete!
echo  Now run: 2-install-github-cli.bat
echo.
echo  Press any key to close...
pause >nul
