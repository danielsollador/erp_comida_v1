import { api, ErrorApi } from './api'
import type { AlertaPrecio, CuerpoCompletarFactura } from './types'

/**
 * Lo que queda por hacer después de guardar una factura: enganchar la foto,
 * que la memoria del proveedor aprenda y generar las alertas de precio.
 *
 * La factura ya está guardada cuando esto empieza; si el wifi se cae justo
 * ahí, no se pierde nada de ella, pero sí esos tres pasos. Antes de guardar,
 * lo que hay que hacer queda anotado EN EL SERVIDOR, pegado a la foto
 * (`anotarAntesDeGuardar`). Si el "completar" de después no llega, el
 * servidor reconoce la factura por RIF y número y lo termina solo
 * (`reconciliar`), desde cualquier equipo: ya no depende de que vuelva la
 * tablet que la guardó.
 *
 * La cola local de antes (`vp-compras-pendientes`) solo se vacía: lo que
 * haya quedado ahí de antes de este cambio se manda una última vez.
 */

type PendienteViejo = { factura_id: number; numero: string; cuerpo: CuerpoCompletarFactura; desde: string }

const CLAVE_VIEJA = 'vp-compras-pendientes'
const ESPERAS_MS = [0, 1500, 4000]

function leerViejos(): PendienteViejo[] {
  try {
    const l = JSON.parse(window.localStorage.getItem(CLAVE_VIEJA) || '[]')
    return Array.isArray(l) ? l : []
  } catch {
    return []
  }
}

function escribirViejos(lista: PendienteViejo[]) {
  try {
    if (lista.length) window.localStorage.setItem(CLAVE_VIEJA, JSON.stringify(lista))
    else window.localStorage.removeItem(CLAVE_VIEJA)
  } catch {
    // sin almacenamiento: no hay nada viejo que vaciar
  }
}

/** Un 4xx no se arregla reintentando (la foto es de otra factura, la factura
 * se borró). Sin conexión o el servidor caído, sí. */
function valeReintentar(e: unknown): boolean {
  return !(e instanceof ErrorApi) || e.status >= 500 || e.status === 408 || e.status === 429
}

/**
 * Antes de guardar una factura leída de una foto: lo que el servidor tiene
 * que hacer cuando quede guardada. Si esto falla no se guarda la factura
 * (sin red, el guardado fallaría igual).
 */
export async function anotarAntesDeGuardar(numero: string, cuerpo: CuerpoCompletarFactura): Promise<void> {
  if (cuerpo.soporte_id === null) return
  await api.anotarAlGuardar(cuerpo.soporte_id, {
    numero_factura: numero,
    proveedor_rif: cuerpo.proveedor_rif,
    proveedor_nombre: cuerpo.proveedor_nombre,
    renglones: cuerpo.renglones,
  })
}

export type ResultadoCompletar =
  | { estado: 'hecho'; foto: boolean; fotoPerdida: boolean; alertas: AlertaPrecio[] }
  | { estado: 'pendiente' }
  | { estado: 'fallo'; mensaje: string }

/** Justo después de guardar: unos pocos intentos seguidos. Si no llega, lo
 * termina el servidor (ver arriba). */
export async function completarDespuesDeGuardar(
  facturaId: number,
  cuerpo: CuerpoCompletarFactura,
): Promise<ResultadoCompletar> {
  for (const espera of ESPERAS_MS) {
    if (espera) await new Promise((r) => setTimeout(r, espera))
    try {
      const r = await api.completarFactura(facturaId, cuerpo)
      return { estado: 'hecho', foto: r.foto, fotoPerdida: r.foto_perdida, alertas: r.alertas }
    } catch (e) {
      if (!valeReintentar(e)) return { estado: 'fallo', mensaje: e instanceof Error ? e.message : 'error' }
    }
  }
  return { estado: 'pendiente' }
}

/** Cuántas facturas esperan en la cola local de antes. Llega a cero sola. */
export function cuantosPendientes(): number {
  return leerViejos().length
}

/** Vacía la cola local de antes y le pide al servidor que termine lo que
 * quedó a medias, de este equipo o de cualquier otro. Devuelve cuántas se
 * completaron. */
export async function procesarPendientes(): Promise<number> {
  let hechas = 0
  for (const p of leerViejos()) {
    try {
      await api.completarFactura(p.factura_id, p.cuerpo)
      escribirViejos(leerViejos().filter((x) => x.factura_id !== p.factura_id))
      hechas++
    } catch (e) {
      if (!valeReintentar(e)) escribirViejos(leerViejos().filter((x) => x.factura_id !== p.factura_id))
      else return hechas
    }
  }
  try {
    hechas += (await api.reconciliarCompras()).completadas
  } catch {
    // sin conexión: se intenta la próxima vez
  }
  return hechas
}
