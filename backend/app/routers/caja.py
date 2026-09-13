import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import contabilidad, models, schemas
from ..database import get_db
from ..timeutils import hoy, inicio_del_dia

router = APIRouter(prefix="/api/caja", tags=["caja"])


def _rango_hoy():
    inicio = inicio_del_dia(hoy())
    return inicio, inicio + datetime.timedelta(days=1)


def _pedidos_pagados_hoy(db: Session):
    inicio, fin = _rango_hoy()
    return (
        db.query(models.Pedido)
        .filter(
            models.Pedido.estado == "pagado",
            models.Pedido.cerrado_en >= inicio,
            models.Pedido.cerrado_en < fin,
        )
        .all()
    )


def _retiros_hoy(db: Session) -> float:
    inicio, fin = _rango_hoy()
    retiros = (
        db.query(models.RetiroPropietario)
        .filter(
            models.RetiroPropietario.fecha >= inicio,
            models.RetiroPropietario.fecha < fin,
            models.RetiroPropietario.metodo_pago == "Efectivo",
        )
        .all()
    )
    return round(sum(r.monto for r in retiros), 2)


def _salidas_efectivo_hoy(db: Session) -> float:
    """Todo lo que salio de la gaveta hoy que no fue una venta, segun los libros."""
    inicio, fin = _rango_hoy()
    ventas_efectivo = sum(
        p.total for p in _pedidos_pagados_hoy(db) if p.metodo_pago == "Efectivo"
    )
    # neto = entradas - salidas. Las unicas entradas son las ventas en efectivo,
    # asi que lo demas que movio la cuenta son salidas.
    neto = contabilidad.movimiento_efectivo(db, inicio, fin)
    return round(ventas_efectivo - neto, 2)


def _saldo_anterior(db: Session) -> float:
    """Lo que quedo en la gaveta de dias anteriores.

    La caja no arranca en cero cada manana: si ayer sobro plata, hoy sigue ahi.
    Sin esto, un dia en que se le paga al proveedor mas de lo que se vendio en
    efectivo mostraba un "deberia haber" negativo, que no significa nada.
    """
    inicio, _fin = _rango_hoy()
    return contabilidad.movimiento_efectivo(db, datetime.datetime.min, inicio)


@router.get("/resumen", response_model=schemas.ResumenCaja)
def resumen_caja(db: Session = Depends(get_db)):
    pedidos = _pedidos_pagados_hoy(db)
    por_metodo: dict = {}
    total = 0.0
    for pedido in pedidos:
        metodo = pedido.metodo_pago or "Sin especificar"
        por_metodo[metodo] = por_metodo.get(metodo, 0) + pedido.total
        total += pedido.total

    # Lo que debe haber en la gaveta lo dice la contabilidad, no un calculo
    # aparte: el saldo de la cuenta 1010 ya incluye ventas en efectivo, gastos,
    # pagos a proveedores y compras sueltas. Cuando Caja llevaba su propia
    # cuenta solo restaba Gastos, y los dias de pagar al proveedor mostraba un
    # faltante inexistente (medido: hasta $93.95 en un dia).
    saldo_anterior = _saldo_anterior(db)
    salidas = _salidas_efectivo_hoy(db)
    efectivo_esperado = round(
        saldo_anterior + por_metodo.get("Efectivo", 0) - salidas, 2
    )

    return schemas.ResumenCaja(
        fecha=hoy().isoformat(),
        total_ventas=round(total, 2),
        por_metodo_pago={k: round(v, 2) for k, v in por_metodo.items()},
        saldo_anterior=saldo_anterior,
        efectivo_esperado=efectivo_esperado,
        salidas_efectivo=salidas,
        retiros_hoy=_retiros_hoy(db),
        cantidad_pedidos=len(pedidos),
    )


@router.post("/cerrar", response_model=schemas.CierreCaja)
def cerrar_caja(body: schemas.CierreCajaRequest, db: Session = Depends(get_db)):
    inicio, fin = _rango_hoy()
    # Cerrar dos veces el mismo dia ahora genera dos asientos de diferencia y
    # descuadraria la caja contra si misma.
    ya_cerrada = (
        db.query(models.CierreCaja)
        .filter(models.CierreCaja.fecha >= inicio, models.CierreCaja.fecha < fin)
        .first()
    )
    if ya_cerrada:
        raise HTTPException(
            status_code=409,
            detail="La caja de hoy ya fue cerrada. Para corregir, registra la diferencia como un gasto o un ajuste.",
        )

    resumen = resumen_caja(db)
    diferencia = round(body.efectivo_contado - resumen.efectivo_esperado, 2)
    db_cierre = models.CierreCaja(
        total_sistema=resumen.total_ventas,
        efectivo_esperado=resumen.efectivo_esperado,
        efectivo_contado=body.efectivo_contado,
        diferencia=diferencia,
        nota=body.nota,
    )
    db.add(db_cierre)
    db.flush()
    # El faltante/sobrante tambien va a los libros: si no, 1010 nunca se
    # concilia con lo que de verdad hay en la gaveta.
    contabilidad.registrar_diferencia_caja(db, db_cierre)
    db.commit()
    db.refresh(db_cierre)
    return _a_schema(db_cierre)


def _a_schema(c: models.CierreCaja) -> schemas.CierreCaja:
    return schemas.CierreCaja(
        id=c.id,
        fecha=c.fecha.isoformat(),
        total_sistema=c.total_sistema,
        efectivo_esperado=c.efectivo_esperado,
        efectivo_contado=c.efectivo_contado,
        diferencia=c.diferencia,
        nota=c.nota,
    )


@router.get("/retiros", response_model=List[schemas.RetiroPropietario])
def listar_retiros(dias: int = 30, db: Session = Depends(get_db)):
    desde = inicio_del_dia(hoy()) - datetime.timedelta(days=dias)
    return (
        db.query(models.RetiroPropietario)
        .filter(models.RetiroPropietario.fecha >= desde)
        .order_by(models.RetiroPropietario.id.desc())
        .all()
    )


@router.post("/retiros", response_model=schemas.RetiroPropietario)
def crear_retiro(body: schemas.RetiroCreate, db: Session = Depends(get_db)):
    """El dueno se lleva plata del negocio.

    Va contra patrimonio, no contra resultados: no es un gasto del negocio
    sino capital que sale, asi que no debe bajar la ganancia.
    """
    if body.monto <= 0:
        raise HTTPException(status_code=400, detail="El monto debe ser mayor a cero")
    if body.metodo_pago not in ("Efectivo", "Banco"):
        raise HTTPException(status_code=400, detail="El retiro sale de Efectivo o de Banco")

    retiro = models.RetiroPropietario(
        monto=body.monto, metodo_pago=body.metodo_pago, nota=body.nota
    )
    db.add(retiro)
    db.flush()
    contabilidad.registrar_retiro(db, retiro)
    db.commit()
    db.refresh(retiro)
    return retiro


@router.delete("/retiros/{retiro_id}")
def eliminar_retiro(retiro_id: int, db: Session = Depends(get_db)):
    retiro = db.query(models.RetiroPropietario).filter(models.RetiroPropietario.id == retiro_id).first()
    if not retiro:
        raise HTTPException(status_code=404, detail="Retiro no encontrado")
    for asiento in (
        db.query(models.AsientoContable)
        .filter_by(origen="retiro", referencia_id=retiro_id)
        .all()
    ):
        db.delete(asiento)
    db.delete(retiro)
    db.commit()
    return {"ok": True}


@router.get("/cierres", response_model=List[schemas.CierreCaja])
def listar_cierres(db: Session = Depends(get_db)):
    cierres = db.query(models.CierreCaja).order_by(models.CierreCaja.id.desc()).limit(30).all()
    return [_a_schema(c) for c in cierres]


@router.get("/gastos", response_model=List[schemas.Gasto])
def listar_gastos(dias: int = 30, db: Session = Depends(get_db)):
    desde = inicio_del_dia(hoy()) - datetime.timedelta(days=dias)
    return (
        db.query(models.Gasto)
        .filter(models.Gasto.fecha >= desde)
        .order_by(models.Gasto.id.desc())
        .all()
    )


@router.post("/gastos", response_model=schemas.Gasto)
def crear_gasto(gasto: schemas.GastoCreate, db: Session = Depends(get_db)):
    if gasto.monto <= 0:
        raise HTTPException(status_code=400, detail="El monto debe ser mayor a cero")
    db_gasto = models.Gasto(**gasto.model_dump())
    db.add(db_gasto)
    db.flush()
    contabilidad.registrar_gasto(db, db_gasto)
    db.commit()
    db.refresh(db_gasto)
    return db_gasto


@router.delete("/gastos/{gasto_id}")
def eliminar_gasto(gasto_id: int, db: Session = Depends(get_db)):
    db_gasto = db.query(models.Gasto).filter(models.Gasto.id == gasto_id).first()
    if not db_gasto:
        raise HTTPException(status_code=404, detail="Gasto no encontrado")
    # Uno por uno con db.delete(): un DELETE masivo sobre el query NO dispara el
    # cascade del ORM y dejaria vivos los movimientos del asiento, que el balance
    # de comprobacion sigue sumando aunque el asiento ya no exista.
    for asiento in (
        db.query(models.AsientoContable)
        .filter(
            models.AsientoContable.origen == "gasto",
            models.AsientoContable.referencia_id == gasto_id,
        )
        .all()
    ):
        db.delete(asiento)
    db.delete(db_gasto)
    db.commit()
    return {"ok": True}
