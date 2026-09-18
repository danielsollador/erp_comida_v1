"""El libro de movimientos del inventario. Una fila por cada vez que algo entra o sale.

POR QUE EXISTE
--------------
Antes, `ingredientes.stock_actual` era un numero que cada operacion pisaba. Se
podia ver cuanto hay, nunca por que. Con el dueno preguntando "la carne bajo
3 kg hoy, desglosame eso" habia que abrir cuatro pantallas -mermas, sobrantes,
pedidos, compras- y aun asi el consumo del personal y las compras sueltas no
tenian listado propio. La respuesta honesta era "no se puede".

Ahora cada movimiento deja su fila, con el costo congelado al momento y el
saldo que quedo despues. `stock_actual` sigue existiendo -es el saldo vivo y
es lo que se lee mil veces al dia- pero ya no es la unica verdad: es la suma
de este libro, y si los dos no coinciden se puede demostrar.

Es el mismo patron de la contabilidad de este ERP: el hecho no se borra ni se
pisa, se anota. Y es lo que hace cualquier ERP serio (`stock.move` en Odoo, el
kardex en Profit).

QUE DESBLOQUEA
--------------
- "Que paso con la carne": los movimientos de un insumo, en orden.
- "Cuanto valia el inventario el 31 de agosto": existencia a una fecha, por
  insumo, sumando hasta ahi. Antes solo se podia reconstruir el total desde
  los asientos.
- "Cuanto consumo por dia": sale del libro, no de un minimo puesto a dedo.
- Separar la merma de verdad del ajuste por conteo, que hoy van al mismo saco.

LA REGLA
--------
Toda escritura de stock pasa por `anotar()`. Si aparece un
`ingrediente.stock_actual = ...` suelto en el codigo, es un bug: ese
movimiento no va a existir para nadie.
"""

from typing import List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import models
from .timeutils import ahora

# Que fue lo que paso. El signo va en la cantidad, no en el tipo: una merma
# revertida es una merma con cantidad positiva, y se lee igual de bien.
COMPRA = "compra"                    # entro por compra suelta o factura
VENTA = "venta"                      # salio por una comanda
MERMA = "merma"                      # se daño, se quemo, se boto
SOBRANTE = "sobrante"                # aparecio de mas en un conteo
AJUSTE = "ajuste"                    # conteo fisico: lo que dice la balanza
CONSUMO_PERSONAL = "consumo_personal"
DEVOLUCION_PROVEEDOR = "devolucion_proveedor"
REVERSO = "reverso"                  # se deshizo algo que se habia anotado mal

ETIQUETAS = {
    COMPRA: "Compra",
    VENTA: "Venta",
    MERMA: "Merma",
    SOBRANTE: "Sobrante de conteo",
    AJUSTE: "Ajuste por conteo",
    CONSUMO_PERSONAL: "Consumo del personal",
    DEVOLUCION_PROVEEDOR: "Devolucion a proveedor",
    REVERSO: "Reverso",
}


def anotar(
    db: Session,
    ingrediente: models.Ingrediente,
    cantidad: float,
    tipo: str,
    *,
    costo_unitario: Optional[float] = None,
    origen: str = "",
    referencia_id: Optional[int] = None,
    operador_id: Optional[int] = None,
    nota: str = "",
) -> models.MovimientoInventario:
    """Mueve el stock y deja el rastro. La UNICA via para tocar existencias.

    `cantidad` lleva signo: positiva entra, negativa sale. El costo se congela
    aca -el promedio del insumo cambia con cada compra, asi que preguntarlo
    manana daria otro numero y el libro dejaria de cuadrar con lo que se
    asento en su momento.

    No hace commit: quien llama decide la transaccion, porque casi siempre el
    movimiento va junto a un asiento contable y los dos tienen que entrar o no
    entrar juntos.
    """
    if cantidad == 0:
        raise ValueError("Un movimiento de inventario de cero no es un movimiento")

    costo = costo_unitario if costo_unitario is not None else (ingrediente.costo_unitario or 0)
    ingrediente.stock_actual = round((ingrediente.stock_actual or 0) + cantidad, 4)

    mov = models.MovimientoInventario(
        ingrediente_id=ingrediente.id,
        fecha=ahora(),
        tipo=tipo,
        cantidad=round(cantidad, 4),
        costo_unitario=round(costo, 4),
        valor=round(cantidad * costo, 2),
        # El promedio ya viene recalculado por `costeo.registrar_entrada` en
        # las entradas; en las salidas no cambia. En los dos casos, este es el
        # promedio con el que queda el insumo despues de este movimiento.
        costo_promedio=round(ingrediente.costo_unitario or 0, 4),
        saldo=ingrediente.stock_actual,
        origen=origen,
        referencia_id=referencia_id,
        operador_id=operador_id,
        nota=nota,
    )
    db.add(mov)
    return mov


def movimientos_de(db: Session, ingrediente_id: int, limite: int = 200) -> List[models.MovimientoInventario]:
    """El extracto de un insumo, del mas reciente al mas viejo."""
    return (
        db.query(models.MovimientoInventario)
        .filter(models.MovimientoInventario.ingrediente_id == ingrediente_id)
        .order_by(models.MovimientoInventario.fecha.desc(), models.MovimientoInventario.id.desc())
        .limit(limite)
        .all()
    )


def existencia_a(db: Session, ingrediente_id: int, fecha) -> float:
    """Cuanto habia de ese insumo en esa fecha.

    Suma hasta ahi en vez de leer el `saldo` del ultimo movimiento porque un
    movimiento cargado con fecha vieja (una factura de la semana pasada) haria
    mentir al saldo guardado.
    """
    total = (
        db.query(func.sum(models.MovimientoInventario.cantidad))
        .filter(
            models.MovimientoInventario.ingrediente_id == ingrediente_id,
            models.MovimientoInventario.fecha <= fecha,
        )
        .scalar()
    )
    return round(total or 0, 4)


def existencias_a(db: Session, fecha) -> dict:
    """Cuanto habia de CADA insumo en esa fecha, en una sola consulta.

    Antes esto se preguntaba insumo por insumo dentro de un bucle: con 120
    insumos eran 241 consultas y 302 ms para armar una tabla. La version de a
    uno (`existencia_a`) se queda para cuando de verdad se necesita uno solo.
    """
    filas = (
        db.query(
            models.MovimientoInventario.ingrediente_id,
            func.sum(models.MovimientoInventario.cantidad),
        )
        .filter(models.MovimientoInventario.fecha <= fecha)
        .group_by(models.MovimientoInventario.ingrediente_id)
        .all()
    )
    return {ing_id: round(total or 0, 4) for ing_id, total in filas}


def costos_promedio_a(db: Session, fecha) -> dict:
    """El promedio ponderado de cada insumo en esa fecha: el del ultimo
    movimiento hasta ahi. Es el criterio con el que se asienta la cuenta 1040,
    y por eso el inventario valorizado ata con el balance."""
    sub = (
        db.query(
            models.MovimientoInventario.ingrediente_id.label("ing"),
            func.max(models.MovimientoInventario.id).label("ultimo"),
        )
        .filter(models.MovimientoInventario.fecha <= fecha)
        .group_by(models.MovimientoInventario.ingrediente_id)
        .subquery()
    )
    filas = (
        db.query(models.MovimientoInventario.ingrediente_id,
                 models.MovimientoInventario.costo_promedio)
        .join(sub, models.MovimientoInventario.id == sub.c.ultimo)
        .all()
    )
    return {ing_id: costo for ing_id, costo in filas}


def consumo_por_dia_de_todos(db: Session, desde, hasta) -> dict:
    """Consumo diario de cada insumo, en una consulta. Ver `consumo_por_dia`."""
    dias = max((hasta - desde).days, 1)
    filas = (
        db.query(
            models.MovimientoInventario.ingrediente_id,
            func.sum(models.MovimientoInventario.cantidad),
        )
        .filter(
            models.MovimientoInventario.tipo.in_([VENTA, MERMA, CONSUMO_PERSONAL]),
            models.MovimientoInventario.fecha >= desde,
            models.MovimientoInventario.fecha <= hasta,
        )
        .group_by(models.MovimientoInventario.ingrediente_id)
        .all()
    )
    return {ing_id: round(abs(total or 0) / dias, 4) for ing_id, total in filas}


def consumo_por_dia(db: Session, ingrediente_id: int, desde, hasta) -> float:
    """Cuanto se consume al dia, medido: ventas mas mermas mas consumo del
    personal. No entra el ajuste por conteo -corregir el sistema no es gastar
    insumo- ni las compras.

    Es lo que deberia decidir cuanto pedir. El minimo a dedo se pone una vez y
    se queda viejo; el consumo real cambia solo.
    """
    dias = max((hasta - desde).days, 1)
    salidas = (
        db.query(func.sum(models.MovimientoInventario.cantidad))
        .filter(
            models.MovimientoInventario.ingrediente_id == ingrediente_id,
            models.MovimientoInventario.tipo.in_([VENTA, MERMA, CONSUMO_PERSONAL]),
            models.MovimientoInventario.fecha >= desde,
            models.MovimientoInventario.fecha <= hasta,
        )
        .scalar()
    ) or 0
    return round(abs(salidas) / dias, 4)
