FROM node:20-alpine

# Install common tools agents may need
RUN apk add --no-cache git bash

WORKDIR /app

# Copy workspace config
COPY package.json tsconfig.base.json ./

# Copy service package files
COPY services/memory/package.json services/memory/
COPY services/tools/package.json services/tools/
COPY services/agents/package.json services/agents/

# Install dependencies
RUN (cd services/memory && npm install) && \
    (cd services/tools && npm install) && \
    (cd services/agents && npm install)

# Copy source
COPY services/memory/ services/memory/
COPY services/tools/ services/tools/
COPY services/agents/ services/agents/

# Build
RUN cd services/memory && npx tsc --skipLibCheck || true
RUN cd services/tools && npx tsc --skipLibCheck || true
RUN cd services/agents && npx tsc --skipLibCheck || true

CMD ["node", "services/agents/dist/index.js"]
