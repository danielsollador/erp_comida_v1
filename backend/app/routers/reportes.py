import datetime
from typing import Dict, List, Tuple

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..timeutils import rango_periodo

router = APIRouter(prefix="/api/reportes", tags=["reportes"])

DIAS_ES = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"]


def _pedidos_pagados(db: Session, inicio: datetime.datetime, fin: datetime.datetime):
    return (
        db.query(models.Pedido)
        .filter(
            models.Pedido.estado == "pagado",
            models.Pedido.cerrado_en >= inicio,
            models.Pedido.cerrado_en < fin,
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


def _gastos_periodo(db: Session, inicio: datetime.datetime, fin: datetime.datetime) -> float:
    gastos = (
        db.query(models.Gasto)
        .filter(models.Gasto.fecha >= inicio, models.Gasto.fecha < fin)
        .all()
    )
    return sum(g.monto for g in gastos)


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


def _top_productos(pedidos) -> List[schemas.ProductoVendido]:
    agregado: Dict[str, Dict[str, float]] = {}
    for p in pedidos:
        for i in p.items:
            entrada = agregado.setdefault(
                i.nombre, {"unidades": 0, "ingresos": 0.0, "costo": 0.0}
            )
            entrada["unidades"] += i.cantidad
            entrada["ingresos"] += i.precio_unitario * i.cantidad
            entrada["costo"] += (i.costo_unitario or 0) * i.cantidad

    productos = []
    for nombre, datos in agregado.items():
        ingresos = round(datos["ingresos"], 2)
        costo = round(datos["costo"], 2)
        ganancia = round(ingresos - costo, 2)
        productos.append(
            schemas.ProductoVendido(
                nombre=nombre,
                unidades=int(datos["unidades"]),
                ingresos=ingresos,
                costo=costo,
                ganancia=ganancia,
                margen_pct=round(ganancia / ingresos * 100, 1) if ingresos else 0.0,
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

    # Food cost: en comida rapida sobre 35% del precio de venta aprieta el margen.
    if costo > 0 and ventas > 0:
        food_cost = costo / ventas * 100
        if food_cost > 35:
            insights.append(
                schemas.Insight(
                    tipo="alerta",
                    titulo=f"Los insumos se llevan {food_cost:.0f}% de la venta",
                    detalle="Arriba de 35% el margen se aprieta. Revisa precios de venta o el costo de tus insumos.",
                )
            )
        else:
            insights.append(
                schemas.Insight(
                    tipo="bueno",
                    titulo=f"Costo de insumos en {food_cost:.0f}%",
                    detalle="Esta en rango sano para comida rapida (referencia: menos de 35%).",
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
        con_costo = [p for p in productos if p.costo > 0]
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

    return insights


@router.get("/resumen", response_model=schemas.ReporteResumen)
def resumen(periodo: str = "dia", db: Session = Depends(get_db)):
    if periodo not in ("dia", "semana", "mes"):
        periodo = "dia"

    inicio, fin, etiqueta = rango_periodo(periodo)
    pedidos = _pedidos_pagados(db, inicio, fin)

    ventas, costo = _totales(pedidos)
    gastos = _gastos_periodo(db, inicio, fin)
    ganancia_bruta = ventas - costo

    # Mismo tamano de ventana, inmediatamente anterior.
    duracion = fin - inicio
    pedidos_previos = _pedidos_pagados(db, inicio - duracion, inicio)
    ventas_previas, _ = _totales(pedidos_previos)

    anulados = (
        db.query(models.Pedido)
        .filter(
            models.Pedido.estado == "anulado",
            models.Pedido.creado_en >= inicio,
            models.Pedido.creado_en < fin,
        )
        .count()
    )

    por_metodo: Dict[str, float] = {}
    for p in pedidos:
        metodo = p.metodo_pago or "Sin especificar"
        por_metodo[metodo] = round(por_metodo.get(metodo, 0) + p.total, 2)

    serie = _serie(periodo, pedidos, inicio, fin)
    productos = _top_productos(pedidos)

    return schemas.ReporteResumen(
        periodo=periodo,
        etiqueta=etiqueta,
        ventas=round(ventas, 2),
        pedidos=len(pedidos),
        ticket_promedio=round(ventas / len(pedidos), 2) if pedidos else 0.0,
        costo_insumos=round(costo, 2),
        ganancia_bruta=round(ganancia_bruta, 2),
        margen_pct=round(ganancia_bruta / ventas * 100, 1) if ventas else 0.0,
        gastos=round(gastos, 2),
        ganancia_neta=round(ganancia_bruta - gastos, 2),
        pedidos_anulados=anulados,
        por_metodo_pago=por_metodo,
        serie=serie,
        top_productos=productos[:10],
        insights=_insights(
            db, periodo, ventas, costo, gastos, pedidos, productos, serie, ventas_previas
        ),
    )
