import datetime
from typing import Dict, List, Tuple

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from sqlalchemy.orm import joinedload

from .. import combos, contabilidad, impuestos, models, reposicion, schemas, seed
from ..database import get_db
from ..rango import Rango, anterior, granularidad, serie as serie_del_rango
from ..timeutils import hoy

router = APIRouter(prefix="/api/reportes", tags=["reportes"])


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
                titulo=f"Tus insumos subieron {inflacion['cambio_pct']:.0f}% en 30 dias",
                detalle=(
                    f"{detalle}. Si tus precios no subieron parecido, estas vendiendo "
                    "mas barato de lo que te va a costar reponer. Revisa el Menu: "
                    "ahi esta el precio sugerido de cada producto."
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


def _pedidos_pagados(db: Session, inicio: datetime.datetime, fin: datetime.datetime):
    """Ventas efectivas del periodo. Las devueltas no cuentan: el cliente
    trajo la comida de vuelta, asi que no hubo venta."""
    return (
        db.query(models.Pedido)
        .filter(
            models.Pedido.estado == "pagado",
            models.Pedido.devuelto.is_(False),
            models.Pedido.cerrado_en >= inicio,
            models.Pedido.cerrado_en < fin,
        )
        .all()
    )


def _devoluciones(db: Session, inicio: datetime.datetime, fin: datetime.datetime):
    return (
        db.query(models.Pedido)
        .filter(
            models.Pedido.devuelto.is_(True),
            models.Pedido.fecha_devolucion >= inicio,
            models.Pedido.fecha_devolucion < fin,
        )
        .all()
    )


def _totales(pedidos) -> Tuple[float, float]:
    """(ventas, costo de insumos) del conjunto de pedidos."""
    ventas = sum(p.total for p in pedidos)
    costo = sum(
        (i.costo_unitario or 0) * i.cantidad for p in pedidos for i in p.items
    )
    return ventas, costo


def _pedidos_anulados(db: Session, inicio: datetime.datetime, fin: datetime.datetime):
    return (
        db.query(models.Pedido)
        .filter(
            models.Pedido.estado == "anulado",
            models.Pedido.creado_en >= inicio,
            models.Pedido.creado_en < fin,
        )
        .all()
    )


def _valor_anulado(db: Session, inicio: datetime.datetime, fin: datetime.datetime) -> float:
    """Cuanto dinero de venta se perdio en anulaciones.

    Contar cuantos pedidos se anularon no le dice nada al dueno; lo que importa
    es si eso le esta costando plata.
    """
    return round(sum(p.total for p in _pedidos_anulados(db, inicio, fin)), 2)


def merma_periodo(db: Session, inicio: datetime.datetime, fin: datetime.datetime) -> float:
    """Valor de lo que se boto en el periodo, segun la cuenta 6020."""
    cuenta = (
        db.query(models.CuentaContable).filter(models.CuentaContable.codigo == "6020").first()
    )
    if not cuenta:
        return 0.0
    movimientos = (
        db.query(models.MovimientoContable)
        .join(models.AsientoContable)
        .filter(
            models.MovimientoContable.cuenta_id == cuenta.id,
            models.AsientoContable.fecha >= inicio,
            models.AsientoContable.fecha < fin,
        )
        .all()
    )
    return round(sum(m.debe - m.haber for m in movimientos), 2)


def _ventas_en_bs(pedidos) -> float:
    """Bolivares que de verdad entraron, cada venta a la tasa de SU dia.

    Convertir el total en dolares a la tasa de hoy haria que el historico en
    bolivares cambiara solo cada vez que se mueve el dolar.
    """
    return round(sum(p.total * (p.tasa_bcv or 0) for p in pedidos), 2)


def _iva_cobrado(pedidos) -> float:
    """IVA contenido en las ventas facturadas: entro a la caja pero no es del negocio."""
    total = 0.0
    for p in pedidos:
        if not p.facturado:
            continue
        _base, iva = impuestos.desglosar(p.total, p.tasa_iva or impuestos.IVA_DEFAULT)
        total += iva
    return round(total, 2)


def _serie(periodo: str, pedidos, inicio: datetime.datetime, fin: datetime.datetime):
    """Ventas a lo largo del rango, con el paso que le toca (ver `rango.serie`).

    La semana se sigue leyendo por dia de la semana ("Lun", "Mar"), que es como
    la piensa quien atiende; lo demas lleva la fecha.
    """
    puntos = serie_del_rango(((p.cerrado_en, p.total) for p in pedidos), inicio, fin)
    if periodo == "semana" and granularidad(inicio, fin) == "dia":
        dia = inicio
        for punto in puntos:
            punto["etiqueta"] = DIAS_ES[dia.weekday()]
            dia += datetime.timedelta(days=1)
    return [schemas.PuntoSerie(**p) for p in puntos]


def _top_productos(pedidos, servicios: set) -> List[schemas.ProductoVendido]:
    """Agrupa por variante, NO por el nombre congelado del item.

    Agrupar por nombre rompia en las dos direcciones: dos productos distintos
    con el mismo nombre (uno en Desayuno a $10 y otro en Merienda a $4) se
    fundian en una linea cuyo margen -96.3% en la prueba- no era el de ninguno
    de los dos; y renombrar un producto a mitad de mes partia su historico en
    dos lineas. El nombre congelado sigue siendo el que se muestra (el ticket
    de ayer decia eso), pero ya no es la clave.
    """
    agregado: Dict[object, Dict[str, float]] = {}
    for p in pedidos:
        for i in p.items:
            # La venta libre no tiene variante: se agrupa por su nombre, que es
            # lo unico que la identifica.
            clave = i.variante_id if i.variante_id is not None else ("libre", i.nombre)
            entrada = agregado.setdefault(
                clave,
                {
                    "nombre": i.nombre,
                    "unidades": 0,
                    "ingresos": 0.0,
                    "costo": 0.0,
                    "sin_receta": False,
                },
            )
            # Si el producto se renombro, manda el nombre mas reciente: es el
            # que el dueno reconoce hoy en la pantalla.
            entrada["nombre"] = i.nombre
            entrada["unidades"] += i.cantidad
            entrada["ingresos"] += i.precio_unitario * i.cantidad
            entrada["costo"] += (i.costo_unitario or 0) * i.cantidad
            # Lo que decide si el margen es confiable es si ESA venta tuvo
            # costo, no si el producto tiene receta HOY. Con la receta de hoy,
            # borrarla reescribia a 0% el margen de ventas que si lo tuvieron,
            # y cargarla despues presentaba como dato bueno un 100% inventado
            # sobre ventas que se hicieron sin costo.
            # Un servicio (el envio) cuesta cero de verdad: no le falta nada.
            if not (i.costo_unitario or 0) and i.variante_id not in servicios:
                entrada["sin_receta"] = True

    productos = []
    for _variante_id, datos in agregado.items():
        nombre = datos["nombre"]
        ingresos = round(datos["ingresos"], 2)
        costo = round(datos["costo"], 2)
        ganancia = round(ingresos - costo, 2)
        sin_receta = bool(datos["sin_receta"])
        productos.append(
            schemas.ProductoVendido(
                nombre=nombre,
                unidades=int(datos["unidades"]),
                ingresos=ingresos,
                costo=costo,
                ganancia=ganancia,
                # Un margen calculado sobre costo cero no significa nada, asi
                # que no se reporta como si fuera un dato bueno.
                margen_pct=0.0 if sin_receta else (round(ganancia / ingresos * 100, 1) if ingresos else 0.0),
                sin_receta=sin_receta,
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
    etiqueta: str, pedidos_previos, ventas_previas: float, libro_previo: dict,
    ventas: float, cuantos: int, ganancia_neta: float,
) -> schemas.Comparativa:
    """El periodo anterior puesto al lado, con el cambio en porcentaje.

    Se calcula igual que el actual --mismos pedidos pagados, misma
    contabilidad-- para que "vas 12% arriba" compare lo mismo con lo mismo.
    """
    n_prev = len(pedidos_previos)
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
    serie_actual: List[schemas.PuntoSerie], pedidos_previos, inicio, fin, paso: str
) -> List[schemas.PuntoSerie]:
    """La serie del periodo anterior, tramo a tramo contra la actual.

    Lleva las etiquetas de la actual a proposito: se dibuja encima de ella,
    punteada, y lo que se compara es "el mismo tramo" (la misma hora, el
    mismo dia de la semana), no la fecha.
    """
    if not serie_actual:
        return []
    ini_prev, fin_prev = anterior(inicio, fin)
    puntos = serie_del_rango(
        ((p.cerrado_en, p.total) for p in pedidos_previos), ini_prev, fin_prev, paso=paso
    )
    if paso == "hora":
        # Por horas la serie viene recortada de la primera a la ultima venta
        # de cada dia, y esos recortes no coinciden: se alinea por la hora.
        por_hora = {pt["etiqueta"]: pt for pt in puntos}
        return [
            schemas.PuntoSerie(
                etiqueta=s.etiqueta,
                ventas=por_hora.get(s.etiqueta, {}).get("ventas", 0.0),
                pedidos=por_hora.get(s.etiqueta, {}).get("pedidos", 0),
            )
            for s in serie_actual
        ]
    salida = [
        schemas.PuntoSerie(etiqueta=s.etiqueta, ventas=pt["ventas"], pedidos=pt["pedidos"])
        for s, pt in zip(serie_actual, puntos)
    ]
    # Meses de distinto largo pueden dar un tramo mas o menos: se rellena.
    for s in serie_actual[len(salida):]:
        salida.append(schemas.PuntoSerie(etiqueta=s.etiqueta, ventas=0.0, pedidos=0))
    return salida


def _mapa_de_calor(pedidos) -> List[schemas.PuntoCalor]:
    """Cuando ENTRAN los clientes: por la hora en que se tomo el pedido, no
    en la que se cobro. Para decidir a que hora hace falta mas gente en el
    mostrador importa cuando llegan, y una mesa que paga al irse se cobraria
    una hora despues de haber pedido."""
    celdas: Dict[Tuple[int, int], Dict[str, float]] = {}
    for p in pedidos:
        t = p.creado_en or p.cerrado_en
        if t is None:
            continue
        c = celdas.setdefault((t.weekday(), t.hour), {"pedidos": 0, "ventas": 0.0})
        c["pedidos"] += 1
        c["ventas"] += p.total
    return [
        schemas.PuntoCalor(dia=d, hora=h, pedidos=int(c["pedidos"]), ventas=round(c["ventas"], 2))
        for (d, h), c in sorted(celdas.items())
    ]


def _por_categoria(db: Session, pedidos, ventas_total: float) -> List[schemas.GrupoReporte]:
    """Que parte de la venta es comida, que parte bebida, que parte envios.

    Se agrupa por la categoria de HOY de cada variante: los renglones guardan
    nombre y precio pero no categoria, y guardarla habria sido repetir el menu
    en cada venta. La venta libre va en su propio grupo.
    """
    ids = {i.variante_id for p in pedidos for i in p.items if i.variante_id is not None}
    categoria_de: Dict[int, str] = {}
    if ids:
        variantes = (
            db.query(models.Variante)
            .options(joinedload(models.Variante.producto).joinedload(models.Producto.categoria))
            .filter(models.Variante.id.in_(ids))
            .all()
        )
        for v in variantes:
            cat = v.producto.categoria if v.producto else None
            categoria_de[v.id] = cat.nombre if cat else "Sin categoría"

    grupos: Dict[str, Dict[str, float]] = {}
    pedidos_por_grupo: Dict[str, set] = {}
    for p in pedidos:
        for i in p.items:
            nombre = "Venta libre" if i.variante_id is None else categoria_de.get(i.variante_id, "Sin categoría")
            g = grupos.setdefault(nombre, {"ventas": 0.0})
            g["ventas"] += i.precio_unitario * i.cantidad
            pedidos_por_grupo.setdefault(nombre, set()).add(p.id)

    salida = [
        schemas.GrupoReporte(
            nombre=nombre,
            ventas=round(g["ventas"], 2),
            pedidos=len(pedidos_por_grupo[nombre]),
            pct=round(g["ventas"] / ventas_total * 100, 1) if ventas_total else 0.0,
        )
        for nombre, g in grupos.items()
    ]
    salida.sort(key=lambda g: g.ventas, reverse=True)
    return salida


def _por_dia_semana(pedidos, inicio, fin, ventas_total: float) -> List[schemas.GrupoReporte]:
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
    for p in pedidos:
        t = p.cerrado_en
        if t is None:
            continue
        total[t.weekday()] += p.total
        cuantos[t.weekday()] += 1

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
    pedidos,
    productos: List[schemas.ProductoVendido],
    serie: List[schemas.PuntoSerie],
    granularidad_serie: str,
    ventas_previas: float,
    merma: float = 0,
    incompleto: bool = True,
) -> List[schemas.Insight]:
    """Analisis deterministico: sin llamadas a ningun modelo, sin costo variable."""
    insights: List[schemas.Insight] = []
    nombre_periodo = {"dia": "hoy", "semana": "esta semana", "mes": "este mes"}.get(
        periodo, "en este periodo"
    )

    if not pedidos:
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
        return insights + _avisos_de_costos(db)

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
                    titulo=f"Los insumos se llevan {food_cost:.0f}% de la venta",
                    detalle=f"Arriba de 35% el margen se aprieta{sobre}. Revisa precios de venta o el costo de tus insumos.",
                )
            )
        else:
            insights.append(
                schemas.Insight(
                    tipo="bueno",
                    titulo=f"Costo de insumos en {food_cost:.0f}%",
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
    if len(pedidos) > 3 and ventas > 0:
        mayor = max(pedidos, key=lambda p: p.total)
        peso = mayor.total / ventas * 100
        if peso >= 30:
            mediana = _mediana([p.total for p in pedidos])
            insights.append(
                schemas.Insight(
                    tipo="info",
                    titulo=f"Un solo pedido fue el {peso:.0f}% de la venta",
                    detalle=(
                        f"El pedido #{mayor.numero} de ${mayor.total:.2f} mueve todos los "
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
        if i.stock_actual <= i.stock_minimo
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
def resumen(rango: Rango = Depends(), db: Session = Depends(get_db)):
    """Los numeros del periodo. `desde`/`hasta` o, como antes, `periodo=`."""
    inicio, fin, etiqueta = rango.resolver(periodo="dia")
    # Las palabras ("hoy", "ayer") solo cuando se pidio con el boton; con un
    # rango de fechas se habla de "este periodo".
    periodo = rango.periodo if rango.periodo in ("dia", "semana", "mes") and rango.desde is None else "rango"
    pedidos = _pedidos_pagados(db, inicio, fin)

    # Las ventas brutas (lo que entro por caja) salen de los pedidos, porque es
    # el numero que el dueno reconoce. Pero la GANANCIA sale de la contabilidad:
    # el IVA cobrado no es ingreso suyo, y las mermas si son perdida aunque no
    # sean un "gasto" de la tabla de gastos. Antes Reportes calculaba los dos
    # por su cuenta y daba 8% mas de ganancia que el Estado de Resultados.
    ventas, _costo_pedidos = _totales(pedidos)
    iva_cobrado = _iva_cobrado(pedidos)
    libro = contabilidad.saldos_por_tipo(db, inicio, fin)
    ingresos_netos = libro["ingreso"]
    costo = libro["costo"]
    gastos = libro["gasto"]
    ganancia_bruta = round(ingresos_netos - costo, 2)

    # Mismo tamano de ventana, inmediatamente anterior.
    pedidos_previos = _pedidos_pagados(db, *anterior(inicio, fin))
    ventas_previas, _ = _totales(pedidos_previos)
    libro_previo = contabilidad.saldos_por_tipo(db, *anterior(inicio, fin))

    anulados = len(_pedidos_anulados(db, inicio, fin))
    devoluciones = _devoluciones(db, inicio, fin)
    facturados = [p for p in pedidos if p.facturado]

    por_metodo: Dict[str, float] = {}
    for p in pedidos:
        # Por pago y no por pedido: una venta mixta reparte su monto entre dos
        # metodos en vez de aparecer entera bajo una etiqueta combinada.
        for pago in p.pagos:
            por_metodo[pago.metodo] = round(por_metodo.get(pago.metodo, 0) + pago.monto, 2)

    serie = _serie(periodo, pedidos, inicio, fin)
    productos = _top_productos(pedidos, seed.variantes_de_servicio(db))
    paso = granularidad(inicio, fin)
    ganancia_neta = round(ganancia_bruta - gastos, 2)
    # Un dia solo se lee por horas; el mapa y el dia de la semana necesitan
    # varios dias para decir algo.
    varios_dias = (fin - inicio).days >= 2
    calor = _mapa_de_calor(pedidos) if varios_dias else []
    por_dia = _por_dia_semana(pedidos, inicio, fin, ventas) if varios_dias else []

    return schemas.ReporteResumen(
        periodo=periodo,
        etiqueta=etiqueta,
        granularidad=granularidad(inicio, fin),
        ventas=round(ventas, 2),
        ventas_bs=_ventas_en_bs(pedidos),
        iva_cobrado=iva_cobrado,
        ingresos_netos=ingresos_netos,
        pedidos=len(pedidos),
        ticket_promedio=round(ventas / len(pedidos), 2) if pedidos else 0.0,
        ticket_mediano=_mediana([p.total for p in pedidos]),
        costo_insumos=round(costo, 2),
        ganancia_bruta=ganancia_bruta,
        margen_pct=round(ganancia_bruta / ingresos_netos * 100, 1) if ingresos_netos else 0.0,
        gastos=round(gastos, 2),
        ganancia_neta=ganancia_neta,
        valor_anulado=_valor_anulado(db, inicio, fin),
        pedidos_anulados=anulados,
        devoluciones=len(devoluciones),
        valor_devuelto=round(sum(p.total for p in devoluciones), 2),
        facturadas=len(facturados),
        valor_facturado=round(sum(p.total for p in facturados), 2),
        por_metodo_pago=por_metodo,
        serie=serie,
        top_productos=productos[:10],
        insights=_insights(
            db,
            periodo,
            ventas,
            costo,
            gastos,
            pedidos,
            productos,
            serie,
            paso,
            ventas_previas,
            merma=merma_periodo(db, inicio, fin),
            # El periodo esta a medias si incluye hoy.
            incompleto=fin > datetime.datetime.now(),
        )
        + _lecturas_de_ritmo(calor, por_dia, len(pedidos)),
        anterior=_comparativa(
            _nombre_del_anterior(periodo, inicio, fin),
            pedidos_previos, ventas_previas, libro_previo, ventas, len(pedidos), ganancia_neta,
        ),
        serie_anterior=_serie_anterior(serie, pedidos_previos, inicio, fin, paso),
        calor=calor,
        por_categoria=_por_categoria(db, pedidos, ventas),
        por_dia_semana=por_dia,
    )


@router.get("/combos", response_model=schemas.ReporteCombos)
def reporte_combos(rango: Rango = Depends(), db: Session = Depends(get_db)):
    """Que se vende junto y cuanto se pierde por no ofrecer el acompanante.

    El periodo por defecto es el mes: la canasta necesita volumen para que los
    porcentajes signifiquen algo, y un solo dia rara vez lo tiene.
    """
    inicio, fin, etiqueta = rango.resolver(periodo="mes")
    pedidos = _pedidos_pagados(db, inicio, fin)
    analisis = combos.analizar(db, pedidos)

    return schemas.ReporteCombos(periodo=rango.periodo or "rango", etiqueta=etiqueta, **analisis)
