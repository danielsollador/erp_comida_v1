import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import contabilidad, models, schemas
from ..database import get_db
from ..rango import Rango
from ..timeutils import ahora, hoy, inicio_del_dia
from . import operadores

router = APIRouter(prefix="/api/caja", tags=["caja"])


def _rango_de(fecha: datetime.date):
    """El dia que se esta mirando, de medianoche a medianoche.

    Recibe la fecha en vez de asumir hoy: la caja de ayer se cuadra esta
    manana. En un local de verdad no siempre da tiempo de cerrar antes de
    bajar la santamaria, y obligar a cuadrar "hoy o nunca" es lo que hace que
    se dejen de cerrar cajas.
    """
    inicio = inicio_del_dia(fecha)
    return inicio, inicio + datetime.timedelta(days=1)


def _pedidos_pagados(db: Session, inicio, fin):
    return (
        db.query(models.Pedido)
        .filter(
            models.Pedido.estado == "pagado",
            models.Pedido.cerrado_en >= inicio,
            models.Pedido.cerrado_en < fin,
        )
        .all()
    )


def _gastos_de(db: Session, inicio, fin):
    return (
        db.query(models.Gasto)
        .filter(models.Gasto.fecha >= inicio, models.Gasto.fecha < fin)
        .all()
    )


def _retiros_de(db: Session, inicio, fin):
    return (
        db.query(models.RetiroPropietario)
        .filter(
            models.RetiroPropietario.fecha >= inicio,
            models.RetiroPropietario.fecha < fin,
        )
        .all()
    )


# Los metodos que se cuadran al cerrar, en el orden en que se revisan: primero
# lo que se cuenta con la mano, despues lo que se coteja contra una pantalla.
#
# `fisico` cambia lo que la persona HACE: los billetes se cuentan, el punto de
# venta se lee del lote que imprime el terminal y el pago movil del banco.
#
# El credito va de ultimo y no se "cuenta": no entro plata, nacio una deuda.
# Se muestra igual porque el dueno quiere ver cuanto se fio ese dia, y
# confirmarlo es una verificacion mas.
METODOS_DE_CIERRE = (
    ("Efectivo Bs", True),
    ("Efectivo $", True),
    ("Punto de venta", False),
    ("Pago movil", False),
    ("Transferencia", False),
    ("Tarjeta", False),
    ("Zelle", False),
    ("Fiado", False),
)

# "Efectivo" a secas es historico: antes de separar bolivares de divisas todo
# el efectivo iba a la misma cuenta. Se suma a "Efectivo Bs" para que una
# venta vieja no quede fuera del cuadre.
ALIAS_METODO = {"Efectivo": "Efectivo Bs", "Banco": "Transferencia"}


def _normalizar(metodo: str) -> str:
    return ALIAS_METODO.get(metodo, metodo)


def _ventas_por_metodo(db: Session, inicio, fin) -> dict:
    """Lo que entro por cada forma de pago, pago por pago.

    Se mira el PAGO y no el pedido: una venta mixta --algo en efectivo y el
    resto por pago movil-- aporta a dos metodos distintos, y contarla entera
    bajo una sola etiqueta es lo que hacia imposible cuadrar.

    Las devueltas no cuentan: el cliente trajo la comida y se le devolvio la
    plata, asi que ni es venta ni quedo en la gaveta.
    """
    por_metodo: dict = {}
    for pedido in _pedidos_pagados(db, inicio, fin):
        if pedido.devuelto:
            continue
        for pago in pedido.pagos:
            m = _normalizar(pago.metodo)
            por_metodo[m] = round(por_metodo.get(m, 0.0) + pago.monto, 2)
    return por_metodo


def _salidas_por_metodo(db: Session, inicio, fin) -> dict:
    """Lo que salio por cada forma de pago: gastos y retiros del dueno.

    Es la mitad que faltaba para que el cuadre tenga sentido. Si la caja
    cobro 100 en efectivo y de ahi salieron 50 para una bombona, al contar
    tienen que aparecer 50 y no 100.
    """
    por_metodo: dict = {}
    for g in _gastos_de(db, inicio, fin):
        m = _normalizar(g.metodo_pago or "Efectivo Bs")
        por_metodo[m] = round(por_metodo.get(m, 0.0) + g.monto, 2)
    for r in _retiros_de(db, inicio, fin):
        m = _normalizar(r.metodo_pago or "Efectivo Bs")
        por_metodo[m] = round(por_metodo.get(m, 0.0) + r.monto, 2)
    return por_metodo


def _cuentas_de(metodo: str) -> str:
    return contabilidad.CUENTA_POR_METODO_PAGO.get(metodo, "1010")


def _saldo_anterior_de(db: Session, codigo: str, inicio) -> float:
    """Lo que quedo en esa gaveta de dias anteriores.

    La caja no arranca en cero cada manana: si ayer sobro plata, hoy sigue
    ahi. Sin esto, un dia en que se le paga al proveedor mas de lo que se
    vendio en efectivo mostraba un "deberia haber" negativo, que no significa
    nada.
    """
    return contabilidad.movimiento_efectivo(db, datetime.datetime.min, inicio, codigo)


# Que metodos caen en cada cuenta. El punto de venta, el pago movil, la
# transferencia y la tarjeta comparten 1020: ahi no se puede saber por cual
# de los cuatro entro un movimiento que no sea una venta.
METODOS_POR_CUENTA: dict = {}
for _m, _f in METODOS_DE_CIERRE:
    METODOS_POR_CUENTA.setdefault(contabilidad.CUENTA_POR_METODO_PAGO.get(_m, "1010"), []).append(_m)


def _desglose(db: Session, inicio, fin) -> List[schemas.LineaMetodo]:
    """Una fila por forma de pago: lo que entro, lo que salio y que deberia
    haber.

    LO QUE NO ES VENTA NI GASTO TAMBIEN CUENTA. Pagarle a un proveedor en
    efectivo, declarar con cuanto arranco la gaveta, cobrar un fiado: todo eso
    mueve la plata y los libros lo saben, pero no es ninguna de las dos cosas
    que el dueno tiene en la cabeza al cuadrar. Si se ignora, contar la gaveta
    da un descuadre del tamano de esos movimientos.

    Cuando una forma de pago es la UNICA que usa su cuenta --el efectivo en
    bolivares es la unica que toca 1010-- ese resto se le puede atribuir, y
    entonces lo esperado es el saldo contable: la verdad completa. Cuando
    cuatro metodos comparten cuenta (1020) no hay forma de saber por cual
    entro, asi que el resto se reporta aparte (ver `_otros_movimientos`).
    """
    ventas = _ventas_por_metodo(db, inicio, fin)
    salidas = _salidas_por_metodo(db, inicio, fin)
    filas = []
    for metodo, fisico in METODOS_DE_CIERRE:
        cuenta = _cuentas_de(metodo)
        entro = ventas.get(metodo, 0.0)
        salio = salidas.get(metodo, 0.0)
        # Solo el efectivo arrastra saldo: los billetes que sobraron ayer
        # siguen en la gaveta. Lo del banco y el punto se coteja contra el
        # movimiento del dia, que es lo que muestra el extracto.
        anterior = _saldo_anterior_de(db, cuenta, inicio) if fisico else 0.0

        otros = 0.0
        if len(METODOS_POR_CUENTA.get(cuenta, [])) == 1:
            neto_libro = contabilidad.movimiento_efectivo(db, inicio, fin, cuenta)
            otros = round(neto_libro - (entro - salio), 2)

        filas.append(
            schemas.LineaMetodo(
                metodo=metodo,
                cuenta=cuenta,
                fisico=fisico,
                # El credito no se cuenta: no hay billetes ni extracto que
                # mirar. Se muestra para saber cuanto se fio.
                se_cuadra=metodo != "Fiado",
                saldo_anterior=round(anterior, 2),
                ventas=round(entro, 2),
                salidas=round(salio, 2),
                otros=otros,
                esperado=round(anterior + entro - salio + otros, 2),
            )
        )
    return filas


def _otros_movimientos(db: Session, inicio, fin, desglose) -> List[schemas.OtroMovimiento]:
    """Lo que movio una cuenta compartida sin ser venta, gasto ni retiro.

    Solo queda aqui lo que NO se pudo atribuir a una forma de pago: los cuatro
    metodos que comparten la cuenta del banco (punto de venta, pago movil,
    transferencia y tarjeta). El asiento guarda la cuenta, no el metodo, asi
    que no hay forma de saber por cual de los cuatro salio.

    Se dice en vez de callarlo: que aparezca como un descuadre sin
    explicacion al contar es peor que una linea de mas.
    """
    fuera = []
    for cuenta, metodos in METODOS_POR_CUENTA.items():
        if len(metodos) == 1:
            continue  # ya va dentro de su propia fila
        neto_libro = contabilidad.movimiento_efectivo(db, inicio, fin, cuenta)
        explicado = round(
            sum(l.ventas - l.salidas for l in desglose if l.cuenta == cuenta), 2
        )
        resto = round(neto_libro - explicado, 2)
        if abs(resto) >= 0.01:
            fuera.append(
                schemas.OtroMovimiento(
                    cuenta=cuenta, etiqueta="Banco, punto y pago móvil", monto=resto
                )
            )
    return fuera


# Las cuentas cuyo saldo inicial se puede declarar. Son DESTINOS y no metodos:
# lo que se declara es con cuanto arranco la gaveta, no por que via entro.
DESTINOS_ARQUEO = (
    ("1010", "Efectivo en bolívares", True),
    ("1011", "Efectivo en dólares", True),
    ("1020", "Banco, punto y pago móvil", False),
    ("1021", "Zelle", False),
)


def _anulados(db: Session, inicio, fin):
    """Comandas que se botaron: cuantas y por cuanto.

    Se cuentan por `creado_en` y no por `cerrado_en`: un pedido anulado nunca
    se cierra, asi que filtrar por la fecha de cierre no devolvia ninguno.

    No tocan el cuadre --no movieron plata-- pero son la otra mitad de la
    pregunta que el dueno hace al cerrar: cuanto se vendio y cuanto se boto.
    """
    pedidos = (
        db.query(models.Pedido)
        .filter(
            models.Pedido.estado == "anulado",
            models.Pedido.creado_en >= inicio,
            models.Pedido.creado_en < fin,
        )
        .all()
    )
    return len(pedidos), round(sum(p.total for p in pedidos), 2)


def _devueltos(db: Session, inicio, fin):
    """Ventas cobradas que el cliente trajo de vuelta y se le reembolsaron.

    Distinto de anular: aqui la plata SI entro y volvio a salir.
    """
    pedidos = (
        db.query(models.Pedido)
        .filter(
            models.Pedido.devuelto.is_(True),
            models.Pedido.fecha_devolucion >= inicio,
            models.Pedido.fecha_devolucion < fin,
        )
        .all()
    )
    return len(pedidos), round(sum(p.total for p in pedidos), 2)


def _fecha_pedida(fecha: Optional[datetime.date]) -> datetime.date:
    d = fecha or hoy()
    if d > hoy():
        raise HTTPException(status_code=400, detail="Esa fecha todavía no llegó")
    return d


@router.get("/resumen", response_model=schemas.ResumenCaja)
def resumen_caja(fecha: Optional[datetime.date] = None, db: Session = Depends(get_db)):
    """Todo lo que hace falta para cuadrar un dia.

    Con `fecha` se mira cualquier dia pasado, no solo hoy: la caja de ayer se
    cuadra esta manana.
    """
    dia = _fecha_pedida(fecha)
    inicio, fin = _rango_de(dia)

    # Las devueltas no son ventas: el cliente trajo la comida y se le devolvio
    # la plata. Salen del total y del desglose; que la plata entrara y saliera
    # de la gaveta lo resuelven los libros.
    pedidos = [p for p in _pedidos_pagados(db, inicio, fin) if not p.devuelto]
    vendido = round(sum(p.total for p in pedidos), 2)
    descuentos = round(sum(p.descuento or 0 for p in pedidos), 2)
    propinas = round(sum(p.propina or 0 for p in pedidos), 2)
    # Lo que de verdad habia que cobrar: la comida, menos la rebaja, mas la
    # propina. Es contra esto que tiene que cuadrar el desglose.
    a_cobrar = round(vendido - descuentos + propinas, 2)

    desglose = _desglose(db, inicio, fin)
    cobrado = round(sum(l.ventas for l in desglose), 2)

    gastos_dia = _gastos_de(db, inicio, fin)
    retiros_dia = _retiros_de(db, inicio, fin)
    total_gastos = round(sum(g.monto for g in gastos_dia), 2)
    total_retiros = round(sum(r.monto for r in retiros_dia), 2)

    anulados, anulado_monto = _anulados(db, inicio, fin)
    devueltos, devuelto_monto = _devueltos(db, inicio, fin)

    cierre = (
        db.query(models.CierreCaja)
        .filter(
            models.CierreCaja.fecha >= inicio,
            models.CierreCaja.fecha < fin,
            models.CierreCaja.anulado.is_(False),
        )
        .first()
    )

    return schemas.ResumenCaja(
        fecha=dia.isoformat(),
        es_hoy=dia == hoy(),
        vendido=vendido,
        descuentos=descuentos,
        propinas=propinas,
        a_cobrar=a_cobrar,
        cobrado=cobrado,
        # Si esto no da, el desglose no explica las ventas y hay un pago mal
        # registrado. Se dice en la pantalla en vez de esconderlo.
        cuadra_ventas=abs(a_cobrar - cobrado) < 0.01,
        cantidad_pedidos=len(pedidos),
        anulados_hoy=anulados,
        anulado_monto_hoy=anulado_monto,
        devueltos_hoy=devueltos,
        devuelto_monto_hoy=devuelto_monto,
        gastos=total_gastos,
        retiros=total_retiros,
        desglose=desglose,
        otros_movimientos=_otros_movimientos(db, inicio, fin, desglose),
        fiado_por_cobrar=round(contabilidad.saldo_de_cuenta(db, "1015"), 2),
        propinas_por_entregar=round(contabilidad.saldo_de_cuenta(db, "2040"), 2),
        cerrada=cierre is not None,
        cierre_id=cierre.id if cierre else None,
    )


@router.post("/apertura", response_model=schemas.AperturaCaja)
def declarar_saldo_inicial(
    body: schemas.AperturaCajaRequest, db: Session = Depends(get_db)
):
    """Con cuanta plata arranco el negocio en esa gaveta.

    POR QUE HACE FALTA. Los libros empiezan en cero, pero el local no: el dia
    que se estrena el sistema ya hay billetes en la gaveta y saldo en el
    banco. Mientras nadie lo declare, la primera compra pagada en efectivo
    saca plata de una cuenta vacia y la deja en NEGATIVO -- un activo
    imposible.

    No es un detalle contable. El cierre calcula lo que deberia haber como
    `saldo anterior + entradas - salidas`: con el saldo anterior corrido, el
    primer arqueo reporta un sobrante que no existe, y ese sobrante termina
    asentado como ingreso del negocio.

    Es el mismo gesto que `contabilidad.asiento_de_apertura` hace con el
    inventario: lo que ya estaba entra contra el capital del dueño, porque
    no es una venta -- es plata suya que ya estaba ahi.

    UNA VEZ POR GAVETA. Declararlo dos veces duplicaria el capital. Si se
    tecleo mal, el asiento se borra desde Contabilidad y se vuelve a declarar.
    """
    codigo = body.cuenta
    etiquetas = {c: e for c, e, _ in DESTINOS_ARQUEO}
    if codigo not in etiquetas:
        raise HTTPException(
            status_code=400,
            detail="Solo se declara el saldo inicial de una gaveta o del banco",
        )
    if body.monto < 0:
        raise HTTPException(status_code=400, detail="El monto no puede ser negativo")

    ya = (
        db.query(models.AsientoContable)
        .filter(
            models.AsientoContable.origen == "apertura_caja",
            models.AsientoContable.referencia_id == int(codigo),
        )
        .first()
    )
    if ya:
        raise HTTPException(
            status_code=409,
            detail=(
                f"El saldo inicial de {etiquetas[codigo]} ya se declaró. "
                "Si quedó mal, borra ese asiento en Contabilidad y vuelve a declararlo."
            ),
        )

    nota = (body.nota or "").strip()
    descripcion = f"Apertura: efectivo inicial en {etiquetas[codigo]}"
    if nota:
        descripcion += f" ({nota})"
    # Contra el capital del dueño: esa plata no la genero el negocio vendiendo,
    # ya era suya. Meterla como ingreso inflaria la ganancia y pagaria impuesto
    # sobre algo que nunca se vendio.
    contabilidad.crear_asiento(
        db,
        descripcion,
        [(codigo, round(body.monto, 2), 0.0), ("3010", 0.0, round(body.monto, 2))],
        origen="apertura_caja",
        referencia_id=int(codigo),
    )
    db.commit()
    return schemas.AperturaCaja(
        cuenta=codigo,
        etiqueta=etiquetas[codigo],
        monto=round(body.monto, 2),
        saldo=round(contabilidad.saldo_de_cuenta(db, codigo), 2),
    )


@router.get("/apertura", response_model=List[schemas.DestinoApertura])
def estado_apertura(db: Session = Depends(get_db)):
    """Que gavetas ya declararon con cuanto arrancaron, y cuales hacen falta.

    `urge` marca las que estan en negativo: ahi la falta de declaracion ya
    esta ensuciando los libros y el proximo cierre va a mentir.
    """
    declaradas = {
        a.referencia_id
        for a in db.query(models.AsientoContable).filter_by(origen="apertura_caja").all()
    }
    filas = []
    for codigo, etiqueta, _fisico in DESTINOS_ARQUEO:
        saldo = round(contabilidad.saldo_de_cuenta(db, codigo), 2)
        filas.append(
            schemas.DestinoApertura(
                cuenta=codigo,
                etiqueta=etiqueta,
                declarada=int(codigo) in declaradas,
                saldo=saldo,
                urge=saldo < -0.01 and int(codigo) not in declaradas,
            )
        )
    return filas


@router.post("/cerrar", response_model=schemas.CierreCaja)
def cerrar_caja(
    body: schemas.CierreCajaRequest, request: Request, db: Session = Depends(get_db)
):
    """Cuadrar la caja de un dia.

    Se cuenta POR FORMA DE PAGO y no por cuenta contable, porque es como se
    cuenta de verdad: los billetes se cuentan, el punto de venta imprime su
    lote, el pago movil y el Zelle se miran en el telefono. Cada uno tiene su
    propia fuente de verdad, y juntarlos en "banco" obligaba a sumarlos a mano
    antes de poder teclear un solo numero.

    La diferencia se asienta por CUENTA, no por metodo: los libros llevan
    cuentas. Si el punto y el pago movil --que caen los dos en 1020-- fallan
    cada uno por su lado, lo que va al asiento es la suma.
    """
    dia = _fecha_pedida(body.fecha)
    inicio, fin = _rango_de(dia)
    quien = operadores.del_turno(db, request, body.operador_id)

    ya_cerrada = (
        db.query(models.CierreCaja)
        .filter(
            models.CierreCaja.fecha >= inicio,
            models.CierreCaja.fecha < fin,
            models.CierreCaja.anulado.is_(False),
        )
        .first()
    )
    if ya_cerrada:
        cuando = "de hoy" if dia == hoy() else f"del {dia.strftime('%d/%m')}"
        raise HTTPException(
            status_code=409,
            detail=f"La caja {cuando} ya fue cerrada. Si el conteo quedó mal, "
            "anula ese cierre y vuelve a cerrar.",
        )

    resumen = resumen_caja(dia, db)
    esperados = {l.metodo: l for l in resumen.desglose}

    # Nulo = no se verifico esa forma de pago, y entonces no hay diferencia
    # que asentar. Distinto de cero, que es "conte y no habia nada".
    contados = {
        c.metodo: round(c.contado, 2)
        for c in body.conteos
        if c.contado is not None and c.metodo in esperados
    }
    if not contados:
        raise HTTPException(
            status_code=400,
            detail="Falta el conteo: hay que verificar al menos una forma de pago para cerrar.",
        )

    # La fecha del cierre es la del DIA que se cuadra, no la de ahora: cerrar
    # el lunes la caja del domingo tiene que quedar archivado en el domingo, o
    # el historico miente y el dia siguiente arranca con el saldo equivocado.
    momento = ahora() if dia == hoy() else inicio + datetime.timedelta(hours=23, minutes=59)

    bolivares = esperados.get("Efectivo Bs")
    divisas = esperados.get("Efectivo $")
    esperado_bs = bolivares.esperado if bolivares else 0.0
    esperado_usd = divisas.esperado if divisas else 0.0
    contado_bs = contados.get("Efectivo Bs")
    contado_usd = contados.get("Efectivo $")

    db_cierre = models.CierreCaja(
        fecha=momento,
        total_sistema=resumen.vendido,
        efectivo_esperado=esperado_bs,
        # Las columnas viejas no aceptan nulo: si no se conto esa gaveta se
        # guarda lo esperado, que deja la diferencia en cero -- que es
        # justamente "no se verifico, no hay nada que reclamar".
        efectivo_contado=contado_bs if contado_bs is not None else esperado_bs,
        diferencia=round(contado_bs - esperado_bs, 2) if contado_bs is not None else 0.0,
        divisas_esperado=esperado_usd,
        divisas_contado=contado_usd if contado_usd is not None else esperado_usd,
        divisas_diferencia=round(contado_usd - esperado_usd, 2) if contado_usd is not None else 0.0,
        nota=body.nota,
        operador_id=quien.id if quien else None,
    )
    db.add(db_cierre)
    db.flush()

    # Una fila por forma de pago verificada, con lo que decia el sistema al
    # cerrar. Congelado aqui porque manana el esperado ya no sera el mismo.
    for metodo, contado in contados.items():
        linea = esperados[metodo]
        db.add(
            models.CierreCajaLinea(
                cierre_id=db_cierre.id,
                cuenta=linea.cuenta,
                metodo=metodo,
                etiqueta=metodo,
                metodos=metodo,
                esperado=linea.esperado,
                contado=contado,
                diferencia=round(contado - linea.esperado, 2),
            )
        )
    db.flush()
    # El faltante/sobrante tambien va a los libros: si no, la cuenta nunca se
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
                metodo=l.metodo or "",
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
