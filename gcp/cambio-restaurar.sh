#!/bin/bash
# EL DIA DEL CAMBIO, EN LA VM (como root): reemplaza la base de la VM ENTERA
# con el volcado fresco de Hostinger y los usuarios/roles de `compartido`.
#
# Los datos que la VM tenia (las pruebas) se descartan: desde el 5-oct los dos
# servidores divergen con los mismos ids (ver gcp/cambio.md). Antes de correr
# esto, el volcado y los json tienen que estar en /docker/erp/migracion
# (los sube cambio.md, paso 3). Se puede correr dos veces: es idempotente.
set -euo pipefail
DIR=/docker/erp
M=$DIR/migracion
C="docker compose -f $DIR/docker-compose.yml -f $DIR/docker-compose.prod.yml -f $DIR/docker-compose.gcp.yml"
cd $DIR

[ -f $M/vertigo.dump ] || { echo "falta $M/vertigo.dump"; exit 1; }
[ -f $M/users.json ] || { echo "falta $M/users.json"; exit 1; }
# Solo un volcado completo y legible entra.
docker exec -i erp_comida-db-1 pg_restore --list < $M/vertigo.dump | grep -q "TABLE DATA" || { echo "el volcado no trae datos"; exit 1; }

echo "== 1. Parar los backends (la base sigue arriba)"
$C stop backend hub-backend frontend hub-frontend

echo "== 2. Guardar lo que la VM tenia, por si acaso"
docker exec erp_comida-db-1 pg_dump -U vertigo -d vertigo -Fc > $M/vm-antes-del-cambio-$(date -u +%Y%m%d-%H%M).dump

echo "== 3. Reemplazar los esquemas con el volcado de Hostinger"
docker exec -i erp_comida-db-1 psql -U vertigo -d vertigo -v ON_ERROR_STOP=1 <<'SQL'
drop schema if exists "SAVORA" cascade;
drop schema if exists "HUB" cascade;
drop schema if exists "SAVORA_previo" cascade;
SQL
docker exec -i erp_comida-db-1 pg_restore -U vertigo -d vertigo --no-owner --no-privileges --exit-on-error < $M/vertigo.dump
echo "restaurado"

echo "== 4. Usuarios y roles"
V=/var/lib/docker/volumes/erp_comida_compartido/_data
cp $M/users.json $M/roles.json $V/
chown 10001:10001 $V/users.json $V/roles.json
chmod 600 $V/users.json $V/roles.json

echo "== 5. Arrancar con la version nueva: las migraciones corren solas"
$C up -d
for i in $(seq 1 36); do
  s=$(docker inspect --format '{{.State.Health.Status}}' erp_comida-backend-1 2>/dev/null || echo arrancando)
  [ "$s" = healthy ] && break
  sleep 5
done
echo "backend: $s"
docker ps --format "{{.Names}} {{.Status}}"

echo "== 6. Conteos en la VM (comparar con los de Hostinger)"
docker exec -i erp_comida-db-1 psql -U vertigo -d vertigo -At < $DIR/conteos.sql
echo "== migraciones aplicadas"
docker logs erp_comida-backend-1 2>&1 | grep -c "Columna agregada\|Indices" || true
