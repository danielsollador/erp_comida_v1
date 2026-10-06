"""Reportes a medida: el usuario elige que ver, como agruparlo y que filtrar.

POR QUE EXISTE. Cada pregunta nueva del cliente ("¿cuanto vendio cada cajera
los sabados?", "¿que proveedor me vendio mas harina este mes?") terminaba en
una pantalla o un endpoint nuevo. No escala. Esto es la tabla dinamica de
Excel, o el reporte ALV de SAP: una fuente, unos campos para agrupar y
filtrar, unas medidas, y el resultado se arma solo.

UN CATALOGO, NO LAS TABLAS. El usuario no elige tablas ni columnas: elige de
una lista curada de FUENTES, cada una con CAMPOS (por que agrupar o filtrar) y
MEDIDAS (que sumar), todos con el nombre que usa el negocio. Las razones:

  * Cada numero tiene reglas. "Venta" excluye las devoluciones, el IVA sale
    con la alicuota de cada pedido, la cortesia no es venta. Esas reglas viven
    en `consolidacion.bloque_en_vivo`, y las filas de cada fuente las aplican
    IGUAL: el reporte a medida tiene que dar el mismo numero que Reportes y
    Ventas, o el cliente deja de creerle a los dos.
  * `TRX111_VEN_PEDIDO_DET` no le dice nada a nadie; "Productos vendidos", si.
  * Costo y margen no los ve cualquiera (`Medida.sensible`).

COMO FUNCIONA. Cada fuente sabe producir sus FILAS atomicas para un tramo de
fechas: una por pedido, por renglon vendido, por cobro, por renglon de
compra, por merma. Cada fila trae los valores de sus campos y lo que aporta a
cada medida. `consultar` filtra, agrupa en el SERVIDOR (la tablet de 3 GB
recibe solo el resultado, nunca el detalle crudo) y calcula las medidas
derivadas (ticket promedio, margen) despues de sumar, que es la unica forma
de que un promedio de promedios no mienta.

EL MART. Los dias ya consolidados (`consolidacion.py`, de Leider) traen hechas
las sumas por dia y por UN detalle (cajera, caja, hora, metodo, producto,
categoria). Cuando la consulta cabe en eso --agrupa por fechas y a lo sumo
uno de esos detalles, y pide medidas que el mart guarda-- los dias pasados se
leen del mart y solo lo que falta (hoy, un dia invalidado) se calcula en
vivo. Como el mart es literalmente lo que `bloque_en_vivo` calculo, el numero
es el mismo venga de donde venga; `test_reporte_dinamico.py` lo comprueba.
Lo que no cabe (producto x cajera) se calcula en vivo con tope de fechas.

DEL MART, SOLO LO EXACTO. El mart guarda cada dia ya redondeado a centavos.
Para ventas, unidades, IVA y cobros da igual: son precios exactos. Para el
COSTO (fracciones de centavo, sale de la receta) y los Bs no: la suma de un
mes cambiaria de centavos segun saliera del mart o en vivo, y el mismo
producto mostraria otro margen al ponerle un filtro. Esos se calculan
siempre en vivo. Contra Reportes, que si lee el costo del mart, puede haber
centavos de diferencia en un mes; aqui se prefirio la cifra exacta.
"""
from __future__ import annotations

import datetime
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Set, Tuple

from sqlalchemy.orm import Session, joinedload, selectinload

from . import consolidacion, impuestos, models, seed
from .timeutils import MESES_ES, inicio_del_dia

Fila = Dict[str, Any]

# Lo que se calcula leyendo pedidos, compras o mermas. Mas que esto es un
# volcado: para mirar varios años se agrupa por mes, y eso sale del mart.
MAX_DIAS_EN_VIVO = 400
# Filas que se mandan a la PANTALLA. La tablet tiene 3 GB: quinientas filas
# ya no se leen y miles de celdas la ponen lenta. El Excel trae todas
# (`MAX_GRUPOS_EXPORTAR`): para revisar fila por fila esta el archivo.
MAX_GRUPOS = 500
MAX_GRUPOS_EXPORTAR = 50000
# Valores distintos del campo que va en columnas. 31 para que quepan los dias
# de un mes; mas ya no se lee en una tablet y casi siempre es haber elegido
# el campo equivocado.
MAX_COLUMNAS = 31

SIN_DATO = "(sin dato)"
DIAS_SEMANA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]


class ErrorDeConsulta(ValueError):
    """La consulta no se puede responder tal como vino; el mensaje dice por que."""


# ─────────────────────────────────────────────────────────────────────────────
# El catalogo
# ─────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Campo:
    id: str
    nombre: str
    # fecha | semana | mes | anio | dia_semana | hora | texto. Le dice a la
    # pantalla como mostrarlo y como ordenarlo.
    tipo: str = "texto"
    ayuda: str = ""
    # Los campos de fecha salen todos de `_fecha`; los demas, de la fila.
    de_fecha: bool = False
    # Cuando | Que | Quien | Como: como se agrupan en el menu de la pantalla.
    grupo: str = ""


@dataclass(frozen=True)
class Medida:
    id: str
    nombre: str
    formato: str  # dinero | bs | entero | numero | pct
    # Como se agrega: `suma` suma la clave de la fila; `distintos` cuenta
    # valores distintos de esa clave (pedidos distintos entre sus renglones).
    suma: Optional[str] = None
    distintos: Optional[str] = None
    # Una medida derivada se calcula DESPUES de sumar, a partir de otras.
    derivada: Optional[Callable[[Dict[str, float]], Optional[float]]] = None
    depende: Tuple[str, ...] = ()
    # Costo y margen: solo quien administra el local.
    sensible: bool = False
    ayuda: str = ""
    # Una suma de trabajo (el total de minutos detras del promedio): se
    # calcula, pero no se ofrece en la pantalla.
    oculta: bool = False


@dataclass
class DetalleMart:
    """Como se lee un campo desde `DM_FACT120_VEN_DIA_DET`."""

    tipo: str
    # medida base -> atributo de la fila del mart (ventas | pedidos | unidades | costo)
    medidas: Dict[str, str]
    # clave del mart -> valor del campo. Por defecto, la clave tal cual.
    valor: Callable[[str, str], Any] = lambda clave, nombre: clave


@dataclass
class Fuente:
    id: str
    nombre: str
    descripcion: str
    campos: List[Campo]
    medidas: List[Medida]
    # (db, inicio, fin) -> filas atomicas del tramo
    filas: Callable[[Session, datetime.datetime, datetime.datetime], Iterable[Fila]]
    # Que campos se pueden leer del mart. Vacio: siempre en vivo.
    mart: Dict[str, DetalleMart] = field(default_factory=dict)
    # Como se muestra un valor de un campo (clave interna -> texto). Lo que no
    # este aqui se muestra tal cual.
    etiquetas: Optional[Callable[[Session, str, List[Any]], Dict[Any, str]]] = None
    # El modulo del ERP del que salen los datos (`acceso.permisos.MODULOS`):
    # la fuente solo la ve quien entra a ese modulo. Una cajera sin
    # Contabilidad no la ve aparecer aqui por la puerta de atras.
    modulo: str = ""

    def campo(self, id_: str) -> Campo:
        for c in self.campos:
            if c.id == id_:
                return c
        raise ErrorDeConsulta(f"«{self.nombre}» no tiene el campo «{id_}».")

    def medida(self, id_: str) -> Medida:
        for m in self.medidas:
            if m.id == id_:
                return m
        raise ErrorDeConsulta(f"«{self.nombre}» no tiene la medida «{id_}».")


# ── Los conceptos: UNA lista para todos los modulos ─────────────────────────
#
# El cliente (6-oct): "en agrupar deberia tener una lista amplia de conceptos
# que tengan relacion con mis areas, generales, que calcen con casi todos los
# modulos... todo se ve demasiado tecnico". Por eso cada fuente no inventa sus
# nombres: elige de este vocabulario. "Persona" es la cajera en Ventas y quien
# registro la merma en Inventario; "Producto" es lo del menu en Ventas y el
# insumo en Compras. El dueño aprende una sola lista y le sirve en todas
# partes. Lo que un modulo no tiene, sencillamente no aparece.
#
#   id: (nombre, grupo, tipo)
CONCEPTOS: Dict[str, Tuple[str, str, str]] = {
    "dia": ("Día", "Cuándo", "fecha"),
    "semana": ("Semana", "Cuándo", "semana"),
    "mes": ("Mes", "Cuándo", "mes"),
    "anio": ("Año", "Cuándo", "anio"),
    "dia_semana": ("Día de la semana", "Cuándo", "dia_semana"),
    "hora": ("Hora", "Cuándo", "hora"),
    "producto": ("Producto", "Qué", "texto"),
    "categoria": ("Categoría", "Qué", "texto"),
    "tipo": ("Tipo", "Qué", "texto"),
    "motivo": ("Motivo", "Qué", "texto"),
    "cuenta": ("Cuenta", "Qué", "texto"),
    "persona": ("Persona", "Quién", "texto"),
    "cliente": ("Cliente", "Quién", "texto"),
    "proveedor": ("Proveedor", "Quién", "texto"),
    "caja": ("Caja", "Cómo", "texto"),
    "forma_pago": ("Forma de pago", "Cómo", "texto"),
    "estado": ("Estado", "Cómo", "texto"),
    "documento": ("Documento", "Cómo", "texto"),
    "factura": ("Factura", "Cómo", "texto"),
    "delivery": ("Delivery", "Cómo", "texto"),
    "descuento": ("Descuento", "Cómo", "texto"),
    "preparacion": ("Cocina o vitrina", "Cómo", "texto"),
}
IDS_FECHA = {"dia", "semana", "mes", "anio", "dia_semana"}


def C(id_: str, ayuda: str = "") -> Campo:
    """Un campo de una fuente: el concepto comun, con la aclaracion de que es
    en ESE modulo ("la cajera que cobro")."""
    nombre, grupo, tipo = CONCEPTOS[id_]
    return Campo(id_, nombre, tipo, ayuda, de_fecha=id_ in IDS_FECHA, grupo=grupo)


# Los campos de fecha son los mismos en todas las fuentes y salen de `_fecha`.
CAMPOS_FECHA = [C("dia"), C("semana", "De lunes a domingo."), C("mes"), C("anio"), C("dia_semana")]


def _valor_de_fecha(campo: str, cuando: datetime.datetime) -> Any:
    d = cuando.date()
    if campo == "dia":
        return d.isoformat()
    if campo == "semana":
        return (d - datetime.timedelta(days=d.weekday())).isoformat()
    if campo == "mes":
        return f"{d.year:04d}-{d.month:02d}"
    if campo == "anio":
        return str(d.year)
    if campo == "dia_semana":
        return d.weekday()
    raise KeyError(campo)


def etiqueta_de(campo: Campo, valor: Any) -> str:
    """El texto de un valor de fecha u hora. Los demas los pone la fuente."""
    if valor is None or valor == "":
        return SIN_DATO
    if campo.tipo == "fecha":
        d = datetime.date.fromisoformat(valor)
        return f"{DIAS_SEMANA[d.weekday()][:3]} {d.day:02d}/{d.month:02d}/{d.year}"
    if campo.tipo == "semana":
        d = datetime.date.fromisoformat(valor)
        return f"Semana del {d.day:02d}/{d.month:02d}/{d.year}"
    if campo.tipo == "mes":
        anio, mes = valor.split("-")
        return f"{MESES_ES[int(mes) - 1].capitalize()} {anio}"
    if campo.tipo == "dia_semana":
        return DIAS_SEMANA[int(valor)]
    if campo.tipo == "hora":
        return f"{int(valor):02d}:00"
    return str(valor)


# ── Medidas derivadas ────────────────────────────────────────────────────────


def _division(a: str, b: str, por: float = 1.0):
    def calcular(v: Dict[str, float]) -> Optional[float]:
        if not v.get(b):
            return None
        return v.get(a, 0.0) / v[b] * por
    return calcular


def _margen(v: Dict[str, float]) -> Optional[float]:
    return v.get("ventas", 0.0) - v.get("costo", 0.0)


def _margen_pct(v: Dict[str, float]) -> Optional[float]:
    if not v.get("ventas"):
        return None
    return (v["ventas"] - v.get("costo", 0.0)) / v["ventas"] * 100


# ─────────────────────────────────────────────────────────────────────────────
# Las fuentes
# ─────────────────────────────────────────────────────────────────────────────


def _si_no(valor: bool, si: str, no: str) -> str:
    return si if valor else no


# ── Las ventas, leidas por columnas ──────────────────────────────────────────
#
# POR QUE NO `consolidacion.pedidos_pagados`. Esa funcion trae cada pedido
# como objeto del ORM con sus renglones, pagos, cajera y caja. Para el dia de
# hoy da igual; un reporte a medida de un año son decenas de miles de pedidos:
# medido, ~0,4 ms y varios KB por pedido, o sea 10 segundos y cientos de MB
# por consulta en un servidor que comparten varios locales. Aqui se leen solo
# las columnas que hacen falta, en tres consultas planas.
#
# Las REGLAS no se copian: el filtro es el mismo de `pedidos_pagados` (ver
# `_pagados_en`) y el total del pedido lo calculan las propiedades
# `Pedido.subtotal` y `Pedido.total` del modelo, llamadas sobre un objeto
# liviano. Los tests comparan contra el Resumen y contra el mart.


class _PedidoLigero:
    __slots__ = ("id", "cerrado_en", "tasa_bcv", "facturado", "tasa_iva", "descuento", "propina",
                 "cliente", "metodo_pago", "operador", "punto_venta", "items", "pagos", "subtotal")

    @property
    def total(self) -> float:
        return models.Pedido.total.fget(self)  # type: ignore[attr-defined]


class _Renglon:
    __slots__ = ("variante_id", "nombre", "precio_unitario", "costo_unitario", "cantidad", "cortesia", "a_cocina")


def _pagados_en(q, inicio, fin):
    """El mismo filtro que `consolidacion.pedidos_pagados`: cobrados, sin los
    devueltos (el cliente trajo la comida de vuelta: no hubo venta)."""
    return q.filter(
        models.Pedido.estado == "pagado",
        models.Pedido.devuelto.is_(False),
        models.Pedido.cerrado_en >= inicio,
        models.Pedido.cerrado_en < fin,
    )


def _pedidos_ligeros(db: Session, inicio, fin, con_pagos: bool = False) -> List[_PedidoLigero]:
    P = models.Pedido
    filas = _pagados_en(
        db.query(P.id, P.cerrado_en, P.tasa_bcv, P.facturado, P.tasa_iva, P.descuento, P.propina,
                 P.cliente, P.metodo_pago, models.Operador.nombre, models.PuntoVenta.nombre)
        .outerjoin(models.Operador, models.Operador.id == P.operador_id)
        .outerjoin(models.PuntoVenta, models.PuntoVenta.id == P.punto_venta_id),
        inicio, fin,
    ).all()
    pedidos: Dict[int, _PedidoLigero] = {}
    for (pid, cerrado, tasa_bcv, facturado, tasa_iva, descuento, propina, cliente, metodo,
         operador, punto) in filas:
        p = _PedidoLigero()
        p.id, p.cerrado_en, p.tasa_bcv, p.facturado, p.tasa_iva = pid, cerrado, tasa_bcv, facturado, tasa_iva
        p.descuento, p.propina, p.cliente, p.metodo_pago = descuento, propina, cliente, metodo
        # Igual que las propiedades `Pedido.operador` y `Pedido.punto_venta`.
        p.operador, p.punto_venta = operador or "", punto or ""
        p.items, p.pagos = [], []
        pedidos[pid] = p
    if not pedidos:
        return []
    I = models.PedidoItem
    for (pid, variante_id, nombre, precio, costo, cantidad, cortesia, a_cocina) in _pagados_en(
        db.query(I.pedido_id, I.variante_id, I.nombre, I.precio_unitario, I.costo_unitario,
                 I.cantidad, I.cortesia, I.a_cocina).join(P, P.id == I.pedido_id),
        inicio, fin,
    ):
        r = _Renglon()
        r.variante_id, r.nombre, r.precio_unitario, r.costo_unitario = variante_id, nombre, precio, costo
        r.cantidad, r.cortesia, r.a_cocina = cantidad, cortesia, a_cocina
        pedidos[pid].items.append(r)
    if con_pagos:
        G = models.PagoPedido
        for (pid, metodo, monto) in _pagados_en(
            db.query(G.pedido_id, G.metodo, G.monto).join(P, P.id == G.pedido_id), inicio, fin,
        ):
            pedidos[pid].pagos.append((metodo, monto))
    for p in pedidos.values():
        p.subtotal = models.Pedido.subtotal.fget(p)  # type: ignore[attr-defined]
    return list(pedidos.values())


def _forma_de_pago(pedido: _PedidoLigero) -> str:
    metodos = sorted({metodo for metodo, _monto in pedido.pagos})
    if not metodos:
        return pedido.metodo_pago or SIN_DATO
    return metodos[0] if len(metodos) == 1 else "Mixto"


def _filas_ventas(db: Session, inicio, fin) -> Iterable[Fila]:
    servicios = seed.variantes_de_servicio(db)
    for p in _pedidos_ligeros(db, inicio, fin, con_pagos=True):
        total = p.total
        iva = 0.0
        if p.facturado:
            _base, iva = impuestos.desglosar(total, p.tasa_iva or impuestos.IVA_DEFAULT)
        yield {
            "_fecha": p.cerrado_en,
            "hora": p.cerrado_en.hour,
            "persona": p.operador or "Sin asignar",
            "caja": p.punto_venta or "Sin asignar",
            "cliente": (p.cliente or "").strip() or SIN_DATO,
            "forma_pago": _forma_de_pago(p),
            "factura": _si_no(p.facturado, "Con factura", "Sin factura"),
            "delivery": _si_no(any(i.variante_id in servicios for i in p.items), "Con delivery", "Sin delivery"),
            "descuento": _si_no((p.descuento or 0) > 0, "Con descuento", "Sin descuento"),
            "n": 1,
            "ventas": total,
            "ventas_bs": total * (p.tasa_bcv or 0),
            "iva": iva,
            "descuentos": p.descuento or 0,
            "propinas": p.propina or 0,
        }


def _categoria_de_variantes(db: Session, ids) -> Dict[int, str]:
    return consolidacion._categoria_de_variantes(db, ids)


def _filas_productos(db: Session, inicio, fin) -> Iterable[Fila]:
    pedidos = _pedidos_ligeros(db, inicio, fin)
    categoria_de = _categoria_de_variantes(
        db, {i.variante_id for p in pedidos for i in p.items if i.variante_id is not None}
    )
    for p in pedidos:
        for i in p.items:
            # Igual que en `bloque_en_vivo`: la cortesia no es venta.
            if i.cortesia:
                continue
            yield {
                "_fecha": p.cerrado_en,
                "hora": p.cerrado_en.hour,
                "producto": f"v:{i.variante_id}" if i.variante_id is not None else f"l:{i.nombre}",
                "_nombre_producto": i.nombre,
                "categoria": (
                    "Venta libre" if i.variante_id is None
                    else categoria_de.get(i.variante_id, "Sin categoría")
                ),
                "persona": p.operador or "Sin asignar",
                "caja": p.punto_venta or "Sin asignar",
                "preparacion": _si_no(i.a_cocina is not False, "Cocina", "Vitrina"),
                "pedido_id": p.id,
                "unidades": i.cantidad,
                "ventas": i.precio_unitario * i.cantidad,
                "costo": (i.costo_unitario or 0) * i.cantidad,
            }


def _etiquetas_productos(db: Session, campo: str, valores: List[Any]) -> Dict[Any, str]:
    """Los productos se agrupan por variante y se muestran con el nombre de
    HOY: si se renombro, es el que el dueño reconoce."""
    if campo != "producto":
        return {}
    ids = [int(v[2:]) for v in valores if isinstance(v, str) and v.startswith("v:")]
    salida: Dict[Any, str] = {}
    if ids:
        for v in (
            db.query(models.Variante)
            .options(joinedload(models.Variante.producto))
            .filter(models.Variante.id.in_(ids))
        ):
            nombre = v.producto.nombre if v.producto else f"Variante {v.id}"
            if v.nombre and v.nombre.lower() != "regular":
                nombre = f"{nombre} - {v.nombre}"
            salida[f"v:{v.id}"] = nombre
    for v in valores:
        if isinstance(v, str) and v.startswith("l:"):
            salida[v] = f"{v[2:]} (venta libre)"
    return salida


def _filas_cobros(db: Session, inicio, fin) -> Iterable[Fila]:
    for p in _pedidos_ligeros(db, inicio, fin, con_pagos=True):
        for metodo, monto in p.pagos:
            yield {
                "_fecha": p.cerrado_en,
                "hora": p.cerrado_en.hour,
                "forma_pago": metodo,
                "persona": p.operador or "Sin asignar",
                "caja": p.punto_venta or "Sin asignar",
                "monto": monto,
                "n": 1,
            }


def _cajones(db: Session) -> Dict[int, str]:
    """El cajon del deposito de cada insumo (la categoria de Inventario)."""
    nombres = {c.id: c.nombre for c in db.query(models.CategoriaInsumo)}
    return {
        iid: nombres.get(cid, "Sin categoría")
        for iid, cid in db.query(models.Ingrediente.id, models.Ingrediente.categoria_id)
    }


def _insumo(ing) -> str:
    return f"{ing.nombre} ({ing.unidad})" if ing else SIN_DATO


def _filas_compras(db: Session, inicio, fin) -> Iterable[Fila]:
    cajon = _cajones(db)
    facturas = (
        db.query(models.FacturaCompra)
        .options(selectinload(models.FacturaCompra.items).joinedload(models.FacturaCompraItem.ingrediente))
        .filter(models.FacturaCompra.fecha >= inicio, models.FacturaCompra.fecha < fin)
        .all()
    )
    for f in facturas:
        comun = {
            "_fecha": f.fecha,
            "proveedor": f.proveedor_nombre or SIN_DATO,
            "tipo": f.categoria or SIN_DATO,
            "documento": "Factura",
            "forma_pago": f.forma_pago or SIN_DATO,
            "estado": _si_no(bool(f.pagada), "Pagada", "Por pagar"),
            "_doc": f"f:{f.id}",
        }
        if not f.items:
            yield {**comun, "producto": "(sin detalle de insumos)", "categoria": SIN_DATO,
                   "cantidad": 0.0, "monto": f.base_imponible or 0}
            continue
        # La base de la factura ya trae el flete y el descuento repartidos
        # (ver compras._crear_factura); repartirlos igual aqui hace que la
        # suma de los renglones sea la base del Libro de Compras.
        bruta = sum(i.cantidad * i.costo_unitario for i in f.items)
        factor = (f.base_imponible / bruta) if bruta else 1.0
        for i in f.items:
            yield {
                **comun,
                "producto": _insumo(i.ingrediente),
                "categoria": cajon.get(i.ingrediente_id, "Sin categoría"),
                "cantidad": i.cantidad,
                "monto": i.cantidad * i.costo_unitario * factor,
            }
    # Las notas de credito del proveedor RESTAN, en la fecha de la nota: una
    # devolucion de harina baja lo que se le compro a ese proveedor. Sin esto
    # "Compras por proveedor" quedaba inflado. No cuentan como factura.
    notas = (
        db.query(models.NotaCreditoCompra)
        .options(
            selectinload(models.NotaCreditoCompra.items).joinedload(models.NotaCreditoCompraItem.ingrediente),
            joinedload(models.NotaCreditoCompra.factura),
        )
        .filter(models.NotaCreditoCompra.fecha >= inicio, models.NotaCreditoCompra.fecha < fin)
        .all()
    )
    for n in notas:
        f = n.factura
        comun = {
            "_fecha": n.fecha,
            "proveedor": (f.proveedor_nombre if f else "") or SIN_DATO,
            "tipo": (f.categoria if f else "") or SIN_DATO,
            "documento": "Nota de crédito",
            "forma_pago": (f.forma_pago if f else "") or SIN_DATO,
            "estado": _si_no(bool(f and f.pagada), "Pagada", "Por pagar"),
            "_doc": None,
        }
        if not n.items:
            yield {**comun, "producto": "(descuento del proveedor)", "categoria": SIN_DATO,
                   "cantidad": 0.0, "monto": -(n.base_imponible or 0)}
            continue
        bruta = sum(i.cantidad * i.costo_unitario for i in n.items)
        factor = (n.base_imponible / bruta) if bruta else 1.0
        for i in n.items:
            yield {
                **comun,
                "producto": _insumo(i.ingrediente),
                "categoria": cajon.get(i.ingrediente_id, "Sin categoría"),
                "cantidad": -i.cantidad,
                "monto": -i.cantidad * i.costo_unitario * factor,
            }
    sueltas = (
        db.query(models.CompraSuelta)
        .options(joinedload(models.CompraSuelta.ingrediente))
        .filter(models.CompraSuelta.fecha >= inicio, models.CompraSuelta.fecha < fin)
        .all()
    )
    for c in sueltas:
        yield {
            "_fecha": c.fecha,
            "proveedor": "(compra sin factura)",
            "tipo": "Insumos",
            "documento": "Sin factura",
            "forma_pago": SIN_DATO,
            "estado": "Pagada",
            "_doc": f"s:{c.id}",
            "producto": _insumo(c.ingrediente),
            "categoria": cajon.get(c.ingrediente_id, "Sin categoría"),
            "cantidad": c.cantidad,
            "monto": c.cantidad * c.costo_unitario,
        }


def _filas_inventario(db: Session, inicio, fin) -> Iterable[Fila]:
    """El libro de movimientos del deposito (`kardex.py`): cada entrada y cada
    salida, con su valor congelado al costo de ese momento. Es lo mismo que
    lee Inventario > movimientos; las mermas estan aqui como un tipo mas."""
    from . import kardex

    M = models.MovimientoInventario
    ingredientes = {i.id: _insumo(i) for i in db.query(models.Ingrediente)}
    cajon = _cajones(db)
    operadores = {o.id: o.nombre for o in db.query(models.Operador)}
    filas = (
        db.query(M.fecha, M.ingrediente_id, M.tipo, M.cantidad, M.valor, M.origen, M.referencia_id,
                 M.operador_id)
        .filter(M.fecha >= inicio, M.fecha < fin)
        .all()
    )
    # El motivo de cada merma: el movimiento solo trae el id de la merma.
    ids_merma = {r for (_f, _i, _t, _c, _v, o, r, _op) in filas if o == "merma" and r is not None}
    motivo_de = {
        m.id: (m.motivo or "").strip() or SIN_DATO
        for m in db.query(models.Merma).filter(models.Merma.id.in_(ids_merma or [0]))
    }
    for fecha, iid, tipo, cantidad, valor, origen, ref, operador_id in filas:
        cantidad = cantidad or 0
        valor = abs(valor or 0)
        yield {
            "_fecha": fecha,
            "producto": ingredientes.get(iid, SIN_DATO),
            "categoria": cajon.get(iid, "Sin categoría"),
            "tipo": kardex.ETIQUETAS.get(tipo, (tipo or SIN_DATO).capitalize()),
            "motivo": motivo_de.get(ref, SIN_DATO) if origen == "merma" else SIN_DATO,
            "persona": operadores.get(operador_id, "Sin asignar"),
            "entra": cantidad if cantidad > 0 else 0.0,
            "sale": -cantidad if cantidad < 0 else 0.0,
            "v_entra": valor if cantidad > 0 else 0.0,
            "v_sale": valor if cantidad < 0 else 0.0,
            "n": 1,
        }


def _filas_cocina(db: Session, inicio, fin) -> Iterable[Fila]:
    """Las comandas que pasaron por cocina y cuanto tardaron: de que se tomo el
    pedido a que la cocina lo marco listo."""
    P = models.Pedido
    filas = (
        db.query(P.creado_en, P.listo_en, models.Operador.nombre, models.PuntoVenta.nombre)
        .outerjoin(models.Operador, models.Operador.id == P.operador_id)
        .outerjoin(models.PuntoVenta, models.PuntoVenta.id == P.punto_venta_id)
        .filter(
            P.a_cocina.is_(True),
            P.estado != "anulado",
            P.listo_en.isnot(None),
            P.creado_en >= inicio,
            P.creado_en < fin,
        )
        .all()
    )
    for creado, listo, operador, punto in filas:
        minutos = max((listo - creado).total_seconds() / 60, 0)
        yield {
            "_fecha": creado,
            "hora": creado.hour,
            "persona": operador or "Sin asignar",
            "caja": punto or "Sin asignar",
            "n": 1,
            "minutos": minutos,
        }


_TIPO_CUENTA = {"activo": "Activo", "pasivo": "Pasivo", "patrimonio": "Patrimonio",
                "ingreso": "Ingreso", "costo": "Costo", "gasto": "Gasto"}
_ORIGEN_ASIENTO = {"venta": "Venta", "factura_compra": "Compra", "compra_insumo": "Compra",
                   "gasto": "Gasto", "merma": "Merma", "manual": "Asiento manual",
                   "correccion_pago": "Corrección de pago"}


def _filas_contabilidad(db: Session, inicio, fin) -> Iterable[Fila]:
    A, Mv, Cu = models.AsientoContable, models.MovimientoContable, models.CuentaContable
    filas = (
        db.query(A.fecha, A.origen, Cu.codigo, Cu.nombre, Cu.tipo, Cu.naturaleza, Mv.debe, Mv.haber)
        .join(A, A.id == Mv.asiento_id)
        .join(Cu, Cu.id == Mv.cuenta_id)
        .filter(A.fecha >= inicio, A.fecha < fin)
        .all()
    )
    for fecha, origen, codigo, nombre, tipo, naturaleza, debe, haber in filas:
        debe, haber = debe or 0, haber or 0
        yield {
            "_fecha": fecha,
            "cuenta": f"{codigo} · {nombre}",
            "tipo": _TIPO_CUENTA.get(tipo, (tipo or SIN_DATO).capitalize()),
            "documento": _ORIGEN_ASIENTO.get(origen, (origen or SIN_DATO).replace("_", " ").capitalize()),
            "debe": debe,
            "haber": haber,
            # El saldo en el sentido de la cuenta: un gasto sube con el debe,
            # un ingreso con el haber. Asi "Ingreso" y "Gasto" salen positivos.
            "saldo": (debe - haber) if naturaleza == "deudora" else (haber - debe),
        }


def _filas_tasa(db: Session, inicio, fin) -> Iterable[Fila]:
    T = models.TasaCambio
    for fecha, bcv, eur, paralelo in (
        db.query(T.fecha, T.bcv, T.eur, T.paralelo)
        .filter(T.fecha >= inicio.date(), T.fecha < fin.date() + datetime.timedelta(days=1))
    ):
        momento = inicio_del_dia(fecha)
        if not (inicio <= momento < fin):
            continue
        yield {
            "_fecha": momento,
            "s_bcv": bcv or 0, "n_bcv": 1 if bcv else 0,
            "s_eur": eur or 0, "n_eur": 1 if eur else 0,
            "s_par": paralelo or 0, "n_par": 1 if paralelo else 0,
        }


def _hora_del_mart(clave: str, nombre: str) -> int:
    return int(clave)


FUENTES: Dict[str, Fuente] = {}


def _registrar(f: Fuente) -> None:
    FUENTES[f.id] = f


_registrar(Fuente(
    id="ventas",
    nombre="Ventas",
    descripcion="Cada venta cobrada. Las devoluciones no cuentan.",
    modulo="ventas",
    campos=CAMPOS_FECHA + [
        C("hora", "La hora en que se cobró."),
        C("persona", "La cajera que cobró."),
        C("caja"),
        C("cliente"),
        C("forma_pago", "«Mixto» si se pagó de más de una forma."),
        C("factura"),
        C("delivery"),
        C("descuento"),
    ],
    medidas=[
        Medida("ventas", "Total vendido", "dinero", suma="ventas"),
        Medida("pedidos", "Número de ventas", "entero", suma="n"),
        Medida("ticket", "Venta promedio", "dinero", derivada=_division("ventas", "pedidos"),
               depende=("ventas", "pedidos"), ayuda="Total vendido entre el número de ventas."),
        Medida("ventas_bs", "Total en bolívares", "bs", suma="ventas_bs",
               ayuda="Cada venta a la tasa de su día."),
        Medida("iva", "IVA cobrado", "dinero", suma="iva", ayuda="Solo de las ventas con factura."),
        Medida("descuentos", "Descuentos", "dinero", suma="descuentos"),
        Medida("propinas", "Propinas", "dinero", suma="propinas"),
    ],
    filas=_filas_ventas,
    mart={
        # Sin detalle: la fila del dia (DM_FACT110).
        # Solo lo que es exacto al centavo: ventas, IVA y descuentos son
        # precios. Los Bs no: el mart guarda cada dia ya redondeado y la suma
        # de un mes cambiaria de centavos segun de donde salga.
        "": DetalleMart("dia", {"ventas": "ventas", "n": "pedidos",
                                "iva": "iva_cobrado", "descuentos": "valor_descuentos"}),
        "persona": DetalleMart(consolidacion.OPERADOR, {"ventas": "ventas", "n": "pedidos"}),
        "caja": DetalleMart(consolidacion.PUNTO, {"ventas": "ventas", "n": "pedidos"}),
        "hora": DetalleMart(consolidacion.HORA, {"ventas": "ventas", "n": "pedidos"}, _hora_del_mart),
    },
))

_registrar(Fuente(
    id="productos",
    nombre="Menú",
    descripcion="Lo que se vendió de tu menú, producto por producto. Las cortesías no cuentan.",
    modulo="menu",
    campos=CAMPOS_FECHA + [
        C("hora", "La hora en que se cobró."),
        C("producto"),
        C("categoria", "La categoría del menú."),
        C("persona", "La cajera que cobró."),
        C("caja"),
        C("preparacion"),
    ],
    medidas=[
        Medida("unidades", "Unidades vendidas", "entero", suma="unidades"),
        Medida("ventas", "Total vendido", "dinero", suma="ventas"),
        Medida("pedidos", "Número de ventas", "entero", distintos="pedido_id",
               ayuda="En cuántas ventas distintas apareció."),
        Medida("precio_promedio", "Precio promedio", "dinero", derivada=_division("ventas", "unidades"),
               depende=("ventas", "unidades")),
        Medida("costo", "Costo", "dinero", suma="costo", sensible=True,
               ayuda="Costo de la receta al momento de la venta."),
        Medida("margen", "Ganancia", "dinero", derivada=_margen, depende=("ventas", "costo"), sensible=True,
               ayuda="Total vendido menos el costo."),
        Medida("margen_pct", "Ganancia %", "pct", derivada=_margen_pct, depende=("ventas", "costo"),
               sensible=True),
    ],
    filas=_filas_productos,
    mart={
        # El costo NO se lee del mart: tiene fracciones de centavo (sale de
        # la receta) y el mart lo guarda redondeado por dia. Leido de ahi, el
        # margen del cafe cambiaba un centavo al ponerle un filtro.
        "producto": DetalleMart(consolidacion.PRODUCTO, {"unidades": "unidades", "ventas": "ventas"}),
        # "Numero de ventas" de una categoria NO se lee del mart: es un conteo
        # de pedidos distintos, y un pedido con jugo y empanada esta en las
        # dos categorias. Sumarlo para el total lo contaria dos veces.
        "categoria": DetalleMart(consolidacion.CATEGORIA, {"unidades": "unidades", "ventas": "ventas"}),
    },
    etiquetas=_etiquetas_productos,
))

_registrar(Fuente(
    id="cobros",
    nombre="Caja",
    descripcion="Cada pago recibido. Una venta pagada de dos formas aparece en las dos.",
    modulo="caja",
    campos=CAMPOS_FECHA + [
        C("hora", "La hora en que se cobró."),
        C("forma_pago"),
        C("persona", "La cajera que cobró."),
        C("caja"),
    ],
    medidas=[
        Medida("monto", "Total cobrado", "dinero", suma="monto"),
        Medida("cobros", "Número de cobros", "entero", suma="n"),
    ],
    filas=_filas_cobros,
    mart={"forma_pago": DetalleMart(consolidacion.METODO, {"monto": "ventas", "n": "pedidos"})},
))

_registrar(Fuente(
    id="compras",
    nombre="Compras",
    descripcion="Lo comprado a proveedores, sin IVA, menos las notas de crédito.",
    modulo="compras",
    campos=CAMPOS_FECHA + [
        C("proveedor"),
        C("producto", "El insumo comprado."),
        C("categoria", "El cajón del depósito del insumo."),
        C("tipo", "Insumos, servicios, activos u otros."),
        C("documento", "Factura, nota de crédito o compra sin factura."),
        C("forma_pago"),
        C("estado", "Pagada o por pagar."),
    ],
    medidas=[
        Medida("monto", "Total comprado", "dinero", suma="monto",
               ayuda="Sin IVA, con flete y descuentos repartidos."),
        Medida("cantidad", "Cantidad", "numero", suma="cantidad",
               ayuda="Tiene sentido por producto: cada insumo tiene su unidad."),
        Medida("documentos", "Facturas", "entero", distintos="_doc"),
        Medida("costo_promedio", "Costo promedio", "dinero", derivada=_division("monto", "cantidad"),
               depende=("monto", "cantidad"), ayuda="Por unidad del insumo."),
    ],
    filas=_filas_compras,
))

_registrar(Fuente(
    id="inventario",
    nombre="Inventario",
    descripcion="Todo lo que entró y salió del depósito: compras, consumo de las ventas, mermas y ajustes.",
    modulo="inventario",
    campos=CAMPOS_FECHA + [
        C("producto", "El insumo."),
        C("categoria", "El cajón del depósito."),
        C("tipo", "Compra, venta, merma, ajuste por conteo..."),
        C("motivo", "Por qué se perdió (solo las mermas)."),
        C("persona", "Quien lo registró."),
    ],
    medidas=[
        Medida("v_sale", "Valor que salió", "dinero", suma="v_sale", ayuda="Al costo de ese momento."),
        Medida("v_entra", "Valor que entró", "dinero", suma="v_entra"),
        Medida("sale", "Cantidad que salió", "numero", suma="sale",
               ayuda="Tiene sentido por producto: cada insumo tiene su unidad."),
        Medida("entra", "Cantidad que entró", "numero", suma="entra",
               ayuda="Tiene sentido por producto: cada insumo tiene su unidad."),
        Medida("movimientos", "Movimientos", "entero", suma="n"),
    ],
    filas=_filas_inventario,
))

_registrar(Fuente(
    id="cocina",
    nombre="Cocina",
    descripcion="Las comandas que pasaron por cocina y cuánto tardaron en estar listas.",
    modulo="cocina",
    campos=CAMPOS_FECHA + [
        C("hora", "La hora en que se tomó el pedido."),
        C("persona", "La cajera que tomó el pedido."),
        C("caja"),
    ],
    medidas=[
        Medida("comandas", "Comandas", "entero", suma="n"),
        Medida("minutos", "Minutos promedio", "numero", derivada=_division("t_min", "comandas"),
               depende=("t_min", "comandas"), ayuda="De que se tomó el pedido a que la cocina lo marcó listo."),
        Medida("t_min", "Minutos en total", "numero", suma="minutos", oculta=True),
    ],
    filas=_filas_cocina,
))

_registrar(Fuente(
    id="contabilidad",
    nombre="Contabilidad",
    descripcion="Los movimientos de cada cuenta contable.",
    modulo="contabilidad",
    campos=CAMPOS_FECHA + [
        C("cuenta"),
        C("tipo", "Activo, pasivo, ingreso, costo, gasto..."),
        C("documento", "De dónde salió el asiento: venta, compra, gasto..."),
    ],
    medidas=[
        Medida("saldo", "Saldo del período", "dinero", suma="saldo",
               ayuda="En el sentido de cada cuenta: ingresos y gastos salen en positivo."),
        Medida("debe", "Debe", "dinero", suma="debe"),
        Medida("haber", "Haber", "dinero", suma="haber"),
    ],
    filas=_filas_contabilidad,
))

_registrar(Fuente(
    id="tasa",
    nombre="Tasa de cambio",
    descripcion="Cómo se movió la tasa del dólar y del euro.",
    modulo="tasa",
    campos=list(CAMPOS_FECHA),
    medidas=[
        Medida("bcv", "Dólar BCV", "bs", derivada=_division("s_bcv", "n_bcv"), depende=("s_bcv", "n_bcv"),
               ayuda="Promedio del período."),
        Medida("paralelo", "Dólar paralelo", "bs", derivada=_division("s_par", "n_par"),
               depende=("s_par", "n_par"), ayuda="Promedio del período."),
        Medida("eur", "Euro BCV", "bs", derivada=_division("s_eur", "n_eur"), depende=("s_eur", "n_eur"),
               ayuda="Promedio del período."),
        Medida("s_bcv", "", "bs", suma="s_bcv", oculta=True),
        Medida("n_bcv", "", "entero", suma="n_bcv", oculta=True),
        Medida("s_par", "", "bs", suma="s_par", oculta=True),
        Medida("n_par", "", "entero", suma="n_par", oculta=True),
        Medida("s_eur", "", "bs", suma="s_eur", oculta=True),
        Medida("n_eur", "", "entero", suma="n_eur", oculta=True),
    ],
    filas=_filas_tasa,
))


def _sumable(m: Medida) -> bool:
    """Si las partes de esta medida suman el total: el total vendido si; un
    promedio o un porcentaje no. Decide si el grafico puede apilarla."""
    return m.derivada is None and not m.distintos


def puede_ver(fuente: "Fuente", modulos: Optional[Sequence[str]]) -> bool:
    """Si quien pregunta entra al modulo de esta fuente. None: sin limite
    (los tests y los usos internos)."""
    return modulos is None or not fuente.modulo or fuente.modulo in modulos


def catalogo(ve_sensibles: bool, modulos: Optional[Sequence[str]] = None) -> List[dict]:
    return [
        {
            "id": f.id,
            "nombre": f.nombre,
            "descripcion": f.descripcion,
            "campos": [
                {"id": c.id, "nombre": c.nombre, "tipo": c.tipo, "ayuda": c.ayuda, "grupo": c.grupo}
                for c in f.campos
            ],
            "medidas": [
                {"id": m.id, "nombre": m.nombre, "formato": m.formato, "ayuda": m.ayuda, "sumable": _sumable(m)}
                for m in f.medidas if (ve_sensibles or not m.sensible) and not m.oculta
            ],
        }
        for f in FUENTES.values() if puede_ver(f, modulos)
    ]


# ─────────────────────────────────────────────────────────────────────────────
# La consulta
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class Consulta:
    fuente: str
    inicio: datetime.datetime
    fin: datetime.datetime
    filas: List[str] = field(default_factory=list)
    columna: Optional[str] = None
    medidas: List[str] = field(default_factory=list)
    # campo -> valores permitidos (como texto). Vacio: sin filtro.
    filtros: Dict[str, List[str]] = field(default_factory=dict)
    # Cuantas filas devolver: la pantalla, pocas; el Excel, todas.
    limite: int = MAX_GRUPOS


class _Acumulado:
    __slots__ = ("sumas", "distintos")

    def __init__(self) -> None:
        self.sumas: Dict[str, float] = defaultdict(float)
        self.distintos: Dict[str, Set[Any]] = defaultdict(set)

    def final(self) -> Dict[str, float]:
        salida = dict(self.sumas)
        for clave, valores in self.distintos.items():
            salida[clave] = salida.get(clave, 0.0) + len(valores)
        return salida


def _texto(valor: Any) -> str:
    """Un valor como lo manda y lo recibe la pantalla. None es "" en los dos
    sentidos: si no, filtrar por "(sin dato)" no encontraba nada."""
    return "" if valor is None else str(valor)


def _valor_de(fila: Fila, campo: Campo) -> Any:
    if campo.de_fecha:
        return _valor_de_fecha(campo.id, fila["_fecha"])
    return fila.get(campo.id)


def _medidas_base(fuente: Fuente, ids: Sequence[str]) -> List[Medida]:
    """Las medidas que hay que SUMAR para responder `ids`, derivadas incluidas."""
    base: Dict[str, Medida] = {}
    pendientes = list(ids)
    while pendientes:
        m = fuente.medida(pendientes.pop())
        if m.derivada is not None:
            pendientes.extend(d for d in m.depende if d not in base)
        else:
            base[m.id] = m
    return list(base.values())


def _clave_de_fila(m: Medida) -> str:
    return m.suma or m.distintos or m.id


def _campos_usados(c: Consulta) -> Set[str]:
    """Los campos que la consulta toca. Un filtro sin valores no es filtro."""
    return set(c.filas) | ({c.columna} if c.columna else set()) | {k for k, v in c.filtros.items() if v}


def _plan_mart(fuente: Fuente, c: Consulta, base: List[Medida]) -> Optional[DetalleMart]:
    """El detalle del mart que responde esta consulta, o None si va en vivo."""
    if not fuente.mart:
        return None
    detalles = _campos_usados(c) - IDS_FECHA
    if len(detalles) > 1:
        return None
    clave = next(iter(detalles)) if detalles else ""
    plan = fuente.mart.get(clave)
    if plan is None:
        return None
    # Cada medida pedida tiene que estar en el mart con su misma definicion.
    # Los conteos de distintos nunca: no se pueden sumar entre grupos.
    if any(m.distintos for m in base):
        return None
    for m in base:
        if _clave_de_fila(m) not in plan.medidas and m.id not in plan.medidas:
            return None
    return plan


def _filas_del_mart(db: Session, plan: DetalleMart, dias: List[datetime.date],
                    detalle: str) -> Iterable[Fila]:
    if not dias:
        return
    desde, hasta = min(dias), max(dias) + datetime.timedelta(days=1)
    quiero = set(dias)
    if plan.tipo == "dia":
        for f in (db.query(models.DmVentaDia)
                  .filter(models.DmVentaDia.fecha >= desde, models.DmVentaDia.fecha < hasta)):
            if f.fecha not in quiero or not f.pedidos:
                continue
            fila: Fila = {"_fecha": inicio_del_dia(f.fecha)}
            for clave, atributo in plan.medidas.items():
                fila[clave] = getattr(f, atributo) or 0
            yield fila
        return
    for d in (db.query(models.DmVentaDiaDet)
              .filter(models.DmVentaDiaDet.fecha >= desde, models.DmVentaDiaDet.fecha < hasta,
                      models.DmVentaDiaDet.tipo == plan.tipo)):
        if d.fecha not in quiero:
            continue
        fila = {"_fecha": inicio_del_dia(d.fecha), detalle: plan.valor(d.clave, d.nombre)}
        for clave, atributo in plan.medidas.items():
            fila[clave] = getattr(d, atributo) or 0
        yield fila


def _dias_de(inicio: datetime.datetime, fin: datetime.datetime) -> float:
    return (fin - inicio).total_seconds() / 86400


def _agrupar(
    filas: Iterable[Fila],
    campos_fila: List[Campo],
    campo_col: Optional[Campo],
    base: List[Medida],
    filtros: Dict[Campo, Set[str]],
    del_mart: bool,
    grupos: Dict[Tuple, Dict[Any, _Acumulado]],
    totales_col: Dict[Any, _Acumulado],
    nombres: Dict[Any, Tuple[datetime.datetime, str]],
) -> None:
    for fila in filas:
        if any(_texto(_valor_de(fila, cf)) not in permitidos for cf, permitidos in filtros.items()):
            continue
        clave = tuple(_valor_de(fila, cf) for cf in campos_fila)
        col = _valor_de(fila, campo_col) if campo_col else None
        # El nombre de lo que se renombro: el de la fila mas reciente.
        if "_nombre_producto" in fila:
            vista = nombres.get(fila["producto"])
            if vista is None or fila["_fecha"] >= vista[0]:
                nombres[fila["producto"]] = (fila["_fecha"], fila["_nombre_producto"])
        destinos = (grupos.setdefault(clave, {}), totales_col)
        for por_col in destinos:
            for celda in (por_col.setdefault(col, _Acumulado()), por_col.setdefault("__total__", _Acumulado())) \
                    if campo_col else (por_col.setdefault(None, _Acumulado()),):
                for m in base:
                    k = _clave_de_fila(m)
                    if m.distintos:
                        # Lo que no es documento (una nota de credito) no
                        # cuenta como factura.
                        if fila.get(k) is not None:
                            celda.distintos[m.id].add(fila.get(k))
                    else:
                        celda.sumas[m.id] += float(fila.get(k, 0) or 0)


def _medidas_finales(fuente: Fuente, ids: Sequence[str], sumas: Dict[str, float]) -> Dict[str, Optional[float]]:
    salida: Dict[str, Optional[float]] = {}
    # El mart guarda cada dia ya redondeado; en vivo la suma arrastra el ruido
    # del punto flotante (144.39999...). Sin igualarlos antes de dividir, un
    # ticket de 9.025 salia 9.02 en vivo y 9.03 del mart.
    sumas = {k: round(v, 4) for k, v in sumas.items()}
    for mid in ids:
        m = fuente.medida(mid)
        v = m.derivada(sumas) if m.derivada is not None else sumas.get(mid, 0.0)
        salida[mid] = None if v is None else round(v, 2)
    return salida


def _orden(campo: Campo, valor: Any):
    """Clave para ordenar valores de un campo: lo vacio al final."""
    if valor is None or valor == "":
        return (1, "")
    if isinstance(valor, (int, float)):
        return (0, f"{valor:012.3f}")
    return (0, str(valor).lower())


def _fuente_para(fuente_id: str, modulos: Optional[Sequence[str]]) -> Fuente:
    fuente = FUENTES.get(fuente_id)
    if fuente is None:
        raise ErrorDeConsulta(f"No existe la fuente «{fuente_id}».")
    if not puede_ver(fuente, modulos):
        raise ErrorDeConsulta(f"Tu rol no entra a {fuente.nombre}: pídele acceso al dueño del local.")
    return fuente


def consultar(db: Session, c: Consulta, ve_sensibles: bool,
              modulos: Optional[Sequence[str]] = None) -> dict:
    fuente = _fuente_para(c.fuente, modulos)
    if not c.medidas:
        raise ErrorDeConsulta("Elige al menos una medida.")
    if len(c.filas) != len(set(c.filas)):
        raise ErrorDeConsulta("Un campo no puede ir dos veces en las filas.")
    if c.columna and c.columna in c.filas:
        raise ErrorDeConsulta("El campo de las columnas no puede estar también en las filas.")
    campos_fila = [fuente.campo(cid) for cid in c.filas]
    campo_col = fuente.campo(c.columna) if c.columna else None
    filtros = {fuente.campo(cid): {str(v) for v in vals} for cid, vals in c.filtros.items() if vals}
    medidas = [fuente.medida(mid) for mid in c.medidas]
    if not ve_sensibles and any(m.sensible for m in medidas):
        raise ErrorDeConsulta("Costo y margen solo los ve quien administra el local.")
    base = _medidas_base(fuente, c.medidas)

    grupos: Dict[Tuple, Dict[Any, _Acumulado]] = {}
    totales_col: Dict[Any, _Acumulado] = {}
    nombres: Dict[Any, Tuple[datetime.datetime, str]] = {}

    plan = _plan_mart(fuente, c, base)
    if plan is not None:
        dias, tramos = consolidacion.partir_rango(db, c.inicio, c.fin)
        detalle = next(iter(_campos_usados(c) - IDS_FECHA), "")
        en_vivo = [(t0 or c.inicio, t1 or c.fin) for t0, t1 in tramos]
    else:
        dias, detalle = [], ""
        en_vivo = [(c.inicio, c.fin)]

    dias_vivos = sum(_dias_de(a, b) for a, b in en_vivo)
    if dias_vivos > MAX_DIAS_EN_VIVO:
        raise ErrorDeConsulta(
            f"Esta combinación se calcula leyendo cada movimiento, y el período pasa de "
            f"{MAX_DIAS_EN_VIVO} días. Acorta las fechas o agrupa por un solo campo además de la fecha."
        )

    if dias:
        _agrupar(_filas_del_mart(db, plan, dias, detalle), campos_fila, campo_col, base, filtros,
                 True, grupos, totales_col, nombres)
    # Lo vivo se agrupa APARTE y se suma despues: un "pedidos distintos" de
    # hoy se cuenta con su conjunto, y el del mart ya viene contado. Un pedido
    # es de un solo dia, asi que sumar los dos es exacto.
    vivos: Dict[Tuple, Dict[Any, _Acumulado]] = {}
    vivos_col: Dict[Any, _Acumulado] = {}
    for a, b in en_vivo:
        if b > a:
            _agrupar(fuente.filas(db, a, b), campos_fila, campo_col, base, filtros,
                     False, vivos, vivos_col, nombres)
    for destino, origen in ((None, vivos_col),) + tuple((k, v) for k, v in vivos.items()):
        objetivo = totales_col if destino is None else grupos.setdefault(destino, {})
        for col, acc in origen.items():
            final = acc.final()
            t = objetivo.setdefault(col, _Acumulado())
            for k, v in final.items():
                t.sumas[k] += v

    # Las etiquetas de cada valor.
    valores_por_campo: Dict[str, Set[Any]] = defaultdict(set)
    for clave in grupos:
        for cf, v in zip(campos_fila, clave):
            valores_por_campo[cf.id].add(v)
    columnas_vistas = sorted((k for k in totales_col if k != "__total__"),
                             key=lambda v: _orden(campo_col, v)) if campo_col else []
    if campo_col:
        if len(columnas_vistas) > MAX_COLUMNAS:
            raise ErrorDeConsulta(
                f"«{campo_col.nombre}» tiene {len(columnas_vistas)} valores distintos y en columnas caben "
                f"{MAX_COLUMNAS}. Filtra algunos o llévalo a las filas."
            )
        valores_por_campo[campo_col.id].update(columnas_vistas)
    etiquetas: Dict[str, Dict[Any, str]] = {}
    for cf in campos_fila + ([campo_col] if campo_col else []):
        propias = fuente.etiquetas(db, cf.id, list(valores_por_campo[cf.id])) if fuente.etiquetas else {}
        if cf.id == "producto":
            for k, (_f, nombre) in nombres.items():
                propias.setdefault(k, nombre)
        etiquetas[cf.id] = {v: propias.get(v) or etiqueta_de(cf, v) for v in valores_por_campo[cf.id]}

    def valores_de(por_col: Dict[Any, _Acumulado]) -> dict:
        if not campo_col:
            acc = por_col.get(None) or _Acumulado()
            return {"total": _medidas_finales(fuente, c.medidas, acc.final())}
        return {
            "total": _medidas_finales(fuente, c.medidas, (por_col.get("__total__") or _Acumulado()).final()),
            "por_columna": {
                _texto(col): _medidas_finales(fuente, c.medidas, por_col[col].final())
                for col in columnas_vistas if col in por_col
            },
        }

    filas_salida = []
    for clave, por_col in grupos.items():
        filas_salida.append({
            "claves": [_texto(v) for v in clave],
            "etiquetas": [etiquetas[cf.id].get(v, SIN_DATO) for cf, v in zip(campos_fila, clave)],
            "_orden": [_orden(cf, v) for cf, v in zip(campos_fila, clave)],
            **valores_de(por_col),
        })
    # Por fecha, en orden de calendario; si no, lo que mas pesa primero.
    if campos_fila and campos_fila[0].de_fecha or (campos_fila and campos_fila[0].tipo == "hora"):
        filas_salida.sort(key=lambda f: f["_orden"])
    else:
        primera = c.medidas[0]
        filas_salida.sort(key=lambda f: (-(f["total"].get(primera) or 0), f["_orden"]))
    for f in filas_salida:
        del f["_orden"]
    truncado = len(filas_salida) > c.limite

    return {
        "fuente": fuente.id,
        "campos_fila": [{"id": cf.id, "nombre": cf.nombre, "tipo": cf.tipo} for cf in campos_fila],
        "columna": (
            {
                "id": campo_col.id, "nombre": campo_col.nombre, "tipo": campo_col.tipo,
                "valores": [
                    {"valor": _texto(v), "etiqueta": etiquetas[campo_col.id].get(v, SIN_DATO)}
                    for v in columnas_vistas
                ],
            }
            if campo_col else None
        ),
        "medidas": [{"id": m.id, "nombre": m.nombre, "formato": m.formato, "sumable": _sumable(m)}
                    for m in medidas],
        "filas": filas_salida[:c.limite],
        "totales": valores_de(totales_col),
        "truncado": truncado,
        "desde_mart": bool(dias),
    }


def valores_posibles(db: Session, fuente_id: str, campo_id: str,
                     inicio: datetime.datetime, fin: datetime.datetime,
                     modulos: Optional[Sequence[str]] = None) -> List[dict]:
    """Los valores que tiene un campo en el periodo: lo que se ofrece al filtrar."""
    fuente = _fuente_para(fuente_id, modulos)
    campo = fuente.campo(campo_id)
    if campo.tipo == "dia_semana":
        return [{"valor": str(i), "etiqueta": d} for i, d in enumerate(DIAS_SEMANA)]
    if campo.tipo == "hora":
        return [{"valor": str(h), "etiqueta": f"{h:02d}:00"} for h in range(24)]
    if _dias_de(inicio, fin) > MAX_DIAS_EN_VIVO:
        inicio = fin - datetime.timedelta(days=MAX_DIAS_EN_VIVO)
    vistos: Set[Any] = set()
    nombres: Dict[Any, str] = {}
    for fila in fuente.filas(db, inicio, fin):
        v = _valor_de(fila, campo)
        vistos.add(v)
        if "_nombre_producto" in fila and campo.id == "producto":
            nombres[v] = fila["_nombre_producto"]
    propias = fuente.etiquetas(db, campo.id, list(vistos)) if fuente.etiquetas else {}
    salida = [
        {"valor": _texto(v), "etiqueta": propias.get(v) or nombres.get(v) or etiqueta_de(campo, v)}
        for v in vistos
    ]
    salida.sort(key=lambda x: (x["valor"] if campo.de_fecha else x["etiqueta"].lower()))
    return salida
