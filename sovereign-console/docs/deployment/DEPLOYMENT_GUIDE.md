# Sovereign Operator Console: Deployment Guide

> **Governance notice.** This document defers to and must not contradict the root governance rules in `D:\ProjectsHome\CLAUDE.md` (Sections 0.6, 6, 13), `docs/architecture/SENSITIVE_PATHS.md`, `docs/architecture/AGENT_BOUNDARIES.md`, and `docs/architecture/APPROVAL_POLICY.md`. Security rules in this guide may only tighten root protections, never loosen them.

## Overview

This guide walks through end-to-end deployment of the Sovereign Operator Console, a single-operator development control plane with three components:

1. **Broker** (Fastify + PostgreSQL + Redis) on a Hostinger VPS
2. **Console UI** (Next.js 14 SPA) served alongside the broker on the same VPS
3. **Local Agent** (Node.js Windows service) on the operator's Windows machine

All traffic between components is encrypted. The broker faces the internet behind NGINX with Let's Encrypt TLS. The local agent connects to the broker over a mutual TLS (mTLS) WebSocket. Every write operation requires an explicit, single-use approval token.

## Prerequisites

### VPS (Broker + Console UI)

| Requirement | Minimum |
|---|---|
| Provider | Hostinger VPS (or equivalent) |
| OS | Ubuntu 22.04 LTS |
| RAM | 2 GB |
| Disk | 40 GB SSD |
| CPU | 2 vCPU |
| Domain | `ops.lancewfisher.com` with DNS A record pointing to VPS IP |
| Ports open inbound | 22 (SSH), 80 (HTTP, Certbot redirect), 443 (HTTPS) |
| Software | Docker 24+, Docker Compose v2, NGINX, Certbot, UFW |

### Local Agent (Windows)

| Requirement | Minimum |
|---|---|
| OS | Windows 10/11 Pro |
| Node.js | 20.x LTS or later |
| WinSW | v3.x binary (`winsw.exe`) |
| Claude Code CLI | Installed and authenticated (`claude` on PATH) |
| Outbound access | HTTPS/WSS to `ops.lancewfisher.com:443` |

### Tools (Development Machine)

| Tool | Purpose |
|---|---|
| `openssl` | Certificate generation (mTLS CA, broker cert, agent cert) |
| `ssh` | VPS access |
| `git` | Source control |
| `npm` | Package management (Node.js 20+) |
| `docker` / `docker compose` | Container orchestration on VPS |

## Deployment Order

The deployment must proceed in this order. Later steps depend on earlier ones.

```
1. VPS provisioning and hardening
2. DNS configuration
3. mTLS certificate generation
4. Docker infrastructure (PostgreSQL, Redis)
5. Broker deployment
6. Console UI deployment
7. NGINX reverse proxy + Let's Encrypt SSL
8. Local agent installation (Windows)
9. Post-deployment verification
```

## Step 1: VPS Provisioning

Follow `docs/deployment/HOSTINGER_VPS_SETUP.md` for the complete VPS provisioning procedure, which covers:

- Ubuntu 22.04 hardening (fail2ban, SSH key-only, disable root password)
- Docker and Docker Compose installation
- NGINX installation
- UFW firewall (22, 80, 443 only)
- Directory structure creation

## Step 2: DNS Configuration

Create the following DNS records at your registrar (Hostinger DNS or external):

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `ops.lancewfisher.com` | `<VPS_IP_ADDRESS>` | 300 |

Verify propagation before proceeding:

```bash
dig +short ops.lancewfisher.com
# Should return your VPS IP
```

If using Cloudflare or another proxy, set the record to DNS-only (no proxy) during initial setup so Certbot HTTP-01 validation works. You can enable proxying after SSL is configured if desired.

## Step 3: mTLS Certificate Generation

The broker and local agent authenticate each other using mutual TLS with a custom Certificate Authority. The `scripts/generate-certs.sh` script automates this process when it exists. Until that script is created, generate certificates manually:

```bash
# Create a working directory
mkdir -p /opt/sovereign-console/certs && cd /opt/sovereign-console/certs

# 1. Generate CA key and certificate (10-year lifetime)
openssl genrsa -out ca-key.pem 4096
openssl req -new -x509 -key ca-key.pem -sha256 -days 3650 \
  -out ca.pem -subj "/CN=Sovereign Console CA/O=LanceFisher"

# 2. Generate broker certificate
openssl genrsa -out broker-key.pem 2048
openssl req -new -key broker-key.pem \
  -out broker.csr -subj "/CN=ops.lancewfisher.com/O=LanceFisher"
openssl x509 -req -in broker.csr -CA ca.pem -CAkey ca-key.pem \
  -CAcreateserial -out broker.pem -days 825 -sha256

# 3. Generate agent certificate
openssl genrsa -out agent-key.pem 2048
openssl req -new -key agent-key.pem \
  -out agent.csr -subj "/CN=sovereign-agent-001/O=LanceFisher"
openssl x509 -req -in agent.csr -CA ca.pem -CAkey ca-key.pem \
  -CAcreateserial -out agent.pem -days 825 -sha256

# 4. Clean up CSRs
rm -f *.csr

# 5. Set restrictive permissions
chmod 600 *-key.pem
chmod 644 *.pem ca.pem
```

**Distribution:**

| File | Broker (VPS) | Agent (Windows) |
|---|---|---|
| `ca.pem` | Yes | Yes |
| `broker.pem` | Yes | No |
| `broker-key.pem` | Yes | No |
| `agent.pem` | No | Yes |
| `agent-key.pem` | No | Yes |

Copy agent certificates to the Windows machine securely (SCP or encrypted transfer). Never commit certificate files to version control.

## Step 4: Docker Infrastructure

See `docs/deployment/HOSTINGER_VPS_SETUP.md` for detailed PostgreSQL 16 and Redis 7 container setup. Summary:

```bash
cd /opt/sovereign-console
docker compose up -d postgres redis
```

Verify both services:

```bash
docker compose exec postgres pg_isready -U sovereign
docker compose exec redis redis-cli -a <password> ping
```

## Step 5: Broker Deployment

### Build and deploy

```bash
cd /opt/sovereign-console/broker

# Install dependencies
npm ci --production

# Compile TypeScript
npm run build

# Run database migrations
npm run migrate
```

### Configure environment

Copy `broker/.env.example` to `broker/.env` and fill in all values. See the Environment Variable Reference below for every variable.

### Start via Docker

The broker runs inside the `docker-compose.yml` alongside PostgreSQL and Redis:

```bash
cd /opt/sovereign-console
docker compose up -d broker
```

### Verify

```bash
curl -sf http://127.0.0.1:3100/health && echo "Broker OK"
docker compose logs broker --tail 20
```

## Step 6: Console UI Deployment

### Build the production image

```bash
cd /opt/sovereign-console/console-ui

# Build the Docker image
docker build -t sovereign-console-ui:latest .
```

### Configure environment

Copy `console-ui/.env.example` to `console-ui/.env`:

```env
NEXT_PUBLIC_API_URL=https://ops.lancewfisher.com/api
NEXT_PUBLIC_WS_URL=wss://ops.lancewfisher.com/ws
NEXT_PUBLIC_RP_ID=ops.lancewfisher.com
```

These values are baked into the Next.js build at compile time (they use the `NEXT_PUBLIC_` prefix).

### Start via Docker

```bash
cd /opt/sovereign-console
docker compose up -d console-ui
```

The console UI container listens on port 3000 internally and is reverse-proxied through NGINX.

## Step 7: NGINX Reverse Proxy + SSL

### Install Certbot and obtain certificate

```bash
sudo certbot --nginx -d ops.lancewfisher.com --non-interactive --agree-tos -m lance@lancewfisher.com
```

### NGINX site configuration

Create `/etc/nginx/sites-available/sovereign-console`:

```nginx
upstream broker {
    server 127.0.0.1:3100;
}

upstream console {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    server_name ops.lancewfisher.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ops.lancewfisher.com;

    # Let's Encrypt certificates (managed by Certbot)
    ssl_certificate /etc/letsencrypt/live/ops.lancewfisher.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ops.lancewfisher.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Security headers
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    # Rate limiting zone (defined in nginx.conf http block)
    # limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

    # API routes -> broker
    location /api/ {
        limit_req zone=api burst=20 nodelay;
        proxy_pass http://broker;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket routes -> broker
    location /ws/ {
        proxy_pass http://broker;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }

    # Agent mTLS WebSocket endpoint
    location /ws/agent {
        # Require client certificate (mTLS)
        ssl_client_certificate /etc/sovereign/certs/ca.pem;
        ssl_verify_client on;

        proxy_pass http://broker;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-SSL-Client-Cert $ssl_client_cert;
        proxy_read_timeout 86400;
    }

    # Everything else -> console UI
    location / {
        proxy_pass http://console;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site and reload:

```bash
sudo ln -sf /etc/nginx/sites-available/sovereign-console /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### Verify SSL auto-renewal

```bash
sudo certbot renew --dry-run
```

## Step 8: Local Agent Installation (Windows)

Follow `docs/deployment/WINDOWS_SERVICE_GUIDE.md` for the complete WinSW setup. Summary:

1. Build the agent: `cd local-agent && npm ci && npm run build`
2. Copy agent certificates (`ca.pem`, `agent.pem`, `agent-key.pem`) to `local-agent/certs/`
3. Configure `local-agent/.env` (see Environment Variable Reference)
4. Install as Windows service via WinSW (see `scripts/install-service.ps1`)
5. Verify: `sc query SovereignAgent` shows RUNNING

## Step 9: Post-Deployment Verification

Run through this checklist after completing all deployment steps.

### Infrastructure

- [ ] VPS is accessible via SSH (key-only, no root password login)
- [ ] UFW shows only ports 22, 80, 443 open
- [ ] fail2ban is active: `sudo fail2ban-client status sshd`
- [ ] PostgreSQL container is healthy: `docker compose exec postgres pg_isready`
- [ ] Redis container is healthy: `docker compose exec redis redis-cli ping`

### Broker

- [ ] Broker health endpoint responds: `curl -sf https://ops.lancewfisher.com/api/health`
- [ ] Database migrations applied: check `docker compose logs broker` for migration success
- [ ] Audit log table exists and has correct constraints (no UPDATE/DELETE permissions)

### Console UI

- [ ] Console loads at `https://ops.lancewfisher.com`
- [ ] SSL certificate is valid: `curl -vI https://ops.lancewfisher.com 2>&1 | grep "SSL certificate"`
- [ ] CSP headers present: check response headers in browser DevTools
- [ ] WebAuthn passkey enrollment flow works from the browser

### Local Agent

- [ ] Service is running: `sc query SovereignAgent` or `Get-Service SovereignAgent`
- [ ] Agent connects to broker: check broker logs for WebSocket connection from agent
- [ ] mTLS handshake succeeds: no TLS errors in agent or broker logs
- [ ] File read operation works: issue a read command from the console UI
- [ ] Write operation requires approval token: confirm token prompt appears
- [ ] Secret redaction works: file containing `.env` content is redacted in transit

### End-to-End

- [ ] Login via passkey from enrolled device
- [ ] TOTP step-up works for write operations
- [ ] Command dispatch reaches the agent and returns output
- [ ] Audit log records all operations with valid hash chain
- [ ] Agent disconnection is reflected in console UI status

## Environment Variable Reference

### Broker (`broker/.env`)

| Variable | Type | Default | Required | Description |
|---|---|---|---|---|
| `DATABASE_URL` | string (URL) | none | Yes | PostgreSQL connection string. Format: `postgresql://user:pass@host:port/db` |
| `REDIS_URL` | string (URL) | none | Yes | Redis connection string. Format: `redis://host:port/db` or `redis://:password@host:port/db` |
| `BROKER_PORT` | integer | `3100` | No | Port the Fastify server binds to (behind NGINX) |
| `BROKER_HOST` | string | `127.0.0.1` | No | Host the Fastify server binds to. Use `127.0.0.1` when behind NGINX. |
| `JWT_SECRET` | string (min 64 chars) | none | Yes | JWT signing secret. Generate: `openssl rand -hex 32` |
| `SESSION_SECRET` | string (min 32 chars) | none | Yes | Session encryption secret. Generate: `openssl rand -hex 16` |
| `WEBAUTHN_RP_ID` | string | none | Yes | Relying Party ID for passkey ceremonies. Must match the domain: `ops.lancewfisher.com` |
| `WEBAUTHN_RP_NAME` | string | none | Yes | Human-readable RP name shown during passkey enrollment. Example: `Sovereign Console` |
| `WEBAUTHN_ORIGIN` | string (URL) | none | Yes | Origin URL for WebAuthn verification. Must include scheme, no trailing slash: `https://ops.lancewfisher.com` |
| `AGENT_MTLS_CA_CERT` | string (path) | none | Yes | Absolute path to the CA certificate that signed agent certs |
| `AGENT_MTLS_CERT` | string (path) | none | Yes | Absolute path to the broker's mTLS certificate |
| `AGENT_MTLS_KEY` | string (path) | none | Yes | Absolute path to the broker's mTLS private key |
| `TOTP_ENCRYPTION_KEY` | string (min 64 hex chars) | none | Yes | AES-256 key for encrypting TOTP secrets at rest. Generate: `openssl rand -hex 32` |
| `APPROVAL_TOKEN_TTL_WRITE` | integer (seconds) | `120` | No | Time-to-live for write-operation approval tokens (30-600) |
| `APPROVAL_TOKEN_TTL_DANGEROUS` | integer (seconds) | `60` | No | Time-to-live for dangerous-operation approval tokens (15-300) |
| `AGENT_QUEUE_TTL_SECONDS` | integer (seconds) | `300` | No | Max time a queued command waits for an offline agent (30-3600) |
| `CLAUDE_MAX_TOKENS_PER_TASK` | integer | `50000` | No | Maximum tokens per individual Claude Code task (min 1000) |
| `CLAUDE_MAX_TASKS_PER_SESSION` | integer | `20` | No | Maximum concurrent tasks per session (min 1) |
| `CLAUDE_DAILY_SPEND_THRESHOLD` | number (USD) | `25.00` | No | Daily spend threshold. Broker warns operator when exceeded. |
| `CORS_ORIGIN` | string (URL) | `https://ops.lancewfisher.com` | No | Allowed CORS origin. Must match console UI domain. |
| `LOG_LEVEL` | enum | `info` | No | Log verbosity: `error`, `warn`, `info`, `http`, `verbose`, `debug`, `silly` |

### Console UI (`console-ui/.env`)

| Variable | Type | Default | Required | Description |
|---|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | string (URL) | `https://localhost:3001/api` | Yes | Broker API base URL. Baked into build at compile time. |
| `NEXT_PUBLIC_WS_URL` | string (URL) | `wss://localhost:3001/ws` | Yes | Broker WebSocket URL for real-time agent status. Baked into build. |
| `NEXT_PUBLIC_RP_ID` | string | `localhost` | Yes | WebAuthn Relying Party ID. Must match broker's `WEBAUTHN_RP_ID`. |

### Local Agent (`local-agent/.env`)

| Variable | Type | Default | Required | Description |
|---|---|---|---|---|
| `BROKER_WS_URL` | string (URL, wss://) | none | Yes | Broker WebSocket endpoint. Must use `wss://`. Example: `wss://ops.lancewfisher.com/ws/agent` |
| `AGENT_ID` | string | none | Yes | Unique identifier for this agent instance |
| `AGENT_SECRET` | string (min 16 chars) | none | Yes | Shared secret for agent authentication |
| `MTLS_CA_CERT` | string (path) | `certs/ca.pem` | No | Path to CA certificate (relative to agent root or absolute) |
| `MTLS_CERT` | string (path) | `certs/agent.pem` | No | Path to agent's mTLS certificate |
| `MTLS_KEY` | string (path) | `certs/agent-key.pem` | No | Path to agent's mTLS private key |
| `PROJECTS_ROOT` | string (path) | none | Yes | Root directory containing managed projects. Example: `D:\ProjectsHome` |
| `ALLOWED_PROJECTS` | string (comma-separated) | none | Yes | Comma-separated list of project directory names the agent may access |
| `PROTECTED_PATHS` | string (comma-separated) | `.env*,*.key,*.pem,...` | No | Glob patterns for paths the agent must never write to |
| `CLAUDE_CLI_PATH` | string | `claude` | No | Path to Claude Code CLI binary |
| `MAX_TOKENS_PER_TASK` | integer | `50000` | No | Maximum tokens per Claude Code task (max 200,000) |
| `MAX_TASKS_PER_SESSION` | integer | `20` | No | Maximum tasks per session (max 100) |
| `DAILY_SPEND_THRESHOLD` | integer | `100000` | No | Daily token spend threshold |
| `CLAUDE_TASK_TIMEOUT_MS` | integer (ms) | `300000` | No | Timeout for individual Claude Code task execution (5 min default) |
| `LOG_PATH` | string (path) | `logs/agent.log` | No | Path to agent log file |
| `LOG_LEVEL` | enum | `info` | No | Log verbosity: `error`, `warn`, `info`, `http`, `verbose`, `debug`, `silly` |
| `SERVICE_ACCOUNT_NAME` | string | `.\SovereignAgent` | No | Windows service account name for WinSW |

## Docker Network Topology

```
                          Internet
                             |
                         [NGINX:443]
                          /    |    \
                         /     |     \
                [Console UI] [Broker] [/ws/agent (mTLS)]
                  :3000       :3100        |
                                |          |
                          ┌─────┴─────┐    |
                          |           |    |
                     [PostgreSQL] [Redis]  |
                       :5432      :6379    |
                                           |
                              ═════════════╪══════  (Internet / WSS+mTLS)
                                           |
                                    [Local Agent]
                                     (Windows)
```

All VPS services communicate over Docker's internal bridge network (`sovereign-net`). Only NGINX binds to the host network on ports 80 and 443. PostgreSQL and Redis are never exposed externally. The local agent connects inbound to the broker's `/ws/agent` endpoint over WSS with mutual TLS client certificate verification.

## Rollback Procedures

### Broker rollback

```bash
cd /opt/sovereign-console

# Stop the current broker
docker compose stop broker

# Restore previous image
docker tag sovereign-broker:latest sovereign-broker:rollback
docker tag sovereign-broker:previous sovereign-broker:latest

# Restart
docker compose up -d broker

# Verify
curl -sf http://127.0.0.1:3100/health
```

For database migration rollback, check `broker/src/db/migrate.ts` for down-migration support. If migrations are not reversible, restore from the most recent PostgreSQL backup:

```bash
# Restore PostgreSQL from backup
docker compose exec -T postgres pg_restore -U sovereign -d sovereign_console \
  < /var/backups/sovereign-console/db/sovereign_$(date +%Y%m%d).dump
```

### Console UI rollback

```bash
cd /opt/sovereign-console
docker compose stop console-ui

# Restore previous image
docker tag sovereign-console-ui:latest sovereign-console-ui:rollback
docker tag sovereign-console-ui:previous sovereign-console-ui:latest

docker compose up -d console-ui
```

### Local agent rollback

On the Windows machine:

```powershell
# Stop the service
Stop-Service SovereignAgent

# Restore previous build
Copy-Item -Path "local-agent\dist.bak\*" -Destination "local-agent\dist\" -Recurse -Force

# Restart the service
Start-Service SovereignAgent
Get-Service SovereignAgent
```

### Full rollback (all components)

If a coordinated rollback is needed (for example, after a breaking API change):

1. Stop the local agent service on Windows
2. Roll back the broker on VPS
3. Roll back the console UI on VPS
4. Verify broker health
5. Restart the local agent service
6. Verify end-to-end connectivity

### Emergency: disable all access

If the system is compromised or behaving unexpectedly:

```bash
# On VPS: block all traffic except SSH
sudo ufw default deny incoming
sudo ufw allow 22/tcp
sudo ufw reload

# Stop all services
cd /opt/sovereign-console
docker compose down
```

On Windows:

```powershell
Stop-Service SovereignAgent
```

The broker's emergency disable endpoint (if implemented) revokes all sessions and blocks all authentication instantly. Refer to `docs/operations/RUNBOOK.md` for the full incident response procedure.
