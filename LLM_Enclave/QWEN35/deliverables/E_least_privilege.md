# DELIVERABLE E: Least Privilege Execution and Containment

## E1. Dedicated Local Windows User Account

Creating a restricted local user provides process-level containment. The runtime runs as this user and can only access enclave directories.

```powershell
# =============================================================================
# REQUIRES ADMINISTRATOR PRIVILEGES
# =============================================================================

# Create a restricted local user for the LLM runtime
$securePassword = Read-Host -AsSecureString "Enter password for LLM_Enclave_User"
New-LocalUser -Name "LLM_Enclave_User" `
    -Password $securePassword `
    -FullName "LLM Enclave Runtime User" `
    -Description "Restricted user for running local LLM inference. No admin rights. Limited file access." `
    -AccountNeverExpires `
    -PasswordNeverExpires `
    -UserMayNotChangePassword

# Do NOT add to any privileged groups. The user is in "Users" group by default.
# Explicitly remove from Remote Desktop Users if present
Remove-LocalGroupMember -Group "Remote Desktop Users" -Member "LLM_Enclave_User" -ErrorAction SilentlyContinue

# Deny interactive logon (optional - prevents the user from logging in at the console)
# This is done via Local Security Policy (secpol.msc) or via secedit.
# For scripted approach:
# secedit /export /cfg C:\temp\secpol.cfg
# Add "LLM_Enclave_User" to SeDenyInteractiveLogonRight
# secedit /configure /db C:\temp\secpol.sdb /cfg C:\temp\secpol.cfg

Write-Host "User 'LLM_Enclave_User' created successfully." -ForegroundColor Green
```

### Grant Access to Enclave Folders Only

```powershell
# Grant LLM_Enclave_User access ONLY to the enclave directory tree
$enclavePath = "D:\ProjectsHome\LLM_Enclave\QWEN35"

# First, remove any inherited permissions from parent
$acl = Get-Acl $enclavePath
$acl.SetAccessRuleProtection($true, $false)  # Disable inheritance, remove inherited rules

# Add full control for the current admin user (so you can still manage files)
$adminRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    [System.Security.Principal.WindowsIdentity]::GetCurrent().Name,
    "FullControl",
    "ContainerInherit,ObjectInherit",
    "None",
    "Allow"
)
$acl.AddAccessRule($adminRule)

# Add modify access for LLM_Enclave_User (read, write, execute - but not full control)
$userRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    "LLM_Enclave_User",
    "Modify",
    "ContainerInherit,ObjectInherit",
    "None",
    "Allow"
)
$acl.AddAccessRule($userRule)

# Apply
Set-Acl -Path $enclavePath -AclObject $acl

Write-Host "NTFS permissions set on $enclavePath" -ForegroundColor Green
```

### Restrict Access to Projects Root

```powershell
# Explicitly deny LLM_Enclave_User access to D:\ProjectsHome
# (except the LLM_Enclave subtree, which has its own explicit Allow)
$projectsPath = "D:\ProjectsHome"
$acl = Get-Acl $projectsPath

$denyRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    "LLM_Enclave_User",
    "FullControl",
    "ContainerInherit,ObjectInherit",
    "None",
    "Deny"
)
$acl.AddAccessRule($denyRule)
Set-Acl -Path $projectsPath -AclObject $acl

# NOTE: The explicit Allow on D:\ProjectsHome\LLM_Enclave\QWEN35 with
# inheritance disabled will still apply because NTFS evaluates ACLs
# with Deny generally taking precedence, BUT if we break inheritance on
# the enclave folder and set explicit Allow there, the user can access
# the enclave while being denied the parent.
#
# IMPORTANT: Test this thoroughly. If Deny on the parent overrides the
# Allow on the child, use approach E2 instead.

Write-Host "Deny rule set on $projectsPath for LLM_Enclave_User" -ForegroundColor Green
```

## E2. Alternative Containment (If Local User Is Not Feasible)

If creating a local user is impractical, use NTFS ACLs combined with process-level restrictions.

### Approach: NTFS ACLs + PowerShell Job Containment

```powershell
# Create a restricted PowerShell session configuration
# This limits what commands and paths are available

# Method 1: Use Start-Process with reduced privileges
# RunAs a lower-integrity process using icacls
# Set the enclave directory to allow modification
icacls "D:\ProjectsHome\LLM_Enclave\QWEN35" /grant:r "$env:USERNAME:(OI)(CI)M" /T

# Set all other project directories to deny the enclave process
# (This only works with a separate user; for same-user, we rely on bridge enforcement)

# Method 2: Use Windows Sandbox (if available)
# Windows Sandbox provides full isolation but requires Windows Pro/Enterprise
# and does not persist state easily. Consider only for high-risk operations.

# Method 3: Use a constrained PowerShell endpoint
$sessionConfigPath = "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\config\ConstrainedSession.pssc"
New-PSSessionConfigurationFile -Path $sessionConfigPath `
    -SessionType RestrictedRemoteServer `
    -VisibleCmdlets @('Get-ChildItem', 'Get-Content', 'Set-Content', 'Copy-Item', 'Test-Path') `
    -VisibleProviders @('FileSystem') `
    -MountUserDrive `
    -UserDriveMaximumSize 1GB
```

## E3. Ensuring Runtime Cannot Access Outside Enclave

### Primary Enforcement: NTFS ACLs (with dedicated user)

As configured in E1, the `LLM_Enclave_User` has:
- **Allow Modify** on `D:\ProjectsHome\LLM_Enclave\QWEN35\` (and children)
- **Deny FullControl** on `D:\ProjectsHome\` (parent, does not cascade into enclave due to broken inheritance)

### Secondary Enforcement: Bridge Script Validation

All scripts (H4, H5) validate paths before any file operation:

```powershell
function Test-PathInEnclave {
    param([string]$Path)
    $resolvedPath = (Resolve-Path $Path -ErrorAction SilentlyContinue).Path
    if (-not $resolvedPath) { return $false }
    $enclave = "D:\ProjectsHome\LLM_Enclave\QWEN35"
    return $resolvedPath.StartsWith($enclave, [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-PathInAllowlist {
    param(
        [string]$Path,
        [string[]]$AllowedRoots
    )
    $resolvedPath = (Resolve-Path $Path -ErrorAction SilentlyContinue).Path
    if (-not $resolvedPath) { return $false }
    foreach ($root in $AllowedRoots) {
        if ($resolvedPath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }
    return $false
}
```

### Tertiary Enforcement: Process Working Directory

The runtime start script (H3) forces the working directory to the enclave:

```powershell
Set-Location "D:\ProjectsHome\LLM_Enclave\QWEN35"
# All relative paths resolve within the enclave
```

## E4. WSL Mount Risks and Mitigations

### Risk Assessment

By default, WSL2 mounts Windows drives under `/mnt/`:
- `/mnt/c` -> `C:\`
- `/mnt/d` -> `D:\`

This means any process running in WSL has full read/write access to `D:\ProjectsHome`.

### Mitigations

#### Option 1: Restrict WSL Mount Points (Recommended if WSL is used)

Create or edit `/etc/wsl.conf` inside the WSL distribution:

```ini
# /etc/wsl.conf
[automount]
enabled = true
root = /mnt/
options = "metadata,umask=077,fmask=077"
mountFsTab = false

[interop]
enabled = false
appendWindowsPath = false
```

**What this changes:**
- `umask=077,fmask=077`: Only the WSL user who owns the mount can access files. Other WSL users cannot.
- `interop.enabled = false`: Disables the ability for WSL processes to execute Windows binaries (cmd.exe, powershell.exe). This is critical -- without this, a compromised WSL process can escape to Windows.
- `appendWindowsPath = false`: Prevents WSL from adding Windows PATH entries, which could allow execution of Windows tools.

**Rollback:**
```ini
# Revert /etc/wsl.conf to default:
[automount]
enabled = true

[interop]
enabled = true
appendWindowsPath = true
```

Then restart WSL: `wsl --shutdown` from PowerShell.

#### Option 2: Mount Only the Enclave (Strict)

If WSL must access enclave files, create a specific mount instead of using automount:

```bash
# Inside WSL, after disabling automount:
sudo mkdir -p /mnt/llm_enclave
sudo mount -t drvfs 'D:\ProjectsHome\LLM_Enclave\QWEN35' /mnt/llm_enclave -o metadata,uid=1000,gid=1000,umask=077
```

This gives WSL access only to the enclave, not to the rest of `D:\ProjectsHome`.

#### Option 3: Do Not Use WSL (Simplest)

If all operations can be done in Windows (which is the case with Ollama as the primary runtime), avoid WSL entirely. This eliminates the entire class of WSL interop risks.

**Recommendation**: Use Option 3 (avoid WSL) unless a specific WSL requirement is identified. Ollama runs natively on Windows and does not require WSL.
