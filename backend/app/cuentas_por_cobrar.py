"""Cuentas por cobrar: quien le debe al negocio por lo que se vendio a credito.

La venta a credito ya existia (el pago "Fiado" del punto de venta, contra
1015), pero solo se podia cobrar pedido por pedido y el deudor era un nombre
escrito a mano. PedidosYa paga la semana de una vez y ya restada su comision:
con eso habia que partir un deposito en veinte abonos y la comision no tenia
donde ir. Aqui viven la ficha del cliente, lo que debe cada uno y el cobro
agrupado. Lo contable sigue en `contabilidad.py`.
"""
from __future__ import annotations

import datetime
import re
import unicodedata
from typing import List, Optional

from sqlalchemy.orm import Session

from . import contabilidad, models, schemas
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
        .order_by(models.Pedido.cerrado_en)
        .all()
    )
    return [p for p in pedidos if p.fiado_saldo > 0]


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
    for p in pedidos_por_cobrar(db):
        cliente = clientes.get(p.cliente_id)
        fila = venta_por_cobrar(p, cliente, hoy_)
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
    )


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
    for cobro in cobros_vistos.values():
        detalle = f"Cobro de {len(cobro.abonos)} venta(s) · {cobro.metodo_pago}"
        if cobro.referencia:
            detalle += f" ref. {cobro.referencia}"
        if cobro.comision:
            detalle += f" (entró {cobro.recibido:.2f}, comisión {cobro.comision:.2f})"
        movs.append(schemas.MovimientoCuenta(
            fecha=cobro.fecha, tipo="cobro", detalle=detalle, abono=cobro.monto, cobro_id=cobro.id,
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


def cobrar(db: Session, body: schemas.CobroClienteCreate) -> models.CobroCliente:
    """Salda de una vez las ventas marcadas. No hace commit."""
    if body.metodo_pago == "Fiado" or not contabilidad.metodo_de_pago_valido(body.metodo_pago):
        raise ErrorCobro(400, "Forma de cobro inválida")
    referencia = (body.referencia or "").strip()
    if body.metodo_pago in contabilidad.METODOS_CON_REFERENCIA and not referencia:
        raise ErrorCobro(400, f"Un cobro por {body.metodo_pago} necesita su número de referencia")
    ids = list(dict.fromkeys(body.pedido_ids))
    pedidos = db.query(models.Pedido).filter(models.Pedido.id.in_(ids)).all()
    if len(pedidos) != len(ids):
        raise ErrorCobro(404, "Alguna de esas ventas no existe")
    cliente = None
    if body.cliente_id is not None:
        cliente = db.get(models.Cliente, body.cliente_id)
        if cliente is None:
            raise ErrorCobro(404, "Cliente no encontrado")
    for p in pedidos:
        if p.devuelto:
            raise ErrorCobro(409, f"La venta #{p.numero} fue devuelta: ya no se debe")
        if p.fiado_saldo <= 0:
            raise ErrorCobro(409, f"La venta #{p.numero} ya no debe nada")
        # Un cobro es de UN cliente: mezclar deudores en un deposito es la
        # forma de que despues nadie sepa quien pago que.
        if cliente is not None and p.cliente_id not in (None, cliente.id):
            raise ErrorCobro(409, f"La venta #{p.numero} es de otro cliente")
    monto = round(sum(p.fiado_saldo for p in pedidos), 2)
    comision = round(body.comision or 0.0, 2)
    if comision >= monto:
        raise ErrorCobro(400, f"La comisión ({comision:.2f}) no puede ser igual o mayor que lo cobrado ({monto:.2f})")

    fecha = ahora()
    if body.fecha and body.fecha != fecha.date():
        fecha = datetime.datetime.combine(body.fecha, datetime.time(12, 0))
    cobro = models.CobroCliente(
        cliente_id=cliente.id if cliente else None,
        fecha=fecha,
        metodo_pago=body.metodo_pago,
        referencia=referencia,
        monto=monto,
        comision=comision,
        recibido=round(monto - comision, 2),
        nota=body.nota.strip(),
        operador_id=body.operador_id,
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


def anular_cobro(db: Session, cobro: models.CobroCliente) -> None:
    """Las ventas vuelven a deberse enteras y el asiento se compensa. No hace
    commit."""
    if cobro.anulado:
        raise ErrorCobro(409, "Ese cobro ya estaba anulado")
    try:
        contabilidad.asegurar_ejercicio_abierto(db, cobro.fecha, "ese cobro")
    except contabilidad.ErrorEjercicioCerrado as e:
        raise ErrorCobro(409, str(e))
    for a in list(cobro.abonos):
        a.pedido.fiado_saldado = False
        a.pedido.fecha_cobro_fiado = None
        db.delete(a)
    contabilidad.reversar_asiento(db, "cobro_cliente", cobro.id, "reverso_cobro_cliente")
    cobro.anulado = True


def cobro_a_esquema(cobro: models.CobroCliente) -> schemas.CobroCliente:
    return schemas.CobroCliente(
        id=cobro.id,
        cliente_id=cobro.cliente_id,
        cliente=cobro.cliente.nombre if cobro.cliente else "",
        fecha=cobro.fecha,
        metodo_pago=cobro.metodo_pago,
        referencia=cobro.referencia or "",
        monto=cobro.monto,
        comision=cobro.comision or 0.0,
        recibido=cobro.recibido,
        nota=cobro.nota or "",
        anulado=bool(cobro.anulado),
        ventas=[a.pedido_id for a in cobro.abonos],
    )
