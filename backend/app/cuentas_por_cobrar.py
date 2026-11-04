"""Cuentas por cobrar: quien le debe al negocio por lo que se vendio a credito.

La venta a credito ya existia (el pago "Fiado" del punto de venta, contra
1015), pero solo se podia cobrar pedido por pedido y el deudor era un nombre
escrito a mano. PedidosYa paga la semana de una vez y ya restada su comision:
con eso habia que partir un deposito en veinte abonos y la comision no tenia
donde ir. Aqui viven la ficha del cliente, lo que debe cada uno, el cobro
agrupado, el abono "a lo que debo" y la deuda que se da por perdida. Lo
contable sigue en `contabilidad.py`.
"""
from __future__ import annotations

import datetime
import re
import unicodedata
from typing import List, Optional

from sqlalchemy.orm import Session

from . import contabilidad, impuestos, models, schemas
from .timeutils import ahora


def clave_de_nombre(nombre: str) -> str:
    """"PedidosYa", "Pedidos ya" y "PEDIDOS-YA" son el mismo cliente."""
    s = unicodedata.normalize("NFKD", nombre or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", s.lower())


def cliente_por_nombre(db: Session, nombre: str) -> Optional[models.Cliente]:
    clave = clave_de_nombre(nombre)
    if not clave:
        return None
    for c in db.query(models.Cliente).filter(models.Cliente.activo.is_(True)).all():
        if clave_de_nombre(c.nombre) == clave:
            return c
    return None


def vincular_pedido(db: Session, pedido: models.Pedido) -> None:
    """Al fiar desde el punto de venta: si el nombre es el de una ficha, la
    venta entra en la cuenta de ese cliente. Si no, queda como fiado suelto y
    se puede asignar despues."""
    if pedido.cliente_id:
        return
    cliente = cliente_por_nombre(db, pedido.cliente or "")
    if cliente is not None:
        pedido.cliente_id = cliente.id


def pedidos_por_cobrar(db: Session) -> List[models.Pedido]:
    """Las ventas a credito que todavia deben algo, de la mas vieja a la mas
    nueva. Mismo criterio que Ventas y el cierre: devuelto ya no se debe."""
    pedidos = (
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
    pedidos.sort(key=_fecha)
    return [p for p in pedidos if p.fiado_saldo > 0]


def bloquear_pedidos(db: Session, ids) -> List[models.Pedido]:
    """Toma las filas de estas ventas hasta el commit y las vuelve a leer.

    Sin esto dos personas leen el mismo saldo y cobran las dos: la deuda queda
    en negativo. Se llama ANTES de mirar el saldo; quien llega segundo espera y
    ve lo que dejo el primero. En orden de id para que dos cobros que marcaron
    las mismas ventas no se traben entre si."""
    pedidos = (
        db.query(models.Pedido)
        .filter(models.Pedido.id.in_(list(ids)))
        .order_by(models.Pedido.id)
        .with_for_update(of=models.Pedido)
        .all()
    )
    for p in pedidos:
        db.expire(p)
    return pedidos


def cobro_por_clave(db: Session, clave: Optional[str]) -> Optional[models.CobroCliente]:
    """El cobro que ya entro con esta clave: un reintento lo recibe a el. Se
    pregunta DESPUES de bloquear, porque quien esperaba al primero tiene que
    ver lo que el primero dejo."""
    if not clave:
        return None
    return db.query(models.CobroCliente).filter(models.CobroCliente.clave_cliente == clave).first()


def _fecha(p: models.Pedido) -> datetime.datetime:
    return p.cerrado_en or p.creado_en


def venta_por_cobrar(p: models.Pedido, cliente: Optional[models.Cliente], hoy_: datetime.datetime) -> schemas.VentaPorCobrar:
    dias = (hoy_ - _fecha(p)).days
    plazo = cliente.dias_credito if cliente else 0
    return schemas.VentaPorCobrar(
        pedido_id=p.id,
        numero=p.numero,
        cliente=p.cliente or "Sin nombre",
        cliente_id=p.cliente_id,
        fecha=_fecha(p),
        dias=dias,
        original=p.fiado_monto,
        abonado=p.fiado_abonado,
        saldo=p.fiado_saldo,
        facturado=bool(p.facturado),
        numero_factura=p.numero_factura,
        # Sin plazo pactado no hay "vencida": no se inventa una fecha.
        vencida=bool(plazo) and dias > plazo,
    )


def resumen(db: Session) -> schemas.ResumenCxC:
    hoy_ = ahora()
    clientes = {c.id: c for c in db.query(models.Cliente).all()}
    por_cliente: dict = {}
    sin_ficha: List[schemas.VentaPorCobrar] = []
    ventas_todas: List[schemas.VentaPorCobrar] = []
    for p in pedidos_por_cobrar(db):
        cliente = clientes.get(p.cliente_id)
        fila = venta_por_cobrar(p, cliente, hoy_)
        ventas_todas.append(fila)
        if cliente is None:
            sin_ficha.append(fila)
        else:
            por_cliente.setdefault(cliente.id, []).append(fila)

    filas = []
    for c in clientes.values():
        ventas = por_cliente.get(c.id, [])
        if not ventas and not c.activo:
            continue
        filas.append(schemas.ClienteConSaldo(
            **schemas.Cliente.model_validate(c).model_dump(),
            saldo=round(sum(v.saldo for v in ventas), 2),
            ventas=len(ventas),
            mas_vieja_dias=max((v.dias for v in ventas), default=None),
            vencido=round(sum(v.saldo for v in ventas if v.vencida), 2),
        ))
    filas.sort(key=lambda f: (-f.saldo, f.nombre.lower()))
    total = round(sum(f.saldo for f in filas) + sum(v.saldo for v in sin_ficha), 2)
    return schemas.ResumenCxC(
        total=total,
        vencido=round(sum(f.vencido for f in filas), 2),
        clientes=filas,
        sin_ficha=sin_ficha,
        ventas=ventas_todas,
        dadas_de_baja=_dadas_de_baja(db, clientes, hoy_),
    )


def _dadas_de_baja(db: Session, clientes: dict, hoy_: datetime.datetime) -> List[schemas.VentaPorCobrar]:
    pedidos = (
        db.query(models.Pedido)
        .filter(models.Pedido.fiado_castigado > 0, models.Pedido.devuelto.is_(False))
        .order_by(models.Pedido.fecha_castigo.desc())
        .limit(100)
        .all()
    )
    filas = []
    for p in pedidos:
        fila = venta_por_cobrar(p, clientes.get(p.cliente_id), hoy_)
        fila.fecha = p.fecha_castigo or fila.fecha
        fila.saldo = p.fiado_castigado
        fila.vencida = False
        filas.append(fila)
    return filas


def _usd(monto: float) -> str:
    """$1.234,50: como se escribe la plata en pantalla, no 1234.50."""
    return "$" + f"{monto:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


def _ventas(n: int) -> str:
    return "1 venta" if n == 1 else f"{n} ventas"


def _detalle_cobro(cobro: models.CobroCliente, que: str = "Pago") -> str:
    detalle = f"{que} · {cobro.metodo_pago}"
    if cobro.referencia:
        detalle += f" ref. {cobro.referencia}"
    partes = []
    if cobro.comision:
        partes.append(f"comisión {_usd(cobro.comision)}")
    if cobro.retencion_iva:
        partes.append(f"IVA retenido {_usd(cobro.retencion_iva)}")
    if cobro.excedente:
        partes.append(f"de más {_usd(cobro.excedente)}")
    if partes:
        detalle += f" (entró {_usd(cobro.recibido)}; " + ", ".join(partes) + ")"
    return detalle


def estado_de_cuenta(db: Session, cliente: models.Cliente) -> schemas.EstadoDeCuenta:
    """Lo que se le vendio a credito y lo que pago, en orden, con el saldo
    corrido. Es lo que se le manda al cliente cuando dice "yo no debo eso"."""
    hoy_ = ahora()
    pedidos = (
        db.query(models.Pedido)
        .filter(models.Pedido.cliente_id == cliente.id, models.Pedido.devuelto.is_(False))
        .all()
    )
    movs: List[schemas.MovimientoCuenta] = []
    cobros_vistos: dict = {}
    for p in pedidos:
        if p.fiado_monto <= 0:
            continue
        movs.append(schemas.MovimientoCuenta(
            fecha=_fecha(p), tipo="venta", detalle=f"Venta #{p.numero}"
            + (f" · factura {p.numero_factura}" if p.numero_factura else ""),
            cargo=p.fiado_monto, pedido_id=p.id,
        ))
        for a in p.abonos:
            if a.cobro_id:
                cobros_vistos.setdefault(a.cobro_id, a.cobro)
                continue
            movs.append(schemas.MovimientoCuenta(
                fecha=a.fecha, tipo="abono", detalle=f"Abono a la venta #{p.numero} · {a.metodo_pago}"
                + (f" ref. {a.referencia}" if a.referencia else ""),
                abono=a.monto, pedido_id=p.id,
            ))
        if p.fiado_castigado:
            movs.append(schemas.MovimientoCuenta(
                fecha=p.fecha_castigo or hoy_, tipo="perdida", detalle=f"Venta #{p.numero} dada por perdida",
                abono=p.fiado_castigado, pedido_id=p.id,
            ))
    for cobro in cobros_vistos.values():
        # Lo que el cobro desconto de la deuda: si fue un abono parcial, es
        # solo lo aplicado, no lo que se debia.
        aplicado = round(sum(a.monto for a in cobro.abonos), 2)
        movs.append(schemas.MovimientoCuenta(
            fecha=cobro.fecha, tipo="cobro",
            detalle=_detalle_cobro(
                cobro, "Abono" if (cobro.nota or "").startswith("Abono") else f"Pago de {_ventas(len(cobro.abonos))}"
            ),
            abono=aplicado, cobro_id=cobro.id,
        ))
    movs.sort(key=lambda m: (m.fecha, 0 if m.tipo == "venta" else 1))
    saldo = 0.0
    for m in movs:
        saldo = round(saldo + m.cargo - m.abono, 2)
        m.saldo = saldo
    pendientes = [venta_por_cobrar(p, cliente, hoy_) for p in pedidos_por_cobrar(db) if p.cliente_id == cliente.id]
    return schemas.EstadoDeCuenta(
        cliente=schemas.Cliente.model_validate(cliente),
        saldo=round(sum(v.saldo for v in pendientes), 2),
        pendientes=pendientes,
        movimientos=movs,
    )


class ErrorCobro(Exception):
    def __init__(self, status: int, detalle: str):
        super().__init__(detalle)
        self.status = status
        self.detalle = detalle


def _validar_forma(metodo: str, referencia: str) -> str:
    if metodo == "Fiado" or not contabilidad.metodo_de_pago_valido(metodo):
        raise ErrorCobro(400, "Forma de cobro inválida")
    referencia = (referencia or "").strip()
    if metodo in contabilidad.METODOS_CON_REFERENCIA and not referencia:
        raise ErrorCobro(400, f"Un cobro por {metodo} necesita su número de referencia")
    return referencia


def _fecha_cobro(fecha: Optional[datetime.date]) -> datetime.datetime:
    ya = ahora()
    if fecha and fecha != ya.date():
        if fecha > ya.date():
            raise ErrorCobro(400, "Un cobro no puede tener fecha futura")
        return datetime.datetime.combine(fecha, datetime.time(12, 0))
    return ya


def _cliente(db: Session, cliente_id: Optional[int]) -> Optional[models.Cliente]:
    if cliente_id is None:
        return None
    cliente = db.get(models.Cliente, cliente_id)
    if cliente is None:
        raise ErrorCobro(404, "Cliente no encontrado")
    return cliente


def _retener(db: Session, p: models.Pedido, pct: float, fecha: datetime.datetime) -> float:
    """El IVA que el cliente retuvo de esta venta, en dolares. Se guarda en el
    pedido igual que si se hubiera retenido al cobrar en el punto: el Libro de
    Ventas y la declaracion lo leen de ahi."""
    if not p.facturado or p.retencion_iva_usd:
        return 0.0
    _, iva = impuestos.desglosar(p.total, p.tasa_iva or impuestos.tasa_iva(db))
    retenido = impuestos.porcentaje_de(iva, pct)
    p.retencion_iva_pct = pct
    p.retencion_iva_usd = retenido
    if p.tasa_bcv:
        _, iva_bs = impuestos.desglosar(round(p.total * p.tasa_bcv, 2), p.tasa_iva or impuestos.tasa_iva(db))
        p.retencion_iva_bs = impuestos.porcentaje_de(iva_bs, pct)
    return retenido


def cobrar(db: Session, body: schemas.CobroClienteCreate) -> models.CobroCliente:
    """Salda de una vez las ventas marcadas. No hace commit."""
    referencia = _validar_forma(body.metodo_pago, body.referencia)
    ids = list(dict.fromkeys(body.pedido_ids))
    pedidos = bloquear_pedidos(db, ids)
    ya = cobro_por_clave(db, body.clave_cliente)
    if ya is not None:
        return ya
    if len(pedidos) != len(ids):
        raise ErrorCobro(404, "Alguna de esas ventas no existe")
    cliente = _cliente(db, body.cliente_id)
    for p in pedidos:
        if p.devuelto:
            raise ErrorCobro(409, f"La venta #{p.numero} fue devuelta: ya no se debe")
        if p.fiado_saldo <= 0:
            raise ErrorCobro(409, f"La venta #{p.numero} ya no debe nada")
        # Un cobro es de UN cliente: mezclar deudores en un deposito es la
        # forma de que despues nadie sepa quien pago que.
        if cliente is not None and p.cliente_id not in (None, cliente.id):
            raise ErrorCobro(409, f"La venta #{p.numero} es de otro cliente")
    pct = body.retencion_iva_pct or 0
    if pct and pct not in (75, 100):
        raise ErrorCobro(400, "La retención de IVA es de 75 % o 100 %.")
    if pct and not any(p.facturado for p in pedidos):
        raise ErrorCobro(400, "Solo se retiene IVA de ventas facturadas, y ninguna de las marcadas lo está.")
    monto = round(sum(p.fiado_saldo for p in pedidos), 2)
    comision = round(body.comision or 0.0, 2)
    excedente = round(body.excedente or 0.0, 2)
    if comision and excedente:
        raise ErrorCobro(400, "O entró de menos (comisión) o entró de más, no las dos cosas.")
    fecha = _fecha_cobro(body.fecha)
    retencion = round(sum(_retener(db, p, pct, fecha) for p in pedidos), 2) if pct else 0.0
    if body.recibido is not None:
        diferencia = round(monto - retencion - body.recibido, 2)
        comision, excedente = max(diferencia, 0.0), max(-diferencia, 0.0)
    recibido = round(monto - comision - retencion + excedente, 2)
    if recibido <= 0:
        raise ErrorCobro(400, f"Con esa comisión no entra nada: se debían {monto:.2f}")

    cobro = models.CobroCliente(
        cliente_id=cliente.id if cliente else None,
        fecha=fecha,
        metodo_pago=body.metodo_pago,
        referencia=referencia,
        monto=monto,
        comision=comision,
        excedente=excedente,
        retencion_iva=retencion,
        retencion_iva_pct=pct or None,
        recibido=recibido,
        nota=body.nota.strip(),
        operador_id=body.operador_id,
        clave_cliente=body.clave_cliente or None,
    )
    db.add(cobro)
    db.flush()
    for p in pedidos:
        if cliente is not None and p.cliente_id is None:
            p.cliente_id = cliente.id
        db.add(models.AbonoFiado(
            pedido_id=p.id, monto=p.fiado_saldo, metodo_pago=body.metodo_pago,
            referencia=referencia, operador_id=body.operador_id, fecha=fecha, cobro_id=cobro.id,
        ))
        p.fiado_saldado = True
        p.fecha_cobro_fiado = fecha
    db.flush()
    db.refresh(cobro)
    quien = cliente.nombre if cliente else (pedidos[0].cliente or "sin nombre")
    contabilidad.registrar_cobro_cliente(db, cobro, quien)
    return cobro


def abonar_a_cuenta(db: Session, cliente: models.Cliente, body: schemas.AbonoACuenta) -> models.CobroCliente:
    """"Abono a lo que debo": se aplica de la venta mas vieja a la mas nueva.
    Un pago mitad Zelle y mitad pago movil son dos abonos. No hace commit."""
    referencia = _validar_forma(body.metodo_pago, body.referencia)
    bloquear_pedidos(db, [p.id for p in pedidos_por_cobrar(db) if p.cliente_id == cliente.id])
    ya = cobro_por_clave(db, body.clave_cliente)
    if ya is not None:
        return ya
    pendientes = [p for p in pedidos_por_cobrar(db) if p.cliente_id == cliente.id]
    debe = round(sum(p.fiado_saldo for p in pendientes), 2)
    monto = round(body.monto, 2)
    if not pendientes:
        raise ErrorCobro(409, f"{cliente.nombre} no debe nada")
    if monto > debe + 0.005:
        raise ErrorCobro(400, f"Debe {debe:.2f}: no se puede abonar {monto:.2f}. Si pagó de más, usa el cobro y marca «entró de más».")
    return _aplicar_abono(db, pendientes, body, monto, referencia, cliente.id, cliente.nombre)


def abonar_ventas(db: Session, body: schemas.AbonoAVentas) -> models.CobroCliente:
    """Pago parcial de las ventas marcadas, sin necesidad de ficha de cliente.
    No hace commit."""
    referencia = _validar_forma(body.metodo_pago, body.referencia)
    ids = set(body.pedido_ids)
    bloquear_pedidos(db, ids)
    ya = cobro_por_clave(db, body.clave_cliente)
    if ya is not None:
        return ya
    marcadas = [p for p in pedidos_por_cobrar(db) if p.id in ids]
    if len(marcadas) != len(ids):
        raise ErrorCobro(409, "Alguna de esas ventas ya no debe nada: vuelve a cargar la lista.")
    debe = round(sum(p.fiado_saldo for p in marcadas), 2)
    monto = round(body.monto, 2)
    if monto > debe + 0.005:
        raise ErrorCobro(400, f"Las ventas marcadas deben {_usd(debe)}: no se puede abonar {_usd(monto)}.")
    fichas = {p.cliente_id for p in marcadas}
    cliente_id = fichas.pop() if len(fichas) == 1 else None
    return _aplicar_abono(db, marcadas, body, monto, referencia, cliente_id, marcadas[0].cliente or "sin nombre")


def _aplicar_abono(db, pedidos, body, monto, referencia, cliente_id, quien) -> models.CobroCliente:
    fecha = _fecha_cobro(body.fecha)
    cobro = models.CobroCliente(
        cliente_id=cliente_id, fecha=fecha, metodo_pago=body.metodo_pago, referencia=referencia,
        monto=monto, comision=0.0, recibido=monto, nota=body.nota.strip() or "Abono a cuenta",
        operador_id=body.operador_id, clave_cliente=body.clave_cliente or None,
    )
    db.add(cobro)
    db.flush()
    queda = monto
    for p in pedidos:
        if queda <= 0.004:
            break
        parte = round(min(p.fiado_saldo, queda), 2)
        db.add(models.AbonoFiado(
            pedido_id=p.id, monto=parte, metodo_pago=body.metodo_pago, referencia=referencia,
            operador_id=body.operador_id, fecha=fecha, cobro_id=cobro.id,
        ))
        db.flush()
        db.refresh(p)
        queda = round(queda - parte, 2)
        if p.fiado_saldo < 0.01:
            p.fiado_saldado = True
            p.fecha_cobro_fiado = fecha
    db.flush()
    db.refresh(cobro)
    contabilidad.registrar_cobro_cliente(db, cobro, quien)
    return cobro


def anular_cobro(db: Session, cobro: models.CobroCliente) -> None:
    """Las ventas vuelven a deberse y el asiento se compensa. No hace commit."""
    db.query(models.CobroCliente).filter(models.CobroCliente.id == cobro.id).with_for_update(of=models.CobroCliente).one()
    db.expire(cobro)
    if cobro.anulado:
        raise ErrorCobro(409, "Ese cobro ya estaba anulado")
    try:
        contabilidad.asegurar_ejercicio_abierto(db, cobro.fecha, "ese cobro")
    except contabilidad.ErrorEjercicioCerrado as e:
        raise ErrorCobro(409, str(e))
    bloquear_pedidos(db, [a.pedido_id for a in cobro.abonos])
    for a in list(cobro.abonos):
        p = a.pedido
        p.fiado_saldado = False
        p.fecha_cobro_fiado = None
        # La retencion que se anoto con este cobro tambien se va: la venta
        # vuelve a estar como antes de pagarse.
        if cobro.retencion_iva and p.retencion_iva_usd and not p.comprobante_retencion_iva:
            p.retencion_iva_pct = None
            p.retencion_iva_usd = None
            p.retencion_iva_bs = None
        db.delete(a)
    contabilidad.reversar_asiento(db, "cobro_cliente", cobro.id, "reverso_cobro_cliente")
    cobro.anulado = True


def dar_por_perdida(db: Session, p: models.Pedido, motivo: str) -> float:
    """Lo que falta de esta venta deja de deberse y va a gasto. No hace commit."""
    bloquear_pedidos(db, [p.id])
    if p.devuelto:
        raise ErrorCobro(409, "Esa venta fue devuelta: ya no se debe")
    saldo = p.fiado_saldo
    if saldo <= 0:
        raise ErrorCobro(409, "Esa venta ya no debe nada")
    p.fiado_castigado = round((p.fiado_castigado or 0) + saldo, 2)
    p.fecha_castigo = ahora()
    p.fiado_saldado = True
    contabilidad.registrar_castigo_fiado(db, p, saldo, motivo.strip())
    return saldo


def recuperar_perdida(db: Session, p: models.Pedido) -> None:
    """Se dio por perdida y al final si va a pagar: vuelve a deberse."""
    bloquear_pedidos(db, [p.id])
    if not p.fiado_castigado:
        raise ErrorCobro(409, "Esa venta no estaba dada por perdida")
    try:
        contabilidad.asegurar_ejercicio_abierto(db, p.fecha_castigo, "esa pérdida")
    except contabilidad.ErrorEjercicioCerrado as e:
        raise ErrorCobro(409, str(e))
    contabilidad.reversar_asiento(db, "castigo_fiado", p.id, "reverso_castigo_fiado")
    p.fiado_castigado = None
    p.fecha_castigo = None
    p.fiado_saldado = False


def cobro_a_esquema(cobro: models.CobroCliente) -> schemas.CobroCliente:
    return schemas.CobroCliente(
        id=cobro.id,
        cliente_id=cobro.cliente_id,
        cliente=cobro.cliente.nombre if cobro.cliente else next((a.pedido.cliente for a in cobro.abonos if a.pedido.cliente), ""),
        fecha=cobro.fecha,
        metodo_pago=cobro.metodo_pago,
        referencia=cobro.referencia or "",
        monto=cobro.monto,
        comision=cobro.comision or 0.0,
        excedente=cobro.excedente or 0.0,
        retencion_iva=cobro.retencion_iva or 0.0,
        recibido=cobro.recibido,
        nota=cobro.nota or "",
        anulado=bool(cobro.anulado),
        ventas=[a.pedido_id for a in cobro.abonos],
    )
