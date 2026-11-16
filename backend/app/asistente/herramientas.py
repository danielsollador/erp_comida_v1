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
from .. import consolidacion, contabilidad, models, reposicion, texto
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


def movimientos_de_caja(db: Session, forma_de_pago: str, fecha: Optional[str] = None) -> dict:
    """Todo lo que movio esa gaveta o cuenta ese dia, con su descripcion: lo
    que explica un "salio" o un sobrante sin tener que adivinar."""
    cuenta = contabilidad.CUENTA_POR_METODO_PAGO.get(forma_de_pago)
    if not cuenta:
        return {"error": f"Forma de pago desconocida: {forma_de_pago}"}
    dia = datetime.date.fromisoformat(fecha) if fecha else hoy()
    inicio = inicio_del_dia(dia)
    filas = (
        db.query(models.AsientoContable, models.MovimientoContable)
        .join(models.MovimientoContable, models.MovimientoContable.asiento_id == models.AsientoContable.id)
        .join(models.CuentaContable, models.CuentaContable.id == models.MovimientoContable.cuenta_id)
        .filter(
            models.CuentaContable.codigo == cuenta,
            models.AsientoContable.fecha >= inicio,
            models.AsientoContable.fecha < inicio + datetime.timedelta(days=1),
        )
        .order_by(models.AsientoContable.fecha)
        .all()
    )
    return {
        "fecha": dia.isoformat(),
        "forma_de_pago": forma_de_pago,
        "movimientos": [
            {"hora": a.fecha.strftime("%H:%M"), "que": a.descripcion, "entro": _r(d.debe), "salio": _r(d.haber)}
            for a, d in filas
        ],
        "total_entro": _r(sum(d.debe or 0 for _, d in filas)),
        "total_salio": _r(sum(d.haber or 0 for _, d in filas)),
    }


def compras_de_mercancia(db: Session, nombre: str) -> dict:
    """El costo de una mercancia y de donde sale: lo que dice su ficha, lo
    ultimo que se pago y sus ultimas compras."""
    buscado = texto.comparable(nombre)
    ultimos = reposicion.costos_reposicion(db)
    salida = []
    for ing in db.query(models.Ingrediente).filter(models.Ingrediente.activo.is_(True)).all():
        if buscado not in texto.comparable(ing.nombre):
            continue
        salida.append({
            "nombre": ing.nombre,
            "unidad": ing.unidad,
            "hay": _r(ing.stock_actual),
            "costo_en_la_ficha": ing.costo_unitario or 0,
            "costo_que_usa_el_menu": reposicion.costo_reposicion_efectivo(ing, ultimos),
            "ultimas_compras": [
                {
                    "fecha": c["fecha"].strftime("%Y-%m-%d %H:%M"),
                    "cantidad": c["cantidad"],
                    "costo_por_unidad": c["costo_unitario"],
                    "total": _r(c["cantidad"] * c["costo_unitario"]),
                    "como": c["origen"],
                }
                for c in reposicion.historial_de_costos(db, ing.id, limite=5)
            ],
        })
        if len(salida) == 5:
            break
    return {"mercancias": salida} if salida else {"error": f"No hay mercancía que se llame como «{nombre}»."}


# ── QA de noviembre (hallazgos 13, 14 y 27): lo que Dona no sabia ──────────
# En el examen de 40 preguntas acerto 20 y 15 fueron "no tengo ese dato".
# Cada herramienta lee lo mismo que su pantalla; ninguna suma a mano.


def gastos(db: Session, desde: Optional[str] = None, hasta: Optional[str] = None) -> dict:
    """Los gastos del periodo, cuenta por cuenta: el Estado de resultados."""
    from ..routers.contabilidad import estado_resultados

    er = estado_resultados(rango=_rango(desde, hasta), db=db)
    return {
        "periodo": er.etiqueta,
        "gastos_usd": _r(er.gastos),
        "costo_mercancia_usd": _r(er.costos),
        "ingresos_usd": _r(er.ingresos),
        "ganancia_neta_usd": _r(er.utilidad_neta),
        "por_cuenta": [{"cuenta": f.nombre, "usd": _r(f.saldo)} for f in er.detalle_gastos],
        "ojo": "El total de gastos es este; no lo armes sumando pagos sueltos.",
    }


def saldos(db: Session) -> dict:
    """Lo que dicen los libros hoy de cada gaveta y cuenta, y la tasa."""
    from .. import tasas

    t = tasas.tasa_vigente(db)
    return {
        "gaveta_bolivares_usd": _r(contabilidad.saldo_de_cuenta(db, "1010")),
        "gaveta_dolares_usd": _r(contabilidad.saldo_de_cuenta(db, "1011")),
        "banco_usd": _r(contabilidad.saldo_de_cuenta(db, "1020")),
        "zelle_usd": _r(contabilidad.saldo_de_cuenta(db, "1021")),
        "tasa_bcv": t.bcv if t else None,
        "tasa_euro": t.eur if t else None,
        "tasa_del_dia": t.fecha.isoformat() if t else None,
        "ojo": "Son saldos de los libros. Si hay diferencias de caja por aprobar, la gaveta real difiere en ese monto.",
    }


def cuentas(db: Session) -> dict:
    """Quien me debe (cuentas por cobrar) y a quien le debo (proveedores)."""
    from .. import cuentas_por_cobrar

    cxc = cuentas_por_cobrar.resumen(db)
    deudas = (
        db.query(models.FacturaCompra)
        .filter(models.FacturaCompra.forma_pago == "Credito", models.FacturaCompra.pagada.is_(False))
        .all()
    )
    por_proveedor: dict = {}
    for f in deudas:
        por_proveedor[f.proveedor_nombre] = por_proveedor.get(f.proveedor_nombre, 0) + (f.saldo or 0)
    return {
        "me_deben_usd": _r(cxc.total),
        "vencido_usd": _r(cxc.vencido),
        "clientes": [{"cliente": c.nombre, "debe_usd": _r(c.saldo), "dias_de_la_mas_vieja": c.mas_vieja_dias}
                     for c in sorted(cxc.clientes, key=lambda c: -c.saldo)[:10]],
        "sin_ficha": [{"cliente": v.cliente, "debe_usd": _r(v.saldo)} for v in cxc.sin_ficha[:10]],
        "le_debo_a_proveedores_usd": _r(sum(por_proveedor.values())),
        "proveedores": [{"proveedor": k, "debo_usd": _r(v)} for k, v in sorted(por_proveedor.items(), key=lambda x: -x[1])[:10]],
    }


def iva(db: Session, anio: Optional[int] = None, mes: Optional[int] = None) -> dict:
    """El IVA de un mes desde los mismos libros que se imprimen, y si ya se declaro."""
    from ..routers.impuestos import _totales_iva_del_rango

    h = hoy()
    anio, mes = anio or h.year, mes or h.month
    inicio = datetime.datetime(anio, mes, 1)
    fin = datetime.datetime(anio + (mes == 12), mes % 12 + 1, 1)
    t = _totales_iva_del_rango(db, inicio, min(fin, ahora()))
    dec = db.query(models.DeclaracionIva).filter_by(anio=anio, mes=mes).first()
    sin_facturar = (
        db.query(models.Pedido)
        .filter(models.Pedido.estado == "pagado", models.Pedido.facturado.is_(False),
                models.Pedido.devuelto.is_(False), models.Pedido.cerrado_en >= inicio, models.Pedido.cerrado_en < fin)
        .count()
    )
    return {
        "mes": f"{mes:02d}/{anio}",
        "iva_ventas_debito_usd": _r(t["debito"]),
        "iva_compras_credito_usd": _r(t["credito"]),
        "iva_ventas_debito_bs": _r(t["debito_bs"]),
        "iva_compras_credito_bs": _r(t["credito_bs"]),
        "ventas_sin_marcar_facturadas": sin_facturar,
        "declarado": bool(dec),
        "a_pagar_usd": _r(dec.iva_a_pagar) if dec else None,
    }


def cierres(db: Session, desde: Optional[str] = None, hasta: Optional[str] = None) -> dict:
    """Los cierres de caja del periodo: cuadro o no, anulados (por quien y por
    que) y las diferencias que esperan aprobacion."""
    from ..routers.caja import diferencias_por_aprobar

    rango = _rango(desde, hasta)
    inicio, fin, etiqueta = rango.resolver()
    filas = (
        db.query(models.CierreCaja)
        .filter(models.CierreCaja.fecha >= inicio, models.CierreCaja.fecha < fin)
        .order_by(models.CierreCaja.fecha)
        .all()
    )
    pend = diferencias_por_aprobar(db)

    def dif(c):
        return _r(sum(l.diferencia or 0 for l in c.lineas)) if c.lineas else _r((c.diferencia or 0) + (c.divisas_diferencia or 0))

    return {
        "periodo": etiqueta,
        "cierres": [
            {"dia": c.fecha.date().isoformat(), "diferencia_usd": dif(c), "anulado": bool(c.anulado),
             "motivo_anulacion": c.motivo_anulacion or "", "autorizo": c.autorizado_por or "",
             "cerro": c.cerrado_por or c.operador, "estado": c.estado_diferencia or "asentada"}
            for c in filas
        ],
        "anulados": sum(1 for c in filas if c.anulado),
        "por_aprobar_usd": pend.total,
        "por_aprobar": len(pend.filas),
    }


def producto(db: Session, nombre: str) -> dict:
    """Un producto del menu por su nombre: precio, costo de su receta y margen."""
    clave = texto.comparable(nombre)
    costos: dict = {}
    for r in db.query(models.RecetaItem).all():
        if r.ingrediente is not None:
            costos[r.variante_id] = costos.get(r.variante_id, 0) + r.cantidad_por_unidad * (r.ingrediente.costo_efectivo or 0)
    filas = []
    for v in db.query(models.Variante).filter(models.Variante.activo.is_(True)).all():
        completo = f"{v.producto.nombre if v.producto else ''} {v.nombre or ''}".strip()
        if clave not in texto.comparable(completo):
            continue
        costo = costos.get(v.id)
        filas.append({
            "producto": completo,
            "precio_usd": _r(v.precio),
            "costo_receta_usd": _r(costo) if costo else None,
            "margen_pct": round((v.precio - costo) / v.precio * 100, 1) if costo and v.precio else None,
            "tiene_receta": bool(costo),
        })
        if len(filas) == 8:
            break
    return {"productos": filas} if filas else {"error": f"No hay producto del menú que se llame como «{nombre}»."}


HERRAMIENTAS: dict = {
    "ventas": Herramienta(
        {
            "name": "ventas",
            "description": "Ventas, pedidos, ticket, costo, ganancia y margen de un período, comparado con el período anterior del mismo largo; productos más vendidos con su margen; formas de pago; por categoría y por día de la semana.",
            "parameters": {"type": "object", "properties": _FECHAS},
        },
        ventas,
        modulos=("reportes",),
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
    "movimientos_de_caja": Herramienta(
        {
            "name": "movimientos_de_caja",
            "description": "Cada movimiento de una gaveta o cuenta en un día, con hora y descripción (compras, pagos, retiros, cobros). Úsala cuando pregunten de dónde sale un monto del cierre o por qué sobra o falta.",
            "parameters": {
                "type": "object",
                "properties": {
                    "forma_de_pago": {"type": "string", "enum": ["Efectivo Bs", "Efectivo $", "Banco", "Zelle"], "description": "La gaveta o cuenta."},
                    "fecha": {"type": "string", "description": "AAAA-MM-DD. Sin esto, hoy."},
                },
                "required": ["forma_de_pago"],
            },
        },
        movimientos_de_caja,
        modulos=("caja",),
        plata=True,
    ),
    "compras_de_mercancia": Herramienta(
        {
            "name": "compras_de_mercancia",
            "description": "De una mercancía: cuánto hay, el costo de su ficha, el costo que usa el menú y sus últimas compras. Úsala cuando un costo salga raro o en cero.",
            "parameters": {
                "type": "object",
                "properties": {"nombre": {"type": "string", "description": "Nombre o parte del nombre."}},
                "required": ["nombre"],
            },
        },
        compras_de_mercancia,
        modulos=("inventario", "compras"),
        plata=True,
    ),
    "gastos": Herramienta(
        {
            "name": "gastos",
            "description": "Los gastos de un período cuenta por cuenta (sueldos, alquiler, faltantes de caja...), con ingresos y ganancia neta: el Estado de resultados. Úsala para cualquier pregunta de gastos; nunca sumes pagos sueltos.",
            "parameters": {"type": "object", "properties": _FECHAS},
        },
        gastos,
        modulos=("contabilidad", "reportes"),
        plata=True,
    ),
    "saldos": Herramienta(
        {
            "name": "saldos",
            "description": "Cuánto hay hoy según los libros en la gaveta de bolívares, la de dólares, el banco y Zelle, y la tasa BCV y euro del día.",
            "parameters": {"type": "object", "properties": {}},
        },
        saldos,
        modulos=("contabilidad", "caja", "reportes"),
        plata=True,
    ),
    "cuentas": Herramienta(
        {
            "name": "cuentas",
            "description": "Quién me debe y cuánto (cuentas por cobrar, por cliente) y a qué proveedores les debo facturas a crédito.",
            "parameters": {"type": "object", "properties": {}},
        },
        cuentas,
        modulos=("cobranzas", "compras", "reportes"),
        plata=True,
    ),
    "iva": Herramienta(
        {
            "name": "iva",
            "description": "El IVA de un mes (débito de ventas, crédito de compras, en $ y Bs), cuántas ventas faltan por marcar facturadas y si ya se declaró.",
            "parameters": {"type": "object", "properties": {
                "anio": {"type": "integer"}, "mes": {"type": "integer", "description": "1 a 12. Sin esto, el mes en curso."}}},
        },
        iva,
        modulos=("impuestos", "contabilidad"),
        plata=True,
    ),
    "cierres": Herramienta(
        {
            "name": "cierres",
            "description": "Los cierres de caja de un período: si cuadraron, cuáles se anularon (quién autorizó y por qué) y las diferencias por aprobar.",
            "parameters": {"type": "object", "properties": _FECHAS},
        },
        cierres,
        modulos=("caja",),
        plata=True,
    ),
    "producto": Herramienta(
        {
            "name": "producto",
            "description": "Un producto del menú por su nombre (o parte): precio, costo de su receta y margen.",
            "parameters": {"type": "object", "properties": {"nombre": {"type": "string"}}, "required": ["nombre"]},
        },
        producto,
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
    """Las herramientas que este rol puede usar (las demás no se le ofrecen).

    Las ventas son como en Reportes: quien entra a Reportes las ve, pero sin
    ganancia, margen ni costo si no administra (QA nov, hallazgo 27: Dona le
    negaba a la cajera lo que la pantalla si le mostraba)."""
    salida = {}
    for nombre, h in HERRAMIENTAS.items():
        if h.modulos and not any(permisos.puede_modulo(rol, m) for m in h.modulos):
            continue
        if h.plata and not permisos.ve_kpis(rol):
            continue
        if nombre == "ventas" and not permisos.administra(rol):
            h = Herramienta(h.declaracion, _sin_ganancia(h.ejecutar), h.modulos, h.plata)
        salida[nombre] = h
    return salida


def _sin_ganancia(f):
    def envuelta(db, **kw):
        return reportes._sin_lo_sensible(f(db, **kw))
    return envuelta
