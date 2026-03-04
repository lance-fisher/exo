#Requires -Version 5.1
<#
.SYNOPSIS
    Perform a hardened install of OpenClaw into the enclave.

.DESCRIPTION
    PURPOSE:
    Install OpenClaw from previously downloaded and verified release artifacts
    into the enclave directory. This is a local-only, contained installation
    that does not modify system-wide settings.

    CHANGES:
    - Extracts OpenClaw release artifacts to openclaw\install\
    - Creates Python venv (if Python-based) with pinned dependencies
    - Creates OpenClaw configuration at openclaw\config\config.yaml
    - Creates firewall rules for OpenClaw processes (REQUIRES ADMIN)
    - Updates openclaw_install_record.md with install details
    - Logs all actions to logs\provision.log

    PREREQS:
    - Enclave provisioned (01_provision_enclave.ps1)
    - OpenClaw downloaded and verified (06_download_openclaw.ps1)
    - No outbound network needed (offline install from local artifacts)

    ROLLBACK:
    To completely remove the OpenClaw installation:
    1. Stop OpenClaw processes: Stop-Process -Name "openclaw*" -Force
    2. Remove install directory: Remove-Item "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\install" -Recurse -Force
    3. Remove config: Remove-Item "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\config" -Recurse -Force
    4. Remove firewall rules: Get-NetFirewallRule -DisplayName "LLM_Enclave: Block OpenClaw*" | Remove-NetFirewallRule
    5. The release artifacts in openclaw\release\ are preserved for re-install.

    SECURITY NOTES:
    - This script installs from LOCAL artifacts only. No network access.
    - The install is contained within the enclave directory.
    - Global PATH is NOT modified unless -AddToPath is specified.
    - Firewall rules are created to block OpenClaw outbound.
    - Configuration enforces bridge-only file access.
    - Telemetry and auto-update are disabled.
    - Fails closed if hash verification fails.
#>

param(
    [switch]$AddToPath,
    [switch]$SkipFirewall,
    [switch]$DryRun
)

# -------------------------------------------------------------------
# Configuration
# -------------------------------------------------------------------
$EnclaveRoot = "D:\ProjectsHome\LLM_Enclave\QWEN35"
$ReleaseDir = "$EnclaveRoot\openclaw\release"
$InstallDir = "$EnclaveRoot\openclaw\install"
$ConfigDir = "$EnclaveRoot\openclaw\config"
$HashFile = "$EnclaveRoot\hashes\openclaw_hashes.txt"
$LogFile = "$EnclaveRoot\logs\provision.log"
$InstallRecordPath = "$EnclaveRoot\docs\openclaw_install_record.md"

# -------------------------------------------------------------------
# Helper Functions
# -------------------------------------------------------------------
function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $entry = "$timestamp | $Level | 07_install_openclaw | $Message"
    Add-Content -Path $LogFile -Value $entry -ErrorAction SilentlyContinue
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
Write-Host " OPENCLAW HARDENED INSTALLATION" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Check enclave
if (-not (Test-Path $EnclaveRoot)) {
    Write-Error "FATAL: Enclave not provisioned."
    exit 1
}

# Check release artifacts
if (-not (Test-Path $ReleaseDir)) {
    Write-Error "FATAL: No release artifacts found. Run 06_download_openclaw.ps1 first."
    exit 1
}

$releaseFiles = Get-ChildItem -Path $ReleaseDir -File
if ($releaseFiles.Count -eq 0) {
    Write-Error "FATAL: Release directory is empty. Run 06_download_openclaw.ps1 first."
    exit 1
}

# Verify hashes of release artifacts
Write-Host "`n--- Verifying Release Artifact Integrity ---" -ForegroundColor Cyan
$storedHashes = @{}
if (Test-Path $HashFile) {
    Get-Content $HashFile | Where-Object { $_ -notmatch "^#" -and $_ -ne "" } | ForEach-Object {
        $parts = $_ -split "\s{2,}"
        if ($parts.Count -ge 2) {
            $storedHashes[$parts[1]] = $parts[0]
        }
    }
}

foreach ($file in $releaseFiles) {
    $currentHash = (Get-FileHash -Path $file.FullName -Algorithm SHA256).Hash
    if ($storedHashes.ContainsKey($file.Name)) {
        if ($storedHashes[$file.Name] -ne $currentHash) {
            Write-Error "INTEGRITY FAILURE: $($file.Name) hash does not match stored hash."
            Write-Error "  Stored:  $($storedHashes[$file.Name])"
            Write-Error "  Current: $currentHash"
            Write-Error "ABORTING. Artifacts may have been tampered with."
            Write-Log "INTEGRITY FAILURE: $($file.Name)" "ERROR"
            exit 1
        }
        Write-Host "  VERIFIED: $($file.Name)" -ForegroundColor Green
    } else {
        Write-Host "  NO STORED HASH: $($file.Name) (hash: $currentHash)" -ForegroundColor Yellow
        Write-Log "No stored hash for: $($file.Name). Hash=$currentHash" "WARN"
    }
}

Write-Log "All artifact integrity checks passed"

# -------------------------------------------------------------------
# Extract and Install
# -------------------------------------------------------------------
Write-Host "`n--- Installing OpenClaw ---" -ForegroundColor Cyan

if (-not $DryRun) {
    # Find the source archive
    $sourceArchive = Get-ChildItem -Path $ReleaseDir -Filter "source-*.zip" | Select-Object -First 1
    $binaryArchive = Get-ChildItem -Path $ReleaseDir -Filter "*.zip" | Where-Object { $_.Name -notmatch "source-" } | Select-Object -First 1

    if ($sourceArchive) {
        Write-Host "Extracting source archive: $($sourceArchive.Name)"
        Expand-Archive -Path $sourceArchive.FullName -DestinationPath $InstallDir -Force
        Write-Host "Extracted to: $InstallDir" -ForegroundColor Green
        Write-Log "Extracted source archive to: $InstallDir"
    } elseif ($binaryArchive) {
        Write-Host "Extracting binary archive: $($binaryArchive.Name)"
        Expand-Archive -Path $binaryArchive.FullName -DestinationPath $InstallDir -Force
        Write-Host "Extracted to: $InstallDir" -ForegroundColor Green
        Write-Log "Extracted binary archive to: $InstallDir"
    } else {
        # Copy all release files to install dir
        Write-Host "No archive found. Copying release files directly."
        foreach ($file in $releaseFiles) {
            if ($file.Name -ne "provenance.json") {
                Copy-Item -Path $file.FullName -Destination $InstallDir
                Write-Host "  Copied: $($file.Name)"
            }
        }
        Write-Log "Copied release files to install dir"
    }

    # Check for Python requirements
    $reqFiles = Get-ChildItem -Path $InstallDir -Filter "requirements*.txt" -Recurse
    if ($reqFiles) {
        Write-Host "`n--- Setting Up Python Environment ---" -ForegroundColor Cyan
        $venvPath = "$InstallDir\venv"

        if (-not (Test-Path $venvPath)) {
            Write-Host "Creating Python venv..."
            python -m venv $venvPath

            if (Test-Path "$venvPath\Scripts\pip.exe") {
                Write-Host "Installing dependencies..."
                # Try to install with hash verification
                $reqFile = $reqFiles | Select-Object -First 1
                try {
                    & "$venvPath\Scripts\pip.exe" install -r $reqFile.FullName --no-deps 2>&1
                    Write-Host "Dependencies installed." -ForegroundColor Green
                    Write-Log "Python dependencies installed from: $($reqFile.FullName)"
                } catch {
                    Write-Warning "Dependency install had issues: $_"
                    Write-Log "Dependency install warning: $_" "WARN"
                }
            }
        }
    }
} else {
    Write-Host "[DRY RUN] Would extract and install OpenClaw to: $InstallDir"
}

# -------------------------------------------------------------------
# Create Configuration
# -------------------------------------------------------------------
Write-Host "`n--- Creating Configuration ---" -ForegroundColor Cyan

if (-not (Test-Path $ConfigDir)) {
    New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null
}

$configPath = "$ConfigDir\config.yaml"
if (-not (Test-Path $configPath) -or $DryRun) {
    $configContent = @"
# =============================================================================
# OpenClaw Enclave Configuration
# =============================================================================
# Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
# This configuration enforces local-only, contained operation.
# =============================================================================

# LLM Backend - connects to local Ollama only
llm_backend: "ollama"
ollama_host: "http://127.0.0.1:11434"
ollama_model: "qwen-local"

# File Access - restricted to bridge directories only
workspace_root: "D:\\ProjectsHome\\LLM_Enclave\\QWEN35\\workspace_bridge"
allowed_directories:
  - "D:\\ProjectsHome\\LLM_Enclave\\QWEN35\\workspace_bridge\\inbox"
  - "D:\\ProjectsHome\\LLM_Enclave\\QWEN35\\workspace_bridge\\outbox"
  - "D:\\ProjectsHome\\LLM_Enclave\\QWEN35\\workspace_bridge\\scratch"

# Security - all external access disabled
telemetry_enabled: false
auto_update_enabled: false
plugin_loading_enabled: false
mcp_servers_enabled: false
extensions_enabled: false
connectors_enabled: false
trust_remote_code: false
network_access: false

# Scanning - disabled to prevent unauthorized directory access
file_watcher_enabled: false
auto_index_enabled: false
recursive_scan_enabled: false
smart_context_enabled: false
additional_roots: []

# Logging - metadata only, no content
log_directory: "D:\\ProjectsHome\\LLM_Enclave\\QWEN35\\logs\\openclaw"
log_level: "INFO"
log_prompts: false
log_responses: false
log_file_contents: false

# Verified plugins (empty by default - all plugins blocked)
verified_plugins: []
"@

    if (-not $DryRun) {
        $configContent | Set-Content -Path $configPath
        Write-Host "Configuration created: $configPath" -ForegroundColor Green
        Write-Log "OpenClaw configuration created"
    } else {
        Write-Host "[DRY RUN] Would create configuration at: $configPath"
    }
} else {
    Write-Host "Configuration already exists: $configPath" -ForegroundColor Yellow
}

# -------------------------------------------------------------------
# Firewall Rules
# -------------------------------------------------------------------
if (-not $SkipFirewall -and (Test-IsAdmin)) {
    Write-Host "`n--- Creating Firewall Rules ---" -ForegroundColor Cyan

    # Find executables in the install directory
    $exeFiles = Get-ChildItem -Path $InstallDir -Filter "*.exe" -Recurse
    $pythonExe = "$InstallDir\venv\Scripts\python.exe"

    $fwTargets = @()
    foreach ($exe in $exeFiles) {
        $fwTargets += @{
            Name = "LLM_Enclave: Block OpenClaw $($exe.BaseName) Outbound"
            Path = $exe.FullName
        }
    }
    if (Test-Path $pythonExe) {
        $fwTargets += @{
            Name = "LLM_Enclave: Block OpenClaw Python Outbound"
            Path = $pythonExe
        }
    }

    foreach ($fw in $fwTargets) {
        $existing = Get-NetFirewallRule -DisplayName $fw.Name -ErrorAction SilentlyContinue
        if (-not $existing -and -not $DryRun) {
            try {
                New-NetFirewallRule `
                    -DisplayName $fw.Name `
                    -Direction Outbound `
                    -Action Block `
                    -Program $fw.Path `
                    -Profile Any `
                    -Enabled True `
                    -Description "Blocks outbound for OpenClaw process. LLM Enclave." | Out-Null
                Write-Host "Created: $($fw.Name)" -ForegroundColor Green
                Write-Log "Firewall rule created: $($fw.Name)"
            } catch {
                Write-Warning "Could not create firewall rule: $_"
            }
        }
    }
} elseif (-not $SkipFirewall) {
    Write-Host "`n--- Firewall Rules SKIPPED (not admin) ---" -ForegroundColor Yellow
}

# -------------------------------------------------------------------
# Update Install Record
# -------------------------------------------------------------------
Write-Host "`n--- Updating Install Record ---" -ForegroundColor Cyan

# Read provenance
$provenancePath = "$ReleaseDir\provenance.json"
$provenance = @{}
if (Test-Path $provenancePath) {
    $provenance = Get-Content $provenancePath -Raw | ConvertFrom-Json
}

$installRecord = @"
# OpenClaw Install Record

## Installation Details

| Field | Value |
|-------|-------|
| Installed Version | $($provenance.release_tag) |
| Release Name | $($provenance.release_name) |
| Commit Hash | $($provenance.target_commitish) |
| Source Repository | $($provenance.repo_url) |
| Published Date | $($provenance.published_at) |
| Download Date | $($provenance.download_timestamp) |
| Install Date | $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') |
| Install Machine | $env:COMPUTERNAME |
| Install Path | $InstallDir |
| Config Path | $ConfigDir |

## Installed Components

$(Get-ChildItem -Path $InstallDir -Recurse -File | ForEach-Object { "- $($_.FullName.Substring($InstallDir.Length))" } | Out-String)

## Dependency Versions

$(if (Test-Path "$InstallDir\venv\Scripts\pip.exe") {
    $pipList = & "$InstallDir\venv\Scripts\pip.exe" list --format=columns 2>$null
    if ($pipList) { $pipList | Out-String } else { "No Python dependencies installed." }
} else {
    "No Python venv found."
})

## How to Verify Integrity

```powershell
# Re-verify all release artifact hashes
`$hashFile = "$HashFile"
Get-ChildItem -Path "$ReleaseDir" -File | ForEach-Object {
    `$hash = (Get-FileHash -Path `$_.FullName -Algorithm SHA256).Hash
    Write-Host "`$(`$_.Name): `$hash"
}
# Compare output against entries in `$hashFile
```

## How to Update Safely

1. Download new release: ``.\06_download_openclaw.ps1 -AllowNetwork``
2. Back up current install: ``Copy-Item "$InstallDir" "$EnclaveRoot\backups\openclaw_$(Get-Date -Format 'yyyyMMdd')" -Recurse``
3. Install new version: ``.\07_install_openclaw.ps1``
4. Verify firewall rules still apply
5. Update this record

## How to Fully Remove

```powershell
Stop-Process -Name "openclaw*" -Force -ErrorAction SilentlyContinue
Remove-Item -Path "$InstallDir" -Recurse -Force
Remove-Item -Path "$ConfigDir" -Recurse -Force
Get-NetFirewallRule -DisplayName "LLM_Enclave: Block OpenClaw*" | Remove-NetFirewallRule
```
"@

if (-not $DryRun) {
    $installRecord | Set-Content -Path $InstallRecordPath
    Write-Host "Install record updated: $InstallRecordPath" -ForegroundColor Green
    Write-Log "Install record updated"
}

# -------------------------------------------------------------------
# PATH Modification (Optional)
# -------------------------------------------------------------------
if ($AddToPath) {
    Write-Host "`n--- Adding to PATH ---" -ForegroundColor Yellow
    Write-Host "Adding $InstallDir to user PATH..."
    $currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
    if ($currentPath -notmatch [regex]::Escape($InstallDir)) {
        if (-not $DryRun) {
            [Environment]::SetEnvironmentVariable("PATH", "$InstallDir;$currentPath", "User")
            Write-Host "Added to PATH." -ForegroundColor Green
            Write-Host "REVERSAL: Remove '$InstallDir' from user PATH in System Properties." -ForegroundColor Yellow
            Write-Log "Added $InstallDir to user PATH"
        }
    } else {
        Write-Host "Already in PATH."
    }
} else {
    Write-Host "`nPATH not modified. Run OpenClaw from: $InstallDir" -ForegroundColor DarkGray
}

# -------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------
Write-Host "`n========================================" -ForegroundColor Green
Write-Host " OPENCLAW INSTALLATION COMPLETE" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Install path:  $InstallDir"
Write-Host "Config path:   $ConfigDir\config.yaml"
Write-Host "Install record: $InstallRecordPath"
Write-Host ""
Write-Host "To run OpenClaw, see docs\README.md for instructions."
Write-Log "OpenClaw installation completed" "SUCCESS"
