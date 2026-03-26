# =============================================================================
# Sovereign Console — Windows Local Agent Setup
# Prerequisites: Node.js 20+, npm
# =============================================================================

param(
    [string]$BrokerUrl = "https://ops.lancewfisher.com",
    [string]$CertsDir = "$PSScriptRoot\..\certs",
    [string]$AgentDir = "$PSScriptRoot\..\local-agent"
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "[+] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "[x] $msg" -ForegroundColor Red }

Write-Host ""
Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host "  Sovereign Console — Local Agent Setup (Windows)" -ForegroundColor Cyan
Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------------------------------------------------
# 1. Check prerequisites
# ---------------------------------------------------------------------------
Write-Step "Checking prerequisites..."

# Node.js
try {
    $nodeVersion = (node --version 2>&1).ToString().TrimStart('v')
    $nodeMajor = [int]($nodeVersion.Split('.')[0])
    if ($nodeMajor -lt 20) {
        Write-Err "Node.js 20+ required. Found: v$nodeVersion"
        Write-Host "Download from: https://nodejs.org/" -ForegroundColor Yellow
        exit 1
    }
    Write-Step "Node.js v$nodeVersion detected."
} catch {
    Write-Err "Node.js not found. Install from https://nodejs.org/ (v20+)."
    exit 1
}

# npm
try {
    $npmVersion = (npm --version 2>&1).ToString()
    Write-Step "npm v$npmVersion detected."
} catch {
    Write-Err "npm not found. It should be bundled with Node.js."
    exit 1
}

# Claude Code CLI
try {
    $claudeVersion = (claude --version 2>&1).ToString()
    Write-Step "Claude Code CLI detected: $claudeVersion"
} catch {
    Write-Warn "Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code"
    Write-Warn "The agent can start without it, but task execution will fail."
}

# ---------------------------------------------------------------------------
# 2. Verify certificate files exist
# ---------------------------------------------------------------------------
Write-Step "Checking mTLS certificate files..."

$requiredCerts = @("ca.pem", "agent.pem", "agent-key.pem")
$certsPath = Resolve-Path $CertsDir -ErrorAction SilentlyContinue

if (-not $certsPath) {
    Write-Err "Certs directory not found: $CertsDir"
    Write-Host "Run generate-certs.sh on the broker first, then copy agent certs here." -ForegroundColor Yellow
    exit 1
}

foreach ($cert in $requiredCerts) {
    $certPath = Join-Path $certsPath $cert
    if (-not (Test-Path $certPath)) {
        Write-Err "Missing certificate: $certPath"
        Write-Host "Ensure all mTLS certs are copied from the broker." -ForegroundColor Yellow
        exit 1
    }
}
Write-Step "All certificate files present."

# ---------------------------------------------------------------------------
# 3. Install dependencies
# ---------------------------------------------------------------------------
Write-Step "Installing npm dependencies..."

Push-Location $AgentDir
try {
    npm install --production 2>&1 | Out-Null
    Write-Step "Dependencies installed."
} catch {
    Write-Err "npm install failed: $_"
    Pop-Location
    exit 1
}

# ---------------------------------------------------------------------------
# 4. Build TypeScript
# ---------------------------------------------------------------------------
Write-Step "Building TypeScript..."

try {
    npm run build 2>&1 | Out-Null
    Write-Step "Build complete."
} catch {
    Write-Err "Build failed: $_"
    Pop-Location
    exit 1
}

Pop-Location

# ---------------------------------------------------------------------------
# 5. Create agent configuration
# ---------------------------------------------------------------------------
Write-Step "Creating agent configuration..."

$agentConfigDir = Join-Path $env:APPDATA "sovereign-console"
$agentConfigFile = Join-Path $agentConfigDir "agent.json"

if (-not (Test-Path $agentConfigDir)) {
    New-Item -ItemType Directory -Path $agentConfigDir -Force | Out-Null
}

if (-not (Test-Path $agentConfigFile)) {
    $config = @{
        broker_url       = $BrokerUrl
        broker_ws_url    = $BrokerUrl.Replace("https://", "wss://") + "/ws/agent"
        certs_dir        = $certsPath.Path
        projects_root    = (Join-Path $env:USERPROFILE "projects")
        log_level        = "info"
        reconnect_delay  = 5000
        heartbeat_interval = 30000
    } | ConvertTo-Json -Depth 3

    Set-Content -Path $agentConfigFile -Value $config -Encoding UTF8
    Write-Step "Configuration written to: $agentConfigFile"
} else {
    Write-Warn "Configuration already exists at: $agentConfigFile"
}

# ---------------------------------------------------------------------------
# 6. Install as Windows service
# ---------------------------------------------------------------------------
Write-Step "Installing as Windows service..."

$installServiceScript = Join-Path $AgentDir "scripts\install-service.ps1"
if (Test-Path $installServiceScript) {
    try {
        & $installServiceScript
        Write-Step "Service installed."
    } catch {
        Write-Warn "Service installation failed: $_"
        Write-Host "You can run the agent manually: cd $AgentDir && npm start" -ForegroundColor Yellow
    }
} else {
    Write-Warn "install-service.ps1 not found. Setting up manual start instead."

    # Create a start script
    $startScript = Join-Path $AgentDir "start-agent.ps1"
    @"
# Sovereign Console Local Agent — Manual Start
`$env:AGENT_CONFIG = "$agentConfigFile"
Set-Location "$AgentDir"
node dist/index.js
"@ | Set-Content -Path $startScript -Encoding UTF8
    Write-Step "Manual start script created: $startScript"
}

# ---------------------------------------------------------------------------
# 7. Verify service started
# ---------------------------------------------------------------------------
Write-Step "Verifying agent is running..."

Start-Sleep -Seconds 3

$serviceName = "SovereignConsoleAgent"
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue

if ($service -and $service.Status -eq "Running") {
    Write-Step "Service '$serviceName' is running."
} else {
    Write-Warn "Service is not running. You may need to start it manually."
}

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Step "Local agent setup complete!"
Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Connection details:" -ForegroundColor White
Write-Host "  Broker URL:    $BrokerUrl" -ForegroundColor Gray
Write-Host "  Config file:   $agentConfigFile" -ForegroundColor Gray
Write-Host "  Agent dir:     $AgentDir" -ForegroundColor Gray
Write-Host "  Certs dir:     $certsPath" -ForegroundColor Gray
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Ensure the broker is running at $BrokerUrl" -ForegroundColor Gray
Write-Host "  2. Enroll this device via the Console UI" -ForegroundColor Gray
Write-Host "  3. Register a passkey for authentication" -ForegroundColor Gray
Write-Host "  4. Verify connection: the broker should show 'agent.connect' in audit logs" -ForegroundColor Gray
Write-Host ""
Write-Host "Useful commands:" -ForegroundColor White
Write-Host "  Start service:  Start-Service $serviceName" -ForegroundColor Gray
Write-Host "  Stop service:   Stop-Service $serviceName" -ForegroundColor Gray
Write-Host "  View logs:      Get-Content $agentConfigDir\agent.log -Tail 50 -Wait" -ForegroundColor Gray
Write-Host "=============================================================================" -ForegroundColor Cyan
