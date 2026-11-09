import datetime
import json
import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import contabilidad, cuentas_por_cobrar, models, salvaguardas, schemas, tasas
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


def _pagos_de(db: Session, inicio, fin):
    return (
        db.query(models.PagoSinFactura)
        .filter(
            models.PagoSinFactura.fecha >= inicio,
            models.PagoSinFactura.fecha < fin,
            models.PagoSinFactura.anulado.is_(False),
        )
        .all()
    )


def _traspasos_de(db: Session, inicio, fin):
    return (
        db.query(models.TraspasoFondos)
        .filter(
            models.TraspasoFondos.fecha >= inicio,
            models.TraspasoFondos.fecha < fin,
            models.TraspasoFondos.anulado.is_(False),
        )
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
    ("Zelle", False),
    ("Fiado", False),
)

# "Efectivo" a secas es historico: antes de separar bolivares de divisas todo
# el efectivo iba a la misma cuenta. Se suma a "Efectivo Bs" para que una
# venta vieja no quede fuera del cuadre.
#
# "Tarjeta" y "Punto de venta" son la MISMA cosa: el terminal del local
# (Leider, 21-sep: "punto de venta y tarjeta es el mismo ya que punto de
# ventas es POS"). Eran dos filas del arqueo que se cuadraban por separado
# contra un solo lote impreso, asi que una de las dos siempre daba descuadre.
# El nombre viejo se sigue traduciendo porque hay ventas cargadas con el.
ALIAS_METODO = {
    "Efectivo": "Efectivo Bs",
    "Banco": "Transferencia",
    "Tarjeta": "Punto de venta",
}


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
    # Lo que se pago desde el modulo Pagos (un sueldo, el alquiler): sale por
    # donde se pago, aunque no sea un retiro de caja.
    for p in _pagos_de(db, inicio, fin):
        if not p.neto:
            continue
        m = _normalizar(p.metodo_pago)
        por_metodo[m] = round(por_metodo.get(m, 0.0) + p.neto, 2)
    # Llevar el efectivo al banco tambien saca plata de la gaveta.
    for t in _traspasos_de(db, inicio, fin):
        if t.tipo == "traspaso" and t.desde:
            m = _normalizar(t.desde)
            por_metodo[m] = round(por_metodo.get(m, 0.0) + t.monto, 2)
    return por_metodo


def _abonos_del_dia(db: Session, inicio, fin) -> list:
    return (
        db.query(models.AbonoFiado)
        .filter(models.AbonoFiado.fecha >= inicio, models.AbonoFiado.fecha < fin)
        .all()
    )


def _cobros_fiado_por_metodo(db: Session, inicio, fin) -> dict:
    """Lo que entro ese dia por fiados cobrados, por forma de pago.

    Es plata del dia: si la señora paga su fiado con el punto, el lote del
    punto lo trae, y el cierre tiene que esperarlo en esa fila. Es lo que entro,
    no lo que se dejo de deber: con comision, retencion o pago de mas no son
    lo mismo, y la fila mostraba un descuadre que no existia.
    """
    por_metodo: dict = {}
    for a, entro in cuentas_por_cobrar.entradas_de_abonos(_abonos_del_dia(db, inicio, fin)):
        m = _normalizar(a.metodo_pago or "Efectivo Bs")
        por_metodo[m] = round(por_metodo.get(m, 0.0) + entro, 2)
    return por_metodo


def _fiado_aplicado_por_metodo(db: Session, inicio, fin) -> dict:
    """La cuenta con la que se cerraron los dias que ya estan cerrados: lo que se
    dejo de deber. Solo para no mover esos dias (ver `_esperados_guardados`)."""
    por_metodo: dict = {}
    for a in _abonos_del_dia(db, inicio, fin):
        m = _normalizar(a.metodo_pago or "Efectivo Bs")
        por_metodo[m] = round(por_metodo.get(m, 0.0) + a.monto, 2)
    return por_metodo


def _esperados_guardados(cierre: Optional[models.CierreCaja]) -> dict:
    """Lo que el cierre congelo por forma de pago. Un dia cerrado muestra esto:
    ni un cobro tardio ni una cuenta corregida despues mueven lo que se cuadro.
    Las gavetas se guardan aunque no se cuenten; las demas, solo si se contaron."""
    if cierre is None:
        return {}
    guardados = {"Efectivo Bs": cierre.efectivo_esperado, "Efectivo $": cierre.divisas_esperado}
    for l in cierre.lineas:
        guardados[_normalizar(l.metodo or "")] = l.esperado
    return guardados


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


# Las gavetas que se cuentan al abrir. Solo el efectivo: el punto de venta y
# el banco no tienen fondo que contar en la manana -- su saldo lo dice la
# pantalla del banco, no un conteo.
GAVETAS_DE_APERTURA = tuple(m for m, fisico in METODOS_DE_CIERRE if fisico)

ORIGEN_APERTURA = "apertura_dia"
# La nota con que queda la apertura que nadie declaro: al cerrar, esa gaveta
# se da por abierta en cero.
NOTA_SIN_DECLARAR = "No se declaró al abrir"


SUELDO = re.compile(r"\b(sueldo|salario|n[oó]mina|quincena)s?\b", re.I)
# D14: una diferencia de menos de esto se aprueba sola.
APRUEBA_SOLA = 0.10
# Abrir con un fondo que se aleja de lo esperado en mas de $20 Y mas de la
# mitad pide confirmar (el 9-oct se abrio con $2.500 cuando habia $46).
FONDO_RARO_USD, FONDO_RARO_PCT = 20.0, 0.5
# Un faltante o sobrante de mas de esto pide confirmar antes de cerrar.
DIFERENCIA_GRANDE_USD = 20.0


def _ultimo_cierre_antes(db: Session, inicio) -> Optional[models.CierreCaja]:
    return (
        db.query(models.CierreCaja)
        .filter(models.CierreCaja.fecha < inicio, models.CierreCaja.anulado.is_(False))
        .order_by(models.CierreCaja.fecha.desc(), models.CierreCaja.id.desc())
        .first()
    )


def _contado_en(cierre: models.CierreCaja, metodo: str) -> Optional[float]:
    for l in cierre.lineas:
        if _normalizar(l.metodo or "") == metodo and l.contado is not None:
            return l.contado
    if metodo == "Efectivo Bs":
        return cierre.efectivo_contado
    if metodo == "Efectivo $":
        return cierre.divisas_contado
    return None


def fondo_esperado(db: Session, metodo: str, inicio) -> tuple[float, Optional[models.CierreCaja]]:
    """Con cuanto deberia arrancar la gaveta: lo que se conto en el ultimo
    cierre mas lo que se movio despues (un dia sin cerrar, un gasto de la
    madrugada). No lo que dicen los libros: los libros arrastran diferencias
    que todavia no se aprobaron, y empezar de ahi las contaria dos veces
    (specs/caja.md, bloque 1.10). Sin ningun cierre, los libros."""
    codigo = _cuentas_de(metodo)
    ultimo = _ultimo_cierre_antes(db, inicio)
    contado = _contado_en(ultimo, metodo) if ultimo else None
    if contado is None:
        return round(_saldo_anterior_de(db, codigo, inicio), 2), None
    _, fin_ultimo = _rango_de(ultimo.fecha.date())
    despues = _movimiento_del_dia(db, fin_ultimo, inicio, codigo) if fin_ultimo < inicio else 0.0
    return round(contado + despues, 2), ultimo


def _aperturas_de(db: Session, dia: datetime.date) -> dict:
    """Las gavetas que se abrieron ese dia, por forma de pago."""
    filas = db.query(models.AperturaCaja).filter(models.AperturaCaja.dia == dia).all()
    return {a.metodo: a for a in filas}


def _ajuste_apertura(db: Session, dia: datetime.date, codigo: str) -> float:
    """Lo que el ajuste de apertura movio en esa cuenta ese dia.

    Hay que descontarlo de `otros` antes de armar la fila: ese ajuste YA esta
    dentro del fondo declarado, y dejarlo en los dos sitios haria que la fila
    no sumara. Un "debe cuadrar" que no se obtiene de los numeros que el
    cajero tiene delante es la forma mas rapida de que le pierda la confianza
    al cuadre y empiece a llevarlo en un cuaderno aparte.
    """
    inicio, fin = _rango_de(dia)
    filas = (
        db.query(models.MovimientoContable)
        .join(models.AsientoContable,
              models.MovimientoContable.asiento_id == models.AsientoContable.id)
        .join(models.CuentaContable,
              models.MovimientoContable.cuenta_id == models.CuentaContable.id)
        .filter(
            models.AsientoContable.origen == ORIGEN_APERTURA,
            models.AsientoContable.fecha >= inicio,
            models.AsientoContable.fecha < fin,
            models.CuentaContable.codigo == codigo,
        )
        .all()
    )
    return round(sum((m.debe or 0) - (m.haber or 0) for m in filas), 2)


ORIGENES_DEL_CIERRE = ("cierre_caja", "reverso_cierre_caja", "aprobacion_caja", "diferencial_caja")


def _ajustes_de_cierre(db: Session, inicio, fin, codigo: str) -> float:
    """Lo que el propio arqueo movio en esa cuenta dentro del dia.

    Al cerrar, el faltante o sobrante se lleva a los libros (ver
    contabilidad.registrar_diferencia_caja). Ese asiento NO es plata que entro
    o salio en el dia: es el resultado del conteo. Si se deja dentro del
    movimiento del dia, al volver a abrir un cierre ya hecho el faltante
    aparecia como "Salio" y la fila decia "cuadra" (19-oct: Zelle faltaban
    $10 y la pantalla decia que cuadraba). Para los dias siguientes si cuenta:
    va en el saldo que arrastra la gaveta, que es justo lo que corrige.
    """
    filas = (
        db.query(models.MovimientoContable)
        .join(models.AsientoContable,
              models.MovimientoContable.asiento_id == models.AsientoContable.id)
        .join(models.CuentaContable,
              models.MovimientoContable.cuenta_id == models.CuentaContable.id)
        .filter(
            models.AsientoContable.origen.in_(ORIGENES_DEL_CIERRE),
            models.AsientoContable.fecha >= inicio,
            models.AsientoContable.fecha < fin,
            models.CuentaContable.codigo == codigo,
        )
        .all()
    )
    return round(sum((m.debe or 0) - (m.haber or 0) for m in filas), 2)


def _movimiento_del_dia(db: Session, inicio, fin, codigo: str) -> float:
    """Lo que la cuenta movio en el dia, sin el resultado del propio arqueo."""
    return round(
        contabilidad.movimiento_efectivo(db, inicio, fin, codigo) - _ajustes_de_cierre(db, inicio, fin, codigo), 2
    )


def _desglose(
    db: Session,
    dia: datetime.date,
    inicio,
    fin,
    cierre: Optional[models.CierreCaja] = None,
) -> List[schemas.LineaMetodo]:
    """Una fila por forma de pago: con cuanto arranco, que entro, que salio y
    que deberia haber.

    LA FILA TIENE QUE SUMAR A LA VISTA: fondo + entradas - salidas = esperado.
    Ese es el contrato. Un arqueo en el que el total no se obtiene de las
    columnas que estan al lado obliga a creer en el sistema en vez de
    verificarlo, y lo que la gente hace entonces es llevar la caja en un
    cuaderno aparte.

    EL FONDO. Es lo que se declaro al abrir la caja ese dia, y si no se
    declaro, CERO (24-oct). Antes, sin declarar, arrancaba con lo que quedaba
    de dias anteriores segun los libros: un arrastre que heredaba cualquier
    error viejo y que nadie entendia ("¿por que debo tener $247 si hubo un
    solo cobro de $4,50?"). Al cerrar, la gaveta que no se declaro queda
    declarada en cero (`_asentar_apertura`), asi que los libros siguen a lo
    que se ve aqui.

    EL BANCO NO SE RESTA. Lo que se pago desde el banco o el pago movil (un
    sueldo, un proveedor) ya esta en los libros con su gasto. En esas filas se
    coteja solo lo que se cobro ese dia, que es lo que la cajera ve en el
    telefono o en el lote; los pagos se muestran aparte (`pagos`). Restarlos
    obligaba a teclear "lo cobrado menos los sueldos", y nadie lo hacia: el
    24-oct salio un "sobran $167,49" que eran dos sueldos.

    LO QUE NO ES VENTA NI GASTO TAMBIEN CUENTA. Pagarle a un proveedor en
    efectivo o cobrar un fiado mueve la plata y los libros lo saben, pero no
    es ninguna de las dos cosas que el dueno tiene en la cabeza al cuadrar. Si
    se ignora, contar la gaveta da un descuadre del tamano de esos
    movimientos.

    Cuando una forma de pago es la UNICA que usa su cuenta --el efectivo en
    bolivares es la unica que toca 1010-- ese resto se le puede atribuir.
    Cuando cuatro metodos comparten cuenta (1020) no hay forma de saber por
    cual entro, asi que el resto se reporta aparte (ver `_otros_movimientos`).
    """
    ventas = _ventas_por_metodo(db, inicio, fin)
    salidas = _salidas_por_metodo(db, inicio, fin)
    fiados = _fiado_aplicado_por_metodo(db, inicio, fin) if cierre else _cobros_fiado_por_metodo(db, inicio, fin)
    guardados = _esperados_guardados(cierre)
    aperturas = _aperturas_de(db, dia)
    # Lo que se reporto al cerrar, si el dia ya se cerro. Se normaliza el
    # nombre: un cierre viejo pudo guardar la fila como "Tarjeta".
    contados = {}
    if cierre is not None:
        for l in cierre.lineas:
            if l.contado is None:
                continue
            m = _normalizar(l.metodo or "")
            anterior = contados.get(m, 0.0)
            contados[m] = round(anterior + l.contado, 2)
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
            neto_libro = _movimiento_del_dia(db, inicio, fin, cuenta)
            otros = round(neto_libro - (entro - salio), 2)
        else:
            # En la cuenta compartida no se sabe por cual metodo entro algo,
            # salvo el fiado cobrado, que guarda su metodo.
            otros = round(fiados.get(metodo, 0.0), 2)

        # El ajuste de la apertura cae dentro del dia, asi que viene metido en
        # `otros`. Se le saca de ahi y se le suma al fondo, que es donde el
        # cajero lo espera ver.
        apertura = aperturas.get(metodo)
        if apertura is not None and apertura.estado_diferencia is None:
            # Apertura de antes del 1.10: su diferencia ya entro a los libros.
            ajuste = _ajuste_apertura(db, dia, cuenta)
            otros = round(otros - ajuste, 2)
            fondo = round(anterior + ajuste, 2)
        elif apertura is not None:
            fondo = round(apertura.fondo, 2)
        elif fisico:
            fondo = fondo_esperado(db, metodo, inicio)[0]
        else:
            fondo = 0.0
        # Lo que salio por el banco ya esta en los libros: no se resta.
        pagos = 0.0
        if not fisico:
            pagos, salio = salio, 0.0
        # Los bolivares valen otros dolares si cambio la tasa desde el ultimo
        # cierre: eso va en "otros" para que "debes tener" sea lo que el
        # cierre espera (y no salga un faltante que es diferencial).
        if cierre is None and metodo == "Efectivo Bs":
            otros = round(otros + _diferencial_bs(db, dia, inicio, fondo), 2)
        # La fila Fiado de un dia cerrado dice cuanto se fio ese dia: los
        # abonos y las bajas de despues no la mueven (QA nov, hallazgo 32).
        if cierre is not None and metodo == "Fiado":
            otros, salio = 0.0, 0.0
        # Dia cerrado: manda lo guardado, y `otros` absorbe lo que haya pasado
        # despues para que la fila siga sumando a la vista.
        if metodo in guardados:
            otros = round(guardados[metodo] - fondo - entro + salio, 2)

        filas.append(
            schemas.LineaMetodo(
                metodo=metodo,
                cuenta=cuenta,
                fisico=fisico,
                # El credito no se cuenta: no hay billetes ni extracto que
                # mirar. Se muestra para saber cuanto se fio.
                se_cuadra=metodo != "Fiado",
                saldo_anterior=round(anterior, 2),
                fondo=fondo,
                fondo_declarado=apertura is not None and not (apertura.nota or "").startswith(NOTA_SIN_DECLARAR),
                diferencia_apertura=round(apertura.diferencia or 0, 2) if apertura is not None else 0.0,
                ventas=round(entro, 2),
                salidas=round(salio, 2),
                pagos=round(pagos, 2),
                otros=otros,
                esperado=round(fondo + entro - salio + otros, 2),
                contado=contados.get(metodo),
                diferencia=(
                    round(contados[metodo] - (fondo + entro - salio + otros), 2)
                    if metodo in contados
                    else None
                ),
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
        neto_libro = _movimiento_del_dia(db, inicio, fin, cuenta)
        explicado = round(
            sum(l.ventas - l.salidas + l.otros for l in desglose if l.cuenta == cuenta), 2
        )
        resto = round(neto_libro - explicado, 2)
        if abs(resto) >= 0.01:
            fuera.append(
                schemas.OtroMovimiento(
                    cuenta=cuenta, etiqueta="Banco, punto y pago móvil", monto=resto
                )
            )
    return fuera


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


def _cierre_del_dia(db: Session, inicio, fin) -> Optional[models.CierreCaja]:
    return (
        db.query(models.CierreCaja)
        .filter(
            models.CierreCaja.fecha >= inicio,
            models.CierreCaja.fecha < fin,
            models.CierreCaja.anulado.is_(False),
        )
        .first()
    )


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

    cierre = _cierre_del_dia(db, inicio, fin)
    desglose = _desglose(db, dia, inicio, fin, cierre)
    cobrado = round(sum(l.ventas for l in desglose), 2)

    gastos_dia = _gastos_de(db, inicio, fin)
    retiros_dia = _retiros_de(db, inicio, fin)
    total_gastos = round(sum(g.monto for g in gastos_dia), 2)
    total_retiros = round(sum(r.monto for r in retiros_dia), 2)

    anulados, anulado_monto = _anulados(db, inicio, fin)
    devueltos, devuelto_monto = _devueltos(db, inicio, fin)

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
        pagos_efectivo=round(sum(p.neto for p in _pagos_de(db, inicio, fin) if p.metodo_pago.startswith("Efectivo")), 2),
        desglose=desglose,
        otros_movimientos=_otros_movimientos(db, inicio, fin, desglose),
        fiado_por_cobrar=round(contabilidad.saldo_de_cuenta(db, "1015"), 2),
        propinas_por_entregar=round(contabilidad.saldo_de_cuenta(db, "2040"), 2),
        cerrada=cierre is not None,
        cierre_id=cierre.id if cierre else None,
        abierta=bool(_aperturas_de(db, dia)),
    )


@router.get("/cobros", response_model=List[schemas.CobroDelDia])
def cobros_del_dia(fecha: Optional[datetime.date] = None, db: Session = Depends(get_db)):
    """Cada cobro del dia, uno por uno, con su referencia.

    Es el detalle de la columna "Entró" del desglose: cuando el cierre dice
    que faltan $12 en el punto, aqui se ve cual ticket fue, poniendo esta
    lista al lado del lote que imprime el terminal. Salen las mismas ventas
    que suma el desglose (cobradas ese dia y no devueltas), mas los abonos de
    fiado, que tambien pasan por el punto y el banco aunque no sean venta.
    """
    dia = _fecha_pedida(fecha)
    inicio, fin = _rango_de(dia)
    nombres = {o.id: o.nombre for o in db.query(models.Operador).all()}

    cobros: List[schemas.CobroDelDia] = []
    for pedido in _pedidos_pagados(db, inicio, fin):
        if pedido.devuelto:
            continue
        for pago in pedido.pagos:
            cobros.append(schemas.CobroDelDia(
                metodo=_normalizar(pago.metodo),
                pedido_id=pedido.id,
                numero=pedido.numero,
                cliente=pedido.cliente or "",
                fecha=pedido.cerrado_en,
                monto=round(pago.monto, 2),
                tasa=pedido.tasa_bcv,
                referencia=(pago.referencia or "").strip(),
                cobrado_por=nombres.get(pedido.operador_id, ""),
            ))
    abonos = _abonos_del_dia(db, inicio, fin)
    # Un dia cerrado sigue con lo que se dejo de deber, igual que su fila.
    entradas = (
        [(a, a.monto) for a in abonos]
        if _cierre_del_dia(db, inicio, fin)
        else cuentas_por_cobrar.entradas_de_abonos(abonos)
    )
    for abono, entro in entradas:
        cobros.append(schemas.CobroDelDia(
            metodo=_normalizar(abono.metodo_pago or "Efectivo Bs"),
            tipo="abono",
            pedido_id=abono.pedido_id,
            numero=abono.pedido.numero if abono.pedido else 0,
            cliente=(abono.pedido.cliente or "") if abono.pedido else "",
            fecha=abono.fecha,
            monto=round(entro, 2),
            referencia=(abono.referencia or "").strip(),
            cobrado_por=nombres.get(abono.operador_id, ""),
        ))

    vistas: dict = {}
    for c in cobros:
        if c.referencia:
            clave = (c.metodo, c.referencia.lower())
            vistas[clave] = vistas.get(clave, 0) + 1
    for c in cobros:
        if c.referencia and vistas[(c.metodo, c.referencia.lower())] > 1:
            c.repetida = True

    cobros.sort(key=lambda c: (c.fecha or datetime.datetime.min, c.numero))
    return cobros


@router.get("/explicar", response_model=schemas.ExplicacionCierre)
def explicar_descuadre(fecha: Optional[datetime.date] = None, db: Session = Depends(get_db)):
    """¿Por que no cuadra? Las causas probables del descuadre de ese dia, y
    los pedidos a revisar. Solo lee: no cambia ningun cobro ni el cierre."""
    from .. import explicar_cierre

    return explicar_cierre.explicar(resumen_caja(fecha, db), cobros_del_dia(fecha, db))


@router.get("/estado-apertura", response_model=schemas.EstadoApertura)
def estado_de_apertura(
    fecha: Optional[datetime.date] = None, db: Session = Depends(get_db)
):
    """Si la caja de ese dia ya se abrio, y con cuanto arranco cada gaveta.

    Es lo que consulta el punto de venta al cargar para decidir si muestra el
    boton de "Abrir caja". Cuando no esta abierta trae, en `fondos`, lo que
    los libros creen que hay: no para rellenar el formulario --eso volveria
    el conteo un tramite de darle a aceptar-- sino para calcular la
    diferencia cuando la persona teclee lo suyo.
    """
    dia = _fecha_pedida(fecha)
    inicio, fin = _rango_de(dia)
    abiertas = _aperturas_de(db, dia)

    if abiertas:
        primera = next(iter(abiertas.values()))
        # Al cerrar quedan aperturas en cero de lo que no se declaro: si la
        # caja ya se cerro, eso es lo que hay que decir.
        cerrada_ya = (
            db.query(models.CierreCaja.id)
            .filter(models.CierreCaja.fecha >= inicio, models.CierreCaja.fecha < fin,
                    models.CierreCaja.anulado.is_(False))
            .first()
        )
        return schemas.EstadoApertura(
            fecha=dia.isoformat(),
            abierta=True,
            puede_abrir=False,
            motivo=("La caja de este día ya se cerró. Anula ese cierre si hay que rehacerlo." if cerrada_ya
                    else "La caja de este día ya se abrió."),
            momento=primera.fecha.isoformat() if primera.fecha else None,
            operador=primera.operador,
            nota=primera.nota or "",
            fondos=[
                schemas.FondoApertura(
                    metodo=a.metodo,
                    cuenta=a.cuenta,
                    fondo=round(a.fondo, 2),
                    segun_libros=round(a.segun_libros or 0, 2),
                    diferencia=round(a.diferencia or 0, 2),
                )
                for a in abiertas.values()
            ],
        )

    # Una caja ya cerrada no se reabre: el cierre congelo lo esperado y metio
    # la diferencia a los libros. Cambiarle el punto de partida despues
    # dejaria ese cierre apuntando a un numero que ya no existe.
    cerrada = (
        db.query(models.CierreCaja)
        .filter(
            models.CierreCaja.fecha >= inicio,
            models.CierreCaja.fecha < fin,
            models.CierreCaja.anulado.is_(False),
        )
        .first()
    )
    motivo = ""
    if cerrada:
        motivo = "La caja de este día ya se cerró. Anula ese cierre si hay que rehacerlo."
    elif dia > hoy():
        motivo = "Todavía no es ese día."

    return schemas.EstadoApertura(
        fecha=dia.isoformat(),
        abierta=False,
        puede_abrir=not motivo,
        motivo=motivo,
        fondos=[
            schemas.FondoApertura(
                metodo=m,
                cuenta=_cuentas_de(m),
                fondo=0.0,
                segun_libros=fondo_esperado(db, m, inicio)[0],
            )
            for m in GAVETAS_DE_APERTURA
        ],
    )


def _asentar_apertura(db: Session, dia: datetime.date, inicio, metodo: str, fondo: float, momento,
                      nota: str = "", desglose: str = "", operador_id: Optional[int] = None) -> schemas.FondoApertura:
    """Una gaveta abierta con `fondo`: la fila de la apertura y, si los libros
    decian otra cosa, el asiento que los pone en lo declarado."""
    codigo = _cuentas_de(metodo)
    libros = round(_saldo_anterior_de(db, codigo, inicio), 2)
    diferencia = round(fondo - libros, 2)
    # ANTES de agregar la fila: la consulta hace autoflush y se
    # encontraria a si misma, y entonces ninguna apertura seria nunca la
    # primera.
    primera_vez = (
        db.query(models.AperturaCaja)
        .filter(models.AperturaCaja.metodo == metodo)
        .first()
        is None
    )

    db.add(
        models.AperturaCaja(
            fecha=momento,
            dia=dia,
            metodo=metodo,
            cuenta=codigo,
            fondo=fondo,
            segun_libros=libros,
            diferencia=diferencia,
            nota=nota,
            desglose=desglose,
            operador_id=operador_id,
        )
    )

    if abs(diferencia) >= 0.01:
        contrapartida = "3010" if primera_vez else "6030"
        sin_declarar = nota.startswith(NOTA_SIN_DECLARAR)
        if diferencia > 0:
            lineas = [(codigo, diferencia, 0.0), (contrapartida, 0.0, diferencia)]
            texto = (
                f"Apertura: {metodo} ya tenía {diferencia:.2f} sin declarar"
                if primera_vez
                else f"Sobrante de {metodo} al abrir"
            )
        else:
            falta = abs(diferencia)
            lineas = [(contrapartida, falta, 0.0), (codigo, 0.0, falta)]
            texto = (
                f"Apertura: {metodo} tenía {falta:.2f} menos de lo declarado"
                if primera_vez
                else f"{metodo} no se declaró al abrir: los libros traían {falta:.2f}"
                if sin_declarar
                else f"Faltante de {metodo} al abrir"
            )
        contabilidad.crear_asiento(
            db,
            f"{texto} ({dia.strftime('%d/%m')})",
            lineas,
            origen=ORIGEN_APERTURA,
            referencia_id=int(codigo),
            fecha=momento,
        )
    return schemas.FondoApertura(metodo=metodo, cuenta=codigo, fondo=fondo, segun_libros=libros, diferencia=diferencia)


def _registrar_apertura(db: Session, dia: datetime.date, inicio, metodo: str, fondo: float, momento,
                        nota: str = "", desglose: str = "", operador_id: Optional[int] = None) -> schemas.FondoApertura:
    """Una gaveta abierta con `fondo`, SIN asientos (specs/caja.md, 1.10).

    La diferencia es contra lo que quedo en el ultimo cierre y queda "por
    aprobar": un tecleo de la mañana ya no entra a los libros como sobrante.
    Las de menos de $0,10 se aprueban solas (D14)."""
    codigo = _cuentas_de(metodo)
    esperado = fondo_esperado(db, metodo, inicio)[0]
    diferencia = round(fondo - esperado, 2)
    estado = "sin_diferencia" if abs(diferencia) < 0.005 else "sola" if abs(diferencia) < APRUEBA_SOLA else "por_aprobar"
    fila = models.AperturaCaja(
        fecha=momento, dia=dia, metodo=metodo, cuenta=codigo, fondo=fondo, segun_libros=esperado,
        diferencia=diferencia, nota=nota, desglose=desglose, operador_id=operador_id, estado_diferencia=estado,
    )
    db.add(fila)
    db.flush()
    if estado == "sola":
        _asentar_diferencia_apertura(db, fila, "Se aprobó sola (menos de $0,10)", "sistema")
    return schemas.FondoApertura(metodo=metodo, cuenta=codigo, fondo=fondo, segun_libros=esperado, diferencia=diferencia)


def _asentar_diferencia_apertura(db: Session, fila: models.AperturaCaja, motivo: str, quien: str) -> None:
    d = round(fila.diferencia or 0, 2)
    fecha = fila.fecha or ahora()
    if contabilidad.periodo_bloqueado(db, fecha):
        fecha = ahora()
    # La primera vez que se abre una gaveta, lo que habia ya era del dueño:
    # va a su capital (3010), no a faltantes y sobrantes.
    primera = (
        db.query(models.AperturaCaja.id)
        .filter(models.AperturaCaja.metodo == fila.metodo, models.AperturaCaja.id < fila.id)
        .first() is None
    )
    contra = "3010" if primera else "6030"
    if abs(d) >= 0.01:
        lineas = [(fila.cuenta, d, 0.0), (contra, 0.0, d)] if d > 0 else [(contra, -d, 0.0), (fila.cuenta, 0.0, -d)]
        contabilidad.crear_asiento(
            db, f"{'Sobrante' if d > 0 else 'Faltante'} de {fila.metodo} al abrir ({fila.dia:%d/%m}): {motivo}",
            lineas, origen="aprobacion_caja", referencia_id=fila.id, fecha=fecha,
        )
    if fila.estado_diferencia != "sola":
        fila.estado_diferencia = "aprobada"
    fila.aprobada_por = quien
    fila.aprobada_en = ahora()
    fila.motivo_aprobacion = motivo


def _aperturas_por_defecto(db: Session, dia: datetime.date, inicio) -> None:
    """Al cerrar: la gaveta que nadie declaro arranco con lo que quedo en el
    ultimo cierre. Antes arrancaba en CERO y lo que habia pasaba a faltante
    (QA nov: cerrar sin abrir mandaba $133 a perdida). Sin asiento."""
    abiertas = _aperturas_de(db, dia)
    for metodo in GAVETAS_DE_APERTURA:
        if metodo in abiertas:
            continue
        esperado = fondo_esperado(db, metodo, inicio)[0]
        db.add(models.AperturaCaja(
            fecha=inicio + datetime.timedelta(minutes=1), dia=dia, metodo=metodo, cuenta=_cuentas_de(metodo),
            fondo=esperado, segun_libros=esperado, diferencia=0.0,
            nota=f"{NOTA_SIN_DECLARAR}: arranca con lo que quedó en el último cierre",
            estado_diferencia="sin_diferencia",
        ))
    db.flush()


def _declarar_en_cero_lo_no_declarado(db: Session, dia: datetime.date, inicio) -> None:
    """Al cerrar: la gaveta que nadie declaro al abrir arranco en cero. Se
    deja asentado como una apertura en cero, para que los libros digan lo
    mismo que el cuadre (y lo que arrastraban de antes no vuelva mas)."""
    abiertas = _aperturas_de(db, dia)
    for metodo in GAVETAS_DE_APERTURA:
        if metodo in abiertas:
            continue
        _asentar_apertura(db, dia, inicio, metodo, 0.0, inicio + datetime.timedelta(minutes=1),
                          f"{NOTA_SIN_DECLARAR}: arranca en cero")
    db.flush()


@router.post("/abrir", response_model=schemas.EstadoApertura)
def abrir_caja(
    body: schemas.AbrirCajaRequest, request: Request, db: Session = Depends(get_db)
):
    """Abrir la caja del dia contando el fondo de cada gaveta.

    QUE HACE DE VERDAD. Fija el punto de partida del cuadre. Lo contado pasa a
    ser la verdad de la gaveta, y si los libros decian otra cosa se asienta la
    diferencia ahi mismo -- si no, el cierre de esta noche reportaria como
    faltante del turno algo que ya faltaba en la manana.

    A DONDE VA ESA DIFERENCIA. La primera vez que se abre una gaveta va contra
    el capital del dueno (3010): esa plata no la genero el negocio vendiendo,
    ya era suya y estaba ahi antes de que existiera el sistema. Meterla como
    ingreso inflaria la ganancia y pagaria impuesto sobre algo que nunca se
    vendio. De ahi en adelante es un descuadre como el de cualquier arqueo y
    va a faltantes y sobrantes (6030), igual que el del cierre.
    """
    dia = _fecha_pedida(body.fecha)
    inicio, fin = _rango_de(dia)
    quien = operadores.del_turno(db, request, body.operador_id)

    estado = estado_de_apertura(dia, db)
    if not estado.puede_abrir:
        raise HTTPException(status_code=409, detail=estado.motivo)

    pedidos = {
        f.metodo: round(f.fondo, 2)
        for f in body.fondos
        if f.metodo in GAVETAS_DE_APERTURA
    }
    desgloses = {f.metodo: f.desglose for f in body.fondos if f.desglose}
    # Si vino el desglose, tiene que sumar el fondo: un desglose que no
    # cuadra con el total es peor que ninguno, porque parece contado. La
    # gaveta de bolivares no se comprueba asi: su desglose viene en bolivares
    # y el fondo en dolares, convertido a la tasa del dia por la pantalla.
    for metodo, d in desgloses.items():
        if metodo == "Efectivo Bs":
            continue
        suma = round(sum(
            float(v) if k == "sueltos" else float(k) * float(v) for k, v in d.items()
        ), 2)
        if abs(suma - pedidos[metodo]) >= 0.01:
            raise HTTPException(
                status_code=400,
                detail=f"El desglose de {metodo} suma {suma:.2f} y el fondo dice {pedidos[metodo]:.2f}.",
            )
    if not pedidos:
        raise HTTPException(
            status_code=400,
            detail="Falta el fondo: hay que contar al menos una gaveta para abrir.",
        )
    if any(v < 0 for v in pedidos.values()):
        raise HTTPException(status_code=400, detail="El fondo no puede ser negativo")

    momento = ahora() if dia == hoy() else inicio + datetime.timedelta(hours=8)
    contabilidad.exigir_mes_abierto(db, momento, "la apertura de la caja")
    for metodo, fondo in pedidos.items():
        esperado = fondo_esperado(db, metodo, inicio)[0]
        distancia = abs(fondo - esperado)
        if distancia > FONDO_RARO_USD and distancia > FONDO_RARO_PCT * max(esperado, 0.01):
            salvaguardas.pedir_confirmacion(
                request, f"fondo_raro_{metodo}",
                f"En {metodo} contaste {salvaguardas.usd(fondo)} y en el último cierre quedaron {salvaguardas.usd(esperado)}. "
                "¿Es correcto? Si fue un tecleo, corrígelo antes de abrir.",
            )
    resultado = []
    for metodo in GAVETAS_DE_APERTURA:
        if metodo not in pedidos:
            continue
        resultado.append(_registrar_apertura(
            db, dia, inicio, metodo, pedidos[metodo], momento, body.nota or "",
            json.dumps(desgloses[metodo]) if metodo in desgloses else "", quien.id if quien else None,
        ))

    db.commit()
    return schemas.EstadoApertura(
        fecha=dia.isoformat(),
        abierta=True,
        puede_abrir=False,
        motivo="La caja de este día ya se abrió.",
        momento=momento.isoformat(),
        operador=quien.nombre if quien else "",
        nota=body.nota or "",
        fondos=resultado,
    )


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

    _aperturas_por_defecto(db, dia, inicio)
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
    contabilidad.exigir_mes_abierto(db, momento, "el cierre de la caja")

    # La gaveta de bolivares vale menos dolares si subio la tasa desde el
    # ultimo cierre: eso no es faltante (QA nov, hallazgo 15).
    bs_linea = esperados.get("Efectivo Bs")
    diferencial = _diferencial_bs(db, dia, inicio, bs_linea.fondo if bs_linea else 0.0)
    grandes = []
    for metodo, contado in contados.items():
        d = round(contado - esperados[metodo].esperado, 2)
        if abs(d) > DIFERENCIA_GRANDE_USD:
            grandes.append(f"{metodo}: {'sobran' if d > 0 else 'faltan'} {salvaguardas.usd(abs(d))}")
    if grandes:
        salvaguardas.pedir_confirmacion(
            request, "diferencia_grande",
            "El conteo no cuadra por mucho (" + "; ".join(grandes) + "). Revisa que no sobre o falte un cero. "
            "Si está bien contado, ciérrala: la diferencia queda por aprobar y no toca los libros.",
        )

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
        cerrado_por=_usuario(request),
    )
    db.add(db_cierre)
    db.flush()

    # Una fila por forma de pago verificada, con lo que decia el sistema al
    # cerrar. Congelado aqui porque manana el esperado ya no sera el mismo.
    for metodo, contado in contados.items():
        linea = esperados[metodo]
        cambiario = diferencial if metodo == "Efectivo Bs" else 0.0
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
                diferencial_cambiario=cambiario,
            )
        )
    db.flush()
    db.refresh(db_cierre)
    if diferencial and contado_bs is not None:
        _asentar_diferencial(db, db_cierre, diferencial)
    # La diferencia NO va sola a los libros (specs/caja.md, 1.10): queda por
    # aprobar. Las de menos de $0,10 se aprueban solas (D14).
    mayor = max((abs(l.diferencia or 0) for l in db_cierre.lineas), default=0.0)
    if mayor < 0.005:
        db_cierre.estado_diferencia = "sin_diferencia"
    elif mayor < APRUEBA_SOLA:
        db_cierre.estado_diferencia = "sola"
        _aprobar_cierre(db, db_cierre, "Se aprobó sola (menos de $0,10)", "sistema")
    else:
        db_cierre.estado_diferencia = "por_aprobar"
    db.commit()
    db.refresh(db_cierre)
    return _a_schema(db_cierre)


@router.post("/cierres/{cierre_id}/anular", response_model=schemas.CierreCaja)
def anular_cierre(
    cierre_id: int, body: schemas.AnularCierreRequest, request: Request, db: Session = Depends(get_db)
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
    contabilidad.exigir_mes_abierto(db, cierre.fecha, "ese cierre")
    cierre.autorizado_por = salvaguardas.exigir_firma(
        db, request, "anular_cierre", f"Anular el cierre del {cierre.fecha:%d/%m/%Y}"
    )

    _revertir_si_estaba_asentado(db, cierre)
    _soltar_aperturas_por_defecto(db, cierre)
    cierre.anulado = True
    cierre.fecha_anulacion = ahora()
    cierre.motivo_anulacion = body.motivo
    db.commit()
    db.refresh(cierre)
    return _a_schema(cierre)


@router.post("/cierres/{cierre_id}/corregir", response_model=schemas.CierreCaja)
def corregir_cierre(
    cierre_id: int,
    body: schemas.CierreCajaRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Cambiar el conteo de un cierre ya hecho.

    POR QUE EXISTE. Un digito de mas al teclear (500 en vez de 50) dejaba el
    dia cerrado con un sobrante ficticio, y la unica salida era anular el
    cierre --con su motivo, su contra-asiento y su fila anulada en el
    historico-- y volver a cerrar desde cero. Para un error de tecleo eso es
    demasiado tramite, y lo que hace la gente es dejarlo mal (Leider, 21-sep:
    "me debe permitir modificar los datos enviados en el formulario de cerrar
    caja por algun error de tipeo").

    Por dentro sigue siendo lo mismo, y a proposito: se anula el cierre viejo
    --queda la fila y el reverso de su diferencia, porque los libros no se
    reescriben-- y se crea uno nuevo con el conteo bueno, todo en una sola
    peticion. Si algo falla, no se queda el dia sin cierre.
    """
    viejo = db.query(models.CierreCaja).filter(models.CierreCaja.id == cierre_id).first()
    if not viejo:
        raise HTTPException(status_code=404, detail="Cierre no encontrado")
    if viejo.anulado:
        raise HTTPException(
            status_code=409,
            detail="Ese cierre esta anulado: vuelve a cerrar el dia en vez de corregirlo.",
        )

    # Se comprueba ANTES de tocar nada. Si el conteo nuevo viniera vacio,
    # `cerrar_caja` cortaria con un 400 dejando el dia anulado y sin cierre:
    # la sesion se descarta sola al cerrarse, pero no se deja depender de eso
    # una operacion que mueve los libros.
    if not [c for c in body.conteos if c.contado is not None]:
        raise HTTPException(
            status_code=400,
            detail="Falta el conteo: hay que verificar al menos una forma de pago.",
        )

    contabilidad.exigir_mes_abierto(db, viejo.fecha, "ese cierre")
    firma = salvaguardas.exigir_firma(
        db, request, "corregir_cierre", f"Corregir el conteo del cierre del {viejo.fecha:%d/%m/%Y}"
    )
    _revertir_si_estaba_asentado(db, viejo)
    viejo.autorizado_por = firma
    viejo.anulado = True
    viejo.fecha_anulacion = ahora()
    viejo.motivo_anulacion = (body.nota or "").strip() or "Se corrigio el conteo"
    db.flush()
    return cerrar_caja(body, request, db)


def _usuario(request: Request) -> str:
    s = getattr(request.state, "sesion", None) or {}
    return s.get("usuario") or ""


def _diferencial_bs(db: Session, dia: datetime.date, inicio, fondo: float) -> float:
    """Cuanto cambio en dolares el fondo de bolivares por la tasa desde el
    ultimo cierre. Negativo si subio la tasa (valen menos dolares).

    Solo si el fondo se arrastra sin contar: si la gaveta se conto al abrir,
    ya se conto a la tasa de hoy y no hay nada que separar (QA nov, D1c)."""
    if not fondo:
        return 0.0
    apertura = _aperturas_de(db, dia).get("Efectivo Bs")
    if apertura is not None and not (apertura.nota or "").startswith(NOTA_SIN_DECLARAR):
        return 0.0
    _, ultimo = fondo_esperado(db, "Efectivo Bs", inicio)
    if ultimo is None:
        return 0.0
    antes, ahora_t = tasas.tasa_al(db, ultimo.fecha.date()), tasas.tasa_al(db, dia)
    if not antes or not ahora_t or not antes.bcv or not ahora_t.bcv or antes.bcv == ahora_t.bcv:
        return 0.0
    return round(fondo * (antes.bcv / ahora_t.bcv - 1), 2)


def _asentar_diferencial(db: Session, cierre: models.CierreCaja, monto: float) -> None:
    lineas = [("6160", -monto, 0.0), ("1010", 0.0, -monto)] if monto < 0 else [("1010", monto, 0.0), ("6160", 0.0, monto)]
    contabilidad.crear_asiento(
        db, f"Diferencial cambiario de la gaveta de bolívares ({cierre.fecha:%d/%m})",
        lineas, origen="diferencial_caja", referencia_id=cierre.id, fecha=cierre.fecha,
    )


def _aprobar_cierre(db: Session, cierre: models.CierreCaja, motivo: str, quien: str) -> None:
    fecha = cierre.fecha
    if contabilidad.periodo_bloqueado(db, fecha):
        fecha = ahora()
    contabilidad.registrar_diferencia_caja(db, cierre, fecha=fecha, origen="aprobacion_caja")
    if cierre.estado_diferencia != "sola":
        cierre.estado_diferencia = "aprobada"
    cierre.aprobada_por = quien
    cierre.aprobada_en = ahora()
    cierre.motivo_aprobacion = motivo


def _revertir_si_estaba_asentado(db: Session, cierre: models.CierreCaja) -> None:
    """Anular o corregir solo revierte lo que llego a los libros: un cierre
    viejo (asentado al cerrar) o una diferencia ya aprobada. La que estaba
    por aprobar nunca entro, y no hay nada que deshacer."""
    if cierre.estado_diferencia in (None, "aprobada", "sola"):
        contabilidad.registrar_reverso_diferencia_caja(db, cierre)
    for a in db.query(models.AsientoContable).filter_by(origen="diferencial_caja", referencia_id=cierre.id).all():
        db.delete(a)


def _soltar_aperturas_por_defecto(db: Session, cierre: models.CierreCaja) -> None:
    """Las gavetas que el cierre dio por abiertas con lo del ultimo cierre (sin
    que nadie las contara) se sueltan al anularlo: asi se puede abrir de nuevo
    contando el fondo real (QA nov, regresion E3c)."""
    for a in _aperturas_de(db, cierre.fecha.date()).values():
        if a.estado_diferencia == "sin_diferencia" and (a.nota or "").startswith(NOTA_SIN_DECLARAR):
            db.delete(a)


@router.get("/diferencias", response_model=schemas.DiferenciasPorAprobar)
def diferencias_por_aprobar(db: Session = Depends(get_db)):
    """Lo que el conteo no cuadro y todavia no entro a los libros."""
    filas = []
    for c in (
        db.query(models.CierreCaja)
        .filter(models.CierreCaja.estado_diferencia == "por_aprobar", models.CierreCaja.anulado.is_(False))
        .order_by(models.CierreCaja.fecha)
        .all()
    ):
        filas.append(schemas.DiferenciaCaja(
            tipo="cierre", id=c.id, dia=c.fecha.date().isoformat(),
            monto=round(sum(l.diferencia or 0 for l in c.lineas), 2),
            detalle="; ".join(f"{l.metodo}: {l.diferencia:+.2f}" for l in c.lineas if abs(l.diferencia or 0) >= 0.01),
            quien=c.cerrado_por or c.operador, nota=c.nota or "",
        ))
    for a in (
        db.query(models.AperturaCaja)
        .filter(models.AperturaCaja.estado_diferencia == "por_aprobar")
        .order_by(models.AperturaCaja.dia)
        .all()
    ):
        filas.append(schemas.DiferenciaCaja(
            tipo="apertura", id=a.id, dia=a.dia.isoformat(), monto=round(a.diferencia or 0, 2),
            detalle=f"{a.metodo} al abrir: {a.diferencia:+.2f}", quien=a.operador, nota=a.nota or "",
        ))
    filas.sort(key=lambda f: f.dia)
    dias = (hoy() - datetime.date.fromisoformat(filas[0].dia)).days if filas else 0
    return schemas.DiferenciasPorAprobar(
        filas=filas, total=round(sum(f.monto for f in filas), 2), dias_mas_vieja=dias,
    )


@router.post("/diferencias/aprobar", response_model=schemas.DiferenciasPorAprobar)
def aprobar_diferencia(body: schemas.AprobarDiferencia, request: Request, db: Session = Depends(get_db)):
    """Llevar a los libros una diferencia del conteo, con su motivo y la firma
    de quien autoriza (D12, D13)."""
    motivo = (body.motivo or "").strip()
    if not motivo:
        raise HTTPException(status_code=400, detail="Escribe el motivo: es lo que queda en los libros.")
    if body.tipo == "cierre":
        fila = db.get(models.CierreCaja, body.id)
        if fila is None or fila.anulado or fila.estado_diferencia != "por_aprobar":
            raise HTTPException(status_code=409, detail="Esa diferencia ya no está por aprobar.")
        quien = salvaguardas.exigir_firma(db, request, "aprobar_diferencia", f"Aprobar la diferencia del {fila.fecha:%d/%m}",
                                          monto=sum(l.diferencia or 0 for l in fila.lineas))
        _aprobar_cierre(db, fila, motivo, quien)
    else:
        fila = db.get(models.AperturaCaja, body.id)
        if fila is None or fila.estado_diferencia != "por_aprobar":
            raise HTTPException(status_code=409, detail="Esa diferencia ya no está por aprobar.")
        quien = salvaguardas.exigir_firma(db, request, "aprobar_diferencia", f"Aprobar la diferencia al abrir del {fila.dia:%d/%m}",
                                          monto=fila.diferencia or 0)
        _asentar_diferencia_apertura(db, fila, motivo, quien)
    db.commit()
    return diferencias_por_aprobar(db)


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
        estado_diferencia=c.estado_diferencia or "asentada",
        aprobada_por=c.aprobada_por or "",
        motivo_aprobacion=c.motivo_aprobacion or "",
        cerrado_por=c.cerrado_por or "",
        autorizado_por=c.autorizado_por or "",
        por_revisar=bool(c.por_revisar),
        cambios_despues=c.cambios_despues or "",
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
    pedido = next(iter(cuentas_por_cobrar.bloquear_pedidos(db, [pedido_id])), None)
    if not pedido:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    # Reintento de un abono que ya entro: se responde lo que quedo, sin aplicarlo otra vez.
    ya = (
        db.query(models.AbonoFiado).filter(models.AbonoFiado.clave_cliente == body.clave_cliente).first()
        if body.clave_cliente
        else None
    )
    if ya is not None:
        return {
            "ok": True,
            "cobrado": ya.monto,
            "queda": pedido.fiado_saldo,
            "saldado": pedido.fiado_saldo <= 0,
            "cliente": pedido.cliente,
        }
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
        clave_cliente=body.clave_cliente or None,
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


@router.get("/traspasos", response_model=List[schemas.Traspaso])
def listar_traspasos(rango: Rango = Depends(), db: Session = Depends(get_db)):
    inicio, fin, _ = rango.resolver(dias=30)
    return (
        db.query(models.TraspasoFondos)
        .filter(models.TraspasoFondos.fecha >= inicio, models.TraspasoFondos.fecha < fin)
        .order_by(models.TraspasoFondos.id.desc())
        .all()
    )


@router.post("/traspasos", response_model=schemas.Traspaso)
def crear_traspaso(body: schemas.TraspasoCreate, db: Session = Depends(get_db)):
    """Llevar el efectivo al banco, cambiar de gaveta, o que el dueño ponga
    plata. Ninguno es venta ni gasto, pero los dos mueven la caja."""
    if not contabilidad.metodo_de_pago_valido(body.hacia):
        raise HTTPException(status_code=400, detail="¿A dónde va la plata?")
    desde = None
    if body.tipo == "traspaso":
        if not contabilidad.metodo_de_pago_valido(body.desde):
            raise HTTPException(status_code=400, detail="¿De dónde sale la plata?")
        if contabilidad.cuenta_de_pago(body.desde) == contabilidad.cuenta_de_pago(body.hacia):
            raise HTTPException(status_code=400, detail="Sale y entra en el mismo sitio: no hay nada que mover")
        desde = body.desde
    referencia = body.referencia.strip()
    if not referencia and body.hacia in contabilidad.METODOS_CON_REFERENCIA:
        raise HTTPException(status_code=400, detail="Pon la referencia del depósito o la transferencia")
    t = models.TraspasoFondos(
        tipo=body.tipo, desde=desde, hacia=body.hacia, monto=round(body.monto, 2),
        referencia=referencia, nota=body.nota.strip(), fecha=ahora(), operador_id=body.operador_id,
    )
    db.add(t)
    db.flush()
    contabilidad.registrar_traspaso(db, t)
    db.commit()
    db.refresh(t)
    return t


@router.post("/traspasos/{traspaso_id}/anular", response_model=schemas.Traspaso)
def anular_traspaso(traspaso_id: int, db: Session = Depends(get_db)):
    t = db.get(models.TraspasoFondos, traspaso_id)
    if t is None:
        raise HTTPException(status_code=404, detail="Movimiento no encontrado")
    if t.anulado:
        raise HTTPException(status_code=409, detail="Ese movimiento ya estaba anulado")
    _solo_si_el_ejercicio_esta_abierto(db, t.fecha, "ese movimiento")
    contabilidad.reversar_asiento(db, t.tipo, t.id, f"reverso_{t.tipo}")
    t.anulado = True
    db.commit()
    db.refresh(t)
    return t


@router.get("/retiros", response_model=List[schemas.RetiroPropietario])
def listar_retiros(rango: Rango = Depends(), db: Session = Depends(get_db)):
    inicio, fin, _ = rango.resolver(dias=30)
    return (
        db.query(models.RetiroPropietario)
        .filter(models.RetiroPropietario.fecha >= inicio, models.RetiroPropietario.fecha < fin)
        .order_by(models.RetiroPropietario.id.desc())
        .all()
    )


def _hay_en_la_gaveta(db: Session, metodo: str, monto: float, que: str) -> None:
    """Un retiro o gasto en efectivo no puede sacar mas de lo que hay (QA nov,
    hallazgo 7: un retiro de $5.000 con $133 en la gaveta dejo -$4.900)."""
    if metodo not in GAVETAS_DE_APERTURA:
        return
    inicio, fin = _rango_de(hoy())
    fila = next((l for l in _desglose(db, hoy(), inicio, fin) if l.metodo == metodo), None)
    hay = fila.esperado if fila else 0.0
    if monto > hay + 0.005:
        raise HTTPException(
            status_code=400,
            detail=f"En {metodo} hay {salvaguardas.usd(hay)} y {que} es de {salvaguardas.usd(monto)}. "
            "Revisa el monto, o si salió de otro lado, cambia de dónde salió.",
        )


def _dia_cerrado(db: Session, fecha) -> Optional[models.CierreCaja]:
    if fecha is None:
        return None
    inicio, fin = _rango_de(fecha.date())
    return (
        db.query(models.CierreCaja)
        .filter(models.CierreCaja.fecha >= inicio, models.CierreCaja.fecha < fin, models.CierreCaja.anulado.is_(False))
        .first()
    )


def _firma_si_dia_cerrado(db: Session, request: Request, fecha, que: str) -> None:
    cierre = _dia_cerrado(db, fecha)
    if cierre is not None:
        salvaguardas.exigir_firma(db, request, "borrar_dia_cerrado", f"Borrar {que} del {fecha:%d/%m}, con la caja ya cerrada")


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
    _hay_en_la_gaveta(db, body.metodo_pago, body.monto, "el retiro")

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
def eliminar_retiro(retiro_id: int, request: Request, db: Session = Depends(get_db)):
    retiro = db.query(models.RetiroPropietario).filter(models.RetiroPropietario.id == retiro_id).first()
    if not retiro:
        raise HTTPException(status_code=404, detail="Retiro no encontrado")
    _solo_si_el_ejercicio_esta_abierto(db, retiro.fecha, "ese retiro")
    _firma_si_dia_cerrado(db, request, retiro.fecha, "un retiro")
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
    _hay_en_la_gaveta(db, gasto.metodo_pago, gasto.monto, "el gasto")
    # Un sueldo pagado como pago menor iba a gastos varios: Pagos y Dona
    # decian que en octubre no hubo sueldos (QA nov, hallazgo 20).
    if SUELDO.search(gasto.descripcion or ""):
        raise HTTPException(
            status_code=400,
            detail="Los sueldos van en Pagos › Nuevo pago, con concepto «Sueldos»: ahí se descuentan los anticipos "
            "y salen en el reporte de nómina. Puedes elegir que sale de la gaveta.",
        )
    db_gasto = models.Gasto(**gasto.model_dump())
    db.add(db_gasto)
    db.flush()
    contabilidad.registrar_gasto(db, db_gasto)
    db.commit()
    db.refresh(db_gasto)
    return db_gasto


@router.delete("/gastos/{gasto_id}")
def eliminar_gasto(gasto_id: int, request: Request, db: Session = Depends(get_db)):
    db_gasto = db.query(models.Gasto).filter(models.Gasto.id == gasto_id).first()
    if not db_gasto:
        raise HTTPException(status_code=404, detail="Gasto no encontrado")
    _solo_si_el_ejercicio_esta_abierto(db, db_gasto.fecha, "ese gasto")
    _firma_si_dia_cerrado(db, request, db_gasto.fecha, "un gasto")
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


@router.post("/historial/exportar")
def exportar_historial(body: schemas.ExportarRango, db: Session = Depends(get_db)):
    """Cierres, gastos y retiros del periodo, en orden (QA nov, hallazgo 29)."""
    from ..exportar_csv import respuesta_csv, respuesta_xlsx

    inicio, fin, _ = Rango(desde=body.desde, hasta=body.hasta).resolver(dias=30)
    filas = []
    for c in db.query(models.CierreCaja).filter(models.CierreCaja.fecha >= inicio, models.CierreCaja.fecha < fin).all():
        dif = round(sum(l.diferencia or 0 for l in c.lineas), 2) if c.lineas else round((c.diferencia or 0) + (c.divisas_diferencia or 0), 2)
        estado = "Anulado" if c.anulado else {"por_aprobar": "Diferencia por aprobar", "aprobada": "Aprobada"}.get(c.estado_diferencia or "", "")
        filas.append((c.fecha, "Cierre", c.nota or "", c.total_sistema, dif, c.cerrado_por or c.operador, estado))
    for g in db.query(models.Gasto).filter(models.Gasto.fecha >= inicio, models.Gasto.fecha < fin).all():
        filas.append((g.fecha, "Gasto", f"{g.descripcion} ({g.metodo_pago})", -g.monto, None, "", ""))
    for r in db.query(models.RetiroPropietario).filter(models.RetiroPropietario.fecha >= inicio, models.RetiroPropietario.fecha < fin).all():
        filas.append((r.fecha, "Retiro del dueño", f"{r.nota or ''} ({r.metodo_pago})".strip(), -r.monto, None, "", ""))
    filas.sort(key=lambda f: f[0], reverse=True)
    columnas = ("Fecha", "Tipo", "Detalle", "Monto ($)", "Descuadre ($)", "Quién cerró", "Estado")
    nombre = f"caja-historial-{hoy().isoformat()}.{body.formato}"
    if body.formato == "xlsx":
        return respuesta_xlsx(nombre, columnas, filas, hoja="Historial de caja")
    return respuesta_csv(nombre, columnas, filas, regional=True)
