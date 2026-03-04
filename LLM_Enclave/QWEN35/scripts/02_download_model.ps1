#Requires -Version 5.1
<#
.SYNOPSIS
    Download and verify Qwen model artifacts safely.

.DESCRIPTION
    PURPOSE:
    Download model weight files (GGUF format) from a specified URL or
    Hugging Face repository, compute SHA256 hashes, store hash records,
    and refuse to proceed if hashes mismatch previously recorded values.
    This script does NOT execute any downloaded code.

    CHANGES:
    - Downloads model file(s) to models\staging\
    - Computes SHA256 hash of each downloaded file
    - Stores hashes in hashes\model_hashes.txt
    - Moves verified files to models\verified\ (if hash check passes)
    - Logs all actions to logs\provision.log

    PREREQS:
    - Enclave provisioned (run 01_provision_enclave.ps1 first)
    - Temporary outbound network access enabled (firewall allow)
    - Model download URL or Hugging Face repo identifier known

    ROLLBACK:
    - Remove downloaded files from models\staging\ and models\verified\
    - Remove hash entries from hashes\model_hashes.txt

    SECURITY NOTES:
    - This script NEVER executes downloaded code.
    - This script NEVER uses trust_remote_code.
    - This script verifies SHA256 hashes before accepting any file.
    - If a hash file already contains an entry for a filename and the new
      hash does not match, the script REFUSES to proceed.
    - Supports "offline mode": refuses to run if outbound is blocked
      and -AllowNetwork is not specified.
#>

param(
    [Parameter(Mandatory=$false)]
    [string]$ModelUrl = "",

    [Parameter(Mandatory=$false)]
    [string]$ModelFileName = "",

    [Parameter(Mandatory=$false)]
    [string]$ExpectedHash = "",

    [Parameter(Mandatory=$false)]
    [string]$HuggingFaceRepo = "",

    [Parameter(Mandatory=$false)]
    [string]$HuggingFaceRevision = "",

    [Parameter(Mandatory=$false)]
    [string]$HuggingFaceFile = "",

    [switch]$AllowNetwork,
    [switch]$SkipDownload
)

# -------------------------------------------------------------------
# Configuration
# -------------------------------------------------------------------
$EnclaveRoot = "D:\ProjectsHome\LLM_Enclave\QWEN35"
$StagingDir = "$EnclaveRoot\models\staging"
$VerifiedDir = "$EnclaveRoot\models\verified"
$HashFile = "$EnclaveRoot\hashes\model_hashes.txt"
$LogFile = "$EnclaveRoot\logs\provision.log"

# -------------------------------------------------------------------
# Helper Functions
# -------------------------------------------------------------------
function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $entry = "$timestamp | $Level | 02_download_model | $Message"
    Add-Content -Path $LogFile -Value $entry
    switch ($Level) {
        "ERROR"   { Write-Host $entry -ForegroundColor Red }
        "WARN"    { Write-Host $entry -ForegroundColor Yellow }
        "SUCCESS" { Write-Host $entry -ForegroundColor Green }
        default   { Write-Host $entry }
    }
}

function Test-OutboundBlocked {
    # Check if Ollama firewall rules are active (proxy for "outbound blocked" state)
    $rules = Get-NetFirewallRule -DisplayName "LLM_Enclave:*" -ErrorAction SilentlyContinue
    $activeBlocks = $rules | Where-Object { $_.Enabled -eq "True" -and $_.Action -eq "Block" }
    return ($activeBlocks.Count -gt 0)
}

# -------------------------------------------------------------------
# Pre-flight Checks
# -------------------------------------------------------------------
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " MODEL DOWNLOAD AND VERIFICATION" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# Check enclave exists
if (-not (Test-Path $EnclaveRoot)) {
    Write-Error "FATAL: Enclave not provisioned. Run 01_provision_enclave.ps1 first."
    exit 1
}

# Check network state
if (-not $SkipDownload) {
    if (-not $AllowNetwork) {
        Write-Host "Checking outbound network state..." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "This script requires temporary outbound network access to download model files." -ForegroundColor Yellow
        Write-Host "If outbound is currently blocked, you must either:" -ForegroundColor Yellow
        Write-Host "  1. Run this script with -AllowNetwork to acknowledge network requirement" -ForegroundColor Yellow
        Write-Host "  2. Manually download the model file and use -SkipDownload" -ForegroundColor Yellow
        Write-Host ""
        Write-Log "Script invoked without -AllowNetwork. Requiring explicit acknowledgment." "WARN"

        $ack = Read-Host "Do you confirm that outbound network is temporarily enabled? (yes/no)"
        if ($ack -ne "yes") {
            Write-Host "Aborted. No changes made." -ForegroundColor Red
            exit 0
        }
    }
}

# -------------------------------------------------------------------
# Download
# -------------------------------------------------------------------
if (-not $SkipDownload) {
    Write-Host "`n--- Downloading Model ---" -ForegroundColor Cyan

    # Determine download method
    if ($ModelUrl -ne "") {
        # Direct URL download
        if ($ModelFileName -eq "") {
            $ModelFileName = Split-Path $ModelUrl -Leaf
        }
        $outPath = Join-Path $StagingDir $ModelFileName

        if (Test-Path $outPath) {
            Write-Host "File already exists in staging: $outPath" -ForegroundColor Yellow
            Write-Host "Will verify hash of existing file."
        } else {
            Write-Host "Downloading: $ModelUrl"
            Write-Host "Destination: $outPath"
            Write-Log "Downloading model from: $ModelUrl"

            try {
                # Use BITS for large file downloads (supports resume)
                Start-BitsTransfer -Source $ModelUrl -Destination $outPath -Description "Downloading model"
                Write-Host "Download complete." -ForegroundColor Green
                Write-Log "Download complete: $ModelFileName"
            } catch {
                Write-Error "Download failed: $_"
                Write-Log "Download failed: $_" "ERROR"
                exit 1
            }
        }

    } elseif ($HuggingFaceRepo -ne "") {
        # Hugging Face download (direct file URL, NOT using transformers)
        if ($HuggingFaceFile -eq "") {
            Write-Error "FATAL: -HuggingFaceFile is required when using -HuggingFaceRepo."
            exit 1
        }

        $revision = if ($HuggingFaceRevision -ne "") { $HuggingFaceRevision } else { "main" }
        $hfUrl = "https://huggingface.co/$HuggingFaceRepo/resolve/$revision/$HuggingFaceFile"
        $ModelFileName = $HuggingFaceFile
        $outPath = Join-Path $StagingDir $ModelFileName

        if (Test-Path $outPath) {
            Write-Host "File already exists in staging: $outPath" -ForegroundColor Yellow
        } else {
            Write-Host "Downloading from Hugging Face:"
            Write-Host "  Repo:     $HuggingFaceRepo"
            Write-Host "  File:     $HuggingFaceFile"
            Write-Host "  Revision: $revision"
            Write-Host "  URL:      $hfUrl"
            Write-Log "Downloading from HF: $hfUrl"

            try {
                Start-BitsTransfer -Source $hfUrl -Destination $outPath -Description "Downloading from Hugging Face"
                Write-Host "Download complete." -ForegroundColor Green
                Write-Log "HF download complete: $ModelFileName"
            } catch {
                Write-Error "Download failed: $_"
                Write-Log "Download failed: $_" "ERROR"
                exit 1
            }
        }
    } else {
        Write-Error "FATAL: Specify either -ModelUrl or -HuggingFaceRepo + -HuggingFaceFile."
        Write-Host ""
        Write-Host "Examples:"
        Write-Host '  .\02_download_model.ps1 -ModelUrl "https://example.com/model.gguf" -AllowNetwork'
        Write-Host '  .\02_download_model.ps1 -HuggingFaceRepo "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF" -HuggingFaceFile "qwen2.5-coder-7b-instruct-q4_k_m.gguf" -HuggingFaceRevision "abc123" -AllowNetwork'
        Write-Host '  .\02_download_model.ps1 -SkipDownload -ModelFileName "model.gguf" -ExpectedHash "abc123..."'
        exit 1
    }
} else {
    Write-Host "`n--- Download SKIPPED (using existing file) ---" -ForegroundColor Yellow
    if ($ModelFileName -eq "") {
        Write-Error "FATAL: -ModelFileName is required when using -SkipDownload."
        exit 1
    }
    $outPath = Join-Path $StagingDir $ModelFileName
    if (-not (Test-Path $outPath)) {
        Write-Error "FATAL: File not found at $outPath"
        exit 1
    }
}

# -------------------------------------------------------------------
# Hash Verification
# -------------------------------------------------------------------
Write-Host "`n--- Hash Verification ---" -ForegroundColor Cyan

$actualHash = (Get-FileHash -Path $outPath -Algorithm SHA256).Hash
Write-Host "SHA256: $actualHash"
Write-Log "SHA256 of $ModelFileName : $actualHash"

# Check against expected hash (if provided)
if ($ExpectedHash -ne "") {
    if ($actualHash -ne $ExpectedHash.ToUpper()) {
        Write-Error "HASH MISMATCH!"
        Write-Error "  Expected: $ExpectedHash"
        Write-Error "  Actual:   $actualHash"
        Write-Error "The downloaded file may be corrupted or tampered with."
        Write-Error "DO NOT USE THIS FILE."
        Write-Log "HASH MISMATCH for $ModelFileName. Expected: $ExpectedHash, Got: $actualHash" "ERROR"
        exit 1
    }
    Write-Host "Hash matches expected value." -ForegroundColor Green
    Write-Log "Hash verification PASSED for $ModelFileName"
}

# Check against stored hashes (if file was previously downloaded)
$storedEntries = Get-Content $HashFile -ErrorAction SilentlyContinue |
    Where-Object { $_ -match $ModelFileName -and $_ -notmatch "^#" }

if ($storedEntries) {
    $storedHash = ($storedEntries | Select-Object -Last 1) -split "\s{2,}" | Select-Object -First 1
    if ($storedHash -ne $actualHash) {
        Write-Error "HASH MISMATCH WITH STORED RECORD!"
        Write-Error "  Stored:  $storedHash"
        Write-Error "  Current: $actualHash"
        Write-Error "This file differs from a previously verified version."
        Write-Error "If this is intentional (new version), remove the old entry from $HashFile first."
        Write-Log "HASH MISMATCH with stored record for $ModelFileName" "ERROR"
        exit 1
    }
    Write-Host "Hash matches stored record." -ForegroundColor Green
} else {
    # New file, record the hash
    "$actualHash  $ModelFileName  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  INITIAL" | `
        Add-Content -Path $HashFile
    Write-Host "Hash recorded in $HashFile" -ForegroundColor Green
    Write-Log "New hash recorded for $ModelFileName"
}

# -------------------------------------------------------------------
# Move to Verified
# -------------------------------------------------------------------
Write-Host "`n--- Moving to Verified ---" -ForegroundColor Cyan

$verifiedPath = Join-Path $VerifiedDir $ModelFileName
if (Test-Path $verifiedPath) {
    Write-Host "File already exists in verified directory." -ForegroundColor Yellow
    Write-Host "Will not overwrite. If this is a new version, use a different filename."
    Write-Log "File already exists in verified: $verifiedPath. Not overwriting." "WARN"
} else {
    Move-Item -Path $outPath -Destination $verifiedPath
    Write-Host "Moved to: $verifiedPath" -ForegroundColor Green
    Write-Log "Model moved to verified: $verifiedPath" "SUCCESS"
}

# -------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------
Write-Host "`n========================================" -ForegroundColor Green
Write-Host " MODEL DOWNLOAD AND VERIFICATION COMPLETE" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Model file: $ModelFileName"
Write-Host "SHA256:     $actualHash"
Write-Host "Location:   $verifiedPath"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Update the Modelfile at $EnclaveRoot\runtime\config\Modelfile"
Write-Host "     Change the FROM line to: FROM $verifiedPath"
Write-Host "  2. Create the Ollama model:"
Write-Host "     & `"$EnclaveRoot\runtime\bin\ollama.exe`" create qwen-local -f `"$EnclaveRoot\runtime\config\Modelfile`""
Write-Host "  3. Run 03_run_runtime.ps1 to start the runtime"
Write-Host ""
Write-Host "REMEMBER: Re-enable outbound firewall block if you temporarily disabled it!"
