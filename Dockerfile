# ─── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:22-slim AS deps
WORKDIR /app

# Install Node dependencies
COPY package.json package-lock.json* ./
RUN npm ci --prefer-offline

# ─── Stage 2: builder ─────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ─── Stage 3: runner (production image) ───────────────────────────────────────
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    PYTHONIOENCODING="utf-8"

# Install Python 3, venv, and build dependencies required for MemPalace
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-venv build-essential wget && \
    rm -rf /var/lib/apt/lists/*

# Create non-root users
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Setup Python Virtual Environment and install MemPalace vector database
RUN python3 -m venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"
RUN pip install --no-cache-dir mempalace

# Copy build output and public files
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Setup the Knowledge Base
RUN mkdir -p /app/knowledge_base && chown -R nextjs:nodejs /app/knowledge_base

# Copy any existing pre-computed knowledge base files
COPY --chown=nextjs:nodejs knowledge_base/ ./knowledge_base/

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD wget -qO- http://localhost:3000/ > /dev/null

CMD ["node", "server.js"]
