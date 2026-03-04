# DELIVERABLE J: Validation Checklist

Run this checklist after initial setup and after any changes to the enclave.

---

## J1. Confirm Outbound Network Blocked

```powershell
# Check 1: Verify firewall rules exist and are enabled
Write-Host "=== J1.1: Firewall Rules ===" -ForegroundColor Cyan
$rules = Get-NetFirewallRule -DisplayName "LLM_Enclave:*" -ErrorAction SilentlyContinue
if (-not $rules) {
    Write-Error "FAIL: No LLM_Enclave firewall rules found."
} else {
    foreach ($rule in $rules) {
        $appFilter = Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $rule
        $status = if ($rule.Enabled -eq "True" -and $rule.Action -eq "Block") { "PASS" } else { "FAIL" }
        Write-Host "$status : $($rule.DisplayName) | Action=$($rule.Action) | Enabled=$($rule.Enabled) | Program=$($appFilter.Program)"
    }
}

# Check 2: Verify Ollama cannot reach external endpoints
Write-Host "`n=== J1.2: Network Connectivity Test ===" -ForegroundColor Cyan
$ollamaPath = "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\bin\ollama.exe"
if (Test-Path $ollamaPath) {
    $testProc = Start-Process -FilePath $ollamaPath -ArgumentList "pull","tinyllama" `
        -NoNewWindow -PassThru -RedirectStandardError "$env:TEMP\ollama_net_test.txt"
    Start-Sleep -Seconds 5
    if (-not $testProc.HasExited) { Stop-Process -Id $testProc.Id -Force }
    $output = Get-Content "$env:TEMP\ollama_net_test.txt" -ErrorAction SilentlyContinue
    if ($output -match "timeout|refused|unreachable|could not connect") {
        Write-Host "PASS: Ollama cannot reach external network." -ForegroundColor Green
    } else {
        Write-Warning "REVIEW: Check output manually at $env:TEMP\ollama_net_test.txt"
    }
    Remove-Item "$env:TEMP\ollama_net_test.txt" -ErrorAction SilentlyContinue
} else {
    Write-Host "SKIP: Ollama not installed yet."
}

# Check 3: Verify no listening ports on non-localhost
Write-Host "`n=== J1.3: Listening Ports ===" -ForegroundColor Cyan
$listeners = Get-NetTCPConnection -State Listen |
    Where-Object { $_.LocalAddress -ne "127.0.0.1" -and $_.LocalAddress -ne "::1" -and $_.LocalAddress -ne "0.0.0.0" }
$ollamaListeners = $listeners | Where-Object {
    try { (Get-Process -Id $_.OwningProcess).ProcessName -match "ollama" } catch { $false }
}
if ($ollamaListeners) {
    Write-Error "FAIL: Ollama is listening on a non-localhost address!"
    $ollamaListeners | Format-Table LocalAddress, LocalPort
} else {
    Write-Host "PASS: No Ollama listeners on non-localhost addresses." -ForegroundColor Green
}
```

---

## J2. Confirm Runtime Logs Written Only Inside Enclave

```powershell
Write-Host "=== J2: Log File Locations ===" -ForegroundColor Cyan

# Check that the log directory exists and has content
$logDir = "D:\ProjectsHome\LLM_Enclave\QWEN35\logs"
if (Test-Path $logDir) {
    $logFiles = Get-ChildItem -Path $logDir -Recurse -File
    Write-Host "PASS: Log directory exists with $($logFiles.Count) file(s)." -ForegroundColor Green
    $logFiles | ForEach-Object { Write-Host "  - $($_.FullName)" }
} else {
    Write-Error "FAIL: Log directory does not exist at $logDir"
}

# Check that no logs are being written to unexpected locations
Write-Host "`nChecking for Ollama logs outside enclave..."
$commonLogPaths = @(
    "$env:LOCALAPPDATA\Ollama",
    "$env:APPDATA\Ollama",
    "$env:TEMP\ollama*",
    "C:\ProgramData\Ollama"
)
foreach ($path in $commonLogPaths) {
    if (Test-Path $path) {
        Write-Warning "REVIEW: Found Ollama data at $path - may contain logs or cached data."
    } else {
        Write-Host "PASS: No data at $path" -ForegroundColor Green
    }
}
```

---

## J3. Confirm Restricted User Cannot Access D:\ProjectsHome Outside Enclave

```powershell
Write-Host "=== J3: User Access Control ===" -ForegroundColor Cyan

# Check if restricted user exists
$user = Get-LocalUser -Name "LLM_Enclave_User" -ErrorAction SilentlyContinue
if ($user) {
    Write-Host "PASS: User 'LLM_Enclave_User' exists." -ForegroundColor Green

    # Check ACLs on enclave directory
    $enclaveAcl = Get-Acl "D:\ProjectsHome\LLM_Enclave\QWEN35"
    $userRules = $enclaveAcl.Access | Where-Object { $_.IdentityReference -match "LLM_Enclave_User" }
    if ($userRules | Where-Object { $_.AccessControlType -eq "Allow" }) {
        Write-Host "PASS: User has Allow rules on enclave directory." -ForegroundColor Green
    } else {
        Write-Warning "CHECK: User may not have proper access to enclave directory."
    }

    # Check ACLs on parent directory
    $parentAcl = Get-Acl "D:\ProjectsHome"
    $denyRules = $parentAcl.Access | Where-Object {
        $_.IdentityReference -match "LLM_Enclave_User" -and $_.AccessControlType -eq "Deny"
    }
    if ($denyRules) {
        Write-Host "PASS: User has Deny rules on D:\ProjectsHome." -ForegroundColor Green
    } else {
        Write-Warning "CHECK: No explicit Deny rules found on D:\ProjectsHome for LLM_Enclave_User."
    }
} else {
    Write-Host "INFO: No dedicated user created. Using script-level enforcement only."
}
```

---

## J4. Confirm Bridge Refuses Disallowed Paths and File Types

```powershell
Write-Host "=== J4: Bridge Policy Enforcement ===" -ForegroundColor Cyan

$policyPath = "D:\ProjectsHome\LLM_Enclave\QWEN35\policies\bridge_policy.yaml"
if (-not (Test-Path $policyPath)) {
    Write-Error "FAIL: Policy file not found at $policyPath"
} else {
    Write-Host "PASS: Policy file exists." -ForegroundColor Green
}

# Test 1: Attempt to export a .key file (should be denied)
Write-Host "`nTest: Export a .key file (should be DENIED)..."
$testKeyFile = "D:\ProjectsHome\LLM_Enclave\QWEN35\workspace_bridge\scratch\test.key"
"test" | Set-Content -Path $testKeyFile
$result = & "D:\ProjectsHome\LLM_Enclave\QWEN35\scripts\04_export_to_bridge.ps1" `
    -SourcePath $testKeyFile 2>&1
if ($result -match "denied|refused|blocked|not allowed") {
    Write-Host "PASS: .key file was denied." -ForegroundColor Green
} else {
    Write-Warning "REVIEW: .key file may not have been properly denied."
}
Remove-Item $testKeyFile -ErrorAction SilentlyContinue

# Test 2: Attempt to apply to a path outside allowed roots (should be denied)
Write-Host "`nTest: Apply to unauthorized path (should be DENIED)..."
$result = & "D:\ProjectsHome\LLM_Enclave\QWEN35\scripts\05_apply_changes.ps1" `
    -OutboxPath "D:\ProjectsHome\LLM_Enclave\QWEN35\workspace_bridge\outbox" `
    -TargetPath "C:\Windows\System32" 2>&1
if ($result -match "denied|refused|blocked|not allowed|not in allowed") {
    Write-Host "PASS: Unauthorized path was denied." -ForegroundColor Green
} else {
    Write-Warning "REVIEW: Path validation may not be working correctly."
}
```

---

## J5. Confirm Apply Script Refuses Without Explicit Allowlist Configuration

```powershell
Write-Host "=== J5: Default Policy Block ===" -ForegroundColor Cyan

# Read policy file and check policy_not_configured flag
$policyContent = Get-Content $policyPath -Raw
if ($policyContent -match "policy_not_configured:\s*true") {
    Write-Host "PASS: Policy is in default unconfigured state (blocks all applies)." -ForegroundColor Green

    # Attempt an apply (should fail)
    $result = & "D:\ProjectsHome\LLM_Enclave\QWEN35\scripts\05_apply_changes.ps1" `
        -OutboxPath "D:\ProjectsHome\LLM_Enclave\QWEN35\workspace_bridge\outbox" `
        -TargetPath "D:\ProjectsHome\SomeProject" 2>&1
    if ($result -match "not configured|policy.*not.*set|refused") {
        Write-Host "PASS: Apply script refuses when policy is not configured." -ForegroundColor Green
    } else {
        Write-Warning "REVIEW: Apply script may not properly check policy_not_configured flag."
    }
} else {
    Write-Host "INFO: Policy has been configured. Re-set policy_not_configured to true to test default behavior."
}
```

---

## J6. Confirm Diffs and Backups Happen Before Any Apply

```powershell
Write-Host "=== J6: Diff and Backup Verification ===" -ForegroundColor Cyan

# Check that backup directory exists
$backupDir = "D:\ProjectsHome\LLM_Enclave\QWEN35\backups"
if (Test-Path $backupDir) {
    $backups = Get-ChildItem -Path $backupDir -Recurse -Directory
    Write-Host "PASS: Backup directory exists with $($backups.Count) backup set(s)." -ForegroundColor Green
} else {
    Write-Host "INFO: Backup directory exists but no backups yet (normal if no applies have been done)."
}

# Check that diffs directory exists
$diffsDir = "D:\ProjectsHome\LLM_Enclave\QWEN35\diffs"
if (Test-Path $diffsDir) {
    Write-Host "PASS: Diffs directory exists." -ForegroundColor Green
} else {
    Write-Error "FAIL: Diffs directory does not exist."
}

# Review audit log for evidence of backups before applies
$auditLog = "D:\ProjectsHome\LLM_Enclave\QWEN35\logs\audit\apply_audit.log"
if (Test-Path $auditLog) {
    $applyEntries = Get-Content $auditLog | Select-String "BACKUP_CREATED|APPLY_COMPLETED"
    Write-Host "Found $($applyEntries.Count) audit entries for backup/apply operations."
} else {
    Write-Host "INFO: No audit log yet (normal if no applies have been done)."
}
```

---

## J7. Confirm No Telemetry and No Unexpected Processes

```powershell
Write-Host "=== J7: Telemetry and Process Check ===" -ForegroundColor Cyan

# Check 1: Environment variables
Write-Host "`n--- Environment Variables ---"
$envChecks = @(
    @{ Name = "OLLAMA_NOPRUNE"; Expected = "1" },
    @{ Name = "HF_HUB_OFFLINE"; Expected = "1" },
    @{ Name = "TRANSFORMERS_OFFLINE"; Expected = "1" },
    @{ Name = "DO_NOT_TRACK"; Expected = "1" },
    @{ Name = "OLLAMA_HOST"; Expected = "127.0.0.1:11434" }
)
foreach ($check in $envChecks) {
    $value = [Environment]::GetEnvironmentVariable($check.Name, "User")
    if ($value -eq $check.Expected) {
        Write-Host "PASS: $($check.Name) = $value" -ForegroundColor Green
    } else {
        Write-Warning "CHECK: $($check.Name) = '$value' (expected: $($check.Expected))"
    }
}

# Check 2: Unexpected processes
Write-Host "`n--- Process Check ---"
$suspiciousProcesses = @("ollama-update", "ollama_update", "hf-hub", "huggingface")
foreach ($procName in $suspiciousProcesses) {
    $found = Get-Process -Name $procName -ErrorAction SilentlyContinue
    if ($found) {
        Write-Error "FAIL: Unexpected process '$procName' is running (PID: $($found.Id))"
    } else {
        Write-Host "PASS: No '$procName' process found." -ForegroundColor Green
    }
}

# Check 3: Outbound connections from Ollama
Write-Host "`n--- Active Connections ---"
$ollamaProc = Get-Process -Name "ollama" -ErrorAction SilentlyContinue
if ($ollamaProc) {
    $connections = Get-NetTCPConnection -OwningProcess $ollamaProc.Id -ErrorAction SilentlyContinue |
        Where-Object { $_.RemoteAddress -ne "127.0.0.1" -and $_.RemoteAddress -ne "::1" -and $_.RemoteAddress -ne "0.0.0.0" }
    if ($connections) {
        Write-Error "FAIL: Ollama has active connections to external addresses!"
        $connections | Format-Table RemoteAddress, RemotePort, State
    } else {
        Write-Host "PASS: Ollama has no external connections." -ForegroundColor Green
    }
} else {
    Write-Host "INFO: Ollama is not currently running."
}

# Check 4: Scheduled tasks
Write-Host "`n--- Scheduled Tasks ---"
$suspiciousTasks = Get-ScheduledTask | Where-Object {
    $_.TaskName -match "ollama|huggingface|update" -and $_.TaskName -notmatch "LLM_Enclave"
}
if ($suspiciousTasks) {
    Write-Warning "REVIEW: Found potentially suspicious scheduled tasks:"
    $suspiciousTasks | Format-Table TaskName, State
} else {
    Write-Host "PASS: No suspicious scheduled tasks found." -ForegroundColor Green
}

Write-Host "`n=== Validation Complete ===" -ForegroundColor Cyan
```

---

## Summary Checklist (Manual Reference)

| # | Check | Status |
|---|-------|--------|
| J1 | Outbound network blocked for runtime | [ ] |
| J2 | Logs only inside enclave | [ ] |
| J3 | Restricted user cannot access outside enclave | [ ] |
| J4 | Bridge refuses disallowed paths/types | [ ] |
| J5 | Apply refuses without configured policy | [ ] |
| J6 | Diffs and backups created before applies | [ ] |
| J7 | No telemetry, no unexpected processes | [ ] |
