import { api, ErrorApi } from './api'
import type { AlertaPrecio, CuerpoCompletarFactura } from './types'

/**
 * Lo que queda por hacer después de guardar una factura: enganchar la foto,
 * que la memoria del proveedor aprenda y generar las alertas de precio.
 *
 * La factura ya está guardada cuando esto empieza; si el wifi se cae justo
 * ahí, no se pierde nada de ella, pero sí esos tres pasos. Por eso cada uno
 * se anota ANTES de mandarlo y se borra recién cuando el servidor lo confirma:
 * si la tablet se apaga a mitad, al volver a abrir Compras se retoma. El
 * servidor lo hace idempotente, así que mandarlo dos veces no duplica nada.
 *
 * Vive en este dispositivo: es la cola de lo que ESTA tablet mandó y no supo
 * si llegó. Si el almacenamiento no está disponible, se intenta igual en el
 * momento y solo se pierde el reintento posterior.
 */

type Pendiente = { factura_id: number; numero: string; cuerpo: CuerpoCompletarFactura; desde: string }

const CLAVE = 'vp-compras-pendientes'
const ESPERAS_MS = [0, 1500, 4000]

function leer(): Pendiente[] {
  try {
    const l = JSON.parse(window.localStorage.getItem(CLAVE) || '[]')
    return Array.isArray(l) ? l : []
  } catch {
    return []
  }
}

function escribir(lista: Pendiente[]) {
  try {
    if (lista.length) window.localStorage.setItem(CLAVE, JSON.stringify(lista))
    else window.localStorage.removeItem(CLAVE)
  } catch {
    // sin almacenamiento: se pierde solo el reintento posterior
  }
}

function quitar(facturaId: number) {
  escribir(leer().filter((p) => p.factura_id !== facturaId))
}

/** Un 4xx no se arregla reintentando (la foto es de otra factura, la factura
 * se borró): se descarta. Sin conexión o el servidor caído, sí. */
function valeReintentar(e: unknown): boolean {
  return !(e instanceof ErrorApi) || e.status >= 500 || e.status === 408 || e.status === 429
}

export type ResultadoCompletar =
  | { estado: 'hecho'; foto: boolean; alertas: AlertaPrecio[] }
  | { estado: 'pendiente' }
  | { estado: 'fallo'; mensaje: string }

/** Justo después de guardar: unos pocos intentos seguidos y, si no, a la cola. */
export async function completarDespuesDeGuardar(
  facturaId: number,
  numero: string,
  cuerpo: CuerpoCompletarFactura,
): Promise<ResultadoCompletar> {
  escribir([
    ...leer().filter((p) => p.factura_id !== facturaId),
    { factura_id: facturaId, numero, cuerpo, desde: new Date().toISOString() },
  ])
  for (const espera of ESPERAS_MS) {
    if (espera) await new Promise((r) => setTimeout(r, espera))
    try {
      const r = await api.completarFactura(facturaId, cuerpo)
      quitar(facturaId)
      return { estado: 'hecho', foto: r.foto, alertas: r.alertas }
    } catch (e) {
      if (!valeReintentar(e)) {
        quitar(facturaId)
        return { estado: 'fallo', mensaje: e instanceof Error ? e.message : 'error' }
      }
    }
  }
  return { estado: 'pendiente' }
}

/** Cuántas facturas de este dispositivo esperan. */
export function cuantosPendientes(): number {
  return leer().length
}

/** Reintenta lo que quedó en cola. Devuelve cuántas se completaron. */
export async function procesarPendientes(): Promise<number> {
  let hechas = 0
  for (const p of leer()) {
    try {
      await api.completarFactura(p.factura_id, p.cuerpo)
      quitar(p.factura_id)
      hechas++
    } catch (e) {
      if (!valeReintentar(e)) quitar(p.factura_id)
      // sin conexion: se deja para la proxima; no tiene sentido seguir probando las demas
      else break
    }
  }
  return hechas
}
