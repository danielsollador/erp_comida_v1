# Despliegue en producción

Servidor: **2.25.223.224** (`srv1983471`, Hostinger, Ubuntu 24.04), en
`/docker/erp_comida_v1`. Traefik ya corre ahí en **red host** (puertos 80/443,
Let's Encrypt, redirección http→https), en `/docker/traefik`.

| Qué | Dominio | Contenedores |
|---|---|---|
| **Base de datos** | — (no se publica) | `db` (PostgreSQL 16) |
| **ERP de Sávora** | `savora.vertigopro.tech` | `backend` + `frontend` |
| **Hub Vertigo Pro** (login, cartera, cuentas) | `vertigopro.tech`, `www.vertigopro.tech` | `hub-backend` + `hub-frontend` |

DNS: registros **A** en Hostinger para `@` y `savora` → `2.25.223.224`; `www` es
un CNAME al raíz.

## La base: PostgreSQL, un esquema por local

Una sola instancia (`db`), una base (`vertigo`) y un **esquema** por local:
`savora` para Sávora, `hub` para el hub, y el siguiente local tendrá el suyo.
Cada backend arranca con `ERP_DB_SCHEMA` y su `search_path` solo tiene ese
esquema: `SELECT * FROM pedidos` es siempre `savora.pedidos` y nunca el de otro
cliente.

Se eligió esquema-por-local y no base-por-local porque es **una sola instancia
que respaldar y vigilar**, y aun así cada local tiene sus tablas aparte. El día
que un cliente pida su base separada, es un `pg_dump -n <esquema>` a otra
instancia y cambiar una variable.

El puerto 5432 **no se publica**: solo los backends hablan con la base, con la
clave de `POSTGRES_PASSWORD` del `.env` del servidor.

**Respaldos**: `pg_dump` del esquema (formato custom, comprimido) cada 6 horas
desde el propio backend, con retención por tiempo (8 recientes + el último de
cada día de los últimos 30). Se descargan y **se restauran desde la pantalla
Sistema**. Restaurar renombra el esquema vivo a `savora_previo`, restaura en
una transacción, y solo si terminó bien lo suelta: un archivo malo no cuesta la
base buena. Junto a cada `.dump` va un `.json` con cuántos pedidos tenía y hasta
cuándo: es lo que permite decir "vas a perder 14 pedidos por $87" antes de
confirmar.

## Las dos puertas y los cuatro roles

- `savora.vertigopro.tech` → login → **el ERP**. Es el enlace del local.
- `vertigopro.tech` → login → depende de quién entra:
  - **Vertigo** (`admin`) se queda en el hub: cartera de locales con su estado
    y administración de todas las cuentas.
  - quien tiene **un** local es mandado a él con un **pase** (un minuto, un
    local, un uso), sin volver a poner la clave y **sin cookie en el hub**.
  - quien tiene varios, elige.

| Rol | Puede |
|---|---|
| `admin` (Vertigo) | Todo, en todos los locales. Crea dueños y reparte locales. Único que ve el hub de administración. |
| `dueno` | Todo **dentro de su local**: contabilidad, impuestos, respaldos y las cuentas de su gente (dueño, caja, cocina). No ve a Vertigo ni otros locales. |
| `caja` | POS, cocina, caja, inventario, compras, menú, tasa, reportes. |
| `cocina` | Solo la pantalla de cocina (ver comandas, marcarlas listas). |

La tabla está en `backend/app/acceso/permisos.py` y la aplica el middleware de
`main.py` a **toda** petición. Esconder un botón en el frontend es comodidad;
la cerradura es esa. Quien entra con su clave **es el operador**: cada pedido,
anulación, retiro y cierre queda a su nombre sin elegir nada en la tablet
(`operadores.del_turno`).

Hub y panel comparten el volumen `erp_comida_compartido` (`users.json` +
`session_secret`) y la base: la misma cuenta entra por los dos y el pase que
firma uno lo valida el otro.

## Procedimiento

Todo desde `/docker/erp_comida_v1` en el servidor.

### 1. Subir el código

No hay `rsync` en la laptop de Windows; se empaqueta con `tar` por SSH desde la
carpeta del repo:

```bash
tar --exclude=./.git --exclude=./frontend/node_modules --exclude=./backend/.venv --exclude=./frontend/dist \
    --exclude=./backend/compartido --exclude='*.db' --exclude=./backend/backups --exclude=./.env \
    --exclude=./backend/.pytest_cache --exclude='__pycache__' \
    -czf - . | ssh root@2.25.223.224 "tar -xzf - -C /docker/erp_comida_v1"
```

**El `.env` no viaja.** Vive solo en el servidor y lleva `ERP_SESSION_SECRET` y
`POSTGRES_PASSWORD` (los dos generados allá con `openssl rand`).

### 2. Levantar

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

El compose de producción **no publica ningún puerto**: todo entra por Traefik
con certificado. Los cinco contenedores tienen healthcheck; `docker compose ps`
debe mostrarlos `healthy`. **Traefik filtra los contenedores que no lo están**:
un frontend enfermo no recibe router ni certificado.

### 3. Primera vez: crear el administrador de Vertigo

La primera visita a cualquiera de los dos dominios muestra **modo
instalación**: crea la cuenta de Vertigo. En cuanto existe una, ese formulario
deja de aceptar a nadie más (409). Hacerlo **enseguida** después del primer
despliegue.

Después, desde el hub (`vertigopro.tech` → Administración → Cuentas) se crea
el **dueño** de Sávora con su local asignado. El dueño, desde su ERP → menú de
usuario → Usuarios, crea a su gente de caja y cocina.

## Cosas que muerden

- **Traefik está en `network_mode: host`**: alcanza los contenedores por su IP
  de bridge. No hay ninguna red que compartir con él; bastan las etiquetas.
- **Un router por dominio**, nunca `Host(a) || Host(b)`: Let's Encrypt emite
  todo o nada y el dominio que falle tumba al otro.
- **Un tmpfs de compose copia el modo de la carpeta de la imagen pero la
  monta de root.** `/etc/nginx/conf.d` va con `mode: 0o1777` explícito; sin
  eso nginx (uid 101) no escribe la plantilla, arranca sin `server` y nunca
  está `healthy`.
- **Un volumen montado en una ruta que no existe en la imagen nace de root.**
  `/compartido` se crea en el Dockerfile con dueño `appuser` (uid 10001).
- **`docker exec` entra como `appuser`** en el backend, así que escribir
  `users.json` desde un exec es seguro. Si alguna vez queda de root:
  `docker compose exec -u root backend chown -R 10001:10001 /compartido`.
- **pg_dump tiene que ser ≥ la versión del servidor.** El backend instala
  `postgresql-client-16` del repositorio oficial de PostgreSQL; el compose usa
  `postgres:16-alpine`. Si se sube el servidor, se sube el cliente.
- **Todo el ERP, cocina incluida, sigue el interruptor claro/oscuro**
  (`vertigo_tema` en localStorage). La cocina iba oscura fija hasta el 16-sep.
- Errores de Traefik `Cannot retrieve the ACME challenge for vertigopro.tech`
  anteriores al despliegue vienen de un cliente ACME **externo** (el hosting
  web de Hostinger) que pide certificado para el mismo dominio. No bloquean
  nada; conviene apagarle el SSL automático a ese plan si sigue activo.

## Añadir un local

1. `locales/<slug>.json` con nombre, `dominio`, `url`, `interno`
   (`http://<servicio>-backend:8000`), `logo` y `favicon` (archivos en
   `frontend/public/`).
2. Registro A del subdominio → la IP del servidor.
3. Dos servicios en el compose de producción copiando los de Sávora, con
   `ERP_LOCAL`, `ERP_DB_SCHEMA` y `BACKEND_HOST` propios y su router de
   Traefik. La base es la misma: el esquema se crea solo al arrancar.
4. Desde el hub, crear al dueño con ese local asignado.

Ni una línea de código.

## Pruebas

```bash
cd backend && python -m pytest -q
```

Corren sobre SQLite en memoria (rápido, sin Docker). `tests/test_acceso.py`
recorre la lista **real** de rutas y comprueba que ninguna responda sin sesión,
que cada rol haga solo lo suyo —incluido que un dueño no vea ni toque a
Vertigo—, que un pase no valga como sesión ni al revés, y que nginx sirva sin
cookie **únicamente** `login.html`, iconos y logos.
