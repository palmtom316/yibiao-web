# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:22.23.2-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
ARG NGINX_IMAGE=nginx:stable-bookworm@sha256:552e7481ca93ffccd046aa658dbbed22caefbc09c66fa7cd247cbb90b8a5c609

FROM ${NODE_IMAGE} AS toolchain
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates openssl && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@10.17.1 npm@10.9.3

FROM toolchain AS client-build
WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
ARG VITE_SOURCE_REPOSITORY_URL=https://github.com/palmtom316/yibiao-web
ARG VITE_BUILD_COMMIT=development
ENV VITE_SOURCE_REPOSITORY_URL=${VITE_SOURCE_REPOSITORY_URL} VITE_BUILD_COMMIT=${VITE_BUILD_COMMIT}
RUN npm run typecheck && npm run build

FROM toolchain AS server-build
WORKDIR /build/server
COPY server/package.json server/pnpm-lock.yaml ./
COPY server/prisma/ ./prisma/
RUN pnpm install --frozen-lockfile && pnpm exec prisma generate
COPY server/ ./
RUN pnpm run typecheck

FROM server-build AS production-deps
RUN pnpm prune --prod

FROM ${NODE_IMAGE} AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends libreoffice-writer libreoffice-calc fonts-noto-cjk fonts-dejavu-core ca-certificates openssl tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 YIBIAO_DATA_DIR=/data TZ=Asia/Shanghai XDG_CACHE_HOME=/tmp/yibiao-cache XDG_CONFIG_HOME=/tmp/yibiao-config
RUN mkdir -p /data && chown node:node /data
COPY --from=server-build --chown=node:node /build/server/src ./src
COPY --from=server-build --chown=node:node /build/server/package.json ./package.json
COPY --from=server-build --chown=node:node /build/server/tsconfig.json ./tsconfig.json
USER node
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]

FROM runtime AS migrate
COPY --from=server-build --chown=node:node /build/server/node_modules ./node_modules
COPY --from=server-build --chown=node:node /build/server/prisma ./prisma
COPY --from=server-build --chown=node:node /build/server/scripts ./scripts
CMD ["node", "scripts/initialize.mjs"]

FROM runtime AS app
COPY --from=production-deps --chown=node:node /build/server/node_modules ./node_modules
ARG BUILD_COMMIT=development
ENV YIBIAO_BUILD_COMMIT=${BUILD_COMMIT}
LABEL org.opencontainers.image.source="https://github.com/palmtom316/yibiao-web" org.opencontainers.image.licenses="AGPL-3.0-only"
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/index.ts"]

FROM ${NGINX_IMAGE} AS nginx
COPY --from=client-build /build/client/dist /usr/share/nginx/html
COPY deploy/nginx/container.conf /etc/nginx/conf.d/default.conf
EXPOSE 443

# Optional quality target; the base app remains independent of .NET and Chromium.
FROM mcr.microsoft.com/dotnet/sdk:10.0@sha256:4beef5b8919dcaa2dc924233bd069257e883cc7a061e09088a97d152d6a48510 AS openxml-build
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
WORKDIR /build/openxmlhelper
COPY vendor/openxmlhelper/ ./
RUN dotnet restore src/OpenXmlHelper/OpenXmlHelper.csproj --runtime linux-x64 --use-lock-file && dotnet publish src/OpenXmlHelper/OpenXmlHelper.csproj --configuration Release --runtime linux-x64 --self-contained true --no-restore --output /out

FROM app AS app-enhanced
USER root
RUN apt-get update && apt-get install -y --no-install-recommends chromium libicu72 && rm -rf /var/lib/apt/lists/*
COPY --from=openxml-build /out /opt/yibiao/openxmlhelper
COPY vendor/openxmlhelper/LICENSE vendor/openxmlhelper/UPSTREAM.md /opt/yibiao/openxmlhelper/
ENV YIBIAO_ENABLE_LOCAL_RENDER=true YIBIAO_CHROMIUM_PATH=/usr/bin/chromium YIBIAO_OPENXML_HELPER=/opt/yibiao/openxmlhelper/openxmlhelper
USER node
