# DELIVERABLE M: OpenClaw Containment and Firewall Rules

## Extending Firewall Blocking to OpenClaw

### Firewall Rules for OpenClaw Executables

```powershell
# =============================================================================
# REQUIRES ADMINISTRATOR PRIVILEGES
# =============================================================================

# Block OpenClaw binary (if it ships as a standalone executable)
$openclawExe = "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\install\openclaw.exe"
if (Test-Path $openclawExe) {
    New-NetFirewallRule `
        -DisplayName "LLM_Enclave: Block OpenClaw Outbound" `
        -Direction Outbound `
        -Action Block `
        -Program $openclawExe `
        -Profile Any `
        -Enabled True `
        -Description "Blocks all outbound network access for OpenClaw. Part of LLM Enclave security."
    Write-Host "Firewall rule created for OpenClaw binary." -ForegroundColor Green
}

# Block OpenClaw Python (if it runs via Python venv)
$openclawPython = "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\install\venv\Scripts\python.exe"
if (Test-Path $openclawPython) {
    New-NetFirewallRule `
        -DisplayName "LLM_Enclave: Block OpenClaw Python Outbound" `
        -Direction Outbound `
        -Action Block `
        -Program $openclawPython `
        -Profile Any `
        -Enabled True `
        -Description "Blocks outbound for OpenClaw Python process."
    Write-Host "Firewall rule created for OpenClaw Python." -ForegroundColor Green
}

# Block OpenClaw Node.js (if it uses Node)
$openclawNode = "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\install\node\node.exe"
if (Test-Path $openclawNode) {
    New-NetFirewallRule `
        -DisplayName "LLM_Enclave: Block OpenClaw Node Outbound" `
        -Direction Outbound `
        -Action Block `
        -Program $openclawNode `
        -Profile Any `
        -Enabled True `
        -Description "Blocks outbound for OpenClaw Node.js process."
    Write-Host "Firewall rule created for OpenClaw Node.js." -ForegroundColor Green
}
```

### Docker Containment (If Docker Is Used)

```powershell
# If OpenClaw runs in Docker, the --network none flag is the primary control.
# Additionally, block Docker's network creation for this container:

# Verify Docker container has no network
docker inspect openclaw-enclave --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'
# Should return empty if --network none was used

# Block Docker Desktop outbound for the container's process
# (Docker processes run as child processes of com.docker.backend.exe)
# Note: This is defense-in-depth; --network none is the primary control.
```

## Verification Steps

### Verify OpenClaw Cannot Egress

```powershell
# =============================================================================
# OPENCLAW EGRESS VERIFICATION
# =============================================================================

Write-Host "=== OpenClaw Egress Verification ===" -ForegroundColor Cyan

# Step 1: Verify firewall rules exist and are active
Write-Host "`n--- Firewall Rules ---"
$ocRules = Get-NetFirewallRule -DisplayName "LLM_Enclave: Block OpenClaw*" -ErrorAction SilentlyContinue
if (-not $ocRules) {
    Write-Error "FAIL: No OpenClaw firewall rules found."
} else {
    foreach ($rule in $ocRules) {
        $appFilter = Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $rule
        $status = if ($rule.Enabled -eq "True" -and $rule.Action -eq "Block") { "PASS" } else { "FAIL" }
        Write-Host "$status : $($rule.DisplayName) | Program: $($appFilter.Program)"
    }
}

# Step 2: Test outbound from OpenClaw process
Write-Host "`n--- Connectivity Test ---"
# Run a simple network test from within OpenClaw's Python environment (if applicable)
$openclawPython = "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\install\venv\Scripts\python.exe"
if (Test-Path $openclawPython) {
    $testScript = @"
import socket
try:
    s = socket.create_connection(('8.8.8.8', 53), timeout=5)
    s.close()
    print('FAIL: Connection succeeded - firewall not blocking!')
except (socket.timeout, socket.error, OSError):
    print('PASS: Connection blocked by firewall.')
"@
    $testResult = $testScript | & $openclawPython -c "import sys; exec(sys.stdin.read())" 2>&1
    Write-Host $testResult
} else {
    Write-Host "INFO: OpenClaw Python not found. Test with appropriate executable."
}

# Step 3: Check for active connections
Write-Host "`n--- Active Connections ---"
$openclawProcesses = Get-Process | Where-Object {
    $_.Path -like "*LLM_Enclave*QWEN35*openclaw*"
}
foreach ($proc in $openclawProcesses) {
    $connections = Get-NetTCPConnection -OwningProcess $proc.Id -ErrorAction SilentlyContinue |
        Where-Object {
            $_.RemoteAddress -ne "127.0.0.1" -and
            $_.RemoteAddress -ne "::1" -and
            $_.RemoteAddress -ne "0.0.0.0"
        }
    if ($connections) {
        Write-Error "FAIL: OpenClaw process $($proc.Id) has external connections!"
        $connections | Format-Table RemoteAddress, RemotePort, State
    } else {
        Write-Host "PASS: OpenClaw process $($proc.Id) has no external connections." -ForegroundColor Green
    }
}
if (-not $openclawProcesses) {
    Write-Host "INFO: No OpenClaw processes currently running."
}

# Step 4: Docker container verification (if applicable)
if (Get-Command docker -ErrorAction SilentlyContinue) {
    $container = docker ps --filter "name=openclaw-enclave" --format "{{.ID}}" 2>$null
    if ($container) {
        $networkMode = docker inspect $container --format '{{.HostConfig.NetworkMode}}' 2>$null
        if ($networkMode -eq "none") {
            Write-Host "PASS: Docker container has network mode 'none'." -ForegroundColor Green
        } else {
            Write-Error "FAIL: Docker container network mode is '$networkMode' (expected 'none')."
        }
    }
}

Write-Host "`n=== Verification Complete ===" -ForegroundColor Cyan
```

## NTFS ACL Enforcement for OpenClaw

```powershell
# If using LLM_Enclave_User, ensure OpenClaw install directory
# inherits the same permissions as the enclave root.

$openclawDir = "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw"
$acl = Get-Acl $openclawDir

# Verify inheritance is working
Write-Host "OpenClaw directory ACL:"
$acl.Access | Format-Table IdentityReference, FileSystemRights, AccessControlType

# Ensure the restricted user has Modify (not FullControl)
$userRules = $acl.Access | Where-Object {
    $_.IdentityReference -match "LLM_Enclave_User" -and
    $_.FileSystemRights -match "FullControl"
}
if ($userRules) {
    Write-Warning "OpenClaw directory grants FullControl to LLM_Enclave_User. Should be Modify only."
}
```
