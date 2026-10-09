import datetime
from typing import Dict, List, Optional, Set

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from .. import combos, consolidacion, contabilidad, kardex, models, reposicion, schemas, seed
from ..consolidacion import Bloque, pedidos_pagados as _pedidos_pagados
from ..database import get_db
from ..rango import Rango, anterior, granularidad, serie as serie_del_rango
from ..timeutils import ahora, hoy, inicio_del_dia
from .inventario import sugerencias_compra

router = APIRouter(prefix="/api/reportes", tags=["reportes"])


# ── Los filtros de Reportes ──────────────────────────────────────────────────
#
# Leider (30-sep): "que la gente pueda filtrar por la categoria de su producto
# y hasta por su producto". Resumen y Ventas se filtran por el MENU (categoria,
# producto); Perdidas e Inventario por el DEPOSITO (cajon, mercancia), que es
# de lo que hablan. Los dos viajan como parametros de consulta y el reporte
# devuelve el eco (`filtro`) con los nombres, para el rotulo de la pantalla.


def _variantes_del_filtro(
    db: Session, categoria_id: Optional[int], producto_id: Optional[int]
) -> Optional[Set[int]]:
    """Las variantes que abarca el filtro del menu. None = sin filtro.

    Entran tambien las retiradas: lo que se vendio en agosto de un producto
    que se saco del menu en septiembre sigue siendo venta de ese producto.
    """
    if categoria_id is None and producto_id is None:
        return None
    q = db.query(models.Variante.id).join(models.Producto, models.Producto.id == models.Variante.producto_id)
    if producto_id is not None:
        q = q.filter(models.Producto.id == producto_id)
    if categoria_id is not None:
        q = q.filter(models.Producto.categoria_id == categoria_id)
    return {v for (v,) in q.all()}


def _filtro_menu(db: Session, categoria_id: Optional[int], producto_id: Optional[int]) -> Optional[schemas.FiltroMenu]:
    if categoria_id is None and producto_id is None:
        return None
    cat = db.get(models.Categoria, categoria_id) if categoria_id is not None else None
    prod = db.get(models.Producto, producto_id) if producto_id is not None else None
    return schemas.FiltroMenu(
        categoria_id=categoria_id,
        categoria=cat.nombre if cat else "",
        producto_id=producto_id,
        producto=prod.nombre if prod else "",
    )


def _insumos_del_filtro(
    db: Session, categoria_id: Optional[int], ingrediente_id: Optional[int]
) -> Optional[Set[int]]:
    """Las mercancias que abarca el filtro del deposito. None = sin filtro."""
    if categoria_id is None and ingrediente_id is None:
        return None
    q = db.query(models.Ingrediente.id)
    if ingrediente_id is not None:
        q = q.filter(models.Ingrediente.id == ingrediente_id)
    if categoria_id is not None:
        q = q.filter(models.Ingrediente.categoria_id == categoria_id)
    return {i for (i,) in q.all()}


def _filtro_deposito(
    db: Session, categoria_id: Optional[int], ingrediente_id: Optional[int]
) -> Optional[schemas.FiltroDeposito]:
    if categoria_id is None and ingrediente_id is None:
        return None
    cat = db.get(models.CategoriaInsumo, categoria_id) if categoria_id is not None else None
    ing = db.get(models.Ingrediente, ingrediente_id) if ingrediente_id is not None else None
    return schemas.FiltroDeposito(
        categoria_id=categoria_id,
        categoria=cat.nombre if cat else "",
        ingrediente_id=ingrediente_id,
        ingrediente=ing.nombre if ing else "",
    )


def _avisos_de_costos(db: Session) -> List[schemas.Insight]:
    """Avisos que salen de lo que PAGAS, no de lo que vendiste.

    El costo promedio ponderado tarda semanas en reflejar una subida, asi que
    el margen en pantalla se ve bien mientras el negocio ya esta vendiendo por
    debajo de lo que le cuesta reponer. Esto mira el ultimo precio pagado, que
    si se entera el mismo dia.
    """
    avisos: List[schemas.Insight] = []

    inflacion = reposicion.inflacion_de_insumos(db, dias=30)
    if inflacion and inflacion["cambio_pct"] >= reposicion.SALTO_QUE_IMPORTA_PCT:
        detalle = "; ".join(
            f"{i['nombre']} +{i['cambio_pct']:.0f}%" for i in inflacion["insumos"][:3]
        )
        avisos.append(
            schemas.Insight(
                tipo="alerta",
                titulo=f"Tu mercancía subió {inflacion['cambio_pct']:.0f}% en 30 dias",
                detalle=(
                    f"{detalle}. Si tus precios no subieron parecido, estas vendiendo "
                    "mas barato de lo que te va a costar reponer. Revisa los precios "
                    "en el Menu."
                ),
            )
        )

    # El acantilado: productos cuyo margen aguanta con el inventario viejo pero
    # no con lo que cuesta reponer. Cuando ese stock se acabe, el margen cae de
    # golpe - y hasta ahora no se veia venir.
    apretados = [
        f
        for f in _margenes_de_reposicion(db)
        if f["margen_pct"] is not None
        and f["margen_reposicion_pct"] is not None
        and f["margen_pct"] >= reposicion.MARGEN_FLACO_PCT
        and f["margen_reposicion_pct"] < reposicion.MARGEN_FLACO_PCT
    ]
    if apretados:
        detalle = "; ".join(
            f"{f['nombre']} pasa de {f['margen_pct']:.0f}% a {f['margen_reposicion_pct']:.0f}%"
            for f in apretados[:3]
        )
        avisos.append(
            schemas.Insight(
                tipo="alerta",
                titulo=f"{len(apretados)} producto(s) dejan de ser rentables al reponer",
                detalle=(
                    f"{detalle}. El margen que ves sale del inventario que compraste "
                    "barato; cuando se acabe, ese es el margen que te queda."
                ),
            )
        )

    return avisos


def _margenes_de_reposicion(db: Session) -> List[dict]:
    """Margen contable vs margen a precios de hoy, por producto activo."""
    ultimos = reposicion.costos_reposicion(db)
    promedio: Dict[int, float] = {}
    hoy_cuesta: Dict[int, float] = {}

    for receta in db.query(models.RecetaItem).all():
        ingrediente = receta.ingrediente
        if ingrediente is None:
            continue
        promedio[receta.variante_id] = promedio.get(receta.variante_id, 0) + (
            receta.cantidad_por_unidad * (ingrediente.costo_efectivo or 0)
        )
        ultimo = ultimos.get(receta.ingrediente_id)
        efectivo = (
            reposicion.costo_efectivo_de(ultimo["costo"], ingrediente.rendimiento_pct)
            if ultimo
            else (ingrediente.costo_efectivo or 0)
        )
        hoy_cuesta[receta.variante_id] = hoy_cuesta.get(receta.variante_id, 0) + (
            receta.cantidad_por_unidad * efectivo
        )

    filas = []
    for variante in db.query(models.Variante).filter(models.Variante.activo.is_(True)).all():
        costo = promedio.get(variante.id)
        costo_hoy = hoy_cuesta.get(variante.id)
        if costo is None or not variante.precio:
            continue
        nombre = variante.producto.nombre if variante.producto else ""
        if variante.nombre and variante.nombre.lower() != "regular":
            nombre = f"{nombre} - {variante.nombre}".strip(" -")
        filas.append(
            {
                "nombre": nombre,
                "margen_pct": round((variante.precio - costo) / variante.precio * 100, 1),
                "margen_reposicion_pct": (
                    round((variante.precio - costo_hoy) / variante.precio * 100, 1)
                    if costo_hoy is not None
                    else None
                ),
            }
        )
    return filas

def _mediana(valores: List[float]) -> float:
    """El ticket del cliente del medio.

    El promedio lo mueve un solo pedido grande: 40 ventas de $2 mas un catering
    de $200 daban un "ticket promedio" de $6.83, que no es lo que gasta nadie.
    La mediana sigue diciendo $2.00, que es la verdad del mostrador.
    """
    if not valores:
        return 0.0
    ordenados = sorted(valores)
    mitad = len(ordenados) // 2
    if len(ordenados) % 2:
        return round(ordenados[mitad], 2)
    return round((ordenados[mitad - 1] + ordenados[mitad]) / 2, 2)


DIAS_ES = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"]
# Para la prosa: "tu dia fuerte es el sabado", no "el sab".
DIAS_LARGOS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"]


def merma_periodo(db: Session, inicio: datetime.datetime, fin: datetime.datetime) -> float:
    """Valor de lo que se boto en el periodo, segun la cuenta 6020. Pasa por
    `sumas_de_cuenta`, que ya lee los dias cerrados del mart."""
    cuenta = (
        db.query(models.CuentaContable).filter(models.CuentaContable.codigo == "6020").first()
    )
    if not cuenta:
        return 0.0
    debe, haber = contabilidad.sumas_de_cuenta(db, cuenta.id, inicio, fin)
    return round(debe - haber, 2)


def _puntos_del_bloque(b: Bloque, paso: str):
    """Los puntos con que `rango.serie` arma la serie: por horas cuando el
    rango es un dia (el detalle por hora del bloque), por dias en lo demas.
    Cada punto vale por los pedidos que agrupa."""
    if paso == "hora":
        # Un rango de un dia: la fecha de cada punto es la de ese dia. Si el
        # bloque cubre varios dias por horas no tiene sentido y no se pide.
        dia = consolidacion.fecha_de_clave(next(iter(b.por_dia))) if b.por_dia else None
        if dia is None:
            return []
        return [
            (datetime.datetime.combine(dia, datetime.time(int(h), 0)), g.ventas, g.pedidos, g.unidades)
            for h, g in b.por_hora.items()
        ]
    return [
        (
            inicio_del_dia(consolidacion.fecha_de_clave(clave)) + datetime.timedelta(hours=12),
            g.ventas,
            g.pedidos,
            g.unidades,
        )
        for clave, g in b.por_dia.items()
    ]


# Los granos que la pantalla puede pedir. "hora" solo tiene sentido dentro de
# un dia, pero no se prohibe: pedir horas de un mes dibuja 720 puntos, feo pero
# no roto, y decidir por el dueño que no puede mirarlo seria peor.
PASOS_VALIDOS = ("hora", "dia", "semana", "mes")


def _serie(periodo: str, b: Bloque, inicio: datetime.datetime, fin: datetime.datetime, paso: str):
    """Ventas a lo largo del rango, con el paso que se pida.

    La semana se sigue leyendo por dia de la semana ("Lun", "Mar"), que es como
    la piensa quien atiende; lo demas lleva la fecha.
    """
    puntos = serie_del_rango(_puntos_del_bloque(b, paso), inicio, fin, paso=paso)
    if periodo == "semana" and paso == "dia":
        dia = inicio
        for punto in puntos:
            punto["etiqueta"] = DIAS_ES[dia.weekday()]
            dia += datetime.timedelta(days=1)
    return [schemas.PuntoSerie(**p) for p in puntos]


def _producto_de_variantes(db: Session, claves) -> Dict[str, tuple]:
    """"v:<id>" -> (producto_id, categoria). La venta libre no tiene."""
    ids = [int(c[2:]) for c in claves if c.startswith("v:")]
    if not ids:
        return {}
    filas = (
        db.query(models.Variante.id, models.Producto.id, models.Categoria.nombre)
        .join(models.Producto, models.Producto.id == models.Variante.producto_id)
        .join(models.Categoria, models.Categoria.id == models.Producto.categoria_id)
        .filter(models.Variante.id.in_(ids))
        .all()
    )
    return {f"v:{v}": (p, c) for v, p, c in filas}


def _top_productos(db: Session, b: Bloque) -> List[schemas.ProductoVendido]:
    """Agrupa por variante, NO por el nombre congelado del item.

    Agrupar por nombre rompia en las dos direcciones: dos productos distintos
    con el mismo nombre (uno en Desayuno a $10 y otro en Merienda a $4) se
    fundian en una linea cuyo margen -96.3% en la prueba- no era el de ninguno
    de los dos; y renombrar un producto a mitad de mes partia su historico en
    dos lineas. El nombre congelado sigue siendo el que se muestra (el ticket
    de ayer decia eso), pero ya no es la clave.
    """
    # El bloque ya agrupo por variante (o por nombre en la venta libre) y ya
    # decidio si a cada uno le falto costo; ver `consolidacion.bloque_en_vivo`.
    de_que = _producto_de_variantes(db, b.productos.keys())
    productos = []
    for clave, g in b.productos.items():
        ingresos = round(g.ventas, 2)
        costo = round(g.costo, 2)
        ganancia = round(ingresos - costo, 2)
        producto_id, categoria = de_que.get(clave, (None, ""))
        productos.append(
            schemas.ProductoVendido(
                nombre=g.nombre,
                unidades=int(g.unidades),
                ingresos=ingresos,
                costo=costo,
                ganancia=ganancia,
                # Un margen calculado sobre costo cero no significa nada, asi
                # que no se reporta como si fuera un dato bueno.
                margen_pct=0.0 if g.sin_receta else (round(ganancia / ingresos * 100, 1) if ingresos else 0.0),
                sin_receta=bool(g.sin_receta),
                producto_id=producto_id,
                categoria=categoria,
            )
        )
    productos.sort(key=lambda x: x.ingresos, reverse=True)
    return productos


NOMBRE_ANTERIOR = {"dia": "ayer", "semana": "la semana pasada", "mes": "el mes pasado"}


def _nombre_del_anterior(periodo: str, inicio, fin) -> str:
    """Como se llama el periodo de al lado, en palabras.

    La pantalla manda siempre `desde`/`hasta` (el filtro de fechas), asi que
    `periodo` casi nunca dice "dia" o "semana": se deduce del rango. Un dia
    que es hoy se compara con "ayer"; una semana que empieza en lunes, con
    "la semana pasada"; un mes entero, con "el mes pasado". Lo demas es "el
    periodo anterior", que es exacto aunque no suene a nada.
    """
    if periodo in NOMBRE_ANTERIOR:
        return NOMBRE_ANTERIOR[periodo]
    dias = (fin - inicio).days
    if dias == 1:
        return "ayer" if inicio.date() == hoy() else "el dia anterior"
    if dias == 7 and inicio.weekday() == 0:
        return "la semana pasada"
    if inicio.day == 1 and fin.day == 1 and dias >= 28:
        return "el mes pasado"
    return "el periodo anterior"


def _pct(nuevo: float, viejo: float):
    if not viejo:
        return None
    return round((nuevo / viejo - 1) * 100, 1)


def _comparativa(
    etiqueta: str, previo: Bloque, libro_previo: dict, ventas: float, cuantos: int, ganancia_neta: float,
) -> schemas.Comparativa:
    """El periodo anterior puesto al lado, con el cambio en porcentaje.

    Se calcula igual que el actual --mismos pedidos pagados, misma
    contabilidad-- para que "vas 12% arriba" compare lo mismo con lo mismo.
    """
    n_prev = previo.pedidos
    ventas_previas = previo.ventas
    ticket_prev = round(ventas_previas / n_prev, 2) if n_prev else 0.0
    ticket = round(ventas / cuantos, 2) if cuantos else 0.0
    ganancia_prev = round(libro_previo["ingreso"] - libro_previo["costo"] - libro_previo["gasto"], 2)
    return schemas.Comparativa(
        etiqueta=etiqueta,
        ventas=round(ventas_previas, 2),
        pedidos=n_prev,
        ticket_promedio=ticket_prev,
        ganancia_neta=ganancia_prev,
        cambio_ventas_pct=_pct(ventas, ventas_previas),
        cambio_pedidos_pct=_pct(cuantos, n_prev),
        cambio_ticket_pct=_pct(ticket, ticket_prev),
        # La ganancia puede ser negativa: un porcentaje sobre un numero
        # negativo no significa nada, asi que solo se da si ambas son positivas.
        cambio_ganancia_pct=_pct(ganancia_neta, ganancia_prev) if ganancia_prev > 0 and ganancia_neta > 0 else None,
    )


def _serie_anterior(
    serie_actual: List[schemas.PuntoSerie], previo: Bloque, inicio, fin, paso: str
) -> List[schemas.PuntoSerie]:
    """La serie del periodo anterior, tramo a tramo contra la actual.

    Lleva las etiquetas de la actual a proposito: se dibuja encima de ella,
    punteada, y lo que se compara es "el mismo tramo" (la misma hora, el
    mismo dia de la semana), no la fecha.
    """
    if not serie_actual:
        return []
    ini_prev, fin_prev = anterior(inicio, fin)
    puntos = serie_del_rango(_puntos_del_bloque(previo, paso), ini_prev, fin_prev, paso=paso)
    if paso == "hora":
        # Por horas la serie viene recortada de la primera a la ultima venta
        # de cada dia, y esos recortes no coinciden: se alinea por la hora.
        por_hora = {pt["etiqueta"]: pt for pt in puntos}
        return [
            schemas.PuntoSerie(
                etiqueta=s.etiqueta,
                ventas=por_hora.get(s.etiqueta, {}).get("ventas", 0.0),
                pedidos=por_hora.get(s.etiqueta, {}).get("pedidos", 0),
                unidades=por_hora.get(s.etiqueta, {}).get("unidades", 0),
            )
            for s in serie_actual
        ]
    salida = [
        schemas.PuntoSerie(etiqueta=s.etiqueta, ventas=pt["ventas"], pedidos=pt["pedidos"], unidades=pt["unidades"])
        for s, pt in zip(serie_actual, puntos)
    ]
    # Meses de distinto largo pueden dar un tramo mas o menos: se rellena.
    for s in serie_actual[len(salida):]:
        salida.append(schemas.PuntoSerie(etiqueta=s.etiqueta, ventas=0.0, pedidos=0))
    return salida


def _mapa_de_calor(b: Bloque) -> List[schemas.PuntoCalor]:
    """Cuando ENTRAN los clientes: por la hora en que se tomo el pedido, no
    en la que se cobro (ver `consolidacion.bloque_en_vivo`)."""
    celdas = []
    for clave, g in b.calor.items():
        d, h = clave.split("-")
        celdas.append(schemas.PuntoCalor(dia=int(d), hora=int(h), pedidos=g.pedidos, ventas=round(g.ventas, 2)))
    celdas.sort(key=lambda c: (c.dia, c.hora))
    return celdas


def _por_categoria(db: Session, b: Bloque, ventas_total: float) -> List[schemas.GrupoReporte]:
    """Que parte de la venta es comida, que parte bebida, que parte envios.
    La venta libre va en su propio grupo. Con el id de la categoria cuando
    es una del menu, para poder filtrar tocandola."""
    ids = {c.nombre: c.id for c in db.query(models.Categoria.nombre, models.Categoria.id).all()}
    salida = [
        schemas.GrupoReporte(
            nombre=nombre,
            ventas=round(g.ventas, 2),
            pedidos=g.pedidos,
            pct=round(g.ventas / ventas_total * 100, 1) if ventas_total else 0.0,
            id=ids.get(nombre),
        )
        for nombre, g in b.por_categoria.items()
    ]
    salida.sort(key=lambda g: g.ventas, reverse=True)
    return salida


def _por_dia_semana(b: Bloque, inicio, fin, ventas_total: float) -> List[schemas.GrupoReporte]:
    """Lo que vende cada dia de la semana, y lo que vende uno TIPICO.

    El promedio divide entre las veces que ese dia cayo dentro del rango --y
    ya paso--, asi el sabado de un mes con cinco sabados no le gana al de uno
    con cuatro solo por eso.
    """
    veces = [0] * 7
    d = inicio.date()
    tope = min(fin.date(), hoy() + datetime.timedelta(days=1))
    while d < tope:
        veces[d.weekday()] += 1
        d += datetime.timedelta(days=1)

    total = [0.0] * 7
    cuantos = [0] * 7
    for clave, g in b.por_dia.items():
        w = consolidacion.fecha_de_clave(clave).weekday()
        total[w] += g.ventas
        cuantos[w] += g.pedidos

    return [
        schemas.GrupoReporte(
            nombre=DIAS_ES[i],
            ventas=round(total[i], 2),
            pedidos=cuantos[i],
            pct=round(total[i] / ventas_total * 100, 1) if ventas_total else 0.0,
            promedio=round(total[i] / veces[i], 2) if veces[i] else None,
        )
        for i in range(7)
    ]


def _lecturas_de_ritmo(
    calor: List[schemas.PuntoCalor], por_dia: List[schemas.GrupoReporte], total_pedidos: int
) -> List[schemas.Insight]:
    """Lo que dicen el mapa de calor y el dia de la semana, en una frase."""
    out: List[schemas.Insight] = []
    if not calor or total_pedidos < 20:
        return out

    # Las dos horas que concentran mas clientes, sumando todos los dias.
    por_hora: Dict[int, int] = {}
    for c in calor:
        por_hora[c.hora] = por_hora.get(c.hora, 0) + c.pedidos
    pico = sorted(por_hora.items(), key=lambda kv: kv[1], reverse=True)[:2]
    en_pico = sum(n for _h, n in pico)
    if pico and en_pico / total_pedidos >= 0.3:
        horas = " y ".join(f"{h:02d}:00" for h, _n in sorted(pico))
        out.append(
            schemas.Insight(
                tipo="info",
                titulo=f"Tu hora pico: {horas}",
                detalle=(
                    f"El {en_pico / total_pedidos * 100:.0f}% de los pedidos entra en esas dos "
                    "horas. Ahi es donde hace falta la gente y la comida lista; el resto del "
                    "dia se puede atender con menos."
                ),
            )
        )

    # El dia fuerte y el flojo, por lo que vende un dia tipico.
    con_promedio = [d for d in por_dia if d.promedio is not None and d.pedidos > 0]
    if len(con_promedio) >= 4:
        media = sum(d.promedio for d in con_promedio) / len(con_promedio)
        fuerte = max(con_promedio, key=lambda d: d.promedio)
        flojo = min(con_promedio, key=lambda d: d.promedio)
        if media > 0 and fuerte.promedio >= media * 1.25:
            largo = dict(zip(DIAS_ES, DIAS_LARGOS))
            out.append(
                schemas.Insight(
                    tipo="info",
                    titulo=f"Tu dia fuerte es el {largo.get(fuerte.nombre, fuerte.nombre)}",
                    detalle=(
                        f"Vende ${fuerte.promedio:.2f} en promedio, un {fuerte.promedio / media * 100 - 100:.0f}% "
                        f"mas que un dia normal. El mas flojo es el {largo.get(flojo.nombre, flojo.nombre)} "
                        f"(${flojo.promedio:.2f}). Compra y arma turnos con eso en mente."
                    ),
                )
            )
    return out


def _insights(
    db: Session,
    periodo: str,
    ventas: float,
    costo: float,
    gastos: float,
    b: Bloque,
    productos: List[schemas.ProductoVendido],
    serie: List[schemas.PuntoSerie],
    granularidad_serie: str,
    ventas_previas: float,
    merma: float = 0,
    incompleto: bool = True,
    solo_ventas: bool = False,
) -> List[schemas.Insight]:
    """Analisis deterministico: sin llamadas a ningun modelo, sin costo variable.

    `solo_ventas`: se esta mirando una categoria o un producto, no el negocio.
    Lo que es del negocio entero --los gastos, lo que sube de precio, el
    deposito, la merma-- no se opina: no es de ese producto.
    """
    insights: List[schemas.Insight] = []
    nombre_periodo = {"dia": "hoy", "semana": "esta semana", "mes": "este mes"}.get(
        periodo, "en este periodo"
    )

    if not b.pedidos:
        insights.append(
            schemas.Insight(
                tipo="info",
                titulo="Sin ventas registradas",
                detalle=f"No hay pedidos cobrados {nombre_periodo}. Cobra un pedido para empezar a ver numeros.",
            )
        )
        # Que tus insumos suban importa igual, hayas vendido hoy o no: es
        # justamente el dia flojo cuando te alcanza el tiempo para revisar
        # precios. Estos avisos no dependen de las ventas del periodo.
        return insights + ([] if solo_ventas else _avisos_de_costos(db))

    # Comparativa contra el periodo anterior. El periodo en curso siempre esta
    # incompleto, asi que se avisa para no leer una caida donde solo falta tiempo.
    if ventas_previas > 0:
        cambio = (ventas - ventas_previas) / ventas_previas * 100
        anterior = {"dia": "ayer", "semana": "la semana pasada", "mes": "el mes pasado"}.get(
            periodo, "el periodo anterior"
        )
        aclaracion = f" Ojo: {nombre_periodo} todavia no termina." if incompleto else ""
        base = f"Vendiste ${ventas:.2f} contra ${ventas_previas:.2f} de {anterior}."
        if cambio >= 10:
            insights.append(
                schemas.Insight(
                    tipo="bueno",
                    titulo=f"Vas {cambio:.0f}% arriba",
                    detalle=base,
                )
            )
        elif cambio <= -10:
            insights.append(
                schemas.Insight(
                    tipo="alerta",
                    titulo=f"Vas {abs(cambio):.0f}% abajo",
                    detalle=base + aclaracion,
                )
            )

    # Productos sin receta: su costo entra como cero, asi que hunden el food
    # cost y lo pueden hacer pasar de alerta a felicitacion. Se avisa ANTES de
    # opinar sobre el margen, y el food cost se calcula solo sobre lo que si
    # tiene costo conocido.
    sin_receta = [p for p in productos if p.sin_receta]
    ventas_medibles = round(ventas - sum(p.ingresos for p in sin_receta), 2)
    if sin_receta:
        nombres = ", ".join(p.nombre for p in sin_receta[:3])
        insights.append(
            schemas.Insight(
                tipo="alerta",
                titulo=f"{len(sin_receta)} producto(s) sin receta: su ganancia no es real",
                detalle=(
                    f"{nombres}. Vendiste ${sum(p.ingresos for p in sin_receta):.2f} sin saber "
                    "cuanto costo producirlo, asi que aparece como ganancia pura. Cargale la "
                    "receta en Recetas para ver el margen de verdad."
                ),
            )
        )

    # Food cost: en comida rapida sobre 35% del precio de venta aprieta el margen.
    if costo > 0 and ventas_medibles > 0:
        food_cost = costo / ventas_medibles * 100
        sobre = " (sobre los productos con receta cargada)" if sin_receta else ""
        if food_cost > 35:
            insights.append(
                schemas.Insight(
                    tipo="alerta",
                    titulo=f"La mercancía se lleva {food_cost:.0f}% de la venta",
                    detalle=f"Arriba de 35% el margen se aprieta{sobre}. Revisa precios de venta o el costo de tu mercancía.",
                )
            )
        else:
            insights.append(
                schemas.Insight(
                    tipo="bueno",
                    titulo=f"Costo de la mercancía en {food_cost:.0f}%",
                    detalle=f"Esta en rango sano para comida rapida{sobre} (referencia: menos de 35%).",
                )
            )
    elif costo == 0:
        insights.append(
            schemas.Insight(
                tipo="info",
                titulo="Falta cargar el costo de tus insumos",
                detalle="Sin costos no se puede calcular ganancia. Cargalos en Inventario para ver cuanto te deja cada producto.",
            )
        )

    # Producto estrella y producto flojo en margen.
    if productos:
        estrella = max(productos, key=lambda p: p.unidades)
        insights.append(
            schemas.Insight(
                tipo="info",
                titulo=f"Lo mas vendido: {estrella.nombre}",
                detalle=f"{estrella.unidades} unidades, ${estrella.ingresos:.2f} en ventas.",
            )
        )
        # Solo se opina del margen de lo que tiene costo conocido; de los que
        # no lo tienen ya avisa el insight de arriba, que es mas util que un
        # margen inventado.
        con_costo = [p for p in productos if p.costo > 0 and not p.sin_receta]
        if con_costo:
            peor = min(con_costo, key=lambda p: p.margen_pct)
            if peor.margen_pct < 30:
                insights.append(
                    schemas.Insight(
                        tipo="alerta",
                        titulo=f"{peor.nombre} deja poco margen",
                        detalle=f"Solo {peor.margen_pct:.0f}% de ganancia. Evalua subir el precio o ajustar la receta.",
                    )
                )

    # Mejor momento de venta. Se decide por CLIENTES atendidos, no por monto:
    # este dato sirve para saber cuando reforzar personal, y una hora con un
    # solo pedido grande le ganaba a una hora con treinta clientes.
    if serie:
        mejor = max(serie, key=lambda s: (s.pedidos, s.ventas))
        if mejor.pedidos > 0:
            etiqueta = {"hora": "hora", "dia": "dia", "semana": "semana", "mes": "mes"}[
                granularidad_serie
            ]
            mas_plata = max(serie, key=lambda s: s.ventas)
            detalle = (
                f"{mejor.pedidos} pedido(s) por ${mejor.ventas:.2f}. "
                "Asegura tener personal e inventario en ese momento."
            )
            if mas_plata.etiqueta != mejor.etiqueta and mas_plata.ventas > mejor.ventas:
                detalle += (
                    f" (La {etiqueta} de mas facturacion fue otra: {mas_plata.etiqueta}, "
                    f"${mas_plata.ventas:.2f} en {mas_plata.pedidos} pedido(s).)"
                )
            insights.append(
                schemas.Insight(
                    tipo="info", titulo=f"Mejor {etiqueta}: {mejor.etiqueta}", detalle=detalle
                )
            )

    if solo_ventas:
        return insights

    # Peso de los gastos.
    if gastos > 0 and ventas > 0:
        peso = gastos / ventas * 100
        if peso > 30:
            insights.append(
                schemas.Insight(
                    tipo="alerta",
                    titulo=f"Los gastos se llevan {peso:.0f}% de la venta",
                    detalle=f"${gastos:.2f} en gastos contra ${ventas:.2f} vendidos.",
                )
            )

    # Precio por debajo del costo. Se mira el precio de HOY contra el costo de
    # HOY, no el margen del periodo: con inflacion el costo sube solo por el
    # promedio ponderado mientras el precio solo sube cuando el dueno lo toca,
    # y el margen promedio del mes esconde las ventas que ya van a perdida.
    a_perdida = []
    for variante in db.query(models.Variante).filter(models.Variante.activo.is_(True)).all():
        costo_actual = sum(
            r.cantidad_por_unidad * (r.ingrediente.costo_efectivo or 0)
            for r in db.query(models.RecetaItem).filter_by(variante_id=variante.id).all()
        )
        if costo_actual > 0 and variante.precio < costo_actual:
            nombre = variante.producto.nombre
            if variante.nombre and variante.nombre.lower() != "regular":
                nombre = f"{nombre} - {variante.nombre}"
            a_perdida.append((nombre, variante.precio, costo_actual))

    if a_perdida:
        detalle = "; ".join(
            f"{n} se vende a ${p:.2f} y cuesta ${c:.2f}" for n, p, c in a_perdida[:3]
        )
        insights.append(
            schemas.Insight(
                tipo="alerta",
                titulo=f"{len(a_perdida)} producto(s) se venden por debajo de su costo",
                detalle=f"{detalle}. Pierdes dinero en cada una que vendes: subi el precio o revisa la receta.",
            )
        )

    # Un pedido que pesa demasiado en el dia distorsiona todos los promedios.
    # Decirlo es mas util que corregir el numero en silencio.
    if b.pedidos > 3 and ventas > 0 and b.mayor:
        mayor_numero, mayor_total = b.mayor
        peso = mayor_total / ventas * 100
        if peso >= 30:
            mediana = _mediana(b.totales)
            insights.append(
                schemas.Insight(
                    tipo="info",
                    titulo=f"Un solo pedido fue el {peso:.0f}% de la venta",
                    detalle=(
                        f"El pedido #{mayor_numero} de ${mayor_total:.2f} mueve todos los "
                        f"promedios del dia. El cliente tipico gasto ${mediana:.2f} "
                        "(esa es la mediana, no el promedio)."
                    ),
                )
            )

    insights.extend(_avisos_de_costos(db))

    # Insumos por agotarse.
    bajos = [
        i
        for i in db.query(models.Ingrediente).all()
        if i.stock_actual <= i.stock_minimo and i.tipo not in ("desechable", "preparacion")
    ]
    if bajos:
        nombres = ", ".join(i.nombre for i in bajos[:3])
        insights.append(
            schemas.Insight(
                tipo="alerta",
                titulo=f"{len(bajos)} insumo(s) por debajo del minimo",
                detalle=f"{nombres}. Revisa el asistente de compras en Inventario.",
            )
        )

    # Merma: se paga igual que un insumo vendido, pero no deja ingreso. Antes no
    # aparecia en ningun reporte, solo en el libro contable.
    if merma > 0 and ventas > 0:
        peso_merma = merma / ventas * 100
        insights.append(
            schemas.Insight(
                tipo="alerta" if peso_merma > 3 else "info",
                titulo=f"Perdiste ${merma:.2f} en merma",
                detalle=(
                    f"Es el {peso_merma:.1f}% de lo que vendiste. "
                    "Revisa Inventario para ver que se esta botando."
                ),
            )
        )

    return insights


@router.get("/resumen", response_model=schemas.ReporteResumen)
def resumen(
    rango: Rango = Depends(),
    paso: Optional[str] = None,
    categoria_id: Optional[int] = None,
    producto_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Los numeros del periodo. `desde`/`hasta` o, como antes, `periodo=`.

    `paso` (hora|dia|semana|mes) fuerza el grano de la serie. Sin el, se elige
    solo segun el largo del rango. Lo manda la pantalla cuando el dueño toca el
    selector del grafico: el automatico acierta casi siempre, pero "casi" no
    sirve cuando lo que quieres ver es justo el dia (Leider, 24-sep).

    `categoria_id` / `producto_id`: solo esa parte del menu. Entonces la
    ganancia es lo vendido menos su mercancia --un producto no tiene gastos
    ni IVA propios-- y lo que es del pedido entero (como se pago, cuanto se
    facturo) viene en cero.
    """
    inicio, fin, etiqueta = rango.resolver(periodo="dia")
    # Las palabras ("hoy", "ayer") solo cuando se pidio con el boton; con un
    # rango de fechas se habla de "este periodo".
    periodo = rango.periodo if rango.periodo in ("dia", "semana", "mes") and rango.desde is None else "rango"
    variantes = _variantes_del_filtro(db, categoria_id, producto_id)
    filtrado = variantes is not None
    if not filtrado:
        # Del mart los dias cerrados, en vivo lo que falta (hoy). Es una sola
        # definicion de "las ventas del periodo" para las dos fuentes.
        b = consolidacion.bloque_para(db, inicio, fin)
        # Las ventas brutas (lo que entro por caja) salen de los pedidos,
        # porque es el numero que el dueno reconoce. Pero la GANANCIA sale de
        # la contabilidad: el IVA cobrado no es ingreso suyo, y las mermas si
        # son perdida aunque no sean un "gasto" de la tabla de gastos. Antes
        # Reportes calculaba los dos por su cuenta y daba 8% mas de ganancia
        # que el Estado de Resultados.
        libro = contabilidad.saldos_por_tipo(db, inicio, fin)
        # Mismo tamano de ventana, inmediatamente anterior.
        previo = consolidacion.bloque_para(db, *anterior(inicio, fin))
        libro_previo = contabilidad.saldos_por_tipo(db, *anterior(inicio, fin))
    else:
        # Una parte del menu: se lee de los pedidos, renglon a renglon, y lo
        # que deja es lo vendido menos la mercancia de esos renglones.
        b = consolidacion.bloque_en_vivo(db, inicio, fin, solo_variantes=variantes)
        previo = consolidacion.bloque_en_vivo(db, *anterior(inicio, fin), solo_variantes=variantes)
        libro = {"ingreso": b.ventas, "costo": b.costo_items, "gasto": 0.0}
        libro_previo = {"ingreso": previo.ventas, "costo": previo.costo_items, "gasto": 0.0}

    ventas = b.ventas
    iva_cobrado = b.iva_cobrado
    ingresos_netos = round(libro["ingreso"], 2)
    costo = round(libro["costo"], 2)
    gastos = round(libro["gasto"], 2)
    ganancia_bruta = round(ingresos_netos - costo, 2)
    ventas_previas = previo.ventas

    # Por pago y no por pedido: una venta mixta reparte su monto entre dos
    # metodos en vez de aparecer entera bajo una etiqueta combinada.
    por_metodo: Dict[str, float] = {m: round(g.ventas, 2) for m, g in b.por_metodo.items()}

    # El que pidio la pantalla si es uno de los validos; si no, el automatico.
    paso = paso if paso in PASOS_VALIDOS else granularidad(inicio, fin)
    serie = _serie(periodo, b, inicio, fin, paso)
    productos = _top_productos(db, b)
    ganancia_neta = round(ganancia_bruta - gastos, 2)
    # Un dia solo se lee por horas; el mapa y el dia de la semana necesitan
    # varios dias para decir algo.
    varios_dias = (fin - inicio).days >= 2
    calor = _mapa_de_calor(b) if varios_dias else []
    por_dia = _por_dia_semana(b, inicio, fin, ventas) if varios_dias else []
    consolidado_en = (
        consolidacion.ultima_consolidacion(db)
        if not filtrado and consolidacion.partir_rango(db, inicio, fin)[0]
        else None
    )

    return schemas.ReporteResumen(
        periodo=periodo,
        etiqueta=etiqueta,
        granularidad=paso,
        ventas=round(ventas, 2),
        ventas_bs=round(b.ventas_bs, 2),
        iva_cobrado=iva_cobrado,
        ingresos_netos=ingresos_netos,
        pedidos=b.pedidos,
        unidades=int(b.unidades),
        ticket_promedio=round(ventas / b.pedidos, 2) if b.pedidos else 0.0,
        ticket_mediano=_mediana(b.totales),
        costo_insumos=round(costo, 2),
        ganancia_bruta=ganancia_bruta,
        margen_pct=round(ganancia_bruta / ingresos_netos * 100, 1) if ingresos_netos else 0.0,
        gastos=round(gastos, 2),
        ganancia_neta=ganancia_neta,
        valor_anulado=round(b.valor_anulado, 2),
        pedidos_anulados=b.anulados,
        devoluciones=b.devoluciones,
        valor_devuelto=round(b.valor_devuelto, 2),
        facturadas=b.facturadas,
        valor_facturado=round(b.valor_facturado, 2),
        por_metodo_pago=por_metodo,
        serie=serie,
        # TODOS los productos, no los 10 primeros: el grafico y la tabla de
        # Reportes > Ventas los muestran enteros (Leider, 30-sep).
        top_productos=productos,
        insights=_insights(
            db,
            periodo,
            ventas,
            costo,
            gastos,
            b,
            productos,
            serie,
            paso,
            ventas_previas,
            merma=0.0 if filtrado else merma_periodo(db, inicio, fin),
            # El periodo esta a medias si incluye hoy.
            incompleto=fin > datetime.datetime.now(),
            solo_ventas=filtrado,
        )
        + _lecturas_de_ritmo(calor, por_dia, b.pedidos),
        anterior=_comparativa(
            _nombre_del_anterior(periodo, inicio, fin),
            previo, libro_previo, ventas, b.pedidos, ganancia_neta,
        ),
        serie_anterior=_serie_anterior(serie, previo, inicio, fin, paso),
        calor=calor,
        por_categoria=_por_categoria(db, b, ventas),
        por_dia_semana=por_dia,
        consolidado_en=consolidado_en.isoformat() if consolidado_en else None,
        filtro=_filtro_menu(db, categoria_id, producto_id),
    )


@router.get("/combos", response_model=schemas.ReporteCombos)
def reporte_combos(
    rango: Rango = Depends(),
    categoria_id: Optional[int] = None,
    producto_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Que se vende junto y cuanto se pierde por no ofrecer el acompanante.

    El periodo por defecto es el mes: la canasta necesita volumen para que los
    porcentajes signifiquen algo, y un solo dia rara vez lo tiene.

    Filtrado por categoria o producto, se miran los pedidos que LLEVAN eso:
    "con que sale la empanada", no "con que sale todo".
    """
    inicio, fin, etiqueta = rango.resolver(periodo="mes")
    pedidos = _pedidos_pagados(db, inicio, fin)
    variantes = _variantes_del_filtro(db, categoria_id, producto_id)
    if variantes is not None:
        pedidos = [p for p in pedidos if any(i.variante_id in variantes for i in p.items)]
    analisis = combos.analizar(db, pedidos)

    return schemas.ReporteCombos(
        periodo=rango.periodo or "rango",
        etiqueta=etiqueta,
        filtro=_filtro_menu(db, categoria_id, producto_id),
        **analisis,
    )


# ── Perdidas ─────────────────────────────────────────────────────────────────


def _mermas_valoradas(
    db: Session, inicio: datetime.datetime, fin: datetime.datetime, solo: Optional[Set[int]] = None
):
    """Las mermas vivas del periodo con su valor CONGELADO, como las lista
    Inventario: el costo de hoy revaloraria una merma de hace un mes.
    `solo`: las de esas mercancias nada mas (el filtro del deposito)."""
    if solo is not None and not solo:
        return []
    q = (
        db.query(models.Merma)
        .options(joinedload(models.Merma.ingrediente))
        .filter(
            models.Merma.fecha >= inicio,
            models.Merma.fecha < fin,
            models.Merma.revertida.is_(False),
        )
    )
    if solo is not None:
        q = q.filter(models.Merma.ingrediente_id.in_(solo))
    mermas = q.order_by(models.Merma.fecha.desc()).all()
    ids = [m.id for m in mermas] or [0]
    congelado = {
        mv.referencia_id: abs(mv.valor)
        for mv in db.query(models.MovimientoInventario)
        .filter(
            models.MovimientoInventario.origen == "merma",
            models.MovimientoInventario.referencia_id.in_(ids),
        )
        .all()
    }
    # El faltante de un conteo no deja movimiento "merma" (el ajuste va como
    # "conteo"), pero si deja su asiento: ahi esta el valor al costo de ese
    # dia, que es el mismo que resta en el Estado de Resultados.
    for asiento in (
        db.query(models.AsientoContable)
        .options(joinedload(models.AsientoContable.movimientos))
        .filter(models.AsientoContable.origen == "merma", models.AsientoContable.referencia_id.in_(ids))
        .all()
    ):
        congelado.setdefault(asiento.referencia_id, round(sum(mv.debe or 0 for mv in asiento.movimientos), 2))
    return [
        (
            m,
            congelado.get(m.id, round(m.cantidad * (m.ingrediente.costo_unitario or 0), 2)),
        )
        for m in mermas
    ]


def _lecturas_de_perdidas(
    merma: float,
    ventas: float,
    por_insumo: List[schemas.PerdidaPorInsumo],
    merma_conteo: float,
    merma_anterior: float,
    cambio_pct,
    anulados: int,
    valor_anulado: float,
) -> List[schemas.Insight]:
    out: List[schemas.Insight] = []
    if merma <= 0:
        if ventas > 0:
            out.append(
                schemas.Insight(
                    tipo="bueno",
                    titulo="Sin mermas registradas en el periodo",
                    detalle="Si de verdad no se boto nada, perfecto. Si se boto y no se anoto, el inventario va a cuadrar mal en el proximo conteo.",
                )
            )
        return out
    if ventas > 0:
        peso = merma / ventas * 100
        out.append(
            schemas.Insight(
                tipo="alerta" if peso > 3 else "info",
                titulo=f"La merma es el {peso:.1f}% de la venta",
                detalle=(
                    f"${merma:.2f} perdidos contra ${ventas:.2f} vendidos. "
                    + ("En comida, por encima de 3-4% hay que buscar la causa." if peso > 3 else "Esta dentro de lo normal para comida.")
                ),
            )
        )
    if por_insumo:
        top = por_insumo[0]
        if top.pct >= 40 and len(por_insumo) > 1:
            out.append(
                schemas.Insight(
                    tipo="alerta",
                    titulo=f"{top.nombre} concentra el {top.pct:.0f}% de la perdida",
                    detalle=f"${top.valor:.2f} en {top.veces} registro(s). Es el primer sitio donde mirar: porciones, almacenamiento o compra de mas.",
                )
            )
    if merma_conteo > 0 and merma > 0:
        parte = merma_conteo / merma * 100
        if parte >= 50:
            out.append(
                schemas.Insight(
                    tipo="alerta",
                    titulo=f"El {parte:.0f}% de la perdida aparecio en conteos",
                    detalle="Nadie la registro cuando paso: o se bota sin anotar, o se esta yendo por la puerta. Las dos se arreglan distinto.",
                )
            )
    if cambio_pct is not None and merma_anterior > 0:
        if cambio_pct >= 25:
            out.append(
                schemas.Insight(
                    tipo="alerta",
                    titulo=f"La merma subio {cambio_pct:.0f}% contra el periodo anterior",
                    detalle=f"De ${merma_anterior:.2f} a ${merma:.2f}.",
                )
            )
        elif cambio_pct <= -25:
            out.append(
                schemas.Insight(
                    tipo="bueno",
                    titulo=f"La merma bajo {abs(cambio_pct):.0f}% contra el periodo anterior",
                    detalle=f"De ${merma_anterior:.2f} a ${merma:.2f}.",
                )
            )
    if anulados > 0 and ventas > 0 and valor_anulado / ventas >= 0.05:
        out.append(
            schemas.Insight(
                tipo="info",
                titulo=f"{anulados} comanda(s) anuladas por ${valor_anulado:.2f}",
                detalle="No es merma salvo que ya se hubieran preparado; revisa en Ventas cuales se marcaron como perdida.",
            )
        )
    return out


@router.get("/perdidas", response_model=schemas.ReportePerdidas)
def reporte_perdidas(
    rango: Rango = Depends(),
    categoria_id: Optional[int] = None,
    ingrediente_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Analisis de perdidas: que se merma mas, que se merma menos, por que, y
    cuanto pesa sobre la venta. Mas las ventas que no llegaron.

    `categoria_id` / `ingrediente_id`: un cajon del deposito o una mercancia.
    El peso sigue siendo sobre la venta ENTERA: lo que se pierde de carne se
    compara con lo que vende el local, no con "las ventas de carne".
    """
    inicio, fin, etiqueta = rango.resolver(periodo="dia")
    paso = granularidad(inicio, fin)
    b = consolidacion.bloque_para(db, inicio, fin)
    solo = _insumos_del_filtro(db, categoria_id, ingrediente_id)

    valoradas = _mermas_valoradas(db, inicio, fin, solo)
    total = round(sum(v for _, v in valoradas), 2)
    por_conteo = round(sum(v for m, v in valoradas if m.por_conteo), 2)

    grupos: Dict[int, dict] = {}
    motivos: Dict[str, dict] = {}
    for m, v in valoradas:
        g = grupos.setdefault(
            m.ingrediente_id,
            {"nombre": m.ingrediente.nombre, "unidad": m.ingrediente.unidad, "cantidad": 0.0, "valor": 0.0, "veces": 0, "conteo": 0.0},
        )
        g["cantidad"] += m.cantidad
        g["valor"] += v
        g["veces"] += 1
        if m.por_conteo:
            g["conteo"] += v
        motivo = "Conteo fisico" if m.por_conteo else (m.motivo.strip() or "Sin motivo")
        mo = motivos.setdefault(motivo, {"valor": 0.0, "veces": 0})
        mo["valor"] += v
        mo["veces"] += 1

    por_insumo = sorted(
        (
            schemas.PerdidaPorInsumo(
                ingrediente_id=i,
                nombre=g["nombre"],
                unidad=g["unidad"],
                cantidad=round(g["cantidad"], 3),
                valor=round(g["valor"], 2),
                veces=g["veces"],
                pct=round(g["valor"] / total * 100, 1) if total else 0.0,
                valor_conteo=round(g["conteo"], 2),
            )
            for i, g in grupos.items()
        ),
        key=lambda x: x.valor,
        reverse=True,
    )
    por_motivo = sorted(
        (schemas.PerdidaPorMotivo(motivo=k, valor=round(v["valor"], 2), veces=v["veces"]) for k, v in motivos.items()),
        key=lambda x: x.valor,
        reverse=True,
    )
    # La serie en el mismo paso que las ventas: `serie_del_rango` cuenta un
    # "pedido" por punto, que aqui es un registro de merma.
    serie = [
        schemas.PuntoPerdida(etiqueta=t["etiqueta"], valor=round(t["ventas"], 2), veces=t["pedidos"])
        for t in serie_del_rango([(m.fecha, v) for m, v in valoradas], inicio, fin, paso)
    ]

    activos_q = db.query(models.Ingrediente).filter(models.Ingrediente.activo.isnot(False))
    if solo is not None:
        activos_q = activos_q.filter(models.Ingrediente.id.in_(solo or [0]))
    activos = activos_q.count()
    sin_merma = max(activos - len(grupos), 0)

    consumo_q = db.query(models.MovimientoInventario).filter(
        models.MovimientoInventario.tipo == kardex.CONSUMO_PERSONAL,
        models.MovimientoInventario.fecha >= inicio,
        models.MovimientoInventario.fecha < fin,
    )
    if solo is not None:
        consumo_q = consumo_q.filter(models.MovimientoInventario.ingrediente_id.in_(solo or [0]))
    consumo_personal = round(sum(abs(mv.valor or 0) for mv in consumo_q.all()), 2)

    merma_anterior = round(sum(v for _, v in _mermas_valoradas(db, *anterior(inicio, fin), solo)), 2)
    cambio = _pct(total, merma_anterior)

    # Lo regalado en ventas cobradas del periodo: cuantas unidades, cuanto
    # valian y cuanto costaron.
    cortesias = 0
    valor_cortesias = 0.0
    costo_cortesias = 0.0
    for item in (
        db.query(models.PedidoItem)
        .join(models.Pedido, models.PedidoItem.pedido_id == models.Pedido.id)
        .filter(
            models.PedidoItem.cortesia.is_(True),
            models.Pedido.estado == "pagado",
            models.Pedido.devuelto.is_(False),
            models.Pedido.cerrado_en >= inicio,
            models.Pedido.cerrado_en < fin,
        )
        .all()
    ):
        cortesias += item.cantidad
        valor_cortesias += (item.precio_lista or 0) * item.cantidad
        costo_cortesias += (item.costo_unitario or 0) * item.cantidad

    detalle = [
        schemas.Merma(
            id=m.id,
            ingrediente_id=m.ingrediente_id,
            ingrediente_nombre=m.ingrediente.nombre,
            unidad=m.ingrediente.unidad,
            cantidad=m.cantidad,
            valor=v,
            motivo=m.motivo,
            fecha=m.fecha,
            revertida=m.revertida,
            por_conteo=bool(m.por_conteo),
        )
        for m, v in valoradas
    ]

    return schemas.ReportePerdidas(
        etiqueta=etiqueta,
        granularidad=paso,
        ventas=round(b.ventas, 2),
        merma=total,
        merma_registrada=round(total - por_conteo, 2),
        merma_por_conteo=por_conteo,
        registros=len(valoradas),
        peso_pct=round(total / b.ventas * 100, 1) if b.ventas else 0.0,
        consumo_personal=consumo_personal,
        merma_anterior=merma_anterior,
        cambio_pct=cambio,
        por_insumo=por_insumo,
        por_motivo=por_motivo,
        serie=serie,
        sin_merma=sin_merma,
        anulados=b.anulados,
        valor_anulado=round(b.valor_anulado, 2),
        devoluciones=b.devoluciones,
        valor_devuelto=round(b.valor_devuelto, 2),
        con_descuento=b.con_descuento,
        valor_descuentos=round(b.valor_descuentos, 2),
        cortesias=cortesias,
        valor_cortesias=round(valor_cortesias, 2),
        costo_cortesias=round(costo_cortesias, 2),
        detalle=detalle,
        insights=_lecturas_de_perdidas(
            total, b.ventas, por_insumo, por_conteo, merma_anterior, cambio, b.anulados, b.valor_anulado
        ),
        filtro=_filtro_deposito(db, categoria_id, ingrediente_id),
    )


# ── Inventario ───────────────────────────────────────────────────────────────


def _estado_del_insumo(cantidad: float, minimo: float, dias: Optional[float], por_dia: float) -> str:
    if cantidad <= 0:
        return "agotado"
    if cantidad <= minimo:
        return "bajo"
    if por_dia <= 0:
        return "quieto"
    if dias is not None and dias > 45:
        return "sobra"
    return "ok"


def _lecturas_de_inventario(
    valor_total: float,
    por_insumo: List[schemas.InsumoDelDeposito],
    bajo: int,
    agotados: int,
    quietos: int,
    valor_quieto: float,
    rotacion: Optional[float],
    inflacion_pct: Optional[float],
    dias: int,
) -> List[schemas.Insight]:
    out: List[schemas.Insight] = []
    if valor_total <= 0:
        return out
    if agotados:
        nombres = ", ".join(i.nombre for i in por_insumo if i.estado == "agotado")
        out.append(schemas.Insight(tipo="alerta", titulo=f"{agotados} mercancia(s) agotadas", detalle=nombres[:160]))
    if bajo:
        nombres = ", ".join(i.nombre for i in por_insumo if i.estado == "bajo")
        out.append(
            schemas.Insight(
                tipo="alerta",
                titulo=f"{bajo} mercancia(s) bajo el minimo",
                detalle=f"{nombres[:140]}. La lista de compra esta abajo.",
            )
        )
    if por_insumo:
        top = por_insumo[0]
        if top.pct >= 35:
            out.append(
                schemas.Insight(
                    tipo="info",
                    titulo=f"{top.nombre} es el {top.pct:.0f}% de la plata en el inventario",
                    detalle=f"${top.valor:.2f} de ${valor_total:.2f}. Conviene contarlo mas seguido que al resto.",
                )
            )
    if quietos and valor_quieto / valor_total >= 0.15:
        out.append(
            schemas.Insight(
                tipo="alerta",
                titulo=f"${valor_quieto:.2f} en mercancia que no se movio en {dias} dia(s)",
                detalle=f"{quietos} mercancia(s) sin ninguna salida. Es plata quieta: revisa si se sigue usando o si se compro de mas.",
            )
        )
    if rotacion is not None:
        if rotacion < 0.5 and dias >= 14:
            out.append(
                schemas.Insight(
                    tipo="info",
                    titulo=f"El inventario roto {rotacion:.1f} veces en el periodo",
                    detalle="Hay mas inventario del que la venta necesita: cada dolar en el estante tarda en volver a la gaveta.",
                )
            )
        elif rotacion >= 2:
            out.append(
                schemas.Insight(
                    tipo="bueno",
                    titulo=f"El inventario roto {rotacion:.1f} veces en el periodo",
                    detalle="Se compra lo que se vende. Ojo con quedarse corto en los dias fuertes.",
                )
            )
    if inflacion_pct is not None and inflacion_pct >= 10:
        out.append(
            schemas.Insight(
                tipo="alerta",
                titulo=f"La mercancia subio {inflacion_pct:.0f}% en el periodo",
                detalle="Si los precios del menu no se movieron, el margen se esta achicando solo. Revisa los precios en Menu.",
            )
        )
    return out


@router.get("/inventario", response_model=schemas.ReporteInventario)
def reporte_inventario(
    rango: Rango = Depends(),
    categoria_id: Optional[int] = None,
    ingrediente_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """El deposito de hoy, leido con el consumo del periodo: donde esta la
    plata, para cuantos dias alcanza, que no se mueve y que hay que comprar.

    `categoria_id` / `ingrediente_id`: un cajon del deposito o una mercancia.
    Todo --el valor, la rotacion, lo quieto, la lista de compra-- es de esa
    parte nada mas.
    """
    inicio, fin, etiqueta = rango.resolver(periodo="dia")
    solo = _insumos_del_filtro(db, categoria_id, ingrediente_id)
    corte = ahora()
    # El consumo se mide hasta ahora aunque el rango sea el mes pasado: lo
    # que interesa es cuanto dura lo que HAY, y eso se mide con dias reales.
    dias = max((min(fin, corte) - inicio).days, 1)
    desde_consumo = min(fin, corte) - datetime.timedelta(days=dias)

    saldos = kardex.existencias_a(db, corte)
    promedios = kardex.costos_promedio_a(db, corte)
    consumo_diario = kardex.consumo_por_dia_de_todos(db, desde_consumo, corte)
    # Lo que salio por ventas en el periodo, a costo, por mercancia.
    consumido_por: Dict[int, float] = {}
    for ing_id, valor in (
        db.query(models.MovimientoInventario.ingrediente_id, func.sum(models.MovimientoInventario.valor))
        .filter(
            models.MovimientoInventario.tipo == kardex.VENTA,
            models.MovimientoInventario.fecha >= inicio,
            models.MovimientoInventario.fecha < fin,
        )
        .group_by(models.MovimientoInventario.ingrediente_id)
        .all()
    ):
        consumido_por[ing_id] = abs(valor or 0)

    filas = []
    valor_total = 0.0
    ingredientes_q = db.query(models.Ingrediente).filter(models.Ingrediente.activo.isnot(False))
    if solo is not None:
        ingredientes_q = ingredientes_q.filter(models.Ingrediente.id.in_(solo or [0]))
    for ing in ingredientes_q.order_by(models.Ingrediente.nombre).all():
        if ing.tipo == "desechable":
            continue  # no lleva stock: no hay nada que valorar en el deposito
        cantidad = saldos.get(ing.id, ing.stock_actual or 0)
        costo = promedios.get(ing.id) or ing.costo_unitario or 0
        valor = round(max(cantidad, 0) * costo, 2)
        valor_total += valor
        por_dia = consumo_diario.get(ing.id, 0.0)
        dias_stock = round(cantidad / por_dia, 1) if por_dia > 0 and cantidad > 0 else None
        filas.append(
            schemas.InsumoDelDeposito(
                ingrediente_id=ing.id,
                nombre=ing.nombre,
                unidad=ing.unidad,
                tipo=ing.tipo or "insumo",
                cantidad=round(cantidad, 3),
                stock_minimo=ing.stock_minimo or 0,
                costo_unitario=round(costo, 4),
                valor=valor,
                pct=0.0,
                por_dia=por_dia,
                dias_de_stock=dias_stock,
                consumido=round(consumido_por.get(ing.id, 0.0), 2),
                estado=_estado_del_insumo(cantidad, ing.stock_minimo or 0, dias_stock, por_dia),
            )
        )
    valor_total = round(valor_total, 2)
    for f in filas:
        f.pct = round(f.valor / valor_total * 100, 1) if valor_total else 0.0
    filas.sort(key=lambda f: f.valor, reverse=True)

    # Lo consumido, solo de lo que se esta mirando.
    consumido = round(sum(f.consumido for f in filas), 2)
    quietos = [f for f in filas if f.estado == "quieto" and f.valor > 0]
    inflacion = reposicion.inflacion_de_insumos(db, dias)
    if inflacion and solo is not None:
        # La subida de precios, solo de esas mercancias: el promedio se
        # vuelve a sacar sobre ellas.
        insumos = [i for i in inflacion["insumos"] if i["ingrediente_id"] in solo]
        inflacion = (
            {"insumos": insumos, "cambio_pct": round(sum(i["cambio_pct"] for i in insumos) / len(insumos), 1)}
            if insumos
            else None
        )
    por_comprar = sugerencias_compra(db)
    if solo is not None:
        por_comprar = [s for s in por_comprar if s.ingrediente_id in solo]

    bajo = sum(1 for f in filas if f.estado == "bajo")
    agotados = sum(1 for f in filas if f.estado == "agotado")
    valor_quieto = round(sum(f.valor for f in quietos), 2)
    rotacion = round(consumido / valor_total, 2) if valor_total > 0 else None

    return schemas.ReporteInventario(
        etiqueta=etiqueta,
        dias=dias,
        valor_total=valor_total,
        valor_insumos=round(sum(f.valor for f in filas if f.tipo != "reventa"), 2),
        valor_reventa=round(sum(f.valor for f in filas if f.tipo == "reventa"), 2),
        activos=len(filas),
        bajo_minimo=bajo,
        agotados=agotados,
        sin_costo=sum(1 for f in filas if f.costo_unitario <= 0),
        quietos=len(quietos),
        valor_quieto=valor_quieto,
        consumido=consumido,
        rotacion=rotacion,
        inflacion_pct=inflacion["cambio_pct"] if inflacion else None,
        inflacion=[schemas.InsumoInflacion(**i) for i in (inflacion["insumos"][:8] if inflacion else [])],
        por_insumo=filas,
        por_comprar=por_comprar,
        insights=_lecturas_de_inventario(
            valor_total, filas, bajo, agotados, len(quietos), valor_quieto, rotacion,
            inflacion["cambio_pct"] if inflacion else None, dias,
        ),
        filtro=_filtro_deposito(db, categoria_id, ingrediente_id),
    )


# ── La portada: arranque y avisos ─────────────────────────────────────────────
#
# "Fight complexity" (Leider, 30-sep): el sistema no espera a que le
# pregunten. La portada cuenta cuanto lleva armado un local nuevo --para
# guiarlo paso a paso-- y le dice al dueño lo que hoy tendria que ir a buscar
# a tres pantallas distintas: que se le acaba, que le deben, que subio.


@router.get("/arranque", response_model=schemas.ArranqueLocal)
def arranque(db: Session = Depends(get_db)):
    """Cuanto lleva armado el local. Cinco cuentas, una consulta cada una."""
    # Sin la categoria de envios: son servicios que el sistema trae puestos,
    # no productos que el local cargo. Un local recien abierto tiene cero.
    productos = (
        db.query(models.Producto)
        .join(models.Categoria)
        .filter(
            models.Producto.activo.is_(True),
            models.Categoria.activo.is_(True),
            models.Categoria.nombre != seed.CATEGORIA_ENVIOS,
        )
        .count()
    )
    con_receta = (
        db.query(models.RecetaItem.variante_id)
        .join(models.Variante, models.Variante.id == models.RecetaItem.variante_id)
        .join(models.Producto, models.Producto.id == models.Variante.producto_id)
        .filter(models.Variante.activo.is_(True), models.Producto.activo.is_(True))
        .distinct()
        .count()
    )
    mercancias = db.query(models.Ingrediente).filter(models.Ingrediente.activo.isnot(False)).count()
    ventas = db.query(models.Pedido).filter(models.Pedido.estado == "pagado").count()
    cierres = db.query(models.CierreCaja).filter(models.CierreCaja.anulado.isnot(True)).count()
    return schemas.ArranqueLocal(
        productos=productos,
        con_receta=con_receta,
        mercancias=mercancias,
        ventas=ventas,
        cierres=cierres,
    )


def _cuando(dias: float) -> str:
    """"hoy", "mañana", "el jueves": cuando se acaba algo que dura `dias`."""
    if dias < 1:
        return "hoy"
    if dias < 2:
        return "mañana"
    fecha = hoy() + datetime.timedelta(days=int(round(dias)))
    return f"el {DIAS_LARGOS[fecha.weekday()]}"


def _avisos_de_deposito(db: Session) -> List[schemas.Aviso]:
    """Lo que se acaba, medido con el consumo real de las ultimas dos semanas.

    "La harina se te acaba el jueves" vale mas que una tabla de existencias:
    el minimo a dedo se pone una vez y se queda viejo; el consumo cambia solo.
    """
    corte = ahora()
    saldos = kardex.existencias_a(db, corte)
    consumo = kardex.consumo_por_dia_de_todos(db, corte - datetime.timedelta(days=14), corte)
    agotados: List[str] = []
    pronto: List[tuple] = []
    for ing in db.query(models.Ingrediente).filter(models.Ingrediente.activo.isnot(False)).all():
        por_dia = consumo.get(ing.id, 0.0)
        if por_dia <= 0:
            continue  # lo que no se mueve no se acaba
        cantidad = saldos.get(ing.id, ing.stock_actual or 0)
        if cantidad <= 0:
            agotados.append(ing.nombre)
            continue
        dias = cantidad / por_dia
        if dias <= 7:
            pronto.append((dias, ing.nombre))
    out: List[schemas.Aviso] = []
    if agotados:
        nombres = ", ".join(agotados[:3]) + ("…" if len(agotados) > 3 else "")
        out.append(
            schemas.Aviso(
                id="agotados",
                tono="ojo",
                titulo=f"Te quedaste sin {nombres}",
                detalle="Se vende con eso y ya no hay en el inventario.",
                a="/inventario/comprar",
            )
        )
    pronto.sort()
    if pronto:
        dias, nombre = pronto[0]
        resto = len(pronto) - 1
        out.append(
            schemas.Aviso(
                id="se-acaba",
                tono="ojo",
                titulo=f"{nombre} se te acaba {_cuando(dias)}",
                detalle=(
                    f"Al ritmo de las últimas dos semanas. Y {resto} más esta semana."
                    if resto
                    else "Al ritmo de las últimas dos semanas."
                ),
                a="/inventario/comprar",
            )
        )
    return out


def _aviso_de_fiado(db: Session) -> Optional[schemas.Aviso]:
    pedidos = (
        db.query(models.Pedido)
        .join(models.PagoPedido)
        .filter(
            models.PagoPedido.metodo == "Fiado",
            models.Pedido.fiado_saldado.is_(False),
            models.Pedido.devuelto.is_(False),
        )
        .all()
    )
    total = round(sum(p.fiado_saldo for p in pedidos), 2)
    if total <= 0:
        return None
    viejo = max(((ahora() - (p.cerrado_en or p.creado_en)).days for p in pedidos), default=0)
    return schemas.Aviso(
        id="fiado",
        tono="ojo",
        titulo=f"Te deben ${total:.2f} de {len(pedidos)} venta{'s' if len(pedidos) != 1 else ''} a crédito",
        detalle=f"La más vieja tiene {viejo} día{'s' if viejo != 1 else ''}." if viejo else "",
        a="/ventas?e=fiada&r=90d",
    )


def _avisos_del_mes(db: Session) -> List[schemas.Aviso]:
    """Lo que se lee de las ventas del mes: recetas que faltan, el dia fuerte."""
    fin = ahora()
    inicio = inicio_del_dia(hoy().replace(day=1))
    b = consolidacion.bloque_para(db, inicio, fin)
    out: List[schemas.Aviso] = []
    if not b.pedidos:
        return out
    sin_receta = [g for g in b.productos.values() if g.sin_receta and g.ventas > 0]
    if sin_receta:
        vendido = sum(g.ventas for g in sin_receta)
        n = len(sin_receta)
        out.append(
            schemas.Aviso(
                id="sin-receta",
                tono="info",
                titulo=f"{n} producto{'s' if n != 1 else ''} que vendes no {'tienen' if n != 1 else 'tiene'} receta",
                detalle=f"${vendido:.2f} vendidos este mes sin saber cuánto dejan. Ponles receta y lo ves al instante.",
                a="/menu/recetas",
            )
        )
    # El dia fuerte solo cuando hay con que compararlo: dos semanas de datos.
    if (fin - inicio).days >= 13:
        dias = [d for d in _por_dia_semana(b, inicio, fin, b.ventas) if d.promedio]
        if len(dias) >= 3:
            mejor = max(dias, key=lambda d: d.promedio or 0)
            i = DIAS_ES.index(mejor.nombre)
            out.append(
                schemas.Aviso(
                    id="dia-fuerte",
                    tono="bien",
                    titulo=f"El {DIAS_LARGOS[i]} es tu día fuerte",
                    detalle=f"Un {DIAS_LARGOS[i]} típico vende ${mejor.promedio:.2f}. Que no falte nada ese día.",
                    a="/reportes/ventas",
                )
            )
    return out


def _aviso_de_iva(db: Session) -> Optional[schemas.Aviso]:
    """Al final del mes: cuanto IVA se lleva el SENIAT. Impuestos trabaja por
    debajo; el dueño solo necesita saber la cifra antes de que le toque."""
    if hoy().day < 24:
        return None
    from .impuestos import _totales_iva_del_rango

    inicio = inicio_del_dia(hoy().replace(day=1))
    debito, credito = _totales_iva_del_rango(db, inicio, ahora())
    neto = round(debito - credito, 2)
    if neto <= 0:
        return None
    return schemas.Aviso(
        id="iva",
        tono="info",
        titulo=f"Este mes llevas ${neto:.2f} de IVA por pagar",
        detalle="Cobrado en ventas menos pagado en compras. Los libros ya están armados.",
        a="/impuestos/declaraciones",
    )


# ── El recorrido de la portada ───────────────────────────────────────────────
#
# Leider (1-oct): "los negocios tienen flujos, el mas claro de mi ERP es
# compras > inventario > menu", que termina en el cierre de caja. La portada
# lo dibuja como el seguimiento de un pedido: cinco estaciones en orden, cada
# una con UNA frase literal de como esta, y en ambar solo las que piden algo.
# Sin cifras de plata sueltas: "los numeros esos no estan fight complexity".
# Cada frase sale del mismo sitio que la pantalla a la que lleva, para que lo
# de la portada y lo de adentro digan lo mismo.


def _lista_corta(nombres: List[str], tope: int = 2) -> str:
    """"harina", "harina y queso", "harina, queso y 3 más"."""
    nombres = [n.strip().lower() for n in nombres if n and n.strip()]
    if len(nombres) <= 1:
        return "".join(nombres)
    if len(nombres) <= tope:
        return " y ".join(nombres)
    resto = len(nombres) - tope
    return f"{', '.join(nombres[:tope])} y {resto} más"


def _paso_compras(db: Session) -> schemas.PasoRecorrido:
    # Lo mismo que "Qué comprar" en Inventario: primero lo que se acaba antes.
    sugeridas = sugerencias_compra(db)
    if sugeridas:
        sugeridas = sorted(
            sugeridas, key=lambda s: (s.dias_restantes is None, s.dias_restantes or 0)
        )
        return schemas.PasoRecorrido(
            id="compras",
            frase=f"Toca comprar {_lista_corta([s.ingrediente_nombre for s in sugeridas])}",
            pendiente=True,
            a="/inventario/comprar",
            accion="Ver qué comprar",
        )
    return schemas.PasoRecorrido(id="compras", frase="Nada que comprar", a="/compras", accion="Abrir compras")


def _paso_inventario(db: Session) -> schemas.PasoRecorrido:
    activos = db.query(models.Ingrediente).filter(models.Ingrediente.activo.isnot(False)).all()
    if not activos:
        return schemas.PasoRecorrido(
            id="inventario", frase="Carga tu mercancía", pendiente=True, a="/inventario", accion="Agregar mercancía"
        )
    # Se acabo y se usa: con stock cero lo que no se mueve no molesta a nadie.
    corte = ahora()
    consumo = kardex.consumo_por_dia_de_todos(db, corte - datetime.timedelta(days=14), corte)
    agotados = [i.nombre for i in activos if (i.stock_actual or 0) <= 0 and consumo.get(i.id, 0) > 0]
    if agotados:
        return schemas.PasoRecorrido(
            id="inventario",
            frase=f"Se acabó {_lista_corta(agotados)}",
            pendiente=True,
            a="/inventario/comprar",
            accion="Ver qué falta",
        )
    # Solo si ya se conto alguna vez: a un local que nunca conto no se le
    # recuerda todos los dias algo que todavia no hace.
    ultimo = db.query(func.max(models.Conteo.fecha)).scalar()
    if ultimo is not None:
        dias = (hoy() - ultimo.date()).days
        if dias > 14:
            return schemas.PasoRecorrido(
                id="inventario",
                frase=f"Hace {dias} días que no se cuenta",
                pendiente=True,
                a="/inventario",
                accion="Contar lo que hay",
            )
    return schemas.PasoRecorrido(id="inventario", frase="Hay de todo", a="/inventario", accion="Abrir inventario")


def _paso_menu(db: Session) -> schemas.PasoRecorrido:
    # Lo mismo que cuenta Recetas: las variantes a la venta sin receta. Los
    # envios no se cocinan, no llevan receta.
    variantes = (
        db.query(models.Variante.id)
        .join(models.Producto, models.Producto.id == models.Variante.producto_id)
        .join(models.Categoria, models.Categoria.id == models.Producto.categoria_id)
        .filter(
            models.Variante.activo.is_(True),
            models.Producto.activo.is_(True),
            models.Categoria.activo.is_(True),
            models.Categoria.nombre != seed.CATEGORIA_ENVIOS,
        )
        .all()
    )
    if not variantes:
        return schemas.PasoRecorrido(
            id="menu", frase="Arma tu menú", pendiente=True, a="/menu", accion="Agregar productos"
        )
    con_receta = {v for (v,) in db.query(models.RecetaItem.variante_id).distinct()}
    faltan = sum(1 for (v,) in variantes if v not in con_receta)
    if faltan:
        return schemas.PasoRecorrido(
            id="menu",
            frase=f"{faltan} producto{'s' if faltan != 1 else ''} sin receta",
            pendiente=True,
            a="/menu/recetas",
            accion="Ponerles receta",
        )
    return schemas.PasoRecorrido(id="menu", frase="Todo con receta", a="/menu", accion="Abrir el menú")


def _paso_ventas(db: Session) -> schemas.PasoRecorrido:
    fiadas = (
        db.query(models.Pedido)
        .join(models.PagoPedido)
        .filter(
            models.PagoPedido.metodo == "Fiado",
            models.Pedido.fiado_saldado.is_(False),
            models.Pedido.devuelto.is_(False),
        )
        .distinct()
        .all()
    )
    deben = round(sum(p.fiado_saldo for p in fiadas), 2)
    if deben > 0:
        return schemas.PasoRecorrido(
            id="ventas",
            frase="Te deben {monto}",
            monto=deben,
            pendiente=True,
            a="/ventas?e=fiada&r=90d",
            accion="Ver quién debe",
        )
    # Los mismos "pedidos" del panel de Hoy: lo cobrado desde la medianoche.
    n = (
        db.query(models.Pedido)
        .filter(models.Pedido.estado == "pagado", models.Pedido.cerrado_en >= inicio_del_dia(hoy()))
        .count()
    )
    frase = f"{n} pedido{'s' if n != 1 else ''} hoy" if n else "Sin ventas todavía hoy"
    return schemas.PasoRecorrido(id="ventas", frase=frase, a="/ventas", accion="Ver las ventas")


def _paso_caja(db: Session) -> schemas.PasoRecorrido:
    def cierre_de(dia: datetime.date):
        inicio = inicio_del_dia(dia)
        return (
            db.query(models.CierreCaja)
            .filter(
                models.CierreCaja.fecha >= inicio,
                models.CierreCaja.fecha < inicio + datetime.timedelta(days=1),
                models.CierreCaja.anulado.is_(False),
            )
            .order_by(models.CierreCaja.fecha.desc())
            .first()
        )

    # Primero lo que quedo atras: un dia con ventas y sin cerrar.
    ayer = hoy() - datetime.timedelta(days=1)
    vendio_ayer = (
        db.query(models.Pedido.id)
        .filter(
            models.Pedido.estado == "pagado",
            models.Pedido.cerrado_en >= inicio_del_dia(ayer),
            models.Pedido.cerrado_en < inicio_del_dia(hoy()),
        )
        .first()
        is not None
    )
    if vendio_ayer and cierre_de(ayer) is None:
        return schemas.PasoRecorrido(
            id="caja", frase="La caja de ayer no se cerró", pendiente=True, a="/caja", accion="Cerrarla"
        )

    cerrada = cierre_de(hoy())
    if cerrada is not None:
        dif = round(cerrada.diferencia or 0, 2)
        if abs(dif) < 0.01:
            return schemas.PasoRecorrido(id="caja", frase="Cerrada: cuadró", a="/caja", accion="Ver el cierre")
        return schemas.PasoRecorrido(
            id="caja",
            frase="Cerrada: faltaron {monto}" if dif < 0 else "Cerrada: sobraron {monto}",
            monto=abs(dif),
            a="/caja",
            accion="Ver el cierre",
        )
    abierta = db.query(models.AperturaCaja.id).filter(models.AperturaCaja.dia == hoy()).first() is not None
    if abierta:
        return schemas.PasoRecorrido(
            id="caja", frase="Abierta, se cierra al final del día", a="/caja", accion="Ir a la caja"
        )
    return schemas.PasoRecorrido(
        id="caja", frase="Falta abrirla", pendiente=True, a="/pos", accion="Abrir la caja"
    )


@router.get("/recorrido", response_model=schemas.Recorrido)
def recorrido(db: Session = Depends(get_db)):
    """Las cinco estaciones de la portada y las ventas de los ultimos 7 dias."""
    pasos = [_paso_compras(db), _paso_inventario(db), _paso_menu(db), _paso_ventas(db), _paso_caja(db)]
    # Las mismas ventas que Reportes: del data mart, un dia a la vez.
    dias = []
    for k in range(6, -1, -1):
        dia = hoy() - datetime.timedelta(days=k)
        inicio = inicio_del_dia(dia)
        fin = min(inicio + datetime.timedelta(days=1), ahora())
        b = consolidacion.bloque_para(db, inicio, fin)
        dias.append(schemas.DiaVendido(fecha=dia.isoformat(), ventas=round(b.ventas, 2)))
    return schemas.Recorrido(pasos=pasos, ultimos_7_dias=dias)


@router.get("/avisos", response_model=List[schemas.Aviso])
def avisos(db: Session = Depends(get_db)):
    """Lo que el dueño tendria que ir a buscar hoy, dicho en la portada.

    Primero lo que cuesta plata si no se atiende (ojo), despues lo que
    conviene saber (info), y al final lo bueno. Nunca mas de cuatro: cinco
    avisos son una lista, y una lista ya no se lee.
    """
    todos: List[schemas.Aviso] = []
    todos += _avisos_de_deposito(db)
    fiado = _aviso_de_fiado(db)
    if fiado:
        todos.append(fiado)
    # Lo que subio de precio ya lo calcula Reportes: se cuenta en una frase.
    for i, insight in enumerate(_avisos_de_costos(db)[:1]):
        todos.append(
            schemas.Aviso(id=f"costos-{i}", tono="ojo", titulo=insight.titulo, detalle=insight.detalle, a="/menu")
        )
    todos += _avisos_del_mes(db)
    iva = _aviso_de_iva(db)
    if iva:
        todos.append(iva)
    orden = {"ojo": 0, "info": 1, "bien": 2}
    todos.sort(key=lambda a: orden.get(a.tono, 9))
    return todos[:4]
