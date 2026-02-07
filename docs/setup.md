# Setup Guide

## Prerequisites

- Docker and Docker Compose installed
- Git (for version control operations)
- A terminal / command line

## Quick Start

```bash
# 1. Clone and enter the project
cd /path/to/project

# 2. Copy environment config
cp .env.example .env

# 3. Start everything
make up

# 4. Open the Control UI
# Visit http://localhost:3000 in your browser
```

## What Gets Started

| Service | Port | Description |
|---------|------|-------------|
| Control UI | 3000 | Web interface for task submission and monitoring |
| Orchestrator | 3001 | API server and task coordinator |
| PostgreSQL | 5432 | Shared state database |
| Redis | 6379 | Event bus for agent coordination |
| Agent Workers | (internal) | 7 agent roles processing tasks concurrently |

## Verifying the Setup

```bash
# Check all services are running
make status

# Check orchestrator health
make health

# View live logs
make logs
```

## Stopping

```bash
# Stop services (keeps data)
make down

# Stop and remove all data
make clean
```

## Troubleshooting

**Services fail to start?**
- Ensure Docker is running
- Check if ports 3000, 3001, 5432, 6379 are available
- Run `make logs` to see error details

**Database connection errors?**
- PostgreSQL may need a few seconds to initialize
- Services auto-retry connections with backoff

**UI shows "Disconnected"?**
- The orchestrator may still be starting
- Check `make logs-orchestrator` for details
- The UI auto-reconnects every 3 seconds
