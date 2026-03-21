# === Build Stage ===
FROM node:20-alpine AS build

WORKDIR /app

# Copy package files for dependency installation
COPY package.json package-lock.json ./
COPY packages/engine/package.json ./packages/engine/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY tsconfig.base.json ./
COPY packages/engine/ ./packages/engine/
COPY packages/server/ ./packages/server/
COPY packages/web/ ./packages/web/

# Build engine first (server depends on it)
RUN npm run build --workspace=packages/engine

# Build server
RUN npm run build --workspace=packages/server

# Build web frontend
RUN npm run build --workspace=packages/web

# === Runtime Stage ===
FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Copy package files
COPY package.json package-lock.json ./
COPY packages/engine/package.json ./packages/engine/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built artifacts
COPY --from=build /app/packages/engine/dist ./packages/engine/dist
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/web/dist ./packages/web/dist

# Copy engine source for runtime imports (tsx compatibility)
COPY --from=build /app/packages/engine/src ./packages/engine/src
COPY --from=build /app/tsconfig.base.json ./

EXPOSE 3000

CMD ["node", "packages/server/dist/index.js"]
