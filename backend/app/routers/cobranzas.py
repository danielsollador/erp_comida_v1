"""Cuentas por cobrar: clientes a credito, lo que debe cada uno y el cobro
agrupado. La logica vive en `cuentas_por_cobrar.py`."""

from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import cuentas_por_cobrar as cxc
from .. import models, salvaguardas, schemas
from ..database import get_db
from ..exportar_csv import respuesta_csv, respuesta_xlsx
from ..timeutils import hoy

router = APIRouter(prefix="/api/cobranzas", tags=["cobranzas"])

COLUMNAS_EXPORTAR = ("Cliente", "Venta", "Fecha", "Días", "Abonó ($)", "Debe ($)")


def _cliente(db: Session, cliente_id: int) -> models.Cliente:
    c = db.get(models.Cliente, cliente_id)
    if c is None:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    return c


def _sin_duplicar(db: Session, nombre: str, excluir: int = 0) -> None:
    clave = cxc.clave_de_nombre(nombre)
    if not clave:
        raise HTTPException(status_code=400, detail="El cliente necesita un nombre")
    for c in db.query(models.Cliente).filter(models.Cliente.id != excluir).all():
        if cxc.clave_de_nombre(c.nombre) == clave:
            raise HTTPException(status_code=409, detail=f"Ya existe el cliente «{c.nombre}»")


def _confirmar(db: Session, cobro: models.CobroCliente, clave) -> schemas.CobroCliente:
    """Dos reintentos sobre ventas distintas no se esperan entre si: el indice
    UNIQUE deja pasar uno y el otro recibe el cobro del que gano."""
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        cobro = cxc.cobro_por_clave(db, clave)
        if cobro is None:
            raise
    db.refresh(cobro)
    return cxc.cobro_a_esquema(cobro)


@router.get("/resumen", response_model=schemas.ResumenCxC)
def resumen(db: Session = Depends(get_db)):
    return cxc.resumen(db)


@router.post("/ventas/exportar")
def exportar_ventas(body: schemas.ExportarCxC, db: Session = Depends(get_db)):
    """Solo lee. Va por POST porque 1.000 ventas no caben en una direccion."""
    nombre = f"cuentas-por-cobrar-{hoy().isoformat()}.{body.formato}"
    filas = cxc.filas_para_exportar(db, body.pedido_ids)
    if body.formato == "xlsx":
        return respuesta_xlsx(nombre, COLUMNAS_EXPORTAR, filas, hoja="Cuentas por cobrar")
    return respuesta_csv(nombre, COLUMNAS_EXPORTAR, filas, regional=True)


@router.get("/clientes", response_model=List[schemas.Cliente])
def listar_clientes(db: Session = Depends(get_db)):
    return db.query(models.Cliente).order_by(models.Cliente.nombre).all()


@router.post("/clientes", response_model=schemas.Cliente)
def crear_cliente(body: schemas.ClienteCreate, db: Session = Depends(get_db)):
    _sin_duplicar(db, body.nombre)
    c = models.Cliente(**{**body.model_dump(), "nombre": body.nombre.strip()})
    db.add(c)
    db.flush()
    # Los fiados que ya estaban a ese nombre entran en su cuenta: es lo
    # primero que se quiere al crear "PedidosYa" con un mes de ventas encima.
    for p in cxc.pedidos_por_cobrar(db):
        if p.cliente_id is None and cxc.clave_de_nombre(p.cliente or "") == cxc.clave_de_nombre(c.nombre):
            p.cliente_id = c.id
    db.commit()
    db.refresh(c)
    return c


@router.put("/clientes/{cliente_id}", response_model=schemas.Cliente)
def editar_cliente(cliente_id: int, body: schemas.ClienteCreate, db: Session = Depends(get_db)):
    c = _cliente(db, cliente_id)
    _sin_duplicar(db, body.nombre, excluir=c.id)
    for k, v in body.model_dump().items():
        setattr(c, k, v.strip() if isinstance(v, str) else v)
    db.commit()
    db.refresh(c)
    return c


@router.get("/clientes/{cliente_id}/estado", response_model=schemas.EstadoDeCuenta)
def estado_de_cuenta(cliente_id: int, db: Session = Depends(get_db)):
    return cxc.estado_de_cuenta(db, _cliente(db, cliente_id))


@router.post("/ventas/{pedido_id}/cliente")
def asignar_cliente(pedido_id: int, body: schemas.AsignarCliente, db: Session = Depends(get_db)):
    """Meter en la cuenta de un cliente un fiado que se hizo con otro nombre."""
    p = db.get(models.Pedido, pedido_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Venta no encontrada")
    if p.fiado_monto <= 0:
        raise HTTPException(status_code=400, detail="Esa venta no quedó a crédito")
    c = _cliente(db, body.cliente_id)
    p.cliente_id = c.id
    db.commit()
    return {"ok": True}


@router.post("/clientes/{cliente_id}/abono", response_model=schemas.CobroCliente)
def abonar(cliente_id: int, body: schemas.AbonoACuenta, db: Session = Depends(get_db)):
    """Un pago "a lo que debo": se aplica de la venta mas vieja a la mas nueva."""
    c = _cliente(db, cliente_id)
    try:
        cobro = cxc.abonar_a_cuenta(db, c, body)
    except cxc.ErrorCobro as e:
        db.rollback()
        raise HTTPException(status_code=e.status, detail=e.detalle)
    return _confirmar(db, cobro, body.clave_cliente)


@router.post("/abonos", response_model=schemas.CobroCliente)
def abonar_ventas(body: schemas.AbonoAVentas, db: Session = Depends(get_db)):
    """Pago parcial de las ventas marcadas: de la mas vieja a la mas nueva."""
    try:
        cobro = cxc.abonar_ventas(db, body)
    except cxc.ErrorCobro as e:
        db.rollback()
        raise HTTPException(status_code=e.status, detail=e.detalle)
    return _confirmar(db, cobro, body.clave_cliente)


@router.post("/ventas/{pedido_id}/perdida")
def dar_por_perdida(pedido_id: int, body: schemas.DarPorPerdida, request: Request, db: Session = Depends(get_db)):
    """El cliente no va a pagar (PedidosYa no reconocio el pedido): lo que
    falta se lleva a gasto y deja de deberse. La venta no se toca. Pide la
    firma de quien autoriza (QA nov: la cajera daba de baja deudas sola)."""
    p = db.get(models.Pedido, pedido_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Venta no encontrada")
    salvaguardas.exigir_firma(db, request, "dar_de_baja", f"Dar de baja la deuda de la venta #{p.numero}",
                              monto=p.fiado_saldo or 0, pedido_id=p.id)
    try:
        monto = cxc.dar_por_perdida(db, p, body.motivo)
    except cxc.ErrorCobro as e:
        db.rollback()
        raise HTTPException(status_code=e.status, detail=e.detalle)
    db.commit()
    return {"ok": True, "perdido": monto}


@router.delete("/ventas/{pedido_id}/perdida")
def recuperar_perdida(pedido_id: int, db: Session = Depends(get_db)):
    p = db.get(models.Pedido, pedido_id)
    if p is None:
        raise HTTPException(status_code=404, detail="Venta no encontrada")
    try:
        cxc.recuperar_perdida(db, p)
    except cxc.ErrorCobro as e:
        db.rollback()
        raise HTTPException(status_code=e.status, detail=e.detalle)
    db.commit()
    return {"ok": True}


@router.get("/cobros", response_model=List[schemas.CobroCliente])
def listar_cobros(db: Session = Depends(get_db)):
    """Todo lo cobrado de deudas: lo cobrado aqui y los abonos hechos desde
    Ventas o Caja. Decia "Todavia no hay cobros" con 10 abonos hechos por
    alla (QA nov, hallazgo 26)."""
    cobros = [cxc.cobro_a_esquema(c) for c in
              db.query(models.CobroCliente).order_by(models.CobroCliente.fecha.desc()).limit(200).all()]
    for a in (
        db.query(models.AbonoFiado)
        .filter(models.AbonoFiado.cobro_id.is_(None))
        .order_by(models.AbonoFiado.fecha.desc())
        .limit(200)
        .all()
    ):
        cobros.append(schemas.CobroCliente(
            id=-a.id, cliente=a.pedido.cliente if a.pedido else "", fecha=a.fecha, metodo_pago=a.metodo_pago or "",
            referencia=a.referencia or "", monto=a.monto, comision=0.0, recibido=a.monto,
            nota="Abono hecho desde Ventas o Caja", anulado=False, ventas=[a.pedido_id], origen="abono",
        ))
    cobros.sort(key=lambda c: c.fecha, reverse=True)
    return cobros[:200]


@router.post("/cobros", response_model=schemas.CobroCliente)
def cobrar(body: schemas.CobroClienteCreate, db: Session = Depends(get_db)):
    try:
        cobro = cxc.cobrar(db, body)
    except cxc.ErrorCobro as e:
        db.rollback()
        raise HTTPException(status_code=e.status, detail=e.detalle)
    return _confirmar(db, cobro, body.clave_cliente)


@router.post("/cobros/{cobro_id}/anular", response_model=schemas.CobroCliente)
def anular_cobro(cobro_id: int, db: Session = Depends(get_db)):
    cobro = db.get(models.CobroCliente, cobro_id)
    if cobro is None:
        raise HTTPException(status_code=404, detail="Cobro no encontrado")
    try:
        cxc.anular_cobro(db, cobro)
    except cxc.ErrorCobro as e:
        db.rollback()
        raise HTTPException(status_code=e.status, detail=e.detalle)
    db.commit()
    db.refresh(cobro)
    return cxc.cobro_a_esquema(cobro)
