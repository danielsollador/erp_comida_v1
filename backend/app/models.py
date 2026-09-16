from sqlalchemy import Boolean, Column, Date, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from .database import Base
from .timeutils import ahora


class Operador(Base):
    """Quien esta en la caja. No es seguridad, es trazabilidad.

    El sistema era completamente anonimo: un pedido anulado, un precio
    cambiado, plata retirada de la gaveta - nada tenia nombre detras. Para un
    dueno que no esta siempre en el local ese era el hueco mas grande, y ademas
    empeoraba todo lo demas: un cierre mal contado no solo no se podia
    corregir, tampoco se sabia quien lo hizo.

    Sin contrasenas a proposito: en un mostrador con una tablet compartida, un
    login con clave se convierte en "todos usan el del dueno". Se elige quien
    esta en el turno y queda registrado; el control real es que el dueno pueda
    ver despues quien hizo que.
    """

    __tablename__ = "operadores"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    rol = Column(String, default="cajero")  # cajero | dueno
    activo = Column(Boolean, default=True)
    # En que punto de venta esta: el local tiene dos pisos y dos gavetas.
    punto_venta = Column(String, default="")


class PuntoVenta(Base):
    """Una caja fisica. El local tiene dos pisos y dos gavetas.

    Con un solo `efectivo_esperado` y un solo cierre por dia, la caja del piso
    2 no podia cuadrar ni cerrar lo suyo: si faltaba plata no habia forma de
    saber en cual gaveta.
    """

    __tablename__ = "puntos_venta"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    activo = Column(Boolean, default=True)


class Categoria(Base):
    __tablename__ = "categorias"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    orden = Column(Integer, default=0)
    # Se desactiva, no se borra: igual que producto y variante. Borrarla en
    # duro arrastraba sus productos por cascade y dejaba las ventas historicas
    # apuntando a variantes inexistentes (419 filas huerfanas en la prueba).
    activo = Column(Boolean, default=True)

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
    unidad = Column(String, nullable=False)  # kg | g | lt | ml | unidad | paquete
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
    # Que es: materia prima que entra en recetas ("insumo") o mercancia que se
    # compra y se vende tal cual ("reventa": el refresco, la botella de agua).
    # Los dos llevan stock, costo y conteo; se separan para poder mirar el
    # deposito por partes y porque el de reventa no tiene rendimiento que
    # medir.
    tipo = Column(String, default="insumo")
    # Un insumo que ya no se compra no se borra: tiene recetas, compras y
    # mermas colgando. Se archiva y deja de aparecer en listas y sugerencias.
    activo = Column(Boolean, default=True)

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


class MovimientoInventario(Base):
    """Una fila por cada vez que un insumo entra o sale. Ver `kardex.py`.

    `stock_actual` en el ingrediente sigue siendo el saldo vivo -se lee mil
    veces al dia y no se va a calcular sumando todo cada vez-, pero deja de
    ser la unica verdad: es la suma de esta tabla. Si los dos no coinciden,
    ahora se puede demostrar cual esta mal y desde cuando.

    El costo va congelado: el promedio del insumo cambia con cada compra, asi
    que preguntarlo manana daria otro numero y el libro dejaria de cuadrar con
    lo que se asento en su momento. Es el mismo criterio que con el precio y
    el costo de una venta.
    """

    __tablename__ = "movimientos_inventario"

    id = Column(Integer, primary_key=True, index=True)
    ingrediente_id = Column(Integer, ForeignKey("ingredientes.id"), nullable=False, index=True)
    fecha = Column(DateTime, default=ahora, index=True)
    tipo = Column(String, nullable=False)  # ver kardex.py
    # Con signo: positiva entra, negativa sale.
    cantidad = Column(Float, nullable=False)
    # A como se movio ESTA cantidad: el precio de esta compra, el costo al que
    # salio esta venta.
    costo_unitario = Column(Float, default=0)
    valor = Column(Float, default=0)
    # El promedio ponderado del insumo DESPUES de este movimiento. Es distinto
    # del de arriba y hace falta para valorar existencias a una fecha pasada
    # con el mismo criterio que usa la contabilidad. Sin esto, el inventario
    # valorizado y la cuenta 1040 daban numeros parecidos pero distintos, y
    # "parecido" en contabilidad es estar mal.
    costo_promedio = Column(Float, default=0)
    # Existencia que quedo despues de este movimiento. Guardarla permite leer
    # el extracto sin recalcular, igual que la libreta del banco.
    saldo = Column(Float, default=0)
    # De donde vino: "pedido", "compra_suelta", "factura", "merma"... con el id
    # de ese registro, para poder ir hasta el documento.
    origen = Column(String, default="")
    referencia_id = Column(Integer, nullable=True)
    operador_id = Column(Integer, ForeignKey("operadores.id"), nullable=True)
    nota = Column(String, default="")

    ingrediente = relationship("Ingrediente")


class RecetaItem(Base):
    __tablename__ = "receta_items"

    id = Column(Integer, primary_key=True, index=True)
    variante_id = Column(Integer, ForeignKey("variantes.id"), nullable=False)
    ingrediente_id = Column(Integer, ForeignKey("ingredientes.id"), nullable=False)
    cantidad_por_unidad = Column(Float, nullable=False)  # cuanto insumo consume 1 unidad vendida

    variante = relationship("Variante")
    ingrediente = relationship("Ingrediente")


class CambioReceta(Base):
    """Historial de como cambio la receta de un producto.

    Los precios de venta si tenian historial (CambioPrecio) pero las recetas
    no, asi que no habia como responder "por que cambio mi costo en marzo".
    Se guarda la composicion completa, no el delta: es lo que permite
    reconstruir el costo de una epoca sin ir sumando diferencias.
    """

    __tablename__ = "cambios_receta"

    id = Column(Integer, primary_key=True, index=True)
    variante_id = Column(Integer, ForeignKey("variantes.id"), nullable=False)
    # "Queso 0.1 kg; Harina 0.05 kg" - legible, para que el dueno lo entienda.
    composicion = Column(String, default="")
    costo_resultante = Column(Float, default=0)
    fecha = Column(DateTime, default=ahora)
    operador_id = Column(Integer, ForeignKey("operadores.id"), nullable=True)


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
    # De donde salio la plata. Sin esto un sueldo pagado por transferencia
    # bajaba igual el efectivo esperado del cierre de caja.
    metodo_pago = Column(String, default="Efectivo")  # Efectivo | Banco
    fecha = Column(DateTime, default=ahora)
    operador_id = Column(Integer, ForeignKey("operadores.id"), nullable=True)


class RetiroPropietario(Base):
    """Plata que el dueno saca del negocio para el.

    En un local chico esto pasa casi todos los dias y no habia donde
    registrarlo: o la caja acumulaba en los libros mientras la gaveta estaba
    vacia, o se cargaba como Gasto y hacia ver al negocio menos rentable de lo
    que es. No es gasto, es capital que sale.
    """

    __tablename__ = "retiros_propietario"

    id = Column(Integer, primary_key=True, index=True)
    monto = Column(Float, nullable=False)
    metodo_pago = Column(String, default="Efectivo")  # Efectivo | Banco
    nota = Column(String, default="")
    fecha = Column(DateTime, default=ahora)
    operador_id = Column(Integer, ForeignKey("operadores.id"), nullable=True)


class AbonoFiado(Base):
    """Un pago parcial contra una venta fiada.

    Antes el fiado solo tenia dos estados: se debe todo o no se debe nada. En
    la calle no funciona asi -la senora abona 5 el martes y 3 el viernes-, y
    sin donde anotarlo la cajera terminaba cobrando el total de golpe o, peor,
    llevando la cuenta en un cuaderno aparte que los libros no ven.

    Cada abono es un hecho con su fecha y su forma de pago, no un booleano:
    por eso son filas y no una columna `abonado` en el pedido. Lo que se debe
    hoy se calcula restando estos abonos al monto fiado.
    """

    __tablename__ = "abonos_fiado"

    id = Column(Integer, primary_key=True, index=True)
    pedido_id = Column(Integer, ForeignKey("pedidos.id"), nullable=False, index=True)
    monto = Column(Float, nullable=False)
    metodo_pago = Column(String, default="Efectivo Bs")
    fecha = Column(DateTime, default=ahora)
    operador_id = Column(Integer, ForeignKey("operadores.id"), nullable=True)

    pedido = relationship("Pedido", back_populates="abonos")


class DeclaracionIva(Base):
    """Declaracion mensual de IVA ya presentada al SENIAT.

    Sin esto las dos cuentas de IVA solo crecian: el balance decia que el
    negocio debia todo el debito acumulado desde siempre y tenia a favor todo
    el credito, cuando los meses cerrados ya estaban declarados y pagados.

    El excedente de credito fiscal (cuando se compro mas de lo que se facturo)
    se arrastra al mes siguiente, que es como funciona de verdad.
    """

    __tablename__ = "declaraciones_iva"

    id = Column(Integer, primary_key=True, index=True)
    anio = Column(Integer, nullable=False)
    mes = Column(Integer, nullable=False)
    iva_debito = Column(Float, default=0)  # cobrado en ventas facturadas del mes
    iva_credito = Column(Float, default=0)  # pagado en compras del mes
    credito_arrastrado = Column(Float, default=0)  # excedente que venia del mes anterior
    credito_usado = Column(Float, default=0)
    iva_a_pagar = Column(Float, default=0)
    credito_excedente = Column(Float, default=0)  # lo que pasa al mes siguiente
    fecha_declaracion = Column(DateTime, default=ahora)
    pagada = Column(Boolean, default=False)
    fecha_pago = Column(DateTime, nullable=True)
    forma_pago = Column(String, nullable=True)  # Efectivo | Banco

    @property
    def periodo(self):
        return f"{self.anio}-{self.mes:02d}"


class ActivoFijo(Base):
    """Un bien que se usa por años: nevera, horno, mesas, la tablet.

    Se crea solo al cargar una factura de categoria Activos. Sin esto, la
    compra entraba a 1050 y se quedaba ahi para siempre: el balance mostraba
    una nevera de cinco años valiendo lo mismo que el dia que se compro, y el
    desgaste nunca llegaba al estado de resultados.
    """

    __tablename__ = "activos_fijos"

    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String, nullable=False)
    valor = Column(Float, nullable=False)  # costo sin IVA, que es lo que se deprecia
    fecha_compra = Column(DateTime, default=ahora)
    vida_util_meses = Column(Integer, default=60)  # 5 años es lo tipico para equipo de cocina
    factura_id = Column(Integer, ForeignKey("facturas_compra.id"), nullable=True)
    dado_de_baja = Column(Boolean, default=False)
    fecha_baja = Column(DateTime, nullable=True)
    motivo_baja = Column(String, default="")

    @property
    def cuota_mensual(self):
        if not self.vida_util_meses:
            return 0.0
        return round(self.valor / self.vida_util_meses, 2)


class CambioPrecio(Base):
    """Cada vez que se mueve el precio de venta de una variante.

    Con inflacion los precios se tocan seguido y hoy no quedaba rastro de
    cuando ni de cuanto: `Variante.precio` se sobrescribia y listo. Sirve para
    responder "subi el precio, que paso con las ventas" y como control basico,
    ya que cualquiera con la tablet puede cambiarlos.
    """

    __tablename__ = "cambios_precio"

    id = Column(Integer, primary_key=True, index=True)
    variante_id = Column(Integer, ForeignKey("variantes.id"), nullable=False)
    precio_anterior = Column(Float, nullable=False)
    precio_nuevo = Column(Float, nullable=False)
    fecha = Column(DateTime, default=ahora)

    variante = relationship("Variante")


class CompraSuelta(Base):
    """Compra de insumo sin factura de proveedor (el mandado del dia).

    Existe para que cada entrada de inventario tenga su propio registro al que
    apuntar desde el asiento contable. Las compras con factura viven en
    FacturaCompraItem; esta es la via informal, que el negocio usa igual.
    """

    __tablename__ = "compras_sueltas"

    id = Column(Integer, primary_key=True, index=True)
    ingrediente_id = Column(Integer, ForeignKey("ingredientes.id"), nullable=False)
    cantidad = Column(Float, nullable=False)
    costo_unitario = Column(Float, nullable=False)
    fecha = Column(DateTime, default=ahora)

    ingrediente = relationship("Ingrediente")


class Merma(Base):
    __tablename__ = "mermas"

    id = Column(Integer, primary_key=True, index=True)
    ingrediente_id = Column(Integer, ForeignKey("ingredientes.id"), nullable=False)
    cantidad = Column(Float, nullable=False)
    motivo = Column(String, default="")
    # Una merma mal cargada se revierte con un asiento de reverso, no se borra:
    # el error queda documentado igual que en Compras.
    revertida = Column(Boolean, default=False)
    # Esta merma salio de un CONTEO, no de un accidente. Las dos bajan el
    # stock y las dos llevan asiento, pero son dos problemas distintos: una
    # dice "se nos cayo al piso" y la otra "el sistema estaba mal". Mezcladas
    # en el informe de perdidas, el ajuste de un conteo se lee como si se
    # hubiera botado comida, y el numero deja de servir para decidir nada.
    por_conteo = Column(Boolean, default=False)
    fecha = Column(DateTime, default=ahora)
    operador_id = Column(Integer, ForeignKey("operadores.id"), nullable=True)

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
    # Solo relevante para forma_pago="Credito": Efectivo/Banco se dan por
    # pagadas al momento de cargarlas, porque la plata ya salio ahi mismo.
    pagada = Column(Boolean, default=True)
    fecha_vencimiento = Column(DateTime, nullable=True)
    fecha_pago = Column(DateTime, nullable=True)

    @property
    def total(self):
        return round(self.base_imponible + self.iva, 2)

    items = relationship("FacturaCompraItem", back_populates="factura", cascade="all, delete-orphan")
    notas_credito = relationship(
        "NotaCreditoCompra", back_populates="factura", cascade="all, delete-orphan"
    )

    @property
    def base_neta(self) -> float:
        """Base imponible despues de las notas de credito del proveedor.

        Es la que va al Libro de Compras: declarar la base bruta seria deducir
        credito fiscal que ya no corresponde.
        """
        return round(self.base_imponible - sum(n.base_imponible or 0 for n in self.notas_credito), 2)

    @property
    def iva_neto(self) -> float:
        return round(self.iva - sum(n.iva or 0 for n in self.notas_credito), 2)

    @property
    def total_neto(self) -> float:
        return round(self.base_neta + self.iva_neto, 2)


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
    operador_id = Column(Integer, ForeignKey("operadores.id"), nullable=True)
    punto_venta_id = Column(Integer, ForeignKey("puntos_venta.id"), nullable=True)
    # Un digito de mas al contar (1000 en vez de 100) metia un sobrante
    # ficticio en los libros para siempre: no habia borrar ni volver a cerrar.
    # El cierre no se borra - se anula con su contra-asiento y queda el rastro
    # de que hubo un error, que es lo que un libro contable debe mostrar.
    anulado = Column(Boolean, default=False)
    fecha_anulacion = Column(DateTime, nullable=True)
    motivo_anulacion = Column(String, default="")
    # La segunda gaveta: billetes verdes. Se cuenta aparte porque es otra
    # moneda; los campos de arriba siguen siendo los bolivares.
    divisas_esperado = Column(Float, default=0)
    divisas_contado = Column(Float, default=0)
    divisas_diferencia = Column(Float, default=0)
    # Quien conto y que gaveta cerro. Con dos pisos son dos cierres distintos.
    operador_id = Column(Integer, ForeignKey("operadores.id"), nullable=True)
    punto_venta_id = Column(Integer, ForeignKey("puntos_venta.id"), nullable=True)

    operador_rel = relationship("Operador")
    punto_venta_rel = relationship("PuntoVenta")

    @property
    def operador(self) -> str:
        return self.operador_rel.nombre if self.operador_rel else ""

    @property
    def punto_venta(self) -> str:
        return self.punto_venta_rel.nombre if self.punto_venta_rel else ""


class SobranteInventario(Base):
    """Conteo fisico que encontro MAS mercancia de la que decia el sistema.

    El faltante ya tenia su fila (Merma) y por lo tanto su boton de revertir;
    el sobrante solo generaba un asiento referenciado por `ingrediente_id`, sin
    fila propia. Eso dejaba dos agujeros: no habia como deshacer un conteo mal
    tecleado hacia arriba, y dos sobrantes del mismo insumo compartian
    referencia contable (el mismo bug que ya se corrigio en compras sueltas).
    """

    __tablename__ = "sobrantes_inventario"

    id = Column(Integer, primary_key=True, index=True)
    ingrediente_id = Column(Integer, ForeignKey("ingredientes.id"), nullable=False)
    cantidad = Column(Float, nullable=False)
    motivo = Column(String, default="")
    fecha = Column(DateTime, default=ahora)
    revertido = Column(Boolean, default=False)

    ingrediente = relationship("Ingrediente")


class NotaCreditoCompra(Base):
    """Nota de credito del proveedor contra una factura de compra.

    Espejo de la devolucion de venta. Son dos casos distintos y el asiento
    cambia con cada uno:

      - devolucion: la mercancia vuelve al proveedor (te mando 8 de 10). Sale
        stock y sale valor; el costo por unidad no se mueve.
      - descuento: te quedas la mercancia y te rebajan el precio. El stock no
        se toca, baja el valor, y el costo por unidad BAJA.

    Sin esto, el Libro de Compras seguia declarando credito fiscal que ya no
    corresponde (deduccion indebida ante el SENIAT) y `2010 Cuentas por pagar`
    le hacia pagar de mas al proveedor.
    """

    __tablename__ = "notas_credito_compra"

    id = Column(Integer, primary_key=True, index=True)
    factura_id = Column(Integer, ForeignKey("facturas_compra.id"), nullable=False)
    numero = Column(String, nullable=False)  # el numero que emitio el proveedor
    tipo = Column(String, nullable=False)  # devolucion | descuento
    fecha = Column(DateTime, default=ahora)
    base_imponible = Column(Float, nullable=False)
    iva = Column(Float, default=0)
    motivo = Column(String, default="")

    factura = relationship("FacturaCompra", back_populates="notas_credito")
    items = relationship(
        "NotaCreditoCompraItem", back_populates="nota", cascade="all, delete-orphan"
    )

    @property
    def total(self) -> float:
        return round((self.base_imponible or 0) + (self.iva or 0), 2)


class NotaCreditoCompraItem(Base):
    """Renglon de la nota de credito: cuanto de cada insumo se devuelve.

    Solo aplica al tipo `devolucion`; un descuento no mueve cantidades.
    """

    __tablename__ = "nota_credito_compra_items"

    id = Column(Integer, primary_key=True, index=True)
    nota_id = Column(Integer, ForeignKey("notas_credito_compra.id"), nullable=False)
    ingrediente_id = Column(Integer, ForeignKey("ingredientes.id"), nullable=False)
    cantidad = Column(Float, nullable=False)
    costo_unitario = Column(Float, nullable=False)

    nota = relationship("NotaCreditoCompra", back_populates="items")
    ingrediente = relationship("Ingrediente")


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
    # El cliente trajo la comida de vuelta y se le devolvio la plata. La venta
    # se revierte entera: deja de contar como ingreso, deja de deber IVA y sale
    # del Libro de Ventas. Si estaba facturada, el numero de la nota de credito
    # que el dueno emitio a mano.
    devuelto = Column(Boolean, default=False)
    fecha_devolucion = Column(DateTime, nullable=True)
    nota_credito = Column(String, nullable=True)
    motivo_devolucion = Column(String, default="")
    # Rebaja concedida a ESTE cliente. Antes la unica via era bajarle el precio
    # al menu, que se lo bajaba a todos y ademas dejaba la base imponible del
    # IVA sobre un precio que no se cobro.
    descuento = Column(Float, default=0)
    motivo_descuento = Column(String, default="")
    # Plata del empleado que pasa por la gaveta. No es ingreso del negocio: va
    # a un pasivo (2040) hasta que se le entrega.
    propina = Column(Float, default=0)
    # Para el fiado: a quien se le dio. Sin nombre no hay a quien cobrarle.
    # Idempotencia: la clave que genero el POS para ESTE intento de pedido.
    # Si la tablet manda la comanda y la respuesta se pierde en el camino (la
    # wifi del local se cae a media cuadra del router), la cajera le da otra
    # vez y saldrian dos comandas iguales a cocina. Con la misma clave, el
    # segundo intento devuelve el pedido que ya existe en vez de crear otro.
    clave_cliente = Column(String, nullable=True, unique=True, index=True)
    cliente = Column(String, default="")
    fiado_saldado = Column(Boolean, default=False)
    fecha_cobro_fiado = Column(DateTime, nullable=True)
    # Quien lo cobro y desde que caja. Sin esto no habia forma de saber quien
    # anulo un pedido ni cuanto entro por cada gaveta con dos tablets.
    operador_id = Column(Integer, ForeignKey("operadores.id"), nullable=True)
    punto_venta_id = Column(Integer, ForeignKey("puntos_venta.id"), nullable=True)
    anulado_por_id = Column(Integer, ForeignKey("operadores.id"), nullable=True)

    items = relationship("PedidoItem", back_populates="pedido", cascade="all, delete-orphan")
    operador_rel = relationship("Operador", foreign_keys=[operador_id])
    anulado_por_rel = relationship("Operador", foreign_keys=[anulado_por_id])
    punto_venta_rel = relationship("PuntoVenta")

    # Nombres para la pantalla. Se exponen como texto para que el historico
    # siga legible aunque despues se desactive al operador.
    @property
    def operador(self) -> str:
        return self.operador_rel.nombre if self.operador_rel else ""

    @property
    def anulado_por(self) -> str:
        return self.anulado_por_rel.nombre if self.anulado_por_rel else ""

    @property
    def punto_venta(self) -> str:
        return self.punto_venta_rel.nombre if self.punto_venta_rel else ""
    consumos = relationship("PedidoConsumo", cascade="all, delete-orphan")
    pagos = relationship("PagoPedido", cascade="all, delete-orphan")
    abonos = relationship(
        "AbonoFiado", back_populates="pedido", cascade="all, delete-orphan",
        order_by="AbonoFiado.fecha",
    )

    @property
    def total(self):
        """Lo que el cliente paga por la comida, ya con el descuento aplicado.

        La propina NO entra aca: no es venta del negocio sino plata del
        empleado que pasa por la gaveta (ver `2040 Propinas por entregar`).
        """
        return round(max(self.subtotal - (self.descuento or 0), 0), 2)

    @property
    def subtotal(self):
        """Precio de lista, antes de descuentos. Es la venta bruta."""
        return round(sum(item.precio_unitario * item.cantidad for item in self.items), 2)

    @property
    def a_cobrar(self):
        """Lo que se recibe en la gaveta: la comida mas la propina."""
        return round(self.total + (self.propina or 0), 2)

    @property
    def fiado_monto(self):
        """Cuanto de este pedido quedo a credito."""
        return round(sum(p.monto for p in self.pagos if p.metodo == "Fiado"), 2)

    @property
    def fiado_abonado(self):
        return round(sum(a.monto for a in self.abonos), 2)

    @property
    def fiado_saldo(self):
        """Lo que el cliente debe HOY. Una sola definicion para todos: la
        pantalla de cuentas por cobrar, el cobro y los libros preguntaban lo
        mismo y cada uno lo sumaba por su cuenta."""
        return round(max(self.fiado_monto - self.fiado_abonado, 0), 2)


class PagoPedido(Base):
    """Cada forma en que se pago un pedido, con su monto.

    Un cliente que da $5 en efectivo y el resto por pago movil es cosa de todos
    los dias. Con un solo campo de texto habia que elegir uno y mentir: los
    $15 completos entraban a Caja y el cierre mostraba un faltante de $10 que
    no existia.
    """

    __tablename__ = "pagos_pedido"

    id = Column(Integer, primary_key=True, index=True)
    pedido_id = Column(Integer, ForeignKey("pedidos.id"), nullable=False)
    metodo = Column(String, nullable=False)  # ver contabilidad.CUENTA_POR_METODO_PAGO
    monto = Column(Float, nullable=False)
    # Lo que el cliente entrego de verdad. Con un billete de $20 por una compra
    # de $10 entran $20 a la gaveta y salen $10: si solo se registra el monto,
    # el arqueo nunca cuadra. Y si el vuelto se da en otra moneda (pago en
    # divisas, vuelto en bolivares) el movimiento entre las dos cajas no
    # quedaba en ninguna parte.
    recibido = Column(Float, nullable=True)
    vuelto_metodo = Column(String, nullable=True)
    vuelto_monto = Column(Float, default=0)


class PedidoConsumo(Base):
    """Lo que de verdad salio del inventario por este pedido.

    Se congela al crear la comanda, igual que el precio y el costo. Recalcular
    desde la receta al anular daba numeros distintos si la receta habia
    cambiado mientras tanto: se devolvia mas (o menos) de lo que se habia
    descontado, y aparecia inventario de la nada.
    """

    __tablename__ = "pedido_consumos"

    id = Column(Integer, primary_key=True, index=True)
    pedido_id = Column(Integer, ForeignKey("pedidos.id"), nullable=False)
    ingrediente_id = Column(Integer, ForeignKey("ingredientes.id"), nullable=False)
    cantidad = Column(Float, nullable=False)  # cantidad bruta, ya ajustada por rendimiento

    ingrediente = relationship("Ingrediente")


class PedidoItem(Base):
    __tablename__ = "pedido_items"

    id = Column(Integer, primary_key=True, index=True)
    pedido_id = Column(Integer, ForeignKey("pedidos.id"), nullable=False)
    # Nullable para la venta libre: el encargo especial, el combo armado a mano,
    # el producto de temporada. Antes habia que crearlo en el menu para poder
    # cobrarlo, y ahi se quedaba para siempre ensuciando el catalogo - lo que
    # en la practica empujaba a no registrar la venta.
    variante_id = Column(Integer, ForeignKey("variantes.id"), nullable=True)
    nombre = Column(String, nullable=False)
    precio_unitario = Column(Float, nullable=False)
    # Costo de insumos congelado al momento de la venta: si manana sube el queso,
    # los reportes de meses pasados siguen mostrando el margen real de entonces.
    costo_unitario = Column(Float, default=0)
    cantidad = Column(Integer, default=1)
    nota = Column(String, default="")
    preparado = Column(Boolean, default=False)

    pedido = relationship("Pedido", back_populates="items")
