"""Conciliacion bancaria, en Contabilidad (ver conciliacion_bancaria.py).
Va bajo /api/contabilidad: la ve quien entra a Contabilidad."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session

from .. import conciliacion, conciliacion_bancaria as cb, models, schemas
from ..database import get_db

router = APIRouter(prefix="/api/contabilidad/conciliacion", tags=["contabilidad"])

# Un estado de cuenta de un mes en PDF pesa unos cientos de KB.
TAMANO_MAXIMO = 10 * 1024 * 1024


def _extracto(db: Session, extracto_id: int) -> models.ExtractoBanco:
    e = db.get(models.ExtractoBanco, extracto_id)
    if e is None:
        raise HTTPException(status_code=404, detail="Ese estado de cuenta no existe.")
    return e


def _pendientes(db: Session):
    return db.query(models.LineaExtracto).filter(models.LineaExtracto.estado.in_(("pendiente", "propuesta"))).all()


@router.get("", response_model=schemas.EstadoConciliacion)
def estado(db: Session = Depends(get_db)):
    extractos = (db.query(models.ExtractoBanco)
                 .order_by(models.ExtractoBanco.desde.desc(), models.ExtractoBanco.id.desc()).all())
    reglas = db.query(models.ReglaBanco).order_by(models.ReglaBanco.id).all()
    return schemas.EstadoConciliacion(extractos=[cb.resumen_de(e) for e in extractos],
                                      reglas=[cb.vista_regla(r) for r in reglas])


@router.post("/extractos", response_model=schemas.DetalleExtracto)
def subir(request: Request, archivo: UploadFile = File(...), cuenta: str = Form(cb.CUENTA_BANCO),
          db: Session = Depends(get_db)):
    contenido = archivo.file.read(TAMANO_MAXIMO + 1)
    if len(contenido) > TAMANO_MAXIMO:
        raise HTTPException(status_code=413, detail="El archivo pesa demasiado (máximo 10 MB).")
    try:
        e = cb.subir(db, archivo.filename or "", contenido, request.state.sesion["usuario"], cuenta)
    except (conciliacion.ErrorDeLectura, cb.ErrorConciliacion) as err:
        raise HTTPException(status_code=422, detail=str(err))
    return cb.vista(db, e)


@router.get("/extractos/{extracto_id}", response_model=schemas.DetalleExtracto)
def ver(extracto_id: int, db: Session = Depends(get_db)):
    return cb.vista(db, _extracto(db, extracto_id))


@router.delete("/extractos/{extracto_id}")
def borrar(extracto_id: int, db: Session = Depends(get_db)):
    e = _extracto(db, extracto_id)
    if any(l.estado == "registrado" for l in e.lineas):
        raise HTTPException(status_code=422, detail="Tiene movimientos ya registrados en contabilidad: no se puede quitar.")
    db.delete(e)
    db.commit()
    return {"ok": True}


@router.post("/extractos/{extracto_id}/aplicar-reglas", response_model=schemas.DetalleExtracto)
def aplicar(extracto_id: int, db: Session = Depends(get_db)):
    e = _extracto(db, extracto_id)
    cb.aplicar_reglas(db, e.lineas)
    db.commit()
    return cb.vista(db, e)


@router.post("/extractos/{extracto_id}/registrar", response_model=schemas.DetalleExtracto)
def registrar(extracto_id: int, datos: schemas.RegistrarLineas, db: Session = Depends(get_db)):
    e = _extracto(db, extracto_id)
    try:
        cb.registrar(db, e, datos.ids)
    except (cb.ErrorConciliacion, ValueError) as err:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(err))
    return cb.vista(db, e)


@router.post("/lineas/{linea_id}", response_model=schemas.DetalleExtracto)
def accion(linea_id: int, datos: schemas.AccionLinea, db: Session = Depends(get_db)):
    l = db.get(models.LineaExtracto, linea_id)
    if l is None:
        raise HTTPException(status_code=404, detail="Ese movimiento no existe.")
    try:
        cb.marcar(db, l, datos.accion, datos.cuenta)
    except cb.ErrorConciliacion as err:
        raise HTTPException(status_code=422, detail=str(err))
    return cb.vista(db, l.extracto)


def _validar_cuenta(db: Session, codigo: str) -> None:
    if not cb.contabilidad_tiene(db, codigo):
        raise HTTPException(status_code=422, detail=f"La cuenta {codigo} no existe en el plan de cuentas.")


@router.post("/reglas", response_model=schemas.Regla)
def crear_regla(datos: schemas.ReglaIn, request: Request, db: Session = Depends(get_db)):
    _validar_cuenta(db, datos.cuenta)
    r = models.ReglaBanco(nombre=datos.nombre.strip() or datos.contiene.strip(), contiene=datos.contiene.strip(),
                          sentido=datos.sentido, cuenta=datos.cuenta, activa=datos.activa,
                          creada_por=request.state.sesion["usuario"])
    db.add(r)
    db.commit()
    db.refresh(r)
    # Se aplica de una a todo lo pendiente: para eso se crea.
    cb.aplicar_reglas(db, _pendientes(db))
    db.commit()
    return cb.vista_regla(r)


@router.put("/reglas/{regla_id}", response_model=schemas.Regla)
def editar_regla(regla_id: int, datos: schemas.ReglaIn, db: Session = Depends(get_db)):
    r = db.get(models.ReglaBanco, regla_id)
    if r is None:
        raise HTTPException(status_code=404, detail="Esa regla no existe.")
    _validar_cuenta(db, datos.cuenta)
    r.nombre = datos.nombre.strip() or datos.contiene.strip()
    r.contiene, r.sentido, r.cuenta, r.activa = datos.contiene.strip(), datos.sentido, datos.cuenta, datos.activa
    db.commit()
    cb.aplicar_reglas(db, _pendientes(db))
    db.commit()
    return cb.vista_regla(r)


@router.delete("/reglas/{regla_id}")
def borrar_regla(regla_id: int, db: Session = Depends(get_db)):
    r = db.get(models.ReglaBanco, regla_id)
    if r is None:
        raise HTTPException(status_code=404, detail="Esa regla no existe.")
    # Lo que proponia vuelve a pendiente; lo ya registrado queda como esta.
    for l in db.query(models.LineaExtracto).filter_by(regla_id=r.id, estado="propuesta").all():
        l.estado, l.cuenta, l.detalle = "pendiente", "", ""
    db.query(models.LineaExtracto).filter_by(regla_id=r.id).update({"regla_id": None})
    db.delete(r)
    db.commit()
    return {"ok": True}
