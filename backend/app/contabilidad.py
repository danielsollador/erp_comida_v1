"""Contabilidad basica de partida doble, inspirada en el plan de cuentas de Odoo
pero recortada a lo que un negocio de comida rapida realmente necesita.

Todo se lleva en USD (la moneda funcional del negocio): es la que fija los
precios y con la que se compran los insumos. Bolivares es solo la conversion
que se le muestra al cliente en el punto de venta (ver `tasas.py`), no una
segunda contabilidad - llevar dos monedas en los libros duplicaria la
complejidad sin que este negocio lo necesite.

No hay asiento de cierre de ejercicio: los saldos de Ingresos/Costos/Gastos se
acumulan sin resetear, y el Balance General los sube a Patrimonio como
"utilidad acumulada no distribuida" al vuelo (ver `balance_general`). Es lo
que hace cualquier sistema chico que no corta el año fiscal por software.
"""

import logging
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from . import impuestos, models
from .timeutils import ahora

log = logging.getLogger("erp.contabilidad")

# codigo, nombre, tipo, naturaleza
PLAN_DE_CUENTAS = [
    ("1010", "Caja (efectivo)", "activo", "deudora"),
    ("1020", "Banco / pagos electronicos", "activo", "deudora"),
    ("1030", "IVA credito fiscal", "activo", "deudora"),
    ("1040", "Inventario de insumos", "activo", "deudora"),
    ("1050", "Equipos y mobiliario", "activo", "deudora"),
    ("2010", "Cuentas por pagar a proveedores", "pasivo", "acreedora"),
    ("2020", "Impuestos por pagar", "pasivo", "acreedora"),
    ("2030", "IVA debito fiscal", "pasivo", "acreedora"),
    ("3010", "Capital del propietario", "patrimonio", "acreedora"),
    ("3020", "Utilidades retenidas", "patrimonio", "acreedora"),
    ("4010", "Ventas", "ingreso", "acreedora"),
    ("5010", "Costo de ventas (insumos)", "costo", "deudora"),
    ("6010", "Gastos operativos", "gasto", "deudora"),
    ("6020", "Perdida por merma", "gasto", "deudora"),
]

# Metodo de pago del pedido -> cuenta donde entra el dinero.
CUENTA_POR_METODO_PAGO = {
    "Efectivo": "1010",
    "Tarjeta": "1020",
    "Pago movil": "1020",
    "Transferencia": "1020",
}

# Categoria de la factura de compra -> cuenta donde se contabiliza el gasto/activo.
CUENTA_POR_CATEGORIA_COMPRA = {
    "Insumos": "1040",
    "Servicios": "6010",
    "Activos": "1050",
    "Otros": "6010",
}

# Forma de pago de la factura de compra -> cuenta que sale (o la deuda que entra).
CUENTA_PAGO_COMPRA = {
    "Efectivo": "1010",
    "Banco": "1020",
    "Credito": "2010",
}


def seed_plan_de_cuentas(db: Session) -> None:
    """Idempotente: agrega las cuentas que falten sin duplicar las que ya existen.

    Asi una instalacion que arranco antes de que existiera el IVA en el plan
    de cuentas recibe 1030/2030 solas la proxima vez que arranca el backend,
    sin perder ni un asiento de los que ya tenia.
    """
    existentes = {c.codigo for c in db.query(models.CuentaContable).all()}
    agregadas = False
    for codigo, nombre, tipo, naturaleza in PLAN_DE_CUENTAS:
        if codigo in existentes:
            continue
        db.add(models.CuentaContable(codigo=codigo, nombre=nombre, tipo=tipo, naturaleza=naturaleza))
        agregadas = True
    if agregadas:
        db.commit()


def _cuenta(db: Session, codigo: str) -> models.CuentaContable:
    cuenta = (
        db.query(models.CuentaContable).filter(models.CuentaContable.codigo == codigo).first()
    )
    if not cuenta:
        raise ValueError(f"Cuenta contable {codigo} no existe. Revisa el plan de cuentas.")
    return cuenta


def crear_asiento(
    db: Session,
    descripcion: str,
    lineas: List[Tuple[str, float, float]],
    origen: str = "manual",
    referencia_id: Optional[int] = None,
    fecha=None,
) -> models.AsientoContable:
    """lineas: [(codigo_cuenta, debe, haber), ...]. No hace commit."""
    total_debe = round(sum(debe for _, debe, _ in lineas), 2)
    total_haber = round(sum(haber for _, _, haber in lineas), 2)
    if abs(total_debe - total_haber) > 0.01:
        raise ValueError(
            f"Asiento descuadrado: debe {total_debe} != haber {total_haber} ({descripcion})"
        )
    if total_debe == 0:
        raise ValueError(f"Asiento sin monto: {descripcion}")

    asiento = models.AsientoContable(
        fecha=fecha or ahora(), descripcion=descripcion, origen=origen, referencia_id=referencia_id
    )
    db.add(asiento)
    db.flush()

    for codigo, debe, haber in lineas:
        if not debe and not haber:
            continue
        db.add(
            models.MovimientoContable(
                asiento_id=asiento.id, cuenta_id=_cuenta(db, codigo).id, debe=debe, haber=haber
            )
        )
    return asiento


def registrar_venta(db: Session, pedido: models.Pedido) -> None:
    total = round(pedido.total, 2)
    costo = round(sum((i.costo_unitario or 0) * i.cantidad for i in pedido.items), 2)
    cuenta_cobro = CUENTA_POR_METODO_PAGO.get(pedido.metodo_pago or "", "1010")

    if pedido.facturado:
        # Solo lo facturado le debe IVA al fisco. La alicuota ya viene congelada
        # en el pedido (se fija al cobrar) para que un Libro de Ventas de un
        # mes cerrado no cambie si despues sube el IVA.
        base, iva = impuestos.desglosar(total, pedido.tasa_iva or impuestos.IVA_DEFAULT)
        lineas = [(cuenta_cobro, total, 0.0), ("4010", 0.0, base), ("2030", 0.0, iva)]
    else:
        lineas = [(cuenta_cobro, total, 0.0), ("4010", 0.0, total)]

    if costo > 0:
        lineas += [("5010", costo, 0.0), ("1040", 0.0, costo)]

    crear_asiento(
        db,
        f"Venta pedido #{pedido.numero}",
        lineas,
        origen="venta",
        referencia_id=pedido.id,
        fecha=pedido.cerrado_en,
    )


def registrar_gasto(db: Session, gasto: models.Gasto) -> None:
    crear_asiento(
        db,
        f"Gasto: {gasto.descripcion}",
        [("6010", gasto.monto, 0.0), ("1010", 0.0, gasto.monto)],
        origen="gasto",
        referencia_id=gasto.id,
        fecha=gasto.fecha,
    )


def registrar_compra_insumo(
    db: Session, ingrediente: models.Ingrediente, valor: float, referencia_id: int
) -> None:
    if valor <= 0:
        return  # sin costo informado no hay nada que contabilizar
    crear_asiento(
        db,
        f"Compra de {ingrediente.nombre}",
        [("1040", valor, 0.0), ("1010", 0.0, valor)],
        origen="compra_insumo",
        referencia_id=referencia_id,
    )


def registrar_factura_compra(db: Session, factura: models.FacturaCompra) -> None:
    cuenta_concepto = CUENTA_POR_CATEGORIA_COMPRA.get(factura.categoria, "6010")
    cuenta_pago = CUENTA_PAGO_COMPRA.get(factura.forma_pago, "1010")

    lineas = [(cuenta_concepto, factura.base_imponible, 0.0)]
    if factura.iva > 0:
        lineas.append(("1030", factura.iva, 0.0))
    lineas.append((cuenta_pago, 0.0, factura.total))

    crear_asiento(
        db,
        f"Compra: {factura.proveedor_nombre} (fact. {factura.numero_factura})",
        lineas,
        origen="factura_compra",
        referencia_id=factura.id,
        fecha=factura.fecha,
    )


def registrar_merma(db: Session, ingrediente: models.Ingrediente, valor: float, referencia_id: int) -> None:
    if valor <= 0:
        return
    crear_asiento(
        db,
        f"Merma de {ingrediente.nombre}",
        [("6020", valor, 0.0), ("1040", 0.0, valor)],
        origen="merma",
        referencia_id=referencia_id,
    )
