# El ERP en Google Cloud: cómo se opera

Proyecto `vertigo-erp-produccion`, región `us-east1`. Todo se hace con `gcloud`
(con la cuenta de Daniel o la de Leider); nada exige entrar a la consola.

| Qué | Dónde |
|---|---|
| VM | `vertigo-erp` (`e2-micro`, zona `us-east1-b`), IP fija `35.231.43.80` |
| Código en la VM | `/docker/erp` (los tres compose + `locales/`) |
| Imágenes | Artifact Registry `us-east1-docker.pkg.dev/vertigo-erp-produccion/vertigo/{backend,frontend}:<tag>` |
| Secretos | Secret Manager: `postgres-password`, `erp-session-secret`, `pabilo-api-key`, `pabilo-user-bank-id`, `acme-email`, `dominio-savora`, `dominio-hub`, `imagen-tag` |
| Respaldos | el ERP hace `pg_dump` cada 6 h; un temporizador los copia cada hora a `gs://vertigo-erp-respaldos` |
| Cuenta de la VM | `vm-erp@…` con solo: leer imágenes, leer secretos, escribir en el bucket, logs y métricas |

## Entrar a la VM

No hay puerto 22 abierto: se entra por IAP con la cuenta de Google.

```bash
gcloud compute ssh vertigo-erp --zone=us-east1-b --tunnel-through-iap
```

## Publicar una versión nueva

1. Construir las imágenes (desde la raíz del repo; tarda ~5 min, gratis):

```bash
gcloud builds submit backend --tag us-east1-docker.pkg.dev/vertigo-erp-produccion/vertigo/backend:$(git rev-parse --short HEAD) --region=us-east1
```

```bash
gcloud builds submit frontend --tag us-east1-docker.pkg.dev/vertigo-erp-produccion/vertigo/frontend:$(git rev-parse --short HEAD) --region=us-east1
```

2. Decirle a la VM qué versión usar:

```bash
printf $(git rev-parse --short HEAD) | gcloud secrets versions add imagen-tag --data-file=-
```

3. Si cambió algún compose o `locales/`, copiarlos:

```bash
gcloud compute scp docker-compose.yml docker-compose.prod.yml docker-compose.gcp.yml vertigo-erp:/tmp/ --zone=us-east1-b --tunnel-through-iap
```

4. Aplicar: el script de arranque reescribe el `.env` con los secretos y hace
   `up -d`. Se puede reiniciar la VM o correrlo a mano dentro de ella:

```bash
gcloud compute ssh vertigo-erp --zone=us-east1-b --tunnel-through-iap --command='sudo mv /tmp/docker-compose*.yml /docker/erp/ 2>/dev/null; sudo google_metadata_script_runner startup'
```

5. Comprobar los dos: `https://<dominio savora>/api/health` y
   `https://<dominio hub>/api/health`.

## Cambiar un secreto o un dominio

`gcloud secrets versions add <nombre> --data-file=-` con el valor por stdin
(nunca en la línea de comando ni en el chat) y volver a correr el script de
arranque. Los dominios son dos secretos (`dominio-savora`, `dominio-hub`): el
día del cambio a producción se ponen `savora.vertigopro.tech` y
`vertigopro.tech` y Traefik pide los certificados solo.

## Trampas que ya pasaron

- Traefik v3.1 no habla con el Docker nuevo (API 1.24 < 1.40): se usa
  `traefik:v3` con `DOCKER_API_VERSION=1.44`.
- El primer arranque del backend en una e2-micro tarda más de 30 s
  (migraciones): `start_period: 120s` en el compose de GCP.
- `docker cp` a un contenedor parado falla: los archivos del volumen
  `compartido` se escriben en `/var/lib/docker/volumes/erp_comida_compartido/_data`
  con dueño `10001`.
