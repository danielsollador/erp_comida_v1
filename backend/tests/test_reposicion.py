"""Caso 21: un insumo sube 300% de golpe.

El promedio ponderado es correcto para la contabilidad y enganoso para poner
precios: mezcla lo que compraste barato con lo que acabas de pagar caro. Estos
tests fijan la separacion entre las dos preguntas.
"""

import datetime

from app import models, reposicion


def _factura(db, ingrediente, cantidad, costo, dias_atras=0, numero="F-1"):
    factura = models.FacturaCompra(
        numero_factura=numero,
        proveedor_nombre="Proveedor",
        fecha=datetime.datetime.now() - datetime.timedelta(days=dias_atras),
        categoria="Insumos",
        forma_pago="Efectivo",
        base_imponible=round(cantidad * costo, 2),
        iva=0,
    )
    db.add(factura)
    db.flush()
    db.add(
        models.FacturaCompraItem(
            factura_id=factura.id,
            ingrediente_id=ingrediente.id,
            cantidad=cantidad,
            costo_unitario=costo,
        )
    )
    db.commit()
    return factura


def test_el_costo_de_reposicion_es_el_ultimo_pagado_no_el_promedio(db, insumo):
    """El bug medido: con 14 kg a $7 y 2 kg a $28, el promedio daba $9.75 y el
    menu mostraba 67% de margen cuando el real era 12%."""
    _factura(db, insumo, cantidad=14, costo=7.0, dias_atras=10, numero="F-VIEJA")
    _factura(db, insumo, cantidad=2, costo=28.0, dias_atras=0, numero="F-NUEVA")

    ultimos = reposicion.costos_reposicion(db)
    assert ultimos[insumo.id]["costo"] == 28.0


def test_la_compra_suelta_tambien_cuenta_para_la_reposicion(db, insumo):
    """El mandado del dia es una compra igual que una factura."""
    _factura(db, insumo, cantidad=10, costo=7.0, dias_atras=5)
    db.add(
        models.CompraSuelta(ingrediente_id=insumo.id, cantidad=1, costo_unitario=30.0)
    )
    db.commit()

    assert reposicion.costos_reposicion(db)[insumo.id]["costo"] == 30.0


def test_el_historial_mezcla_facturas_y_compras_sueltas_en_orden(db, insumo):
    _factura(db, insumo, cantidad=5, costo=6.0, dias_atras=20, numero="F-1")
    _factura(db, insumo, cantidad=5, costo=7.0, dias_atras=10, numero="F-2")
    db.add(models.CompraSuelta(ingrediente_id=insumo.id, cantidad=1, costo_unitario=9.0))
    db.commit()

    historial = reposicion.historial_de_costos(db, insumo.id)
    assert [c["costo_unitario"] for c in historial] == [9.0, 7.0, 6.0]
    assert historial[0]["origen"] == "compra suelta"
    assert historial[1]["referencia"] == "F-2"


def test_el_costo_de_reposicion_corrige_por_rendimiento(db, insumo):
    """Un insumo que rinde 80% cuesta mas por unidad utilizable. La correccion
    tiene que ser la misma que usa el costeo contable, o los dos margenes no
    serian comparables."""
    assert insumo.rendimiento_pct == 80
    assert reposicion.costo_efectivo_de(8.0, 80) == 10.0


def test_el_menu_muestra_los_dos_margenes(client, db, insumo, variante):
    """El contable (con el inventario barato) y el de reponer hoy."""
    _factura(db, insumo, cantidad=20, costo=8.0, dias_atras=10, numero="F-VIEJA")
    insumo.costo_unitario = 8.0
    db.commit()

    costos = {c["variante_id"]: c for c in client.get("/api/menu/costos").json()}
    fila = costos[variante.id]
    # 0.1 kg utilizables con 80% de rendimiento y $8/kg -> $1.00 por unidad
    assert fila["costo"] == 1.0
    assert fila["costo_reposicion"] == 1.0
    assert fila["margen_pct"] == fila["margen_reposicion_pct"]

    # ahora el proveedor cuadruplica
    _factura(db, insumo, cantidad=2, costo=32.0, dias_atras=0, numero="F-CARA")

    costos = {c["variante_id"]: c for c in client.get("/api/menu/costos").json()}
    fila = costos[variante.id]
    assert fila["costo"] == 1.0, "el costo contable no se mueve solo"
    assert fila["costo_reposicion"] == 4.0, "reponer cuesta 4x"
    assert fila["margen_pct"] == 80.0  # $5 de precio, $1 de costo promedio
    assert fila["margen_reposicion_pct"] == 20.0  # $5 de precio, $4 de reponer


def test_el_precio_sugerido_conserva_el_margen_que_ya_tenia(client, db, insumo, variante):
    """No un margen inventado por el sistema: el que el dueno ya decidio."""
    insumo.costo_unitario = 8.0
    db.commit()
    _factura(db, insumo, cantidad=2, costo=32.0, numero="F-CARA")

    fila = {c["variante_id"]: c for c in client.get("/api/menu/costos").json()}[variante.id]
    # margen actual 80%, costo de reponer $4 -> 4 / (1 - 0.8) = $20
    assert fila["precio_sugerido"] == 20.0


def test_comprar_caro_avisa_en_el_momento(client, db, insumo, variante):
    """El promedio tarda semanas en reflejar la subida; para entonces ya
    vendiste con el margen viejo en pantalla."""
    respuesta = client.post(
        f"/api/inventario/ingredientes/{insumo.id}/comprar",
        json={"cantidad": 2, "costo_total": 64.0},  # $32/kg contra $8 que tenia
    ).json()

    assert respuesta["revisar_precios"] is True
    assert respuesta["salto_pct"] == 300.0
    assert respuesta["costo_anterior"] == 8.0
    assert respuesta["costo_pagado"] == 32.0

    afectado = next(p for p in respuesta["productos"] if p["variante_id"] == variante.id)
    assert afectado["margen_antes_pct"] == 80.0
    assert afectado["margen_despues_pct"] == 20.0

    # El sugerido sale de la MISMA cuenta que el del menu. Antes eran dos
    # formulas distintas y el aviso decia $5.12 donde el menu decia $3.96.
    del_menu = {c["variante_id"]: c for c in client.get("/api/menu/costos").json()}
    assert afectado["precio_sugerido"] == del_menu[variante.id]["precio_sugerido"]


def test_una_compra_al_mismo_precio_no_molesta(client, insumo):
    """Avisar por cada compra normal entrenaria al dueno a ignorar el aviso."""
    respuesta = client.post(
        f"/api/inventario/ingredientes/{insumo.id}/comprar",
        json={"cantidad": 2, "costo_total": 16.0},  # el mismo $8/kg de siempre
    ).json()

    assert respuesta["revisar_precios"] is False
    assert respuesta["productos"] == []


def test_el_producto_a_perdida_se_marca_como_tal(client, db, insumo, variante):
    variante.precio = 2.0  # menos de lo que costara producirlo
    db.commit()

    respuesta = client.post(
        f"/api/inventario/ingredientes/{insumo.id}/comprar",
        json={"cantidad": 1, "costo_total": 40.0},  # $40/kg -> $5 por unidad
    ).json()

    afectado = next(p for p in respuesta["productos"] if p["variante_id"] == variante.id)
    assert afectado["a_perdida"] is True
    assert afectado["margen_despues_pct"] < 0


def test_el_insumo_aparece_con_su_costo_de_reposicion(client, db, insumo):
    _factura(db, insumo, cantidad=2, costo=24.0)

    fila = next(
        i for i in client.get("/api/inventario/ingredientes").json() if i["id"] == insumo.id
    )
    assert fila["costo_unitario"] == 8.0  # promedio, sin tocar
    assert fila["costo_reposicion"] == 24.0
    assert fila["variacion_pct"] == 200.0
    assert fila["ultima_compra"] is not None


def test_el_insumo_nunca_comprado_no_inventa_un_costo_de_reposicion(client, insumo):
    fila = next(
        i for i in client.get("/api/inventario/ingredientes").json() if i["id"] == insumo.id
    )
    assert fila["costo_reposicion"] is None
    assert fila["variacion_pct"] is None


def test_la_inflacion_de_insumos_se_mide_sobre_compras_reales(db, insumo):
    _factura(db, insumo, cantidad=5, costo=5.0, dias_atras=25, numero="F-1")
    _factura(db, insumo, cantidad=5, costo=10.0, dias_atras=1, numero="F-2")

    inflacion = reposicion.inflacion_de_insumos(db, dias=30)
    assert inflacion is not None
    assert inflacion["insumos"][0]["cambio_pct"] == 100.0
    assert inflacion["cambio_pct"] == 100.0


def test_sin_dos_compras_no_se_inventa_una_inflacion(db, insumo):
    _factura(db, insumo, cantidad=5, costo=5.0, dias_atras=1)
    assert reposicion.inflacion_de_insumos(db, dias=30) is None


def test_el_reporte_avisa_cuando_el_margen_se_desploma_al_reponer(client, db, insumo, variante):
    """El acantilado: aguanta con el stock viejo y no con el precio nuevo."""
    insumo.costo_unitario = 8.0
    db.commit()
    _factura(db, insumo, cantidad=2, costo=36.0, numero="F-CARA")

    insights = client.get("/api/reportes/resumen?periodo=dia").json()["insights"]
    titulos = " ".join(i["titulo"] for i in insights)
    assert "dejan de ser rentables" in titulos


def test_sin_subida_no_hay_aviso_de_reposicion(client, db, insumo, variante):
    insumo.costo_unitario = 8.0
    db.commit()
    _factura(db, insumo, cantidad=2, costo=8.0, numero="F-IGUAL")

    insights = client.get("/api/reportes/resumen?periodo=dia").json()["insights"]
    titulos = " ".join(i["titulo"] for i in insights)
    assert "dejan de ser rentables" not in titulos
    assert "subieron" not in titulos
