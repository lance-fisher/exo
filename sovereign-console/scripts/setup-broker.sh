#!/bin/bash
# =============================================================================
# Sovereign Console Broker Setup for Hostinger VPS
# Prerequisites: Ubuntu 22.04+, root access
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
DOMAIN="${DOMAIN:-ops.lancewfisher.com}"
EMAIL="${EMAIL:-lance@lancewfisher.com}"
INSTALL_DIR="/opt/sovereign-console"
DATA_DIR="/var/lib/sovereign-console"
LOG_DIR="/var/log/sovereign-console"
BACKUP_DIR="/var/backups/sovereign-console"

# ---------------------------------------------------------------------------
# Color output
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[+]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[x]${NC} $*" >&2; }

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
if [[ $EUID -ne 0 ]]; then
  err "This script must be run as root."
  exit 1
fi

log "Starting Sovereign Console broker setup on $(hostname)..."

# ---------------------------------------------------------------------------
# 1. System updates & dependencies
# ---------------------------------------------------------------------------
log "Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

log "Installing prerequisites..."
apt-get install -y -qq \
  ca-certificates \
  curl \
  gnupg \
  lsb-release \
  ufw \
  fail2ban \
  unattended-upgrades \
  gpg

# ---------------------------------------------------------------------------
# 2. Install Docker & Docker Compose
# ---------------------------------------------------------------------------
if ! command -v docker &>/dev/null; then
  log "Installing Docker..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    tee /etc/apt/sources.list.d/docker.list > /dev/null

  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  log "Docker installed: $(docker --version)"
else
  log "Docker already installed: $(docker --version)"
fi

# ---------------------------------------------------------------------------
# 3. Install NGINX
# ---------------------------------------------------------------------------
if ! command -v nginx &>/dev/null; then
  log "Installing NGINX..."
  apt-get install -y -qq nginx
  systemctl enable --now nginx
  log "NGINX installed: $(nginx -v 2>&1)"
else
  log "NGINX already installed."
fi

# ---------------------------------------------------------------------------
# 4. Install Certbot for Let's Encrypt
# ---------------------------------------------------------------------------
if ! command -v certbot &>/dev/null; then
  log "Installing Certbot..."
  apt-get install -y -qq certbot python3-certbot-nginx
  log "Certbot installed: $(certbot --version 2>&1)"
else
  log "Certbot already installed."
fi

# ---------------------------------------------------------------------------
# 5. Create directory structure
# ---------------------------------------------------------------------------
log "Creating directory structure..."
mkdir -p "${INSTALL_DIR}"/{config,certs,nginx}
mkdir -p "${DATA_DIR}"/{postgres,redis}
mkdir -p "${LOG_DIR}"
mkdir -p "${BACKUP_DIR}"

chmod 700 "${INSTALL_DIR}/certs"
chmod 700 "${DATA_DIR}"

# ---------------------------------------------------------------------------
# 6. Copy configuration files
# ---------------------------------------------------------------------------
log "Setting up configuration..."

# NGINX site config
cat > /etc/nginx/sites-available/sovereign-console <<'NGINX_CONF'
server {
    listen 80;
    server_name ops.lancewfisher.com;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name ops.lancewfisher.com;

    # Certs will be placed by certbot
    ssl_certificate     /etc/letsencrypt/live/ops.lancewfisher.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ops.lancewfisher.com/privkey.pem;

    # Modern TLS config
    ssl_protocols TLSv1.3;
    ssl_prefer_server_ciphers off;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss://ops.lancewfisher.com;" always;

    # Broker API
    location /api/ {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Rate limiting
        limit_req zone=api burst=20 nodelay;
    }

    # WebSocket for agent relay
    location /ws/ {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }

    # Console UI static files
    location / {
        proxy_pass http://127.0.0.1:3200;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
NGINX_CONF

# NGINX rate limiting zone (add to http block)
if ! grep -q "limit_req_zone.*api" /etc/nginx/nginx.conf; then
  sed -i '/http {/a \    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;' /etc/nginx/nginx.conf
fi

ln -sf /etc/nginx/sites-available/sovereign-console /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# ---------------------------------------------------------------------------
# 7. Generate initial secrets
# ---------------------------------------------------------------------------
log "Generating secrets..."

SECRETS_FILE="${INSTALL_DIR}/config/.env"
if [[ ! -f "${SECRETS_FILE}" ]]; then
  JWT_SECRET=$(openssl rand -hex 64)
  SESSION_SECRET=$(openssl rand -hex 32)
  TOTP_KEY=$(openssl rand -hex 64)
  PG_PASSWORD=$(openssl rand -base64 32 | tr -d '=/+')
  REDIS_PASSWORD=$(openssl rand -base64 24 | tr -d '=/+')

  cat > "${SECRETS_FILE}" <<EOF
# =============================================================================
# Sovereign Console — Environment Configuration
# Generated: $(date -Iseconds)
# =============================================================================

# Database
DATABASE_URL=postgresql://sovereign:${PG_PASSWORD}@postgres:5432/sovereign_console

# Redis
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379

# Server
BROKER_PORT=3100
BROKER_HOST=0.0.0.0

# Secrets
JWT_SECRET=${JWT_SECRET}
SESSION_SECRET=${SESSION_SECRET}

# WebAuthn
WEBAUTHN_RP_ID=${DOMAIN}
WEBAUTHN_RP_NAME=Sovereign Console
WEBAUTHN_ORIGIN=https://${DOMAIN}

# Agent mTLS (paths inside container)
AGENT_MTLS_CA_CERT=/app/certs/ca.pem
AGENT_MTLS_CERT=/app/certs/broker.pem
AGENT_MTLS_KEY=/app/certs/broker-key.pem

# TOTP
TOTP_ENCRYPTION_KEY=${TOTP_KEY}

# Approval Tokens
APPROVAL_TOKEN_TTL_WRITE=120
APPROVAL_TOKEN_TTL_DANGEROUS=60

# Command Queue
AGENT_QUEUE_TTL_SECONDS=300

# Claude Code Limits
CLAUDE_MAX_TOKENS_PER_TASK=50000
CLAUDE_MAX_TASKS_PER_SESSION=20
CLAUDE_DAILY_SPEND_THRESHOLD=25.0

# CORS
CORS_ORIGIN=https://${DOMAIN}

# Logging
LOG_LEVEL=info
EOF

  chmod 600 "${SECRETS_FILE}"
  log "Secrets generated at ${SECRETS_FILE}"
else
  warn "Secrets file already exists at ${SECRETS_FILE} — skipping generation."
fi

# ---------------------------------------------------------------------------
# 8. Docker Compose file
# ---------------------------------------------------------------------------
cat > "${INSTALL_DIR}/docker-compose.yml" <<'COMPOSE'
version: "3.9"

services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: sovereign_console
      POSTGRES_USER: sovereign
      POSTGRES_PASSWORD_FILE: /run/secrets/pg_password
    volumes:
      - /var/lib/sovereign-console/postgres:/var/lib/postgresql/data
    secrets:
      - pg_password
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sovereign -d sovereign_console"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: >
      redis-server
      --requirepass "${REDIS_PASSWORD}"
      --maxmemory 256mb
      --maxmemory-policy allkeys-lru
      --appendonly yes
    volumes:
      - /var/lib/sovereign-console/redis:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  broker:
    build:
      context: ./broker
      dockerfile: Dockerfile
    restart: unless-stopped
    env_file:
      - ./config/.env
    ports:
      - "127.0.0.1:3100:3100"
    volumes:
      - ./certs:/app/certs:ro
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  console-ui:
    build:
      context: ./console-ui
      dockerfile: Dockerfile
    restart: unless-stopped
    ports:
      - "127.0.0.1:3200:3200"

secrets:
  pg_password:
    file: ./config/.pg_password
COMPOSE

log "Docker Compose file created."

# Extract PG password for Docker secret
if [[ -f "${SECRETS_FILE}" ]]; then
  grep -oP '(?<=POSTGRES_PASSWORD=|sovereign:)[^@]+(?=@)' "${SECRETS_FILE}" | head -1 > "${INSTALL_DIR}/config/.pg_password" 2>/dev/null || true
  chmod 600 "${INSTALL_DIR}/config/.pg_password"
fi

# ---------------------------------------------------------------------------
# 9. Set up firewall
# ---------------------------------------------------------------------------
log "Configuring firewall (ufw)..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP (certbot)'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable
log "Firewall enabled: SSH (22), HTTP (80), HTTPS (443)"

# ---------------------------------------------------------------------------
# 10. Generate mTLS certificates (if not done already)
# ---------------------------------------------------------------------------
if [[ ! -f "${INSTALL_DIR}/certs/ca.pem" ]]; then
  log "Generating mTLS certificates..."
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -f "${SCRIPT_DIR}/generate-certs.sh" ]]; then
    bash "${SCRIPT_DIR}/generate-certs.sh" "${INSTALL_DIR}/certs"
  else
    warn "generate-certs.sh not found. Run it separately to create mTLS certs."
  fi
fi

# ---------------------------------------------------------------------------
# 11. Start services
# ---------------------------------------------------------------------------
log "Starting Docker Compose services..."
cd "${INSTALL_DIR}"
docker compose pull 2>/dev/null || true
docker compose up -d --build

# Wait for services
log "Waiting for services to be healthy..."
sleep 5
docker compose ps

# ---------------------------------------------------------------------------
# 12. Set up SSL with Certbot
# ---------------------------------------------------------------------------
log "Requesting SSL certificate from Let's Encrypt..."
# First, test NGINX config with port 80 only
nginx -t && systemctl reload nginx

certbot --nginx \
  -d "${DOMAIN}" \
  --email "${EMAIL}" \
  --agree-tos \
  --no-eff-email \
  --redirect \
  || warn "Certbot failed — you may need to set up DNS for ${DOMAIN} first."

# ---------------------------------------------------------------------------
# 13. Systemd timer for cert renewal
# ---------------------------------------------------------------------------
log "Setting up automatic certificate renewal..."
cat > /etc/systemd/system/certbot-renewal.service <<'UNIT'
[Unit]
Description=Certbot certificate renewal
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/certbot renew --quiet --deploy-hook "systemctl reload nginx"
UNIT

cat > /etc/systemd/system/certbot-renewal.timer <<'TIMER'
[Unit]
Description=Run certbot renewal twice daily

[Timer]
OnCalendar=*-*-* 02,14:30:00
RandomizedDelaySec=3600
Persistent=true

[Install]
WantedBy=timers.target
TIMER

systemctl daemon-reload
systemctl enable --now certbot-renewal.timer
log "Certbot renewal timer enabled."

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "============================================================================="
echo -e "${GREEN}Sovereign Console broker setup complete!${NC}"
echo "============================================================================="
echo ""
echo "Next steps:"
echo "  1. Verify DNS: ${DOMAIN} → $(curl -s ifconfig.me)"
echo "  2. Generate mTLS certs:  bash scripts/generate-certs.sh ${INSTALL_DIR}/certs"
echo "  3. Run migrations:       docker compose exec broker npm run migrate"
echo "  4. Set up first device:  Visit https://${DOMAIN}"
echo "  5. Install local agent:  See scripts/setup-agent.ps1 on your Windows machine"
echo ""
echo "Useful commands:"
echo "  docker compose -f ${INSTALL_DIR}/docker-compose.yml logs -f broker"
echo "  docker compose -f ${INSTALL_DIR}/docker-compose.yml ps"
echo "  systemctl status certbot-renewal.timer"
echo ""
echo "Security notes:"
echo "  - Secrets stored at: ${SECRETS_FILE} (chmod 600)"
echo "  - Firewall: only ports 22, 80, 443 open"
echo "  - fail2ban is active for SSH protection"
echo "  - Automatic security updates enabled"
echo "============================================================================="
