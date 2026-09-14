"""Tier 5: los menores, que igual dejaban el sistema mintiendo o trancado."""

import datetime

from app import models


def saldo(db, codigo):
    cuenta = db.query(models.CuentaContable).filter_by(codigo=codigo).first()
    movs = db.query(models.MovimientoContable).filter_by(cuenta_id=cuenta.id).all()
    total = sum(m.debe - m.haber for m in movs)
    return round(total if cuenta.naturaleza == "deudora" else -total, 2)


# ------------------------------------------------- H95: historial de recetas
def test_cada_cambio_de_receta_queda_registrado(client, insumo, variante):
    """Los precios de venta tenian historial y las recetas no: no habia como
    responder 'por que cambio mi costo en marzo'."""
    client.put(
        f"/api/inventario/recetas/{variante.id}",
        json=[{"ingrediente_id": insumo.id, "cantidad_por_unidad": 0.2}],
    )
    client.put(
        f"/api/inventario/recetas/{variante.id}",
        json=[{"ingrediente_id": insumo.id, "cantidad_por_unidad": 0.3}],
    )

    historial = client.get(f"/api/inventario/recetas/{variante.id}/historial").json()
    assert len(historial) == 2
    assert "Carne molida 0.3 kg" in historial[0]["composicion"]
    assert historial[0]["costo_resultante"] > historial[1]["costo_resultante"]


def test_borrar_la_receta_tambien_queda_registrado(client, variante):
    client.put(f"/api/inventario/recetas/{variante.id}", json=[])
    historial = client.get(f"/api/inventario/recetas/{variante.id}/historial").json()
    assert historial[0]["composicion"] == "(sin receta)"
    assert historial[0]["costo_resultante"] == 0


# ------------------------------------------------- H115: consumo del personal
def test_lo_que_se_come_el_personal_no_ensucia_la_merma(client, db, insumo):
    """Una merma es plata perdida y sirve para detectar desperdicio o robo.
    Meter ahi el consumo autorizado contamina justo ese indicador."""
    stock_antes = insumo.stock_actual
    r = client.post(
        f"/api/inventario/ingredientes/{insumo.id}/consumo-personal",
        json={"cantidad": 0.5, "motivo": "almuerzo del turno"},
    )
    assert r.status_code == 200
    db.expire_all()
    assert insumo.stock_actual == stock_antes - 0.5

    assert saldo(db, "6020") == 0.0, "la merma no se toco"
    assert saldo(db, "6025") == 4.0, "quedo como costo de personal"
    assert client.get("/api/inventario/mermas").json() == []


def test_el_consumo_del_personal_si_baja_la_utilidad(client, db, insumo):
    """Es un costo real del negocio, aunque no sea una perdida."""
    client.post(
        f"/api/inventario/ingredientes/{insumo.id}/consumo-personal",
        json={"cantidad": 0.5, "motivo": "turno"},
    )
    er = client.get("/api/contabilidad/estado-resultados?periodo=mes").json()
    assert er["gastos"] == 4.0


# ------------------------------------------------- H107: comandas olvidadas
def test_la_comanda_vieja_sin_cobrar_se_reclama(client, db, variante):
    """Su inventario ya salio al crearla: es mercancia que se fue sin que nadie
    la pagara, y no aparecia en ningun reporte ni alerta."""
    p = client.post(
        "/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 2}]}
    ).json()
    pedido = db.query(models.Pedido).filter_by(id=p["id"]).first()
    pedido.creado_en = datetime.datetime.now() - datetime.timedelta(days=3)
    db.commit()

    olvidados = client.get("/api/pedidos/olvidados").json()
    assert len(olvidados) == 1

    salud = client.get("/api/contabilidad/salud").json()
    assert any("sin cobrar" in pr["titulo"] for pr in salud["problemas"])


def test_una_comanda_de_hace_un_rato_no_se_reclama(client, variante):
    """En pleno servicio siempre hay comandas abiertas: avisar por esas
    entrenaria al dueno a ignorar el aviso."""
    client.post("/api/pedidos", json={"items": [{"variante_id": variante.id, "cantidad": 2}]})
    assert client.get("/api/pedidos/olvidados").json() == []
    salud = client.get("/api/contabilidad/salud").json()
    assert not any("sin cobrar" in pr["titulo"] for pr in salud["problemas"])


# ------------------------------------------------- H116: venta libre
def test_se_puede_cobrar_algo_que_no_esta_en_el_menu(client, db, variante):
    """Antes habia que crearlo en el menu, y ahi se quedaba para siempre: en la
    practica eso empujaba a no registrar la venta."""
    p = client.post(
        "/api/pedidos",
        json={
            "items": [
                {"variante_id": variante.id, "cantidad": 1},
                {"nombre_libre": "Torta por encargo", "precio_libre": 25.0, "cantidad": 1},
            ]
        },
    ).json()
    assert p["total"] == 30.0

    cobrado = client.post(
        f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"}
    ).json()
    assert cobrado["total"] == 30.0
    assert saldo(db, "4010") == 30.0

    # y el menu quedo limpio: no se creo ningun producto
    categorias = client.get("/api/menu/categorias").json()
    nombres = [v["nombre"] for c in categorias for pr in c["productos"] for v in pr["variantes"]]
    assert "Torta por encargo" not in nombres


def test_la_venta_libre_no_finge_tener_costo(client, variante):
    client.post(
        "/api/pedidos",
        json={"items": [{"nombre_libre": "Torta", "precio_libre": 25.0, "cantidad": 1}]},
    )
    pedido = client.get("/api/pedidos").json()[0]
    client.post(f"/api/pedidos/{pedido['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})

    fila = next(
        f
        for f in client.get("/api/reportes/resumen?periodo=dia").json()["top_productos"]
        if f["nombre"] == "Torta"
    )
    assert fila["costo"] == 0.0
    assert fila["sin_receta"] is True, "el margen que saldria no significa nada"


def test_la_venta_libre_necesita_nombre_y_precio(client):
    sin_nombre = client.post(
        "/api/pedidos", json={"items": [{"precio_libre": 10.0, "cantidad": 1}]}
    )
    assert sin_nombre.status_code == 400
    sin_precio = client.post(
        "/api/pedidos", json={"items": [{"nombre_libre": "Torta", "cantidad": 1}]}
    )
    assert sin_precio.status_code == 400


def test_dos_ventas_libres_con_el_mismo_nombre_se_agrupan(client, variante):
    for _ in range(2):
        p = client.post(
            "/api/pedidos",
            json={"items": [{"nombre_libre": "Torta", "precio_libre": 25.0, "cantidad": 1}]},
        ).json()
        client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})

    filas = [
        f
        for f in client.get("/api/reportes/resumen?periodo=dia").json()["top_productos"]
        if f["nombre"] == "Torta"
    ]
    assert len(filas) == 1
    assert filas[0]["unidades"] == 2


# ------------------------------------------------- migracion: relajar NOT NULL
def test_la_migracion_relaja_not_null_sin_perder_filas(tmp_path, monkeypatch):
    """La venta libre guarda variante_id en NULL, pero en una base que ya venia
    de antes la columna seguia siendo NOT NULL: los tests pasaban (crean las
    tablas de cero) y el endpoint reventaba en produccion.

    Un primer intento de esta migracion fallo a mitad y dejo la tabla viva
    vacia con las filas en la copia. Este test fija que eso no vuelva a pasar.
    """
    import sqlite3

    from sqlalchemy import create_engine

    from app import migrations

    ruta = tmp_path / "vieja.db"
    con = sqlite3.connect(str(ruta))
    con.executescript(
        """
        CREATE TABLE pedidos (id INTEGER PRIMARY KEY);
        CREATE TABLE variantes (id INTEGER PRIMARY KEY);
        CREATE TABLE pedido_items (
            id INTEGER NOT NULL PRIMARY KEY,
            pedido_id INTEGER NOT NULL,
            variante_id INTEGER NOT NULL,
            nombre VARCHAR NOT NULL,
            precio_unitario FLOAT NOT NULL,
            costo_unitario FLOAT, cantidad INTEGER, nota VARCHAR, preparado BOOLEAN);
        CREATE INDEX ix_pedido_items_id ON pedido_items (id);
        INSERT INTO pedidos VALUES (1);
        INSERT INTO variantes VALUES (1);
        INSERT INTO pedido_items VALUES (1, 1, 1, 'Empanada', 5.0, 1.0, 2, '', 0);
        """
    )
    con.commit()
    con.close()

    monkeypatch.setattr(migrations, "engine", create_engine(f"sqlite:///{ruta}"))
    migrations._relajar_not_null("pedido_items", "variante_id")

    con = sqlite3.connect(str(ruta))
    try:
        notnull = [r[3] for r in con.execute("PRAGMA table_info(pedido_items)")
                   if r[1] == "variante_id"][0]
        assert notnull == 0, "la columna acepta NULL"
        assert con.execute("SELECT COUNT(*) FROM pedido_items").fetchone()[0] == 1
        assert con.execute("SELECT nombre FROM pedido_items").fetchone()[0] == "Empanada"
        sobrantes = [
            r[0]
            for r in con.execute(
                "SELECT name FROM sqlite_master WHERE name LIKE '%migrando%'"
            )
        ]
        assert sobrantes == [], "no queda tabla temporal"
        # y la venta libre ya entra
        con.execute(
            "INSERT INTO pedido_items (pedido_id, variante_id, nombre, precio_unitario) "
            "VALUES (1, NULL, 'Torta por encargo', 25.0)"
        )
        con.commit()
    finally:
        con.close()


def test_la_venta_libre_no_se_reporta_como_fila_huerfana(client, variante):
    """No apunta a ninguna variante porque el producto no esta en el menu: eso
    es correcto, no una referencia rota."""
    p = client.post(
        "/api/pedidos",
        json={"items": [{"nombre_libre": "Torta", "precio_libre": 25.0, "cantidad": 1}]},
    ).json()
    client.post(f"/api/pedidos/{p['id']}/cobrar", json={"metodo_pago": "Efectivo Bs"})

    salud = client.get("/api/contabilidad/salud").json()
    assert not any("ya no existen" in pr["titulo"] for pr in salud["problemas"])
