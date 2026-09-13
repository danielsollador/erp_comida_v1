# ERP Comida en Docker

## Levantar (produccion / demo)

```bash
docker compose up -d --build
```

App completa en **http://localhost:8090** (cambia el puerto con `APP_PORT` en `.env`).

| Comando | Para que |
|---|---|
| `docker compose ps` | ver estado y healthchecks |
| `docker compose logs -f backend` | logs de la API |
| `docker compose down` | apagar (los datos se conservan) |
| `docker compose down -v` | apagar **y borrar la base de datos** |

## Desarrollo con recarga en caliente

```bash
docker compose -f docker-compose.dev.yml up --build
```

Front en http://localhost:5181 (Vite/HMR), API en http://localhost:8011.
Editar archivos en `backend/app` o `frontend/src` se refleja sin reconstruir.

## Arquitectura de los contenedores

```
navegador ──▶ frontend (nginx :8080) ──┬─▶ /            SPA compilado
                 host :8090            ├─▶ /api/*  ──▶ backend (uvicorn :8000)
                                       └─▶ /ws     ──▶ backend (WebSocket)
```

Una sola puerta de entrada: el backend **no** se publica al host. Front y API
comparten origen, asi que no hay CORS ni URLs de API hardcodeadas.

## Datos y respaldos

La base SQLite y los respaldos automaticos viven en el volumen `erp_comida_data`
montado en `/data`, no dentro de la imagen: se puede reconstruir sin perder nada.

Sacar una copia a la maquina host:

```bash
docker compose cp backend:/data/comida.db ./comida-backup.db
```

## Configuracion

Copiar `.env.example` a `.env` y ajustar. Variables disponibles:

| Variable | Default | Que hace |
|---|---|---|
| `APP_PORT` | `8090` | puerto del host |
| `TZ` | `America/Caracas` | zona horaria (afecta cierres y reportes por dia) |
| `ERP_BACKUP_INTERVAL_HOURS` | `6` | cada cuanto respalda solo |
| `ERP_BACKUP_RETENER_RECIENTES` | `8` | ultimos respaldos que siempre se conservan |
| `ERP_BACKUP_RETENER_DIAS` | `30` | dias de historia (el ultimo respaldo de cada dia) |
| `ERP_BACKUP_MIRROR_DIR` | vacio | carpeta externa (USB/Drive) con copia del ultimo respaldo |
| `ERP_CORS_ORIGINS` | `*` | origenes permitidos (irrelevante detras de nginx) |

## Buenas practicas aplicadas

- **Multi-stage builds**: el venv de Python y el `dist` de Vite se copian a
  imagenes limpias; no viajan `pip`, `npm` ni `node_modules` al runtime.
- **Sin root**: backend corre como `appuser` (uid 10001), nginx usa la imagen
  `nginx-unprivileged`.
- **Filesystem de solo lectura** en el contenedor de nginx, con `tmpfs` para lo
  que necesita escribir.
- **`no-new-privileges`** en ambos servicios.
- **Healthchecks reales** (`/api/health` y `/healthz`); compose espera a que el
  backend este `healthy` antes de arrancar nginx.
- **Cache de capas**: `requirements.txt` y `package*.json` se copian antes que
  el codigo, asi un cambio de codigo no reinstala dependencias.
- **Estado fuera de la imagen**: volumen para base de datos y respaldos.
- **Logs rotados** (10 MB x 3) para que no llenen el disco del local.
- **Configuracion por entorno**, con defaults que mantienen el modo sin Docker.
