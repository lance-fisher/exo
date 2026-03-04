# GitHub Workflow Guide - LLM Enclave

## Overview

This guide describes how to safely use GitHub within the LLM Enclave security model.
All GitHub operations follow the principle of least privilege and explicit opt-in.

## Default State: Offline

By default, git.exe and ssh.exe are blocked from making outbound connections.
This prevents accidental pushes, credential leaks, or unintended data exposure.

- Local git operations (status, log, diff, add, commit) always work.
- Remote git operations (push, pull, fetch, clone) require a sync window.

## Workflow

### Step 1: Work Locally

1. Export project files to the bridge inbox using `04_export_to_bridge.ps1`.
2. Let Qwen/OpenClaw process them and produce output in the outbox.
3. Review diffs and apply changes using `05_apply_changes.ps1`.
4. Manually run `git add` and `git commit` in your project directory.

### Step 2: Open Sync Window (When Ready to Push/Pull)

```powershell
# Run as Administrator
& "D:\ProjectsHome\LLM_Enclave\QWEN35\scripts\08_open_github_sync_window.ps1"

# You will be prompted to type: OPEN SYNC WINDOW
# Default timeout: 15 minutes
```

### Step 3: Perform Git Operations

```powershell
cd "D:\ProjectsHome\MyProject"

# Pull latest changes
git fetch origin main
git log HEAD..origin/main --oneline
# Review incoming changes, then merge if appropriate:
git merge origin/main

# Push your changes
git status
git diff HEAD~1..HEAD
git log --oneline -5

# Push requires manual confirmation (see below)
```

### Step 4: Push Confirmation

Every push to GitHub requires you to type the exact confirmation string:

```
Lance Confirms Git Push
```

Use the safe push helper:
```powershell
# This shows diff, status, and requires typed confirmation
Invoke-SafeGitPush -RepoPath "D:\ProjectsHome\MyProject" -Branch "main"
```

### Step 5: Close Sync Window

```powershell
# Run as Administrator
& "D:\ProjectsHome\LLM_Enclave\QWEN35\scripts\09_close_github_sync_window.ps1"
```

If you forget, the window auto-closes after the timeout (default: 15 minutes).

## Credential Handling

### Preferred: SSH Keys

- Use ed25519 keys: `ssh-keygen -t ed25519`
- Store keys in `%USERPROFILE%\.ssh\`
- Use ssh-agent for passphrase management
- Add public key to GitHub Settings > SSH Keys

### Alternative: Windows Credential Manager

- Configure: `git config --global credential.helper manager`
- Credentials stored in Windows Credential Manager
- Remove with: `cmdkey /delete:git:https://github.com`

### Prohibited

- NEVER store tokens in scripts
- NEVER store tokens in environment variables
- NEVER store tokens in the enclave directory
- NEVER use inline tokens in git URLs
- NEVER pass tokens as command-line arguments

## Security Rules

1. The model (Qwen/OpenClaw) NEVER runs git commands.
2. Git operations are always manual, by you, in your normal terminal.
3. No push without typed confirmation string.
4. No remote operations without an open sync window.
5. Sync windows are time-bounded and logged.
6. All git operations are logged to `logs\audit\git_operations.log`.

## Audit Log

All sync window operations are recorded in:
```
D:\ProjectsHome\LLM_Enclave\QWEN35\logs\audit\network_access.log
D:\ProjectsHome\LLM_Enclave\QWEN35\logs\audit\git_operations.log
```

## Troubleshooting

### Push/Pull fails with "connection refused"
- The sync window is not open. Run `08_open_github_sync_window.ps1`.

### Sync window closed unexpectedly
- The auto-revert timer expired. Open a new window.

### Firewall rules not found
- Run `08_open_github_sync_window.ps1` as Administrator. It creates rules if missing.

### SSH key not working
- Verify ssh-agent is running: `Get-Service ssh-agent`
- Verify key is loaded: `ssh-add -l`
- Verify GitHub can see the key: `ssh -T git@github.com` (requires sync window)
