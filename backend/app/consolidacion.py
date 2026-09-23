"""El data mart diario: los numeros de cada dia cerrado, calculados UNA vez.

POR QUE EXISTE. Cada vez que alguien abria Reportes, Ventas o Contabilidad
por "este mes", el servidor volvia a leer TODOS los pedidos del mes con sus
renglones y pagos, y a sumar TODOS los asientos, para producir los mismos
numeros que la vez anterior: un dia que ya termino no cambia. Con un local
eso no se nota; con veinte locales en el mismo servidor, cada gerente
mirando su mes a media mañana es el equivalente de reconstruir un año de
ventas por minuto. Leider (19-sep): "la menor cantidad de peticiones al
dia... lo que no se necesite para la operatividad del dia, que se vea hasta
el dia anterior".

QUE HACE. Un hilo nocturno (03:30 hora del local, ver `iniciar_consolidacion`)
toma cada dia ya terminado que no este consolidado y guarda:

  DM_FACT110_VEN_DIA          una fila por dia: ventas, pedidos, IVA, costo,
                              anulados, devueltos, facturados... y la lista de
                              totales de cada pedido (para la mediana exacta).
  DM_FACT120_VEN_DIA_DET      el detalle del dia: por metodo de pago, por
                              hora, por dia-de-la-semana x hora, por
                              categoria, por producto, por operador, por caja.
  DM_FACT610_CON_DIA_CUENTA   debe y haber de cada cuenta contable ese dia.

Las pantallas piden un rango y `bloque_para` lo parte en dos: los dias ya
consolidados se leen del mart (una consulta chiquita), y lo que falta --hoy,
o un dia que se invalido-- se calcula en vivo como siempre. Los dos caminos
pasan por LA MISMA funcion (`bloque_en_vivo`), asi que el numero es identico
venga de donde venga: consolidar es literalmente guardar lo que la pantalla
habria calculado.

CUANDO UN DIA PASADO CAMBIA. Una devolucion, una factura tardia, un asiento
manual con fecha de ayer: `invalidar_dia` borra ese dia del mart y la
proxima lectura lo calcula en vivo; la noche siguiente se vuelve a guardar.
Nunca se corrige una cifra del mart a mano: se recalcula entera.

POR QUE EN PYTHON Y NO EN UN PROCEDIMIENTO DE POSTGRESQL. Se penso. Pero
la definicion de "venta del dia" vive aqui (devueltas fuera, IVA desglosado
con la alicuota de cada pedido, envios que no son "sin receta", mediana...)
y duplicarla en SQL era garantizar que las dos copias terminaran diciendo
cosas distintas. El costo que importa --leer el historico entero-- se paga
igual una sola vez por dia y por local, que es lo que se buscaba.
"""
from __future__ import annotations

import datetime
import json
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload, selectinload

from . import impuestos, models, seed
from .database import SessionLocal
from .timeutils import ahora, hoy, inicio_del_dia

log = logging.getLogger("erp.consolidacion")

# Sube cuando cambie QUE se guarda o COMO se calcula: los dias guardados con
# una version vieja se vuelven a consolidar la noche siguiente.
VERSION = 1

# A que hora del local corre la consolidacion nocturna.
HORA_NOCTURNA = datetime.time(3, 30)

# Cuantos dias hacia atras se mira buscando dias sin consolidar. Un local
# nuevo no tiene mas; uno viejo no necesita mas: lo anterior ya se guardo.
DIAS_HACIA_ATRAS = 400

# Claves de `DM_FACT120_VEN_DIA_DET.tipo`.
METODO, HORA, CALOR, CATEGORIA, PRODUCTO, OPERADOR, PUNTO = (
    "metodo", "hora", "calor", "categoria", "producto", "operador", "punto",
)


# ─────────────────────────────────────────────────────────────────────────────
# El bloque: los numeros de un tramo, vengan del mart o de los pedidos
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class Grupo:
    ventas: float = 0.0
    pedidos: int = 0
    unidades: int = 0
    costo: float = 0.0
    nombre: str = ""
    sin_receta: bool = False

    def sumar(self, otro: "Grupo") -> None:
        self.ventas += otro.ventas
        self.pedidos += otro.pedidos
        self.unidades += otro.unidades
        self.costo += otro.costo
        # El nombre mas reciente manda: si el producto se renombro, es el que
        # el dueño reconoce hoy.
        if otro.nombre:
            self.nombre = otro.nombre
        self.sin_receta = self.sin_receta or otro.sin_receta


@dataclass
class Bloque:
    """Todo lo que Reportes y Ventas necesitan de un tramo de tiempo."""

    ventas: float = 0.0
    ventas_bs: float = 0.0
    iva_cobrado: float = 0.0
    pedidos: int = 0
    unidades: int = 0
    costo_items: float = 0.0
    # Los totales de cada pedido cobrado: para la mediana exacta y para saber
    # si uno solo se llevo el dia.
    totales: List[float] = field(default_factory=list)
    mayor: Optional[Tuple[int, float]] = None  # (numero, total)
    anulados: int = 0
    valor_anulado: float = 0.0
    devoluciones: int = 0
    valor_devuelto: float = 0.0
    facturadas: int = 0
    valor_facturado: float = 0.0
    con_descuento: int = 0
    valor_descuentos: float = 0.0
    # Ventas y pedidos por dia natural (la serie por dias/semanas/meses).
    por_dia: Dict[datetime.date, Grupo] = field(default_factory=dict)
    # Los detalles, por tipo y clave.
    por_metodo: Dict[str, Grupo] = field(default_factory=dict)
    por_hora: Dict[str, Grupo] = field(default_factory=dict)       # "HH"
    calor: Dict[str, Grupo] = field(default_factory=dict)          # "d-HH"
    por_categoria: Dict[str, Grupo] = field(default_factory=dict)
    productos: Dict[str, Grupo] = field(default_factory=dict)      # "v:<id>" | "l:<nombre>"
    por_operador: Dict[str, Grupo] = field(default_factory=dict)
    por_punto: Dict[str, Grupo] = field(default_factory=dict)

    def sumar(self, otro: "Bloque") -> None:
        self.ventas += otro.ventas
        self.ventas_bs += otro.ventas_bs
        self.iva_cobrado += otro.iva_cobrado
        self.pedidos += otro.pedidos
        self.unidades += otro.unidades
        self.costo_items += otro.costo_items
        self.totales.extend(otro.totales)
        if otro.mayor and (self.mayor is None or otro.mayor[1] > self.mayor[1]):
            self.mayor = otro.mayor
        self.anulados += otro.anulados
        self.valor_anulado += otro.valor_anulado
        self.devoluciones += otro.devoluciones
        self.valor_devuelto += otro.valor_devuelto
        self.facturadas += otro.facturadas
        self.valor_facturado += otro.valor_facturado
        self.con_descuento += otro.con_descuento
        self.valor_descuentos += otro.valor_descuentos
        for mio, suyo in (
            (self.por_dia, otro.por_dia), (self.por_metodo, otro.por_metodo),
            (self.por_hora, otro.por_hora), (self.calor, otro.calor),
            (self.por_categoria, otro.por_categoria), (self.productos, otro.productos),
            (self.por_operador, otro.por_operador), (self.por_punto, otro.por_punto),
        ):
            for clave, g in suyo.items():
                mio.setdefault(clave, Grupo(nombre=g.nombre)).sumar(g)

    def redondear(self) -> "Bloque":
        for nombre in ("ventas", "ventas_bs", "iva_cobrado", "costo_items", "valor_anulado",
                       "valor_devuelto", "valor_facturado", "valor_descuentos"):
            setattr(self, nombre, round(getattr(self, nombre), 2))
        for d in (self.por_dia, self.por_metodo, self.por_hora, self.calor,
                  self.por_categoria, self.productos, self.por_operador, self.por_punto):
            for g in d.values():
                g.ventas = round(g.ventas, 2)
                g.costo = round(g.costo, 2)
        return self


def _grupo(d: Dict[str, Grupo], clave: str, nombre: str = "") -> Grupo:
    g = d.get(clave)
    if g is None:
        g = d[clave] = Grupo(nombre=nombre or clave)
    elif nombre:
        g.nombre = nombre
    return g


# ─────────────────────────────────────────────────────────────────────────────
# El calculo en vivo: la unica definicion de "los numeros de un tramo"
# ─────────────────────────────────────────────────────────────────────────────


def pedidos_pagados(db: Session, inicio: datetime.datetime, fin: datetime.datetime):
    """Ventas efectivas del periodo. Las devueltas no cuentan: el cliente
    trajo la comida de vuelta, asi que no hubo venta."""
    return (
        db.query(models.Pedido)
        .options(
            selectinload(models.Pedido.items),
            selectinload(models.Pedido.pagos),
            joinedload(models.Pedido.operador_rel),
            joinedload(models.Pedido.punto_venta_rel),
        )
        .filter(
            models.Pedido.estado == "pagado",
            models.Pedido.devuelto.is_(False),
            models.Pedido.cerrado_en >= inicio,
            models.Pedido.cerrado_en < fin,
        )
        .all()
    )


def devoluciones(db: Session, inicio: datetime.datetime, fin: datetime.datetime):
    """Por la fecha en que se DEVOLVIERON: la plata salio de la caja ese dia."""
    return (
        db.query(models.Pedido)
        .filter(
            models.Pedido.devuelto.is_(True),
            models.Pedido.fecha_devolucion >= inicio,
            models.Pedido.fecha_devolucion < fin,
        )
        .all()
    )


def pedidos_anulados(db: Session, inicio: datetime.datetime, fin: datetime.datetime):
    return (
        db.query(models.Pedido)
        .filter(
            models.Pedido.estado == "anulado",
            models.Pedido.creado_en >= inicio,
            models.Pedido.creado_en < fin,
        )
        .all()
    )


def _categoria_de_variantes(db: Session, ids: Iterable[int]) -> Dict[int, str]:
    ids = list(ids)
    if not ids:
        return {}
    variantes = (
        db.query(models.Variante)
        .options(joinedload(models.Variante.producto).joinedload(models.Producto.categoria))
        .filter(models.Variante.id.in_(ids))
        .all()
    )
    salida = {}
    for v in variantes:
        cat = v.producto.categoria if v.producto else None
        salida[v.id] = cat.nombre if cat else "Sin categoría"
    return salida


def bloque_en_vivo(db: Session, inicio: datetime.datetime, fin: datetime.datetime) -> Bloque:
    """Los numeros de [inicio, fin) leyendo los pedidos. Es lo que se guarda
    al consolidar y lo que se calcula para hoy: la misma cosa."""
    b = Bloque()
    pedidos = pedidos_pagados(db, inicio, fin)
    servicios = seed.variantes_de_servicio(db)
    categoria_de = _categoria_de_variantes(
        db, {i.variante_id for p in pedidos for i in p.items if i.variante_id is not None}
    )

    for p in pedidos:
        b.ventas += p.total
        b.ventas_bs += p.total * (p.tasa_bcv or 0)
        b.pedidos += 1
        b.totales.append(round(p.total, 2))
        if b.mayor is None or p.total > b.mayor[1]:
            b.mayor = (p.numero, round(p.total, 2))
        if p.facturado:
            _base, iva = impuestos.desglosar(p.total, p.tasa_iva or impuestos.IVA_DEFAULT)
            b.iva_cobrado += iva
            b.facturadas += 1
            b.valor_facturado += p.total
        if (p.descuento or 0) > 0:
            b.con_descuento += 1
            b.valor_descuentos += p.descuento or 0

        cuando = p.cerrado_en
        dia = _grupo(b.por_dia, cuando.date().isoformat())  # type: ignore[arg-type]
        dia.ventas += p.total
        dia.pedidos += 1
        hora = _grupo(b.por_hora, f"{cuando.hour:02d}")
        hora.ventas += p.total
        hora.pedidos += 1
        # Cuando ENTRAN los clientes: por la hora en que se tomo el pedido,
        # que es lo que sirve para armar turnos.
        t = p.creado_en or cuando
        celda = _grupo(b.calor, f"{t.weekday()}-{t.hour:02d}")
        celda.ventas += p.total
        celda.pedidos += 1

        # Por pago y no por pedido: una venta mixta se reparte entre metodos.
        for pago in p.pagos:
            m = _grupo(b.por_metodo, pago.metodo)
            m.ventas += pago.monto
            m.pedidos += 1
        op = _grupo(b.por_operador, p.operador or "Sin asignar")
        op.ventas += p.total
        op.pedidos += 1
        pv = _grupo(b.por_punto, p.punto_venta or "Sin asignar")
        pv.ventas += p.total
        pv.pedidos += 1

        categorias_del_pedido = set()
        for i in p.items:
            # Lo regalado no entra al ranking de productos ni al costo de lo
            # vendido: vendio cero y su costo esta en gastos (6035). Se mira
            # aparte, en Perdidas.
            if i.cortesia:
                continue
            b.unidades += i.cantidad
            b.costo_items += (i.costo_unitario or 0) * i.cantidad
            clave = f"v:{i.variante_id}" if i.variante_id is not None else f"l:{i.nombre}"
            prod = _grupo(b.productos, clave, i.nombre)
            prod.unidades += i.cantidad
            prod.ventas += i.precio_unitario * i.cantidad
            prod.costo += (i.costo_unitario or 0) * i.cantidad
            # Lo que decide si el margen es confiable es si ESA venta tuvo
            # costo. Un servicio (el envio) cuesta cero de verdad.
            if not (i.costo_unitario or 0) and i.variante_id not in servicios:
                prod.sin_receta = True
            nombre_cat = (
                "Venta libre" if i.variante_id is None
                else categoria_de.get(i.variante_id, "Sin categoría")
            )
            cat = _grupo(b.por_categoria, nombre_cat)
            cat.ventas += i.precio_unitario * i.cantidad
            cat.unidades += i.cantidad
            categorias_del_pedido.add(nombre_cat)
        for nombre_cat in categorias_del_pedido:
            b.por_categoria[nombre_cat].pedidos += 1

    for p in pedidos_anulados(db, inicio, fin):
        b.anulados += 1
        b.valor_anulado += p.total
    for p in devoluciones(db, inicio, fin):
        b.devoluciones += 1
        b.valor_devuelto += p.total
    return b.redondear()


# Las claves de `por_dia` son fechas ISO para que el bloque se pueda guardar
# y volver a leer sin convertir; estas dos ayudan a las pantallas.
def fecha_de_clave(clave: str) -> datetime.date:
    return datetime.date.fromisoformat(clave)


# ─────────────────────────────────────────────────────────────────────────────
# Guardar y leer el mart
# ─────────────────────────────────────────────────────────────────────────────

_TIPOS = (
    (METODO, "por_metodo"), (HORA, "por_hora"), (CALOR, "calor"),
    (CATEGORIA, "por_categoria"), (PRODUCTO, "productos"),
    (OPERADOR, "por_operador"), (PUNTO, "por_punto"),
)


def _borrar_dia(db: Session, fecha: datetime.date) -> None:
    db.query(models.DmVentaDiaDet).filter(models.DmVentaDiaDet.fecha == fecha).delete()
    db.query(models.DmCuentaDia).filter(models.DmCuentaDia.fecha == fecha).delete()
    db.query(models.DmVentaDia).filter(models.DmVentaDia.fecha == fecha).delete()


def consolidar_dia(db: Session, fecha: datetime.date) -> models.DmVentaDia:
    """Calcula el dia entero y lo guarda, pisando lo que hubiera. Un dia solo
    se consolida si ya termino: hoy cambia a cada minuto."""
    if fecha >= hoy():
        raise ValueError(f"{fecha} no ha terminado: no se consolida")
    inicio = inicio_del_dia(fecha)
    fin = inicio + datetime.timedelta(days=1)
    b = bloque_en_vivo(db, inicio, fin)

    _borrar_dia(db, fecha)
    fila = models.DmVentaDia(
        fecha=fecha,
        version=VERSION,
        consolidado_en=ahora(),
        ventas=b.ventas,
        ventas_bs=b.ventas_bs,
        iva_cobrado=b.iva_cobrado,
        pedidos=b.pedidos,
        unidades=b.unidades,
        costo_items=b.costo_items,
        totales_json=json.dumps(sorted(b.totales)),
        mayor_numero=b.mayor[0] if b.mayor else None,
        mayor_total=b.mayor[1] if b.mayor else None,
        anulados=b.anulados,
        valor_anulado=b.valor_anulado,
        devoluciones=b.devoluciones,
        valor_devuelto=b.valor_devuelto,
        facturadas=b.facturadas,
        valor_facturado=b.valor_facturado,
        con_descuento=b.con_descuento,
        valor_descuentos=b.valor_descuentos,
    )
    db.add(fila)
    for tipo, atributo in _TIPOS:
        for clave, g in getattr(b, atributo).items():
            db.add(
                models.DmVentaDiaDet(
                    fecha=fecha, tipo=tipo, clave=clave, nombre=g.nombre,
                    ventas=g.ventas, pedidos=g.pedidos, unidades=g.unidades,
                    costo=g.costo, sin_receta=g.sin_receta,
                )
            )

    # La contabilidad del dia: debe y haber de cada cuenta que se movio.
    sumas = (
        db.query(
            models.MovimientoContable.cuenta_id,
            func.coalesce(func.sum(models.MovimientoContable.debe), 0.0),
            func.coalesce(func.sum(models.MovimientoContable.haber), 0.0),
        )
        .join(models.AsientoContable)
        .filter(models.AsientoContable.fecha >= inicio, models.AsientoContable.fecha < fin)
        .group_by(models.MovimientoContable.cuenta_id)
        .all()
    )
    for cuenta_id, debe, haber in sumas:
        db.add(
            models.DmCuentaDia(
                fecha=fecha, cuenta_id=cuenta_id,
                debe=round(float(debe or 0), 2), haber=round(float(haber or 0), 2),
            )
        )
    db.commit()
    _olvidar_cache(db)
    return fila


def invalidar_dia(db: Session, fecha) -> None:
    """Un dia pasado cambio (devolucion, factura tardia, asiento con fecha de
    ayer): se borra del mart y se vuelve a calcular en vivo hasta que la
    noche lo guarde de nuevo. No hace commit: va dentro de la transaccion
    de quien lo cambio."""
    if fecha is None:
        return
    if isinstance(fecha, datetime.datetime):
        fecha = fecha.date()
    if fecha >= hoy():
        return
    _borrar_dia(db, fecha)
    _olvidar_cache(db)


def dias_consolidados(db: Session, desde: datetime.date, hasta_exclusivo: datetime.date) -> set:
    """Las fechas con fila en el mart dentro de [desde, hasta). Se recuerda en
    la sesion: el balance general lo pregunta una vez por cuenta."""
    cache = db.info.setdefault("dm_dias", {})
    clave = (desde, hasta_exclusivo)
    if clave not in cache:
        filas = (
            db.query(models.DmVentaDia.fecha)
            .filter(models.DmVentaDia.fecha >= desde, models.DmVentaDia.fecha < hasta_exclusivo)
            .all()
        )
        cache[clave] = {f for (f,) in filas}
    return cache[clave]


def _olvidar_cache(db: Session) -> None:
    db.info.pop("dm_dias", None)


def partir_rango(
    db: Session, inicio: Optional[datetime.datetime], fin: Optional[datetime.datetime]
) -> Tuple[List[datetime.date], List[Tuple[Optional[datetime.datetime], Optional[datetime.datetime]]]]:
    """Que parte del rango esta en el mart y que parte hay que calcular.

    Devuelve (dias consolidados, tramos vivos). Los tramos vivos son los
    huecos: los dias sin fila (hoy siempre, y cualquier dia invalidado o que
    la noche no alcanzo), y --con `inicio` abierto-- todo lo anterior al
    primer dia consolidado, por si el local viene de antes del mart.
    """
    manana = inicio_del_dia(hoy()) + datetime.timedelta(days=1)
    tope = min(fin, manana) if fin is not None else manana
    if inicio is None:
        primero = db.query(func.min(models.DmVentaDia.fecha)).scalar()
        if primero is None:
            return [], [(None, fin)]
        desde_dia = primero
    else:
        desde_dia = inicio.date()
        if inicio != inicio_del_dia(desde_dia):
            # Un rango que arranca a media tarde no cubre ese dia entero.
            desde_dia += datetime.timedelta(days=1)

    hasta_dia = tope.date()  # exclusivo: solo dias que terminan antes de `tope`
    consolidados = sorted(
        d for d in dias_consolidados(db, desde_dia, hasta_dia) if d < hoy()
    )
    tramos: List[Tuple[Optional[datetime.datetime], Optional[datetime.datetime]]] = []
    cursor = inicio  # None = abierto hacia atras
    for d in consolidados:
        arranque = inicio_del_dia(d)
        if cursor is None or cursor < arranque:
            tramos.append((cursor, arranque))
        cursor = arranque + datetime.timedelta(days=1)
    if fin is None or cursor is None or cursor < fin:
        tramos.append((cursor, fin))
    return consolidados, tramos


def bloque_desde_mart(db: Session, dias: List[datetime.date]) -> Bloque:
    b = Bloque()
    if not dias:
        return b
    desde, hasta = min(dias), max(dias) + datetime.timedelta(days=1)
    filas = (
        db.query(models.DmVentaDia)
        .filter(models.DmVentaDia.fecha >= desde, models.DmVentaDia.fecha < hasta)
        .all()
    )
    quiero = set(dias)
    for f in filas:
        if f.fecha not in quiero:
            continue
        b.ventas += f.ventas
        b.ventas_bs += f.ventas_bs
        b.iva_cobrado += f.iva_cobrado
        b.pedidos += f.pedidos
        b.unidades += f.unidades
        b.costo_items += f.costo_items
        b.totales.extend(json.loads(f.totales_json or "[]"))
        if f.mayor_total is not None and (b.mayor is None or f.mayor_total > b.mayor[1]):
            b.mayor = (f.mayor_numero, f.mayor_total)
        b.anulados += f.anulados
        b.valor_anulado += f.valor_anulado
        b.devoluciones += f.devoluciones
        b.valor_devuelto += f.valor_devuelto
        b.facturadas += f.facturadas
        b.valor_facturado += f.valor_facturado
        b.con_descuento += f.con_descuento
        b.valor_descuentos += f.valor_descuentos
        if f.pedidos:
            dia = _grupo(b.por_dia, f.fecha.isoformat())
            dia.ventas += f.ventas
            dia.pedidos += f.pedidos

    destino = {tipo: getattr(b, atributo) for tipo, atributo in _TIPOS}
    detalles = (
        db.query(models.DmVentaDiaDet)
        .filter(models.DmVentaDiaDet.fecha >= desde, models.DmVentaDiaDet.fecha < hasta)
        .all()
    )
    for d in detalles:
        if d.fecha not in quiero or d.tipo not in destino:
            continue
        g = _grupo(destino[d.tipo], d.clave, d.nombre)
        g.ventas += d.ventas
        g.pedidos += d.pedidos
        g.unidades += d.unidades
        g.costo += d.costo
        g.sin_receta = g.sin_receta or bool(d.sin_receta)
    return b.redondear()


def bloque_para(db: Session, inicio: datetime.datetime, fin: datetime.datetime) -> Bloque:
    """Los numeros de [inicio, fin): del mart lo que ya esta, en vivo el resto."""
    dias, tramos = partir_rango(db, inicio, fin)
    b = bloque_desde_mart(db, dias)
    for t_inicio, t_fin in tramos:
        b.sumar(bloque_en_vivo(db, t_inicio or inicio, t_fin or fin))
    return b.redondear()


def sumas_de_cuenta_por_mart(
    db: Session, cuenta_id: int, inicio: Optional[datetime.datetime], fin: Optional[datetime.datetime]
) -> Tuple[float, float, List[Tuple[Optional[datetime.datetime], Optional[datetime.datetime]]]]:
    """(debe, haber) de una cuenta en los dias ya consolidados del rango, y
    los tramos que `contabilidad.sumas_de_cuenta` todavia tiene que sumar en
    vivo."""
    dias, tramos = partir_rango(db, inicio, fin)
    if not dias:
        return 0.0, 0.0, tramos
    debe, haber = (
        db.query(
            func.coalesce(func.sum(models.DmCuentaDia.debe), 0.0),
            func.coalesce(func.sum(models.DmCuentaDia.haber), 0.0),
        )
        .filter(
            models.DmCuentaDia.cuenta_id == cuenta_id,
            models.DmCuentaDia.fecha >= min(dias),
            models.DmCuentaDia.fecha <= max(dias),
        )
        .one()
    )
    return round(float(debe or 0), 2), round(float(haber or 0), 2), tramos


def ultima_consolidacion(db: Session) -> Optional[datetime.datetime]:
    return db.query(func.max(models.DmVentaDia.consolidado_en)).scalar()


# ─────────────────────────────────────────────────────────────────────────────
# La corrida nocturna
# ─────────────────────────────────────────────────────────────────────────────


def dias_pendientes(db: Session) -> List[datetime.date]:
    """Los dias terminados que faltan en el mart o que se guardaron con una
    version vieja del calculo, desde el primer dato del local."""
    primer_pedido = db.query(func.min(models.Pedido.creado_en)).scalar()
    primer_asiento = db.query(func.min(models.AsientoContable.fecha)).scalar()
    candidatos = [d for d in (primer_pedido, primer_asiento) if d is not None]
    if not candidatos:
        return []
    desde = max(min(candidatos).date(), hoy() - datetime.timedelta(days=DIAS_HACIA_ATRAS))
    al_dia = {
        f.fecha
        for f in db.query(models.DmVentaDia.fecha, models.DmVentaDia.version)
        .filter(models.DmVentaDia.fecha >= desde)
        .all()
        if f.version == VERSION
    }
    pendientes = []
    d = desde
    while d < hoy():
        if d not in al_dia:
            pendientes.append(d)
        d += datetime.timedelta(days=1)
    return pendientes


def consolidar_pendientes(db: Session) -> int:
    """Consolida todo lo que falte. Devuelve cuantos dias guardo."""
    cuantos = 0
    for fecha in dias_pendientes(db):
        consolidar_dia(db, fecha)
        cuantos += 1
    if cuantos:
        log.info("consolidacion: %d dia(s) guardados en el mart", cuantos)
    return cuantos


def _segundos_hasta_la_proxima(momento: Optional[datetime.datetime] = None) -> float:
    """Cuanto falta para las 03:30 de hoy o de mañana, lo que venga primero."""
    momento = momento or ahora()
    proxima = datetime.datetime.combine(momento.date(), HORA_NOCTURNA)
    if proxima <= momento:
        proxima += datetime.timedelta(days=1)
    return (proxima - momento).total_seconds()


def _correr_una_vez(motivo: str) -> None:
    db = SessionLocal()
    try:
        n = consolidar_pendientes(db)
        log.info("consolidacion (%s): %d dia(s)", motivo, n)
    except Exception as e:  # nunca debe tumbar el servidor
        log.warning("fallo la consolidacion (%s): %s", motivo, e)
    finally:
        db.close()


def _loop():
    # Al arrancar se espera un minuto (que el servidor termine de levantar) y
    # se pone al dia lo que la noche no alcanzo: un servidor que estuvo
    # apagado a las 03:30 no se queda sin mart hasta la noche siguiente.
    time.sleep(60)
    _correr_una_vez("arranque")
    while True:
        time.sleep(_segundos_hasta_la_proxima())
        _correr_una_vez("nocturna")


def iniciar_consolidacion():
    hilo = threading.Thread(target=_loop, daemon=True, name="consolidacion")
    hilo.start()
