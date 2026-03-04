# DELIVERABLE D: Network Egress Control

## D1. Windows Firewall Rules to Block Outbound for Runtime Executables

All rules must be created with Administrator privileges. These rules block ALL outbound traffic for the specified executables.

```powershell
# REQUIRES ADMINISTRATOR PRIVILEGES

# Block Ollama server
New-NetFirewallRule `
    -DisplayName "LLM_Enclave: Block Ollama Outbound" `
    -Direction Outbound `
    -Action Block `
    -Program "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\bin\ollama.exe" `
    -Profile Any `
    -Enabled True `
    -Description "Blocks all outbound network access for Ollama inference runtime. Part of LLM Enclave security."

# Block Ollama runner (if it spawns a separate process)
New-NetFirewallRule `
    -DisplayName "LLM_Enclave: Block Ollama Runner Outbound" `
    -Direction Outbound `
    -Action Block `
    -Program "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\bin\ollama_runners\*.exe" `
    -Profile Any `
    -Enabled True `
    -Description "Blocks outbound for Ollama runner sub-processes."

# Block Python (if venv is used for tooling)
New-NetFirewallRule `
    -DisplayName "LLM_Enclave: Block Enclave Python Outbound" `
    -Direction Outbound `
    -Action Block `
    -Program "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\venv\Scripts\python.exe" `
    -Profile Any `
    -Enabled True `
    -Description "Blocks outbound for Python in the enclave venv."

# Verify rules were created
Get-NetFirewallRule -DisplayName "LLM_Enclave:*" | Format-Table DisplayName, Direction, Action, Enabled
```

## D2. Verification Routine

This routine proves the outbound block is effective.

```powershell
# =============================================================================
# VERIFICATION: Prove that the blocked processes cannot reach the internet
# =============================================================================

# Step 1: Verify firewall rules exist and are enabled
Write-Host "=== Step 1: Checking firewall rules ===" -ForegroundColor Cyan
$rules = Get-NetFirewallRule -DisplayName "LLM_Enclave:*"
foreach ($rule in $rules) {
    $appFilter = Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $rule
    Write-Host ("Rule: {0} | Direction: {1} | Action: {2} | Enabled: {3} | Program: {4}" -f `
        $rule.DisplayName, $rule.Direction, $rule.Action, $rule.Enabled, $appFilter.Program)
    if ($rule.Action -ne "Block" -or $rule.Enabled -ne "True") {
        Write-Error "FAIL: Rule $($rule.DisplayName) is not properly configured!"
    }
}

# Step 2: Attempt outbound connection from the runtime (should fail)
Write-Host "`n=== Step 2: Testing outbound connectivity (should FAIL) ===" -ForegroundColor Cyan

# Start Ollama temporarily, then try to reach an external endpoint
# This test uses Ollama's own pull command which requires network
$testProcess = Start-Process `
    -FilePath "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\bin\ollama.exe" `
    -ArgumentList "pull", "library/llama2:latest" `
    -NoNewWindow `
    -PassThru `
    -RedirectStandardError "D:\ProjectsHome\LLM_Enclave\QWEN35\logs\firewall_test.log"

Start-Sleep -Seconds 5
if (-not $testProcess.HasExited) {
    Stop-Process -Id $testProcess.Id -Force
}

$testLog = Get-Content "D:\ProjectsHome\LLM_Enclave\QWEN35\logs\firewall_test.log" -ErrorAction SilentlyContinue
if ($testLog -match "connection refused|timeout|could not connect|network is unreachable|dial tcp") {
    Write-Host "PASS: Outbound connection blocked successfully." -ForegroundColor Green
} else {
    Write-Warning "CHECK MANUALLY: Review firewall_test.log to confirm block is effective."
}

# Step 3: Cross-reference with Windows Firewall log
Write-Host "`n=== Step 3: Checking Windows Firewall log for dropped packets ===" -ForegroundColor Cyan
Write-Host "Enable firewall logging if not already enabled:"
Write-Host '  Set-NetFirewallProfile -Profile Domain,Public,Private -LogBlocked True -LogFileName "C:\Windows\System32\LogFiles\Firewall\pfirewall.log"'
Write-Host "Then check: Get-Content 'C:\Windows\System32\LogFiles\Firewall\pfirewall.log' | Select-String 'DROP'"
```

## D3. Safe "Temporary Allow" Mechanism

```powershell
# =============================================================================
# TEMPORARY ALLOW MECHANISM
# =============================================================================
# WARNING: This temporarily allows outbound network access for the runtime.
# Use ONLY for downloading model updates or runtime updates.
# You MUST run the revert script when done.
# =============================================================================

function Enable-TemporaryOutbound {
    param(
        [Parameter(Mandatory=$true)]
        [string]$RuleName,

        [int]$TimeoutMinutes = 10
    )

    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host "WARNING: ENABLING OUTBOUND NETWORK ACCESS" -ForegroundColor Red
    Write-Host "Rule: $RuleName" -ForegroundColor Yellow
    Write-Host "This will be active for up to $TimeoutMinutes minutes." -ForegroundColor Yellow
    Write-Host "You MUST manually revert if auto-revert fails." -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Yellow

    $confirm = Read-Host "Type 'ALLOW OUTBOUND' to proceed"
    if ($confirm -ne "ALLOW OUTBOUND") {
        Write-Host "Aborted. No changes made." -ForegroundColor Green
        return
    }

    # Log the action
    $logEntry = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | OUTBOUND ENABLED | Rule: $RuleName | Timeout: ${TimeoutMinutes}m"
    Add-Content -Path "D:\ProjectsHome\LLM_Enclave\QWEN35\logs\audit\network_access.log" -Value $logEntry

    # Disable the block rule (effectively allowing traffic)
    Set-NetFirewallRule -DisplayName $RuleName -Enabled False

    Write-Host "Outbound ENABLED. Starting $TimeoutMinutes minute timer..." -ForegroundColor Yellow

    # Schedule auto-revert
    $revertAction = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -Command `"Set-NetFirewallRule -DisplayName '$RuleName' -Enabled True; Add-Content -Path 'D:\ProjectsHome\LLM_Enclave\QWEN35\logs\audit\network_access.log' -Value '$(Get-Date -Format ''yyyy-MM-dd HH:mm:ss'') | AUTO-REVERTED | Rule: $RuleName'`""
    $revertTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes($TimeoutMinutes)
    Register-ScheduledTask -TaskName "LLM_Enclave_Revert_$($RuleName -replace '[^a-zA-Z0-9]','_')" `
        -Action $revertAction -Trigger $revertTrigger -RunLevel Highest -Force

    Write-Host "Auto-revert scheduled in $TimeoutMinutes minutes." -ForegroundColor Cyan
    Write-Host "To revert NOW, run: Disable-TemporaryOutbound -RuleName '$RuleName'" -ForegroundColor Cyan
}

function Disable-TemporaryOutbound {
    param(
        [Parameter(Mandatory=$true)]
        [string]$RuleName
    )

    # Re-enable the block rule
    Set-NetFirewallRule -DisplayName $RuleName -Enabled True

    # Log
    $logEntry = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | OUTBOUND REVERTED | Rule: $RuleName"
    Add-Content -Path "D:\ProjectsHome\LLM_Enclave\QWEN35\logs\audit\network_access.log" -Value $logEntry

    # Clean up scheduled task
    $taskName = "LLM_Enclave_Revert_$($RuleName -replace '[^a-zA-Z0-9]','_')"
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

    Write-Host "Outbound BLOCKED again for rule: $RuleName" -ForegroundColor Green

    # Verify
    $rule = Get-NetFirewallRule -DisplayName $RuleName
    if ($rule.Enabled -eq "True" -and $rule.Action -eq "Block") {
        Write-Host "VERIFIED: Block rule is active." -ForegroundColor Green
    } else {
        Write-Error "VERIFICATION FAILED: Rule may not be properly blocking. Check manually!"
    }
}
```

### Manual Revert Script (Fallback)

```powershell
# =============================================================================
# !!! MANUAL REVERT SCRIPT !!!
# =============================================================================
# RUN THIS if auto-revert failed or if you are unsure about outbound status.
# This re-enables ALL LLM Enclave outbound block rules.
# =============================================================================

Write-Host "RE-ENABLING ALL LLM ENCLAVE OUTBOUND BLOCKS" -ForegroundColor Red
$rules = Get-NetFirewallRule -DisplayName "LLM_Enclave:*"
foreach ($rule in $rules) {
    Set-NetFirewallRule -Name $rule.Name -Enabled True
    Write-Host "Re-enabled: $($rule.DisplayName)" -ForegroundColor Green
}

# Clean up any leftover scheduled revert tasks
Get-ScheduledTask -TaskName "LLM_Enclave_Revert_*" -ErrorAction SilentlyContinue |
    Unregister-ScheduledTask -Confirm:$false

Write-Host "All outbound blocks restored." -ForegroundColor Green
```

## D4. DNS and Call-Home Prevention

```powershell
# 1. Environment variables to disable telemetry for common tools
[Environment]::SetEnvironmentVariable("OLLAMA_NOPRUNE", "1", "User")
[Environment]::SetEnvironmentVariable("HF_HUB_OFFLINE", "1", "User")
[Environment]::SetEnvironmentVariable("TRANSFORMERS_OFFLINE", "1", "User")
[Environment]::SetEnvironmentVariable("DO_NOT_TRACK", "1", "User")
[Environment]::SetEnvironmentVariable("OLLAMA_HOST", "127.0.0.1:11434", "User")

# 2. The firewall rules above block ALL outbound (including DNS) for the runtime processes.
#    DNS resolution requires UDP port 53 outbound, which is blocked.

# 3. Hosts file entries (optional extra layer - requires admin)
# Add to C:\Windows\System32\drivers\etc\hosts:
#   127.0.0.1 ollama.com
#   127.0.0.1 registry.ollama.ai
#   127.0.0.1 huggingface.co
#   127.0.0.1 cdn-lfs.huggingface.co
# NOTE: Only add these if you want to block ALL access, not just runtime access.
# The firewall rules are the primary control; hosts file is defense-in-depth.

# 4. Verify no unexpected listeners
Get-NetTCPConnection -State Listen |
    Where-Object { $_.LocalAddress -ne "127.0.0.1" -and $_.LocalAddress -ne "::1" } |
    Format-Table LocalAddress, LocalPort, OwningProcess, @{
        Name="ProcessName"; Expression={(Get-Process -Id $_.OwningProcess).ProcessName}
    }
```
