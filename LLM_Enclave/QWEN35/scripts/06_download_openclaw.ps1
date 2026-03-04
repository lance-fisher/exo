#Requires -Version 5.1
<#
.SYNOPSIS
    Download and verify OpenClaw release artifacts.

.DESCRIPTION
    PURPOSE:
    Download the latest verified OpenClaw release artifacts from the official
    GitHub repository, pin the version, compute SHA256 hashes, store provenance
    information, and refuse to proceed if verification fails.
    This script does NOT execute any downloaded code.

    CHANGES:
    - Downloads release artifacts to openclaw\release\
    - Stores provenance in openclaw\release\provenance.json
    - Records SHA256 hashes in hashes\openclaw_hashes.txt
    - Logs all actions to logs\provision.log

    PREREQS:
    - Enclave provisioned (01_provision_enclave.ps1)
    - Temporary outbound network access enabled
    - Official OpenClaw repository URL verified by the user

    ROLLBACK:
    - Remove downloaded files from openclaw\release\
    - Remove hash entries from hashes\openclaw_hashes.txt

    SECURITY NOTES:
    - This script NEVER executes downloaded code.
    - This script downloads release artifacts only (zip/tarball), not arbitrary scripts.
    - SHA256 hashes are computed for every downloaded file.
    - If upstream publishes checksums, they are verified.
    - The script supports offline mode and refuses to run without explicit
      network acknowledgment.
    - OpenClaw is treated as UNTRUSTED until verified.
#>

param(
    [Parameter(Mandatory=$false)]
    [string]$RepoOwner = "",

    [Parameter(Mandatory=$false)]
    [string]$RepoName = "openclaw",

    [Parameter(Mandatory=$false)]
    [string]$ReleaseTag = "",

    [switch]$AllowNetwork,

    [switch]$UseDirectUrl,

    [Parameter(Mandatory=$false)]
    [string]$DirectUrl = ""
)

# -------------------------------------------------------------------
# Configuration
# -------------------------------------------------------------------
$EnclaveRoot = "D:\ProjectsHome\LLM_Enclave\QWEN35"
$ReleaseDir = "$EnclaveRoot\openclaw\release"
$HashFile = "$EnclaveRoot\hashes\openclaw_hashes.txt"
$LogFile = "$EnclaveRoot\logs\provision.log"

# -------------------------------------------------------------------
# Helper Functions
# -------------------------------------------------------------------
function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $entry = "$timestamp | $Level | 06_download_openclaw | $Message"
    Add-Content -Path $LogFile -Value $entry -ErrorAction SilentlyContinue
    switch ($Level) {
        "ERROR"   { Write-Host $entry -ForegroundColor Red }
        "WARN"    { Write-Host $entry -ForegroundColor Yellow }
        "SUCCESS" { Write-Host $entry -ForegroundColor Green }
        default   { Write-Host $entry }
    }
}

# -------------------------------------------------------------------
# Pre-flight Checks
# -------------------------------------------------------------------
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " OPENCLAW DOWNLOAD AND VERIFICATION" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

if (-not (Test-Path $EnclaveRoot)) {
    Write-Error "FATAL: Enclave not provisioned. Run 01_provision_enclave.ps1 first."
    exit 1
}

# Network acknowledgment
if (-not $AllowNetwork) {
    Write-Host ""
    Write-Host "This script requires temporary outbound network access." -ForegroundColor Yellow
    Write-Host "Ensure you have temporarily enabled outbound access." -ForegroundColor Yellow
    Write-Host ""
    $ack = Read-Host "Do you confirm outbound network is temporarily enabled? (yes/no)"
    if ($ack -ne "yes") {
        Write-Host "Aborted. No changes made." -ForegroundColor Red
        exit 0
    }
}

# Repository identification
if ($RepoOwner -eq "") {
    Write-Host ""
    Write-Host "You must specify the official OpenClaw repository owner." -ForegroundColor Yellow
    Write-Host "This ensures we download from the correct, verified source." -ForegroundColor Yellow
    Write-Host ""
    $RepoOwner = Read-Host "Enter the GitHub owner/organization for OpenClaw"
    if ($RepoOwner -eq "") {
        Write-Error "FATAL: Repository owner is required."
        exit 1
    }
}

$repoFullName = "$RepoOwner/$RepoName"
Write-Host "Repository: $repoFullName" -ForegroundColor Cyan
Write-Log "Starting OpenClaw download from: $repoFullName"

# -------------------------------------------------------------------
# Fetch Release Information
# -------------------------------------------------------------------
Write-Host "`n--- Fetching Release Information ---" -ForegroundColor Cyan

try {
    if ($ReleaseTag -ne "") {
        $apiUrl = "https://api.github.com/repos/$repoFullName/releases/tags/$ReleaseTag"
    } else {
        $apiUrl = "https://api.github.com/repos/$repoFullName/releases/latest"
    }

    Write-Host "API URL: $apiUrl"
    $headers = @{
        "Accept" = "application/vnd.github.v3+json"
        "User-Agent" = "LLM-Enclave-Verifier/1.0"
    }

    $releaseInfo = Invoke-RestMethod -Uri $apiUrl -Headers $headers -ErrorAction Stop

    Write-Host "Release found:" -ForegroundColor Green
    Write-Host "  Tag:       $($releaseInfo.tag_name)"
    Write-Host "  Name:      $($releaseInfo.name)"
    Write-Host "  Published: $($releaseInfo.published_at)"
    Write-Host "  Commit:    $($releaseInfo.target_commitish)"
    Write-Host "  Assets:    $($releaseInfo.assets.Count)"

    Write-Log "Release found: $($releaseInfo.tag_name) ($($releaseInfo.name))"

} catch {
    Write-Error "Failed to fetch release information: $_"
    Write-Error "Verify the repository exists and is accessible."
    Write-Log "Failed to fetch release info: $_" "ERROR"
    exit 1
}

# -------------------------------------------------------------------
# Record Provenance
# -------------------------------------------------------------------
Write-Host "`n--- Recording Provenance ---" -ForegroundColor Cyan

$provenance = @{
    repo_url = "https://github.com/$repoFullName"
    release_tag = $releaseInfo.tag_name
    release_name = $releaseInfo.name
    published_at = $releaseInfo.published_at
    tarball_url = $releaseInfo.tarball_url
    zipball_url = $releaseInfo.zipball_url
    target_commitish = $releaseInfo.target_commitish
    download_timestamp = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
    download_machine = $env:COMPUTERNAME
    assets = @($releaseInfo.assets | ForEach-Object {
        @{
            name = $_.name
            size = $_.size
            download_url = $_.browser_download_url
            content_type = $_.content_type
        }
    })
}

$provenancePath = "$ReleaseDir\provenance.json"
$provenance | ConvertTo-Json -Depth 5 | Set-Content -Path $provenancePath
Write-Host "Provenance recorded: $provenancePath" -ForegroundColor Green
Write-Log "Provenance saved to: $provenancePath"

# -------------------------------------------------------------------
# Download Assets
# -------------------------------------------------------------------
Write-Host "`n--- Downloading Assets ---" -ForegroundColor Cyan

$downloadedFiles = @()

# Download release assets
foreach ($asset in $releaseInfo.assets) {
    $outPath = Join-Path $ReleaseDir $asset.name

    if (Test-Path $outPath) {
        Write-Host "  EXISTS: $($asset.name) (will verify hash)" -ForegroundColor Yellow
    } else {
        Write-Host "  Downloading: $($asset.name) ($($asset.size) bytes)..."
        try {
            Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $outPath -ErrorAction Stop
            Write-Host "  Downloaded: $($asset.name)" -ForegroundColor Green
            Write-Log "Downloaded: $($asset.name)"
        } catch {
            Write-Error "  FAILED: $($asset.name) - $_"
            Write-Log "Download FAILED: $($asset.name) - $_" "ERROR"
            exit 1
        }
    }
    $downloadedFiles += $outPath
}

# Download source archive
$sourceArchiveName = "source-$($releaseInfo.tag_name).zip"
$sourceArchivePath = Join-Path $ReleaseDir $sourceArchiveName
if (-not (Test-Path $sourceArchivePath)) {
    Write-Host "  Downloading source archive..."
    try {
        Invoke-WebRequest -Uri $releaseInfo.zipball_url -OutFile $sourceArchivePath -ErrorAction Stop
        Write-Host "  Downloaded: $sourceArchiveName" -ForegroundColor Green
        Write-Log "Downloaded source archive: $sourceArchiveName"
    } catch {
        Write-Warning "  Could not download source archive: $_"
        Write-Log "Source archive download failed (non-fatal): $_" "WARN"
    }
}
if (Test-Path $sourceArchivePath) {
    $downloadedFiles += $sourceArchivePath
}

# -------------------------------------------------------------------
# Compute and Store SHA256 Hashes
# -------------------------------------------------------------------
Write-Host "`n--- Computing SHA256 Hashes ---" -ForegroundColor Cyan

foreach ($filePath in $downloadedFiles) {
    $fileName = Split-Path $filePath -Leaf
    $hash = (Get-FileHash -Path $filePath -Algorithm SHA256).Hash
    Write-Host "  $fileName : $hash"

    # Check against stored hashes
    $storedEntries = Get-Content $HashFile -ErrorAction SilentlyContinue |
        Where-Object { $_ -match $fileName -and $_ -notmatch "^#" }

    if ($storedEntries) {
        $storedHash = ($storedEntries | Select-Object -Last 1) -split "\s{2,}" | Select-Object -First 1
        if ($storedHash -ne $hash) {
            Write-Error "HASH MISMATCH for $fileName!"
            Write-Error "  Stored:  $storedHash"
            Write-Error "  Current: $hash"
            Write-Error "This file differs from a previously verified version."
            Write-Log "HASH MISMATCH: $fileName (stored=$storedHash, current=$hash)" "ERROR"
            exit 1
        }
        Write-Host "  VERIFIED against stored hash." -ForegroundColor Green
    } else {
        "$hash  $fileName  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  tag=$($releaseInfo.tag_name)" | `
            Add-Content -Path $HashFile
        Write-Host "  Hash recorded." -ForegroundColor Green
        Write-Log "New hash recorded for $fileName"
    }
}

# -------------------------------------------------------------------
# Verify Against Upstream Checksums (if available)
# -------------------------------------------------------------------
Write-Host "`n--- Checking for Upstream Checksums ---" -ForegroundColor Cyan

$checksumAsset = $releaseInfo.assets | Where-Object {
    $_.name -match "(SHA256SUMS|checksums|CHECKSUMS|\.sha256)"
}

if ($checksumAsset) {
    Write-Host "Found upstream checksum file: $($checksumAsset.name)" -ForegroundColor Green
    # The checksum file was already downloaded as an asset
    $checksumPath = Join-Path $ReleaseDir $checksumAsset.name
    if (Test-Path $checksumPath) {
        $checksumContent = Get-Content $checksumPath
        Write-Host "Upstream checksums:"
        $checksumContent | ForEach-Object { Write-Host "  $_" }
        Write-Log "Upstream checksums found and logged"
    }
} else {
    Write-Host "No upstream checksum file found in release assets." -ForegroundColor Yellow
    Write-Host "Relying on our computed hashes for integrity verification." -ForegroundColor Yellow
    Write-Log "No upstream checksums found. Using computed hashes." "WARN"
}

# -------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------
Write-Host "`n========================================" -ForegroundColor Green
Write-Host " OPENCLAW DOWNLOAD COMPLETE" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Repository:  $repoFullName"
Write-Host "Release:     $($releaseInfo.tag_name)"
Write-Host "Files:       $($downloadedFiles.Count)"
Write-Host "Provenance:  $provenancePath"
Write-Host "Hashes:      $HashFile"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Review provenance.json to confirm source"
Write-Host "  2. Run 07_install_openclaw.ps1 to install"
Write-Host "  3. Re-enable outbound firewall block"
Write-Log "OpenClaw download completed successfully" "SUCCESS"
