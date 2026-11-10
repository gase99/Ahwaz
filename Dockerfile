# ==============================================================================
# Stage 1: Build TypeScript source
# ==============================================================================
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ==============================================================================
# Stage 2: Production Runtime (includes Git, Python3 & Bash for Agent Tools)
# ==============================================================================
FROM node:22-bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    git \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV WORKSPACES_ROOT=/app/workspaces
ENV DATA_DIR=/app/data
ENV SERVER_HOST=0.0.0.0
ENV SERVER_PORT=3000

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

RUN mkdir -p /app/workspaces /app/data && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/index.js"]
