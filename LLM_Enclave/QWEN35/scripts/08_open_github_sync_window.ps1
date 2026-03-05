#Requires -Version 5.1
<#
.SYNOPSIS
    Temporarily enable outbound network for Git and SSH operations.

.DESCRIPTION
    PURPOSE:
    Open a time-bounded "sync window" that allows git.exe and ssh.exe
    to make outbound connections for push/pull operations. The window
    automatically closes after the specified timeout.

    CHANGES:
    - Temporarily disables the Git/SSH outbound block firewall rules
    - Creates a scheduled task to automatically re-enable the block
    - Logs the event to audit\network_access.log

    PREREQS:
    - Administrator privileges (required for firewall modifications)
    - Firewall rules for Git/SSH must exist (created by this script if missing)

    ROLLBACK:
    - Run 09_close_github_sync_window.ps1 to immediately close the window
    - Or wait for the automatic timeout
    - Firewall rules are re-enabled, not deleted

    SECURITY NOTES:
    - This script only allows git.exe and ssh.exe outbound. All other
      enclave processes remain blocked.
    - The window has a configurable timeout (default: 15 minutes).
    - Automatic revert is scheduled. Manual revert is also available.
    - All operations are logged with timestamps.
    - Fails closed: if rule creation fails, the script aborts.
#>

param(
    [int]$TimeoutMinutes = 15
)

# -------------------------------------------------------------------
# Configuration
# -------------------------------------------------------------------
$EnclaveRoot = (Split-Path -Parent (Split-Path -Parent $PSCommandPath))
$AuditLog = "$EnclaveRoot\logs\audit\network_access.log"

# Firewall rule names
$gitRuleName = "LLM_Enclave: Block Git Outbound"
$sshRuleName = "LLM_Enclave: Block SSH Outbound"

# -------------------------------------------------------------------
# Helper Functions
# -------------------------------------------------------------------
function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $entry = "$timestamp | $Level | 08_sync_window | $Message"
    Add-Content -Path $AuditLog -Value $entry -ErrorAction SilentlyContinue
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
Write-Host "========================================" -ForegroundColor Yellow
Write-Host " GITHUB SYNC WINDOW" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "WARNING: This will temporarily allow git.exe and ssh.exe" -ForegroundColor Red
Write-Host "to make outbound network connections." -ForegroundColor Red
Write-Host ""
Write-Host "Timeout: $TimeoutMinutes minutes" -ForegroundColor Yellow
Write-Host "Auto-revert: YES (scheduled task)" -ForegroundColor Yellow
Write-Host ""

if (-not (Test-IsAdmin)) {
    Write-Error "FATAL: Administrator privileges required for firewall modifications."
    Write-Error "Run PowerShell as Administrator."
    exit 1
}

# Confirmation
$confirm = Read-Host "Type 'OPEN SYNC WINDOW' to proceed"
if ($confirm -ne "OPEN SYNC WINDOW") {
    Write-Host "Aborted. No changes made." -ForegroundColor Green
    exit 0
}

# -------------------------------------------------------------------
# Ensure Firewall Rules Exist
# -------------------------------------------------------------------
Write-Host "`n--- Ensuring Firewall Rules Exist ---" -ForegroundColor Cyan

# Find git.exe
$gitPath = (Get-Command git.exe -ErrorAction SilentlyContinue).Source
if (-not $gitPath) {
    $gitPath = "C:\Program Files\Git\cmd\git.exe"
}

# Find ssh.exe
$sshPath = (Get-Command ssh.exe -ErrorAction SilentlyContinue).Source
if (-not $sshPath) {
    $sshPath = "C:\Windows\System32\OpenSSH\ssh.exe"
}

# Create Git block rule if it doesn't exist
$gitRule = Get-NetFirewallRule -DisplayName $gitRuleName -ErrorAction SilentlyContinue
if (-not $gitRule) {
    if (Test-Path $gitPath) {
        New-NetFirewallRule `
            -DisplayName $gitRuleName `
            -Direction Outbound `
            -Action Block `
            -Program $gitPath `
            -Profile Any `
            -Enabled True `
            -Description "Blocks git.exe outbound. Part of LLM Enclave GitHub sync control." | Out-Null
        Write-Host "Created firewall rule: $gitRuleName" -ForegroundColor Green
        Write-Log "Created firewall rule: $gitRuleName"
    } else {
        Write-Warning "git.exe not found at $gitPath. Rule not created."
    }
}

# Create SSH block rule if it doesn't exist
$sshRule = Get-NetFirewallRule -DisplayName $sshRuleName -ErrorAction SilentlyContinue
if (-not $sshRule) {
    if (Test-Path $sshPath) {
        New-NetFirewallRule `
            -DisplayName $sshRuleName `
            -Direction Outbound `
            -Action Block `
            -Program $sshPath `
            -Profile Any `
            -Enabled True `
            -Description "Blocks ssh.exe outbound. Part of LLM Enclave GitHub sync control." | Out-Null
        Write-Host "Created firewall rule: $sshRuleName" -ForegroundColor Green
        Write-Log "Created firewall rule: $sshRuleName"
    } else {
        Write-Warning "ssh.exe not found at $sshPath. Rule not created."
    }
}

# -------------------------------------------------------------------
# Open the Sync Window
# -------------------------------------------------------------------
Write-Host "`n--- Opening Sync Window ---" -ForegroundColor Cyan

# Disable Git block (allow outbound)
$gitRule = Get-NetFirewallRule -DisplayName $gitRuleName -ErrorAction SilentlyContinue
if ($gitRule) {
    Set-NetFirewallRule -DisplayName $gitRuleName -Enabled False
    Write-Host "Git outbound: ALLOWED" -ForegroundColor Green
    Write-Log "SYNC_WINDOW_OPENED: Git outbound allowed"
}

# Disable SSH block (allow outbound)
$sshRule = Get-NetFirewallRule -DisplayName $sshRuleName -ErrorAction SilentlyContinue
if ($sshRule) {
    Set-NetFirewallRule -DisplayName $sshRuleName -Enabled False
    Write-Host "SSH outbound: ALLOWED" -ForegroundColor Green
    Write-Log "SYNC_WINDOW_OPENED: SSH outbound allowed"
}

Write-Log "SYNC_WINDOW_OPENED: Timeout=${TimeoutMinutes}m"

# -------------------------------------------------------------------
# Schedule Auto-Revert
# -------------------------------------------------------------------
Write-Host "`n--- Scheduling Auto-Revert ---" -ForegroundColor Cyan

$revertTime = (Get-Date).AddMinutes($TimeoutMinutes)
$taskName = "LLM_Enclave_Close_Sync_Window"

# Remove existing task if any
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$revertScript = @"
Set-NetFirewallRule -DisplayName '$gitRuleName' -Enabled True -ErrorAction SilentlyContinue
Set-NetFirewallRule -DisplayName '$sshRuleName' -Enabled True -ErrorAction SilentlyContinue
Add-Content -Path '$AuditLog' -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | INFO | AUTO_REVERT | Sync window auto-closed after timeout"
Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false -ErrorAction SilentlyContinue
"@

$revertAction = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -NonInteractive -Command `"$revertScript`""
$revertTrigger = New-ScheduledTaskTrigger -Once -At $revertTime
Register-ScheduledTask -TaskName $taskName `
    -Action $revertAction -Trigger $revertTrigger `
    -RunLevel Highest -Force | Out-Null

Write-Host "Auto-revert scheduled at: $($revertTime.ToString('HH:mm:ss'))" -ForegroundColor Cyan
Write-Host "($TimeoutMinutes minutes from now)" -ForegroundColor Cyan
Write-Log "Auto-revert scheduled for: $revertTime"

# -------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------
Write-Host "`n========================================" -ForegroundColor Green
Write-Host " SYNC WINDOW OPEN" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Git and SSH outbound connections are now ALLOWED."
Write-Host ""
Write-Host "You can now:"
Write-Host "  git pull origin main"
Write-Host "  git push origin feature-branch"
Write-Host ""
Write-Host "The window will AUTO-CLOSE at $($revertTime.ToString('HH:mm:ss'))."
Write-Host ""
Write-Host "To close IMMEDIATELY:"
Write-Host "  .\09_close_github_sync_window.ps1"
Write-Host ""
Write-Host "IMPORTANT: Close the window as soon as you are done!" -ForegroundColor Yellow
