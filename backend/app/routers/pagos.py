"""Verificar un pago movil contra el banco antes de cobrarlo.

El mostrador pregunta aqui, no a Pabilo: la clave vive en el servidor, la tasa
tambien, y es el ERP quien sabe si esa referencia ya se uso para cobrar otra
cuenta. La respuesta le dice a la cajera UNA de cinco cosas:

  verificado      el banco encontro el pago y el monto alcanza.
  monto_distinto  el banco lo encontro pero entro otra cantidad: se muestran
                  las dos y la cajera decide (aceptar, o pedir la diferencia).
  no_encontrado   el banco no tiene nada con esa referencia.
  ya_usado        esa referencia ya cobro otro pedido de este local.
  error           no se pudo saber: banco caido, sin creditos, sin clave. La
                  respuesta dice si vale reintentar o si es cosa del dueno.

En todos los casos la referencia se puede seguir anotando a mano y cobrar,
igual que antes de existir esto: un local no deja de cobrar porque un tercero
no responda. Lo que cambia es que la venta queda marcada como verificada o no.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import contabilidad, models, pabilo, schemas, tasas
from ..database import get_db
from . import operadores

log = logging.getLogger("erp.pagos")

router = APIRouter(prefix="/api/pagos", tags=["pagos"])

# Los metodos del ERP que caen en la cuenta bancaria conectada. Efectivo no
# tiene nada que verificar; el punto de venta lo liquida el banco por su lado;
# Zelle es otra plataforma.
METODOS_VERIFICABLES = ("Pago movil", "Transferencia")

# Cuanto puede faltar para darlo por bueno igual. El monto en Bs sale de
# multiplicar dolares por una tasa con decimales y el cliente redondea al
# escribirlo en su banco: Bs 1.234,57 contra Bs 1.234,50 no es un faltante,
# es redondeo. Un bolivar o el 0,5 %, lo que sea mayor.
TOLERANCIA_BS = 1.0
TOLERANCIA_PCT = 0.005


def _limpiar_referencia(texto: str) -> str:
    # Los bancos muestran la referencia con espacios o guiones; el API quiere
    # solo los digitos. Y el cliente suele leer los ultimos 4-8: se acepta lo
    # que traiga, el banco busca por coincidencia.
    return "".join(ch for ch in (texto or "") if ch.isalnum())


@router.get("/estado", response_model=schemas.EstadoPabilo)
def estado():
    """Si el local puede verificar pagos, y con que cuenta.

    El mostrador lo consulta al abrir: si no esta configurado, el cuadro de
    cobro ni menciona la verificacion.
    """
    if not pabilo.configurado():
        return schemas.EstadoPabilo(configurado=False)
    try:
        cuenta = pabilo.cuenta_activa()
    except pabilo.PabiloNoConfigurado:
        return schemas.EstadoPabilo(configurado=False)
    except LookupError as e:
        return schemas.EstadoPabilo(configurado=True, error=str(e))
    except Exception as e:  # noqa: BLE001 - un tercero caido no tumba el mostrador
        log.warning("pabilo no responde al listar cuentas: %s", e)
        return schemas.EstadoPabilo(configurado=True, error="Pabilo no respondió. Se puede cobrar anotando la referencia.")
    extras = [c for c in cuenta.campos if c != "REFERENCE_NUMBER"]
    return schemas.EstadoPabilo(
        configurado=True,
        cuenta=cuenta.descripcion,
        banco=cuenta.banco,
        moneda=cuenta.moneda,
        campos=extras,
        metodos=list(METODOS_VERIFICABLES),
    )


def _a_respuesta(v: models.VerificacionPago, *, reintentable=False, del_dueno=False,
                 pedido_numero: Optional[int] = None) -> schemas.VerificacionPago:
    return schemas.VerificacionPago(
        id=v.id,
        referencia=v.referencia,
        resultado=v.resultado,
        mensaje=v.mensaje or "",
        codigo=v.codigo or "",
        esperado_bs=v.esperado_bs,
        monto_bs=v.monto_bs,
        tasa=v.tasa,
        es_nueva=bool(v.es_nueva),
        reintentable=reintentable,
        del_dueno=del_dueno,
        creditos_restantes=v.creditos_restantes,
        pedido_numero=pedido_numero,
    )


@router.post("/verificar", response_model=schemas.VerificacionPago)
def verificar(body: schemas.VerificarPagoRequest, request: Request, db: Session = Depends(get_db)):
    referencia = _limpiar_referencia(body.referencia)
    if len(referencia) < 4:
        raise HTTPException(status_code=400, detail="La referencia tiene que tener al menos 4 dígitos.")
    if body.monto_usd <= 0:
        raise HTTPException(status_code=400, detail="El monto a verificar tiene que ser mayor a cero.")
    if body.metodo not in METODOS_VERIFICABLES:
        raise HTTPException(
            status_code=400,
            detail=f"'{body.metodo}' no se verifica con el banco. Solo: {', '.join(METODOS_VERIFICABLES)}.",
        )
    if not pabilo.configurado():
        raise HTTPException(status_code=409, detail="La verificación de pagos no está configurada en este local.")

    operador = operadores.del_turno(db, request)
    vigente = tasas.tasa_vigente(db)
    tasa = float(vigente.bcv) if vigente else None
    esperado_bs = round(body.monto_usd * tasa, 2) if tasa else None

    registro = models.VerificacionPago(
        referencia=referencia,
        metodo=body.metodo,
        resultado="error",
        esperado_usd=round(body.monto_usd, 2),
        esperado_bs=esperado_bs,
        tasa=tasa,
        pedido_id=body.pedido_id,
        operador_id=operador.id if operador else None,
    )

    # PRIMERO la base propia, sin gastar un credito: la misma referencia no
    # puede cobrar dos cuentas. Se busca por sufijo en ambos sentidos porque
    # el cliente a veces dicta los ultimos digitos y otras la referencia
    # completa; "3456" y "00123456" son el mismo pago.
    usado = (
        db.query(models.PagoPedido, models.Pedido)
        .join(models.Pedido, models.Pedido.id == models.PagoPedido.pedido_id)
        .filter(
            models.PagoPedido.metodo.in_(contabilidad.METODOS_CON_REFERENCIA),
            models.PagoPedido.referencia != "",
            models.Pedido.estado == "pagado",
        )
        .all()
    )
    for pago, pedido in usado:
        ref = _limpiar_referencia(pago.referencia)
        if len(ref) >= 4 and (ref.endswith(referencia) or referencia.endswith(ref)):
            registro.resultado = "ya_usado"
            registro.codigo = "YA_USADO_LOCAL"
            registro.mensaje = (
                f"Esa referencia ya cobró el pedido #{pedido.numero}"
                f"{' de ' + pedido.cliente if pedido.cliente else ''}. Pide otro comprobante."
            )
            db.add(registro)
            db.commit()
            db.refresh(registro)
            return _a_respuesta(registro, pedido_numero=pedido.numero)

    try:
        cuenta = pabilo.cuenta_activa()
    except (LookupError, pabilo.PabiloNoConfigurado) as e:
        registro.codigo = "SIN_CUENTA"
        registro.mensaje = str(e)
        db.add(registro); db.commit(); db.refresh(registro)
        return _a_respuesta(registro, del_dueno=True)
    except Exception as e:  # noqa: BLE001
        log.warning("pabilo: no se pudo resolver la cuenta: %s", e)
        registro.codigo = "SIN_CONEXION"
        registro.mensaje = pabilo.MENSAJES["SIN_CONEXION"]
        db.add(registro); db.commit(); db.refresh(registro)
        return _a_respuesta(registro, reintentable=True)

    cuerpo = pabilo.armar_cuerpo(
        cuenta, referencia, telefono=body.telefono, cedula=body.cedula, banco_origen=body.banco_origen
    )
    r = pabilo.verificar(cuenta, cuerpo)

    registro.codigo = r.codigo
    registro.pabilo_id = r.pabilo_id
    registro.es_nueva = r.es_nuevo
    registro.credito_costo = r.credito_costo
    registro.creditos_restantes = r.creditos_restantes
    registro.monto_bs = r.monto

    if r.ok:
        if r.monto is None or esperado_bs is None:
            # Encontrado, pero sin con que comparar (el banco no dijo monto, o
            # el local no tiene tasa cargada). Se avisa en vez de aprobar a
            # ciegas: la cajera ve el monto que haya y decide.
            registro.resultado = "monto_distinto" if r.monto is not None else "verificado"
            registro.mensaje = (
                "El banco confirma el pago. Sin tasa cargada no se pudo comparar el monto."
                if esperado_bs is None
                else "El banco confirma el pago."
            )
        else:
            falta = round(esperado_bs - r.monto, 2)
            tolerancia = max(TOLERANCIA_BS, esperado_bs * TOLERANCIA_PCT)
            if falta <= tolerancia:
                registro.resultado = "verificado"
                registro.mensaje = "Pago confirmado por el banco."
                if falta < -tolerancia:
                    registro.mensaje = f"Pago confirmado. Entró Bs {r.monto - esperado_bs:,.2f} de más."
            else:
                registro.resultado = "monto_distinto"
                registro.mensaje = f"El banco encontró el pago, pero entraron Bs {r.monto:,.2f} y la cuenta es Bs {esperado_bs:,.2f}: faltan Bs {falta:,.2f}."
        if not r.es_nuevo and registro.resultado == "verificado":
            # Pabilo ya lo habia visto: en este local no esta pegado a ningun
            # cobro (eso se reviso arriba), asi que fue una consulta previa
            # que no termino en venta. Se avisa por si acaso.
            registro.mensaje += " Esta referencia ya se había consultado antes."
    elif r.codigo == "PAYMENT_NOT_FOUND":
        registro.resultado = "no_encontrado"
        registro.mensaje = r.mensaje
    elif r.codigo == "PAYMENT_ALREADY_EXISTS":
        registro.resultado = "ya_usado"
        registro.mensaje = r.mensaje
    else:
        registro.resultado = "error"
        registro.mensaje = r.mensaje
        if r.detalle and r.codigo not in pabilo.MENSAJES:
            registro.mensaje = f"{r.mensaje} ({r.detalle[:120]})"

    db.add(registro)
    db.commit()
    db.refresh(registro)
    return _a_respuesta(registro, reintentable=r.reintentable, del_dueno=r.del_dueno)
