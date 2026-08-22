from typing import List, Optional

from pydantic import BaseModel


class ProductoBase(BaseModel):
    nombre: str
    categoria: str
    precio: float
    activo: bool = True


class ProductoCreate(ProductoBase):
    pass


class Producto(ProductoBase):
    id: int

    class Config:
        from_attributes = True


class PedidoItemCreate(BaseModel):
    producto_id: int
    cantidad: int = 1
    nota: str = ""


class PedidoCreate(BaseModel):
    items: List[PedidoItemCreate]
    nota: str = ""


class PedidoItem(BaseModel):
    id: int
    producto_id: int
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
