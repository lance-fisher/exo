#!/bin/bash
# =============================================================================
# Sovereign Console — mTLS Certificate Generation
# Generates CA, broker server, and agent client certificates for mutual TLS.
# =============================================================================
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
OUTPUT_DIR="${1:-./certs}"
CA_DAYS=3650          # 10 years for CA
CERT_DAYS=365         # 1 year for server/client certs
KEY_SIZE=4096
DOMAIN="${DOMAIN:-ops.lancewfisher.com}"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

log() { echo -e "${GREEN}[+]${NC} $*"; }
err() { echo -e "${RED}[x]${NC} $*" >&2; }

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------
if ! command -v openssl &>/dev/null; then
  err "openssl is required but not found."
  exit 1
fi

mkdir -p "${OUTPUT_DIR}"
cd "${OUTPUT_DIR}"

log "Generating certificates in: $(pwd)"

# ---------------------------------------------------------------------------
# 1. Certificate Authority (CA)
# ---------------------------------------------------------------------------
log "Generating CA private key..."
openssl genrsa -out ca-key.pem ${KEY_SIZE}

log "Generating CA certificate (valid ${CA_DAYS} days)..."
openssl req -new -x509 \
  -key ca-key.pem \
  -out ca.pem \
  -days ${CA_DAYS} \
  -subj "/C=US/ST=Utah/L=SLC/O=Sovereign Console/OU=CA/CN=Sovereign Console CA"

chmod 600 ca-key.pem
chmod 644 ca.pem

# ---------------------------------------------------------------------------
# 2. Broker Server Certificate
# ---------------------------------------------------------------------------
log "Generating broker server private key..."
openssl genrsa -out broker-key.pem ${KEY_SIZE}

log "Creating broker server CSR..."
cat > broker-ext.cnf <<EOF
[req]
default_bits = ${KEY_SIZE}
prompt = no
distinguished_name = dn
req_extensions = v3_req

[dn]
C  = US
ST = Utah
L  = SLC
O  = Sovereign Console
OU = Broker
CN = ${DOMAIN}

[v3_req]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${DOMAIN}
DNS.2 = localhost
IP.1  = 127.0.0.1
EOF

openssl req -new \
  -key broker-key.pem \
  -out broker.csr \
  -config broker-ext.cnf

log "Signing broker server certificate with CA..."
openssl x509 -req \
  -in broker.csr \
  -CA ca.pem \
  -CAkey ca-key.pem \
  -CAcreateserial \
  -out broker.pem \
  -days ${CERT_DAYS} \
  -extensions v3_req \
  -extfile broker-ext.cnf

chmod 600 broker-key.pem
chmod 644 broker.pem

# ---------------------------------------------------------------------------
# 3. Agent Client Certificate
# ---------------------------------------------------------------------------
log "Generating agent client private key..."
openssl genrsa -out agent-key.pem ${KEY_SIZE}

log "Creating agent client CSR..."
cat > agent-ext.cnf <<EOF
[req]
default_bits = ${KEY_SIZE}
prompt = no
distinguished_name = dn
req_extensions = v3_req

[dn]
C  = US
ST = Utah
L  = SLC
O  = Sovereign Console
OU = Agent
CN = sovereign-agent

[v3_req]
basicConstraints = CA:FALSE
keyUsage = digitalSignature
extendedKeyUsage = clientAuth
EOF

openssl req -new \
  -key agent-key.pem \
  -out agent.csr \
  -config agent-ext.cnf

log "Signing agent client certificate with CA..."
openssl x509 -req \
  -in agent.csr \
  -CA ca.pem \
  -CAkey ca-key.pem \
  -CAcreateserial \
  -out agent.pem \
  -days ${CERT_DAYS} \
  -extensions v3_req \
  -extfile agent-ext.cnf

chmod 600 agent-key.pem
chmod 644 agent.pem

# ---------------------------------------------------------------------------
# 4. Clean up CSRs and config files
# ---------------------------------------------------------------------------
rm -f broker.csr agent.csr broker-ext.cnf agent-ext.cnf ca.srl

# ---------------------------------------------------------------------------
# 5. Output summary
# ---------------------------------------------------------------------------
echo ""
echo "============================================================================="
log "Certificate generation complete!"
echo "============================================================================="
echo ""
echo "Files created:"
echo "  CA:     ca.pem, ca-key.pem"
echo "  Broker: broker.pem, broker-key.pem"
echo "  Agent:  agent.pem, agent-key.pem"
echo ""
echo "Fingerprints (for verification):"
echo "  CA:     $(openssl x509 -in ca.pem -noout -fingerprint -sha256 | cut -d= -f2)"
echo "  Broker: $(openssl x509 -in broker.pem -noout -fingerprint -sha256 | cut -d= -f2)"
echo "  Agent:  $(openssl x509 -in agent.pem -noout -fingerprint -sha256 | cut -d= -f2)"
echo ""
echo "Expiry dates:"
echo "  CA:     $(openssl x509 -in ca.pem -noout -enddate | cut -d= -f2)"
echo "  Broker: $(openssl x509 -in broker.pem -noout -enddate | cut -d= -f2)"
echo "  Agent:  $(openssl x509 -in agent.pem -noout -enddate | cut -d= -f2)"
echo ""
echo "Next steps:"
echo "  1. Copy ca.pem, broker.pem, broker-key.pem to the broker server"
echo "  2. Copy ca.pem, agent.pem, agent-key.pem to the agent machine"
echo "  3. Record fingerprints in a secure location for out-of-band verification"
echo "============================================================================="
