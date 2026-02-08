@echo off
REM =============================================
REM  Step 2 of 4: Install GitHub CLI
REM  Required for extracting projects in Step 3
REM =============================================
setlocal

echo.
echo  ========================================
echo   Step 2/4: Install GitHub CLI
echo  ========================================
echo.
echo  The GitHub CLI (gh) is needed to create
echo  new repositories in Step 3.
echo.

REM Check if gh is already installed
where gh >nul 2>nul
if not errorlevel 1 (
    echo  GitHub CLI is already installed!
    gh --version
    echo.

    REM Check if authenticated
    gh auth status >nul 2>nul
    if not errorlevel 1 (
        echo  Already authenticated with GitHub.
        echo.
        echo  Step 2 complete! You can skip ahead to:
        echo    3-extract-projects.bat
        echo.

        REM Mark step 2 complete
        echo step2=complete>> "D:\ProjectsHome\github-cleanup\.cleanup-progress.txt"

        echo  Press any key to close...
        pause >nul
        exit /b 0
    ) else (
        echo  GitHub CLI installed but not logged in.
        echo  Starting login now...
        echo.
    )
) else (
    echo  Installing GitHub CLI via winget...
    echo.
    winget install GitHub.cli --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo.
        echo  Winget install failed. Trying alternative...
        echo  Opening GitHub CLI download page...
        start https://cli.github.com/
        echo.
        echo  Please download and install GitHub CLI manually,
        echo  then re-run this script.
        echo.
        echo  Press any key to close...
        pause >nul
        exit /b 1
    )
    echo.
    echo  GitHub CLI installed successfully!
    echo.
)

echo  ----------------------------------------
echo  GitHub Login Required
echo  ----------------------------------------
echo.
echo  A browser window will open for you to
echo  log in to GitHub. Follow the prompts.
echo.
echo  When asked:
echo    - Protocol: HTTPS
echo    - Authenticate: Login with a web browser
echo.
echo  Press any key to start login...
pause >nul

gh auth login --hostname github.com --git-protocol https --web

if errorlevel 1 (
    echo.
    echo  Login failed. Please try again by
    echo  re-running this script.
    echo.
    echo  Press any key to close...
    pause >nul
    exit /b 1
)

echo.
echo  Successfully logged in to GitHub!
echo.

REM Mark step 2 complete
echo step2=complete>> "D:\ProjectsHome\github-cleanup\.cleanup-progress.txt"

echo  Step 2 complete!
echo  Now run: 3-extract-projects.bat
echo.
echo  Press any key to close...
pause >nul
