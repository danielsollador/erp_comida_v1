"""Que se vende junto: analisis de canasta y sugerencia de acompanantes.

La idea es la de cualquier mostrador de comida rapida - "y con papas?" - pero
sin adivinar: el sistema mira los pedidos reales del local y calcula que
productos aparecen juntos, con que frecuencia y cuanto se deja de vender
cuando el cliente se va sin bebida.

Dos usos, un solo motor:
- Reporte: pares mas frecuentes y tasa de acompanamiento del periodo.
- Caja: mientras se arma la comanda, que ofrecer y a que precio.
"""

import datetime
from typing import Dict, List, Set, Tuple

from sqlalchemy.orm import Session

from . import models

# Debajo de esto los porcentajes son ruido, no senal: dos pedidos que
# coincidieron no son un patron de consumo.
MIN_PEDIDOS = 15
# Un par que solo paso una o dos veces tampoco dice nada.
MIN_JUNTOS = 3


def _categoria_es_bebida(nombre: str) -> bool:
    return "bebida" in (nombre or "").lower()


def _mapa_variantes(db: Session) -> Dict[int, dict]:
    """variante_id -> datos del producto al que pertenece.

    Se resuelve en una sola consulta con joins: recorrer las relaciones item por
    item dispara una consulta por linea de pedido (N+1) y el reporte del mes se
    vuelve lento con nada de datos.
    """
    filas = (
        db.query(
            models.Variante.id,
            models.Variante.nombre,
            models.Variante.precio,
            models.Variante.activo,
            models.Producto.id,
            models.Producto.nombre,
            models.Categoria.id,
            models.Categoria.nombre,
        )
        .join(models.Producto, models.Variante.producto_id == models.Producto.id)
        .join(models.Categoria, models.Producto.categoria_id == models.Categoria.id)
        .all()
    )

    mapa = {}
    for v_id, v_nom, precio, activo, p_id, p_nom, c_id, c_nom in filas:
        mapa[v_id] = {
            "variante_id": v_id,
            "variante": v_nom,
            "precio": precio,
            "activo": activo,
            "producto_id": p_id,
            "producto": p_nom,
            "categoria_id": c_id,
            "categoria": c_nom,
            "es_bebida": _categoria_es_bebida(c_nom),
        }
    return mapa


def _canastas(pedidos, mapa) -> List[Set[int]]:
    """Cada pedido, reducido al conjunto de productos que lo componen.

    Se trabaja a nivel de producto y no de variante: "Empanada de carne" y
    "Empanada de queso" son la misma decision de compra para este analisis, y
    separarlas fragmenta los conteos hasta que ningun par pasa el minimo.
    """
    canastas = []
    for pedido in pedidos:
        productos = {
            mapa[i.variante_id]["producto_id"]
            for i in pedido.items
            if i.variante_id in mapa
        }
        if productos:
            canastas.append(productos)
    return canastas


def analizar(db: Session, pedidos) -> dict:
    """Pares frecuentes y tasa de acompanamiento de un conjunto de pedidos."""
    mapa = _mapa_variantes(db)
    canastas = _canastas(pedidos, mapa)
    total = len(canastas)

    nombre_producto = {d["producto_id"]: d["producto"] for d in mapa.values()}
    bebidas = {d["producto_id"] for d in mapa.values() if d["es_bebida"]}

    if total < MIN_PEDIDOS:
        return {
            "pedidos_analizados": total,
            "suficientes_datos": False,
            "pares": [],
            "acompanamiento": None,
            "oportunidad": None,
        }

    soporte: Dict[int, int] = {}
    juntos: Dict[Tuple[int, int], int] = {}
    for canasta in canastas:
        ordenados = sorted(canasta)
        for i, a in enumerate(ordenados):
            soporte[a] = soporte.get(a, 0) + 1
            for b in ordenados[i + 1 :]:
                juntos[(a, b)] = juntos.get((a, b), 0) + 1

    pares = []
    for (a, b), veces in juntos.items():
        if veces < MIN_JUNTOS:
            continue
        # Confianza: de los pedidos que llevaron A, cuantos llevaron tambien B.
        # Se reporta la direccion mas fuerte, que es la accionable en caja.
        conf_ab = veces / soporte[a]
        conf_ba = veces / soporte[b]
        if conf_ab >= conf_ba:
            origen, destino, confianza = a, b, conf_ab
        else:
            origen, destino, confianza = b, a, conf_ba
        # Lift > 1: se compran juntos mas de lo que explicaria el azar.
        esperado = soporte[destino] / total
        lift = confianza / esperado if esperado else 0

        pares.append(
            {
                "producto": nombre_producto.get(origen, "?"),
                "acompanante": nombre_producto.get(destino, "?"),
                "juntos": veces,
                "confianza_pct": round(confianza * 100, 1),
                "lift": round(lift, 2),
            }
        )
    pares.sort(key=lambda p: (p["juntos"], p["confianza_pct"]), reverse=True)

    # --- Tasa de acompanamiento: cuantos pedidos salieron sin bebida ---
    acompanamiento = None
    oportunidad = None
    if bebidas:
        con_bebida = sum(1 for c in canastas if c & bebidas)
        sin_bebida = total - con_bebida
        acompanamiento = {
            "con_bebida": con_bebida,
            "sin_bebida": sin_bebida,
            "con_bebida_pct": round(con_bebida / total * 100, 1),
            "sin_bebida_pct": round(sin_bebida / total * 100, 1),
        }

        # Cuanto deja hoy una bebida promedio, con datos reales del periodo.
        precios, ganancias = [], []
        for pedido in pedidos:
            for item in pedido.items:
                d = mapa.get(item.variante_id)
                if d and d["es_bebida"]:
                    precios.append(item.precio_unitario)
                    ganancias.append(item.precio_unitario - (item.costo_unitario or 0))
        if precios and sin_bebida:
            ticket_bebida = sum(precios) / len(precios)
            margen_bebida = sum(ganancias) / len(ganancias)
            # Un tercio de conversion es lo que suele lograr un upsell hecho en
            # el mostrador. Se muestra ese escenario y no el techo teorico, que
            # seria vender una bebida en el 100% de los pedidos.
            convertibles = sin_bebida / 3
            oportunidad = {
                "pedidos_sin_bebida": sin_bebida,
                "ticket_bebida": round(ticket_bebida, 2),
                "venta_potencial": round(convertibles * ticket_bebida, 2),
                "ganancia_potencial": round(convertibles * margen_bebida, 2),
                "conversion_supuesta_pct": 33,
            }

    return {
        "pedidos_analizados": total,
        "suficientes_datos": True,
        "pares": pares[:10],
        "acompanamiento": acompanamiento,
        "oportunidad": oportunidad,
    }


def sugerir(db: Session, variante_ids: List[int], limite: int = 3) -> List[dict]:
    """Que ofrecer para completar la comanda que se esta armando ahora.

    Primero intenta el patron real del local (lo que suele acompanar a lo que
    ya esta en el carrito). Si todavia no hay historial suficiente, cae en las
    bebidas mas vendidas: siempre hay algo que ofrecer, nunca un hueco.
    """
    mapa = _mapa_variantes(db)
    en_carrito = {
        mapa[v]["producto_id"] for v in variante_ids if v in mapa
    }

    # Solo pedidos ya cobrados de los ultimos 90 dias: los gustos cambian y un
    # patron de hace un ano no ayuda a vender hoy.
    desde = datetime.datetime.now() - datetime.timedelta(days=90)
    pedidos = (
        db.query(models.Pedido)
        .filter(models.Pedido.estado == "pagado", models.Pedido.cerrado_en >= desde)
        .all()
    )
    canastas = _canastas(pedidos, mapa)

    puntaje: Dict[int, float] = {}
    if len(canastas) >= MIN_PEDIDOS and en_carrito:
        for objetivo in en_carrito:
            con_objetivo = [c for c in canastas if objetivo in c]
            if len(con_objetivo) < MIN_JUNTOS:
                continue
            for canasta in con_objetivo:
                for otro in canasta - en_carrito:
                    puntaje[otro] = puntaje.get(otro, 0) + 1 / len(con_objetivo)

    if not puntaje:
        # Respaldo: bebidas mas vendidas que no esten ya en el carrito.
        for canasta in canastas:
            for producto_id in canasta - en_carrito:
                es_bebida = any(
                    d["es_bebida"]
                    for d in mapa.values()
                    if d["producto_id"] == producto_id
                )
                if es_bebida:
                    puntaje[producto_id] = puntaje.get(producto_id, 0) + 0.001

    # Se ofrece la variante activa mas barata: el "si" del cliente es mas facil
    # con el precio de entrada, y siempre puede escalar a la grande.
    por_producto: Dict[int, dict] = {}
    for d in mapa.values():
        if not d["activo"]:
            continue
        actual = por_producto.get(d["producto_id"])
        if actual is None or d["precio"] < actual["precio"]:
            por_producto[d["producto_id"]] = d

    sugerencias = []
    for producto_id, _ in sorted(puntaje.items(), key=lambda kv: kv[1], reverse=True):
        d = por_producto.get(producto_id)
        if not d:
            continue
        etiqueta = (
            d["producto"] if d["variante"] == "Regular" else f"{d['producto']} - {d['variante']}"
        )
        sugerencias.append(
            {
                "variante_id": d["variante_id"],
                "etiqueta": etiqueta,
                "precio": round(d["precio"], 2),
                "es_bebida": d["es_bebida"],
            }
        )
        if len(sugerencias) >= limite:
            break

    return sugerencias
