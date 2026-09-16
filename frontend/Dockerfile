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

# PLANTILLA, no configuracion final. La misma imagen sirve al panel del local
# y al hub, y lo que cambia entre ellos --a que backend preguntar y que pagina
# es la raiz-- se lo pone el compose. Todo lo que caiga en /etc/nginx/templates
# lo pasa la imagen por `envsubst` al arrancar y lo deja en /etc/nginx/conf.d
# (que en compose es un tmpfs, porque el contenedor es de solo lectura).
COPY --chown=nginx:nginx nginx.conf.template /etc/nginx/templates/default.conf.template

# EL FILTRO ES OBLIGATORIO. Sin el, `envsubst` sustituye TODA variable que
# encuentre, y la plantilla esta llena de variables de nginx ($host, $uri,
# $proxy_add_x_forwarded_for...) que se reemplazarian por cadena vacia. nginx
# arrancaria igual y se perderian la IP real y las cabeceras de proxy.
ENV NGINX_ENVSUBST_FILTER='(BACKEND_HOST|PAGINA_INICIO)'

# Que sirve la raiz: el ERP por defecto; `inicio.html` solo en el hub.
ENV PAGINA_INICIO=/index.html
# BACKEND_HOST sin valor por defecto A PROPOSITO: si falta, nginx no arranca y
# se ve enseguida, en vez de hablar con el backend equivocado.

COPY --from=builder --chown=nginx:nginx /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null 2>&1 || exit 1
