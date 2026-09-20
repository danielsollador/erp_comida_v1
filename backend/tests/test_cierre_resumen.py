"""El resumen con el que se cierra la caja, y el cierre por destino.

POR QUE. La pantalla de cierre mostraba lo vendido y pedia UN numero: cuanto
efectivo hay. Faltaban las dos mitades de la pregunta que el dueno hace al
cerrar -- "¿cuanto se vendio y cuanto se boto?" -- y el arqueo de lo demas
(dolares, banco, Zelle), que se cerraba a ciegas o no se cerraba.

Lo que se prueba aca es que anular y devolver NO son lo mismo, porque se
cuentan distinto: en el anulado nunca entro plata, y en el devuelto entro y
volvio a salir (y por eso el arqueo ya lo tiene contado y no hay que
descontarlo dos veces).
"""


def vender(client, variante, metodo="Efectivo Bs", cantidad=1):
    p = client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": variante.id, "cantidad": cantidad}], "nota": ""},
    ).json()
    r = client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": metodo})
    assert r.status_code == 200, r.text
    return p


def resumen(client):
    r = client.get("/api/caja/resumen")
    assert r.status_code == 200, r.text
    return r.json()


def test_un_dia_limpio_no_reporta_anulados_ni_devueltos(client, variante):
    vender(client, variante)
    d = resumen(client)
    assert d["cantidad_pedidos"] == 1
    assert d["anulados_hoy"] == 0
    assert d["anulado_monto_hoy"] == 0
    assert d["devueltos_hoy"] == 0


def test_una_comanda_botada_sale_como_anulada(client, variante):
    p = client.post(
        "/api/pedidos",
        json={"items": [{"variante_id": variante.id, "cantidad": 2}], "nota": ""},
    ).json()
    client.post(f"/api/pedidos/{p['id']}/anular", json={})

    d = resumen(client)
    assert d["anulados_hoy"] == 1
    assert d["anulado_monto_hoy"] == p["total"]
    # No se vendio: no engorda el total ni la cuenta de pedidos cobrados.
    assert d["cantidad_pedidos"] == 0
    assert d["total_ventas"] == 0


def test_una_venta_devuelta_se_reporta_aparte_de_la_anulada(client, variante):
    p = vender(client, variante, cantidad=2)
    r = client.post(f"/api/pedidos/{p['id']}/devolver", json={"motivo": "vino malo"})
    assert r.status_code == 200, r.text

    d = resumen(client)
    assert d["devueltos_hoy"] == 1
    assert d["devuelto_monto_hoy"] == p["total"]
    # Devolver no es anular: no se mezclan.
    assert d["anulados_hoy"] == 0


def test_el_arqueo_trae_una_fila_por_gaveta_aunque_este_vacia(client, variante):
    """Las gavetas se cuentan aunque no haya entrado nada: "conte y no habia"
    es una respuesta, y sin la fila no hay donde darla."""
    d = resumen(client)
    cuentas = [l["cuenta"] for l in d["arqueo"]]
    assert "1010" in cuentas  # bolivares
    assert "1011" in cuentas  # divisas


def test_cerrar_por_destino_asienta_la_diferencia_de_cada_uno(client, variante):
    vender(client, variante, metodo="Efectivo Bs")
    d = resumen(client)
    esperado = {l["cuenta"]: l["esperado"] for l in d["arqueo"]}

    # Los bolivares cuadran; en la gaveta de dolares falta un dolar.
    r = client.post(
        "/api/caja/cerrar",
        json={
            "conteos": [
                {"cuenta": "1010", "contado": esperado["1010"]},
                {"cuenta": "1011", "contado": esperado["1011"] - 1},
            ]
        },
    )
    assert r.status_code == 200, r.text
    lineas = {l["cuenta"]: l for l in r.json()["lineas"]}
    assert lineas["1010"]["diferencia"] == 0
    assert lineas["1011"]["diferencia"] == -1


def test_un_destino_sin_contar_no_inventa_un_faltante(client, variante):
    """Dejar un campo en blanco es "no lo verifique", no "habia cero". Si se
    tratara como cero, cerrar sin contar el banco asentaria un faltante por
    todo el saldo."""
    vender(client, variante, metodo="Efectivo Bs")
    d = resumen(client)
    esperado = {l["cuenta"]: l["esperado"] for l in d["arqueo"]}

    r = client.post(
        "/api/caja/cerrar",
        json={"conteos": [{"cuenta": "1010", "contado": esperado["1010"]}]},
    )
    assert r.status_code == 200, r.text
    cierre = r.json()
    # Solo se guarda la fila de lo que de verdad se conto.
    assert [l["cuenta"] for l in cierre["lineas"]] == ["1010"]
    assert cierre["diferencia"] == 0


def test_cerrar_sin_contar_nada_no_se_deja(client, variante):
    r = client.post("/api/caja/cerrar", json={"conteos": []})
    assert r.status_code == 400
