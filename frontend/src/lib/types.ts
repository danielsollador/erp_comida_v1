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
  /** Retirada del menu. Sus ventas historicas se conservan igual. */
  activo: boolean
  productos: Producto[]
}

export type Operador = {
  id: number
  nombre: string
  rol: string
  punto_venta: string
  activo: boolean
}

export type PuntoVenta = {
  id: number
  nombre: string
  activo: boolean
}

export type PedidoItem = {
  id: number
  /** null = venta libre, no esta en el menu. */
  variante_id: number | null
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
  /** Promedio ponderado: lo que costo el stock que hay en el deposito. */
  costo_unitario: number
  rendimiento_pct: number
  costo_efectivo: number
  /** Ultimo precio pagado: lo que cuesta REPONERLO hoy. null = nunca comprado. */
  costo_reposicion: number | null
  ultima_compra: string | null
  /** Cuanto subestima el promedio al costo de reponer, en %. */
  variacion_pct: number | null
}

export type CompraDeInsumo = {
  fecha: string
  cantidad: number
  costo_unitario: number
  origen: string
  referencia: string
}

export type ImpactoEnProducto = {
  variante_id: number
  nombre: string
  precio: number
  costo_antes: number
  costo_despues: number
  margen_antes_pct: number | null
  margen_despues_pct: number | null
  /** Precio que conserva el margen que tenia antes de la subida. */
  precio_sugerido: number | null
  a_perdida: boolean
  margen_flaco: boolean
}

export type ImpactoDeCompra = {
  ingrediente: Ingrediente
  costo_anterior: number
  costo_pagado: number
  salto_pct: number | null
  revisar_precios: boolean
  /** Aviso cuando el salto parece error de unidad (un saco tecleado como 1). */
  posible_error_de_unidad: string | null
  productos: ImpactoEnProducto[]
}

export type InsumoInflacion = {
  ingrediente_id: number
  nombre: string
  costo_inicial: number
  costo_actual: number
  cambio_pct: number
}

export type InflacionInsumos = {
  dias: number
  cambio_pct: number
  insumos: InsumoInflacion[]
}

export type RecetaItem = {
  id: number
  ingrediente_id: number
  ingrediente_nombre: string
  unidad: string
  cantidad_por_unidad: number
}

export type Gasto = {
  id: number
  descripcion: string
  categoria: string
  monto: number
  metodo_pago: 'Efectivo' | 'Banco'
  fecha: string
}

export type PuntoSerie = {
  etiqueta: string
  ventas: number
  pedidos: number
}

export type ProductoVendido = {
  nombre: string
  unidades: number
  ingresos: number
  costo: number
  ganancia: number
  margen_pct: number
  /** Sin receta cargada: el costo es 0 y el margen no significa nada. */
  sin_receta: boolean
}

export type CambioPrecio = {
  id: number
  variante_id: number
  precio_anterior: number
  precio_nuevo: number
  fecha: string
}

export type CostoVariante = {
  variante_id: number
  /** Costo contable: promedio ponderado del inventario que ya compraste. */
  costo: number | null
  margen_pct: number | null
  sin_receta: boolean
  /** Lo que costaria producirlo con los precios de hoy. */
  costo_reposicion: number | null
  margen_reposicion_pct: number | null
  /** Precio que conserva el margen actual si tuvieras que reponer hoy. */
  precio_sugerido: number | null
}

export type Insight = {
  tipo: 'bueno' | 'alerta' | 'info'
  titulo: string
  detalle: string
}

export type Periodo = 'dia' | 'semana' | 'mes'

export type ReporteResumen = {
  periodo: Periodo
  etiqueta: string
  ventas: number
  ventas_bs: number
  iva_cobrado: number
  ingresos_netos: number
  pedidos: number
  ticket_promedio: number
  /** Lo que gasta el cliente del medio: el promedio lo mueve un solo pedido. */
  ticket_mediano: number
  costo_insumos: number
  ganancia_bruta: number
  margen_pct: number
  gastos: number
  ganancia_neta: number
  pedidos_anulados: number
  valor_anulado: number
  devoluciones: number
  valor_devuelto: number
  por_metodo_pago: Record<string, number>
  serie: PuntoSerie[]
  top_productos: ProductoVendido[]
  insights: Insight[]
}

export type ActivoFijo = {
  id: number
  nombre: string
  valor: number
  fecha_compra: string
  vida_util_meses: number
  cuota_mensual: number
  depreciacion_acumulada: number
  valor_en_libros: number
  meses_depreciados: number
  dado_de_baja: boolean
  fecha_baja: string | null
  motivo_baja: string
}

export type ProblemaContable = {
  gravedad: 'grave' | 'aviso'
  titulo: string
  detalle: string
}

export type SaludContable = {
  sano: boolean
  problemas: ProblemaContable[]
}

export type Merma = {
  id: number
  ingrediente_id: number
  ingrediente_nombre: string
  unidad: string
  cantidad: number
  valor: number
  motivo: string
  fecha: string
  revertida: boolean
}

export type SugerenciaCompra = {
  ingrediente_id: number
  ingrediente_nombre: string
  unidad: string
  stock_actual: number
  stock_minimo: number
  cantidad_sugerida: number
  dias_restantes: number | null
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
  facturado: boolean
  numero_factura: string | null
  /** Tasa a la que se cobro. Para montos historicos manda esta, no la de hoy. */
  tasa_bcv: number | null
  /** El cliente trajo la comida de vuelta: la venta se revirtio entera. */
  devuelto: boolean
  nota_credito: string | null
  /** Precio de lista antes de rebajas; `total` ya viene con el descuento. */
  subtotal: number
  descuento: number
  motivo_descuento: string
  /** Plata del empleado: no suma a la venta ni al IVA. */
  propina: number
  /** `total` + propina: lo que de verdad se recibe. */
  a_cobrar: number
  cliente: string
  fiado_saldado: boolean
  operador: string
  punto_venta: string
  anulado_por: string
  /** Un pedido puede pagarse con varias formas a la vez. */
  pagos: {
    metodo: string
    monto: number
    recibido: number | null
    vuelto_metodo: string | null
    vuelto_monto: number
  }[]
  items: PedidoItem[]
}

export type Gaveta = {
  codigo: string
  etiqueta: string
  saldo_anterior: number
  entradas_hoy: number
  salidas_hoy: number
  esperado: number
}

export type CuentaPorCobrar = {
  pedido_id: number
  numero: number
  cliente: string
  monto: number
  fecha: string
  dias: number
}

export type TicketLinea = {
  nombre: string
  cantidad: number
  precio_unitario: number
  subtotal: number
}

export type Ticket = {
  pedido_id: number
  numero: number
  fecha: string
  estado: string
  items: TicketLinea[]
  subtotal: number
  descuento: number
  propina: number
  total: number
  a_cobrar: number
  tasa_bcv: number | null
  total_bs: number | null
  facturado: boolean
  numero_factura: string | null
  base_imponible: number | null
  iva: number | null
  pagos: { metodo: string; monto: number; recibido: number | null; vuelto_monto: number }[]
  cliente: string
  operador: string
  punto_venta: string
}

export type CambioReceta = {
  id: number
  variante_id: number
  composicion: string
  costo_resultante: number
  fecha: string
}

export type SobranteInventario = {
  id: number
  ingrediente_id: number
  ingrediente_nombre: string
  unidad: string
  cantidad: number
  valor: number
  motivo: string
  fecha: string
  revertido: boolean
}

export type NotaCreditoCompra = {
  id: number
  factura_id: number
  numero: string
  tipo: 'devolucion' | 'descuento'
  fecha: string
  base_imponible: number
  iva: number
  total: number
  motivo: string
  items: {
    id: number
    ingrediente_id: number
    ingrediente_nombre: string
    unidad: string
    cantidad: number
    costo_unitario: number
    subtotal: number
  }[]
}

export type CuentaContable = {
  id: number
  codigo: string
  nombre: string
  tipo: 'activo' | 'pasivo' | 'patrimonio' | 'ingreso' | 'costo' | 'gasto'
  naturaleza: 'deudora' | 'acreedora'
  activa: boolean
}

export type MovimientoContable = {
  id: number
  cuenta_id: number
  cuenta_codigo: string
  cuenta_nombre: string
  debe: number
  haber: number
}

export type AsientoContable = {
  id: number
  fecha: string
  descripcion: string
  origen: string
  referencia_id: number | null
  movimientos: MovimientoContable[]
}

export type FilaMayor = {
  asiento_id: number
  fecha: string
  descripcion: string
  origen: string
  debe: number
  haber: number
  saldo: number
}

export type FilaBalanceComprobacion = {
  cuenta_id: number
  codigo: string
  nombre: string
  tipo: string
  debe: number
  haber: number
  saldo: number
}

export type EstadoResultadosContable = {
  periodo: Periodo
  etiqueta: string
  ingresos: number
  costos: number
  utilidad_bruta: number
  gastos: number
  utilidad_neta: number
  detalle_ingresos: FilaBalanceComprobacion[]
  detalle_costos: FilaBalanceComprobacion[]
  detalle_gastos: FilaBalanceComprobacion[]
}

export type BalanceGeneral = {
  fecha: string
  activos: FilaBalanceComprobacion[]
  pasivos: FilaBalanceComprobacion[]
  patrimonio: FilaBalanceComprobacion[]
  utilidad_acumulada: number
  total_activos: number
  total_pasivos: number
  total_patrimonio: number
  cuadra: boolean
}

export type Configuracion = {
  tasa_bcv: number
}

export type Respaldo = {
  nombre: string
  tamano_kb: number
  creado_en: string
}

export type EstadoRespaldos = {
  ultimo_respaldo: string | null
  cantidad: number
  /** Hasta que fecha se puede volver atras de verdad. */
  dia_mas_viejo: string | null
  ultima_descarga: string | null
  /** Hace cuanto nadie saca una copia de esta maquina. null = nunca. */
  dias_sin_descargar: number | null
  /** Carpeta externa (USB/Drive) donde se copia el ultimo respaldo. */
  copia_externa: string | null
  restauracion_reciente: Restauracion | null
}

export type PrevisualizacionRestauracion = {
  valido: boolean
  motivo: string
  /** Fecha de la ultima venta que tiene el respaldo. */
  corte: string | null
  pedidos_en_el_respaldo: number
  /** null = no se pudo medir. NO es cero: hay que advertirlo, no tranquilizar. */
  pedidos_que_se_pierden: number | null
  monto_que_se_pierde: number | null
}

export type Restauracion = {
  fecha: string
  restaurado_desde: string
  /** Copia de la base que habia ANTES, por si restaurar fue el error. */
  respaldo_previo: string
  pedidos_perdidos: number | null
  monto_perdido: number | null
  corte: string | null
}

export type ResumenCaja = {
  fecha: string
  total_ventas: number
  por_metodo_pago: Record<string, number>
  saldo_anterior: number
  efectivo_esperado: number
  salidas_efectivo: number
  /** Parte de salidas_efectivo que se llevo el dueno (no es gasto del negocio). */
  retiros_hoy: number
  cantidad_pedidos: number
  /** Bolivares y divisas son dos montones de billetes: dos conteos. */
  gavetas: Gaveta[]
  /** Plata en la gaveta que no es del negocio. */
  propinas_por_entregar: number
  fiado_por_cobrar: number
  propinas_hoy: number
  descuentos_hoy: number
}

export type RetiroPropietario = {
  id: number
  monto: number
  metodo_pago: 'Efectivo' | 'Banco'
  nota: string
  fecha: string
}

export type CierreCaja = {
  id: number
  fecha: string
  total_sistema: number
  efectivo_esperado: number
  efectivo_contado: number
  diferencia: number
  nota: string
  /** Un cierre mal contado no se borra: se anula y queda el rastro. */
  anulado: boolean
  motivo_anulacion: string
  operador: string
  punto_venta: string
  divisas_esperado: number
  divisas_contado: number
  divisas_diferencia: number
}

export type EstadoTasa = {
  fecha: string
  bcv: number | null
  eur: number | null
  paralelo: number | null
  brecha_pct: number | null
  variacion_semana_pct: number | null
  origen: 'auto' | 'manual' | null
  actualizado_en: string | null
  en_vivo: boolean
  /** Hace cuanto se hablo con BCV/Binance. null = nunca desde que arranco. */
  minutos_sin_contacto: number | null
  fuente_actualizada: string | null
  desactualizada: boolean
}

export type PuntoTasa = {
  fecha: string
  bcv: number
  paralelo: number | null
  origen: string
}

export type ParCombo = {
  producto: string
  acompanante: string
  juntos: number
  confianza_pct: number
  lift: number
}

export type Acompanamiento = {
  con_bebida: number
  sin_bebida: number
  con_bebida_pct: number
  sin_bebida_pct: number
}

export type OportunidadCombo = {
  pedidos_sin_bebida: number
  ticket_bebida: number
  venta_potencial: number
  ganancia_potencial: number
  conversion_supuesta_pct: number
}

export type ReporteCombos = {
  periodo: Periodo
  etiqueta: string
  pedidos_analizados: number
  suficientes_datos: boolean
  pares: ParCombo[]
  acompanamiento: Acompanamiento | null
  oportunidad: OportunidadCombo | null
}

export type Sugerencia = {
  variante_id: number
  etiqueta: string
  precio: number
  es_bebida: boolean
}

export type LineaFactura = {
  id: number
  ingrediente_id: number
  ingrediente_nombre: string
  unidad: string
  cantidad: number
  costo_unitario: number
  subtotal: number
}

export type FacturaCompra = {
  id: number
  numero_factura: string
  proveedor_nombre: string
  proveedor_rif: string | null
  fecha: string
  categoria: 'Insumos' | 'Servicios' | 'Activos' | 'Otros'
  forma_pago: 'Efectivo' | 'Banco' | 'Credito'
  base_imponible: number
  iva: number
  descripcion: string
  total: number
  pagada: boolean
  fecha_vencimiento: string | null
  fecha_pago: string | null
  items: LineaFactura[]
}

export type ConfiguracionFiscal = {
  tasa_iva: number
}

export type FilaLibroVentas = {
  pedido_id: number
  fecha: string
  numero_factura: string
  cliente: string
  base_imponible: number
  iva: number
  total: number
}

export type LibroVentas = {
  periodo: Periodo
  etiqueta: string
  tasa_iva: number
  filas: FilaLibroVentas[]
  total_base: number
  total_iva: number
  total_general: number
  ventas_no_facturadas: number
  monto_no_facturado: number
}

export type FilaLibroCompras = {
  factura_id: number
  fecha: string
  numero_factura: string
  proveedor_nombre: string
  proveedor_rif: string | null
  base_imponible: number
  iva: number
  total: number
}

export type LibroCompras = {
  periodo: Periodo
  etiqueta: string
  filas: FilaLibroCompras[]
  total_base: number
  total_iva: number
  total_general: number
}

export type DeclaracionIva = {
  id: number
  anio: number
  mes: number
  periodo: string
  etiqueta: string
  iva_debito: number
  iva_credito: number
  /** Excedente de credito fiscal que venia del mes anterior. */
  credito_arrastrado: number
  credito_usado: number
  iva_a_pagar: number
  /** Lo que sobra y pasa al mes siguiente. */
  credito_excedente: number
  fecha_declaracion: string
  pagada: boolean
  fecha_pago: string | null
  forma_pago: string | null
}

export type PeriodoPendiente = {
  anio: number
  mes: number
  etiqueta: string
  iva_debito: number
  iva_credito: number
}

export type ResumenIva = {
  periodo: Periodo
  etiqueta: string
  iva_debito: number
  iva_credito: number
  iva_a_pagar: number
}

// ------------------------------------------------------------------ acceso
export type Rol = 'admin' | 'dueno' | 'caja' | 'cocina'

export type EstadoAcceso = {
  autenticado: boolean
  es_hub: boolean
  /** Direccion del hub (vertigopro.tech). Vacia en el propio hub. */
  hub_url: string
  local: { slug: string; nombre: string; dominio: string; url: string; logo: string; favicon: string }
  locales: { slug: string; nombre: string; descripcion: string; url: string; dominio: string }[]
  usuario: string | null
  rol: Rol | null
  /** Lo dice el servidor; el frontend no deduce permisos del rol. */
  puede: { vertigo: boolean; administrar: boolean; operar: boolean; cocina: boolean }
  configurado: boolean
  problema: string | null
}

export type Usuario = {
  usuario: string
  rol: Rol
  locales: string[]
  creado: number | null
  ultimo_acceso: number | null
}

export type ListaUsuarios = {
  usuarios: Usuario[]
  yo: string
  roles: { rol: Rol; descripcion: string }[]
  locales: { slug: string; nombre: string }[]
}
