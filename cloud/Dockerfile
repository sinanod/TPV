# Imagen del portal en la nube: API (cloud/server) + web del portal (cloud/portal)
# Construir desde la carpeta cloud/:  docker build -t tpv-cloud .
#
# Prisma necesita `openssl` para detectar la versión de OpenSSL y elegir su
# motor; la imagen slim no lo trae.

FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY portal/package*.json portal/
RUN cd portal && npm ci
COPY server/package*.json server/
COPY server/prisma server/prisma
RUN cd server && npm ci

COPY portal portal
COPY server server
RUN cd portal && npm run build
RUN cd server && npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /app/server/package.json server/
COPY --from=build --chown=node:node /app/server/node_modules server/node_modules
COPY --from=build --chown=node:node /app/server/dist server/dist
COPY --from=build --chown=node:node /app/server/prisma server/prisma
COPY --from=build --chown=node:node /app/portal/dist portal/dist
WORKDIR /app/server
USER node
EXPOSE 8080
# Aplica las migraciones pendientes antes de arrancar; `exec` para que node
# reciba las señales de parada de App Service.
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/index.js"]
