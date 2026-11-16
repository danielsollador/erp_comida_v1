"""Las tablas del HUB (esquema `HUB`): lo que es de Vertigo y no de un local.

Van en su propio `HubBase` y no en el `Base` de `models.py` a proposito: el
`create_all` de cada local no tiene que crearlas en su esquema, y el del hub no
tiene que clonarle las tablas de ventas de un local. Misma nomenclatura que
`models.py` (modulo 9, administracion).
"""
from sqlalchemy import Column, Date, DateTime, Float, ForeignKey, Integer, MetaData, String
from sqlalchemy.orm import declarative_base, relationship

from .database import NOMBRES
from .timeutils import ahora

HubBase = declarative_base(metadata=MetaData(naming_convention=NOMBRES))


class GastoVertigo(HubBase):
    """Lo que cuesta mantener la plataforma: servidores, dominio, IA, tiendas.
    Un renglon por compromiso de pago, no por pago (esos van en
    `PagoGastoVertigo`)."""

    __tablename__ = "DIM930_ADM_GASTO_VERTIGO"

    id = Column(Integer, primary_key=True)
    nombre = Column(String, nullable=False)
    proveedor = Column(String, nullable=False, default="")
    categoria = Column(String, nullable=False, default="Otros")
    # `None` = nadie sabe todavia cuanto es. Mejor eso que un cero inventado.
    monto = Column(Float, nullable=True)
    moneda = Column(String, nullable=False, default="USD")
    frecuencia = Column(String, nullable=False, default="mensual")
    proximo_pago = Column(Date, nullable=True)
    paga = Column(String, nullable=False, default="")
    estado = Column(String, nullable=False, default="activo")
    nota = Column(String, nullable=False, default="")
    creado = Column(DateTime, default=ahora)

    pagos = relationship("PagoGastoVertigo", back_populates="gasto",
                         cascade="all, delete-orphan", order_by="PagoGastoVertigo.fecha")


class PagoGastoVertigo(HubBase):
    """Cada vez que se pago. Guarda el monto de ese dia: si el proveedor sube
    el precio, lo ya pagado no cambia."""

    __tablename__ = "TRX930_ADM_PAGO_VERTIGO"

    id = Column(Integer, primary_key=True)
    gasto_id = Column(Integer, ForeignKey("DIM930_ADM_GASTO_VERTIGO.id", ondelete="CASCADE"),
                      nullable=False, index=True)
    fecha = Column(Date, nullable=False)
    monto = Column(Float, nullable=False)
    registrado_por = Column(String, nullable=False, default="")
    creado = Column(DateTime, default=ahora)

    gasto = relationship("GastoVertigo", back_populates="pagos")
