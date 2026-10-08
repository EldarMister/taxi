FROM node:22-bookworm-slim AS build
WORKDIR /site/web
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
COPY public ./public
COPY privacy ./privacy
COPY terms ./terms
COPY drivers ./drivers
COPY scripts ./scripts
ARG VITE_CLIENT_APP_STORE_URL
ARG VITE_CLIENT_GOOGLE_PLAY_URL
ARG VITE_DRIVER_APP_STORE_URL
ARG VITE_DRIVER_GOOGLE_PLAY_URL
ARG VITE_CLIENT_APK_URL
ARG VITE_DRIVER_APK_URL
ARG ATLAS_RELEASE_DOWNLOAD_BASE
ARG ATLAS_RELEASE_VERSION
RUN node scripts/fetch-release-downloads.mjs && npm run build

FROM nginx:stable-alpine
ENV PORT=8080 API_UPSTREAM=server:3000
# Only substitute runtime configuration values; preserve nginx's $uri/$host.
ENV NGINX_ENVSUBST_FILTER="^(PORT|API_UPSTREAM|DNS_RESOLVER)$"
COPY deploy/10-atlas-resolver.envsh /docker-entrypoint.d/10-atlas-resolver.envsh
RUN chmod +x /docker-entrypoint.d/10-atlas-resolver.envsh
COPY deploy/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /site/web/dist /usr/share/nginx/html
COPY admin/dist /usr/share/nginx/html/admin
EXPOSE 8080
