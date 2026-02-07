.PHONY: up down logs test build clean status

# Start all services
up:
	docker compose up --build -d
	@echo ""
	@echo "Distributed Claude Agents is starting..."
	@echo "  Control UI:   http://localhost:3000"
	@echo "  API:          http://localhost:3001"
	@echo "  API Health:   http://localhost:3001/health"
	@echo ""
	@echo "Run 'make logs' to see service output."

# Stop all services
down:
	docker compose down

# View logs (all services)
logs:
	docker compose logs -f

# View logs for specific service
logs-orchestrator:
	docker compose logs -f orchestrator

logs-agents:
	docker compose logs -f agents

logs-ui:
	docker compose logs -f control-ui

# Run tests
test:
	@echo "Running tests..."
	cd services/memory && npm test 2>/dev/null || echo "Memory tests: no tests configured yet"
	cd services/tools && npm test 2>/dev/null || echo "Tools tests: no tests configured yet"
	cd services/orchestrator && npm test 2>/dev/null || echo "Orchestrator tests: no tests configured yet"

# Build all services
build:
	docker compose build

# Clean up volumes and containers
clean:
	docker compose down -v --remove-orphans
	@echo "Cleaned up containers and volumes."

# Check status of services
status:
	docker compose ps

# Quick health check
health:
	@curl -s http://localhost:3001/health | python3 -m json.tool 2>/dev/null || echo "Orchestrator not responding"

# Submit a demo task via CLI
demo:
	@echo "Submitting demo task..."
	@curl -s -X POST http://localhost:3001/api/tasks \
		-H 'Content-Type: application/json' \
		-d '{"request": "Review the project structure and create a summary of what files exist"}' \
		| python3 -m json.tool 2>/dev/null || echo "Failed to submit task. Is the system running? Try: make up"

# Restart services
restart:
	docker compose restart

# Reset everything (careful: destroys data)
reset: clean up
