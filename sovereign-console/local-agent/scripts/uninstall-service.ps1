#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Uninstall the Sovereign Console Local Agent Windows service.

.DESCRIPTION
    This script:
    1. Stops the running service
    2. Uninstalls the service via WinSW
    3. Optionally removes the service account
    4. Optionally removes certificates and logs

.NOTES
    Run from the local-agent directory:
      powershell -ExecutionPolicy Bypass -File scripts\uninstall-service.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Configuration ────────────────────────────────────────────────────────────

$ServiceName   = "SovereignConsoleAgent"
$ServiceAccount = "SovereignAgent"
$AgentDir      = Split-Path -Parent $PSScriptRoot
$WinSwExe      = Join-Path $AgentDir "SovereignConsoleAgent.exe"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " Sovereign Console Local Agent — Uninstaller" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Verify Administrator ─────────────────────────────────────────────────

$currentPrincipal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent()
)
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script must be run as Administrator."
    exit 1
}

# ── 2. Stop Service ─────────────────────────────────────────────────────────

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
    Write-Host "Stopping service '$ServiceName'..." -ForegroundColor Yellow
    if ($svc.Status -eq "Running") {
        if (Test-Path $WinSwExe) {
            & $WinSwExe stop 2>&1 | Out-Null
        } else {
            Stop-Service -Name $ServiceName -Force
        }
        Start-Sleep -Seconds 3
    }
    Write-Host "[OK] Service stopped" -ForegroundColor Green
} else {
    Write-Host "[INFO] Service '$ServiceName' not found (may already be uninstalled)" -ForegroundColor Gray
}

# ── 3. Uninstall Service ────────────────────────────────────────────────────

if (Test-Path $WinSwExe) {
    Write-Host "Uninstalling service via WinSW..." -ForegroundColor Yellow
    Push-Location $AgentDir
    try {
        & $WinSwExe uninstall 2>&1 | Out-Null
    } catch {
        Write-Host "[WARN] WinSW uninstall returned an error (service may already be removed)" -ForegroundColor Yellow
    } finally {
        Pop-Location
    }
    Start-Sleep -Seconds 2
    Write-Host "[OK] Service uninstalled" -ForegroundColor Green
} elseif ($svc) {
    # Fallback: use sc.exe if WinSW is not present
    Write-Host "WinSW not found, using sc.exe to remove service..." -ForegroundColor Yellow
    sc.exe delete $ServiceName | Out-Null
    Write-Host "[OK] Service removed via sc.exe" -ForegroundColor Green
}

# ── 4. Optionally Remove Service Account ────────────────────────────────────

Write-Host ""
$removeAccount = Read-Host "Remove the '$ServiceAccount' service account? (y/N)"
if ($removeAccount -eq "y" -or $removeAccount -eq "Y") {
    try {
        Remove-LocalUser -Name $ServiceAccount -ErrorAction Stop
        Write-Host "[OK] Service account '$ServiceAccount' removed" -ForegroundColor Green
    } catch {
        Write-Host "[WARN] Could not remove service account: $_" -ForegroundColor Yellow
    }

    # Remove credential file
    $credPath = Join-Path $AgentDir ".service-cred"
    if (Test-Path $credPath) {
        Remove-Item -Path $credPath -Force
        Write-Host "[OK] Credential file removed" -ForegroundColor Green
    }
} else {
    Write-Host "[INFO] Service account preserved" -ForegroundColor Gray
}

# ── 5. Optionally Remove Certificates and Logs ──────────────────────────────

Write-Host ""
$removeCerts = Read-Host "Remove certificates (certs/) and logs (logs/)? (y/N)"
if ($removeCerts -eq "y" -or $removeCerts -eq "Y") {
    $certsDir = Join-Path $AgentDir "certs"
    $logsDir  = Join-Path $AgentDir "logs"

    if (Test-Path $certsDir) {
        Remove-Item -Path $certsDir -Recurse -Force
        Write-Host "[OK] Certificates removed" -ForegroundColor Green
    }

    if (Test-Path $logsDir) {
        Remove-Item -Path $logsDir -Recurse -Force
        Write-Host "[OK] Logs removed" -ForegroundColor Green
    }
} else {
    Write-Host "[INFO] Certificates and logs preserved" -ForegroundColor Gray
}

# ── 6. Clean Up WinSW Files ─────────────────────────────────────────────────

Write-Host ""
$removeWinsw = Read-Host "Remove WinSW executable and XML config? (y/N)"
if ($removeWinsw -eq "y" -or $removeWinsw -eq "Y") {
    $xmlFile = Join-Path $AgentDir "SovereignConsoleAgent.xml"

    foreach ($file in @($WinSwExe, $xmlFile)) {
        if (Test-Path $file) {
            Remove-Item -Path $file -Force
        }
    }
    Write-Host "[OK] WinSW files removed" -ForegroundColor Green
} else {
    Write-Host "[INFO] WinSW files preserved" -ForegroundColor Gray
}

# ── Done ─────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " Uninstallation complete!"                     -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# Verify service is gone
$finalCheck = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($finalCheck) {
    Write-Host "[WARN] Service still appears registered. A reboot may be required." -ForegroundColor Yellow
} else {
    Write-Host "[OK] Service '$ServiceName' is fully removed." -ForegroundColor Green
}
Write-Host ""
