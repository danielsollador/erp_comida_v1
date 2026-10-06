"""El lector de Gemini, sin llamar a Google.

Se simula la respuesta de la API para fijar lo que importa: que pide lo que
debe (archivo, esquema, temperatura 0, la clave en la cabecera y no en la
URL), que convierte la respuesta en un borrador, y que cada falla de Google
llega a la pantalla como un mensaje que dice que hacer -- con la foto
guardada igual para cargar la factura a mano.
"""
import base64
import datetime
import json

import httpx
import pytest

from app import lectura_facturas, models, schemas, settings

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
        def stream(metodo, url, json=None, headers=None, timeout=None):
            pedidos.append({"url": url, "json": json, "headers": headers, "timeout": timeout})
            if error:
                raise error
            e, c = secuencia[len(pedidos) - 1] if secuencia else (estado, cuerpo)
            return FlujoFalso(e, c)
        monkeypatch.setattr(lectura_facturas.httpx, "stream", stream)

    return pedidos, responder


class FlujoFalso:
    """La respuesta en streaming (SSE) de Google: el cuerpo entero en un
    evento, o el error tal cual."""

    def __init__(self, estado, cuerpo):
        self.status_code = estado
        self.text = json.dumps(cuerpo)
        self._cuerpo = cuerpo

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self):
        return self.text.encode()

    def iter_lines(self):
        yield "data: " + json.dumps(self._cuerpo)


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
    assert p["url"].endswith("/models/gemini-3.8-flash:streamGenerateContent?alt=sse")
    assert "clave-de-prueba" not in p["url"], "la clave va en la cabecera, no en la URL (queda en logs)"
    assert p["headers"]["x-goog-api-key"] == "clave-de-prueba"
    parte = p["json"]["contents"][0]["parts"][0]["inline_data"]
    assert parte["mime_type"] == "image/jpeg" and base64.b64decode(parte["data"]) == JPG
    config = p["json"]["generationConfig"]
    assert config["response_mime_type"] == "application/json"
    assert config["temperature"] == 0
    # En streaming y con lo que va razonando: asi la conexion no queda muda.
    assert config["thinkingConfig"] == {"includeThoughts": True}
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
    # Sin red se reintenta (suele ser un corte pasajero) y despues se dice.
    pedidos, _ = gemini
    antes = len(pedidos)
    responder(error=httpx.ConnectError("sin red"))
    with pytest.raises(lectura_facturas.ErrorDeLectura, match="sin conexión"):
        lectura_facturas.leer(JPG, "image/jpeg")
    assert len(pedidos) - antes == 3


def test_un_corte_de_conexion_se_reintenta(gemini, monkeypatch):
    pedidos, _ = gemini
    llamadas = []

    def stream(metodo, url, json=None, headers=None, timeout=None):
        llamadas.append(url)
        if len(llamadas) == 1:
            raise httpx.RemoteProtocolError("se corto")
        return FlujoFalso(200, respuesta(__import__("json").dumps(BORRADOR)))

    monkeypatch.setattr(lectura_facturas.httpx, "stream", stream)
    assert lectura_facturas.leer(JPG, "image/jpeg").borrador.numero_factura == "0004512"
    assert len(llamadas) == 2


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


# ------------------------------------------------- los dos modelos en cascada

def borrador_bueno(**cambios):
    """Una lectura que pasa todos los controles."""
    b = {
        "proveedor_nombre": "Megalicores La Castellana, C.A",
        "proveedor_rif": "J-40223513-5",
        "numero_factura": "00113422",
        "fecha": datetime.date.today().isoformat(),
        "moneda": "Bs",
        "renglones": [
            {"descripcion": "MANI MIXTO (E)", "cantidad": 2, "unidad": "UND",
             "precio_unitario": 50, "subtotal": 100, "exento": True},
            {"descripcion": "QUESO", "cantidad": 1, "unidad": "KG",
             "precio_unitario": 200, "subtotal": 200, "exento": False},
        ],
        "recargo": 0, "descuento": 0, "subtotal": 300, "iva": 32, "total": 332,
        "advertencias": [],
    }
    b.update(cambios)
    return b


def _modelos(pedidos):
    return [p["url"].split("/models/")[1].split(":")[0] for p in pedidos]


@pytest.fixture()
def cascada(gemini, monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_MODELO", "gemini-3.5-flash-lite")
    monkeypatch.setattr(settings, "GEMINI_MODELO_RESPALDO", "gemini-3.8-flash")
    return gemini


def test_los_controles_de_una_lectura():
    hoy = datetime.date(2026, 10, 1)
    leer = lambda **c: lectura_facturas.problemas_de_lectura(  # noqa: E731
        schemas.BorradorFactura(**borrador_bueno(**{"fecha": "2026-09-28", **c})), hoy)
    assert leer() == []
    # Los errores que hicieron los modelos con las facturas reales.
    assert leer(proveedor_rif="J-41247314-8") == ["rif"]   # un digito mal leido
    assert leer(proveedor_rif="J-31366291") == ["rif"]     # le falto un digito
    assert leer(fecha="2021-08-12") == ["fecha"]           # el ano
    assert leer(fecha="2026-10-28") == ["fecha"]           # futura
    assert leer(numero_factura="") == ["numero"]
    assert leer(total=None) == ["total"]
    assert leer(total=334) == ["totales"]
    assert leer(subtotal=310, total=342) == ["renglones"]
    # Un precio que no se leyo: los renglones no se pueden sumar.
    renglones = borrador_bueno()["renglones"]
    renglones[1] = {**renglones[1], "subtotal": None}
    assert leer(renglones=renglones) == ["renglones"]
    # Centimos de redondeo no son un error; un precio cortado si (Bella Chacao).
    assert leer(total=332.03) == []
    assert leer(subtotal=301.03, total=333.03) == ["renglones"]


def test_si_la_primera_lectura_cuadra_no_se_relee(cascada):
    pedidos, responder = cascada
    responder(cuerpo=respuesta(json.dumps(borrador_bueno())))
    l = lectura_facturas.leer(JPG, "image/jpeg")
    assert _modelos(pedidos) == ["gemini-3.5-flash-lite"]
    assert l.modelo == "gemini-3.5-flash-lite"


def test_si_no_cuadra_relee_con_el_preciso_y_queda_la_buena(cascada):
    pedidos, responder = cascada
    mala = borrador_bueno(proveedor_rif="J-40223513-8", fecha="2021-08-12")
    responder(secuencia=[(200, respuesta(json.dumps(mala))),
                         (200, respuesta(json.dumps(borrador_bueno()), promptTokenCount=2000))])
    l = lectura_facturas.leer(JPG, "image/jpeg")
    assert _modelos(pedidos) == ["gemini-3.5-flash-lite", "gemini-3.8-flash"]
    assert l.borrador.proveedor_rif == "J-40223513-5"
    assert l.modelo == "gemini-3.5-flash-lite>gemini-3.8-flash=gemini-3.8-flash"
    # Se pagaron las dos.
    assert (l.tokens_entrada, l.tokens_salida) == (3800, 800)


def test_si_la_segunda_sale_peor_queda_la_primera(cascada):
    pedidos, responder = cascada
    responder(secuencia=[(200, respuesta(json.dumps(borrador_bueno(total=None)))),
                         (200, respuesta(json.dumps(borrador_bueno(total=None, fecha="2021-01-01"))))])
    l = lectura_facturas.leer(JPG, "image/jpeg")
    assert l.modelo.endswith("=gemini-3.5-flash-lite")
    assert str(l.borrador.fecha) == datetime.date.today().isoformat()


def test_si_la_segunda_falla_queda_la_primera(cascada):
    """La segunda opinion es un extra: si Google falla, no se pierde lo leido."""
    pedidos, responder = cascada
    responder(secuencia=[(200, respuesta(json.dumps(borrador_bueno(total=None))))] + [(503, {})] * 3)
    l = lectura_facturas.leer(JPG, "image/jpeg")
    assert l.modelo == "gemini-3.5-flash-lite" and l.borrador.total is None
    assert len(pedidos) == 4


def test_un_ticket_con_descuento_por_renglon(gemini):
    """Ferreteria EPA: cada producto con su DESC debajo, el "descuento
    general" que los suma, y sin cantidades. Antes salian 22 renglones y el
    descuento contado dos veces."""
    pedidos, responder = gemini
    ticket = {**BORRADOR, "subtotal": 2700.0, "descuento": 300.0, "renglones": [
        {"descripcion": "GUS.3 COB VIDRIO (G)", "cantidad": None, "unidad": "", "precio_unitario": None, "subtotal": 1000.0, "exento": False},
        {"descripcion": "DESC", "cantidad": None, "unidad": "", "precio_unitario": None, "subtotal": -100.0, "exento": None},
        {"descripcion": "TOMA DOBLE (G)", "cantidad": 2, "unidad": "UND", "precio_unitario": 1000.0, "subtotal": 2000.0, "exento": False},
        {"descripcion": "DESC.", "cantidad": None, "unidad": "", "precio_unitario": None, "subtotal": -200.0, "exento": None},
    ]}
    responder(cuerpo=respuesta(json.dumps(ticket)))
    b = lectura_facturas.leer(JPG, "image/jpeg").borrador
    assert [(r.descripcion, r.cantidad, r.precio_unitario, r.subtotal) for r in b.renglones] == [
        ("GUS.3 COB VIDRIO (G)", 1, 900.0, 900.0),
        ("TOMA DOBLE (G)", 2, 900.0, 1800.0),
    ]
    assert b.descuento == 0, "el descuento general era la suma de los DESC"
    assert any("sin cantidad" in a for a in b.advertencias)


def test_un_descuento_general_que_no_es_la_suma_se_queda(gemini):
    pedidos, responder = gemini
    ticket = {**BORRADOR, "descuento": 50.0, "renglones": [
        {"descripcion": "A", "cantidad": 1, "unidad": "", "precio_unitario": 100.0, "subtotal": 100.0, "exento": False},
        {"descripcion": "DESC", "cantidad": None, "unidad": "", "precio_unitario": None, "subtotal": -10.0, "exento": None},
    ]}
    responder(cuerpo=respuesta(json.dumps(ticket)))
    b = lectura_facturas.leer(JPG, "image/jpeg").borrador
    assert (b.descuento, b.renglones[0].subtotal) == (50.0, 90.0)


def test_la_ia_copia_el_rif_del_cliente_aunque_no_sea_el_de_la_empresa(gemini):
    pedidos, responder = gemini
    responder(cuerpo=respuesta(json.dumps(BORRADOR)))
    lectura_facturas.leer(JPG, "image/jpeg", "ALIMENTOS SAVORELLA, C.A. (J508531736)")
    texto = pedidos[0]["json"]["contents"][0]["parts"][1]["text"]
    assert "J508531736" in texto and "sea o no el de la empresa" in texto


def test_precio_de_lista_con_subtotal_rebajado_se_alinea(gemini):
    """El modelo resta el DESC del subtotal pero deja el precio de lista: si
    los subtotales cuadran con el papel, el precio se toma del subtotal."""
    pedidos, responder = gemini
    ticket = {**BORRADOR, "subtotal": 1429.40, "descuento": 0, "renglones": [
        {"descripcion": "GUS.3 COB VIDRIO (G)", "cantidad": 1, "unidad": "", "precio_unitario": 1588.22, "subtotal": 1429.40, "exento": False},
    ]}
    responder(cuerpo=respuesta(json.dumps(ticket)))
    [r] = lectura_facturas.leer(JPG, "image/jpeg").borrador.renglones
    assert (r.precio_unitario, r.subtotal) == (1429.40, 1429.40)


def test_una_fecha_que_no_existe_no_tumba_la_lectura(gemini):
    """Ticket de Daka: "2027-02-30" rechazaba la lectura entera."""
    pedidos, responder = gemini
    responder(cuerpo=respuesta(json.dumps({**BORRADOR, "fecha": "2027-02-30"})))
    b = lectura_facturas.leer(JPG, "image/jpeg").borrador
    assert b.fecha is None and b.numero_factura == "0004512"
    assert any("2027-02-30" in a for a in b.advertencias)


def test_si_el_rapido_devuelve_algo_que_no_sirve_lee_el_preciso(gemini, monkeypatch):
    pedidos, responder = gemini
    monkeypatch.setattr(settings, "GEMINI_MODELO", "gemini-3.5-flash-lite")
    monkeypatch.setattr(settings, "GEMINI_MODELO_RESPALDO", "gemini-3.8-flash")
    responder(secuencia=[(200, respuesta("{no es json")), (200, respuesta(json.dumps(BORRADOR)))])
    l = lectura_facturas.leer(JPG, "image/jpeg")
    assert l.modelo == "gemini-3.8-flash" and l.borrador.numero_factura == "0004512"


def test_los_trozos_del_streaming_se_juntan(gemini, monkeypatch):
    """Lo que va razonando llega en trozos aparte y no cuenta como respuesta;
    el JSON puede venir partido en varios."""
    pedidos, _ = gemini
    texto = json.dumps(BORRADOR)
    eventos = [
        {"candidates": [{"content": {"parts": [{"text": "leyendo el papel...", "thought": True}]}}]},
        {"candidates": [{"content": {"parts": [{"text": texto[:40]}]}}]},
        {"candidates": [{"content": {"parts": [{"text": texto[40:]}]}, "finishReason": "STOP"}],
         "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 20, "thoughtsTokenCount": 5}},
    ]

    class Varios(FlujoFalso):
        def iter_lines(self):
            for e in eventos:
                yield "data: " + json.dumps(e)
                yield ""

    monkeypatch.setattr(lectura_facturas.httpx, "stream", lambda *a, **k: Varios(200, {}))
    l = lectura_facturas.leer(JPG, "image/jpeg")
    assert l.borrador.numero_factura == "0004512"
    assert (l.tokens_entrada, l.tokens_salida) == (10, 25)
