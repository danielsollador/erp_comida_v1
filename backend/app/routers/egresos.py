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
from ..cuentas_por_cobrar import clave_de_nombre
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
    # Si todo el sueldo se cubre con lo adelantado no sale plata: no hay
    # comprobante que pedir.
    sale_plata = round(datos["monto"] - (datos.get("descontar_anticipo") or 0), 2) > 0
    if sale_plata and datos["metodo_pago"] in contabilidad.METODOS_CON_REFERENCIA and not referencia:
        raise HTTPException(status_code=400, detail=f"Un pago por {datos['metodo_pago']} necesita su número de referencia")
    monto, monto_bs, tasa = datos["monto"], None, None
    if datos["moneda"] == "Bs":
        t = tasas.tasa_al(db, fecha.date())
        if t is None or not t.bcv:
            raise HTTPException(status_code=409, detail="No hay tasa BCV para esa fecha: cárgala en Tasa de cambio")
        monto_bs, tasa = round(monto, 2), t.bcv
        monto = round(monto_bs / tasa, 2)
    pct = datos.get("retencion_islr_pct") or 0.0
    if datos["concepto"] == "Anticipo" and pct:
        raise HTTPException(status_code=400, detail="Un anticipo no lleva retención: se retiene al pagar el sueldo")
    retencion = round(monto * pct / 100, 2)
    descuento = round(datos.get("descontar_anticipo") or 0.0, 2)
    if descuento:
        if datos["concepto"] != "Sueldos":
            raise HTTPException(status_code=400, detail="Los anticipos se descuentan de un sueldo")
        pendiente = anticipos_de(db).get(clave_de_nombre(datos["beneficiario"]), 0.0)
        if descuento > pendiente + 0.005:
            raise HTTPException(
                status_code=400,
                detail=f"A {datos['beneficiario'].strip()} solo se le adelantaron {pendiente:.2f} por descontar",
            )
        if descuento > round(monto - retencion, 2) + 0.005:
            raise HTTPException(status_code=400, detail="El anticipo a descontar es mayor que el sueldo")
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
        retencion_islr=retencion,
        anticipo_descontado=descuento,
        pago_fijo_id=pago_fijo_id,
        operador_id=datos.get("operador_id"),
    )
    db.add(pago)
    db.flush()
    contabilidad.registrar_pago_sin_factura(db, pago)
    return pago


def anticipos_de(db: Session) -> dict:
    """Lo adelantado a cada empleado que falta por descontar, por nombre."""
    saldos: dict = {}
    nombres: dict = {}
    for p in db.query(models.PagoSinFactura).filter(models.PagoSinFactura.anulado.is_(False)).all():
        clave = clave_de_nombre(p.beneficiario)
        if p.concepto == "Anticipo":
            saldos[clave] = round(saldos.get(clave, 0.0) + p.monto, 2)
            nombres.setdefault(clave, p.beneficiario)
        elif p.anticipo_descontado:
            saldos[clave] = round(saldos.get(clave, 0.0) - p.anticipo_descontado, 2)
    anticipos_de.nombres = nombres
    return {k: v for k, v in saldos.items() if v > 0.004}


@router.get("/anticipos", response_model=List[schemas.AnticipoPendiente])
def anticipos(db: Session = Depends(get_db)):
    saldos = anticipos_de(db)
    return [schemas.AnticipoPendiente(beneficiario=anticipos_de.nombres[k], saldo=v) for k, v in saldos.items()]


@router.post("/islr/enterar")
def enterar_islr(body: schemas.EnterarIslr, db: Session = Depends(get_db)):
    """Pagarle al SENIAT lo retenido de ISLR."""
    pendiente = round(contabilidad.saldo_de_cuenta(db, "2060"), 2)
    monto = round(body.monto if body.monto is not None else pendiente, 2)
    if pendiente <= 0:
        raise HTTPException(status_code=409, detail="No hay ISLR retenido por enterar")
    if monto <= 0 or monto > pendiente + 0.005:
        raise HTTPException(status_code=400, detail=f"Hay {pendiente:.2f} retenidos por enterar")
    if not contabilidad.metodo_de_pago_valido(body.metodo_pago):
        raise HTTPException(status_code=400, detail="Forma de pago desconocida")
    if body.metodo_pago in contabilidad.METODOS_CON_REFERENCIA and not body.referencia.strip():
        raise HTTPException(status_code=400, detail="Pon la referencia de la planilla o del pago")
    contabilidad.registrar_entero_islr(db, monto, body.metodo_pago, body.referencia.strip(), fecha=_fecha(body.fecha))
    db.commit()
    return {"ok": True, "enterado": monto, "queda": round(pendiente - monto, 2)}


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
    # Un anticipo no es gasto todavia: se cuenta cuando se descuenta del
    # sueldo, que ya va en "Sueldos" por el monto completo.
    gastado = [p for p in pagos if p.concepto != "Anticipo"]
    return schemas.ResumenPagos(
        total=round(sum(p.monto for p in gastado), 2),
        por_concepto=por_concepto,
        islr_por_enterar=round(contabilidad.saldo_de_cuenta(db, "2060"), 2),
        anticipos_pendientes=round(contabilidad.saldo_de_cuenta(db, "1016"), 2),
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
    if pago.concepto == "Anticipo":
        pendiente = anticipos_de(db).get(clave_de_nombre(pago.beneficiario), 0.0)
        if pago.monto > pendiente + 0.005:
            raise HTTPException(
                status_code=409,
                detail="Ese anticipo ya se descontó de un sueldo. Anula primero ese pago de sueldo.",
            )
    # Lo retenido ya se le pago al SENIAT: anular devolveria al libro un ISLR
    # que no se debe y el "por enterar" quedaba en negativo.
    if (pago.retencion_islr or 0) > 0.004:
        pendiente = round(contabilidad.saldo_de_cuenta(db, "2060"), 2)
        if pago.retencion_islr > pendiente + 0.005:
            raise HTTPException(
                status_code=409,
                detail="El ISLR retenido en ese pago ya se le pagó al SENIAT. No se puede anular: corrígelo con el contador.",
            )
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
    if f.concepto == "Sueldos":
        # Lo adelantado en la quincena se descuenta solo, salvo que se diga
        # otra cosa al confirmar.
        pendiente = anticipos_de(db).get(clave_de_nombre(f.beneficiario), 0.0)
        monto_usd = datos["monto"]
        if f.moneda == "Bs":
            t = tasas.tasa_al(db, _fecha(body.fecha).date())
            monto_usd = round(datos["monto"] / t.bcv, 2) if t and t.bcv else datos["monto"]
        tope = round(monto_usd * (1 - (f.retencion_islr_pct or 0) / 100), 2)
        pedido = pendiente if body.descontar_anticipo is None else body.descontar_anticipo
        datos["descontar_anticipo"] = round(min(pedido, tope), 2)
    pago = _registrar(db, datos, _fecha(body.fecha), pago_fijo_id=f.id)
    f.proximo = siguiente_fecha(f.proximo, f.frecuencia)
    db.commit()
    db.refresh(pago)
    return pago
