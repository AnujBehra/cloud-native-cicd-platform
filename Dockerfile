# Stage 1: Build TypeScript Application
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci --prefer-offline --no-audit

COPY src ./src
COPY public ./public
COPY charts ./charts
COPY sample-apps ./sample-apps

RUN npm run build

# Stage 2: Minimal Production Image
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0

# Install Helm & Kubectl CLI tools for direct cluster interaction if needed
RUN apk add --no-cache curl bash git ca-certificates openssl && \
    curl -fsSL https://get.helm.sh/helm-v3.14.0-linux-amd64.tar.gz | tar -xz && \
    mv linux-amd64/helm /usr/local/bin/helm && \
    rm -rf linux-amd64 && \
    curl -fsSL -o /usr/local/bin/kubectl https://dl.k8s.io/release/v1.29.2/bin/linux/amd64/kubectl && \
    chmod +x /usr/local/bin/kubectl

# Create non-root user
RUN addgroup --system --gid 1001 shipops && \
    adduser --system --uid 1001 shipops

COPY package*.json ./
RUN npm ci --only=production --ignore-scripts

COPY --from=builder --chown=shipops:shipops /app/dist ./dist
COPY --from=builder --chown=shipops:shipops /app/public ./public
COPY --from=builder --chown=shipops:shipops /app/charts ./charts
COPY --from=builder --chown=shipops:shipops /app/sample-apps ./sample-apps
COPY --from=builder --chown=shipops:shipops /app/src/db/schema.sql ./src/db/schema.sql

USER shipops

EXPOSE 4000

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/healthz || exit 1

CMD ["node", "dist/server.js"]
