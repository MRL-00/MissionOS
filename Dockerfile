# Stage 1: Install deps + build client and server
FROM node:24-slim AS build
RUN corepack enable && corepack prepare pnpm@10.17.0 --activate
WORKDIR /app
ARG VITE_DEPLOY_VERSION=local
ENV VITE_DEPLOY_VERSION=$VITE_DEPLOY_VERSION
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Stage 2: Production
FROM node:24-slim AS production
RUN corepack enable && corepack prepare pnpm@10.17.0 --activate
WORKDIR /app

# Copy everything needed at runtime
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist ./dist
COPY --from=build /app/docs ./docs
COPY --from=build /app/server/dist ./server/dist

ENV NODE_ENV=production
EXPOSE 3001

CMD ["pnpm", "start"]
