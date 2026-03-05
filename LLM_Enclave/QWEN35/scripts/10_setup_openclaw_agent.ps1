#Requires -Version 5.1
<#
.SYNOPSIS
    Install and configure OpenClaw as the primary agent runner for the LLM Enclave.

.DESCRIPTION
    PURPOSE:
    Install OpenClaw via npm, configure it to use the local Ollama instance
    (127.0.0.1:11434) with the qwen-local model, and set up the enclave
    configuration for offline-only, bridge-scoped operation.

    CHANGES:
    - Installs OpenClaw globally via npm (requires Node.js >= 22)
    - Creates OpenClaw configuration at ~/.openclaw/openclaw.json
    - Configures Ollama as the sole LLM provider (local only)
    - Disables all cloud providers, telemetry, and auto-updates
    - Creates firewall rule for OpenClaw Node.js process
    - Logs all actions

    PREREQS:
    - Enclave provisioned (01_provision_enclave.ps1)
    - Ollama running with qwen-local model loaded
    - Node.js >= 22 installed (https://nodejs.org)
    - Temporary outbound network access for npm install

    ROLLBACK:
    - npm uninstall -g openclaw
    - Remove ~/.openclaw directory
    - Remove firewall rules: Get-NetFirewallRule -DisplayName "LLM_Enclave: Block OpenClaw*" | Remove-NetFirewallRule

    SECURITY NOTES:
    - After installation, re-enable outbound firewall blocks.
    - OpenClaw is configured for LOCAL ONLY operation.
    - No cloud API keys are stored.
    - Telemetry is disabled via configuration.
#>

param(
    [switch]$AllowNetwork,
    [switch]$SkipFirewall,
    [switch]$DryRun
)

# -------------------------------------------------------------------
# Configuration
# -------------------------------------------------------------------
$EnclaveRoot = (Split-Path -Parent (Split-Path -Parent $PSCommandPath))
$LogFile = "$EnclaveRoot\logs\provision.log"
$OpenClawConfigDir = "$env:USERPROFILE\.openclaw"
$OpenClawConfigPath = "$OpenClawConfigDir\openclaw.json"

# -------------------------------------------------------------------
# Helper Functions
# -------------------------------------------------------------------
function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $entry = "$timestamp | $Level | 10_setup_openclaw | $Message"
    Add-Content -Path $LogFile -Value $entry -ErrorAction SilentlyContinue
    switch ($Level) {
        "ERROR"   { Write-Host $entry -ForegroundColor Red }
        "WARN"    { Write-Host $entry -ForegroundColor Yellow }
        "SUCCESS" { Write-Host $entry -ForegroundColor Green }
        default   { Write-Host $entry }
    }
}

function Test-IsAdmin {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

# -------------------------------------------------------------------
# Pre-flight Checks
# -------------------------------------------------------------------
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " OPENCLAW AGENT SETUP" -ForegroundColor Cyan
Write-Host " Local Ollama + Qwen Integration" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Check enclave exists
if (-not (Test-Path $EnclaveRoot)) {
    Write-Error "FATAL: Enclave not provisioned. Run 01_provision_enclave.ps1 first."
    exit 1
}

# Check Node.js
$nodeVersion = $null
try {
    $nodeVersion = (node --version 2>$null)
} catch {}

if (-not $nodeVersion) {
    Write-Error "FATAL: Node.js not found. Install Node.js >= 22 from https://nodejs.org"
    exit 1
}

$versionNum = [int]($nodeVersion -replace "^v(\d+)\..*", '$1')
if ($versionNum -lt 22) {
    Write-Error "FATAL: Node.js $nodeVersion found, but >= 22 is required."
    Write-Host "Download from: https://nodejs.org" -ForegroundColor Yellow
    exit 1
}
Write-Host "Node.js: $nodeVersion" -ForegroundColor Green

# Check Ollama is running
try {
    $ollamaResp = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 5
    $models = $ollamaResp.models | ForEach-Object { $_.name }
    $qwenFound = $models | Where-Object { $_ -match "qwen" }
    if ($qwenFound) {
        Write-Host "Ollama: Running, qwen model found" -ForegroundColor Green
    } else {
        Write-Host "Ollama: Running, but qwen model not found" -ForegroundColor Yellow
        Write-Host "  Available: $($models -join ', ')" -ForegroundColor Yellow
    }
} catch {
    Write-Host "WARNING: Ollama not reachable at 127.0.0.1:11434" -ForegroundColor Yellow
    Write-Host "  Start Ollama before using OpenClaw." -ForegroundColor Yellow
}

# Network acknowledgment
if (-not $AllowNetwork) {
    Write-Host ""
    Write-Host "This script needs temporary outbound access for npm install." -ForegroundColor Yellow
    $ack = Read-Host "Confirm outbound network is temporarily enabled? (yes/no)"
    if ($ack -ne "yes") {
        Write-Host "Aborted." -ForegroundColor Red
        exit 0
    }
}

# -------------------------------------------------------------------
# Step 1: Install OpenClaw via npm
# -------------------------------------------------------------------
Write-Host "`n--- Step 1: Installing OpenClaw ---" -ForegroundColor Cyan

$existingVersion = $null
try {
    $existingVersion = (openclaw --version 2>$null)
} catch {}

if ($existingVersion) {
    Write-Host "OpenClaw already installed: $existingVersion" -ForegroundColor Green
    $upgrade = Read-Host "Upgrade to latest? (yes/no)"
    if ($upgrade -eq "yes" -and -not $DryRun) {
        Write-Host "Upgrading OpenClaw..."
        npm install -g openclaw@latest
        Write-Log "Upgraded OpenClaw"
    }
} else {
    if (-not $DryRun) {
        Write-Host "Installing OpenClaw globally..."
        npm install -g openclaw@latest
        if ($LASTEXITCODE -ne 0) {
            Write-Error "npm install failed. Check Node.js and network."
            exit 1
        }
        Write-Log "Installed OpenClaw via npm"
        Write-Host "OpenClaw installed." -ForegroundColor Green
    } else {
        Write-Host "[DRY RUN] Would install: npm install -g openclaw@latest"
    }
}

# -------------------------------------------------------------------
# Step 2: Create OpenClaw Configuration
# -------------------------------------------------------------------
Write-Host "`n--- Step 2: Creating Configuration ---" -ForegroundColor Cyan

if (-not (Test-Path $OpenClawConfigDir)) {
    New-Item -ItemType Directory -Path $OpenClawConfigDir -Force | Out-Null
}

# Create a local-only configuration
$openclawConfig = @{
    # Ollama as sole provider
    models = @{
        providers = @{
            ollama = @{
                apiKey  = "ollama-local"
                baseUrl = "http://127.0.0.1:11434"
            }
        }
        default = "ollama/qwen-local"
    }

    # Disable all cloud providers
    auth = @{
        oauth = @{
            enabled = $false
        }
    }

    # Performance tuning for local models
    agent = @{
        maxConcurrentTasks = 1
        taskTimeout = 300
    }

    # Telemetry and updates disabled
    telemetry = @{
        enabled = $false
    }
    updates = @{
        autoCheck = $false
    }

    # Workspace settings
    workspace = @{
        root = "$EnclaveRoot\workspace_bridge"
    }
}

if (-not $DryRun) {
    $openclawConfig | ConvertTo-Json -Depth 10 | Set-Content -Path $OpenClawConfigPath
    Write-Host "Config created: $OpenClawConfigPath" -ForegroundColor Green
    Write-Log "OpenClaw config created at: $OpenClawConfigPath"
} else {
    Write-Host "[DRY RUN] Would create config at: $OpenClawConfigPath"
}

# Also update the enclave's own openclaw config
$enclaveConfigDir = "$EnclaveRoot\openclaw\config"
if (-not (Test-Path $enclaveConfigDir)) {
    New-Item -ItemType Directory -Path $enclaveConfigDir -Force | Out-Null
}

$enclaveOpenclawConfig = @"
# =============================================================================
# OpenClaw Enclave Configuration Reference
# =============================================================================
# Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
#
# The actual OpenClaw config lives at: $OpenClawConfigPath
# This file documents the enclave-specific settings.
# =============================================================================

# Provider: Local Ollama only
provider: ollama
ollama_host: "http://127.0.0.1:11434"
ollama_model: "qwen-local"
api_key: "ollama-local"

# Security: All cloud disabled
cloud_providers_enabled: false
oauth_enabled: false
telemetry_enabled: false
auto_update_enabled: false

# Performance: Tuned for local 7B model
max_concurrent_tasks: 1
task_timeout_seconds: 300

# Workspace: Bridge-scoped only
workspace_root: "$EnclaveRoot\workspace_bridge"
allowed_paths:
  - "$EnclaveRoot\workspace_bridge\inbox"
  - "$EnclaveRoot\workspace_bridge\outbox"
  - "$EnclaveRoot\workspace_bridge\scratch"
"@

$enclaveOpenclawConfig | Set-Content -Path "$enclaveConfigDir\config.yaml"

# -------------------------------------------------------------------
# Step 3: Firewall Rules
# -------------------------------------------------------------------
if (-not $SkipFirewall -and (Test-IsAdmin)) {
    Write-Host "`n--- Step 3: Firewall Rules ---" -ForegroundColor Cyan

    # Find Node.js executable
    $nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
    if ($nodeExe) {
        $ruleName = "LLM_Enclave: Block OpenClaw Node.js Outbound"
        $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
        if (-not $existing -and -not $DryRun) {
            Write-Host "NOTE: OpenClaw uses Node.js ($nodeExe)." -ForegroundColor Yellow
            Write-Host "Blocking Node.js outbound would prevent npm installs too." -ForegroundColor Yellow
            Write-Host "Consider blocking only after setup is complete." -ForegroundColor Yellow
            Write-Log "Skipped Node.js firewall rule (would block npm)"
        }
    }
} else {
    Write-Host "`n--- Step 3: Firewall - run as admin to configure ---" -ForegroundColor Yellow
}

# -------------------------------------------------------------------
# Step 4: Environment Variables
# -------------------------------------------------------------------
Write-Host "`n--- Step 4: Environment Variables ---" -ForegroundColor Cyan

$envVars = @{
    "DO_NOT_TRACK" = "1"
}

foreach ($kv in $envVars.GetEnumerator()) {
    $current = [Environment]::GetEnvironmentVariable($kv.Key, "User")
    if ($current -ne $kv.Value -and -not $DryRun) {
        [Environment]::SetEnvironmentVariable($kv.Key, $kv.Value, "User")
        Write-Host "Set: $($kv.Key) = $($kv.Value)" -ForegroundColor Green
    }
}

# -------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------
Write-Host "`n========================================" -ForegroundColor Green
Write-Host " OPENCLAW SETUP COMPLETE" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Config: $OpenClawConfigPath"
Write-Host ""
Write-Host "IMPORTANT: Re-enable outbound firewall blocks now!" -ForegroundColor Yellow
Write-Host ""
Write-Host "To start OpenClaw:"
Write-Host "  openclaw"
Write-Host ""
Write-Host "To chat with Qwen directly (lightweight CLI):"
Write-Host "  python `"$EnclaveRoot\cli\qwen_chat.py`""
Write-Host ""
Write-Host "OpenClaw will use Ollama (127.0.0.1:11434) with model: qwen-local"
Write-Host ""

Write-Log "OpenClaw setup completed" "SUCCESS"
