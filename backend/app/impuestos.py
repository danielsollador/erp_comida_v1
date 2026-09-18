"""IVA: alicuota configurable y desglose base/impuesto.

No todas las ventas se facturan - el dueno decide cual sale con factura a
mano al momento de cobrar. Solo esas cuentan para el SENIAT. Esta separacion
vive en `Pedido.facturado` (ver `contabilidad.registrar_venta`); este modulo
solo resuelve la aritmetica del IVA y donde vive la alicuota vigente.
"""

import re
from typing import Tuple

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


def _config(db: Session) -> models.ConfiguracionFiscal:
    cfg = db.query(models.ConfiguracionFiscal).first()
    if not cfg:
        cfg = models.ConfiguracionFiscal(tasa_iva=IVA_DEFAULT)
        db.add(cfg)
        db.commit()
        db.refresh(cfg)
    return cfg


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
