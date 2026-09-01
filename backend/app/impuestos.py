"""IVA: alicuota configurable y desglose base/impuesto.

No todas las ventas se facturan - el dueno decide cual sale con factura a
mano al momento de cobrar. Solo esas cuentan para el SENIAT. Esta separacion
vive en `Pedido.facturado` (ver `contabilidad.registrar_venta`); este modulo
solo resuelve la aritmetica del IVA y donde vive la alicuota vigente.
"""

from typing import Tuple

from sqlalchemy.orm import Session

from . import models

IVA_DEFAULT = 16.0  # alicuota general vigente en Venezuela


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
