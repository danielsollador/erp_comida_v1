"""Mercancías duplicadas: que no nazcan, y fundir las que ya nacieron.

En producción convivían "Crema de Leche Lata", "Crema de leche" y una
"crema de leche leche leche leche": tres fichas con su stock y su costo cada
una, y ninguna con la verdad. Dos defensas:

  - al crear o renombrar, un nombre IGUAL a otro activo (sin mirar tildes,
    mayúsculas ni espacios) se rechaza, y las palabras repetidas seguidas se
    limpian;
  - fundir una ficha en otra pasa lo vivo (stock, recetas, memoria de
    proveedores, consumos de comandas) y archiva la que se va, sin reescribir
    la historia ni descuadrar el inventario contable.
"""

from app import models
from app.texto import nombre_limpio


def alta(client, nombre, unidad="kg", stock=0.0, costo=0.0, **extra):
    r = client.post(
        "/api/inventario/ingredientes",
        json={"nombre": nombre, "unidad": unidad, "stock_actual": stock, "costo_unitario": costo, **extra},
    )
    assert r.status_code == 200, r.text
    return r.json()


def preparacion(client, nombre, lineas, rinde=1.0, **extra):
    r = client.post(
        "/api/inventario/preparaciones",
        json={"nombre": nombre, "unidad": "kg", "rinde": rinde, "lineas": lineas, **extra},
    )
    assert r.status_code == 200, r.text
    return r.json()


def fundir(client, origen_id, destino_id, factor=1.0):
    return client.post(f"/api/inventario/ingredientes/{origen_id}/fusionar", json={"destino_id": destino_id, "factor": factor})


def lineas_de(db, prep_id):
    db.expire_all()
    return sorted(
        (l.ingrediente_id, round(l.cantidad, 6))
        for l in db.query(models.LineaPreparacion).filter_by(preparacion_id=prep_id).all()
    )


def saldo(db, codigo):
    cuenta = db.query(models.CuentaContable).filter_by(codigo=codigo).first()
    movs = db.query(models.MovimientoContable).filter_by(cuenta_id=cuenta.id).all()
    total = sum(m.debe - m.haber for m in movs)
    return round(total if cuenta.naturaleza == "deudora" else -total, 2)


def valor_deposito(db):
    return round(
        sum(
            (i.stock_actual or 0) * (i.costo_unitario or 0)
            for i in db.query(models.Ingrediente).all()
        ),
        2,
    )


# ── Que no nazcan ─────────────────────────────────────────────────────────


def test_las_palabras_repetidas_seguidas_se_limpian():
    assert nombre_limpio("  crema de leche leche leche leche ") == "crema de leche"
    assert nombre_limpio("Crema de  Leche LECHE") == "Crema de Leche"
    # Solo la repetición SEGUIDA: "pan de pan" es un nombre posible.
    assert nombre_limpio("pan de pan") == "pan de pan"


def test_el_nombre_se_guarda_limpio(client):
    assert alta(client, "crema de leche leche leche")["nombre"] == "crema de leche"


def test_no_se_crea_una_mercancia_que_ya_existe(client):
    alta(client, "Azúcar Morena")
    r = client.post("/api/inventario/ingredientes", json={"nombre": "  azucar   morena ", "unidad": "kg"})
    assert r.status_code == 409
    assert "Azúcar Morena" in r.json()["detail"]


def test_una_archivada_no_bloquea_el_nombre(client):
    vieja = alta(client, "Pollo")
    client.put(f"/api/inventario/ingredientes/{vieja['id']}", json={"nombre": "Pollo", "unidad": "kg", "activo": False})
    assert alta(client, "pollo")["nombre"] == "pollo"


def test_no_se_renombra_a_un_nombre_ocupado(client):
    alta(client, "Harina PAN")
    otra = alta(client, "Harina de maiz")
    r = client.put(f"/api/inventario/ingredientes/{otra['id']}", json={"nombre": "harina pan", "unidad": "kg"})
    assert r.status_code == 409
    assert "fusiónalas" in r.json()["detail"]
    # Guardarse con su propio nombre (editar otra cosa) sigue andando.
    r = client.put(f"/api/inventario/ingredientes/{otra['id']}", json={"nombre": "Harina de maiz", "unidad": "kg", "stock_minimo": 2})
    assert r.status_code == 200, r.text


def test_los_duplicados_que_ya_existen_se_pueden_editar(client, db):
    """En produccion ya conviven "Crema de leche" y "Crema de Leche" (nacieron
    antes del bloqueo). Guardarles un minimo no puede fallar por el nombre:
    si no, ninguna se podria editar ni fusionar."""
    a = models.Ingrediente(nombre="Crema de leche", unidad="kg")
    b = models.Ingrediente(nombre="Crema de Leche", unidad="kg")
    db.add_all([a, b])
    db.commit()

    r = client.put(f"/api/inventario/ingredientes/{a.id}", json={"nombre": "Crema de leche", "unidad": "kg", "stock_minimo": 2})
    assert r.status_code == 200, r.text
    assert r.json()["stock_minimo"] == 2 and r.json()["nombre"] == "Crema de leche"
    # Pero ponerle el nombre de la otra, no: eso si es un cambio de nombre.
    r = client.put(f"/api/inventario/ingredientes/{a.id}", json={"nombre": "Crema de Leche", "unidad": "kg"})
    assert r.status_code == 409
    assert "fusiónalas" in r.json()["detail"]


# ── Fundir ────────────────────────────────────────────────────────────────


def test_fundir_pasa_el_stock_y_promedia_el_costo(client, db):
    queda = alta(client, "Crema de leche", stock=2, costo=4.0)  # 2 kg a $4
    se_va = alta(client, "Crema de leche lata", unidad="unidad", stock=8, costo=1.5)  # 8 latas de 250 g a $1.5
    antes = valor_deposito(db)

    r = client.post(f"/api/inventario/ingredientes/{se_va['id']}/fusionar", json={"destino_id": queda["id"], "factor": 0.25})
    assert r.status_code == 200, r.text
    destino = r.json()
    # 2 kg + 8 latas x 0.25 kg = 4 kg; $8 + $12 = $20 -> $5/kg.
    assert destino["stock_actual"] == 4
    assert destino["costo_unitario"] == 5.0

    db.expire_all()
    origen = db.get(models.Ingrediente, se_va["id"])
    assert origen.activo is False and origen.stock_actual == 0
    # El depósito vale lo mismo, y sigue cuadrando con la cuenta de inventario.
    assert valor_deposito(db) == antes
    assert saldo(db, "1040") == valor_deposito(db)

    # El rastro queda en el kardex de las dos.
    tipos = {
        (m.ingrediente_id, m.tipo, m.cantidad)
        for m in db.query(models.MovimientoInventario).filter_by(tipo="fusion").all()
    }
    assert (se_va["id"], "fusion", -8) in tipos
    assert (queda["id"], "fusion", 2) in tipos


def test_con_unidades_distintas_hay_que_decir_la_conversion(client):
    queda = alta(client, "Leche", unidad="lt")
    se_va = alta(client, "Leche caja", unidad="unidad")
    r = client.post(f"/api/inventario/ingredientes/{se_va['id']}/fusionar", json={"destino_id": queda["id"]})
    assert r.status_code == 400
    assert "cuántos lt trae 1 unidad" in r.json()["detail"]


def test_no_se_funde_consigo_misma_ni_con_una_archivada(client):
    a = alta(client, "Queso")
    b = alta(client, "Queso blanco")
    r = client.post(f"/api/inventario/ingredientes/{a['id']}/fusionar", json={"destino_id": a["id"]})
    assert r.status_code == 400
    client.put(f"/api/inventario/ingredientes/{b['id']}", json={"nombre": "Queso blanco", "unidad": "kg", "activo": False})
    r = client.post(f"/api/inventario/ingredientes/{a['id']}/fusionar", json={"destino_id": b["id"]})
    assert r.status_code == 409


def test_las_recetas_y_la_memoria_del_proveedor_pasan_a_la_que_queda(client, db, variante):
    queda = alta(client, "Masa")
    se_va = alta(client, "Disco de masa", unidad="unidad")
    receta_previa = db.query(models.RecetaItem).filter_by(variante_id=variante.id).count()
    db.add(models.RecetaItem(variante_id=variante.id, ingrediente_id=se_va["id"], cantidad_por_unidad=2))
    db.add(models.RecetaItem(variante_id=variante.id, ingrediente_id=queda["id"], cantidad_por_unidad=0.1))
    db.add(
        models.EquivalenciaProveedor(
            proveedor_rif="J123456789", clave="DISCOMASA", descripcion="DISCO MASA",
            ingrediente_id=se_va["id"], factor=10,
        )
    )
    db.commit()

    r = client.post(f"/api/inventario/ingredientes/{se_va['id']}/fusionar", json={"destino_id": queda["id"], "factor": 0.05})
    assert r.status_code == 200, r.text

    db.expire_all()
    lineas = db.query(models.RecetaItem).filter_by(variante_id=variante.id).all()
    # La receta que llevaba las dos queda con UNA línea: 0.1 + 2 discos x 0.05 kg.
    assert len(lineas) == receta_previa + 1
    masa = next(linea for linea in lineas if linea.ingrediente_id == queda["id"])
    assert round(masa.cantidad_por_unidad, 6) == 0.2
    eq = db.query(models.EquivalenciaProveedor).filter_by(clave="DISCOMASA").one()
    # 1 renglón del papel eran 10 discos; ahora son 10 x 0.05 = 0.5 kg de masa.
    assert eq.ingrediente_id == queda["id"] and round(eq.factor, 6) == 0.5


def test_las_recetas_de_las_preparaciones_pasan_a_la_que_queda(client, db):
    queda = alta(client, "Pollo")
    se_va = alta(client, "Pollo pechuga", unidad="unidad")  # 1 pechuga = 0.4 kg
    guiso = preparacion(client, "Guiso", [{"ingrediente_id": se_va["id"], "cantidad": 2}], rinde=0.8)
    mixto = preparacion(
        client, "Mixto",
        [{"ingrediente_id": se_va["id"], "cantidad": 1}, {"ingrediente_id": queda["id"], "cantidad": 0.5}],
    )

    r = fundir(client, se_va["id"], queda["id"], factor=0.4)
    assert r.status_code == 200, r.text
    # El guiso llevaba 2 pechugas: ahora lleva 0,8 kg de pollo.
    assert lineas_de(db, guiso["id"]) == [(queda["id"], 0.8)]
    # El mixto llevaba las dos: queda UNA línea, 0,5 + 1 x 0,4.
    assert lineas_de(db, mixto["id"]) == [(queda["id"], 0.9)]
    # Y la pantalla de preparaciones lo cuenta igual.
    por_nombre = {p["nombre"]: p for p in client.get("/api/inventario/preparaciones").json()}
    assert [(l["ingrediente_id"], l["cantidad"]) for l in por_nombre["Guiso"]["lineas"]] == [(queda["id"], 0.8)]


def test_no_se_funden_tipos_distintos(client):
    carne = alta(client, "Carne")
    pepsi = alta(client, "Pepsi", unidad="unidad", tipo="reventa")
    r = fundir(client, carne["id"], pepsi["id"])
    assert r.status_code == 409
    assert "materia prima" in r.json()["detail"] and "reventa" in r.json()["detail"]


def test_fundir_dos_preparaciones_hereda_la_receta_si_la_que_queda_no_tiene(client, db):
    """La ficha "Guiso pollo" nacio desde Inventario, sin receta; la que tiene
    la receta y las tandas es la otra. Al fundirlas, la receta, el modo y las
    tandas pasan a la que queda."""
    pollo = alta(client, "Pollo", stock=10, costo=4.0)
    se_va = preparacion(
        client, "Guiso de pollo", [{"ingrediente_id": pollo["id"], "cantidad": 1}],
        rinde=0.8, modo_produccion="producir",
    )
    queda = alta(client, "Guiso pollo", tipo="preparacion")
    r = client.post("/api/inventario/produccion", json={"preparacion_id": se_va["id"], "cantidad": 0.8})
    assert r.status_code == 200, r.text

    r = fundir(client, se_va["id"], queda["id"])
    assert r.status_code == 200, r.text
    db.expire_all()
    destino = db.get(models.Ingrediente, queda["id"])
    assert lineas_de(db, queda["id"]) == [(pollo["id"], 1)]
    assert (destino.rinde, destino.modo_produccion) == (1.0, "producir")
    assert round(destino.stock_actual, 4) == 0.8, "lo producido pasa con el stock"
    assert db.query(models.Produccion).one().preparacion_id == queda["id"]
    assert db.get(models.Ingrediente, se_va["id"]).activo is False


def test_fundir_no_puede_cerrar_un_ciclo(client, db):
    """El relleno lleva guiso; fundir el relleno EN el guiso (que no tiene
    receta) dejaria al guiso llevandose a si mismo."""
    pollo = alta(client, "Pollo")
    guiso = alta(client, "Guiso", tipo="preparacion")
    relleno = preparacion(
        client, "Relleno",
        [{"ingrediente_id": guiso["id"], "cantidad": 0.5}, {"ingrediente_id": pollo["id"], "cantidad": 0.5}],
    )
    r = fundir(client, relleno["id"], guiso["id"])
    assert r.status_code == 409
    assert "sí misma" in r.json()["detail"]
    db.expire_all()
    # No se fundio nada.
    assert db.get(models.Ingrediente, relleno["id"]).activo is True
    assert lineas_de(db, guiso["id"]) == []
