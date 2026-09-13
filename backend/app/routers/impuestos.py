import calendar
import datetime
from typing import List, Tuple

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import contabilidad, impuestos, models, schemas
from ..database import get_db
from ..timeutils import ahora, hoy, rango_periodo

router = APIRouter(prefix="/api/impuestos", tags=["impuestos"])


@router.get("/config", response_model=schemas.ConfiguracionFiscal)
def obtener_config(db: Session = Depends(get_db)):
    return schemas.ConfiguracionFiscal(tasa_iva=impuestos.tasa_iva(db))


@router.put("/config", response_model=schemas.ConfiguracionFiscal)
def actualizar_config(body: schemas.ConfiguracionFiscal, db: Session = Depends(get_db)):
    if body.tasa_iva < 0:
        raise HTTPException(status_code=400, detail="La tasa de IVA no puede ser negativa")
    return schemas.ConfiguracionFiscal(tasa_iva=impuestos.fijar_tasa_iva(db, body.tasa_iva))


def _totales_iva_del_rango(db: Session, inicio, fin) -> Tuple[float, float]:
    """(debito, credito) de un rango cualquiera, para declarar un mes puntual."""
    facturados = (
        db.query(models.Pedido)
        .filter(
            models.Pedido.estado == "pagado",
            models.Pedido.facturado.is_(True),
            models.Pedido.cerrado_en >= inicio,
            models.Pedido.cerrado_en < fin,
        )
        .all()
    )
    debito = 0.0
    for p in facturados:
        _base, iva = impuestos.desglosar(p.total, p.tasa_iva or impuestos.IVA_DEFAULT)
        debito += iva

    credito = sum(
        f.iva
        for f in db.query(models.FacturaCompra)
        .filter(models.FacturaCompra.fecha >= inicio, models.FacturaCompra.fecha < fin)
        .all()
    )
    return round(debito, 2), round(credito, 2)


@router.get("/libro-ventas", response_model=schemas.LibroVentas)
def libro_ventas(periodo: str = "mes", db: Session = Depends(get_db)):
    if periodo not in ("dia", "semana", "mes"):
        periodo = "mes"
    inicio, fin, etiqueta = rango_periodo(periodo)

    pedidos_facturados = (
        db.query(models.Pedido)
        .filter(
            models.Pedido.estado == "pagado",
            models.Pedido.facturado.is_(True),
            models.Pedido.cerrado_en >= inicio,
            models.Pedido.cerrado_en < fin,
        )
        .order_by(models.Pedido.cerrado_en)
        .all()
    )
    no_facturados = (
        db.query(models.Pedido)
        .filter(
            models.Pedido.estado == "pagado",
            models.Pedido.facturado.is_(False),
            models.Pedido.cerrado_en >= inicio,
            models.Pedido.cerrado_en < fin,
        )
        .all()
    )

    filas = []
    for p in pedidos_facturados:
        base, iva = impuestos.desglosar(p.total, p.tasa_iva or impuestos.IVA_DEFAULT)
        filas.append(
            schemas.FilaLibroVentas(
                pedido_id=p.id,
                fecha=p.cerrado_en,
                numero_factura=p.numero_factura or f"P-{p.numero}",
                cliente="Consumidor final",
                base_imponible=base,
                iva=iva,
                total=round(p.total, 2),
            )
        )

    return schemas.LibroVentas(
        periodo=periodo,
        etiqueta=etiqueta,
        tasa_iva=impuestos.tasa_iva(db),
        filas=filas,
        total_base=round(sum(f.base_imponible for f in filas), 2),
        total_iva=round(sum(f.iva for f in filas), 2),
        total_general=round(sum(f.total for f in filas), 2),
        ventas_no_facturadas=len(no_facturados),
        monto_no_facturado=round(sum(p.total for p in no_facturados), 2),
    )


@router.get("/libro-compras", response_model=schemas.LibroCompras)
def libro_compras(periodo: str = "mes", db: Session = Depends(get_db)):
    if periodo not in ("dia", "semana", "mes"):
        periodo = "mes"
    inicio, fin, etiqueta = rango_periodo(periodo)

    facturas = (
        db.query(models.FacturaCompra)
        .filter(models.FacturaCompra.fecha >= inicio, models.FacturaCompra.fecha < fin)
        .order_by(models.FacturaCompra.fecha)
        .all()
    )

    filas = [
        schemas.FilaLibroCompras(
            factura_id=f.id,
            fecha=f.fecha,
            numero_factura=f.numero_factura,
            proveedor_nombre=f.proveedor_nombre,
            proveedor_rif=f.proveedor_rif,
            base_imponible=f.base_imponible,
            iva=f.iva,
            total=f.total,
        )
        for f in facturas
    ]

    return schemas.LibroCompras(
        periodo=periodo,
        etiqueta=etiqueta,
        filas=filas,
        total_base=round(sum(f.base_imponible for f in filas), 2),
        total_iva=round(sum(f.iva for f in filas), 2),
        total_general=round(sum(f.total for f in filas), 2),
    )


@router.get("/resumen", response_model=schemas.ResumenIva)
def resumen_iva(periodo: str = "mes", db: Session = Depends(get_db)):
    ventas = libro_ventas(periodo, db)
    compras = libro_compras(periodo, db)
    return schemas.ResumenIva(
        periodo=periodo,
        etiqueta=ventas.etiqueta,
        iva_debito=ventas.total_iva,
        iva_credito=compras.total_iva,
        iva_a_pagar=round(ventas.total_iva - compras.total_iva, 2),
    )


# ------------------------------------------------------------ declaraciones
MESES_ES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
]


def _rango_del_mes(anio: int, mes: int):
    inicio = datetime.datetime(anio, mes, 1)
    fin = datetime.datetime(anio + (mes // 12), (mes % 12) + 1, 1)
    return inicio, fin


def _a_schema(d: models.DeclaracionIva) -> schemas.DeclaracionIva:
    return schemas.DeclaracionIva(
        id=d.id,
        anio=d.anio,
        mes=d.mes,
        periodo=d.periodo,
        etiqueta=f"{MESES_ES[d.mes - 1]} {d.anio}",
        iva_debito=d.iva_debito,
        iva_credito=d.iva_credito,
        credito_arrastrado=d.credito_arrastrado,
        credito_usado=d.credito_usado,
        iva_a_pagar=d.iva_a_pagar,
        credito_excedente=d.credito_excedente,
        fecha_declaracion=d.fecha_declaracion,
        pagada=d.pagada,
        fecha_pago=d.fecha_pago,
        forma_pago=d.forma_pago,
    )


@router.get("/declaraciones", response_model=List[schemas.DeclaracionIva])
def listar_declaraciones(db: Session = Depends(get_db)):
    declaraciones = (
        db.query(models.DeclaracionIva)
        .order_by(models.DeclaracionIva.anio.desc(), models.DeclaracionIva.mes.desc())
        .all()
    )
    return [_a_schema(d) for d in declaraciones]


@router.get("/periodos-pendientes", response_model=List[schemas.PeriodoPendiente])
def periodos_pendientes(db: Session = Depends(get_db)):
    """Meses ya terminados que todavia no se declararon.

    Solo se listan meses cerrados: el mes en curso todavia puede recibir
    ventas, asi que declararlo seria declarar un numero que va a cambiar.
    """
    # Se arranca desde el primer movimiento fiscal, sea venta o compra: un mes
    # sin ventas pero con compras igual genera credito fiscal que hay que
    # declarar para poder arrastrarlo.
    fechas = []
    primera_venta = (
        db.query(models.Pedido)
        .filter(models.Pedido.estado == "pagado")
        .order_by(models.Pedido.cerrado_en)
        .first()
    )
    if primera_venta and primera_venta.cerrado_en:
        fechas.append(primera_venta.cerrado_en)
    primera_compra = (
        db.query(models.FacturaCompra).order_by(models.FacturaCompra.fecha).first()
    )
    if primera_compra and primera_compra.fecha:
        fechas.append(primera_compra.fecha)
    if not fechas:
        return []
    primera = min(fechas)

    declarados = {(d.anio, d.mes) for d in db.query(models.DeclaracionIva).all()}
    hoy_ = hoy()
    pendientes = []
    anio, mes = primera.year, primera.month
    while (anio, mes) < (hoy_.year, hoy_.month):
        if (anio, mes) not in declarados:
            inicio, fin = _rango_del_mes(anio, mes)
            debito, credito = _totales_iva_del_rango(db, inicio, fin)
            # Un mes sin ventas ni compras no tiene nada que declarar: listarlo
            # solo llenaria la pantalla de meses vacios.
            if debito > 0 or credito > 0:
                pendientes.append(
                    schemas.PeriodoPendiente(
                        anio=anio,
                        mes=mes,
                        etiqueta=f"{MESES_ES[mes - 1]} {anio}",
                        iva_debito=debito,
                        iva_credito=credito,
                    )
                )
        mes += 1
        if mes > 12:
            anio, mes = anio + 1, 1
    return pendientes


@router.post("/declaraciones", response_model=schemas.DeclaracionIva)
def declarar_iva(body: schemas.DeclararIvaRequest, db: Session = Depends(get_db)):
    if not 1 <= body.mes <= 12:
        raise HTTPException(status_code=400, detail="Mes invalido")

    hoy_ = hoy()
    if (body.anio, body.mes) >= (hoy_.year, hoy_.month):
        raise HTTPException(
            status_code=400,
            detail="Ese mes todavia no termina: declararlo fijaria un numero que aun puede cambiar.",
        )

    existente = (
        db.query(models.DeclaracionIva).filter_by(anio=body.anio, mes=body.mes).first()
    )
    if existente:
        raise HTTPException(
            status_code=409, detail=f"El periodo {existente.periodo} ya fue declarado."
        )

    inicio, fin = _rango_del_mes(body.anio, body.mes)
    debito, credito = _totales_iva_del_rango(db, inicio, fin)

    # El credito que sobro del mes anterior sigue disponible: es como funciona
    # el excedente de credito fiscal, no se pierde.
    anterior = (
        db.query(models.DeclaracionIva)
        .order_by(models.DeclaracionIva.anio.desc(), models.DeclaracionIva.mes.desc())
        .first()
    )
    arrastrado = anterior.credito_excedente if anterior else 0.0

    disponible = round(credito + arrastrado, 2)
    usado = round(min(disponible, debito), 2)
    a_pagar = round(debito - usado, 2)
    excedente = round(disponible - usado, 2)

    declaracion = models.DeclaracionIva(
        anio=body.anio,
        mes=body.mes,
        iva_debito=debito,
        iva_credito=credito,
        credito_arrastrado=arrastrado,
        credito_usado=usado,
        iva_a_pagar=a_pagar,
        credito_excedente=excedente,
    )
    db.add(declaracion)
    db.flush()
    contabilidad.registrar_declaracion_iva(db, declaracion)
    db.commit()
    db.refresh(declaracion)
    return _a_schema(declaracion)


@router.post("/declaraciones/{declaracion_id}/pagar", response_model=schemas.DeclaracionIva)
def pagar_declaracion(
    declaracion_id: int, body: schemas.PagoIvaRequest, db: Session = Depends(get_db)
):
    declaracion = (
        db.query(models.DeclaracionIva).filter(models.DeclaracionIva.id == declaracion_id).first()
    )
    if not declaracion:
        raise HTTPException(status_code=404, detail="Declaracion no encontrada")
    if declaracion.pagada:
        raise HTTPException(status_code=409, detail="Esta declaracion ya fue pagada")
    if declaracion.iva_a_pagar <= 0:
        raise HTTPException(
            status_code=400,
            detail="Este periodo no dejo IVA por pagar: el credito fiscal cubrio el debito.",
        )
    if body.forma_pago not in ("Efectivo", "Banco"):
        raise HTTPException(status_code=400, detail="La forma de pago debe ser Efectivo o Banco")

    contabilidad.registrar_pago_iva(db, declaracion, body.forma_pago)
    declaracion.pagada = True
    declaracion.fecha_pago = ahora()
    declaracion.forma_pago = body.forma_pago
    db.commit()
    db.refresh(declaracion)
    return _a_schema(declaracion)
