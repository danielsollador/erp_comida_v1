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

from . import contabilidad, models, reposicion

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

# Con menos dias que esto, el ritmo diario es ruido y no se proyecta.
DIAS_PARA_PROYECTAR = 7

# Los billetes con los que se explica la tasa: lo que cuesta "un dolar" no le
# dice nada a nadie; "veinte dolares eran 16.900 y hoy son 17.400" si.
BILLETES_USD = (1.0, 5.0, 10.0, 20.0, 50.0)

# Si los insumos subieron mas que esto por encima del dolar, la subida no la
# explica la tasa: la explica el proveedor.
INSUMOS_POR_ENCIMA_DEL_DOLAR_PCT = 5.0


def _pct(nuevo: float, viejo: float) -> Optional[float]:
    if not viejo:
        return None
    return round((nuevo / viejo - 1) * 100, 1)


def _brecha(bcv: Optional[float], paralelo: Optional[float]) -> Optional[float]:
    if not bcv or not paralelo:
        return None
    return round((paralelo / bcv - 1) * 100, 1)


def _cobrado_por_metodo(
    db: Session, inicio: datetime.datetime, fin: datetime.datetime
) -> dict:
    """Lo cobrado en el periodo, metodo por metodo, en dolares.

    Se mira pago por pago y no pedido por pedido: una venta mixta --unos
    dolares en efectivo y el resto en pago movil-- solo expone a la brecha la
    parte que entro en bolivares. El fiado no cuenta: todavia no es plata.
    """
    pagos = (
        db.query(models.PagoPedido)
        .join(models.Pedido)
        .filter(
            models.Pedido.estado == "pagado",
            models.Pedido.devuelto.is_(False),
            models.Pedido.cerrado_en >= inicio,
            models.Pedido.cerrado_en < fin,
        )
        .all()
    )
    por_metodo: dict = {}
    for p in pagos:
        if contabilidad.CUENTA_POR_METODO_PAGO.get(p.metodo) == CUENTA_FIADO:
            continue
        por_metodo[p.metodo] = round(por_metodo.get(p.metodo, 0.0) + p.monto, 2)
    return por_metodo


def _cobrado_en_bolivares(
    db: Session, inicio: datetime.datetime, fin: datetime.datetime
) -> float:
    """Lo que se cobro EN BOLIVARES en el periodo, expresado en dolares."""
    por_metodo = _cobrado_por_metodo(db, inicio, fin)
    return round(sum(m for metodo, m in por_metodo.items() if metodo in METODOS_EN_BS), 2)


def _ritmo_y_proyeccion(primero, ultimo):
    """(ritmo diario %, tasa a 30 dias, % a 30 dias) si hay dias suficientes.

    Es interes compuesto hacia adelante, nada mas: una extrapolacion que sirve
    para dimensionar ("a este paso, en un mes el dolar esta 6% mas caro"), no
    un pronostico. La lectura lo dice asi.
    """
    if not primero or not ultimo or not primero["bcv"]:
        return None, None, None
    dias = (
        datetime.date.fromisoformat(ultimo["fecha"]) - datetime.date.fromisoformat(primero["fecha"])
    ).days
    if dias < DIAS_PARA_PROYECTAR:
        return None, None, None
    ritmo = (ultimo["bcv"] / primero["bcv"]) ** (1 / dias) - 1
    proyeccion = ultimo["bcv"] * (1 + ritmo) ** 30
    return round(ritmo * 100, 3), round(proyeccion, 2), round((proyeccion / ultimo["bcv"] - 1) * 100, 1)


def _mayor_salto(puntos) -> Optional[dict]:
    """El dia con el mayor movimiento del oficial, en cualquier direccion."""
    mejor = None
    for antes, despues in zip(puntos, puntos[1:]):
        if not antes["bcv"]:
            continue
        pct = round((despues["bcv"] / antes["bcv"] - 1) * 100, 2)
        if mejor is None or abs(pct) > abs(mejor["pct"]):
            mejor = {"fecha": despues["fecha"], "de": antes["bcv"], "a": despues["bcv"], "pct": pct}
    return mejor


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

    por_metodo = _cobrado_por_metodo(db, inicio, fin)
    cobrado_total = round(sum(por_metodo.values()), 2)
    cobrado_bs = round(sum(m for metodo, m in por_metodo.items() if metodo in METODOS_EN_BS), 2)
    cobrado_divisas = round(cobrado_total - cobrado_bs, 2)
    exposicion = round(cobrado_bs / cobrado_total * 100, 1) if cobrado_total else None
    por_metodo_bs = sorted(
        (
            {"nombre": metodo, "monto": monto, "pct": round(monto / cobrado_bs * 100, 1) if cobrado_bs else 0.0}
            for metodo, monto in por_metodo.items()
            if metodo in METODOS_EN_BS and monto > 0
        ),
        key=lambda g: g["monto"],
        reverse=True,
    )
    # Lo que valen esos bolivares comprando divisas: con 11% de brecha, de cada
    # $100 cobrados al oficial quedan $90.
    costo_brecha = (
        round(cobrado_bs * (1 - 1 / (1 + brecha_fin / 100)), 2)
        if brecha_fin and cobrado_bs
        else 0.0
    )

    ritmo, proyeccion, proyeccion_pct = _ritmo_y_proyeccion(primero, ultimo)
    salto = _mayor_salto(puntos)
    equivalencias = (
        [
            {"usd": usd, "bs_inicio": round(usd * primero["bcv"], 2), "bs_fin": round(usd * ultimo["bcv"], 2)}
            for usd in BILLETES_USD
        ]
        if primero and ultimo
        else []
    )
    # Los insumos del mismo periodo. `inflacion_de_insumos` mira las compras
    # de los ultimos N dias; se le pasa el largo del rango (minimo una semana,
    # que con menos no hay dos compras del mismo insumo que comparar).
    dias_rango = max(7, (fin - inicio).days)
    inflacion = reposicion.inflacion_de_insumos(db, dias=dias_rango)
    inflacion_pct = inflacion["cambio_pct"] if inflacion else None

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
        )
        + _lecturas_de_ritmo(
            variacion, ultimo, ritmo, proyeccion, proyeccion_pct, salto,
            exposicion, cobrado_bs, cobrado_total, inflacion_pct,
        ),
        "ritmo_diario_pct": ritmo,
        "proyeccion_30d": proyeccion,
        "proyeccion_30d_pct": proyeccion_pct,
        "mayor_salto": salto,
        "cobrado_total_usd": cobrado_total,
        "cobrado_divisas_usd": cobrado_divisas,
        "exposicion_pct": exposicion,
        "por_metodo_bs": por_metodo_bs,
        "equivalencias": equivalencias,
        "inflacion_insumos_pct": inflacion_pct,
    }


def _lecturas_de_ritmo(
    variacion, ultimo, ritmo, proyeccion, proyeccion_pct, salto,
    exposicion, cobrado_bs, cobrado_total, inflacion_pct,
) -> List[dict]:
    """Las lecturas nuevas: a donde va, cuanto estas expuesto, y de quien
    es la culpa de que los costos suban."""
    out: List[dict] = []

    # 6. A donde llega si sigue igual. Se dice como extrapolacion, no como
    #    pronostico: nadie sabe que hara el BCV, pero si se puede decir que
    #    pasa si no cambia nada.
    if proyeccion is not None and proyeccion_pct is not None and abs(proyeccion_pct) >= 1:
        sube = proyeccion_pct > 0
        out.append({
            "tipo": "alerta" if proyeccion_pct >= 5 else "info",
            "titulo": f"A este ritmo, en 30 días el dólar estaría en {proyeccion:,.2f}",
            "detalle": (
                f"Se mueve {ritmo:+.2f}% por día. Si sigue igual, en un mes "
                f"{'sube' if sube else 'baja'} {abs(proyeccion_pct)}% desde los {ultimo['bcv']:,.2f} de hoy. "
                + (
                    "Conviene revisar los precios del menú antes, no después: cada semana que pasa "
                    "la mercancía se repone un poco más cara."
                    if sube and proyeccion_pct >= 5
                    else "Es una extrapolación de lo que ya pasó, no un pronóstico: sirve para dimensionar."
                )
            ),
        })

    # 7. El dia del salto. Un movimiento concentrado en un dia es distinto de
    #    una subida pareja: es el dia que la cajera cobro a una tasa vieja si
    #    la de la mañana no se actualizo.
    if salto and abs(salto["pct"]) >= 1.0:
        fecha = datetime.date.fromisoformat(salto["fecha"]).strftime("%d/%m")
        out.append({
            "tipo": "info",
            "titulo": f"El mayor salto fue el {fecha}: {salto['pct']:+.2f}% en un día",
            "detalle": (
                f"Pasó de {salto['de']:,.2f} a {salto['a']:,.2f}. Los días así, la tasa de la mañana "
                "ya no vale a mediodía: el sistema la refresca solo cada media hora, y si se "
                "fijó a mano hay que volver a tocarla."
            ),
        })

    # 8. Exposicion: que parte de la plata entro en bolivares. Es la que la
    #    brecha se come; el resto no pierde nada.
    if exposicion is not None and cobrado_total > 0:
        if exposicion >= 60:
            tipo, titulo = "alerta", f"El {exposicion:.0f}% de lo cobrado entró en bolívares"
            consejo = (
                "Casi todo lo que vendes lo cobras al oficial y lo repones al paralelo. "
                "Cada punto que muevas hacia divisas o hacia precios en dólares es margen que se queda."
            )
        elif exposicion >= 30:
            tipo, titulo = "info", f"El {exposicion:.0f}% de lo cobrado entró en bolívares"
            consejo = "La otra parte entró en divisas y no pierde nada con la brecha."
        else:
            tipo, titulo = "bueno", f"Solo el {exposicion:.0f}% de lo cobrado entró en bolívares"
            consejo = "La brecha te afecta poco: la mayor parte de la venta ya entra en divisas."
        out.append({
            "tipo": tipo,
            "titulo": titulo,
            "detalle": f"${cobrado_bs:,.2f} de ${cobrado_total:,.2f}. {consejo}",
        })

    # 9. Insumos contra dolar. La pregunta de fondo del dueño: "todo esta mas
    #    caro, ¿es el dolar?". Con las compras del periodo se puede responder.
    if inflacion_pct is not None and variacion is not None and inflacion_pct > 0:
        diferencia = inflacion_pct - variacion
        if diferencia >= INSUMOS_POR_ENCIMA_DEL_DOLAR_PCT:
            out.append({
                "tipo": "alerta",
                "titulo": f"Tu mercancía subió {inflacion_pct}% y el dólar {variacion:+.1f}%",
                "detalle": (
                    f"La diferencia ({diferencia:.1f} puntos) no viene de la tasa: viene de los "
                    "proveedores. Ajustar el menú solo por el dólar te deja corto; revisa en "
                    "Inventario qué mercancía subió más y a quién se la compras."
                ),
            })
        elif abs(diferencia) < INSUMOS_POR_ENCIMA_DEL_DOLAR_PCT:
            out.append({
                "tipo": "info",
                "titulo": f"La mercancía subió pareja con el dólar ({inflacion_pct}% contra {variacion:+.1f}%)",
                "detalle": "La subida de costos es la de la tasa, no de los proveedores. "
                           "Con el menú en dólares, el margen se sostiene solo.",
            })
        else:
            out.append({
                "tipo": "bueno",
                "titulo": f"Tu mercancía subió menos que el dólar ({inflacion_pct}% contra {variacion:+.1f}%)",
                "detalle": "Los proveedores no trasladaron toda la subida. Buen momento para "
                           "comprar lo que aguante en depósito.",
            })

    return out


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
                    "Tu mercancía se repondrá más cara: si el menú no subió parecido, el margen "
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
