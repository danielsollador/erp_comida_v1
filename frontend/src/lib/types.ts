export type Variante = {
  id: number
  producto_id: number
  nombre: string
  precio: number
  activo: boolean
}

export type Producto = {
  id: number
  categoria_id: number
  nombre: string
  activo: boolean
  variantes: Variante[]
}

export type Categoria = {
  id: number
  nombre: string
  orden: number
  productos: Producto[]
}

export type PedidoItem = {
  id: number
  variante_id: number
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
  creado_en: string
  items: PedidoItem[]
}

export type Configuracion = {
  tasa_bcv: number
}

export type ResumenCaja = {
  fecha: string
  total_ventas: number
  por_metodo_pago: Record<string, number>
  efectivo_esperado: number
  cantidad_pedidos: number
}

export type CierreCaja = {
  id: number
  fecha: string
  total_sistema: number
  efectivo_esperado: number
  efectivo_contado: number
  diferencia: number
  nota: string
}
