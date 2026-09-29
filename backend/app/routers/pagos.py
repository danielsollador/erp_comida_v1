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
from ..acceso import auth, permisos
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
        return schemas.EstadoPabilo(
            configurado=True, error="El verificador de pagos no respondió. Se puede cobrar anotando la referencia."
        )
    extras = [c for c in cuenta.campos if c != "REFERENCE_NUMBER"]
    operativas = [c for c in pabilo.cuentas() if not c.deshabilitada and not c.bloqueada]
    return schemas.EstadoPabilo(
        configurado=True,
        cuenta=cuenta.descripcion,
        cuenta_id=cuenta.id,
        cuentas=[schemas.CuentaCorta(id=c.id, descripcion=c.descripcion, banco=c.banco) for c in operativas],
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
        cuenta_bs=round(v.esperado_usd * v.tasa, 2) if v.esperado_usd and v.tasa else None,
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
    # Contra que se compara lo que diga el banco: lo que la cajera escribio
    # (el cliente dijo "te mande 1.700") o, si no toco nada, la cuenta a la
    # tasa. La diferencia con la cuenta real la resuelve la cajera al cobrar:
    # de mas es propina, de menos se completa con otra forma.
    if body.monto_bs and body.monto_bs > 0:
        esperado_bs = round(body.monto_bs, 2)
    else:
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
        # A la que la caja dijo que le pagaron (un local con dos bancos), o
        # la principal.
        cuenta = pabilo.cuenta_por_id(body.user_bank_id) if body.user_bank_id else pabilo.cuenta_activa()
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


# ── Configuracion: la clave, la cuenta y las cuentas (Configuracion > Pago movil)
#
# Solo quien administra el local (dueño o Vertigo): la clave gasta creditos y
# da de alta cuentas bancarias con la contraseña del banco. El middleware ya
# cierra `/api/pagos/config` a los demas (permisos.SOLO_ADMINISTRA); aqui se
# vuelve a exigir por si alguien monta el router en otro sitio.


def _fila(db: Session) -> models.Configuracion:
    fila = db.query(models.Configuracion).first()
    if fila is None:
        fila = models.Configuracion(vender_sin_inventario=False)
        db.add(fila)
        db.commit()
        db.refresh(fila)
    return fila


def cargar_ajustes(db: Session) -> None:
    """Deja en `pabilo` lo guardado en la base. Se llama al arrancar y cada
    vez que se guarda algo desde la pantalla."""
    fila = db.query(models.Configuracion).first()
    pabilo.ajustar(
        clave=(fila.pabilo_api_key or "") if fila else "",
        cuenta=(fila.pabilo_user_bank_id or "") if fila else "",
    )


def _pista(clave: str) -> str:
    return ("…" + clave[-4:]) if len(clave) >= 8 else ""


def _config_actual(db: Session, *, vertigo: bool, forzar: bool = False) -> schemas.ConfigPabilo:
    """La foto para la pantalla.

    SOLO VERTIGO VE LA INTEGRACION: con quien esta hecha, la clave, los
    creditos y el plan son de la plataforma, no del local. Al dueño le llegan
    sus cuentas bancarias y nada mas (Leider, 29-sep: "si no eres admin, no
    tienes por que ver con quien estamos integrados").
    """
    fila = _fila(db)
    activa = pabilo.cuenta_configurada()
    r = schemas.ConfigPabilo(
        configurado=pabilo.configurado(),
        origen_clave=pabilo.origen_clave() if vertigo else "",
        clave_pista=_pista(pabilo.clave()) if vertigo else "",
        cuenta_activa_id=activa,
    )
    if not r.configurado:
        return r
    try:
        if vertigo:
            p = pabilo.perfil()
            r.perfil = schemas.PerfilPabilo(
                usuario=p["usuario"], empresa=p["empresa"], creditos=p["creditos"], plan_activo=p["plan_activo"]
            )
        lista = pabilo.cuentas(forzar=forzar)
    except pabilo.PabiloError as e:
        r.error = e.mensaje
        return r
    except Exception as e:  # noqa: BLE001
        log.warning("pabilo: no se pudo leer la configuracion: %s", e)
        r.error = pabilo.MENSAJES["SIN_CONEXION"]
        return r
    # Sin cuenta elegida y una sola conectada: esa es, y se deja guardada
    # para que la pantalla y el cobro digan lo mismo.
    if not activa and len(lista) == 1:
        fila.pabilo_user_bank_id = lista[0].id
        db.commit()
        cargar_ajustes(db)
        activa = lista[0].id
        r.cuenta_activa_id = activa
    r.cuentas = [
        schemas.CuentaPabilo(
            id=c.id,
            descripcion=c.descripcion,
            banco=c.banco,
            proveedor=c.proveedor,
            moneda=c.moneda,
            numero=c.numero,
            telefono=c.telefono,
            deshabilitada=c.deshabilitada,
            bloqueada=c.bloqueada,
            activa=c.id == activa,
        )
        for c in lista
    ]
    if activa and not any(c.id == activa for c in lista):
        r.error = "La cuenta principal ya no está conectada. Elige otra."
    return r


def _traducir(e: pabilo.PabiloError) -> HTTPException:
    return HTTPException(status_code=e.status, detail=e.mensaje)


def _vertigo(request: Request) -> bool:
    return permisos.es_vertigo(auth.exigir_admin(request)["rol"])


def _exigir_vertigo(request: Request) -> None:
    """La conexion con el verificador (la clave) es de la plataforma."""
    if not _vertigo(request):
        raise HTTPException(403, "La conexión con el verificador de pagos la administra Vertigo.")


@router.get("/config", response_model=schemas.ConfigPabilo)
def config(request: Request, db: Session = Depends(get_db)):
    return _config_actual(db, vertigo=_vertigo(request), forzar=True)


@router.put("/config/clave", response_model=schemas.ConfigPabilo)
def guardar_clave(body: schemas.ClavePabiloRequest, request: Request, db: Session = Depends(get_db)):
    """Pega la clave de Pabilo. Se prueba ANTES de guardarla (GET /me): una
    clave mal copiada no se queda puesta rompiendo el cobro. Vacia = se quita
    la de la pantalla y vuelve a valer la del servidor, si hay. Solo Vertigo."""
    _exigir_vertigo(request)
    clave = body.clave.strip()
    fila = _fila(db)
    if clave:
        anterior = pabilo._ajuste["clave"]
        pabilo.ajustar(clave=clave)
        try:
            pabilo.perfil()
        except pabilo.PabiloError as e:
            pabilo.ajustar(clave=anterior)
            if e.codigo in ("UNAUTHORIZED", "FORBIDDEN"):
                raise HTTPException(400, "Pabilo no reconoce esa clave. Cópiala de nuevo desde Integraciones en pabilo.app.")
            raise _traducir(e)
    # Otra clave, otras cuentas: la elegida ya no aplica.
    if clave != (fila.pabilo_api_key or ""):
        fila.pabilo_user_bank_id = ""
    fila.pabilo_api_key = clave
    db.commit()
    cargar_ajustes(db)
    return _config_actual(db, vertigo=True, forzar=True)


@router.put("/config/cuenta", response_model=schemas.ConfigPabilo)
def elegir_cuenta(body: schemas.CuentaActivaRequest, request: Request, db: Session = Depends(get_db)):
    """La cuenta PRINCIPAL: a la que se verifica si la caja no elige otra."""
    vertigo = _vertigo(request)
    if not pabilo.configurado():
        raise HTTPException(409, "La verificación de pagos no está activada para este local. Avísale a Vertigo.")
    try:
        lista = pabilo.cuentas(forzar=True)
    except pabilo.PabiloError as e:
        raise _traducir(e)
    except Exception:  # noqa: BLE001
        raise HTTPException(502, pabilo.MENSAJES["SIN_CONEXION"])
    if not any(c.id == body.user_bank_id for c in lista):
        raise HTTPException(404, "Esa cuenta no está entre las de la clave.")
    fila = _fila(db)
    fila.pabilo_user_bank_id = body.user_bank_id
    db.commit()
    cargar_ajustes(db)
    return _config_actual(db, vertigo=vertigo)


@router.get("/config/bancos", response_model=list[schemas.OpcionBanco])
def bancos(request: Request):
    """Con que bancos se puede conectar una cuenta y que pide cada uno. El
    banco de prueba solo se le ofrece a Vertigo."""
    vertigo = _vertigo(request)
    try:
        return [o for o in pabilo.opciones_de_banco() if vertigo or not o["prueba"]]
    except pabilo.PabiloError as e:
        raise _traducir(e)


@router.post("/config/cuentas", response_model=schemas.ConfigPabilo)
def crear_cuenta(body: schemas.NuevaCuentaPabilo, request: Request, db: Session = Depends(get_db)):
    """Conecta una cuenta bancaria nueva en Pabilo con las credenciales del
    banco. Si es la primera, queda como principal."""
    vertigo = _vertigo(request)
    if not pabilo.configurado():
        raise HTTPException(409, "La verificación de pagos no está activada para este local. Avísale a Vertigo.")
    try:
        creada = pabilo.crear_cuenta(
            body.proveedor,
            body.descripcion,
            usuario=body.usuario,
            clave_banco=body.clave,
            metadata={str(k): str(v) for k, v in (body.metadata or {}).items()},
            telefono=body.telefono,
            cedula=body.cedula,
        )
    except pabilo.PabiloError as e:
        raise _traducir(e)
    fila = _fila(db)
    if not fila.pabilo_user_bank_id and creada.get("id"):
        fila.pabilo_user_bank_id = creada["id"]
        db.commit()
        cargar_ajustes(db)
    return _config_actual(db, vertigo=vertigo, forzar=True)


@router.put("/config/cuentas/{user_bank_id}/clave", response_model=schemas.ConfigPabilo)
def cambiar_clave_de_cuenta(
    user_bank_id: str, body: schemas.SecretoCuentaRequest, request: Request, db: Session = Depends(get_db)
):
    vertigo = _vertigo(request)
    if not body.clave:
        raise HTTPException(400, "Escribe la clave nueva.")
    try:
        pabilo.cambiar_secreto(user_bank_id, body.clave)
    except pabilo.PabiloError as e:
        raise _traducir(e)
    return _config_actual(db, vertigo=vertigo, forzar=True)


@router.delete("/config/cuentas/{user_bank_id}", response_model=schemas.ConfigPabilo)
def borrar_cuenta(user_bank_id: str, request: Request, db: Session = Depends(get_db)):
    vertigo = _vertigo(request)
    try:
        pabilo.borrar_cuenta(user_bank_id)
    except pabilo.PabiloError as e:
        raise _traducir(e)
    fila = _fila(db)
    if fila.pabilo_user_bank_id == user_bank_id:
        fila.pabilo_user_bank_id = ""
        db.commit()
        cargar_ajustes(db)
    return _config_actual(db, vertigo=vertigo, forzar=True)
