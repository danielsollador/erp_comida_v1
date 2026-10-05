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
# Grupos que se devuelven. Un reporte de 5.000 filas no se lee: se filtra.
MAX_GRUPOS = 5000
# Valores distintos del campo que va en columnas. Treinta columnas ya no caben
# en una tablet; mas es casi siempre haber elegido el campo equivocado.
MAX_COLUMNAS = 30

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


# Los campos de fecha son los mismos en todas las fuentes y salen de `_fecha`.
CAMPOS_FECHA = [
    Campo("dia", "Día", "fecha", de_fecha=True),
    Campo("semana", "Semana", "semana", "Semana de lunes a domingo.", de_fecha=True),
    Campo("mes", "Mes", "mes", de_fecha=True),
    Campo("anio", "Año", "anio", de_fecha=True),
    Campo("dia_semana", "Día de la semana", "dia_semana", de_fecha=True),
]
IDS_FECHA = {c.id for c in CAMPOS_FECHA}


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


def _forma_de_pago(pedido: models.Pedido) -> str:
    metodos = sorted({p.metodo for p in pedido.pagos})
    if not metodos:
        return pedido.metodo_pago or SIN_DATO
    return metodos[0] if len(metodos) == 1 else "Mixto"


def _filas_ventas(db: Session, inicio, fin) -> Iterable[Fila]:
    servicios = seed.variantes_de_servicio(db)
    for p in consolidacion.pedidos_pagados(db, inicio, fin):
        iva = 0.0
        if p.facturado:
            _base, iva = impuestos.desglosar(p.total, p.tasa_iva or impuestos.IVA_DEFAULT)
        yield {
            "_fecha": p.cerrado_en,
            "hora": p.cerrado_en.hour,
            "cajera": p.operador or "Sin asignar",
            "caja": p.punto_venta or "Sin asignar",
            "cliente": (p.cliente or "").strip() or SIN_DATO,
            "forma_pago": _forma_de_pago(p),
            "facturado": _si_no(p.facturado, "Facturado", "Sin factura"),
            "delivery": _si_no(any(i.variante_id in servicios for i in p.items), "Con delivery", "Sin delivery"),
            "descuento": _si_no((p.descuento or 0) > 0, "Con descuento", "Sin descuento"),
            "n": 1,
            "ventas": p.total,
            "ventas_bs": p.total * (p.tasa_bcv or 0),
            "iva": iva,
            "descuentos": p.descuento or 0,
            "propinas": p.propina or 0,
        }


def _categoria_de_variantes(db: Session, ids) -> Dict[int, str]:
    return consolidacion._categoria_de_variantes(db, ids)


def _filas_productos(db: Session, inicio, fin) -> Iterable[Fila]:
    pedidos = consolidacion.pedidos_pagados(db, inicio, fin)
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
                "cajera": p.operador or "Sin asignar",
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
    for p in consolidacion.pedidos_pagados(db, inicio, fin):
        for pago in p.pagos:
            yield {
                "_fecha": p.cerrado_en,
                "hora": p.cerrado_en.hour,
                "metodo": pago.metodo,
                "cajera": p.operador or "Sin asignar",
                "caja": p.punto_venta or "Sin asignar",
                "monto": pago.monto,
                "n": 1,
            }


def _filas_compras(db: Session, inicio, fin) -> Iterable[Fila]:
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
            "origen": "Factura",
            "forma_pago": f.forma_pago or SIN_DATO,
            "estado": _si_no(bool(f.pagada), "Pagada", "Por pagar"),
            "documento": f"f:{f.id}",
        }
        if not f.items:
            yield {**comun, "insumo": "(sin detalle de insumos)", "cantidad": 0.0, "monto": f.base_imponible or 0}
            continue
        # La base de la factura ya trae el flete y el descuento repartidos
        # (ver compras._crear_factura); repartirlos igual aqui hace que la
        # suma de los renglones sea la base del Libro de Compras.
        bruta = sum(i.cantidad * i.costo_unitario for i in f.items)
        factor = (f.base_imponible / bruta) if bruta else 1.0
        for i in f.items:
            ing = i.ingrediente
            yield {
                **comun,
                "insumo": f"{ing.nombre} ({ing.unidad})" if ing else SIN_DATO,
                "cantidad": i.cantidad,
                "monto": i.cantidad * i.costo_unitario * factor,
            }
    sueltas = (
        db.query(models.CompraSuelta)
        .options(joinedload(models.CompraSuelta.ingrediente))
        .filter(models.CompraSuelta.fecha >= inicio, models.CompraSuelta.fecha < fin)
        .all()
    )
    for c in sueltas:
        ing = c.ingrediente
        yield {
            "_fecha": c.fecha,
            "proveedor": "(compra sin factura)",
            "tipo": "Insumos",
            "origen": "Compra sin factura",
            "forma_pago": SIN_DATO,
            "estado": "Pagada",
            "documento": f"s:{c.id}",
            "insumo": f"{ing.nombre} ({ing.unidad})" if ing else SIN_DATO,
            "cantidad": c.cantidad,
            "monto": c.cantidad * c.costo_unitario,
        }


def _filas_mermas(db: Session, inicio, fin) -> Iterable[Fila]:
    # El valor CONGELADO de cada merma, el mismo que muestra Perdidas.
    from .routers.reportes import _mermas_valoradas

    operadores = {o.id: o.nombre for o in db.query(models.Operador)}
    for m, valor in _mermas_valoradas(db, inicio, fin):
        ing = m.ingrediente
        yield {
            "_fecha": m.fecha,
            "insumo": f"{ing.nombre} ({ing.unidad})" if ing else SIN_DATO,
            "motivo": (m.motivo or "").strip() or SIN_DATO,
            "origen": _si_no(bool(m.por_conteo), "Faltante de conteo", "Registrada"),
            "responsable": operadores.get(m.operador_id, "Sin asignar"),
            "cantidad": m.cantidad,
            "valor": valor,
            "n": 1,
        }


def _hora_del_mart(clave: str, nombre: str) -> int:
    return int(clave)


FUENTES: Dict[str, Fuente] = {}


def _registrar(f: Fuente) -> None:
    FUENTES[f.id] = f


_registrar(Fuente(
    id="ventas",
    nombre="Ventas (por pedido)",
    descripcion="Cada pedido cobrado. Las devoluciones no cuentan como venta.",
    campos=CAMPOS_FECHA + [
        Campo("hora", "Hora del cobro", "hora"),
        Campo("cajera", "Cajera"),
        Campo("caja", "Caja"),
        Campo("cliente", "Cliente"),
        Campo("forma_pago", "Forma de pago", ayuda="«Mixto» si se pagó con más de un método."),
        Campo("facturado", "Factura"),
        Campo("delivery", "Delivery"),
        Campo("descuento", "Descuento"),
    ],
    medidas=[
        Medida("ventas", "Ventas", "dinero", suma="ventas"),
        Medida("pedidos", "Pedidos", "entero", suma="n"),
        Medida("ticket", "Ticket promedio", "dinero", derivada=_division("ventas", "pedidos"),
               depende=("ventas", "pedidos"), ayuda="Ventas entre pedidos."),
        Medida("ventas_bs", "Ventas en Bs", "bs", suma="ventas_bs",
               ayuda="Cada venta a la tasa de su día."),
        Medida("iva", "IVA cobrado", "dinero", suma="iva", ayuda="Solo de los pedidos facturados."),
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
        "cajera": DetalleMart(consolidacion.OPERADOR, {"ventas": "ventas", "n": "pedidos"}),
        "caja": DetalleMart(consolidacion.PUNTO, {"ventas": "ventas", "n": "pedidos"}),
        "hora": DetalleMart(consolidacion.HORA, {"ventas": "ventas", "n": "pedidos"}, _hora_del_mart),
    },
))

_registrar(Fuente(
    id="productos",
    nombre="Productos vendidos",
    descripcion="Cada renglón vendido en un pedido cobrado. Las cortesías no cuentan (están en Pérdidas).",
    campos=CAMPOS_FECHA + [
        Campo("hora", "Hora del cobro", "hora"),
        Campo("producto", "Producto"),
        Campo("categoria", "Categoría"),
        Campo("cajera", "Cajera"),
        Campo("caja", "Caja"),
        Campo("preparacion", "Cocina o vitrina"),
    ],
    medidas=[
        Medida("unidades", "Unidades", "entero", suma="unidades"),
        Medida("ventas", "Ventas", "dinero", suma="ventas"),
        Medida("pedidos", "Pedidos", "entero", distintos="pedido_id",
               ayuda="En cuántos pedidos distintos apareció."),
        Medida("precio_promedio", "Precio promedio", "dinero", derivada=_division("ventas", "unidades"),
               depende=("ventas", "unidades")),
        Medida("costo", "Costo", "dinero", suma="costo", sensible=True,
               ayuda="Costo de receta al momento de la venta."),
        Medida("margen", "Margen", "dinero", derivada=_margen, depende=("ventas", "costo"), sensible=True),
        Medida("margen_pct", "Margen %", "pct", derivada=_margen_pct, depende=("ventas", "costo"),
               sensible=True),
    ],
    filas=_filas_productos,
    mart={
        # El costo NO se lee del mart: tiene fracciones de centavo (sale de
        # la receta) y el mart lo guarda redondeado por dia. Leido de ahi, el
        # margen del cafe cambiaba un centavo al ponerle un filtro.
        "producto": DetalleMart(consolidacion.PRODUCTO, {"unidades": "unidades", "ventas": "ventas"}),
        # "Pedidos" de una categoria NO se lee del mart: es un conteo de
        # pedidos distintos, y un pedido con jugo y empanada esta en las dos
        # categorias. Sumarlo para el total lo contaria dos veces.
        "categoria": DetalleMart(consolidacion.CATEGORIA, {"unidades": "unidades", "ventas": "ventas"}),
    },
    etiquetas=_etiquetas_productos,
))

_registrar(Fuente(
    id="cobros",
    nombre="Cobros",
    descripcion="Cada pago recibido por las ventas cobradas. Una venta mixta aparece en cada método.",
    campos=CAMPOS_FECHA + [
        Campo("hora", "Hora del cobro", "hora"),
        Campo("metodo", "Método de pago"),
        Campo("cajera", "Cajera"),
        Campo("caja", "Caja"),
    ],
    medidas=[
        Medida("monto", "Monto", "dinero", suma="monto"),
        Medida("cobros", "Cobros", "entero", suma="n"),
    ],
    filas=_filas_cobros,
    mart={"metodo": DetalleMart(consolidacion.METODO, {"monto": "ventas", "n": "pedidos"})},
))

_registrar(Fuente(
    id="compras",
    nombre="Compras",
    descripcion="Renglones de las facturas de compra y las compras sin factura. Montos sin IVA, con flete y descuento repartidos.",
    campos=CAMPOS_FECHA + [
        Campo("proveedor", "Proveedor"),
        Campo("insumo", "Insumo"),
        Campo("tipo", "Tipo de compra", ayuda="Insumos, Servicios, Activos u Otros."),
        Campo("origen", "Origen"),
        Campo("forma_pago", "Forma de pago"),
        Campo("estado", "Estado"),
    ],
    medidas=[
        Medida("monto", "Monto sin IVA", "dinero", suma="monto"),
        Medida("cantidad", "Cantidad", "numero", suma="cantidad",
               ayuda="Solo tiene sentido agrupando por insumo: cada uno tiene su unidad."),
        Medida("documentos", "Facturas", "entero", distintos="documento"),
        Medida("costo_promedio", "Costo promedio", "dinero", derivada=_division("monto", "cantidad"),
               depende=("monto", "cantidad"), ayuda="Monto entre cantidad, por unidad del insumo."),
    ],
    filas=_filas_compras,
))

_registrar(Fuente(
    id="mermas",
    nombre="Mermas",
    descripcion="Lo que se dañó, se botó o faltó en un conteo, con su valor al costo de ese día.",
    campos=CAMPOS_FECHA + [
        Campo("insumo", "Insumo"),
        Campo("motivo", "Motivo"),
        Campo("origen", "Origen"),
        Campo("responsable", "Registró"),
    ],
    medidas=[
        Medida("valor", "Valor", "dinero", suma="valor"),
        Medida("cantidad", "Cantidad", "numero", suma="cantidad",
               ayuda="Solo tiene sentido agrupando por insumo: cada uno tiene su unidad."),
        Medida("registros", "Registros", "entero", suma="n"),
    ],
    filas=_filas_mermas,
))


def catalogo(ve_sensibles: bool) -> List[dict]:
    return [
        {
            "id": f.id,
            "nombre": f.nombre,
            "descripcion": f.descripcion,
            "campos": [{"id": c.id, "nombre": c.nombre, "tipo": c.tipo, "ayuda": c.ayuda} for c in f.campos],
            "medidas": [
                {"id": m.id, "nombre": m.nombre, "formato": m.formato, "ayuda": m.ayuda}
                for m in f.medidas if ve_sensibles or not m.sensible
            ],
        }
        for f in FUENTES.values()
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


def _plan_mart(fuente: Fuente, c: Consulta, base: List[Medida]) -> Optional[DetalleMart]:
    """El detalle del mart que responde esta consulta, o None si va en vivo."""
    if not fuente.mart:
        return None
    usados = set(c.filas) | ({c.columna} if c.columna else set()) | set(c.filtros)
    detalles = usados - IDS_FECHA
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
        if any(str(_valor_de(fila, cf)) not in permitidos for cf, permitidos in filtros.items()):
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


def consultar(db: Session, c: Consulta, ve_sensibles: bool) -> dict:
    fuente = FUENTES.get(c.fuente)
    if fuente is None:
        raise ErrorDeConsulta(f"No existe la fuente «{c.fuente}».")
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
        detalle = next(iter((set(c.filas) | ({c.columna} if c.columna else set()) | set(c.filtros)) - IDS_FECHA), "")
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
                str(col): _medidas_finales(fuente, c.medidas, por_col[col].final())
                for col in columnas_vistas if col in por_col
            },
        }

    filas_salida = []
    for clave, por_col in grupos.items():
        filas_salida.append({
            "claves": [str(v) if v is not None else "" for v in clave],
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
    truncado = len(filas_salida) > MAX_GRUPOS

    return {
        "fuente": fuente.id,
        "campos_fila": [{"id": cf.id, "nombre": cf.nombre, "tipo": cf.tipo} for cf in campos_fila],
        "columna": (
            {
                "id": campo_col.id, "nombre": campo_col.nombre, "tipo": campo_col.tipo,
                "valores": [
                    {"valor": str(v), "etiqueta": etiquetas[campo_col.id].get(v, SIN_DATO)}
                    for v in columnas_vistas
                ],
            }
            if campo_col else None
        ),
        "medidas": [{"id": m.id, "nombre": m.nombre, "formato": m.formato} for m in medidas],
        "filas": filas_salida[:MAX_GRUPOS],
        "totales": valores_de(totales_col),
        "truncado": truncado,
        "desde_mart": bool(dias),
    }


def valores_posibles(db: Session, fuente_id: str, campo_id: str,
                     inicio: datetime.datetime, fin: datetime.datetime) -> List[dict]:
    """Los valores que tiene un campo en el periodo: lo que se ofrece al filtrar."""
    fuente = FUENTES.get(fuente_id)
    if fuente is None:
        raise ErrorDeConsulta(f"No existe la fuente «{fuente_id}».")
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
        {"valor": str(v) if v is not None else "", "etiqueta": propias.get(v) or nombres.get(v) or etiqueta_de(campo, v)}
        for v in vistos
    ]
    salida.sort(key=lambda x: (x["valor"] if campo.de_fecha else x["etiqueta"].lower()))
    return salida
