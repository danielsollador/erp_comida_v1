"""Alertas que se explican (21-oct).

Tres cosas que cuestan plata y que nadie va a buscar a una tabla: una merma
muy por encima de lo normal, un insumo que el proveedor subió de golpe, y una
referencia bancaria usada en dos ventas. Cada alerta dice QUÉ pasó, POR QUÉ el
sistema lo marca (con los números que lo prueban) y QUÉ HACER.

Reglas fijas, a propósito y sin IA: son números contra números, y una alerta
que se equivoca una vez deja de leerse. La explicación se arma con los datos
de cada caso, así que no hace falta que nadie la redacte.

Las tres van a la portada por `reportes.avisos`, con el mismo tope de cuatro.
"""

import datetime
import statistics
from typing import Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import models, schemas
from .timeutils import ahora

# Una merma es rara si es varias veces la de siempre de ese mismo insumo.
VECES_MERMA_RARA = 3.0
# Con menos historia que esto no hay "lo de siempre" contra qué comparar.
MUESTRAS_MINIMAS = 3
# Por debajo de esto no vale la pena distraer al dueño.
MERMA_MINIMA_USD = 5.0
# Un precio que sube menos que esto es la inflación de todas las semanas.
SUBIDA_QUE_IMPORTA = 0.15
DIAS_RECIENTES = 7


def _usd(monto: float) -> str:
    return f"${monto:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _num(cantidad: float) -> str:
    return f"{cantidad:,.3f}".rstrip("0").rstrip(".").replace(",", "X").replace(".", ",").replace("X", ".")


def _dia(fecha: datetime.datetime) -> str:
    dias = (ahora().date() - fecha.date()).days
    if dias == 0:
        return "hoy"
    if dias == 1:
        return "ayer"
    return f"el {fecha.day}/{fecha.month}"


def _lista(nombres: List[str], tope: int = 3) -> str:
    nombres = list(dict.fromkeys(n for n in nombres if n))
    if len(nombres) > tope:
        return ", ".join(nombres[:tope]) + f" y {len(nombres) - tope} más"
    if len(nombres) > 1:
        return ", ".join(nombres[:-1]) + " y " + nombres[-1]
    return "".join(nombres)


def merma_rara(db: Session) -> Optional[schemas.Aviso]:
    """La merma de la semana que más se sale de lo normal para su insumo."""
    desde = ahora() - datetime.timedelta(days=DIAS_RECIENTES)
    historia_desde = desde - datetime.timedelta(days=90)
    vivas = (models.Merma.revertida.is_(False), models.Merma.por_conteo.is_(False))
    recientes = db.query(models.Merma).filter(models.Merma.fecha >= desde, *vivas).all()
    if not recientes:
        return None
    anteriores: Dict[int, List[float]] = {}
    for m in db.query(models.Merma).filter(
        models.Merma.fecha >= historia_desde, models.Merma.fecha < desde, *vivas
    ).all():
        anteriores.setdefault(m.ingrediente_id, []).append(m.cantidad)

    peor = None
    for m in recientes:
        ing = m.ingrediente
        valor = m.cantidad * (ing.costo_unitario or 0)
        historia = anteriores.get(m.ingrediente_id, [])
        if valor < MERMA_MINIMA_USD or len(historia) < MUESTRAS_MINIMAS:
            continue
        normal = statistics.median(historia)
        if normal <= 0 or m.cantidad < VECES_MERMA_RARA * normal:
            continue
        veces = m.cantidad / normal
        if peor is None or valor > peor[1]:
            peor = (m, valor, normal, veces, len(historia))
    if peor is None:
        return None

    m, valor, normal, veces, muestras = peor
    ing = m.ingrediente
    quien = m.operador.nombre if m.operador else ""
    motivo = f": «{m.motivo.strip()}»" if (m.motivo or "").strip() else ", sin motivo"
    return schemas.Aviso(
        id=f"merma-rara-{m.id}",
        tono="ojo",
        titulo=f"Se botó {_num(veces)} veces lo normal de {ing.nombre}",
        detalle=f"{_num(m.cantidad)} {ing.unidad} ({_usd(valor)}) {_dia(m.fecha)}.",
        por_que=(
            f"{_dia(m.fecha).capitalize()} {'la cargó ' + quien if quien else 'se cargó'} como merma{motivo}. "
            f"Las últimas {muestras} mermas de {ing.nombre} fueron de unos {_num(normal)} {ing.unidad}."
        ),
        que_hacer=(
            f"Pregúntale{' a ' + quien if quien else ''} qué pasó. Si fue un error de carga (gramos por kilos, "
            "un cero de más), se revierte en Inventario › Control con «Revertir» y queda el rastro."
        ),
        a="/inventario/control",
    )


def precio_que_sube(db: Session) -> Optional[schemas.Aviso]:
    """El insumo cuya última factura vino más cara que las anteriores."""
    desde = ahora() - datetime.timedelta(days=90)
    filas = (
        db.query(models.FacturaCompraItem, models.FacturaCompra)
        .join(models.FacturaCompra, models.FacturaCompra.id == models.FacturaCompraItem.factura_id)
        .filter(models.FacturaCompra.fecha >= desde)
        .order_by(models.FacturaCompra.fecha)
        .all()
    )
    por_insumo: Dict[int, list] = {}
    for item, factura in filas:
        if item.costo_unitario and item.costo_unitario > 0:
            por_insumo.setdefault(item.ingrediente_id, []).append((item, factura))

    reciente = ahora() - datetime.timedelta(days=DIAS_RECIENTES)
    peor = None
    for ing_id, compras in por_insumo.items():
        ultima, factura = compras[-1]
        antes = [i.costo_unitario for i, _ in compras[:-1]]
        if factura.fecha < reciente or len(antes) < 2:
            continue
        normal = statistics.median(antes)
        subida = ultima.costo_unitario / normal - 1
        if subida < SUBIDA_QUE_IMPORTA:
            continue
        # Lo que pesa es la plata de más, no el porcentaje: 40 % del perejil
        # importa menos que 15 % de la carne.
        de_mas = (ultima.costo_unitario - normal) * (ultima.cantidad or 0)
        if peor is None or de_mas > peor[3]:
            peor = (ultima, factura, normal, de_mas, subida, len(antes))
    if peor is None:
        return None

    item, factura, normal, de_mas, subida, muestras = peor
    ing = db.get(models.Ingrediente, item.ingrediente_id)
    productos = [
        v.producto.nombre
        for v in (
            db.query(models.Variante)
            .join(models.RecetaItem, models.RecetaItem.variante_id == models.Variante.id)
            .filter(models.RecetaItem.ingrediente_id == ing.id)
            .all()
        )
        if v.producto
    ]
    usa = f" Va en {_lista(productos)}." if productos else ""
    return schemas.Aviso(
        id=f"precio-sube-{ing.id}-{factura.id}",
        tono="ojo",
        titulo=f"{ing.nombre} subió {subida * 100:.0f} % con {factura.proveedor_nombre}",
        detalle=f"De {_usd(normal)} a {_usd(item.costo_unitario)} por {ing.unidad}.",
        por_que=(
            f"La factura {factura.numero_factura} ({_dia(factura.fecha)}) la trajo a {_usd(item.costo_unitario)} "
            f"por {ing.unidad}; las {muestras} compras anteriores rondaban {_usd(normal)}. "
            f"En esa factura son {_usd(de_mas)} de más.{usa}"
        ),
        que_hacer=(
            "Si el precio se queda, revisa el margen de esos productos en Menú › Recetas. "
            "Si parece un error de carga (una caja leída como unidad), revisa la factura en Compras."
        ),
        a="/menu/recetas",
    )


def _referencia_util(ref: str) -> bool:
    """Una referencia que de verdad identifica un pago: "0", "123" o "0000"
    son lo que se escribe para salir del paso, y repetidas no dicen nada."""
    ref = ref.strip()
    return len(ref) >= 4 and len(set(ref)) > 1


def cobro_repetido(db: Session) -> Optional[schemas.Aviso]:
    """Una misma referencia bancaria en dos ventas distintas."""
    desde = ahora() - datetime.timedelta(days=DIAS_RECIENTES)
    filas = (
        db.query(models.PagoPedido, models.Pedido)
        .join(models.Pedido, models.Pedido.id == models.PagoPedido.pedido_id)
        .filter(
            models.Pedido.cerrado_en >= desde,
            models.Pedido.devuelto.is_(False),
            func.coalesce(models.PagoPedido.referencia, "") != "",
            ~models.PagoPedido.metodo.like("Efectivo%"),
        )
        .all()
    )
    grupos: Dict[tuple, list] = {}
    for pago, pedido in filas:
        ref = pago.referencia.strip()
        if _referencia_util(ref):
            grupos.setdefault((pago.metodo, ref.lower()), []).append((pago, pedido))
    repetidas = [g for g in grupos.values() if len({p.id for _, p in g}) > 1]
    if not repetidas:
        return None

    repetidas.sort(key=lambda g: -sum(pago.monto for pago, _ in g))
    grupo = repetidas[0]
    pago = grupo[0][0]
    pedidos = sorted({p.numero for _, p in grupo})
    numeros = _lista([f"#{n}" for n in pedidos], tope=4)
    otras = len(repetidas) - 1
    return schemas.Aviso(
        id=f"ref-repetida-{pago.metodo}-{pago.referencia.strip().lower()}",
        tono="ojo",
        titulo=f"La misma referencia de {pago.metodo} en {len(pedidos)} ventas",
        detalle=f"Ref. {pago.referencia.strip()}: pedidos {numeros}." + (f" Y {otras} referencia(s) más." if otras else ""),
        por_que=(
            "Cada pago del banco tiene su propia referencia. Si la misma aparece en dos ventas, "
            "o se anotó mal en una, o el cliente mostró el mismo comprobante dos veces y una venta quedó sin cobrar."
        ),
        que_hacer=(
            f"Busca la referencia {pago.referencia.strip()} en el banco. Si entró una sola vez, abre la otra venta "
            "en Ventas y corrige el cobro con «Editar pago»."
        ),
        a="/ventas",
    )


def todas(db: Session) -> List[schemas.Aviso]:
    return [a for a in (cobro_repetido(db), merma_rara(db), precio_que_sube(db)) if a]
