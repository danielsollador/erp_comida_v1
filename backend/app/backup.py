"""Respaldo automatico de la base de datos.

El local corre en una sola laptop/mini PC con un archivo SQLite. Si se dana el
disco, se cae el sistema, o alguien borra el archivo sin querer, se pierde
TODO el historico de ventas, inventario y cierres de caja. Este modulo:

1. Copia la base de datos de forma segura (API de backup de sqlite3, no un
   simple copy de archivo: un copy mientras la app esta escribiendo puede
   generar una copia corrupta a medias).
2. Corre solo, cada pocas horas, sin que nadie tenga que acordarse.
3. Mantiene los ultimos N respaldos y borra los viejos para no llenar el disco.

Esto protege contra corrupcion/borrado accidental EN LA MISMA maquina. No
protege si la laptop se pierde, se moja o se la roban - para eso hace falta
sacar una copia fuera de la maquina (USB, correo, Drive). Por eso el endpoint
de descarga: el dueno puede bajarse el ultimo respaldo con un clic y llevarselo
a su telefono una vez por semana, sin depender de ningun servicio pago.
"""

import datetime
import glob
import os
import sqlite3
import threading
import time

from .settings import (
    BACKUP_DIR,
    BACKUP_INTERVAL_HOURS,
    BACKUP_KEEP,
    DB_PATH,
)

INTERVALO_HORAS = BACKUP_INTERVAL_HOURS
MANTENER_RESPALDOS = BACKUP_KEEP  # por defecto ~15 dias a razon de 4 al dia


def crear_respaldo() -> str:
    os.makedirs(BACKUP_DIR, exist_ok=True)
    marca = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    destino = os.path.join(BACKUP_DIR, f"comida_{marca}.db")

    origen_con = sqlite3.connect(DB_PATH)
    destino_con = sqlite3.connect(destino)
    try:
        origen_con.backup(destino_con)
    finally:
        destino_con.close()
        origen_con.close()

    _limpiar_antiguos()
    return destino


def _limpiar_antiguos():
    respaldos = sorted(glob.glob(os.path.join(BACKUP_DIR, "comida_*.db")))
    for viejo in respaldos[:-MANTENER_RESPALDOS]:
        try:
            os.remove(viejo)
        except OSError:
            pass


def listar_respaldos():
    archivos = sorted(glob.glob(os.path.join(BACKUP_DIR, "comida_*.db")), reverse=True)
    resultado = []
    for ruta in archivos:
        stat = os.stat(ruta)
        resultado.append(
            {
                "nombre": os.path.basename(ruta),
                "tamano_kb": round(stat.st_size / 1024, 1),
                "creado_en": datetime.datetime.fromtimestamp(stat.st_mtime).isoformat(),
            }
        )
    return resultado


def _loop_respaldos():
    while True:
        try:
            crear_respaldo()
        except Exception as e:  # nunca debe tumbar el servidor por esto
            print(f"[backup] fallo al respaldar: {e}")
        time.sleep(INTERVALO_HORAS * 3600)


def iniciar_respaldos_automaticos():
    hilo = threading.Thread(target=_loop_respaldos, daemon=True)
    hilo.start()
