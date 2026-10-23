import { req } from './api'
import type {
  Autorizacion,
  Categoria,
  ConfiguracionFiscal,
  EstadoApertura,
  EstadoPabilo,
  Pedido,
  PuntoVenta,
  SolicitudAutorizacion,
  Ticket,
  VerificacionPago,
  VueltoEmitido,
} from './tipos'

/**
 * PUNTO DE VENTA: las MISMAS llamadas de la web (frontend/src/lib/api.ts),
 * con los mismos cuerpos, para que el servidor no distinga si le habla la
 * tablet del mostrador o el telefono del mesonero. Lo que hace cada una esta
 * en backend/app/routers/pedidos.py (y caja.py, pagos.py, autorizaciones.py).
 */

/** Un renglon de la comanda tal como lo pide el servidor al crear o editar. */
export type RenglonComanda = {
  variante_id?: number | null
  cantidad: number
  nota?: string
  /** Venta libre (el delivery sin producto del menu): nombre y monto. */
  nombre_libre?: string
  precio_libre?: number
  /** Solo venta libre: true = no hay nada que cocinar. */
  preparado?: boolean
  /** Se regala: no se cobra, si descuenta inventario. */
  cortesia?: boolean
  /** Si este renglon va a cocina. Sin decirlo, lo que sugiera su categoria. */
  a_cocina?: boolean
  /** Editando: a donde van solo las unidades que se suman a algo que ya estaba. */
  a_cocina_agregado?: boolean
}

/** Una parte del cobro: un pago con su forma, su comprobante y su vuelto. */
export type PagoCobro = {
  metodo: string
  monto: number
  recibido?: number
  vuelto_metodo?: string
  /** El numero de confirmacion: el backend lo exige salvo en efectivo y fiado. */
  referencia?: string
  /** La consulta al banco que respaldo la referencia (Pabilo). */
  verificacion_id?: number
  /** Los bolivares que dijo el banco: con ellos el servidor guarda el redondeo. */
  monto_bs?: number
  /** Vuelto por pago movil: la referencia del banco y el vuelto emitido. */
  vuelto_referencia?: string
  vuelto_id?: number
}

/** Lo que el Libro de Ventas pide de una factura y no sale del cobro. Todo opcional. */
export type DatosFacturaVenta = {
  numero_control?: string
  rif_cliente?: string
  razon_social_cliente?: string
}

/** El punto de venta al abrir, en una llamada (routers/app_movil.py). */
export type ArranquePos = {
  categorias: Categoria[]
  en_cocina: Pedido[]
  listos: Pedido[]
  por_entregar: Pedido[]
  apertura: EstadoApertura
  puntos_venta: PuntoVenta[]
  pabilo: EstadoPabilo
  fiscal: ConfiguracionFiscal
}

export const apiPos = {
  arranque: () => req<ArranquePos>('/app/pos'),
  // ── El menu y lo que vive en el piso ──
  categorias: () => req<Categoria[]>('/menu/categorias'),
  /** Lo que cocina todavia tiene que preparar, cobrado o no (el mismo listado de la cocina). */
  enCocina: () => req<Pedido[]>('/pedidos?en_cocina=true'),
  /** Listos y sin cobrar. */
  listos: () => req<Pedido[]>('/pedidos?estado=listo'),
  /** Cobradas y ya cocinadas, todavia en la barra esperando al cliente. */
  porEntregar: () => req<Pedido[]>('/pedidos?por_entregar=true'),
  /** Las ventas de hoy, para consultarlas sin salir del mostrador. */
  ventasDelDia: () => req<Pedido[]>('/pedidos?del_dia=true'),
  puntosVenta: () => req<PuntoVenta[]>('/puntos-venta'),

  // ── La comanda ──
  crearPedido: (
    items: RenglonComanda[],
    permitir_sin_stock: boolean,
    clave_cliente: string,
    cliente: string,
  ) =>
    req<Pedido>('/pedidos', {
      method: 'POST',
      // `nota` y `a_cocina` van como los manda la web: la comanda sin nota y
      // a cocina, y cada renglon dice lo suyo.
      body: JSON.stringify({ items, nota: '', permitir_sin_stock, clave_cliente, cliente, a_cocina: true }),
    }),
  /** El punto de venta agarra la comanda: la cocina la ve bloqueada. */
  abrirEdicion: (id: number, forzar = false) =>
    req<Pedido>(`/pedidos/${id}/edicion${forzar ? '?forzar=true' : ''}`, { method: 'POST' }),
  /** Se cerro sin guardar: la cocina puede seguir. */
  soltarEdicion: (id: number) => req<Pedido>(`/pedidos/${id}/edicion`, { method: 'DELETE' }),
  /**
   * Como queda el pedido: la lista COMPLETA de renglones, no un delta. La
   * firma y los pagos solo hacen falta cuando la edicion le cambia el monto
   * a una venta ya cobrada (el monto va en positivo: el signo lo pone la
   * diferencia).
   */
  editarPedido: (
    id: number,
    items: RenglonComanda[],
    extra?: {
      motivo?: string
      autorizacion?: Autorizacion
      pagos?: { metodo: string; monto: number; referencia?: string }[]
    },
  ) =>
    req<Pedido>(`/pedidos/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        items,
        nota: null,
        motivo: extra?.motivo ?? '',
        permitir_sin_stock: false,
        autorizacion: extra?.autorizacion ?? null,
        pagos: extra?.pagos ?? null,
      }),
    }),
  /** Que va a cocina y que es de vitrina, renglon por renglon. Solo los que cambian. */
  cambiarCocina: (id: number, items: { id: number; a_cocina: boolean }[]) =>
    req<Pedido>(`/pedidos/${id}/cocina`, { method: 'PUT', body: JSON.stringify({ items }) }),
  /** Se le dio al cliente: sale del mostrador sin esperar la hora. */
  marcarEntregado: (id: number) => req<Pedido>(`/pedidos/${id}/entregado`, { method: 'POST' }),
  anularPedido: (id: number, comida_preparada: boolean) =>
    req<Pedido>(`/pedidos/${id}/anular`, {
      method: 'POST',
      body: JSON.stringify({ comida_preparada, operador_id: null }),
    }),

  // ── El cobro ──
  cobrarPedido: (
    id: number,
    metodo_pago: string,
    facturado: boolean,
    numero_factura: string,
    pagos: PagoCobro[] | undefined,
    extra: {
      descuento: number
      motivo_descuento: string
      propina: number
      cliente: string
      punto_venta_id: number | null
      referencia?: string
      factura?: DatosFacturaVenta
      retencion_iva_pct?: number
    },
  ) =>
    req<Pedido>(`/pedidos/${id}/cobrar`, {
      method: 'POST',
      body: JSON.stringify({
        metodo_pago,
        facturado,
        numero_factura: numero_factura || null,
        pagos: pagos ?? null,
        descuento: extra.descuento,
        motivo_descuento: extra.motivo_descuento,
        propina: extra.propina,
        cliente: extra.cliente,
        operador_id: null,
        punto_venta_id: extra.punto_venta_id,
        referencia: extra.referencia || null,
        ...(facturado ? extra.factura : {}),
        retencion_iva_pct: facturado && extra.retencion_iva_pct ? extra.retencion_iva_pct : null,
      }),
    }),
  ticket: (id: number) => req<Ticket>(`/pedidos/${id}/ticket`),
  configFiscal: () => req<ConfiguracionFiscal>('/impuestos/config'),

  // ── Pago movil verificado (Pabilo) ──
  estadoPabilo: () => req<EstadoPabilo>('/pagos/estado'),
  verificarPago: (datos: {
    referencia: string
    monto_usd: number
    monto_bs?: number
    user_bank_id?: string
    metodo: string
    pedido_id?: number
    telefono?: string
    cedula?: string
    banco_origen?: string
  }) => req<VerificacionPago>('/pagos/verificar', { method: 'POST', body: JSON.stringify(datos) }),
  /** Manda el vuelto por pago movil desde la cuenta del local. */
  emitirVuelto: (datos: {
    telefono: string
    cedula: string
    banco: string
    monto_bs: number
    monto_usd?: number
    pedido_id?: number
    user_bank_id?: string
  }) => req<VueltoEmitido>('/pagos/vuelto', { method: 'POST', body: JSON.stringify(datos) }),

  // ── Abrir la caja ──
  estadoApertura: () => req<EstadoApertura>('/caja/estado-apertura'),
  abrirCaja: (
    fondos: { metodo: string; cuenta: string; fondo: number; desglose?: Record<string, number> }[],
    nota: string,
  ) =>
    req<EstadoApertura>('/caja/abrir', {
      method: 'POST',
      body: JSON.stringify({ fondos, fecha: null, nota }),
    }),

  // ── Pedir permiso (la firma de quien autoriza) ──
  solicitarAutorizacion: (d: { accion: string; detalle?: string; monto?: number; pedido_id?: number | null }) =>
    req<SolicitudAutorizacion>('/autorizaciones', { method: 'POST', body: JSON.stringify(d) }),
  verSolicitud: (id: number) => req<SolicitudAutorizacion>(`/autorizaciones/${id}`),
  cancelarSolicitud: (id: number) => req<SolicitudAutorizacion>(`/autorizaciones/${id}`, { method: 'DELETE' }),
  /** Cuantas personas que autorizan tienen la aplicacion abierta ahora. */
  autorizantesConectados: () => req<{ autorizantes: number }>('/autorizaciones/conectados'),
}
