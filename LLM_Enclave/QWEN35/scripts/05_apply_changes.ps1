#Requires -Version 5.1
<#
.SYNOPSIS
    Apply changes from the bridge outbox to a target project with review gate.

.DESCRIPTION
    PURPOSE:
    Compare files in the bridge outbox against a target project directory,
    display diffs for review, require manual confirmation, create backups
    of existing files, then apply changes. Maintains a full audit log.

    CHANGES:
    - Copies files from workspace_bridge\outbox\ to the target project directory
    - Creates backups under backups\ with timestamped folders
    - Stores diffs under diffs\ with timestamped folders
    - Logs all operations to logs\audit\apply_audit.log

    PREREQS:
    - Enclave provisioned (01_provision_enclave.ps1)
    - Policy file configured (policies\bridge_policy.yaml)
    - policy_not_configured must be set to false
    - Target path must be in allowed_target_roots
    - Files in outbox ready for review

    ROLLBACK:
    - Restore files from the timestamped backup directory created during apply
    - Backup location is printed after each apply operation

    SECURITY NOTES:
    - This script REFUSES to operate if policy_not_configured is true.
    - This script REFUSES paths not in allowed_target_roots.
    - This script REFUSES file types not in allowed_extensions.
    - This script REFUSES files matching deny_patterns.
    - This script REFUSES files exceeding max size limits.
    - All files are backed up BEFORE being overwritten.
    - Manual typed confirmation is REQUIRED for every apply.
    - A detailed audit log is maintained.
    - This script does NOT delete any files.
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$OutboxPath,

    [Parameter(Mandatory=$true)]
    [string]$TargetPath,

    [switch]$DryRun
)

# -------------------------------------------------------------------
# Configuration
# -------------------------------------------------------------------
$EnclaveRoot = (Split-Path -Parent (Split-Path -Parent $PSCommandPath))
$PolicyFile = "$EnclaveRoot\policies\bridge_policy.yaml"
$BackupsRoot = "$EnclaveRoot\backups"
$DiffsRoot = "$EnclaveRoot\diffs"
$AuditLog = "$EnclaveRoot\logs\audit\apply_audit.log"

# -------------------------------------------------------------------
# Helper Functions
# -------------------------------------------------------------------
function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $entry = "$timestamp | $Level | 05_apply | $Message"
    Add-Content -Path $AuditLog -Value $entry -ErrorAction SilentlyContinue
    switch ($Level) {
        "ERROR"   { Write-Host $entry -ForegroundColor Red }
        "WARN"    { Write-Host $entry -ForegroundColor Yellow }
        "SUCCESS" { Write-Host $entry -ForegroundColor Green }
        default   { Write-Host $entry }
    }
}

function Read-PolicySimple {
    $policy = @{
        policy_not_configured = $true
        allowed_target_roots = @()
        allowed_extensions = @()
        deny_patterns = @()
        max_file_size_bytes = 1048576
        max_batch_size_bytes = 10485760
    }

    if (-not (Test-Path $PolicyFile)) {
        return $policy
    }

    $lines = Get-Content $PolicyFile
    $currentSection = ""

    foreach ($line in $lines) {
        $trimmed = $line.Trim()
        if ($trimmed -match '^#' -or $trimmed -eq "") { continue }

        if ($trimmed -match '^policy_not_configured:\s*(true|false)') {
            $policy.policy_not_configured = ($matches[1] -eq "true")
        }
        elseif ($trimmed -match '^max_file_size_bytes:\s*(\d+)') {
            $policy.max_file_size_bytes = [int64]$matches[1]
        }
        elseif ($trimmed -match '^max_batch_size_bytes:\s*(\d+)') {
            $policy.max_batch_size_bytes = [int64]$matches[1]
        }
        elseif ($trimmed -match '^allowed_target_roots:') {
            $currentSection = "target_roots"
        }
        elseif ($trimmed -match '^allowed_extensions:') {
            $currentSection = "extensions"
        }
        elseif ($trimmed -match '^deny_patterns:') {
            $currentSection = "deny"
        }
        elseif ($trimmed -match '^\w') {
            $currentSection = ""
        }
        elseif ($trimmed -match '^\s*-\s*"([^"]+)"' -or $trimmed -match "^\s*-\s*'([^']+)'") {
            $value = $matches[1]
            switch ($currentSection) {
                "target_roots" { $policy.allowed_target_roots += $value }
                "extensions"   { $policy.allowed_extensions += $value }
                "deny"         { $policy.deny_patterns += $value }
            }
        }
    }

    return $policy
}

# -------------------------------------------------------------------
# Validation
# -------------------------------------------------------------------
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " APPLY CHANGES - REVIEW GATE" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Check 1: Policy configured
$policy = Read-PolicySimple
if ($policy.policy_not_configured) {
    Write-Error "REFUSED: Policy is not configured."
    Write-Error "Edit $PolicyFile and set policy_not_configured to false."
    Write-Error "You must also add target paths to allowed_target_roots."
    Write-Log "REFUSED: policy_not_configured is true" "ERROR"
    exit 1
}

# Check 2: Outbox path exists
if (-not (Test-Path $OutboxPath)) {
    Write-Error "REFUSED: Outbox path does not exist: $OutboxPath"
    Write-Log "REFUSED: Outbox path not found: $OutboxPath" "ERROR"
    exit 1
}

# Check 3: Target path is in allowed roots
$targetResolved = (Resolve-Path $TargetPath -ErrorAction SilentlyContinue).Path
if (-not $targetResolved) {
    # Target may not exist yet (new directory)
    $targetResolved = $TargetPath
}

$targetAllowed = $false
foreach ($root in $policy.allowed_target_roots) {
    $rootNormalized = $root.Replace("\\", "\")
    if ($targetResolved.StartsWith($rootNormalized, [System.StringComparison]::OrdinalIgnoreCase)) {
        $targetAllowed = $true
        break
    }
}

if (-not $targetAllowed) {
    Write-Error "REFUSED: Target path is not in allowed_target_roots."
    Write-Error "  Target: $targetResolved"
    Write-Error "  Allowed roots: $($policy.allowed_target_roots -join ', ')"
    Write-Error "Edit $PolicyFile to add this path to allowed_target_roots."
    Write-Log "REFUSED: Target not in allowed roots: $targetResolved" "ERROR"
    exit 1
}

# Check 4: Target must be under D:\ProjectsHome (hard-coded safety)
if (-not $targetResolved.StartsWith("D:\ProjectsHome", [System.StringComparison]::OrdinalIgnoreCase)) {
    Write-Error "REFUSED: Target path must be under D:\ProjectsHome."
    Write-Log "REFUSED: Target outside D:\ProjectsHome: $targetResolved" "ERROR"
    exit 1
}

# -------------------------------------------------------------------
# Enumerate Files
# -------------------------------------------------------------------
Write-Host "`n--- Enumerating Files ---" -ForegroundColor Cyan

$outboxFiles = Get-ChildItem -Path $OutboxPath -File -Recurse
if ($outboxFiles.Count -eq 0) {
    Write-Host "No files found in outbox. Nothing to apply."
    exit 0
}

Write-Host "Found $($outboxFiles.Count) file(s) in outbox."
Write-Log "Apply started. Outbox: $OutboxPath, Target: $targetResolved, Files: $($outboxFiles.Count)"

# -------------------------------------------------------------------
# Validate Each File
# -------------------------------------------------------------------
$totalSize = 0
$filesToApply = @()

foreach ($file in $outboxFiles) {
    $relativePath = $file.FullName.Substring($OutboxPath.TrimEnd('\').Length)
    $targetFile = Join-Path $targetResolved $relativePath.TrimStart('\')
    $fileName = $file.Name

    # Extension check
    $ext = $file.Extension.ToLower()
    if ($policy.allowed_extensions.Count -gt 0 -and $ext -notin $policy.allowed_extensions) {
        Write-Host "  BLOCKED: $fileName - extension '$ext' not allowed" -ForegroundColor Red
        Write-Log "BLOCKED by extension: $fileName" "WARN"
        continue
    }

    # Deny pattern check
    $denied = $false
    foreach ($pattern in $policy.deny_patterns) {
        if ($fileName -match $pattern) {
            Write-Host "  BLOCKED: $fileName - matches deny pattern '$pattern'" -ForegroundColor Red
            Write-Log "BLOCKED by deny pattern: $fileName (pattern: $pattern)" "WARN"
            $denied = $true
            break
        }
    }
    if ($denied) { continue }

    # Size check
    if ($file.Length -gt $policy.max_file_size_bytes) {
        Write-Host "  BLOCKED: $fileName - size $($file.Length) exceeds limit" -ForegroundColor Red
        Write-Log "BLOCKED by size: $fileName ($($file.Length) bytes)" "WARN"
        continue
    }

    $totalSize += $file.Length
    $filesToApply += @{
        Source = $file.FullName
        Target = $targetFile
        RelativePath = $relativePath
        IsNew = -not (Test-Path $targetFile)
        Size = $file.Length
    }
}

# Batch size check
if ($totalSize -gt $policy.max_batch_size_bytes) {
    Write-Error "REFUSED: Total batch size $totalSize exceeds limit $($policy.max_batch_size_bytes)."
    Write-Log "REFUSED: Batch size exceeded ($totalSize > $($policy.max_batch_size_bytes))" "ERROR"
    exit 1
}

if ($filesToApply.Count -eq 0) {
    Write-Host "No files passed validation. Nothing to apply."
    exit 0
}

# -------------------------------------------------------------------
# Generate and Display Diffs
# -------------------------------------------------------------------
Write-Host "`n--- Changes to Apply ---" -ForegroundColor Cyan

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$diffDir = Join-Path $DiffsRoot $timestamp
New-Item -ItemType Directory -Path $diffDir -Force | Out-Null

foreach ($f in $filesToApply) {
    Write-Host "`n  $($f.RelativePath)" -ForegroundColor White

    if ($f.IsNew) {
        Write-Host "  [NEW FILE] ($($f.Size) bytes)" -ForegroundColor Green
        # Save diff showing entire file as new
        $content = Get-Content $f.Source -Raw -ErrorAction SilentlyContinue
        if ($content) {
            $diffContent = "+++ NEW FILE: $($f.RelativePath)`n$content"
            $diffFileName = ($f.RelativePath -replace '[\\\/]', '_') + ".diff"
            $diffContent | Set-Content -Path (Join-Path $diffDir $diffFileName)
        }
    } else {
        Write-Host "  [MODIFIED]" -ForegroundColor Yellow

        # Generate diff
        $oldContent = Get-Content $f.Target -ErrorAction SilentlyContinue
        $newContent = Get-Content $f.Source -ErrorAction SilentlyContinue

        if ($oldContent -and $newContent) {
            $oldTemp = [System.IO.Path]::GetTempFileName()
            $newTemp = [System.IO.Path]::GetTempFileName()
            $oldContent | Set-Content -Path $oldTemp
            $newContent | Set-Content -Path $newTemp

            # Use fc.exe for diff (built into Windows)
            $diffOutput = fc.exe /L /N $oldTemp $newTemp 2>&1
            Remove-Item $oldTemp, $newTemp -Force

            if ($diffOutput) {
                Write-Host "  --- Diff ---" -ForegroundColor DarkGray
                $diffOutput | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
            }

            # Save diff
            $diffFileName = ($f.RelativePath -replace '[\\\/]', '_') + ".diff"
            $diffOutput | Set-Content -Path (Join-Path $diffDir $diffFileName)
        }
    }
}

Write-Host "`nDiffs saved to: $diffDir"

# -------------------------------------------------------------------
# Confirmation Gate
# -------------------------------------------------------------------
Write-Host "`n========================================" -ForegroundColor Yellow
Write-Host " REVIEW THE CHANGES ABOVE" -ForegroundColor Yellow
Write-Host " Files to apply: $($filesToApply.Count)" -ForegroundColor Yellow
Write-Host " Target: $targetResolved" -ForegroundColor Yellow
Write-Host " Total size: $totalSize bytes" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

if ($DryRun) {
    Write-Host "`n[DRY RUN] No changes will be made." -ForegroundColor Cyan
    Write-Log "DRY RUN completed. No changes made."
    exit 0
}

$confirm = Read-Host "Type 'CONFIRM APPLY' to proceed (anything else cancels)"
if ($confirm -ne "CONFIRM APPLY") {
    Write-Host "CANCELLED. No changes were made." -ForegroundColor Red
    Write-Log "Apply CANCELLED by user" "WARN"
    exit 0
}

# -------------------------------------------------------------------
# Create Backups and Apply
# -------------------------------------------------------------------
Write-Host "`n--- Applying Changes ---" -ForegroundColor Cyan

$backupDir = Join-Path $BackupsRoot $timestamp
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

$applied = 0
$newFiles = 0
$backupManifest = @{}

foreach ($f in $filesToApply) {
    $targetDir = Split-Path $f.Target -Parent

    # Backup existing file
    if (-not $f.IsNew) {
        $backupRelPath = $f.RelativePath.TrimStart('\')
        $backupFilePath = Join-Path $backupDir $backupRelPath
        $backupFileDir = Split-Path $backupFilePath -Parent
        if (-not (Test-Path $backupFileDir)) {
            New-Item -ItemType Directory -Path $backupFileDir -Force | Out-Null
        }
        Copy-Item -Path $f.Target -Destination $backupFilePath
        # Record backup hash for integrity verification
        $backupHash = (Get-FileHash -Path $backupFilePath -Algorithm SHA256).Hash
        $backupManifest[$backupRelPath] = $backupHash
        Write-Host "  BACKUP: $($f.Target) -> $backupFilePath" -ForegroundColor DarkGray
        Write-Log "BACKUP_CREATED: $($f.Target) -> $backupFilePath (SHA256: $backupHash)"
    }

    # Create target directory if needed
    if (-not (Test-Path $targetDir)) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }

    # Copy file
    Copy-Item -Path $f.Source -Destination $f.Target
    if ($f.IsNew) {
        Write-Host "  CREATED: $($f.Target)" -ForegroundColor Green
        Write-Log "FILE_CREATED: $($f.Target)"
        $newFiles++
    } else {
        Write-Host "  UPDATED: $($f.Target)" -ForegroundColor Green
        Write-Log "FILE_UPDATED: $($f.Target)"
        $applied++
    }
}

# -------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------
Write-Host "`n========================================" -ForegroundColor Green
Write-Host " APPLY COMPLETE" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
# Save backup manifest with SHA256 hashes for integrity verification
if ($backupManifest.Count -gt 0) {
    $manifestPath = Join-Path $backupDir "backup_manifest.json"
    $backupManifest | ConvertTo-Json -Depth 3 | Set-Content -Path $manifestPath -Encoding UTF8
    Write-Host "Backup manifest: $manifestPath ($($backupManifest.Count) hashes)" -ForegroundColor DarkGray
    Write-Log "Backup manifest created: $manifestPath"
}

Write-Host "Updated files: $applied"
Write-Host "New files:     $newFiles"
Write-Host "Backup dir:    $backupDir"
Write-Host "Diff dir:      $diffDir"
Write-Host ""
Write-Host "To rollback, restore files from: $backupDir"
Write-Log "APPLY_COMPLETED: Updated=$applied, New=$newFiles, Backup=$backupDir" "SUCCESS"
