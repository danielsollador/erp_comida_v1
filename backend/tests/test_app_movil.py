"""La portada y el punto de venta del telefono en una llamada (routers/app_movil.py).

Leider (23-oct): "ingreso y dura 10 segundos en mostrarme la primera
informacion". Con datos moviles cada llamada cuesta uno o dos segundos y la
portada hacia siete. Aqui se fija que una sola traiga lo mismo que las siete.
"""
from tests.test_cierre_resumen import vender


def test_inicio_trae_lo_mismo_que_las_siete_llamadas(client, variante):
    vender(client, variante, "Zelle")
    r = client.get("/api/app/inicio")
    assert r.status_code == 200, r.text
    d = r.json()
    assert [p["id"] for p in d["pedidos"]] == [p["id"] for p in client.get("/api/pedidos?del_dia=true").json()]
    assert d["cobrar"] == client.get("/api/pedidos?estado=listo").json()
    assert d["resumen"]["ventas"] == client.get("/api/reportes/resumen?periodo=dia").json()["ventas"]
    assert isinstance(d["avisos"], list)
    assert "pasos" in d["recorrido"]
    assert d["arranque"]["ventas"] >= 1


def test_pos_trae_menu_piso_y_caja(client, variante):
    r = client.get("/api/app/pos")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["categorias"] == client.get("/api/menu/categorias").json()
    assert d["apertura"]["fecha"] == client.get("/api/caja/estado-apertura").json()["fecha"]
    assert d["fiscal"]["tasa_iva"] == client.get("/api/impuestos/config").json()["tasa_iva"]
    assert "configurado" in d["pabilo"]
    assert d["puntos_venta"] == client.get("/api/puntos-venta").json()
