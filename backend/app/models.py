from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from .database import Base
from .timeutils import ahora


class Categoria(Base):
    __tablename__ = "categorias"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    orden = Column(Integer, default=0)

    productos = relationship("Producto", back_populates="categoria", cascade="all, delete-orphan")


class Producto(Base):
    __tablename__ = "productos"

    id = Column(Integer, primary_key=True, index=True)
    categoria_id = Column(Integer, ForeignKey("categorias.id"), nullable=False)
    nombre = Column(String, nullable=False)
    activo = Column(Boolean, default=True)

    categoria = relationship("Categoria", back_populates="productos")
    variantes = relationship("Variante", back_populates="producto", cascade="all, delete-orphan")


class Variante(Base):
    __tablename__ = "variantes"

    id = Column(Integer, primary_key=True, index=True)
    producto_id = Column(Integer, ForeignKey("productos.id"), nullable=False)
    nombre = Column(String, nullable=False)  # ej. "Grande", "Carne", "Regular"
    precio = Column(Float, nullable=False)
    activo = Column(Boolean, default=True)

    producto = relationship("Producto", back_populates="variantes")


class Ingrediente(Base):
    __tablename__ = "ingredientes"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    unidad = Column(String, nullable=False)  # kg | unidad | litro
    stock_actual = Column(Float, default=0)
    stock_minimo = Column(Float, default=0)
    stock_objetivo = Column(Float, default=0)  # nivel al que se repone al comprar
    costo_unitario = Column(Float, default=0)  # cuanto cuesta 1 unidad de medida (ej. 1 kg)


class RecetaItem(Base):
    __tablename__ = "receta_items"

    id = Column(Integer, primary_key=True, index=True)
    variante_id = Column(Integer, ForeignKey("variantes.id"), nullable=False)
    ingrediente_id = Column(Integer, ForeignKey("ingredientes.id"), nullable=False)
    cantidad_por_unidad = Column(Float, nullable=False)  # cuanto insumo consume 1 unidad vendida

    variante = relationship("Variante")
    ingrediente = relationship("Ingrediente")


class Configuracion(Base):
    __tablename__ = "configuracion"

    id = Column(Integer, primary_key=True, index=True)
    tasa_bcv = Column(Float, default=0)


class Gasto(Base):
    __tablename__ = "gastos"

    id = Column(Integer, primary_key=True, index=True)
    descripcion = Column(String, nullable=False)
    categoria = Column(String, default="Operativo")  # Insumos | Servicios | Sueldos | Otros
    monto = Column(Float, nullable=False)
    fecha = Column(DateTime, default=ahora)


class Merma(Base):
    __tablename__ = "mermas"

    id = Column(Integer, primary_key=True, index=True)
    ingrediente_id = Column(Integer, ForeignKey("ingredientes.id"), nullable=False)
    cantidad = Column(Float, nullable=False)
    motivo = Column(String, default="")
    fecha = Column(DateTime, default=ahora)

    ingrediente = relationship("Ingrediente")


class CierreCaja(Base):
    __tablename__ = "cierres_caja"

    id = Column(Integer, primary_key=True, index=True)
    fecha = Column(DateTime, default=ahora)
    total_sistema = Column(Float, nullable=False)
    efectivo_esperado = Column(Float, nullable=False)
    efectivo_contado = Column(Float, nullable=False)
    diferencia = Column(Float, nullable=False)
    nota = Column(String, default="")


class Pedido(Base):
    __tablename__ = "pedidos"

    id = Column(Integer, primary_key=True, index=True)
    numero = Column(Integer, nullable=False)
    estado = Column(String, default="pendiente")  # pendiente | listo | pagado | anulado
    nota = Column(String, default="")
    metodo_pago = Column(String, nullable=True)
    creado_en = Column(DateTime, default=ahora)
    cerrado_en = Column(DateTime, nullable=True)

    items = relationship("PedidoItem", back_populates="pedido", cascade="all, delete-orphan")

    @property
    def total(self):
        return sum(item.precio_unitario * item.cantidad for item in self.items)


class PedidoItem(Base):
    __tablename__ = "pedido_items"

    id = Column(Integer, primary_key=True, index=True)
    pedido_id = Column(Integer, ForeignKey("pedidos.id"), nullable=False)
    variante_id = Column(Integer, ForeignKey("variantes.id"), nullable=False)
    nombre = Column(String, nullable=False)
    precio_unitario = Column(Float, nullable=False)
    # Costo de insumos congelado al momento de la venta: si manana sube el queso,
    # los reportes de meses pasados siguen mostrando el margen real de entonces.
    costo_unitario = Column(Float, default=0)
    cantidad = Column(Integer, default=1)
    nota = Column(String, default="")
    preparado = Column(Boolean, default=False)

    pedido = relationship("Pedido", back_populates="items")
