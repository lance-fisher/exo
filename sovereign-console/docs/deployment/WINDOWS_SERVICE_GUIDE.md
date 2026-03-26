# Sovereign Operator Console: Windows Service Guide (Local Agent)

> **Governance notice.** This document defers to and must not contradict the root governance rules in `D:\ProjectsHome\CLAUDE.md` (Sections 0.6, 6, 13), `docs/architecture/SENSITIVE_PATHS.md`, `docs/architecture/AGENT_BOUNDARIES.md`, and `docs/architecture/APPROVAL_POLICY.md`. Security rules in this guide may only tighten root protections, never loosen them.

## Overview

The local agent runs as a Windows service managed by WinSW (Windows Service Wrapper). It connects to the VPS-hosted broker over a mutual TLS WebSocket, executes file operations and Claude Code tasks within governed scope boundaries, and reports results back through the broker to the console UI.

This guide covers installation, configuration, management, and troubleshooting of the local agent as a Windows service.

## Prerequisites

| Requirement | Details |
|---|---|
| **Operating System** | Windows 10 Pro or Windows 11 Pro |
| **Node.js** | 20.x LTS or later, on PATH |
| **WinSW** | v3.x binary. Download from https://github.com/winsw/winsw/releases. Rename to `winsw.exe`. |
| **Claude Code CLI** | Installed and authenticated. Verify: `claude --version` |
| **mTLS Certificates** | `ca.pem`, `agent.pem`, `agent-key.pem` from the CA generation step (see `DEPLOYMENT_GUIDE.md` Step 3) |
| **Outbound network** | HTTPS/WSS access to `ops.lancewfisher.com:443` |
| **Admin privileges** | Required for service installation and service account creation |

## Directory Layout

After installation, the local agent directory should look like this:

```
D:\ProjectsHome\sovereign-console-workspace\sovereign-console\local-agent\
├── dist\                    # Compiled JavaScript (from npm run build)
│   └── index.js             # Service entry point
├── certs\                   # mTLS certificates (NEVER committed to git)
│   ├── ca.pem               # CA certificate
│   ├── agent.pem            # Agent certificate
│   └── agent-key.pem        # Agent private key (chmod 600 equivalent)
├── logs\                    # Service log output
│   ├── agent.log            # Application log (written by winston)
│   ├── service.out.log      # WinSW stdout capture
│   └── service.err.log      # WinSW stderr capture
├── node_modules\            # Dependencies
├── src\                     # TypeScript source
├── .env                     # Environment configuration (NEVER committed)
├── .env.example             # Template
├── package.json
├── sovereign-agent.xml      # WinSW service descriptor
└── winsw.exe                # WinSW binary (renamed from WinSW-x64.exe)
```

## Step 1: Service Account Creation

Create a dedicated local Windows user account for the service. This limits the blast radius if the service is compromised.

Open an elevated PowerShell prompt:

```powershell
# Create the service account (no interactive login, password never expires)
$password = ConvertTo-SecureString -String "<strong-random-password>" -AsPlainText -Force
New-LocalUser -Name "SovereignAgent" -Password $password -Description "Sovereign Console local agent service account" -PasswordNeverExpires -UserMayNotChangePassword

# Add to Users group (minimal privileges)
Add-LocalGroupMember -Group "Users" -Member "SovereignAgent"
```

Grant the service account the required filesystem permissions:

```powershell
# Read+Execute on the agent installation directory
icacls "D:\ProjectsHome\sovereign-console-workspace\sovereign-console\local-agent" /grant "SovereignAgent:(OI)(CI)RX" /T

# Full control on the logs directory
icacls "D:\ProjectsHome\sovereign-console-workspace\sovereign-console\local-agent\logs" /grant "SovereignAgent:(OI)(CI)F" /T

# Read on the certs directory
icacls "D:\ProjectsHome\sovereign-console-workspace\sovereign-console\local-agent\certs" /grant "SovereignAgent:(OI)(CI)R" /T

# Read+Write on project directories the agent is allowed to access
# (adjust per ALLOWED_PROJECTS in .env)
icacls "D:\ProjectsHome" /grant "SovereignAgent:(OI)(CI)RX" /T
```

Grant the "Log on as a service" right:

```powershell
# Using ntrights (from Windows Server Resource Kit) or secpol.msc:
# Local Security Policy -> Local Policies -> User Rights Assignment
# -> "Log on as a service" -> Add SovereignAgent
```

Alternatively, use Group Policy Editor (`gpedit.msc`): navigate to Computer Configuration, Windows Settings, Security Settings, Local Policies, User Rights Assignment, "Log on as a service", and add `.\SovereignAgent`.

## Step 2: Build the Agent

```powershell
cd D:\ProjectsHome\sovereign-console-workspace\sovereign-console\local-agent

# Install dependencies
npm ci

# Compile TypeScript to dist/
npm run build

# Verify the build
node dist/index.js --version 2>$null; if ($LASTEXITCODE -eq 0) { Write-Host "Build OK" }
```

## Step 3: Configure Environment

Copy the example file and fill in all values:

```powershell
Copy-Item .env.example .env
```

Edit `.env` with the production values:

```env
# Broker connection
BROKER_WS_URL=wss://ops.lancewfisher.com/ws/agent
AGENT_ID=agent-001
AGENT_SECRET=<generate: openssl rand -hex 16>

# mTLS certificates
MTLS_CA_CERT=certs/ca.pem
MTLS_CERT=certs/agent.pem
MTLS_KEY=certs/agent-key.pem

# Project scope
PROJECTS_ROOT=D:\ProjectsHome
ALLOWED_PROJECTS=<comma-separated list of project directory names>
PROTECTED_PATHS=.env*,*.key,*.pem,*.p12,.git/config,credentials*,**/secrets/**,**/node_modules/**

# Claude Code
CLAUDE_CLI_PATH=claude
MAX_TOKENS_PER_TASK=50000
MAX_TASKS_PER_SESSION=20
DAILY_SPEND_THRESHOLD=100000
CLAUDE_TASK_TIMEOUT_MS=300000

# Logging
LOG_PATH=logs/agent.log
LOG_LEVEL=info

# Service account
SERVICE_ACCOUNT_NAME=.\SovereignAgent
```

See `DEPLOYMENT_GUIDE.md` for the complete environment variable reference.

## Step 4: WinSW Service Descriptor

Create `sovereign-agent.xml` in the `local-agent/` directory. This file tells WinSW how to manage the service.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<service>
  <!-- Service identity -->
  <id>SovereignAgent</id>
  <name>Sovereign Console Local Agent</name>
  <description>Local agent for the Sovereign Operator Console. Connects to the VPS broker over mTLS WebSocket, executes governed file operations and Claude Code tasks.</description>

  <!-- Executable and arguments -->
  <executable>node</executable>
  <arguments>dist/index.js</arguments>

  <!-- Working directory -->
  <workingdirectory>D:\ProjectsHome\sovereign-console-workspace\sovereign-console\local-agent</workingdirectory>

  <!-- Service account -->
  <serviceaccount>
    <username>.\SovereignAgent</username>
    <password><service-account-password></password>
    <allowservicelogon>true</allowservicelogon>
  </serviceaccount>

  <!-- Logging -->
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>5</keepFiles>
  </log>
  <logpath>D:\ProjectsHome\sovereign-console-workspace\sovereign-console\local-agent\logs</logpath>

  <!-- Restart policy: 10s, then 30s, then 60s. Reset failure counter after 1 hour. -->
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <onfailure action="restart" delay="60 sec" />
  <resetfailure>1 hour</resetfailure>

  <!-- Environment variables (loaded from .env by the agent, but NODE_ENV is set here) -->
  <env name="NODE_ENV" value="production" />

  <!-- Startup type -->
  <startmode>Automatic</startmode>

  <!-- Stop timeout: give the agent time to close WebSocket gracefully -->
  <stoptimeout>15 sec</stoptimeout>

  <!-- Priority -->
  <priority>Normal</priority>
</service>
```

**Field reference:**

| Field | Purpose |
|---|---|
| `<id>` | Internal Windows service ID. Used with `sc query`, `Get-Service`, etc. |
| `<name>` | Human-readable service name displayed in `services.msc`. |
| `<description>` | Longer description shown in service properties. |
| `<executable>` | The binary to run. `node` must be on the system PATH. |
| `<arguments>` | Arguments passed to the executable. Points to the compiled entry file. |
| `<workingdirectory>` | Working directory for the process. The agent loads `.env` from this directory. |
| `<serviceaccount>` | Windows account the service runs under. `allowservicelogon` grants the "Log on as a service" right if not already set. |
| `<log mode="roll-by-size">` | WinSW's own stdout/stderr log rotation. Rolls at 10 MB, keeps 5 files. |
| `<logpath>` | Directory for WinSW's stdout/stderr capture files (`service.out.log`, `service.err.log`). |
| `<onfailure>` | Restart escalation. First failure: wait 10s. Second: 30s. Third and beyond: 60s. |
| `<resetfailure>` | Reset the failure counter after 1 hour of successful operation. |
| `<startmode>` | `Automatic` starts the service on system boot. |
| `<stoptimeout>` | Seconds to wait for graceful shutdown before killing the process. |

## Step 5: Install the Service

The `scripts/install-service.ps1` script (when created) automates this process. Until that script exists, install manually:

```powershell
cd D:\ProjectsHome\sovereign-console-workspace\sovereign-console\local-agent

# Place the WinSW binary in the agent directory
# (Download from https://github.com/winsw/winsw/releases, rename to winsw.exe)

# Install the service
.\winsw.exe install sovereign-agent.xml

# Start the service
.\winsw.exe start sovereign-agent.xml

# Verify
Get-Service SovereignAgent
```

Expected output:

```
Status   Name               DisplayName
------   ----               -----------
Running  SovereignAgent     Sovereign Console Local Agent
```

### What install-service.ps1 does (walkthrough)

When `scripts/install-service.ps1` exists, it performs these steps in order:

1. Verifies Node.js 20+ is installed and on PATH
2. Verifies `winsw.exe` is present in the `local-agent/` directory
3. Verifies `sovereign-agent.xml` is present and valid
4. Checks that `local-agent/.env` exists and contains required variables
5. Verifies mTLS certificate files exist in `certs/`
6. Creates the `logs/` directory if it does not exist
7. Runs `npm ci --production` if `node_modules/` is missing
8. Runs `npm run build` if `dist/` is missing or older than `src/`
9. Executes `winsw.exe install sovereign-agent.xml`
10. Executes `winsw.exe start sovereign-agent.xml`
11. Waits 5 seconds and checks service status
12. Tests broker connectivity by inspecting agent logs for a successful WebSocket handshake

## Uninstall Procedure

```powershell
cd D:\ProjectsHome\sovereign-console-workspace\sovereign-console\local-agent

# Stop the service first
.\winsw.exe stop sovereign-agent.xml

# Uninstall
.\winsw.exe uninstall sovereign-agent.xml

# Verify
Get-Service SovereignAgent
# Expected: error indicating service does not exist
```

To also remove the service account:

```powershell
Remove-LocalUser -Name "SovereignAgent"
```

## Log File Locations and Rotation

The local agent produces logs in two locations:

### Application logs (winston)

| File | Location | Content |
|---|---|---|
| `agent.log` | `local-agent/logs/agent.log` | Structured application logs (JSON format). Broker connection events, command execution, governance decisions, errors. |

The application log path is configured via `LOG_PATH` in `.env`. Log level is controlled by `LOG_LEVEL`. The application does not currently implement log rotation natively. Use an external tool (e.g., `logrotate` equivalent for Windows, or a scheduled task) to manage application log file size.

### WinSW service logs

| File | Location | Content |
|---|---|---|
| `service.out.log` | `local-agent/logs/service.out.log` | Captured stdout from the Node.js process |
| `service.err.log` | `local-agent/logs/service.err.log` | Captured stderr from the Node.js process |
| `service.wrapper.log` | `local-agent/logs/service.wrapper.log` | WinSW's own lifecycle events (start, stop, restart, failures) |

WinSW log rotation is configured in `sovereign-agent.xml`:

- **Rotation trigger:** File reaches 10 MB (`<sizeThreshold>10240</sizeThreshold>` in KB)
- **Retention:** 5 rotated files kept (`<keepFiles>5</keepFiles>`)
- **Total maximum disk usage:** ~50 MB per log file (5 rotations x 10 MB)

## Restart Policy

The service is configured with an escalating restart policy for crash recovery:

| Failure # | Action | Delay |
|---|---|---|
| 1st | Restart | 10 seconds |
| 2nd | Restart | 30 seconds |
| 3rd+ | Restart | 60 seconds |

The failure counter resets to zero after 1 hour of continuous successful operation (`<resetfailure>1 hour</resetfailure>`).

This means:
- Transient failures (network blip, temporary broker unavailability) recover quickly
- Persistent failures (bad config, missing certs) do not spin in a tight restart loop
- After the third restart attempt, the service retries every 60 seconds indefinitely until the issue is resolved or an administrator intervenes

To view the current failure count:

```powershell
sc qfailure SovereignAgent
```

To manually reset the failure counter:

```powershell
sc failure SovereignAgent reset= 0 actions= restart/10000/restart/30000/restart/60000
```

## Troubleshooting

### Service won't start

**Symptom:** `Get-Service SovereignAgent` shows `Stopped`. WinSW reports install succeeded but service fails immediately.

**Check these in order:**

1. **Node.js on PATH for the service account.**
   ```powershell
   # Test by running as the service account
   runas /user:.\SovereignAgent "cmd /c node --version"
   ```
   If Node.js is not found, the system PATH may not include the Node.js directory for all users. Add it to the system-level PATH (not the user-level PATH).

2. **Working directory exists and is readable.**
   ```powershell
   icacls "D:\ProjectsHome\sovereign-console-workspace\sovereign-console\local-agent"
   ```
   The `SovereignAgent` account needs at least Read+Execute.

3. **Compiled output exists.**
   ```powershell
   Test-Path "D:\ProjectsHome\sovereign-console-workspace\sovereign-console\local-agent\dist\index.js"
   ```
   If missing, run `npm run build` in the `local-agent/` directory.

4. **Environment file exists and is valid.**
   ```powershell
   Test-Path "D:\ProjectsHome\sovereign-console-workspace\sovereign-console\local-agent\.env"
   ```
   The agent validates all environment variables at startup using Zod. Check `service.err.log` for validation errors.

5. **Check WinSW wrapper log.**
   ```powershell
   Get-Content "D:\ProjectsHome\sovereign-console-workspace\sovereign-console\local-agent\logs\service.wrapper.log" -Tail 30
   ```

### Certificate errors

**Symptom:** Agent starts but immediately fails with TLS/SSL errors. Broker logs show "client certificate required" or "unknown CA".

1. **Verify certificate files exist.**
   ```powershell
   Get-ChildItem "D:\ProjectsHome\sovereign-console-workspace\sovereign-console\local-agent\certs\"
   # Should show: ca.pem, agent.pem, agent-key.pem
   ```

2. **Verify certificates are not expired.**
   ```powershell
   # Using OpenSSL (install via Git Bash or standalone)
   openssl x509 -in certs\agent.pem -noout -dates
   openssl x509 -in certs\ca.pem -noout -dates
   ```

3. **Verify the agent cert was signed by the same CA the broker trusts.**
   ```powershell
   openssl verify -CAfile certs\ca.pem certs\agent.pem
   # Expected: certs\agent.pem: OK
   ```

4. **Verify paths in `.env` match actual file locations.**
   The `MTLS_CA_CERT`, `MTLS_CERT`, and `MTLS_KEY` values can be relative (to the working directory) or absolute. If relative, they resolve from `local-agent/`.

5. **Verify file permissions.** The `SovereignAgent` account must be able to read the cert files.

### Connection failures

**Symptom:** Agent starts, certificates load, but it cannot connect to the broker. Logs show connection timeout or WebSocket handshake failure.

1. **Verify broker is reachable from this machine.**
   ```powershell
   Test-NetConnection -ComputerName ops.lancewfisher.com -Port 443
   ```

2. **Verify the `BROKER_WS_URL` is correct.**
   ```powershell
   # Should be: wss://ops.lancewfisher.com/ws/agent
   Select-String "BROKER_WS_URL" .env
   ```

3. **Check if a firewall or proxy is blocking WSS.**
   ```powershell
   # Test raw HTTPS
   Invoke-WebRequest -Uri "https://ops.lancewfisher.com/api/health" -UseBasicParsing
   ```

4. **Check broker-side logs for the connection attempt.**
   ```bash
   # On VPS
   cd /opt/sovereign-console
   docker compose logs broker --tail 50 | grep -i agent
   ```

5. **Verify NGINX is proxying the `/ws/agent` path correctly.** The mTLS client certificate verification happens at the NGINX layer for the `/ws/agent` location block. If NGINX is misconfigured, the connection will fail before reaching the broker.

### Agent connects but commands fail

1. **Check `ALLOWED_PROJECTS` matches actual directory names.** The agent resolves project paths under `PROJECTS_ROOT`. If a directory name in `ALLOWED_PROJECTS` does not match an actual directory, operations targeting that project will be rejected by the governance layer.

2. **Check `PROTECTED_PATHS` is not blocking legitimate operations.** Review the governance rejection log entries in `agent.log`.

3. **Check Claude Code CLI is accessible.** The service account must be able to run `claude` from its PATH. If Claude Code is installed per-user (not system-wide), the service account may not have access.

## Verifying Service Health

### Quick check

```powershell
Get-Service SovereignAgent | Format-List Status, StartType, CanStop
```

### Detailed status

```powershell
# Service status
sc query SovereignAgent

# Recent log output
Get-Content "D:\ProjectsHome\sovereign-console-workspace\sovereign-console\local-agent\logs\agent.log" -Tail 20

# WinSW stderr (errors)
Get-Content "D:\ProjectsHome\sovereign-console-workspace\sovereign-console\local-agent\logs\service.err.log" -Tail 20

# Check from the broker side (on VPS)
# curl -sf https://ops.lancewfisher.com/api/agent/status
```

### Monitoring checklist

- [ ] Service status is `Running`
- [ ] No errors in `service.err.log` within the last hour
- [ ] `agent.log` shows recent heartbeat or keepalive messages
- [ ] Broker reports agent as connected (check console UI dashboard or broker API)
- [ ] Certificate expiry is more than 30 days away
