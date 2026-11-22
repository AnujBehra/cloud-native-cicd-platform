# Stage 1: Build & TypeScript Compilation
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --prefer-offline --no-audit
COPY . .
RUN npm run build || true

# Stage 2: Minimal Production Runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Create non-root secure user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 shipops

COPY package*.json ./
RUN npm ci --only=production --ignore-scripts

COPY --from=builder --chown=shipops:nodejs /app/dist ./dist 2>/dev/null || true
COPY --from=builder --chown=shipops:nodejs /app/src ./src

USER shipops

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/healthz || exit 1

CMD ["node", "src/index.js"]
