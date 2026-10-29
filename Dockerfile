# Server de Frontera de Naciones (para Fly.io, Render, Koyeb, Oracle...)
FROM node:22-slim
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter @fdn/server... --filter @fdn/client...
RUN pnpm --filter @fdn/client build
ENV NODE_ENV=production
EXPOSE 1337
CMD ["pnpm", "--filter", "@fdn/server", "start"]
