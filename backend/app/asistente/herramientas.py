"""Lo que el asistente puede consultar, y nada más.

TODO ES DE SOLO LECTURA. Cada herramienta llama a la misma función que arma
la pantalla correspondiente (Reportes › Resumen, Inventario, Pérdidas,
avisos de la portada), así que el número que dice el asistente es el mismo
que ve el dueño si va a mirarlo: no hay una segunda definición de "ventas".

El local sale de la sesión (el `search_path` que ya puso el middleware), nunca
del modelo; y cada herramienta exige el módulo que la pantalla exigiría. Un
rol que no ve Reportes tampoco puede preguntarle al asistente cuánto se
vendió: la herramienta ni siquiera se le ofrece.
"""
import datetime
from dataclasses import dataclass
from typing import Callable, Optional

from sqlalchemy.orm import Session

from ..acceso import permisos
from ..rango import Rango
from ..routers import reportes
from .. import consolidacion
from ..timeutils import ahora, hoy, inicio_del_dia


@dataclass
class Herramienta:
    declaracion: dict
    ejecutar: Callable[..., dict]
    # Basta con UNO de estos módulos. None = cualquiera con sesión.
    modulos: Optional[tuple] = None
    # Cifras de plata del negocio: solo quien ve los KPIs de la portada.
    plata: bool = False


def _rango(desde: Optional[str], hasta: Optional[str]) -> Rango:
    d = datetime.date.fromisoformat(desde) if desde else hoy()
    h = datetime.date.fromisoformat(hasta) if hasta else d
    if h < d:
        d, h = h, d
    return Rango(desde=d, hasta=h, periodo=None, anio=None, mes=None, dias=None)


def _r(x: float) -> float:
    return round(x or 0, 2)


_FECHAS = {
    "desde": {"type": "string", "description": "Primer día, AAAA-MM-DD, inclusive."},
    "hasta": {"type": "string", "description": "Último día, AAAA-MM-DD, inclusive. Igual a desde para un solo día."},
}


def ventas(db: Session, desde: Optional[str] = None, hasta: Optional[str] = None) -> dict:
    rango = _rango(desde, hasta)
    r = reportes.resumen(rango=rango, paso=None, categoria_id=[], producto_id=[], db=db)
    a = r.anterior
    # Si el período es HOY, el anterior (ayer) está completo y hoy no: el
    # modelo leía "50 vs 96" como una caída y llegó a inventar que era "a esta
    # misma hora" aunque una nota se lo aclaraba. Se le da el dato verdadero.
    a_esta_hora = None
    if rango.desde == rango.hasta == hoy():
        t = ahora()
        ayer = inicio_del_dia(hoy() - datetime.timedelta(days=1))
        b = consolidacion.bloque_para(db, ayer, ayer + (t - inicio_del_dia(hoy())))
        a_esta_hora = {
            "hasta_las": f"{t:%H:%M}",
            "ventas_usd": _r(b.ventas),
            "pedidos": b.pedidos,
            "cambio_ventas_pct": round((r.ventas - b.ventas) / b.ventas * 100, 1) if b.ventas else None,
        }
    return {
        "periodo": r.etiqueta,
        "ayer_hasta_esta_misma_hora": a_esta_hora,
        "ventas_usd": _r(r.ventas),
        "ventas_bs": _r(r.ventas_bs),
        "pedidos": r.pedidos,
        "ticket_promedio_usd": _r(r.ticket_promedio),
        "costo_mercancia_usd": _r(r.costo_insumos),
        "ganancia_bruta_usd": _r(r.ganancia_bruta),
        "margen_pct": _r(r.margen_pct),
        "gastos_usd": _r(r.gastos),
        "ganancia_neta_usd": _r(r.ganancia_neta),
        "anulados": r.pedidos_anulados,
        "devoluciones": r.devoluciones,
        "por_forma_de_pago_usd": {k: _r(v) for k, v in (r.por_metodo_pago or {}).items()},
        "contra_periodo_anterior": (
            {
                # Con fechas: "el período anterior" a secas se leía como "la
                # semana pasada completa" y no lo es (son los N días de antes).
                "desde": (rango.desde - (rango.hasta - rango.desde) - datetime.timedelta(days=1)).isoformat(),
                "hasta": (rango.desde - datetime.timedelta(days=1)).isoformat(),
                "que_es": "los mismos días de largo justo antes del período (no la semana o el mes calendario anterior)",
                "ventas_usd": _r(a.ventas),
                "pedidos": a.pedidos,
                "cambio_ventas_pct": a.cambio_ventas_pct,
                "cambio_ganancia_pct": a.cambio_ganancia_pct,
            }
            if a
            else None
        ),
        "mas_vendidos": [
            {
                "producto": p.nombre,
                "unidades": p.unidades,
                "ventas_usd": _r(p.ingresos),
                "ganancia_usd": _r(p.ganancia),
                "margen_pct": None if p.sin_receta else _r(p.margen_pct),
                "sin_receta": p.sin_receta,
            }
            for p in r.top_productos[:10]
        ],
        "por_categoria": [{"categoria": g.nombre, "ventas_usd": _r(g.ventas)} for g in (r.por_categoria or [])[:8]],
        "por_dia_de_semana": [{"dia": g.nombre, "ventas_usd": _r(g.ventas)} for g in (r.por_dia_semana or [])],
        "lecturas_del_sistema": [f"{i.titulo}. {i.detalle}" for i in r.insights[:5]],
    }


def inventario(db: Session) -> dict:
    h = hoy()
    rango = _rango((h - datetime.timedelta(days=29)).isoformat(), h.isoformat())
    r = reportes.reporte_inventario(rango=rango, categoria_id=[], ingrediente_id=[], db=db)
    por_acabarse = sorted(
        (i for i in r.por_insumo if i.dias_de_stock is not None and i.por_dia > 0),
        key=lambda i: i.dias_de_stock,
    )[:10]
    return {
        "valor_del_deposito_usd": _r(r.valor_total),
        "mercancias_activas": r.activos,
        "bajo_el_minimo": r.bajo_minimo,
        "agotadas": r.agotados,
        "sin_costo_cargado": r.sin_costo,
        "plata_quieta_usd": _r(r.valor_quieto),
        "lo_que_se_acaba_primero": [
            {"mercancia": i.nombre, "hay": round(i.cantidad, 2), "unidad": i.unidad, "alcanza_dias": round(i.dias_de_stock, 1)}
            for i in por_acabarse
        ],
        "sugerido_comprar": [
            {"mercancia": s.ingrediente_nombre, "comprar": round(s.cantidad_sugerida, 2), "unidad": s.unidad, "por_que": s.razon}
            for s in r.por_comprar[:12]
        ],
        "lecturas_del_sistema": [f"{i.titulo}. {i.detalle}" for i in r.insights[:5]],
    }


def perdidas(db: Session, desde: Optional[str] = None, hasta: Optional[str] = None) -> dict:
    r = reportes.reporte_perdidas(rango=_rango(desde, hasta), categoria_id=[], ingrediente_id=[], db=db)
    return {
        "periodo": r.etiqueta,
        "merma_usd": _r(r.merma),
        "merma_pct_de_la_venta": _r(r.peso_pct),
        "merma_anterior_usd": _r(r.merma_anterior),
        "cambio_pct": r.cambio_pct,
        "consumo_personal_usd": _r(r.consumo_personal),
        "por_mercancia": [{"mercancia": p.nombre, "usd": _r(p.valor)} for p in r.por_insumo[:8]],
        "por_motivo": [{"motivo": p.motivo, "usd": _r(p.valor)} for p in r.por_motivo[:6]],
    }


def margenes(db: Session, orden: str = "menor") -> dict:
    filas = reportes._margenes_de_reposicion(db)
    filas.sort(key=lambda f: f["margen_pct"], reverse=(orden == "mayor"))
    return {
        "explicacion": "margen_pct = con el costo promedio de lo comprado; margen_a_precios_de_hoy = si repusieras la mercancía hoy.",
        "productos": [
            {"producto": f["nombre"], "margen_pct": f["margen_pct"], "margen_a_precios_de_hoy_pct": f["margen_reposicion_pct"]}
            for f in filas[:15]
        ],
        "productos_con_receta": len(filas),
    }


def avisos(db: Session) -> dict:
    return {"avisos": [{"titulo": a.titulo, "detalle": a.detalle, "donde": a.a} for a in reportes.avisos(db=db)]}


HERRAMIENTAS: dict = {
    "ventas": Herramienta(
        {
            "name": "ventas",
            "description": "Ventas, pedidos, ticket, costo, ganancia y margen de un período, comparado con el período anterior del mismo largo; productos más vendidos con su margen; formas de pago; por categoría y por día de la semana.",
            "parameters": {"type": "object", "properties": _FECHAS},
        },
        ventas,
        modulos=("reportes",),
        plata=True,
    ),
    "inventario": Herramienta(
        {
            "name": "inventario",
            "description": "El depósito hoy: qué se acaba primero (días que alcanza al ritmo de los últimos 30 días), qué está bajo el mínimo o agotado, qué conviene comprar y cuánta plata hay quieta.",
            "parameters": {"type": "object", "properties": {}},
        },
        inventario,
        modulos=("inventario", "reportes"),
    ),
    "perdidas": Herramienta(
        {
            "name": "perdidas",
            "description": "Merma (lo que se botó, dañó o faltó en conteos) de un período: cuánto, qué mercancía, por qué motivo y contra el período anterior.",
            "parameters": {"type": "object", "properties": _FECHAS},
        },
        perdidas,
        modulos=("reportes", "inventario"),
        plata=True,
    ),
    "margenes": Herramienta(
        {
            "name": "margenes",
            "description": "Margen de cada producto del menú según su receta, y el margen si la mercancía se repusiera a los precios de hoy. Solo productos con receta.",
            "parameters": {
                "type": "object",
                "properties": {"orden": {"type": "string", "enum": ["menor", "mayor"], "description": "menor = los que menos dejan primero."}},
            },
        },
        margenes,
        modulos=("menu", "recetas", "reportes"),
        plata=True,
    ),
    "avisos": Herramienta(
        {
            "name": "avisos",
            "description": "Lo que el sistema le avisaría hoy al dueño: mercancía por acabarse, cuentas por cobrar (fiado), costos que subieron, IVA del mes.",
            "parameters": {"type": "object", "properties": {}},
        },
        avisos,
        modulos=("reportes",),
        plata=True,
    ),
}


def disponibles(rol: str) -> dict:
    """Las herramientas que este rol puede usar (las demás no se le ofrecen)."""
    salida = {}
    for nombre, h in HERRAMIENTAS.items():
        if h.modulos and not any(permisos.puede_modulo(rol, m) for m in h.modulos):
            continue
        if h.plata and not permisos.ve_kpis(rol):
            continue
        salida[nombre] = h
    return salida
