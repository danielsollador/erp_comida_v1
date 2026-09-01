import datetime
from typing import List, Optional

from pydantic import BaseModel


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


class IngredienteCreate(IngredienteBase):
    pass


class Ingrediente(IngredienteBase):
    id: int

    class Config:
        from_attributes = True


class ComprarIngredienteRequest(BaseModel):
    cantidad: float
    costo_total: Optional[float] = None  # si se informa, actualiza el costo unitario


class MermaRequest(BaseModel):
    cantidad: float
    motivo: str = ""


class AjusteStockRequest(BaseModel):
    stock_real: float
    motivo: str = "Conteo fisico"


class GastoBase(BaseModel):
    descripcion: str
    categoria: str = "Operativo"
    monto: float


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


class SugerenciaCompra(BaseModel):
    ingrediente_id: int
    ingrediente_nombre: str
    unidad: str
    stock_actual: float
    stock_minimo: float
    cantidad_sugerida: float
    razon: str


class PedidoItemCreate(BaseModel):
    variante_id: int
    cantidad: int = 1
    nota: str = ""


class PedidoCreate(BaseModel):
    items: List[PedidoItemCreate]
    nota: str = ""


class PedidoItem(BaseModel):
    id: int
    variante_id: int
    nombre: str
    precio_unitario: float
    cantidad: int
    nota: str
    preparado: bool

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
    items: List[PedidoItem]

    class Config:
        from_attributes = True


class CobrarRequest(BaseModel):
    metodo_pago: str


class Configuracion(BaseModel):
    tasa_bcv: float


class CierreCajaRequest(BaseModel):
    efectivo_contado: float
    nota: str = ""


class ResumenCaja(BaseModel):
    fecha: str
    total_ventas: float
    por_metodo_pago: dict
    efectivo_esperado: float
    cantidad_pedidos: int


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


class Insight(BaseModel):
    tipo: str  # bueno | alerta | info
    titulo: str
    detalle: str


class ReporteResumen(BaseModel):
    periodo: str
    etiqueta: str
    ventas: float
    pedidos: int
    ticket_promedio: float
    costo_insumos: float
    ganancia_bruta: float
    margen_pct: float
    gastos: float
    ganancia_neta: float
    pedidos_anulados: int
    por_metodo_pago: dict
    serie: List[PuntoSerie]
    top_productos: List[ProductoVendido]
    insights: List[Insight]


class CierreCaja(BaseModel):
    id: int
    fecha: str
    total_sistema: float
    efectivo_esperado: float
    efectivo_contado: float
    diferencia: float
    nota: str

    class Config:
        from_attributes = True


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
    fuente_actualizada: Optional[str]
    desactualizada: bool


class TasaManual(BaseModel):
    bcv: float
    paralelo: Optional[float] = None


class PuntoTasa(BaseModel):
    fecha: str
    bcv: float
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
