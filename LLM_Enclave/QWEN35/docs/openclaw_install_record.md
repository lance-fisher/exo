# OpenClaw Install Record

## Installation Details

| Field | Value |
|-------|-------|
| Installed Version | [TO BE FILLED AFTER INSTALL] |
| Release Name | [TO BE FILLED AFTER INSTALL] |
| Commit Hash | [TO BE FILLED AFTER INSTALL] |
| Source Repository | [TO BE FILLED - Official OpenClaw repo URL] |
| Published Date | [TO BE FILLED AFTER INSTALL] |
| Download Date | [TO BE FILLED AFTER INSTALL] |
| Install Date | [TO BE FILLED AFTER INSTALL] |
| Install Machine | [TO BE FILLED AFTER INSTALL] |
| Install Path | D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\install |
| Config Path | D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\config |
| Release Artifacts | D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\release |
| Hash Records | D:\ProjectsHome\LLM_Enclave\QWEN35\hashes\openclaw_hashes.txt |
| Provenance File | D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\release\provenance.json |

## Installed Components

[TO BE FILLED BY 07_install_openclaw.ps1]

## Dependency Versions

[TO BE FILLED BY 07_install_openclaw.ps1]

## How to Verify Integrity

Re-run hash verification against stored hashes:

```powershell
$hashFile = "D:\ProjectsHome\LLM_Enclave\QWEN35\hashes\openclaw_hashes.txt"
$releaseDir = "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\release"

# Load stored hashes
$storedHashes = @{}
Get-Content $hashFile | Where-Object { $_ -notmatch "^#" -and $_ -ne "" } | ForEach-Object {
    $parts = $_ -split "\s{2,}"
    if ($parts.Count -ge 2) { $storedHashes[$parts[1]] = $parts[0] }
}

# Verify each artifact
Get-ChildItem -Path $releaseDir -File | ForEach-Object {
    $currentHash = (Get-FileHash -Path $_.FullName -Algorithm SHA256).Hash
    $stored = $storedHashes[$_.Name]
    if ($stored) {
        if ($currentHash -eq $stored) {
            Write-Host "PASS: $($_.Name)" -ForegroundColor Green
        } else {
            Write-Host "FAIL: $($_.Name) - hash mismatch!" -ForegroundColor Red
        }
    } else {
        Write-Host "WARN: $($_.Name) - no stored hash" -ForegroundColor Yellow
    }
}
```

## How to Update Safely

1. **Open a temporary network window** (if needed):
   ```powershell
   # Only for the download step
   ```

2. **Download the new release**:
   ```powershell
   & "D:\ProjectsHome\LLM_Enclave\QWEN35\scripts\06_download_openclaw.ps1" -AllowNetwork
   ```

3. **Back up the current installation**:
   ```powershell
   $timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
   Copy-Item "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\install" `
       "D:\ProjectsHome\LLM_Enclave\QWEN35\backups\openclaw_$timestamp" -Recurse
   ```

4. **Install the new version**:
   ```powershell
   & "D:\ProjectsHome\LLM_Enclave\QWEN35\scripts\07_install_openclaw.ps1"
   ```

5. **Verify firewall rules** still apply to the new binary paths.

6. **Update this record** with new version information.

7. **Record the change** in `docs\changelog.md`.

8. **Close the network window** (if opened):
   ```powershell
   & "D:\ProjectsHome\LLM_Enclave\QWEN35\scripts\09_close_github_sync_window.ps1"
   ```

## How to Fully Remove

```powershell
# 1. Stop all OpenClaw processes
Stop-Process -Name "openclaw*" -Force -ErrorAction SilentlyContinue

# 2. Remove the installation
Remove-Item -Path "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\install" -Recurse -Force

# 3. Remove the configuration
Remove-Item -Path "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\config" -Recurse -Force

# 4. Remove firewall rules
Get-NetFirewallRule -DisplayName "LLM_Enclave: Block OpenClaw*" | Remove-NetFirewallRule

# 5. (Optional) Remove release artifacts
# Remove-Item -Path "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\release" -Recurse -Force

# 6. (Optional) Remove Docker container and image
# docker rm -f openclaw-enclave 2>$null
# docker rmi openclaw-image:verified-tag 2>$null

# 7. Record removal in changelog
$entry = "## $(Get-Date -Format 'yyyyMMdd_HHmmss') - OpenClaw REMOVED"
Add-Content -Path "D:\ProjectsHome\LLM_Enclave\QWEN35\docs\changelog.md" -Value $entry
```

## Security Notes

1. OpenClaw is treated as an UNTRUSTED supply chain input until all hashes are verified.
2. OpenClaw processes are blocked from outbound network by firewall rules.
3. OpenClaw can only access files within the enclave and bridge directories.
4. OpenClaw plugins, extensions, and MCP servers are DISABLED by default.
5. No plugin may be enabled without source review, hash pinning, and explicit approval.
6. OpenClaw logs are configured to avoid capturing sensitive data (prompts, source code).
7. OpenClaw auto-update and telemetry are disabled in the configuration.
