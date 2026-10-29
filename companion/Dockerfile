# Companion relay + PWA for Fly.io
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/relay/package.json packages/relay/
COPY packages/pwa/package.json packages/pwa/
COPY packages/daemon/package.json packages/daemon/
COPY packages/desktop/package.json packages/desktop/

# Install workspaces needed to build/run relay+PWA (lockfile expects all workspace package.json)
RUN npm ci -w @companion/shared -w @companion/relay -w @companion/pwa

COPY packages/shared packages/shared
COPY packages/relay packages/relay
COPY packages/pwa packages/pwa

RUN npm run build -w @companion/shared \
  && npm run build -w @companion/pwa

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV COMPANION_DATA_DIR=/data
ENV COMPANION_PWA_DIST=/app/packages/pwa/dist

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/relay/package.json packages/relay/
COPY packages/pwa/package.json packages/pwa/
COPY packages/daemon/package.json packages/daemon/
COPY packages/desktop/package.json packages/desktop/

RUN npm ci -w @companion/shared -w @companion/relay --omit=dev

COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/relay packages/relay
COPY --from=build /app/packages/pwa/dist packages/pwa/dist

RUN mkdir -p /data

EXPOSE 8080
CMD ["node", "packages/relay/bin/relay.js"]
