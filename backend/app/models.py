import datetime

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from .database import Base


class Producto(Base):
    __tablename__ = "productos"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    categoria = Column(String, nullable=False)  # bebida | comida | postre
    precio = Column(Float, nullable=False)
    activo = Column(Boolean, default=True)


class Ingrediente(Base):
    __tablename__ = "ingredientes"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    unidad = Column(String, nullable=False)  # kg | unidad | litro
    stock_actual = Column(Float, default=0)
    stock_minimo = Column(Float, default=0)
    stock_objetivo = Column(Float, default=0)  # nivel al que se repone al comprar


class RecetaItem(Base):
    __tablename__ = "receta_items"

    id = Column(Integer, primary_key=True, index=True)
    producto_id = Column(Integer, ForeignKey("productos.id"), nullable=False)
    ingrediente_id = Column(Integer, ForeignKey("ingredientes.id"), nullable=False)
    cantidad_por_unidad = Column(Float, nullable=False)  # cuanto insumo consume 1 unidad del producto

    producto = relationship("Producto")
    ingrediente = relationship("Ingrediente")


class Pedido(Base):
    __tablename__ = "pedidos"

    id = Column(Integer, primary_key=True, index=True)
    numero = Column(Integer, nullable=False)
    estado = Column(String, default="pendiente")  # pendiente | listo | pagado | anulado
    nota = Column(String, default="")
    metodo_pago = Column(String, nullable=True)
    creado_en = Column(DateTime, default=datetime.datetime.utcnow)
    cerrado_en = Column(DateTime, nullable=True)

    items = relationship("PedidoItem", back_populates="pedido", cascade="all, delete-orphan")

    @property
    def total(self):
        return sum(item.precio_unitario * item.cantidad for item in self.items)


class PedidoItem(Base):
    __tablename__ = "pedido_items"

    id = Column(Integer, primary_key=True, index=True)
    pedido_id = Column(Integer, ForeignKey("pedidos.id"), nullable=False)
    producto_id = Column(Integer, ForeignKey("productos.id"), nullable=False)
    nombre = Column(String, nullable=False)
    precio_unitario = Column(Float, nullable=False)
    cantidad = Column(Integer, default=1)
    nota = Column(String, default="")
    preparado = Column(Boolean, default=False)

    pedido = relationship("Pedido", back_populates="items")
