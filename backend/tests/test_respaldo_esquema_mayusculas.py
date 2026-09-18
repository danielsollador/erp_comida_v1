"""El respaldo con los esquemas en mayusculas, y que un fallo se vea.

Los dos salieron del mismo incidente en produccion: al renombrar el esquema a
`SAVORA`, `pg_dump --schema=SAVORA` dejo de encontrarlo y el respaldo
automatico llevaba horas fallando sin que nada lo dijera fuera del log.
"""
import datetime

import pytest

from app import backup


def test_el_esquema_va_entre_comillas_para_pg_dump():
    """`--schema` no toma un nombre, toma un patron estilo `psql \\d`: lo que
    no va entre comillas se pliega a minusculas. Sin las comillas, `SAVORA`
    busca `savora` y pg_dump responde "no matching schemas were found"."""
    assert backup._patron_de_esquema("SAVORA") == '"SAVORA"'
    # El de siempre tambien sobrevive: entrecomillar un nombre en minusculas
    # es inofensivo.
    assert backup._patron_de_esquema("savora") == '"savora"'


def test_el_comando_de_pg_dump_lleva_el_esquema_entrecomillado(monkeypatch, tmp_path):
    visto = {}

    def falso_pg(comando, timeout=600):
        visto["comando"] = comando
        class R:
            returncode = 0
            stderr = ""
        return R()

    monkeypatch.setattr(backup, "_pg", falso_pg)
    monkeypatch.setattr(backup, "DB_SCHEMA", "SAVORA")
    backup._pg_dump(str(tmp_path / "x.dump"))

    esquema = [a for a in visto["comando"] if a.startswith("--schema=")]
    assert esquema == ['--schema="SAVORA"'], visto["comando"]


def test_un_respaldo_que_falla_queda_anotado(monkeypatch, tmp_path):
    """Lo que faltaba: el fallo solo salia por consola."""
    monkeypatch.setattr(backup, "BACKUP_DIR", str(tmp_path))
    monkeypatch.setattr(backup, "RUTA_ESTADO", str(tmp_path / "estado.json"))
    monkeypatch.setattr(backup, "ES_POSTGRES", True)

    def revienta(_destino):
        raise RuntimeError("pg_dump fallo: no matching schemas were found")

    monkeypatch.setattr(backup, "_pg_dump", revienta)

    with pytest.raises(RuntimeError):
        backup.crear_respaldo("automatico")

    fallo = backup.estado()["ultimo_fallo"]
    assert fallo is not None, "un respaldo roto tiene que verse en la pantalla"
    assert "no matching schemas" in fallo["error"]
    assert fallo["motivo"] == "automatico"
    datetime.datetime.fromisoformat(fallo["fecha"])

    # Y un respaldo bueno despues lo borra: el aviso no se puede quedar pegado.
    monkeypatch.setattr(backup, "_pg_dump", lambda destino: open(destino, "wb").close())
    monkeypatch.setattr(backup, "_escribir_meta", lambda _ruta: None)
    backup.crear_respaldo("manual")
    assert backup.estado()["ultimo_fallo"] is None


def test_el_estado_dice_cuantas_horas_lleva_sin_respaldo(monkeypatch, tmp_path):
    """Con solo la fecha del ultimo, hay que hacer la resta a ojo; y la
    pantalla decia "hace N horas" con N creciendo sin que nada avisara."""
    monkeypatch.setattr(backup, "BACKUP_DIR", str(tmp_path))
    monkeypatch.setattr(backup, "RUTA_ESTADO", str(tmp_path / "estado.json"))
    monkeypatch.setattr(backup, "ES_POSTGRES", True)
    monkeypatch.setattr(backup, "_pg_dump", lambda destino: open(destino, "wb").close())
    monkeypatch.setattr(backup, "_escribir_meta", lambda _ruta: None)

    assert backup.estado()["horas_sin_respaldo"] is None  # todavia no hay ninguno
    backup.crear_respaldo("manual")
    est = backup.estado()
    assert est["horas_sin_respaldo"] < 0.1
    assert est["intervalo_horas"] == backup.INTERVALO_HORAS


def test_al_fallar_el_respaldo_manual_dice_por_que(client, monkeypatch):
    """Antes cualquier tropiezo salia como "Internal Server Error" y el dueno
    no sabia si fue el disco, la base o un programa que falta."""
    def falta_el_programa(motivo="manual"):
        raise FileNotFoundError(2, "El sistema no puede encontrar el archivo")

    monkeypatch.setattr(backup, "crear_respaldo", falta_el_programa)
    r = client.post("/api/respaldos/crear")
    assert r.status_code == 500
    assert "pg_dump" in r.json()["detail"], r.text

    def disco_lleno(motivo="manual"):
        raise OSError("No space left on device")

    monkeypatch.setattr(backup, "crear_respaldo", disco_lleno)
    r = client.post("/api/respaldos/crear")
    assert r.status_code == 500
    assert "No space left" in r.json()["detail"], r.text
