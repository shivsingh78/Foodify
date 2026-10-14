# Foodify combined deployment: Express serves the API, Socket.IO and the built SPA.
# Node 22.12+ is required by the locked toolchain (vitest 5); node:24 matches CI.
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.6.0 --activate

# Manifests only, so the dependency layer is cached.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY packages/validation/package.json packages/validation/

# --ignore-scripts: the root postinstall builds @foodify/validation, but its sources
# are not copied yet. It is built explicitly below instead.
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY packages packages
COPY backend backend
COPY frontend frontend

# Public values only: VITE_* is embedded in the browser bundle. Leave VITE_API_URL
# unset for same-origin API and Socket.IO (the combined deployment).
ARG VITE_API_URL
ARG VITE_FIREBASE_APIKEY
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_RAZORPAY_KEY_ID

RUN pnpm --filter @foodify/validation build \
 && pnpm --filter backend build \
 && pnpm --filter frontend build \
 && pnpm --filter backend --prod deploy --legacy /prod/backend

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
# Same layout the server expects: backend/dist and frontend/dist side by side.
COPY --from=build /prod/backend backend
COPY --from=build /app/frontend/dist frontend/dist
WORKDIR /app/backend
USER node
EXPOSE 5000
CMD ["node", "dist/index.js"]
