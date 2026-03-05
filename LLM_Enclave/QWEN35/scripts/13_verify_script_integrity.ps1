#Requires -Version 5.1
<#
.SYNOPSIS
    Verify integrity of all enclave scripts via SHA256 hashing.

.DESCRIPTION
    Computes SHA256 hashes of all .ps1 and .py files in the enclave.
    In baseline mode (default), stores hashes to runtime/config/script_hashes.json.
    In verify mode (-Verify), compares current hashes against stored baseline.

.PARAMETER Verify
    Compare current hashes against stored baseline. Exit code 0 = pass, 1 = fail.

.PARAMETER Quiet
    Suppress detailed output (for use in preflight checks).
#>

param(
    [string]$EnclaveRoot = (Split-Path -Parent (Split-Path -Parent $PSCommandPath)),
    [switch]$Verify,
    [switch]$Quiet
)

$HashFile = "$EnclaveRoot\runtime\config\script_hashes.json"

function Get-ScriptHashes {
    param([string]$Root)
    $hashes = @{}

    # Hash all .ps1 files in root
    Get-ChildItem -Path $Root -Filter "*.ps1" -File -ErrorAction SilentlyContinue | ForEach-Object {
        $rel = $_.Name
        $hashes[$rel] = (Get-FileHash -Path $_.FullName -Algorithm SHA256).Hash
    }

    # Hash all .ps1 files in scripts/
    $scriptsDir = Join-Path $Root "scripts"
    if (Test-Path $scriptsDir) {
        Get-ChildItem -Path $scriptsDir -Filter "*.ps1" -File -ErrorAction SilentlyContinue | ForEach-Object {
            $rel = "scripts\$($_.Name)"
            $hashes[$rel] = (Get-FileHash -Path $_.FullName -Algorithm SHA256).Hash
        }
    }

    # Hash all .py files in cli/
    $cliDir = Join-Path $Root "cli"
    if (Test-Path $cliDir) {
        Get-ChildItem -Path $cliDir -Filter "*.py" -File -ErrorAction SilentlyContinue | ForEach-Object {
            $rel = "cli\$($_.Name)"
            $hashes[$rel] = (Get-FileHash -Path $_.FullName -Algorithm SHA256).Hash
        }
    }

    return $hashes
}

if ($Verify) {
    # Verify mode: compare against stored baseline
    if (-not (Test-Path $HashFile)) {
        if (-not $Quiet) { Write-Host "No baseline hash file found. Run without -Verify to create one." -ForegroundColor Yellow }
        Write-Output "NO_BASELINE"
        exit 1
    }

    $stored = Get-Content $HashFile -Raw | ConvertFrom-Json
    $current = Get-ScriptHashes -Root $EnclaveRoot
    $failures = @()

    foreach ($file in $current.Keys) {
        $storedHash = $stored.$file
        if (-not $storedHash) {
            $failures += "NEW: $file (not in baseline)"
        } elseif ($storedHash -ne $current[$file]) {
            $failures += "MODIFIED: $file"
        }
    }

    # Check for deleted files
    $stored.PSObject.Properties | ForEach-Object {
        if (-not $current.ContainsKey($_.Name)) {
            $failures += "DELETED: $($_.Name)"
        }
    }

    if ($failures.Count -eq 0) {
        if (-not $Quiet) { Write-Host "All script hashes match baseline." -ForegroundColor Green }
        exit 0
    } else {
        if (-not $Quiet) {
            Write-Host "Script integrity check FAILED:" -ForegroundColor Red
            foreach ($f in $failures) {
                Write-Host "  $f" -ForegroundColor Red
            }
        } else {
            Write-Output ($failures -join "; ")
        }
        exit 1
    }
} else {
    # Baseline mode: compute and store hashes
    $hashes = Get-ScriptHashes -Root $EnclaveRoot

    # Ensure directory exists
    $configDir = Split-Path $HashFile -Parent
    if (-not (Test-Path $configDir)) {
        New-Item -ItemType Directory -Path $configDir -Force | Out-Null
    }

    $hashes | ConvertTo-Json -Depth 3 | Set-Content -Path $HashFile -Encoding UTF8
    Write-Host "Script integrity baseline established ($($hashes.Count) files):" -ForegroundColor Green
    foreach ($file in ($hashes.Keys | Sort-Object)) {
        Write-Host "  $file" -ForegroundColor DarkGray
    }
    Write-Host "Hashes saved to: $HashFile" -ForegroundColor Green
}
