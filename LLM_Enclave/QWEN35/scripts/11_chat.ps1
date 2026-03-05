#Requires -Version 5.1
<#
.SYNOPSIS
    Launch the local AI chat interface — your offline "Claude Code".

.DESCRIPTION
    Quick launcher for the Qwen Chat CLI. Connects to local Ollama
    and provides an interactive terminal chat experience.

    This is the "just talk to it" interface.

.EXAMPLE
    .\11_chat.ps1
    .\11_chat.ps1 -Project MyProject
    .\11_chat.ps1 -UseOpenClaw
#>

param(
    [string]$Project = "",
    [string]$Model = "qwen-local",
    [switch]$UseOpenClaw
)

$EnclaveRoot = "D:\ProjectsHome\LLM_Enclave\QWEN35"
$CliPath = "$EnclaveRoot\cli\qwen_chat.py"

# Pre-flight: Check Ollama
try {
    $null = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -TimeoutSec 3
} catch {
    Write-Host "Ollama is not running. Starting it..." -ForegroundColor Yellow
    # Try to start from enclave bin
    $ollamaExe = "$EnclaveRoot\runtime\bin\ollama.exe"
    if (Test-Path $ollamaExe) {
        $env:OLLAMA_HOST = "127.0.0.1:11434"
        Start-Process -FilePath $ollamaExe -ArgumentList "serve" -WindowStyle Minimized
        Start-Sleep -Seconds 3
        Write-Host "Ollama started." -ForegroundColor Green
    } else {
        # Try system ollama
        try {
            Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Minimized
            Start-Sleep -Seconds 3
            Write-Host "Ollama started (system)." -ForegroundColor Green
        } catch {
            Write-Host "Could not start Ollama. Start it manually first." -ForegroundColor Red
            exit 1
        }
    }
}

if ($UseOpenClaw) {
    # Launch OpenClaw
    Write-Host "Starting OpenClaw agent..." -ForegroundColor Cyan
    $env:OLLAMA_API_KEY = "ollama-local"
    $env:DO_NOT_TRACK = "1"
    openclaw
} else {
    # Launch Qwen Chat CLI
    $args_list = @()
    if ($Project) { $args_list += "--project"; $args_list += $Project }
    if ($Model -ne "qwen-local") { $args_list += "--model"; $args_list += $Model }

    python $CliPath @args_list
}
