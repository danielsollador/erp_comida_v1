export type Producto = {
  id: number
  nombre: string
  categoria: string
  precio: number
  activo: boolean
}

export type PedidoItem = {
  id: number
  producto_id: number
  nombre: string
  precio_unitario: number
  cantidad: number
  nota: string
  preparado: boolean
}

export type Ingrediente = {
  id: number
  nombre: string
  unidad: string
  stock_actual: number
  stock_minimo: number
  stock_objetivo: number
}

export type SugerenciaCompra = {
  ingrediente_id: number
  ingrediente_nombre: string
  unidad: string
  stock_actual: number
  stock_minimo: number
  cantidad_sugerida: number
  razon: string
}

export type Pedido = {
  id: number
  numero: number
  estado: 'pendiente' | 'listo' | 'pagado' | 'anulado'
  nota: string
  metodo_pago: string | null
  total: number
  items: PedidoItem[]
}
