# syntax=docker/dockerfile:1

########################  etapa 1: dependencias  ########################
FROM python:3.12-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Las dependencias se instalan en un venv aparte para copiarlo limpio a la
# imagen final: asi no arrastramos pip, wheels ni cache al runtime.
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install -r requirements.txt

########################  etapa 2: runtime  ############################
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    ERP_DATA_DIR=/data

# curl para el HEALTHCHECK, y el cliente de PostgreSQL 16 (pg_dump/pg_restore)
# para los respaldos. Se instala del repositorio oficial de PostgreSQL y no
# del de Debian: pg_dump se niega a volcar un servidor mas nuevo que el, y la
# version de Debian va varias por detras del `postgres:16` del compose.
#
# SOLO IPv4 para apt. `apt.postgresql.org` publica direccion IPv6 y dentro
# del constructor de Docker esa ruta no sale: apt se queda 40 s intentando y
# falla con "Unable to connect", con lo que el despliegue se cae aunque el
# servidor si llegue al repositorio por IPv4. Se comprobo en produccion el
# 20-sep-2026: desde un contenedor, curl -4 responde 200 y curl -6 no conecta.
RUN echo 'Acquire::ForceIPv4 "true";' > /etc/apt/apt.conf.d/99force-ipv4     && apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
       | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
    && . /etc/os-release \
    && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] http://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-16 \
    && apt-get purge -y --auto-remove gnupg \
    && rm -rf /var/lib/apt/lists/*

# Usuario sin privilegios: si alguien logra ejecutar codigo dentro del
# contenedor, no lo hace como root.
RUN useradd --create-home --uid 10001 appuser

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app
COPY --chown=appuser:appuser app ./app

# /data es el volumen: base de datos + respaldos viven aca, fuera de la imagen.
# /compartido es el otro: usuarios y secreto de sesion, comun al hub y al
# panel. Los dos se crean en la imagen CON el dueño correcto: un volumen nuevo
# hereda el dueño de la carpeta de la imagen, y si la carpeta no existe Docker
# la crea de root -- y el proceso, que corre como appuser, no puede escribir
# users.json. Paso en el primer despliegue: el login quedo en "el servidor no
# puede escribir en /compartido".
RUN mkdir -p /data /compartido && chown -R appuser:appuser /data /compartido
VOLUME ["/data"]

USER appuser
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8000/api/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
