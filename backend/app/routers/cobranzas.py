"""Cuentas por cobrar: clientes a credito, lo que debe cada uno y el cobro
agrupado. La logica vive en `cuentas_por_cobrar.py`."""

from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import cuentas_por_cobrar as cxc
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/cobranzas", tags=["cobranzas"])


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


@router.get("/resumen", response_model=schemas.ResumenCxC)
def resumen(db: Session = Depends(get_db)):
    return cxc.resumen(db)


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


@router.get("/cobros", response_model=List[schemas.CobroCliente])
def listar_cobros(db: Session = Depends(get_db)):
    cobros = db.query(models.CobroCliente).order_by(models.CobroCliente.fecha.desc()).limit(200).all()
    return [cxc.cobro_a_esquema(c) for c in cobros]


@router.post("/cobros", response_model=schemas.CobroCliente)
def cobrar(body: schemas.CobroClienteCreate, db: Session = Depends(get_db)):
    try:
        cobro = cxc.cobrar(db, body)
    except cxc.ErrorCobro as e:
        db.rollback()
        raise HTTPException(status_code=e.status, detail=e.detalle)
    db.commit()
    db.refresh(cobro)
    return cxc.cobro_a_esquema(cobro)


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
