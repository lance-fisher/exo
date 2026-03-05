#Requires -Version 5.1
<#
.SYNOPSIS
    LLM Enclave Provisioning Script

.DESCRIPTION
    PURPOSE:
    Create the complete directory structure for the LLM Enclave, set NTFS
    permissions, create Windows Firewall rules, create baseline configuration,
    initialize log files, and optionally create a restricted local user account.

    CHANGES:
    - Creates directory tree under D:\ProjectsHome\LLM_Enclave\QWEN35\
    - Sets NTFS ACLs on the enclave directory (if creating restricted user)
    - Creates Windows Firewall outbound block rules (REQUIRES ADMIN)
    - Sets environment variables for telemetry suppression (user-level)
    - Creates initial policy and configuration files
    - Creates initial log files

    PREREQS:
    - Windows 11
    - PowerShell 5.1 or later
    - Administrator privileges (for firewall rules and optional user creation)
    - D:\ProjectsHome must exist

    ROLLBACK:
    To undo all changes made by this script:
    1. Remove directories:
       Remove-Item -Path "D:\ProjectsHome\LLM_Enclave" -Recurse -Force
    2. Remove firewall rules:
       Get-NetFirewallRule -DisplayName "LLM_Enclave:*" | Remove-NetFirewallRule
    3. Remove local user (if created):
       Remove-LocalUser -Name "LLM_Enclave_User"
    4. Remove environment variables:
       [Environment]::SetEnvironmentVariable("OLLAMA_NOPRUNE", $null, "User")
       [Environment]::SetEnvironmentVariable("HF_HUB_OFFLINE", $null, "User")
       [Environment]::SetEnvironmentVariable("TRANSFORMERS_OFFLINE", $null, "User")
       [Environment]::SetEnvironmentVariable("DO_NOT_TRACK", $null, "User")
       [Environment]::SetEnvironmentVariable("OLLAMA_HOST", $null, "User")

    SECURITY NOTES:
    - This script is additive only. It does not delete or overwrite existing files.
    - Firewall rules require Administrator privileges. The script will warn if not elevated.
    - The restricted user creation is optional and prompted interactively.
    - All actions are logged to the enclave log directory.
#>

param(
    [switch]$CreateRestrictedUser,
    [switch]$SkipFirewall,
    [switch]$DryRun
)

# -------------------------------------------------------------------
# Configuration
# -------------------------------------------------------------------
$EnclaveRoot = (Split-Path -Parent (Split-Path -Parent $PSCommandPath))
$ProjectsRoot = "D:\ProjectsHome"
$LogFile = "$EnclaveRoot\logs\provision.log"

# -------------------------------------------------------------------
# Helper Functions
# -------------------------------------------------------------------
function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $entry = "$timestamp | $Level | $Message"
    if (Test-Path (Split-Path $LogFile -Parent)) {
        Add-Content -Path $LogFile -Value $entry
    }
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
Write-Host " LLM ENCLAVE PROVISIONING" -ForegroundColor Cyan
Write-Host " What this will change:" -ForegroundColor Cyan
Write-Host "   - Create directory tree under $EnclaveRoot" -ForegroundColor Cyan
Write-Host "   - Set environment variables (user-level)" -ForegroundColor Cyan
if (-not $SkipFirewall) {
    Write-Host "   - Create Windows Firewall rules (REQUIRES ADMIN)" -ForegroundColor Cyan
}
if ($CreateRestrictedUser) {
    Write-Host "   - Create local user 'LLM_Enclave_User' (REQUIRES ADMIN)" -ForegroundColor Cyan
}
Write-Host "========================================" -ForegroundColor Cyan

if (-not (Test-Path $ProjectsRoot)) {
    Write-Error "FATAL: $ProjectsRoot does not exist. Cannot proceed."
    exit 1
}

$isAdmin = Test-IsAdmin
if (-not $isAdmin) {
    Write-Host "WARNING: Not running as Administrator." -ForegroundColor Yellow
    Write-Host "  Firewall rules and user creation require elevation." -ForegroundColor Yellow
    Write-Host "  Directory creation and environment variables will still work." -ForegroundColor Yellow
    if (-not $SkipFirewall) {
        $SkipFirewall = $true
        Write-Host "  Firewall steps will be SKIPPED." -ForegroundColor Yellow
    }
    if ($CreateRestrictedUser) {
        Write-Host "  User creation will be SKIPPED." -ForegroundColor Yellow
        $CreateRestrictedUser = $false
    }
}

$confirm = Read-Host "Proceed with provisioning? (yes/no)"
if ($confirm -ne "yes") {
    Write-Host "Aborted. No changes made."
    exit 0
}

# -------------------------------------------------------------------
# Step 1: Create Directory Structure
# -------------------------------------------------------------------
Write-Host "`n--- Step 1: Creating Directory Structure ---" -ForegroundColor Cyan

$directories = @(
    "$EnclaveRoot",
    "$EnclaveRoot\runtime",
    "$EnclaveRoot\runtime\bin",
    "$EnclaveRoot\runtime\config",
    "$EnclaveRoot\runtime\venv",
    "$EnclaveRoot\models",
    "$EnclaveRoot\models\staging",
    "$EnclaveRoot\models\verified",
    "$EnclaveRoot\hashes",
    "$EnclaveRoot\logs",
    "$EnclaveRoot\logs\runtime",
    "$EnclaveRoot\logs\bridge",
    "$EnclaveRoot\logs\audit",
    "$EnclaveRoot\logs\openclaw",
    "$EnclaveRoot\workspace_bridge",
    "$EnclaveRoot\workspace_bridge\inbox",
    "$EnclaveRoot\workspace_bridge\outbox",
    "$EnclaveRoot\workspace_bridge\scratch",
    "$EnclaveRoot\policies",
    "$EnclaveRoot\scripts",
    "$EnclaveRoot\staging",
    "$EnclaveRoot\diffs",
    "$EnclaveRoot\docs",
    "$EnclaveRoot\backups",
    "$EnclaveRoot\backups\runtime",
    "$EnclaveRoot\openclaw",
    "$EnclaveRoot\openclaw\release",
    "$EnclaveRoot\openclaw\install",
    "$EnclaveRoot\openclaw\config"
)

foreach ($dir in $directories) {
    if (-not (Test-Path $dir)) {
        if ($DryRun) {
            Write-Host "[DRY RUN] Would create: $dir"
        } else {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            Write-Host "Created: $dir" -ForegroundColor Green
        }
    } else {
        Write-Host "Exists:  $dir" -ForegroundColor DarkGray
    }
}

# Initialize log file now that directory exists
if (-not $DryRun) {
    if (-not (Test-Path $LogFile)) {
        New-Item -ItemType File -Path $LogFile -Force | Out-Null
    }
    Write-Log "Provisioning started"
}

# -------------------------------------------------------------------
# Step 2: Create Initial Files
# -------------------------------------------------------------------
Write-Host "`n--- Step 2: Creating Initial Files ---" -ForegroundColor Cyan

# Hash files
$hashFiles = @(
    "$EnclaveRoot\hashes\model_hashes.txt",
    "$EnclaveRoot\hashes\runtime_hashes.txt",
    "$EnclaveRoot\hashes\openclaw_hashes.txt",
    "$EnclaveRoot\hashes\verified_plugins.txt"
)

foreach ($hf in $hashFiles) {
    if (-not (Test-Path $hf)) {
        if (-not $DryRun) {
            "# SHA256 Hash Records - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Set-Content -Path $hf
            "# Format: HASH  FILENAME  DATE  NOTES" | Add-Content -Path $hf
            Write-Log "Created hash file: $hf"
        }
        Write-Host "Created: $hf" -ForegroundColor Green
    }
}

# Changelog
$changelogPath = "$EnclaveRoot\docs\changelog.md"
if (-not (Test-Path $changelogPath)) {
    if (-not $DryRun) {
        @"
# LLM Enclave Change Log

All changes to the runtime, model, tooling, and configuration are recorded here.

## $(Get-Date -Format 'yyyyMMdd_HHmmss') - Initial Provisioning
- Enclave directory structure created
- Initial configuration files created
- Provisioned by: 01_provision_enclave.ps1
"@ | Set-Content -Path $changelogPath
        Write-Log "Created changelog: $changelogPath"
    }
    Write-Host "Created: $changelogPath" -ForegroundColor Green
}

# Audit log files
$auditLogs = @(
    "$EnclaveRoot\logs\audit\network_access.log",
    "$EnclaveRoot\logs\audit\apply_audit.log",
    "$EnclaveRoot\logs\audit\git_operations.log",
    "$EnclaveRoot\logs\cloud_escalation_audit.log"
)

foreach ($al in $auditLogs) {
    if (-not (Test-Path $al)) {
        if (-not $DryRun) {
            "# Audit Log - Created $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Set-Content -Path $al
            Write-Log "Created audit log: $al"
        }
        Write-Host "Created: $al" -ForegroundColor Green
    }
}

# Ollama Modelfile template
$modelfilePath = "$EnclaveRoot\runtime\config\Modelfile"
if (-not (Test-Path $modelfilePath)) {
    if (-not $DryRun) {
        @"
# Ollama Modelfile for Qwen Local
# Update the FROM line to point to your verified model file.
# See docs\README.md for instructions.

FROM $EnclaveRoot\models\verified\MODEL_FILE_NAME_HERE.gguf

PARAMETER temperature 0.3
PARAMETER top_p 0.9
PARAMETER num_ctx 8192
PARAMETER stop "<|im_end|>"
PARAMETER stop "<|endoftext|>"

SYSTEM """You are a helpful coding assistant. You produce clean, correct, well-structured code. You do not access external resources or make network calls."""
"@ | Set-Content -Path $modelfilePath
        Write-Log "Created Modelfile template: $modelfilePath"
    }
    Write-Host "Created: $modelfilePath" -ForegroundColor Green
}

# -------------------------------------------------------------------
# Step 3: Set Environment Variables
# -------------------------------------------------------------------
Write-Host "`n--- Step 3: Setting Environment Variables ---" -ForegroundColor Cyan

$envVars = @{
    "OLLAMA_NOPRUNE"        = "1"
    "HF_HUB_OFFLINE"        = "1"
    "TRANSFORMERS_OFFLINE"   = "1"
    "DO_NOT_TRACK"           = "1"
    "OLLAMA_HOST"            = "127.0.0.1:11434"
}

foreach ($kv in $envVars.GetEnumerator()) {
    $current = [Environment]::GetEnvironmentVariable($kv.Key, "User")
    if ($current -ne $kv.Value) {
        if (-not $DryRun) {
            [Environment]::SetEnvironmentVariable($kv.Key, $kv.Value, "User")
            Write-Log "Set environment variable: $($kv.Key) = $($kv.Value)"
        }
        Write-Host "Set: $($kv.Key) = $($kv.Value)" -ForegroundColor Green
    } else {
        Write-Host "Already set: $($kv.Key) = $($kv.Value)" -ForegroundColor DarkGray
    }
}

# -------------------------------------------------------------------
# Step 4: Windows Firewall Rules
# -------------------------------------------------------------------
if (-not $SkipFirewall) {
    Write-Host "`n--- Step 4: Creating Firewall Rules (REQUIRES ADMIN) ---" -ForegroundColor Cyan

    $firewallRules = @(
        @{
            DisplayName = "LLM_Enclave: Block Ollama Outbound"
            Program     = "$EnclaveRoot\runtime\bin\ollama.exe"
            Description = "Blocks all outbound network access for Ollama inference runtime."
        },
        @{
            DisplayName = "LLM_Enclave: Block Enclave Python Outbound"
            Program     = "$EnclaveRoot\runtime\venv\Scripts\python.exe"
            Description = "Blocks outbound for Python in the enclave venv."
        },
        @{
            DisplayName = "LLM_Enclave: Block OpenClaw Python Outbound"
            Program     = "$EnclaveRoot\openclaw\install\venv\Scripts\python.exe"
            Description = "Blocks outbound for OpenClaw Python process."
        }
    )

    foreach ($rule in $firewallRules) {
        $existing = Get-NetFirewallRule -DisplayName $rule.DisplayName -ErrorAction SilentlyContinue
        if (-not $existing) {
            if (-not $DryRun) {
                try {
                    New-NetFirewallRule `
                        -DisplayName $rule.DisplayName `
                        -Direction Outbound `
                        -Action Block `
                        -Program $rule.Program `
                        -Profile Any `
                        -Enabled True `
                        -Description $rule.Description | Out-Null
                    Write-Host "Created firewall rule: $($rule.DisplayName)" -ForegroundColor Green
                    Write-Log "Created firewall rule: $($rule.DisplayName)"
                } catch {
                    Write-Host "FAILED to create firewall rule: $($rule.DisplayName)" -ForegroundColor Red
                    Write-Host "  Error: $_" -ForegroundColor Red
                    Write-Log "FAILED to create firewall rule: $($rule.DisplayName) - $_" "ERROR"
                }
            } else {
                Write-Host "[DRY RUN] Would create: $($rule.DisplayName)"
            }
        } else {
            Write-Host "Exists: $($rule.DisplayName)" -ForegroundColor DarkGray
        }
    }
} else {
    Write-Host "`n--- Step 4: Firewall Rules SKIPPED ---" -ForegroundColor Yellow
}

# -------------------------------------------------------------------
# Step 5: Create Restricted User (Optional)
# -------------------------------------------------------------------
if ($CreateRestrictedUser) {
    Write-Host "`n--- Step 5: Creating Restricted User (REQUIRES ADMIN) ---" -ForegroundColor Cyan

    $existingUser = Get-LocalUser -Name "LLM_Enclave_User" -ErrorAction SilentlyContinue
    if (-not $existingUser) {
        if (-not $DryRun) {
            $securePassword = Read-Host -AsSecureString "Enter password for LLM_Enclave_User"
            try {
                New-LocalUser -Name "LLM_Enclave_User" `
                    -Password $securePassword `
                    -FullName "LLM Enclave Runtime User" `
                    -Description "Restricted user for local LLM inference. No admin rights." `
                    -AccountNeverExpires `
                    -PasswordNeverExpires `
                    -UserMayNotChangePassword | Out-Null

                Write-Host "Created user: LLM_Enclave_User" -ForegroundColor Green
                Write-Log "Created restricted user: LLM_Enclave_User"

                # Set NTFS permissions on enclave directory
                $acl = Get-Acl $EnclaveRoot
                $acl.SetAccessRuleProtection($true, $false)

                # Admin full control
                $adminRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
                    [System.Security.Principal.WindowsIdentity]::GetCurrent().Name,
                    "FullControl",
                    "ContainerInherit,ObjectInherit",
                    "None",
                    "Allow"
                )
                $acl.AddAccessRule($adminRule)

                # SYSTEM full control (required for services)
                $systemRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
                    "SYSTEM",
                    "FullControl",
                    "ContainerInherit,ObjectInherit",
                    "None",
                    "Allow"
                )
                $acl.AddAccessRule($systemRule)

                # LLM_Enclave_User modify access
                $userRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
                    "LLM_Enclave_User",
                    "Modify",
                    "ContainerInherit,ObjectInherit",
                    "None",
                    "Allow"
                )
                $acl.AddAccessRule($userRule)

                Set-Acl -Path $EnclaveRoot -AclObject $acl
                Write-Host "Set NTFS permissions on $EnclaveRoot" -ForegroundColor Green
                Write-Log "Set NTFS ACLs on enclave for LLM_Enclave_User"

            } catch {
                Write-Host "FAILED to create user: $_" -ForegroundColor Red
                Write-Log "FAILED to create restricted user: $_" "ERROR"
            }
        }
    } else {
        Write-Host "User already exists: LLM_Enclave_User" -ForegroundColor DarkGray
    }
} else {
    Write-Host "`n--- Step 5: Restricted User creation SKIPPED ---" -ForegroundColor Yellow
    Write-Host "  Run with -CreateRestrictedUser to create the user." -ForegroundColor Yellow
}

# -------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------
Write-Host "`n========================================" -ForegroundColor Green
Write-Host " PROVISIONING COMPLETE" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Enclave root: $EnclaveRoot"
Write-Host "Log file:     $LogFile"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Download Ollama and place in $EnclaveRoot\runtime\bin\"
Write-Host "  2. Run 02_download_model.ps1 to download model weights"
Write-Host "  3. Run 03_run_runtime.ps1 to start the runtime"
Write-Host ""
Write-Host "See docs\README.md for complete instructions."

if (-not $DryRun) {
    Write-Log "Provisioning completed successfully" "SUCCESS"
}
