"""El modulo de Ventas: cada venta, que paso con ella, y los numeros del periodo.

POR QUE EXISTE APARTE DE REPORTES. Reportes opina: ganancia, margen, que se
vende junto, avisos. Aqui no se opina, se muestra: la lista de TODAS las
ventas del periodo --cobradas, fiadas, devueltas, anuladas, abiertas-- con
quien la cobro y como, y encima las cifras que un dueño pregunta primero:
cuanto vendi, cuanto vendo al dia, y cuanta plata se me esta yendo. Leider
(16-sep): "falta el modulo de ventas, en donde hay un historial con todas las
ventas, que paso con ellas, y KPIs relevantes, media de ventas al dia, cuanto
dinero se esta mermando, donde haya un filtro de fecha obvio".

LA FECHA DE UNA VENTA es la del cobro (`cerrado_en`); la de una anulada o una
abierta, la de la comanda (`creado_en`), que es la unica que tiene. Una venta
devuelta sigue en el dia en que se vendio, marcada como devuelta: quien busca
"la venta del martes" la encuentra el martes.
"""
import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from .. import models, schemas
from ..database import get_db
from ..rango import Rango, anterior, dias_transcurridos, granularidad, serie
from .reportes import _mediana, merma_periodo

router = APIRouter(prefix="/api/ventas", tags=["ventas"])

# Mas filas que esto no se leen: se acorta el rango.
TOPE_FILAS = 3000


def _fecha_venta():
    """La columna por la que se filtra y se ordena: el cobro, o la comanda."""
    return func.coalesce(models.Pedido.cerrado_en, models.Pedido.creado_en)


def _pedidos_del_rango(db: Session, inicio: datetime.datetime, fin: datetime.datetime):
    f = _fecha_venta()
    return (
        db.query(models.Pedido)
        .options(
            joinedload(models.Pedido.items),
            joinedload(models.Pedido.pagos),
            joinedload(models.Pedido.operador_rel),
            joinedload(models.Pedido.anulado_por_rel),
            joinedload(models.Pedido.punto_venta_rel),
        )
        .filter(f >= inicio, f < fin)
        .order_by(f.desc(), models.Pedido.id.desc())
        .all()
    )


def _es_fiado(p: models.Pedido) -> bool:
    return any(pg.metodo == "Fiado" for pg in p.pagos)


def estado_de(p: models.Pedido) -> str:
    """Que paso con la venta, en una palabra. Es lo que se filtra en pantalla.

    anulada   no llego a venderse (se anulo antes o despues de cobrar)
    devuelta  se cobro y el cliente trajo la comida de vuelta
    fiada     se entrego y todavia se debe
    cobrada   se cobro, incluido el fiado que ya se saldo
    abierta   la comanda sigue en cocina o lista sin cobrar
    """
    if p.estado == "anulado":
        return "anulada"
    if p.devuelto:
        return "devuelta"
    if p.estado == "pagado":
        return "fiada" if _es_fiado(p) and not p.fiado_saldado else "cobrada"
    return "abierta"


def _detalle(p: models.Pedido) -> str:
    """"2× Empanada, 1× Jugo": lo que se vendio, de un vistazo."""
    return ", ".join(f"{i.cantidad}× {i.nombre}" for i in p.items)


def _metodos(p: models.Pedido) -> str:
    """Como se pago. Con pago mixto, las dos formas: "Efectivo $ + Pago movil"."""
    vistos: List[str] = []
    for pg in p.pagos:
        if pg.metodo not in vistos:
            vistos.append(pg.metodo)
    return " + ".join(vistos) if vistos else (p.metodo_pago or "")


def _fila(p: models.Pedido) -> schemas.VentaFila:
    fecha = p.cerrado_en or p.creado_en
    total = p.total
    fiado_pendiente = 0.0
    if _es_fiado(p) and not p.fiado_saldado and not p.devuelto and p.estado == "pagado":
        fiado_pendiente = round(sum(pg.monto for pg in p.pagos if pg.metodo == "Fiado"), 2)
    return schemas.VentaFila(
        id=p.id,
        numero=p.numero,
        fecha=fecha,
        estado=estado_de(p),
        cliente=p.cliente or "",
        detalle=_detalle(p),
        unidades=sum(i.cantidad for i in p.items),
        subtotal=p.subtotal,
        descuento=round(p.descuento or 0, 2),
        total=total,
        propina=round(p.propina or 0, 2),
        total_bs=round(total * (p.tasa_bcv or 0), 2) if p.tasa_bcv else None,
        tasa_bcv=p.tasa_bcv,
        pago=_metodos(p),
        fiado_pendiente=fiado_pendiente,
        fiado_saldado=bool(p.fiado_saldado),
        facturado=bool(p.facturado),
        numero_factura=p.numero_factura,
        operador=p.operador,
        punto_venta=p.punto_venta,
        anulado_por=p.anulado_por,
        anulado_es_perdida=p.anulado_es_perdida,
        motivo_devolucion=p.motivo_devolucion or "",
        nota_credito=p.nota_credito,
        nota=p.nota or "",
        items=[schemas.PedidoItem.model_validate(i) for i in p.items],
    )


@router.get("", response_model=schemas.ListaVentas)
def listar(
    estado: Optional[str] = None,
    rango: Rango = Depends(),
    db: Session = Depends(get_db),
):
    """Todas las ventas del periodo, la mas reciente primero.

    `estado` filtra por lo que paso con ella (ver `estado_de`); sin el, todas.
    """
    inicio, fin, etiqueta = rango.resolver(periodo="mes")
    pedidos = _pedidos_del_rango(db, inicio, fin)
    filas = [_fila(p) for p in pedidos]
    if estado:
        filas = [f for f in filas if f.estado == estado]
    total = len(filas)
    return schemas.ListaVentas(
        etiqueta=etiqueta,
        total=total,
        recortado=total > TOPE_FILAS,
        filas=filas[:TOPE_FILAS],
    )


def _agrupar(pedidos, clave) -> List[schemas.GrupoVentas]:
    grupos: Dict[str, Dict[str, float]] = {}
    for p in pedidos:
        k = clave(p) or "Sin asignar"
        g = grupos.setdefault(k, {"ventas": 0.0, "pedidos": 0})
        g["ventas"] += p.total
        g["pedidos"] += 1
    salida = [
        schemas.GrupoVentas(nombre=k, ventas=round(v["ventas"], 2), pedidos=int(v["pedidos"]))
        for k, v in grupos.items()
    ]
    salida.sort(key=lambda g: g.ventas, reverse=True)
    return salida


@router.get("/resumen", response_model=schemas.ResumenVentas)
def resumen(rango: Rango = Depends(), db: Session = Depends(get_db)):
    inicio, fin, etiqueta = rango.resolver(periodo="mes")
    todos = _pedidos_del_rango(db, inicio, fin)

    # Venta efectiva: cobrada o fiada (la comida salio y hay una deuda a
    # favor). Las devueltas y anuladas van aparte, en lo que se pierde.
    vendidos = [p for p in todos if p.estado == "pagado" and not p.devuelto]
    anulados = [p for p in todos if p.estado == "anulado"]
    # Devoluciones por la fecha en que se DEVOLVIERON, igual que en Reportes:
    # la plata salio de la caja ese dia, no el dia de la venta.
    devueltos = (
        db.query(models.Pedido)
        .filter(
            models.Pedido.devuelto.is_(True),
            models.Pedido.fecha_devolucion >= inicio,
            models.Pedido.fecha_devolucion < fin,
        )
        .all()
    )

    ventas = round(sum(p.total for p in vendidos), 2)
    dias = dias_transcurridos(inicio, fin)

    # El periodo anterior, del mismo tamaño, para decir si esto es mas o menos
    # que antes. Siempre incompleto el actual si incluye hoy; se aclara en
    # pantalla, no se corrige el numero.
    a_ini, a_fin = anterior(inicio, fin)
    prev = [p for p in _pedidos_del_rango(db, a_ini, a_fin) if p.estado == "pagado" and not p.devuelto]
    ventas_prev = round(sum(p.total for p in prev), 2)
    dias_prev = max(1, (a_fin - a_ini).days)

    con_descuento = [p for p in vendidos if (p.descuento or 0) > 0]
    fiado_pendiente = [
        p for p in vendidos if _es_fiado(p) and not p.fiado_saldado
    ]
    valor_fiado = round(
        sum(pg.monto for p in fiado_pendiente for pg in p.pagos if pg.metodo == "Fiado"), 2
    )
    merma = merma_periodo(db, inicio, fin)
    perdidas = schemas.PerdidasVentas(
        anuladas=len(anulados),
        valor_anulado=round(sum(p.total for p in anulados), 2),
        devueltas=len(devueltos),
        valor_devuelto=round(sum(p.total for p in devueltos), 2),
        con_descuento=len(con_descuento),
        valor_descuentos=round(sum(p.descuento or 0 for p in con_descuento), 2),
        merma_inventario=merma,
        fiado_pendiente=len(fiado_pendiente),
        valor_fiado_pendiente=valor_fiado,
    )
    # Lo que de verdad se fue: devuelto (ya se habia cobrado), rebajado y
    # botado. Lo anulado nunca entro, y lo fiado todavia puede cobrarse: se
    # muestran, pero no se suman como perdida.
    perdidas.total = round(perdidas.valor_devuelto + perdidas.valor_descuentos + merma, 2)
    perdidas.pct_sobre_ventas = round(perdidas.total / ventas * 100, 1) if ventas else 0.0

    por_metodo: Dict[str, float] = {}
    for p in vendidos:
        for pg in p.pagos:
            por_metodo[pg.metodo] = round(por_metodo.get(pg.metodo, 0) + pg.monto, 2)

    puntos = serie(((p.cerrado_en, p.total) for p in vendidos), inicio, fin)
    mejor = max(puntos, key=lambda s: (s["ventas"], s["pedidos"])) if puntos else None

    facturadas = [p for p in vendidos if p.facturado]

    return schemas.ResumenVentas(
        etiqueta=etiqueta,
        desde=inicio.date(),
        hasta=(fin - datetime.timedelta(days=1)).date(),
        dias=dias,
        granularidad=granularidad(inicio, fin),
        ventas=ventas,
        ventas_bs=round(sum(p.total * (p.tasa_bcv or 0) for p in vendidos), 2),
        pedidos=len(vendidos),
        unidades=sum(i.cantidad for p in vendidos for i in p.items),
        ticket_promedio=round(ventas / len(vendidos), 2) if vendidos else 0.0,
        ticket_mediano=_mediana([p.total for p in vendidos]),
        promedio_diario=round(ventas / dias, 2),
        pedidos_por_dia=round(len(vendidos) / dias, 1),
        anterior=schemas.VentasAnteriores(
            ventas=ventas_prev,
            pedidos=len(prev),
            promedio_diario=round(ventas_prev / dias_prev, 2),
        ),
        cambio_pct=round((ventas - ventas_prev) / ventas_prev * 100, 1) if ventas_prev else None,
        perdidas=perdidas,
        por_metodo_pago=por_metodo,
        por_punto_venta=_agrupar(vendidos, lambda p: p.punto_venta),
        por_operador=_agrupar(vendidos, lambda p: p.operador),
        facturadas=len(facturadas),
        valor_facturado=round(sum(p.total for p in facturadas), 2),
        serie=[schemas.PuntoSerie(**s) for s in puntos],
        mejor=schemas.PuntoSerie(**mejor) if mejor and mejor["pedidos"] else None,
    )
