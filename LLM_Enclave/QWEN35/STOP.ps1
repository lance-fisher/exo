<#
.SYNOPSIS
    Stop the local AI coding assistant.
    Usually not needed - just close the LAUNCH window or press Ctrl+C.
#>

param(
    [string]$EnclaveRoot = (Split-Path -Parent $PSCommandPath)
)

Write-Host "`n  Stopping Local AI Coder..." -ForegroundColor Yellow

# Stop by PID files
foreach ($svc in @("openclaw", "ollama")) {
    $pidFile = "$EnclaveRoot\runtime\$svc.pid"
    if (Test-Path $pidFile) {
        $pid = [int](Get-Content $pidFile -Raw).Trim()
        try {
            Stop-Process -Id $pid -Force -ErrorAction Stop
            Write-Host "  [OK] Stopped $svc (PID $pid)" -ForegroundColor Green
        } catch {
            Write-Host "  [SKIP] $svc was not running" -ForegroundColor DarkGray
        }
        Remove-Item $pidFile -ErrorAction SilentlyContinue
    }
}

# Also kill by process name as fallback
Get-Process -Name "ollama" -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "  [OK] All services stopped" -ForegroundColor Green
Write-Host ""
