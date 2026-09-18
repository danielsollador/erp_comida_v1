"""Que dice la tasa de cambio, leida en prosa.

POR QUE EXISTE. El modulo de Tasa mostraba numeros --la de hoy, la de ayer,
una tabla-- y ninguna respuesta. La pregunta del dueño no es "cuanto esta el
dolar": es "¿tengo que subir precios?" y "¿cuanto me esta costando esto?".

Traido del modulo cambiario de Vertigo Timon, donde el analisis se llama
"Margen comido por la tasa": los precios en bolivares fijados hace dias que,
con la tasa de hoy, ya no dejan el margen que decia la lista.

AQUI ES DISTINTO Y POR ESO SE ADAPTO. Este ERP no guarda precios en
bolivares: el menu esta en dolares y los bolivares se calculan al cobrar, asi
que un precio nunca "se queda viejo". Lo que si se come el margen es LA
BRECHA: se cobra al oficial y se repone comprando divisas en la calle. Por eso
la cuenta se hace sobre lo que de verdad entro en bolivares --que el sistema
sabe, porque guarda con que metodo se pago cada venta-- y no sobre la venta
entera: lo que el cliente pago en efectivo en dolares no pierde nada.

Todo es deterministico: sin llamadas a ningun modelo, sin costo variable.
"""
from __future__ import annotations

import datetime
from typing import List, Optional

from sqlalchemy.orm import Session

from . import contabilidad, models

# La gaveta de los dolares en efectivo y la cuenta del fiado. Lo que entra por
# ahi no pasa por la tasa: las divisas ya son divisas, y el fiado todavia no es
# plata (no se sabe a que tasa ni en que moneda se va a cobrar).
CUENTA_DIVISAS = "1011"
CUENTA_FIADO = "1015"

# Los metodos con los que entra bolivares, deducidos del plan de cuentas en vez
# de repetidos aqui: un metodo de pago nuevo queda clasificado solo.
METODOS_EN_BS = frozenset(
    metodo
    for metodo, cuenta in contabilidad.CUENTA_POR_METODO_PAGO.items()
    if cuenta not in (CUENTA_DIVISAS, CUENTA_FIADO)
)

# Por debajo de esto, mover la tasa es ruido del dia a dia y no una señal.
MOVIMIENTO_QUE_IMPORTA_PCT = 2.0

# Una brecha de mas de esto ya no es un detalle: es un pedazo del margen.
BRECHA_QUE_DUELE_PCT = 8.0


def _pct(nuevo: float, viejo: float) -> Optional[float]:
    if not viejo:
        return None
    return round((nuevo / viejo - 1) * 100, 1)


def _brecha(bcv: Optional[float], paralelo: Optional[float]) -> Optional[float]:
    if not bcv or not paralelo:
        return None
    return round((paralelo / bcv - 1) * 100, 1)


def _cobrado_en_bolivares(
    db: Session, inicio: datetime.datetime, fin: datetime.datetime
) -> float:
    """Lo que se cobro EN BOLIVARES en el periodo, expresado en dolares.

    Se mira pago por pago y no pedido por pedido: una venta mixta --unos
    dolares en efectivo y el resto en pago movil-- solo expone a la brecha la
    parte que entro en bolivares.
    """
    pagos = (
        db.query(models.PagoPedido)
        .join(models.Pedido)
        .filter(
            models.Pedido.estado == "pagado",
            models.Pedido.devuelto.is_(False),
            models.Pedido.cerrado_en >= inicio,
            models.Pedido.cerrado_en < fin,
            models.PagoPedido.metodo.in_(tuple(METODOS_EN_BS)),
        )
        .all()
    )
    return round(sum(p.monto for p in pagos), 2)


def analizar(
    db: Session, inicio: datetime.datetime, fin: datetime.datetime, etiqueta: str
) -> dict:
    """La serie del periodo y lo que se lee en ella."""
    filas = (
        db.query(models.TasaCambio)
        .filter(models.TasaCambio.fecha >= inicio.date(), models.TasaCambio.fecha < fin.date())
        .order_by(models.TasaCambio.fecha.asc())
        .all()
    )
    # Con una sola fila no hay serie que dibujar ni movimiento que leer, pero
    # la brecha de ese dia si se puede decir.
    puntos = [
        {
            "fecha": f.fecha.isoformat(),
            "bcv": f.bcv,
            "eur": f.eur,
            "paralelo": f.paralelo,
            "brecha_pct": _brecha(f.bcv, f.paralelo),
        }
        for f in filas
        if f.bcv
    ]

    con_paralelo = [p for p in puntos if p["brecha_pct"] is not None]
    primero = puntos[0] if puntos else None
    ultimo = puntos[-1] if puntos else None

    variacion = _pct(ultimo["bcv"], primero["bcv"]) if primero and ultimo else None
    brechas = [p["brecha_pct"] for p in con_paralelo]
    brecha_fin = con_paralelo[-1]["brecha_pct"] if con_paralelo else None
    brecha_inicio = con_paralelo[0]["brecha_pct"] if con_paralelo else None

    cobrado_bs = _cobrado_en_bolivares(db, inicio, fin)
    # Lo que valen esos bolivares comprando divisas: con 11% de brecha, de cada
    # $100 cobrados al oficial quedan $90.
    costo_brecha = (
        round(cobrado_bs * (1 - 1 / (1 + brecha_fin / 100)), 2)
        if brecha_fin and cobrado_bs
        else 0.0
    )

    return {
        "etiqueta": etiqueta,
        "puntos": puntos,
        "dias": len(puntos),
        "bcv_inicio": primero["bcv"] if primero else None,
        "bcv_fin": ultimo["bcv"] if ultimo else None,
        "bcv_min": min((p["bcv"] for p in puntos), default=None),
        "bcv_max": max((p["bcv"] for p in puntos), default=None),
        "variacion_pct": variacion,
        "brecha_inicio_pct": brecha_inicio,
        "brecha_fin_pct": brecha_fin,
        "brecha_media_pct": round(sum(brechas) / len(brechas), 1) if brechas else None,
        "cobrado_bs_usd": cobrado_bs,
        "costo_brecha_usd": costo_brecha,
        "lecturas": _lecturas(
            variacion, primero, ultimo, brecha_inicio, brecha_fin, cobrado_bs, costo_brecha, filas
        ),
    }


def _lecturas(
    variacion, primero, ultimo, brecha_inicio, brecha_fin, cobrado_bs, costo_brecha, filas
) -> List[dict]:
    """Lo que hay que hacer con esos numeros, dicho en una frase."""
    out: List[dict] = []

    if not primero:
        out.append({
            "tipo": "info",
            "titulo": "Todavía no hay tasas guardadas en este periodo",
            "detalle": "El sistema guarda una tasa por día. Elige un periodo más amplio, o "
                       "consulta el BCV para empezar el histórico de hoy.",
        })
        return out

    # 1. Cuanto se movio el dolar, y que significa para los precios.
    if variacion is not None and abs(variacion) >= MOVIMIENTO_QUE_IMPORTA_PCT:
        subio = variacion > 0
        out.append({
            "tipo": "alerta" if subio else "info",
            "titulo": f"El dólar {'subió' if subio else 'bajó'} {abs(variacion)}% en el periodo",
            "detalle": (
                f"De {primero['bcv']:,.2f} a {ultimo['bcv']:,.2f} bolívares. "
                + (
                    "Tus insumos se repondrán más caros: si el menú no subió parecido, el margen "
                    "de cada plato ya es menor que el de la carta."
                    if subio
                    else "Si bajaste precios siguiendo la subida anterior, este es el momento de revisar."
                )
            ),
        })
    elif variacion is not None:
        out.append({
            "tipo": "bueno",
            "titulo": f"El dólar se movió poco: {'+' if variacion >= 0 else ''}{variacion}%",
            "detalle": f"De {primero['bcv']:,.2f} a {ultimo['bcv']:,.2f} bolívares. "
                       "Con la tasa quieta, los precios del menú aguantan.",
        })

    # 2. La brecha: cuanto vale de verdad lo que cobras al oficial.
    if brecha_fin is not None:
        queda = 100 / (1 + brecha_fin / 100)
        movimiento = (
            None if brecha_inicio is None else round(brecha_fin - brecha_inicio, 1)
        )
        detalle = (
            f"De cada $100 que cobras en bolívares al oficial, te quedan ${queda:.2f} "
            "si con esos bolívares compras divisas."
        )
        if movimiento:
            detalle += (
                f" La brecha se {'abrió' if movimiento > 0 else 'cerró'} "
                f"{abs(movimiento)} puntos en el periodo."
            )
        out.append({
            "tipo": "alerta" if brecha_fin >= BRECHA_QUE_DUELE_PCT else "info",
            "titulo": f"La brecha esta en {brecha_fin}%",
            "detalle": detalle,
        })

    # 3. LO QUE COSTO, en plata. Es la unica linea que convierte todo lo de
    #    arriba en una cifra que se puede comparar con un gasto.
    if costo_brecha > 0:
        out.append({
            "tipo": "alerta",
            "titulo": f"La brecha se llevó ${costo_brecha:,.2f} de lo cobrado",
            "detalle": (
                f"Cobraste ${cobrado_bs:,.2f} en bolívares (efectivo Bs, pago móvil, "
                f"transferencia y tarjeta). A la hora de reponer comprando divisas, eso "
                f"rinde como ${cobrado_bs - costo_brecha:,.2f}. Lo que se cobró en efectivo "
                "en dólares no pierde nada: por eso conviene tener precio en divisas."
            ),
        })

    # 4. Una tasa cargada a mano por debajo del oficial es plata regalada, y
    #    por encima espanta al cliente. Se mira la ultima del periodo.
    hoy_fila = filas[-1] if filas else None
    if hoy_fila is not None and hoy_fila.origen == "manual" and ultimo:
        out.append({
            "tipo": "info",
            "titulo": "La última tasa del periodo la cargaste a mano",
            "detalle": (
                f"Se cobra a {ultimo['bcv']:,.2f}. Mientras siga en manual no se actualiza "
                "sola: si el dólar se mueve, hay que volver a tocarla o devolverla a automática."
            ),
        })

    # 5. Dias sin tasa: si el historico tiene huecos, los promedios enganan.
    if primero and ultimo:
        esperados = (
            datetime.date.fromisoformat(ultimo["fecha"])
            - datetime.date.fromisoformat(primero["fecha"])
        ).days + 1
        faltan = esperados - len(filas)
        if faltan > 2:
            out.append({
                "tipo": "info",
                "titulo": f"Faltan {faltan} días de tasa en el periodo",
                "detalle": "El BCV no publica fines de semana ni feriados, y sin internet "
                           "tampoco se guarda. Para cobrar se usa la última conocida.",
            })

    return out
