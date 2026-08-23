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


class IngredienteCreate(IngredienteBase):
    pass


class Ingrediente(IngredienteBase):
    id: int

    class Config:
        from_attributes = True


class ComprarIngredienteRequest(BaseModel):
    cantidad: float


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
