# DELIVERABLE F: Workspace Bridge Design for Safe Project Assistance

## Overview

The Workspace Bridge is a controlled file exchange mechanism that allows the local Qwen model to assist with your projects WITHOUT having direct access to your project files. It operates on an explicit export/import model with mandatory review gates.

```
+-------------------+       +---------------------------+       +-------------------+
|                   |       |    WORKSPACE BRIDGE       |       |                   |
|  YOUR PROJECTS    | --->  |  inbox/  (you export to)  | --->  |  QWEN MODEL       |
|  D:\ProjectsHome\ |       |  scratch/ (model works)   |       |  (reads inbox,    |
|  (NEVER TOUCHED)  | <---  |  outbox/ (model outputs)  | <---  |   writes outbox)  |
|                   |       |                           |       |                   |
+-------------------+       +---------------------------+       +-------------------+
        ^                              |
        |                              v
        +-------- APPLY CHANGES -------+
                 (diff + confirm + backup)
```

## F1. Model Read/Write Boundaries

The model (via Ollama and any agent runner like OpenClaw) can ONLY read and write within these three directories:

```
D:\ProjectsHome\LLM_Enclave\QWEN35\workspace_bridge\inbox\
D:\ProjectsHome\LLM_Enclave\QWEN35\workspace_bridge\outbox\
D:\ProjectsHome\LLM_Enclave\QWEN35\workspace_bridge\scratch\
```

### Directory Purposes

| Directory | Who Writes | Who Reads | Purpose |
|-----------|-----------|-----------|---------|
| `inbox\`  | You (via export script) | Model | Files from your projects that the model should analyze or edit |
| `outbox\` | Model | You (via apply script) | Model-generated edits, patches, new files |
| `scratch\`| Model | Model | Temporary working space for intermediate computations |

### Enforcement Mechanisms

1. **NTFS ACLs** (if using dedicated user): `LLM_Enclave_User` has Modify access only to these three directories and the `logs\` directory.
2. **Script enforcement**: All bridge scripts validate that paths fall within allowed boundaries before any file operation.
3. **Ollama binding**: Ollama is configured to serve on 127.0.0.1 only. Any agent (OpenClaw) connecting to it operates within the bridge boundaries by policy.

## F2. Explicit Export Workflow

To give the model access to a project file, you must explicitly export it:

```powershell
# Export a specific file
.\scripts\04_export_to_bridge.ps1 -SourcePath "D:\ProjectsHome\MyProject\src\app.py"

# Export a directory (filtered by policy)
.\scripts\04_export_to_bridge.ps1 -SourcePath "D:\ProjectsHome\MyProject\src\" -Recursive

# Export with a project label (organizes inbox)
.\scripts\04_export_to_bridge.ps1 -SourcePath "D:\ProjectsHome\MyProject\src\app.py" -ProjectLabel "MyProject"
```

The export script (H4) enforces:
- Deny patterns from the policy file (no .key, .pem, .env files)
- Max file size limits
- Secret scanning and redaction
- Logging of every exported file

Exported files are COPIES. The originals are never modified.

## F3. Model Output Workflow

The model produces its work in the outbox:

```
D:\ProjectsHome\LLM_Enclave\QWEN35\workspace_bridge\outbox\
|-- MyProject\
|   |-- src\
|   |   |-- app.py              # Modified file (full replacement)
|   |   |-- app.py.patch        # Or as a unified diff patch
|   |-- new_file.py             # Newly created file
```

The model NEVER writes directly to your project directories. It always writes to the outbox.

## F4. Apply Changes Workflow

The apply script (H5) performs a safe, gated merge:

```powershell
# Review and apply changes from outbox to target project
.\scripts\05_apply_changes.ps1 `
    -OutboxPath "D:\ProjectsHome\LLM_Enclave\QWEN35\workspace_bridge\outbox\MyProject" `
    -TargetPath "D:\ProjectsHome\MyProject"
```

### Apply Process (Step by Step)

1. **Policy check**: Verify that `TargetPath` is in the allowed roots list in `bridge_policy.yaml`. If not, REFUSE.
2. **File type check**: Verify all files in outbox match allowed extensions. If any fail, REFUSE.
3. **Size check**: Verify no file exceeds max size. Verify total batch does not exceed max batch size.
4. **Diff generation**: For each file that exists in both outbox and target, generate a unified diff and display it.
5. **New file listing**: List any new files that would be created.
6. **Backup**: Before any write, copy the existing target file to `backups\` with a timestamped folder.
7. **Manual confirmation**: Display all diffs and require the user to type "CONFIRM APPLY" to proceed.
8. **Apply**: Copy files from outbox to target.
9. **Audit log**: Record every file applied, the timestamp, the diff hash, and the backup location.
10. **Verification**: Show a summary of what was applied and where backups are stored.

## F5. Allowlist Enforcement

The apply script enforces:

### Target Path Allowlist
```yaml
# From bridge_policy.yaml
allowed_target_roots: []  # Empty by default - user must opt-in
# Example after configuration:
# allowed_target_roots:
#   - "D:\\ProjectsHome\\MyProject"
#   - "D:\\ProjectsHome\\AnotherProject"
```

### Max File Sizes
```yaml
max_file_size_bytes: 1048576      # 1 MB per file
max_batch_size_bytes: 10485760    # 10 MB total per apply batch
```

### File Type Restrictions
```yaml
allowed_extensions:
  - ".py"
  - ".js"
  - ".ts"
  - ".jsx"
  - ".tsx"
  - ".html"
  - ".css"
  - ".json"
  - ".yaml"
  - ".yml"
  - ".md"
  - ".txt"
  - ".toml"
  - ".cfg"
  - ".ini"
  - ".sh"
  - ".ps1"
  - ".bat"
  - ".rs"
  - ".go"
  - ".java"
  - ".xml"
  - ".sql"
  - ".r"
  - ".rmd"
```

## F6. Secret Scanning and Redaction

### During Export (04_export_to_bridge.ps1)

Before copying files to the inbox, the export script scans for secrets:

```powershell
# Secret detection patterns (regex)
$secretPatterns = @(
    @{ Name = "AWS Key";           Pattern = 'AKIA[0-9A-Z]{16}' }
    @{ Name = "AWS Secret";        Pattern = '(?i)aws_secret_access_key\s*=\s*\S+' }
    @{ Name = "GitHub Token";      Pattern = 'gh[pousr]_[A-Za-z0-9_]{36,}' }
    @{ Name = "Generic API Key";   Pattern = '(?i)(api[_-]?key|apikey)\s*[:=]\s*["\x27]?\S{20,}' }
    @{ Name = "Generic Secret";    Pattern = '(?i)(secret|password|passwd|token)\s*[:=]\s*["\x27]?\S{8,}' }
    @{ Name = "Private Key Block"; Pattern = '-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----' }
    @{ Name = "Connection String"; Pattern = '(?i)(server|host)=\S+;.*(password|pwd)=\S+' }
    @{ Name = "Bearer Token";      Pattern = '(?i)bearer\s+[A-Za-z0-9\-._~+/]+=*' }
    @{ Name = "Base64 High Entropy"; Pattern = '[A-Za-z0-9+/]{40,}={0,2}' }
)
```

### Behavior on Detection

1. **Default mode (BLOCK)**: If any secret pattern matches, the export is REFUSED with a detailed report showing which file, which line, and which pattern matched.
2. **Redact mode**: If the user explicitly enables redaction, matched strings are replaced with `[REDACTED:pattern_name]` in the exported copy. The original file is never modified.
3. **Override mode**: The user can add exceptions to the policy file for known false positives, but must do so explicitly.

### Configurable Secret Scanning

```yaml
# In bridge_policy.yaml
secret_scanning:
  enabled: true
  mode: "block"  # Options: "block", "redact", "warn"
  custom_patterns:
    - name: "My Custom Token"
      pattern: 'myapp_token_[A-Za-z0-9]{32}'
  ignore_patterns:
    - "test_data/mock_credentials.json"  # False positive exceptions
```
