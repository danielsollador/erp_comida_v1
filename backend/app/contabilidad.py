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

import calendar
import datetime
import logging
from typing import List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import impuestos, models
from .timeutils import ahora

log = logging.getLogger("erp.contabilidad")

# codigo, nombre, tipo, naturaleza
PLAN_DE_CUENTAS = [
    ("1010", "Caja en bolivares", "activo", "deudora"),
    # Los billetes verdes son otra gaveta fisica y otro arqueo: mezclarlos con
    # los bolivares en una sola cuenta hacia imposible cuadrar la caja, porque
    # el sistema decia "esperado $10" tanto si habia un billete de $10 como si
    # habia Bs 400.
    ("1011", "Caja en divisas (efectivo $)", "activo", "deudora"),
    ("1015", "Cuentas por cobrar a clientes", "activo", "deudora"),
    ("1020", "Banco / pagos electronicos", "activo", "deudora"),
    # Zelle entra en dolares y no es efectivo -no hay billete que contar en el
    # arqueo-, asi que necesita su propia cuenta y no puede compartir la de
    # 1020 (que es Bs) ni la 1011 (que si se cuenta fisicamente al cerrar).
    ("1021", "Banco USD (Zelle)", "activo", "deudora"),
    ("1030", "IVA credito fiscal", "activo", "deudora"),
    ("1040", "Inventario de insumos", "activo", "deudora"),
    ("1050", "Equipos y mobiliario", "activo", "deudora"),
    # Contra-cuenta de activo (ver CUENTAS_CONTRA): se acredita, asi que su
    # saldo sale negativo y resta del total de activos, como debe presentarse.
    ("1051", "Depreciacion acumulada", "activo", "deudora"),
    ("2010", "Cuentas por pagar a proveedores", "pasivo", "acreedora"),
    ("2020", "Impuestos por pagar", "pasivo", "acreedora"),
    ("2030", "IVA debito fiscal", "pasivo", "acreedora"),
    # La propina es del empleado, no del negocio: entra a la gaveta pero se
    # debe. Sin esta cuenta el cierre la reportaba como sobrante y terminaba
    # engordando la utilidad (y pagando impuesto sobre plata ajena).
    ("2040", "Propinas por entregar", "pasivo", "acreedora"),
    ("3010", "Capital del propietario", "patrimonio", "acreedora"),
    ("3020", "Utilidades retenidas", "patrimonio", "acreedora"),
    # Contra-cuenta de patrimonio (ver CUENTAS_CONTRA): se debita, su saldo
    # sale negativo y resta del patrimonio, que es lo que hace un retiro.
    ("3030", "Retiros del propietario", "patrimonio", "acreedora"),
    ("4010", "Ventas", "ingreso", "acreedora"),
    # Contra-cuenta de ingreso (ver CUENTAS_CONTRA): conserva la venta bruta y
    # muestra aparte cuanto se regalo en rebajas, que es informacion que el
    # dueno necesita y que bajar el precio del menu destruia.
    ("4020", "Descuentos concedidos", "ingreso", "acreedora"),
    ("5010", "Costo de ventas (insumos)", "costo", "deudora"),
    ("6010", "Gastos operativos", "gasto", "deudora"),
    ("6020", "Perdida por merma", "gasto", "deudora"),
    # Lo que consume el personal sale del inventario sin venta, pero no es una
    # perdida: es un costo laboral autorizado. Mezclarlo con la merma
    # contaminaba el indicador que sirve para vigilar desperdicio y robo.
    ("6025", "Consumo del personal", "gasto", "deudora"),
    ("6030", "Faltante / sobrante de caja", "gasto", "deudora"),
    ("6040", "Depreciacion", "gasto", "deudora"),
]

# Cuentas que viven dentro de un grupo pero con el saldo invertido a proposito:
# la depreciacion acumulada es un activo que RESTA, y los retiros del dueno son
# patrimonio que RESTA. Su saldo negativo es correcto y no debe reportarse como
# un descuadre.
CUENTAS_CONTRA = {"1051", "3030", "4020"}

# Metodo de pago del pedido -> cuenta donde entra el dinero.
CUENTA_POR_METODO_PAGO = {
    # "Efectivo" se conserva como sinonimo de bolivares por las ventas que ya
    # estan cargadas: renombrarlo a secas dejaria huerfano todo el historico.
    "Efectivo": "1010",
    "Efectivo Bs": "1010",
    "Efectivo $": "1011",
    "Tarjeta": "1020",
    "Punto de venta": "1020",  # mismo terminal que "Tarjeta"; nombre distinto, misma cuenta
    "Pago movil": "1020",
    "Transferencia": "1020",
    "Banco": "1020",
    "Zelle": "1021",
    # El cliente se lleva la comida y paga despues. No entra plata: nace una
    # cuenta por cobrar. Antes habia que elegir entre no registrar la venta
    # (y descuadrar el inventario) o marcarla cobrada (y descuadrar la caja).
    "Fiado": "1015",
}

# Las gavetas fisicas que se cuentan al cerrar. El resto de los metodos no se
# arquea: su saldo lo dice el banco, no un conteo.
CUENTAS_DE_EFECTIVO = {"1010": "bolivares", "1011": "divisas"}
METODOS_DE_EFECTIVO = {"Efectivo", "Efectivo Bs", "Efectivo $"}

# Todo lo que no es un billete deja un numero de confirmacion en alguna parte
# -el pago movil su codigo, el punto su ticket, el Zelle su comprobante- y sin
# el, reclamar un pago duplicado o un cobro que nunca llego es la palabra del
# cliente contra la del negocio. El efectivo no tiene nada que anotar: un
# billete no trae referencia.
METODOS_CON_REFERENCIA = set(CUENTA_POR_METODO_PAGO) - METODOS_DE_EFECTIVO - {"Fiado"}

# Con que se PAGA algo (un gasto, un retiro, una factura, el IVA, una compra
# suelta): la plata sale de una de las dos gavetas o del banco. Es la misma
# tabla que la de cobros menos el fiado, que no es plata. Se centraliza aca
# porque cada modulo tenia la suya --"Efectivo o Banco"-- y ninguna sabia que
# existia la gaveta de dolares: los verdes entraban por ventas y nunca podian
# salir, asi que 1011 solo crecia y la de bolivares mostraba faltantes cuando
# al proveedor se le pagaba en dolares, que es lo normal en Venezuela.
METODOS_DE_PAGO = {m: c for m, c in CUENTA_POR_METODO_PAGO.items() if m != "Fiado"}


def cuenta_de_pago(metodo: Optional[str], por_defecto: str = "1010") -> str:
    """La cuenta de la que sale la plata segun como se pago."""
    return METODOS_DE_PAGO.get(metodo or "", por_defecto)


def metodo_de_pago_valido(metodo: Optional[str]) -> bool:
    return (metodo or "") in METODOS_DE_PAGO

# Categoria de la factura de compra -> cuenta donde se contabiliza el gasto/activo.
CUENTA_POR_CATEGORIA_COMPRA = {
    "Insumos": "1040",
    "Servicios": "6010",
    "Activos": "1050",
    "Otros": "6010",
}

# Forma de pago de la factura de compra -> cuenta que sale (o la deuda que entra).
CUENTA_PAGO_COMPRA = {
    **METODOS_DE_PAGO,
    "Credito": "2010",
}

# Con que se salda despues una factura que quedo a credito. No incluye
# "Credito" - no se puede pagar una deuda con otra deuda.
CUENTA_LIQUIDACION_CREDITO = dict(METODOS_DE_PAGO)


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


def asiento_de_apertura(db: Session) -> None:
    """Registra el inventario con que arranca el negocio contra su capital.

    Sin esto los libros empiezan en cero mientras el local ya tiene mercancia:
    la primera venta saca costo de una cuenta de inventario vacia y `1040` se
    va a negativo, un activo imposible que ademas el Balance General no
    detecta (cuadra igual, porque la diferencia la absorbe el patrimonio).

    Idempotente: si ya existe un asiento de apertura, no hace nada.
    """
    ya_existe = (
        db.query(models.AsientoContable).filter(models.AsientoContable.origen == "apertura").first()
    )
    if ya_existe:
        return

    valor = round(
        sum(
            (i.stock_actual or 0) * (i.costo_unitario or 0)
            for i in db.query(models.Ingrediente).all()
        ),
        2,
    )
    if valor <= 0:
        return

    crear_asiento(
        db,
        "Apertura: inventario inicial",
        [("1040", valor, 0.0), ("3010", 0.0, valor)],
        origen="apertura",
    )
    db.commit()


def _cuenta(db: Session, codigo: str) -> models.CuentaContable:
    cuenta = (
        db.query(models.CuentaContable).filter(models.CuentaContable.codigo == codigo).first()
    )
    if not cuenta:
        raise ValueError(f"Cuenta contable {codigo} no existe. Revisa el plan de cuentas.")
    return cuenta


class ErrorEjercicioCerrado(ValueError):
    """Se intento tocar un asiento de un año que ya se cerro."""

    def __init__(self, anio: int, que: str = "ese asiento"):
        self.anio = anio
        super().__init__(
            f"El ejercicio {anio} ya esta cerrado y su resultado se llevo a Utilidades "
            f"retenidas: {que} no se puede borrar. Si hay que corregirlo, registra un "
            f"asiento de ajuste en el ejercicio abierto."
        )


def ultimo_ejercicio_cerrado(db: Session) -> Optional[int]:
    """El ultimo año con asiento de cierre, o None si nunca se cerro ninguno."""
    return (
        db.query(func.max(models.AsientoContable.referencia_id))
        .filter(models.AsientoContable.origen == "cierre_ejercicio")
        .scalar()
    )


def asegurar_ejercicio_abierto(db: Session, fecha: Optional[datetime.datetime], que: str) -> None:
    """Para BORRAR: un asiento de un año cerrado no se toca. Los libros de un
    ejercicio cerrado son inamovibles; si no, el resultado que ya se llevo a
    Utilidades retenidas cambiaria sin que ningun asiento lo cuente."""
    if fecha is None:
        return
    cerrado = ultimo_ejercicio_cerrado(db)
    if cerrado is not None and fecha.year <= cerrado:
        raise ErrorEjercicioCerrado(fecha.year, que)


def fecha_contable(db: Session, fecha: Optional[datetime.datetime], descripcion: str):
    """Para ASENTAR: la fecha con la que un asiento entra a los libros.

    Cargar hoy una factura del año pasado, o completar la depreciacion
    atrasada de un equipo, no puede reescribir un ejercicio ya cerrado. El
    asiento cae en el primer instante del ejercicio abierto y la descripcion
    dice de que fecha era, que es como se registra un ajuste de ejercicios
    anteriores: en el periodo en que se descubre, no en el que ya se firmo.
    """
    fecha = fecha or ahora()
    cerrado = ultimo_ejercicio_cerrado(db)
    if cerrado is not None and fecha.year <= cerrado:
        nueva = datetime.datetime(cerrado + 1, 1, 1, 0, 0, 0)
        return nueva, (
            f"{descripcion} (corresponde al {fecha:%Y-%m-%d}; ejercicio {fecha.year} cerrado)"
        )
    return fecha, descripcion


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

    # El propio asiento de cierre se fecha el 31 de diciembre del año que
    # cierra; todo lo demas respeta los ejercicios ya cerrados.
    if origen != "cierre_ejercicio":
        fecha, descripcion = fecha_contable(db, fecha, descripcion)

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


def _lineas_de_cobro(
    pedido: models.Pedido,
    signo: float = 1.0,
    reparto_fiado: Optional[List[Tuple[str, float]]] = None,
) -> List[Tuple[str, float, float]]:
    """Una linea por cada forma en que se pago, a su cuenta correspondiente.

    Un pago mixto entra parte a caja y parte a banco: mandarlo todo a una sola
    cuenta hacia que el cierre de caja mostrara un faltante inexistente.

    El vuelto se registra aparte cuando sale por una gaveta distinta de la que
    recibio la plata: pagar en divisas y dar el vuelto en bolivares mueve dos
    cajas, y si solo se anota el neto ninguna de las dos cuadra al cerrar.

    `reparto_fiado` sirve al REVERTIR: dice donde esta parada hoy la plata de
    un pedido fiado. Lo ya cobrado sale de la cuenta por donde entro -no de la
    cuenta por cobrar, que quedaria en negativo, como si el cliente nos debiera
    menos que nada- y lo que aun se debe simplemente se deja de deber. Con
    abonos parciales son las dos cosas a la vez: por eso es una lista de
    (cuenta, monto) y no una sola cuenta.
    """
    lineas = []
    fiado_repartido = False
    for pago in pedido.pagos:
        if pago.metodo == "Fiado" and reparto_fiado is not None:
            # El reparto cubre TODO lo fiado del pedido de una vez, asi que si
            # hubiera mas de una linea fiada solo se emite en la primera.
            if not fiado_repartido:
                for cuenta_r, monto_r in reparto_fiado:
                    if round(monto_r, 2) <= 0:
                        continue
                    lineas.append(
                        (cuenta_r, round(monto_r, 2), 0.0) if signo > 0
                        else (cuenta_r, 0.0, round(monto_r, 2))
                    )
                fiado_repartido = True
            continue

        cuenta = CUENTA_POR_METODO_PAGO.get(pago.metodo, "1010")
        vuelto = round(pago.vuelto_monto or 0, 2)
        cuenta_vuelto = CUENTA_POR_METODO_PAGO.get(pago.vuelto_metodo or pago.metodo, cuenta)

        if vuelto > 0 and cuenta_vuelto != cuenta:
            entra = round(pago.monto + vuelto, 2)
            if signo > 0:
                lineas.append((cuenta, entra, 0.0))
                lineas.append((cuenta_vuelto, 0.0, vuelto))
            else:
                lineas.append((cuenta, 0.0, entra))
                lineas.append((cuenta_vuelto, vuelto, 0.0))
            continue

        monto = round(pago.monto, 2)
        lineas.append((cuenta, monto, 0.0) if signo > 0 else (cuenta, 0.0, monto))
    return lineas


def _lineas_ingreso_venta(pedido: models.Pedido, facturado: bool) -> List[Tuple[str, float, float]]:
    """La parte de la venta que cambia segun si esta facturada o no: el resto
    del asiento (caja, propina, costo) es igual facture o no. Aparte para que
    `registrar_facturacion_tardia` pueda pedir la version "antes" y la version
    "despues" sin repetir la aritmetica.
    """
    total = round(pedido.total, 2)
    descuento = round(pedido.descuento or 0, 2)
    # La venta se reconoce BRUTA y el descuento se muestra aparte: asi el dueno
    # puede ver cuanto regalo en rebajas, que es informacion que se perdia
    # cuando la unica via era bajarle el precio al menu.
    bruto = round(total + descuento, 2)
    if facturado:
        # Solo lo facturado le debe IVA al fisco, y sobre lo que de verdad se
        # cobro: el IVA se desglosa del neto, no del precio de lista. La
        # alicuota ya viene congelada en el pedido (se fija al facturar) para
        # que un Libro de Ventas de un mes cerrado no cambie si despues sube
        # el IVA.
        base, iva = impuestos.desglosar(total, pedido.tasa_iva or impuestos.IVA_DEFAULT)
        base_bruta, _ = impuestos.desglosar(bruto, pedido.tasa_iva or impuestos.IVA_DEFAULT)
        lineas = [("4010", 0.0, base_bruta), ("2030", 0.0, iva)]
        if descuento > 0:
            # El descuento se reconoce neto de IVA, porque 4010 tambien es
            # neto: la diferencia entre las dos bases es exactamente lo que
            # cuadra el asiento.
            lineas += [("4020", round(base_bruta - base, 2), 0.0)]
    else:
        lineas = [("4010", 0.0, bruto)]
        if descuento > 0:
            lineas += [("4020", descuento, 0.0)]
    return lineas


def registrar_venta(db: Session, pedido: models.Pedido) -> None:
    propina = round(pedido.propina or 0, 2)
    costo = round(sum((i.costo_unitario or 0) * i.cantidad for i in pedido.items), 2)

    lineas = _lineas_de_cobro(pedido)

    # La propina entro a la gaveta con el resto del pago, pero no es venta: se
    # le debe al empleado hasta que se le entrega.
    if propina > 0:
        lineas += [("2040", 0.0, propina)]

    lineas += _lineas_ingreso_venta(pedido, bool(pedido.facturado))

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


def registrar_ajuste_edicion(
    db: Session,
    pedido: models.Pedido,
    delta_venta: float,
    delta_costo: float,
    pagos: List[Tuple[str, float]],
    costo_perdido: float = 0.0,
) -> None:
    """Corrige una venta YA COBRADA que se edito: solo lo que cambio.

    No se reescribe el asiento de la venta ni se anula para volver a hacerlo.
    Un asiento contable no se borra --si se pudiera, la contabilidad no serviria
    de nada-- asi que el ajuste entra como lo que es: un segundo asiento, por la
    diferencia, con su propia fecha. El dia que alguien pregunte por que esa
    venta cambio de monto, la respuesta esta escrita.

    Son dos movimientos independientes y cada uno cuadra por su lado:

      la plata   la diferencia entra (o sale) por la gaveta que diga el cajero
                 y se reconoce contra el ingreso (4010).
      el costo   quitar o agregar un renglon cambia los insumos que se
                 consumieron, y eso mueve costo de ventas (5010) contra
                 inventario (1040) aunque el precio no se haya movido un centavo
                 -- cambiar una empanada por otra del mismo precio pero distinta
                 receta es exactamente ese caso.

    Sin IVA a proposito: el router no deja editar el monto de una venta
    facturada, porque cambiarle el total a una factura ya emitida se corrige con
    una nota de credito y no retocando el Libro de Ventas.
    """
    delta_venta = round(delta_venta, 2)
    delta_costo = round(delta_costo, 2)
    lineas: List[Tuple[str, float, float]] = []

    if delta_venta > 0:
        for metodo, monto in pagos:
            lineas.append((cuenta_de_pago(metodo), round(monto, 2), 0.0))
        lineas.append(("4010", 0.0, delta_venta))
    elif delta_venta < 0:
        for metodo, monto in pagos:
            lineas.append((cuenta_de_pago(metodo), 0.0, round(monto, 2)))
        lineas.append(("4010", -delta_venta, 0.0))

    if delta_costo > 0:
        lineas += [("5010", delta_costo, 0.0), ("1040", 0.0, delta_costo)]
    elif delta_costo < 0:
        # Baja el costo de ventas, pero el contrapeso depende de donde quedo la
        # comida: si nunca se cocino, los insumos volvieron al deposito (1040);
        # si ya estaba hecha, se boto y es perdida por merma (6020). Mandarlo
        # todo a inventario haria aparecer en los libros comida que esta en la
        # basura, y el arqueo del deposito dejaria de cuadrar.
        baja = -delta_costo
        botado = min(round(costo_perdido, 2), baja)
        vuelve = round(baja - botado, 2)
        if botado > 0:
            lineas.append(("6020", botado, 0.0))
        if vuelve > 0:
            lineas.append(("1040", vuelve, 0.0))
        lineas.append(("5010", 0.0, baja))

    if not lineas:
        return

    crear_asiento(
        db,
        f"Ajuste por edicion del pedido #{pedido.numero}",
        lineas,
        origen="edicion_pedido",
        referencia_id=pedido.id,
    )


def registrar_facturacion_tardia(db: Session, pedido: models.Pedido) -> None:
    """El pedido ya se cobro y ya tiene su asiento de venta (sin IVA, porque
    en ese momento no se facturo). El dueno decide despues, revisando el
    historico, facturarlo con un numero de su talonario.

    No se reabre el asiento original -un asiento ya posteado no se toca-, se
    postea el AJUSTE: la diferencia entre "como se conto sin factura" y "como
    se cuenta con factura" es sacar del ingreso bruto lo que en realidad era
    IVA y pasarlo a la cuenta por pagar al fisco (2030).

    FECHADO EN LA FECHA DE LA VENTA, no en la de hoy. Se intento al reves y
    descuadraba dos cosas a la vez:

      el IVA   el Libro de Ventas ubica la factura en el mes de la venta
               (`cerrado_en`) y la declaracion del SENIAT se arma con ese
               libro. Si el credito a 2030 caia en el mes en que el dueno
               agarro el talonario, el mayor decia que el IVA nacio en
               septiembre y la declaracion que se debia desde agosto.
      la ganancia  Reportes muestra "ventas cobradas - IVA = ingreso del
               negocio", con las ventas sacadas de los pedidos y el ingreso
               del mayor. Con el ajuste fechado hoy, el mes de la venta
               restaba un IVA que el mayor todavia no habia sacado de 4010
               (ganancia inflada) y el mes de hoy perdia una base que nunca
               vendio (ganancia hundida, a veces negativa).

    El principio de no tocar lo posteado se respeta igual: esto sigue siendo
    un asiento aparte, con su propio `origen`, rastreable. Solo que fechado en
    el periodo al que pertenece el hecho economico. Por eso el router se niega
    a facturar dentro de un mes ya declarado o de un ejercicio ya cerrado: ahi
    si seria reescribir el pasado.
    """
    antes = _lineas_ingreso_venta(pedido, facturado=False)
    despues = _lineas_ingreso_venta(pedido, facturado=True)

    saldos: dict = {}
    for cuenta, debito, credito in antes:
        neto = saldos.get(cuenta, 0.0) - (debito - credito)
        saldos[cuenta] = round(neto, 2)
    for cuenta, debito, credito in despues:
        neto = saldos.get(cuenta, 0.0) + (debito - credito)
        saldos[cuenta] = round(neto, 2)

    lineas = []
    for cuenta, neto in saldos.items():
        if neto > 0:
            lineas.append((cuenta, neto, 0.0))
        elif neto < 0:
            lineas.append((cuenta, 0.0, -neto))
    if not lineas:
        return

    crear_asiento(
        db,
        f"Facturacion tardia del pedido #{pedido.numero}",
        lineas,
        origen="factura_tardia",
        referencia_id=pedido.id,
        fecha=pedido.cerrado_en or ahora(),
    )


def registrar_devolucion(
    db: Session, pedido: models.Pedido, recuperable: bool
) -> None:
    """Deshace una venta cobrada: el cliente trajo la comida y se le pago.

    Se revierte todo lo que genero la venta -ingreso, IVA debito y la plata que
    entro- en vez de anotar la salida como un gasto, que era lo unico posible
    antes: por esa via el ingreso quedaba contado, el IVA se seguia debiendo al
    SENIAT por algo que no se vendio, y la perdida mostrada no era la real.

    El costo de los insumos no desaparece: si la comida se puede revender
    vuelve al inventario, y si se boto pasa de costo de ventas a merma, que es
    lo que de verdad fue.
    """
    total = round(pedido.total, 2)
    descuento = round(pedido.descuento or 0, 2)
    propina = round(pedido.propina or 0, 2)
    costo = round(sum((i.costo_unitario or 0) * i.cantidad for i in pedido.items), 2)
    bruto = round(total + descuento, 2)

    # ES EL ESPEJO EXACTO DE `registrar_venta`. La venta se reconocio bruta con
    # el descuento aparte, asi que la devolucion revierte las dos: si no,
    # "Descuentos concedidos" seguia diciendo que se regalo algo en una venta
    # que ya no existe. Y la propina que el cliente dejo tambien vuelve: la
    # plata sale completa por donde entro, y el negocio deja de deberle al
    # empleado una propina que ya se devolvio. Sin esa linea el asiento no
    # cuadraba y la devolucion reventaba con un 500.
    if pedido.facturado:
        tasa = pedido.tasa_iva or impuestos.IVA_DEFAULT
        base, iva = impuestos.desglosar(total, tasa)
        base_bruta, _ = impuestos.desglosar(bruto, tasa)
        lineas = [("4010", base_bruta, 0.0), ("2030", iva, 0.0)]
        if descuento > 0:
            lineas.append(("4020", 0.0, round(base_bruta - base, 2)))
    else:
        lineas = [("4010", bruto, 0.0)]
        if descuento > 0:
            lineas.append(("4020", 0.0, descuento))
    if propina > 0:
        lineas.append(("2040", propina, 0.0))

    # La plata vuelve por donde entro: si se pago mitad efectivo y mitad pago
    # movil, se devuelve en esa misma proporcion. Si estaba fiado y el cliente
    # ya lo habia pagado, sale de donde entro ese pago; si todavia lo debia,
    # simplemente deja de deberlo. Con abonos parciales pasan las dos cosas:
    # se le devuelve lo que alcanzo a abonar y se le borra el resto.
    lineas += _lineas_de_cobro(pedido, signo=-1, reparto_fiado=_reparto_del_fiado(db, pedido))

    if costo > 0:
        # El costo sale de "costo de ventas" porque ya no hay venta. Si la
        # comida se recupera vuelve al inventario; si no, es perdida por merma.
        destino = "1040" if recuperable else "6020"
        lineas += [(destino, costo, 0.0), ("5010", 0.0, costo)]

    crear_asiento(
        db,
        f"Devolucion pedido #{pedido.numero}",
        lineas,
        origen="devolucion",
        referencia_id=pedido.id,
    )


def _reparto_del_fiado(
    db: Session, pedido: models.Pedido
) -> Optional[List[Tuple[str, float]]]:
    """Donde esta parada hoy la plata de un pedido fiado, cuenta por cuenta.

    Tres casos:
      - Nadie abono nada: None, y el que llama trata el fiado como siempre
        (todo sigue en cuentas por cobrar).
      - Hubo abonos: cada uno esta en la cuenta por donde entro, y lo que
        falta sigue en 1015.
      - Fiado saldado ANTES de que existieran los abonos: no hay filas que
        sumar, asi que se lee del asiento de cobro que quedo en los libros.
        Sin esto, devolver una venta vieja ya cobrada sacaria la plata de una
        gaveta que nunca la recibio.
    """
    total = pedido.fiado_monto
    if total <= 0:
        return None

    por_cuenta: dict = {}
    for abono in pedido.abonos:
        cuenta = CUENTA_POR_METODO_PAGO.get(abono.metodo_pago, "1010")
        por_cuenta[cuenta] = round(por_cuenta.get(cuenta, 0.0) + abono.monto, 2)

    if not por_cuenta:
        if not pedido.fiado_saldado:
            return None
        asiento = (
            db.query(models.AsientoContable)
            .filter_by(origen="cobro_fiado", referencia_id=pedido.id)
            .order_by(models.AsientoContable.id.desc())
            .first()
        )
        cuenta = "1010"
        if asiento is not None:
            for m in asiento.movimientos:
                if m.debe and m.cuenta is not None:
                    cuenta = m.cuenta.codigo
                    break
        return [(cuenta, total)]

    pendiente = round(total - sum(por_cuenta.values()), 2)
    reparto = [(c, m) for c, m in por_cuenta.items()]
    if pendiente > 0:
        reparto.append(("1015", pendiente))
    return reparto


def registrar_gasto(db: Session, gasto: models.Gasto) -> None:
    cuenta_pago = cuenta_de_pago(gasto.metodo_pago)
    crear_asiento(
        db,
        f"Gasto: {gasto.descripcion}",
        [("6010", gasto.monto, 0.0), (cuenta_pago, 0.0, gasto.monto)],
        origen="gasto",
        referencia_id=gasto.id,
        fecha=gasto.fecha,
    )


def saldos_por_tipo(db: Session, inicio, fin) -> dict:
    """{ingreso, costo, gasto} del periodo, tal como los ve el libro.

    Es la fuente unica para "cuanto gane": Reportes mostraba su propia version
    (ventas brutas con IVA adentro y sin contar mermas) y daba un numero
    distinto al del Estado de Resultados por el mismo periodo.
    """
    totales = {"ingreso": 0.0, "costo": 0.0, "gasto": 0.0}
    cuentas = (
        db.query(models.CuentaContable)
        .filter(models.CuentaContable.tipo.in_(list(totales)))
        .all()
    )
    for cuenta in cuentas:
        debe, haber = sumas_de_cuenta(db, cuenta.id, inicio, fin)
        saldo = debe - haber if cuenta.naturaleza == "deudora" else haber - debe
        totales[cuenta.tipo] += saldo
    return {k: round(v, 2) for k, v in totales.items()}


def sumas_de_cuenta(db: Session, cuenta_id: int, inicio=None, fin=None) -> Tuple[float, float]:
    """(debe, haber) de una cuenta, sumados EN la base y no en Python.

    Traer cada movimiento a memoria para sumarlo funcionaba con cien asientos;
    con un año de ventas son decenas de miles de filas por cuenta, y el
    balance general las recorria todas en cada pantalla. La base suma en una
    consulta lo que Python sumaba en un bucle.
    """
    consulta = db.query(
        func.coalesce(func.sum(models.MovimientoContable.debe), 0.0),
        func.coalesce(func.sum(models.MovimientoContable.haber), 0.0),
    ).filter(models.MovimientoContable.cuenta_id == cuenta_id)
    if inicio is not None or fin is not None:
        consulta = consulta.join(models.AsientoContable)
        if inicio is not None:
            consulta = consulta.filter(models.AsientoContable.fecha >= inicio)
        if fin is not None:
            consulta = consulta.filter(models.AsientoContable.fecha < fin)
    debe, haber = consulta.one()
    return round(float(debe or 0), 2), round(float(haber or 0), 2)


def saldo_de_cuenta(db: Session, codigo: str) -> float:
    """Saldo acumulado de una cuenta, con el signo de su naturaleza."""
    cuenta = _cuenta(db, codigo)
    debe, haber = sumas_de_cuenta(db, cuenta.id)
    total = debe - haber
    return round(total if cuenta.naturaleza == "deudora" else -total, 2)


def movimiento_efectivo(db: Session, inicio, fin, codigo: str = "1010") -> float:
    """Neto que entro (+) o salio (-) de esa gaveta en el rango, segun los libros.

    Es LA fuente de verdad del efectivo: incluye ventas cobradas en efectivo,
    gastos, pagos a proveedores y compras sueltas, sin que Caja tenga que
    conocer cada una de esas vias. Antes Caja restaba solo los Gastos y por eso
    mostraba faltantes que no existian.

    `codigo` elige la gaveta: 1010 son los bolivares y 1011 las divisas. Son
    dos monedas y dos conteos fisicos distintos.
    """
    cuenta = _cuenta(db, codigo)
    debe, haber = sumas_de_cuenta(db, cuenta.id, inicio, fin)
    return round(debe - haber, 2)


def periodo_bloqueado(db: Session, fecha: datetime.datetime) -> Optional[str]:
    """Por que no se puede postear nada nuevo con esa fecha, o None si si.

    Hay dos puertas que ya se cerraron detras de un periodo: la declaracion de
    IVA del mes -que se presento al SENIAT con un numero que ya no puede
    cambiar- y el cierre del ejercicio -que volco resultados a utilidades
    retenidas contando los saldos de ese ano-. Meterle un asiento a un periodo
    asi no es corregir, es dejar los libros diciendo algo distinto de lo que se
    declaro y se firmo.

    Devuelve el motivo en texto para que quien llame lo muestre tal cual: al
    dueno hay que decirle por que no se puede, no solo que no se puede.

    Para el ejercicio cerrado no basta con `fecha_contable`, que empuja el
    asiento al ejercicio abierto: eso sirve para una factura de compra
    atrasada, pero aca partiria en dos lo que tiene que ir junto -el Libro de
    Ventas seguiria poniendo la factura en el ano viejo y el mayor en el
    nuevo-, que es exactamente el descuadre que se esta evitando.
    """
    cerrado = ultimo_ejercicio_cerrado(db)
    if cerrado is not None and fecha.year <= cerrado:
        return f"el ejercicio {fecha.year} ya esta cerrado"

    declarada = (
        db.query(models.DeclaracionIva)
        .filter_by(anio=fecha.year, mes=fecha.month)
        .first()
    )
    if declarada:
        return f"el IVA de {fecha.month:02d}/{fecha.year} ya fue declarado"

    return None


def cerrar_ejercicio(db: Session, anio: int) -> dict:
    """Cierra el ano: manda el resultado a Utilidades retenidas.

    Sin esto, `utilidad_acumulada` del Balance General se calculaba como residuo
    sobre TODA la historia: en el segundo ano mezclaba el resultado de 2025 -que
    ya deberia estar volcado- con el de 2026 en curso, y el dueno no podia
    responder "cuanto gane el ano pasado" ni presentar un balance de cierre.

    Idempotente: si ese ano ya se cerro, no hace nada.
    """
    ya = (
        db.query(models.AsientoContable)
        .filter(
            models.AsientoContable.origen == "cierre_ejercicio",
            models.AsientoContable.referencia_id == anio,
        )
        .first()
    )
    if ya:
        return {"ok": False, "motivo": f"El ejercicio {anio} ya estaba cerrado."}

    inicio = datetime.datetime(anio, 1, 1)
    fin = datetime.datetime(anio + 1, 1, 1)

    lineas = []
    resultado = 0.0
    for cuenta in db.query(models.CuentaContable).all():
        if cuenta.tipo not in ("ingreso", "costo", "gasto"):
            continue
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
        neto = round(sum(m.debe - m.haber for m in movimientos), 2)
        if abs(neto) < 0.01:
            continue
        # Se cierra cada cuenta contra su propio saldo: si quedo con saldo
        # acreedor se debita, y al reves. El neto es el resultado del ano.
        lineas.append((cuenta.codigo, -neto, 0.0) if neto < 0 else (cuenta.codigo, 0.0, neto))
        resultado -= neto  # ingresos (haber) suman, costos/gastos (debe) restan

    if not lineas:
        return {"ok": False, "motivo": f"El ejercicio {anio} no tiene movimientos que cerrar."}

    resultado = round(resultado, 2)
    if resultado >= 0:
        lineas.append(("3020", 0.0, resultado))
    else:
        lineas.append(("3020", abs(resultado), 0.0))

    crear_asiento(
        db,
        f"Cierre del ejercicio {anio}",
        lineas,
        origen="cierre_ejercicio",
        referencia_id=anio,
        fecha=datetime.datetime(anio, 12, 31, 23, 59, 59),
    )
    db.commit()
    return {"ok": True, "anio": anio, "resultado": resultado}


def registrar_entrega_propinas(
    db: Session, monto: float, metodo_pago: str, referencia_id: int, nota: str = ""
) -> None:
    """Se le entrega al empleado la propina que estaba en la gaveta.

    Cancela el pasivo 2040 contra la caja de donde sale la plata. No toca
    resultados: nunca fue ingreso del negocio.
    """
    cuenta = CUENTA_POR_METODO_PAGO.get(metodo_pago, "1010")
    crear_asiento(
        db,
        f"Entrega de propinas{f': {nota}' if nota else ''}",
        [("2040", monto, 0.0), (cuenta, 0.0, monto)],
        origen="entrega_propinas",
        referencia_id=referencia_id,
    )


def registrar_cobro_fiado(
    db: Session, pedido: models.Pedido, monto: float, metodo_pago: str,
    saldo_restante: float = 0.0,
) -> None:
    """El cliente vino a pagar lo que debia: la cuenta por cobrar se convierte
    en plata.

    Sirve igual para el pago completo y para un abono; lo unico que cambia es
    lo que dice el asiento. Que la descripcion diga "abono" y cuanto queda
    importa: quien lea el libro mayor dentro de seis meses tiene que entender
    por que 1015 bajo 5 en vez de los 12 de la venta, sin ir a buscar el
    pedido.
    """
    cuenta = CUENTA_POR_METODO_PAGO.get(metodo_pago, "1010")
    quien = pedido.cliente or "sin nombre"
    if round(saldo_restante, 2) > 0:
        detalle = f"Abono a fiado pedido #{pedido.numero} ({quien}), queda {saldo_restante:.2f}"
    else:
        detalle = f"Cobro de fiado pedido #{pedido.numero} ({quien})"
    crear_asiento(
        db,
        detalle,
        [(cuenta, monto, 0.0), ("1015", 0.0, monto)],
        origen="cobro_fiado",
        referencia_id=pedido.id,
    )


def registrar_retiro(db: Session, retiro: models.RetiroPropietario) -> None:
    """El dueno saca plata del negocio para el.

    No es un gasto: no se consumio nada para producir, es capital que sale. Por
    eso va contra patrimonio y no toca la utilidad. Registrarlo como Gasto, que
    era la unica via posible antes, hacia ver al negocio menos rentable de lo
    que es y dejaba el patrimonio sin reflejar lo retirado.
    """
    cuenta_origen = cuenta_de_pago(retiro.metodo_pago)
    crear_asiento(
        db,
        f"Retiro del propietario{': ' + retiro.nota if retiro.nota else ''}",
        [("3030", retiro.monto, 0.0), (cuenta_origen, 0.0, retiro.monto)],
        origen="retiro",
        referencia_id=retiro.id,
        fecha=retiro.fecha,
    )


def registrar_diferencia_caja(db: Session, cierre: models.CierreCaja) -> None:
    """Lleva a los libros el faltante o sobrante del conteo fisico.

    Sin esto, `1010 Caja` nunca se concilia con lo que de verdad hay en la
    gaveta: la diferencia quedaba solo como una nota en la tabla de cierres.
    """
    # LAS DOS GAVETAS. Se contaban las dos pero solo la de bolivares se
    # conciliaba: un faltante en dolares quedaba anotado en la fila del cierre
    # y la cuenta 1011 seguia diciendo que la plata estaba ahi.
    for codigo, nombre, diferencia in (
        ("1010", "caja", round(cierre.diferencia or 0, 2)),
        ("1011", "divisas", round(cierre.divisas_diferencia or 0, 2)),
    ):
        if abs(diferencia) < 0.01:
            continue
        if diferencia < 0:  # falta plata: sale de caja y se reconoce como perdida
            lineas = [("6030", abs(diferencia), 0.0), (codigo, 0.0, abs(diferencia))]
            texto = f"Faltante de {nombre}"
        else:  # sobra plata: entra a caja y baja el gasto acumulado del rubro
            lineas = [(codigo, diferencia, 0.0), ("6030", 0.0, diferencia)]
            texto = f"Sobrante de {nombre}"
        crear_asiento(
            db,
            f"{texto} del {cierre.fecha.date()}",
            lineas,
            origen="cierre_caja",
            referencia_id=cierre.id,
            fecha=cierre.fecha,
        )


def registrar_reverso_diferencia_caja(db: Session, cierre: models.CierreCaja) -> None:
    """Deshace el faltante/sobrante de un cierre mal contado, en las dos gavetas.

    El cierre no se borra: se anula. Borrarlo dejaria los libros limpios pero
    mudos sobre lo que paso, y un error de conteo es justo lo que un dueno
    quiere poder auditar despues.
    """
    for codigo, nombre, diferencia in (
        ("1010", "caja", round(cierre.diferencia or 0, 2)),
        ("1011", "divisas", round(cierre.divisas_diferencia or 0, 2)),
    ):
        if abs(diferencia) < 0.01:
            continue
        if diferencia < 0:  # se habia reconocido un faltante: se devuelve a caja
            lineas = [(codigo, abs(diferencia), 0.0), ("6030", 0.0, abs(diferencia))]
        else:  # se habia reconocido un sobrante: sale de caja
            lineas = [("6030", diferencia, 0.0), (codigo, 0.0, diferencia)]
        crear_asiento(
            db,
            f"Anulacion del cierre del {cierre.fecha.date()} ({nombre})",
            lineas,
            origen="reverso_cierre_caja",
            referencia_id=cierre.id,
        )


def registrar_reverso_sobrante_inventario(
    db: Session, ingrediente: models.Ingrediente, valor: float, referencia_id: int
) -> None:
    """Contra-asiento de un conteo mal tecleado hacia arriba."""
    if valor <= 0:
        return
    crear_asiento(
        db,
        f"Reverso de sobrante de {ingrediente.nombre}",
        [("6020", valor, 0.0), ("1040", 0.0, valor)],
        origen="reverso_sobrante",
        referencia_id=referencia_id,
    )


def registrar_reverso_baja_activo(db: Session, activo: models.ActivoFijo, acumulada: float) -> None:
    """Revive un bien dado de baja por error: vuelve a los libros como estaba.

    Es el contra-asiento exacto de `registrar_baja_activo`, no una compra
    nueva: el bien recupera su valor bruto y su depreciacion acumulada.
    """
    valor_en_libros = round(activo.valor - acumulada, 2)
    lineas = [("1050", activo.valor, 0.0)]
    if acumulada > 0:
        lineas.append(("1051", 0.0, acumulada))
    if valor_en_libros > 0:
        lineas.append(("6040", 0.0, valor_en_libros))
    crear_asiento(
        db,
        f"Anulacion de la baja de {activo.nombre}",
        lineas,
        origen="reverso_baja_activo",
        referencia_id=activo.id,
    )


def registrar_reverso_declaracion_iva(db: Session, declaracion: models.DeclaracionIva) -> None:
    """Deshace una declaracion mal hecha, devolviendo el IVA a sus cuentas."""
    for asiento in (
        db.query(models.AsientoContable)
        .filter(
            models.AsientoContable.origen.in_(("declaracion_iva", "pago_iva")),
            models.AsientoContable.referencia_id == declaracion.id,
        )
        .all()
    ):
        lineas = [
            (m.cuenta.codigo, m.haber, m.debe) for m in asiento.movimientos if m.cuenta is not None
        ]
        if not lineas:
            continue
        crear_asiento(
            db,
            f"Anulacion: {asiento.descripcion}",
            lineas,
            origen="reverso_declaracion_iva",
            referencia_id=declaracion.id,
        )


def registrar_nota_credito_compra(
    db: Session, nota: models.NotaCreditoCompra, cuenta_concepto: str
) -> None:
    """Asiento espejo de la compra, por lo que el proveedor acredita.

    Baja el inventario (o el gasto, segun la categoria de la factura), baja el
    credito fiscal que ya no corresponde, y baja lo que se le debe al
    proveedor. Si la factura ya estaba pagada, lo que baja no es la deuda sino
    que entra la plata de vuelta.
    """
    factura = nota.factura
    lineas = []
    if nota.base_imponible > 0:
        lineas.append((cuenta_concepto, 0.0, nota.base_imponible))
    if nota.iva > 0:
        lineas.append(("1030", 0.0, nota.iva))

    if factura.forma_pago == "Credito" and not factura.pagada:
        contrapartida = "2010"  # todavia se le debe: baja la deuda
    else:
        contrapartida = CUENTA_PAGO_COMPRA.get(factura.forma_pago, "1010")
    lineas.append((contrapartida, nota.total, 0.0))

    crear_asiento(
        db,
        f"Nota de credito {nota.numero} sobre factura {factura.numero_factura}",
        lineas,
        origen="nota_credito_compra",
        referencia_id=nota.id,
        fecha=nota.fecha,
    )


def registrar_compra_insumo(
    db: Session,
    ingrediente: models.Ingrediente,
    valor: float,
    referencia_id: int,
    metodo_pago: Optional[str] = None,
) -> None:
    if valor <= 0:
        return  # sin costo informado no hay nada que contabilizar
    # De donde salio la plata. Salia SIEMPRE de la gaveta de bolivares, aunque
    # se hubiera pagado por transferencia o con los dolares de la otra gaveta,
    # y el cierre del dia mostraba un faltante que no existia.
    crear_asiento(
        db,
        f"Compra de {ingrediente.nombre}",
        [("1040", valor, 0.0), (cuenta_de_pago(metodo_pago), 0.0, valor)],
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


def registrar_pago_factura(db: Session, factura: models.FacturaCompra, forma_pago: str) -> None:
    """Salda una factura que habia quedado a credito: baja la deuda (2010) y
    sale la plata de donde de verdad salio. Sin esto, `2010 Cuentas por
    pagar` solo crece y nunca refleja que ya se le pago al proveedor.
    """
    cuenta_pago = CUENTA_LIQUIDACION_CREDITO.get(forma_pago, "1010")
    crear_asiento(
        db,
        f"Pago factura {factura.numero_factura} ({factura.proveedor_nombre})",
        [("2010", factura.total, 0.0), (cuenta_pago, 0.0, factura.total)],
        origen="pago_factura",
        referencia_id=factura.id,
    )


def _sumar_meses(fecha: datetime.datetime, meses: int) -> datetime.datetime:
    mes = fecha.month - 1 + meses
    anio = fecha.year + mes // 12
    mes = mes % 12 + 1
    dia = min(fecha.day, calendar.monthrange(anio, mes)[1])
    return fecha.replace(year=anio, month=mes, day=dia)


def _meses_cumplidos(desde: datetime.datetime, hasta: datetime.datetime) -> int:
    meses = (hasta.year - desde.year) * 12 + (hasta.month - desde.month)
    if hasta.day < desde.day:
        meses -= 1
    return max(meses, 0)


def asentar_depreciacion_pendiente(db: Session) -> int:
    """Registra las cuotas de depreciacion que ya se cumplieron y faltan.

    Es idempotente y se llama al consultar la contabilidad, no desde una tarea
    en background: cuenta cuantas cuotas ya tiene asentadas cada activo y
    completa las que falten. Un local que estuvo un mes sin abrir el sistema
    se pone al dia solo la proxima vez que mire sus libros.
    """
    activos = db.query(models.ActivoFijo).filter(models.ActivoFijo.dado_de_baja.is_(False)).all()
    ahora_ = ahora()
    nuevos = 0

    for activo in activos:
        if not activo.vida_util_meses or activo.valor <= 0:
            continue
        cumplidos = _meses_cumplidos(activo.fecha_compra, ahora_)
        objetivo = min(cumplidos, activo.vida_util_meses)
        ya = (
            db.query(models.AsientoContable)
            .filter_by(origen="depreciacion", referencia_id=activo.id)
            .count()
        )
        if ya >= objetivo:
            continue

        cuota = activo.cuota_mensual
        for numero in range(ya + 1, objetivo + 1):
            # En la ultima cuota se ajusta el redondeo para que lo depreciado
            # sume exactamente el valor del bien y no quede un resto colgado.
            monto = (
                round(activo.valor - cuota * (activo.vida_util_meses - 1), 2)
                if numero == activo.vida_util_meses
                else cuota
            )
            if monto <= 0:
                continue
            crear_asiento(
                db,
                f"Depreciacion de {activo.nombre} ({numero}/{activo.vida_util_meses})",
                [("6040", monto, 0.0), ("1051", 0.0, monto)],
                origen="depreciacion",
                referencia_id=activo.id,
                fecha=_sumar_meses(activo.fecha_compra, numero),
            )
            nuevos += 1

    if nuevos:
        db.commit()
    return nuevos


def depreciacion_acumulada(db: Session, activo: models.ActivoFijo) -> float:
    """Cuanto se le ha depreciado ya a ese bien, segun los asientos existentes."""
    asientos = (
        db.query(models.AsientoContable)
        .filter_by(origen="depreciacion", referencia_id=activo.id)
        .all()
    )
    return round(sum(m.debe for a in asientos for m in a.movimientos), 2)


def registrar_baja_activo(db: Session, activo: models.ActivoFijo, acumulada: float) -> None:
    """Saca el bien de los libros: se daño, se vendio o se robo.

    Lo ya depreciado se revierte y lo que quedaba por depreciar se reconoce de
    golpe como perdida, que es lo que de verdad paso.
    """
    valor_en_libros = round(activo.valor - acumulada, 2)
    lineas = []
    if acumulada > 0:
        lineas.append(("1051", acumulada, 0.0))
    if valor_en_libros > 0:
        lineas.append(("6040", valor_en_libros, 0.0))
    lineas.append(("1050", 0.0, activo.valor))
    crear_asiento(
        db,
        f"Baja de {activo.nombre}: {activo.motivo_baja or 'sin motivo'}",
        lineas,
        origen="baja_activo",
        referencia_id=activo.id,
    )


def registrar_declaracion_iva(db: Session, declaracion: models.DeclaracionIva) -> None:
    """Cierra el IVA del mes contra las cuentas fiscales.

    Se cancela el debito del periodo contra el credito que alcanzo a cubrirlo;
    lo que falte queda como deuda en 2020 hasta que se pague. Si sobro credito,
    el sobrante se queda en 1030 y sirve para el mes siguiente: el arrastre
    sale solo, sin necesidad de moverlo.
    """
    lineas = []
    if declaracion.iva_debito > 0:
        lineas.append(("2030", declaracion.iva_debito, 0.0))
    if declaracion.credito_usado > 0:
        lineas.append(("1030", 0.0, declaracion.credito_usado))
    if declaracion.iva_a_pagar > 0:
        lineas.append(("2020", 0.0, declaracion.iva_a_pagar))
    if not lineas:
        return
    crear_asiento(
        db,
        f"Declaracion de IVA {declaracion.periodo}",
        lineas,
        origen="declaracion_iva",
        referencia_id=declaracion.id,
    )


def registrar_pago_iva(db: Session, declaracion: models.DeclaracionIva, forma_pago: str) -> None:
    """Paga al SENIAT lo declarado: baja la deuda y sale la plata."""
    if declaracion.iva_a_pagar <= 0:
        return
    cuenta_pago = cuenta_de_pago(forma_pago, por_defecto="1020")
    crear_asiento(
        db,
        f"Pago de IVA {declaracion.periodo}",
        [("2020", declaracion.iva_a_pagar, 0.0), (cuenta_pago, 0.0, declaracion.iva_a_pagar)],
        origen="pago_iva",
        referencia_id=declaracion.id,
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


def registrar_consumo_personal(
    db: Session, ingrediente: models.Ingrediente, valor: float, referencia_id: int, nota: str = ""
) -> None:
    """Comida del personal: sale del inventario contra gasto de personal."""
    if valor <= 0:
        return
    crear_asiento(
        db,
        f"Consumo del personal: {ingrediente.nombre}{f' ({nota})' if nota else ''}",
        [("6025", valor, 0.0), ("1040", 0.0, valor)],
        origen="consumo_personal",
        referencia_id=referencia_id,
    )


def registrar_reverso_merma(
    db: Session, ingrediente: models.Ingrediente, valor: float, referencia_id: int
) -> None:
    """Contra-asiento de una merma mal cargada: devuelve el valor al inventario."""
    if valor <= 0:
        return
    crear_asiento(
        db,
        f"Reverso de merma de {ingrediente.nombre}",
        [("1040", valor, 0.0), ("6020", 0.0, valor)],
        origen="reverso_merma",
        referencia_id=referencia_id,
    )


def registrar_sobrante_inventario(
    db: Session, ingrediente: models.Ingrediente, valor: float, referencia_id: int
) -> None:
    """El conteo fisico encontro mas mercancia de la que decia el sistema.

    Entra al inventario contra la cuenta de merma (baja la perdida acumulada),
    porque un sobrante casi siempre es una merma o un consumo mal registrado
    antes, no mercancia que aparecio de la nada.

    El origen cambio de "ajuste_inventario" a "sobrante_inventario" cuando el
    sobrante paso a tener fila propia: `referencia_id` ya no es el ingrediente
    sino el sobrante. Los asientos viejos conservan el origen viejo a proposito,
    para que nadie los lea con la semantica nueva.
    """
    if valor <= 0:
        return
    crear_asiento(
        db,
        f"Sobrante de inventario: {ingrediente.nombre}",
        [("1040", valor, 0.0), ("6020", 0.0, valor)],
        origen="sobrante_inventario",
        referencia_id=referencia_id,
    )
