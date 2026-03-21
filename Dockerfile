# === Build Stage ===
FROM node:20-alpine AS build

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
COPY packages/engine/package.json ./packages/engine/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/

# Install all dependencies
RUN npm ci

# Copy source
COPY tsconfig.base.json ./
COPY packages/engine/ ./packages/engine/
COPY packages/server/ ./packages/server/
COPY packages/web/ ./packages/web/
COPY skills/ ./skills/

# Build web frontend
RUN cd packages/web && npx vite build

# === Runtime Stage ===
FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Copy everything needed for tsx runtime
COPY package.json package-lock.json ./
COPY packages/engine/package.json ./packages/engine/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/

# Install production + tsx
RUN npm ci

# Copy source (tsx runs TypeScript directly)
COPY tsconfig.base.json ./
COPY packages/engine/src ./packages/engine/src
COPY packages/server/src ./packages/server/src
COPY skills/ ./skills/

# Copy built frontend
COPY --from=build /app/packages/web/dist ./packages/web/dist

# Create data directory
RUN mkdir -p data

EXPOSE 3000

CMD ["npx", "tsx", "packages/server/src/index.ts"]
