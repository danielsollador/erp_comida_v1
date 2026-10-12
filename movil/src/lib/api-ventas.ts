import { rango, req } from './api'
import type {
  Autorizacion,
  Categoria,
  ListaVentas,
  Pedido,
  ResumenVentas,
  SolicitudAutorizacion,
  Ticket,
} from './tipos'

/**
 * Ventas: las MISMAS llamadas de la web (frontend/src/lib/api.ts) que usan
 * pages/Ventas.tsx, components/EditarPedido.tsx, CorregirPago.tsx y
 * Autorizar.tsx, con los mismos cuerpos. Las reglas (quien firma, que dia ya
 * se cerro, que no se fia) las pone el servidor y las dice en palabras.
 */

/** Lo que el Libro de Ventas pide de una factura. Todo opcional: sin ello va a "Consumidor final". */
export type DatosFacturaVenta = { numero_control?: string; rif_cliente?: string; razon_social_cliente?: string }

export type RenglonEdicion = {
  variante_id?: number | null
  cantidad: number
  nombre_libre?: string
  precio_libre?: number
  cortesia?: boolean
}

export const apiVentas = {
  ventas: (desde: string, hasta: string) => req<ListaVentas>(`/ventas?${rango(desde, hasta)}`),
  resumen: (desde: string, hasta: string) => req<ResumenVentas>(`/ventas/resumen?${rango(desde, hasta)}`),
  verPedido: (id: number) => req<Pedido>(`/pedidos/${id}`),
  ticket: (id: number) => req<Ticket>(`/pedidos/${id}/ticket`),
  categorias: () => req<Categoria[]>('/menu/categorias'),

  /** Abrir toma el candado: mientras se edita, la cocina ve la comanda bloqueada. */
  abrirEdicion: (id: number) => req<Pedido>(`/pedidos/${id}/edicion`, { method: 'POST' }),
  soltarEdicion: (id: number) => req<Pedido>(`/pedidos/${id}/edicion`, { method: 'DELETE' }),
  /** Como queda el pedido: la lista COMPLETA de renglones, no un delta. */
  editarPedido: (
    id: number,
    items: RenglonEdicion[],
    extra: { motivo?: string; autorizacion?: Autorizacion; pagos?: { metodo: string; monto: number; referencia?: string }[] },
  ) =>
    req<Pedido>(`/pedidos/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        items,
        nota: null,
        motivo: extra.motivo ?? '',
        permitir_sin_stock: false,
        autorizacion: extra.autorizacion ?? null,
        pagos: extra.pagos ?? null,
      }),
    }),
  /** Corregir COMO se pago: los pagos tienen que sumar lo mismo. Mover plata de gaveta pide firma. */
  corregirPagos: (
    id: number,
    pagos: { id?: number | null; metodo: string; monto: number; referencia?: string }[],
    extra: { motivo?: string; autorizacion?: Autorizacion },
  ) =>
    req<Pedido>(`/pedidos/${id}/pagos`, {
      method: 'PUT',
      body: JSON.stringify({ pagos, motivo: extra.motivo ?? '', autorizacion: extra.autorizacion }),
    }),
  /** Facturar despues de cobrar: el numero sale del talonario. */
  facturar: (id: number, numero_factura: string, datos: DatosFacturaVenta) =>
    req<Pedido>(`/pedidos/${id}/facturar`, { method: 'POST', body: JSON.stringify({ numero_factura, ...datos }) }),
  devolver: (id: number, o: { recuperable: boolean; nota_credito?: string; motivo?: string }) =>
    req<Pedido>(`/pedidos/${id}/devolver`, {
      method: 'POST',
      body: JSON.stringify({ recuperable: o.recuperable, nota_credito: o.nota_credito ?? null, motivo: o.motivo ?? '' }),
    }),
  /** Sin `monto` se cobra todo lo que queda; con monto, es un abono. */
  cobrarFiado: (id: number, metodo_pago: string, monto: number, referencia: string) =>
    req<{ ok: boolean; cobrado: number; queda: number; saldado: boolean; cliente: string }>(`/caja/fiado/${id}/cobrar`, {
      method: 'POST',
      body: JSON.stringify({ metodo_pago, monto, referencia }),
    }),

  // Las autorizaciones: pedir permiso a quien autoriza y esperar su respuesta.
  solicitar: (d: { accion: string; detalle: string; monto: number; pedido_id?: number | null }) =>
    req<SolicitudAutorizacion>('/autorizaciones', { method: 'POST', body: JSON.stringify(d) }),
  verSolicitud: (id: number) => req<SolicitudAutorizacion>(`/autorizaciones/${id}`),
  cancelarSolicitud: (id: number) => req<SolicitudAutorizacion>(`/autorizaciones/${id}`, { method: 'DELETE' }),
  autorizantesConectados: () => req<{ autorizantes: number }>('/autorizaciones/conectados'),
}
