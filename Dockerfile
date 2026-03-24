# Stage 1: Install deps + build client
FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@10.17.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# Stage 2: Production
FROM node:22-slim AS production
RUN corepack enable && corepack prepare pnpm@10.17.0 --activate
WORKDIR /app

# Copy everything needed at runtime
COPY --from=build /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
COPY --from=build /app/vite.config.ts ./vite.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json

EXPOSE 3001 5173

CMD ["npx", "concurrently", "npx vite preview --host 0.0.0.0 --port 5173", "npx tsx server/server.ts"]
