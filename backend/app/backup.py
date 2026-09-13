"""Respaldo y restauracion de la base de datos.

El local corre en una sola laptop/mini PC con un archivo SQLite. Si se dana el
disco, se cae el sistema, o alguien borra el archivo sin querer, se pierde
TODO el historico de ventas, inventario y cierres de caja. Este modulo:

1. Copia la base de datos de forma segura (API de backup de sqlite3, no un
   simple copy de archivo: un copy mientras la app esta escribiendo puede
   generar una copia corrupta a medias).
2. Corre solo, cada pocas horas, sin que nadie tenga que acordarse.
3. Retiene por TIEMPO, no por cantidad (ver `_limpiar_antiguos`).
4. Restaura desde la pantalla, sin que nadie toque archivos.

Esto protege contra corrupcion/borrado accidental EN LA MISMA maquina. No
protege si la laptop se pierde, se moja o se la roban - para eso hace falta
sacar una copia fuera de la maquina (USB, correo, Drive). De ahi vienen dos
cosas: el endpoint de descarga, y `BACKUP_MIRROR_DIR` (una carpeta de USB o de
Drive donde se deja copia del ultimo respaldo automaticamente si esta montada).

Sobre el estado (ultima descarga, restauraciones): vive en un JSON FUERA de la
base, no en una tabla. Una tabla se la lleva por delante la propia
restauracion, y justo despues de restaurar es cuando hace falta saber que se
restauro.
"""

import datetime
import glob
import json
import os
import shutil
import sqlite3
import threading
import time
from typing import List, Optional

from .settings import (
    BACKUP_DIR,
    BACKUP_INTERVAL_HOURS,
    BACKUP_MIRROR_DIR,
    BACKUP_RETENER_DIAS,
    BACKUP_RETENER_RECIENTES,
    DATA_DIR,
    DB_PATH,
)

INTERVALO_HORAS = BACKUP_INTERVAL_HOURS

# Tablas sin las cuales un archivo .db no es una base de este ERP. Se revisan
# antes de restaurar: subir el .db equivocado y perder la base buena encima
# seria peor que el problema original.
TABLAS_OBLIGATORIAS = ("pedidos", "ingredientes", "asientos_contables", "cuentas_contables")

RUTA_ESTADO = os.path.join(DATA_DIR, "respaldos_estado.json")

# Restaurar cierra y reemplaza el archivo de la base: no puede pasar dos veces
# a la vez, ni mientras se esta creando un respaldo.
_candado = threading.RLock()


# ---------------------------------------------------------------- estado

def _leer_estado() -> dict:
    try:
        with open(RUTA_ESTADO, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _guardar_estado(estado: dict):
    try:
        with open(RUTA_ESTADO, "w", encoding="utf-8") as f:
            json.dump(estado, f, indent=2)
    except OSError as e:
        print(f"[backup] no se pudo guardar el estado: {e}")


def registrar_descarga(nombre: str):
    """El dueno se bajo un respaldo. Es la unica proteccion real contra perder
    la maquina entera, asi que se lleva la cuenta de cuando fue la ultima."""
    estado = _leer_estado()
    estado["ultima_descarga"] = datetime.datetime.now().isoformat()
    estado["ultima_descarga_archivo"] = nombre
    _guardar_estado(estado)


def restauraciones() -> List[dict]:
    return _leer_estado().get("restauraciones", [])


def _registrar_restauracion(registro: dict):
    estado = _leer_estado()
    historial = estado.get("restauraciones", [])
    historial.insert(0, registro)
    estado["restauraciones"] = historial[:20]
    _guardar_estado(estado)


# ---------------------------------------------------------------- crear

def _ruta_libre(marca: str) -> str:
    """Dos respaldos en el mismo segundo no se pueden pisar."""
    base = os.path.join(BACKUP_DIR, f"comida_{marca}")
    if not os.path.exists(base + ".db"):
        return base + ".db"
    for n in range(2, 100):
        candidato = f"{base}-{n}.db"
        if not os.path.exists(candidato):
            return candidato
    return f"{base}-{int(time.time() * 1000)}.db"


def crear_respaldo(motivo: str = "automatico") -> str:
    with _candado:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        marca = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        destino = _ruta_libre(marca)

        origen_con = sqlite3.connect(DB_PATH)
        destino_con = sqlite3.connect(destino)
        try:
            origen_con.backup(destino_con)
        finally:
            destino_con.close()
            origen_con.close()

        _limpiar_antiguos()
        _espejar(destino)
        return destino


def respaldo_si_hace_falta(motivo: str = "arranque") -> Optional[str]:
    """Respaldo de arranque, pero solo si de verdad toca.

    Antes se respaldaba en CADA arranque. Como la limpieza botaba el mas viejo
    para mantener N copias, cada reinicio se comia historia: medido en este
    equipo, 60 respaldos que debian cubrir 15 dias cubrian 19 minutos. Se va la
    luz tres veces en una noche y amaneces sin respaldos de la semana.
    """
    ultimo = _mas_reciente()
    if ultimo is not None:
        edad_horas = (time.time() - os.stat(ultimo).st_mtime) / 3600
        if edad_horas < INTERVALO_HORAS:
            return None
    return crear_respaldo(motivo)


def _espejar(ruta: str):
    """Copia fuera de la carpeta de la app, si hay una configurada y montada.

    Los respaldos viven al lado de la base: mismo disco, misma carpeta padre.
    Eso no protege contra un disco muerto. Si `ERP_BACKUP_MIRROR_DIR` apunta a
    un USB o a una carpeta de Drive, ahi queda siempre el ultimo. Si el USB no
    esta puesto, no pasa nada: no es motivo para tumbar el respaldo local.
    """
    if not BACKUP_MIRROR_DIR:
        return
    try:
        os.makedirs(BACKUP_MIRROR_DIR, exist_ok=True)
        shutil.copyfile(ruta, os.path.join(BACKUP_MIRROR_DIR, os.path.basename(ruta)))
    except OSError as e:
        print(f"[backup] no se pudo copiar a {BACKUP_MIRROR_DIR}: {e}")


# ---------------------------------------------------------------- retencion

def _archivos() -> List[str]:
    return sorted(glob.glob(os.path.join(BACKUP_DIR, "comida_*.db")))


def _mas_reciente() -> Optional[str]:
    archivos = _archivos()
    return max(archivos, key=lambda r: os.stat(r).st_mtime) if archivos else None


def _dia_de(ruta: str) -> datetime.date:
    return datetime.date.fromtimestamp(os.stat(ruta).st_mtime)


def _limpiar_antiguos():
    """Retencion por tiempo, no por cantidad.

    Se conservan los ultimos N respaldos (para volver atras unas horas) mas el
    ultimo de cada dia de los ultimos D dias (para volver atras una semana).
    Contar copias hacia que un reinicio costara historia; contar dias no.
    """
    archivos = _archivos()
    if not archivos:
        return

    archivos.sort(key=lambda r: os.stat(r).st_mtime)
    conservar = set(archivos[-BACKUP_RETENER_RECIENTES:])

    ultimo_del_dia = {}
    for ruta in archivos:  # ya ordenados: el ultimo de cada dia gana
        ultimo_del_dia[_dia_de(ruta)] = ruta
    limite = datetime.date.today() - datetime.timedelta(days=BACKUP_RETENER_DIAS)
    conservar.update(ruta for dia, ruta in ultimo_del_dia.items() if dia >= limite)

    for ruta in archivos:
        if ruta in conservar:
            continue
        try:
            os.remove(ruta)
        except OSError:
            pass


# ---------------------------------------------------------------- leer

def listar_respaldos() -> List[dict]:
    archivos = sorted(_archivos(), key=lambda r: os.stat(r).st_mtime, reverse=True)
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


def ruta_de(nombre: str) -> str:
    """Resuelve un nombre de respaldo a una ruta dentro de BACKUP_DIR."""
    if "/" in nombre or "\\" in nombre or ".." in nombre:
        raise ValueError("Nombre de archivo invalido")
    return os.path.join(BACKUP_DIR, nombre)


def validar_respaldo(ruta: str) -> dict:
    """Un .db solo es restaurable si abre, esta integro y es de este ERP."""
    if not os.path.isfile(ruta):
        return {"valido": False, "motivo": "El archivo no existe."}
    try:
        con = sqlite3.connect("file:{}?mode=ro".format(ruta.replace("?", "")), uri=True)
    except sqlite3.Error as e:
        return {"valido": False, "motivo": "No se pudo abrir: {}".format(e)}
    try:
        integridad = con.execute("PRAGMA integrity_check").fetchone()[0]
        if integridad != "ok":
            return {"valido": False, "motivo": "El archivo esta danado ({}).".format(integridad)}

        tablas = {f[0] for f in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        faltantes = [t for t in TABLAS_OBLIGATORIAS if t not in tablas]
        if faltantes:
            return {
                "valido": False,
                "motivo": "No parece una base de este sistema (faltan: {}).".format(
                    ", ".join(faltantes)
                ),
            }

        pedidos = con.execute("SELECT COUNT(*) FROM pedidos").fetchone()[0]
        ultima = con.execute("SELECT MAX(creado_en) FROM pedidos").fetchone()[0]
        return {
            "valido": True,
            "motivo": "",
            "pedidos": pedidos,
            "ultima_venta": ultima,
        }
    except sqlite3.Error as e:
        return {"valido": False, "motivo": "No se pudo leer: {}".format(e)}
    finally:
        con.close()


def que_se_pierde(ruta: str) -> dict:
    """Cuanto trabajo se borra si se restaura este respaldo.

    Nadie debe confirmar una restauracion viendo un nombre de archivo. Lo que
    importa es "vas a perder 14 pedidos por $87 desde las 12:00".
    """
    info = validar_respaldo(ruta)
    if not info["valido"]:
        return {"valido": False, "motivo": info["motivo"]}

    corte = info["ultima_venta"]

    # El total del pedido no es una columna: se arma sumando sus items. Sumar
    # una columna `total` inexistente devolvia un error que un `except` amplio
    # convertia en "no se pierde nada", que es la peor respuesta posible aca.
    consulta = (
        "SELECT COUNT(DISTINCT p.id), "
        "       COALESCE(SUM(i.precio_unitario * i.cantidad), 0) "
        "FROM pedidos p LEFT JOIN pedido_items i ON i.pedido_id = p.id "
        "WHERE p.estado != 'anulado'"
    )

    viva = sqlite3.connect("file:{}?mode=ro".format(DB_PATH), uri=True)
    try:
        if corte:
            fila = viva.execute(consulta + " AND p.creado_en > ?", (corte,)).fetchone()
        else:
            fila = viva.execute(consulta).fetchone()
        perdidos, monto = fila[0], round(fila[1] or 0.0, 2)
    except sqlite3.Error as e:
        # Si no se pudo medir, se dice que no se pudo medir. Un 0 aqui haria
        # que el dueno confirmara una restauracion creyendo que no pierde nada.
        print(f"[backup] no se pudo medir la perdida: {e}")
        perdidos, monto = None, None
    finally:
        viva.close()

    return {
        "valido": True,
        "motivo": "",
        "corte": corte,
        "pedidos_en_el_respaldo": info["pedidos"],
        "pedidos_que_se_pierden": perdidos,
        "monto_que_se_pierde": monto,
    }


def estado() -> dict:
    ultimo = _mas_reciente()
    est = _leer_estado()

    descarga = est.get("ultima_descarga")
    dias_sin_descargar = None
    if descarga:
        try:
            delta = datetime.datetime.now() - datetime.datetime.fromisoformat(descarga)
            dias_sin_descargar = delta.days
        except ValueError:
            pass

    historial = est.get("restauraciones", [])
    reciente = None
    if historial:
        try:
            cuando = datetime.datetime.fromisoformat(historial[0]["fecha"])
            if (datetime.datetime.now() - cuando).total_seconds() < 24 * 3600:
                reciente = historial[0]
        except (ValueError, KeyError):
            pass

    return {
        "ultimo_respaldo": (
            datetime.datetime.fromtimestamp(os.stat(ultimo).st_mtime).isoformat()
            if ultimo
            else None
        ),
        "cantidad": len(_archivos()),
        "dia_mas_viejo": _dia_de(min(_archivos(), key=lambda r: os.stat(r).st_mtime)).isoformat()
        if _archivos()
        else None,
        "ultima_descarga": descarga,
        "dias_sin_descargar": dias_sin_descargar,
        "copia_externa": BACKUP_MIRROR_DIR or None,
        "restauracion_reciente": reciente,
    }


# ---------------------------------------------------------------- restaurar

def restaurar(ruta: str, etiqueta: str) -> dict:
    """Reemplaza la base viva por este respaldo.

    Secuencia, en este orden y sin saltarse ninguno:
      1. Validar el archivo (integro y de este sistema).
      2. Respaldar la base ACTUAL, por si la restauracion era el error.
      3. Soltar las conexiones del pool.
      4. Volcar el respaldo DENTRO del archivo vivo con la API de sqlite3, en
         vez de reemplazar el archivo. Reemplazarlo fallaba en Windows con
         "Acceso denegado" porque siempre queda algun handle abierto; ademas
         dejaba huerfanos los journals -wal/-shm de la base vieja. Volcar por
         SQLite deja que el propio motor tome el lock y rehaga los journals.
      5. Dejar constancia FUERA de la base: el cierre de caja de hoy va a dar
         un faltante que no es faltante, y alguien tiene que poder explicarlo.
    """
    from .database import engine  # local: evita ciclo de importacion

    with _candado:
        info = validar_respaldo(ruta)
        if not info["valido"]:
            return {"ok": False, "motivo": info["motivo"]}

        perdida = que_se_pierde(ruta)
        respaldo_previo = crear_respaldo(motivo="antes_de_restaurar")

        engine.dispose()

        origen = sqlite3.connect(ruta)
        destino = sqlite3.connect(DB_PATH, timeout=30)
        try:
            origen.backup(destino)
        except sqlite3.Error as e:
            return {"ok": False, "motivo": "No se pudo reemplazar la base: {}".format(e)}
        finally:
            destino.close()
            origen.close()
            engine.dispose()  # el pool no debe reusar conexiones de la base vieja

        registro = {
            "fecha": datetime.datetime.now().isoformat(),
            "restaurado_desde": etiqueta,
            "respaldo_previo": os.path.basename(respaldo_previo),
            "pedidos_perdidos": perdida.get("pedidos_que_se_pierden"),
            "monto_perdido": perdida.get("monto_que_se_pierde"),
            "corte": perdida.get("corte"),
        }
        _registrar_restauracion(registro)
        return {"ok": True, **registro}


# ---------------------------------------------------------------- automatico

def _loop_respaldos():
    while True:
        time.sleep(INTERVALO_HORAS * 3600)
        try:
            crear_respaldo()
        except Exception as e:  # nunca debe tumbar el servidor por esto
            print(f"[backup] fallo al respaldar: {e}")


def iniciar_respaldos_automaticos():
    hilo = threading.Thread(target=_loop_respaldos, daemon=True)
    hilo.start()
