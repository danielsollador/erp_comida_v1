import type {
  ActivoFijo,
  AsientoContable,
  BalanceGeneral,
  CambioPrecio,
  CambioReceta,
  Categoria,
  CompraDeInsumo,
  DatosRol,
  RolInfo,
  DatosIngrediente,
  ConteoDetalle,
  ConteoResumen,
  PlanillaLeida,
  ResultadoConteo,
  CuentaPorCobrar,
  NotaCreditoCompra,
  Operador,
  PuntoVenta,
  SobranteInventario,
  Ticket,
  CostoVariante,
  ImpactoDeCompra,
  InflacionInsumos,
  EstadoTasa,
  CierreCaja,
  EstadoApertura,
  Configuracion,
  ConfiguracionFiscal,
  CuentaContable,
  DeclaracionIva,
  EstadoAcceso,
  EstadoResultadosContable,
  FacturaCompra,
  FilaBalanceComprobacion,
  FilaMayor,
  Gasto,
  Ingrediente,
  Proveedor,
  LibroCompras,
  LibroVentas,
  ListaUsuarios,
  Merma,
  Autorizacion,
  SolicitudAutorizacion,
  Pedido,
  PedidoItem,
  PeriodoPendiente,
  Producto,
  ReporteResumen,
  PuntoTasa,
  ReporteCombos,
  RecetaItem,
  Respaldo,
  EstadoRespaldos,
  PrevisualizacionRestauracion,
  Restauracion,
  ResumenCaja,
  ResumenIva,
  RetiroPropietario,
  Rol,
  SaludContable,
  Sugerencia,
  SugerenciaCompra,
  ExtractoInsumo,
  Usuario,
  Variante,
  AnalisisTasa,
  ListaVentas,
  ResumenVentas,
} from './types'
import { queryRango, type Rango } from './fechas'

/** `?desde=…&hasta=…` si hay rango; sin el, el endpoint usa su defecto. */
const conRango = (r?: Rango, extra = '') => {
  const partes = [r ? queryRango(r) : '', extra].filter(Boolean)
  return partes.length ? `?${partes.join('&')}` : ''
}

/** Se cayo la red (no el servidor): `fetch` rechaza sin respuesta. */
export class SinConexion extends Error {
  constructor() {
    super('Sin conexión. Revisa el wifi e intenta otra vez.')
    this.name = 'SinConexion'
  }
}

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      // SIN CACHE. El API no manda `Cache-Control` ni `ETag`, asi que el
      // navegador puede decidir por su cuenta reutilizar la respuesta
      // anterior de un GET: se borraba algo, se volvia a pedir la lista y
      // llegaba la de antes. Solo al recargar la pagina se veia el cambio.
      // Son respuestas pequenas y lo que se pide de este ERP es siempre "como
      // esta AHORA": una lista vieja no sirve de nada.
      cache: 'no-store',
      // La cookie de sesion viaja sola en el mismo origen; se declara igual
      // para que un despliegue con el API en otro origen no la pierda en
      // silencio.
      credentials: 'same-origin',
      ...options,
    })
  } catch {
    // `fetch` solo rechaza cuando no hubo respuesta: wifi caida, servidor
    // inalcanzable. Un 500 NO pasa por aca. Sin esto la cajera veia
    // "Failed to fetch", que no le dice que hacer.
    throw new SinConexion()
  }
  // Sesion caducada o cerrada en otra pestaña: al login, no a un error rojo.
  // Las rutas del propio acceso no: alli el 401 es "clave incorrecta".
  if (res.status === 401 && !path.startsWith('/acceso/')) {
    window.location.replace('/login.html')
    throw new Error('Sesión requerida.')
  }
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
  // --- acceso y usuarios ---
  estadoAcceso: () => req<EstadoAcceso>('/acceso/estado'),
  salir: () => req<{ ok: boolean }>('/acceso/logout', { method: 'POST' }),
  pedirPase: (local: string) =>
    req<{ pase: string }>('/acceso/pase', { method: 'POST', body: JSON.stringify({ local }) }),
  listarUsuarios: () => req<ListaUsuarios>('/usuarios'),
  crearRol: (r: DatosRol) => req<RolInfo>('/usuarios/roles', { method: 'POST', body: JSON.stringify(r) }),
  editarRol: (id: string, r: DatosRol) =>
    req<RolInfo>(`/usuarios/roles/${id}`, { method: 'PUT', body: JSON.stringify(r) }),
  borrarRol: (id: string) => req<{ ok: boolean }>(`/usuarios/roles/${id}`, { method: 'DELETE' }),
  /** Devuelve un rol de fabrica a los modulos con los que viene. */
  restaurarRol: (id: string) => req<RolInfo>(`/usuarios/roles/${id}/ajuste`, { method: 'DELETE' }),
  crearUsuario: (u: {
    usuario: string
    clave: string
    rol: Rol
    nombre?: string
    apellido?: string
    locales?: string[]
  }) =>
    req<Usuario>('/usuarios', { method: 'POST', body: JSON.stringify(u) }),
  cambiarRol: (usuario: string, rol: Rol) =>
    req<Usuario>(`/usuarios/${encodeURIComponent(usuario)}/rol`, {
      method: 'PUT',
      body: JSON.stringify({ rol }),
    }),
  borrarUsuario: (usuario: string) =>
    req<{ ok: boolean }>(`/usuarios/${encodeURIComponent(usuario)}`, { method: 'DELETE' }),
  reiniciarClave: (usuario: string, clave: string) =>
    req<{ ok: boolean }>(`/usuarios/${encodeURIComponent(usuario)}/clave`, {
      method: 'POST',
      body: JSON.stringify({ clave }),
    }),
  cambiarMiClave: (clave_actual: string, clave_nueva: string) =>
    req<{ ok: boolean }>('/usuarios/mi/clave', {
      method: 'POST',
      body: JSON.stringify({ clave_actual, clave_nueva }),
    }),
  cambiarNombre: (usuario: string, nombre: string, apellido: string) =>
    req<Usuario>(`/usuarios/${encodeURIComponent(usuario)}/nombre`, {
      method: 'PUT',
      body: JSON.stringify({ nombre, apellido }),
    }),
  /** Cada quien escribe como se llama. */
  cambiarMiNombre: (nombre: string, apellido: string) =>
    req<Usuario>('/usuarios/mi/nombre', { method: 'PUT', body: JSON.stringify({ nombre, apellido }) }),
  /** Quien administra le pone el PIN a alguien cuyo rol autoriza. */
  ponerPin: (usuario: string, pin: string) =>
    req<Usuario>(`/usuarios/${encodeURIComponent(usuario)}/pin`, { method: 'POST', body: JSON.stringify({ pin }) }),
  quitarPin: (usuario: string) =>
    req<Usuario>(`/usuarios/${encodeURIComponent(usuario)}/pin`, { method: 'DELETE' }),
  /** El PIN propio, con la contraseña delante. */
  ponerMiPin: (clave_actual: string, pin: string) =>
    req<Usuario>('/usuarios/mi/pin', { method: 'POST', body: JSON.stringify({ clave_actual, pin }) }),
  quitarMiPin: () => req<Usuario>('/usuarios/mi/pin', { method: 'DELETE' }),

  // --- autorizaciones: pedir permiso desde la caja, resolverlo desde la app ---
  solicitarAutorizacion: (d: { accion: string; detalle?: string; monto?: number; pedido_id?: number | null }) =>
    req<SolicitudAutorizacion>('/autorizaciones', { method: 'POST', body: JSON.stringify(d) }),
  solicitudesPendientes: () => req<SolicitudAutorizacion[]>('/autorizaciones'),
  /** El buzon: las ultimas solicitudes, resueltas o no. */
  historialAutorizaciones: () => req<SolicitudAutorizacion[]>('/autorizaciones/historial'),
  verSolicitud: (id: number) => req<SolicitudAutorizacion>(`/autorizaciones/${id}`),
  aprobarSolicitud: (id: number) => req<SolicitudAutorizacion>(`/autorizaciones/${id}/aprobar`, { method: 'POST' }),
  rechazarSolicitud: (id: number) => req<SolicitudAutorizacion>(`/autorizaciones/${id}/rechazar`, { method: 'POST' }),
  cancelarSolicitud: (id: number) => req<SolicitudAutorizacion>(`/autorizaciones/${id}`, { method: 'DELETE' }),
  /** Cuantas personas que autorizan tienen la aplicacion abierta ahora. */
  autorizantesConectados: () => req<{ autorizantes: number }>('/autorizaciones/conectados'),

  listarCategorias: () => req<Categoria[]>('/menu/categorias'),
  crearCategoria: (nombre: string, orden = 0) =>
    req<Categoria>('/menu/categorias', { method: 'POST', body: JSON.stringify({ nombre, orden }) }),
  /**
   * Cambia SOLO lo que se le pasa. El backend ignora lo que no venga en el
   * cuerpo: mandar el objeto entero hacia que renombrar una categoria
   * retirada la devolviera al menu sola.
   */
  actualizarCategoria: (id: number, cambios: { nombre?: string; orden?: number; bebida?: boolean }) =>
    req<Categoria>(`/menu/categorias/${id}`, {
      method: 'PUT',
      body: JSON.stringify(cambios),
    }),
  eliminarCategoria: (id: number) => req(`/menu/categorias/${id}`, { method: 'DELETE' }),
  reactivarCategoria: (id: number) =>
    req<Categoria>(`/menu/categorias/${id}/reactivar`, { method: 'POST' }),

  crearProducto: (categoria_id: number, nombre: string, variantes: { nombre: string; precio: number }[]) =>
    req<Producto>('/menu/productos', {
      method: 'POST',
      body: JSON.stringify({ categoria_id, nombre, activo: true, variantes }),
    }),
  actualizarProducto: (id: number, p: { categoria_id: number; nombre: string; activo: boolean }) =>
    req<Producto>(`/menu/productos/${id}`, { method: 'PUT', body: JSON.stringify(p) }),
  eliminarProducto: (id: number) => req(`/menu/productos/${id}`, { method: 'DELETE' }),
  reactivarProducto: (id: number) =>
    req<Producto>(`/menu/productos/${id}/reactivar`, { method: 'POST' }),

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
  reactivarVariante: (id: number) =>
    req<Variante>(`/menu/variantes/${id}/reactivar`, { method: 'POST' }),
  costosVariantes: () => req<CostoVariante[]>('/menu/costos'),
  historialPrecios: (varianteId: number) =>
    req<CambioPrecio[]>(`/menu/variantes/${varianteId}/precios`),

  listarPedidos: (estado?: string) =>
    req<Pedido[]>(`/pedidos${estado ? `?estado=${estado}` : ''}`),
  /** Lo que cocina todavia tiene que preparar, cobrado o no. */
  listarPedidosEnCocina: () => req<Pedido[]>('/pedidos?en_cocina=true'),
  crearPedido: (
    items: {
      variante_id?: number
      cantidad: number
      nota?: string
      // Venta libre: cobrar algo que no esta en el menu sin ensuciarlo.
      nombre_libre?: string
      precio_libre?: number
      // Solo aplica a venta libre: en true cuando el ítem no necesita cocina
      // (un delivery personalizado, por ejemplo), para que no se quede
      // pegado en la cola de cocina esperando que alguien marque "listo"
      // algo que nadie va a cocinar.
      preparado?: boolean
    }[],
    permitir_sin_stock = false,
    nota = '',
    // Reintentar con la misma clave devuelve el pedido que ya entro, en vez
    // de mandar dos comandas iguales a cocina.
    clave_cliente?: string,
    /** A nombre de quien va la comanda: sale al lado del numero de pedido. */
    cliente = '',
  ) =>
    req<Pedido>('/pedidos', {
      method: 'POST',
      body: JSON.stringify({ items, nota, permitir_sin_stock, clave_cliente, cliente }),
    }),
  /** Que paso con este insumo, en orden. El extracto del deposito. */
  /** Con `desde`/`hasta` el extracto trae además saldo inicial y totales del período. */
  movimientosDeInsumo: (
    ingredienteId: number,
    limite = 60,
    rango?: { desde?: string; hasta?: string },
  ) => {
    const q = new URLSearchParams({ limite: String(limite) })
    if (rango?.desde) q.set('desde', rango.desde)
    if (rango?.hasta) q.set('hasta', rango.hasta)
    return req<ExtractoInsumo>(`/inventario/ingredientes/${ingredienteId}/movimientos?${q}`)
  },
  marcarItemPreparado: (itemId: number) =>
    req<Pedido>(`/pedidos/items/${itemId}/preparado`, { method: 'POST' }),
  marcarPedidoListo: (pedidoId: number) =>
    req<Pedido>(`/pedidos/${pedidoId}/marcar-listo`, { method: 'POST' }),
  /**
   * La cocina agarra (o suelta) la comanda. Es un interruptor: avisa al resto
   * de la cocina que esa ya tiene dueño y le cierra la edicion a la caja.
   */
  marcarCocinando: (pedidoId: number) =>
    req<Pedido>(`/pedidos/${pedidoId}/cocinando`, { method: 'POST' }),
  /** El punto de venta agarra la comanda: la cocina la ve bloqueada. */
  abrirEdicion: (pedidoId: number) =>
    req<Pedido>(`/pedidos/${pedidoId}/edicion`, { method: 'POST' }),
  /** Se cerro el cuadro sin guardar: la cocina puede seguir. */
  soltarEdicion: (pedidoId: number) =>
    req<Pedido>(`/pedidos/${pedidoId}/edicion`, { method: 'DELETE' }),
  /**
   * Como queda el pedido: la lista COMPLETA de renglones, no un delta.
   *
   * `autorizacion` y `pagos` solo hacen falta cuando la edicion le cambia el
   * monto a una venta ya cobrada. El monto del pago va en positivo siempre: el
   * signo lo pone la diferencia, no quien lo teclea.
   */
  editarPedido: (
    pedidoId: number,
    items: {
      variante_id?: number | null
      cantidad: number
      nota?: string
      nombre_libre?: string
      precio_libre?: number
    }[],
    extra?: {
      nota?: string
      motivo?: string
      permitir_sin_stock?: boolean
      autorizacion?: Autorizacion
      pagos?: { metodo: string; monto: number; referencia?: string }[]
    },
  ) =>
    req<Pedido>(`/pedidos/${pedidoId}`, {
      method: 'PUT',
      body: JSON.stringify({
        items,
        nota: extra?.nota ?? null,
        motivo: extra?.motivo ?? '',
        permitir_sin_stock: extra?.permitir_sin_stock ?? false,
        autorizacion: extra?.autorizacion ?? null,
        pagos: extra?.pagos ?? null,
      }),
    }),
  cobrarPedido: (
    pedidoId: number,
    metodo_pago: string,
    facturado = false,
    numero_factura?: string,
    // Pago partido entre varias formas; si se omite, todo va a `metodo_pago`.
    pagos?: {
      metodo: string
      monto: number
      recibido?: number
      vuelto_metodo?: string
      // Numero de confirmacion: del pago movil, el ticket del punto, el
      // comprobante del Zelle. El backend lo exige para todo lo que no sea
      // efectivo ni fiado.
      referencia?: string
    }[],
    extra?: {
      descuento?: number
      motivo_descuento?: string
      propina?: number
      cliente?: string
      operador_id?: number | null
      punto_venta_id?: number | null
      // Solo aplica cuando no se manda `pagos` (un solo metodo para todo).
      referencia?: string
    },
  ) =>
    req<Pedido>(`/pedidos/${pedidoId}/cobrar`, {
      method: 'POST',
      body: JSON.stringify({
        metodo_pago,
        facturado,
        numero_factura: numero_factura || null,
        pagos: pagos ?? null,
        descuento: extra?.descuento ?? 0,
        motivo_descuento: extra?.motivo_descuento ?? '',
        propina: extra?.propina ?? 0,
        cliente: extra?.cliente ?? '',
        operador_id: extra?.operador_id ?? null,
        punto_venta_id: extra?.punto_venta_id ?? null,
        referencia: extra?.referencia || null,
      }),
    }),
  ticket: (pedidoId: number) => req<Ticket>(`/pedidos/${pedidoId}/ticket`),
  pedidosOlvidados: (horas = 24) => req<Pedido[]>(`/pedidos/olvidados?horas=${horas}`),
  /** Facturar despues de cobrar: el numero de factura sale del talonario. */
  facturarPedido: (pedidoId: number, numero_factura: string) =>
    req<Pedido>(`/pedidos/${pedidoId}/facturar`, {
      method: 'POST',
      body: JSON.stringify({ numero_factura }),
    }),
  devolverPedido: (
    pedidoId: number,
    opciones: { recuperable: boolean; nota_credito?: string; motivo?: string },
  ) =>
    req<Pedido>(`/pedidos/${pedidoId}/devolver`, {
      method: 'POST',
      body: JSON.stringify({
        recuperable: opciones.recuperable,
        nota_credito: opciones.nota_credito ?? null,
        motivo: opciones.motivo ?? '',
      }),
    }),
  anularPedido: (pedidoId: number, comida_preparada?: boolean, operador_id?: number | null) =>
    req<Pedido>(`/pedidos/${pedidoId}/anular`, {
      method: 'POST',
      body: JSON.stringify({
        comida_preparada: comida_preparada ?? null,
        operador_id: operador_id ?? null,
      }),
    }),

  listarOperadores: () => req<Operador[]>('/operadores'),
  crearOperador: (nombre: string, rol = 'cajero') =>
    req<Operador>('/operadores', { method: 'POST', body: JSON.stringify({ nombre, rol }) }),
  desactivarOperador: (id: number) => req(`/operadores/${id}`, { method: 'DELETE' }),
  listarPuntosVenta: () => req<PuntoVenta[]>('/puntos-venta'),
  crearPuntoVenta: (nombre: string) =>
    req<PuntoVenta>('/puntos-venta', { method: 'POST', body: JSON.stringify({ nombre }) }),

  listarIngredientes: () => req<Ingrediente[]>('/inventario/ingredientes'),
  crearIngrediente: (i: DatosIngrediente) =>
    req<Ingrediente>('/inventario/ingredientes', { method: 'POST', body: JSON.stringify(i) }),
  actualizarIngrediente: (id: number, i: DatosIngrediente) =>
    req<Ingrediente>(`/inventario/ingredientes/${id}`, { method: 'PUT', body: JSON.stringify(i) }),
  // Todo el deposito de una vez; lo que no se anoto no se toca.
  conteoFisico: (
    items: { ingrediente_id: number; stock_real: number }[],
    motivo = 'Conteo fisico',
    ciego = false,
  ) =>
    req<ResultadoConteo>('/inventario/conteo', {
      method: 'POST',
      body: JSON.stringify({ items, motivo, ciego }),
    }),
  /** El historial de planillas del período. */
  conteos: (rango: Rango) => req<ConteoResumen[]>(`/inventario/conteos?${queryRango(rango)}`),
  conteo: (id: number) => req<ConteoDetalle>(`/inventario/conteos/${id}`),
  /**
   * Sube la planilla llena y devuelve lo que el ERP entendió. NO guarda nada:
   * el conteo se aplica después con `conteoFisico`, que es el camino que sabe
   * dejar cada diferencia como merma o sobrante con su asiento.
   */
  leerPlanillaConteo: async (archivo: File) => {
    const datos = new FormData()
    datos.append('archivo', archivo)
    // Sin cabecera Content-Type a propósito: el navegador la pone con el
    // `boundary` del multipart, y fijarla a JSON rompe el envío.
    return req<PlanillaLeida>('/inventario/conteos/leer-planilla', {
      method: 'POST',
      body: datos,
      headers: {},
    })
  },
  registrarCompra: (id: number, cantidad: number, costo_total?: number, metodo_pago = 'Efectivo Bs') =>
    req<ImpactoDeCompra>(`/inventario/ingredientes/${id}/comprar`, {
      method: 'POST',
      body: JSON.stringify({ cantidad, costo_total: costo_total ?? null, metodo_pago }),
    }),
  historialCostos: (id: number) =>
    req<CompraDeInsumo[]>(`/inventario/ingredientes/${id}/costos`),
  inflacionInsumos: (dias = 30) =>
    req<InflacionInsumos | null>(`/inventario/inflacion?dias=${dias}`),
  consumoPersonal: (id: number, cantidad: number, motivo: string) =>
    req<Ingrediente>(`/inventario/ingredientes/${id}/consumo-personal`, {
      method: 'POST',
      body: JSON.stringify({ cantidad, motivo }),
    }),
  listarSobrantes: (r?: Rango) => req<SobranteInventario[]>(`/inventario/sobrantes${conRango(r)}`),
  revertirSobrante: (id: number) =>
    req<Ingrediente>(`/inventario/sobrantes/${id}/revertir`, { method: 'POST' }),
  historialReceta: (varianteId: number) =>
    req<CambioReceta[]>(`/inventario/recetas/${varianteId}/historial`),

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
  listarMermas: (r?: Rango) => req<Merma[]>(`/inventario/mermas${conRango(r)}`),
  revertirMerma: (id: number) =>
    req<Ingrediente>(`/inventario/mermas/${id}/revertir`, { method: 'POST' }),

  verReceta: (varianteId: number) => req<RecetaItem[]>(`/inventario/recetas/${varianteId}`),
  actualizarReceta: (varianteId: number, items: { ingrediente_id: number; cantidad_por_unidad: number }[]) =>
    req<RecetaItem[]>(`/inventario/recetas/${varianteId}`, { method: 'PUT', body: JSON.stringify(items) }),

  listarGastos: (r?: Rango) => req<Gasto[]>(`/caja/gastos${conRango(r)}`),
  crearGasto: (descripcion: string, categoria: string, monto: number, metodo_pago = 'Efectivo') =>
    req<Gasto>('/caja/gastos', {
      method: 'POST',
      body: JSON.stringify({ descripcion, categoria, monto, metodo_pago }),
    }),
  eliminarGasto: (id: number) => req(`/caja/gastos/${id}`, { method: 'DELETE' }),

  reporte: (r: Rango) => req<ReporteResumen>(`/reportes/resumen${conRango(r)}`),

  notasCreditoCompra: (facturaId: number) =>
    req<NotaCreditoCompra[]>(`/compras/facturas/${facturaId}/notas-credito`),
  crearNotaCredito: (
    facturaId: number,
    datos: {
      numero: string
      tipo: 'devolucion' | 'descuento'
      motivo?: string
      base_imponible?: number
      iva?: number
      items?: { ingrediente_id: number; cantidad: number }[]
    },
  ) =>
    req<NotaCreditoCompra>(`/compras/facturas/${facturaId}/notas-credito`, {
      method: 'POST',
      body: JSON.stringify(datos),
    }),
  reactivarActivo: (id: number) =>
    req<ActivoFijo>(`/contabilidad/activos/${id}/reactivar`, { method: 'POST' }),
  registrarActivoExistente: (datos: {
    nombre: string
    valor: number
    vida_util_meses: number
    fecha_compra?: string
  }) => req<ActivoFijo>('/contabilidad/activos', { method: 'POST', body: JSON.stringify(datos) }),
  anularDeclaracion: (id: number) =>
    req<{ ok: boolean; periodo: string }>(`/impuestos/declaraciones/${id}/anular`, {
      method: 'POST',
    }),
  cerrarEjercicio: (anio: number) =>
    req<{ ok: boolean; anio: number; resultado: number }>('/contabilidad/cerrar-ejercicio', {
      method: 'POST',
      body: JSON.stringify({ anio }),
    }),
  ejerciciosCerrados: () =>
    req<{ anio: number; descripcion: string }[]>('/contabilidad/ejercicios-cerrados'),

  listarRespaldos: () => req<Respaldo[]>('/respaldos'),
  crearRespaldo: () => req<{ ok: boolean; archivo: string }>('/respaldos/crear', { method: 'POST' }),
  estadoRespaldos: () => req<EstadoRespaldos>('/respaldos/estado'),
  previsualizarRestauracion: (nombre: string) =>
    req<PrevisualizacionRestauracion>(`/respaldos/${nombre}/previsualizar`),
  restaurarRespaldo: (nombre: string) =>
    req<Restauracion>(`/respaldos/${nombre}/restaurar`, {
      method: 'POST',
      body: JSON.stringify({ confirmar: true }),
    }),
  restaurarDesdeArchivo: async (archivo: File) => {
    // multipart: el navegador pone el Content-Type con su boundary, por eso
    // no se usa `req`, que fuerza application/json.
    const datos = new FormData()
    datos.append('archivo', archivo)
    const res = await fetch('/api/respaldos/restaurar-archivo?confirmar=true', {
      method: 'POST',
      body: datos,
    })
    const texto = await res.text()
    if (!res.ok) {
      let mensaje = texto || `Error ${res.status}`
      try {
        const cuerpo = JSON.parse(texto)
        if (typeof cuerpo?.detail === 'string') mensaje = cuerpo.detail
      } catch {
        // respuesta no-JSON
      }
      throw new Error(mensaje)
    }
    return JSON.parse(texto) as Restauracion
  },

  obtenerConfig: () => req<Configuracion>('/config'),
  actualizarConfig: (tasa_bcv: number) =>
    req<Configuracion>('/config', { method: 'PUT', body: JSON.stringify({ tasa_bcv }) }),
  /** Prender o apagar la venta sin control de inventario (arranque del local). */
  venderSinInventario: (vender_sin_inventario: boolean) =>
    req<Configuracion>('/config/inventario', {
      method: 'PUT',
      body: JSON.stringify({ vender_sin_inventario }),
    }),

  reporteCombos: (r: Rango) => req<ReporteCombos>(`/reportes/combos${conRango(r)}`),
  ventas: (r: Rango, estado?: string) =>
    req<ListaVentas>(`/ventas${conRango(r, estado ? `estado=${estado}` : '')}`),
  resumenVentas: (r: Rango) => req<ResumenVentas>(`/ventas/resumen${conRango(r)}`),
  sugerencias: (varianteIds: number[]) =>
    req<Sugerencia[]>(`/pedidos/sugerencias?variantes=${varianteIds.join(',')}`),

  estadoTasa: () => req<EstadoTasa>('/tasas'),
  refrescarTasa: (forzar = false) =>
    req<EstadoTasa>(`/tasas/refrescar?forzar=${forzar}`, { method: 'POST' }),
  fijarTasa: (bcv: number, paralelo?: number) =>
    req<EstadoTasa>('/tasas', { method: 'PUT', body: JSON.stringify({ bcv, paralelo }) }),
  historialTasa: (r?: Rango) => req<PuntoTasa[]>(`/tasas/historial${conRango(r)}`),
  analisisTasa: (r?: Rango) => req<AnalisisTasa>(`/tasas/analisis${conRango(r)}`),

  resumenCaja: (fecha?: string) =>
    req<ResumenCaja>('/caja/resumen' + (fecha ? `?fecha=${fecha}` : '')),
  anularCierre: (id: number, motivo: string) =>
    req<CierreCaja>(`/caja/cierres/${id}/anular`, {
      method: 'POST',
      body: JSON.stringify({ motivo }),
    }),
  propinasPendientes: () => req<{ por_entregar: number }>('/caja/propinas'),
  entregarPropinas: (monto: number, metodo_pago = 'Efectivo Bs', nota = '') =>
    req<{ ok: boolean; entregado: number; queda: number }>('/caja/propinas/entregar', {
      method: 'POST',
      body: JSON.stringify({ monto, metodo_pago, nota }),
    }),
  listarFiado: () => req<CuentaPorCobrar[]>('/caja/fiado'),
  /**
   * Sin `monto` se cobra todo lo que queda; con monto, es un abono.
   * `referencia` es obligatoria si el metodo no es efectivo: el backend la
   * exige igual (ver contabilidad.METODOS_CON_REFERENCIA).
   */
  cobrarFiado: (
    pedidoId: number,
    metodo_pago = 'Efectivo Bs',
    monto?: number,
    referencia?: string,
  ) =>
    req<{ ok: boolean; cobrado: number; queda: number; saldado: boolean; cliente: string }>(
      `/caja/fiado/${pedidoId}/cobrar`,
      { method: 'POST', body: JSON.stringify({ metodo_pago, monto, referencia }) },
    ),

  /**
   * Cerrar la caja con el arqueo completo: una entrada por destino contado.
   *
   * Un destino que no se verifico simplemente no viene en la lista. Es
   * distinto de mandarlo en cero, que significa "conte y no habia nada": el
   * backend solo asienta diferencia de lo que de verdad se conto.
   */
  /**
   * Cuadrar la caja de un dia, contando POR FORMA DE PAGO.
   *
   * Cada una tiene su propia fuente de verdad: los billetes se cuentan, el
   * punto de venta imprime su lote, el pago movil se mira en el banco. Una
   * forma que no venga en la lista es "no la verifique", que es distinto de
   * contarla en cero.
   */
  cerrarCaja: (
    conteos: { metodo: string; contado: number }[],
    opciones: { fecha?: string; nota?: string } = {},
  ) =>
    req<CierreCaja>('/caja/cerrar', {
      method: 'POST',
      body: JSON.stringify({
        conteos,
        fecha: opciones.fecha ?? null,
        nota: opciones.nota ?? '',
      }),
    }),
  /**
   * Si la caja de ese dia ya se abrio, y con cuanto arranco cada gaveta.
   *
   * Es lo que el punto de venta consulta al cargar para decidir si muestra el
   * boton de "Abrir caja".
   */
  estadoDeApertura: (fecha?: string) =>
    req<EstadoApertura>('/caja/estado-apertura' + (fecha ? `?fecha=${fecha}` : '')),
  /**
   * Abrir la caja del dia contando el fondo de cada gaveta.
   *
   * Lo contado pasa a ser la verdad de la gaveta: si los libros decian otra
   * cosa, la diferencia se asienta ahi mismo en vez de aparecer esta noche
   * como un faltante del turno.
   */
  abrirCaja: (
    fondos: { metodo: string; cuenta: string; fondo: number }[],
    opciones: { fecha?: string; nota?: string } = {},
  ) =>
    req<EstadoApertura>('/caja/abrir', {
      method: 'POST',
      body: JSON.stringify({
        fondos,
        fecha: opciones.fecha ?? null,
        nota: opciones.nota ?? '',
      }),
    }),
  listarCierres: (r?: Rango) => req<CierreCaja[]>(`/caja/cierres${conRango(r)}`),
  listarRetiros: (r?: Rango) => req<RetiroPropietario[]>(`/caja/retiros${conRango(r)}`),
  crearRetiro: (monto: number, metodo_pago: string, nota = '') =>
    req<RetiroPropietario>('/caja/retiros', {
      method: 'POST',
      body: JSON.stringify({ monto, metodo_pago, nota }),
    }),
  eliminarRetiro: (id: number) => req(`/caja/retiros/${id}`, { method: 'DELETE' }),

  planCuentas: () => req<CuentaContable[]>('/contabilidad/plan-cuentas'),
  crearCuenta: (c: Omit<CuentaContable, 'id'>) =>
    req<CuentaContable>('/contabilidad/plan-cuentas', { method: 'POST', body: JSON.stringify(c) }),
  listarAsientos: (r?: Rango) => req<AsientoContable[]>(`/contabilidad/asientos${conRango(r)}`),
  crearAsiento: (descripcion: string, lineas: { cuenta_id: number; debe: number; haber: number }[]) =>
    req<AsientoContable>('/contabilidad/asientos', {
      method: 'POST',
      body: JSON.stringify({ descripcion, lineas }),
    }),
  eliminarAsiento: (id: number) => req(`/contabilidad/asientos/${id}`, { method: 'DELETE' }),
  libroMayor: (cuentaId: number) => req<FilaMayor[]>(`/contabilidad/mayor/${cuentaId}`),
  balanceComprobacion: () => req<FilaBalanceComprobacion[]>('/contabilidad/balance-comprobacion'),
  estadoResultadosContable: (r: Rango) =>
    req<EstadoResultadosContable>(`/contabilidad/estado-resultados${conRango(r)}`),
  balanceGeneral: () => req<BalanceGeneral>('/contabilidad/balance-general'),
  saludContable: () => req<SaludContable>('/contabilidad/salud'),
  listarActivos: () => req<ActivoFijo[]>('/contabilidad/activos'),
  actualizarActivo: (id: number, cambios: { nombre?: string; vida_util_meses?: number }) =>
    req<ActivoFijo>(`/contabilidad/activos/${id}`, { method: 'PUT', body: JSON.stringify(cambios) }),
  darDeBajaActivo: (id: number, motivo: string) =>
    req<ActivoFijo>(`/contabilidad/activos/${id}/baja`, {
      method: 'POST',
      body: JSON.stringify({ motivo }),
    }),

  listarFacturasCompra: (r?: Rango) => req<FacturaCompra[]>(`/compras/facturas${conRango(r)}`),

  listarProveedores: (soloActivos = false) =>
    req<Proveedor[]>(`/proveedores${soloActivos ? '?activos=true' : ''}`),
  crearProveedor: (p: Omit<Proveedor, 'id' | 'activo'>) =>
    req<Proveedor>('/proveedores', { method: 'POST', body: JSON.stringify(p) }),
  editarProveedor: (id: number, p: Omit<Proveedor, 'id' | 'activo'>) =>
    req<Proveedor>(`/proveedores/${id}`, { method: 'PUT', body: JSON.stringify(p) }),
  archivarProveedor: (id: number, activo: boolean) =>
    req<Proveedor>(`/proveedores/${id}/archivar?activo=${activo}`, { method: 'POST' }),
  crearFacturaCompra: (f: {
    numero_factura: string
    proveedor_nombre: string
    // Obligatorio para el Libro de Compras: el backend rechaza vacio o
    // formato invalido.
    proveedor_rif: string
    categoria: string
    forma_pago: string
    descripcion?: string
    // Con renglones (compra de mercancia): cada uno actualiza stock y costo
    // promedio de su ingrediente, y la base se calcula sola sumandolos.
    // `exento` solo viaja cuando ESTA factura contradice a la ficha.
    items?: {
      ingrediente_id: number
      cantidad: number
      costo_unitario: number
      exento?: boolean
    }[]
    // Sin renglones (servicios, activos...): se carga la base a mano.
    base_imponible?: number
    iva?: number
    // Lo que el proveedor suma o rebaja sobre el total: flete, recargo por
    // pagar a credito, descuento por volumen. Los dos en positivo.
    recargo?: number
    descuento?: number
    // Solo si forma_pago es "Credito".
    fecha_vencimiento?: string
    // Solo si categoria es "Activos": en cuantos meses se gasta el equipo.
    vida_util_meses?: number
    // Obligatoria si se carga ya pagada y no fue en efectivo (el backend la
    // exige igual, ver contabilidad.METODOS_CON_REFERENCIA).
    referencia_pago?: string
  }) => req<FacturaCompra>('/compras/facturas', { method: 'POST', body: JSON.stringify(f) }),
  eliminarFacturaCompra: (id: number) => req(`/compras/facturas/${id}`, { method: 'DELETE' }),
  /** `referencia` es obligatoria si no se salda en efectivo. */
  pagarFacturaCompra: (id: number, forma_pago: string, referencia?: string) =>
    req<FacturaCompra>(`/compras/facturas/${id}/pagar`, {
      method: 'POST',
      body: JSON.stringify({ forma_pago, referencia }),
    }),

  configFiscal: () => req<ConfiguracionFiscal>('/impuestos/config'),
  actualizarConfigFiscal: (tasa_iva: number) =>
    req<ConfiguracionFiscal>('/impuestos/config', { method: 'PUT', body: JSON.stringify({ tasa_iva }) }),
  libroVentas: (r: Rango) => req<LibroVentas>(`/impuestos/libro-ventas${conRango(r)}`),
  libroCompras: (r: Rango) => req<LibroCompras>(`/impuestos/libro-compras${conRango(r)}`),
  resumenIva: (r: Rango) => req<ResumenIva>(`/impuestos/resumen${conRango(r)}`),
  listarDeclaraciones: () => req<DeclaracionIva[]>('/impuestos/declaraciones'),
  periodosPendientes: () => req<PeriodoPendiente[]>('/impuestos/periodos-pendientes'),
  declararIva: (anio: number, mes: number) =>
    req<DeclaracionIva>('/impuestos/declaraciones', {
      method: 'POST',
      body: JSON.stringify({ anio, mes }),
    }),
  pagarDeclaracion: (id: number, forma_pago: string) =>
    req<DeclaracionIva>(`/impuestos/declaraciones/${id}/pagar`, {
      method: 'POST',
      body: JSON.stringify({ forma_pago }),
    }),
}

export type WsEvent =
  | { event: 'pedido_nuevo' | 'pedido_actualizado' | 'pedido_pagado'; data: Pedido }
  | { event: 'autorizacion_pendiente' | 'autorizacion_resuelta'; data: SolicitudAutorizacion }

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
  ActivoFijo,
  AsientoContable,
  BalanceGeneral,
  CambioPrecio,
  Categoria,
  CostoVariante,
  CierreCaja,
  Configuracion,
  ConfiguracionFiscal,
  CuentaContable,
  DeclaracionIva,
  EstadoResultadosContable,
  EstadoTasa,
  FacturaCompra,
  FilaBalanceComprobacion,
  FilaMayor,
  Gasto,
  Ingrediente,
  Proveedor,
  LibroCompras,
  LibroVentas,
  Merma,
  Pedido,
  PedidoItem,
  PeriodoPendiente,
  Producto,
  ReporteResumen,
  PuntoTasa,
  ReporteCombos,
  RecetaItem,
  Respaldo,
  EstadoRespaldos,
  PrevisualizacionRestauracion,
  Restauracion,
  ResumenCaja,
  ResumenIva,
  RetiroPropietario,
  SaludContable,
  Sugerencia,
  SugerenciaCompra,
  Variante,
}
