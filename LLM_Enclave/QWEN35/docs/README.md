# LLM Enclave - Complete Operating Manual

## Overview

This is a hardened, privacy-first, local-only AI development environment for running
Qwen locally with strict containment, auditability, and reversibility. It enables
local AI-assisted development through a controlled Workspace Bridge without giving
the model unrestricted access to your project files.

**Primary Runtime:** Ollama (with Qwen model via GGUF format)
**Agent Runner:** OpenClaw (local-only, contained)
**Workspace:** D:\ProjectsHome\LLM_Enclave\QWEN35\

---

## Security Model

### Core Principles

1. **Zero trust in downloaded artifacts**: Every binary, model file, and dependency
   is hash-verified before use. Nothing is trusted by default.

2. **Zero outbound network**: All enclave processes (Ollama, OpenClaw, Python) are
   blocked from making outbound connections via Windows Firewall rules.

3. **Zero telemetry**: All telemetry, update checks, and phone-home behavior is
   disabled via environment variables and configuration.

4. **Least privilege**: An optional dedicated local user (LLM_Enclave_User) runs
   the runtime with access only to the enclave directory.

5. **Bridge-only project access**: The model never directly reads or writes your
   project files. All interaction goes through the Workspace Bridge with explicit
   export, review, and gated apply steps.

6. **Fail closed**: If any security check fails, the system refuses to proceed.

### Trust Boundaries

```
+-------------------------------------------------------------+
| UNTRUSTED ZONE (blocked from outbound, contained by ACLs)   |
|   - Ollama server process                                    |
|   - Qwen model weights                                      |
|   - OpenClaw agent process                                   |
|   - Any Python/Node in enclave venvs                         |
+-------------------------------------------------------------+
                        |
                   (localhost:11434 only)
                        |
+-------------------------------------------------------------+
| BRIDGE ZONE (inbox/outbox/scratch)                           |
|   - Files explicitly exported by user                        |
|   - Model-generated outputs awaiting review                  |
+-------------------------------------------------------------+
                        |
                   (manual review + typed confirmation)
                        |
+-------------------------------------------------------------+
| TRUSTED ZONE (your normal user context)                      |
|   - Your project repos under D:\ProjectsHome                |
|   - Your terminal and development tools                      |
|   - Claude Code (separate process, separate network)         |
+-------------------------------------------------------------+
```

---

## How to Provision

### First-Time Setup

1. Copy the entire `LLM_Enclave` directory to `D:\ProjectsHome\`.

2. Open PowerShell as Administrator and run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
& "D:\ProjectsHome\LLM_Enclave\QWEN35\scripts\01_provision_enclave.ps1"
```

3. For maximum security, include the restricted user:

```powershell
& "D:\ProjectsHome\LLM_Enclave\QWEN35\scripts\01_provision_enclave.ps1" -CreateRestrictedUser
```

4. Review what was created and verify firewall rules:

```powershell
Get-NetFirewallRule -DisplayName "LLM_Enclave:*" | Format-Table DisplayName, Enabled, Action
```

---

## How to Download and Verify Model

### Option A: Direct Download (Preferred)

1. Identify the exact model file you want from the official Qwen Hugging Face page.
2. Temporarily allow your browser's outbound access (the enclave processes stay blocked).
3. Download the GGUF file to `D:\ProjectsHome\LLM_Enclave\QWEN35\models\staging\`.
4. Run the verification script:

```powershell
& "D:\ProjectsHome\LLM_Enclave\QWEN35\scripts\02_download_model.ps1" `
    -SkipDownload `
    -ModelFileName "your-model-file.gguf" `
    -ExpectedHash "PASTE_SHA256_HERE"
```

### Option B: Scripted Download

```powershell
& "D:\ProjectsHome\LLM_Enclave\QWEN35\scripts\02_download_model.ps1" `
    -HuggingFaceRepo "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF" `
    -HuggingFaceFile "qwen2.5-coder-7b-instruct-q4_k_m.gguf" `
    -HuggingFaceRevision "EXACT_COMMIT_HASH" `
    -AllowNetwork
```

### After Download

1. Update the Modelfile:

```powershell
# Edit D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\config\Modelfile
# Change the FROM line to point to your verified model file
```

2. Create the Ollama model:

```powershell
& "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\bin\ollama.exe" create qwen-local `
    -f "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\config\Modelfile"
```

---

## How to Run Offline

```powershell
& "D:\ProjectsHome\LLM_Enclave\QWEN35\scripts\03_run_runtime.ps1" -Background
```

The script will:
1. Verify the enclave directory exists.
2. Verify the Ollama binary is present.
3. Verify the Modelfile is configured.
4. Verify the firewall outbound block is active.
5. Start Ollama bound to 127.0.0.1:11434.

To test:

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags"
& "D:\ProjectsHome\LLM_Enclave\QWEN35\runtime\bin\ollama.exe" run qwen-local "Hello, confirm you are running."
```

To stop:

```powershell
Stop-Process -Name "ollama" -Force
```

---

## How to Use the Workspace Bridge

### Export Files for the Model

```powershell
# Export a single file
& "D:\ProjectsHome\LLM_Enclave\QWEN35\scripts\04_export_to_bridge.ps1" `
    -SourcePath "D:\ProjectsHome\MyProject\src\main.py" `
    -ProjectLabel "MyProject"

# Export a directory
& "D:\ProjectsHome\LLM_Enclave\QWEN35\scripts\04_export_to_bridge.ps1" `
    -SourcePath "D:\ProjectsHome\MyProject\src\" `
    -Recursive `
    -ProjectLabel "MyProject"
```

### Work with the Model

The model (via Ollama directly or through OpenClaw) reads from `inbox\` and writes to `outbox\`.

### Review and Apply Changes

```powershell
& "D:\ProjectsHome\LLM_Enclave\QWEN35\scripts\05_apply_changes.ps1" `
    -OutboxPath "D:\ProjectsHome\LLM_Enclave\QWEN35\workspace_bridge\outbox\MyProject" `
    -TargetPath "D:\ProjectsHome\MyProject"
```

This will show diffs, require typed confirmation ("CONFIRM APPLY"), create backups, then apply.

---

## How to Apply Changes Safely

1. **Review the policy file** at `policies\bridge_policy.yaml`.
2. **Add your project** to `allowed_target_roots`.
3. **Set `policy_not_configured` to `false`**.
4. **Run the apply script** (see above).
5. **Review every diff** before typing confirmation.
6. **Check the backup** created under `backups\` if you need to rollback.

---

## How to Rotate Logs

Logs are stored under `D:\ProjectsHome\LLM_Enclave\QWEN35\logs\`.

Log rotation is MANUAL to prevent data loss:

```powershell
$logDir = "D:\ProjectsHome\LLM_Enclave\QWEN35\logs"
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$archiveDir = "$logDir\archive_$timestamp"
New-Item -ItemType Directory -Path $archiveDir -Force
Get-ChildItem -Path $logDir -Filter "*.log" | ForEach-Object {
    Move-Item -Path $_.FullName -Destination $archiveDir
}
# Recreate empty log files
@("provision.log") | ForEach-Object {
    New-Item -ItemType File -Path "$logDir\$_" -Force
}
```

Subdirectory logs (runtime, bridge, audit, openclaw) follow the same pattern.

---

## How to Update the Runtime and Model Safely

See `deliverables\I_secure_update.md` for the complete procedure.

Short version:
1. Download new version to `staging\`.
2. Verify SHA256 hash.
3. Back up current version to `backups\`.
4. Install new version.
5. Verify firewall rules still apply.
6. Record in `docs\changelog.md`.

---

## How to Rollback Firewall Rules and Local User

### Remove All Firewall Rules

```powershell
# As Administrator
Get-NetFirewallRule -DisplayName "LLM_Enclave:*" | Remove-NetFirewallRule
Get-NetFirewallRule -DisplayName "LLM_Enclave: Block*" | Remove-NetFirewallRule
```

### Remove Local User

```powershell
# As Administrator
Remove-LocalUser -Name "LLM_Enclave_User"
```

### Remove Environment Variables

```powershell
[Environment]::SetEnvironmentVariable("OLLAMA_NOPRUNE", $null, "User")
[Environment]::SetEnvironmentVariable("HF_HUB_OFFLINE", $null, "User")
[Environment]::SetEnvironmentVariable("TRANSFORMERS_OFFLINE", $null, "User")
[Environment]::SetEnvironmentVariable("DO_NOT_TRACK", $null, "User")
[Environment]::SetEnvironmentVariable("OLLAMA_HOST", $null, "User")
```

### Remove Everything

```powershell
# WARNING: This removes the entire enclave
Remove-Item -Path "D:\ProjectsHome\LLM_Enclave" -Recurse -Force
```

---

## OpenClaw Operation

### Starting OpenClaw

```powershell
# If binary:
& "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\install\openclaw.exe" `
    --config "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\config\config.yaml"

# If Python-based:
& "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\install\venv\Scripts\python.exe" `
    -m openclaw `
    --config "D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\config\config.yaml"
```

### OpenClaw connects to Ollama via localhost:11434 only.

### OpenClaw reads from workspace_bridge\inbox\ and writes to workspace_bridge\outbox\.

### OpenClaw plugins are DISABLED by default. See `deliverables\R_openclaw_agent_runner.md`.

---

## GitHub Sync

See `docs\github_workflow.md` for the complete guide.

Short version:
1. Open sync window: `.\scripts\08_open_github_sync_window.ps1`
2. Do your git pull/push operations.
3. Close sync window: `.\scripts\09_close_github_sync_window.ps1`

---

## Cloud Escalation (Claude Code)

See `deliverables\P_local_first_strategy.md` for the complete guide.

**Rule:** Always try Qwen local first. Only escalate to Claude Code after the
structured attempt process (3 retries with different approaches) and manual confirmation.

---

## Known Limitations

1. **NTFS ACL Deny/Allow interaction**: If using a restricted user, the Deny rule on
   D:\ProjectsHome may sometimes override the Allow rule on the enclave subdirectory.
   Test this thoroughly during provisioning. If it does not work, rely on script-level
   enforcement instead.

2. **Ollama telemetry**: Even with OLLAMA_NOPRUNE=1, Ollama may attempt telemetry in
   future versions. The firewall block is the definitive control.

3. **GGUF model quality**: Quantized models have lower quality than full-precision.
   Q4_K_M is a good default balance. If quality is insufficient, try Q5_K_M or Q6_K.

4. **Context window**: Qwen2.5-Coder-7B has a 32K context window. Very large files
   or multi-file contexts may exceed this. Break work into smaller chunks.

5. **No automatic orchestration**: The bridge is manual by design. You must explicitly
   export files, and explicitly apply changes. This is a security feature.

6. **Windows Firewall granularity**: Firewall rules are per-executable path. If the
   runtime binary moves (e.g., during an update), rules must be updated.

7. **Log sensitivity**: Runtime logs may inadvertently capture prompt fragments.
   Rotate and review logs periodically. Consider enabling log redaction.

## How to Keep It Secure

1. Never disable firewall rules permanently.
2. Never store API keys or tokens in the enclave.
3. Never enable OpenClaw plugins without review.
4. Never run the enclave processes as Administrator.
5. Always verify hashes after downloading anything.
6. Always review diffs before applying changes.
7. Always close sync windows promptly after use.
8. Periodically review logs for unexpected activity.
9. Keep the policy file conservative (deny by default).
10. Record all changes in the changelog.
