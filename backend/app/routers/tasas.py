import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import analisis_tasa, salvaguardas, schemas, tasas
from ..database import get_db
from ..rango import Rango

router = APIRouter(prefix="/api/tasas", tags=["tasas"])


@router.get("", response_model=schemas.EstadoTasa)
def estado(db: Session = Depends(get_db)):
    """Tasa vigente, brecha con el paralelo y si hay conexion a las fuentes."""
    return tasas.estado(db)


@router.post("/refrescar", response_model=schemas.EstadoTasa)
def refrescar(forzar: bool = False, db: Session = Depends(get_db)):
    """Vuelve a consultar BCV y Binance ahora mismo.

    `forzar=true` ademas devuelve el dia a modo automatico, pisando una tasa
    que se haya cargado a mano.
    """
    ok = tasas.refrescar(db, forzar=forzar)
    if not ok:
        raise HTTPException(
            status_code=503,
            detail="No hay conexión con el BCV ni con las fuentes de respaldo. "
            "Puedes cargar la tasa a mano mientras tanto.",
        )
    return tasas.estado(db)


@router.put("", response_model=schemas.EstadoTasa)
def fijar(body: schemas.TasaManual, request: Request, db: Session = Depends(get_db)):
    """Fija a mano la tasa con la que se cobra hoy. Manda sobre lo automatico.

    Pide la firma de quien autoriza (QA nov, R5: la cajera la puso en 1 Bs) y
    un salto de mas de 30 % contra la vigente pide confirmar."""
    if body.bcv <= 0:
        raise HTTPException(status_code=400, detail="La tasa debe ser mayor que cero")
    vigente = tasas.tasa_vigente(db)
    if vigente and tasas.salto(body.bcv, vigente.bcv) > tasas.SALTO_MAXIMO:
        salvaguardas.pedir_confirmacion(
            request, "tasa_salto",
            f"La tasa vigente es {salvaguardas.numero(vigente.bcv)} Bs y escribiste {salvaguardas.numero(body.bcv)}: "
            "es un salto de más de 30 %. ¿Es correcta, o falta o sobra un dígito?",
        )
    salvaguardas.exigir_firma(db, request, "cambiar_tasa", f"Fijar la tasa del día en {salvaguardas.numero(body.bcv)} Bs")
    tasas.fijar_manual(db, body.bcv, body.paralelo)
    return tasas.estado(db)


@router.put("/cobro", response_model=schemas.EstadoTasa)
def elegir_cobro(body: schemas.TasaCobroIn, request: Request, db: Session = Depends(get_db)):
    """Elige con que tasa se pasan a bolivares los precios en divisa al cobrar:
    el dolar BCV, el euro BCV o una tasa manual (specs/tasa.md).

    No toca la tasa oficial. Pide la firma de quien autoriza (R5), y una manual
    con un salto de mas de 30 % contra la de cobro actual pide confirmar. Lo ya
    cobrado conserva su tasa."""
    if body.fuente not in tasas.ETIQUETAS_COBRO:
        raise HTTPException(status_code=400, detail="Elige Dólar BCV, Euro BCV o Manual")
    actual = tasas.cobro(db)
    if body.fuente == "eur" and not tasas.euro_vigente(db):
        raise HTTPException(
            status_code=409,
            detail="No hay euro del BCV guardado todavía. Espera a que se actualice o escribe la tasa a mano.",
        )
    if body.fuente == "manual":
        if not body.tasa or body.tasa <= 0:
            raise HTTPException(status_code=400, detail="Escribe la tasa manual: tiene que ser mayor que cero")
        if actual["tasa"] and tasas.salto(body.tasa, actual["tasa"]) > tasas.SALTO_MAXIMO:
            salvaguardas.pedir_confirmacion(
                request, "tasa_salto",
                f"Hoy se cobra a {salvaguardas.numero(actual['tasa'])} Bs y escribiste {salvaguardas.numero(body.tasa)}: "
                "es un salto de más de 30 %. ¿Es correcta, o falta o sobra un dígito?",
            )
    detalle = f"Cobrar en bolívares a {tasas.ETIQUETAS_COBRO[body.fuente]}" + (
        f" ({salvaguardas.numero(body.tasa)} Bs)" if body.fuente == "manual" else ""
    )
    salvaguardas.exigir_firma(db, request, "cambiar_tasa", detalle)
    tasas.fijar_cobro(db, body.fuente, body.tasa if body.fuente == "manual" else None)
    return tasas.estado(db)


@router.get("/al", response_model=schemas.TasaDeUnaFecha)
def tasa_de_una_fecha(fecha: datetime.date, db: Session = Depends(get_db)):
    """La tasa que valia ese dia, para pasar a Bs una factura de esa fecha."""
    fila = tasas.tasa_al(db, fecha)
    if fila is None:
        return schemas.TasaDeUnaFecha(pedida=fecha)
    return schemas.TasaDeUnaFecha(pedida=fecha, fecha=fila.fecha, bcv=fila.bcv, origen=fila.origen or "auto")


@router.get("/historial", response_model=List[schemas.PuntoTasa])
def historial(rango: Rango = Depends(), db: Session = Depends(get_db)):
    """La tasa dia por dia. Sin rango, los ultimos 30 dias."""
    inicio, fin, _ = rango.resolver(dias=30)
    return [
        schemas.PuntoTasa(
            fecha=t.fecha.isoformat(),
            bcv=t.bcv,
            eur=t.eur,
            paralelo=t.paralelo,
            origen=t.origen or "auto",
        )
        for t in tasas.historial(db, inicio.date(), fin.date())
    ]


@router.get("/analisis", response_model=schemas.AnalisisTasa)
def analisis(rango: Rango = Depends(), db: Session = Depends(get_db)):
    """Como se movio la tasa en el periodo y que significa para el negocio.

    Sin rango, los ultimos 30 dias: es lo que se mira para decidir si hay que
    tocar los precios del menu.
    """
    inicio, fin, etiqueta = rango.resolver(dias=30)
    return analisis_tasa.analizar(db, inicio, fin, etiqueta)
