# DELIVERABLE N: OpenClaw Workflow Integration with Workspace Bridge

## Core Principle

OpenClaw interacts with your projects ONLY through the Workspace Bridge. It never directly reads or writes live project repositories.

```
+-------------------+      +-------------------+      +-------------------+
|                   |      |   WORKSPACE       |      |                   |
|  YOUR PROJECTS    | ---> |   BRIDGE          | ---> |  OPENCLAW +       |
|  D:\ProjectsHome\ |      |   inbox/          |      |  QWEN LOCAL       |
|                   | <--- |   outbox/         | <--- |                   |
|  (READ ONLY       |      |   scratch/        |      |  (reads inbox,    |
|   VIA EXPORT)     |      |                   |      |   writes outbox)  |
+-------------------+      +-------------------+      +-------------------+
        ^                           |
        |                           v
        +--- 05_apply_changes.ps1 --+
             (diff + confirm + backup)
```

## Workflow Steps

### 1. Export Files for OpenClaw to Work On

```powershell
# Export specific files from your project into the bridge inbox
& "D:\ProjectsHome\LLM_Enclave\QWEN35\scripts\04_export_to_bridge.ps1" `
    -SourcePath "D:\ProjectsHome\MyProject\src\main.py" `
    -ProjectLabel "MyProject"

# Export a directory
& "D:\ProjectsHome\LLM_Enclave\QWEN35\scripts\04_export_to_bridge.ps1" `
    -SourcePath "D:\ProjectsHome\MyProject\src\" `
    -Recursive `
    -ProjectLabel "MyProject"
```

### 2. OpenClaw Reads from Inbox

OpenClaw is configured to look for input files in:
```
D:\ProjectsHome\LLM_Enclave\QWEN35\workspace_bridge\inbox\
```

It reads the files, processes them with Qwen via Ollama, and produces output.

### 3. OpenClaw Writes to Outbox

All model-generated outputs go to:
```
D:\ProjectsHome\LLM_Enclave\QWEN35\workspace_bridge\outbox\
```

OpenClaw must NEVER:
- Write directly to `D:\ProjectsHome\` or any project directory
- Execute shell commands that modify files outside the bridge
- Create symlinks pointing outside the enclave
- Access files outside `inbox\`, `outbox\`, `scratch\`, and enclave internals

### 4. Review and Apply Changes

```powershell
# Review diffs and apply changes with manual confirmation
& "D:\ProjectsHome\LLM_Enclave\QWEN35\scripts\05_apply_changes.ps1" `
    -OutboxPath "D:\ProjectsHome\LLM_Enclave\QWEN35\workspace_bridge\outbox\MyProject" `
    -TargetPath "D:\ProjectsHome\MyProject"
```

The apply script:
1. Checks the target path against the policy allowlist
2. Generates diffs for all changed files
3. Displays diffs for your review
4. Requires you to type "CONFIRM APPLY" to proceed
5. Creates backups of all files being replaced
6. Copies the new files into place
7. Logs the entire operation

## Policy Enforcement

OpenClaw is subject to the SAME policy file as all other bridge operations:
`D:\ProjectsHome\LLM_Enclave\QWEN35\policies\bridge_policy.yaml`

This means:
- All deny patterns apply (no .key, .pem, .env files)
- All size limits apply
- All extension restrictions apply
- Secret scanning applies to both import and export
- The `policy_not_configured` flag must be set to `false` before any apply works

## No Direct Editing

**RULE:** OpenClaw must never be configured with direct write access to any path outside:
- `D:\ProjectsHome\LLM_Enclave\QWEN35\workspace_bridge\outbox\`
- `D:\ProjectsHome\LLM_Enclave\QWEN35\workspace_bridge\scratch\`
- `D:\ProjectsHome\LLM_Enclave\QWEN35\logs\`

If OpenClaw has a configuration option for "workspace" or "project root", it must be set to the bridge directory, NEVER to `D:\ProjectsHome\` or any live project.

## OpenClaw Agent Instructions

When configuring OpenClaw as an agent runner, include these system-level instructions:

```
SYSTEM RULES FOR OPENCLAW AGENT:
1. You may ONLY read files in the workspace_bridge/inbox/ directory.
2. You may ONLY write files to the workspace_bridge/outbox/ directory.
3. You may use workspace_bridge/scratch/ for temporary work.
4. You must NEVER attempt to access files outside these directories.
5. You must NEVER execute shell commands that modify the filesystem outside these directories.
6. You must NEVER create symlinks.
7. All file paths you generate must be relative to workspace_bridge/outbox/.
8. If you need additional context from a project, ask the user to export it to inbox.
9. You must NEVER attempt to access the internet or make network calls.
10. You must NEVER modify the enclave configuration, policies, or scripts.
```

## Logging

All OpenClaw operations are logged to:
```
D:\ProjectsHome\LLM_Enclave\QWEN35\logs\openclaw\
```

Logging rules:
- Log file paths, timestamps, and operation types
- Do NOT log prompt contents or model responses
- Do NOT log source code contents
- Log errors and policy violations with full detail
- Log bridge operations (what was read from inbox, what was written to outbox)
