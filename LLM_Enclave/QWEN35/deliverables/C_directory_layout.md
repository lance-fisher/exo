# DELIVERABLE C: Directory Layout and Installation Plan

## C1. Dedicated Enclave Root

```
D:\ProjectsHome\LLM_Enclave\QWEN35\
```

This is the single root for all local LLM operations. Nothing outside this path is modified by the system.

## C2. Complete Directory Layout

```
D:\ProjectsHome\LLM_Enclave\QWEN35\
|
|-- runtime\                    # Ollama binary and configuration
|   |-- bin\                    # Ollama executable (copied here, not global install)
|   |-- config\                 # Ollama environment config, Modelfile
|   |-- venv\                   # Python venv (only if Python tooling is needed)
|   |-- requirements.txt        # Pinned Python dependencies with hashes (if used)
|
|-- models\                     # Downloaded model weight files (GGUF)
|   |-- staging\                # Temporary landing zone for downloads before verification
|   |-- verified\               # Models that passed hash verification
|
|-- hashes\                     # SHA256 hash records
|   |-- model_hashes.txt        # Known-good hashes for model files
|   |-- runtime_hashes.txt      # Known-good hashes for runtime binaries
|   |-- openclaw_hashes.txt     # Known-good hashes for OpenClaw artifacts
|
|-- logs\                       # All log output
|   |-- runtime\                # Ollama server logs
|   |-- bridge\                 # Workspace bridge operation logs
|   |-- audit\                  # Security audit trail
|   |-- cloud_escalation_audit.log  # Cloud usage audit (metadata only)
|
|-- workspace_bridge\           # Controlled file exchange area
|   |-- inbox\                  # Files exported FROM projects for model to read
|   |-- outbox\                 # Files produced BY model for review
|   |-- scratch\                # Model working area (ephemeral)
|
|-- policies\                   # Policy files
|   |-- bridge_policy.yaml      # Workspace bridge policy
|   |-- cloud_escalation_policy.yaml  # Cloud escalation gate policy
|
|-- scripts\                    # All operational scripts
|   |-- 01_provision_enclave.ps1
|   |-- 02_download_model.ps1
|   |-- 03_run_runtime.ps1
|   |-- 04_export_to_bridge.ps1
|   |-- 05_apply_changes.ps1
|   |-- 06_download_openclaw.ps1
|   |-- 07_install_openclaw.ps1
|   |-- 08_open_github_sync_window.ps1
|   |-- 09_close_github_sync_window.ps1
|
|-- staging\                    # General staging area for downloads
|
|-- diffs\                      # Stored diffs from apply operations
|
|-- docs\                       # Documentation
|   |-- README.md               # Complete operating manual
|   |-- openclaw_install_record.md  # OpenClaw provenance and install record
|   |-- github_workflow.md      # GitHub sync workflow guide
|   |-- changelog.md            # Change log for all updates
|
|-- backups\                    # Backups of files replaced by apply operations
|   |-- runtime\               # Old runtime binaries before update
|
|-- openclaw\                   # OpenClaw installation
|   |-- release\               # Downloaded release artifacts
|   |-- install\               # Installed OpenClaw files
|   |-- config\                # OpenClaw configuration
```

## C3. Single Source of Truth README

The complete operating manual is at: `D:\ProjectsHome\LLM_Enclave\QWEN35\docs\README.md`
(Generated as file H7)

---

## Step-by-Step Installation and Configuration

### Prerequisites
- Windows 11
- PowerShell 5.1 or later (built-in)
- Administrator access (required only for firewall rules and optional local user creation)
- Approximately 10-20 GB free disk space (varies by model size)
- Git installed and configured

### Step 1: Create Directory Structure

```powershell
# Run 01_provision_enclave.ps1 (see H1 for full content)
# This creates all directories and sets baseline NTFS permissions
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
& "D:\ProjectsHome\LLM_Enclave\QWEN35\scripts\01_provision_enclave.ps1"
```

### Step 2: Download and Verify Ollama Runtime

```powershell
# Manual download approach (preferred for security)
# 1. Open browser, navigate to: https://github.com/ollama/ollama/releases
# 2. Download the Windows zip/installer for the latest stable release
# 3. Note the SHA256 from the release page

# Verify hash
$expectedHash = "PASTE_SHA256_FROM_RELEASE_PAGE_HERE"
$downloadedFile = "D:\ProjectsHome\LLM_Enclave\QWEN35\staging\ollama-windows-amd64.zip"
$actualHash = (Get-FileHash -Path $downloadedFile -Algorithm SHA256).Hash
if ($actualHash -ne $expectedHash) {
    Write-Error "HASH MISMATCH. DO NOT PROCEED. File may be tampered."
    return
}
Write-Host "Hash verified: $actualHash"

# Record the hash
"$actualHash  ollama-windows-amd64.zip  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | `
    Add-Content -Path "D:\ProjectsHome\LLM_Enclave\QWEN35\hashes\runtime_hashes.txt"

# Extract to enclave runtime directory
Expand-Archive -Path $downloadedFile -DestinationPath "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\bin\" -Force
```

## C4. Acquiring Model Weights

```powershell
# Run 02_download_model.ps1 (see H2 for full content)
# This downloads the model with hash verification
& "D:\ProjectsHome\LLM_Enclave\QWEN35\scripts\02_download_model.ps1"
```

The model download script:
1. Downloads from the official Qwen Hugging Face repository or a verified GGUF source.
2. Uses a pinned revision/commit hash to ensure reproducibility.
3. Computes SHA256 of every downloaded file.
4. Stores hashes in `D:\ProjectsHome\LLM_Enclave\QWEN35\hashes\model_hashes.txt`.
5. Refuses to proceed if any hash mismatches a previously recorded known-good hash.
6. Does NOT execute any downloaded code (no trust_remote_code, no setup.py).

### Hash Storage and Lockdown

```powershell
# After initial verified download, lock down the hash file
$hashFile = "D:\ProjectsHome\LLM_Enclave\QWEN35\hashes\model_hashes.txt"
# Make read-only
Set-ItemProperty -Path $hashFile -Name IsReadOnly -Value $true
# Optionally set restrictive ACL
$acl = Get-Acl $hashFile
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    [System.Security.Principal.WindowsIdentity]::GetCurrent().Name,
    "Read",
    "Allow"
)
$acl.AddAccessRule($rule)
Set-Acl -Path $hashFile -AclObject $acl
```

## C5. Hugging Face Safety Mode

If downloading from Hugging Face:

```powershell
# Install huggingface-cli in a contained venv (if needed)
python -m venv "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\venv"
& "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\venv\Scripts\Activate.ps1"
pip install huggingface-hub==0.27.1 --no-deps --require-hashes -r requirements.txt

# Download specific files by exact revision
huggingface-cli download `
    "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF" `
    --revision "EXACT_COMMIT_HASH_HERE" `
    --local-dir "D:\ProjectsHome\LLM_Enclave\QWEN35\models\staging" `
    --local-dir-use-symlinks False

# CRITICAL: Do NOT use trust_remote_code or execute any repo code
# CRITICAL: Verify hashes after download
```

Alternatively, use direct HTTPS download of specific GGUF files (preferred to avoid the HF client entirely):

```powershell
# Direct download of a specific GGUF file
$modelUrl = "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/REVISION/qwen2.5-coder-7b-instruct-q4_k_m.gguf"
$outPath = "D:\ProjectsHome\LLM_Enclave\QWEN35\models\staging\qwen2.5-coder-7b-instruct-q4_k_m.gguf"
Invoke-WebRequest -Uri $modelUrl -OutFile $outPath

# Verify SHA256
$hash = (Get-FileHash -Path $outPath -Algorithm SHA256).Hash
Write-Host "SHA256: $hash"
# Compare against known-good hash and record
```

## C6. Pinned Versions and Controlled Dependencies

If Python is used for any tooling:

```powershell
# Create isolated venv
python -m venv "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\venv"

# requirements.txt with hashes (example format):
# huggingface-hub==0.27.1 \
#     --hash=sha256:EXACT_HASH_HERE

# Install with hash verification
& "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\venv\Scripts\pip.exe" `
    install --require-hashes -r "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\requirements.txt"

# NEVER run: pip install --upgrade
# NEVER run: pip install without --require-hashes
```

## C7. PATH Modifications

**Default: No global PATH modifications.**

Ollama is run from its enclave path directly:

```powershell
# Run Ollama from its enclave location
& "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\bin\ollama.exe" serve
```

If PATH modification is absolutely needed (not recommended):

```powershell
# Add to PATH for current session only (non-persistent)
$env:PATH = "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\bin;$env:PATH"

# REVERSAL: Simply close the PowerShell session. The PATH returns to normal.

# If persistent PATH modification was done (not recommended):
# REVERSAL:
# [Environment]::SetEnvironmentVariable(
#     "PATH",
#     ($env:PATH -replace [regex]::Escape("D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\bin;"), ""),
#     "User"
# )
```
