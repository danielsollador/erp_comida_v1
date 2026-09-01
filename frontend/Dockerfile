# syntax=docker/dockerfile:1

########################  etapa 1: build del SPA  ######################
FROM node:22-alpine AS builder

WORKDIR /app

# Se copian solo los manifiestos primero: mientras no cambien, Docker reusa
# la capa de npm ci y el build tarda segundos en vez de minutos.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

########################  etapa 2: nginx  ##############################
# Imagen "unprivileged": nginx corre como usuario 101, no como root, y
# escucha en el puerto 8080 (los puertos <1024 requieren privilegios).
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

COPY --chown=nginx:nginx nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder --chown=nginx:nginx /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null 2>&1 || exit 1
