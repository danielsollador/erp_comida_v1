import { req } from './api'
import type { DefinicionReporte } from './tipos'

/**
 * LA IA DEL NEGOCIO (Claude, backend/app/asistente/): las mismas cuatro
 * llamadas de la web (frontend/src/lib/api.ts), con los mismos cuerpos.
 *
 *   preguntar   el chat: "¿cuánto vendí ayer?", "búscame la factura de carne",
 *               "¿cómo cierro la caja?". Sin estado en el servidor: se mandan
 *               las últimas vueltas cada vez.
 *   reporte     una frase → una definición de Reportes › A medida, ya validada.
 *   precios     una instrucción → la lista de cambios para revisar; aplicar
 *               guarda lo aprobado (deshacer = aplicar al revés).
 *
 * Lo que el asistente puede MIRAR lo decide el servidor con el rol; aquí no
 * se filtra nada.
 */

export type MensajeIA = { rol: 'yo' | 'asistente'; texto: string }

export type DocumentoEncontrado = {
  tipo: 'compra' | 'venta' | 'gasto'
  id: number
  titulo: string
  detalle: string
  fecha: string
  monto_usd: number
  estado: string
  /** El enlace de la web (`/compras?abrir=12`); la app lo traduce a su ruta. */
  enlace: string
}

export type PasoGuia = { ruta: string; ancla: string; titulo: string; texto: string; accion?: 'tocar' | 'escribir' | 'mirar' }

export type RespuestaIA = {
  texto: string
  /** La guía paso a paso recorre la pantalla de la WEB; en la app se avisa que existe. */
  guia: PasoGuia[] | null
  /** Qué consultó para responder: "ventas", "inventario", "manual"… */
  consulto: string[]
  documentos?: DocumentoEncontrado[]
  ms: number
  costo_usd: number
}

export type ReporteHablado = {
  definicion?: DefinicionReporte
  desde?: string
  hasta?: string
  entendi: string
  no_se_puede: string | null
}

export type CambioPropuesto = {
  variante_id: number
  nombre: string
  categoria: string
  precio_anterior: number
  precio_nuevo: number
}

export type PropuestaPrecios = { cambios: CambioPropuesto[]; entendi: string; duda: string | null }

export type CambioPrecio = { variante_id: number; precio_anterior: number; precio_nuevo: number }

export const apiIA = {
  preguntar: (mensajes: MensajeIA[], pantalla: string) =>
    req<RespuestaIA>('/asistente/preguntar', { method: 'POST', body: JSON.stringify({ mensajes, pantalla }) }),
  reporte: (frase: string) => req<ReporteHablado>('/asistente/reporte', { method: 'POST', body: JSON.stringify({ frase }) }),
  proponerPrecios: (instruccion: string) =>
    req<PropuestaPrecios>('/asistente/precios/proponer', { method: 'POST', body: JSON.stringify({ instruccion }) }),
  aplicarPrecios: (cambios: CambioPrecio[]) =>
    req<{ aplicados: number }>('/asistente/precios/aplicar', { method: 'POST', body: JSON.stringify({ cambios }) }),
}

/**
 * A dónde lleva un documento que encontró el asistente. El enlace que manda
 * el servidor es el de la web (`/compras?abrir=12&d=…`); la app tiene su
 * propia pantalla para cada uno.
 */
export function rutaDeDocumento(d: DocumentoEncontrado): string | null {
  if (d.tipo === 'compra' || d.tipo === 'gasto') return `/compras/factura/${d.id}`
  if (d.tipo === 'venta') return `/ventas/pedido/${d.id}?f=${d.fecha.slice(0, 10)}`
  return null
}
