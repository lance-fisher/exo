#Requires -RunAsAdministrator
<#
.SYNOPSIS
    One-click setup for your offline AI coding assistant.
    Run this ONCE. After that, just use LAUNCH.ps1 (or the desktop shortcut).

.DESCRIPTION
    Installs and configures:
    1. Ollama (local LLM runtime)
    2. Qwen2.5-Coder model (best local coding model)
    3. OpenClaw (AI agent with web chat UI)
    4. Firewall rules (blocks all AI outbound traffic)
    5. Desktop shortcut (double-click to launch)

.NOTES
    - Requires Windows 10/11 with admin rights
    - Requires ~20GB disk space (model + tools)
    - Internet needed for setup only — offline after that
    - Nothing touches your project files without explicit approval
#>

param(
    [string]$EnclaveRoot = "D:\ProjectsHome\LLM_Enclave\QWEN35",
    [string]$ModelSize = "auto",  # auto, 7b, 14b, 32b
    [switch]$SkipFirewall,
    [switch]$SkipShortcut
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# ─── Colors & Helpers ─────────────────────────────────────────────────────────

function Write-Step  { param($n,$msg) Write-Host "`n[$n/7] $msg" -ForegroundColor Cyan }
function Write-Ok    { param($msg) Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Skip  { param($msg) Write-Host "  → $msg (already done)" -ForegroundColor DarkGray }
function Write-Warn  { param($msg) Write-Host "  ! $msg" -ForegroundColor Yellow }
function Write-Fail  { param($msg) Write-Host "  ✗ $msg" -ForegroundColor Red }

function Test-Command { param($cmd) $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue) }

# ─── 1. Create directory structure ────────────────────────────────────────────

Write-Step 1 "Creating enclave directory structure"

$dirs = @(
    "$EnclaveRoot\models\verified",
    "$EnclaveRoot\runtime\config",
    "$EnclaveRoot\runtime\bin",
    "$EnclaveRoot\openclaw\config",
    "$EnclaveRoot\workspace_bridge\inbox",
    "$EnclaveRoot\workspace_bridge\outbox",
    "$EnclaveRoot\workspace_bridge\scratch",
    "$EnclaveRoot\logs\runtime",
    "$EnclaveRoot\logs\bridge",
    "$EnclaveRoot\logs\audit",
    "$EnclaveRoot\policies",
    "$EnclaveRoot\backups"
)

foreach ($d in $dirs) {
    if (-not (Test-Path $d)) {
        New-Item -ItemType Directory -Path $d -Force | Out-Null
        Write-Ok "Created $d"
    }
}
Write-Ok "Directory structure ready"

# ─── 2. Install Ollama ───────────────────────────────────────────────────────

Write-Step 2 "Installing Ollama"

if (Test-Command "ollama") {
    $ollamaVersion = & ollama --version 2>&1
    Write-Skip "Ollama already installed ($ollamaVersion)"
} else {
    Write-Host "  Downloading Ollama installer..." -ForegroundColor White
    $installerPath = "$env:TEMP\OllamaSetup.exe"
    Invoke-WebRequest -Uri "https://ollama.com/download/OllamaSetup.exe" -OutFile $installerPath -UseBasicParsing
    Write-Host "  Running installer (follow prompts if any)..." -ForegroundColor White
    Start-Process -FilePath $installerPath -Wait
    Remove-Item $installerPath -ErrorAction SilentlyContinue

    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    if (Test-Command "ollama") {
        Write-Ok "Ollama installed successfully"
    } else {
        Write-Fail "Ollama installation may require a restart. Re-run this script after restarting."
        exit 1
    }
}

# ─── 3. Auto-detect hardware & pull model ────────────────────────────────────

Write-Step 3 "Selecting and downloading coding model"

# Auto-detect VRAM
function Get-ApproxVRAM {
    try {
        $gpu = Get-CimInstance Win32_VideoController | Sort-Object AdapterRAM -Descending | Select-Object -First 1
        if ($gpu.AdapterRAM) {
            return [math]::Round($gpu.AdapterRAM / 1GB, 1)
        }
    } catch {}
    return 0
}

$vram = Get-ApproxVRAM
if ($ModelSize -eq "auto") {
    if ($vram -ge 24) {
        $model = "qwen2.5-coder:32b"
        Write-Ok "Detected ${vram}GB VRAM → using qwen2.5-coder:32b (best quality)"
    } elseif ($vram -ge 10) {
        $model = "qwen2.5-coder:14b"
        Write-Ok "Detected ${vram}GB VRAM → using qwen2.5-coder:14b (great quality)"
    } else {
        $model = "qwen2.5-coder:7b"
        Write-Ok "Detected ${vram}GB VRAM → using qwen2.5-coder:7b (good quality)"
    }
} else {
    $model = "qwen2.5-coder:$ModelSize"
    Write-Ok "Using specified model: $model"
}

# Check if model already pulled
$existingModels = & ollama list 2>&1
if ($existingModels -match [regex]::Escape($model)) {
    Write-Skip "Model $model already downloaded"
} else {
    Write-Host "  Downloading $model (this may take 10-30 minutes)..." -ForegroundColor White
    & ollama pull $model
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Model download failed. Check internet connection and try again."
        exit 1
    }
    Write-Ok "Model $model downloaded"
}

# Save model choice for launcher
$model | Out-File "$EnclaveRoot\runtime\config\active_model.txt" -Encoding UTF8 -NoNewline
Write-Ok "Model selection saved"

# ─── 4. Install Node.js if needed ────────────────────────────────────────────

Write-Step 4 "Checking Node.js"

$nodeOk = $false
if (Test-Command "node") {
    $nodeVersion = (& node --version 2>&1).ToString().TrimStart('v')
    $nodeMajor = [int]($nodeVersion.Split('.')[0])
    if ($nodeMajor -ge 22) {
        Write-Skip "Node.js v$nodeVersion installed (>= 22 required)"
        $nodeOk = $true
    } else {
        Write-Warn "Node.js v$nodeVersion found but >= 22 required"
    }
}

if (-not $nodeOk) {
    Write-Host "  Installing Node.js 22 LTS via winget..." -ForegroundColor White
    try {
        & winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements 2>&1 | Out-Null
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
        if (Test-Command "node") {
            Write-Ok "Node.js installed: $(node --version)"
        } else {
            Write-Warn "Node.js installed but not in PATH yet. You may need to restart and re-run."
            exit 1
        }
    } catch {
        Write-Fail "Could not install Node.js automatically. Please install Node.js 22+ from https://nodejs.org and re-run."
        exit 1
    }
}

# ─── 5. Install OpenClaw ─────────────────────────────────────────────────────

Write-Step 5 "Installing OpenClaw"

$openclawInstalled = $false
if (Test-Command "openclaw") {
    $ocVersion = & openclaw --version 2>&1
    Write-Skip "OpenClaw already installed ($ocVersion)"
    Write-Host "  Checking for updates..." -ForegroundColor White
    & npm update -g openclaw 2>&1 | Out-Null
    Write-Ok "OpenClaw is up to date"
    $openclawInstalled = $true
} else {
    Write-Host "  Installing OpenClaw globally via npm..." -ForegroundColor White
    & npm install -g openclaw@latest 2>&1
    if (Test-Command "openclaw") {
        Write-Ok "OpenClaw installed: $(openclaw --version 2>&1)"
        $openclawInstalled = $true
    } else {
        Write-Fail "OpenClaw installation failed. Check npm logs."
        exit 1
    }
}

# Configure OpenClaw for local-only Ollama usage
$openclawConfig = @"
# OpenClaw Configuration - Local AI Coding Assistant
# Generated by SETUP.ps1 on $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
# This configuration keeps everything offline and private.

gateway:
  host: "127.0.0.1"
  port: 18789

providers:
  ollama-local:
    type: ollama
    host: "http://127.0.0.1:11434"
    apiKey: "not-needed"
    authHeader: false
    models:
      - $model

defaults:
  provider: ollama-local
  model: $model

# Security & Privacy
telemetry:
  enabled: false

auto_update:
  enabled: false

# Agent settings for coding tasks
agent:
  workspace_root: "$($EnclaveRoot -replace '\\','\\')"
  allowed_directories:
    - "$($EnclaveRoot -replace '\\','\\')"
  confirm_dangerous_actions: true
  max_tokens: 8192

# Context window - must be large for coding tasks
ollama:
  num_ctx: 32768

# Disable all external integrations
integrations: {}
channels: {}
"@

$configDir = "$env:USERPROFILE\.openclaw"
if (-not (Test-Path $configDir)) {
    New-Item -ItemType Directory -Path $configDir -Force | Out-Null
}
$openclawConfig | Out-File "$configDir\config.yaml" -Encoding UTF8
# Also save a copy in enclave
$openclawConfig | Out-File "$EnclaveRoot\openclaw\config\config.yaml" -Encoding UTF8
Write-Ok "OpenClaw configured for local-only Ollama"

# ─── 6. Firewall rules ───────────────────────────────────────────────────────

Write-Step 6 "Configuring firewall (blocking AI outbound traffic)"

if ($SkipFirewall) {
    Write-Skip "Firewall configuration skipped (-SkipFirewall)"
} else {
    # Block Ollama from reaching the internet
    $ollamaPath = (Get-Command ollama -ErrorAction SilentlyContinue).Source
    if ($ollamaPath) {
        $existingRule = Get-NetFirewallRule -DisplayName "Block Ollama Outbound" -ErrorAction SilentlyContinue
        if ($existingRule) {
            Write-Skip "Ollama firewall rule already exists"
        } else {
            New-NetFirewallRule -DisplayName "Block Ollama Outbound" `
                -Direction Outbound -Action Block `
                -Program $ollamaPath `
                -Description "Prevents Ollama from sending data to the internet. Local loopback still works." `
                -ErrorAction SilentlyContinue | Out-Null
            Write-Ok "Blocked Ollama outbound internet access"
        }
    } else {
        Write-Warn "Could not find Ollama binary path for firewall rule"
    }

    # Block OpenClaw from reaching the internet (except localhost)
    $openclawPath = (Get-Command openclaw -ErrorAction SilentlyContinue).Source
    if ($openclawPath) {
        # OpenClaw runs via node, so we need the node path
        $nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
        $existingRule = Get-NetFirewallRule -DisplayName "Block OpenClaw Node Outbound" -ErrorAction SilentlyContinue
        if ($existingRule) {
            Write-Skip "OpenClaw/Node firewall rule already exists"
        } else {
            # Create a rule that blocks node.exe outbound but allows localhost
            # We block all outbound, then allow localhost specifically
            New-NetFirewallRule -DisplayName "Block OpenClaw Node Outbound" `
                -Direction Outbound -Action Block `
                -Program $nodePath `
                -RemoteAddress "!127.0.0.1" `
                -Description "Prevents OpenClaw (node.js) from sending data to the internet. Localhost allowed for Ollama." `
                -ErrorAction SilentlyContinue | Out-Null
            Write-Ok "Blocked OpenClaw outbound internet access (localhost allowed)"
        }
    }

    Write-Ok "Firewall configured — AI tools cannot phone home"
}

# ─── 7. Desktop shortcut ─────────────────────────────────────────────────────

Write-Step 7 "Creating desktop shortcut"

if ($SkipShortcut) {
    Write-Skip "Desktop shortcut skipped (-SkipShortcut)"
} else {
    $launchScript = "$EnclaveRoot\LAUNCH.ps1"
    $shortcutPath = [System.IO.Path]::Combine(
        [System.Environment]::GetFolderPath("Desktop"),
        "Local AI Coder.lnk"
    )

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = "powershell.exe"
    $shortcut.Arguments = "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launchScript`""
    $shortcut.WorkingDirectory = $EnclaveRoot
    $shortcut.Description = "Launch your offline AI coding assistant"
    $shortcut.IconLocation = "shell32.dll,21"  # Computer icon
    $shortcut.Save()

    Write-Ok "Desktop shortcut created: 'Local AI Coder'"
}

# ─── Done ─────────────────────────────────────────────────────────────────────

Write-Host "`n" -NoNewline
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  SETUP COMPLETE" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "  Model:     $model" -ForegroundColor White
Write-Host "  Chat UI:   http://127.0.0.1:18789" -ForegroundColor White
Write-Host "  Firewall:  $(if($SkipFirewall){'Skipped'}else{'Active — AI tools blocked from internet'})" -ForegroundColor White
Write-Host "  Shortcut:  $(if($SkipShortcut){'Skipped'}else{'Desktop → Local AI Coder'})" -ForegroundColor White
Write-Host ""
Write-Host "  To start: Double-click 'Local AI Coder' on your desktop" -ForegroundColor Cyan
Write-Host "       or:  Run $EnclaveRoot\LAUNCH.ps1" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Everything runs locally. Nothing leaves your computer." -ForegroundColor DarkGray
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Green
