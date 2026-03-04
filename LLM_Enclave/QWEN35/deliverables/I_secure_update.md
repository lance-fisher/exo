# DELIVERABLE I: Secure Update Procedure

## I1. How to Update the Runtime Binary (Ollama) Safely

### Pre-Update Checklist
- [ ] Confirm the new version addresses a specific need (security fix, bug fix, required feature).
- [ ] Do NOT update "just because a new version exists."

### Update Steps

```powershell
# Step 1: Record current version
$currentVersion = & "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\bin\ollama.exe" --version
Write-Host "Current version: $currentVersion"

# Step 2: Temporarily enable outbound for your browser/download tool ONLY
# (Do NOT enable outbound for ollama.exe itself)
# Use the 08_open_github_sync_window.ps1 or manual browser download

# Step 3: Download new version from official source
# URL: https://github.com/ollama/ollama/releases
# Download the Windows zip to staging
$stagingDir = "D:\ProjectsHome\LLM_Enclave\QWEN35\staging"
# Place downloaded file here: $stagingDir\ollama-windows-amd64-NEW.zip

# Step 4: Verify hash
$newFile = "$stagingDir\ollama-windows-amd64-NEW.zip"
$actualHash = (Get-FileHash -Path $newFile -Algorithm SHA256).Hash
Write-Host "SHA256 of downloaded file: $actualHash"
Write-Host "Compare this against the hash published on the GitHub release page."
$expectedHash = Read-Host "Paste the expected SHA256 from the release page"
if ($actualHash -ne $expectedHash) {
    Write-Error "HASH MISMATCH. Aborting update. Downloaded file may be compromised."
    return
}
Write-Host "Hash verified." -ForegroundColor Green

# Step 5: Backup current runtime
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDir = "D:\ProjectsHome\LLM_Enclave\QWEN35\backups\runtime\$timestamp"
New-Item -ItemType Directory -Path $backupDir -Force
Copy-Item -Path "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\bin\*" -Destination $backupDir -Recurse
Write-Host "Current runtime backed up to: $backupDir"

# Step 6: Stop the running runtime
Stop-Process -Name "ollama" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Step 7: Extract new version
Expand-Archive -Path $newFile -DestinationPath "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\bin\" -Force

# Step 8: Record new hash
$newExeHash = (Get-FileHash -Path "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\bin\ollama.exe" -Algorithm SHA256).Hash
"$newExeHash  ollama.exe  $timestamp  UPDATED" | Add-Content -Path "D:\ProjectsHome\LLM_Enclave\QWEN35\hashes\runtime_hashes.txt"

# Step 9: Verify firewall rules still apply to the new binary path
$fwRules = Get-NetFirewallRule -DisplayName "LLM_Enclave:*"
foreach ($rule in $fwRules) {
    $appFilter = Get-NetFirewallApplicationFilter -AssociatedNetFirewallRule $rule
    Write-Host "Rule: $($rule.DisplayName) -> Program: $($appFilter.Program) | Enabled: $($rule.Enabled)"
}
# If the binary path changed, update firewall rules

# Step 10: Verify new version
$newVersion = & "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\bin\ollama.exe" --version
Write-Host "New version: $newVersion"

# Step 11: Revoke outbound access (if it was enabled for download)
# Run 09_close_github_sync_window.ps1

# Step 12: Record in changelog
$changeEntry = @"
## $timestamp - Runtime Update
- Previous version: $currentVersion
- New version: $newVersion
- SHA256: $newExeHash
- Backup location: $backupDir
- Verified: Hash match confirmed
- Firewall rules: Verified
"@
Add-Content -Path "D:\ProjectsHome\LLM_Enclave\QWEN35\docs\changelog.md" -Value $changeEntry
```

### Rollback Steps

```powershell
# Rollback to previous runtime version
$backupDir = "D:\ProjectsHome\LLM_Enclave\QWEN35\backups\runtime\TIMESTAMP_HERE"

# Stop current runtime
Stop-Process -Name "ollama" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Restore from backup
Copy-Item -Path "$backupDir\*" -Destination "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\bin\" -Recurse -Force

# Verify restored version
& "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\bin\ollama.exe" --version

# Record rollback in changelog
$rollbackEntry = "## $(Get-Date -Format 'yyyyMMdd_HHmmss') - ROLLBACK to backup from $backupDir"
Add-Content -Path "D:\ProjectsHome\LLM_Enclave\QWEN35\docs\changelog.md" -Value $rollbackEntry
```

---

## I2. How to Update Model Weights Safely

### Update Steps

```powershell
# Step 1: Identify the new model version
# Check the official Qwen repository for the new version/revision
$newRevision = "EXACT_COMMIT_HASH_OR_TAG"
$newModelFile = "model-name-here.gguf"

# Step 2: Download to staging (NEVER overwrite existing verified models)
$stagingPath = "D:\ProjectsHome\LLM_Enclave\QWEN35\models\staging\$newModelFile"
# Download using browser or Invoke-WebRequest to staging

# Step 3: Verify hash
$modelHash = (Get-FileHash -Path $stagingPath -Algorithm SHA256).Hash
Write-Host "SHA256: $modelHash"
Write-Host "Compare against the hash from the official source."

# Step 4: Move to verified directory (do NOT overwrite old model)
$verifiedPath = "D:\ProjectsHome\LLM_Enclave\QWEN35\models\verified\$newModelFile"
if (Test-Path $verifiedPath) {
    Write-Error "A file already exists at $verifiedPath. Will not overwrite."
    Write-Host "Rename the new file or move the old one to backups first."
    return
}
Move-Item -Path $stagingPath -Destination $verifiedPath

# Step 5: Record hash
"$modelHash  $newModelFile  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  revision=$newRevision" | `
    Add-Content -Path "D:\ProjectsHome\LLM_Enclave\QWEN35\hashes\model_hashes.txt"

# Step 6: Update Ollama Modelfile to point to new model
# Edit D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\config\Modelfile
# Change the FROM line to point to the new model file

# Step 7: Re-import into Ollama
& "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\bin\ollama.exe" create qwen-local -f "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\config\Modelfile"

# Step 8: Test
& "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\bin\ollama.exe" run qwen-local "Hello, confirm you are running."

# Step 9: Record in changelog
$changeEntry = @"
## $(Get-Date -Format 'yyyyMMdd_HHmmss') - Model Update
- New model file: $newModelFile
- Revision: $newRevision
- SHA256: $modelHash
- Previous model: (still available in models\verified\)
"@
Add-Content -Path "D:\ProjectsHome\LLM_Enclave\QWEN35\docs\changelog.md" -Value $changeEntry
```

### Rollback Steps

```powershell
# Rollback to previous model
# 1. Edit the Modelfile to point to the previous model file
# 2. Re-run ollama create
# 3. Old model files are never deleted, so they are always available
```

---

## I3. Change Log Format

Location: `D:\ProjectsHome\LLM_Enclave\QWEN35\docs\changelog.md`

```markdown
# LLM Enclave Change Log

All changes to the runtime, model, tooling, and configuration are recorded here.
Each entry includes: date, what changed, verification details, and rollback path.

## TEMPLATE
## YYYYMMDD_HHMMSS - [Type: Runtime Update | Model Update | Config Change | Policy Change]
- Description: What was changed
- Previous state: What it was before
- New state: What it is now
- Verification: How it was verified (hash, signature, etc.)
- Backup location: Where the old version is stored
- Rollback command: How to undo this change
```

---

## I4. Rollback Plan Summary

| Component | Rollback Method | Backup Location |
|-----------|----------------|-----------------|
| Ollama runtime | Restore from timestamped backup | `backups\runtime\TIMESTAMP\` |
| Model weights | Switch Modelfile back to old model | Old model still in `models\verified\` |
| Firewall rules | Re-run provision script or manually recreate | Rules documented in provision script |
| Local user | `Remove-LocalUser -Name "LLM_Enclave_User"` | N/A |
| NTFS ACLs | Re-run provision script to reset | Documented in provision script |
| Python venv | Delete and recreate from pinned requirements | `runtime\requirements.txt` has pinned deps |
| Policy file | Restore from backup or reset to defaults | Copy the default from this document |
| OpenClaw | Remove the `openclaw\` directory | Installation is self-contained |
| Hosts file entries | Remove the added lines | Documented in provision script |
| Environment variables | Remove via `[Environment]::SetEnvironmentVariable("VAR", $null, "User")` | Listed in provision script |
