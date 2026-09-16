"""Configuracion por variables de entorno.

Todo lo que cambia entre "mi laptop" y "el contenedor" vive aca y tiene un
valor por defecto sensato, para que la app siga corriendo igual sin Docker.
"""

import os

# Carpeta donde viven la base de datos y los respaldos. En Docker se monta un
# volumen aca, para que los datos sobrevivan a un rebuild de la imagen.
DATA_DIR = os.getenv(
    "ERP_DATA_DIR",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
)

DB_PATH = os.getenv("ERP_DB_PATH", os.path.join(DATA_DIR, "comida.db"))
BACKUP_DIR = os.getenv("ERP_BACKUP_DIR", os.path.join(DATA_DIR, "backups"))

# EN PRODUCCION ES POSTGRESQL. El compose lo pone (`postgresql+psycopg://...`);
# el SQLite por defecto existe solo para correr la app y las pruebas sin
# Docker en una laptop. Cada local vive en su propio ESQUEMA de PostgreSQL
# (ver `DB_SCHEMA` mas abajo y `database.py`).
DATABASE_URL = os.getenv("ERP_DATABASE_URL", f"sqlite:///{DB_PATH}")
ES_POSTGRES = DATABASE_URL.startswith("postgresql")

# Cada cuantas horas se respalda solo.
BACKUP_INTERVAL_HOURS = float(os.getenv("ERP_BACKUP_INTERVAL_HOURS", "6"))

# Retencion por TIEMPO, no por cantidad: los ultimos N respaldos (para volver
# atras unas horas) mas el ultimo de cada dia de los ultimos D dias (para
# volver atras una semana). Con retencion por cantidad, cada reinicio del
# servidor botaba el respaldo mas viejo y se comia la historia.
BACKUP_RETENER_RECIENTES = int(os.getenv("ERP_BACKUP_RETENER_RECIENTES", "8"))
BACKUP_RETENER_DIAS = int(os.getenv("ERP_BACKUP_RETENER_DIAS", "30"))

BACKUP_ON_STARTUP = os.getenv("ERP_BACKUP_ON_STARTUP", "1") not in ("0", "false", "False")

# Carpeta FUERA de la app donde se deja copia del ultimo respaldo: un USB
# siempre puesto, una carpeta sincronizada con Drive. Los respaldos viven al
# lado de la base, en el mismo disco; eso no salva de un disco muerto. Si no
# esta configurada o no esta montada, el respaldo local se hace igual.
BACKUP_MIRROR_DIR = os.getenv("ERP_BACKUP_MIRROR_DIR", "").strip()

# Origenes permitidos para CORS. Detras de nginx el front y la API comparten
# origen y esto no hace falta; se deja configurable para desarrollo.
CORS_ORIGINS = [o.strip() for o in os.getenv("ERP_CORS_ORIGINS", "*").split(",") if o.strip()]

# ── Acceso ─────────────────────────────────────────────────────────────────
# Usuarios y secreto de sesion. En Docker es un volumen COMPARTIDO entre el
# panel del local y el hub del dominio raiz: es lo que hace que una cuenta
# valga en los dos. Fuera de Docker, una carpeta junto a la base de datos.
SHARED_DIR = os.getenv("ERP_SHARED_DIR", os.path.join(DATA_DIR, "compartido"))
# El secreto con el que se firman sesiones y pases. Si esta vacio se genera
# uno la primera vez y se guarda en SHARED_DIR. TIENE que ser el mismo en el
# hub y en el panel: con el volumen compartido lo es aunque no se defina.
SESSION_SECRET = os.getenv("ERP_SESSION_SECRET", "").strip()

# Si este proceso es el HUB (vertigopro.tech: login y redireccion al local) o
# el panel de UN local (savora.vertigopro.tech). Por defecto, panel: equivocarse
# hacia "panel" deja a alguien en su propio ERP; hacia "hub", sin ERP.
ES_HUB = os.getenv("ERP_ES_HUB", "0").strip().lower() in ("1", "true", "yes")
# Que local sirve este panel. Su ficha es `locales/<slug>.json`.
LOCAL_SLUG = os.getenv("ERP_LOCAL", "savora").strip() or "savora"
# Donde estan las fichas. Fuera de Docker, la carpeta `locales/` del repo.
LOCALES_DIR = os.getenv(
    "ERP_LOCALES_DIR",
    os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "locales"),
)
# A donde vuelve el enlace "Vertigo Pro" del panel. Vacio = no se muestra.
HUB_URL = os.getenv("ERP_HUB_URL", "").strip().rstrip("/")

# Siembra del primer usuario, OPCIONAL. Sin esto, la primera visita al ERP
# pide crear el administrador desde el navegador (modo instalacion).
APP_USER = os.getenv("ERP_APP_USER", "admin").strip() or "admin"
APP_PASSWORD = os.getenv("ERP_APP_PASSWORD", "")

# ── Base de datos: un esquema por local ─────────────────────────────────────
# Una sola instancia de PostgreSQL y una sola base (`vertigo`), y dentro un
# ESQUEMA por local: `savora`, el siguiente que venga, y `hub` para el hub.
# Se eligio esquema-por-local y no base-por-local porque comparte una sola
# instancia que respaldar y vigilar, y aun asi cada local tiene sus tablas
# aparte: un `SELECT` de un local no puede tocar las filas de otro sin
# nombrar su esquema, y el `search_path` de cada proceso solo tiene el suyo.
DB_SCHEMA = (os.getenv("ERP_DB_SCHEMA", "").strip()
             or ("hub" if ES_HUB else LOCAL_SLUG)).replace("-", "_").lower()

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(BACKUP_DIR, exist_ok=True)
