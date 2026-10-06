"""IVA: alicuota configurable y desglose base/impuesto.

No todas las ventas se facturan - el dueno decide cual sale con factura a
mano al momento de cobrar. Solo esas cuentan para el SENIAT. Esta separacion
vive en `Pedido.facturado` (ver `contabilidad.registrar_venta`); este modulo
solo resuelve la aritmetica del IVA y donde vive la alicuota vigente.
"""

import re
from typing import Optional, Tuple

from sqlalchemy.orm import Session

from . import models

IVA_DEFAULT = 16.0  # alicuota general vigente en Venezuela

# Letra (tipo de contribuyente) + 8 o 9 digitos, con o sin guiones/espacios:
# J-12345678-9, V123456789, E-12345678. No se valida el digito verificador
# -esa cuenta es del SENIAT, no del ERP- pero un campo vacio o "sin rif" no
# puede quedar en un libro de compras que se declara.
_RIF_FORMATO = re.compile(r"^[VEJGPC]\d{8,9}$")


def normalizar_rif(rif: str) -> str:
    return re.sub(r"[\s-]", "", (rif or "").strip().upper())


def rif_valido(rif: str) -> bool:
    return bool(_RIF_FORMATO.match(normalizar_rif(rif)))


# El documento de quien recibe una factura de venta: un RIF, o la cedula de
# una persona sin RIF (6 a 8 digitos). Solo numeros se lee como cedula
# venezolana: "12345678" es V12345678.
_DOCUMENTO_CLIENTE = re.compile(r"^[VEJGPC]\d{6,9}$")


def normalizar_documento_cliente(texto: str) -> str:
    limpio = re.sub(r"[\s.\-]", "", (texto or "").strip().upper())
    return f"V{limpio}" if limpio.isdigit() else limpio


def documento_cliente_valido(texto: str) -> bool:
    return bool(_DOCUMENTO_CLIENTE.match(normalizar_documento_cliente(texto)))


# Valor de la letra para el digito verificador. La C (comunas) no se incluye:
# no hay certeza de su valor, y un aviso falso es peor que ninguno.
_VALOR_LETRA_RIF = {"V": 1, "E": 2, "J": 3, "P": 4, "G": 5}
_PESOS_RIF = (4, 3, 2, 7, 6, 5, 4, 3, 2)


def rif_digito_ok(rif: str) -> Optional[bool]:
    """Si el ultimo digito del RIF cuadra con el resto.

    NO es para rechazar: guardar sigue pidiendo solo el formato (ver arriba).
    Es para AVISAR al revisar una factura leida de una foto, donde un digito
    mal leido es el error mas comun -- y con este calculo se ve sin mirar el
    papel. Comprobado con 10 RIF reales de facturas de proveedores.
    None si no se puede decir (sin digito verificador o letra sin valor).
    """
    r = normalizar_rif(rif)
    if not _RIF_FORMATO.match(r) or len(r) != 10 or r[0] not in _VALOR_LETRA_RIF:
        return None
    suma = sum(p * d for p, d in zip(_PESOS_RIF, [_VALOR_LETRA_RIF[r[0]]] + [int(c) for c in r[1:9]]))
    digito = 11 - suma % 11
    return (0 if digito >= 10 else digito) == int(r[9])


def _config(db: Session) -> models.ConfiguracionFiscal:
    cfg = db.query(models.ConfiguracionFiscal).first()
    if not cfg:
        cfg = models.ConfiguracionFiscal(tasa_iva=IVA_DEFAULT)
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


def config(db: Session) -> models.ConfiguracionFiscal:
    return _config(db)


def tasa_iva(db: Session) -> float:
    return _config(db).tasa_iva


def fijar_tasa_iva(db: Session, valor: float) -> float:
    cfg = _config(db)
    cfg.tasa_iva = valor
    db.commit()
    return cfg.tasa_iva


def desglosar(monto_total: float, tasa_pct: float) -> Tuple[float, float]:
    """De un monto final (IVA incluido) saca (base_imponible, iva)."""
    factor = 1 + (tasa_pct / 100)
    base = round(monto_total / factor, 2)
    iva = round(monto_total - base, 2)
    return base, iva


# ------------------------------------------------- montos en bolivares

def gravado_de(base: float, iva: float, tasa_pct: float) -> float:
    """La parte de una base que paga IVA, cuando no hay renglones que lo digan
    (servicios, notas de credito): la que corresponde al IVA cobrado."""
    if iva <= 0 or tasa_pct <= 0:
        return 0.0
    gravado = iva * 100 / tasa_pct
    # El IVA viene redondeado al centimo: una base toda gravada da un
    # "gravado" corrido unos centimos. Eso no es una parte exenta.
    return base if gravado >= base - 0.05 else min(gravado, base)


def montos_bs(base: float, gravado: float, iva: float, tasa: float, iva_de_la_base: bool,
              tasa_pct: float) -> Tuple[float, float, float]:
    """(gravado_bs, exento_bs, iva_bs) a partir de montos en dolares SIN
    redondear: si la factura vino en Bs, se paso a dolares dividiendo entre
    la misma tasa, y multiplicar de vuelta devuelve los Bs del papel.

    `iva_de_la_base`: con renglones el IVA en Bs se calcula sobre la base en
    Bs, como lo calcula el proveedor; sin renglones vale el que se tecleo.
    """
    base_bs = round(base * tasa, 2)
    gravado_bs = round(gravado * tasa, 2)
    exento_bs = round(base_bs - gravado_bs, 2)
    iva_bs = round(gravado_bs * tasa_pct / 100, 2) if iva_de_la_base else round(iva * tasa, 2)
    return gravado_bs, exento_bs, iva_bs


def porcentaje_de(monto: float, pct: float) -> float:
    """El pct de un monto, en centimos enteros y la mitad hacia arriba
    (5,175 -> 5,18). Con floats, 6,90 x 75 % daba 5,17 o 5,18 segun como se
    escribiera la cuenta, y la caja (que lo calcula igual en el navegador)
    descuadraba por un centimo."""
    centimos = round(monto * 100)
    return ((centimos * int(round(pct * 100)) + 5000) // 10000) / 100
