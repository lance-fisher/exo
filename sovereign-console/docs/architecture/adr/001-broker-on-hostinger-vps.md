# ADR-001: Deploy Broker on Hostinger VPS with Separate Subdomain

## Status

**Accepted**

## Context

The Sovereign Operator Console requires a publicly reachable broker that can:

1. Serve the Console UI to the operator's browser
2. Accept WebSocket connections from the local agent on the Windows workstation
3. Handle WebAuthn authentication ceremonies
4. Relay task requests and results between the UI and agent
5. Store audit logs, sessions, and device registry in PostgreSQL

We evaluated several hosting options:

| Option | Pros | Cons |
|---|---|---|
| **Hostinger VPS** | Full root access, custom firewall, Docker support, low cost ($5-10/mo), dedicated IP | Self-managed OS updates and security |
| **Cloudflare Tunnel** | No exposed ports, DDoS protection | Added dependency, tunnel reliability concerns, limited control over TLS termination |
| **Home network + DDNS** | Free, low latency to agent | Dynamic IP, ISP blocks, NAT traversal, no isolation from home network |
| **AWS/GCP free tier** | Major cloud, managed services | Complexity overhead for single-operator use, cost unpredictability, vendor lock-in |
| **Shared hosting** | Cheapest | No Docker, no WebSocket support, no root access, shared IP |

The operator already has a Hostinger account and is familiar with the platform.

## Decision

Deploy the Broker and Console UI on a **Hostinger VPS** under the subdomain **`ops.lancewfisher.com`**, using:

- Ubuntu 22.04 LTS as the base OS
- Docker and Docker Compose for service orchestration
- NGINX as reverse proxy with Let's Encrypt TLS (certbot)
- UFW firewall allowing only ports 22 (SSH, key-only), 80 (HTTP redirect), and 443 (HTTPS)
- Separate DNS A record for `ops.lancewfisher.com` pointing to the VPS IP

## Consequences

### Positive

- **Complete isolation**: The operator console has its own subdomain, its own TLS certificate, its own server process. No shared routing with any other site.
- **Clean CORS**: Single origin (`https://ops.lancewfisher.com`). No wildcard or multi-origin CORS configuration.
- **Full control**: Root SSH, custom NGINX config, Docker runtime, custom firewall rules, cron jobs for maintenance.
- **Predictable cost**: Fixed monthly VPS cost regardless of usage.
- **Simple networking**: Agent connects outbound to a stable public endpoint. No NAT traversal, no tunnels, no DDNS.

### Negative

- **Self-managed security**: OS patching, Docker updates, NGINX config, firewall rules, and TLS renewal are the operator's responsibility. Mitigated by automated unattended-upgrades, certbot auto-renewal, and documented maintenance procedures.
- **Single point of failure**: If the VPS goes down, the broker is unavailable. Mitigated by: Hostinger's infrastructure SLA, monitoring with health checks, and the fact that the agent gracefully queues locally when disconnected.
- **Geographic latency**: VPS may be in a different region than the operator's workstation. Acceptable for a single-operator system where sub-second latency is not critical.

### Risks

- **VPS compromise**: If an attacker gains SSH access, they control the broker. Mitigated by: SSH key-only auth, fail2ban, UFW, Docker isolation, minimal installed packages, no password auth.
- **Hostinger account compromise**: Could lead to VPS access. Mitigated by: strong password + 2FA on Hostinger account.
