"""Costo de REPOSICION: lo que cuesta volver a comprar, no lo que costo.

Son dos preguntas distintas y el ERP solo sabia contestar una:

  - "cuanto me costo lo que vendi?"  -> promedio ponderado (costeo.py).
    Es el metodo contable correcto y es el que se congela por venta, para que
    el margen de agosto siga siendo el de agosto.

  - "a cuanto tengo que vender para poder reponer?" -> ultimo costo pagado.
    Es la pregunta comercial, y en un pais con inflacion es LA pregunta.

Contestar la segunda con el promedio ponderado es como se descapitaliza un
negocio sin darse cuenta: con 14 kg comprados a $7 y 2 kg a $28, el promedio
da $9.75 y el menu muestra 67% de margen, cuando reponer cuesta $28 y el
margen real es 12%. La caja cuadra, el reporte dice que ganaste, y a la hora
de comprar no alcanza para la misma cantidad.

El dato ya estaba: cada linea de factura y cada compra suelta guardan su
costo unitario con fecha. Nadie lo leia.
"""

import datetime
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from . import impuestos, models

# Por debajo de esto una subida es ruido de proveedor, no un cambio de precio.
SALTO_QUE_IMPORTA_PCT = 15.0

# Margen que se considera "ya no vale la pena venderlo".
MARGEN_FLACO_PCT = 20.0

# Un salto de este tamano en el costo unitario casi nunca es inflacion: es un
# error de unidad. Comprar un saco de 50 kg y teclear "cantidad 1" deja el
# costo 50x inflado y el stock 50x corto, y el menu pasa a decir que vendes a
# perdida un producto que te deja 96%.
SALTO_SOSPECHOSO_PCT = 200.0


def salto_sospechoso(costo_nuevo: float, costo_anterior: float) -> Optional[dict]:
    """Detecta un costo que parece error de unidad, no cambio de precio.

    Devuelve el factor y una sugerencia en criollo, o None si el salto entra
    dentro de lo que la inflacion puede explicar.
    """
    if not costo_anterior or not costo_nuevo or costo_nuevo <= costo_anterior:
        return None
    factor = costo_nuevo / costo_anterior
    if (factor - 1) * 100 < SALTO_SOSPECHOSO_PCT:
        return None
    return {
        "factor": round(factor, 1),
        "mensaje": (
            "Ese precio es {:.0f} veces el anterior. Si compraste por saco, bulto o "
            "caja, la cantidad va en la unidad de la mercancía: un saco de 50 kg son "
            "50, no 1."
        ).format(factor),
    }


# Una compra que cuesta menos de la quinta parte de lo de siempre casi nunca
# es una oferta: es el monto en bolivares, la coma corrida o el total puesto
# como precio por unidad (26-oct: 10 kg de pernil por $0,08, a $8 el kilo).
BAJA_SOSPECHOSA = 0.2
SUBIDA_ABSURDA = 10


def precio_absurdo(costo_nuevo: float, referencia: float) -> Optional[str]:
    """Un precio que no tiene sentido contra lo de siempre, hacia ARRIBA (la
    unidad equivocada) o hacia ABAJO (bolivares, la coma). Devuelve el aviso
    en criollo, o None si es un precio posible."""
    if not referencia or not costo_nuevo or referencia <= 0:
        return None
    if costo_nuevo < referencia * BAJA_SOSPECHOSA:
        return (f"Ese precio es {referencia / costo_nuevo:,.0f} veces MENOR que lo de siempre "
                f"(${costo_nuevo:,.4f} contra ${referencia:,.2f}). ¿Pusiste el monto en bolívares o "
                "con la coma corrida? El costo va en dólares y por el total de lo que llegó.")
    # Hacia arriba solo frena lo que no puede ser inflacion: diez veces o mas.
    # Un 3x o un 5x avisa despues de guardar (salto_sospechoso), como siempre.
    if costo_nuevo >= referencia * SUBIDA_ABSURDA:
        sospecha = salto_sospechoso(costo_nuevo, referencia)
        return sospecha["mensaje"] if sospecha else None
    return None


def historial_de_costos(db: Session, ingrediente_id: int, limite: int = 24) -> List[dict]:
    """Cada compra de ese insumo, de la mas nueva a la mas vieja.

    Mezcla las dos vias de entrada: factura de proveedor y compra suelta (el
    mandado del dia). Para la curva de inflacion del insumo las dos cuentan.
    """
    compras: List[dict] = []

    filas = (
        db.query(models.FacturaCompraItem, models.FacturaCompra)
        .join(models.FacturaCompra, models.FacturaCompra.id == models.FacturaCompraItem.factura_id)
        .filter(models.FacturaCompraItem.ingrediente_id == ingrediente_id)
        .all()
    )
    for item, factura in filas:
        compras.append(
            {
                "fecha": factura.fecha,
                "cantidad": item.cantidad,
                "costo_unitario": item.costo_unitario,
                "origen": "factura",
                "referencia": factura.numero_factura,
            }
        )

    for suelta in (
        db.query(models.CompraSuelta).filter_by(ingrediente_id=ingrediente_id)
        .filter(models.CompraSuelta.anulada.isnot(True)).all()
    ):
        compras.append(
            {
                "fecha": suelta.fecha,
                "cantidad": suelta.cantidad,
                "costo_unitario": suelta.costo_unitario,
                "origen": "compra suelta",
                "referencia": "",
                "compra_id": suelta.id,
            }
        )

    compras.sort(key=lambda c: c["fecha"], reverse=True)
    return compras[:limite]


def costos_reposicion(db: Session) -> Dict[int, dict]:
    """Ultimo costo pagado por cada insumo, en una sola pasada.

    Se arma de golpe (no insumo por insumo) porque el menu lo necesita para
    todos a la vez y consultarlo uno por uno era N+1 consultas por pantalla.
    """
    ultimo: Dict[int, dict] = {}

    def considerar(ingrediente_id, fecha, costo):
        if ingrediente_id is None or fecha is None:
            return
        actual = ultimo.get(ingrediente_id)
        if actual is None or fecha > actual["fecha"]:
            ultimo[ingrediente_id] = {"fecha": fecha, "costo": costo}

    filas = (
        db.query(models.FacturaCompraItem, models.FacturaCompra.fecha)
        .join(models.FacturaCompra, models.FacturaCompra.id == models.FacturaCompraItem.factura_id)
        .all()
    )
    for item, fecha in filas:
        considerar(item.ingrediente_id, fecha, item.costo_unitario)

    for suelta in db.query(models.CompraSuelta).filter(models.CompraSuelta.anulada.isnot(True)).all():
        considerar(suelta.ingrediente_id, suelta.fecha, suelta.costo_unitario)

    return ultimo


def costo_efectivo_de(costo: Optional[float], rendimiento_pct: Optional[float]) -> Optional[float]:
    """Costo por unidad UTILIZABLE. Misma correccion de rendimiento que usa el
    costeo contable: si de 1 kg solo sirven 800 g, el kg util cuesta mas."""
    if costo is None:
        return None
    rendimiento = (rendimiento_pct or 100) / 100
    if rendimiento <= 0:
        rendimiento = 1
    return round(costo / rendimiento, 4)


def costo_reposicion_efectivo(ingrediente, ultimos: Dict[int, dict], _visitados=frozenset()) -> float:
    """Lo que cuesta HOY 1 unidad utilizable de algo, a ultimo precio pagado.

    Para lo comprado, su ultimo precio corregido por rendimiento. Para una
    PREPARACION, su receta a ultimos precios: el guiso no se compra, asi que
    reponerlo cuesta lo que cuesta reponer su pollo y su cebolla.
    """
    # Un ultimo precio absurdo (bolivares, la coma) no se toma: se usa el
    # promedio de la ficha hasta que llegue una compra con precio de verdad
    # (26-oct, el pernil a $0,0085 el kilo dejaba la receta en cero).
    ultimo = ultimos.get(getattr(ingrediente, "id", None))
    if (ultimo and getattr(ingrediente, "tipo", "") != "preparacion"
            and precio_absurdo(ultimo.get("costo") or 0, getattr(ingrediente, "costo_unitario", 0) or 0)):
        return costo_efectivo_de(ingrediente.costo_unitario, ingrediente.rendimiento_pct) or 0.0
    if ingrediente.tipo == "preparacion":
        if ingrediente.id in _visitados or not ingrediente.rinde_real:
            return 0.0
        dentro = _visitados | {ingrediente.id}
        total = sum(
            linea.cantidad * _bruto_reposicion(linea.ingrediente, ultimos, dentro)
            for linea in ingrediente.lineas_preparacion
        )
        return round(total / ingrediente.rinde_real, 6)
    ultimo = ultimos.get(ingrediente.id)
    if ultimo:
        return costo_efectivo_de(ultimo["costo"], ingrediente.rendimiento_pct) or 0.0
    return ingrediente.costo_efectivo or 0.0


def _bruto_reposicion(ingrediente, ultimos, visitados) -> float:
    """Dentro de una preparacion va la cantidad tal como sale del deposito:
    su costo sin corregir por rendimiento (la merma ya esta en lo que rinde)."""
    if ingrediente.tipo == "preparacion":
        return costo_reposicion_efectivo(ingrediente, ultimos, visitados)
    ultimo = ultimos.get(ingrediente.id)
    return ultimo["costo"] if ultimo else (ingrediente.costo_unitario or 0)


def variacion_pct(reposicion: Optional[float], promedio: Optional[float]) -> Optional[float]:
    """Cuanto subestima el promedio al costo de reponer."""
    if not reposicion or not promedio:
        return None
    return round((reposicion / promedio - 1) * 100, 1)


def impacto_en_productos(
    db: Session, ingrediente_id: int, costo_nuevo: float, costo_anterior: float
) -> List[dict]:
    """Que productos quedan flacos (o a perdida) si ese insumo pasa a costar eso.

    Es lo que hay que ponerle delante al dueno en el momento en que registra la
    compra cara, no un mes despues cuando el promedio por fin lo refleje.
    """
    ingrediente = db.query(models.Ingrediente).filter_by(id=ingrediente_id).first()
    if ingrediente is None:
        return []

    efectivo_nuevo = costo_efectivo_de(costo_nuevo, ingrediente.rendimiento_pct)
    efectivo_anterior = costo_efectivo_de(costo_anterior, ingrediente.rendimiento_pct)
    # "Reponer" es al precio de hoy de TODOS los insumos, no solo del que
    # acaba de subir. Usando el promedio para los demas, este aviso y el menu
    # daban precios sugeridos distintos por unos centavos para el mismo plato.
    ultimos = costos_reposicion(db)
    tasa_iva = impuestos.tasa_iva(db)

    afectados = []
    recetas = db.query(models.RecetaItem).filter_by(ingrediente_id=ingrediente_id).all()
    for receta in recetas:
        variante = db.query(models.Variante).filter_by(id=receta.variante_id).first()
        if variante is None or not variante.activo:
            continue

        # Tres costos del mismo producto, cada uno contestando algo distinto:
        #   antes    - con el precio que tenia el insumo antes de esta compra.
        #   despues  - con lo que se acaba de pagar (lo que costara reponer).
        #   contable - con el promedio ponderado de ahora mismo, que es el que
        #              el menu muestra. El precio sugerido se calcula sobre
        #              ESTE, no sobre "antes": si no, el aviso sugeria $5.12 y
        #              el menu $3.96 un minuto despues, para el mismo producto.
        costo_antes = 0.0
        costo_despues = 0.0
        costo_contable = 0.0
        ingredientes_de_la_receta = []
        for linea in db.query(models.RecetaItem).filter_by(variante_id=variante.id).all():
            ing = linea.ingrediente
            if ing is None:
                continue
            ingredientes_de_la_receta.append(ing)
            costo_contable += linea.cantidad_por_unidad * (ing.costo_efectivo or 0)
            if ing.id == ingrediente_id:
                costo_antes += linea.cantidad_por_unidad * (efectivo_anterior or 0)
                costo_despues += linea.cantidad_por_unidad * (efectivo_nuevo or 0)
            else:
                costo_antes += linea.cantidad_por_unidad * (ing.costo_efectivo or 0)
                ultimo = ultimos.get(ing.id)
                efectivo_hoy = (
                    costo_efectivo_de(ultimo["costo"], ing.rendimiento_pct)
                    if ultimo
                    else (ing.costo_efectivo or 0)
                )
                costo_despues += linea.cantidad_por_unidad * efectivo_hoy

        precio = variante.precio or 0
        # El margen se mide contra lo que queda del precio SIN el IVA, igual
        # que en /menu/costos: si no, el aviso de "a perdida" salia optimista.
        # Exento = toda la receta es mercancia exenta.
        exento = bool(ingredientes_de_la_receta) and all(bool(i.exento) for i in ingredientes_de_la_receta)
        neto = impuestos.precio_neto(precio, tasa_iva, exento)
        margen_antes = round((neto - costo_antes) / neto * 100, 1) if neto else None
        margen_despues = round((neto - costo_despues) / neto * 100, 1) if neto else None

        producto = db.query(models.Producto).filter_by(id=variante.producto_id).first()
        # Misma regla que el mostrador: con una sola subseccion activa, su
        # nombre no aporta nada ("Jugo natural", no "Jugo natural Regular").
        hermanas = sum(1 for v in producto.variantes if v.activo) if producto else 0
        nombre = producto.nombre if producto else ""
        if hermanas > 1:
            nombre = f"{nombre} - {variante.nombre}".strip(" -")
        afectados.append(
            {
                "variante_id": variante.id,
                "nombre": nombre,
                "precio": round(precio, 2),
                "costo_antes": round(costo_antes, 4),
                "costo_despues": round(costo_despues, 4),
                "margen_antes_pct": margen_antes,
                "margen_despues_pct": margen_despues,
                "a_perdida": margen_despues is not None and margen_despues < 0,
                "margen_flaco": (
                    margen_despues is not None and 0 <= margen_despues < MARGEN_FLACO_PCT
                ),
            }
        )

    afectados.sort(key=lambda a: a["margen_despues_pct"] if a["margen_despues_pct"] is not None else 0)
    return afectados


def compras_por_insumo(db: Session, desde=None) -> Dict[int, List[dict]]:
    """El historial de compras de TODOS los insumos, en dos consultas.

    Misma informacion que `historial_de_costos`, pero para todos a la vez.
    Existe porque la curva de inflacion la necesita insumo por insumo, y
    pedirla de a uno costaba dos consultas por insumo: con 120 insumos eran
    241 consultas para dibujar un solo numero.
    """
    por_insumo: Dict[int, List[dict]] = {}

    consulta = db.query(models.FacturaCompraItem, models.FacturaCompra).join(
        models.FacturaCompra, models.FacturaCompra.id == models.FacturaCompraItem.factura_id
    )
    if desde is not None:
        consulta = consulta.filter(models.FacturaCompra.fecha >= desde)
    for item, factura in consulta.all():
        por_insumo.setdefault(item.ingrediente_id, []).append(
            {
                "fecha": factura.fecha,
                "cantidad": item.cantidad,
                "costo_unitario": item.costo_unitario,
                "origen": "factura",
                "referencia": factura.numero_factura,
            }
        )

    sueltas = db.query(models.CompraSuelta).filter(models.CompraSuelta.anulada.isnot(True))
    if desde is not None:
        sueltas = sueltas.filter(models.CompraSuelta.fecha >= desde)
    for suelta in sueltas.all():
        por_insumo.setdefault(suelta.ingrediente_id, []).append(
            {
                "fecha": suelta.fecha,
                "cantidad": suelta.cantidad,
                "costo_unitario": suelta.costo_unitario,
                "origen": "compra suelta",
                "referencia": "",
                "compra_id": suelta.id,
            }
        )

    for compras in por_insumo.values():
        compras.sort(key=lambda c: c["fecha"], reverse=True)
    return por_insumo


def inflacion_de_insumos(db: Session, dias: int = 30) -> Optional[dict]:
    """Cuanto subio la canasta de insumos en el periodo.

    Compara, insumo por insumo, el ultimo costo pagado contra el primero del
    periodo, y los pondera por lo que pesa cada insumo en el inventario. Es el
    numero que le dice al dueno si sus precios se estan quedando atras.
    """
    desde = datetime.datetime.now() - datetime.timedelta(days=dias)
    detalle = []
    peso_total = 0.0
    subida_ponderada = 0.0

    del_periodo = compras_por_insumo(db, desde=desde)
    for ingrediente in db.query(models.Ingrediente).all():
        compras = del_periodo.get(ingrediente.id, [])
        if len(compras) < 2:
            continue
        nuevo = compras[0]["costo_unitario"]
        viejo = compras[-1]["costo_unitario"]
        if not viejo:
            continue
        cambio = (nuevo / viejo - 1) * 100
        peso = max(ingrediente.stock_actual or 0, 0) * (ingrediente.costo_unitario or 0)
        detalle.append(
            {
                "ingrediente_id": ingrediente.id,
                "nombre": ingrediente.nombre,
                "costo_inicial": round(viejo, 4),
                "costo_actual": round(nuevo, 4),
                "cambio_pct": round(cambio, 1),
            }
        )
        peso_total += peso
        subida_ponderada += cambio * peso

    if not detalle:
        return None

    detalle.sort(key=lambda d: d["cambio_pct"], reverse=True)
    promedio = subida_ponderada / peso_total if peso_total else (
        sum(d["cambio_pct"] for d in detalle) / len(detalle)
    )
    return {
        "dias": dias,
        "cambio_pct": round(promedio, 1),
        "insumos": detalle,
    }
