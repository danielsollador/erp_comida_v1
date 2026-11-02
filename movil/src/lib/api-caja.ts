import { rango, req } from './api'
import type { CierreCaja, CobroDelDia, EstadoApertura, Gasto, ResumenCaja, RetiroPropietario } from './tipos'

/**
 * CIERRE DE CAJA: las MISMAS llamadas de la web (frontend/src/lib/api.ts:
 * resumenCaja, cobrosDelDia, estadoDeApertura, abrirCaja, cerrarCaja,
 * corregirCierre, anularCierre, gastos, retiros y cierres), con los mismos
 * cuerpos. Lo que hace cada una de verdad esta en
 * backend/app/routers/caja.py; si alla cambia una, cambia aqui.
 */

/**
 * Lo que se conto de una forma de pago, ya en dolares (la moneda de los
 * libros). Una forma que NO viaja es "no la verifique", que es distinto de
 * mandarla en cero: eso diria "conte y no habia nada" y asentaria un
 * faltante por todo lo esperado.
 */
export type Conteo = { metodo: string; contado: number }

/**
 * Una gaveta contada al abrir: el fondo en dolares y el desglose tal como se
 * conto, billete -> cuantos (y "sueltos"), en la moneda de la gaveta.
 */
export type FondoContado = { metodo: string; cuenta: string; fondo: number; desglose?: Record<string, number> }

/** El dia que se cuadra. Sin fecha, el servidor entiende hoy. */
const delDia = (fecha?: string) => (fecha ? `?fecha=${fecha}` : '')

const cuerpo = (datos: unknown) => JSON.stringify(datos)

export const apiCaja = {
  /** Todo lo que hace falta para cuadrar un dia: ventas, salidas y el desglose por forma de pago. */
  resumen: (fecha?: string) => req<ResumenCaja>(`/caja/resumen${delDia(fecha)}`),
  /** Cada cobro del dia con su referencia: el detalle de la columna "Entró". */
  cobrosDelDia: (fecha?: string) => req<CobroDelDia[]>(`/caja/cobros${delDia(fecha)}`),

  /** Si la caja de ese dia ya se abrio, y con cuanto arranco cada gaveta. */
  estadoDeApertura: (fecha?: string) => req<EstadoApertura>(`/caja/estado-apertura${delDia(fecha)}`),
  /** Abrir contando el fondo: lo contado pasa a ser la verdad de la gaveta. */
  abrir: (fondos: FondoContado[], opciones: { fecha?: string; nota?: string } = {}) =>
    req<EstadoApertura>('/caja/abrir', {
      method: 'POST',
      body: cuerpo({ fondos, fecha: opciones.fecha ?? null, nota: opciones.nota ?? '' }),
    }),

  /** Cuadrar un dia contando POR FORMA DE PAGO. */
  cerrar: (conteos: Conteo[], opciones: { fecha?: string; nota?: string } = {}) =>
    req<CierreCaja>('/caja/cerrar', {
      method: 'POST',
      body: cuerpo({ conteos, fecha: opciones.fecha ?? null, nota: opciones.nota ?? '' }),
    }),
  /**
   * Cambiar el conteo de un cierre ya hecho (un digito de mas al teclear).
   * Por dentro anula el viejo --los libros no se reescriben-- y crea uno nuevo.
   */
  corregirCierre: (id: number, conteos: Conteo[], opciones: { fecha?: string; nota?: string } = {}) =>
    req<CierreCaja>(`/caja/cierres/${id}/corregir`, {
      method: 'POST',
      body: cuerpo({ conteos, fecha: opciones.fecha ?? null, nota: opciones.nota ?? '' }),
    }),
  /** El cierre no se borra: se revierte su diferencia y el dia se puede volver a cerrar. */
  anularCierre: (id: number, motivo: string) =>
    req<CierreCaja>(`/caja/cierres/${id}/anular`, { method: 'POST', body: cuerpo({ motivo }) }),
  listarCierres: (desde: string, hasta: string) => req<CierreCaja[]>(`/caja/cierres?${rango(desde, hasta)}`),

  listarGastos: (desde: string, hasta: string) => req<Gasto[]>(`/caja/gastos?${rango(desde, hasta)}`),
  crearGasto: (descripcion: string, categoria: string, monto: number, metodo_pago: string) =>
    req<Gasto>('/caja/gastos', { method: 'POST', body: cuerpo({ descripcion, categoria, monto, metodo_pago }) }),
  eliminarGasto: (id: number) => req<{ ok: boolean }>(`/caja/gastos/${id}`, { method: 'DELETE' }),

  listarRetiros: (desde: string, hasta: string) => req<RetiroPropietario[]>(`/caja/retiros?${rango(desde, hasta)}`),
  crearRetiro: (monto: number, metodo_pago: string, nota = '') =>
    req<RetiroPropietario>('/caja/retiros', { method: 'POST', body: cuerpo({ monto, metodo_pago, nota }) }),
  eliminarRetiro: (id: number) => req<{ ok: boolean }>(`/caja/retiros/${id}`, { method: 'DELETE' }),
}
