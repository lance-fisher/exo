@echo off
REM =============================================
REM  Distributed Claude Agents - Full Setup
REM  Run this once on your Windows machine.
REM  It sets up:
REM   1. The project in D:\ProjectsHome
REM   2. Desktop shortcut + instructions
REM   3. ProjectHub integration (auto-registers)
REM   4. Updates existing ProjectHub if present
REM =============================================

set PROJECT_NAME=distributed-claude-agents
set PROJECTS_HOME=D:\ProjectsHome
set PROJECT_DIR=%PROJECTS_HOME%\%PROJECT_NAME%
set HUB_DIR=%PROJECTS_HOME%\project-hub
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

REM -- Step 2: Clone or update the project --
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

REM -- Step 4: Update ProjectHub with new server.py --
if exist "%HUB_DIR%\server.py" (
    echo.
    echo Updating ProjectHub with latest server.py...
    copy /Y "%PROJECT_DIR%\project-hub\server.py" "%HUB_DIR%\server.py"
    echo Updated %HUB_DIR%\server.py
    if not exist "%HUB_DIR%\config.json" (
        copy /Y "%PROJECT_DIR%\project-hub\config.json" "%HUB_DIR%\config.json"
    )
    copy /Y "%PROJECT_DIR%\project-hub\register.py" "%HUB_DIR%\register.py"
    copy /Y "%PROJECT_DIR%\project-hub\github-sync.py" "%HUB_DIR%\github-sync.py"
    echo Copied register.py and github-sync.py
) else (
    echo.
    echo ProjectHub not found at %HUB_DIR%.
    echo Installing ProjectHub...
    mkdir "%HUB_DIR%" 2>nul
    copy /Y "%PROJECT_DIR%\project-hub\server.py" "%HUB_DIR%\server.py"
    copy /Y "%PROJECT_DIR%\project-hub\config.json" "%HUB_DIR%\config.json"
    copy /Y "%PROJECT_DIR%\project-hub\register.py" "%HUB_DIR%\register.py"
    copy /Y "%PROJECT_DIR%\project-hub\github-sync.py" "%HUB_DIR%\github-sync.py"
    echo ProjectHub installed at %HUB_DIR%
)

REM -- Step 5: Register this project with the running Hub --
echo.
echo Registering with ProjectHub...
curl -s -X POST http://localhost:8090/api/projects ^
  -H "Content-Type: application/json" ^
  -d "{\"name\":\"Distributed Claude Agents\",\"description\":\"Local-first multi-agent system where 7 specialized AI bots collaborate to decompose, plan, execute, and verify user tasks concurrently.\",\"status\":\"active\",\"platform\":\"PC\",\"tags\":[\"typescript\",\"react\",\"docker\",\"multi-agent\"],\"path\":\"D:\\ProjectsHome\\distributed-claude-agents\",\"repo\":\"https://github.com/lance-fisher/exo\",\"branch\":\"claude/distributed-claude-agents-oR46c\"}" >nul 2>&1
if %errorlevel%==0 (
    echo Registered with running Hub.
) else (
    echo Hub not currently running. Project will appear on next Scan.
)

REM -- Step 6: Create desktop shortcut to start the agents --
echo.
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
    echo echo   Control UI:   http://localhost:3000
    echo echo   ProjectHub:   http://localhost:8090
    echo echo ========================================
    echo echo.
    echo echo Press any key to view logs ^(Ctrl+C to stop^)...
    echo pause ^>nul
    echo docker compose logs -f
) > "%DESKTOP%\Distributed Claude Agents.bat"

REM -- Step 7: Create desktop shortcut to start ProjectHub --
(
    echo @echo off
    echo cd /d "%HUB_DIR%"
    echo echo Starting ProjectsHome Hub...
    echo python server.py
) > "%DESKTOP%\ProjectsHome Hub.bat"

REM -- Step 8: Create desktop instructions --
(
    echo =============================================
    echo   DISTRIBUTED CLAUDE AGENTS
    echo =============================================
    echo.
    echo QUICK START
    echo   1. Double-click "ProjectsHome Hub.bat" to start the dashboard
    echo   2. Double-click "Distributed Claude Agents.bat" to start the agents
    echo   3. Open http://localhost:3000 for the agent UI
    echo   4. Open http://localhost:8090 for the project dashboard
    echo.
    echo WORKS EVERYWHERE
    echo   - Windows: use this setup, desktop shortcuts, Claude Code
    echo   - iPhone: Claude app creates branches on GitHub, Hub syncs them
    echo   - Any project with a project-hub.json auto-registers on Scan
    echo.
    echo ADDING NEW PROJECTS
    echo   Option A: Click "+ Add Project" in the Hub dashboard
    echo   Option B: Put a project-hub.json in your project folder, click Scan
    echo   Option C: Run "python register.py" from any project directory
    echo   Option D: Projects from iPhone Claude appear via GitHub sync
    echo.
    echo GITHUB SYNC ^(for iPhone Claude projects^)
    echo   set GITHUB_TOKEN=your_token
    echo   cd D:\ProjectsHome\project-hub
    echo   python github-sync.py
    echo.
    echo PORTS
    echo   3000 - Agent Control UI
    echo   3001 - Orchestrator API
    echo   8090 - ProjectsHome Hub
    echo =============================================
) > "%DESKTOP%\Distributed Claude Agents - README.txt"

echo.
echo  ========================================
echo   Setup complete!
echo  ========================================
echo.
echo   Desktop shortcuts created:
echo     - Distributed Claude Agents.bat  (starts agents)
echo     - ProjectsHome Hub.bat           (starts dashboard)
echo     - README.txt                     (instructions)
echo.
echo   Project:    %PROJECT_DIR%
echo   Hub:        %HUB_DIR%
echo   Agent UI:   http://localhost:3000
echo   Hub UI:     http://localhost:8090
echo.
pause
