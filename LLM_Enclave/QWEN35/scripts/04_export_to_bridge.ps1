#Requires -Version 5.1
<#
.SYNOPSIS
    Export files from a project into the Workspace Bridge inbox.

.DESCRIPTION
    PURPOSE:
    Copy selected files from a target project repository into the bridge
    inbox directory where the model can access them. Applies deny patterns,
    max size limits, and secret scanning before copying.

    CHANGES:
    - Copies files into workspace_bridge\inbox\ (originals are never modified)
    - Logs all exported files to logs\bridge\export.log

    PREREQS:
    - Enclave provisioned (01_provision_enclave.ps1)
    - Policy file exists at policies\bridge_policy.yaml
    - Source path must exist and be readable

    ROLLBACK:
    - Remove exported copies from workspace_bridge\inbox\
    - No changes are made to the source project.

    SECURITY NOTES:
    - Source files are NEVER modified. Only copies are created.
    - Deny patterns from policy are enforced (no .key, .pem, .env, etc.)
    - Max file size is enforced.
    - Secret scanning is performed and files with detected secrets are blocked.
    - This script does not require Administrator privileges.
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$SourcePath,

    [string]$ProjectLabel = "",

    [switch]$Recursive,

    [switch]$Force
)

# -------------------------------------------------------------------
# Configuration
# -------------------------------------------------------------------
$EnclaveRoot = (Split-Path -Parent (Split-Path -Parent $PSCommandPath))
$InboxDir = "$EnclaveRoot\workspace_bridge\inbox"
$PolicyFile = "$EnclaveRoot\policies\bridge_policy.yaml"
$LogFile = "$EnclaveRoot\logs\bridge\export.log"

# -------------------------------------------------------------------
# Helper Functions
# -------------------------------------------------------------------
function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $entry = "$timestamp | $Level | 04_export | $Message"
    Add-Content -Path $LogFile -Value $entry -ErrorAction SilentlyContinue
    switch ($Level) {
        "ERROR"   { Write-Host $entry -ForegroundColor Red }
        "WARN"    { Write-Host $entry -ForegroundColor Yellow }
        "SUCCESS" { Write-Host $entry -ForegroundColor Green }
        default   { Write-Host $entry }
    }
}

function Read-PolicyFile {
    # Simple YAML parser for our known policy structure
    # (Avoids dependency on external YAML modules)
    $policy = @{
        deny_patterns = @()
        allowed_extensions = @()
        max_file_size_bytes = 1048576
        secret_scanning_enabled = $true
        secret_scanning_mode = "block"
    }

    if (-not (Test-Path $PolicyFile)) {
        Write-Log "Policy file not found. Using defaults." "WARN"
        return $policy
    }

    $content = Get-Content $PolicyFile -Raw

    # Extract deny patterns
    if ($content -match "deny_patterns:\s*\n((?:\s+-\s+'[^']+'\s*\n)+)") {
        $patternBlock = $matches[1]
        $policy.deny_patterns = [regex]::Matches($patternBlock, "'([^']+)'") |
            ForEach-Object { $_.Groups[1].Value }
    }

    # Extract max file size
    if ($content -match "max_file_size_bytes:\s*(\d+)") {
        $policy.max_file_size_bytes = [int64]$matches[1]
    }

    # Extract allowed extensions
    if ($content -match "allowed_extensions:\s*\n((?:\s+-\s+`"[^`"]+`"\s*\n)+)") {
        $extBlock = $matches[1]
        $policy.allowed_extensions = [regex]::Matches($extBlock, '"([^"]+)"') |
            ForEach-Object { $_.Groups[1].Value }
    }

    return $policy
}

function Test-DenyPattern {
    param([string]$FileName, [string[]]$Patterns)
    foreach ($pattern in $Patterns) {
        if ($FileName -match $pattern) {
            return $pattern
        }
    }
    return $null
}

function Test-SecretContent {
    param([string]$Content)
    $secretPatterns = @(
        @{ Name = "AWS Access Key";    Pattern = 'AKIA[0-9A-Z]{16}' }
        @{ Name = "GitHub Token";      Pattern = 'gh[pousr]_[A-Za-z0-9_]{36,}' }
        @{ Name = "Private Key Block"; Pattern = '-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----' }
        @{ Name = "Generic API Key";   Pattern = '(?i)(api[_-]?key|apikey)\s*[:=]\s*["\x27]?\S{20,}' }
        @{ Name = "Generic Secret";    Pattern = '(?i)(secret|password|passwd|token)\s*[:=]\s*["\x27]?\S{8,}' }
        @{ Name = "Connection String"; Pattern = '(?i)(server|host)=\S+;.*(password|pwd)=\S+' }
        @{ Name = "Bearer Token";      Pattern = '(?i)bearer\s+[A-Za-z0-9\-._~+/]{20,}=*' }
        @{ Name = "JWT Token";         Pattern = 'eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_.+/=]+' }
    )

    $findings = @()
    foreach ($sp in $secretPatterns) {
        if ($Content -match $sp.Pattern) {
            $findings += $sp.Name
        }
    }
    return $findings
}

# -------------------------------------------------------------------
# Validation
# -------------------------------------------------------------------
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " EXPORT TO BRIDGE" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

if (-not (Test-Path $SourcePath)) {
    Write-Error "Source path does not exist: $SourcePath"
    Write-Log "Source path does not exist: $SourcePath" "ERROR"
    exit 1
}

# Load policy
$policy = Read-PolicyFile

# Determine files to export
$isDirectory = (Get-Item $SourcePath).PSIsContainer
if ($isDirectory) {
    if ($Recursive) {
        $files = Get-ChildItem -Path $SourcePath -File -Recurse
    } else {
        $files = Get-ChildItem -Path $SourcePath -File
    }
} else {
    $files = @(Get-Item $SourcePath)
}

if ($files.Count -eq 0) {
    Write-Host "No files found to export." -ForegroundColor Yellow
    exit 0
}

Write-Host "Found $($files.Count) file(s) to process."
Write-Log "Export started. Source: $SourcePath, Files: $($files.Count)"

# Determine inbox subdirectory
$inboxSubDir = $InboxDir
if ($ProjectLabel -ne "") {
    $inboxSubDir = Join-Path $InboxDir $ProjectLabel
}

# -------------------------------------------------------------------
# Process Each File
# -------------------------------------------------------------------
$exported = 0
$skipped = 0
$blocked = 0

foreach ($file in $files) {
    $relativePath = ""
    if ($isDirectory) {
        $relativePath = $file.FullName.Substring($SourcePath.TrimEnd('\').Length)
    } else {
        $relativePath = "\$($file.Name)"
    }

    $destPath = Join-Path $inboxSubDir $relativePath.TrimStart('\')
    $fileName = $file.Name

    Write-Host "`nProcessing: $($file.FullName)" -ForegroundColor DarkGray

    # Check 1: Deny patterns
    $denyMatch = Test-DenyPattern -FileName $fileName -Patterns $policy.deny_patterns
    if ($denyMatch) {
        Write-Host "  BLOCKED: Matches deny pattern '$denyMatch'" -ForegroundColor Red
        Write-Log "BLOCKED by deny pattern: $fileName (pattern: $denyMatch)" "WARN"
        $blocked++
        continue
    }

    # Check 2: File extension
    $ext = $file.Extension.ToLower()
    if ($policy.allowed_extensions.Count -gt 0 -and $ext -notin $policy.allowed_extensions) {
        Write-Host "  BLOCKED: Extension '$ext' not in allowed list" -ForegroundColor Red
        Write-Log "BLOCKED by extension: $fileName (ext: $ext)" "WARN"
        $blocked++
        continue
    }

    # Check 3: File size
    if ($file.Length -gt $policy.max_file_size_bytes) {
        Write-Host "  BLOCKED: File size $($file.Length) exceeds limit $($policy.max_file_size_bytes)" -ForegroundColor Red
        Write-Log "BLOCKED by size: $fileName ($($file.Length) bytes)" "WARN"
        $blocked++
        continue
    }

    # Check 4: Secret scanning
    if ($policy.secret_scanning_enabled) {
        try {
            $content = Get-Content $file.FullName -Raw -ErrorAction Stop
            $secrets = Test-SecretContent -Content $content
            if ($secrets.Count -gt 0) {
                Write-Host "  BLOCKED: Secrets detected: $($secrets -join ', ')" -ForegroundColor Red
                Write-Log "BLOCKED by secret scan: $fileName (patterns: $($secrets -join ', '))" "WARN"
                $blocked++
                continue
            }
        } catch {
            # Binary file or unreadable, skip secret scan
            Write-Host "  INFO: Could not scan for secrets (binary file?)" -ForegroundColor DarkGray
        }
    }

    # All checks passed, copy the file
    $destDir = Split-Path $destPath -Parent
    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }

    if (Test-Path $destPath) {
        if (-not $Force) {
            Write-Host "  SKIPPED: File already exists in inbox (use -Force to overwrite)" -ForegroundColor Yellow
            $skipped++
            continue
        }
        # With -Force, create timestamped variant instead of overwriting
        $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
        $newName = "$($file.BaseName)_$timestamp$($file.Extension)"
        $destPath = Join-Path (Split-Path $destPath -Parent) $newName
        Write-Host "  INFO: Creating timestamped variant: $newName" -ForegroundColor Yellow
    }

    Copy-Item -Path $file.FullName -Destination $destPath
    Write-Host "  EXPORTED: $destPath" -ForegroundColor Green
    Write-Log "EXPORTED: $($file.FullName) -> $destPath"
    $exported++
}

# -------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------
Write-Host "`n========================================" -ForegroundColor Green
Write-Host " EXPORT COMPLETE" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Exported: $exported"
Write-Host "Skipped:  $skipped"
Write-Host "Blocked:  $blocked"
Write-Host "Inbox:    $inboxSubDir"
Write-Log "Export complete. Exported=$exported, Skipped=$skipped, Blocked=$blocked" "SUCCESS"
