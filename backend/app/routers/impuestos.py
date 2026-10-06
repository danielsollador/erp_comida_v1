import calendar
import datetime
import re
from typing import List, Tuple

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload

from .. import contabilidad, impuestos, models, schemas, tasas
from ..database import get_db
from ..exportar_csv import nombre_de_archivo, respuesta_csv
from ..rango import Rango
from ..timeutils import ahora, hoy, rango_periodo

router = APIRouter(prefix="/api/impuestos", tags=["impuestos"])


@router.get("/config", response_model=schemas.ConfiguracionFiscal)
def obtener_config(db: Session = Depends(get_db)):
    cfg = impuestos.config(db)
    return schemas.ConfiguracionFiscal(
        tasa_iva=cfg.tasa_iva, razon_social=cfg.razon_social or "", rif=cfg.rif or "",
        direccion=cfg.direccion or "", agente_retencion=bool(cfg.agente_retencion),
    )


@router.put("/config", response_model=schemas.ConfiguracionFiscal)
def actualizar_config(body: schemas.ConfiguracionFiscal, db: Session = Depends(get_db)):
    if body.tasa_iva < 0:
        raise HTTPException(status_code=400, detail="La tasa de IVA no puede ser negativa")
    cambios = body.model_dump(exclude_unset=True)
    if cambios.get("rif") and not impuestos.rif_valido(cambios["rif"]):
        raise HTTPException(status_code=400, detail="El RIF es una letra (J/G/V/E/P/C) y 8 o 9 dígitos.")
    cfg = impuestos.config(db)
    # Solo lo que vino: guardar la alicuota no borra la razon social.
    for campo in ("razon_social", "direccion"):
        if campo in cambios:
            setattr(cfg, campo, (cambios[campo] or "").strip())
    if "rif" in cambios:
        cfg.rif = impuestos.normalizar_rif(cambios["rif"] or "")
    if "agente_retencion" in cambios:
        cfg.agente_retencion = bool(cambios["agente_retencion"])
    db.commit()
    impuestos.fijar_tasa_iva(db, body.tasa_iva)
    return obtener_config(db)


def _ventas_del_libro(db: Session, inicio, fin):
    """Lo que va al Libro de Ventas de ese periodo: (facturas, notas de credito).

    Una venta devuelta salia del libro, y punto. Eso funciona mientras la
    devolucion cae en el mismo mes que la venta, pero si el cliente trae la
    comida en octubre y esa factura ya se declaro en septiembre, borrarla de
    septiembre reescribe en silencio un periodo que ya se le presento al
    SENIAT: el libro reimpreso deja de coincidir con la declaracion firmada.

    Lo correcto es lo que hace cualquier contabilidad: la factura se queda en
    su mes y la NOTA DE CREDITO es un documento aparte, con su propia fecha,
    que entra en negativo en el mes en que se emitio. Que es ademas la fecha
    con la que `registrar_devolucion` ya asienta la reversion, asi que el
    mayor y el libro pasan a decir lo mismo.

    Vendida y devuelta dentro del mismo periodo sigue saliendo entera: ese mes
    todavia no se declaro, no hay nada que corregir, y un par factura/NC que
    se anulan entre si solo ensuciaria el libro.
    """
    facturadas = (
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
    # Sin fecha de devolucion es historico viejo: se trata como antes (fuera),
    # que es lo unico que se puede afirmar de el.
    vigentes = [
        p for p in facturadas
        if not (p.devuelto and (p.fecha_devolucion is None or p.fecha_devolucion < fin))
    ]
    notas = (
        db.query(models.Pedido)
        .filter(
            models.Pedido.estado == "pagado",
            models.Pedido.facturado.is_(True),
            models.Pedido.devuelto.is_(True),
            models.Pedido.cerrado_en < inicio,
            models.Pedido.fecha_devolucion >= inicio,
            models.Pedido.fecha_devolucion < fin,
        )
        .order_by(models.Pedido.fecha_devolucion)
        .all()
    )
    return vigentes, notas


def _totales_iva_del_rango(db: Session, inicio, fin) -> dict:
    """El IVA de un periodo, para declararlo: sale de los MISMOS libros que se
    imprimen, asi lo declarado y el libro no pueden decir cosas distintas.
    En dolares (para el libro mayor) y en bolivares (lo que va al SENIAT)."""
    ventas = armar_libro_ventas(db, inicio, fin)
    compras = armar_libro_compras(db, inicio, fin)
    return {
        "debito": ventas.total_iva, "credito": compras.total_iva,
        "debito_bs": ventas.total_iva_bs, "credito_bs": compras.total_iva_bs,
        "retenciones_bs": ventas.total_retenido_bs,
        "sin_tasa": ventas.sin_tasa + compras.sin_tasa,
    }


@router.get("/libro-ventas", response_model=schemas.LibroVentas)
def libro_ventas(rango: Rango = Depends(), db: Session = Depends(get_db)):
    """Con `anio` y `mes` emite el libro de un periodo ya cerrado.

    Es requisito fiscal poder re-emitirlo: el SENIAT lo pide por periodo y el
    sistema solo sabia emitir el mes en curso.
    """
    inicio, fin, etiqueta = rango.resolver(periodo="mes")
    return armar_libro_ventas(db, inicio, fin, etiqueta, rango.periodo or "rango")


def _venta_bs(db: Session, p: models.Pedido, signo: int = 1) -> dict:
    """La venta en Bs a la tasa BCV congelada al cobrarla (o la guardada de
    ese dia, en ventas viejas). El IVA se desglosa sobre los Bs, como lo
    imprime la maquina fiscal."""
    tasa = p.tasa_bcv
    if not tasa:
        fila_tasa = tasas.tasa_al(db, p.cerrado_en.date())
        tasa = fila_tasa.bcv if fila_tasa else None
    if not tasa:
        return {}
    total_bs = round(p.total * tasa, 2)
    base_bs, iva_bs = impuestos.desglosar(total_bs, p.tasa_iva or impuestos.IVA_DEFAULT)
    return dict(
        tasa_bcv=tasa, gravado_bs=round(signo * base_bs, 2), exento_bs=0.0,
        iva_bs=round(signo * iva_bs, 2), total_bs=round(signo * total_bs, 2),
    )


def armar_libro_ventas(db: Session, inicio, fin, etiqueta: str = "", periodo: str = "rango") -> schemas.LibroVentas:

    # Las facturas del periodo y las notas de credito emitidas en el (ver
    # `_ventas_del_libro`: una devolucion posterior no borra la factura de su
    # mes, entra como NC en el suyo).
    pedidos_facturados, notas = _ventas_del_libro(db, inicio, fin)
    no_facturados = (
        db.query(models.Pedido)
        .filter(
            models.Pedido.estado == "pagado",
            models.Pedido.facturado.is_(False),
            models.Pedido.devuelto.is_(False),
            models.Pedido.cerrado_en >= inicio,
            models.Pedido.cerrado_en < fin,
        )
        .all()
    )

    def en_bs(p: models.Pedido, signo: int) -> dict:
        return _venta_bs(db, p, signo)

    def en_el_periodo(fecha) -> bool:
        return fecha is not None and inicio.date() <= fecha < fin.date()

    def retencion(p: models.Pedido) -> dict:
        return dict(
            fecha_retencion=p.fecha_retencion_iva, comprobante_retencion=p.comprobante_retencion_iva or "",
            iva_retenido_bs=p.retencion_iva_bs,
        )

    def cliente(p: models.Pedido) -> str:
        # La razon social que se pidio al facturar; si no, el nombre del
        # cliente de la comanda; si no, consumidor final.
        return (p.razon_social_cliente or "").strip() or (p.cliente or "").strip() or "Consumidor final"

    filas = []
    for p in pedidos_facturados:
        base, iva = impuestos.desglosar(p.total, p.tasa_iva or impuestos.IVA_DEFAULT)
        filas.append(
            schemas.FilaLibroVentas(
                pedido_id=p.id,
                fecha=p.cerrado_en,
                numero_factura=p.numero_factura or f"P-{p.numero}",
                cliente=cliente(p),
                rif=p.rif_cliente or "",
                numero_control=p.numero_control or "",
                base_imponible=base,
                iva=iva,
                total=round(p.total, 2),
                **en_bs(p, 1),
                # La retencion va en su factura si el comprobante es de este mes.
                **(retencion(p) if en_el_periodo(p.fecha_retencion_iva) else {}),
                retencion_pendiente_bs=(
                    p.retencion_iva_bs if p.retencion_iva_bs is not None and p.fecha_retencion_iva is None else None
                ),
            )
        )

    # Comprobantes de retencion que llegaron este mes por facturas de otro
    # mes: van en el libro del mes del comprobante, en su propia fila.
    for p in (
        db.query(models.Pedido)
        .filter(
            models.Pedido.facturado.is_(True),
            models.Pedido.retencion_iva_bs.isnot(None),
            models.Pedido.fecha_retencion_iva >= inicio.date(),
            models.Pedido.fecha_retencion_iva < fin.date(),
            (models.Pedido.cerrado_en < inicio) | (models.Pedido.cerrado_en >= fin),
        )
        .all()
    ):
        filas.append(
            schemas.FilaLibroVentas(
                pedido_id=p.id,
                fecha=datetime.datetime.combine(p.fecha_retencion_iva, datetime.time(12)),
                numero_factura="",
                cliente=cliente(p),
                rif=p.rif_cliente or "",
                base_imponible=0, iva=0, total=0,
                tipo="RET",
                factura_afectada=p.numero_factura or f"P-{p.numero}",
                gravado_bs=0, exento_bs=0, iva_bs=0, total_bs=0, tasa_bcv=p.tasa_bcv,
                **retencion(p),
            )
        )

    # Las notas de credito del periodo, en negativo. Llevan la fecha en que se
    # emitieron y el numero del talonario de notas, no el de la factura: son
    # otro documento y el SENIAT los cuenta aparte.
    for p in notas:
        base, iva = impuestos.desglosar(p.total, p.tasa_iva or impuestos.IVA_DEFAULT)
        filas.append(
            schemas.FilaLibroVentas(
                pedido_id=p.id,
                fecha=p.fecha_devolucion,
                numero_factura=p.nota_credito or f"NC-{p.numero}",
                cliente=cliente(p),
                rif=p.rif_cliente or "",
                base_imponible=round(-base, 2),
                iva=round(-iva, 2),
                total=round(-p.total, 2),
                tipo="NC",
                numero_nota=p.nota_credito or f"NC-{p.numero}",
                factura_afectada=p.numero_factura or f"P-{p.numero}",
                **en_bs(p, -1),
            )
        )
    filas.sort(key=lambda f: f.fecha)

    def suma(campo):
        return round(sum(getattr(f, campo) or 0 for f in filas), 2)

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
        total_exento_bs=suma("exento_bs"),
        total_gravado_bs=suma("gravado_bs"),
        total_iva_bs=suma("iva_bs"),
        total_bs=suma("total_bs"),
        sin_tasa=sum(1 for f in filas if f.total_bs is None),
        total_retenido_bs=suma("iva_retenido_bs"),
    )


@router.post("/ventas/{pedido_id}/retencion", response_model=schemas.FilaLibroVentas)
def registrar_retencion_recibida(
    pedido_id: int, body: schemas.RetencionRecibidaRequest, db: Session = Depends(get_db)
):
    """El comprobante de retencion de IVA que le entrego el cliente
    (contribuyente especial) por una factura de venta."""
    p = db.query(models.Pedido).filter_by(id=pedido_id).first()
    if p is None or not p.facturado:
        raise HTTPException(status_code=404, detail="Venta facturada no encontrada")
    if body.monto_bs is None and p.retencion_iva_usd:
        # Se retuvo al cobrar: el monto es el de entonces.
        body.monto_bs = p.retencion_iva_bs
    comprobante = re.sub(r"\D", "", body.comprobante or "")
    if len(comprobante) != 14:
        raise HTTPException(
            status_code=400,
            detail="El número de comprobante tiene 14 dígitos: año, mes y correlativo (AAAAMM + 8).",
        )
    if body.fecha > hoy():
        raise HTTPException(status_code=400, detail="La fecha del comprobante no puede ser futura.")
    if p.cerrado_en and body.fecha < p.cerrado_en.date():
        raise HTTPException(status_code=400, detail="El comprobante no puede ser de antes de la factura.")
    _sin_periodo_cerrado(db, datetime.datetime.combine(body.fecha, datetime.time(12)))
    if p.fecha_retencion_iva:
        _sin_periodo_cerrado(db, datetime.datetime.combine(p.fecha_retencion_iva, datetime.time(12)))
    bs = _venta_bs(db, p)
    if not bs:
        raise HTTPException(status_code=409, detail="La venta no tiene tasa: cárgala primero en el Libro de Ventas.")
    monto = body.monto_bs if body.monto_bs is not None else impuestos.porcentaje_de(bs["iva_bs"], 75)
    if monto <= 0 or monto > bs["iva_bs"] + 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"La retención va de más de 0 hasta el IVA de la factura (Bs {bs['iva_bs']:.2f}).",
        )
    p.retencion_iva_bs = round(monto, 2)
    p.comprobante_retencion_iva = comprobante
    p.fecha_retencion_iva = body.fecha
    db.commit()
    return schemas.FilaLibroVentas(
        pedido_id=p.id, fecha=p.cerrado_en, numero_factura=p.numero_factura or "", cliente=p.cliente or "",
        base_imponible=0, iva=0, total=0, fecha_retencion=p.fecha_retencion_iva,
        comprobante_retencion=p.comprobante_retencion_iva, iva_retenido_bs=p.retencion_iva_bs, **bs,
    )


@router.delete("/ventas/{pedido_id}/retencion")
def quitar_retencion_recibida(pedido_id: int, db: Session = Depends(get_db)):
    p = db.query(models.Pedido).filter_by(id=pedido_id).first()
    if p is None or p.retencion_iva_bs is None:
        raise HTTPException(status_code=404, detail="Esa venta no tiene retención registrada")
    if p.fecha_retencion_iva:
        _sin_periodo_cerrado(db, datetime.datetime.combine(p.fecha_retencion_iva, datetime.time(12)))
    # Si se retuvo al cobrar, la plata no entro: lo retenido se queda y solo
    # se quita el comprobante (estaba mal cargado).
    if not p.retencion_iva_usd:
        p.retencion_iva_bs = None
    p.comprobante_retencion_iva = ""
    p.fecha_retencion_iva = None
    db.commit()
    return {"ok": True}


@router.get("/libro-ventas/seniat")
def libro_ventas_seniat(rango: Rango = Depends(), db: Session = Depends(get_db)) -> StreamingResponse:
    """El Libro de Ventas en bolivares, con el formato de la planilla del
    SENIAT (.xlsx)."""
    from .. import libros_seniat as seniat

    inicio, fin, _ = rango.resolver(periodo="mes")
    libro = libro_ventas(rango, db)
    contenido = seniat.libro_ventas(
        libro, impuestos.config(db), inicio.date(), (fin - datetime.timedelta(days=1)).date()
    )
    nombre = f"libro-ventas-{nombre_de_archivo(libro.etiqueta)}.xlsx"
    return StreamingResponse(
        iter([contenido]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{nombre}"'},
    )


@router.get("/libro-ventas/exportar")
def libro_ventas_exportar(rango: Rango = Depends(), db: Session = Depends(get_db)) -> StreamingResponse:
    """El mismo Libro de Ventas, como CSV para Excel."""
    libro = libro_ventas(rango, db)
    filas = [
        (f.pedido_id, f.fecha.strftime("%d/%m/%Y %H:%M"), f.numero_factura, f.cliente,
         f"{f.base_imponible:.2f}", f"{f.iva:.2f}", f"{f.total:.2f}")
        for f in libro.filas
    ]
    return respuesta_csv(
        f"libro-ventas-{nombre_de_archivo(libro.etiqueta)}.csv",
        ["Pedido", "Fecha", "N. Factura", "Cliente", "Base imponible", "IVA", "Total"],
        filas,
    )


def _gravado_usd(f: models.FacturaCompra, tasa_pct: float) -> float:
    """La parte de la base que pago IVA, en dolares y sin redondear."""
    if f.items:
        bruta = sum(i.cantidad * i.costo_unitario for i in f.items)
        gravada = sum(i.cantidad * i.costo_unitario for i in f.items if not i.exento)
        return gravada * (f.base_imponible / bruta) if bruta else 0.0
    return impuestos.gravado_de(f.base_imponible, f.iva, tasa_pct)


def _fila_bs(fila: dict, gravado_bs, exento_bs, iva_bs, tasa, estimada: bool, signo: int = 1) -> dict:
    if tasa is None:
        return fila
    gravado_bs, exento_bs, iva_bs = (round(signo * x, 2) for x in (gravado_bs, exento_bs, iva_bs))
    fila.update(
        tasa_bcv=tasa, tasa_estimada=estimada, gravado_bs=gravado_bs, exento_bs=exento_bs,
        iva_bs=iva_bs, total_bs=round(gravado_bs + exento_bs + iva_bs, 2),
    )
    return fila


def _tasa_de_factura(f: models.FacturaCompra, db: Session):
    """(tasa, estimada): la congelada al guardar, o la guardada de su fecha
    de emision para las facturas de antes."""
    if f.tasa_bcv is not None:
        return f.tasa_bcv, f.gravado_bs is None
    fila_tasa = tasas.tasa_al(db, f.fecha_emision or f.fecha.date())
    return (fila_tasa.bcv if fila_tasa else None), True


def _comun(f: models.FacturaCompra) -> dict:
    return dict(
        factura_id=f.id, proveedor_nombre=f.proveedor_nombre, proveedor_rif=f.proveedor_rif,
        moneda=f.moneda or "$",
    )


def _fila_de_factura(f: models.FacturaCompra, tasa_pct: float, db: Session) -> schemas.FilaLibroCompras:
    tasa, estimada = _tasa_de_factura(f, db)
    if tasa is not None and f.gravado_bs is None:
        gravado_bs, exento_bs, iva_bs = impuestos.montos_bs(
            f.base_imponible, _gravado_usd(f, tasa_pct), f.iva, tasa,
            iva_de_la_base=bool(f.items), tasa_pct=tasa_pct,
        )
    else:
        gravado_bs, exento_bs, iva_bs = f.gravado_bs, f.exento_bs, f.iva_bs
    return schemas.FilaLibroCompras(**_fila_bs(dict(
        _comun(f), tipo="FAC", fecha=f.fecha, fecha_emision=f.fecha_emision or f.fecha.date(),
        numero_factura=f.numero_factura, numero_control=f.numero_control or "",
        base_imponible=f.base_imponible, iva=f.iva, total=f.total,
        fecha_retencion=f.fecha_retencion, comprobante_retencion=f.comprobante_retencion or "",
        iva_retenido_bs=f.iva_retenido_bs,
    ), gravado_bs, exento_bs, iva_bs, tasa, estimada))


def _fila_de_nota(n: models.NotaCreditoCompra, tasa_pct: float, db: Session) -> schemas.FilaLibroCompras:
    """La nota de credito del proveedor: su propia fila, en negativo, en el
    mes en que se emitio (no en el de su factura), como manda el SENIAT. Se
    pasa a Bs a la tasa de su factura: devuelve parte de esos bolivares."""
    f = n.factura
    tasa, estimada = _tasa_de_factura(f, db)
    nota_bs = (
        impuestos.montos_bs(
            n.base_imponible, impuestos.gravado_de(n.base_imponible, n.iva or 0, tasa_pct),
            n.iva or 0, tasa, iva_de_la_base=False, tasa_pct=tasa_pct,
        ) if tasa is not None else (0, 0, 0)
    )
    return schemas.FilaLibroCompras(**_fila_bs(dict(
        _comun(f), tipo="NC", fecha=n.fecha, fecha_emision=n.fecha.date(), numero_factura="",
        numero_nota=n.numero, factura_afectada=f.numero_factura, numero_control="",
        base_imponible=-round(n.base_imponible, 2), iva=-round(n.iva or 0, 2),
        total=-round(n.base_imponible + (n.iva or 0), 2),
    ), *nota_bs, tasa, estimada, signo=-1))


@router.get("/libro-compras", response_model=schemas.LibroCompras)
def libro_compras(rango: Rango = Depends(), db: Session = Depends(get_db)):
    inicio, fin, etiqueta = rango.resolver(periodo="mes")
    return armar_libro_compras(db, inicio, fin, etiqueta, rango.periodo or "rango")


def armar_libro_compras(db: Session, inicio, fin, etiqueta: str = "", periodo: str = "rango") -> schemas.LibroCompras:
    tasa_pct = impuestos.tasa_iva(db)
    facturas = (
        db.query(models.FacturaCompra)
        .options(joinedload(models.FacturaCompra.items))
        .filter(models.FacturaCompra.fecha >= inicio, models.FacturaCompra.fecha < fin)
        .all()
    )
    # Las notas de credito entran en el mes en que se emitieron, sea cual sea
    # el de su factura: asi lo pide el SENIAT, y asi una nota de octubre no
    # reescribe un septiembre ya declarado.
    notas = (
        db.query(models.NotaCreditoCompra)
        .options(joinedload(models.NotaCreditoCompra.factura).joinedload(models.FacturaCompra.items))
        .filter(models.NotaCreditoCompra.fecha >= inicio, models.NotaCreditoCompra.fecha < fin)
        .all()
    )
    filas = [_fila_de_factura(f, tasa_pct, db) for f in facturas] + [_fila_de_nota(n, tasa_pct, db) for n in notas]
    filas.sort(key=lambda f: (f.fecha, f.factura_id, f.tipo != "FAC"))

    def suma(campo):
        return round(sum(getattr(f, campo) or 0 for f in filas), 2)

    return schemas.LibroCompras(
        periodo=periodo,
        etiqueta=etiqueta,
        filas=filas,
        total_base=suma("base_imponible"),
        total_iva=suma("iva"),
        total_general=suma("total"),
        total_exento_bs=suma("exento_bs"),
        total_gravado_bs=suma("gravado_bs"),
        total_iva_bs=suma("iva_bs"),
        total_bs=suma("total_bs"),
        sin_tasa=sum(1 for f in filas if f.total_bs is None),
        tasa_iva=tasa_pct,
    )


def _tasa_valida(tasa: float) -> float:
    if not tasa or tasa <= 0:
        raise HTTPException(status_code=400, detail="La tasa debe ser mayor que cero.")
    return tasa


def _sin_periodo_cerrado(db: Session, fecha: datetime.datetime) -> None:
    motivo = contabilidad.periodo_bloqueado(db, fecha)
    if motivo:
        raise HTTPException(
            status_code=409,
            detail=f"No se puede cambiar la tasa: {motivo}. Cambiarla movería los bolívares ya declarados.",
        )


@router.put("/compras/{factura_id}/tasa", response_model=schemas.FilaLibroCompras)
def cambiar_tasa_compra(factura_id: int, body: schemas.CambiarTasaRequest, db: Session = Depends(get_db)):
    """La tasa con que una factura de compra pasa al libro en Bs: la de su
    fecha de emision por defecto, pero la que diga quien lleva los libros
    (la que imprime el papel, la que uso el contador). Sirve sobre todo para
    las facturas de antes, de fechas sin tasa guardada."""
    f = (
        db.query(models.FacturaCompra)
        .options(joinedload(models.FacturaCompra.items))
        .filter_by(id=factura_id)
        .first()
    )
    if f is None:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    if f.moneda == "Bs" and f.gravado_bs is not None:
        raise HTTPException(
            status_code=409,
            detail="Es una factura en bolívares: van al libro los Bs del papel, y la tasa no los cambia.",
        )
    _sin_periodo_cerrado(db, f.fecha)
    tasa = _tasa_valida(body.tasa_bcv)
    tasa_pct = impuestos.tasa_iva(db)
    f.tasa_bcv = tasa
    f.gravado_bs, f.exento_bs, f.iva_bs = impuestos.montos_bs(
        f.base_imponible, _gravado_usd(f, tasa_pct), f.iva, tasa,
        iva_de_la_base=bool(f.items), tasa_pct=tasa_pct,
    )
    db.commit()
    return _fila_de_factura(f, tasa_pct, db)


@router.put("/ventas/{pedido_id}/tasa")
def cambiar_tasa_venta(pedido_id: int, body: schemas.CambiarTasaRequest, db: Session = Depends(get_db)):
    """La tasa de una venta facturada en el Libro de Ventas: la del momento
    del cobro, o la que se cargue (ventas viejas sin tasa guardada)."""
    p = db.query(models.Pedido).filter_by(id=pedido_id).first()
    if p is None or not p.facturado:
        raise HTTPException(status_code=404, detail="Venta facturada no encontrada")
    _sin_periodo_cerrado(db, p.cerrado_en)
    p.tasa_bcv = _tasa_valida(body.tasa_bcv)
    db.commit()
    return {"ok": True, "tasa_bcv": p.tasa_bcv}


# ------------------------------------------------- retenciones de IVA

def _quincena(anio: int, mes: int, quincena: int):
    if quincena not in (1, 2) or not 1 <= mes <= 12:
        raise HTTPException(status_code=400, detail="La quincena es 1 (del 1 al 15) o 2 (del 16 al fin de mes).")
    if quincena == 1:
        return datetime.date(anio, mes, 1), datetime.date(anio, mes, 15)
    return datetime.date(anio, mes, 16), datetime.date(anio, mes, calendar.monthrange(anio, mes)[1])


def armar_retenciones(db: Session, anio: int, mes: int, quincena: int) -> schemas.RetencionesQuincena:
    desde, hasta = _quincena(anio, mes, quincena)
    tasa_pct = impuestos.tasa_iva(db)
    facturas = (
        db.query(models.FacturaCompra)
        .options(joinedload(models.FacturaCompra.items))
        .filter(
            models.FacturaCompra.fecha_retencion >= desde,
            models.FacturaCompra.fecha_retencion <= hasta,
            models.FacturaCompra.iva_retenido > 0,
        )
        .order_by(models.FacturaCompra.comprobante_retencion)
        .all()
    )
    filas = []
    for f in facturas:
        fila = _fila_de_factura(f, tasa_pct, db)
        filas.append(schemas.RetencionIva(
            factura_id=f.id, fecha_factura=fila.fecha_emision, fecha_retencion=f.fecha_retencion,
            proveedor_nombre=f.proveedor_nombre, proveedor_rif=impuestos.normalizar_rif(f.proveedor_rif or ""),
            numero_factura=f.numero_factura, numero_control=f.numero_control or "",
            comprobante=f.comprobante_retencion or "", porcentaje=f.retencion_pct or 0,
            total_bs=fila.total_bs, base_bs=fila.gravado_bs, exento_bs=fila.exento_bs, iva_bs=fila.iva_bs,
            retenido_bs=f.iva_retenido_bs,
        ))
    enterada = db.query(models.RetencionIvaEnterada).filter_by(anio=anio, mes=mes, quincena=quincena).first()
    return schemas.RetencionesQuincena(
        anio=anio, mes=mes, quincena=quincena,
        etiqueta=f"{'1ra' if quincena == 1 else '2da'} quincena de {MESES_ES[mes - 1]} {anio}",
        retenciones=filas,
        total_retenido_bs=round(sum(r.retenido_bs or 0 for r in filas), 2),
        total_retenido=round(sum(f.iva_retenido or 0 for f in facturas), 2),
        sin_tasa=sum(1 for r in filas if r.retenido_bs is None or r.total_bs is None),
        enterada=enterada is not None,
        fecha_enterada=enterada.fecha if enterada else None,
    )


@router.get("/retenciones-iva", response_model=schemas.RetencionesQuincena)
def retenciones_iva(anio: int, mes: int, quincena: int, db: Session = Depends(get_db)):
    return armar_retenciones(db, anio, mes, quincena)


def _monto_txt(x: float) -> str:
    return f"{(x or 0):.2f}"


@router.get("/retenciones-iva/txt")
def retenciones_iva_txt(anio: int, mes: int, quincena: int, db: Session = Depends(get_db)) -> StreamingResponse:
    """El archivo que se sube al portal del SENIAT: una linea por retencion,
    16 campos separados por tabulador, sin encabezado, montos en Bs con punto
    decimal. Una quincena sin retenciones da un archivo vacio (declaracion en
    cero)."""
    rif_agente = impuestos.normalizar_rif(impuestos.config(db).rif or "")
    if not impuestos.rif_valido(rif_agente):
        raise HTTPException(status_code=400, detail="Carga el RIF de la empresa en Impuestos → Datos fiscales.")
    q = armar_retenciones(db, anio, mes, quincena)
    if q.sin_tasa:
        raise HTTPException(
            status_code=409,
            detail=f"{q.sin_tasa} retención(es) de esa quincena no tienen tasa: sin bolívares no hay TXT.",
        )
    periodo = f"{anio:04d}{mes:02d}"
    lineas = [
        "\t".join([
            rif_agente,                                # 1 RIF del agente de retencion
            periodo,                                   # 2 periodo impositivo AAAAMM
            r.fecha_factura.isoformat(),               # 3 fecha de la factura AAAA-MM-DD
            "C",                                       # 4 tipo de operacion: compra
            "01",                                      # 5 tipo de documento: factura
            r.proveedor_rif,                           # 6 RIF del proveedor
            r.numero_factura,                          # 7 numero del documento
            r.numero_control or "0",                   # 8 numero de control
            _monto_txt(r.total_bs),                    # 9 monto total del documento
            _monto_txt(r.base_bs),                     # 10 base imponible
            _monto_txt(r.retenido_bs),                 # 11 IVA retenido
            "0",                                       # 12 documento afectado (solo NC/ND)
            r.comprobante,                             # 13 numero de comprobante
            _monto_txt(r.exento_bs),                   # 14 monto exento
            f"{impuestos.tasa_iva(db):.2f}",           # 15 alicuota
            "0",                                       # 16 numero de expediente
        ])
        for r in q.retenciones
    ]
    contenido = "\r\n".join(lineas) + ("\r\n" if lineas else "")
    nombre = f"retenciones-iva-{periodo}-q{quincena}.txt"
    return StreamingResponse(
        iter([contenido.encode("utf-8")]),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{nombre}"'},
    )


@router.post("/retenciones-iva/enterar", response_model=schemas.RetencionesQuincena)
def enterar_retenciones(body: schemas.EnterarRetencionesRequest, db: Session = Depends(get_db)):
    """Registra el pago al SENIAT de lo retenido en una quincena."""
    q = armar_retenciones(db, body.anio, body.mes, body.quincena)
    if q.enterada:
        raise HTTPException(status_code=409, detail=f"La {q.etiqueta} ya se enteró.")
    if not q.retenciones:
        raise HTTPException(status_code=400, detail=f"La {q.etiqueta} no tiene retenciones que enterar.")
    if not contabilidad.metodo_de_pago_valido(body.forma_pago):
        raise HTTPException(status_code=400, detail="Se entera desde el Banco o desde una gaveta.")
    enterada = models.RetencionIvaEnterada(
        anio=body.anio, mes=body.mes, quincena=body.quincena, monto_bs=q.total_retenido_bs,
        monto=q.total_retenido, forma_pago=body.forma_pago, referencia=(body.referencia or "").strip(),
    )
    db.add(enterada)
    db.flush()
    contabilidad.registrar_enteramiento_retenciones(db, enterada)
    db.commit()
    return armar_retenciones(db, body.anio, body.mes, body.quincena)


@router.get("/libro-compras/seniat")
def libro_compras_seniat(rango: Rango = Depends(), db: Session = Depends(get_db)) -> StreamingResponse:
    """El Libro de Compras en bolivares, con el formato de la planilla del
    SENIAT (.xlsx)."""
    from .. import libros_seniat as seniat

    inicio, fin, _ = rango.resolver(periodo="mes")
    libro = libro_compras(rango, db)
    contenido = seniat.libro_compras(
        libro, impuestos.config(db), inicio.date(), (fin - datetime.timedelta(days=1)).date()
    )
    nombre = f"libro-compras-{nombre_de_archivo(libro.etiqueta)}.xlsx"
    return StreamingResponse(
        iter([contenido]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{nombre}"'},
    )


@router.get("/libro-compras/exportar")
def libro_compras_exportar(rango: Rango = Depends(), db: Session = Depends(get_db)) -> StreamingResponse:
    """El mismo Libro de Compras, como CSV para Excel."""
    libro = libro_compras(rango, db)
    filas = [
        (f.factura_id, f.fecha_emision.strftime("%d/%m/%Y"), f.fecha.strftime("%d/%m/%Y"),
         f.numero_factura, f.proveedor_nombre,
         f.proveedor_rif or "", f"{f.base_imponible:.2f}", f"{f.iva:.2f}", f"{f.total:.2f}")
        for f in libro.filas
    ]
    return respuesta_csv(
        f"libro-compras-{nombre_de_archivo(libro.etiqueta)}.csv",
        ["Factura", "Fecha factura", "Fecha registro", "N. Factura", "Proveedor", "RIF",
         "Base imponible", "IVA", "Total"],
        filas,
    )


@router.get("/resumen", response_model=schemas.ResumenIva)
def resumen_iva(rango: Rango = Depends(), db: Session = Depends(get_db)):
    ventas = libro_ventas(rango, db)
    compras = libro_compras(rango, db)
    periodo = rango.periodo or "rango"
    return schemas.ResumenIva(
        periodo=periodo,
        etiqueta=ventas.etiqueta,
        iva_debito=ventas.total_iva,
        iva_credito=compras.total_iva,
        iva_a_pagar=round(ventas.total_iva - compras.total_iva, 2),
        iva_debito_bs=ventas.total_iva_bs,
        iva_credito_bs=compras.total_iva_bs,
        iva_a_pagar_bs=round(ventas.total_iva_bs - compras.total_iva_bs, 2),
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
        iva_debito_bs=d.iva_debito_bs,
        iva_credito_bs=d.iva_credito_bs,
        credito_arrastrado_bs=d.credito_arrastrado_bs,
        credito_usado_bs=d.credito_usado_bs,
        iva_a_pagar_bs=d.iva_a_pagar_bs,
        credito_excedente_bs=d.credito_excedente_bs,
        retenciones_usadas=d.retenciones_usadas or 0,
        retenciones_bs=d.retenciones_bs,
        retenciones_arrastradas_bs=d.retenciones_arrastradas_bs,
        retenciones_usadas_bs=d.retenciones_usadas_bs,
        retenciones_excedente_bs=d.retenciones_excedente_bs,
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
            t = _totales_iva_del_rango(db, inicio, fin)
            # Un mes sin ventas ni compras no tiene nada que declarar: listarlo
            # solo llenaria la pantalla de meses vacios.
            if t["debito"] or t["credito"] or t["retenciones_bs"]:
                pendientes.append(
                    schemas.PeriodoPendiente(
                        anio=anio,
                        mes=mes,
                        etiqueta=f"{MESES_ES[mes - 1]} {anio}",
                        iva_debito=t["debito"],
                        iva_credito=t["credito"],
                        iva_debito_bs=t["debito_bs"],
                        iva_credito_bs=t["credito_bs"],
                        retenciones_bs=t["retenciones_bs"],
                        sin_tasa=t["sin_tasa"],
                    )
                )
        mes += 1
        if mes > 12:
            anio, mes = anio + 1, 1
    return pendientes


@router.post("/declaraciones", response_model=schemas.DeclaracionIva)
def declarar_iva(body: schemas.DeclararIvaRequest, db: Session = Depends(get_db)):
    if not 1 <= body.mes <= 12:
        raise HTTPException(status_code=400, detail="Mes inválido")

    hoy_ = hoy()
    if (body.anio, body.mes) >= (hoy_.year, hoy_.month):
        raise HTTPException(
            status_code=400,
            detail="Ese mes todavía no termina: declararlo fijaría un número que aún puede cambiar.",
        )

    existente = (
        db.query(models.DeclaracionIva).filter_by(anio=body.anio, mes=body.mes).first()
    )
    if existente:
        raise HTTPException(
            status_code=409, detail=f"El período {existente.periodo} ya fue declarado."
        )

    inicio, fin = _rango_del_mes(body.anio, body.mes)
    t = _totales_iva_del_rango(db, inicio, fin)
    if t["sin_tasa"]:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Hay {t['sin_tasa']} documento(s) de ese mes sin tasa de cambio: sin ella no hay "
                "bolívares que declarar. Cárgales la tasa en el libro y vuelve a declarar."
            ),
        )
    debito, credito = t["debito"], t["credito"]
    # Retenciones cobradas en caja (en dolares, en 1035) con comprobante de
    # este mes: las que el libro mayor descuenta.
    ret_usd = round(sum(
        p.retencion_iva_usd or 0
        for p in db.query(models.Pedido).filter(
            models.Pedido.retencion_iva_usd.isnot(None),
            models.Pedido.fecha_retencion_iva >= inicio.date(),
            models.Pedido.fecha_retencion_iva < fin.date(),
        )
    ), 2)

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
    ret_disp_usd = round(ret_usd + ((anterior.retenciones_excedente or 0) if anterior else 0), 2)
    ret_usadas_usd = round(min(ret_disp_usd, debito - usado), 2)
    a_pagar = round(debito - usado - ret_usadas_usd, 2)
    excedente = round(disponible - usado, 2)

    # Lo mismo en bolivares, que es lo que se declara. El excedente que viene
    # del mes anterior se arrastra en Bs; si ese mes se declaro antes de
    # existir los Bs, se pasa a la tasa de su ultimo dia.
    if anterior is None:
        arrastrado_bs = 0.0
    elif anterior.credito_excedente_bs is not None:
        arrastrado_bs = anterior.credito_excedente_bs
    else:
        _, fin_anterior = _rango_del_mes(anterior.anio, anterior.mes)
        fila_tasa = tasas.tasa_al(db, (fin_anterior - datetime.timedelta(days=1)).date())
        arrastrado_bs = round(anterior.credito_excedente * fila_tasa.bcv, 2) if fila_tasa else 0.0
    debito_bs, credito_bs = t["debito_bs"], t["credito_bs"]
    disponible_bs = round(credito_bs + arrastrado_bs, 2)
    usado_bs = round(min(disponible_bs, debito_bs), 2)
    # Despues del credito fiscal, las retenciones que hicieron los clientes:
    # bajan lo que queda por pagar, y lo que sobra se arrastra.
    ret_arrastradas = (anterior.retenciones_excedente_bs or 0.0) if anterior else 0.0
    ret_disponibles = round(t["retenciones_bs"] + ret_arrastradas, 2)
    ret_usadas = round(min(ret_disponibles, round(debito_bs - usado_bs, 2)), 2)

    declaracion = models.DeclaracionIva(
        anio=body.anio,
        mes=body.mes,
        iva_debito=debito,
        iva_credito=credito,
        credito_arrastrado=arrastrado,
        credito_usado=usado,
        iva_a_pagar=a_pagar,
        credito_excedente=excedente,
        iva_debito_bs=debito_bs,
        iva_credito_bs=credito_bs,
        credito_arrastrado_bs=arrastrado_bs,
        credito_usado_bs=usado_bs,
        iva_a_pagar_bs=round(debito_bs - usado_bs - ret_usadas, 2),
        credito_excedente_bs=round(disponible_bs - usado_bs, 2),
        retenciones_bs=t["retenciones_bs"],
        retenciones_arrastradas_bs=ret_arrastradas,
        retenciones_usadas_bs=ret_usadas,
        retenciones_excedente_bs=round(ret_disponibles - ret_usadas, 2),
        retenciones_usadas=ret_usadas_usd,
        retenciones_excedente=round(ret_disp_usd - ret_usadas_usd, 2),
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
        raise HTTPException(status_code=404, detail="Declaración no encontrada")
    if declaracion.pagada:
        raise HTTPException(status_code=409, detail="Esta declaración ya fue pagada")
    # Lo que se le paga al SENIAT es lo declarado en Bs.
    a_pagar = declaracion.iva_a_pagar_bs if declaracion.iva_a_pagar_bs is not None else declaracion.iva_a_pagar
    if a_pagar <= 0:
        raise HTTPException(
            status_code=400,
            detail="Este período no dejó IVA por pagar: el crédito fiscal cubrió el débito.",
        )
    if not contabilidad.metodo_de_pago_valido(body.forma_pago):
        raise HTTPException(
            status_code=400,
            detail="El IVA se paga desde el Banco o desde una gaveta (Efectivo Bs, Efectivo $)",
        )

    contabilidad.registrar_pago_iva(db, declaracion, body.forma_pago)
    declaracion.pagada = True
    declaracion.fecha_pago = ahora()
    declaracion.forma_pago = body.forma_pago
    db.commit()
    db.refresh(declaracion)
    return _a_schema(declaracion)


@router.post("/declaraciones/{declaracion_id}/anular")
def anular_declaracion(declaracion_id: int, db: Session = Depends(get_db)):
    """Deshace una declaracion mal hecha y libera el periodo.

    Antes no habia salida: no existia borrar y volver a declarar el mismo mes
    devolvia 409. Se revierten los asientos (el de la declaracion y el del
    pago, si lo hubo), se borra la fila y el mes vuelve a la lista de
    pendientes para declararlo bien.

    Solo se puede anular la ULTIMA declaracion: el excedente de credito fiscal
    se arrastra en cadena, asi que anular un mes con meses posteriores ya
    declarados dejaria mal el arrastre de todos los siguientes.
    """
    declaracion = (
        db.query(models.DeclaracionIva).filter(models.DeclaracionIva.id == declaracion_id).first()
    )
    if not declaracion:
        raise HTTPException(status_code=404, detail="Declaración no encontrada")

    posterior = (
        db.query(models.DeclaracionIva)
        .filter(
            (models.DeclaracionIva.anio > declaracion.anio)
            | (
                (models.DeclaracionIva.anio == declaracion.anio)
                & (models.DeclaracionIva.mes > declaracion.mes)
            )
        )
        .order_by(models.DeclaracionIva.anio, models.DeclaracionIva.mes)
        .first()
    )
    if posterior:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Primero hay que anular {MESES_ES[posterior.mes - 1]} {posterior.anio}: "
                "el credito fiscal se arrastra de un mes al siguiente y anular este "
                "dejaria mal el de los meses posteriores."
            ),
        )

    contabilidad.registrar_reverso_declaracion_iva(db, declaracion)
    etiqueta = f"{MESES_ES[declaracion.mes - 1]} {declaracion.anio}"
    db.delete(declaracion)
    db.commit()
    return {"ok": True, "periodo": etiqueta}
