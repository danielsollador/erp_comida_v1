"""Descargar el Libro de Compras y el de Ventas en Excel.

Es CSV, no .xlsx: Excel lo abre igual con doble clic y evita meter una
libreria binaria solo para escribir filas y columnas. Lo que si importa
probar es el BOM -sin el, Excel en Windows lee un acento como un simbolo
raro- y que las cifras que salen sean las mismas que las de la pantalla, no
un numero recalculado aparte.
"""


def test_libro_de_ventas_se_descarga_como_csv(client, variante):
    p = client.post("/api/pedidos", json={
        "items": [{"variante_id": variante.id, "cantidad": 2}], "nota": "",
    }).json()
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={
        "metodo_pago": "Efectivo Bs", "facturado": True, "numero_factura": "00-1",
    })

    r = client.get("/api/impuestos/libro-ventas/exportar")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]

    texto = r.content.decode("utf-8-sig")  # -sig quita el BOM al leer, como Excel
    assert texto.startswith("Pedido,Fecha,N. Factura,Cliente,Base imponible,IVA,Total")
    assert "00-1" in texto


def test_el_bom_esta_presente_para_que_excel_no_dañe_las_tildes(client):
    r = client.get("/api/impuestos/libro-compras/exportar")
    assert r.content[:3] == b"\xef\xbb\xbf"


def test_libro_de_compras_se_descarga_y_coincide_con_la_pantalla(client, insumo):
    client.post("/api/compras/facturas", json={
        "numero_factura": "F-CSV", "proveedor_nombre": "Ñoño e Hijos", "proveedor_rif": "J123456789",
        "categoria": "Insumos", "forma_pago": "Efectivo",
        "items": [{"ingrediente_id": insumo.id, "cantidad": 1, "costo_unitario": 10.0}],
    })

    pantalla = client.get("/api/impuestos/libro-compras").json()
    csv_resp = client.get("/api/impuestos/libro-compras/exportar")
    texto = csv_resp.content.decode("utf-8-sig")

    assert "F-CSV" in texto
    assert "Ñoño e Hijos" in texto, "el nombre con eñe tiene que sobrevivir la vuelta"
    fila = pantalla["filas"][0]
    assert f"{fila['total']:.2f}" in texto, "el total del CSV es el mismo que ve la pantalla"


def test_un_periodo_sin_movimientos_da_un_csv_con_solo_encabezado(client):
    r = client.get("/api/impuestos/libro-ventas/exportar?desde=2020-01-01&hasta=2020-01-02")
    assert r.status_code == 200
    lineas = r.content.decode("utf-8-sig").strip().splitlines()
    assert len(lineas) == 1  # solo el encabezado
