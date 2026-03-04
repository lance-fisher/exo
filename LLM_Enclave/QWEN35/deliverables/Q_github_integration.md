# DELIVERABLE Q: GitHub Integration Without Expanding Trust Boundary

## Q1. Default: Offline Operation

**Rule:** No GitHub API calls, no git fetch, no git push by default.

The enclave and all its processes (Ollama, OpenClaw, bridge scripts) operate entirely offline. GitHub is not contacted unless the user explicitly opens a sync window.

Git operations within the enclave are local-only:
- `git status` -- works offline
- `git log` -- works offline
- `git diff` -- works offline
- `git add` / `git commit` -- works offline

Operations that require network (blocked by default):
- `git push` -- requires sync window
- `git pull` / `git fetch` -- requires sync window
- `gh` CLI commands -- requires sync window
- Any GitHub API call -- requires sync window

## Q2. Local Git Operations Against Cloned Repos

The system can interact with repos already cloned under `D:\ProjectsHome`, but only through the Workspace Bridge:

1. Files are exported FROM the cloned repo INTO the bridge inbox.
2. The model works on copies in the bridge.
3. Changes are proposed in the outbox.
4. Changes are applied to the cloned repo via the apply script (with diffs and confirmation).
5. Git operations (add, commit) happen in the cloned repo directly by you (not by the model or OpenClaw).

**The model never runs git commands.** Git operations are always manual, performed by the user in their normal terminal.

## Q3. Opt-In "GitHub Sync Window"

A sync window is a time-bounded period during which git.exe and ssh.exe are temporarily allowed outbound network access.

### Opening a Sync Window

```powershell
# Run the sync window script
& "D:\ProjectsHome\LLM_Enclave\QWEN35\scripts\08_open_github_sync_window.ps1"

# This will:
# 1. Ask for confirmation
# 2. Temporarily disable outbound block for git.exe and ssh.exe
# 3. Set a timer (default: 15 minutes)
# 4. Schedule automatic re-block
# 5. Log the event
```

### During the Sync Window

You can perform:
- `git pull origin main`
- `git push origin feature-branch`
- `git fetch --all`
- `gh pr create` (if gh CLI is installed)

### Closing the Sync Window

```powershell
# Manually close the sync window (do not wait for auto-close)
& "D:\ProjectsHome\LLM_Enclave\QWEN35\scripts\09_close_github_sync_window.ps1"

# This will:
# 1. Re-enable outbound block for git.exe and ssh.exe
# 2. Verify the block is active
# 3. Log the event
```

## Q4. Least Privilege Git Credential Handling

### SSH Keys (Preferred)

```powershell
# Use SSH keys stored securely
# 1. Generate a key (if not already done):
ssh-keygen -t ed25519 -C "your_email@example.com"

# 2. Add the public key to GitHub: Settings > SSH Keys

# 3. Use ssh-agent for key management:
# Start the ssh-agent service
Get-Service ssh-agent | Set-Service -StartupType Manual
Start-Service ssh-agent

# Add your key to the agent (it will prompt for passphrase)
ssh-add "$env:USERPROFILE\.ssh\id_ed25519"

# 4. Configure git to use SSH:
git config --global url."git@github.com:".insteadOf "https://github.com/"
```

### Windows Credential Manager (Alternative)

```powershell
# Git can use Windows Credential Manager to store HTTPS credentials
git config --global credential.helper manager

# Credentials are stored in Windows Credential Manager, accessible via:
# Control Panel > User Accounts > Credential Manager > Windows Credentials

# To remove stored credentials:
# cmdkey /delete:git:https://github.com
```

### Prohibited Practices

```
NEVER DO:
- Store GitHub tokens in any script file
- Store GitHub tokens in environment variables
- Store GitHub tokens in the enclave directory
- Use inline tokens in git URLs (e.g., https://TOKEN@github.com/...)
- Store .netrc or .git-credentials files with plaintext tokens
- Pass tokens as command-line arguments (visible in process list)
```

## Q5. Bridge Workflow Still Applies

Even for GitHub-related work:
1. The model reads project files from the bridge inbox (exported copies).
2. The model writes proposed changes to the bridge outbox.
3. You review diffs and apply changes via the apply script.
4. You manually run `git add`, `git commit` in the real repo.
5. You manually run `git push` during a sync window.

The model and OpenClaw NEVER run git commands. They have no git credentials and no network access.

## Q6. Manual Push Gate

Every push to GitHub must be manually confirmed with a specific confirmation string.

### Push Verification Workflow

```powershell
# Before pushing, review what will be pushed:
function Invoke-SafeGitPush {
    param(
        [Parameter(Mandatory=$true)]
        [string]$RepoPath,

        [Parameter(Mandatory=$true)]
        [string]$Branch
    )

    Set-Location $RepoPath

    # Show status
    Write-Host "=== Git Status ===" -ForegroundColor Cyan
    git status

    # Show diff of what will be pushed
    Write-Host "`n=== Changes to Push ===" -ForegroundColor Cyan
    git log "origin/$Branch..HEAD" --oneline 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "(Cannot compare with remote -- remote may not be available)"
        git log --oneline -5
    }

    Write-Host "`n=== Diff ===" -ForegroundColor Cyan
    git diff "origin/$Branch..HEAD" 2>$null
    if ($LASTEXITCODE -ne 0) {
        git diff HEAD~1..HEAD
    }

    # Require explicit confirmation
    Write-Host "`n========================================" -ForegroundColor Yellow
    Write-Host "You are about to push to: $Branch" -ForegroundColor Yellow
    Write-Host "Repository: $RepoPath" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Yellow

    $confirm = Read-Host "Type 'Lance Confirms Git Push' to proceed"
    if ($confirm -ne "Lance Confirms Git Push") {
        Write-Host "Push CANCELLED. No changes were pushed." -ForegroundColor Red
        return
    }

    # Verify sync window is open
    $gitRule = Get-NetFirewallRule -DisplayName "LLM_Enclave: Block Git Outbound" -ErrorAction SilentlyContinue
    if ($gitRule -and $gitRule.Enabled -eq "True") {
        Write-Error "Sync window is CLOSED. Open it first with 08_open_github_sync_window.ps1"
        return
    }

    # Push
    git push origin $Branch
    $pushResult = $LASTEXITCODE

    if ($pushResult -eq 0) {
        Write-Host "Push SUCCESSFUL." -ForegroundColor Green
    } else {
        Write-Error "Push FAILED. Check git output above."
    }

    # Log the push
    $logEntry = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | GIT_PUSH | Repo=$RepoPath | Branch=$Branch | Result=$(if ($pushResult -eq 0) {'SUCCESS'} else {'FAILED'})"
    Add-Content -Path "D:\ProjectsHome\LLM_Enclave\QWEN35\logs\audit\git_operations.log" -Value $logEntry
}
```

## Q7. Safe Pull/Push Helper Scripts

These are provided as convenience scripts. They do NOT run automatically.

### Safe Pull

```powershell
function Invoke-SafeGitPull {
    param(
        [Parameter(Mandatory=$true)]
        [string]$RepoPath,

        [string]$Branch = "main"
    )

    # Verify sync window is open
    $gitRule = Get-NetFirewallRule -DisplayName "LLM_Enclave: Block Git Outbound" -ErrorAction SilentlyContinue
    if ($gitRule -and $gitRule.Enabled -eq "True") {
        Write-Error "Sync window is CLOSED. Open it first with 08_open_github_sync_window.ps1"
        return
    }

    Set-Location $RepoPath

    # Fetch first (safer than pull)
    Write-Host "Fetching from origin..." -ForegroundColor Cyan
    git fetch origin $Branch

    # Show what would change
    Write-Host "`n=== Incoming Changes ===" -ForegroundColor Cyan
    git log "HEAD..origin/$Branch" --oneline

    Write-Host "`n=== Diff ===" -ForegroundColor Cyan
    git diff "HEAD..origin/$Branch" --stat

    $confirm = Read-Host "Merge these changes? (yes/no)"
    if ($confirm -eq "yes") {
        git merge "origin/$Branch"
        Write-Host "Merge complete." -ForegroundColor Green
    } else {
        Write-Host "Merge cancelled. Changes are fetched but not merged." -ForegroundColor Yellow
    }

    # Log
    $logEntry = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') | GIT_PULL | Repo=$RepoPath | Branch=$Branch"
    Add-Content -Path "D:\ProjectsHome\LLM_Enclave\QWEN35\logs\audit\git_operations.log" -Value $logEntry
}
```

### Workflow Summary

```
1. Open sync window:  .\scripts\08_open_github_sync_window.ps1
2. Pull changes:      Invoke-SafeGitPull -RepoPath "D:\ProjectsHome\MyProject" -Branch "main"
3. Push changes:      Invoke-SafeGitPush -RepoPath "D:\ProjectsHome\MyProject" -Branch "feature-x"
4. Close sync window: .\scripts\09_close_github_sync_window.ps1
```
