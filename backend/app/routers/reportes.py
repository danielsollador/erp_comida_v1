import datetime
from typing import Dict, List, Tuple

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import combos, contabilidad, impuestos, models, schemas
from ..database import get_db
from ..timeutils import rango_periodo

router = APIRouter(prefix="/api/reportes", tags=["reportes"])

DIAS_ES = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"]


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


def _merma_periodo(db: Session, inicio: datetime.datetime, fin: datetime.datetime) -> float:
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
    acumulado: Dict[str, Dict[str, float]] = {}

    if periodo == "dia":
        for p in pedidos:
            clave = f"{p.cerrado_en.hour:02d}:00"
            entrada = acumulado.setdefault(clave, {"ventas": 0.0, "pedidos": 0})
            entrada["ventas"] += p.total
            entrada["pedidos"] += 1
        etiquetas = sorted(acumulado.keys())
    else:
        dia = inicio.date()
        ultimo = (fin - datetime.timedelta(days=1)).date()
        etiquetas = []
        while dia <= ultimo:
            clave = (
                DIAS_ES[dia.weekday()] if periodo == "semana" else dia.strftime("%d")
            )
            acumulado[clave] = {"ventas": 0.0, "pedidos": 0}
            etiquetas.append(clave)
            dia += datetime.timedelta(days=1)
        for p in pedidos:
            fecha = p.cerrado_en.date()
            clave = (
                DIAS_ES[fecha.weekday()] if periodo == "semana" else fecha.strftime("%d")
            )
            if clave in acumulado:
                acumulado[clave]["ventas"] += p.total
                acumulado[clave]["pedidos"] += 1

    return [
        schemas.PuntoSerie(
            etiqueta=e,
            ventas=round(acumulado[e]["ventas"], 2),
            pedidos=int(acumulado[e]["pedidos"]),
        )
        for e in etiquetas
    ]


def _variantes_con_receta(db: Session) -> set:
    return {r.variante_id for r in db.query(models.RecetaItem.variante_id).distinct()}


def _top_productos(pedidos, con_receta: set) -> List[schemas.ProductoVendido]:
    agregado: Dict[str, Dict[str, float]] = {}
    for p in pedidos:
        for i in p.items:
            entrada = agregado.setdefault(
                i.nombre, {"unidades": 0, "ingresos": 0.0, "costo": 0.0, "sin_receta": False}
            )
            entrada["unidades"] += i.cantidad
            entrada["ingresos"] += i.precio_unitario * i.cantidad
            entrada["costo"] += (i.costo_unitario or 0) * i.cantidad
            # Sin receta no hay costo que calcular, y el margen que saldria
            # (100%) es ficticio. Hay que poder distinguirlo de un margen bueno.
            if i.variante_id not in con_receta:
                entrada["sin_receta"] = True

    productos = []
    for nombre, datos in agregado.items():
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


def _insights(
    db: Session,
    periodo: str,
    ventas: float,
    costo: float,
    gastos: float,
    pedidos,
    productos: List[schemas.ProductoVendido],
    serie: List[schemas.PuntoSerie],
    ventas_previas: float,
    merma: float = 0,
) -> List[schemas.Insight]:
    """Analisis deterministico: sin llamadas a ningun modelo, sin costo variable."""
    insights: List[schemas.Insight] = []
    nombre_periodo = {"dia": "hoy", "semana": "esta semana", "mes": "este mes"}[periodo]

    if not pedidos:
        insights.append(
            schemas.Insight(
                tipo="info",
                titulo="Sin ventas registradas",
                detalle=f"No hay pedidos cobrados {nombre_periodo}. Cobra un pedido para empezar a ver numeros.",
            )
        )
        return insights

    # Comparativa contra el periodo anterior. El periodo en curso siempre esta
    # incompleto, asi que se avisa para no leer una caida donde solo falta tiempo.
    if ventas_previas > 0:
        cambio = (ventas - ventas_previas) / ventas_previas * 100
        anterior = {"dia": "ayer", "semana": "la semana pasada", "mes": "el mes pasado"}[periodo]
        aclaracion = f" Ojo: {nombre_periodo} todavia no termina."
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

    # Mejor momento de venta.
    if serie:
        mejor = max(serie, key=lambda s: s.ventas)
        if mejor.ventas > 0:
            etiqueta = "hora" if periodo == "dia" else "dia"
            insights.append(
                schemas.Insight(
                    tipo="info",
                    titulo=f"Mejor {etiqueta}: {mejor.etiqueta}",
                    detalle=f"${mejor.ventas:.2f} en {mejor.pedidos} pedidos. Asegura tener personal e inventario en ese momento.",
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
def resumen(periodo: str = "dia", db: Session = Depends(get_db)):
    if periodo not in ("dia", "semana", "mes"):
        periodo = "dia"

    inicio, fin, etiqueta = rango_periodo(periodo)
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
    duracion = fin - inicio
    pedidos_previos = _pedidos_pagados(db, inicio - duracion, inicio)
    ventas_previas, _ = _totales(pedidos_previos)

    anulados = len(_pedidos_anulados(db, inicio, fin))
    devoluciones = _devoluciones(db, inicio, fin)

    por_metodo: Dict[str, float] = {}
    for p in pedidos:
        metodo = p.metodo_pago or "Sin especificar"
        por_metodo[metodo] = round(por_metodo.get(metodo, 0) + p.total, 2)

    serie = _serie(periodo, pedidos, inicio, fin)
    productos = _top_productos(pedidos, _variantes_con_receta(db))

    return schemas.ReporteResumen(
        periodo=periodo,
        etiqueta=etiqueta,
        ventas=round(ventas, 2),
        ventas_bs=_ventas_en_bs(pedidos),
        iva_cobrado=iva_cobrado,
        ingresos_netos=ingresos_netos,
        pedidos=len(pedidos),
        ticket_promedio=round(ventas / len(pedidos), 2) if pedidos else 0.0,
        costo_insumos=round(costo, 2),
        ganancia_bruta=ganancia_bruta,
        margen_pct=round(ganancia_bruta / ingresos_netos * 100, 1) if ingresos_netos else 0.0,
        gastos=round(gastos, 2),
        ganancia_neta=round(ganancia_bruta - gastos, 2),
        valor_anulado=_valor_anulado(db, inicio, fin),
        pedidos_anulados=anulados,
        devoluciones=len(devoluciones),
        valor_devuelto=round(sum(p.total for p in devoluciones), 2),
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
            ventas_previas,
            merma=_merma_periodo(db, inicio, fin),
        ),
    )


@router.get("/combos", response_model=schemas.ReporteCombos)
def reporte_combos(periodo: str = "mes", db: Session = Depends(get_db)):
    """Que se vende junto y cuanto se pierde por no ofrecer el acompanante.

    El periodo por defecto es el mes: la canasta necesita volumen para que los
    porcentajes signifiquen algo, y un solo dia rara vez lo tiene.
    """
    if periodo not in ("dia", "semana", "mes"):
        periodo = "mes"

    inicio, fin, etiqueta = rango_periodo(periodo)
    pedidos = _pedidos_pagados(db, inicio, fin)
    analisis = combos.analizar(db, pedidos)

    return schemas.ReporteCombos(periodo=periodo, etiqueta=etiqueta, **analisis)
