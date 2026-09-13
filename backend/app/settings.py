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

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(BACKUP_DIR, exist_ok=True)
