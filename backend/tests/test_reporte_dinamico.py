"""Reportes a medida: el usuario arma el reporte, el sistema lo calcula.

La promesa que mas importa: el numero es el MISMO que el de los reportes
fijos, y el mismo venga del mart o en vivo. Si no, el cliente deja de creerle
a las dos pantallas.
"""
import datetime

from app import consolidacion, models
from app.timeutils import hoy
from test_mart_diario import comanda, cobrar, iso, mover, resumen, vender_hace


def consulta(client, fuente, filas=(), medidas=("ventas",), columna=None, filtros=None,
             desde=7, hasta=0, esperado=200):
    r = client.post("/api/reportes/dinamico/consulta", json={
        "fuente": fuente, "filas": list(filas), "medidas": list(medidas), "columna": columna,
        "filtros": filtros or {}, "desde": iso(desde), "hasta": iso(hasta),
    })
    assert r.status_code == esperado, r.text
    return r.json()


def sin_origen(r):
    r = dict(r)
    r.pop("desde_mart")
    return r


def otra_variante(db, nombre="Jugo", precio=3.0):
    categoria = models.Categoria(nombre="Bebidas frías")
    db.add(categoria)
    db.flush()
    p = models.Producto(categoria_id=categoria.id, nombre=nombre)
    db.add(p)
    db.flush()
    v = models.Variante(producto_id=p.id, nombre="Regular", precio=precio)
    db.add(v)
    db.commit()
    db.refresh(v)
    return v


def un_poco_de_todo(client, db, variante):
    jugo = otra_variante(db)
    vender_hace(client, db, variante, 1, cantidad=2, hora=9)
    vender_hace(client, db, jugo, 1, cantidad=1, hora=13, metodo="Pago movil")
    vender_hace(client, db, variante, 2, cantidad=3, hora=13)
    vender_hace(client, db, jugo, 0, cantidad=2, hora=8)
    # Un pedido con dos productos, para "pedidos distintos".
    p = client.post("/api/pedidos", json={"items": [
        {"variante_id": variante.id, "cantidad": 1}, {"variante_id": jugo.id, "cantidad": 1},
    ]}).json()
    cobrar(client, p["id"])
    mover(db, p["id"], 2, 19)
    return jugo


CONSULTAS = [
    ("ventas", ["dia"], ["ventas", "pedidos", "ticket"], None),
    ("ventas", [], ["ventas", "pedidos", "iva", "descuentos"], None),
    ("ventas", ["dia"], ["ventas"], "persona"),
    ("ventas", ["hora"], ["pedidos"], "dia_semana"),
    ("ventas", ["mes", "caja"], ["ventas", "pedidos"], None),
    ("productos", ["producto"], ["unidades", "ventas", "precio_promedio"], None),
    ("productos", ["categoria", "dia"], ["unidades", "ventas", "precio_promedio"], None),
    ("cobros", ["dia"], ["monto", "cobros"], "forma_pago"),
]


def test_da_lo_mismo_desde_el_mart_que_en_vivo(client, db, variante):
    un_poco_de_todo(client, db, variante)
    en_vivo = [consulta(client, f, filas, medidas, col) for f, filas, medidas, col in CONSULTAS]
    assert not any(r["desde_mart"] for r in en_vivo)

    assert consolidacion.consolidar_pendientes(db) == 2
    del_mart = [consulta(client, f, filas, medidas, col) for f, filas, medidas, col in CONSULTAS]
    # Todas estas combinaciones caben en el mart: los dias pasados salen de ahi.
    assert all(r["desde_mart"] for r in del_mart)
    for a, b in zip(en_vivo, del_mart):
        assert sin_origen(a) == sin_origen(b)


def test_el_costo_no_cambia_con_un_filtro(client, db, variante):
    """El costo tiene fracciones de centavo y el mart lo guarda redondeado
    por dia: si se leyera de ahi, el margen de un producto cambiaba un
    centavo al ponerle un filtro (que lo manda a calcular en vivo)."""
    jugo = un_poco_de_todo(client, db, variante)
    consolidacion.consolidar_pendientes(db)
    solo = consulta(client, "productos", ["producto"], ["costo", "margen"])
    assert solo["desde_mart"] is False
    filtrado = consulta(client, "productos", ["producto"], ["costo", "margen"],
                        filtros={"categoria": ["Bebidas frías"]})
    fila = lambda r: next(f["total"] for f in r["filas"] if f["claves"][0] == f"v:{jugo.id}")
    assert fila(solo) == fila(filtrado)


def test_lo_que_no_cabe_en_el_mart_se_calcula_en_vivo(client, db, variante):
    un_poco_de_todo(client, db, variante)
    consolidacion.consolidar_pendientes(db)
    r = consulta(client, "productos", ["producto", "persona"], ["unidades"])
    assert r["desde_mart"] is False
    assert r["totales"]["total"]["unidades"] == 2 + 1 + 3 + 2 + 2


def test_cuadra_con_el_resumen_de_reportes(client, db, variante):
    un_poco_de_todo(client, db, variante)
    fijo = resumen(client, 7)
    r = consulta(client, "ventas", [], ["ventas", "pedidos"])
    assert r["totales"]["total"]["ventas"] == fijo["ventas"]
    assert r["totales"]["total"]["pedidos"] == fijo["pedidos"]
    productos = consulta(client, "productos", ["producto"], ["unidades", "ventas"])
    por_nombre = {f["etiquetas"][0]: f["total"] for f in productos["filas"]}
    for top in fijo["top_productos"]:
        assert por_nombre[top["nombre"]]["unidades"] == top["unidades"]
        assert por_nombre[top["nombre"]]["ventas"] == top["ingresos"]


def test_pedidos_distintos_y_columnas(client, db, variante):
    jugo = un_poco_de_todo(client, db, variante)
    r = consulta(client, "productos", ["producto"], ["pedidos", "unidades"], columna="dia")
    fila = next(f for f in r["filas"] if f["claves"][0] == f"v:{jugo.id}")
    # Jugo: hace 1 dia (1 pedido), hoy (1), hace 2 (el pedido mixto).
    assert fila["total"]["pedidos"] == 3
    assert sum(c["pedidos"] for c in fila["por_columna"].values()) == 3
    # Aunque haya mart: los distintos se cuentan en vivo, nunca sumando dias
    # o categorias ya contados.
    consolidacion.consolidar_pendientes(db)
    r2 = consulta(client, "productos", ["categoria"], ["pedidos"])
    assert r2["desde_mart"] is False and r2["totales"]["total"]["pedidos"] == 5
    # Totales: 5 pedidos con productos; el mixto cuenta una vez.
    assert r["totales"]["total"]["pedidos"] == 5
    assert [v["valor"] for v in r["columna"]["valores"]] == sorted(v["valor"] for v in r["columna"]["valores"])


def test_filtros(client, db, variante):
    un_poco_de_todo(client, db, variante)
    r = consulta(client, "cobros", ["forma_pago"], ["monto", "cobros"], filtros={"forma_pago": ["Pago movil"]})
    assert [f["claves"][0] for f in r["filas"]] == ["Pago movil"]
    assert r["totales"]["total"]["cobros"] == 1
    # Filtro por hora: solo lo cobrado a las 13.
    r = consulta(client, "ventas", [], ["pedidos"], filtros={"hora": ["13"]})
    assert r["totales"]["total"]["pedidos"] == 2


def test_costo_y_margen_solo_para_quien_administra(db, variante):
    from fastapi.testclient import TestClient

    from app import settings
    from app.acceso import usuarios
    from app.database import get_db
    from app.main import app
    from conftest import entrar

    cajera = ("cajera_reportes", "clave-de-la-cajera-larga")
    try:
        usuarios.crear(cajera[0], cajera[1], rol="caja", locales=[settings.LOCAL_SLUG],
                       nombre="Carla", apellido="Caja")
    except usuarios.ErrorUsuarios:
        pass
    app.dependency_overrides[get_db] = lambda: db
    try:
        with TestClient(app) as c:
            entrar(c, *cajera)
            cat = c.get("/api/reportes/dinamico/catalogo").json()
            productos = next(f for f in cat if f["id"] == "productos")
            assert "costo" not in {m["id"] for m in productos["medidas"]}
            consulta(c, "productos", ["producto"], ["unidades"])
            consulta(c, "productos", ["producto"], ["margen"], esperado=400)
            # Y si puede guardar sus propios reportes.
            r = c.post("/api/reportes/dinamico/guardados", json={
                "nombre": "Lo mío", "definicion": {"fuente": "ventas", "filas": ["dia"], "medidas": ["ventas"]},
            })
            assert r.status_code == 200, r.text
    finally:
        app.dependency_overrides.clear()
        # Los usuarios viven en un almacen compartido por toda la corrida:
        # dejarla creada le cambia la cuenta de usuarios a otros tests.
        try:
            usuarios.borrar(cajera[0])
        except usuarios.ErrorUsuarios:
            pass


def test_los_reportes_de_fabrica_abren(client, db, variante):
    un_poco_de_todo(client, db, variante)
    for g in client.get("/api/reportes/dinamico/guardados").json():
        d = g["definicion"]
        consulta(client, d["fuente"], d.get("filas", []), d["medidas"], d.get("columna"), d.get("filtros"),
                 desde=30)


def test_guardar_cambiar_y_borrar(client):
    definicion = {"fuente": "productos", "filas": ["categoria"], "medidas": ["ventas"]}
    r = client.post("/api/reportes/dinamico/guardados",
                    json={"nombre": "Categorías", "definicion": definicion, "periodo": "mes"})
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    assert any(g["id"] == rid and g["periodo"] == "mes" for g in client.get("/api/reportes/dinamico/guardados").json())

    r = client.put(f"/api/reportes/dinamico/guardados/{rid}",
                   json={"nombre": "Categorías del mes", "definicion": {**definicion, "columna": "dia"}})
    assert r.status_code == 200 and r.json()["definicion"]["columna"] == "dia"

    # Un campo que no existe no se guarda: el reporte no abriria.
    malo = client.post("/api/reportes/dinamico/guardados",
                       json={"nombre": "x", "definicion": {"fuente": "productos", "filas": ["nada"], "medidas": ["ventas"]}})
    assert malo.status_code == 400
    # Los de fabrica no se borran.
    assert client.delete("/api/reportes/dinamico/guardados/f-productos").status_code == 400
    assert client.delete(f"/api/reportes/dinamico/guardados/{rid}").status_code == 200
    assert not any(g["id"] == rid for g in client.get("/api/reportes/dinamico/guardados").json())


def test_exportar_csv(client, db, variante):
    un_poco_de_todo(client, db, variante)
    import json
    q = json.dumps({
        "fuente": "ventas", "filas": ["dia"], "medidas": ["ventas", "pedidos"], "columna": "persona",
        "filtros": {}, "desde": iso(7), "hasta": iso(0),
    })
    r = client.get("/api/reportes/dinamico/exportar", params={"q": q})
    assert r.status_code == 200
    texto = r.content.decode("utf-8-sig")
    lineas = texto.strip().splitlines()
    assert lineas[0].startswith("Día,")
    assert "Total · Total vendido" in lineas[0]
    assert lineas[-1].startswith("Total,")
    # Los pedidos son conteos: sin ".0".
    assert lineas[-1].split(",")[-1] == "5"


def test_compras_suman_la_base_de_la_factura(client, insumo):
    fac = client.post("/api/compras/facturas", json={
        "numero_factura": "F-1", "proveedor_nombre": "Carnes SA", "proveedor_rif": "J123456789",
        "categoria": "Insumos", "forma_pago": "Credito", "recargo": 3.0,
        "items": [{"ingrediente_id": insumo.id, "cantidad": 2, "costo_unitario": 9.0}],
    })
    assert fac.status_code == 200, fac.text
    r = consulta(client, "compras", ["proveedor"], ["monto", "documentos", "cantidad"])
    fila = r["filas"][0]
    assert fila["etiquetas"] == ["Carnes SA"]
    assert fila["total"]["monto"] == fac.json()["base_imponible"] == 21.0
    assert fila["total"]["documentos"] == 1 and fila["total"]["cantidad"] == 2


def test_las_notas_de_credito_restan_y_no_cuentan_como_factura(client, insumo):
    fac = client.post("/api/compras/facturas", json={
        "numero_factura": "F-1", "proveedor_nombre": "Carnes SA", "proveedor_rif": "J123456789",
        "categoria": "Insumos", "forma_pago": "Credito",
        "items": [{"ingrediente_id": insumo.id, "cantidad": 4, "costo_unitario": 10.0}],
    }).json()
    r = client.post(f"/api/compras/facturas/{fac['id']}/notas-credito", json={
        "numero": "NC-1", "tipo": "devolucion", "items": [{"ingrediente_id": insumo.id, "cantidad": 1}],
    })
    assert r.status_code == 200, r.text
    r = consulta(client, "compras", ["proveedor"], ["monto", "documentos", "cantidad"])
    total = r["filas"][0]["total"]
    assert total["monto"] == 30.0 and total["cantidad"] == 3 and total["documentos"] == 1


def test_un_mes_de_dias_cabe_en_columnas(client, db, variante):
    for d in range(31):
        vender_hace(client, db, variante, d)
    r = consulta(client, "ventas", [], ["pedidos"], columna="dia", desde=30)
    assert len(r["columna"]["valores"]) == 31


def test_la_pantalla_recibe_pocas_filas_y_el_excel_todas(client, db, variante, monkeypatch):
    import json

    from app.routers import reportes_dinamicos as rt
    for d in range(4):
        vender_hace(client, db, variante, d)
    # La pantalla con tope de 2 filas; el Excel pide el suyo, que es mayor.
    original = rt._consulta
    monkeypatch.setattr(rt, "_consulta", lambda p, limite=2: original(p, limite))
    r = consulta(client, "ventas", ["dia"], ["pedidos"])
    assert len(r["filas"]) == 2 and r["truncado"] is True
    q = json.dumps({"fuente": "ventas", "filas": ["dia"], "medidas": ["pedidos"], "columna": None,
                    "filtros": {}, "desde": iso(7), "hasta": iso(0)})
    texto = client.get("/api/reportes/dinamico/exportar", params={"q": q}).content.decode("utf-8-sig")
    assert len(texto.strip().splitlines()) == 1 + 4 + 1  # encabezado, 4 dias, total


def test_periodo_muy_largo_en_vivo_se_rechaza(client):
    r = consulta(client, "productos", ["producto", "persona"], ["unidades"], desde=500, esperado=400)
    assert "días" in r["detail"]


def test_valores_para_filtrar(client, db, variante):
    jugo = un_poco_de_todo(client, db, variante)
    r = client.post("/api/reportes/dinamico/valores", json={
        "fuente": "productos", "campo": "producto", "desde": iso(7), "hasta": iso(0),
    })
    assert r.status_code == 200, r.text
    valores = {v["valor"]: v["etiqueta"] for v in r.json()}
    assert valores[f"v:{jugo.id}"] == "Jugo"


# ── Los modulos nuevos: Inventario, Cocina, Contabilidad y Tasa ────────────


def test_inventario_trae_las_mermas_con_su_motivo_y_valor(client, insumo):
    r = client.post(f"/api/inventario/ingredientes/{insumo.id}/merma", json={"cantidad": 2, "motivo": "se dano"})
    assert r.status_code == 200, r.text
    r = consulta(client, "inventario", ["producto", "motivo"], ["v_sale", "sale"],
                 filtros={"tipo": ["Merma"]})
    fila = r["filas"][0]
    assert fila["etiquetas"][1] == "se dano"
    # El mismo valor que lista Inventario > mermas.
    valor = client.get("/api/inventario/mermas").json()[0]["valor"]
    assert fila["total"]["v_sale"] == valor and fila["total"]["sale"] == 2


def test_cocina_mide_cuanto_tardo_cada_comanda(client, db, variante):
    import datetime as dt

    p = comanda(client, variante)
    assert client.post(f"/api/pedidos/{p['id']}/marcar-listo").status_code == 200
    pedido = db.get(models.Pedido, p["id"])
    pedido.listo_en = pedido.creado_en + dt.timedelta(minutes=12)
    db.commit()
    r = consulta(client, "cocina", [], ["comandas", "minutos"], desde=1)
    assert r["totales"]["total"] == {"comandas": 1, "minutos": 12.0}


def test_contabilidad_cuadra_debe_y_haber(client, db, variante):
    un_poco_de_todo(client, db, variante)
    r = consulta(client, "contabilidad", ["tipo"], ["debe", "haber"])
    total = r["totales"]["total"]
    assert total["debe"] == total["haber"] > 0
    ingreso = next(f for f in r["filas"] if f["claves"][0] == "Ingreso")
    saldo = consulta(client, "contabilidad", [], ["saldo"], filtros={"tipo": ["Ingreso"]})
    # Los ingresos salen en positivo: en el sentido de la cuenta.
    assert saldo["totales"]["total"]["saldo"] == ingreso["total"]["haber"] - ingreso["total"]["debe"] > 0


def test_tasa_promedia_por_semana(client, db):
    hoy_ = hoy()
    for d, bcv in ((0, 100.0), (1, 102.0)):
        db.merge(models.TasaCambio(fecha=hoy_ - datetime.timedelta(days=d), bcv=bcv, paralelo=None))
    db.commit()
    r = consulta(client, "tasa", [], ["bcv", "paralelo"], desde=1)
    assert r["totales"]["total"]["bcv"] == 101.0
    # Sin datos de paralelo: no inventa un cero.
    assert r["totales"]["total"]["paralelo"] is None


def test_cada_fuente_solo_para_quien_entra_a_su_modulo(db, variante):
    from fastapi.testclient import TestClient

    from app import settings
    from app.acceso import usuarios
    from app.database import get_db
    from app.main import app
    from conftest import entrar

    cajera = ("cajera_modulos", "clave-de-la-cajera-larga")
    try:
        usuarios.crear(cajera[0], cajera[1], rol="caja", locales=[settings.LOCAL_SLUG],
                       nombre="Carla", apellido="Caja")
    except usuarios.ErrorUsuarios:
        pass
    app.dependency_overrides[get_db] = lambda: db
    try:
        with TestClient(app) as c:
            entrar(c, *cajera)
            fuentes = {f["id"] for f in c.get("/api/reportes/dinamico/catalogo").json()}
            # La caja no entra a Contabilidad: la fuente no aparece...
            assert "contabilidad" not in fuentes and "ventas" in fuentes
            # ...ni se puede pedir directo...
            consulta(c, "contabilidad", [], ["saldo"], esperado=400)
            # ...ni sus reportes de fabrica salen en la lista.
            guardados = {g["definicion"]["fuente"] for g in c.get("/api/reportes/dinamico/guardados").json()}
            assert "contabilidad" not in guardados
    finally:
        app.dependency_overrides.clear()
        try:
            usuarios.borrar(cajera[0])
        except usuarios.ErrorUsuarios:
            pass


def test_el_catalogo_usa_los_mismos_conceptos_en_todos_los_modulos(client):
    from app import reporte_dinamico as rd

    for f in client.get("/api/reportes/dinamico/catalogo").json():
        for c in f["campos"]:
            nombre, grupo, _tipo = rd.CONCEPTOS[c["id"]]
            assert c["nombre"] == nombre and c["grupo"] == grupo, (f["id"], c)
        # Las sumas de trabajo (minutos en total, sumas de la tasa) no se ofrecen.
        assert all(m["nombre"] for m in f["medidas"])
