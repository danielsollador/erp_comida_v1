"""¿Por qué no cuadra? (20-oct). El caso del 19-oct, a escala: faltan en Zelle
y sobra casi lo mismo en el punto (un cobro en la forma equivocada), el pago
movil por centimos y faltan dolares en efectivo. Sin IA: las pistas salen de
reglas fijas, y son las que se prueban aqui."""
import pytest

from app import settings
from tests.test_cierre_resumen import vender


@pytest.fixture(autouse=True)
def _sin_ia(monkeypatch):
    monkeypatch.setattr(settings, "LECTOR_FACTURAS", "")


def cerrar(client, conteos):
    r = client.post("/api/caja/cerrar", json={"conteos": conteos})
    assert r.status_code == 200, r.text


def explicar(client):
    r = client.get("/api/caja/explicar")
    assert r.status_code == 200, r.text
    return r.json()


def por_tipo(d, tipo):
    return [p for p in d["pistas"] if p["tipo"] == tipo]


def test_el_caso_del_19_de_octubre(client, variante):
    zelle = vender(client, variante, "Zelle")  # $5
    vender(client, variante, "Punto de venta")
    vender(client, variante, "Pago movil")
    vender(client, variante, "Efectivo $")
    cerrar(client, [
        {"metodo": "Zelle", "contado": 0},             # faltan 5
        {"metodo": "Punto de venta", "contado": 9.78},  # sobran 4,78 (la tasa)
        {"metodo": "Pago movil", "contado": 5.03},      # centimos
        {"metodo": "Efectivo $", "contado": 3},         # faltan 2
    ])
    d = explicar(client)

    cruce = por_tipo(d, "cruce")
    assert len(cruce) == 1, d["pistas"]
    assert "Zelle" in cruce[0]["texto"] and "Punto de venta" in cruce[0]["texto"]
    assert cruce[0]["pedidos"] == [zelle["numero"]], "el cobro de Zelle de $5 es el candidato"
    assert "Editar pago" in cruce[0]["texto"]

    assert any("Pago movil" in p["texto"] for p in por_tipo(d, "centimos"))
    efectivo = [p for p in por_tipo(d, "faltante") if "Efectivo $" in p["texto"]]
    assert efectivo and "vuelto" in efectivo[0]["texto"]
    assert d["con_ia"] is False
    assert zelle["numero"] in d["pedidos"]


def test_si_cuadra_no_hay_nada_que_explicar(client, variante):
    vender(client, variante, "Zelle")
    cerrar(client, [{"metodo": "Zelle", "contado": 5}])
    d = explicar(client)
    assert d["pistas"] == []
    assert "cuadra" in d["texto"]


def test_un_faltante_del_banco_sin_pareja_apunta_al_cobro(client, variante):
    p = vender(client, variante, "Transferencia")
    vender(client, variante, "Transferencia")
    cerrar(client, [{"metodo": "Transferencia", "contado": 5}])
    falta = por_tipo(explicar(client), "faltante")
    assert falta and "banco" in falta[0]["texto"]
    assert p["numero"] in falta[0]["pedidos"]


def test_lo_que_no_se_conto_se_dice(client, variante):
    vender(client, variante, "Efectivo Bs")
    vender(client, variante, "Zelle")
    cerrar(client, [{"metodo": "Zelle", "contado": 4}])
    d = explicar(client)
    assert any("Efectivo Bs" in p["texto"] for p in por_tipo(d, "sin_contar"))


def test_solo_explica_no_cambia_nada(client, variante):
    vender(client, variante, "Zelle")
    cerrar(client, [{"metodo": "Zelle", "contado": 0}])
    antes = client.get("/api/caja/resumen").json()
    explicar(client)
    assert client.get("/api/caja/resumen").json() == antes
