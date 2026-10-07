export type Variante = {
  id: number
  producto_id: number
  nombre: string
  precio: number
  activo: boolean
  /** Pasa por la freidora: carga su parte del aceite por pieza. */
  se_frie?: boolean | null
}

export type Producto = {
  id: number
  categoria_id: number
  nombre: string
  activo: boolean
  /** Su puesto dentro de la categoría: el orden del menú y del mostrador. */
  orden?: number
  variantes: Variante[]
}

export type Categoria = {
  id: number
  nombre: string
  orden: number
  /** Retirada del menu. Sus ventas historicas se conservan igual. */
  activo: boolean
  productos: Producto[]
  /** Lo que hay aqui se toma: sirve para ofrecer algo de tomar con la comida. */
  bebida: boolean
  /** El tinte con el que se pinta en el mostrador. Vacio = el automatico. */
  color: string
  /** Lo de aqui se prepara en cocina. Es la sugerencia al comandar: la cajera
   *  la puede cambiar renglón por renglón. */
  va_a_cocina: boolean
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
  /** Regalado: precio 0 en la cuenta; `precio_lista` es lo que habría costado. */
  cortesia: boolean
  precio_lista: number
  /** Pasó por cocina. Con `preparado`: en cocina / cocina lo terminó / de vitrina. */
  a_cocina: boolean
}

export type TipoArticulo = 'insumo' | 'reventa' | 'consumible' | 'desechable' | 'preparacion'

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
  /** Que es: ver lib/tiposArticulo.ts. "insumo" se lee "Materia prima". */
  tipo: TipoArticulo
  /** Preparaciones: cuanto sale de una tanda de su receta. */
  rinde?: number
  /** Preparaciones: se descuenta del crudo al vender, o se produce por tandas. */
  modo_produccion?: 'descontar' | 'producir'
  vida_util_horas?: number | null
  /** El aceite de freir: no va en recetas, se reparte por pieza frita. */
  es_indirecto?: boolean
  /** En que cajon del deposito vive. null = sin clasificar, que es normal. */
  categoria_id: number | null
  /** El nombre de esa categoria, ya resuelto por el servidor. '' si no tiene. */
  categoria: string
  /** false = archivado: no se lista para comprar ni entra en sugerencias. */
  activo: boolean
  /** Exento de IVA (la mayoria de alimentos basicos en Venezuela lo son). */
  exento: boolean
  costo_efectivo: number
  /** Ultimo precio pagado: lo que cuesta REPONERLO hoy. null = nunca comprado. */
  costo_reposicion: number | null
  ultima_compra: string | null
  /** Cuanto subestima el promedio al costo de reponer, en %. */
  variacion_pct: number | null
}

/** Lo que se escribe de un insumo (el resto lo calcula el sistema). */
export type DatosIngrediente = Pick<
  Ingrediente,
  | 'nombre'
  | 'unidad'
  | 'stock_minimo'
  | 'stock_objetivo'
  | 'costo_unitario'
  | 'rendimiento_pct'
  | 'tipo'
  | 'categoria_id'
  | 'activo'
  | 'exento'
> &
  Partial<Pick<Ingrediente, 'rinde' | 'modo_produccion' | 'vida_util_horas' | 'es_indirecto'>> & {
  /** Solo al crear: lo que hay hoy. Despues el stock se mueve con compras, mermas y conteos. */
  stock_actual?: number
}

export type AjusteConteo = {
  ingrediente_id: number
  nombre: string
  unidad: string
  sistema: number
  contado: number
  /** contado - sistema: negativo es faltante (merma), positivo sobrante. */
  diferencia: number
  valor: number
}

export type ResultadoConteo = {
  ajustes: AjusteConteo[]
  faltante_valor: number
  sobrante_valor: number
  sin_cambio: number
  /** La planilla que quedó guardada, para poder abrirla después. */
  conteo_id: number | null
}

export type ConteoResumen = {
  id: number
  fecha: string
  motivo: string
  operador: string | null
  /** Se contó sin ver en pantalla lo que el sistema esperaba. */
  ciego: boolean
  contados: number
  cuadraron: number
  faltante_valor: number
  sobrante_valor: number
  /** Sobrante menos faltante: negativo es lo que el conteo dice que se perdió. */
  neto: number
}

export type ConteoLinea = {
  ingrediente_id: number
  nombre: string
  unidad: string
  sistema: number
  contado: number
  diferencia: number
  costo_unitario: number
  valor: number
}

export type ConteoDetalle = ConteoResumen & {
  lineas: ConteoLinea[]
}

export type FilaLeida = {
  ingrediente_id: number
  nombre: string
  unidad: string
  contado: number
}

/** Lo que el ERP entendió de la planilla llena. Leerla no guarda nada. */
export type PlanillaLeida = {
  filas: FilaLeida[]
  /** Renglones que no se pudieron leer, en palabras, para arreglar el archivo. */
  errores: string[]
  /** Renglones sin nada escrito en "Contado": se ignoran. */
  en_blanco: number
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
  /** Cuántas cosas salieron en ese tramo. */
  unidades: number
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
  /** De que producto del menu es (null en la venta libre): para filtrar tocándolo. */
  producto_id: number | null
  /** En qué categoría está hoy. */
  categoria: string
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
  /** Su parte del aceite de freir por pieza (0 si no se frie). */
  costo_indirecto?: number
  /** El costo con que se decide el precio (segun Configuracion), indirecto incluido. */
  costo_para_precio?: number | null
  margen_para_precio_pct?: number | null
}

/** Lo que la portada le dice al dueño sin que lo pregunte. `a` = adónde ir. */
/** Una estacion del recorrido de la portada (Compras > ... > Cierre de caja). */
export type PasoRecorrido = {
  id: 'compras' | 'inventario' | 'menu' | 'ventas' | 'caja'
  /** Puede traer "{monto}": se escribe con `fmt` en la moneda que se mira. */
  frase: string
  pendiente: boolean
  monto: number | null
  a: string
  accion: string
}
export type Recorrido = { pasos: PasoRecorrido[]; ultimos_7_dias: { fecha: string; ventas: number }[] }

export type Aviso = { id: string; tono: 'ojo' | 'bien' | 'info'; titulo: string; detalle: string; a: string }

/** Cuánto lleva armado el local: las misiones de arranque de la portada. */
export type ArranqueLocal = { productos: number; con_receta: number; mercancias: number; ventas: number; cierres: number }

export type Insight = {
  tipo: 'bueno' | 'alerta' | 'info'
  titulo: string
  detalle: string
}

/** Una celda del mapa de calor: pedidos de ese dia de la semana a esa hora. */
export type PuntoCalor = { dia: number; hora: number; pedidos: number; ventas: number }

export type GrupoReporte = {
  nombre: string
  ventas: number
  pedidos: number
  /** Sobre las ventas del periodo. */
  pct: number
  /** La categoría del menú, si el grupo es una: para filtrar tocándola. */
  id: number | null
  /** Solo para dias de la semana: lo que vende ese dia TIPICO. */
  promedio: number | null
}

/** El periodo inmediatamente anterior, del mismo tamaño. */
export type Comparativa = {
  etiqueta: string
  ventas: number
  pedidos: number
  ticket_promedio: number
  ganancia_neta: number
  cambio_ventas_pct: number | null
  cambio_pedidos_pct: number | null
  cambio_ticket_pct: number | null
  cambio_ganancia_pct: number | null
}

/** Lo que se está mirando cuando Reportes se filtra por el menú. */
export type FiltroMenu = {
  categoria_id: number | null
  categoria: string
  producto_id: number | null
  producto: string
}

/** Lo mismo para Pérdidas e Inventario, que se miran por cajón y mercancía. */
export type FiltroDeposito = {
  categoria_id: number | null
  categoria: string
  ingrediente_id: number | null
  ingrediente: string
}

export type ReporteResumen = {
  periodo: string
  etiqueta: string
  /** El paso de `serie`: hora | dia | semana | mes. Lo decide el tamaño del rango. */
  granularidad: string
  ventas: number
  ventas_bs: number
  iva_cobrado: number
  ingresos_netos: number
  pedidos: number
  /** Cuántas cosas se vendieron, sumando los renglones. */
  unidades: number
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
  facturadas: number
  valor_facturado: number
  por_metodo_pago: Record<string, number>
  serie: PuntoSerie[]
  top_productos: ProductoVendido[]
  insights: Insight[]
  anterior: Comparativa | null
  /** La serie del periodo anterior, alineada tramo a tramo con `serie`. */
  serie_anterior: PuntoSerie[]
  /** Vacio si el rango es de un solo dia. */
  calor: PuntoCalor[]
  por_categoria: GrupoReporte[]
  /** Lunes a domingo. Vacio si el rango es de un solo dia. */
  por_dia_semana: GrupoReporte[]
  /** Cuando se guardaron los dias pasados en el mart. null = todo en vivo. */
  consolidado_en: string | null
  /** Si se está mirando una categoría o un producto y no el negocio entero. */
  filtro: FiltroMenu | null
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
  /** Salió de un conteo, no de un accidente: son dos problemas distintos. */
  por_conteo: boolean
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
  /** Cuando se cobro. Null mientras siga sin cobrar. */
  cerrado_en: string | null
  /** false = no pasó por cocina: comida de vitrina, ya hecha. */
  a_cocina: boolean
  /** Cuando se le entregó al cliente. Null = sigue en la barra esperando. */
  entregado_en: string | null
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
  /** null si no esta anulado. True = se preparo y se perdio. False = volvio al inventario. */
  anulado_es_perdida: boolean | null
  /** Un pedido puede pagarse con varias formas a la vez. */
  pagos: {
    /** Para corregir despues como se pago (ver `api.corregirPagos`). */
    id?: number | null
    metodo: string
    monto: number
    recibido: number | null
    vuelto_metodo: string | null
    vuelto_monto: number
    /** Numero de confirmacion del pago movil, ticket o comprobante. Vacio en efectivo. */
    referencia: string
    /** La consulta al banco que respaldo la referencia (Pabilo). null = anotada a mano. */
    verificacion_id?: number | null
  }[]
  items: PedidoItem[]
  /**
   * Los dos candados entre cocina y punto de venta. Van como fecha, no como
   * booleano: la pantalla muestra desde cuando, y el de edicion vence solo
   * (ver MINUTOS_EDITANDO en el backend), asi que quien lo lee decide si
   * sigue vivo.
   */
  cocinando_desde: string | null
  cocinando_por: string
  editando_desde: string | null
  editando_por: string
  /** Cambio despues de tomado. Se pinta en cocina y en ventas. */
  editado: boolean
  editado_en: string | null
  ediciones: PedidoEdicion[]
}
export type PedidoEdicion = {
  id: number
  fecha: string
  /** Que cambio, en palabras: "+1 Refresco; quitado Empanada (x2)". */
  detalle: string
  total_antes: number
  total_despues: number
  diferencia: number
  /** Por donde entro o salio la diferencia. Vacio si no movio plata. */
  metodo_pago: string
  motivo: string
  operador: string
  /** Quien puso la clave. Vacio si la edicion no movio plata cobrada. */
  autorizado_por: string
}

/** Una fila del cierre ya guardado: lo que decia el sistema contra lo contado. */
export type LineaCierre = {
  /** La forma de pago que se contó. Los cierres viejos no la tienen. */
  metodo: string
  cuenta: string
  etiqueta: string
  metodos: string
  esperado: number
  contado: number
  diferencia: number
}

/**
 * Con cuanta plata arranco una gaveta el dia que se estreno el sistema.
 *
 * Los libros empiezan en cero pero el local no. Sin declararlo, la primera
 * compra pagada en efectivo deja la cuenta en negativo y el primer cierre
 * reporta un sobrante que no existe.
 */

export type CuentaPorCobrar = {
  pedido_id: number
  numero: number
  cliente: string
  /** Lo que debe HOY: la venta menos lo que haya abonado. */
  monto: number
  original: number
  abonado: number
  abonos: number
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
  pagos: { metodo: string; monto: number; recibido: number | null; vuelto_monto: number; referencia: string }[]
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
  periodo: string
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
  /** Mientras está prendido, una venta se hace aunque falte inventario. */
  vender_sin_inventario: boolean
  /** Con que costo se miran margenes y precios: los libros van siempre a promedio. */
  costo_para_precios?: CostoParaPrecios
}

export type CostoParaPrecios = 'reposicion' | 'promedio' | 'mayor'

// ── Preparaciones y produccion (docs/plan-compras-inventario-produccion.md) ──

export type LineaPreparacion = {
  ingrediente_id: number
  nombre: string
  unidad: string
  tipo: TipoArticulo
  cantidad: number
  /** Lo que aporta al costo de una tanda, a costo de hoy. */
  costo: number
}

export type Preparacion = {
  id: number
  nombre: string
  unidad: string
  rinde: number
  modo_produccion: 'descontar' | 'producir'
  vida_util_horas: number | null
  stock_actual: number
  lineas: LineaPreparacion[]
  costo_tanda: number
  costo_unitario: number
  /** Lo que rindieron las ultimas tandas contra la receta (1 = exacto). */
  rendimiento_real: number | null
  tandas: number
}

export type DatosPreparacion = {
  nombre: string
  unidad: string
  rinde: number
  modo_produccion: 'descontar' | 'producir'
  vida_util_horas: number | null
  lineas: { ingrediente_id: number; cantidad: number }[]
}

export type Produccion = {
  id: number
  fecha: string
  preparacion_id: number
  preparacion: string
  unidad: string
  cantidad: number
  cantidad_esperada: number
  rendimiento_real: number | null
  costo_total: number
}

export type Disponibilidad = {
  preparacion_id: number
  nombre: string
  unidad: string
  stock_actual: number
  potencial: number | null
  limita: string | null
  comparte_con: string[]
}

export type CostoTeoricoFila = {
  ingrediente_id: number
  nombre: string
  unidad: string
  teorico: number
  mermas: number
  diferencia_conteo: number
  valor_teorico: number
  valor_diferencia: number
  pct_desvio: number | null
}

export type CostoIndirecto = {
  ingrediente_id: number
  nombre: string
  unidad: string
  cargado: number
  valor: number
  piezas: number
  por_pieza: number | null
  cantidad_por_pieza: number | null
}

export type Respaldo = {
  nombre: string
  tamano_kb: number
  creado_en: string
}

/** El ultimo intento de respaldo que fallo, si aun no hubo uno bueno despues. */
export type FalloRespaldo = { fecha: string; motivo: string; error: string }

export type EstadoRespaldos = {
  ultimo_respaldo: string | null
  /** Horas que lleva la base sin una copia. Si pasa de `intervalo_horas`, algo falla. */
  horas_sin_respaldo: number | null
  intervalo_horas: number
  ultimo_fallo: FalloRespaldo | null
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

/** Una forma de pago, lista para cuadrar. */
export type LineaMetodo = {
  metodo: string
  /** La cuenta contable donde cae. Varias formas comparten una (1020). */
  cuenta: string
  /** true = billetes que se cuentan; false = se coteja contra una pantalla. */
  fisico: boolean
  /** El crédito se muestra pero no se cuenta: no entró plata. */
  se_cuadra: boolean
  saldo_anterior: number
  /**
   * Con cuánto arrancó la gaveta este día: lo contado al abrir, o lo que
   * quedó de ayer si nadie abrió. La fila suma a la vista con esto:
   * fondo + ventas + otras entradas − salidas = esperado.
   */
  fondo: number
  /** true = lo contó una persona al abrir, no es solo el arrastre contable. */
  fondo_declarado: boolean
  ventas: number
  salidas: number
  /** Lo que movió la cuenta sin ser venta, gasto ni retiro. */
  otros: number
  esperado: number
  /** Lo que el cajero reportó al cerrar. null = el día no se ha cerrado, o esa
   *  forma de pago no se verificó. */
  contado: number | null
  /** En cuánto falló lo reportado contra lo que debía haber. */
  diferencia: number | null
}

/** Lo que movió una cuenta compartida sin poder atribuirse a una forma de pago. */
export type OtroMovimiento = {
  cuenta: string
  etiqueta: string
  monto: number
}

/** Un cobro suelto del día, para cotejarlo contra el lote del punto o el banco. */
export type CobroDelDia = {
  metodo: string
  /** "venta": el cobro de una comanda; "abono": un pago contra un fiado. */
  tipo: 'venta' | 'abono'
  pedido_id: number
  numero: number
  cliente: string
  fecha: string | null
  monto: number
  /** La tasa a la que se cobró. null = no se sabe: se usa la de hoy. */
  tasa: number | null
  referencia: string
  cobrado_por: string
  /** La misma referencia anotada dos veces en el día por la misma vía. */
  repetida: boolean
}

export type ResumenCaja = {
  fecha: string
  es_hoy: boolean
  vendido: number
  descuentos: number
  propinas: number
  /** vendido − descuentos + propinas: lo que de verdad había que cobrar. */
  a_cobrar: number
  /** La suma del desglose por forma de pago. */
  cobrado: number
  /** Si no da, hay un pago mal registrado. */
  cuadra_ventas: boolean
  cantidad_pedidos: number
  anulados_hoy: number
  anulado_monto_hoy: number
  devueltos_hoy: number
  devuelto_monto_hoy: number
  gastos: number
  retiros: number
  desglose: LineaMetodo[]
  otros_movimientos: OtroMovimiento[]
  fiado_por_cobrar: number
  propinas_por_entregar: number
  cerrada: boolean
  cierre_id: number | null
  /** Si la caja de ese día se abrió contando el fondo. */
  abierta: boolean
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
  /** Una fila por destino verificado, congelada como estaba al cerrar. */
  lineas: LineaCierre[]
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

export type PuntoAnalisisTasa = {
  fecha: string
  bcv: number
  eur: number | null
  paralelo: number | null
  brecha_pct: number | null
}

/** La serie de la tasa en un periodo y lo que el sistema lee en ella. */
export type AnalisisTasa = {
  etiqueta: string
  puntos: PuntoAnalisisTasa[]
  dias: number
  bcv_inicio: number | null
  bcv_fin: number | null
  bcv_min: number | null
  bcv_max: number | null
  variacion_pct: number | null
  brecha_inicio_pct: number | null
  brecha_fin_pct: number | null
  brecha_media_pct: number | null
  /** Lo cobrado con metodos en bolivares, en dolares. */
  cobrado_bs_usd: number
  /** Lo que de eso se lleva la brecha al reponer comprando divisas. */
  costo_brecha_usd: number
  lecturas: Insight[]
  /** Variacion promedio por dia calendario, y a donde llega en 30 dias si sigue igual. */
  ritmo_diario_pct: number | null
  proyeccion_30d: number | null
  proyeccion_30d_pct: number | null
  mayor_salto: SaltoTasa | null
  cobrado_total_usd: number
  cobrado_divisas_usd: number
  /** Que parte de lo cobrado entro en bolivares: la parte expuesta a la brecha. */
  exposicion_pct: number | null
  por_metodo_bs: GrupoMonto[]
  equivalencias: EquivalenciaTasa[]
  /** Cuanto subieron los insumos en el mismo periodo, si hubo compras que lo digan. */
  inflacion_insumos_pct: number | null
}

export type SaltoTasa = { fecha: string; de: number; a: number; pct: number }
export type EquivalenciaTasa = { usd: number; bs_inicio: number; bs_fin: number }
export type GrupoMonto = { nombre: string; monto: number; pct: number }

export type PuntoTasa = {
  fecha: string
  bcv: number
  /** Euro oficial del BCV. El banco lo fija aparte: no es el dolar convertido. */
  eur: number | null
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

/** Cuanto se perdio de UNA mercancia en el periodo. */
export type PerdidaPorInsumo = {
  ingrediente_id: number
  nombre: string
  unidad: string
  cantidad: number
  valor: number
  veces: number
  /** Sobre el valor total de las mermas del periodo. */
  pct: number
  /** Cuanto de esa perdida salio de un conteo y no de un accidente. */
  valor_conteo: number
}

export type PerdidaPorMotivo = { motivo: string; valor: number; veces: number }
export type PuntoPerdida = { etiqueta: string; valor: number; veces: number }

export type ReportePerdidas = {
  etiqueta: string
  granularidad: string
  ventas: number
  merma: number
  merma_registrada: number
  merma_por_conteo: number
  registros: number
  peso_pct: number
  consumo_personal: number
  merma_anterior: number
  cambio_pct: number | null
  por_insumo: PerdidaPorInsumo[]
  por_motivo: PerdidaPorMotivo[]
  serie: PuntoPerdida[]
  sin_merma: number
  anulados: number
  valor_anulado: number
  devoluciones: number
  valor_devuelto: number
  con_descuento: number
  valor_descuentos: number
  /** Lo regalado en ventas cobradas del período. */
  cortesias: number
  valor_cortesias: number
  costo_cortesias: number
  detalle: Merma[]
  insights: Insight[]
  filtro: FiltroDeposito | null
}

export type EstadoDeposito = 'agotado' | 'bajo' | 'ok' | 'sobra' | 'quieto'

export type InsumoDelDeposito = {
  ingrediente_id: number
  nombre: string
  unidad: string
  tipo: 'insumo' | 'reventa'
  cantidad: number
  stock_minimo: number
  costo_unitario: number
  valor: number
  pct: number
  por_dia: number
  dias_de_stock: number | null
  consumido: number
  estado: EstadoDeposito
}

export type ReporteInventario = {
  etiqueta: string
  dias: number
  valor_total: number
  valor_insumos: number
  valor_reventa: number
  activos: number
  bajo_minimo: number
  agotados: number
  sin_costo: number
  quietos: number
  valor_quieto: number
  consumido: number
  rotacion: number | null
  inflacion_pct: number | null
  inflacion: InsumoInflacion[]
  por_insumo: InsumoDelDeposito[]
  por_comprar: SugerenciaCompra[]
  insights: Insight[]
  filtro: FiltroDeposito | null
}

export type ReporteCombos = {
  periodo: string
  etiqueta: string
  pedidos_analizados: number
  suficientes_datos: boolean
  pares: ParCombo[]
  acompanamiento: Acompanamiento | null
  oportunidad: OportunidadCombo | null
  filtro: FiltroMenu | null
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
  /** Lo que dice el papel del proveedor, sin repartirle el recargo ni el descuento. */
  costo_unitario: number
  subtotal: number
  /** Si ESTE renglón pagó IVA. Se congela al cargar la factura. */
  exento: boolean
}

export type FacturaCompra = {
  id: number
  numero_factura: string
  proveedor_nombre: string
  proveedor_rif: string | null
  /** De registro: decide el período del Libro de Compras y la declaración. */
  fecha: string
  /** La impresa en el papel (AAAA-MM-DD). null en las cargadas antes de existir. */
  fecha_emision: string | null
  numero_control: string
  /** La moneda del papel; los montos de aquí siempre están en dólares. */
  moneda: '$' | 'Bs'
  /** Bs por $ con que pasa al Libro de Compras. null en las de antes. */
  tasa_bcv: number | null
  /** Retención de IVA practicada (agente de retención). */
  retencion_pct: number
  iva_retenido: number
  iva_retenido_bs: number | null
  comprobante_retencion: string
  /** Lo que se le paga al proveedor: total menos lo retenido. */
  a_pagar: number
  categoria: 'Insumos' | 'Servicios' | 'Activos' | 'Otros'
  forma_pago: 'Efectivo' | 'Banco' | 'Credito'
  /** Ya con el recargo y el descuento aplicados: la base que va al Libro de Compras. */
  base_imponible: number
  /** Lo que el proveedor sumó (flete, recargo por crédito) sobre el total. */
  recargo: number
  /** Lo que el proveedor rebajó (volumen, pronto pago). */
  descuento: number
  iva: number
  descripcion: string
  total: number
  pagada: boolean
  fecha_vencimiento: string | null
  fecha_pago: string | null
  /** El comprobante con que se le pagó al proveedor. Vacío si fue en efectivo. */
  referencia_pago: string
  items: LineaFactura[]
  /** Si tiene la foto del papel enganchada. */
  tiene_soporte?: boolean
}

/** Un renglón tal como viene impreso: todavía no es una mercancía nuestra. */
export type RenglonLeido = {
  descripcion: string
  cantidad: number | null
  /** La unidad del papel ("UND", "BULTO"), que rara vez es la nuestra. */
  unidad: string
  /** Sin IVA, en la moneda de la factura. */
  precio_unitario: number | null
  subtotal: number | null
  /** null = el papel no lo marca. */
  exento: boolean | null
}

/** Lo que el lector sacó de la foto: una propuesta, no una factura. */
export type BorradorFactura = {
  proveedor_nombre: string
  proveedor_rif: string
  numero_factura: string
  numero_control: string
  /** A nombre de quién está la factura (el RIF del cliente en el papel). */
  cliente_rif: string
  /** AAAA-MM-DD, la del papel. */
  fecha: string | null
  moneda: '$' | 'Bs' | ''
  /** La tasa (Bs por $) que imprime el papel, si la imprime. */
  tasa_cambio: number | null
  renglones: RenglonLeido[]
  recargo: number
  descuento: number
  /** Los totales IMPRESOS, para ver si lo que se va a guardar cuadra. */
  subtotal: number | null
  iva: number | null
  total: number | null
  advertencias: string[]
}

export type LecturaFactura = {
  soporte_id: number
  lector: string
  borrador: BorradorFactura | null
  /** Si no se pudo leer, por qué. La foto queda guardada igual. */
  error: string
}

export type AvisoPrecio = {
  /** Posición del renglón en el formulario. */
  indice: number
  ingrediente_id: number
  costo_unitario: number
  referencia: number
  /** "compras": mediana de las últimas; "promedio": la ficha, si nunca se compró. */
  base: 'compras' | 'promedio'
  muestras: number
  variacion_pct: number
  /** "unidad": más parece un error de unidad que un cambio de precio. */
  nivel: 'normal' | 'alto' | 'bajo' | 'unidad'
  mensaje: string
}

/** Lo que ese proveedor ya trajo antes: a qué mercancía nuestra corresponde. */
export type SugerenciaRenglon = {
  indice: number
  ingrediente_id: number
  ingrediente_nombre: string
  /** La nuestra. */
  unidad: string
  /** Cuántas unidades nuestras trae una del papel (1 BULTO = 20 kg → 20). */
  factor: number
  unidad_papel: string
  descripcion_recordada: string
  /** Cuántas facturas lo confirmaron. */
  veces: number
  /** false = no es el mismo texto sino uno muy parecido. */
  exacta: boolean
}

export type Equivalencia = {
  id: number
  proveedor_rif: string
  /** Como venía en la última factura. */
  proveedor_nombre: string
  descripcion: string
  unidad_papel: string
  ingrediente_id: number
  ingrediente_nombre: string
  unidad: string
  factor: number
  veces: number
  actualizado: string
}

/** Un plato que queda en problema con el precio nuevo de su mercancía. */
export type ProductoAfectado = {
  nombre: string
  precio: number
  margen_antes_pct: number | null
  margen_despues_pct: number | null
  precio_sugerido: number | null
  a_perdida: boolean
}

/** Algo que llegó más caro en una factura. */
export type AlertaPrecio = {
  id: number
  fecha: string
  factura_id: number
  numero_factura: string
  ingrediente_id: number
  ingrediente_nombre: string
  unidad: string
  proveedor_nombre: string
  costo_anterior: number
  costo_nuevo: number
  variacion_pct: number
  /** "proveedor": contra lo que ese proveedor cobraba; "compras": proveedor nuevo. */
  base: 'proveedor' | 'compras'
  /** "unidad": un salto que parece error de unidad, no de precio. */
  tipo: 'subida' | 'unidad'
  productos: ProductoAfectado[]
  alternativa_proveedor: string
  alternativa_costo: number | null
  alternativa_fecha: string | null
  visto: boolean
  visto_por: string
  visto_en: string | null
}

/** Lo de despues de guardar una factura. Montos en la MISMA moneda que el papel. */
export type CuerpoCompletarFactura = {
  soporte_id: number | null
  proveedor_rif: string
  proveedor_nombre: string
  renglones: {
    descripcion: string
    unidad: string
    cantidad_papel: number | null
    precio_papel: number | null
    ingrediente_id: number
    cantidad: number
    costo_unitario: number
  }[]
}

export type RevisionFactura = {
  duplicadas: { id: number; numero_factura: string; proveedor_nombre: string; fecha: string; total: number }[]
  precios: AvisoPrecio[]
  /** Por qué ese RIF no puede ser correcto (dígito verificador). Vacío si cuadra. */
  rif_aviso: string
  /** Un RIF conocido que difiere en un solo carácter del leído. */
  rif_sugerido: { rif: string; nombre: string } | null
}

export type ConfiguracionFiscal = {
  tasa_iva: number
  /** Cabecera del Libro de Compras (opcionales: solo Impuestos los usa). */
  razon_social?: string
  rif?: string
  direccion?: string
  /** Contribuyente especial: retiene el IVA de sus proveedores. */
  agente_retencion?: boolean
}

/** La tasa con que se pasa a Bs una factura de esa fecha. */
export type TasaDeUnaFecha = {
  pedida: string
  /** El día de la tasa usada: puede ser anterior (fin de semana, feriado). */
  fecha: string | null
  /** null: no hay tasa guardada hasta esa fecha. */
  bcv: number | null
  /** "manual": la fijó el dueño, no es la del BCV. */
  origen: string
}

export type Proveedor = {
  id: number
  nombre: string
  rif: string | null
  telefono: string
  direccion: string
  contacto: string
  nota: string
  activo: boolean
  /** % de su IVA que se le retiene (agente de retención): el último usado. */
  porcentaje_retencion?: number
}

export type FilaLibroVentas = {
  pedido_id: number
  fecha: string
  numero_factura: string
  cliente: string
  /** En dólares, como el resto del ERP y la declaración de IVA. */
  base_imponible: number
  iva: number
  total: number
  /** FAC o NC (en negativo); RET: un comprobante de retención que llegó en
   * este mes por una factura de otro. */
  tipo: 'FAC' | 'NC' | 'RET'
  numero_nota: string
  factura_afectada: string
  rif: string
  numero_control: string
  /** En bolívares, a la tasa BCV congelada al cobrar; null si no hay tasa. */
  tasa_bcv: number | null
  gravado_bs: number | null
  exento_bs: number | null
  iva_bs: number | null
  total_bs: number | null
  /** La retención de IVA que hizo el cliente (contribuyente especial). */
  fecha_retencion: string | null
  comprobante_retencion: string
  iva_retenido_bs: number | null
  /** Retenido al cobrar, esperando el comprobante (no se descuenta aún). */
  retencion_pendiente_bs: number | null
}

export type LibroVentas = {
  periodo: string
  etiqueta: string
  tasa_iva: number
  filas: FilaLibroVentas[]
  total_base: number
  total_iva: number
  total_general: number
  ventas_no_facturadas: number
  monto_no_facturado: number
  total_exento_bs: number
  total_gravado_bs: number
  total_iva_bs: number
  total_bs: number
  /** Filas sin monto en Bs. */
  sin_tasa: number
  total_retenido_bs: number
}

export type FilaLibroCompras = {
  factura_id: number
  /** De registro: la que pone la factura en este libro. */
  fecha: string
  /** La del papel (AAAA-MM-DD); la de registro si no se cargó. */
  fecha_emision: string
  numero_factura: string
  proveedor_nombre: string
  proveedor_rif: string | null
  /** En dólares, como el resto del ERP y la declaración de IVA. */
  base_imponible: number
  iva: number
  total: number
  /** FAC o NC: la nota de crédito es su propia fila, en negativo. */
  tipo: 'FAC' | 'NC'
  numero_nota: string
  factura_afectada: string
  numero_control: string
  moneda: '$' | 'Bs'
  /** En bolívares; null si no hay tasa para pasarla. */
  tasa_bcv: number | null
  /** La tasa no se congeló al guardar: se tomó la guardada de su fecha. */
  tasa_estimada: boolean
  exento_bs: number | null
  gravado_bs: number | null
  iva_bs: number | null
  total_bs: number | null
  fecha_retencion: string | null
  comprobante_retencion: string
  iva_retenido_bs: number | null
}

/** Una retención practicada: una línea del TXT de la quincena. */
export type RetencionIva = {
  factura_id: number
  fecha_factura: string
  fecha_retencion: string
  proveedor_nombre: string
  proveedor_rif: string
  numero_factura: string
  numero_control: string
  comprobante: string
  porcentaje: number
  total_bs: number | null
  base_bs: number | null
  exento_bs: number | null
  iva_bs: number | null
  retenido_bs: number | null
}

export type RetencionesQuincena = {
  anio: number
  mes: number
  quincena: 1 | 2
  etiqueta: string
  retenciones: RetencionIva[]
  total_retenido_bs: number
  total_retenido: number
  sin_tasa: number
  enterada: boolean
  fecha_enterada: string | null
}

export type LibroCompras = {
  periodo: string
  etiqueta: string
  filas: FilaLibroCompras[]
  total_base: number
  total_iva: number
  total_general: number
  total_exento_bs: number
  total_gravado_bs: number
  total_iva_bs: number
  total_bs: number
  /** Filas sin monto en Bs. */
  sin_tasa: number
  tasa_iva: number
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
  /** Lo declarado al SENIAT, en Bs. null en declaraciones de antes. */
  iva_debito_bs: number | null
  iva_credito_bs: number | null
  credito_arrastrado_bs: number | null
  credito_usado_bs: number | null
  iva_a_pagar_bs: number | null
  credito_excedente_bs: number | null
  /** Retenciones de IVA que hicieron los clientes: bajan lo que se paga. */
  retenciones_bs: number | null
  retenciones_arrastradas_bs: number | null
  retenciones_usadas_bs: number | null
  retenciones_excedente_bs: number | null
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
  iva_debito_bs: number
  iva_credito_bs: number
  retenciones_bs: number
  /** Documentos del mes sin tasa: hasta cargarla no se puede declarar. */
  sin_tasa: number
}

export type ResumenIva = {
  periodo: string
  etiqueta: string
  iva_debito: number
  iva_credito: number
  iva_a_pagar: number
  iva_debito_bs: number
  iva_credito_bs: number
  iva_a_pagar_bs: number
}

// ------------------------------------------------------------------ acceso
/** Los cuatro de fabrica, o el identificador de un rol a medida. */
export type Rol = string

/** Un modulo del ERP: una pantalla a la que un rol entra o no entra. */
export type Modulo = { id: string; nombre: string }

export type RolInfo = {
  rol: Rol
  nombre: string
  descripcion: string
  /** A que pantallas entra. Es lo que importa al repartir una llave. */
  modulos: Modulo[]
  /** true = lo creo el dueño; false = uno de fabrica, que no se borra. */
  a_medida: boolean
  /**
   * De la plataforma (Vertigo) y no del negocio. El servidor solo se lo manda
   * a Vertigo: en la pantalla del dueño no llega ninguno, y por eso el bloque
   * de lo interno ni siquiera se dibuja.
   */
  interno: boolean
  /** Si quien tiene el rol autoriza operaciones (PIN y solicitudes). */
  autoriza: boolean
  /** Dueño y Vertigo autorizan siempre: la casilla no se toca. */
  autoriza_fijo: boolean
  /** Si ve las cifras del dia en la portada. */
  ve_kpis: boolean
  ve_kpis_fijo: boolean
  /** Si se le pueden cambiar los modulos desde la pantalla. */
  editable: boolean
  /** Un rol de fabrica al que este local ya le recorto modulos. */
  ajustado: boolean
}

export type EstadoAcceso = {
  autenticado: boolean
  es_hub: boolean
  /** Direccion del hub (vertigopro.tech). Vacia en el propio hub. */
  hub_url: string
  local: { slug: string; nombre: string; dominio: string; url: string; logo: string; favicon: string }
  locales: { slug: string; nombre: string; descripcion: string; url: string; dominio: string }[]
  usuario: string | null
  /** Como se llama la persona. `nombre_visible` nunca viene vacio: cae al usuario. */
  nombre: string
  apellido: string
  nombre_visible: string | null
  tiene_pin: boolean
  rol: Rol | null
  /** Lo dice el servidor; el frontend no deduce permisos del rol. */
  puede: {
    vertigo: boolean
    administrar: boolean
    operar: boolean
    cocina: boolean
    /** Autoriza operaciones delicadas: tiene PIN y le llegan las solicitudes. */
    autoriza: boolean
    /** Ve "Vendido hoy" y "Pedidos" en la portada; si no, un guion. */
    ve_kpis: boolean
    /** Los modulos a los que entra este rol: la barra lateral muestra solo esos. */
    modulos: string[]
  }
  configurado: boolean
  problema: string | null
}

export type Usuario = {
  usuario: string
  nombre: string
  apellido: string
  tiene_pin: boolean
  rol: Rol
  /** El nombre del rol tal cual, aunque no sea de los que se reparten aqui. */
  rol_nombre: string
  locales: string[]
  creado: number | null
  ultimo_acceso: number | null
}

export type ListaUsuarios = {
  usuarios: Usuario[]
  yo: string
  roles: RolInfo[]
  /** El catalogo para armar un rol nuevo. */
  modulos: Modulo[]
  locales: { slug: string; nombre: string }[]
}

/** Lo que se escribe al crear o editar un rol. */
export type DatosRol = {
  id?: string
  nombre: string
  descripcion: string
  modulos: string[]
  autoriza?: boolean
  ve_kpis?: boolean
}

// ── Autorizaciones ──────────────────────────────────────────────────────────

/** La firma de quien autoriza: el PIN tecleado, o una solicitud aprobada. */
export type Autorizacion = { pin: string } | { solicitud_id: number } | { usuario: string; clave: string }

export type EstadoSolicitud = 'pendiente' | 'aprobada' | 'rechazada' | 'cancelada' | 'usada' | 'vencida'

export type SolicitudAutorizacion = {
  id: number
  creada: string
  accion: string
  detalle: string
  monto: number
  pedido_id: number | null
  /** El numero de comanda, que es el que ve la caja. */
  pedido_numero: number | null
  solicitante: string
  solicitante_nombre: string
  estado: EstadoSolicitud
  resuelta_por: string
  resuelta_en: string | null
}

// ── Ventas ──────────────────────────────────────────────────────────────────

/** Que paso con una venta (ver `routers/ventas.py`). */
export type EstadoVenta = 'cobrada' | 'fiada' | 'devuelta' | 'anulada' | 'abierta'

export type VentaFila = {
  id: number
  numero: number
  fecha: string
  estado: EstadoVenta
  cliente: string
  /** "2× Empanada, 1× Jugo" */
  detalle: string
  unidades: number
  subtotal: number
  descuento: number
  total: number
  propina: number
  total_bs: number | null
  tasa_bcv: number | null
  /** "Efectivo $ + Pago movil" */
  pago: string
  fiado_pendiente: number
  fiado_saldado: boolean
  facturado: boolean
  numero_factura: string | null
  operador: string
  punto_venta: string
  anulado_por: string
  anulado_es_perdida: boolean | null
  motivo_devolucion: string
  nota_credito: string | null
  nota: string
  items: PedidoItem[]
  /** Cambio despues de tomada; `ediciones` dice que cambio y quien lo autorizo. */
  editado: boolean
  ediciones: PedidoEdicion[]
}

export type ListaVentas = {
  etiqueta: string
  total: number
  /** Habia mas filas de las que se devolvieron: el rango es demasiado grande. */
  recortado: boolean
  filas: VentaFila[]
}

export type PerdidasVentas = {
  anuladas: number
  valor_anulado: number
  devueltas: number
  valor_devuelto: number
  con_descuento: number
  valor_descuentos: number
  merma_inventario: number
  fiado_pendiente: number
  valor_fiado_pendiente: number
  /** devuelto + descuentos + merma: lo que si se perdio. */
  total: number
  pct_sobre_ventas: number
}

export type GrupoVentas = { nombre: string; ventas: number; pedidos: number }

export type ResumenVentas = {
  etiqueta: string
  desde: string
  hasta: string
  /** Dias del rango que ya pasaron: el divisor de los promedios. */
  dias: number
  granularidad: string
  ventas: number
  ventas_bs: number
  pedidos: number
  unidades: number
  ticket_promedio: number
  ticket_mediano: number
  promedio_diario: number
  pedidos_por_dia: number
  anterior: { ventas: number; pedidos: number; promedio_diario: number }
  cambio_pct: number | null
  perdidas: PerdidasVentas
  por_metodo_pago: Record<string, number>
  por_punto_venta: GrupoVentas[]
  por_operador: GrupoVentas[]
  facturadas: number
  valor_facturado: number
  serie: PuntoSerie[]
  mejor: PuntoSerie | null
}

/** Una linea del extracto de un insumo: el libro de movimientos del deposito. */
export type MovimientoInventario = {
  id: number
  fecha: string
  tipo: string
  /** El tipo en palabras del local: "Venta", "Merma", "Ajuste por conteo"... */
  etiqueta: string
  /** Con signo: positiva entra, negativa sale. */
  cantidad: number
  costo_unitario: number
  valor: number
  /** Existencia que quedo despues de este movimiento. */
  saldo: number
  origen: string
  referencia_id: number | null
  operador: string | null
  nota: string
}

export type RenglonPorTipo = {
  tipo: string
  etiqueta: string
  /** Siempre positiva: el lado lo dice la lista en la que viene. */
  cantidad: number
  valor: number
  movimientos: number
}

export type ExtractoInsumo = {
  ingrediente_id: number
  nombre: string
  unidad: string
  stock_actual: number
  saldo_segun_libro: number
  /** Si es false, alguien movio existencias sin anotarlas: es un bug, no un aviso. */
  cuadra: boolean
  /** Lo que había antes del período. Sin rango es 0. */
  saldo_inicial: number
  saldo_final: number
  entradas: RenglonPorTipo[]
  salidas: RenglonPorTipo[]
  total_entradas: number
  total_salidas: number
  movimientos: MovimientoInventario[]
}

/** Una gaveta al abrir: lo que se contó y lo que los libros creían. */
export type FondoApertura = {
  metodo: string
  cuenta: string
  fondo: number
  segun_libros: number
  diferencia: number
}

/**
 * Si la caja de un día ya se abrió, y con cuánto.
 *
 * `puede_abrir` viene del servidor y no se deduce en la pantalla: las razones
 * por las que no se puede (ya está abierta, ya se cerró, todavía no es ese
 * día) son reglas del negocio, y duplicarlas aquí es como se terminan
 * contradiciendo.
 */
export type EstadoApertura = {
  fecha: string
  abierta: boolean
  puede_abrir: boolean
  motivo: string
  momento: string | null
  operador: string
  nota: string
  fondos: FondoApertura[]
}

// ── Verificacion de pagos moviles (Pabilo) ──────────────────────────────────

export type EstadoPabilo = {
  configurado: boolean
  cuenta: string
  /** La principal, y todas las operativas: si hay varias, la caja elige a cual le pagaron. */
  cuenta_id: string
  cuentas: { id: string; descripcion: string; banco: string }[]
  banco: string
  moneda: string
  /** Campos extra que el banco exige ademas de la referencia (nombres del API). */
  campos: string[]
  /** Los metodos del ERP que se verifican con la cuenta conectada. */
  metodos: string[]
  creditos: number | null
  error: string
  /** Si la cuenta puede MANDAR un pago movil de vuelto (solo juridicas con C2P). */
  emite_vueltos: boolean
  /** Bancos a los que se puede mandar el vuelto: [codigo, nombre]. */
  bancos_destino: [string, string][]
}

/** Un vuelto mandado por pago movil desde la cuenta del local. */
export type VueltoEmitido = {
  id: number
  resultado: 'enviado' | 'rechazado' | 'error'
  mensaje: string
  codigo: string
  referencia: string
  autorizacion: string
  monto_bs: number
  reintentable: boolean
}

export type VerificacionPago = {
  id: number
  referencia: string
  resultado: 'verificado' | 'monto_distinto' | 'no_encontrado' | 'ya_usado' | 'error'
  mensaje: string
  codigo: string
  esperado_bs: number | null
  monto_bs: number | null
  /** Lo que la cuenta vale en Bs a la tasa del momento (contra esto se decide). */
  cuenta_bs: number | null
  tasa: number | null
  es_nueva: boolean
  reintentable: boolean
  del_dueno: boolean
  creditos_restantes: number | null
  pedido_numero: number | null
}

// ── Configuracion > Pago movil (Pabilo) ──────────────────────────────────

export type PerfilPabilo = {
  usuario: string
  empresa: string
  creditos: number | null
  plan_activo: boolean
}

export type CuentaPabilo = {
  id: string
  descripcion: string
  banco: string
  proveedor: string
  moneda: string
  /** Solo el final del numero de cuenta, para distinguir dos del mismo banco. */
  numero: string
  telefono: string
  deshabilitada: boolean
  bloqueada: boolean
  /** Con esta cobra el local. */
  activa: boolean
}

export type ConfigPabilo = {
  configurado: boolean
  /** De donde sale la clave: guardada aqui, del servidor (.env) o ninguna. */
  origen_clave: '' | 'pantalla' | 'servidor'
  clave_pista: string
  cuenta_activa_id: string
  perfil: PerfilPabilo | null
  cuentas: CuentaPabilo[]
  error: string
}

export type CampoProveedor = {
  /** usuario | clave | telefono | cedula | metadata.<NOMBRE> */
  clave: string
  rotulo: string
  ayuda: string
  requerido: boolean
  secreto: boolean
}

export type OpcionBanco = {
  proveedor: string
  banco: string
  nombre: string
  moneda: string
  codigo_banco: string
  prueba: boolean
  ayuda: string
  campos: CampoProveedor[]
}

/** Un cajon del deposito. Vive por su cuenta: existe aunque este vacio. */
export type CategoriaInsumo = {
  id: number
  nombre: string
  /** Cuanta mercancia tiene dentro. */
  usos: number
}

// ── Reportes a medida (backend/app/reporte_dinamico.py) ────────────────────

export type TipoCampo = 'fecha' | 'semana' | 'mes' | 'anio' | 'dia_semana' | 'hora' | 'texto'
export type FormatoMedida = 'dinero' | 'bs' | 'entero' | 'numero' | 'pct'

/** `grupo`: Cuándo, Qué, Quién o Cómo. El mismo concepto en todos los modulos. */
export type CampoDinamico = { id: string; nombre: string; tipo: TipoCampo; ayuda: string; grupo: string }
/** `sumable`: si las partes suman el total (un promedio no): decide si se puede apilar. */
export type MedidaDinamica = { id: string; nombre: string; formato: FormatoMedida; ayuda: string; sumable: boolean }

export type FuenteDinamica = {
  id: string
  nombre: string
  descripcion: string
  campos: CampoDinamico[]
  medidas: MedidaDinamica[]
}

export type DefinicionReporte = {
  fuente: string
  filas: string[]
  columna: string | null
  medidas: string[]
  /** campo -> valores permitidos. */
  filtros: Record<string, string[]>
}

export type ValoresMedidas = Record<string, number | null>
export type CeldasReporte = { total: ValoresMedidas; por_columna?: Record<string, ValoresMedidas> }

export type ResultadoDinamico = {
  fuente: string
  etiqueta: string
  campos_fila: { id: string; nombre: string; tipo: TipoCampo }[]
  columna: {
    id: string
    nombre: string
    tipo: TipoCampo
    valores: { valor: string; etiqueta: string }[]
  } | null
  medidas: { id: string; nombre: string; formato: FormatoMedida; sumable: boolean }[]
  filas: ({ claves: string[]; etiquetas: string[] } & CeldasReporte)[]
  totales: CeldasReporte
  truncado: boolean
  desde_mart: boolean
}

export type ValorCampo = { valor: string; etiqueta: string }

export type ReporteGuardado = {
  id: string
  nombre: string
  definicion: Partial<DefinicionReporte> & { fuente: string; medidas: string[] }
  /** Atajo de fechas con que abre ('mes', '7d'...), o null. */
  periodo: string | null
  creado_por: string
  de_fabrica: boolean
}
