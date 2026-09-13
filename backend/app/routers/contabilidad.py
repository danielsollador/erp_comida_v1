import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import contabilidad, models, schemas
from ..database import get_db
from ..timeutils import ahora, hoy, rango_periodo

router = APIRouter(prefix="/api/contabilidad", tags=["contabilidad"])


@router.get("/plan-cuentas", response_model=List[schemas.CuentaContable])
def listar_cuentas(db: Session = Depends(get_db)):
    return db.query(models.CuentaContable).order_by(models.CuentaContable.codigo).all()


@router.post("/plan-cuentas", response_model=schemas.CuentaContable)
def crear_cuenta(cuenta: schemas.CuentaContableCreate, db: Session = Depends(get_db)):
    if cuenta.naturaleza not in ("deudora", "acreedora"):
        raise HTTPException(status_code=400, detail="Naturaleza debe ser 'deudora' o 'acreedora'")
    existe = (
        db.query(models.CuentaContable).filter(models.CuentaContable.codigo == cuenta.codigo).first()
    )
    if existe:
        raise HTTPException(status_code=409, detail=f"Ya existe la cuenta {cuenta.codigo}")
    db_cuenta = models.CuentaContable(**cuenta.model_dump())
    db.add(db_cuenta)
    db.commit()
    db.refresh(db_cuenta)
    return db_cuenta


def _asiento_a_schema(asiento: models.AsientoContable) -> schemas.AsientoContable:
    return schemas.AsientoContable(
        id=asiento.id,
        fecha=asiento.fecha,
        descripcion=asiento.descripcion,
        origen=asiento.origen,
        referencia_id=asiento.referencia_id,
        movimientos=[
            schemas.MovimientoContable(
                id=m.id,
                cuenta_id=m.cuenta_id,
                cuenta_codigo=m.cuenta.codigo,
                cuenta_nombre=m.cuenta.nombre,
                debe=m.debe,
                haber=m.haber,
            )
            for m in asiento.movimientos
        ],
    )


@router.get("/asientos", response_model=List[schemas.AsientoContable])
def listar_asientos(limite: int = 100, db: Session = Depends(get_db)):
    asientos = (
        db.query(models.AsientoContable)
        .options(joinedload(models.AsientoContable.movimientos).joinedload(models.MovimientoContable.cuenta))
        .order_by(models.AsientoContable.id.desc())
        .limit(limite)
        .all()
    )
    return [_asiento_a_schema(a) for a in asientos]


@router.post("/asientos", response_model=schemas.AsientoContable)
def crear_asiento_manual(body: schemas.AsientoCreate, db: Session = Depends(get_db)):
    if len(body.lineas) < 2:
        raise HTTPException(status_code=400, detail="Un asiento necesita al menos 2 lineas")

    lineas = []
    for linea in body.lineas:
        cuenta = db.query(models.CuentaContable).filter(models.CuentaContable.id == linea.cuenta_id).first()
        if not cuenta:
            raise HTTPException(status_code=404, detail=f"Cuenta {linea.cuenta_id} no existe")
        lineas.append((cuenta.codigo, linea.debe, linea.haber))

    try:
        asiento = contabilidad.crear_asiento(db, body.descripcion, lineas, origen="manual")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    db.commit()
    db.refresh(asiento)
    return _asiento_a_schema(asiento)


@router.delete("/asientos/{asiento_id}")
def eliminar_asiento(asiento_id: int, db: Session = Depends(get_db)):
    asiento = db.query(models.AsientoContable).filter(models.AsientoContable.id == asiento_id).first()
    if not asiento:
        raise HTTPException(status_code=404, detail="Asiento no encontrado")
    if asiento.origen != "manual":
        raise HTTPException(
            status_code=409,
            detail="Este asiento lo genero el sistema automaticamente. Borralo desde donde se origino (la venta, el gasto...).",
        )
    db.delete(asiento)
    db.commit()
    return {"ok": True}


def _saldo(cuenta: models.CuentaContable, debe: float, haber: float) -> float:
    return debe - haber if cuenta.naturaleza == "deudora" else haber - debe


@router.get("/mayor/{cuenta_id}", response_model=List[schemas.FilaMayor])
def libro_mayor(cuenta_id: int, db: Session = Depends(get_db)):
    cuenta = db.query(models.CuentaContable).filter(models.CuentaContable.id == cuenta_id).first()
    if not cuenta:
        raise HTTPException(status_code=404, detail="Cuenta no encontrada")

    movimientos = (
        db.query(models.MovimientoContable)
        .join(models.AsientoContable)
        .filter(models.MovimientoContable.cuenta_id == cuenta_id)
        .options(joinedload(models.MovimientoContable.asiento))
        .order_by(models.AsientoContable.fecha, models.AsientoContable.id)
        .all()
    )

    filas = []
    saldo = 0.0
    for m in movimientos:
        saldo += m.debe - m.haber if cuenta.naturaleza == "deudora" else m.haber - m.debe
        filas.append(
            schemas.FilaMayor(
                asiento_id=m.asiento_id,
                fecha=m.asiento.fecha,
                descripcion=m.asiento.descripcion,
                origen=m.asiento.origen,
                debe=m.debe,
                haber=m.haber,
                saldo=round(saldo, 2),
            )
        )
    return filas


def _balance_por_cuenta(db: Session):
    """(cuenta, debe_total, haber_total) para cada cuenta con al menos un movimiento."""
    cuentas = db.query(models.CuentaContable).order_by(models.CuentaContable.codigo).all()
    resultado = []
    for cuenta in cuentas:
        movimientos = (
            db.query(models.MovimientoContable)
            .filter(models.MovimientoContable.cuenta_id == cuenta.id)
            .all()
        )
        debe = round(sum(m.debe for m in movimientos), 2)
        haber = round(sum(m.haber for m in movimientos), 2)
        resultado.append((cuenta, debe, haber))
    return resultado


@router.get("/balance-comprobacion", response_model=List[schemas.FilaBalanceComprobacion])
def balance_comprobacion(db: Session = Depends(get_db)):
    filas = []
    for cuenta, debe, haber in _balance_por_cuenta(db):
        if debe == 0 and haber == 0:
            continue
        filas.append(
            schemas.FilaBalanceComprobacion(
                cuenta_id=cuenta.id,
                codigo=cuenta.codigo,
                nombre=cuenta.nombre,
                tipo=cuenta.tipo,
                debe=debe,
                haber=haber,
                saldo=round(_saldo(cuenta, debe, haber), 2),
            )
        )
    return filas


@router.get("/estado-resultados", response_model=schemas.EstadoResultados)
def estado_resultados(periodo: str = "mes", db: Session = Depends(get_db)):
    if periodo not in ("dia", "semana", "mes"):
        periodo = "mes"
    # Los equipos se gastan con el uso aunque nadie abra el sistema: se
    # completan las cuotas pendientes antes de leer los numeros.
    contabilidad.asentar_depreciacion_pendiente(db)
    inicio, fin, etiqueta = rango_periodo(periodo)

    cuentas = (
        db.query(models.CuentaContable)
        .filter(models.CuentaContable.tipo.in_(["ingreso", "costo", "gasto"]))
        .all()
    )

    por_tipo = {"ingreso": [], "costo": [], "gasto": []}
    for cuenta in cuentas:
        movimientos = (
            db.query(models.MovimientoContable)
            .join(models.AsientoContable)
            .filter(
                models.MovimientoContable.cuenta_id == cuenta.id,
                models.AsientoContable.fecha >= inicio,
                models.AsientoContable.fecha < fin,
            )
            .all()
        )
        debe = round(sum(m.debe for m in movimientos), 2)
        haber = round(sum(m.haber for m in movimientos), 2)
        if debe == 0 and haber == 0:
            continue
        por_tipo[cuenta.tipo].append(
            schemas.FilaBalanceComprobacion(
                cuenta_id=cuenta.id,
                codigo=cuenta.codigo,
                nombre=cuenta.nombre,
                tipo=cuenta.tipo,
                debe=debe,
                haber=haber,
                saldo=round(_saldo(cuenta, debe, haber), 2),
            )
        )

    ingresos = round(sum(f.saldo for f in por_tipo["ingreso"]), 2)
    costos = round(sum(f.saldo for f in por_tipo["costo"]), 2)
    gastos = round(sum(f.saldo for f in por_tipo["gasto"]), 2)
    utilidad_bruta = round(ingresos - costos, 2)

    return schemas.EstadoResultados(
        periodo=periodo,
        etiqueta=etiqueta,
        ingresos=ingresos,
        costos=costos,
        utilidad_bruta=utilidad_bruta,
        gastos=gastos,
        utilidad_neta=round(utilidad_bruta - gastos, 2),
        detalle_ingresos=por_tipo["ingreso"],
        detalle_costos=por_tipo["costo"],
        detalle_gastos=por_tipo["gasto"],
    )


def _activo_a_schema(db: Session, activo: models.ActivoFijo) -> schemas.ActivoFijo:
    acumulada = contabilidad.depreciacion_acumulada(db, activo)
    meses = (
        db.query(models.AsientoContable)
        .filter_by(origen="depreciacion", referencia_id=activo.id)
        .count()
    )
    return schemas.ActivoFijo(
        id=activo.id,
        nombre=activo.nombre,
        valor=activo.valor,
        fecha_compra=activo.fecha_compra,
        vida_util_meses=activo.vida_util_meses,
        cuota_mensual=activo.cuota_mensual,
        depreciacion_acumulada=acumulada,
        valor_en_libros=round(activo.valor - acumulada, 2),
        meses_depreciados=meses,
        dado_de_baja=activo.dado_de_baja,
        fecha_baja=activo.fecha_baja,
        motivo_baja=activo.motivo_baja or "",
    )


@router.get("/activos", response_model=List[schemas.ActivoFijo])
def listar_activos(db: Session = Depends(get_db)):
    contabilidad.asentar_depreciacion_pendiente(db)
    activos = db.query(models.ActivoFijo).order_by(models.ActivoFijo.id.desc()).all()
    return [_activo_a_schema(db, a) for a in activos]


@router.put("/activos/{activo_id}", response_model=schemas.ActivoFijo)
def actualizar_activo(
    activo_id: int, body: schemas.ActualizarActivoRequest, db: Session = Depends(get_db)
):
    activo = db.query(models.ActivoFijo).filter(models.ActivoFijo.id == activo_id).first()
    if not activo:
        raise HTTPException(status_code=404, detail="Activo no encontrado")
    if activo.dado_de_baja:
        raise HTTPException(status_code=409, detail="Este activo ya fue dado de baja")
    if body.nombre is not None:
        activo.nombre = body.nombre
    if body.vida_util_meses is not None:
        ya = (
            db.query(models.AsientoContable)
            .filter_by(origen="depreciacion", referencia_id=activo.id)
            .count()
        )
        if body.vida_util_meses < ya:
            raise HTTPException(
                status_code=409,
                detail=f"Ya se depreciaron {ya} meses de este bien: la vida util no puede ser menor.",
            )
        activo.vida_util_meses = body.vida_util_meses
    db.commit()
    contabilidad.asentar_depreciacion_pendiente(db)
    db.refresh(activo)
    return _activo_a_schema(db, activo)


@router.post("/activos/{activo_id}/baja", response_model=schemas.ActivoFijo)
def dar_de_baja_activo(
    activo_id: int, body: schemas.BajaActivoRequest, db: Session = Depends(get_db)
):
    """Se daño, se vendio o se lo robaron: sale de los libros."""
    activo = db.query(models.ActivoFijo).filter(models.ActivoFijo.id == activo_id).first()
    if not activo:
        raise HTTPException(status_code=404, detail="Activo no encontrado")
    if activo.dado_de_baja:
        raise HTTPException(status_code=409, detail="Este activo ya fue dado de baja")

    contabilidad.asentar_depreciacion_pendiente(db)
    acumulada = contabilidad.depreciacion_acumulada(db, activo)
    activo.dado_de_baja = True
    activo.fecha_baja = ahora()
    activo.motivo_baja = body.motivo
    contabilidad.registrar_baja_activo(db, activo, acumulada)
    db.commit()
    db.refresh(activo)
    return _activo_a_schema(db, activo)


@router.get("/salud", response_model=schemas.SaludContable)
def salud_contable(db: Session = Depends(get_db)):
    """Chequeos que SI pueden fallar.

    El `cuadra` del Balance General es una tautologia: la utilidad acumulada se
    calcula como residuo y cada asiento ya nace balanceado, asi que siempre da
    true - incluso con el inventario contable en negativo. Esto revisa lo que
    de verdad puede estar mal.
    """
    contabilidad.asentar_depreciacion_pendiente(db)
    problemas: List[schemas.ProblemaContable] = []

    # Activos totalmente depreciados que siguen en uso: no es un error, pero el
    # dueno deberia saber que ese equipo ya cumplio su vida util contable.
    agotados = [
        a
        for a in db.query(models.ActivoFijo).filter(models.ActivoFijo.dado_de_baja.is_(False)).all()
        if contabilidad.depreciacion_acumulada(db, a) >= a.valor - 0.01
    ]
    if agotados:
        problemas.append(
            schemas.ProblemaContable(
                gravedad="aviso",
                titulo=f"{len(agotados)} equipo(s) ya terminaron de depreciarse",
                detalle=", ".join(a.nombre for a in agotados[:4])
                + ". Contablemente ya no valen nada. Si alguno se daño o lo vendiste, dalo de baja.",
            )
        )

    # 1. Movimientos sin asiento (los dejaba un borrado masivo mal hecho).
    huerfanos = (
        db.query(models.MovimientoContable)
        .outerjoin(
            models.AsientoContable,
            models.MovimientoContable.asiento_id == models.AsientoContable.id,
        )
        .filter(models.AsientoContable.id.is_(None))
        .count()
    )
    if huerfanos:
        problemas.append(
            schemas.ProblemaContable(
                gravedad="grave",
                titulo=f"{huerfanos} movimiento(s) contable(s) sin asiento",
                detalle="Quedaron de un borrado incompleto. Suman en el balance pero no "
                "aparecen en el diario. Hay que eliminarlos.",
            )
        )

    # 2. Cuentas de activo en negativo: no existen fisicamente. Se excluyen las
    #    contra-cuentas, cuyo saldo negativo es correcto por diseño.
    for cuenta, debe, haber in _balance_por_cuenta(db):
        if cuenta.tipo != "activo" or cuenta.codigo in contabilidad.CUENTAS_CONTRA:
            continue
        saldo = _saldo(cuenta, debe, haber)
        if saldo < -0.01:
            problemas.append(
                schemas.ProblemaContable(
                    gravedad="grave",
                    titulo=f"{cuenta.codigo} {cuenta.nombre} en negativo (${saldo:,.2f})",
                    detalle="Un activo no puede ser negativo. Suele indicar que falta el "
                    "asiento de apertura o que salio mas mercancia de la que entro.",
                )
            )

    # 3. Inventario contable contra el valor real de las existencias.
    cuenta_inv = (
        db.query(models.CuentaContable).filter(models.CuentaContable.codigo == "1040").first()
    )
    if cuenta_inv:
        movimientos = (
            db.query(models.MovimientoContable)
            .filter(models.MovimientoContable.cuenta_id == cuenta_inv.id)
            .all()
        )
        contable = round(sum(m.debe - m.haber for m in movimientos), 2)
        fisico = round(
            sum(
                (i.stock_actual or 0) * (i.costo_unitario or 0)
                for i in db.query(models.Ingrediente).all()
            ),
            2,
        )
        diferencia = round(fisico - contable, 2)
        if abs(diferencia) > max(1.0, abs(contable) * 0.02):
            problemas.append(
                schemas.ProblemaContable(
                    gravedad="grave" if abs(diferencia) > abs(contable) * 0.1 else "aviso",
                    titulo=f"Inventario descuadrado en ${diferencia:,.2f}",
                    detalle=f"Los libros dicen ${contable:,.2f} y las existencias valen "
                    f"${fisico:,.2f}. Revisa conteos y mermas.",
                )
            )

    # 4. Ventas de productos sin receta: reconocen ingreso sin ningun costo,
    #    asi que inflan la utilidad. No descuadran nada, por eso ninguna otra
    #    validacion los ve: el problema es que falta el vinculo, no que dos
    #    datos discrepen.
    con_receta = {r.variante_id for r in db.query(models.RecetaItem.variante_id).distinct()}
    vendidas_sin_receta = {
        item.nombre
        for item in db.query(models.PedidoItem)
        .join(models.Pedido)
        .filter(models.Pedido.estado == "pagado")
        .all()
        if item.variante_id not in con_receta
    }
    if vendidas_sin_receta:
        nombres = ", ".join(sorted(vendidas_sin_receta)[:4])
        problemas.append(
            schemas.ProblemaContable(
                gravedad="aviso",
                titulo=f"{len(vendidas_sin_receta)} producto(s) vendidos sin receta",
                detalle=f"{nombres}. Se registro el ingreso pero ningun costo de ventas, "
                "asi que la utilidad queda sobrestimada. Cargales la receta.",
            )
        )

    # 5. Ventas facturadas dentro de un periodo de IVA ya declarado: cambian un
    #    numero que ya se le presento al SENIAT.
    for declaracion in db.query(models.DeclaracionIva).all():
        inicio = datetime.datetime(declaracion.anio, declaracion.mes, 1)
        fin = datetime.datetime(
            declaracion.anio + (declaracion.mes // 12), (declaracion.mes % 12) + 1, 1
        )
        posteriores = (
            db.query(models.Pedido)
            .filter(
                models.Pedido.estado == "pagado",
                models.Pedido.facturado.is_(True),
                models.Pedido.cerrado_en >= inicio,
                models.Pedido.cerrado_en < fin,
                models.Pedido.creado_en > declaracion.fecha_declaracion,
            )
            .count()
        )
        if posteriores:
            problemas.append(
                schemas.ProblemaContable(
                    gravedad="grave",
                    titulo=f"{posteriores} venta(s) facturada(s) en {declaracion.periodo}, ya declarado",
                    detalle="Se cargaron despues de declarar ese periodo, asi que el Libro de "
                    "Ventas ya no coincide con lo que se presento. Habria que hacer una "
                    "declaracion sustitutiva.",
                )
            )

    # 6. Insumos con stock negativo.
    negativos = [i for i in db.query(models.Ingrediente).all() if (i.stock_actual or 0) < 0]
    if negativos:
        nombres = ", ".join(i.nombre for i in negativos[:4])
        problemas.append(
            schemas.ProblemaContable(
                gravedad="grave",
                titulo=f"{len(negativos)} insumo(s) con stock negativo",
                detalle=f"{nombres}. Se vendio mas de lo que habia cargado. Haz un conteo "
                "fisico para corregirlo antes de la proxima compra.",
            )
        )

    return schemas.SaludContable(sano=not problemas, problemas=problemas)


@router.get("/balance-general", response_model=schemas.BalanceGeneral)
def balance_general(db: Session = Depends(get_db)):
    contabilidad.asentar_depreciacion_pendiente(db)
    grupos = {"activo": [], "pasivo": [], "patrimonio": []}
    utilidad_acumulada = 0.0

    for cuenta, debe, haber in _balance_por_cuenta(db):
        if cuenta.tipo in ("ingreso", "costo", "gasto"):
            # Sin cierre de ejercicio, el resultado acumulado sube directo a
            # Patrimonio para que el balance cuadre en cualquier momento.
            saldo = _saldo(cuenta, debe, haber)
            utilidad_acumulada += saldo if cuenta.tipo == "ingreso" else -saldo
            continue
        if debe == 0 and haber == 0:
            continue
        fila = schemas.FilaBalanceComprobacion(
            cuenta_id=cuenta.id,
            codigo=cuenta.codigo,
            nombre=cuenta.nombre,
            tipo=cuenta.tipo,
            debe=debe,
            haber=haber,
            saldo=round(_saldo(cuenta, debe, haber), 2),
        )
        grupos[cuenta.tipo].append(fila)

    utilidad_acumulada = round(utilidad_acumulada, 2)
    total_activos = round(sum(f.saldo for f in grupos["activo"]), 2)
    total_pasivos = round(sum(f.saldo for f in grupos["pasivo"]), 2)
    total_patrimonio = round(sum(f.saldo for f in grupos["patrimonio"]) + utilidad_acumulada, 2)

    return schemas.BalanceGeneral(
        fecha=hoy().isoformat(),
        activos=grupos["activo"],
        pasivos=grupos["pasivo"],
        patrimonio=grupos["patrimonio"],
        utilidad_acumulada=utilidad_acumulada,
        total_activos=total_activos,
        total_pasivos=total_pasivos,
        total_patrimonio=total_patrimonio,
        cuadra=abs(total_activos - (total_pasivos + total_patrimonio)) < 0.02,
    )
