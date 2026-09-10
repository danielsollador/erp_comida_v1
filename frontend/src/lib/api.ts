import type {
  AsientoContable,
  BalanceGeneral,
  Categoria,
  EstadoTasa,
  CierreCaja,
  Configuracion,
  ConfiguracionFiscal,
  CuentaContable,
  EstadoResultadosContable,
  FacturaCompra,
  FilaBalanceComprobacion,
  FilaMayor,
  Gasto,
  Ingrediente,
  LibroCompras,
  LibroVentas,
  Pedido,
  PedidoItem,
  Periodo,
  Producto,
  ReporteResumen,
  PuntoTasa,
  ReporteCombos,
  RecetaItem,
  Respaldo,
  ResumenCaja,
  ResumenIva,
  Sugerencia,
  SugerenciaCompra,
  Variante,
} from './types'

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    // FastAPI devuelve {"detail": "..."}; mostrar ese texto y no el JSON crudo.
    const texto = await res.text()
    let mensaje = texto || `Error ${res.status}`
    try {
      const cuerpo = JSON.parse(texto)
      if (typeof cuerpo?.detail === 'string') mensaje = cuerpo.detail
    } catch {
      // respuesta no-JSON: se usa el texto tal cual
    }
    throw new Error(mensaje)
  }
  return res.json()
}

export const api = {
  listarCategorias: () => req<Categoria[]>('/menu/categorias'),
  crearCategoria: (nombre: string, orden = 0) =>
    req<Categoria>('/menu/categorias', { method: 'POST', body: JSON.stringify({ nombre, orden }) }),
  actualizarCategoria: (id: number, nombre: string, orden: number) =>
    req<Categoria>(`/menu/categorias/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ nombre, orden }),
    }),
  eliminarCategoria: (id: number) => req(`/menu/categorias/${id}`, { method: 'DELETE' }),

  crearProducto: (categoria_id: number, nombre: string, variantes: { nombre: string; precio: number }[]) =>
    req<Producto>('/menu/productos', {
      method: 'POST',
      body: JSON.stringify({ categoria_id, nombre, activo: true, variantes }),
    }),
  actualizarProducto: (id: number, p: { categoria_id: number; nombre: string; activo: boolean }) =>
    req<Producto>(`/menu/productos/${id}`, { method: 'PUT', body: JSON.stringify(p) }),
  eliminarProducto: (id: number) => req(`/menu/productos/${id}`, { method: 'DELETE' }),

  crearVariante: (producto_id: number, nombre: string, precio: number) =>
    req<Variante>(`/menu/productos/${producto_id}/variantes`, {
      method: 'POST',
      body: JSON.stringify({ nombre, precio, activo: true }),
    }),
  actualizarVariante: (id: number, nombre: string, precio: number, activo = true) =>
    req<Variante>(`/menu/variantes/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ nombre, precio, activo }),
    }),
  eliminarVariante: (id: number) => req(`/menu/variantes/${id}`, { method: 'DELETE' }),

  listarPedidos: (estado?: string) =>
    req<Pedido[]>(`/pedidos${estado ? `?estado=${estado}` : ''}`),
  crearPedido: (items: { variante_id: number; cantidad: number; nota?: string }[], nota = '') =>
    req<Pedido>('/pedidos', { method: 'POST', body: JSON.stringify({ items, nota }) }),
  marcarItemPreparado: (itemId: number) =>
    req<Pedido>(`/pedidos/items/${itemId}/preparado`, { method: 'POST' }),
  marcarPedidoListo: (pedidoId: number) =>
    req<Pedido>(`/pedidos/${pedidoId}/marcar-listo`, { method: 'POST' }),
  cobrarPedido: (pedidoId: number, metodo_pago: string, facturado = false, numero_factura?: string) =>
    req<Pedido>(`/pedidos/${pedidoId}/cobrar`, {
      method: 'POST',
      body: JSON.stringify({ metodo_pago, facturado, numero_factura: numero_factura || null }),
    }),
  anularPedido: (pedidoId: number) => req<Pedido>(`/pedidos/${pedidoId}/anular`, { method: 'POST' }),

  listarIngredientes: () => req<Ingrediente[]>('/inventario/ingredientes'),
  actualizarIngrediente: (id: number, i: Omit<Ingrediente, 'id' | 'costo_efectivo'>) =>
    req<Ingrediente>(`/inventario/ingredientes/${id}`, { method: 'PUT', body: JSON.stringify(i) }),
  registrarCompra: (id: number, cantidad: number, costo_total?: number) =>
    req<Ingrediente>(`/inventario/ingredientes/${id}/comprar`, {
      method: 'POST',
      body: JSON.stringify({ cantidad, costo_total: costo_total ?? null }),
    }),
  registrarMerma: (id: number, cantidad: number, motivo: string) =>
    req<Ingrediente>(`/inventario/ingredientes/${id}/merma`, {
      method: 'POST',
      body: JSON.stringify({ cantidad, motivo }),
    }),
  ajustarStock: (id: number, stock_real: number) =>
    req<Ingrediente>(`/inventario/ingredientes/${id}/ajustar`, {
      method: 'POST',
      body: JSON.stringify({ stock_real, motivo: 'Conteo fisico' }),
    }),
  sugerenciasCompra: () => req<SugerenciaCompra[]>('/inventario/sugerencias'),

  verReceta: (varianteId: number) => req<RecetaItem[]>(`/inventario/recetas/${varianteId}`),
  actualizarReceta: (varianteId: number, items: { ingrediente_id: number; cantidad_por_unidad: number }[]) =>
    req<RecetaItem[]>(`/inventario/recetas/${varianteId}`, { method: 'PUT', body: JSON.stringify(items) }),

  listarGastos: () => req<Gasto[]>('/caja/gastos'),
  crearGasto: (descripcion: string, categoria: string, monto: number) =>
    req<Gasto>('/caja/gastos', {
      method: 'POST',
      body: JSON.stringify({ descripcion, categoria, monto }),
    }),
  eliminarGasto: (id: number) => req(`/caja/gastos/${id}`, { method: 'DELETE' }),

  reporte: (periodo: Periodo) => req<ReporteResumen>(`/reportes/resumen?periodo=${periodo}`),

  listarRespaldos: () => req<Respaldo[]>('/respaldos'),
  crearRespaldo: () => req<{ ok: boolean; archivo: string }>('/respaldos/crear', { method: 'POST' }),

  obtenerConfig: () => req<Configuracion>('/config'),
  actualizarConfig: (tasa_bcv: number) =>
    req<Configuracion>('/config', { method: 'PUT', body: JSON.stringify({ tasa_bcv }) }),

  reporteCombos: (periodo: Periodo) => req<ReporteCombos>(`/reportes/combos?periodo=${periodo}`),
  sugerencias: (varianteIds: number[]) =>
    req<Sugerencia[]>(`/pedidos/sugerencias?variantes=${varianteIds.join(',')}`),

  estadoTasa: () => req<EstadoTasa>('/tasas'),
  refrescarTasa: (forzar = false) =>
    req<EstadoTasa>(`/tasas/refrescar?forzar=${forzar}`, { method: 'POST' }),
  fijarTasa: (bcv: number, paralelo?: number) =>
    req<EstadoTasa>('/tasas', { method: 'PUT', body: JSON.stringify({ bcv, paralelo }) }),
  historialTasa: (dias = 30) => req<PuntoTasa[]>(`/tasas/historial?dias=${dias}`),

  resumenCaja: () => req<ResumenCaja>('/caja/resumen'),
  cerrarCaja: (efectivo_contado: number, nota = '') =>
    req<CierreCaja>('/caja/cerrar', { method: 'POST', body: JSON.stringify({ efectivo_contado, nota }) }),
  listarCierres: () => req<CierreCaja[]>('/caja/cierres'),

  planCuentas: () => req<CuentaContable[]>('/contabilidad/plan-cuentas'),
  crearCuenta: (c: Omit<CuentaContable, 'id'>) =>
    req<CuentaContable>('/contabilidad/plan-cuentas', { method: 'POST', body: JSON.stringify(c) }),
  listarAsientos: (limite = 100) => req<AsientoContable[]>(`/contabilidad/asientos?limite=${limite}`),
  crearAsiento: (descripcion: string, lineas: { cuenta_id: number; debe: number; haber: number }[]) =>
    req<AsientoContable>('/contabilidad/asientos', {
      method: 'POST',
      body: JSON.stringify({ descripcion, lineas }),
    }),
  eliminarAsiento: (id: number) => req(`/contabilidad/asientos/${id}`, { method: 'DELETE' }),
  libroMayor: (cuentaId: number) => req<FilaMayor[]>(`/contabilidad/mayor/${cuentaId}`),
  balanceComprobacion: () => req<FilaBalanceComprobacion[]>('/contabilidad/balance-comprobacion'),
  estadoResultadosContable: (periodo: Periodo) =>
    req<EstadoResultadosContable>(`/contabilidad/estado-resultados?periodo=${periodo}`),
  balanceGeneral: () => req<BalanceGeneral>('/contabilidad/balance-general'),

  listarFacturasCompra: (dias = 60) => req<FacturaCompra[]>(`/compras/facturas?dias=${dias}`),
  crearFacturaCompra: (f: {
    numero_factura: string
    proveedor_nombre: string
    proveedor_rif?: string
    categoria: string
    forma_pago: string
    descripcion?: string
    // Con renglones (compra de insumos): cada uno actualiza stock y costo
    // promedio de su ingrediente, y la base se calcula sola sumandolos.
    items?: { ingrediente_id: number; cantidad: number; costo_unitario: number }[]
    // Sin renglones (servicios, activos...): se carga la base a mano.
    base_imponible?: number
    iva?: number
  }) => req<FacturaCompra>('/compras/facturas', { method: 'POST', body: JSON.stringify(f) }),
  eliminarFacturaCompra: (id: number) => req(`/compras/facturas/${id}`, { method: 'DELETE' }),

  configFiscal: () => req<ConfiguracionFiscal>('/impuestos/config'),
  actualizarConfigFiscal: (tasa_iva: number) =>
    req<ConfiguracionFiscal>('/impuestos/config', { method: 'PUT', body: JSON.stringify({ tasa_iva }) }),
  libroVentas: (periodo: Periodo) => req<LibroVentas>(`/impuestos/libro-ventas?periodo=${periodo}`),
  libroCompras: (periodo: Periodo) => req<LibroCompras>(`/impuestos/libro-compras?periodo=${periodo}`),
  resumenIva: (periodo: Periodo) => req<ResumenIva>(`/impuestos/resumen?periodo=${periodo}`),
}

export type WsEvent = { event: 'pedido_nuevo' | 'pedido_actualizado' | 'pedido_pagado'; data: Pedido }

export function connectWs(onEvent: (evt: WsEvent) => void): () => void {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  let ws: WebSocket
  let closed = false

  function connect() {
    ws = new WebSocket(`${proto}://${window.location.host}/ws`)
    ws.onmessage = (msg) => {
      try {
        onEvent(JSON.parse(msg.data))
      } catch {
        // ignore malformed message
      }
    }
    ws.onclose = () => {
      if (!closed) setTimeout(connect, 1500)
    }
  }
  connect()

  return () => {
    closed = true
    ws.close()
  }
}

export type {
  AsientoContable,
  BalanceGeneral,
  Categoria,
  CierreCaja,
  Configuracion,
  ConfiguracionFiscal,
  CuentaContable,
  EstadoResultadosContable,
  EstadoTasa,
  FacturaCompra,
  FilaBalanceComprobacion,
  FilaMayor,
  Gasto,
  Ingrediente,
  LibroCompras,
  LibroVentas,
  Pedido,
  PedidoItem,
  Periodo,
  Producto,
  ReporteResumen,
  PuntoTasa,
  ReporteCombos,
  RecetaItem,
  Respaldo,
  ResumenCaja,
  ResumenIva,
  Sugerencia,
  SugerenciaCompra,
  Variante,
}
