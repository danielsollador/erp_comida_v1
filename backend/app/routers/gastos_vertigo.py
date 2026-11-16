"""Lo que le cuesta a Vertigo mantener Vertigo Pro: servidores, dominio, IA,
tiendas de apps. Cuanto, cada cuanto y cuando toca el proximo pago.

Solo lo sirve el hub y solo a Vertigo. Vive en el esquema `HUB` de PostgreSQL
(tablas en `hub_models.py`), no en el de ningun local.

La primera vez que arranca el hub con las tablas nuevas se siembran los gastos
que ya se conocian (`sembrar`). Los montos que nadie sabia van en `None`: la
pantalla los marca como "falta el monto" en vez de inventarlos.
"""
from __future__ import annotations

import calendar
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session, selectinload

from .. import settings
from ..acceso import auth
from ..database import get_db
from ..hub_models import GastoVertigo, PagoGastoVertigo

router = APIRouter(prefix="/api/gastos-vertigo", tags=["gastos-vertigo"])

CATEGORIAS = ("Infraestructura", "Dominios", "Inteligencia artificial",
              "Pagos y bancos", "Tiendas de apps", "Herramientas", "Otros")
MONEDAS = ("USD", "EUR", "VES")
# Cuantos meses cubre cada pago. `unico` y `a_demanda` no se reparten: no
# entran al mensual. `a_demanda` es credito prepago (la API de Claude): se
# recarga cuando se acaba, sin fecha fija; solo cuenta lo que se pago.
MESES = {"mensual": 1, "trimestral": 3, "semestral": 6, "anual": 12, "unico": 0,
         "a_demanda": 0}
ESTADOS = ("activo", "por_contratar", "por_cancelar", "cancelado")
# Lo que cuenta en el costo fijo: lo que se paga hoy. `por_cancelar` sigue
# cobrando hasta que alguien lo cancele de verdad.
CUENTAN = ("activo", "por_cancelar")

SEMILLA = [
    {"nombre": "VM de producción (e2-micro)", "proveedor": "Google Cloud",
     "categoria": "Infraestructura", "monto": 4.0, "frecuencia": "mensual",
     "estado": "activo", "nota": "Producción, demo y prueba en la misma VM."},
    {"nombre": "VPS", "proveedor": "Hostinger", "categoria": "Infraestructura",
     "monto": None, "frecuencia": "mensual", "estado": "por_cancelar",
     "nota": "Reemplazado por la VM de GCP. Cancelar el VPS, NO el dominio."},
    {"nombre": "Dominio vertigopro.tech", "proveedor": "Hostinger",
     "categoria": "Dominios", "monto": 63.99, "frecuencia": "anual",
     # Vence el 15-sep-2027; Hostinger cobra la renovacion 27 dias antes.
     "proximo_pago": date(2027, 8, 19), "estado": "activo",
     "nota": "El primer año salió gratis (registrado el 15-sep-2026). La "
             "renovación de .tech en Hostinger cuesta US$63,99 al año y se cobra "
             "27 días antes de que venza (15-sep-2027)."},
    {"nombre": "API de Claude", "proveedor": "Anthropic",
     "categoria": "Inteligencia artificial", "monto": 10.0,
     "frecuencia": "a_demanda", "estado": "activo",
     "nota": "Crédito prepago: se recarga cuando se acaba. En 2026 se cargaron US$10."},
    # Fechas del GET /me de Pabilo (29-oct): `last_renovation` 5-oct (el
    # primer pago del plan) y `next_renovation` 5-nov.
    {"nombre": "Verificación de pago móvil (plan Inicial)", "proveedor": "Pabilo",
     "categoria": "Pagos y bancos", "monto": 10.0, "frecuencia": "mensual",
     "proximo_pago": date(2026, 11, 5), "estado": "activo",
     "nota": "200 créditos al mes y 1 cuenta bancaria. Cada verificación nueva "
             "gasta 1 crédito. Activado el 5-oct-2026.",
     "pagos": [(date(2026, 10, 5), 10.0)]},
    {"nombre": "Apple Developer Program", "proveedor": "Apple",
     "categoria": "Tiendas de apps", "monto": 99.0, "frecuencia": "anual",
     "estado": "por_contratar", "nota": "Necesario para publicar en App Store."},
    {"nombre": "Cuenta de Google Play Console", "proveedor": "Google",
     "categoria": "Tiendas de apps", "monto": 25.0, "frecuencia": "unico",
     "estado": "por_contratar"},
]


def sembrar(db: Session) -> None:
    """Solo la llama el arranque del hub, y solo cuando acaba de crear la
    tabla: una lista que alguien vacio a proposito no se vuelve a llenar."""
    for g in SEMILLA:
        datos = {k: v for k, v in g.items() if k != "pagos"}
        db.add(GastoVertigo(**datos, pagos=[
            PagoGastoVertigo(fecha=f, monto=m, registrado_por="semilla")
            for f, m in g.get("pagos", ())]))
    db.commit()


def _exigir(request: Request) -> dict:
    # En un local la ruta existe (es la misma imagen), pero ahi no estan las
    # tablas: son del esquema del hub.
    if not settings.ES_HUB:
        raise HTTPException(404, "No encontrado.")
    return auth.exigir_vertigo(request)


def sumar_meses(d: date, meses: int) -> date:
    """El mismo dia `meses` despues; si ese mes es mas corto, su ultimo dia
    (31-ene + 1 mes = 28/29-feb)."""
    total = d.month - 1 + meses
    anio, mes = d.year + total // 12, total % 12 + 1
    return date(anio, mes, min(d.day, calendar.monthrange(anio, mes)[1]))


# --- Lectura ----------------------------------------------------------------

def _fin_de_mes(hoy: date) -> date:
    return hoy.replace(day=calendar.monthrange(hoy.year, hoy.month)[1])


def pagado_este_mes(g: GastoVertigo, hoy: date) -> bool:
    return any((p.fecha.year, p.fecha.month) == (hoy.year, hoy.month) for p in g.pagos)


def por_pagar_este_mes(g: GastoVertigo, hoy: date) -> bool:
    """Lo que hay que pagar antes de que cierre el mes, vencidos incluidos."""
    return (g.estado in CUENTAN and g.proximo_pago is not None
            and g.proximo_pago <= _fin_de_mes(hoy))


def _como_dict(g: GastoVertigo, hoy: date) -> dict:
    return {
        "pagado_mes": pagado_este_mes(g, hoy),
        "por_pagar_mes": por_pagar_este_mes(g, hoy),
        "id": g.id, "nombre": g.nombre, "proveedor": g.proveedor,
        "categoria": g.categoria, "monto": g.monto, "moneda": g.moneda,
        "frecuencia": g.frecuencia,
        "proximo_pago": g.proximo_pago.isoformat() if g.proximo_pago else None,
        "paga": g.paga, "estado": g.estado, "nota": g.nota,
        "pagos": [{"id": p.id, "fecha": p.fecha.isoformat(), "monto": p.monto,
                   "registrado_por": p.registrado_por} for p in g.pagos],
    }


def _resumen(gastos: list[GastoVertigo], hoy: date) -> dict:
    """Totales por moneda: no se convierte nada, la tasa no es asunto del hub."""
    mensual: dict[str, float] = {}
    anual: dict[str, float] = {}
    proximos: dict[str, float] = {}
    pagado_anio: dict[str, float] = {}
    pagado_mes: dict[str, float] = {}
    por_pagar_mes: dict[str, float] = {}
    limite = hoy + timedelta(days=30)
    vencen = sin_monto = activos = 0

    def sumar(d: dict, mon: str, v: float) -> None:
        d[mon] = d.get(mon, 0) + v

    for g in gastos:
        for p in g.pagos:
            if p.fecha.year == hoy.year:
                sumar(pagado_anio, g.moneda, p.monto)
                if p.fecha.month == hoy.month:
                    sumar(pagado_mes, g.moneda, p.monto)
        if g.estado not in CUENTAN:
            continue
        if g.monto is not None and por_pagar_este_mes(g, hoy):
            sumar(por_pagar_mes, g.moneda, g.monto)
        activos += 1
        if g.monto is None:
            # Lo que se va a cancelar no vale la pena averiguarlo.
            if g.estado == "activo":
                sin_monto += 1
            continue
        meses = MESES[g.frecuencia]
        if meses:
            sumar(mensual, g.moneda, g.monto / meses)
            sumar(anual, g.moneda, g.monto * 12 / meses)
        if g.proximo_pago and g.proximo_pago <= limite:
            vencen += 1
            sumar(proximos, g.moneda, g.monto)
    redondo = lambda d: {k: round(v, 2) for k, v in d.items()}
    return {
        "mensual": redondo(mensual), "anual": redondo(anual),
        "proximos_30": redondo(proximos), "pagado_anio": redondo(pagado_anio),
        "pagado_mes": redondo(pagado_mes), "por_pagar_mes": redondo(por_pagar_mes),
        "vencen_30": vencen, "activos": activos, "sin_monto": sin_monto,
    }


def _respuesta(db: Session) -> dict:
    hoy = date.today()
    gastos = db.query(GastoVertigo).options(selectinload(GastoVertigo.pagos)).all()
    gastos.sort(key=lambda g: (g.estado == "cancelado", g.proximo_pago or date.max,
                               g.nombre.lower()))
    return {
        "gastos": [_como_dict(g, hoy) for g in gastos], "resumen": _resumen(gastos, hoy),
        "hoy": hoy.isoformat(),
        "opciones": {"categorias": CATEGORIAS, "monedas": MONEDAS,
                     "frecuencias": list(MESES), "estados": ESTADOS},
    }


def _buscar(db: Session, gid: int) -> GastoVertigo:
    g = db.get(GastoVertigo, gid)
    if not g:
        raise HTTPException(404, "Ese gasto ya no existe.")
    return g


# --- Escritura --------------------------------------------------------------

class GastoIn(BaseModel):
    nombre: str = Field(max_length=80)
    proveedor: str = Field(default="", max_length=60)
    categoria: str = "Otros"
    monto: float | None = Field(default=None, ge=0)
    moneda: str = "USD"
    frecuencia: str = "mensual"
    proximo_pago: date | None = None
    paga: str = Field(default="", max_length=40)
    estado: str = "activo"
    nota: str = Field(default="", max_length=300)

    @field_validator("proveedor", "paga", "nota")
    @classmethod
    def _sin_espacios(cls, v: str) -> str:
        return v.strip()

    @field_validator("nombre")
    @classmethod
    def _nombre(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 2:
            raise ValueError("Escribe al menos dos letras.")
        return v

    @field_validator("categoria")
    @classmethod
    def _categoria(cls, v: str) -> str:
        if v not in CATEGORIAS:
            raise ValueError("Elige una categoría de la lista.")
        return v

    @field_validator("moneda")
    @classmethod
    def _moneda(cls, v: str) -> str:
        if v not in MONEDAS:
            raise ValueError("Moneda no reconocida.")
        return v

    @field_validator("frecuencia")
    @classmethod
    def _frecuencia(cls, v: str) -> str:
        if v not in MESES:
            raise ValueError("Frecuencia no reconocida.")
        return v

    @field_validator("estado")
    @classmethod
    def _estado(cls, v: str) -> str:
        if v not in ESTADOS:
            raise ValueError("Estado no reconocido.")
        return v


class PagoIn(BaseModel):
    fecha: date | None = None   # vacio = hoy
    monto: float | None = Field(default=None, ge=0)  # vacio = el del gasto


@router.get("")
def listar(request: Request, db: Session = Depends(get_db)) -> dict:
    _exigir(request)
    return _respuesta(db)


@router.post("")
def crear(body: GastoIn, request: Request, db: Session = Depends(get_db)) -> dict:
    _exigir(request)
    db.add(GastoVertigo(**body.model_dump()))
    db.commit()
    return _respuesta(db)


@router.put("/{gid}")
def editar(gid: int, body: GastoIn, request: Request, db: Session = Depends(get_db)) -> dict:
    _exigir(request)
    g = _buscar(db, gid)
    for campo, valor in body.model_dump().items():
        setattr(g, campo, valor)
    db.commit()
    return _respuesta(db)


@router.delete("/{gid}")
def borrar(gid: int, request: Request, db: Session = Depends(get_db)) -> dict:
    _exigir(request)
    db.delete(_buscar(db, gid))
    db.commit()
    return _respuesta(db)


@router.post("/{gid}/pago")
def registrar_pago(gid: int, body: PagoIn, request: Request,
                   db: Session = Depends(get_db)) -> dict:
    """Anota el pago y corre la fecha al siguiente. Se corre desde la fecha
    que tocaba, no desde hoy: pagar tarde no mueve el dia de cobro."""
    sesion = _exigir(request)
    g = _buscar(db, gid)
    monto = body.monto if body.monto is not None else g.monto
    if monto is None:
        raise HTTPException(422, "Este gasto no tiene monto: escribe cuánto se pagó.")
    fecha = body.fecha or date.today()
    g.pagos.append(PagoGastoVertigo(fecha=fecha, monto=monto,
                                    registrado_por=sesion.get("usuario", "")))
    meses = MESES[g.frecuencia]
    g.proximo_pago = sumar_meses(g.proximo_pago or fecha, meses) if meses else None
    # Pagar algo que estaba por contratar es contratarlo.
    if g.estado == "por_contratar":
        g.estado = "activo"
    db.commit()
    return _respuesta(db)


@router.delete("/{gid}/pago/{pid}")
def anular_pago(gid: int, pid: int, request: Request, db: Session = Depends(get_db)) -> dict:
    """Para el pago anotado por error. La proxima fecha NO se devuelve sola:
    no se sabe si ya la habian corregido a mano."""
    _exigir(request)
    p = db.get(PagoGastoVertigo, pid)
    if not p or p.gasto_id != gid:
        raise HTTPException(404, "Ese pago ya no existe.")
    db.delete(p)
    db.commit()
    return _respuesta(db)
