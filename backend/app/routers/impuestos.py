import calendar
import datetime
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
        direccion=cfg.direccion or "",
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


def _totales_iva_del_rango(db: Session, inicio, fin) -> Tuple[float, float]:
    """(debito, credito) de un rango cualquiera, para declarar un mes puntual."""
    vigentes, notas = _ventas_del_libro(db, inicio, fin)
    debito = 0.0
    for p in vigentes:
        _base, iva = impuestos.desglosar(p.total, p.tasa_iva or impuestos.IVA_DEFAULT)
        debito += iva
    # Las notas de credito del periodo restan: es IVA que se declaro en su mes
    # y que ahora se devuelve.
    for p in notas:
        _base, iva = impuestos.desglosar(p.total, p.tasa_iva or impuestos.IVA_DEFAULT)
        debito -= iva

    # Neto de notas de credito: declarar el IVA bruto de una factura que el
    # proveedor ya acredito es deduccion indebida ante el SENIAT.
    credito = sum(
        f.iva_neto
        for f in db.query(models.FacturaCompra)
        .filter(models.FacturaCompra.fecha >= inicio, models.FacturaCompra.fecha < fin)
        .all()
    )
    return round(debito, 2), round(credito, 2)


@router.get("/libro-ventas", response_model=schemas.LibroVentas)
def libro_ventas(rango: Rango = Depends(), db: Session = Depends(get_db)):
    """Con `anio` y `mes` emite el libro de un periodo ya cerrado.

    Es requisito fiscal poder re-emitirlo: el SENIAT lo pide por periodo y el
    sistema solo sabia emitir el mes en curso.
    """
    inicio, fin, etiqueta = rango.resolver(periodo="mes")
    periodo = rango.periodo or "rango"

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
        """La venta en Bs a la tasa BCV congelada al cobrarla (o la guardada
        de ese dia, en ventas viejas). El IVA se desglosa sobre los Bs, como
        lo imprime la maquina fiscal."""
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
    )


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


def _filas_de_factura(f: models.FacturaCompra, tasa_pct: float, db: Session) -> List[schemas.FilaLibroCompras]:
    """La factura y, debajo, cada nota de credito que la afecta (en negativo),
    como pide el formato del SENIAT."""
    # Los Bs congelados al guardar; las facturas de antes no los tienen y se
    # pasan con la tasa guardada de su fecha de emision.
    estimada = f.gravado_bs is None
    tasa = f.tasa_bcv
    if tasa is None:
        fila_tasa = tasas.tasa_al(db, f.fecha_emision or f.fecha.date())
        tasa = fila_tasa.bcv if fila_tasa else None
    if tasa is not None and estimada:
        gravado_bs, exento_bs, iva_bs = impuestos.montos_bs(
            f.base_imponible, _gravado_usd(f, tasa_pct), f.iva, tasa,
            iva_de_la_base=bool(f.items), tasa_pct=tasa_pct,
        )
    else:
        gravado_bs, exento_bs, iva_bs = f.gravado_bs, f.exento_bs, f.iva_bs

    comun = dict(
        factura_id=f.id, fecha=f.fecha, proveedor_nombre=f.proveedor_nombre,
        proveedor_rif=f.proveedor_rif, numero_control=f.numero_control or "", moneda=f.moneda or "$",
    )
    filas = [schemas.FilaLibroCompras(**_fila_bs(dict(
        comun, tipo="FAC", fecha_emision=f.fecha_emision or f.fecha.date(),
        numero_factura=f.numero_factura,
        base_imponible=f.base_imponible, iva=f.iva, total=f.total,
    ), gravado_bs, exento_bs, iva_bs, tasa, estimada))]
    for n in sorted(f.notas_credito, key=lambda n: n.fecha):
        # La nota se pasa a Bs a la tasa de su factura: devuelve parte de esos
        # mismos bolivares.
        nota_bs = (
            impuestos.montos_bs(
                n.base_imponible, impuestos.gravado_de(n.base_imponible, n.iva or 0, tasa_pct),
                n.iva or 0, tasa, iva_de_la_base=False, tasa_pct=tasa_pct,
            ) if tasa is not None else (0, 0, 0)
        )
        filas.append(schemas.FilaLibroCompras(**_fila_bs(dict(
            comun, tipo="NC", fecha_emision=n.fecha.date(), numero_factura="",
            numero_nota=n.numero, factura_afectada=f.numero_factura, numero_control="",
            base_imponible=-round(n.base_imponible, 2), iva=-round(n.iva or 0, 2),
            total=-round(n.base_imponible + (n.iva or 0), 2),
        ), *nota_bs, tasa, estimada, signo=-1)))
    return filas


@router.get("/libro-compras", response_model=schemas.LibroCompras)
def libro_compras(rango: Rango = Depends(), db: Session = Depends(get_db)):
    inicio, fin, etiqueta = rango.resolver(periodo="mes")
    periodo = rango.periodo or "rango"
    tasa_pct = impuestos.tasa_iva(db)

    facturas = (
        db.query(models.FacturaCompra)
        .options(joinedload(models.FacturaCompra.items), joinedload(models.FacturaCompra.notas_credito))
        .filter(models.FacturaCompra.fecha >= inicio, models.FacturaCompra.fecha < fin)
        .order_by(models.FacturaCompra.fecha, models.FacturaCompra.id)
        .all()
    )

    # Las notas de credito van en el libro de su factura, igual que hasta
    # ahora se descontaban de ella: asi el libro y la declaracion de IVA (que
    # toma el IVA neto de cada factura) siguen diciendo lo mismo.
    filas = [fila for f in facturas for fila in _filas_de_factura(f, tasa_pct, db)]

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
        raise HTTPException(status_code=404, detail="Declaración no encontrada")
    if declaracion.pagada:
        raise HTTPException(status_code=409, detail="Esta declaración ya fue pagada")
    if declaracion.iva_a_pagar <= 0:
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
