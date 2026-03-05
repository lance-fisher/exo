<#
.SYNOPSIS
    Stop the local AI coding assistant.
    Usually not needed — just close the LAUNCH window or press Ctrl+C.
#>

param(
    [string]$EnclaveRoot = "D:\ProjectsHome\LLM_Enclave\QWEN35"
)

Write-Host "`n  Stopping Local AI Coder..." -ForegroundColor Yellow

# Stop by PID files
foreach ($svc in @("openclaw", "ollama")) {
    $pidFile = "$EnclaveRoot\runtime\$svc.pid"
    if (Test-Path $pidFile) {
        $pid = [int](Get-Content $pidFile -Raw).Trim()
        try {
            Stop-Process -Id $pid -Force -ErrorAction Stop
            Write-Host "  ✓ Stopped $svc (PID $pid)" -ForegroundColor Green
        } catch {
            Write-Host "  → $svc was not running" -ForegroundColor DarkGray
        }
        Remove-Item $pidFile -ErrorAction SilentlyContinue
    }
}

# Also kill by process name as fallback
Get-Process -Name "ollama" -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "  ✓ All services stopped" -ForegroundColor Green
Write-Host ""
