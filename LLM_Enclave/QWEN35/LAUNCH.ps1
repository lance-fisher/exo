<#
.SYNOPSIS
    Launch your offline AI coding assistant.
    Double-click the desktop shortcut or run this script directly.

.DESCRIPTION
    Starts Ollama + OpenClaw and opens the chat UI in your browser.
    Everything runs locally - no internet needed after setup.

.NOTES
    Run SETUP.ps1 first if you haven't already.
#>

param(
    [string]$EnclaveRoot = (Split-Path -Parent $PSCommandPath),
    [switch]$NoBrowser,
    [switch]$SkipSecurityChecks,
    [switch]$Verbose
)

# --- Helpers ------------------------------------------------------------------

function Write-Status { param($msg) Write-Host "  $msg" -ForegroundColor Cyan }
function Write-Ok     { param($msg) Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Fail   { param($msg) Write-Host "  [FAIL] $msg" -ForegroundColor Red }
function Test-Command { param($cmd) $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue) }

function Test-PortOpen {
    param([int]$Port)
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect("127.0.0.1", $Port)
        $tcp.Close()
        return $true
    } catch {
        return $false
    }
}

function Wait-ForPort {
    param([int]$Port, [string]$Label, [int]$TimeoutSeconds = 30)
    $elapsed = 0
    while (-not (Test-PortOpen -Port $Port)) {
        if ($elapsed -ge $TimeoutSeconds) {
            Write-Fail "$Label failed to start within ${TimeoutSeconds}s"
            return $false
        }
        Start-Sleep -Seconds 1
        $elapsed++
    }
    return $true
}

function Invoke-SecurityPreflight {
    <#
    .SYNOPSIS
        Fail-closed security checks before starting any services.
        Returns $true if all checks pass, $false otherwise.
    #>
    $passed = $true

    Write-Host "  --- Security Preflight ---" -ForegroundColor Cyan

    # Check 1: Firewall rules active (check both naming conventions)
    Write-Host "  [CHECK 1] Firewall outbound block..." -NoNewline
    $fwFound = $false
    foreach ($name in @("Block Ollama Outbound", "LLM_Enclave: Block Ollama Outbound")) {
        $rule = Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue
        if ($rule -and $rule.Enabled -eq "True" -and $rule.Action -eq "Block") {
            $fwFound = $true
            break
        }
    }
    if ($fwFound) {
        Write-Host " PASS" -ForegroundColor Green
    } else {
        Write-Host " FAIL" -ForegroundColor Red
        Write-Host "    Ollama outbound firewall block is not active." -ForegroundColor Yellow
        Write-Host "    Run SETUP.ps1 as Administrator to create firewall rules." -ForegroundColor Yellow
        $passed = $false
    }

    # Check 2: OLLAMA_HOST is localhost-only
    Write-Host "  [CHECK 2] Ollama bound to localhost..." -NoNewline
    $hostVal = $env:OLLAMA_HOST
    if (-not $hostVal) { $hostVal = "127.0.0.1:11434" }
    if ($hostVal -match "127\.0\.0\.1" -or $hostVal -match "localhost") {
        Write-Host " PASS" -ForegroundColor Green
    } else {
        Write-Host " FAIL (bound to $hostVal)" -ForegroundColor Red
        $passed = $false
    }

    # Check 3: Bridge directories exist
    Write-Host "  [CHECK 3] Bridge directories..." -NoNewline
    $bridgeOk = $true
    foreach ($sub in @("inbox", "outbox", "scratch")) {
        if (-not (Test-Path "$EnclaveRoot\workspace_bridge\$sub")) {
            $bridgeOk = $false
        }
    }
    if ($bridgeOk) {
        Write-Host " PASS" -ForegroundColor Green
    } else {
        Write-Host " FAIL" -ForegroundColor Red
        Write-Host "    Bridge directories missing. Run SETUP.ps1 first." -ForegroundColor Yellow
        $passed = $false
    }

    # Check 4: Script integrity (if hashes exist)
    Write-Host "  [CHECK 4] Script integrity..." -NoNewline
    $hashFile = "$EnclaveRoot\runtime\config\script_hashes.json"
    if (Test-Path $hashFile) {
        $verifyScript = "$EnclaveRoot\scripts\13_verify_script_integrity.ps1"
        if (Test-Path $verifyScript) {
            $result = & $verifyScript -EnclaveRoot $EnclaveRoot -Verify -Quiet 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-Host " PASS" -ForegroundColor Green
            } else {
                Write-Host " FAIL" -ForegroundColor Red
                Write-Host "    Script files have been modified since last setup." -ForegroundColor Yellow
                Write-Host "    $result" -ForegroundColor Yellow
                $passed = $false
            }
        } else {
            Write-Host " SKIP (verifier not found)" -ForegroundColor Yellow
        }
    } else {
        Write-Host " SKIP (no baseline yet)" -ForegroundColor DarkGray
    }

    Write-Host ""
    return $passed
}

function Track-PolicyChanges {
    <# Track changes to policy files and log them to the changelog. #>
    $policiesDir = "$EnclaveRoot\policies"
    $hashFile = "$EnclaveRoot\runtime\config\policy_hashes.json"
    if (-not (Test-Path $policiesDir)) { return }

    $policyFiles = Get-ChildItem $policiesDir -Filter "*.yaml" -ErrorAction SilentlyContinue
    if (-not $policyFiles) { return }

    $storedHashes = @{}
    if (Test-Path $hashFile) {
        try { $storedHashes = Get-Content $hashFile -Raw | ConvertFrom-Json -ErrorAction Stop } catch {}
    }

    $currentHashes = @{}
    $changed = @()
    foreach ($f in $policyFiles) {
        $hash = (Get-FileHash $f.FullName -Algorithm SHA256).Hash
        $currentHashes[$f.Name] = $hash
        if ($storedHashes.PSObject.Properties.Name -contains $f.Name) {
            if ($storedHashes.$($f.Name) -ne $hash) {
                $changed += $f.Name
            }
        }
    }

    if ($changed.Count -gt 0) {
        $changelogPath = "$EnclaveRoot\docs\changelog.md"
        $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
        $entry = "`n## $timestamp - Policy Change`n- Changed: $($changed -join ', ')`n"
        if (Test-Path $changelogPath) {
            Add-Content -Path $changelogPath -Value $entry
        }
        Write-Status "Policy changes detected and logged: $($changed -join ', ')"
    }

    $currentHashes | ConvertTo-Json | Set-Content -Path $hashFile -Encoding UTF8
}

# --- Banner -------------------------------------------------------------------

Write-Host ""
Write-Host "  Local AI Coder" -ForegroundColor Green
Write-Host "  --------------" -ForegroundColor DarkGray
Write-Host "  Offline coding assistant - Everything stays on your machine" -ForegroundColor DarkGray
Write-Host ""

# --- Ensure directories exist ------------------------------------------------

foreach ($dir in @("$EnclaveRoot\logs\runtime", "$EnclaveRoot\runtime", "$EnclaveRoot\runtime\config")) {
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
}

try {

# --- Preflight checks --------------------------------------------------------

if (-not (Test-Command "ollama")) {
    Write-Fail "Ollama not found. Run SETUP.ps1 first."
    Read-Host "Press Enter to exit"
    return
}

# --- Security preflight ---------------------------------------------------

if ($SkipSecurityChecks) {
    Write-Host "  [WARN] Security checks SKIPPED by user override" -ForegroundColor Yellow
} else {
    $preflightOk = Invoke-SecurityPreflight
    if (-not $preflightOk) {
        Write-Fail "Security preflight FAILED. Ollama will NOT start."
        Write-Host "  Use -SkipSecurityChecks to override (NOT recommended)." -ForegroundColor Yellow
        Read-Host "Press Enter to exit"
        return
    }
}

# Track policy file changes
Track-PolicyChanges

# OpenClaw disabled — its npm binary is not a valid Win32 application on Windows.
# Using Python CLI (qwen_chat.py) instead.
$UsePythonCli = $true
Write-Status "Using Python CLI mode (qwen_chat.py)"

# Read saved model choice
$modelFile = "$EnclaveRoot\runtime\config\active_model.txt"
if (Test-Path $modelFile) {
    $model = (Get-Content $modelFile -Raw).Trim()
} else {
    $model = "qwen2.5-coder:7b"
    Write-Status "No saved model preference, defaulting to $model"
}

# --- Start Ollama -------------------------------------------------------------

if (Test-PortOpen -Port 11434) {
    Write-Ok "Ollama already running on :11434"
} else {
    Write-Status "Starting Ollama..."

    # Set environment for privacy
    $env:OLLAMA_HOST = "127.0.0.1:11434"
    $env:OLLAMA_NOPRUNE = "1"
    $env:OLLAMA_NUM_CTX = "32768"

    # Start Ollama in background
    $ollamaProc = Start-Process -FilePath "ollama" -ArgumentList "serve" `
        -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput "$EnclaveRoot\logs\runtime\ollama_stdout.log" `
        -RedirectStandardError "$EnclaveRoot\logs\runtime\ollama_stderr.log"

    # Save PID for clean shutdown
    $ollamaProc.Id | Out-File "$EnclaveRoot\runtime\ollama.pid" -Encoding UTF8 -NoNewline

    if (Wait-ForPort -Port 11434 -Label "Ollama" -TimeoutSeconds 30) {
        Write-Ok "Ollama started (PID: $($ollamaProc.Id))"
    } else {
        Read-Host "Press Enter to exit"
        return
    }
}

# Pre-load the model so first chat is fast
Write-Status "Pre-loading $model (first time may take a minute)..."
try {
    # Trigger model load by sending a tiny request
    $body = @{ model = $model; prompt = "hi"; stream = $false; options = @{ num_predict = 1 } } | ConvertTo-Json
    $null = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/generate" -Method POST -Body $body -ContentType "application/json" -TimeoutSec 120
    Write-Ok "Model $model loaded and ready"

    # Verify model digest integrity
    if (-not $SkipSecurityChecks) {
        try {
            $showBody = @{ name = $model } | ConvertTo-Json
            $modelInfo = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/show" -Method POST -Body $showBody -ContentType "application/json" -TimeoutSec 10
            $digest = $modelInfo.digest
            if ($digest) {
                $digestFile = "$EnclaveRoot\runtime\config\model_digests.json"
                if (Test-Path $digestFile) {
                    $storedDigests = Get-Content $digestFile -Raw | ConvertFrom-Json
                    $storedHash = $storedDigests.$model
                    if ($storedHash -and $storedHash -ne $digest) {
                        Write-Fail "MODEL INTEGRITY FAILURE: digest mismatch for $model"
                        Write-Host "    Expected: $storedHash" -ForegroundColor Red
                        Write-Host "    Got:      $digest" -ForegroundColor Red
                        Write-Host "    The model may have been tampered with." -ForegroundColor Red
                        Read-Host "Press Enter to exit"
                        return
                    }
                    Write-Ok "Model digest verified"
                } else {
                    # First run or new model: merge with existing digests
                    $existingDigests = @{}
                    if (Test-Path $digestFile) {
                        try { $existingDigests = Get-Content $digestFile -Raw | ConvertFrom-Json -AsHashtable } catch { $existingDigests = @{} }
                    }
                    $existingDigests[$model] = $digest
                    $existingDigests | ConvertTo-Json | Out-File $digestFile -Encoding UTF8
                    Write-Ok "Model digest baseline established for $model"
                    Write-Host "    Digest: $digest" -ForegroundColor DarkGray
                    Write-Host "    Verify against official Ollama model registry." -ForegroundColor DarkGray
                }
            }
        } catch {
            Write-Status "Model digest check skipped (API unavailable)"
        }
    }
} catch {
    Write-Status "Model pre-load timed out - it will load on first chat message"
}

# --- Start interface ----------------------------------------------------------

if ($UsePythonCli) {
    # Launch the Python CLI directly — no OpenClaw needed
    $cliPath = "$EnclaveRoot\cli\qwen_chat.py"
    if (-not (Test-Path $cliPath)) {
        Write-Fail "Python CLI not found at: $cliPath"
        Read-Host "Press Enter to exit"
        return
    }

    Write-Host ""
    Write-Host "===============================================================" -ForegroundColor Green
    Write-Host "  READY - Local AI Coder (Terminal Mode)" -ForegroundColor Green
    Write-Host "===============================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Model:   $model" -ForegroundColor White
    Write-Host "  Ollama:  http://127.0.0.1:11434" -ForegroundColor DarkGray
    Write-Host "  Mode:    Python CLI (qwen_chat.py)" -ForegroundColor White
    Write-Host ""
    Write-Host "  Type /help for commands, /quit to exit." -ForegroundColor DarkGray
    Write-Host ""

    if (-not (Test-Command "python")) {
        Write-Fail "Python not found in PATH. Please install Python 3.x."
        Read-Host "Press Enter to exit"
        return
    }

    $env:OLLAMA_MODEL = $model
    python $cliPath

} else {
    # OpenClaw path (if it ever becomes available on Windows)
    if (Test-PortOpen -Port 18789) {
        Write-Ok "OpenClaw already running on :18789"
    } else {
        Write-Status "Starting OpenClaw gateway..."
        $ocProc = Start-Process -FilePath "openclaw" -ArgumentList "gateway", "--headless" `
            -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput "$EnclaveRoot\logs\runtime\openclaw_stdout.log" `
            -RedirectStandardError "$EnclaveRoot\logs\runtime\openclaw_stderr.log"

        $ocProc.Id | Out-File "$EnclaveRoot\runtime\openclaw.pid" -Encoding UTF8 -NoNewline

        if (Wait-ForPort -Port 18789 -Label "OpenClaw" -TimeoutSeconds 30) {
            Write-Ok "OpenClaw started (PID: $($ocProc.Id))"
        } else {
            Read-Host "Press Enter to exit"
            return
        }
    }

    $chatUrl = "http://127.0.0.1:18789"
    if (-not $NoBrowser) {
        Start-Sleep -Seconds 1
        Start-Process $chatUrl
        Write-Ok "Browser opened -> $chatUrl"
    }

    Write-Host ""
    Write-Host "===============================================================" -ForegroundColor Green
    Write-Host "  READY - Chat with your AI at $chatUrl" -ForegroundColor Green
    Write-Host "===============================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Model:   $model" -ForegroundColor White
    Write-Host "  Ollama:  http://127.0.0.1:11434" -ForegroundColor DarkGray
    Write-Host "  Chat:    $chatUrl" -ForegroundColor White
    Write-Host ""
    Write-Host "  Press Ctrl+C or close this window to stop." -ForegroundColor DarkGray
    Write-Host ""

    try {
        while ($true) {
            Start-Sleep -Seconds 5
            $ollamaOk = Test-PortOpen -Port 11434
            $openclawOk = Test-PortOpen -Port 18789

            if (-not $ollamaOk -or -not $openclawOk) {
                if (-not $ollamaOk) { Write-Fail "Ollama stopped unexpectedly" }
                if (-not $openclawOk) { Write-Fail "OpenClaw stopped unexpectedly" }
                Write-Host "  Attempting restart..." -ForegroundColor Yellow

                if (-not $ollamaOk) {
                    $env:OLLAMA_HOST = "127.0.0.1:11434"
                    $env:OLLAMA_NUM_CTX = "32768"
                    Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
                    Wait-ForPort -Port 11434 -Label "Ollama" | Out-Null
                }
                if (-not $openclawOk) {
                    Start-Process -FilePath "openclaw" -ArgumentList "gateway", "--headless" -WindowStyle Hidden
                    Wait-ForPort -Port 18789 -Label "OpenClaw" | Out-Null
                }
                Write-Ok "Services restarted"
            }
        }
    } finally {
        Write-Host "`n  Shutting down..." -ForegroundColor Yellow
        $ocPidFile = "$EnclaveRoot\runtime\openclaw.pid"
        if (Test-Path $ocPidFile) {
            $ocPid = [int](Get-Content $ocPidFile -Raw).Trim()
            Stop-Process -Id $ocPid -Force -ErrorAction SilentlyContinue
            Remove-Item $ocPidFile -ErrorAction SilentlyContinue
        }
        $ollamaPidFile = "$EnclaveRoot\runtime\ollama.pid"
        if (Test-Path $ollamaPidFile) {
            $ollamaPid = [int](Get-Content $ollamaPidFile -Raw).Trim()
            Stop-Process -Id $ollamaPid -Force -ErrorAction SilentlyContinue
            Remove-Item $ollamaPidFile -ErrorAction SilentlyContinue
        }
        Write-Ok "All services stopped cleanly"
    }
}

} catch {
    Write-Host ""
    Write-Fail "Something went wrong: $_"
    Write-Host ""
    Write-Host "  Error details:" -ForegroundColor Yellow
    Write-Host "  $($_.ScriptStackTrace)" -ForegroundColor DarkGray
    Write-Host ""
    Read-Host "Press Enter to close"
}
