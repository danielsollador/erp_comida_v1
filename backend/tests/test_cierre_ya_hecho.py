"""Un cierre ya hecho tiene que seguir diciendo lo que se encontro (19-oct).

En Zelle faltaban $10 y la pantalla decia "cuadra": al cerrar, el faltante
se lleva a los libros con un asiento, y al volver a abrir el dia ese asiento
se contaba como plata que "Salio", asi que "debes tener" bajaba hasta lo
reportado. Con los sobrantes del banco pasaba al reves: aparecian como
"otros movimientos" del dia.
"""
from tests.test_cierre_resumen import linea, resumen, vender


def cerrar(client, conteos):
    r = client.post("/api/caja/cerrar", json={"conteos": conteos})
    assert r.status_code == 200, r.text


def test_el_faltante_de_zelle_se_sigue_viendo_despues_de_cerrar(client, variante):
    vender(client, variante, "Zelle")  # $5
    cerrar(client, [{"metodo": "Zelle", "contado": 0}])

    z = linea(resumen(client), "Zelle")
    assert z["esperado"] == 5.0, "el faltante no es una salida del dia"
    assert z["salidas"] == 0
    assert z["otros"] == 0
    assert z["contado"] == 0
    assert z["diferencia"] == -5.0


def test_el_faltante_de_efectivo_en_dolares_tambien(client, variante):
    vender(client, variante, "Efectivo $")
    cerrar(client, [{"metodo": "Efectivo $", "contado": 3}])

    d = linea(resumen(client), "Efectivo $")
    assert d["otros"] == 0
    assert d["diferencia"] == -2.0


def test_el_sobrante_del_punto_no_es_otro_movimiento_del_banco(client, variante):
    vender(client, variante, "Punto de venta")
    cerrar(client, [{"metodo": "Punto de venta", "contado": 6}])

    d = resumen(client)
    p = linea(d, "Punto de venta")
    assert p["esperado"] == 5.0
    assert p["diferencia"] == 1.0
    assert d.get("otros_movimientos", []) == []
