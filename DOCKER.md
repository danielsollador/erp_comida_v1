# ERP Comida en Docker

## Levantar (local / demo)

```bash
docker compose up -d --build
```

App completa en **http://localhost:8090** (cambia el puerto con `APP_PORT` en `.env`).

La primera visita pide **crear el usuario administrador** (modo instalación).
Con ese usuario se crean los de caja y cocina desde el menú → Usuarios.

| Comando | Para que |
|---|---|
| `docker compose ps` | ver estado y healthchecks |
| `docker compose logs -f backend` | logs de la API |
| `docker compose down` | apagar (los datos se conservan) |
| `docker compose down -v` | apagar **y borrar la base de datos y los usuarios** |

Para el servidor público (Traefik, TLS, hub del dominio raíz) ver
[DESPLIEGUE.md](DESPLIEGUE.md).

## Desarrollo con recarga en caliente

```bash
docker compose -f docker-compose.dev.yml up --build
```

Front en http://localhost:5181 (Vite/HMR), API en http://localhost:8011.
Editar archivos en `backend/app` o `frontend/src` se refleja sin reconstruir.

## Arquitectura de los contenedores

```
navegador ──▶ frontend (nginx :8080) ──┬─▶ /login.html    sin sesion (unico archivo publico)
                 host :8090            ├─▶ /_auth  ──────▶ backend /api/acceso/check  (por cada archivo)
                                       ├─▶ /            SPA compilado          ┐
                                       ├─▶ /api/*  ──▶ backend (uvicorn :8000) │ solo con cookie
                                       └─▶ /ws     ──▶ backend (WebSocket)     ┘
```

Una sola puerta de entrada: el backend **no** se publica al host. Front y API
comparten origen, así que no hay CORS ni URLs de API hardcodeadas.

**Dos cerraduras.** nginx le pregunta al backend si hay sesión antes de servir
un solo archivo del panel (`auth_request`): sin cookie no se descarga ni el
paquete de JavaScript. Y el backend comprueba la sesión y el rol por su cuenta
en cada petición (middleware de `main.py`), porque nginx no es el único camino
hasta él.

## Datos y respaldos

La base es **PostgreSQL 16** (servicio `db`, volumen `erp_comida_pg`), con un
**esquema por local** (`savora`, `hub`, …). Los respaldos (`pg_dump` del
esquema, cada 6 horas) viven en `erp_comida_data` montado en `/data`. Los
usuarios y el secreto de sesión, en `erp_comida_compartido` montado en
`/compartido`. Ninguno está dentro de la imagen: se puede reconstruir sin
perder nada.

Sacar el último respaldo a la máquina host:

```bash
docker compose cp backend:/data/backups ./respaldos
```

O desde la pantalla **Sistema** del ERP, que además restaura.

## Configuración

Copiar `.env.example` a `.env` y ajustar. Variables disponibles:

| Variable | Default | Qué hace |
|---|---|---|
| `APP_PORT` | `8090` | puerto del host (solo local) |
| `TZ` | `America/Caracas` | zona horaria (afecta cierres y reportes por día) |
| `ERP_DATABASE_URL` | *(ver compose)* | conexión a PostgreSQL (`postgresql+psycopg://…`) |
| `ERP_DB_SCHEMA` | `savora` | esquema de PostgreSQL de este local |
| `ERP_BACKUP_INTERVAL_HOURS` | `6` | cada cuánto respalda solo |
| `ERP_BACKUP_RETENER_RECIENTES` | `8` | últimos respaldos que siempre se conservan |
| `ERP_BACKUP_RETENER_DIAS` | `30` | días de historia (el último respaldo de cada día) |
| `ERP_BACKUP_MIRROR_DIR` | vacío | carpeta externa (USB/Drive) con copia del último respaldo |
| `ERP_CORS_ORIGINS` | `*` | orígenes permitidos (irrelevante detrás de nginx) |
| `ERP_LOCAL` | `savora` | qué local sirve este panel (`locales/<slug>.json`) |
| `ERP_SESSION_SECRET` | *(se genera)* | secreto que firma sesiones y pases |
| `ERP_APP_USER` / `ERP_APP_PASSWORD` | *(vacío)* | siembra opcional del primer admin |

## Buenas prácticas aplicadas

- **Multi-stage builds**: el venv de Python y el `dist` de Vite se copian a
  imágenes limpias; no viajan `pip`, `npm` ni `node_modules` al runtime.
- **Sin root**: backend corre como `appuser` (uid 10001), nginx usa la imagen
  `nginx-unprivileged`.
- **Filesystem de solo lectura** en el contenedor de nginx, con `tmpfs` para lo
  que necesita escribir (incluido `/etc/nginx/conf.d`, donde `envsubst` deja la
  configuración final).
- **`no-new-privileges`** en ambos servicios.
- **Healthchecks reales** (`/api/health` y `/healthz`); compose espera a que el
  backend esté `healthy` antes de arrancar nginx.
- **Caché de capas**: `requirements.txt` y `package*.json` se copian antes que
  el código, así un cambio de código no reinstala dependencias.
- **Estado fuera de la imagen**: volúmenes para base de datos, respaldos y
  usuarios.
- **Logs rotados** (10 MB × 3) para que no llenen el disco del local.
- **Configuración por entorno**, con defaults que mantienen el modo sin Docker.
- **Cookie HttpOnly + SameSite**, `secure` detrás de HTTPS; límite de intentos
  de login por IP real (nginx resuelve `X-Forwarded-For` de Traefik).
