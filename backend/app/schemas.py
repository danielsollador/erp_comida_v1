import datetime
from typing import List, Optional, Literal

from pydantic import BaseModel, Field


class OperadorCreate(BaseModel):
    nombre: str
    rol: str = "cajero"  # cajero | dueno
    punto_venta: str = ""


class Operador(OperadorCreate):
    id: int
    activo: bool = True

    class Config:
        from_attributes = True


class PuntoVentaCreate(BaseModel):
    nombre: str


class PuntoVenta(PuntoVentaCreate):
    id: int
    activo: bool = True

    class Config:
        from_attributes = True


class VarianteBase(BaseModel):
    nombre: str
    precio: float
    activo: bool = True


class VarianteCreate(VarianteBase):
    pass


class Variante(VarianteBase):
    id: int
    producto_id: int

    class Config:
        from_attributes = True


class CambioPrecio(BaseModel):
    id: int
    variante_id: int
    precio_anterior: float
    precio_nuevo: float
    fecha: datetime.datetime

    class Config:
        from_attributes = True


class CostoVariante(BaseModel):
    variante_id: int
    costo: Optional[float] = None  # None = sin receta cargada
    margen_pct: Optional[float] = None
    sin_receta: bool = False
    # Lo que costaria producirlo con los precios de HOY (ultimo costo pagado
    # por cada insumo), no con el promedio ponderado. En un pais con inflacion
    # el margen que importa para fijar precios es este, no el contable.
    costo_reposicion: Optional[float] = None
    margen_reposicion_pct: Optional[float] = None
    # A cuanto habria que venderlo para conservar el margen contable actual.
    precio_sugerido: Optional[float] = None


class ProductoBase(BaseModel):
    nombre: str
    categoria_id: int
    activo: bool = True


class ProductoCreate(ProductoBase):
    variantes: List[VarianteCreate] = []


class Producto(ProductoBase):
    id: int
    variantes: List[Variante] = []

    class Config:
        from_attributes = True


class CategoriaBase(BaseModel):
    nombre: str
    orden: int = 0
    activo: bool = True


class CategoriaCreate(CategoriaBase):
    pass


class Categoria(CategoriaBase):
    id: int
    productos: List[Producto] = []

    class Config:
        from_attributes = True


class IngredienteBase(BaseModel):
    nombre: str
    unidad: str
    stock_actual: float = 0
    stock_minimo: float = 0
    stock_objetivo: float = 0
    costo_unitario: float = 0
    # % utilizable despues de preparar (100 = sin merma de cocina). Fuera de
    # (0, 100] no tiene sentido fisico: 0 o negativo es "no rinde nada" y mas
    # de 100 diria que sale mas producto util del que se compro.
    rendimiento_pct: float = Field(default=100, gt=0, le=100)
    # Materia prima de recetas, o mercancia de reventa (ver models.Ingrediente).
    tipo: Literal["insumo", "reventa"] = "insumo"
    # False = archivado: sigue existiendo (recetas, historial) pero no se lista
    # para comprar ni entra en las sugerencias.
    activo: bool = True
    # Exento de IVA (la mayoria de alimentos basicos en Venezuela lo son). Del
    # insumo, no de la factura: la harina es exenta la compre a quien la
    # compre.
    exento: bool = False


class IngredienteCreate(IngredienteBase):
    pass


class Ingrediente(IngredienteBase):
    id: int
    costo_efectivo: float  # costo_unitario / rendimiento - lo que de verdad cuesta 1 unidad usable
    # Ultimo precio pagado por este insumo. El `costo_unitario` de arriba es el
    # promedio ponderado (lo que costo lo que hay en el deposito); esto es lo
    # que cuesta REPONERLO hoy. Se separan porque responden preguntas distintas.
    costo_reposicion: Optional[float] = None
    ultima_compra: Optional[datetime.datetime] = None
    # Cuanto subestima el promedio al costo de reponer, en %.
    variacion_pct: Optional[float] = None

    class Config:
        from_attributes = True


class CompraDeInsumo(BaseModel):
    fecha: datetime.datetime
    cantidad: float
    costo_unitario: float
    origen: str  # factura | compra suelta
    referencia: str = ""


class ImpactoEnProducto(BaseModel):
    variante_id: int
    nombre: str
    precio: float
    costo_antes: float
    costo_despues: float
    margen_antes_pct: Optional[float] = None
    margen_despues_pct: Optional[float] = None
    precio_sugerido: Optional[float] = None
    a_perdida: bool = False
    margen_flaco: bool = False


class ImpactoDeCompra(BaseModel):
    """Lo que hay que decirle al dueno EN EL MOMENTO de registrar la compra."""

    ingrediente: Ingrediente
    costo_anterior: float
    costo_pagado: float
    salto_pct: Optional[float] = None
    # True si el salto es lo bastante grande como para revisar precios.
    revisar_precios: bool = False
    # Aviso cuando el salto parece error de unidad (un saco tecleado como 1)
    # en vez de subida de precio. None = el salto es creible.
    posible_error_de_unidad: Optional[str] = None
    productos: List[ImpactoEnProducto] = []


class InsumoInflacion(BaseModel):
    ingrediente_id: int
    nombre: str
    costo_inicial: float
    costo_actual: float
    cambio_pct: float


class InflacionInsumos(BaseModel):
    dias: int
    cambio_pct: float
    insumos: List[InsumoInflacion] = []


class MovimientoInventario(BaseModel):
    """Una linea del extracto de un insumo."""

    id: int
    fecha: datetime.datetime
    tipo: str
    etiqueta: str          # "Venta", "Merma"... en palabras del local
    cantidad: float        # con signo: positiva entra, negativa sale
    costo_unitario: float
    valor: float
    saldo: float           # existencia que quedo despues
    origen: str
    referencia_id: Optional[int] = None
    operador: Optional[str] = None
    nota: str = ""

    class Config:
        from_attributes = True


class RenglonPorTipo(BaseModel):
    """Cuanto entro (o salio) por un motivo, en el periodo que se mira."""

    tipo: str
    etiqueta: str
    cantidad: float        # siempre positiva: el lado lo dice en que lista va
    valor: float
    movimientos: int


class ExtractoInsumo(BaseModel):
    ingrediente_id: int
    nombre: str
    unidad: str
    stock_actual: float
    # Lo que suman los movimientos. Si no coincide con `stock_actual`, alguien
    # escribio el stock sin pasar por el kardex y hay que saberlo.
    saldo_segun_libro: float
    cuadra: bool
    # El extracto empieza en lo que habia antes del primer movimiento que se
    # muestra: sin eso, un extracto filtrado por fechas arranca en el aire y
    # no se puede comprobar que saldo_inicial + entradas - salidas = final.
    saldo_inicial: float
    saldo_final: float
    entradas: List[RenglonPorTipo]
    salidas: List[RenglonPorTipo]
    total_entradas: float
    total_salidas: float
    movimientos: List[MovimientoInventario]


class ExistenciaEnFecha(BaseModel):
    ingrediente_id: int
    nombre: str
    unidad: str
    cantidad: float
    costo_unitario: float
    valor: float


class InventarioEnFecha(BaseModel):
    """Cuanto habia y cuanto valia el inventario en una fecha."""

    fecha: datetime.datetime
    total: float
    insumos: List[ExistenciaEnFecha]


class ConsumoDeInsumo(BaseModel):
    ingrediente_id: int
    nombre: str
    unidad: str
    por_dia: float
    dias_de_stock: Optional[float] = None  # None = no se consume, no se agota


class ComprarIngredienteRequest(BaseModel):
    cantidad: float
    costo_total: Optional[float] = None  # si se informa, actualiza el costo unitario
    # De donde salio la plata: Efectivo Bs | Efectivo $ | Banco (y sinonimos de
    # contabilidad.METODOS_DE_PAGO). Salia siempre de la gaveta de bolivares.
    metodo_pago: str = "Efectivo Bs"


class MermaRequest(BaseModel):
    cantidad: float
    motivo: str = ""
    operador_id: Optional[int] = None


class Merma(BaseModel):
    id: int
    ingrediente_id: int
    ingrediente_nombre: str
    unidad: str
    cantidad: float
    valor: float
    motivo: str
    fecha: datetime.datetime
    revertida: bool
    # Salio de un conteo, no de un accidente. Las dos bajan el stock, pero
    # "el sistema estaba mal" y "se cayo al piso" son dos problemas distintos
    # y sumarlos en el mismo informe de perdidas no deja decidir nada.
    por_conteo: bool = False

    class Config:
        from_attributes = True


class SobranteInventario(BaseModel):
    """Conteo que encontro mas mercancia de la que decia el sistema.

    Espejo de la merma, para que el mismo error de tecleo tenga vuelta atras
    en las dos direcciones.
    """

    id: int
    ingrediente_id: int
    ingrediente_nombre: str
    unidad: str
    cantidad: float
    valor: float
    motivo: str
    fecha: datetime.datetime
    revertido: bool

    class Config:
        from_attributes = True


class AjusteStockRequest(BaseModel):
    stock_real: float
    motivo: str = "Conteo fisico"


class ConteoItem(BaseModel):
    ingrediente_id: int
    stock_real: float = Field(ge=0)


class ConteoRequest(BaseModel):
    """Un conteo fisico completo: lo que la balanza dijo de cada insumo."""

    items: List[ConteoItem]
    motivo: str = "Conteo fisico"
    # Si se conto sin ver en pantalla lo que el sistema esperaba. Lo manda el
    # frontend porque es lo unico que sabe si se ocultaron las columnas.
    ciego: bool = False


class AjusteConteo(BaseModel):
    ingrediente_id: int
    nombre: str
    unidad: str
    sistema: float
    contado: float
    # contado - sistema: negativo es faltante (merma), positivo sobrante.
    diferencia: float
    valor: float


class ResultadoConteo(BaseModel):
    # Solo los que cambiaron: un conteo que cuadra no tiene nada que contar.
    ajustes: List[AjusteConteo]
    faltante_valor: float
    sobrante_valor: float
    sin_cambio: int
    # El documento que quedo guardado, para poder abrirlo despues.
    conteo_id: Optional[int] = None


class ConteoResumen(BaseModel):
    """Una planilla en la lista del historial."""

    id: int
    fecha: datetime.datetime
    motivo: str
    operador: Optional[str] = None
    ciego: bool
    contados: int
    cuadraron: int
    faltante_valor: float
    sobrante_valor: float
    # Lo que costo la diferencia, neto. Es el numero que el dueno persigue.
    neto: float


class ConteoLinea(BaseModel):
    ingrediente_id: int
    nombre: str
    unidad: str
    sistema: float
    contado: float
    diferencia: float
    costo_unitario: float
    valor: float


class ConteoDetalle(ConteoResumen):
    lineas: List[ConteoLinea]


class FilaPlanilla(BaseModel):
    """Un renglon de la planilla en blanco que se lleva al deposito."""

    ingrediente_id: int
    nombre: str
    unidad: str


class FilaLeida(BaseModel):
    """Un renglon que se pudo leer de la planilla llena."""

    ingrediente_id: int
    nombre: str
    unidad: str
    contado: float


class PlanillaLeida(BaseModel):
    """Lo que trajo el archivo, ya cruzado contra el deposito.

    No se guarda nada: esto solo dice que se entendio. El conteo se aplica
    despues por el camino de siempre (`POST /conteo`), que es el que ya sabe
    poner cada diferencia como merma o sobrante con su asiento.
    """

    filas: List[FilaLeida]
    # Lo que no se pudo leer, en palabras, para arreglarlo en el archivo y
    # volver a subirlo. Una planilla con un renglon roto no se rechaza entera:
    # lo demas sirve igual y el dueno decide.
    errores: List[str] = []
    # Renglones sin nada escrito en "Contado": se ignoran, como en pantalla.
    en_blanco: int = 0


class GastoBase(BaseModel):
    descripcion: str
    categoria: str = "Operativo"
    monto: float
    metodo_pago: str = "Efectivo"  # Efectivo | Banco


class GastoCreate(GastoBase):
    pass


class Gasto(GastoBase):
    id: int
    fecha: datetime.datetime

    class Config:
        from_attributes = True


class RecetaItemInput(BaseModel):
    ingrediente_id: int
    cantidad_por_unidad: float


class RecetaItem(BaseModel):
    id: int
    ingrediente_id: int
    ingrediente_nombre: str
    unidad: str
    cantidad_por_unidad: float

    class Config:
        from_attributes = True


class CambioReceta(BaseModel):
    id: int
    variante_id: int
    composicion: str
    costo_resultante: float
    fecha: datetime.datetime

    class Config:
        from_attributes = True


class SugerenciaCompra(BaseModel):
    ingrediente_id: int
    ingrediente_nombre: str
    unidad: str
    stock_actual: float
    stock_minimo: float
    cantidad_sugerida: float
    # Cuantos dias aguanta al ritmo de venta real. None = todavia no hay
    # historial de consumo de ese insumo.
    dias_restantes: Optional[float] = None
    razon: str


class PagoInput(BaseModel):
    metodo: str  # ver contabilidad.CUENTA_POR_METODO_PAGO
    monto: float
    # Lo que el cliente entrego. Si es mayor que el monto, la diferencia es
    # vuelto; `vuelto_metodo` dice por que gaveta salio (pagar en divisas y dar
    # el vuelto en bolivares mueve dos cajas distintas).
    recibido: Optional[float] = None
    vuelto_metodo: Optional[str] = None
    # Numero de confirmacion: del pago movil, el ticket del punto, el
    # comprobante del Zelle. Se exige para los metodos que de verdad tienen
    # uno (ver contabilidad.METODOS_CON_REFERENCIA); en efectivo se ignora.
    referencia: Optional[str] = None


class Pago(BaseModel):
    metodo: str
    monto: float
    recibido: Optional[float] = None
    vuelto_metodo: Optional[str] = None
    vuelto_monto: float = 0
    referencia: str = ""

    class Config:
        from_attributes = True


class PedidoItemCreate(BaseModel):
    """Un renglon del pedido: del menu, o venta libre.

    Del menu: `variante_id`. Venta libre: `nombre_libre` y `precio_libre`, para
    cobrar algo no catalogado sin tener que crearlo en el menu primero.
    """

    variante_id: Optional[int] = None
    cantidad: int = 1
    nota: str = ""
    nombre_libre: Optional[str] = None
    precio_libre: Optional[float] = None
    # Una venta libre no tiene receta que consultar, asi que por defecto
    # cocina la tiene que marcar a mano (puede ser un encargo real, como una
    # torta). Cuando el cliente SI sabe que no hay nada que cocinar -un
    # delivery personalizado, por ejemplo- lo manda en true para que no se
    # quede pegado para siempre en la cola de cocina.
    preparado: Optional[bool] = None


class PedidoCreate(BaseModel):
    items: List[PedidoItemCreate]
    nota: str = ""
    # El POS lo manda en true cuando el cajero ya vio el aviso de "no alcanza
    # el inventario" y decidio vender igual (el conteo del sistema puede estar
    # atrasado). Por defecto no se deja, para no vender lo que no hay.
    permitir_sin_stock: bool = False
    # Clave que genera el POS para este intento. Si la respuesta se pierde y
    # la cajera vuelve a darle, el mismo valor devuelve el pedido ya creado en
    # vez de mandar una segunda comanda igual a cocina.
    clave_cliente: Optional[str] = None


class AnularRequest(BaseModel):
    # None = que el sistema lo deduzca del estado del pedido.
    comida_preparada: Optional[bool] = None
    operador_id: Optional[int] = None


class FacturarRequest(BaseModel):
    """Facturar despues de cobrar: el dueno revisa el historico y decide que
    vender factura, con el numero que transcribe de su talonario."""

    numero_factura: str


class DevolucionRequest(BaseModel):
    # True: la comida vuelve al inventario (venia sellada, no se abrio).
    # False: se boto, y el costo pasa de costo de ventas a merma.
    recuperable: bool = False
    # Obligatorio si la venta se facturo: es lo que la saca del Libro de Ventas.
    nota_credito: Optional[str] = None
    motivo: str = ""


class PedidoItem(BaseModel):
    id: int
    # None = venta libre, no esta en el menu.
    variante_id: Optional[int] = None
    nombre: str
    precio_unitario: float
    cantidad: int
    nota: str
    preparado: bool

    class Config:
        from_attributes = True


class PedidoEdicion(BaseModel):
    id: int
    fecha: datetime.datetime
    detalle: str = ""
    total_antes: float = 0
    total_despues: float = 0
    diferencia: float = 0
    metodo_pago: str = ""
    motivo: str = ""
    operador: str = ""
    autorizado_por: str = ""

    class Config:
        from_attributes = True


class Pedido(BaseModel):
    id: int
    numero: int
    estado: str
    nota: str
    metodo_pago: Optional[str]
    total: float
    creado_en: datetime.datetime
    # Cuando se cobro. La pantalla la necesita para saber si la venta ya entro
    # al cierre de caja de otro dia, que es lo que impide editarle el monto.
    cerrado_en: Optional[datetime.datetime] = None
    facturado: bool = False
    numero_factura: Optional[str] = None
    # Tasa a la que se cobro. Se expone para que la pantalla muestre los
    # bolivares que de verdad entraron ese dia, y no los que darian esos
    # dolares a la tasa de hoy.
    tasa_bcv: Optional[float] = None
    devuelto: bool = False
    nota_credito: Optional[str] = None
    # Precio de lista antes de rebajas; `total` ya viene con el descuento.
    subtotal: float = 0
    descuento: float = 0
    motivo_descuento: str = ""
    # Plata del empleado que pasa por la gaveta: no suma a `total` ni al IVA.
    propina: float = 0
    # `total` + propina: lo que de verdad se recibe al cobrar.
    a_cobrar: float = 0
    cliente: str = ""
    fiado_saldado: bool = False
    # Trazabilidad: quien cobro, desde que caja, y quien anulo si se anulo.
    operador: str = ""
    punto_venta: str = ""
    anulado_por: str = ""
    # None si no esta anulado. Si lo esta: True = se preparo y se perdio
    # (merma), False = no se llego a preparar y volvio al inventario.
    anulado_es_perdida: Optional[bool] = None
    pagos: List[Pago] = []
    items: List[PedidoItem]
    # Los dos candados. Van como fecha y no como booleano porque la pantalla
    # muestra desde cuando ("editando hace 2 min"), y porque el de edicion
    # vence solo: quien decide si sigue vivo es quien lo lee.
    cocinando_desde: Optional[datetime.datetime] = None
    cocinando_por: str = ""
    editando_desde: Optional[datetime.datetime] = None
    editando_por: str = ""
    editado: bool = False
    editado_en: Optional[datetime.datetime] = None
    ediciones: List[PedidoEdicion] = []

    class Config:
        from_attributes = True


class Autorizacion(BaseModel):
    """Usuario y clave de quien autoriza una diferencia de plata.

    No es el login: quien esta editando ya entro. Es la firma de que alguien
    con cuenta acepta que la caja reciba (o suelte) plata por un pedido que ya
    estaba cobrado. Se verifica contra las cuentas del local y el nombre queda
    guardado en la edicion.
    """

    usuario: str
    clave: str


class EditarPedidoRequest(BaseModel):
    """Como queda el pedido despues de la edicion: la lista COMPLETA de
    renglones, no un delta. El POS ya tiene el pedido en pantalla; mandar el
    estado final evita que dos ediciones seguidas se pisen sumando cambios
    sobre una base distinta a la que el cajero esta viendo."""

    items: List[PedidoItemCreate]
    nota: Optional[str] = None
    motivo: str = ""
    permitir_sin_stock: bool = False
    # Solo hacen falta si la edicion cambia lo que ya se cobro.
    autorizacion: Optional[Autorizacion] = None
    pagos: Optional[List[PagoInput]] = None


class CobrarRequest(BaseModel):
    metodo_pago: str
    # Solo aplica cuando NO se manda `pagos` (un solo metodo para todo el
    # pedido). Con pagos partidos, cada uno trae la suya.
    referencia: Optional[str] = None
    # Pago partido entre varias formas. Si no viene, se asume que todo el
    # pedido se pago con `metodo_pago`.
    pagos: Optional[List[PagoInput]] = None
    facturado: bool = False
    numero_factura: Optional[str] = None
    # Rebaja a ESTE cliente. Antes habia que bajarle el precio al menu, que se
    # lo bajaba a todos y declaraba IVA sobre un precio que no se cobro.
    descuento: float = 0
    motivo_descuento: str = ""
    # Plata del empleado. No suma a la venta ni al IVA: entra a la gaveta y se
    # debe (2040) hasta que se le entrega.
    propina: float = 0
    # Para el fiado: sin nombre no hay a quien cobrarle.
    cliente: str = ""
    # Quien cobra y desde que caja. Opcional: una instalacion sin operadores
    # cargados sigue funcionando igual.
    operador_id: Optional[int] = None
    punto_venta_id: Optional[int] = None


class TicketLinea(BaseModel):
    nombre: str
    cantidad: int
    precio_unitario: float
    subtotal: float


class Ticket(BaseModel):
    """Datos del comprobante impreso. La pantalla los maqueta e imprime."""

    pedido_id: int
    numero: int
    fecha: datetime.datetime
    estado: str
    items: List[TicketLinea] = []
    subtotal: float
    descuento: float = 0
    propina: float = 0
    total: float
    a_cobrar: float
    tasa_bcv: Optional[float] = None
    total_bs: Optional[float] = None
    facturado: bool = False
    numero_factura: Optional[str] = None
    base_imponible: Optional[float] = None
    iva: Optional[float] = None
    pagos: List[Pago] = []
    cliente: str = ""
    operador: str = ""
    punto_venta: str = ""


class Configuracion(BaseModel):
    tasa_bcv: float


class EntregarPropinasRequest(BaseModel):
    monto: float
    metodo_pago: str = "Efectivo Bs"
    nota: str = ""


class SaldarFiadoRequest(BaseModel):
    metodo_pago: str = "Efectivo Bs"
    # Sin monto se cobra todo lo que queda, que es el caso comun y lo que
    # hacia antes este endpoint. Con monto, es un abono.
    monto: Optional[float] = None
    operador_id: Optional[int] = None
    # Obligatoria si el metodo no es efectivo, igual que al cobrar en el punto
    # de venta (ver contabilidad.METODOS_CON_REFERENCIA).
    referencia: Optional[str] = None


class CuentaPorCobrar(BaseModel):
    pedido_id: int
    numero: int
    cliente: str
    # Lo que debe HOY. Si hubo abonos no es lo mismo que la venta.
    monto: float
    original: float
    abonado: float
    abonos: int
    fecha: datetime.datetime
    dias: int


class RetiroCreate(BaseModel):
    monto: float
    metodo_pago: str = "Efectivo"  # Efectivo | Banco
    nota: str = ""
    operador_id: Optional[int] = None


class RetiroPropietario(BaseModel):
    id: int
    monto: float
    metodo_pago: str
    nota: str
    fecha: datetime.datetime

    class Config:
        from_attributes = True


class CierreCajaRequest(BaseModel):
    efectivo_contado: float  # bolivares
    divisas_contado: float = 0  # billetes en dolares, se cuentan aparte
    nota: str = ""
    operador_id: Optional[int] = None
    # Con dos pisos hay dos gavetas: cada una cierra la suya.
    punto_venta_id: Optional[int] = None


class PropinasPendientes(BaseModel):
    por_entregar: float


class Gaveta(BaseModel):
    """Una caja fisica que se cuenta al cerrar.

    Bolivares y divisas son dos montones de billetes distintos: con un solo
    numero el arqueo era imposible.
    """

    codigo: str
    etiqueta: str
    saldo_anterior: float
    entradas_hoy: float
    salidas_hoy: float
    esperado: float


class ResumenCaja(BaseModel):
    fecha: str
    total_ventas: float
    por_metodo_pago: dict
    # Lo que quedo en la gaveta de dias anteriores: la caja no arranca en cero
    # cada manana.
    saldo_anterior: float = 0
    efectivo_esperado: float
    # Lo que salio de la gaveta hoy sin ser una venta (gastos, pagos a
    # proveedores, compras sueltas). Se muestra para que el faltante deje de
    # parecer inexplicable.
    salidas_efectivo: float = 0
    # Parte de `salidas_efectivo` que se llevo el dueno. Se muestra aparte
    # porque no es un gasto del negocio.
    retiros_hoy: float = 0
    cantidad_pedidos: int
    gavetas: List[Gaveta] = []
    # Plata de terceros que esta en la gaveta: no es del negocio.
    propinas_por_entregar: float = 0
    fiado_por_cobrar: float = 0
    propinas_hoy: float = 0
    descuentos_hoy: float = 0


class PuntoSerie(BaseModel):
    etiqueta: str
    ventas: float
    pedidos: int


class ProductoVendido(BaseModel):
    nombre: str
    unidades: int
    ingresos: float
    costo: float
    ganancia: float
    margen_pct: float
    # Sin receta el costo entra como cero: el margen que saldria seria 100% y
    # no significa nada. Se marca para no mostrarlo como si fuera bueno.
    sin_receta: bool = False


class Insight(BaseModel):
    tipo: str  # bueno | alerta | info
    titulo: str
    detalle: str


class PuntoCalor(BaseModel):
    """Una celda del mapa de calor: los pedidos que entraron ese dia de la
    semana a esa hora, sumando todo el periodo. Solo vienen las celdas con
    algo; la cuadricula entera la arma la pantalla."""

    dia: int  # 0 = lunes ... 6 = domingo
    hora: int  # 0..23
    pedidos: int
    ventas: float


class GrupoReporte(BaseModel):
    nombre: str
    ventas: float
    pedidos: int
    pct: float  # sobre las ventas del periodo
    # Para los dias de la semana: lo que vende un lunes TIPICO. La suma de
    # todos los lunes crece con el tamaño del rango y no dice nada.
    promedio: Optional[float] = None


class Comparativa(BaseModel):
    """El periodo inmediatamente anterior, del mismo tamaño."""

    etiqueta: str  # "ayer", "la semana pasada", "el periodo anterior"
    ventas: float
    pedidos: int
    ticket_promedio: float
    ganancia_neta: float
    cambio_ventas_pct: Optional[float] = None
    cambio_pedidos_pct: Optional[float] = None
    cambio_ticket_pct: Optional[float] = None
    cambio_ganancia_pct: Optional[float] = None


class ReporteResumen(BaseModel):
    periodo: str
    etiqueta: str
    # Con que paso viene `serie`: hora | dia | semana | mes. Depende del
    # tamaño del rango, no de que boton se toco.
    granularidad: str = "dia"
    ventas: float  # bruto que entro por caja, incluido el IVA de lo facturado
    # Bolivares reales del periodo: cada venta a la tasa del dia en que se
    # cobro. No es `ventas` por la tasa de hoy.
    ventas_bs: float = 0
    iva_cobrado: float = 0  # parte de `ventas` que le pertenece al SENIAT
    ingresos_netos: float = 0  # ventas - iva_cobrado; es el ingreso real del negocio
    pedidos: int
    ticket_promedio: float
    # Lo que gasta el cliente del medio. El promedio lo mueve un solo pedido
    # grande; la mediana describe el mostrador de verdad.
    ticket_mediano: float = 0
    costo_insumos: float
    ganancia_bruta: float
    margen_pct: float
    gastos: float  # incluye mermas y faltantes de caja, no solo la tabla de gastos
    ganancia_neta: float
    pedidos_anulados: int
    valor_anulado: float = 0
    # Ventas que el cliente devolvio: ya no cuentan como venta, pero el dueno
    # necesita saber cuantas fueron.
    devoluciones: int = 0
    valor_devuelto: float = 0
    # Cuanto de lo vendido el dueno decidio facturar. No es todo o nada: se
    # puede facturar al cobrar o despues, revisando el historico.
    facturadas: int = 0
    valor_facturado: float = 0
    por_metodo_pago: dict
    serie: List[PuntoSerie]
    top_productos: List[ProductoVendido]
    insights: List[Insight]
    # Lo que hace falta para comparar y dibujar, no solo para leer numeros.
    anterior: Optional[Comparativa] = None
    # La misma serie del periodo anterior, alineada punto a punto con `serie`
    # (misma cantidad de tramos, las etiquetas de la actual) para superponerla.
    serie_anterior: List[PuntoSerie] = []
    # Vacio si el rango es de un solo dia: ahi la serie por horas ya lo dice.
    calor: List[PuntoCalor] = []
    por_categoria: List[GrupoReporte] = []
    # Los siete dias, lunes a domingo. Vacio si el rango es de un solo dia.
    por_dia_semana: List[GrupoReporte] = []


class VentaFila(BaseModel):
    """Una venta en el historial: que fue, cuanto, como, quien, y que paso."""

    id: int
    numero: int
    fecha: datetime.datetime
    # cobrada | fiada | devuelta | anulada | abierta (ver routers/ventas.py)
    estado: str
    cliente: str = ""
    detalle: str  # "2× Empanada, 1× Jugo"
    unidades: int
    subtotal: float
    descuento: float = 0
    total: float
    propina: float = 0
    total_bs: Optional[float] = None
    tasa_bcv: Optional[float] = None
    pago: str = ""  # "Efectivo $ + Pago movil"
    fiado_pendiente: float = 0
    fiado_saldado: bool = False
    facturado: bool = False
    numero_factura: Optional[str] = None
    operador: str = ""
    punto_venta: str = ""
    anulado_por: str = ""
    anulado_es_perdida: Optional[bool] = None
    motivo_devolucion: str = ""
    nota_credito: Optional[str] = None
    nota: str = ""
    items: List[PedidoItem] = []
    # Cambio despues de tomada. Una venta editada no se lee igual que una que
    # salio bien a la primera, sobre todo si la edicion le movio el monto: por
    # eso viaja el detalle completo y no solo la marca.
    editado: bool = False
    ediciones: List[PedidoEdicion] = []


class ListaVentas(BaseModel):
    etiqueta: str
    total: int
    # Se devolvieron menos filas de las que hay: el rango es demasiado grande.
    recortado: bool = False
    filas: List[VentaFila]


class PerdidasVentas(BaseModel):
    """La plata que no llego, o que se fue, en el periodo."""

    anuladas: int = 0
    valor_anulado: float = 0
    devueltas: int = 0
    valor_devuelto: float = 0
    con_descuento: int = 0
    valor_descuentos: float = 0
    merma_inventario: float = 0
    fiado_pendiente: int = 0
    valor_fiado_pendiente: float = 0
    # devuelto + descuentos + merma: lo que si se perdio. Lo anulado nunca
    # entro y lo fiado todavia se puede cobrar, asi que no suman aqui.
    total: float = 0
    pct_sobre_ventas: float = 0


class GrupoVentas(BaseModel):
    nombre: str
    ventas: float
    pedidos: int


class VentasAnteriores(BaseModel):
    ventas: float
    pedidos: int
    promedio_diario: float


class ResumenVentas(BaseModel):
    etiqueta: str
    desde: datetime.date
    hasta: datetime.date
    dias: int  # dias del rango que ya pasaron; el divisor de los promedios
    granularidad: str
    ventas: float
    ventas_bs: float = 0
    pedidos: int
    unidades: int = 0
    ticket_promedio: float
    ticket_mediano: float
    promedio_diario: float
    pedidos_por_dia: float
    anterior: VentasAnteriores
    cambio_pct: Optional[float] = None
    perdidas: PerdidasVentas
    por_metodo_pago: dict
    por_punto_venta: List[GrupoVentas] = []
    por_operador: List[GrupoVentas] = []
    facturadas: int = 0
    valor_facturado: float = 0
    serie: List[PuntoSerie]
    mejor: Optional[PuntoSerie] = None


class CierreCaja(BaseModel):
    id: int
    fecha: str
    total_sistema: float
    efectivo_esperado: float
    efectivo_contado: float
    diferencia: float
    nota: str
    # Un cierre mal contado no se borra: se anula y queda el rastro.
    anulado: bool = False
    motivo_anulacion: str = ""
    operador: str = ""
    punto_venta: str = ""
    divisas_esperado: float = 0
    divisas_contado: float = 0
    divisas_diferencia: float = 0

    class Config:
        from_attributes = True


class AnularCierreRequest(BaseModel):
    motivo: str = ""


# ------------------------------------------------------------------ tasas
class EstadoTasa(BaseModel):
    fecha: str
    bcv: Optional[float]
    eur: Optional[float]
    paralelo: Optional[float]
    brecha_pct: Optional[float]
    variacion_semana_pct: Optional[float]
    origen: Optional[str]  # auto | manual
    actualizado_en: Optional[str]
    en_vivo: bool
    # Hace cuanto se hablo con BCV/Binance. None = nunca desde que arranco.
    minutos_sin_contacto: Optional[float] = None
    fuente_actualizada: Optional[str]
    desactualizada: bool


class PuntoAnalisisTasa(BaseModel):
    fecha: str
    bcv: float
    eur: Optional[float] = None
    paralelo: Optional[float] = None
    brecha_pct: Optional[float] = None


class SaltoTasa(BaseModel):
    """El dia que mas se movio el oficial dentro del periodo."""

    fecha: str
    de: float
    a: float
    pct: float


class EquivalenciaTasa(BaseModel):
    """Cuantos bolivares eran X dolares al empezar el periodo y cuantos al final."""

    usd: float
    bs_inicio: float
    bs_fin: float


class GrupoMonto(BaseModel):
    nombre: str
    monto: float
    pct: float


class AnalisisTasa(BaseModel):
    """La serie del periodo y lo que se lee en ella (ver `analisis_tasa.py`)."""

    etiqueta: str
    puntos: List[PuntoAnalisisTasa]
    dias: int
    bcv_inicio: Optional[float] = None
    bcv_fin: Optional[float] = None
    bcv_min: Optional[float] = None
    bcv_max: Optional[float] = None
    variacion_pct: Optional[float] = None
    brecha_inicio_pct: Optional[float] = None
    brecha_fin_pct: Optional[float] = None
    brecha_media_pct: Optional[float] = None
    # Lo cobrado en metodos de bolivares, en dolares, y lo que la brecha se
    # llevo de eso al reponer comprando divisas.
    cobrado_bs_usd: float = 0
    costo_brecha_usd: float = 0
    lecturas: List[Insight] = []
    # Ritmo: variacion promedio por dia calendario, y donde queda el dolar en
    # 30 dias si sigue igual. Es una extrapolacion y se dice como tal.
    ritmo_diario_pct: Optional[float] = None
    proyeccion_30d: Optional[float] = None
    proyeccion_30d_pct: Optional[float] = None
    mayor_salto: Optional[SaltoTasa] = None
    # Exposicion: de todo lo cobrado, que parte entro en bolivares. Esa es la
    # parte que la brecha se come; lo cobrado en divisas no pierde nada.
    cobrado_total_usd: float = 0
    cobrado_divisas_usd: float = 0
    exposicion_pct: Optional[float] = None
    por_metodo_bs: List[GrupoMonto] = []
    equivalencias: List[EquivalenciaTasa] = []
    # Cuanto subieron los insumos en el mismo periodo, si hubo compras que lo
    # digan. Al lado de `variacion_pct` responde si la subida es de la tasa o
    # de los proveedores.
    inflacion_insumos_pct: Optional[float] = None


class TasaManual(BaseModel):
    bcv: float
    paralelo: Optional[float] = None


class PuntoTasa(BaseModel):
    fecha: str
    bcv: float
    # El euro oficial del BCV. No es el dolar convertido: el banco lo fija
    # aparte y da distinto (841,03 derivado contra 840,86 real).
    eur: Optional[float] = None
    paralelo: Optional[float]
    origen: str


# ------------------------------------------------------------------ combos
class ParCombo(BaseModel):
    producto: str
    acompanante: str
    juntos: int
    confianza_pct: float
    lift: float


class Acompanamiento(BaseModel):
    con_bebida: int
    sin_bebida: int
    con_bebida_pct: float
    sin_bebida_pct: float


class OportunidadCombo(BaseModel):
    pedidos_sin_bebida: int
    ticket_bebida: float
    venta_potencial: float
    ganancia_potencial: float
    conversion_supuesta_pct: int


class ReporteCombos(BaseModel):
    periodo: str
    etiqueta: str
    pedidos_analizados: int
    suficientes_datos: bool
    pares: List[ParCombo]
    acompanamiento: Optional[Acompanamiento]
    oportunidad: Optional[OportunidadCombo]


class Sugerencia(BaseModel):
    variante_id: int
    etiqueta: str
    precio: float
    es_bebida: bool


# ------------------------------------------------------------ contabilidad
class CuentaContableBase(BaseModel):
    codigo: str
    nombre: str
    tipo: str
    naturaleza: str
    activa: bool = True


class CuentaContableCreate(CuentaContableBase):
    pass


class CuentaContable(CuentaContableBase):
    id: int

    class Config:
        from_attributes = True


class LineaAsientoInput(BaseModel):
    cuenta_id: int
    debe: float = 0
    haber: float = 0


class AsientoCreate(BaseModel):
    descripcion: str
    lineas: List[LineaAsientoInput]


class MovimientoContable(BaseModel):
    id: int
    cuenta_id: int
    cuenta_codigo: str
    cuenta_nombre: str
    debe: float
    haber: float

    class Config:
        from_attributes = True


class AsientoContable(BaseModel):
    id: int
    fecha: datetime.datetime
    descripcion: str
    origen: str
    referencia_id: Optional[int]
    movimientos: List[MovimientoContable]

    class Config:
        from_attributes = True


class FilaMayor(BaseModel):
    asiento_id: int
    fecha: datetime.datetime
    descripcion: str
    origen: str
    debe: float
    haber: float
    saldo: float


class FilaBalanceComprobacion(BaseModel):
    cuenta_id: int
    codigo: str
    nombre: str
    tipo: str
    debe: float
    haber: float
    saldo: float


class EstadoResultados(BaseModel):
    periodo: str
    etiqueta: str
    ingresos: float
    costos: float
    utilidad_bruta: float
    gastos: float
    utilidad_neta: float
    detalle_ingresos: List[FilaBalanceComprobacion]
    detalle_costos: List[FilaBalanceComprobacion]
    detalle_gastos: List[FilaBalanceComprobacion]


class ActivoFijo(BaseModel):
    id: int
    nombre: str
    valor: float
    fecha_compra: datetime.datetime
    vida_util_meses: int
    cuota_mensual: float
    depreciacion_acumulada: float
    valor_en_libros: float
    meses_depreciados: int
    dado_de_baja: bool
    fecha_baja: Optional[datetime.datetime] = None
    motivo_baja: str = ""


class BajaActivoRequest(BaseModel):
    motivo: str = ""


class ActualizarActivoRequest(BaseModel):
    nombre: Optional[str] = None
    vida_util_meses: Optional[int] = Field(default=None, gt=0, le=600)


class CerrarEjercicioRequest(BaseModel):
    anio: int


class ActivoExistenteCreate(BaseModel):
    """Un bien que ya existia antes de instalar el ERP."""

    nombre: str
    valor: float
    vida_util_meses: int = 60
    fecha_compra: Optional[datetime.datetime] = None


class ProblemaContable(BaseModel):
    gravedad: str  # grave | aviso
    titulo: str
    detalle: str


class SaludContable(BaseModel):
    sano: bool
    problemas: List[ProblemaContable]


class BalanceGeneral(BaseModel):
    fecha: str
    activos: List[FilaBalanceComprobacion]
    pasivos: List[FilaBalanceComprobacion]
    patrimonio: List[FilaBalanceComprobacion]
    utilidad_acumulada: float
    total_activos: float
    total_pasivos: float
    total_patrimonio: float
    cuadra: bool


# ------------------------------------------------------------------ compras
class LineaFacturaInput(BaseModel):
    ingrediente_id: int
    cantidad: float
    costo_unitario: float  # precio pagado por 1 unidad de medida, SIN IVA
    # Si ESTE renglon viene exento. None = lo que diga la ficha del insumo,
    # que es lo normal; se manda explicito cuando esta factura viene distinta
    # (la misma mercancia puede llegar exenta de un proveedor y gravada de
    # otro, y quien tiene el papel delante es quien sabe).
    exento: Optional[bool] = None


class LineaFactura(BaseModel):
    id: int
    ingrediente_id: int
    ingrediente_nombre: str
    unidad: str
    cantidad: float
    costo_unitario: float
    subtotal: float
    exento: bool = False

    class Config:
        from_attributes = True


class ProveedorCreate(BaseModel):
    nombre: str
    rif: Optional[str] = None
    telefono: str = ""
    direccion: str = ""
    contacto: str = ""
    nota: str = ""


class Proveedor(ProveedorCreate):
    id: int
    activo: bool = True

    class Config:
        from_attributes = True


class FacturaCompraBase(BaseModel):
    numero_factura: str
    proveedor_nombre: str
    # Obligatorio para el Libro de Compras: se valida el formato en el router
    # (letra + 8/9 digitos), no aca, porque el mensaje de error necesita decir
    # exactamente que formato se espera.
    proveedor_rif: str
    categoria: str = "Insumos"  # Insumos|Servicios|Activos|Otros
    forma_pago: str = "Efectivo"  # Efectivo|Banco|Credito
    descripcion: str = ""


class FacturaCompraCreate(FacturaCompraBase):
    fecha: Optional[datetime.datetime] = None
    # Con renglones (compra de insumos): la base sale de sumar los renglones,
    # y cada uno actualiza el stock y el costo promedio de su ingrediente.
    items: List[LineaFacturaInput] = []
    # Sin renglones (servicios, activos, cualquier compra que no sea insumo
    # puntual): se carga la base a mano, como antes.
    base_imponible: Optional[float] = None
    iva: float = 0
    # Lo que el proveedor suma o rebaja sobre el total: flete, recargo por
    # pagar a credito, descuento por volumen. Van en positivo los dos; el
    # signo lo pone el campo, no quien teclea.
    recargo: float = 0
    descuento: float = 0
    # Solo tiene sentido si forma_pago="Credito": para cuando el dueno se
    # comprometio a pagar, y poder avisar si ya se paso la fecha.
    fecha_vencimiento: Optional[datetime.datetime] = None
    # Solo para categoria="Activos": en cuantos meses se gasta el bien.
    # 60 (5 años) es lo tipico para equipo de cocina.
    vida_util_meses: Optional[int] = None
    # El comprobante, cuando la factura se carga ya pagada y no en efectivo.
    # A credito no aplica: todavia no ha salido plata.
    referencia_pago: Optional[str] = None


class FacturaCompra(FacturaCompraBase):
    id: int
    fecha: datetime.datetime
    # Ya con el recargo y el descuento aplicados: es la base que va al Libro
    # de Compras. Los dos viajan aparte para poder explicar la diferencia con
    # la suma de los renglones.
    base_imponible: float
    recargo: float = 0
    descuento: float = 0
    iva: float
    total: float
    pagada: bool
    fecha_vencimiento: Optional[datetime.datetime] = None
    fecha_pago: Optional[datetime.datetime] = None
    referencia_pago: str = ""
    items: List[LineaFactura] = []

    class Config:
        from_attributes = True


class PagoFacturaRequest(BaseModel):
    forma_pago: str = "Efectivo"  # Efectivo|Banco - con que se salda la deuda
    # Obligatoria si no se paga en efectivo, igual que al cobrar una venta.
    referencia: Optional[str] = None


# ----------------------------------------------------------------- impuestos
class NotaCreditoItemCreate(BaseModel):
    ingrediente_id: int
    cantidad: float


class NotaCreditoCompraCreate(BaseModel):
    """Nota de credito que emite el proveedor sobre una factura ya cargada.

    `tipo` decide todo lo demas:
      - devolucion: la mercancia vuelve. Hay que decir de que insumos y cuanto
        (`items`); el sistema calcula la base con el precio de la factura.
      - descuento: te quedas la mercancia y rebajan el precio. Se informa
        `base_imponible` y el costo del insumo BAJA.
    """

    numero: str
    tipo: str  # devolucion | descuento
    motivo: str = ""
    fecha: Optional[datetime.datetime] = None
    base_imponible: Optional[float] = None  # solo para 'descuento'
    iva: Optional[float] = None  # si se omite, se prorratea el de la factura
    items: List[NotaCreditoItemCreate] = []


class NotaCreditoItem(BaseModel):
    id: int
    ingrediente_id: int
    ingrediente_nombre: str
    unidad: str
    cantidad: float
    costo_unitario: float
    subtotal: float


class NotaCreditoCompra(BaseModel):
    id: int
    factura_id: int
    numero: str
    tipo: str
    fecha: datetime.datetime
    base_imponible: float
    iva: float
    total: float
    motivo: str
    items: List[NotaCreditoItem] = []


class ConfiguracionFiscal(BaseModel):
    tasa_iva: float


class FilaLibroVentas(BaseModel):
    pedido_id: int
    fecha: datetime.datetime
    numero_factura: str
    cliente: str
    base_imponible: float
    iva: float
    total: float


class LibroVentas(BaseModel):
    periodo: str
    etiqueta: str
    tasa_iva: float
    filas: List[FilaLibroVentas]
    total_base: float
    total_iva: float
    total_general: float
    ventas_no_facturadas: int
    monto_no_facturado: float


class FilaLibroCompras(BaseModel):
    factura_id: int
    fecha: datetime.datetime
    numero_factura: str
    proveedor_nombre: str
    proveedor_rif: Optional[str]
    base_imponible: float
    iva: float
    total: float


class LibroCompras(BaseModel):
    periodo: str
    etiqueta: str
    filas: List[FilaLibroCompras]
    total_base: float
    total_iva: float
    total_general: float


class DeclaracionIva(BaseModel):
    id: int
    anio: int
    mes: int
    periodo: str
    etiqueta: str
    iva_debito: float
    iva_credito: float
    credito_arrastrado: float  # excedente que venia del mes anterior
    credito_usado: float
    iva_a_pagar: float
    credito_excedente: float  # lo que pasa al mes siguiente
    fecha_declaracion: datetime.datetime
    pagada: bool
    fecha_pago: Optional[datetime.datetime] = None
    forma_pago: Optional[str] = None


class PeriodoPendiente(BaseModel):
    anio: int
    mes: int
    etiqueta: str
    iva_debito: float
    iva_credito: float


class DeclararIvaRequest(BaseModel):
    anio: int
    mes: int


class PagoIvaRequest(BaseModel):
    forma_pago: str = "Banco"


class ResumenIva(BaseModel):
    periodo: str
    etiqueta: str
    iva_debito: float
    iva_credito: float
    iva_a_pagar: float
