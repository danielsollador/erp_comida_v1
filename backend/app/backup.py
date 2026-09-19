"""Respaldo y restauracion de la base de datos.

Si se dana el disco, se cae el sistema, o alguien borra algo sin querer, se
pierde TODO el historico de ventas, inventario y cierres de caja. Este modulo:

1. Saca una copia consistente de la base. En PostgreSQL con `pg_dump` del
   esquema de este local (formato custom, comprimido); en SQLite --solo
   desarrollo-- con la API de backup de sqlite3.
2. Corre solo, cada pocas horas, sin que nadie tenga que acordarse.
3. Retiene por TIEMPO, no por cantidad (ver `_limpiar_antiguos`).
4. Restaura desde la pantalla, sin que nadie toque archivos.

Esto protege contra corrupcion/borrado accidental EN LA MISMA maquina. No
protege si el servidor entero se pierde: para eso esta el endpoint de descarga
y `BACKUP_MIRROR_DIR` (una carpeta externa donde se deja copia del ultimo).

Sobre el estado (ultima descarga, restauraciones): vive en un JSON FUERA de la
base, no en una tabla. Una tabla se la lleva por delante la propia
restauracion, y justo despues de restaurar es cuando hace falta saber que se
restauro.

QUE SE PIERDE AL RESTAURAR. Nadie debe confirmar viendo un nombre de archivo:
lo que importa es "vas a perder 14 pedidos por $87 desde las 12:00". Con SQLite
se abre el respaldo y se mira. Un volcado de PostgreSQL no se puede leer sin
restaurarlo, asi que al crearlo se guarda al lado un `.json` con cuantos
pedidos tenia y hasta cuando: es lo que permite medir la perdida despues.
"""

import datetime
import glob
import json
import os
import shutil
import sqlite3
import subprocess
import threading
import time
from typing import List, Optional

from sqlalchemy import text
from sqlalchemy.engine import make_url

from .settings import (
    BACKUP_DIR,
    BACKUP_INTERVAL_HOURS,
    BACKUP_MIRROR_DIR,
    BACKUP_RETENER_DIAS,
    BACKUP_RETENER_RECIENTES,
    DATA_DIR,
    DATABASE_URL,
    DB_PATH,
    DB_SCHEMA,
    ES_POSTGRES,
)

INTERVALO_HORAS = BACKUP_INTERVAL_HOURS

# Un volcado de PostgreSQL o un archivo de SQLite: el resto del modulo no
# distingue, salvo donde dice.
EXTENSION = ".dump" if ES_POSTGRES else ".db"
PREFIJO = "comida_"

# Tablas sin las cuales un archivo no es una base de este ERP. Se revisan
# antes de restaurar: subir el archivo equivocado y perder la base buena encima
# seria peor que el problema original.
TABLAS_OBLIGATORIAS = ("TRX110_VEN_PEDIDO", "DIM310_INV_INGREDIENTE",
                       "TRX610_CON_ASIENTO", "DIM610_CON_CUENTA")
# Los mismos, como se llamaban antes de la nomenclatura: un respaldo de
# entonces sigue siendo de este ERP y se puede restaurar (`renombrar_tablas`
# lo pone al dia en el siguiente arranque).
TABLAS_OBLIGATORIAS_VIEJAS = ("pedidos", "ingredientes", "asientos_contables", "cuentas_contables")

RUTA_ESTADO = os.path.join(DATA_DIR, "respaldos_estado.json")

# Restaurar reemplaza la base: no puede pasar dos veces a la vez, ni mientras
# se esta creando un respaldo.
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
    est = _leer_estado()
    est["ultima_descarga"] = datetime.datetime.now().isoformat()
    est["ultimo_descargado"] = nombre
    _guardar_estado(est)


def _registrar_fallo(motivo: str, error: str):
    """Deja constancia de que un respaldo NO se pudo hacer.

    Hasta ahora un respaldo roto solo se veia en el log del contenedor, que
    nadie mira. Paso de verdad: al pasar los esquemas a mayusculas, `pg_dump`
    empezo a fallar y la pantalla de Sistema siguio diciendo "ultimo respaldo
    hace N horas" -- con un numero que crecia y crecia sin que nada avisara.
    """
    est = _leer_estado()
    est["ultimo_fallo"] = {
        "fecha": datetime.datetime.now().isoformat(),
        "motivo": motivo,
        "error": error[:500],
    }
    _guardar_estado(est)


def _limpiar_fallo():
    est = _leer_estado()
    if est.pop("ultimo_fallo", None) is not None:
        _guardar_estado(est)


def restauraciones() -> List[dict]:
    return _leer_estado().get("restauraciones", [])


def _registrar_restauracion(registro: dict):
    est = _leer_estado()
    historial = [registro] + est.get("restauraciones", [])
    est["restauraciones"] = historial[:20]
    _guardar_estado(est)


# ---------------------------------------------------------------- PostgreSQL

def _pg_entorno() -> dict:
    """Las variables que `pg_dump`/`pg_restore` leen, sacadas de la URL de la
    base. La clave viaja por entorno del subproceso, nunca en la linea de
    comandos (donde `ps` la mostraria)."""
    u = make_url(DATABASE_URL)
    env = dict(os.environ)
    env.update({
        "PGHOST": u.host or "localhost",
        "PGPORT": str(u.port or 5432),
        "PGUSER": u.username or "",
        "PGPASSWORD": u.password or "",
        "PGDATABASE": u.database or "",
    })
    return env


def _pg(comando: List[str], timeout: int = 600) -> subprocess.CompletedProcess:
    return subprocess.run(comando, env=_pg_entorno(), capture_output=True,
                          text=True, timeout=timeout)


def _patron_de_esquema(nombre: str) -> str:
    """El esquema tal como `pg_dump --schema` tiene que recibirlo.

    `--schema` no toma un nombre: toma un PATRON con las reglas de `psql \\d`,
    y esas reglas pliegan a minusculas lo que no va entre comillas. Con los
    esquemas en mayusculas (`SAVORA`), `--schema=SAVORA` busca `savora`, no lo
    encuentra y pg_dump falla con "no matching schemas were found" -- que es
    exactamente lo que paso en produccion: el respaldo automatico llevaba
    horas fallando en silencio porque el error solo salia en el log.
    """
    return f'"{nombre}"'


def _pg_dump(destino: str) -> None:
    r = _pg(["pg_dump", "--format=custom", "--no-owner", "--no-privileges",
             f"--schema={_patron_de_esquema(DB_SCHEMA)}", f"--file={destino}"])
    if r.returncode != 0:
        try:
            os.remove(destino)
        except OSError:
            pass
        raise RuntimeError(f"pg_dump fallo: {r.stderr.strip()[:500]}")


def _medir_base_viva() -> dict:
    """Cuantos pedidos tiene la base AHORA y hasta cuando. Se guarda junto al
    volcado de PostgreSQL, que no se puede leer sin restaurarlo."""
    from .database import engine  # local: evita ciclo de importacion

    try:
        with engine.connect() as con:
            fila = con.execute(text(
                'SELECT COUNT(*), MAX(creado_en) FROM "TRX110_VEN_PEDIDO"')).fetchone()
        ultima = fila[1]
        if isinstance(ultima, datetime.datetime):
            ultima = ultima.isoformat()
        return {"pedidos": int(fila[0] or 0), "ultima_venta": ultima}
    except Exception as e:  # noqa: BLE001
        print(f"[backup] no se pudo medir la base: {e}")
        return {"pedidos": None, "ultima_venta": None}


def _ruta_meta(ruta: str) -> str:
    return ruta + ".json"


def _escribir_meta(ruta: str) -> None:
    meta = _medir_base_viva()
    meta.update({"esquema": DB_SCHEMA, "creado_en": datetime.datetime.now().isoformat()})
    try:
        with open(_ruta_meta(ruta), "w", encoding="utf-8") as f:
            json.dump(meta, f)
    except OSError as e:
        print(f"[backup] no se pudo escribir la ficha del respaldo: {e}")


def _leer_meta(ruta: str) -> dict:
    try:
        with open(_ruta_meta(ruta), "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


# ---------------------------------------------------------------- crear

def _ruta_libre(marca: str) -> str:
    """Dos respaldos en el mismo segundo no se pueden pisar."""
    base = os.path.join(BACKUP_DIR, f"{PREFIJO}{marca}")
    if not os.path.exists(base + EXTENSION):
        return base + EXTENSION
    for n in range(2, 100):
        candidato = f"{base}-{n}{EXTENSION}"
        if not os.path.exists(candidato):
            return candidato
    return f"{base}-{int(time.time() * 1000)}{EXTENSION}"


def crear_respaldo(motivo: str = "automatico") -> str:
    with _candado:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        marca = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        destino = _ruta_libre(marca)

        # Unico sitio por donde pasan todos los respaldos: aqui se anota si
        # fallo, para que la pantalla de Sistema lo pueda decir.
        try:
            if ES_POSTGRES:
                _pg_dump(destino)
                _escribir_meta(destino)
            else:
                origen_con = sqlite3.connect(DB_PATH)
                destino_con = sqlite3.connect(destino)
                try:
                    origen_con.backup(destino_con)
                finally:
                    destino_con.close()
                    origen_con.close()
        except Exception as e:
            _registrar_fallo(motivo, str(e))
            raise

        _limpiar_fallo()
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

    Los respaldos viven al lado de la base: mismo disco. Eso no protege contra
    un disco muerto. Si `ERP_BACKUP_MIRROR_DIR` apunta a otra parte, ahi queda
    siempre el ultimo. Si no esta montada, no es motivo para tumbar el local.
    """
    if not BACKUP_MIRROR_DIR:
        return
    try:
        os.makedirs(BACKUP_MIRROR_DIR, exist_ok=True)
        shutil.copyfile(ruta, os.path.join(BACKUP_MIRROR_DIR, os.path.basename(ruta)))
        if os.path.exists(_ruta_meta(ruta)):
            shutil.copyfile(_ruta_meta(ruta),
                            os.path.join(BACKUP_MIRROR_DIR, os.path.basename(_ruta_meta(ruta))))
    except OSError as e:
        print(f"[backup] no se pudo copiar a {BACKUP_MIRROR_DIR}: {e}")


# ---------------------------------------------------------------- retencion

def _archivos() -> List[str]:
    return sorted(glob.glob(os.path.join(BACKUP_DIR, f"{PREFIJO}*{EXTENSION}")))


def _mas_reciente() -> Optional[str]:
    archivos = _archivos()
    return max(archivos, key=lambda r: os.stat(r).st_mtime) if archivos else None


def _dia_de(ruta: str) -> datetime.date:
    return datetime.date.fromtimestamp(os.stat(ruta).st_mtime)


def _borrar(ruta: str) -> None:
    for r in (ruta, _ruta_meta(ruta)):
        try:
            os.remove(r)
        except OSError:
            pass


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
        if ruta not in conservar:
            _borrar(ruta)


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


def _validar_postgres(ruta: str) -> dict:
    """Un volcado solo es restaurable si `pg_restore` lo lee y trae las tablas
    de este ERP. Lo que tenia dentro se lee de la ficha `.json` de al lado; si
    el archivo lo trajo el dueno de afuera y no tiene ficha, se dice que no se
    sabe -- nunca un cero que invite a confirmar."""
    r = _pg(["pg_restore", "--list", ruta], timeout=120)
    if r.returncode != 0:
        return {"valido": False,
                "motivo": "No es un volcado de PostgreSQL legible: {}".format(
                    r.stderr.strip()[:200] or "pg_restore no pudo leerlo")}
    tablas = set()
    for linea in r.stdout.splitlines():
        partes = linea.split()
        # "; 215; 1259 16400 TABLE savora pedidos vertigo"
        if "TABLE" in partes:
            i = partes.index("TABLE")
            if i + 2 < len(partes):
                tablas.add(partes[i + 2])
    faltantes = _faltantes(tablas)
    if faltantes:
        return {"valido": False,
                "motivo": "No parece una base de este sistema (faltan: {}).".format(
                    ", ".join(faltantes))}
    meta = _leer_meta(ruta)
    return {"valido": True, "motivo": "",
            "pedidos": meta.get("pedidos"), "ultima_venta": meta.get("ultima_venta")}


def _faltantes(tablas) -> list:
    """Que tablas obligatorias le faltan a un archivo, en cualquiera de las dos
    nomenclaturas. Vacia si es una base de este ERP."""
    tablas = set(tablas)
    if not [t for t in TABLAS_OBLIGATORIAS_VIEJAS if t not in tablas]:
        return []
    return [t for t in TABLAS_OBLIGATORIAS if t not in tablas]


def _tabla_pedidos(tablas) -> str:
    return "TRX110_VEN_PEDIDO" if "TRX110_VEN_PEDIDO" in set(tablas) else "pedidos"


def _validar_sqlite(ruta: str) -> dict:
    try:
        con = sqlite3.connect("file:{}?mode=ro".format(ruta.replace("?", "")), uri=True)
    except sqlite3.Error as e:
        return {"valido": False, "motivo": "No se pudo abrir: {}".format(e)}
    try:
        integridad = con.execute("PRAGMA integrity_check").fetchone()[0]
        if integridad != "ok":
            return {"valido": False, "motivo": "El archivo esta danado ({}).".format(integridad)}

        tablas = {f[0] for f in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        faltantes = _faltantes(tablas)
        if faltantes:
            return {
                "valido": False,
                "motivo": "No parece una base de este sistema (faltan: {}).".format(
                    ", ".join(faltantes)
                ),
            }

        t = _tabla_pedidos(tablas)
        pedidos = con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
        ultima = con.execute(f'SELECT MAX(creado_en) FROM "{t}"').fetchone()[0]
        return {"valido": True, "motivo": "", "pedidos": pedidos, "ultima_venta": ultima}
    except sqlite3.Error as e:
        return {"valido": False, "motivo": "No se pudo leer: {}".format(e)}
    finally:
        con.close()


def validar_respaldo(ruta: str) -> dict:
    """Un respaldo solo es restaurable si abre, esta integro y es de este ERP."""
    if not os.path.isfile(ruta):
        return {"valido": False, "motivo": "El archivo no existe."}
    return _validar_postgres(ruta) if ES_POSTGRES else _validar_sqlite(ruta)


def _a_fecha(valor):
    if valor is None or isinstance(valor, datetime.datetime):
        return valor
    try:
        return datetime.datetime.fromisoformat(str(valor))
    except ValueError:
        return None


def que_se_pierde(ruta: str) -> dict:
    """Cuanto trabajo se borra si se restaura este respaldo."""
    from .database import engine  # local: evita ciclo de importacion

    info = validar_respaldo(ruta)
    if not info["valido"]:
        return {"valido": False, "motivo": info["motivo"]}

    corte = info.get("ultima_venta")

    # El total del pedido no es una columna: se arma sumando sus items.
    consulta = (
        "SELECT COUNT(DISTINCT p.id), "
        "       COALESCE(SUM(i.precio_unitario * i.cantidad), 0) "
        'FROM "TRX110_VEN_PEDIDO" p LEFT JOIN "TRX111_VEN_PEDIDO_DET" i ON i.pedido_id = p.id '
        "WHERE p.estado != 'anulado'"
    )
    perdidos, monto = None, None
    if ES_POSTGRES:
        if info.get("pedidos") is not None:
            # Sin ficha no hay corte: no se puede medir, y se dice.
            try:
                with engine.connect() as con:
                    if corte:
                        fila = con.execute(text(consulta + " AND p.creado_en > :corte"),
                                           {"corte": _a_fecha(corte) or corte}).fetchone()
                    else:
                        fila = con.execute(text(consulta)).fetchone()
                perdidos, monto = int(fila[0] or 0), round(float(fila[1] or 0.0), 2)
            except Exception as e:  # noqa: BLE001
                print(f"[backup] no se pudo medir la perdida: {e}")
    else:
        # La base viva se abre por su RUTA y de solo lectura, no por el engine:
        # es lo que permite medir contra el archivo que toque (las pruebas lo
        # cambian) sin arrastrar el pool.
        try:
            viva = sqlite3.connect("file:{}?mode=ro".format(DB_PATH), uri=True)
        except sqlite3.Error as e:
            print(f"[backup] no se pudo medir la perdida: {e}")
            viva = None
        if viva is not None:
            try:
                if corte:
                    fila = viva.execute(consulta + " AND p.creado_en > ?", (corte,)).fetchone()
                else:
                    fila = viva.execute(consulta).fetchone()
                perdidos, monto = fila[0], round(fila[1] or 0.0, 2)
            except sqlite3.Error as e:
                # Si no se pudo medir, se dice que no se pudo medir. Un 0 aqui
                # haria que el dueno confirmara creyendo que no pierde nada.
                print(f"[backup] no se pudo medir la perdida: {e}")
            finally:
                viva.close()

    return {
        "valido": True,
        "motivo": "",
        "corte": corte,
        "pedidos_en_el_respaldo": info.get("pedidos"),
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

    archivos = _archivos()
    # Cuantas horas lleva la base sin una copia. Es el numero que de verdad
    # importa: si pasa del intervalo, algo esta fallando aunque el ultimo
    # respaldo exista y se vea reciente en la lista.
    horas_sin_respaldo = None
    if ultimo:
        horas_sin_respaldo = round((time.time() - os.stat(ultimo).st_mtime) / 3600, 1)

    return {
        "motor": "postgresql" if ES_POSTGRES else "sqlite",
        "ultimo_respaldo": (
            datetime.datetime.fromtimestamp(os.stat(ultimo).st_mtime).isoformat()
            if ultimo
            else None
        ),
        "horas_sin_respaldo": horas_sin_respaldo,
        "intervalo_horas": INTERVALO_HORAS,
        # El ultimo intento que fallo, si no se ha logrado uno bueno despues.
        "ultimo_fallo": est.get("ultimo_fallo"),
        "cantidad": len(archivos),
        "dia_mas_viejo": _dia_de(min(archivos, key=lambda r: os.stat(r).st_mtime)).isoformat()
        if archivos
        else None,
        "ultima_descarga": descarga,
        "dias_sin_descargar": dias_sin_descargar,
        "copia_externa": BACKUP_MIRROR_DIR or None,
        "restauracion_reciente": reciente,
    }


# ---------------------------------------------------------------- restaurar

def _restaurar_postgres(ruta: str) -> Optional[str]:
    """Reemplaza el esquema de este local por el del volcado. Devuelve el
    motivo del fallo, o None si salio bien.

    Secuencia: el esquema vivo se RENOMBRA (no se borra) a `<esquema>_previo`,
    `pg_restore` recrea el esquema desde el volcado en una sola transaccion, y
    solo si termino bien se suelta el previo. Si falla a mitad, el previo vuelve
    a su nombre y la base queda como estaba. Es lo que hace que restaurar un
    archivo malo no cueste la base buena.
    """
    from .database import engine

    previo = f"{DB_SCHEMA}_previo"
    engine.dispose()
    with engine.begin() as con:
        con.execute(text(f'DROP SCHEMA IF EXISTS "{previo}" CASCADE'))
        con.execute(text(f'ALTER SCHEMA "{DB_SCHEMA}" RENAME TO "{previo}"'))
    engine.dispose()

    r = _pg(["pg_restore", "--single-transaction", "--no-owner", "--no-privileges",
             "--exit-on-error", f"--dbname={make_url(DATABASE_URL).database}", ruta])
    if r.returncode != 0:
        with engine.begin() as con:
            con.execute(text(f'DROP SCHEMA IF EXISTS "{DB_SCHEMA}" CASCADE'))
            con.execute(text(f'ALTER SCHEMA "{previo}" RENAME TO "{DB_SCHEMA}"'))
        engine.dispose()
        return "pg_restore fallo y la base quedo como estaba: {}".format(
            r.stderr.strip()[:500])

    with engine.begin() as con:
        con.execute(text(f'DROP SCHEMA IF EXISTS "{previo}" CASCADE'))
    engine.dispose()
    return None


def _restaurar_sqlite(ruta: str) -> Optional[str]:
    """Volcar el respaldo DENTRO del archivo vivo con la API de sqlite3, en vez
    de reemplazar el archivo: reemplazarlo fallaba en Windows con "Acceso
    denegado" porque siempre queda algun handle abierto, y dejaba huerfanos los
    journals -wal/-shm de la base vieja."""
    from .database import engine

    engine.dispose()
    origen = sqlite3.connect(ruta)
    destino = sqlite3.connect(DB_PATH, timeout=30)
    try:
        origen.backup(destino)
    except sqlite3.Error as e:
        return "No se pudo reemplazar la base: {}".format(e)
    finally:
        destino.close()
        origen.close()
        engine.dispose()  # el pool no debe reusar conexiones de la base vieja
    return None


def restaurar(ruta: str, etiqueta: str) -> dict:
    """Reemplaza la base viva por este respaldo.

    Secuencia, en este orden y sin saltarse ninguno:
      1. Validar el archivo (integro y de este sistema).
      2. Medir que se pierde, para dejarlo anotado.
      3. Respaldar la base ACTUAL, por si la restauracion era el error.
      4. Restaurar segun el motor.
      5. Dejar constancia FUERA de la base: el cierre de caja de hoy va a dar
         un faltante que no es faltante, y alguien tiene que poder explicarlo.
    """
    with _candado:
        info = validar_respaldo(ruta)
        if not info["valido"]:
            return {"ok": False, "motivo": info["motivo"]}

        perdida = que_se_pierde(ruta)
        respaldo_previo = crear_respaldo(motivo="antes_de_restaurar")

        fallo = _restaurar_postgres(ruta) if ES_POSTGRES else _restaurar_sqlite(ruta)
        if fallo:
            return {"ok": False, "motivo": fallo}

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
