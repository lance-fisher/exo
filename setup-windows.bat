@echo off
REM =============================================
REM  Distributed Claude Agents - One-Click Setup
REM  Run this on your Windows laptop to:
REM   1. Clone the project into D:\ProjectsHome
REM   2. Create a desktop shortcut
REM   3. Make it visible in ProjectHub
REM =============================================

set PROJECT_NAME=distributed-claude-agents
set PROJECTS_HOME=D:\ProjectsHome
set PROJECT_DIR=%PROJECTS_HOME%\%PROJECT_NAME%
set REPO_URL=https://github.com/lance-fisher/exo.git
set BRANCH=claude/distributed-claude-agents-oR46c
set DESKTOP=%USERPROFILE%\Desktop

echo.
echo  ========================================
echo   Distributed Claude Agents - Setup
echo  ========================================
echo.

REM -- Step 1: Ensure ProjectsHome exists --
if not exist "%PROJECTS_HOME%" (
    echo Creating %PROJECTS_HOME%...
    mkdir "%PROJECTS_HOME%"
)

REM -- Step 2: Clone or update the repo --
if exist "%PROJECT_DIR%\.git" (
    echo Project already exists, pulling latest...
    cd /d "%PROJECT_DIR%"
    git fetch origin %BRANCH%
    git checkout %BRANCH%
    git pull origin %BRANCH%
) else (
    echo Cloning repository...
    cd /d "%PROJECTS_HOME%"
    git clone -b %BRANCH% "%REPO_URL%" "%PROJECT_NAME%"
    cd /d "%PROJECT_DIR%"
)

REM -- Step 3: Create .env if missing --
if not exist "%PROJECT_DIR%\.env" (
    echo Creating .env from template...
    copy "%PROJECT_DIR%\.env.example" "%PROJECT_DIR%\.env"
)

REM -- Step 4: Create desktop shortcut --
echo Creating desktop shortcut...
(
    echo @echo off
    echo cd /d "%PROJECT_DIR%"
    echo echo Starting Distributed Claude Agents...
    echo echo.
    echo docker compose up --build -d
    echo echo.
    echo echo ========================================
    echo echo   System is running!
    echo echo   Open http://localhost:3000 in your browser
    echo echo ========================================
    echo echo.
    echo echo Press any key to view logs ^(Ctrl+C to stop^)...
    echo pause ^>nul
    echo docker compose logs -f
) > "%DESKTOP%\Distributed Claude Agents.bat"

REM -- Step 5: Create desktop instructions file --
echo Creating instructions on desktop...
(
    echo =============================================
    echo   DISTRIBUTED CLAUDE AGENTS
    echo =============================================
    echo.
    echo QUICK START
    echo   Double-click "Distributed Claude Agents.bat" on your desktop.
    echo   Then open http://localhost:3000 in your browser.
    echo.
    echo MANUAL START
    echo   cd D:\ProjectsHome\distributed-claude-agents
    echo   make up
    echo.
    echo STOP
    echo   cd D:\ProjectsHome\distributed-claude-agents
    echo   docker compose down
    echo.
    echo PROJECT HUB
    echo   This project appears in your ProjectsHome Hub at localhost:8090.
    echo   If it does not show up, click "Scan" in the Hub dashboard.
    echo.
    echo WHAT IT DOES
    echo   A team of 7 AI agents work together on your tasks:
    echo   - Product Manager: understands what you want
    echo   - Architect: designs the solution
    echo   - Implementer: writes the code
    echo   - QA/Tester: runs tests
    echo   - Security: checks for risks
    echo   - Docs: writes summaries
    echo   - Performance: monitors health
    echo.
    echo PORTS
    echo   3000 - Control UI ^(open in browser^)
    echo   3001 - API
    echo   5432 - Database ^(internal^)
    echo   6379 - Redis ^(internal^)
    echo.
    echo FILES
    echo   Project: D:\ProjectsHome\distributed-claude-agents
    echo   Repo:    lance-fisher/exo
    echo   Branch:  claude/distributed-claude-agents-oR46c
    echo =============================================
) > "%DESKTOP%\Distributed Claude Agents - README.txt"

echo.
echo  ========================================
echo   Setup complete!
echo  ========================================
echo.
echo   Project:    %PROJECT_DIR%
echo   Desktop:    Shortcut + README created
echo   ProjectHub: Will appear after Scan
echo.
echo   To start: double-click the desktop shortcut
echo   Or run:   cd %PROJECT_DIR% ^&^& make up
echo   Then open: http://localhost:3000
echo.
pause
