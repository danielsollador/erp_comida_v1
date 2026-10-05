#!/bin/bash
# SCRIPT DE ARRANQUE DE LA VM (metadato `startup-script`). Corre como root en
# cada encendido; todo es idempotente.
#
# Que hace:
#   1. Instala Docker la primera vez y agrega 1 GB de swap (la VM tiene 1 GB
#      de RAM; el swap es el colchon para un pg_dump o un reporte pesado).
#   2. Escribe /docker/erp/.env con los secretos de Secret Manager. La VM los
#      lee con su propia cuenta de servicio (solo `secretAccessor` sobre estos
#      secretos): ni el .env ni las claves pasan por el chat ni por el repo.
#   3. Levanta el ERP con los tres compose.
#   4. Deja un temporizador que copia los respaldos al bucket cada hora.
#
# Lo que NO hace: traer el codigo. Los compose y `locales/` se copian con
# `gcloud compute scp` (por IAP) a /docker/erp; ver gcp/README.md.
set -euo pipefail

PROYECTO=$(curl -sH 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/project/project-id)
BUCKET=$(curl -sH 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/attributes/bucket-respaldos || true)
DIR=/docker/erp
mkdir -p "$DIR"

# ── 1. Docker y swap ──────────────────────────────────────────────────────
if ! command -v docker >/dev/null; then
  apt-get update
  apt-get install -y --no-install-recommends ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi
if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
swapon -a || true

# Docker descarga las imagenes de Artifact Registry con la cuenta de la VM.
gcloud auth configure-docker us-east1-docker.pkg.dev --quiet

# ── 2. Secretos → .env ────────────────────────────────────────────────────
# Un secreto en Secret Manager por variable; el nombre del secreto es el de
# la variable en minusculas con guiones (POSTGRES_PASSWORD -> postgres-password).
secreto() {
  gcloud secrets versions access latest --secret="$1" --project="$PROYECTO" 2>/dev/null || true
}
{
  echo "# Generado por gcp/arranque.sh en cada encendido. NO editar a mano."
  echo "TZ=America/Caracas"
  echo "ERP_LOCAL=savora"
  for v in POSTGRES_PASSWORD ERP_SESSION_SECRET PABILO_API_KEY PABILO_USER_BANK_ID \
           DOMINIO_SAVORA DOMINIO_HUB ACME_EMAIL IMAGEN_TAG; do
    n=$(echo "$v" | tr 'A-Z_' 'a-z-')
    echo "$v=$(secreto "$n")"
  done
} > "$DIR/.env.nuevo"
chmod 600 "$DIR/.env.nuevo"
mv "$DIR/.env.nuevo" "$DIR/.env"

# ── 3. Respaldos al bucket, cada hora ─────────────────────────────────────
if [ -n "$BUCKET" ]; then
  cat > /usr/local/bin/respaldos-al-bucket <<EOF
#!/bin/bash
# Copia lo que el ERP ya respaldo (pg_dump cada 6 h) a un bucket fuera de la
# maquina. Solo agrega: nunca borra nada del bucket.
gcloud storage rsync /var/lib/docker/volumes/erp_comida_data/_data/backups gs://$BUCKET/savora --quiet
gcloud storage cp /var/lib/docker/volumes/erp_comida_compartido/_data/*.json gs://$BUCKET/compartido/ --quiet
EOF
  chmod +x /usr/local/bin/respaldos-al-bucket
  cat > /etc/systemd/system/respaldos-al-bucket.service <<'EOF'
[Unit]
Description=Copiar los respaldos del ERP al bucket
[Service]
Type=oneshot
ExecStart=/usr/local/bin/respaldos-al-bucket
EOF
  cat > /etc/systemd/system/respaldos-al-bucket.timer <<'EOF'
[Unit]
Description=Respaldos al bucket cada hora
[Timer]
OnBootSec=15min
OnUnitActiveSec=1h
[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now respaldos-al-bucket.timer
fi

# ── 4. El ERP (al final: si Compose falla, lo de arriba ya quedo hecho) ───
if [ -f "$DIR/docker-compose.gcp.yml" ]; then
  cd "$DIR"
  docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.gcp.yml up -d --remove-orphans || echo '[arranque] compose fallo; revisar docker ps'
fi

