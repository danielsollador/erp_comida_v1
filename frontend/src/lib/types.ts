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
  costo_unitario: number
  rendimiento_pct: number
  costo_efectivo: number
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
  costo: number | null
  margen_pct: number | null
  sin_receta: boolean
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
  costo_insumos: number
  ganancia_bruta: number
  margen_pct: number
  gastos: number
  ganancia_neta: number
  pedidos_anulados: number
  valor_anulado: number
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
  items: PedidoItem[]
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

export type ResumenCaja = {
  fecha: string
  total_ventas: number
  por_metodo_pago: Record<string, number>
  saldo_anterior: number
  efectivo_esperado: number
  salidas_efectivo: number
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
