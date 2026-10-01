"""Factura de compra desde una foto: la IA propone, una persona guarda.

Lo que se cuida aca es el borde: la lectura no crea facturas ni mueve stock,
la foto queda como soporte de la factura que SI se guardo por el camino de
siempre, y los controles (duplicado y precio) avisan sin bloquear.
"""
import pytest

from app import models, settings

JPG = b"\xff\xd8\xff\xe0" + b"foto-de-prueba" * 50


@pytest.fixture()
def lector_de_prueba(monkeypatch):
    monkeypatch.setattr(settings, "LECTOR_FACTURAS", "prueba")


def subir(client, contenido=JPG, tipo="image/jpeg"):
    return client.post("/api/compras/lectura", files={"archivo": ("factura.jpg", contenido, tipo)})


def factura(client, insumo, numero="F-100", rif="J123456789", costo=10.0, **extra):
    cuerpo = {
        "numero_factura": numero,
        "proveedor_nombre": "Carnes SA",
        "proveedor_rif": rif,
        "categoria": "Insumos",
        "forma_pago": "Efectivo",
        "items": [{"ingrediente_id": insumo.id, "cantidad": 10, "costo_unitario": costo}],
    }
    cuerpo.update(extra)
    r = client.post("/api/compras/facturas", json=cuerpo)
    assert r.status_code == 200, r.text
    return r.json()


def revisar(client, insumo=None, costo=None, numero="", rif="", nombre=""):
    items = [] if insumo is None else [
        {"indice": 0, "ingrediente_id": insumo.id, "costo_unitario": costo}
    ]
    r = client.post("/api/compras/revision", json={
        "numero_factura": numero, "proveedor_rif": rif, "proveedor_nombre": nombre, "items": items,
    })
    assert r.status_code == 200, r.text
    return r.json()


# ------------------------------------------------------------------ lectura

def test_apagado_por_defecto_ni_se_ofrece_ni_se_sube_nada(client, db, monkeypatch):
    """Una imagen nueva en produccion no empieza a mandar facturas a ningun
    lado sin que alguien lo decida."""
    monkeypatch.setattr(settings, "LECTOR_FACTURAS", "")
    assert client.get("/api/compras/lectura").json() == {"activo": False, "lector": ""}
    assert subir(client).status_code == 503
    assert db.query(models.SoporteFactura).count() == 0


def test_leer_propone_un_borrador_y_no_toca_nada_mas(client, db, insumo, lector_de_prueba):
    stock_antes = insumo.stock_actual
    r = subir(client)
    assert r.status_code == 200, r.text
    lectura = r.json()
    assert lectura["lector"] == "prueba"
    assert lectura["borrador"]["numero_factura"] == "0004512"
    assert len(lectura["borrador"]["renglones"]) == 3

    # La foto se guarda suelta, todavia sin factura.
    soporte = db.get(models.SoporteFactura, lectura["soporte_id"])
    assert soporte.factura_id is None
    assert soporte.contenido == JPG
    assert '"numero_factura":"0004512"' in soporte.lectura

    # Y nada mas: ni facturas, ni stock, ni asientos.
    assert db.query(models.FacturaCompra).count() == 0
    db.refresh(insumo)
    assert insumo.stock_actual == stock_antes
    assert db.query(models.AsientoContable).filter_by(origen="factura_compra").count() == 0


def test_fotos_o_pdf_y_nada_mas(client, lector_de_prueba):
    assert subir(client, b"PK\x03\x04", "application/zip").status_code == 415
    assert subir(client, b"GIF89a", "image/gif").status_code == 415
    assert subir(client, b"", "image/jpeg").status_code == 400


PDF = b"%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n" + b"x" * 2000 + b"\n%%EOF"


def test_un_pdf_se_lee_y_se_guarda_tal_cual(client, db, insumo, lector_de_prueba):
    """El proveedor manda la factura por correo o WhatsApp en PDF: no hay que
    imprimirla para sacarle una foto."""
    r = subir(client, PDF, "application/pdf")
    assert r.status_code == 200, r.text
    assert r.json()["borrador"]["numero_factura"] == "0004512"
    soporte = r.json()["soporte_id"]
    fid = factura(client, insumo)["id"]
    client.post(f"/api/compras/facturas/{fid}/soporte", json={"soporte_id": soporte})
    vuelta = client.get(f"/api/compras/facturas/{fid}/soporte")
    assert vuelta.headers["content-type"] == "application/pdf"
    assert vuelta.headers["x-content-type-options"] == "nosniff"
    assert vuelta.content == PDF


def test_un_archivo_que_solo_dice_ser_pdf_se_rechaza(client, db, lector_de_prueba):
    """Renombrado o corrupto: se guardaria como soporte y despues no abriria."""
    r = subir(client, b"\xff\xd8\xff\xe0 esto es un jpg", "application/pdf")
    assert r.status_code == 415
    assert db.query(models.SoporteFactura).count() == 0


def test_una_foto_demasiado_pesada_se_rechaza(client, lector_de_prueba):
    from app.routers import compras_lectura
    grande = b"\xff" * (compras_lectura.TAMANO_MAXIMO + 1)
    assert subir(client, grande).status_code == 413


def test_si_el_lector_falla_la_foto_queda_para_cargar_a_mano(client, db, lector_de_prueba, monkeypatch):
    from app import lectura_facturas

    def falla(imagen, tipo):
        raise lectura_facturas.ErrorDeLectura("No se distingue el texto")

    monkeypatch.setitem(lectura_facturas._LECTORES, "prueba", falla)
    r = subir(client)
    assert r.status_code == 200
    assert r.json()["borrador"] is None
    assert r.json()["error"] == "No se distingue el texto"
    assert db.get(models.SoporteFactura, r.json()["soporte_id"]).contenido == JPG


# ------------------------------------------------------------------ soporte

def test_la_foto_se_engancha_a_la_factura_guardada(client, insumo, lector_de_prueba):
    soporte_id = subir(client).json()["soporte_id"]
    guardada = factura(client, insumo)
    assert guardada["tiene_soporte"] is False, "el POST de siempre no sabe de fotos"

    r = client.post(f"/api/compras/facturas/{guardada['id']}/soporte", json={"soporte_id": soporte_id})
    assert r.status_code == 200, r.text
    # Reintentar el mismo enganche no rompe (se corto la red a mitad).
    assert client.post(
        f"/api/compras/facturas/{guardada['id']}/soporte", json={"soporte_id": soporte_id}
    ).status_code == 200

    listado = client.get("/api/compras/facturas").json()
    assert [f["tiene_soporte"] for f in listado] == [True]

    foto = client.get(f"/api/compras/facturas/{guardada['id']}/soporte")
    assert foto.status_code == 200
    assert foto.headers["content-type"] == "image/jpeg"
    assert foto.content == JPG


def test_una_foto_respalda_una_sola_factura(client, insumo, lector_de_prueba):
    soporte_id = subir(client).json()["soporte_id"]
    a = factura(client, insumo, numero="A-1")
    b = factura(client, insumo, numero="B-2")
    client.post(f"/api/compras/facturas/{a['id']}/soporte", json={"soporte_id": soporte_id})
    r = client.post(f"/api/compras/facturas/{b['id']}/soporte", json={"soporte_id": soporte_id})
    assert r.status_code == 409

    otra = subir(client).json()["soporte_id"]
    r = client.post(f"/api/compras/facturas/{a['id']}/soporte", json={"soporte_id": otra})
    assert r.status_code == 409, "la factura ya tiene su foto"


def test_sin_foto_es_404(client, insumo):
    guardada = factura(client, insumo)
    assert client.get(f"/api/compras/facturas/{guardada['id']}/soporte").status_code == 404
    r = client.post(f"/api/compras/facturas/{guardada['id']}/soporte", json={"soporte_id": 999})
    assert r.status_code == 404


def test_borrar_una_factura_se_lleva_su_foto(client, db, lector_de_prueba):
    """Solo se borran las que no tienen renglones. Con las claves foraneas
    activas, una foto colgando hacia la factura daba un 500 al borrar."""
    soporte_id = subir(client).json()["soporte_id"]
    r = client.post("/api/compras/facturas", json={
        "numero_factura": "S-1", "proveedor_nombre": "Luz", "proveedor_rif": "J123456789",
        "categoria": "Servicios", "forma_pago": "Efectivo", "base_imponible": 50, "iva": 8,
    })
    assert r.status_code == 200, r.text
    fid = r.json()["id"]
    client.post(f"/api/compras/facturas/{fid}/soporte", json={"soporte_id": soporte_id})

    assert client.delete(f"/api/compras/facturas/{fid}").status_code == 200
    assert db.query(models.SoporteFactura).count() == 0


# ------------------------------------------------------------------ duplicado

def test_la_misma_factura_con_o_sin_ceros_es_duplicada(client, insumo):
    guardada = factura(client, insumo, numero="0004512", rif="J-12345678-9")
    for numero in ("4512", "0004512", "N° 4512", "00-4512"):
        dup = revisar(client, numero=numero, rif="J123456789")["duplicadas"]
        assert [d["id"] for d in dup] == [guardada["id"]], numero


def test_mismo_numero_de_otro_proveedor_no_es_duplicada(client, insumo):
    factura(client, insumo, numero="4512", rif="J123456789")
    assert revisar(client, numero="4512", rif="J987654321")["duplicadas"] == []
    assert revisar(client, numero="4513", rif="J123456789")["duplicadas"] == []


def test_sin_rif_todavia_se_busca_por_nombre(client, insumo):
    guardada = factura(client, insumo, numero="77")
    dup = revisar(client, numero="077", nombre="carnes sa")["duplicadas"]
    assert [d["id"] for d in dup] == [guardada["id"]]
    assert revisar(client, numero="77")["duplicadas"] == [], "sin proveedor no se adivina"


# ------------------------------------------------------------------ precio

def _precio(client, insumo, costo):
    precios = revisar(client, insumo, costo)["precios"]
    assert len(precios) == 1
    return precios[0]


def test_precio_contra_lo_que_se_venia_pagando(client, insumo):
    for i, costo in enumerate((10.0, 10.0, 11.0)):
        factura(client, insumo, numero=f"H-{i}", costo=costo)

    normal = _precio(client, insumo, 11.5)
    assert normal["nivel"] == "normal"
    assert normal["referencia"] == 10.0, "mediana de 10, 10 y 11"
    assert normal["base"] == "compras" and normal["muestras"] == 3

    alto = _precio(client, insumo, 13.0)
    assert alto["nivel"] == "alto" and alto["variacion_pct"] == 30.0
    assert "Subió 30%" in alto["mensaje"]

    assert _precio(client, insumo, 7.0)["nivel"] == "bajo"


def test_un_precio_de_otra_unidad_se_dice_como_tal(client, insumo):
    """Un saco de 50 kg cargado como "1" deja el precio 50 veces arriba; el
    precio del kg con la cantidad en sacos, 50 veces abajo. No es inflacion."""
    factura(client, insumo, costo=10.0)
    arriba = _precio(client, insumo, 500.0)
    assert arriba["nivel"] == "unidad" and "saco" in arriba["mensaje"]
    abajo = _precio(client, insumo, 0.2)
    assert abajo["nivel"] == "unidad" and "kg" in abajo["mensaje"]


def test_sin_compras_se_compara_con_el_costo_promedio(client, insumo):
    """El insumo del conftest tiene costo 8 y ninguna compra."""
    aviso = _precio(client, insumo, 12.0)
    assert aviso["base"] == "promedio" and aviso["muestras"] == 0
    assert aviso["nivel"] == "alto"
    assert "costo promedio" in aviso["mensaje"]


def test_sin_nada_contra_que_comparar_no_se_inventa_un_aviso(client, db):
    nuevo = models.Ingrediente(nombre="Cilantro", unidad="kg", costo_unitario=0)
    db.add(nuevo)
    db.commit()
    assert revisar(client, nuevo, 3.0)["precios"] == []



# ------------------------------------------------------------------ dos fechas

def test_la_fecha_del_papel_se_guarda_pero_el_periodo_es_el_del_registro(client, insumo, db):
    """Una factura de agosto que llega hoy se registra hoy: entra al Libro de
    Compras de este mes, y agosto -ya declarado- no se toca."""
    import datetime
    db.add(models.DeclaracionIva(anio=2026, mes=8, iva_debito=0, iva_credito=0))
    db.commit()
    guardada = factura(client, insumo, fecha_emision="2026-08-20")
    assert guardada["fecha_emision"] == "2026-08-20"
    assert guardada["fecha"][:10] == datetime.date.today().isoformat()

    agosto = client.get("/api/impuestos/libro-compras?desde=2026-08-01&hasta=2026-08-31").json()
    assert agosto["filas"] == []
    este_mes = client.get("/api/impuestos/libro-compras").json()["filas"]
    assert [f["fecha_emision"] for f in este_mes] == ["2026-08-20"]


def test_sin_fecha_del_papel_el_libro_muestra_la_de_registro(client, insumo):
    """Las facturas de antes no tienen fecha de emision: el libro sigue
    mostrando la que mostraba."""
    guardada = factura(client, insumo)
    assert guardada["fecha_emision"] is None
    fila = client.get("/api/impuestos/libro-compras").json()["filas"][0]
    assert fila["fecha_emision"] == guardada["fecha"][:10]


def test_la_fecha_del_papel_no_puede_ser_futura(client, insumo):
    import datetime
    manana = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
    r = client.post("/api/compras/facturas", json={
        "numero_factura": "F-9", "proveedor_nombre": "Carnes SA", "proveedor_rif": "J123456789",
        "categoria": "Insumos", "forma_pago": "Efectivo", "fecha_emision": manana,
        "items": [{"ingrediente_id": insumo.id, "cantidad": 1, "costo_unitario": 1.0}],
    })
    assert r.status_code == 400
    assert "futura" in r.json()["detail"]


def test_el_csv_lleva_las_dos_fechas(client, insumo):
    factura(client, insumo, fecha_emision="2026-08-20")
    texto = client.get("/api/impuestos/libro-compras/exportar").content.decode("utf-8-sig")
    encabezado, fila = texto.strip().splitlines()[:2]
    assert encabezado.startswith("Factura,Fecha factura,Fecha registro,N. Factura")
    assert ",20/08/2026," in fila


# ------------------------------------------------------------------ fotos sueltas

def test_las_fotos_sueltas_viejas_se_limpian_al_leer_otra(client, db, insumo, lector_de_prueba):
    """Una foto leida cuya factura nunca se guardo no respalda nada. Se borra
    pasado el plazo, no antes: puede ser de una factura ya guardada cuyo
    'completar' espera en una tablet sin conexion."""
    import datetime
    from app.routers.compras_lectura import DIAS_FOTO_SUELTA

    vieja = subir(client).json()["soporte_id"]
    reciente = subir(client).json()["soporte_id"]
    vieja_con_factura = subir(client).json()["soporte_id"]
    fid = factura(client, insumo)["id"]
    client.post(f"/api/compras/facturas/{fid}/soporte", json={"soporte_id": vieja_con_factura})

    hace = datetime.datetime.now() - datetime.timedelta(days=DIAS_FOTO_SUELTA + 1)
    casi = datetime.datetime.now() - datetime.timedelta(days=DIAS_FOTO_SUELTA - 1)
    db.get(models.SoporteFactura, vieja).fecha = hace
    db.get(models.SoporteFactura, vieja_con_factura).fecha = hace
    db.get(models.SoporteFactura, reciente).fecha = casi
    db.commit()

    nueva = subir(client).json()["soporte_id"]
    db.expire_all()
    quedan = {s.id for s in db.query(models.SoporteFactura).all()}
    assert vieja not in quedan, "suelta y vieja: se va"
    assert {reciente, vieja_con_factura, nueva} <= quedan, "reciente, con factura o nueva: se quedan"


# ------------------------------------------------------------------ RIF

def test_la_revision_avisa_un_rif_imposible_y_sugiere_el_conocido(client, db):
    db.add(models.Proveedor(nombre="Suministros Clean 21", rif="J412473140"))
    db.commit()
    rev = revisar(client, numero="1", rif="J-41247314-8")
    assert "dígito verificador" in rev["rif_aviso"]
    assert rev["rif_sugerido"] == {"rif": "J412473140", "nombre": "Suministros Clean 21"}

    bien = revisar(client, numero="1", rif="J-41247314-0")
    assert bien["rif_aviso"] == "" and bien["rif_sugerido"] is None


def test_sin_conocido_parecido_avisa_sin_sugerir(client):
    rev = revisar(client, numero="1", rif="J-40908990-7")
    assert rev["rif_aviso"] and rev["rif_sugerido"] is None


def test_un_rif_que_no_pasa_el_calculo_pero_ya_se_uso_no_se_avisa(client, db):
    """Improal imprime J-33295782-8 en todas sus facturas y no pasa el
    calculo. Avisar cada vez a quien ya lo comparo con el papel es ruido."""
    rev = revisar(client, numero="1", rif="J-33295782-8")
    assert "Compáralo con el papel" in rev["rif_aviso"]
    db.add(models.Proveedor(nombre="Improal, C.A.", rif="J332957828"))
    db.commit()
    assert revisar(client, numero="2", rif="J-33295782-8")["rif_aviso"] == ""
