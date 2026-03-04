# DELIVERABLE R: OpenClaw Primary Agent Runner Integration Plan

## R1. Local-Only Architecture

```
+------------------------------------------------------------------+
|                    LLM ENCLAVE BOUNDARY                           |
|                    D:\ProjectsHome\LLM_Enclave\QWEN35\           |
|                                                                  |
|  +-------------------+        +---------------------------+      |
|  |                   |  REST  |                           |      |
|  |   OLLAMA SERVER   |<------>|   OPENCLAW AGENT          |      |
|  |   (Qwen Model)    |  API   |   (Agent Runner +         |      |
|  |                   | local  |    Tool Orchestrator)     |      |
|  |   127.0.0.1:11434 | only   |                           |      |
|  +-------------------+        +---------------------------+      |
|          ^                         |          |          |        |
|          |                         v          v          v        |
|          |                    +--------+ +--------+ +--------+   |
|          |                    | inbox/ | |outbox/ | |scratch/|   |
|          |                    +--------+ +--------+ +--------+   |
|          |                         WORKSPACE BRIDGE               |
|          |                                                        |
+----------|--------------------------------------------------------+
           |
     FIREWALL BLOCK
     (no outbound)

+------------------------------------------------------------------+
|                    USER BOUNDARY                                  |
|                    (Normal terminal, normal user)                 |
|                                                                  |
|  04_export_to_bridge.ps1 ----> inbox/                            |
|  05_apply_changes.ps1  <------ outbox/                           |
|  Manual git operations in project repos                          |
|  Claude Code (separate process, separate network, paid API)      |
|                                                                  |
+------------------------------------------------------------------+

+------------------------------------------------------------------+
|                    PROJECT REPOS                                  |
|                    D:\ProjectsHome\*                              |
|  (Never accessed directly by enclave processes)                  |
|  (Changes applied only via 05_apply_changes.ps1 with approval)  |
+------------------------------------------------------------------+
```

### Component Responsibilities

| Component | Role | Network | File Access |
|-----------|------|---------|-------------|
| Ollama Server | Inference engine, serves Qwen model | Localhost only (127.0.0.1:11434), outbound blocked | Enclave only |
| OpenClaw Agent | Agent runner, task orchestration, tool execution | None (outbound blocked) | Bridge dirs only |
| Export Script | Copies files from projects to bridge inbox | None | Source project (read), inbox (write) |
| Apply Script | Applies reviewed changes from outbox to projects | None | Outbox (read), target project (write with approval) |
| Firewall Rules | Blocks all outbound for enclave processes | N/A | N/A |
| Restricted User | Process isolation (if enabled) | N/A | Enclave only |

### Data Flow

```
1. USER exports files:
   D:\ProjectsHome\MyProject\src\main.py
       --> (copy via 04_export_to_bridge.ps1) -->
   D:\ProjectsHome\LLM_Enclave\QWEN35\workspace_bridge\inbox\MyProject\src\main.py

2. OPENCLAW reads inbox, sends to OLLAMA for processing:
   OpenClaw reads inbox/MyProject/src/main.py
       --> Sends content as prompt to Ollama (localhost REST API)
       --> Ollama returns model output
       --> OpenClaw writes result to outbox/

3. OPENCLAW writes output:
   D:\ProjectsHome\LLM_Enclave\QWEN35\workspace_bridge\outbox\MyProject\src\main.py

4. USER reviews and applies:
   05_apply_changes.ps1 -OutboxPath "...\outbox\MyProject" -TargetPath "D:\ProjectsHome\MyProject"
       --> Shows diff
       --> Requires "CONFIRM APPLY"
       --> Creates backup
       --> Copies to target
```

## R2. Preventing Automatic Scanning/Indexing

OpenClaw must NOT be configured to automatically scan, index, or watch any directory.

### Configuration Requirements

```yaml
# In OpenClaw config (D:\ProjectsHome\LLM_Enclave\QWEN35\openclaw\config\config.yaml)

# Disable file watching
file_watcher_enabled: false

# Disable automatic indexing
auto_index_enabled: false

# Disable recursive directory scanning
recursive_scan_enabled: false

# Do not set a "projects root" or "workspace root" outside the enclave
workspace_root: "D:\\ProjectsHome\\LLM_Enclave\\QWEN35\\workspace_bridge"

# Do not configure any additional roots
additional_roots: []

# Disable any "smart context" that might try to scan parent directories
smart_context_enabled: false
```

### Verification

```powershell
# Verify OpenClaw is not accessing directories outside the enclave
# Monitor file access using Process Monitor (Sysinternals) if needed:
# 1. Download Process Monitor from https://learn.microsoft.com/en-us/sysinternals/downloads/procmon
# 2. Filter by process name matching openclaw or python (in enclave venv)
# 3. Filter by path NOT starting with D:\ProjectsHome\LLM_Enclave\QWEN35
# 4. Any matches indicate unauthorized access
```

## R3. Bridge-Only File Interaction

**Hard Rule:** OpenClaw can only interact with files inside the bridge directories unless the user explicitly exports.

### Enforcement Layers

1. **Configuration**: `workspace_root` points to the bridge, not to `D:\ProjectsHome`.
2. **NTFS ACLs** (if using restricted user): The user running OpenClaw cannot read `D:\ProjectsHome` except the enclave subtree.
3. **OpenClaw system prompt**: Includes instructions that restrict file access (see Deliverable N).
4. **Bridge scripts**: Export and apply scripts validate all paths against the policy.

### What OpenClaw CAN Do

- Read files in `workspace_bridge\inbox\`
- Write files to `workspace_bridge\outbox\`
- Use `workspace_bridge\scratch\` for temporary work
- Read its own configuration in `openclaw\config\`
- Write logs to `logs\openclaw\`

### What OpenClaw CANNOT Do

- Read any file in `D:\ProjectsHome\` outside the enclave
- Write any file outside the enclave
- Execute shell commands that access files outside the enclave
- Modify its own configuration files (read-only)
- Modify policy files (read-only)
- Modify scripts (read-only)

## R4. Logging Strategy

### What IS Logged

```yaml
# OpenClaw logging configuration
log_level: INFO

# Safe to log:
log_operations: true          # "Read file inbox/MyProject/main.py"
log_timestamps: true          # When operations occurred
log_file_paths: true          # Which files were accessed (paths only)
log_file_sizes: true          # Size of files processed
log_errors: true              # Error messages and stack traces
log_policy_violations: true   # Attempted access outside boundaries
log_model_requests: false     # Do NOT log prompt text sent to model
log_model_responses: false    # Do NOT log model output text
```

### What is NOT Logged

- **Prompt contents**: The actual text sent to Qwen. This could contain source code from the inbox.
- **Model responses**: The actual text returned by Qwen. This is written to outbox as files, not logged.
- **Source code**: Any code content from inbox files.
- **Secrets**: Even if secrets pass through (they should not due to scanning), they must not be logged.
- **Diff contents**: Stored as separate diff files in `diffs\`, not in the main log.

### Log Rotation

```powershell
# Manual log rotation (no automatic rotation to avoid data loss)
$logDir = "D:\ProjectsHome\LLM_Enclave\QWEN35\logs\openclaw"
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"

# Archive current logs
$archiveDir = "$logDir\archive_$timestamp"
New-Item -ItemType Directory -Path $archiveDir -Force
Get-ChildItem -Path $logDir -Filter "*.log" | ForEach-Object {
    Move-Item -Path $_.FullName -Destination $archiveDir
}
Write-Host "Logs archived to $archiveDir"
```

## R5. "No Plugins Unless Verified" Stance

### Default: All Plugins Disabled

```yaml
# In OpenClaw config
plugin_loading_enabled: false
mcp_servers_enabled: false
extensions_enabled: false
connectors_enabled: false
```

### Enabling a Plugin

Before enabling any plugin, extension, connector, or MCP server:

1. **Obtain the source code** and review it locally.
2. **Compute SHA256** of all plugin files.
3. **Record the hash** in a verified plugins file:

```powershell
$pluginPath = "path\to\plugin\file"
$hash = (Get-FileHash -Path $pluginPath -Algorithm SHA256).Hash
"$hash  $(Split-Path $pluginPath -Leaf)  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  VERIFIED" | `
    Add-Content -Path "D:\ProjectsHome\LLM_Enclave\QWEN35\hashes\verified_plugins.txt"
```

4. **Verify the plugin does not**:
   - Require network access
   - Access files outside the enclave
   - Execute arbitrary shell commands
   - Modify system configuration
   - Include telemetry or analytics

5. **Add to the verified allowlist**:

```yaml
# In OpenClaw config
verified_plugins:
  - name: "plugin_name"
    hash: "sha256:HASH_HERE"
    verified_date: "2025-01-15"
    verified_by: "Lance"
    review_notes: "Reviewed source code, no network calls, no file access outside bridge"
```

6. **Enable plugin loading** only if at least one verified plugin is configured:

```yaml
plugin_loading_enabled: true  # Only after at least one plugin is verified
```

### MCP Server Policy

```
MCP servers are treated with the HIGHEST level of suspicion because they can:
- Execute arbitrary tool calls
- Access the filesystem
- Make network requests
- Interact with other processes

RULES:
1. No MCP server is enabled by default.
2. Each MCP server must be reviewed, hashed, and explicitly approved.
3. MCP servers must run within the enclave boundary.
4. MCP servers must be subject to the same firewall rules.
5. MCP servers must not have access to directories outside the bridge.
6. Any MCP server that requires network access is REJECTED unless there is
   an explicit, documented exception approved by the user.
```
