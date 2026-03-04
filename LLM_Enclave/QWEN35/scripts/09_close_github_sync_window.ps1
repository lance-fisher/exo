#Requires -Version 5.1
<#
.SYNOPSIS
    Close the GitHub sync window and re-block Git/SSH outbound.

.DESCRIPTION
    PURPOSE:
    Revoke outbound network access for git.exe and ssh.exe by re-enabling
    the firewall block rules. Verify the block is active. Clean up any
    scheduled auto-revert tasks.

    CHANGES:
    - Re-enables Git/SSH outbound block firewall rules
    - Removes the auto-revert scheduled task
    - Logs the event

    PREREQS:
    - Administrator privileges
    - Firewall rules must exist (created by 08_open_github_sync_window.ps1)

    ROLLBACK:
    - N/A (this script RESTORES the blocked state, which is the safe default)

    SECURITY NOTES:
    - This script fails closed: if re-enabling the block fails, it reports
      the error loudly and does not silently continue.
    - Always run this after completing your Git operations.
    - The script verifies that the block is active after applying.
#>

# -------------------------------------------------------------------
# Configuration
# -------------------------------------------------------------------
$EnclaveRoot = "D:\ProjectsHome\LLM_Enclave\QWEN35"
$AuditLog = "$EnclaveRoot\logs\audit\network_access.log"

$gitRuleName = "LLM_Enclave: Block Git Outbound"
$sshRuleName = "LLM_Enclave: Block SSH Outbound"
$taskName = "LLM_Enclave_Close_Sync_Window"

# -------------------------------------------------------------------
# Helper Functions
# -------------------------------------------------------------------
function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $entry = "$timestamp | $Level | 09_close_sync | $Message"
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
# Execution
# -------------------------------------------------------------------
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " CLOSING GITHUB SYNC WINDOW" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

if (-not (Test-IsAdmin)) {
    Write-Error "FATAL: Administrator privileges required."
    exit 1
}

$allGood = $true

# Re-enable Git block
Write-Host "`nRe-enabling Git outbound block..." -NoNewline
$gitRule = Get-NetFirewallRule -DisplayName $gitRuleName -ErrorAction SilentlyContinue
if ($gitRule) {
    try {
        Set-NetFirewallRule -DisplayName $gitRuleName -Enabled True
        Write-Host " DONE" -ForegroundColor Green
    } catch {
        Write-Host " FAILED" -ForegroundColor Red
        Write-Error "Could not re-enable Git block: $_"
        $allGood = $false
    }
} else {
    Write-Host " SKIPPED (rule not found)" -ForegroundColor Yellow
}

# Re-enable SSH block
Write-Host "Re-enabling SSH outbound block..." -NoNewline
$sshRule = Get-NetFirewallRule -DisplayName $sshRuleName -ErrorAction SilentlyContinue
if ($sshRule) {
    try {
        Set-NetFirewallRule -DisplayName $sshRuleName -Enabled True
        Write-Host " DONE" -ForegroundColor Green
    } catch {
        Write-Host " FAILED" -ForegroundColor Red
        Write-Error "Could not re-enable SSH block: $_"
        $allGood = $false
    }
} else {
    Write-Host " SKIPPED (rule not found)" -ForegroundColor Yellow
}

# Clean up scheduled task
Write-Host "Removing auto-revert task..." -NoNewline
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
Write-Host " DONE" -ForegroundColor Green

# -------------------------------------------------------------------
# Verify
# -------------------------------------------------------------------
Write-Host "`n--- Verification ---" -ForegroundColor Cyan

$gitRule = Get-NetFirewallRule -DisplayName $gitRuleName -ErrorAction SilentlyContinue
if ($gitRule -and $gitRule.Enabled -eq "True" -and $gitRule.Action -eq "Block") {
    Write-Host "Git outbound: BLOCKED" -ForegroundColor Green
} else {
    Write-Error "VERIFICATION FAILED: Git outbound may not be blocked!"
    $allGood = $false
}

$sshRule = Get-NetFirewallRule -DisplayName $sshRuleName -ErrorAction SilentlyContinue
if ($sshRule -and $sshRule.Enabled -eq "True" -and $sshRule.Action -eq "Block") {
    Write-Host "SSH outbound: BLOCKED" -ForegroundColor Green
} else {
    Write-Error "VERIFICATION FAILED: SSH outbound may not be blocked!"
    $allGood = $false
}

# -------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------
if ($allGood) {
    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host " SYNC WINDOW CLOSED" -ForegroundColor Green
    Write-Host " Git and SSH outbound are BLOCKED." -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Log "SYNC_WINDOW_CLOSED: All blocks verified" "SUCCESS"
} else {
    Write-Host "`n========================================" -ForegroundColor Red
    Write-Host " WARNING: VERIFICATION ISSUES DETECTED" -ForegroundColor Red
    Write-Host " Check the errors above and verify" -ForegroundColor Red
    Write-Host " firewall rules manually." -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Log "SYNC_WINDOW_CLOSE: Verification issues detected" "ERROR"
    exit 1
}
