FROM node:20-alpine

WORKDIR /app

# Copy workspace config
COPY package.json tsconfig.base.json ./

# Copy service package files
COPY services/memory/package.json services/memory/
COPY services/tools/package.json services/tools/
COPY services/orchestrator/package.json services/orchestrator/

# Install dependencies
RUN npm install --workspace=@dca/memory --workspace=@dca/tools --workspace=@dca/orchestrator 2>/dev/null || \
    (cd services/memory && npm install) && \
    (cd services/tools && npm install) && \
    (cd services/orchestrator && npm install)

# Copy source
COPY services/memory/ services/memory/
COPY services/tools/ services/tools/
COPY services/orchestrator/ services/orchestrator/

# Build
RUN cd services/memory && npx tsc --skipLibCheck || true
RUN cd services/tools && npx tsc --skipLibCheck || true
RUN cd services/orchestrator && npx tsc --skipLibCheck || true

EXPOSE 3001

CMD ["node", "services/orchestrator/dist/index.js"]
