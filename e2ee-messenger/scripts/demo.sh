#!/usr/bin/env bash
# Demo script: starts the server and demonstrates encrypted message exchange
# between two simulated clients using the crypto library directly.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "========================================="
echo "  E2EE Messenger - Demo"
echo "========================================="
echo ""
echo "This demo will:"
echo "  1. Start the rendezvous/relay server"
echo "  2. Run two simulated clients (Alice & Bob)"
echo "  3. Show encrypted message exchange"
echo ""

# Check dependencies
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is required. Install Node.js >= 20."
    exit 1
fi

# Install dependencies if needed
if [ ! -d "$ROOT_DIR/node_modules" ]; then
    echo "[*] Installing dependencies..."
    cd "$ROOT_DIR" && npm install
fi

echo "[*] Running crypto test suite first..."
cd "$ROOT_DIR"
npx vitest run --config packages/crypto/vitest.config.ts 2>&1 | tail -20

echo ""
echo "========================================="
echo "  Crypto tests passed!"
echo "========================================="
echo ""
echo "[*] Starting server..."

# Start server in background
cd "$ROOT_DIR"
DB_PATH=":memory:" npx tsx apps/server/src/index.ts &
SERVER_PID=$!

# Wait for server to be ready
echo "[*] Waiting for server to start..."
for i in $(seq 1 30); do
    if curl -s http://localhost:3001/health > /dev/null 2>&1; then
        echo "[*] Server is ready!"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "ERROR: Server failed to start"
        kill $SERVER_PID 2>/dev/null
        exit 1
    fi
    sleep 0.5
done

echo ""
echo "[*] Running integration demo..."
echo ""

# Run the integration test script
npx tsx "$SCRIPT_DIR/demo-exchange.ts" 2>&1

echo ""
echo "========================================="
echo "  Demo Complete!"
echo "========================================="
echo ""
echo "To run the full application:"
echo "  cd e2ee-messenger && npm run dev"
echo ""
echo "Server: http://localhost:3001"
echo "Web UI: http://localhost:3000"
echo ""

# Cleanup
kill $SERVER_PID 2>/dev/null || true
