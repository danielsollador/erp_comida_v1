import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import contabilidad, models, schemas
from ..database import get_db
from ..rango import Rango
from ..timeutils import ahora, hoy, inicio_del_dia
from . import operadores

router = APIRouter(prefix="/api/caja", tags=["caja"])


def _rango_hoy():
    inicio = inicio_del_dia(hoy())
    return inicio, inicio + datetime.timedelta(days=1)


def _pedidos_pagados_hoy(db: Session):
    inicio, fin = _rango_hoy()
    return (
        db.query(models.Pedido)
        .filter(
            models.Pedido.estado == "pagado",
            models.Pedido.cerrado_en >= inicio,
            models.Pedido.cerrado_en < fin,
        )
        .all()
    )


def _retiros_hoy(db: Session) -> float:
    inicio, fin = _rango_hoy()
    retiros = (
        db.query(models.RetiroPropietario)
        .filter(
            models.RetiroPropietario.fecha >= inicio,
            models.RetiroPropietario.fecha < fin,
            models.RetiroPropietario.metodo_pago.in_(METODOS_POR_GAVETA["1010"]),
        )
        .all()
    )
    return round(sum(r.monto for r in retiros), 2)


# A que cuenta va cada metodo de pago, dado la vuelta: de la cuenta a sus
# metodos. Sale del plan de cuentas y no de una lista repetida aqui, asi un
# metodo nuevo queda arqueado solo. "Efectivo" a secas es historico: antes de
# separar bolivares de divisas todo el efectivo iba a la misma cuenta.
METODOS_POR_GAVETA = {
    codigo: tuple(
        m for m, c in contabilidad.CUENTA_POR_METODO_PAGO.items() if c == codigo
    )
    for codigo in set(contabilidad.CUENTA_POR_METODO_PAGO.values())
}

# Los destinos que se arquean al cerrar, en el orden en que se cuentan.
#
# El fiado (1015) NO esta: ahi no entro plata, nacio una deuda. Contarlo seria
# pedirle al cajero que "cuente" algo que no esta en ninguna gaveta ni en
# ningun banco.
#
# `fisico` es la diferencia que importa en la mano: los billetes se CUENTAN,
# lo electronico se COTEJA contra el banco o el lote del punto.
DESTINOS_ARQUEO = (
    ("1010", "Efectivo en bolívares", True),
    ("1011", "Efectivo en dólares", True),
    ("1020", "Banco, punto y pago móvil", False),
    ("1021", "Zelle", False),
)


def _entradas_de_gaveta_hoy(db: Session, codigo: str) -> float:
    """Lo que entro a esa gaveta por ventas, contando lo recibido y el vuelto.

    Con un billete de $20 por una compra de $10 entran 20 y salen 10: si solo
    se cuenta el neto, el conteo fisico nunca cuadra cuando el vuelto sale por
    la otra gaveta.
    """
    metodos = METODOS_POR_GAVETA.get(codigo, ())
    total = 0.0
    for pedido in _pedidos_pagados_hoy(db):
        for pago in pedido.pagos:
            if pago.metodo in metodos:
                total += (pago.recibido or pago.monto)
            # Vuelto entregado desde ESTA gaveta por un pago que entro en otra.
            if pago.vuelto_monto and pago.vuelto_metodo in metodos and pago.metodo not in metodos:
                total -= pago.vuelto_monto
    return round(total, 2)


def _salidas_gaveta_hoy(db: Session, codigo: str) -> float:
    """Todo lo que salio de esa gaveta hoy que no fue una venta, segun los libros."""
    inicio, fin = _rango_hoy()
    # neto = entradas - salidas. Las unicas entradas son las ventas en efectivo,
    # asi que lo demas que movio la cuenta son salidas.
    neto = contabilidad.movimiento_efectivo(db, inicio, fin, codigo)
    return round(_entradas_de_gaveta_hoy(db, codigo) - neto, 2)


def _salidas_efectivo_hoy(db: Session) -> float:
    return _salidas_gaveta_hoy(db, "1010")


def _saldo_anterior(db: Session) -> float:
    """Lo que quedo en la gaveta de dias anteriores.

    La caja no arranca en cero cada manana: si ayer sobro plata, hoy sigue ahi.
    Sin esto, un dia en que se le paga al proveedor mas de lo que se vendio en
    efectivo mostraba un "deberia haber" negativo, que no significa nada.
    """
    inicio, _fin = _rango_hoy()
    return contabilidad.movimiento_efectivo(db, datetime.datetime.min, inicio)


def _saldo_anterior_de(db: Session, codigo: str) -> float:
    inicio, _fin = _rango_hoy()
    return contabilidad.movimiento_efectivo(db, datetime.datetime.min, inicio, codigo)


def _ventas_por_metodo_hoy(db: Session) -> dict:
    """Lo cobrado hoy por cada metodo, sin contar las devueltas."""
    por_metodo: dict = {}
    for pedido in _pedidos_pagados_hoy(db):
        if pedido.devuelto:
            continue
        for pago in pedido.pagos:
            por_metodo[pago.metodo] = round(por_metodo.get(pago.metodo, 0) + pago.monto, 2)
    return por_metodo


def _linea_arqueo(
    db: Session, codigo: str, etiqueta: str, fisico: bool, ventas: dict
) -> schemas.LineaArqueo:
    """Una fila del arqueo.

    Para una GAVETA, "lo que debe haber" es un saldo: lo que quedaba de ayer
    mas lo que entro hoy menos lo que salio. Para el BANCO es un flujo: lo que
    debio moverse hoy, que es lo que se ve en el extracto. Sumarle el saldo
    anterior a la cuenta del banco daria un numero que no esta en ningun sitio
    contra el que cotejar.
    """
    metodos = METODOS_POR_GAVETA.get(codigo, ())
    saldo_anterior = _saldo_anterior_de(db, codigo) if fisico else 0.0
    entradas = _entradas_de_gaveta_hoy(db, codigo)
    salidas = _salidas_gaveta_hoy(db, codigo)
    return schemas.LineaArqueo(
        cuenta=codigo,
        etiqueta=etiqueta,
        metodos={m: ventas[m] for m in metodos if ventas.get(m)},
        fisico=fisico,
        saldo_anterior=saldo_anterior,
        entradas_hoy=entradas,
        salidas_hoy=salidas,
        esperado=round(saldo_anterior + entradas - salidas, 2),
    )


def _arqueo(db: Session) -> List[schemas.LineaArqueo]:
    """Las filas a arquear. Las gavetas siempre --se cuentan aunque esten
    vacias--; el banco y Zelle solo si se movieron hoy, para no llenar la
    pantalla de ceros que nadie va a cotejar."""
    ventas = _ventas_por_metodo_hoy(db)
    filas = []
    for codigo, etiqueta, fisico in DESTINOS_ARQUEO:
        linea = _linea_arqueo(db, codigo, etiqueta, fisico, ventas)
        if not fisico and abs(linea.esperado) < 0.01 and not linea.metodos:
            continue
        filas.append(linea)
    return filas


def _gaveta(db: Session, codigo: str, etiqueta: str) -> schemas.Gaveta:
    saldo_anterior = _saldo_anterior_de(db, codigo)
    entradas = _entradas_de_gaveta_hoy(db, codigo)
    salidas = _salidas_gaveta_hoy(db, codigo)
    return schemas.Gaveta(
        codigo=codigo,
        etiqueta=etiqueta,
        saldo_anterior=saldo_anterior,
        entradas_hoy=entradas,
        salidas_hoy=salidas,
        esperado=round(saldo_anterior + entradas - salidas, 2),
    )


@router.get("/resumen", response_model=schemas.ResumenCaja)
def resumen_caja(db: Session = Depends(get_db)):
    # Las devueltas no son ventas: el cliente trajo la comida y se le devolvio
    # la plata. Siguen en `_pedidos_pagados_hoy` porque la plata SI entro y
    # salio de la gaveta (eso lo cuadra el calculo de las gavetas), pero no
    # cuentan en "ventas de hoy" ni en el desglose por forma de pago.
    pedidos = [p for p in _pedidos_pagados_hoy(db) if not p.devuelto]
    por_metodo: dict = {}
    total = 0.0
    for pedido in pedidos:
        total += pedido.total
        # Se desglosa por pago, no por pedido: una venta mixta aporta a dos
        # metodos distintos y antes aparecia entera bajo una etiqueta inventada.
        for pago in pedido.pagos:
            por_metodo[pago.metodo] = por_metodo.get(pago.metodo, 0) + pago.monto

    # Lo que debe haber en la gaveta lo dice la contabilidad, no un calculo
    # aparte: el saldo de la cuenta 1010 ya incluye ventas en efectivo, gastos,
    # pagos a proveedores y compras sueltas. Cuando Caja llevaba su propia
    # cuenta solo restaba Gastos, y los dias de pagar al proveedor mostraba un
    # faltante inexistente (medido: hasta $93.95 en un dia).
    # El esperado de la gaveta de bolivares sale del mismo calculo que la
    # gaveta: sumar `por_metodo["Efectivo"]` se quedaba corto desde que existen
    # "Efectivo Bs", el vuelto y la propina.
    bolivares = _gaveta(db, "1010", "Bolivares")
    saldo_anterior = bolivares.saldo_anterior
    salidas = bolivares.salidas_hoy
    efectivo_esperado = bolivares.esperado

    return schemas.ResumenCaja(
        fecha=hoy().isoformat(),
        total_ventas=round(total, 2),
        por_metodo_pago={k: round(v, 2) for k, v in por_metodo.items()},
        saldo_anterior=saldo_anterior,
        efectivo_esperado=efectivo_esperado,
        salidas_efectivo=salidas,
        retiros_hoy=_retiros_hoy(db),
        cantidad_pedidos=len(pedidos),
        # Dos monedas, dos montones de billetes, dos conteos. Un solo numero
        # hacia imposible arquear: decia "esperado $10" tanto si en la gaveta
        # habia un billete verde como si habia Bs 400.
        gavetas=[bolivares, _gaveta(db, "1011", "Divisas ($)")],
        arqueo=_arqueo(db),
        propinas_por_entregar=round(contabilidad.saldo_de_cuenta(db, "2040"), 2),
        fiado_por_cobrar=round(contabilidad.saldo_de_cuenta(db, "1015"), 2),
        propinas_hoy=round(
            sum(p.propina or 0 for p in pedidos), 2
        ),
        descuentos_hoy=round(sum(p.descuento or 0 for p in pedidos), 2),
    )


@router.post("/cerrar", response_model=schemas.CierreCaja)
def cerrar_caja(
    body: schemas.CierreCajaRequest, request: Request, db: Session = Depends(get_db)
):
    inicio, fin = _rango_hoy()
    # Cerrar dos veces el mismo dia ahora genera dos asientos de diferencia y
    # descuadraria la caja contra si misma.
    quien = operadores.del_turno(db, request, body.operador_id)
    punto = operadores.resolver_punto(db, body.punto_venta_id)

    # Cada caja cierra la suya: con dos pisos, el segundo cierre del dia no es
    # un duplicado sino la otra gaveta. Antes devolvia 409 y la caja de arriba
    # no podia cuadrar lo suyo.
    ya_cerrada = (
        db.query(models.CierreCaja)
        .filter(
            models.CierreCaja.fecha >= inicio,
            models.CierreCaja.fecha < fin,
            models.CierreCaja.anulado.is_(False),
            models.CierreCaja.punto_venta_id == (punto.id if punto else None),
        )
        .first()
    )
    if ya_cerrada:
        cual = f"La caja de {punto.nombre}" if punto else "La caja de hoy"
        raise HTTPException(
            status_code=409,
            detail=f"{cual} ya fue cerrada hoy. Si el conteo quedó mal, anula ese cierre y vuelve a cerrar.",
        )

    resumen = resumen_caja(db)
    arqueo = {linea.cuenta: linea for linea in resumen.arqueo}

    # Lo contado, por destino. `conteos` es la forma nueva; los dos campos
    # sueltos son como se cerraba antes y se siguen aceptando.
    contados: dict = {c.cuenta: c.contado for c in body.conteos}
    if not body.conteos:
        if body.efectivo_contado is None:
            raise HTTPException(
                status_code=400,
                detail="Falta el conteo: dinos al menos cuánto efectivo hay en la gaveta.",
            )
        contados = {"1010": body.efectivo_contado, "1011": round(body.divisas_contado or 0, 2)}
    # Nulo = no se verifico ese destino, y entonces no hay diferencia que
    # asentar. Distinto de cero, que es "conte y no habia nada".
    contados = {k: v for k, v in contados.items() if v is not None}
    if not contados:
        raise HTTPException(
            status_code=400,
            detail="Falta el conteo: hay que verificar al menos un destino para cerrar.",
        )

    bolivares = arqueo.get("1010")
    divisas = arqueo.get("1011")
    esperado_bs = bolivares.esperado if bolivares else resumen.efectivo_esperado
    esperado_usd = divisas.esperado if divisas else 0.0
    contado_bs = contados.get("1010")
    contado_usd = contados.get("1011")

    db_cierre = models.CierreCaja(
        total_sistema=resumen.total_ventas,
        efectivo_esperado=esperado_bs,
        # Las columnas viejas no aceptan nulo: si no se conto la gaveta se
        # guarda lo esperado, que deja la diferencia en cero -- que es
        # justamente "no se verifico, no hay nada que reclamar".
        efectivo_contado=contado_bs if contado_bs is not None else esperado_bs,
        diferencia=round((contado_bs - esperado_bs), 2) if contado_bs is not None else 0.0,
        divisas_esperado=esperado_usd,
        divisas_contado=contado_usd if contado_usd is not None else esperado_usd,
        divisas_diferencia=round((contado_usd - esperado_usd), 2) if contado_usd is not None else 0.0,
        nota=body.nota,
        operador_id=quien.id if quien else None,
        punto_venta_id=punto.id if punto else None,
    )
    db.add(db_cierre)
    db.flush()

    # El detalle: una fila por destino verificado, con lo que decia el sistema
    # al cerrar. Congelado aqui porque manana el esperado ya no sera el mismo.
    for cuenta, contado in contados.items():
        linea = arqueo.get(cuenta)
        esperado = linea.esperado if linea else 0.0
        db.add(
            models.CierreCajaLinea(
                cierre_id=db_cierre.id,
                cuenta=cuenta,
                etiqueta=linea.etiqueta if linea else cuenta,
                metodos=", ".join(linea.metodos) if linea and linea.metodos else "",
                esperado=esperado,
                contado=round(contado, 2),
                diferencia=round(contado - esperado, 2),
            )
        )
    db.flush()
    # El faltante/sobrante tambien va a los libros: si no, 1010 nunca se
    # concilia con lo que de verdad hay en la gaveta.
    contabilidad.registrar_diferencia_caja(db, db_cierre)
    db.commit()
    db.refresh(db_cierre)
    return _a_schema(db_cierre)


@router.post("/cierres/{cierre_id}/anular", response_model=schemas.CierreCaja)
def anular_cierre(
    cierre_id: int, body: schemas.AnularCierreRequest, db: Session = Depends(get_db)
):
    """Deshace un cierre mal contado.

    Un digito de mas al teclear el efectivo (1000 en vez de 100) metia un
    sobrante ficticio en los libros que no habia forma de sacar: no existia
    borrar y volver a cerrar devolvia 409. El error ademas se arrastraba a los
    dias siguientes, porque la caja de manana arranca del saldo de hoy.

    El cierre no se borra, se anula: queda la fila con su motivo y un
    contra-asiento que revierte la diferencia. Despues se puede volver a
    cerrar el dia con el conteo bueno.
    """
    cierre = db.query(models.CierreCaja).filter(models.CierreCaja.id == cierre_id).first()
    if not cierre:
        raise HTTPException(status_code=404, detail="Cierre no encontrado")
    if cierre.anulado:
        raise HTTPException(status_code=409, detail="Ese cierre ya estaba anulado")

    contabilidad.registrar_reverso_diferencia_caja(db, cierre)
    cierre.anulado = True
    cierre.fecha_anulacion = ahora()
    cierre.motivo_anulacion = body.motivo
    db.commit()
    db.refresh(cierre)
    return _a_schema(cierre)


def _a_schema(c: models.CierreCaja) -> schemas.CierreCaja:
    return schemas.CierreCaja(
        lineas=[
            schemas.LineaCierre(
                cuenta=l.cuenta,
                etiqueta=l.etiqueta or l.cuenta,
                metodos=l.metodos or "",
                esperado=l.esperado or 0,
                contado=l.contado,
                diferencia=l.diferencia or 0,
            )
            for l in c.lineas
        ],
        id=c.id,
        fecha=c.fecha.isoformat(),
        total_sistema=c.total_sistema,
        efectivo_esperado=c.efectivo_esperado,
        efectivo_contado=c.efectivo_contado,
        diferencia=c.diferencia,
        nota=c.nota,
        anulado=bool(c.anulado),
        motivo_anulacion=c.motivo_anulacion or "",
        operador=c.operador,
        punto_venta=c.punto_venta,
        divisas_esperado=round(c.divisas_esperado or 0, 2),
        divisas_contado=round(c.divisas_contado or 0, 2),
        divisas_diferencia=round(c.divisas_diferencia or 0, 2),
    )


@router.get("/propinas", response_model=schemas.PropinasPendientes)
def propinas_pendientes(db: Session = Depends(get_db)):
    """Cuanta propina hay en la gaveta que todavia no se le ha dado a nadie."""
    return schemas.PropinasPendientes(
        por_entregar=round(contabilidad.saldo_de_cuenta(db, "2040"), 2)
    )


@router.post("/propinas/entregar")
def entregar_propinas(body: schemas.EntregarPropinasRequest, db: Session = Depends(get_db)):
    """Se le entrega al empleado la propina que estaba en la gaveta.

    Antes no habia donde meterla: el cobro rechazaba un pago mayor al total, y
    si la propina se quedaba en la gaveta el cierre la reportaba como sobrante
    y terminaba como ingreso del negocio - pagando impuesto sobre plata ajena.
    """
    pendiente = contabilidad.saldo_de_cuenta(db, "2040")
    monto = round(body.monto, 2)
    if monto <= 0:
        raise HTTPException(status_code=400, detail="El monto debe ser mayor a cero")
    if monto > pendiente + 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"Solo hay ${pendiente:.2f} de propinas por entregar.",
        )
    if body.metodo_pago not in contabilidad.CUENTA_POR_METODO_PAGO:
        raise HTTPException(status_code=400, detail="Forma de pago desconocida")

    contabilidad.registrar_entrega_propinas(db, monto, body.metodo_pago, 0, body.nota)
    db.commit()
    return {"ok": True, "entregado": monto, "queda": round(pendiente - monto, 2)}


@router.get("/fiado", response_model=List[schemas.CuentaPorCobrar])
def listar_fiado(db: Session = Depends(get_db)):
    """Quien le debe al negocio y desde cuando."""
    pedidos = (
        db.query(models.Pedido)
        .join(models.PagoPedido)
        .filter(
            models.PagoPedido.metodo == "Fiado",
            models.Pedido.fiado_saldado.is_(False),
            models.Pedido.devuelto.is_(False),
        )
        .order_by(models.Pedido.cerrado_en)
        .all()
    )
    ahora_ = ahora()
    filas = []
    for p in pedidos:
        fecha = p.cerrado_en or p.creado_en
        filas.append(
            schemas.CuentaPorCobrar(
                pedido_id=p.id,
                numero=p.numero,
                cliente=p.cliente or "Sin nombre",
                # Lo que falta, no lo que se vendio: si abono la mitad, la
                # pantalla tiene que decir la mitad o la cajera le cobra dos
                # veces lo mismo.
                monto=p.fiado_saldo,
                original=p.fiado_monto,
                abonado=p.fiado_abonado,
                abonos=len(p.abonos),
                fecha=fecha,
                dias=(ahora_ - fecha).days,
            )
        )
    return filas


@router.post("/fiado/{pedido_id}/cobrar")
def cobrar_fiado(pedido_id: int, body: schemas.SaldarFiadoRequest, db: Session = Depends(get_db)):
    """El cliente vino a pagar lo que debia."""
    pedido = db.query(models.Pedido).filter(models.Pedido.id == pedido_id).first()
    if not pedido:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    if pedido.fiado_saldado:
        raise HTTPException(status_code=409, detail="Esa cuenta a crédito ya fue cobrada")
    if pedido.devuelto:
        raise HTTPException(status_code=409, detail="Ese pedido fue devuelto: ya no se debe")
    saldo = pedido.fiado_saldo
    if pedido.fiado_monto <= 0:
        raise HTTPException(status_code=400, detail="Ese pedido no quedó a crédito")
    if saldo <= 0:
        raise HTTPException(status_code=409, detail="Esa cuenta a crédito ya está pagada")
    if body.metodo_pago == "Fiado" or body.metodo_pago not in contabilidad.CUENTA_POR_METODO_PAGO:
        raise HTTPException(status_code=400, detail="Forma de cobro inválida")
    # Cobrar un crédito es aplicar un pago, igual que cobrar en el punto de
    # venta: si no entra por la gaveta tiene un comprobante, y sin anotarlo no
    # hay con qué responder cuando el cliente diga que ya pagó. Este endpoint
    # era el único que aceptaba un pago móvil sin referencia.
    referencia = (body.referencia or "").strip()
    if body.metodo_pago in contabilidad.METODOS_CON_REFERENCIA and not referencia:
        raise HTTPException(
            status_code=400,
            detail=f"Un cobro por {body.metodo_pago} necesita su número de referencia",
        )

    monto = saldo if body.monto is None else round(body.monto, 2)
    if monto <= 0:
        raise HTTPException(status_code=400, detail="El abono tiene que ser mayor que cero")
    if monto > saldo + 0.005:
        # Cobrar de mas no es un abono, es un error de tecleo. Aceptarlo
        # dejaria 1015 en negativo: el cliente nos deberia menos que nada.
        raise HTTPException(
            status_code=400,
            detail=f"No se puede cobrar {monto:.2f}: solo debe {saldo:.2f}",
        )

    restante = round(saldo - monto, 2)
    # Por debajo de un centavo esta pago: perseguir 0.004 seria dejar la
    # deuda viva para siempre por un redondeo.
    if restante < 0.01:
        restante = 0.0

    db.add(models.AbonoFiado(
        pedido_id=pedido.id,
        monto=monto,
        metodo_pago=body.metodo_pago,
        referencia=referencia,
        operador_id=body.operador_id,
        fecha=ahora(),
    ))
    contabilidad.registrar_cobro_fiado(db, pedido, monto, body.metodo_pago, saldo_restante=restante)
    if restante <= 0:
        pedido.fiado_saldado = True
        pedido.fecha_cobro_fiado = ahora()
    db.commit()
    return {
        "ok": True,
        "cobrado": monto,
        "queda": restante,
        "saldado": restante <= 0,
        "cliente": pedido.cliente,
    }


@router.get("/retiros", response_model=List[schemas.RetiroPropietario])
def listar_retiros(rango: Rango = Depends(), db: Session = Depends(get_db)):
    inicio, fin, _ = rango.resolver(dias=30)
    return (
        db.query(models.RetiroPropietario)
        .filter(models.RetiroPropietario.fecha >= inicio, models.RetiroPropietario.fecha < fin)
        .order_by(models.RetiroPropietario.id.desc())
        .all()
    )


@router.post("/retiros", response_model=schemas.RetiroPropietario)
def crear_retiro(body: schemas.RetiroCreate, db: Session = Depends(get_db)):
    """El dueno se lleva plata del negocio.

    Va contra patrimonio, no contra resultados: no es un gasto del negocio
    sino capital que sale, asi que no debe bajar la ganancia.
    """
    if body.monto <= 0:
        raise HTTPException(status_code=400, detail="El monto debe ser mayor a cero")
    if not contabilidad.metodo_de_pago_valido(body.metodo_pago):
        raise HTTPException(
            status_code=400,
            detail="El retiro sale de una gaveta (Efectivo Bs, Efectivo $) o del Banco",
        )

    retiro = models.RetiroPropietario(
        monto=body.monto, metodo_pago=body.metodo_pago, nota=body.nota
    )
    db.add(retiro)
    db.flush()
    contabilidad.registrar_retiro(db, retiro)
    db.commit()
    db.refresh(retiro)
    return retiro


@router.delete("/retiros/{retiro_id}")
def eliminar_retiro(retiro_id: int, db: Session = Depends(get_db)):
    retiro = db.query(models.RetiroPropietario).filter(models.RetiroPropietario.id == retiro_id).first()
    if not retiro:
        raise HTTPException(status_code=404, detail="Retiro no encontrado")
    _solo_si_el_ejercicio_esta_abierto(db, retiro.fecha, "ese retiro")
    for asiento in (
        db.query(models.AsientoContable)
        .filter_by(origen="retiro", referencia_id=retiro_id)
        .all()
    ):
        db.delete(asiento)
    db.delete(retiro)
    db.commit()
    return {"ok": True}


@router.get("/cierres", response_model=List[schemas.CierreCaja])
def listar_cierres(rango: Rango = Depends(), db: Session = Depends(get_db)):
    """Los cierres del periodo. Sin rango, los ultimos 30 dias."""
    inicio, fin, _ = rango.resolver(dias=30)
    cierres = (
        db.query(models.CierreCaja)
        .filter(models.CierreCaja.fecha >= inicio, models.CierreCaja.fecha < fin)
        .order_by(models.CierreCaja.id.desc())
        .all()
    )
    return [_a_schema(c) for c in cierres]


@router.get("/gastos", response_model=List[schemas.Gasto])
def listar_gastos(rango: Rango = Depends(), db: Session = Depends(get_db)):
    inicio, fin, _ = rango.resolver(dias=30)
    return (
        db.query(models.Gasto)
        .filter(models.Gasto.fecha >= inicio, models.Gasto.fecha < fin)
        .order_by(models.Gasto.id.desc())
        .all()
    )


def _solo_si_el_ejercicio_esta_abierto(db: Session, fecha, que: str) -> None:
    """Borrar algo de un año cerrado cambiaria un resultado ya firmado. 409."""
    try:
        contabilidad.asegurar_ejercicio_abierto(db, fecha, que)
    except contabilidad.ErrorEjercicioCerrado as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.post("/gastos", response_model=schemas.Gasto)
def crear_gasto(gasto: schemas.GastoCreate, db: Session = Depends(get_db)):
    if gasto.monto <= 0:
        raise HTTPException(status_code=400, detail="El monto debe ser mayor a cero")
    if not contabilidad.metodo_de_pago_valido(gasto.metodo_pago):
        raise HTTPException(
            status_code=400,
            detail="El gasto sale de una gaveta (Efectivo Bs, Efectivo $) o del Banco",
        )
    db_gasto = models.Gasto(**gasto.model_dump())
    db.add(db_gasto)
    db.flush()
    contabilidad.registrar_gasto(db, db_gasto)
    db.commit()
    db.refresh(db_gasto)
    return db_gasto


@router.delete("/gastos/{gasto_id}")
def eliminar_gasto(gasto_id: int, db: Session = Depends(get_db)):
    db_gasto = db.query(models.Gasto).filter(models.Gasto.id == gasto_id).first()
    if not db_gasto:
        raise HTTPException(status_code=404, detail="Gasto no encontrado")
    _solo_si_el_ejercicio_esta_abierto(db, db_gasto.fecha, "ese gasto")
    # Uno por uno con db.delete(): un DELETE masivo sobre el query NO dispara el
    # cascade del ORM y dejaria vivos los movimientos del asiento, que el balance
    # de comprobacion sigue sumando aunque el asiento ya no exista.
    for asiento in (
        db.query(models.AsientoContable)
        .filter(
            models.AsientoContable.origen == "gasto",
            models.AsientoContable.referencia_id == gasto_id,
        )
        .all()
    ):
        db.delete(asiento)
    db.delete(db_gasto)
    db.commit()
    return {"ok": True}
