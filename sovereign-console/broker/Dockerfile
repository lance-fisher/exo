# =============================================================================
# Sovereign Operator Console — Broker Multi-Stage Build
# =============================================================================

# --- Stage 1: Build ---
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/

RUN npx tsc

# Prune dev dependencies
RUN npm prune --production

# --- Stage 2: Production ---
FROM node:22-alpine AS production

# Security: run as non-root
RUN addgroup -g 1001 -S sovereign && \
    adduser -S sovereign -u 1001 -G sovereign

WORKDIR /app

# Copy built artifacts and production dependencies
COPY --from=builder --chown=sovereign:sovereign /app/dist ./dist
COPY --from=builder --chown=sovereign:sovereign /app/node_modules ./node_modules
COPY --from=builder --chown=sovereign:sovereign /app/package.json ./

# Copy schema for migrations
COPY --chown=sovereign:sovereign src/db/schema.sql ./dist/db/schema.sql

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3100/api/system/health || exit 1

# Environment
ENV NODE_ENV=production
ENV BROKER_PORT=3100
ENV BROKER_HOST=0.0.0.0

# Expose port
EXPOSE 3100

# Drop privileges
USER sovereign

# Start
CMD ["node", "dist/index.js"]
