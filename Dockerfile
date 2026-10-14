# Foodify backend (pnpm workspace). Node 22.12+ is required by the locked
# toolchain (vitest 5); node:24 matches CI.
FROM node:24-alpine

WORKDIR /app

# pnpm version comes from "packageManager" in package.json (pnpm@12.6.0).
RUN corepack enable && corepack prepare pnpm@12.6.0 --activate

# Manifests only, so the dependency layer is cached.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY packages/validation/package.json packages/validation/

# --ignore-scripts: the root postinstall builds @foodify/validation, but its
# sources are not copied yet. It is built explicitly below instead.
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY backend backend
COPY packages packages

RUN pnpm --filter @foodify/validation build \
 && pnpm --filter backend build

ENV NODE_ENV=production
EXPOSE 5000
CMD ["pnpm", "--filter", "backend", "start"]
