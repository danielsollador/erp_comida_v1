"""Lo de despues de guardar una factura: un pedido que se puede repetir.

Guardar es el POST de siempre. Enganchar la foto, que la memoria del
proveedor aprenda y generar las alertas lo manda el navegador despues, y el
wifi se puede caer justo ahi. Lo que se cuida: que el reintento no duplique
nada (la memoria contaba dos veces la misma factura) y que un fallo a mitad
de camino no deje la foto enganchada sin la memoria, o al reves.
"""
import pytest

from app import equivalencias, models, settings

RIF = "J-40123456-7"
JPG = b"\xff\xd8\xff\xe0" + b"foto" * 100


@pytest.fixture(autouse=True)
def lector_de_prueba(monkeypatch):
    monkeypatch.setattr(settings, "LECTOR_FACTURAS", "prueba")


def subir(client):
    return client.post("/api/compras/lectura", files={"archivo": ("f.jpg", JPG, "image/jpeg")}).json()["soporte_id"]


def guardar(client, insumo, costo, numero):
    r = client.post("/api/compras/facturas", json={
        "numero_factura": numero, "proveedor_nombre": "La Montaña", "proveedor_rif": RIF,
        "categoria": "Insumos", "forma_pago": "Efectivo",
        "items": [{"ingrediente_id": insumo.id, "cantidad": 40, "costo_unitario": costo}],
    })
    assert r.status_code == 200, r.text
    return r.json()["id"]


def renglon(insumo, costo):
    return {"descripcion": "CARNE MOLIDA BULTO", "unidad": "BULTO", "cantidad_papel": 2,
            "precio_papel": costo * 20, "ingrediente_id": insumo.id, "cantidad": 40, "costo_unitario": costo}


def completar(client, factura_id, soporte_id=None, renglones=()):
    return client.post(f"/api/compras/facturas/{factura_id}/completar", json={
        "soporte_id": soporte_id, "proveedor_rif": RIF, "proveedor_nombre": "La Montaña",
        "renglones": list(renglones),
    })


def test_engancha_aprende_y_avisa_en_un_solo_pedido(client, insumo, db):
    guardar(client, insumo, 10.0, "F-1")
    soporte = subir(client)
    fid = guardar(client, insumo, 13.0, "F-2")
    r = completar(client, fid, soporte, [renglon(insumo, 13.0)])
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["foto"] is True and d["aprendidas"] == 1
    assert [a["variacion_pct"] for a in d["alertas"]] == [30.0]
    assert db.get(models.SoporteFactura, soporte).factura_id == fid
    [e] = client.get("/api/compras/equivalencias").json()
    assert e["factor"] == 20 and e["veces"] == 1


def test_el_reintento_no_duplica_nada(client, insumo, db):
    """Se cayo el wifi despues de que el servidor lo hizo: el navegador no se
    entero y lo manda otra vez. Antes, la memoria contaba esa factura dos veces."""
    guardar(client, insumo, 10.0, "F-1")
    soporte = subir(client)
    fid = guardar(client, insumo, 13.0, "F-2")
    primero = completar(client, fid, soporte, [renglon(insumo, 13.0)]).json()
    segundo = completar(client, fid, soporte, [renglon(insumo, 13.0)]).json()
    assert segundo["foto"] is True and segundo["aprendidas"] == 0
    assert segundo["alertas"] == primero["alertas"]
    assert client.get("/api/compras/equivalencias").json()[0]["veces"] == 1
    assert db.query(models.AlertaPrecio).count() == 1


def test_un_fallo_a_mitad_no_deja_nada_a_medias(client, insumo, db, monkeypatch):
    """Si la memoria falla, la foto tampoco queda enganchada: el reintento
    empieza de cero y hace las dos cosas."""
    soporte = subir(client)
    fid = guardar(client, insumo, 10.0, "F-1")
    original = equivalencias.aprender_sin_confirmar

    def falla(*a, **k):
        raise RuntimeError("se cayo la base")

    monkeypatch.setattr(equivalencias, "aprender_sin_confirmar", falla)
    with pytest.raises(RuntimeError):
        completar(client, fid, soporte, [renglon(insumo, 10.0)])
    db.rollback()  # lo que hace la sesion del pedido al fallar
    s = db.get(models.SoporteFactura, soporte)
    assert s.factura_id is None and not s.completada

    monkeypatch.setattr(equivalencias, "aprender_sin_confirmar", original)
    d = completar(client, fid, soporte, [renglon(insumo, 10.0)]).json()
    assert d["foto"] is True and d["aprendidas"] == 1


def test_sin_foto_solo_genera_las_alertas(client, insumo):
    guardar(client, insumo, 10.0, "F-1")
    fid = guardar(client, insumo, 13.0, "F-2")
    d = completar(client, fid).json()
    assert d["foto"] is False and d["aprendidas"] == 0 and len(d["alertas"]) == 1
    r = completar(client, fid, renglones=[renglon(insumo, 13.0)])
    assert r.status_code == 400, "sin foto no hay papel del que aprender"


def test_una_foto_de_otra_factura_no_se_roba(client, insumo):
    soporte = subir(client)
    a = guardar(client, insumo, 10.0, "A-1")
    b = guardar(client, insumo, 10.0, "B-1")
    assert completar(client, a, soporte).status_code == 200
    assert completar(client, b, soporte).status_code == 409
    otra = subir(client)
    assert completar(client, a, otra).status_code == 409, "la factura ya tiene su foto"


def test_factura_que_no_existe(client):
    assert completar(client, 9999).status_code == 404


def test_si_la_foto_ya_se_limpio_igual_salen_las_alertas(client, insumo):
    """El reintento llego despues del plazo y la foto se borro por suelta. Un
    404 hacia que el navegador descartara todo, alertas incluidas."""
    guardar(client, insumo, 10.0, "F-1")
    fid = guardar(client, insumo, 13.0, "F-2")
    r = completar(client, fid, 9999, [renglon(insumo, 13.0)])
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["foto"] is False and d["foto_perdida"] is True
    assert d["aprendidas"] == 0, "sin la foto no hay de que aprender"
    assert len(d["alertas"]) == 1
