import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload, selectinload

from .. import contabilidad, costeo, impuestos, kardex, models, schemas, tasas
from ..database import get_db
from ..rango import Rango
from ..timeutils import ahora, hoy, inicio_del_dia

router = APIRouter(prefix="/api/compras", tags=["compras"])


PORCENTAJES_RETENCION = (0, 75, 100)


def _siguiente_comprobante(db: Session, fecha: datetime.date) -> str:
    """AAAAMM + correlativo de 8 digitos. El correlativo sigue de un mes al
    otro (no vuelve a 1): asi un numero no se repite nunca."""
    ultimos = [
        c for (c,) in db.query(models.FacturaCompra.comprobante_retencion)
        .filter(models.FacturaCompra.comprobante_retencion != "")
        .all()
        if c and len(c) == 14 and c.isdigit()
    ]
    siguiente = max((int(c[6:]) for c in ultimos), default=0) + 1
    return f"{fecha.year:04d}{fecha.month:02d}{siguiente:08d}"


def _retencion(db: Session, factura, rif: str, iva: float, iva_bs) -> dict:
    """La retencion de IVA de una factura que se esta guardando, o nada si no
    se es agente de retencion o la factura no trae IVA."""
    if not impuestos.config(db).agente_retencion or iva <= 0:
        return {}
    proveedor = db.query(models.Proveedor).filter(models.Proveedor.rif == rif).first()
    pct = factura.retencion_pct
    if pct is None:
        pct = proveedor.porcentaje_retencion if proveedor and proveedor.porcentaje_retencion is not None else 75.0
    if pct not in PORCENTAJES_RETENCION:
        raise HTTPException(status_code=400, detail="La retención de IVA es de 75 % o 100 % (o 0 si no aplica).")
    # Se recuerda lo que se le retuvo a este proveedor para la proxima.
    if proveedor is not None and factura.retencion_pct is not None and pct:
        proveedor.porcentaje_retencion = pct
    if not pct:
        return {"retencion_pct": 0}
    fecha = hoy()
    return {
        "retencion_pct": pct,
        "iva_retenido": round(iva * pct / 100, 2),
        "iva_retenido_bs": round(iva_bs * pct / 100, 2) if iva_bs is not None else None,
        "comprobante_retencion": _siguiente_comprobante(db, fecha),
        "fecha_retencion": fecha,
    }


def _exento_de(item, ingredientes: dict) -> bool:
    """Si este renglon pago IVA.

    Manda lo que diga la factura que se esta cargando; la ficha del insumo es
    solo el valor por defecto. La misma mercancia puede venir exenta de un
    proveedor y gravada de otro, y quien tiene el papel delante es quien sabe.
    """
    if getattr(item, "exento", None) is not None:
        return bool(item.exento)
    return bool(ingredientes[item.ingrediente_id].exento)


def _referencia_del_pago(forma_pago: str, referencia) -> str:
    """El comprobante con que se le pago al proveedor, ya validado.

    Es la misma regla que al cobrar una venta y sale de la misma tabla
    (`contabilidad.METODOS_CON_REFERENCIA`): lo que no sale en billetes deja
    un numero en alguna parte. Pagarle al proveedor por transferencia sin
    anotarlo deja al negocio sin con que demostrar un pago que el proveedor
    dice no haber recibido, que es el mismo reclamo de siempre pero al reves.
    """
    limpia = (referencia or "").strip()
    if forma_pago in contabilidad.METODOS_CON_REFERENCIA and not limpia:
        raise HTTPException(
            status_code=400,
            detail=f"Un pago por {forma_pago} necesita su número de referencia",
        )
    return limpia


# Con renglones de gasto la categoria de la factura ya no la elige nadie: sale
# de lo que trae. Se sigue guardando porque los listados y las facturas viejas
# la usan para saber de que se trata.
_CATEGORIA_DE_CONCEPTO = {"Flete": "Servicios", "Servicio": "Servicios", "Equipo": "Activos", "Otro": "Otros"}


def _categoria_de(factura: schemas.FacturaCompraCreate) -> str:
    if not factura.gastos:
        return factura.categoria
    if factura.items:
        return "Insumos"
    categorias = {_CATEGORIA_DE_CONCEPTO[g.concepto] for g in factura.gastos}
    return categorias.pop() if len(categorias) == 1 else "Otros"


def _a_schema(factura: models.FacturaCompra) -> schemas.FacturaCompra:
    return schemas.FacturaCompra(
        id=factura.id,
        numero_factura=factura.numero_factura,
        proveedor_nombre=factura.proveedor_nombre,
        proveedor_rif=factura.proveedor_rif,
        fecha=factura.fecha,
        fecha_emision=factura.fecha_emision,
        numero_control=factura.numero_control or "",
        moneda=factura.moneda or "$",
        tasa_bcv=factura.tasa_bcv,
        retencion_pct=factura.retencion_pct or 0,
        iva_retenido=factura.iva_retenido or 0,
        iva_retenido_bs=factura.iva_retenido_bs,
        comprobante_retencion=factura.comprobante_retencion or "",
        a_pagar=factura.a_pagar,
        categoria=factura.categoria,
        forma_pago=factura.forma_pago,
        descripcion=factura.descripcion,
        base_imponible=factura.base_imponible,
        recargo=factura.recargo or 0,
        descuento=factura.descuento or 0,
        iva=factura.iva,
        total=factura.total,
        pagada=factura.pagada,
        fecha_vencimiento=factura.fecha_vencimiento,
        fecha_pago=factura.fecha_pago,
        referencia_pago=factura.referencia_pago or "",
        items=[
            schemas.LineaFactura(
                id=i.id,
                ingrediente_id=i.ingrediente_id,
                ingrediente_nombre=i.ingrediente.nombre,
                unidad=i.ingrediente.unidad,
                cantidad=i.cantidad,
                costo_unitario=i.costo_unitario,
                subtotal=i.subtotal,
                exento=bool(i.exento),
                tipo=i.ingrediente.tipo or "insumo",
                cuenta=i.cuenta or "",
            )
            for i in factura.items
        ],
        gastos=[schemas.LineaGasto.model_validate(g) for g in (factura.gastos or [])],
        abonado=factura.abonado,
        saldo=factura.saldo,
        reclamos=[_reclamo_a_schema(r) for r in (factura.reclamos or []) if r.estado == "abierto"],
        abonos=[schemas.AbonoFactura(id=a.id, fecha=a.fecha, monto=a.monto, forma_pago=a.forma_pago, referencia=a.referencia or "") for a in (factura.abonos or [])],
    )


@router.get("/facturas", response_model=List[schemas.FacturaCompra])
def listar_facturas(rango: Rango = Depends(), db: Session = Depends(get_db)):
    inicio, fin, _ = rango.resolver(dias=60)
    facturas = (
        db.query(models.FacturaCompra)
        .options(
            joinedload(models.FacturaCompra.items).joinedload(models.FacturaCompraItem.ingrediente),
            selectinload(models.FacturaCompra.gastos),
        )
        .filter(models.FacturaCompra.fecha >= inicio, models.FacturaCompra.fecha < fin)
        .order_by(models.FacturaCompra.id.desc())
        .all()
    )
    # Que facturas tienen la foto del papel, en una sola consulta.
    con_foto = {
        fid
        for (fid,) in db.query(models.SoporteFactura.factura_id).filter(
            models.SoporteFactura.factura_id.in_([f.id for f in facturas])
        )
    } if facturas else set()
    return [_a_schema(f).model_copy(update={"tiene_soporte": f.id in con_foto}) for f in facturas]


@router.post("/facturas", response_model=schemas.FacturaCompra)
def crear_factura(factura: schemas.FacturaCompraCreate, db: Session = Depends(get_db)):
    # Los renglones mueven stock igual que una compra suelta, asi que entran
    # por el mismo candado: sin el, dos facturas cargadas a la vez se pisaban
    # el promedio ponderado del mismo insumo.
    with costeo.bloqueo_inventario():
        return _crear_factura(factura, db)


def _crear_factura(factura: schemas.FacturaCompraCreate, db: Session) -> schemas.FacturaCompra:
    if factura.iva < 0:
        raise HTTPException(status_code=400, detail="El IVA no puede ser negativo")
    if factura.recargo < 0 or factura.descuento < 0:
        raise HTTPException(
            status_code=400,
            detail="El recargo y el descuento van en positivo: el signo lo pone el campo.",
        )

    # Sin RIF el Libro de Compras queda incompleto para el SENIAT. No se
    # valida el digito verificador -eso lo hace el SENIAT, no este ERP- pero
    # "V123" o dejarlo en blanco ya no puede pasar.
    if not impuestos.rif_valido(factura.proveedor_rif or ""):
        raise HTTPException(
            status_code=400,
            detail="El RIF del proveedor es obligatorio: letra (J/G/V/E/P/C) + 8 o 9 dígitos.",
        )
    factura_rif = impuestos.normalizar_rif(factura.proveedor_rif)
    # Un año cerrado no recibe facturas (8-oct): el asiento se podia mover al
    # año abierto, pero la factura quedaba en el Libro de Compras de un mes ya
    # declarado. La fecha del PAPEL puede ser vieja (`fecha_emision`); la de
    # registro, no.
    cerrado = contabilidad.ultimo_ejercicio_cerrado(db)
    if factura.fecha is not None and cerrado is not None and factura.fecha.year <= cerrado:
        raise HTTPException(
            status_code=409,
            detail=f"El {factura.fecha.year} ya está cerrado: una factura no puede registrarse en ese año, "
            "porque cambiaría un Libro de Compras ya declarado. Regístrala con la fecha de hoy; "
            "la fecha del papel va aparte, en «fecha de la factura».",
        )
    # La misma factura dos veces: se pregunta AQUI, dentro del candado, no
    # solo en la pantalla. Si dos tablets guardan a la vez, la segunda llega
    # cuando la primera ya entro y se rechaza en vez de duplicar el stock.
    if not factura.confirmar_duplicado:
        from .compras_lectura import _duplicadas

        ya = _duplicadas(db, schemas.RevisionFacturaRequest(
            proveedor_rif=factura_rif, proveedor_nombre=factura.proveedor_nombre,
            numero_factura=factura.numero_factura, items=[],
        ))
        if ya:
            raise HTTPException(
                status_code=409,
                detail=f"Ya está cargada: la {ya[0].numero_factura} de {ya[0].proveedor_nombre} "
                f"del {ya[0].fecha:%d/%m/%Y} por ${ya[0].total:.2f}. Guardarla otra vez duplica la mercancía.",
            )
    if factura.fecha_emision and factura.fecha_emision > hoy():
        raise HTTPException(status_code=400, detail="La fecha de la factura no puede ser futura.")
    if factura.moneda not in ("$", "Bs"):
        raise HTTPException(status_code=400, detail="La moneda de la factura es $ o Bs.")
    if factura.tasa_bcv is not None and factura.tasa_bcv <= 0:
        raise HTTPException(status_code=400, detail="La tasa de cambio debe ser mayor que cero.")
    # La tasa que pasa la factura a Bs en el Libro de Compras: la que manda
    # quien carga (la del papel, o la BCV de su fecha que propone el
    # formulario), o la BCV guardada de la fecha de emision.
    tasa_bcv = factura.tasa_bcv
    if tasa_bcv is None:
        fila_tasa = tasas.tasa_al(db, factura.fecha_emision or (factura.fecha or ahora()).date())
        tasa_bcv = fila_tasa.bcv if fila_tasa else None
    if factura.moneda == "Bs" and tasa_bcv is None:
        raise HTTPException(
            status_code=400,
            detail="Una factura en bolívares necesita la tasa con la que se pasó a dólares.",
        )
    # Antes de tocar stock ni costos: si falta el comprobante hay que rebotar
    # con la factura entera sin cargar, no a mitad de los renglones. A credito
    # no se pide, que todavia no ha salido plata.
    referencia_pago = (
        "" if factura.forma_pago == "Credito"
        else _referencia_del_pago(factura.forma_pago, factura.referencia_pago)
    )

    for g in factura.gastos:
        if g.concepto not in contabilidad.CUENTA_POR_CONCEPTO_GASTO:
            raise HTTPException(status_code=400, detail=f"«{g.concepto}» no es un concepto de gasto: Flete, Servicio, Equipo u Otro.")
        if g.monto <= 0:
            raise HTTPException(status_code=400, detail=f"El monto del renglón de {g.concepto.lower()} debe ser mayor a cero")
    ingredientes = {}
    if factura.items or factura.gastos:
        # Con renglones: la base la calcula el sistema sumando lo que de
        # verdad se compro, no lo que alguien tipeo aparte - evita que un
        # numero de cabecera quede desincronizado de sus propios renglones.
        db.expire_all()  # otro hilo pudo haber movido el stock de estos insumos
        if factura.items:
            ingredientes = {
                i.id: i
                for i in db.query(models.Ingrediente)
                .filter(models.Ingrediente.id.in_([it.ingrediente_id for it in factura.items]))
                .with_for_update(of=models.Ingrediente)
            }
        for item in factura.items:
            if item.ingrediente_id not in ingredientes:
                raise HTTPException(status_code=404, detail=f"Ingrediente {item.ingrediente_id} no existe")
            if item.cantidad <= 0:
                raise HTTPException(status_code=400, detail="La cantidad de cada renglón debe ser mayor a cero")
        bruta_exacta = sum(it.cantidad * it.costo_unitario for it in factura.items) + sum(
            g.monto for g in factura.gastos
        )
        base_bruta = round(bruta_exacta, 2)
        ajuste = round(factura.recargo - factura.descuento, 2)
        base_imponible = round(base_bruta + ajuste, 2)
        if base_imponible <= 0:
            raise HTTPException(
                status_code=400,
                detail=f"El descuento (${factura.descuento:.2f}) se come la factura entera "
                f"(${base_bruta:.2f}). Revisa el monto.",
            )
        # El recargo y el descuento se reparten ENTRE LOS RENGLONES, no se
        # anotan a un lado. Un flete de $10 en una compra de $100 hace que esa
        # mercancia de verdad cueste 10% mas, y el margen de cada plato tiene
        # que saberlo; dejarlo aparte mantendria el costo de receta mintiendo a
        # favor. Lo mismo al reves con un descuento por volumen.
        factor = base_imponible / base_bruta if base_bruta else 1.0

        # El IVA se calcula aca, no se confia en lo que mando el cliente: solo
        # asi el "exento" tiene efecto real. Sin esto, marcar la harina como
        # exenta no cambiaba un centavo del IVA de la factura.
        gravado_bruto = sum(
            it.cantidad * it.costo_unitario for it in factura.items if not _exento_de(it, ingredientes)
        ) + sum(g.monto for g in factura.gastos if not g.exento)
        base_gravada = round(gravado_bruto * factor, 2)
        iva_calculado = round(base_gravada * impuestos.tasa_iva(db) / 100, 2)
        # Lo mismo sin redondear, para los Bs del libro (ver impuestos.montos_bs).
        base_exacta = bruta_exacta + factura.recargo - factura.descuento
        gravado_exacto = gravado_bruto * (base_exacta / bruta_exacta if bruta_exacta else 1.0)
    else:
        if not factura.base_imponible or factura.base_imponible <= 0:
            raise HTTPException(status_code=400, detail="La base imponible debe ser mayor a cero")
        base_imponible = round(factura.base_imponible + factura.recargo - factura.descuento, 2)
        if base_imponible <= 0:
            raise HTTPException(
                status_code=400,
                detail=f"El descuento (${factura.descuento:.2f}) se come la factura entera. "
                "Revisa el monto.",
            )
        # Sin renglones el IVA lo teclea quien tiene el papel delante: no hay
        # nada que recalcular, y adivinarlo por regla de tres daria un numero
        # que no es el que dice la factura.
        iva_calculado = factura.iva
        factor = 1.0
        base_exacta = factura.base_imponible + factura.recargo - factura.descuento
        gravado_exacto = impuestos.gravado_de(base_exacta, factura.iva, impuestos.tasa_iva(db))

    gravado_bs = exento_bs = iva_bs = None
    if tasa_bcv:
        gravado_bs, exento_bs, iva_bs = impuestos.montos_bs(
            base_exacta, gravado_exacto, iva_calculado, tasa_bcv,
            iva_de_la_base=bool(factura.items or factura.gastos), tasa_pct=impuestos.tasa_iva(db),
        )

    retencion = _retencion(db, factura, factura_rif, iva_calculado, iva_bs)

    es_credito = factura.forma_pago == "Credito"
    categoria = _categoria_de(factura)
    db_factura = models.FacturaCompra(
        numero_factura=factura.numero_factura,
        proveedor_nombre=factura.proveedor_nombre,
        proveedor_rif=factura_rif,
        fecha=factura.fecha or ahora(),
        fecha_emision=factura.fecha_emision,
        categoria=categoria,
        forma_pago=factura.forma_pago,
        descripcion=factura.descripcion,
        base_imponible=base_imponible,
        recargo=round(factura.recargo, 2),
        descuento=round(factura.descuento, 2),
        iva=iva_calculado,
        # Efectivo/Banco: la plata ya salio al cargarla. Credito: queda
        # pendiente hasta que se registre el pago aparte.
        pagada=not es_credito,
        fecha_vencimiento=factura.fecha_vencimiento if es_credito else None,
        fecha_pago=None if es_credito else (factura.fecha or ahora()),
        referencia_pago=referencia_pago,
        numero_control=(factura.numero_control or "").strip(),
        moneda=factura.moneda,
        tasa_bcv=tasa_bcv,
        gravado_bs=gravado_bs,
        exento_bs=exento_bs,
        iva_bs=iva_bs,
        **retencion,
    )
    db.add(db_factura)
    db.flush()

    for item in factura.items:
        ingrediente = ingredientes[item.ingrediente_id]
        db.add(
            models.FacturaCompraItem(
                factura_id=db_factura.id,
                ingrediente_id=item.ingrediente_id,
                cantidad=item.cantidad,
                # El renglon guarda el precio que dice el papel, sin repartir:
                # es lo que hay que poder cotejar con la factura del proveedor.
                costo_unitario=item.costo_unitario,
                exento=_exento_de(item, ingredientes),
                # La cuenta la decide el tipo de la mercancia: la carne al
                # inventario, las servilletas a gasto. Una factura trae las dos.
                cuenta=contabilidad.cuenta_de_articulo(ingrediente),
            )
        )
        # Un desechable no lleva stock: no hay forma de atarlo a lo vendido
        # (un pastelito puede llevarse 40 servilletas). Va entero a gasto.
        if ingrediente.tipo == "desechable":
            continue
        # El costo del insumo se promedia con lo que ya habia - mismo motor
        # que "Registrar compra" en Inventario (ver costeo.py), para que las
        # dos vias de cargar una compra lleguen siempre al mismo numero. Aca si
        # va el costo repartido: al inventario entra lo que la mercancia costo
        # de verdad, flete y descuentos incluidos, y asi la suma de las
        # entradas cuadra exactamente con la base de la factura.
        costeo.registrar_entrada(
            ingrediente, item.cantidad, round(item.costo_unitario * factor, 6), db,
            origen="factura", referencia_id=db_factura.id,
            nota=f"Factura {db_factura.numero_factura} - {db_factura.proveedor_nombre}",
        )

    gastos = []
    for g in factura.gastos:
        gasto = models.FacturaCompraGasto(
            factura_id=db_factura.id,
            concepto=g.concepto,
            descripcion=(g.descripcion or "").strip(),
            monto=round(g.monto, 2),
            exento=g.exento,
            cuenta=contabilidad.CUENTA_POR_CONCEPTO_GASTO[g.concepto],
        )
        db.add(gasto)
        gastos.append((gasto, g))

    db.flush()
    db.refresh(db_factura, ["gastos"])
    contabilidad.registrar_factura_compra(db, db_factura)

    # Un equipo comprado renglon por renglon nace como bien, con el recargo o
    # el descuento que le toca, igual que la mercancia.
    for gasto, g in gastos:
        if gasto.concepto == "Equipo":
            db.add(
                models.ActivoFijo(
                    nombre=gasto.descripcion or f"Equipo (fact. {db_factura.numero_factura})",
                    valor=round(gasto.monto * factor, 2),
                    fecha_compra=db_factura.fecha,
                    vida_util_meses=g.vida_util_meses or 60,
                    factura_id=db_factura.id,
                )
            )

    # Una compra de activos crea el bien para que empiece a depreciarse. Antes
    # entraba a 1050 y se quedaba ahi a valor de compra para siempre.
    if db_factura.categoria == "Activos" and not factura.gastos:
        db.add(
            models.ActivoFijo(
                nombre=db_factura.descripcion or f"Activo (fact. {db_factura.numero_factura})",
                valor=db_factura.base_imponible,
                fecha_compra=db_factura.fecha,
                vida_util_meses=factura.vida_util_meses or 60,
                factura_id=db_factura.id,
            )
        )

    db.commit()
    db.refresh(db_factura)
    return _a_schema(db_factura)


@router.post("/facturas/{factura_id}/pagar", response_model=schemas.FacturaCompra)
def pagar_factura(factura_id: int, pago: schemas.PagoFacturaRequest, db: Session = Depends(get_db)):
    db_factura = (
        db.query(models.FacturaCompra)
        .options(joinedload(models.FacturaCompra.items).joinedload(models.FacturaCompraItem.ingrediente))
        .filter(models.FacturaCompra.id == factura_id)
        .first()
    )
    if not db_factura:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    if db_factura.forma_pago != "Credito":
        raise HTTPException(status_code=400, detail="Esta factura no quedó a crédito")
    if db_factura.pagada:
        raise HTTPException(status_code=409, detail="Esta factura ya está pagada")
    if not contabilidad.metodo_de_pago_valido(pago.forma_pago):
        raise HTTPException(
            status_code=400,
            detail="La factura se paga desde una gaveta (Efectivo Bs, Efectivo $) o del Banco",
        )

    referencia = _referencia_del_pago(pago.forma_pago, pago.referencia)

    contabilidad.registrar_pago_factura(db, db_factura, pago.forma_pago)
    db_factura.pagada = True
    db_factura.fecha_pago = ahora()
    db_factura.referencia_pago = referencia
    db.commit()
    db.refresh(db_factura)
    return _a_schema(db_factura)


@router.post("/facturas/{factura_id}/abonos", response_model=schemas.FacturaCompra)
def abonar_factura(factura_id: int, body: schemas.AbonoFacturaRequest, db: Session = Depends(get_db)):
    """Un pago a cuenta de una factura a credito. Cuando lo abonado llega al
    total, la factura queda pagada sola."""
    db_factura = db.query(models.FacturaCompra).filter(models.FacturaCompra.id == factura_id).first()
    if not db_factura:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    if db_factura.forma_pago != "Credito":
        raise HTTPException(status_code=400, detail="Esta factura no quedó a crédito")
    if db_factura.pagada:
        raise HTTPException(status_code=409, detail="Esta factura ya está pagada")
    if not contabilidad.metodo_de_pago_valido(body.forma_pago):
        raise HTTPException(status_code=400, detail="El abono sale de una gaveta (Efectivo Bs, Efectivo $) o del Banco")
    monto = round(body.monto, 2)
    if monto > db_factura.saldo + 0.005:
        raise HTTPException(
            status_code=400,
            detail=f"El abono (${monto:.2f}) es mayor que lo que se debe (${db_factura.saldo:.2f}).",
        )
    referencia = _referencia_del_pago(body.forma_pago, body.referencia)
    contabilidad.registrar_pago_factura(db, db_factura, body.forma_pago, monto)
    db.add(models.FacturaCompraAbono(factura_id=db_factura.id, monto=monto, forma_pago=body.forma_pago, referencia=referencia or ""))
    db.flush()
    db.refresh(db_factura)
    if db_factura.saldo <= 0.005:
        db_factura.pagada = True
        db_factura.fecha_pago = ahora()
        db_factura.referencia_pago = referencia
    db.commit()
    db.refresh(db_factura)
    return _a_schema(db_factura)


@router.get("/facturas/{factura_id}/notas-credito", response_model=List[schemas.NotaCreditoCompra])
def listar_notas_credito(factura_id: int, db: Session = Depends(get_db)):
    factura = _factura_o_404(db, factura_id)
    return [_nota_a_schema(n) for n in factura.notas_credito]


@router.post("/facturas/{factura_id}/notas-credito", response_model=schemas.NotaCreditoCompra)
def crear_nota_credito(
    factura_id: int, body: schemas.NotaCreditoCompraCreate, db: Session = Depends(get_db)
):
    """Nota de credito del proveedor: el espejo de la devolucion de venta.

    Antes no existia. Si el proveedor facturaba 10 kg y mandaba 8, la factura
    no se podia borrar (con razon: deshacer un promedio ponderado ya mezclado
    es peligroso) y la unica salida que ofrecia el mensaje de error era un
    ajuste de inventario, que registra la diferencia como MERMA. Eso dejaba
    tres cosas mal a la vez: una perdida que no ocurrio, credito fiscal de mas
    en el Libro de Compras, y una deuda inflada con el proveedor.

    Son dos casos con asientos distintos:
      - devolucion: la mercancia vuelve. Sale stock y sale valor; el costo por
        unidad no se mueve, porque lo que se devuelve costaba lo mismo.
      - descuento: te quedas la mercancia y rebajan el precio. El stock no se
        toca y el costo por unidad BAJA, que es lo que de verdad paso.
    """
    with costeo.bloqueo_inventario():
        factura = _factura_o_404(db, factura_id)

        if body.tipo not in ("devolucion", "descuento", "faltante"):
            raise HTTPException(
                status_code=400, detail="El tipo debe ser 'devolucion', 'descuento' o 'faltante'"
            )
        abiertos = [r for r in factura.reclamos if r.estado == "abierto"]
        if body.tipo == "faltante":
            if not abiertos:
                raise HTTPException(status_code=400, detail="Esa factura no tiene faltantes pendientes con el proveedor.")
            # Sin renglones: la nota cubre todo lo que se reclamo.
            if not body.items:
                body.items = [schemas.NotaCreditoItemCreate(ingrediente_id=r.ingrediente_id, cantidad=r.cantidad) for r in abiertos]

        fecha = body.fecha or ahora()
        _bloquear_si_periodo_declarado(db, fecha, factura)

        if body.tipo == "devolucion":
            base, lineas = _lineas_de_devolucion(db, factura, body)
        elif body.tipo == "faltante":
            base, lineas = _lineas_de_faltante(db, factura, body, abiertos)
        else:
            base, lineas = _base_de_descuento(body), []

        if base <= 0:
            raise HTTPException(status_code=400, detail="La nota de crédito debe ser mayor a cero")

        disponible = round(factura.base_neta, 2)
        if base > disponible + 0.01:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"La nota es por ${base:.2f} pero de esa factura solo quedan "
                    f"${disponible:.2f} sin acreditar."
                ),
            )

        # Si no lo dicen, el IVA se prorratea al mismo porcentaje de la factura:
        # acreditar base sin acreditar su IVA dejaria credito fiscal de mas.
        if body.iva is not None:
            iva = round(body.iva, 2)
        elif factura.base_imponible:
            iva = round(factura.iva * (base / factura.base_imponible), 2)
        else:
            iva = 0.0

        nota = models.NotaCreditoCompra(
            factura_id=factura.id,
            numero=body.numero,
            tipo=body.tipo,
            fecha=fecha,
            base_imponible=round(base, 2),
            iva=iva,
            motivo=body.motivo,
        )
        db.add(nota)
        db.flush()

        for ingrediente, cantidad, costo in lineas:
            es_desechable = ingrediente.tipo == "desechable"
            db.add(
                models.NotaCreditoCompraItem(
                    nota_id=nota.id,
                    ingrediente_id=ingrediente.id,
                    cantidad=cantidad,
                    costo_unitario=costo,
                )
            )
            # La mercancia se va: sale del stock al costo al que entro. El
            # promedio ponderado no se toca, porque lo devuelto costaba
            # exactamente lo que el resto de esa factura. Un desechable nunca
            # entro al stock: solo se acredita el gasto.
            # Un faltante ya salio del deposito cuando se reclamo.
            if es_desechable or body.tipo == "faltante":
                continue
            kardex.anotar(
                db, ingrediente, -cantidad, kardex.DEVOLUCION_PROVEEDOR,
                costo_unitario=costo, origen="nota_credito", referencia_id=nota.id,
                nota=f"Nota {nota.numero} a {factura.proveedor_nombre}: {body.motivo or 'devolucion'}",
            )

        if body.tipo == "descuento":
            _abaratar_insumos(db, factura, base)

        if body.tipo == "faltante":
            # La nota salda el reclamo: baja 1045, no el inventario.
            porciones = [("1045", nota.base_imponible)]
            _cerrar_reclamos(abiertos, body.items, nota.id)
        elif body.tipo == "devolucion" and factura.items:
            # Cada renglon devuelto vuelve a la cuenta por la que entro.
            concepto = contabilidad.CUENTA_POR_CATEGORIA_COMPRA.get(factura.categoria, "6010")
            cuenta_de = {i.ingrediente_id: (i.cuenta or concepto) for i in factura.items}
            por_cuenta = {}
            for ingrediente, cantidad, costo in lineas:
                c = cuenta_de.get(ingrediente.id, concepto)
                por_cuenta[c] = por_cuenta.get(c, 0) + cantidad * costo
            cuentas = sorted(por_cuenta)
            porciones, repartido = [], 0.0
            for n, c in enumerate(cuentas):
                monto = round(nota.base_imponible - repartido, 2) if n == len(cuentas) - 1 else round(por_cuenta[c], 2)
                repartido += monto
                porciones.append((c, monto))
        else:
            porciones = contabilidad.porciones_de_factura(factura, nota.base_imponible)
        contabilidad.registrar_nota_credito_compra(db, nota, porciones)
        db.commit()
        db.refresh(nota)
        return _nota_a_schema(nota)


def _factura_o_404(db: Session, factura_id: int) -> models.FacturaCompra:
    factura = (
        db.query(models.FacturaCompra)
        .options(joinedload(models.FacturaCompra.items))
        .filter(models.FacturaCompra.id == factura_id)
        .first()
    )
    if not factura:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    return factura


def _bloquear_si_periodo_declarado(
    db: Session, fecha: datetime.datetime, factura: models.FacturaCompra
):
    """Una nota de credito cambia el Libro de Compras del mes de la factura.

    Si ese mes ya se le presento al SENIAT, reescribirlo en silencio seria
    peor que el problema: hace falta una declaracion sustitutiva. Mismo
    criterio que ya se aplica a las devoluciones de venta.
    """
    declarada = (
        db.query(models.DeclaracionIva)
        .filter(
            models.DeclaracionIva.anio == factura.fecha.year,
            models.DeclaracionIva.mes == factura.fecha.month,
        )
        .first()
    )
    if declarada:
        raise HTTPException(
            status_code=409,
            detail=(
                f"El IVA de {declarada.periodo} ya fue declarado y esta nota cambiaria "
                "ese Libro de Compras. Anula esa declaracion primero (Impuestos) y "
                "vuelve a declarar el periodo con la nota ya cargada."
            ),
        )


def _reclamo_a_schema(r: models.ReclamoProveedor) -> schemas.Reclamo:
    return schemas.Reclamo(
        id=r.id, factura_id=r.factura_id, ingrediente_id=r.ingrediente_id,
        ingrediente_nombre=r.ingrediente.nombre, unidad=r.ingrediente.unidad,
        cantidad=r.cantidad, valor=r.valor, motivo=r.motivo or "", fecha=r.fecha, estado=r.estado,
        numero_factura=r.factura.numero_factura if r.factura else "",
        proveedor_nombre=r.factura.proveedor_nombre if r.factura else "",
    )


def _lineas_de_faltante(db: Session, factura: models.FacturaCompra, body, abiertos):
    """Los renglones de una nota que salda faltantes: no mas de lo reclamado."""
    reclamado = {}
    for r in abiertos:
        reclamado[r.ingrediente_id] = reclamado.get(r.ingrediente_id, 0) + r.cantidad
    costo_de = {r.ingrediente_id: r.costo_unitario for r in abiertos}
    base, lineas = 0.0, []
    for it in body.items:
        if it.cantidad <= 0 or it.cantidad > reclamado.get(it.ingrediente_id, 0) + 0.0001:
            raise HTTPException(
                status_code=409,
                detail=f"De esa mercancía se reclamaron {round(reclamado.get(it.ingrediente_id, 0), 4)}: la nota no puede ser por más.",
            )
        ing = db.get(models.Ingrediente, it.ingrediente_id)
        base += it.cantidad * costo_de[it.ingrediente_id]
        lineas.append((ing, it.cantidad, costo_de[it.ingrediente_id]))
    return round(base, 2), lineas


def _cerrar_reclamos(abiertos, items, nota_id: int) -> None:
    """Marca acreditado lo que cubre la nota (y parte un reclamo si cubre menos)."""
    for it in items:
        falta = it.cantidad
        for r in abiertos:
            if falta <= 0.0001 or r.ingrediente_id != it.ingrediente_id or r.estado != "abierto":
                continue
            if r.cantidad <= falta + 0.0001:
                falta -= r.cantidad
                r.estado, r.nota_id = "acreditado", nota_id
            else:
                # La nota cubrio una parte: lo cubierto se cierra, el resto sigue abierto.
                r.cantidad = round(r.cantidad - falta, 6)
                r.factura.reclamos.append(models.ReclamoProveedor(
                    factura_id=r.factura_id, ingrediente_id=r.ingrediente_id, cantidad=falta,
                    costo_unitario=r.costo_unitario, cuenta=r.cuenta, motivo=r.motivo,
                    fecha=r.fecha, estado="acreditado", nota_id=nota_id,
                ))
                falta = 0


@router.post("/facturas/{factura_id}/faltantes", response_model=schemas.FacturaCompra)
def anotar_faltantes(factura_id: int, body: schemas.FaltanteRequest, db: Session = Depends(get_db)):
    """La factura dice 10 kg y llegaron 8: los 2 que faltan salen del deposito
    y quedan como reclamo al proveedor (1045), no como merma."""
    with costeo.bloqueo_inventario():
        factura = _factura_o_404(db, factura_id)
        if not body.items:
            raise HTTPException(status_code=400, detail="Di qué mercancía no llegó y cuánto.")
        por_ingrediente = {i.ingrediente_id: i for i in factura.items}
        ya = {}
        for n in factura.notas_credito:
            for it in n.items:
                ya[it.ingrediente_id] = ya.get(it.ingrediente_id, 0) + it.cantidad
        for r in factura.reclamos:
            if r.estado in ("abierto", "perdido"):
                ya[r.ingrediente_id] = ya.get(r.ingrediente_id, 0) + r.cantidad
        concepto = contabilidad.CUENTA_POR_CATEGORIA_COMPRA.get(factura.categoria, "6010")
        lineas = []
        for it in body.items:
            linea = por_ingrediente.get(it.ingrediente_id)
            if linea is None:
                raise HTTPException(status_code=400, detail=f"La mercancía {it.ingrediente_id} no está en esa factura")
            restante = linea.cantidad - ya.get(it.ingrediente_id, 0)
            if it.cantidad <= 0 or it.cantidad > restante + 0.0001:
                raise HTTPException(
                    status_code=409,
                    detail=f"De {linea.ingrediente.nombre} la factura trae {linea.cantidad} {linea.ingrediente.unidad}; "
                    f"quedan {round(restante, 4)} que puedan faltar.",
                )
            ing = (
                db.query(models.Ingrediente).filter(models.Ingrediente.id == it.ingrediente_id)
                .with_for_update(of=models.Ingrediente).first()
            )
            lineas.append((ing, it.cantidad, linea.costo_unitario, linea.cuenta or concepto))
        total = 0.0
        por_cuenta = {}
        for ing, cantidad, costo, cuenta in lineas:
            r = models.ReclamoProveedor(
                factura_id=factura.id, ingrediente_id=ing.id, cantidad=cantidad,
                costo_unitario=costo, cuenta=cuenta, motivo=body.motivo,
            )
            db.add(r)
            db.flush()
            valor = round(cantidad * costo, 2)
            total += valor
            por_cuenta[cuenta] = por_cuenta.get(cuenta, 0) + valor
            if ing.tipo != "desechable":
                kardex.anotar(
                    db, ing, -cantidad, kardex.DEVOLUCION_PROVEEDOR, costo_unitario=costo,
                    origen="reclamo_proveedor", referencia_id=r.id,
                    nota=f"No llegó (fact. {factura.numero_factura}): {body.motivo or 'faltante'}",
                )
        contabilidad.crear_asiento(
            db, f"Faltante reclamado a {factura.proveedor_nombre} (fact. {factura.numero_factura})",
            [("1045", round(total, 2), 0.0)] + [(c, 0.0, round(v, 2)) for c, v in por_cuenta.items()],
            origen="reclamo_proveedor", referencia_id=factura.id,
        )
        db.commit()
        db.refresh(factura)
        return _a_schema(factura)


@router.get("/reclamos", response_model=List[schemas.Reclamo])
def listar_reclamos(db: Session = Depends(get_db)):
    """Lo que los proveedores deben todavia: lo que no llego y sin nota."""
    return [
        _reclamo_a_schema(r)
        for r in db.query(models.ReclamoProveedor).filter(models.ReclamoProveedor.estado == "abierto")
        .order_by(models.ReclamoProveedor.fecha).all()
    ]


@router.post("/reclamos/{reclamo_id}/perder", response_model=schemas.Reclamo)
def dar_por_perdido(reclamo_id: int, db: Session = Depends(get_db)):
    """El proveedor nunca mando la nota: entonces si es una perdida."""
    r = db.get(models.ReclamoProveedor, reclamo_id)
    if r is None:
        raise HTTPException(status_code=404, detail="Reclamo no encontrado")
    if r.estado != "abierto":
        raise HTTPException(status_code=409, detail="Ese reclamo ya está cerrado")
    r.estado = "perdido"
    contabilidad.crear_asiento(
        db, f"Faltante no acreditado por {r.factura.proveedor_nombre} (fact. {r.factura.numero_factura})",
        [("6020", r.valor, 0.0), ("1045", 0.0, r.valor)],
        origen="reclamo_perdido", referencia_id=r.id,
    )
    db.commit()
    db.refresh(r)
    return _reclamo_a_schema(r)


def _lineas_de_devolucion(db: Session, factura: models.FacturaCompra, body):
    """Valida los renglones devueltos contra los de la factura."""
    if not body.items:
        raise HTTPException(
            status_code=400,
            detail="Una devolución necesita decir qué mercancía vuelve y cuánto de cada una",
        )

    por_ingrediente = {i.ingrediente_id: i for i in factura.items}
    ya_devuelto = {}
    for nota in factura.notas_credito:
        for item in nota.items:
            ya_devuelto[item.ingrediente_id] = (
                ya_devuelto.get(item.ingrediente_id, 0) + item.cantidad
            )
    # Lo que se reclamo como faltante tampoco esta para devolver.
    for r in factura.reclamos:
        if r.estado in ("abierto", "perdido"):
            ya_devuelto[r.ingrediente_id] = ya_devuelto.get(r.ingrediente_id, 0) + r.cantidad

    base = 0.0
    lineas = []
    for pedido_item in body.items:
        linea = por_ingrediente.get(pedido_item.ingrediente_id)
        if linea is None:
            raise HTTPException(
                status_code=400,
                detail=f"La mercancía {pedido_item.ingrediente_id} no está en esa factura",
            )
        if pedido_item.cantidad <= 0:
            raise HTTPException(status_code=400, detail="La cantidad debe ser mayor a cero")

        restante = linea.cantidad - ya_devuelto.get(pedido_item.ingrediente_id, 0)
        if pedido_item.cantidad > restante + 0.0001:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"De {linea.ingrediente.nombre} la factura trae {linea.cantidad} "
                    f"{linea.ingrediente.unidad} y quedan {round(restante, 4)} por devolver."
                ),
            )
        ingrediente = (
            db.query(models.Ingrediente)
            .filter(models.Ingrediente.id == pedido_item.ingrediente_id)
            .with_for_update(of=models.Ingrediente)
            .first()
        )
        base += pedido_item.cantidad * linea.costo_unitario
        lineas.append((ingrediente, pedido_item.cantidad, linea.costo_unitario))

    return round(base, 2), lineas


def _base_de_descuento(body) -> float:
    if body.base_imponible is None or body.base_imponible <= 0:
        raise HTTPException(
            status_code=400, detail="Un descuento necesita el monto acreditado (base imponible)"
        )
    return round(body.base_imponible, 2)


def _abaratar_insumos(db: Session, factura: models.FacturaCompra, rebaja: float):
    """Un descuento hace que lo comprado haya costado menos.

    Se reparte la rebaja entre los renglones de la factura en proporcion a lo
    que pesa cada uno, y se le baja el costo promedio al insumo por la parte
    que todavia esta en el deposito. Sin esto el costo quedaba inflado para
    siempre y el margen del menu mentia hacia abajo.
    """
    if not factura.items or factura.base_imponible <= 0:
        return
    for linea in factura.items:
        peso = (linea.cantidad * linea.costo_unitario) / factura.base_imponible
        rebaja_linea = rebaja * peso
        ingrediente = (
            db.query(models.Ingrediente)
            .filter(models.Ingrediente.id == linea.ingrediente_id)
            .with_for_update(of=models.Ingrediente)
            .first()
        )
        if ingrediente is None or (ingrediente.stock_actual or 0) <= 0:
            continue
        # Solo se abarata lo que queda en existencia: lo ya vendido se costeo
        # con el precio de entonces y su margen historico esta congelado.
        en_deposito = min(linea.cantidad, ingrediente.stock_actual)
        if en_deposito <= 0:
            continue
        baja_unitaria = (rebaja_linea * (en_deposito / linea.cantidad)) / ingrediente.stock_actual
        ingrediente.costo_unitario = round(
            max((ingrediente.costo_unitario or 0) - baja_unitaria, 0), 4
        )


def _nota_a_schema(n: models.NotaCreditoCompra) -> schemas.NotaCreditoCompra:
    return schemas.NotaCreditoCompra(
        id=n.id,
        factura_id=n.factura_id,
        numero=n.numero,
        tipo=n.tipo,
        fecha=n.fecha,
        base_imponible=n.base_imponible,
        iva=n.iva,
        total=n.total,
        motivo=n.motivo or "",
        items=[
            schemas.NotaCreditoItem(
                id=i.id,
                ingrediente_id=i.ingrediente_id,
                ingrediente_nombre=i.ingrediente.nombre,
                unidad=i.ingrediente.unidad,
                cantidad=i.cantidad,
                costo_unitario=i.costo_unitario,
                subtotal=round(i.cantidad * i.costo_unitario, 2),
            )
            for i in n.items
        ],
    )


@router.delete("/facturas/{factura_id}")
def eliminar_factura(factura_id: int, db: Session = Depends(get_db)):
    db_factura = (
        db.query(models.FacturaCompra)
        .options(joinedload(models.FacturaCompra.items))
        .filter(models.FacturaCompra.id == factura_id)
        .first()
    )
    if not db_factura:
        raise HTTPException(status_code=404, detail="Factura no encontrada")
    if db_factura.items:
        # Revertir esta factura significaria deshacer un promedio ponderado
        # que ya se mezclo con compras posteriores - no es reversible sin
        # arriesgar dejar el costo del insumo mal. Mas seguro bloquearlo,
        # igual que ya hacemos con un pedido cobrado.
        raise HTTPException(
            status_code=409,
            detail="Esta factura ya actualizó el stock y no se puede borrar. "
            "Si fue un error, registra un ajuste de inventario para corregir el stock.",
        )
    if db_factura.abonos:
        raise HTTPException(
            status_code=409,
            detail="Esta factura ya tiene abonos con su asiento de pago: no se puede borrar.",
        )
    if db_factura.forma_pago == "Credito" and db_factura.pagada:
        # Ya hay un asiento de pago real (plata que de verdad salio de caja o
        # banco) referenciando esta factura - borrarla lo dejaria huerfano.
        raise HTTPException(
            status_code=409,
            detail="Esta factura ya fue pagada y tiene un asiento de pago asociado, no se puede borrar.",
        )
    # Un año cerrado no se toca: borrar una factura de 2025 cambiaria el
    # resultado que ya se llevo a Utilidades retenidas.
    try:
        contabilidad.asegurar_ejercicio_abierto(db, db_factura.fecha, "esa factura")
    except contabilidad.ErrorEjercicioCerrado as e:
        raise HTTPException(status_code=409, detail=str(e))
    # La factura de un activo creo el bien. Borrarla sin borrar el bien lo
    # dejaba vivo y depreciandose contra nada -- y con las claves foraneas
    # activas ni siquiera eso: la base rechazaba el borrado con un 500.
    for activo in db.query(models.ActivoFijo).filter_by(factura_id=factura_id).all():
        if contabilidad.depreciacion_acumulada(db, activo) > 0:
            raise HTTPException(
                status_code=409,
                detail=f"El equipo «{activo.nombre}» que nació de esta factura ya lleva "
                f"depreciacion asentada: dalo de baja desde Contabilidad en vez de borrar la factura.",
            )
        db.delete(activo)
    # Sin esto el asiento contable de la factura queda huerfano en los libros.
    # Uno por uno con db.delete(): un DELETE masivo sobre el query NO dispara el
    # cascade del ORM y dejaria vivos los movimientos, que el balance de
    # comprobacion sigue sumando aunque su asiento ya no exista.
    for asiento in (
        db.query(models.AsientoContable)
        .filter(
            models.AsientoContable.origen == "factura_compra",
            models.AsientoContable.referencia_id == factura_id,
        )
        .all()
    ):
        db.delete(asiento)
    db.delete(db_factura)
    db.commit()
    return {"ok": True}
