from sqlalchemy import Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String
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
    # Costo promedio ponderado: cada compra lo recalcula con lo que ya habia en
    # stock, no lo pisa. Asi un insumo que se compro mas barato el lunes y mas
    # caro el jueves no salta de golpe al ultimo precio pagado.
    costo_unitario = Column(Float, default=0)  # costo promedio por 1 unidad de medida (ej. 1 kg), SIN IVA
    # % de lo comprado que de verdad queda utilizable despues de preparar (se
    # pierde grasa, cascara, agua al cocinar...). 100 = sin merma de cocina.
    # Distinto de la Merma (que es lo que se dano o se boto): esto es perdida
    # normal e inevitable del proceso, no un accidente.
    rendimiento_pct = Column(Float, default=100.0)

    @property
    def costo_efectivo(self):
        """Costo real por unidad UTILIZABLE, una vez descontada la merma de cocina.

        Es el numero que hay que usar para costear recetas y margenes - el
        costo_unitario a secas subestima el costo real de cualquier insumo que
        rinda menos de 100% (ej. carne, vegetales que se pelan).
        """
        rendimiento = self.rendimiento_pct or 100.0
        if rendimiento <= 0:
            return self.costo_unitario
        return round(self.costo_unitario / (rendimiento / 100), 6)


class RecetaItem(Base):
    __tablename__ = "receta_items"

    id = Column(Integer, primary_key=True, index=True)
    variante_id = Column(Integer, ForeignKey("variantes.id"), nullable=False)
    ingrediente_id = Column(Integer, ForeignKey("ingredientes.id"), nullable=False)
    cantidad_por_unidad = Column(Float, nullable=False)  # cuanto insumo consume 1 unidad vendida

    variante = relationship("Variante")
    ingrediente = relationship("Ingrediente")


class TasaCambio(Base):
    """Tasas del dia en Bs. Una fila por fecha, con historico.

    `origen` decide quien manda: una tasa cargada a mano por el dueno ('manual')
    nunca es pisada por el refresco automatico. En Venezuela el dueno a veces
    cobra a una tasa propia -distinta del BCV- y el sistema tiene que respetarla.
    """

    __tablename__ = "tasas_cambio"

    fecha = Column(Date, primary_key=True)
    bcv = Column(Float, nullable=False)  # Bs por USD (oficial BCV)
    eur = Column(Float, nullable=True)  # Bs por EUR (oficial BCV)
    paralelo = Column(Float, nullable=True)  # Bs por USDT (Binance P2P)
    origen = Column(String, default="auto")  # auto | manual
    actualizado_en = Column(DateTime, default=ahora)


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


class ConfiguracionFiscal(Base):
    __tablename__ = "configuracion_fiscal"

    id = Column(Integer, primary_key=True, index=True)
    tasa_iva = Column(Float, default=16.0)  # alicuota general de IVA en Venezuela


class FacturaCompra(Base):
    """Factura de un proveedor. Alimenta el Libro de Compras y contabiliza sola.

    Es un registro fiscal/contable a nivel de factura completa (no por
    insumo) - separado a proposito de "Registrar compra" en Inventario, que
    solo ajusta el stock de un ingrediente. Una factura puede cubrir varios
    insumos a la vez y el dueno no siempre la carga el mismo dia que compra.
    """

    __tablename__ = "facturas_compra"

    id = Column(Integer, primary_key=True, index=True)
    numero_factura = Column(String, nullable=False)
    proveedor_nombre = Column(String, nullable=False)
    proveedor_rif = Column(String, nullable=True)
    fecha = Column(DateTime, default=ahora)
    categoria = Column(String, default="Insumos")  # Insumos|Servicios|Activos|Otros
    forma_pago = Column(String, default="Efectivo")  # Efectivo|Banco|Credito
    base_imponible = Column(Float, nullable=False)
    iva = Column(Float, default=0)
    descripcion = Column(String, default="")

    @property
    def total(self):
        return round(self.base_imponible + self.iva, 2)

    items = relationship("FacturaCompraItem", back_populates="factura", cascade="all, delete-orphan")


class FacturaCompraItem(Base):
    """Un renglon de la factura: X kg de tal insumo a tal precio.

    Es la pieza que unifica Compras con Inventario. Antes eran dos mundos
    separados (cargabas la factura para el libro fiscal por un lado, y le
    sumabas stock a un insumo por otro, a mano, sin que se hablaran). Con
    renglones, una sola factura hace las dos cosas: alimenta el Libro de
    Compras Y actualiza el stock/costo promedio del insumo, con la MISMA
    base imponible (sin IVA) en ambos lados - asi el costo de receta nunca
    queda inflado con el IVA, que no es un costo real sino credito fiscal.
    """

    __tablename__ = "factura_compra_items"

    id = Column(Integer, primary_key=True, index=True)
    factura_id = Column(Integer, ForeignKey("facturas_compra.id"), nullable=False)
    ingrediente_id = Column(Integer, ForeignKey("ingredientes.id"), nullable=False)
    cantidad = Column(Float, nullable=False)
    costo_unitario = Column(Float, nullable=False)  # precio pagado por 1 unidad de medida, SIN IVA

    factura = relationship("FacturaCompra", back_populates="items")
    ingrediente = relationship("Ingrediente")

    @property
    def subtotal(self):
        return round(self.cantidad * self.costo_unitario, 2)


class CierreCaja(Base):
    __tablename__ = "cierres_caja"

    id = Column(Integer, primary_key=True, index=True)
    fecha = Column(DateTime, default=ahora)
    total_sistema = Column(Float, nullable=False)
    efectivo_esperado = Column(Float, nullable=False)
    efectivo_contado = Column(Float, nullable=False)
    diferencia = Column(Float, nullable=False)
    nota = Column(String, default="")


class CuentaContable(Base):
    """Plan de cuentas. Estructura minima tipo Odoo: codigo, tipo, naturaleza.

    `naturaleza` decide de que lado crece la cuenta: una cuenta deudora (activo,
    costo, gasto) aumenta con debitos; una acreedora (pasivo, patrimonio,
    ingreso) aumenta con creditos. Sin esto no se puede calcular un saldo.
    """

    __tablename__ = "cuentas_contables"

    id = Column(Integer, primary_key=True, index=True)
    codigo = Column(String, unique=True, nullable=False)
    nombre = Column(String, nullable=False)
    tipo = Column(String, nullable=False)  # activo|pasivo|patrimonio|ingreso|costo|gasto
    naturaleza = Column(String, nullable=False)  # deudora|acreedora
    activa = Column(Boolean, default=True)


class AsientoContable(Base):
    """Un asiento de diario: uno o mas movimientos que deben cuadrar (debe=haber).

    `origen` y `referencia_id` trazan el asiento hasta el documento que lo
    genero (una venta, un gasto...) para poder auditar de donde salio cada
    numero sin adivinar.
    """

    __tablename__ = "asientos_contables"

    id = Column(Integer, primary_key=True, index=True)
    fecha = Column(DateTime, default=ahora)
    descripcion = Column(String, nullable=False)
    origen = Column(String, default="manual")  # manual|venta|compra_insumo|gasto|merma
    referencia_id = Column(Integer, nullable=True)

    movimientos = relationship(
        "MovimientoContable", back_populates="asiento", cascade="all, delete-orphan"
    )


class MovimientoContable(Base):
    __tablename__ = "movimientos_contables"

    id = Column(Integer, primary_key=True, index=True)
    asiento_id = Column(Integer, ForeignKey("asientos_contables.id"), nullable=False)
    cuenta_id = Column(Integer, ForeignKey("cuentas_contables.id"), nullable=False)
    debe = Column(Float, default=0)
    haber = Column(Float, default=0)

    asiento = relationship("AsientoContable", back_populates="movimientos")
    cuenta = relationship("CuentaContable")


class Pedido(Base):
    __tablename__ = "pedidos"

    id = Column(Integer, primary_key=True, index=True)
    numero = Column(Integer, nullable=False)
    estado = Column(String, default="pendiente")  # pendiente | listo | pagado | anulado
    nota = Column(String, default="")
    metodo_pago = Column(String, nullable=True)
    creado_en = Column(DateTime, default=ahora)
    cerrado_en = Column(DateTime, nullable=True)
    # Tasa BCV vigente al momento de cobrar. Se congela igual que el costo de
    # insumos: si manana la tasa se mueve, el reporte de ayer sigue mostrando
    # los bolivares que de verdad entraron en la gaveta.
    tasa_bcv = Column(Float, nullable=True)
    # No todas las ventas se facturan - el dueno decide cual factura a mano al
    # cobrar. Solo las facturadas cuentan para el SENIAT (Libro de Ventas e
    # IVA debito fiscal); las demas quedan igual que hoy, sin IVA.
    facturado = Column(Boolean, default=False)
    numero_factura = Column(String, nullable=True)
    # Igual que tasa_bcv: se congela la tasa de IVA del dia para que el Libro
    # de Ventas de un mes cerrado no cambie si despues sube la alicuota.
    tasa_iva = Column(Float, nullable=True)

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
