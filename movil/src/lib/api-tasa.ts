import { rango, req } from './api'
import type { AnalisisTasa, EstadoTasa, PuntoTasa } from './tipos'

/**
 * LAS LLAMADAS DE TASA DE CAMBIO, las mismas de la web (frontend/src/lib/api.ts:
 * `estadoTasa`, `refrescarTasa`, `fijarTasa`, `historialTasa`, `analisisTasa`).
 * Lo que hace cada una: backend/app/routers/tasas.py.
 */
type RangoFechas = { desde: string; hasta: string }

const conRango = (r?: RangoFechas) => (r ? `?${rango(r.desde, r.hasta)}` : '')

export const apiTasa = {
  estado: () => req<EstadoTasa>('/tasas'),
  /** `forzar`: ademas devuelve el dia a automatico, pisando la tasa cargada a mano. */
  refrescar: (forzar = false) => req<EstadoTasa>(`/tasas/refrescar?forzar=${forzar}`, { method: 'POST' }),
  fijar: (bcv: number) => req<EstadoTasa>('/tasas', { method: 'PUT', body: JSON.stringify({ bcv }) }),
  /** Sin rango, los ultimos 30 dias con tasa. */
  historial: (r?: RangoFechas) => req<PuntoTasa[]>(`/tasas/historial${conRango(r)}`),
  analisis: (r?: RangoFechas) => req<AnalisisTasa>(`/tasas/analisis${conRango(r)}`),
}
