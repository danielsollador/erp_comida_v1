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

from .. import consolidacion, models, schemas
from ..database import get_db
from ..rango import Rango, anterior, dias_transcurridos, granularidad, serie
from ..timeutils import inicio_del_dia
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
            joinedload(models.Pedido.ediciones),
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
        editado=bool(p.editado),
        ediciones=[schemas.PedidoEdicion.model_validate(e) for e in p.ediciones],
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


def _agrupar(grupos: Dict[str, consolidacion.Grupo]) -> List[schemas.GrupoVentas]:
    salida = [
        schemas.GrupoVentas(nombre=k, ventas=round(g.ventas, 2), pedidos=int(g.pedidos))
        for k, g in grupos.items()
    ]
    salida.sort(key=lambda g: g.ventas, reverse=True)
    return salida


def _puntos(b: consolidacion.Bloque, paso: str):
    """Los puntos para `serie`: por horas si el rango es un dia, por dias en
    lo demas. Cada punto vale por los pedidos que agrupa."""
    if paso == "hora":
        if not b.por_dia:
            return []
        dia = consolidacion.fecha_de_clave(next(iter(b.por_dia)))
        return [
            (datetime.datetime.combine(dia, datetime.time(int(h), 0)), g.ventas, g.pedidos)
            for h, g in b.por_hora.items()
        ]
    return [
        (inicio_del_dia(consolidacion.fecha_de_clave(k)) + datetime.timedelta(hours=12), g.ventas, g.pedidos)
        for k, g in b.por_dia.items()
    ]


@router.get("/resumen", response_model=schemas.ResumenVentas)
def resumen(rango: Rango = Depends(), db: Session = Depends(get_db)):
    inicio, fin, etiqueta = rango.resolver(periodo="mes")
    # Del mart los dias cerrados, en vivo lo de hoy: una sola definicion de
    # "venta efectiva" compartida con Reportes (ver consolidacion.py). Las
    # anuladas van por el dia de la comanda y las devueltas por el dia en que
    # se devolvieron, igual que antes.
    b = consolidacion.bloque_para(db, inicio, fin)
    ventas = b.ventas
    dias = dias_transcurridos(inicio, fin)

    # El periodo anterior, del mismo tamaño, para decir si esto es mas o menos
    # que antes. Siempre incompleto el actual si incluye hoy; se aclara en
    # pantalla, no se corrige el numero.
    a_ini, a_fin = anterior(inicio, fin)
    prev = consolidacion.bloque_para(db, a_ini, a_fin)
    ventas_prev = prev.ventas
    dias_prev = max(1, (a_fin - a_ini).days)

    # Lo UNICO que sigue vivo: el fiado pendiente cambia cuando el cliente
    # paga, semanas despues de la venta, asi que no se puede guardar por dia.
    fiado_pendiente = (
        db.query(models.Pedido)
        .join(models.PagoPedido)
        .filter(
            models.Pedido.estado == "pagado",
            models.Pedido.devuelto.is_(False),
            models.Pedido.cerrado_en >= inicio,
            models.Pedido.cerrado_en < fin,
            models.Pedido.fiado_saldado.is_(False),
            models.PagoPedido.metodo == "Fiado",
        )
        .distinct()
        .all()
    )
    valor_fiado = round(
        sum(pg.monto for p in fiado_pendiente for pg in p.pagos if pg.metodo == "Fiado"), 2
    )
    merma = merma_periodo(db, inicio, fin)
    perdidas = schemas.PerdidasVentas(
        anuladas=b.anulados,
        valor_anulado=round(b.valor_anulado, 2),
        devueltas=b.devoluciones,
        valor_devuelto=round(b.valor_devuelto, 2),
        con_descuento=b.con_descuento,
        valor_descuentos=round(b.valor_descuentos, 2),
        merma_inventario=merma,
        fiado_pendiente=len(fiado_pendiente),
        valor_fiado_pendiente=valor_fiado,
    )
    # Lo que de verdad se fue: devuelto (ya se habia cobrado), rebajado y
    # botado. Lo anulado nunca entro, y lo fiado todavia puede cobrarse: se
    # muestran, pero no se suman como perdida.
    perdidas.total = round(perdidas.valor_devuelto + perdidas.valor_descuentos + merma, 2)
    perdidas.pct_sobre_ventas = round(perdidas.total / ventas * 100, 1) if ventas else 0.0

    por_metodo: Dict[str, float] = {m: round(g.ventas, 2) for m, g in b.por_metodo.items()}

    paso = granularidad(inicio, fin)
    puntos = serie(_puntos(b, paso), inicio, fin, paso=paso)
    mejor = max(puntos, key=lambda s: (s["ventas"], s["pedidos"])) if puntos else None

    return schemas.ResumenVentas(
        etiqueta=etiqueta,
        desde=inicio.date(),
        hasta=(fin - datetime.timedelta(days=1)).date(),
        dias=dias,
        granularidad=granularidad(inicio, fin),
        ventas=ventas,
        ventas_bs=round(b.ventas_bs, 2),
        pedidos=b.pedidos,
        unidades=b.unidades,
        ticket_promedio=round(ventas / b.pedidos, 2) if b.pedidos else 0.0,
        ticket_mediano=_mediana(b.totales),
        promedio_diario=round(ventas / dias, 2),
        pedidos_por_dia=round(b.pedidos / dias, 1),
        anterior=schemas.VentasAnteriores(
            ventas=ventas_prev,
            pedidos=prev.pedidos,
            promedio_diario=round(ventas_prev / dias_prev, 2),
        ),
        cambio_pct=round((ventas - ventas_prev) / ventas_prev * 100, 1) if ventas_prev else None,
        perdidas=perdidas,
        por_metodo_pago=por_metodo,
        por_punto_venta=_agrupar(b.por_punto),
        por_operador=_agrupar(b.por_operador),
        facturadas=b.facturadas,
        valor_facturado=round(b.valor_facturado, 2),
        serie=[schemas.PuntoSerie(**s) for s in puntos],
        mejor=schemas.PuntoSerie(**mejor) if mejor and mejor["pedidos"] else None,
    )
