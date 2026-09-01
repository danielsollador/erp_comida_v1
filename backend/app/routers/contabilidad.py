from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from .. import contabilidad, models, schemas
from ..database import get_db
from ..timeutils import hoy, rango_periodo

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


@router.get("/balance-general", response_model=schemas.BalanceGeneral)
def balance_general(db: Session = Depends(get_db)):
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
