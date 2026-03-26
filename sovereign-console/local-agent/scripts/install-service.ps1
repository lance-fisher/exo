#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Install the Sovereign Console Local Agent as a Windows service.

.DESCRIPTION
    This script:
    1. Checks for administrator privileges
    2. Creates a dedicated low-privilege service account (SovereignAgent)
    3. Grants the account read/write to D:\ProjectsHome
    4. Grants the account "Log on as a service" right
    5. Downloads WinSW if not present
    6. Installs and starts the service
    7. Configures crash recovery options

.NOTES
    Run from the local-agent directory:
      powershell -ExecutionPolicy Bypass -File scripts\install-service.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Configuration ────────────────────────────────────────────────────────────

$ServiceName        = "SovereignConsoleAgent"
$ServiceDisplayName = "Sovereign Console Local Agent"
$ServiceAccount     = "SovereignAgent"
$ProjectsRoot       = "D:\ProjectsHome"
$AgentDir           = Split-Path -Parent $PSScriptRoot  # parent of scripts/
$WinSwUrl           = "https://github.com/winsw/winsw/releases/download/v3.0.0-alpha.11/WinSW-x64.exe"
$WinSwExe           = Join-Path $AgentDir "SovereignConsoleAgent.exe"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " Sovereign Console Local Agent — Installer"    -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Verify Administrator ─────────────────────────────────────────────────

$currentPrincipal = New-Object Security.Principal.WindowsPrincipal(
    [Security.Principal.WindowsIdentity]::GetCurrent()
)
if (-not $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script must be run as Administrator. Right-click PowerShell and select 'Run as Administrator'."
    exit 1
}
Write-Host "[OK] Running as Administrator" -ForegroundColor Green

# ── 2. Create Service Account ───────────────────────────────────────────────

Write-Host ""
Write-Host "Creating service account '$ServiceAccount'..." -ForegroundColor Yellow

$accountExists = $false
try {
    $null = Get-LocalUser -Name $ServiceAccount -ErrorAction Stop
    $accountExists = $true
    Write-Host "[OK] Service account '$ServiceAccount' already exists" -ForegroundColor Green
} catch {
    # Account does not exist — create it
}

if (-not $accountExists) {
    # Generate a random password for the service account
    Add-Type -AssemblyName System.Web
    $password = [System.Web.Security.Membership]::GeneratePassword(24, 4)
    $securePassword = ConvertTo-SecureString $password -AsPlainText -Force

    New-LocalUser -Name $ServiceAccount `
        -Password $securePassword `
        -Description "Sovereign Console Local Agent service account" `
        -PasswordNeverExpires `
        -UserMayNotChangePassword `
        -AccountNeverExpires

    Write-Host "[OK] Service account '$ServiceAccount' created" -ForegroundColor Green

    # Store the password securely for WinSW configuration
    $credPath = Join-Path $AgentDir ".service-cred"
    $securePassword | ConvertFrom-SecureString | Out-File -FilePath $credPath -Force
    $acl = Get-Acl $credPath
    $acl.SetAccessRuleProtection($true, $false)
    $adminRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        "BUILTIN\Administrators", "FullControl", "Allow"
    )
    $acl.AddAccessRule($adminRule)
    Set-Acl -Path $credPath -AclObject $acl
    Write-Host "[OK] Service account credentials stored securely" -ForegroundColor Green
}

# ── 3. Grant Permissions on ProjectsRoot ────────────────────────────────────

Write-Host ""
Write-Host "Granting '$ServiceAccount' read/write access to '$ProjectsRoot'..." -ForegroundColor Yellow

if (-not (Test-Path $ProjectsRoot)) {
    New-Item -ItemType Directory -Path $ProjectsRoot -Force | Out-Null
    Write-Host "[OK] Created directory '$ProjectsRoot'" -ForegroundColor Green
}

$acl = Get-Acl $ProjectsRoot
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    "$env:COMPUTERNAME\$ServiceAccount",
    "Modify",
    "ContainerInherit,ObjectInherit",
    "None",
    "Allow"
)
$acl.AddAccessRule($rule)
Set-Acl -Path $ProjectsRoot -AclObject $acl
Write-Host "[OK] Permissions granted" -ForegroundColor Green

# ── 4. Grant 'Log on as a service' Right ────────────────────────────────────

Write-Host ""
Write-Host "Granting 'Log on as a service' right to '$ServiceAccount'..." -ForegroundColor Yellow

# Use secedit to grant the right
$tempDir = Join-Path $env:TEMP "sovereign-secedit"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
$exportPath = Join-Path $tempDir "export.cfg"
$importPath = Join-Path $tempDir "import.cfg"

secedit /export /cfg $exportPath /quiet

$config = Get-Content $exportPath -Raw
$sid = (Get-LocalUser -Name $ServiceAccount).SID.Value

if ($config -match "SeServiceLogonRight\s*=\s*(.+)") {
    $currentValue = $Matches[1]
    if ($currentValue -notmatch $sid) {
        $newValue = "$currentValue,*$sid"
        $config = $config -replace "SeServiceLogonRight\s*=\s*.+", "SeServiceLogonRight = $newValue"
    }
} else {
    $config = $config -replace "\[Privilege Rights\]", "[Privilege Rights]`nSeServiceLogonRight = *$sid"
}

Set-Content -Path $importPath -Value $config
secedit /configure /db (Join-Path $tempDir "secedit.sdb") /cfg $importPath /quiet
Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
Write-Host "[OK] 'Log on as a service' right granted" -ForegroundColor Green

# ── 5. Download WinSW ───────────────────────────────────────────────────────

Write-Host ""
Write-Host "Checking for WinSW..." -ForegroundColor Yellow

if (-not (Test-Path $WinSwExe)) {
    Write-Host "Downloading WinSW from $WinSwUrl..." -ForegroundColor Yellow
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $WinSwUrl -OutFile $WinSwExe -UseBasicParsing
    Write-Host "[OK] WinSW downloaded to $WinSwExe" -ForegroundColor Green
} else {
    Write-Host "[OK] WinSW already present at $WinSwExe" -ForegroundColor Green
}

# ── 6. Build the Project ────────────────────────────────────────────────────

Write-Host ""
Write-Host "Building TypeScript project..." -ForegroundColor Yellow

Push-Location $AgentDir
try {
    if (-not (Test-Path (Join-Path $AgentDir "node_modules"))) {
        Write-Host "Installing dependencies..." -ForegroundColor Yellow
        npm install --production=false 2>&1 | Out-Null
    }
    npm run build 2>&1 | Out-Null
    Write-Host "[OK] Build complete" -ForegroundColor Green
} finally {
    Pop-Location
}

# ── 7. Create Log Directory ─────────────────────────────────────────────────

$logDir = Join-Path $AgentDir "logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

# Grant log directory access to service account
$logAcl = Get-Acl $logDir
$logRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    "$env:COMPUTERNAME\$ServiceAccount",
    "Modify",
    "ContainerInherit,ObjectInherit",
    "None",
    "Allow"
)
$logAcl.AddAccessRule($logRule)
Set-Acl -Path $logDir -AclObject $logAcl

# ── 8. Install Service ──────────────────────────────────────────────────────

Write-Host ""
Write-Host "Installing service '$ServiceName'..." -ForegroundColor Yellow

# Stop and uninstall if already present
$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "Stopping existing service..." -ForegroundColor Yellow
    & $WinSwExe stop 2>&1 | Out-Null
    Start-Sleep -Seconds 2
    & $WinSwExe uninstall 2>&1 | Out-Null
    Start-Sleep -Seconds 2
    Write-Host "[OK] Existing service removed" -ForegroundColor Green
}

# Copy winsw.xml alongside the exe (WinSW looks for <exe-name>.xml)
$xmlSource = Join-Path $AgentDir "winsw.xml"
$xmlDest   = Join-Path $AgentDir "SovereignConsoleAgent.xml"
Copy-Item -Path $xmlSource -Destination $xmlDest -Force

# Install
Push-Location $AgentDir
try {
    & $WinSwExe install
    Write-Host "[OK] Service installed" -ForegroundColor Green
} finally {
    Pop-Location
}

# ── 9. Configure Recovery Options ───────────────────────────────────────────

Write-Host ""
Write-Host "Configuring recovery options..." -ForegroundColor Yellow

# sc.exe failure: restart after 10s on first, second, third failure; reset after 1 hour
sc.exe failure $ServiceName reset= 3600 actions= restart/10000/restart/10000/restart/10000 | Out-Null
Write-Host "[OK] Recovery options configured (restart after 10s, max 3 per hour)" -ForegroundColor Green

# ── 10. Start Service ───────────────────────────────────────────────────────

Write-Host ""
Write-Host "Starting service..." -ForegroundColor Yellow

& $WinSwExe start
Start-Sleep -Seconds 3

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc -and $svc.Status -eq "Running") {
    Write-Host "[OK] Service '$ServiceName' is running" -ForegroundColor Green
} else {
    Write-Host "[WARN] Service may not have started. Check logs at: $logDir" -ForegroundColor Yellow
    Write-Host "       Run: Get-Service $ServiceName | Format-List *" -ForegroundColor Yellow
}

# ── Done ─────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " Installation complete!"                       -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Edit .env with your broker URL, agent credentials, and mTLS cert paths" -ForegroundColor Gray
Write-Host "  2. Run 'npm run generate-certs' to create mTLS certificates" -ForegroundColor Gray
Write-Host "  3. Upload the CA cert to your broker" -ForegroundColor Gray
Write-Host "  4. Restart the service: $WinSwExe restart" -ForegroundColor Gray
Write-Host ""
