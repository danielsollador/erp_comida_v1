"""El lector de Gemini, sin llamar a Google.

Se simula la respuesta de la API para fijar lo que importa: que pide lo que
debe (archivo, esquema, temperatura 0, la clave en la cabecera y no en la
URL), que convierte la respuesta en un borrador, y que cada falla de Google
llega a la pantalla como un mensaje que dice que hacer -- con la foto
guardada igual para cargar la factura a mano.
"""
import base64
import json

import httpx
import pytest

from app import lectura_facturas, models, settings

BORRADOR = {
    "proveedor_nombre": "Distribuidora La Montaña, C.A.",
    "proveedor_rif": "J-40123456-7",
    "numero_factura": "0004512",
    "fecha": "2026-09-28",
    "moneda": "Bs",
    "renglones": [
        {"descripcion": "HARINA PAN 1KG (E)", "cantidad": 20, "unidad": "UND",
         "precio_unitario": 45.5, "subtotal": 910.0, "exento": True},
        {"descripcion": "QUESO BLANCO DURO", "cantidad": 5, "unidad": "KG",
         "precio_unitario": None, "subtotal": None, "exento": None},
    ],
    "recargo": 0,
    "descuento": 0,
    "subtotal": 1234.56,
    "iva": None,
    "total": None,
    "advertencias": ["No se lee el precio del queso."],
}
JPG = b"\xff\xd8\xff\xe0" + b"foto" * 100


@pytest.fixture()
def gemini(monkeypatch):
    monkeypatch.setattr(settings, "LECTOR_FACTURAS", "gemini")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "clave-de-prueba")
    monkeypatch.setattr(settings, "GEMINI_MODELO", "gemini-3.8-flash")
    # Sin respaldo salvo que la prueba lo pida, y sin esperar entre reintentos.
    monkeypatch.setattr(settings, "GEMINI_MODELO_RESPALDO", "")
    monkeypatch.setattr(lectura_facturas.time, "sleep", lambda s: None)
    pedidos = []

    def responder(estado=200, cuerpo=None, error=None, secuencia=None):
        """`secuencia`: lista de (estado, cuerpo), una por pedido, en orden."""
        def post(url, json=None, headers=None, timeout=None):
            pedidos.append({"url": url, "json": json, "headers": headers, "timeout": timeout})
            if error:
                raise error
            e, c = secuencia[len(pedidos) - 1] if secuencia else (estado, cuerpo)
            return httpx.Response(e, json=c, request=httpx.Request("POST", url))
        monkeypatch.setattr(lectura_facturas.httpx, "post", post)

    return pedidos, responder


def respuesta(texto, **uso):
    return {
        "candidates": [{"content": {"parts": [{"text": texto}]}, "finishReason": "STOP"}],
        "usageMetadata": {"promptTokenCount": 1800, "candidatesTokenCount": 400, **uso},
    }


def test_sin_clave_queda_apagado(client, monkeypatch):
    """Mejor que el boton no aparezca a que aparezca y falle en cada foto."""
    monkeypatch.setattr(settings, "LECTOR_FACTURAS", "gemini")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
    assert lectura_facturas.lector_activo() is None
    assert client.get("/api/compras/lectura").json() == {"activo": False, "lector": ""}


def test_pide_lo_que_debe(gemini):
    pedidos, responder = gemini
    responder(cuerpo=respuesta(json.dumps(BORRADOR)))
    lectura_facturas.leer(JPG, "image/jpeg")
    [p] = pedidos
    assert p["url"].endswith("/models/gemini-3.8-flash:generateContent")
    assert "clave-de-prueba" not in p["url"], "la clave va en la cabecera, no en la URL (queda en logs)"
    assert p["headers"]["x-goog-api-key"] == "clave-de-prueba"
    parte = p["json"]["contents"][0]["parts"][0]["inline_data"]
    assert parte["mime_type"] == "image/jpeg" and base64.b64decode(parte["data"]) == JPG
    config = p["json"]["generationConfig"]
    assert config["response_mime_type"] == "application/json"
    assert config["temperature"] == 0
    assert "renglones" in config["response_schema"]["properties"]


def test_el_esquema_no_tiene_valores_que_gemini_rechaza():
    """Gemini rechaza con 400 un `enum` con un valor vacio. Paso de verdad: la
    primera lectura real devolvio "enum[2]: cannot be empty"."""
    def recorrer(nodo):
        if isinstance(nodo, dict):
            assert all(v != "" for v in nodo.get("enum", [])), nodo
            for v in nodo.values():
                recorrer(v)
        elif isinstance(nodo, list):
            for v in nodo:
                recorrer(v)
    recorrer(lectura_facturas.ESQUEMA)


def test_moneda_desconocida_queda_vacia(gemini):
    _, responder = gemini
    responder(cuerpo=respuesta(json.dumps({**BORRADOR, "moneda": None})))
    assert lectura_facturas.leer(JPG, "image/jpeg").borrador.moneda == ""


def test_un_pdf_va_tal_cual(gemini):
    pedidos, responder = gemini
    responder(cuerpo=respuesta(json.dumps(BORRADOR)))
    lectura_facturas.leer(b"%PDF-1.7 ...", "application/pdf")
    assert pedidos[0]["json"]["contents"][0]["parts"][0]["inline_data"]["mime_type"] == "application/pdf"


def test_convierte_la_respuesta_en_borrador(gemini):
    _, responder = gemini
    responder(cuerpo=respuesta(json.dumps(BORRADOR), thoughtsTokenCount=250))
    l = lectura_facturas.leer(JPG, "image/jpeg")
    assert l.borrador.numero_factura == "0004512" and l.borrador.moneda == "Bs"
    assert str(l.borrador.fecha) == "2026-09-28"
    assert l.borrador.renglones[0].exento is True
    assert l.borrador.renglones[1].precio_unitario is None, "lo que no se lee queda vacio, no inventado"
    assert l.borrador.advertencias == ["No se lee el precio del queso."]
    assert (l.tokens_entrada, l.tokens_salida) == (1800, 650), "lo que razona tambien se cobra"


def test_ignora_el_razonamiento_y_las_comillas_de_bloque(gemini):
    _, responder = gemini
    cuerpo = respuesta("")
    cuerpo["candidates"][0]["content"]["parts"] = [
        {"text": "Pienso que el RIF es...", "thought": True},
        {"text": "```json\n" + json.dumps(BORRADOR) + "\n```"},
    ]
    responder(cuerpo=cuerpo)
    assert lectura_facturas.leer(JPG, "image/jpeg").borrador.proveedor_rif == "J-40123456-7"


@pytest.mark.parametrize("estado, dice, pedidos_hechos", [
    (401, "clave de Gemini no es válida", 1),
    (403, "no tiene permiso", 1),
    (404, "ERP_GEMINI_MODELO", 1),
    (429, "límite de uso", 1),
    (418, "no está disponible", 1),
    (500, "saturado", 3),
    (503, "saturado", 3),
])
def test_cada_falla_de_google_dice_que_hacer(gemini, estado, dice, pedidos_hechos):
    pedidos, responder = gemini
    responder(estado=estado, cuerpo={"error": {"message": "detalle interno de la cuenta"}})
    with pytest.raises(lectura_facturas.ErrorDeLectura) as e:
        lectura_facturas.leer(JPG, "image/jpeg")
    assert dice in str(e.value)
    assert "detalle interno" not in str(e.value), "el detalle de Google va al log, no a la pantalla"
    assert len(pedidos) == pedidos_hechos, "solo lo pasajero se reintenta"


def test_si_google_esta_saturado_reintenta_y_lee(gemini):
    """Paso de verdad: con las 21 facturas reales, la mitad volvio con 503
    'mucha demanda'. Unos segundos despues se leen."""
    pedidos, responder = gemini
    responder(secuencia=[(503, {}), (503, {}), (200, respuesta(json.dumps(BORRADOR)))])
    l = lectura_facturas.leer(JPG, "image/jpeg")
    assert l.borrador.numero_factura == "0004512" and l.modelo == "gemini-3.8-flash"
    assert len(pedidos) == 3


def test_si_el_principal_sigue_saturado_lee_el_de_respaldo(gemini, monkeypatch):
    pedidos, responder = gemini
    monkeypatch.setattr(settings, "GEMINI_MODELO_RESPALDO", "gemini-3.5-flash-lite")
    responder(secuencia=[(503, {})] * 3 + [(200, respuesta(json.dumps(BORRADOR)))])
    l = lectura_facturas.leer(JPG, "image/jpeg")
    assert l.modelo == "gemini-3.5-flash-lite"
    assert [p["url"].split("/models/")[1].split(":")[0] for p in pedidos] == (
        ["gemini-3.8-flash"] * 3 + ["gemini-3.5-flash-lite"]
    )


def test_los_dos_saturados(gemini, monkeypatch):
    pedidos, responder = gemini
    monkeypatch.setattr(settings, "GEMINI_MODELO_RESPALDO", "gemini-3.5-flash-lite")
    responder(estado=503, cuerpo={})
    with pytest.raises(lectura_facturas.ErrorDeLectura, match="saturado"):
        lectura_facturas.leer(JPG, "image/jpeg")
    assert len(pedidos) == 6


def test_un_error_que_no_es_pasajero_no_cambia_de_modelo(gemini, monkeypatch):
    """Una clave mala no se arregla con otro modelo: se dice de una vez."""
    pedidos, responder = gemini
    monkeypatch.setattr(settings, "GEMINI_MODELO_RESPALDO", "gemini-3.5-flash-lite")
    responder(estado=401, cuerpo={})
    with pytest.raises(lectura_facturas.ErrorDeLectura, match="no es válida"):
        lectura_facturas.leer(JPG, "image/jpeg")
    assert len(pedidos) == 1


def test_sin_red_o_lento(gemini):
    _, responder = gemini
    responder(error=httpx.ReadTimeout("lento"))
    with pytest.raises(lectura_facturas.ErrorDeLectura, match="tardó demasiado"):
        lectura_facturas.leer(JPG, "image/jpeg")
    responder(error=httpx.ConnectError("sin red"))
    with pytest.raises(lectura_facturas.ErrorDeLectura, match="No se pudo conectar"):
        lectura_facturas.leer(JPG, "image/jpeg")


@pytest.mark.parametrize("cuerpo, dice", [
    ({"promptFeedback": {"blockReason": "SAFETY"}}, "se negó"),
    (respuesta(""), "no devolvió nada"),
    (respuesta("esto no es json"), "incompleta"),
    (respuesta(json.dumps({**BORRADOR, "renglones": "dos"})), "incompleta"),
])
def test_respuestas_que_no_sirven(gemini, cuerpo, dice):
    _, responder = gemini
    responder(cuerpo=cuerpo)
    with pytest.raises(lectura_facturas.ErrorDeLectura, match=dice):
        lectura_facturas.leer(JPG, "image/jpeg")


def test_por_la_api_la_foto_queda_aunque_gemini_falle(client, db, gemini):
    _, responder = gemini
    responder(estado=429, cuerpo={})
    r = client.post("/api/compras/lectura", files={"archivo": ("f.jpg", JPG, "image/jpeg")})
    assert r.status_code == 200
    assert r.json()["lector"] == "gemini" and r.json()["borrador"] is None
    assert "límite de uso" in r.json()["error"]
    assert db.get(models.SoporteFactura, r.json()["soporte_id"]).contenido == JPG


def test_por_la_api_guarda_lo_que_costo(client, db, gemini):
    _, responder = gemini
    responder(cuerpo=respuesta(json.dumps(BORRADOR)))
    r = client.post("/api/compras/lectura", files={"archivo": ("f.jpg", JPG, "image/jpeg")}).json()
    s = db.get(models.SoporteFactura, r["soporte_id"])
    assert (s.lector, s.tokens_entrada, s.tokens_salida) == ("gemini:gemini-3.8-flash", 1800, 400)
    assert r["borrador"]["proveedor_rif"] == "J-40123456-7"


def test_los_codigos_de_barra_sueltos_no_son_renglones(gemini):
    """Paso con una factura real: cada codigo de barras salio como renglon."""
    _, responder = gemini
    con_codigos = {**BORRADOR, "renglones": [
        BORRADOR["renglones"][0],
        {"descripcion": "076501171709", "cantidad": 1, "unidad": "", "precio_unitario": 0,
         "subtotal": 0, "exento": None},
        BORRADOR["renglones"][1],
    ]}
    responder(cuerpo=respuesta(json.dumps(con_codigos)))
    b = lectura_facturas.leer(JPG, "image/jpeg").borrador
    assert [r.descripcion for r in b.renglones] == ["HARINA PAN 1KG (E)", "QUESO BLANCO DURO"]


def test_le_dice_a_gemini_la_fecha_de_hoy(gemini):
    """Sin esto leia 2020, 2023 o 2024 en facturas de 2026."""
    import datetime
    pedidos, responder = gemini
    responder(cuerpo=respuesta(json.dumps(BORRADOR)))
    lectura_facturas.leer(JPG, "image/jpeg")
    texto = pedidos[0]["json"]["contents"][0]["parts"][1]["text"]
    assert f"Hoy es {datetime.date.today().isoformat()}" in texto
