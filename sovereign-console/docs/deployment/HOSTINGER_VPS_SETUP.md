# Sovereign Operator Console: Hostinger VPS Setup

> **Governance notice.** This document defers to and must not contradict the root governance rules in `D:\ProjectsHome\CLAUDE.md` (Sections 0.6, 6, 13), `docs/architecture/SENSITIVE_PATHS.md`, `docs/architecture/AGENT_BOUNDARIES.md`, and `docs/architecture/APPROVAL_POLICY.md`. Security rules in this guide may only tighten root protections, never loosen them.

## Overview

This guide provisions a Hostinger VPS from scratch to host the Sovereign Operator Console broker and console UI. The target state is a hardened Ubuntu 22.04 server running the broker (Fastify), console UI (Next.js), PostgreSQL 16, and Redis 7 inside Docker, fronted by NGINX with Let's Encrypt TLS, and accepting mTLS connections from the local Windows agent.

Where procedures are automated by scripts in `scripts/`, this document references them. Where scripts do not yet exist, the manual procedure is documented in full.

## Step 1: Hostinger VPS Selection and Initial Access

### VPS tier

Select a Hostinger VPS plan with at minimum:

| Resource | Minimum | Recommended |
|---|---|---|
| RAM | 2 GB | 4 GB |
| vCPU | 2 | 2 |
| Storage | 40 GB SSD | 80 GB SSD |
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |
| Location | US or EU (closest to operator) | US East |

### Initial access

After provisioning, Hostinger provides root SSH access via the control panel.

1. Note the VPS IP address from the Hostinger dashboard.
2. SSH in with the root password provided:
   ```bash
   ssh root@<VPS_IP>
   ```
3. Immediately proceed to hardening (next step). Do not install anything else first.

## Step 2: Ubuntu 22.04 Hardening

### System updates

```bash
apt update && apt upgrade -y
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

### Create a non-root operator account

```bash
adduser lance
usermod -aG sudo lance
```

### SSH key-only authentication

On your local machine, copy your public key to the server:

```bash
ssh-copy-id lance@<VPS_IP>
```

Then on the server, disable password authentication and root login:

```bash
cat > /etc/ssh/sshd_config.d/hardened.conf << 'EOF'
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowTcpForwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
EOF

systemctl restart sshd
```

**Test the new configuration from a separate terminal before closing the current session.** Verify you can log in as `lance` with your SSH key. If you lock yourself out, use Hostinger's VPS console to recover.

### Install and configure fail2ban

```bash
apt install -y fail2ban

cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3
backend = systemd

[sshd]
enabled = true
port = 22
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
EOF

systemctl enable fail2ban
systemctl start fail2ban
```

Verify:

```bash
sudo fail2ban-client status sshd
```

### Disable root password login entirely

```bash
sudo passwd -l root
```

## Step 3: Docker and Docker Compose Installation

```bash
# Install prerequisites
sudo apt install -y ca-certificates curl gnupg lsb-release

# Add Docker's official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add the Docker repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine and Compose plugin
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add operator user to docker group
sudo usermod -aG docker lance

# Enable and start Docker
sudo systemctl enable docker
sudo systemctl start docker
```

Verify:

```bash
docker --version
docker compose version
docker run --rm hello-world
```

## Step 4: NGINX Installation and Configuration

### Install NGINX

```bash
sudo apt install -y nginx
sudo systemctl enable nginx
```

### Base security configuration

Add security defaults to the NGINX http block:

```bash
cat > /etc/nginx/conf.d/security.conf << 'EOF'
# Rate limiting zone for API endpoints
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

# Hide NGINX version
server_tokens off;

# Prevent clickjacking (global default, overridden per-site)
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;

# Buffer size limits to prevent large header attacks
client_header_buffer_size 1k;
large_client_header_buffers 4 8k;
client_body_buffer_size 16k;
client_max_body_size 10m;
EOF
```

### Site configuration

The full NGINX site configuration for the Sovereign Console is documented in `DEPLOYMENT_GUIDE.md` Step 7. It includes:

- HTTP-to-HTTPS redirect on port 80
- TLS termination with Let's Encrypt certificates on port 443
- Reverse proxy to broker (:3100) for `/api/` and `/ws/` paths
- Reverse proxy to console UI (:3000) for all other paths
- mTLS client certificate verification on `/ws/agent`
- Rate limiting on API endpoints (10 req/s with burst of 20)
- Security headers (HSTS, X-Frame-Options, CSP, Permissions-Policy)

Create the site configuration:

```bash
sudo nano /etc/nginx/sites-available/sovereign-console
# (paste the configuration from DEPLOYMENT_GUIDE.md Step 7)

sudo ln -sf /etc/nginx/sites-available/sovereign-console /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## Step 5: Let's Encrypt SSL via Certbot

### Install Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
```

### Obtain the certificate

Before running Certbot, ensure:
- DNS A record for `ops.lancewfisher.com` points to this VPS IP
- Port 80 is open (required for HTTP-01 challenge)
- NGINX is running with the site configuration in place (the HTTP server block listening on port 80)

```bash
sudo certbot --nginx -d ops.lancewfisher.com \
  --non-interactive \
  --agree-tos \
  -m lance@lancewfisher.com \
  --redirect
```

Certbot will modify the NGINX configuration to add SSL certificate paths and enable the redirect from HTTP to HTTPS.

### Auto-renewal

Certbot installs a systemd timer by default. Verify it is active:

```bash
sudo systemctl status certbot.timer
```

Expected: `active (waiting)`, triggers twice daily.

Test renewal without actually renewing:

```bash
sudo certbot renew --dry-run
```

### Manual renewal (if timer is not working)

Create a systemd timer:

```bash
cat > /etc/systemd/system/certbot-renew.timer << 'EOF'
[Unit]
Description=Certbot renewal timer

[Timer]
OnCalendar=*-*-* 03:00:00
RandomizedDelaySec=3600
Persistent=true

[Install]
WantedBy=timers.target
EOF

cat > /etc/systemd/system/certbot-renew.service << 'EOF'
[Unit]
Description=Certbot renewal
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/certbot renew --quiet --deploy-hook "systemctl reload nginx"
EOF

sudo systemctl daemon-reload
sudo systemctl enable certbot-renew.timer
sudo systemctl start certbot-renew.timer
```

## Step 6: UFW Firewall Rules

```bash
# Reset to defaults
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow only SSH, HTTP, and HTTPS
sudo ufw allow 22/tcp comment "SSH"
sudo ufw allow 80/tcp comment "HTTP (Certbot + redirect)"
sudo ufw allow 443/tcp comment "HTTPS"

# Enable the firewall
sudo ufw enable

# Verify
sudo ufw status verbose
```

Expected output:

```
Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), disabled (routed)

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW IN    Anywhere        # SSH
80/tcp                     ALLOW IN    Anywhere        # HTTP
443/tcp                    ALLOW IN    Anywhere        # HTTPS
22/tcp (v6)                ALLOW IN    Anywhere (v6)   # SSH
80/tcp (v6)                ALLOW IN    Anywhere (v6)   # HTTP
443/tcp (v6)               ALLOW IN    Anywhere (v6)   # HTTPS
```

PostgreSQL (5432) and Redis (6379) are intentionally not opened. They run inside Docker and are only accessible via the Docker bridge network. They are never exposed to the host network or the internet.

## Step 7: PostgreSQL 16 Container Setup

PostgreSQL stores all persistent data: passkey registrations, device trust records, TOTP secrets (encrypted), approval tokens, session state, and the append-only audit log.

### User, database, roles, and permissions

The database is initialized by the broker's migration system (`npm run migrate` / `broker/src/db/migrate.ts`). The following is the intended schema owner and permission model:

| Role | Purpose | Permissions |
|---|---|---|
| `sovereign` | Application role (broker connects as this) | CONNECT, CREATE, USAGE on schema, full DML on all tables |
| `sovereign_readonly` | Backup and monitoring (optional) | SELECT only |

The `audit_log` table has a critical constraint: the application role must not have UPDATE or DELETE permissions on it. This is enforced by the migration script, which explicitly revokes those permissions after table creation.

### Container configuration in docker-compose.yml

```yaml
postgres:
  image: postgres:16-alpine
  container_name: sovereign-postgres
  restart: unless-stopped
  environment:
    POSTGRES_USER: sovereign
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    POSTGRES_DB: sovereign_console
  volumes:
    - postgres_data:/var/lib/postgresql/data
    - /var/backups/sovereign-console/db:/backups
  networks:
    - sovereign-net
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U sovereign -d sovereign_console"]
    interval: 10s
    timeout: 5s
    retries: 5
    start_period: 30s
  deploy:
    resources:
      limits:
        memory: 512M
```

### Post-creation hardening

After the container starts and migrations run:

```bash
# Connect to PostgreSQL
docker compose exec postgres psql -U sovereign -d sovereign_console

-- Verify audit_log protections
\dp audit_log
-- Should show no UPDATE or DELETE grants for the sovereign role

-- Create read-only role for backups (optional)
CREATE ROLE sovereign_readonly;
GRANT CONNECT ON DATABASE sovereign_console TO sovereign_readonly;
GRANT USAGE ON SCHEMA public TO sovereign_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO sovereign_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO sovereign_readonly;
```

## Step 8: Redis 7 Container Setup

Redis is used for session storage, command queue (when the agent is offline), and rate limiting counters.

### Configuration

| Setting | Value | Rationale |
|---|---|---|
| Password | Set via `REDIS_PASSWORD` env var | Required. No unauthenticated access. |
| `maxmemory` | `256mb` | Sufficient for session data and command queue |
| `maxmemory-policy` | `allkeys-lru` | Evict least-recently-used keys when memory limit is reached |
| `appendonly` | `yes` | AOF (Append Only File) persistence for crash recovery |
| `appendfsync` | `everysec` | Flush to disk every second (balance of durability and performance) |

### Container configuration in docker-compose.yml

```yaml
redis:
  image: redis:7-alpine
  container_name: sovereign-redis
  restart: unless-stopped
  command: >
    redis-server
    --requirepass ${REDIS_PASSWORD}
    --maxmemory 256mb
    --maxmemory-policy allkeys-lru
    --appendonly yes
    --appendfsync everysec
    --loglevel warning
  volumes:
    - redis_data:/data
  networks:
    - sovereign-net
  healthcheck:
    test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
    interval: 10s
    timeout: 5s
    retries: 5
  deploy:
    resources:
      limits:
        memory: 300M
```

### Verify

```bash
docker compose exec redis redis-cli -a "${REDIS_PASSWORD}" ping
# Expected: PONG

docker compose exec redis redis-cli -a "${REDIS_PASSWORD}" info memory | grep used_memory_human
```

## Step 9: mTLS Certificate Generation and Placement

The mTLS certificates authenticate the local agent to the broker and vice versa. See `DEPLOYMENT_GUIDE.md` Step 3 for the full certificate generation procedure. The `scripts/generate-certs.sh` script automates this when it exists.

### VPS certificate placement

```bash
sudo mkdir -p /etc/sovereign/certs
sudo cp ca.pem broker.pem broker-key.pem /etc/sovereign/certs/
sudo chmod 600 /etc/sovereign/certs/*-key.pem
sudo chmod 644 /etc/sovereign/certs/ca.pem /etc/sovereign/certs/broker.pem
sudo chown root:root /etc/sovereign/certs/*
```

The broker's `.env` must reference these paths:

```env
AGENT_MTLS_CA_CERT=/etc/sovereign/certs/ca.pem
AGENT_MTLS_CERT=/etc/sovereign/certs/broker.pem
AGENT_MTLS_KEY=/etc/sovereign/certs/broker-key.pem
```

The NGINX configuration also references the CA certificate for client verification:

```nginx
ssl_client_certificate /etc/sovereign/certs/ca.pem;
ssl_verify_client on;
```

## Step 10: Directory Structure

Create the standard directory layout on the VPS:

```bash
# Application directory
sudo mkdir -p /opt/sovereign-console/{broker,console-ui,certs}

# Persistent data (database, redis)
sudo mkdir -p /var/lib/sovereign-console/{postgres,redis}

# Logs
sudo mkdir -p /var/log/sovereign-console/{broker,nginx}

# Backups
sudo mkdir -p /var/backups/sovereign-console/{db,certs,audit}

# Set ownership
sudo chown -R lance:lance /opt/sovereign-console
sudo chown -R lance:lance /var/log/sovereign-console
sudo chown -R lance:lance /var/backups/sovereign-console
```

| Path | Purpose |
|---|---|
| `/opt/sovereign-console/` | Application code, docker-compose.yml, environment files |
| `/opt/sovereign-console/broker/` | Broker source, compiled output, package.json |
| `/opt/sovereign-console/console-ui/` | Console UI source (used for Docker build) |
| `/opt/sovereign-console/certs/` | mTLS certificates (CA, broker cert/key) |
| `/var/lib/sovereign-console/` | Docker volume bind mounts (PostgreSQL data, Redis AOF) |
| `/var/log/sovereign-console/` | Application and service logs |
| `/var/backups/sovereign-console/` | Database dumps, certificate backups, audit log exports |

## Step 11: docker-compose.yml

Create `/opt/sovereign-console/docker-compose.yml`:

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:16-alpine
    container_name: sovereign-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: sovereign
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: sovereign_console
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - /var/backups/sovereign-console/db:/backups
    networks:
      - sovereign-net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sovereign -d sovereign_console"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    deploy:
      resources:
        limits:
          memory: 512M

  redis:
    image: redis:7-alpine
    container_name: sovereign-redis
    restart: unless-stopped
    command: >
      redis-server
      --requirepass ${REDIS_PASSWORD}
      --maxmemory 256mb
      --maxmemory-policy allkeys-lru
      --appendonly yes
      --appendfsync everysec
      --loglevel warning
    volumes:
      - redis_data:/data
    networks:
      - sovereign-net
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    deploy:
      resources:
        limits:
          memory: 300M

  broker:
    build:
      context: ./broker
      dockerfile: Dockerfile
    container_name: sovereign-broker
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    env_file:
      - ./broker/.env
    environment:
      DATABASE_URL: postgresql://sovereign:${POSTGRES_PASSWORD}@postgres:5432/sovereign_console
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379/0
    ports:
      - "127.0.0.1:3100:3100"
    volumes:
      - /etc/sovereign/certs:/etc/sovereign/certs:ro
      - /var/log/sovereign-console/broker:/app/logs
    networks:
      - sovereign-net
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3100/health || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 3

  console-ui:
    build:
      context: ./console-ui
      dockerfile: Dockerfile
    container_name: sovereign-console-ui
    restart: unless-stopped
    depends_on:
      broker:
        condition: service_healthy
    env_file:
      - ./console-ui/.env
    ports:
      - "127.0.0.1:3000:3000"
    networks:
      - sovereign-net
    deploy:
      resources:
        limits:
          memory: 256M

volumes:
  postgres_data:
    driver: local
  redis_data:
    driver: local

networks:
  sovereign-net:
    driver: bridge
```

Create the environment file for Docker Compose secrets:

```bash
cat > /opt/sovereign-console/.env << 'EOF'
POSTGRES_PASSWORD=<generate: openssl rand -hex 16>
REDIS_PASSWORD=<generate: openssl rand -hex 16>
EOF

chmod 600 /opt/sovereign-console/.env
```

### Start all services

```bash
cd /opt/sovereign-console
docker compose up -d
```

### Verify all containers

```bash
docker compose ps
# Expected: all 4 services (postgres, redis, broker, console-ui) showing "Up" and "healthy"

docker compose logs --tail 10
```

## Step 12: Verification

### Health checks

```bash
# PostgreSQL
docker compose exec postgres pg_isready -U sovereign -d sovereign_console
# Expected: accepting connections

# Redis
docker compose exec redis redis-cli -a "${REDIS_PASSWORD}" ping
# Expected: PONG

# Broker (internal)
curl -sf http://127.0.0.1:3100/health && echo "Broker OK"

# Console UI (internal)
curl -sf http://127.0.0.1:3000 > /dev/null && echo "Console UI OK"

# Full stack via NGINX (external)
curl -sf https://ops.lancewfisher.com/api/health && echo "External OK"
```

### Agent connection test

After the local agent is installed and running on the Windows machine (see `WINDOWS_SERVICE_GUIDE.md`):

1. Check broker logs for the agent WebSocket connection:
   ```bash
   docker compose logs broker --tail 30 | grep -i "agent"
   ```
   Expected: log entry showing successful mTLS handshake and agent registration.

2. From the console UI at `https://ops.lancewfisher.com`, the dashboard should show the agent status as "Connected".

3. Issue a test read command from the console UI and verify the agent returns file content.

### SSL verification

```bash
# Certificate chain
openssl s_client -connect ops.lancewfisher.com:443 -servername ops.lancewfisher.com < /dev/null 2>/dev/null | openssl x509 -noout -dates -subject -issuer

# Security headers
curl -sI https://ops.lancewfisher.com | grep -iE "(strict-transport|x-frame|x-content-type|referrer-policy|permissions-policy)"
```

### Firewall verification

```bash
sudo ufw status verbose

# Verify PostgreSQL is NOT externally accessible
nmap -p 5432 <VPS_IP>
# Expected: filtered or closed

# Verify Redis is NOT externally accessible
nmap -p 6379 <VPS_IP>
# Expected: filtered or closed
```

## Maintenance Notes

- **Backups:** Set up a daily cron job to dump PostgreSQL and copy to `/var/backups/sovereign-console/db/`. See `docs/operations/MAINTENANCE_GUIDE.md` (when created) for the full backup procedure. The `scripts/backup-audit-logs.sh` script (when created) handles audit log backup with hash chain verification.
- **Updates:** Use `unattended-upgrades` for OS security patches. For Docker image updates, pull new images and rebuild: `docker compose pull && docker compose up -d --build`.
- **Certificate renewal:** Let's Encrypt certificates auto-renew via the Certbot timer. mTLS certificates have an 825-day lifetime and must be manually regenerated before expiry. See `docs/security/CREDENTIAL_ROTATION.md` (when created).
- **Monitoring:** Check `docker compose ps` and `docker compose logs` regularly. Consider adding uptime monitoring for `https://ops.lancewfisher.com/api/health`.
