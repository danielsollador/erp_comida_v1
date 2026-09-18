"""Caso 20: la tablet se cae y hay que restaurar.

Estos tests trabajan sobre archivos .db de verdad en un directorio temporal,
no sobre la base en memoria del resto de la suite: lo que se esta probando es
justamente el manejo de archivos (copiar, retener, reemplazar), y en memoria
eso no existe.
"""

import datetime
import os
import sqlite3
import time

import pytest

from app import backup


def _crear_base(ruta, pedidos=0, precio=5.0, desde=None):
    """Un .db con la forma de este ERP y N pedidos cobrados."""
    if os.path.exists(ruta):
        os.remove(ruta)
    con = sqlite3.connect(ruta)
    con.execute("CREATE TABLE TRX110_VEN_PEDIDO (id INTEGER PRIMARY KEY, estado TEXT, creado_en TEXT)")
    con.execute(
        "CREATE TABLE TRX111_VEN_PEDIDO_DET (id INTEGER PRIMARY KEY, pedido_id INTEGER, "
        "precio_unitario REAL, cantidad INTEGER)"
    )
    con.execute("CREATE TABLE DIM310_INV_INGREDIENTE (id INTEGER PRIMARY KEY)")
    con.execute("CREATE TABLE TRX610_CON_ASIENTO (id INTEGER PRIMARY KEY)")
    con.execute("CREATE TABLE DIM610_CON_CUENTA (id INTEGER PRIMARY KEY)")
    base = desde or datetime.datetime(2026, 1, 1, 8, 0, 0)
    for i in range(pedidos):
        cuando = (base + datetime.timedelta(minutes=i)).isoformat()
        con.execute("INSERT INTO TRX110_VEN_PEDIDO VALUES (?, 'pagado', ?)", (i + 1, cuando))
        con.execute("INSERT INTO TRX111_VEN_PEDIDO_DET VALUES (?, ?, ?, 1)", (i + 1, i + 1, precio))
    con.commit()
    con.close()


@pytest.fixture()
def entorno(tmp_path, monkeypatch):
    """Aisla el modulo de respaldos en un directorio temporal."""
    dir_respaldos = tmp_path / "backups"
    dir_respaldos.mkdir()
    db = tmp_path / "comida.db"
    _crear_base(str(db), pedidos=3)

    monkeypatch.setattr(backup, "BACKUP_DIR", str(dir_respaldos))
    monkeypatch.setattr(backup, "DB_PATH", str(db))
    monkeypatch.setattr(backup, "RUTA_ESTADO", str(tmp_path / "estado.json"))
    monkeypatch.setattr(backup, "BACKUP_MIRROR_DIR", "")
    return {"dir": str(dir_respaldos), "db": str(db), "tmp": tmp_path}


def _pedidos_en(ruta):
    con = sqlite3.connect(ruta)
    try:
        return con.execute("SELECT COUNT(*) FROM TRX110_VEN_PEDIDO").fetchone()[0]
    finally:
        con.close()


# ------------------------------------------------- H70: se puede restaurar
def test_restaurar_devuelve_la_base_al_estado_del_respaldo(entorno):
    """Antes no existia restaurar en ningun lado: el unico camino de vuelta era
    que alguien copiara un archivo a mano sobre la base."""
    copia = backup.crear_respaldo()
    assert _pedidos_en(entorno["db"]) == 3

    _crear_base(entorno["db"], pedidos=9)  # se siguio vendiendo
    assert _pedidos_en(entorno["db"]) == 9

    resultado = backup.restaurar(copia, os.path.basename(copia))
    assert resultado["ok"] is True
    assert _pedidos_en(entorno["db"]) == 3


def test_restaurar_guarda_la_base_que_habia_antes(entorno):
    """Si restaurar fue el error, tiene que haber vuelta atras."""
    copia = backup.crear_respaldo()
    _crear_base(entorno["db"], pedidos=9)

    resultado = backup.restaurar(copia, "prueba")
    previo = os.path.join(entorno["dir"], resultado["respaldo_previo"])
    assert _pedidos_en(previo) == 9  # la base de 9 pedidos no se perdio


def test_no_restaura_un_archivo_que_no_es_de_este_sistema(entorno, tmp_path):
    """Subir el .db equivocado y perder la base buena encima seria peor que el
    problema que se venia a resolver."""
    intruso = tmp_path / "otra_cosa.db"
    con = sqlite3.connect(str(intruso))
    con.execute("CREATE TABLE clientes (id INTEGER)")
    con.commit()
    con.close()

    resultado = backup.restaurar(str(intruso), "otra_cosa.db")
    assert resultado["ok"] is False
    assert "este sistema" in resultado["motivo"]
    assert _pedidos_en(entorno["db"]) == 3  # la base viva quedo intacta


def test_no_restaura_un_archivo_corrupto(entorno, tmp_path):
    basura = tmp_path / "roto.db"
    basura.write_bytes(b"esto no es una base de datos")

    resultado = backup.restaurar(str(basura), "roto.db")
    assert resultado["ok"] is False
    assert _pedidos_en(entorno["db"]) == 3


def test_avisa_cuanto_se_pierde_antes_de_restaurar(entorno):
    """Nadie confirma una restauracion viendo un nombre de archivo."""
    copia = backup.crear_respaldo()  # tiene 3 pedidos, el ultimo 08:02
    _crear_base(
        entorno["db"], pedidos=7, precio=10.0, desde=datetime.datetime(2026, 1, 1, 8, 0, 0)
    )

    previo = backup.que_se_pierde(copia)
    assert previo["valido"] is True
    # de los 7 pedidos de la base viva, 4 son posteriores al corte del respaldo
    assert previo["pedidos_que_se_pierden"] == 4
    assert previo["monto_que_se_pierde"] == 40.0


def test_la_perdida_que_no_se_puede_medir_no_se_reporta_como_cero(entorno):
    """Un 0 aqui haria que el dueno confirme creyendo que no pierde nada.

    Paso de verdad escribiendo esto: la consulta sumaba `pedidos.total`, que no
    es una columna, y un `except` amplio convertia el error en 0.
    """
    copia = backup.crear_respaldo()

    con = sqlite3.connect(entorno["db"])  # la base viva queda sin esa tabla
    con.execute("DROP TABLE TRX111_VEN_PEDIDO_DET")
    con.commit()
    con.close()

    previo = backup.que_se_pierde(copia)
    assert previo["pedidos_que_se_pierden"] is None
    assert previo["monto_que_se_pierde"] is None


def test_la_restauracion_queda_registrada_fuera_de_la_base(entorno):
    """El registro no puede vivir en una tabla: la propia restauracion la
    borraria, y es justo despues cuando hace falta saber que paso."""
    copia = backup.crear_respaldo()
    _crear_base(entorno["db"], pedidos=9)
    backup.restaurar(copia, "respaldo_de_ayer.db")

    historial = backup.restauraciones()
    assert len(historial) == 1
    assert historial[0]["restaurado_desde"] == "respaldo_de_ayer.db"
    # y la base restaurada no tiene ni idea de que la restauraron
    assert "restauraciones" not in _tablas(entorno["db"])

    estado = backup.estado()
    assert estado["restauracion_reciente"] is not None


def _tablas(ruta):
    con = sqlite3.connect(ruta)
    try:
        return {f[0] for f in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        con.close()


# ------------------------------------------- H71: retencion por tiempo
def test_reiniciar_el_servidor_no_se_come_la_historia(entorno):
    """El bug medido: 60 respaldos que debian cubrir 15 dias cubrian 19
    minutos, porque cada arranque creaba uno y botaba el mas viejo."""
    viejo = backup.crear_respaldo()
    antiguo = time.time() - 10 * 86400
    os.utime(viejo, (antiguo, antiguo))

    for _ in range(30):  # 30 reinicios seguidos
        backup.respaldo_si_hace_falta()

    assert os.path.exists(viejo), "el respaldo de hace 10 dias sobrevivio"


def test_el_arranque_no_respalda_si_el_ultimo_es_reciente(entorno):
    backup.crear_respaldo()
    assert backup.respaldo_si_hace_falta() is None
    assert len(backup.listar_respaldos()) == 1


def test_el_arranque_si_respalda_si_el_ultimo_ya_tiene_horas(entorno):
    primero = backup.crear_respaldo()
    viejo = time.time() - (backup.INTERVALO_HORAS + 1) * 3600
    os.utime(primero, (viejo, viejo))

    assert backup.respaldo_si_hace_falta() is not None
    assert len(backup.listar_respaldos()) == 2


def test_se_conserva_el_ultimo_de_cada_dia(entorno, monkeypatch):
    monkeypatch.setattr(backup, "BACKUP_RETENER_RECIENTES", 2)
    monkeypatch.setattr(backup, "BACKUP_RETENER_DIAS", 30)

    # tres dias, dos respaldos cada uno
    for dias in (5, 4, 3):
        for hora in (9, 18):
            ruta = backup.crear_respaldo()
            cuando = datetime.datetime.now() - datetime.timedelta(days=dias)
            marca = cuando.replace(hour=hora).timestamp()
            os.utime(ruta, (marca, marca))

    backup._limpiar_antiguos()
    dias_cubiertos = {r["creado_en"][:10] for r in backup.listar_respaldos()}
    assert len(dias_cubiertos) == 3, "queda al menos un respaldo por dia"


def test_se_botan_los_respaldos_mas_viejos_que_la_ventana(entorno, monkeypatch):
    monkeypatch.setattr(backup, "BACKUP_RETENER_RECIENTES", 1)
    monkeypatch.setattr(backup, "BACKUP_RETENER_DIAS", 7)

    prehistorico = backup.crear_respaldo()
    hace_un_ano = time.time() - 365 * 86400
    os.utime(prehistorico, (hace_un_ano, hace_un_ano))
    backup.crear_respaldo()  # uno de hoy, para que el viejo no sea "el reciente"

    backup._limpiar_antiguos()
    assert not os.path.exists(prehistorico)


# ------------------------------------------- H72: copia fuera de la maquina
def test_se_deja_copia_en_la_carpeta_externa(entorno, tmp_path, monkeypatch):
    """Los respaldos viven al lado de la base: mismo disco, misma suerte."""
    usb = tmp_path / "usb"
    monkeypatch.setattr(backup, "BACKUP_MIRROR_DIR", str(usb))

    ruta = backup.crear_respaldo()
    assert (usb / os.path.basename(ruta)).exists()


def test_el_usb_desconectado_no_tumba_el_respaldo_local(entorno, monkeypatch):
    monkeypatch.setattr(backup, "BACKUP_MIRROR_DIR", "Z:\\\\usb-que-no-existe")
    ruta = backup.crear_respaldo()
    assert os.path.exists(ruta)


# ------------------------------------------- H73: nadie sabia si se descargaba
def test_se_lleva_la_cuenta_de_la_ultima_descarga(entorno):
    assert backup.estado()["dias_sin_descargar"] is None
    backup.registrar_descarga("comida_x.db")
    assert backup.estado()["dias_sin_descargar"] == 0


# ------------------------------------------- H74: nombres que se pisaban
def test_dos_respaldos_en_el_mismo_segundo_no_se_pisan(entorno):
    primero = backup.crear_respaldo()
    segundo = backup.crear_respaldo()
    assert primero != segundo
    assert os.path.exists(primero) and os.path.exists(segundo)
