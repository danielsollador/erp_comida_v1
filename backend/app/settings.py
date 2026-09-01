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

DATABASE_URL = os.getenv("ERP_DATABASE_URL", f"sqlite:///{DB_PATH}")

# Cada cuantas horas se respalda solo, y cuantos respaldos se guardan.
BACKUP_INTERVAL_HOURS = float(os.getenv("ERP_BACKUP_INTERVAL_HOURS", "6"))
BACKUP_KEEP = int(os.getenv("ERP_BACKUP_KEEP", "60"))
BACKUP_ON_STARTUP = os.getenv("ERP_BACKUP_ON_STARTUP", "1") not in ("0", "false", "False")

# Origenes permitidos para CORS. Detras de nginx el front y la API comparten
# origen y esto no hace falta; se deja configurable para desarrollo.
CORS_ORIGINS = [o.strip() for o in os.getenv("ERP_CORS_ORIGINS", "*").split(",") if o.strip()]

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(BACKUP_DIR, exist_ok=True)
