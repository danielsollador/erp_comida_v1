"""Pagos sin factura: nomina, honorarios, alquiler, servicios.

Se llama `egresos` por dentro porque `/api/pagos` ya es la verificacion del
pago movil del punto de venta; en la pantalla es "Pagos". Ver
models.PagoSinFactura para que va aqui y que no.
"""

import calendar
import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import contabilidad, models, schemas, tasas
from ..database import get_db
from ..rango import Rango
from ..timeutils import ahora, hoy

router = APIRouter(prefix="/api/egresos", tags=["egresos"])

# Un pago en bolivares no sale de una gaveta de dolares ni de Zelle.
METODOS_SOLO_DOLARES = {"Efectivo $", "Zelle"}


def _validar(concepto: str, metodo: str, moneda: str, beneficiario: str) -> None:
    if not beneficiario.strip():
        raise HTTPException(status_code=400, detail="Falta a quién se le pagó")
    if concepto not in contabilidad.CUENTA_POR_CONCEPTO_PAGO:
        raise HTTPException(status_code=400, detail="Concepto desconocido")
    if not contabilidad.metodo_de_pago_valido(metodo):
        raise HTTPException(status_code=400, detail="Forma de pago desconocida")
    if moneda == "Bs" and metodo in METODOS_SOLO_DOLARES:
        raise HTTPException(status_code=400, detail=f"Un pago en bolívares no sale de {metodo}")


def _fecha(fecha: Optional[datetime.date]) -> datetime.datetime:
    ya = ahora()
    if fecha is None or fecha == ya.date():
        return ya
    if fecha > ya.date():
        raise HTTPException(status_code=400, detail="Un pago no puede tener fecha futura")
    return datetime.datetime.combine(fecha, datetime.time(12, 0))


def _registrar(db: Session, datos: dict, fecha: datetime.datetime, pago_fijo_id: Optional[int] = None) -> models.PagoSinFactura:
    _validar(datos["concepto"], datos["metodo_pago"], datos["moneda"], datos["beneficiario"])
    referencia = (datos.get("referencia") or "").strip()
    if datos["metodo_pago"] in contabilidad.METODOS_CON_REFERENCIA and not referencia:
        raise HTTPException(status_code=400, detail=f"Un pago por {datos['metodo_pago']} necesita su número de referencia")
    monto, monto_bs, tasa = datos["monto"], None, None
    if datos["moneda"] == "Bs":
        t = tasas.tasa_al(db, fecha.date())
        if t is None or not t.bcv:
            raise HTTPException(status_code=409, detail="No hay tasa BCV para esa fecha: cárgala en Tasa de cambio")
        monto_bs, tasa = round(monto, 2), t.bcv
        monto = round(monto_bs / tasa, 2)
    pct = datos.get("retencion_islr_pct") or 0.0
    pago = models.PagoSinFactura(
        fecha=fecha,
        beneficiario=datos["beneficiario"].strip(),
        concepto=datos["concepto"],
        descripcion=(datos.get("descripcion") or "").strip(),
        monto=round(monto, 2),
        moneda=datos["moneda"],
        monto_bs=monto_bs,
        tasa=tasa,
        metodo_pago=datos["metodo_pago"],
        referencia=referencia,
        retencion_islr_pct=pct,
        retencion_islr=round(monto * pct / 100, 2),
        pago_fijo_id=pago_fijo_id,
        operador_id=datos.get("operador_id"),
    )
    db.add(pago)
    db.flush()
    contabilidad.registrar_pago_sin_factura(db, pago)
    return pago


@router.get("", response_model=List[schemas.PagoSinFactura])
def listar(rango: Rango = Depends(), db: Session = Depends(get_db)):
    inicio, fin, _ = rango.resolver(dias=30)
    return (
        db.query(models.PagoSinFactura)
        .filter(models.PagoSinFactura.fecha >= inicio, models.PagoSinFactura.fecha < fin)
        .order_by(models.PagoSinFactura.fecha.desc(), models.PagoSinFactura.id.desc())
        .all()
    )


@router.get("/resumen", response_model=schemas.ResumenPagos)
def resumen(rango: Rango = Depends(), db: Session = Depends(get_db)):
    inicio, fin, _ = rango.resolver(dias=30)
    pagos = (
        db.query(models.PagoSinFactura)
        .filter(
            models.PagoSinFactura.fecha >= inicio,
            models.PagoSinFactura.fecha < fin,
            models.PagoSinFactura.anulado.is_(False),
        )
        .all()
    )
    por_concepto: dict = {}
    for p in pagos:
        por_concepto[p.concepto] = round(por_concepto.get(p.concepto, 0.0) + p.monto, 2)
    return schemas.ResumenPagos(
        total=round(sum(p.monto for p in pagos), 2),
        por_concepto=por_concepto,
        islr_por_enterar=round(contabilidad.saldo_de_cuenta(db, "2060"), 2),
    )


@router.get("/beneficiarios", response_model=List[str])
def beneficiarios(db: Session = Depends(get_db)):
    """A quienes ya se les pago, para no escribir el nombre cada vez (y no
    tener a "Jose" y "José" como dos personas en el reporte de nomina)."""
    filas = db.query(models.PagoSinFactura.beneficiario).distinct().all()
    fijos = db.query(models.PagoFijo.beneficiario).distinct().all()
    return sorted({f[0] for f in filas + fijos if f[0]}, key=str.lower)


@router.post("", response_model=schemas.PagoSinFactura)
def crear(body: schemas.PagoSinFacturaCreate, db: Session = Depends(get_db)):
    pago = _registrar(db, body.model_dump(), _fecha(body.fecha))
    db.commit()
    db.refresh(pago)
    return pago


@router.post("/{pago_id}/anular", response_model=schemas.PagoSinFactura)
def anular(pago_id: int, db: Session = Depends(get_db)):
    pago = db.get(models.PagoSinFactura, pago_id)
    if pago is None:
        raise HTTPException(status_code=404, detail="Pago no encontrado")
    if pago.anulado:
        raise HTTPException(status_code=409, detail="Ese pago ya estaba anulado")
    try:
        contabilidad.asegurar_ejercicio_abierto(db, pago.fecha, "ese pago")
    except contabilidad.ErrorEjercicioCerrado as e:
        raise HTTPException(status_code=409, detail=str(e))
    contabilidad.reversar_asiento(db, "pago_sin_factura", pago.id, "reverso_pago_sin_factura")
    pago.anulado = True
    db.commit()
    db.refresh(pago)
    return pago


# ── Pagos fijos ─────────────────────────────────────────────────────────────

def siguiente_fecha(fecha: datetime.date, frecuencia: str) -> datetime.date:
    if frecuencia == "semanal":
        return fecha + datetime.timedelta(days=7)
    if frecuencia == "quincenal":
        # La quincena venezolana: el 15 y el ultimo del mes, o el 1 y el 16.
        # Se suman quince dias y listo; correr al dia exacto lo hace el dueño.
        return fecha + datetime.timedelta(days=15)
    mes = fecha.month % 12 + 1
    anio = fecha.year + (1 if fecha.month == 12 else 0)
    return datetime.date(anio, mes, min(fecha.day, calendar.monthrange(anio, mes)[1]))


def _fijo_a_esquema(f: models.PagoFijo) -> schemas.PagoFijo:
    return schemas.PagoFijo(
        **{k: getattr(f, k) for k in schemas.PagoFijoCreate.model_fields},
        id=f.id,
        toca=bool(f.activo) and f.proximo <= hoy(),
    )


@router.get("/fijos", response_model=List[schemas.PagoFijo])
def listar_fijos(db: Session = Depends(get_db)):
    fijos = db.query(models.PagoFijo).order_by(models.PagoFijo.proximo).all()
    return [_fijo_a_esquema(f) for f in fijos]


@router.post("/fijos", response_model=schemas.PagoFijo)
def crear_fijo(body: schemas.PagoFijoCreate, db: Session = Depends(get_db)):
    _validar(body.concepto, body.metodo_pago, body.moneda, body.beneficiario)
    f = models.PagoFijo(**{**body.model_dump(), "beneficiario": body.beneficiario.strip()})
    db.add(f)
    db.commit()
    db.refresh(f)
    return _fijo_a_esquema(f)


@router.put("/fijos/{fijo_id}", response_model=schemas.PagoFijo)
def editar_fijo(fijo_id: int, body: schemas.PagoFijoCreate, db: Session = Depends(get_db)):
    f = db.get(models.PagoFijo, fijo_id)
    if f is None:
        raise HTTPException(status_code=404, detail="Pago fijo no encontrado")
    _validar(body.concepto, body.metodo_pago, body.moneda, body.beneficiario)
    for k, v in body.model_dump().items():
        setattr(f, k, v.strip() if isinstance(v, str) else v)
    db.commit()
    db.refresh(f)
    return _fijo_a_esquema(f)


@router.post("/fijos/{fijo_id}/pagar", response_model=schemas.PagoSinFactura)
def pagar_fijo(fijo_id: int, body: schemas.PagarFijo, db: Session = Depends(get_db)):
    """Confirmar el pago que toca: queda registrado y el fijo pasa a la
    proxima fecha."""
    f = db.get(models.PagoFijo, fijo_id)
    if f is None or not f.activo:
        raise HTTPException(status_code=404, detail="Pago fijo no encontrado")
    datos = {
        "beneficiario": f.beneficiario,
        "concepto": f.concepto,
        "descripcion": f.descripcion or f"{f.frecuencia.capitalize()} del {f.proximo:%d/%m}",
        "monto": body.monto or f.monto,
        "moneda": f.moneda,
        "metodo_pago": f.metodo_pago,
        "referencia": body.referencia,
        "retencion_islr_pct": f.retencion_islr_pct,
        "operador_id": body.operador_id,
    }
    pago = _registrar(db, datos, _fecha(body.fecha), pago_fijo_id=f.id)
    f.proximo = siguiente_fecha(f.proximo, f.frecuencia)
    db.commit()
    db.refresh(pago)
    return pago
