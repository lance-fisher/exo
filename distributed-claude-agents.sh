#!/bin/bash
# Distributed Claude Agents - Desktop Launcher
# Copy this to ~/Desktop/ and make executable: chmod +x ~/Desktop/distributed-claude-agents.sh

PROJECT_DIR="$HOME/exo"

# Check if project exists
if [ ! -d "$PROJECT_DIR" ]; then
    echo "Project not found at $PROJECT_DIR"
    echo "Clone it first: git clone <repo-url> $PROJECT_DIR"
    read -p "Press Enter to close..."
    exit 1
fi

cd "$PROJECT_DIR"
git checkout claude/distributed-claude-agents-oR46c 2>/dev/null

# Ensure .env exists
if [ ! -f .env ]; then
    cp .env.example .env
    echo "Created .env from .env.example"
fi

# Start the system
echo "Starting Distributed Claude Agents..."
make up

echo ""
echo "========================================"
echo "  System is running!"
echo "  Open http://localhost:3000 in your browser"
echo "========================================"
echo ""
echo "Press Enter to view logs (Ctrl+C to stop logs)..."
read
make logs
