#Requires -Version 5.1
<#
.SYNOPSIS
    Start the Ollama runtime in hardened mode.

.DESCRIPTION
    PURPOSE:
    Start the Ollama local inference server using the restricted enclave
    context. Enforces working directory, ensures logs go to the enclave
    logs directory, and confirms outbound firewall block is in place
    before starting. Fails closed if any security check fails.

    CHANGES:
    - Starts the Ollama server process
    - Writes logs to D:\ProjectsHome\LLM_Enclave\QWEN35\logs\runtime\
    - Sets environment variables for the process

    PREREQS:
    - Enclave provisioned (01_provision_enclave.ps1)
    - Model downloaded and verified (02_download_model.ps1)
    - Ollama binary present at runtime\bin\ollama.exe
    - Modelfile configured at runtime\config\Modelfile

    ROLLBACK:
    - Stop the process: Stop-Process -Name "ollama" -Force
    - No persistent changes are made by this script.

    SECURITY NOTES:
    - This script FAILS CLOSED: if any pre-start check fails, Ollama does not start.
    - Verifies firewall rules are active before starting.
    - Forces working directory to the enclave root.
    - Binds Ollama to 127.0.0.1 only.
    - Disables telemetry via environment variables.
#>

param(
    [switch]$SkipFirewallCheck,
    [int]$Port = 11434,
    [switch]$Background
)

# -------------------------------------------------------------------
# Configuration
# -------------------------------------------------------------------
$EnclaveRoot = (Split-Path -Parent (Split-Path -Parent $PSCommandPath))
# Resolve Ollama binary: prefer system PATH, fallback to enclave binary
$OllamaPath = (Get-Command ollama -ErrorAction SilentlyContinue).Source
if (-not $OllamaPath -or -not (Test-Path $OllamaPath)) {
    $OllamaPath = "$EnclaveRoot\runtime\bin\ollama.exe"
}
$LogDir = "$EnclaveRoot\logs\runtime"
$LogFile = "$EnclaveRoot\logs\provision.log"
$ModelfilePath = "$EnclaveRoot\runtime\config\Modelfile"

# -------------------------------------------------------------------
# Helper Functions
# -------------------------------------------------------------------
function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $entry = "$timestamp | $Level | 03_run_runtime | $Message"
    Add-Content -Path $LogFile -Value $entry -ErrorAction SilentlyContinue
    switch ($Level) {
        "ERROR"   { Write-Host $entry -ForegroundColor Red }
        "WARN"    { Write-Host $entry -ForegroundColor Yellow }
        "SUCCESS" { Write-Host $entry -ForegroundColor Green }
        default   { Write-Host $entry }
    }
}

# -------------------------------------------------------------------
# Pre-Start Checks (FAIL CLOSED)
# -------------------------------------------------------------------
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " OLLAMA RUNTIME - PRE-START CHECKS" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$allChecksPassed = $true

# Check 1: Enclave exists
Write-Host "`n[CHECK 1] Enclave directory exists..." -NoNewline
if (Test-Path $EnclaveRoot) {
    Write-Host " PASS" -ForegroundColor Green
} else {
    Write-Host " FAIL" -ForegroundColor Red
    Write-Log "Pre-start check FAILED: Enclave directory does not exist" "ERROR"
    $allChecksPassed = $false
}

# Check 2: Ollama binary exists
Write-Host "[CHECK 2] Ollama binary exists..." -NoNewline
if (Test-Path $OllamaPath) {
    Write-Host " PASS" -ForegroundColor Green
} else {
    Write-Host " FAIL" -ForegroundColor Red
    Write-Log "Pre-start check FAILED: Ollama binary not found at $OllamaPath" "ERROR"
    $allChecksPassed = $false
}

# Check 3: Modelfile exists
Write-Host "[CHECK 3] Modelfile exists..." -NoNewline
if (Test-Path $ModelfilePath) {
    # Check that the FROM line has been configured
    $modelfileContent = Get-Content $ModelfilePath -Raw
    if ($modelfileContent -match "MODEL_FILE_NAME_HERE") {
        Write-Host " FAIL (not configured)" -ForegroundColor Red
        Write-Host "  The Modelfile still has the placeholder. Update the FROM line." -ForegroundColor Yellow
        Write-Log "Pre-start check FAILED: Modelfile not configured" "ERROR"
        $allChecksPassed = $false
    } else {
        Write-Host " PASS" -ForegroundColor Green
    }
} else {
    Write-Host " FAIL" -ForegroundColor Red
    Write-Log "Pre-start check FAILED: Modelfile not found at $ModelfilePath" "ERROR"
    $allChecksPassed = $false
}

# Check 4: Firewall rules active
if (-not $SkipFirewallCheck) {
    Write-Host "[CHECK 4] Firewall outbound block active..." -NoNewline
    # Check for firewall rule under either naming convention
    $fwRule = Get-NetFirewallRule -DisplayName "LLM_Enclave: Block Ollama Outbound" -ErrorAction SilentlyContinue
    if (-not $fwRule) {
        $fwRule = Get-NetFirewallRule -DisplayName "Block Ollama Outbound" -ErrorAction SilentlyContinue
    }
    if ($fwRule -and $fwRule.Enabled -eq "True" -and $fwRule.Action -eq "Block") {
        Write-Host " PASS" -ForegroundColor Green
    } else {
        Write-Host " FAIL" -ForegroundColor Red
        Write-Host "  Ollama outbound firewall block is not active!" -ForegroundColor Red
        Write-Host "  Run 01_provision_enclave.ps1 as Administrator to create firewall rules." -ForegroundColor Yellow
        Write-Log "Pre-start check FAILED: Firewall block not active" "ERROR"
        $allChecksPassed = $false
    }
} else {
    Write-Host "[CHECK 4] Firewall check SKIPPED (user override)" -ForegroundColor Yellow
    Write-Log "Firewall check skipped by user" "WARN"
}

# Check 5: Log directory exists
Write-Host "[CHECK 5] Log directory exists..." -NoNewline
if (Test-Path $LogDir) {
    Write-Host " PASS" -ForegroundColor Green
} else {
    Write-Host " FAIL" -ForegroundColor Red
    Write-Log "Pre-start check FAILED: Log directory does not exist" "ERROR"
    $allChecksPassed = $false
}

# Check 6: No existing Ollama process
Write-Host "[CHECK 6] No existing Ollama process..." -NoNewline
$existingOllama = Get-Process -Name "ollama" -ErrorAction SilentlyContinue
if ($existingOllama) {
    Write-Host " WARN (already running)" -ForegroundColor Yellow
    Write-Host "  Ollama is already running (PID: $($existingOllama.Id))." -ForegroundColor Yellow
    Write-Host "  Stop it first with: Stop-Process -Name 'ollama' -Force" -ForegroundColor Yellow
    Write-Log "Ollama already running (PID: $($existingOllama.Id))" "WARN"
    # Not a hard failure, but warn
} else {
    Write-Host " PASS" -ForegroundColor Green
}

# -------------------------------------------------------------------
# FAIL CLOSED
# -------------------------------------------------------------------
if (-not $allChecksPassed) {
    Write-Host "`n========================================" -ForegroundColor Red
    Write-Host " PRE-START CHECKS FAILED" -ForegroundColor Red
    Write-Host " Ollama will NOT be started." -ForegroundColor Red
    Write-Host " Fix the issues above and try again." -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Log "Runtime start ABORTED due to failed pre-start checks" "ERROR"
    exit 1
}

# -------------------------------------------------------------------
# Start Ollama
# -------------------------------------------------------------------
Write-Host "`n--- Starting Ollama Runtime ---" -ForegroundColor Cyan

# Set environment for this process
$env:OLLAMA_HOST = "127.0.0.1:$Port"
$env:OLLAMA_NOPRUNE = "1"
$env:OLLAMA_KEEP_ALIVE = "30m"
$env:OLLAMA_NUM_PARALLEL = "1"
$env:OLLAMA_MAX_LOADED_MODELS = "1"
$env:DO_NOT_TRACK = "1"
$env:OLLAMA_MODELS = "$EnclaveRoot\models"

# Set working directory to enclave root
Set-Location $EnclaveRoot

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$stdoutLog = "$LogDir\ollama_stdout_$timestamp.log"
$stderrLog = "$LogDir\ollama_stderr_$timestamp.log"

Write-Host "Ollama executable: $OllamaPath"
Write-Host "Binding to:        127.0.0.1:$Port"
Write-Host "Working directory:  $EnclaveRoot"
Write-Host "Stdout log:         $stdoutLog"
Write-Host "Stderr log:         $stderrLog"
Write-Log "Starting Ollama: Host=127.0.0.1:$Port WorkDir=$EnclaveRoot"

if ($Background) {
    # Start in background
    $process = Start-Process `
        -FilePath $OllamaPath `
        -ArgumentList "serve" `
        -WorkingDirectory $EnclaveRoot `
        -RedirectStandardOutput $stdoutLog `
        -RedirectStandardError $stderrLog `
        -PassThru `
        -NoNewWindow

    Start-Sleep -Seconds 3

    if (-not $process.HasExited) {
        Write-Host "`n========================================" -ForegroundColor Green
        Write-Host " OLLAMA STARTED SUCCESSFULLY" -ForegroundColor Green
        Write-Host " PID: $($process.Id)" -ForegroundColor Green
        Write-Host " Endpoint: http://127.0.0.1:$Port" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
        Write-Log "Ollama started successfully. PID=$($process.Id)" "SUCCESS"

        Write-Host "`nTo test: Invoke-RestMethod -Uri 'http://127.0.0.1:$Port/api/tags'"
        Write-Host "To stop: Stop-Process -Id $($process.Id) -Force"
    } else {
        Write-Error "Ollama exited immediately. Check logs at:"
        Write-Error "  $stderrLog"
        Write-Log "Ollama exited immediately after start" "ERROR"
        exit 1
    }
} else {
    # Start in foreground (interactive)
    Write-Host "`nStarting Ollama in foreground (Ctrl+C to stop)..." -ForegroundColor Yellow
    Write-Log "Starting Ollama in foreground mode"
    & $OllamaPath serve 2>&1 | Tee-Object -FilePath $stdoutLog
}
