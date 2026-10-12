import { rango, req } from './api'
import type {
  ConfiguracionFiscal,
  DeclaracionIva,
  FilaLibroCompras,
  FilaLibroVentas,
  LibroCompras,
  LibroVentas,
  PeriodoPendiente,
  ResumenIva,
  RetencionesQuincena,
  TasaDeUnaFecha,
} from './tipos'

/**
 * Impuestos: las MISMAS llamadas de la web (frontend/src/lib/api.ts), con los
 * mismos cuerpos. Los libros se piden por rango de fechas (`desde`/`hasta`,
 * ambos incluidos), como el filtro de la web.
 */
export const apiImpuestos = {
  configFiscal: () => req<ConfiguracionFiscal>('/impuestos/config'),
  actualizarConfigFiscal: (c: Partial<ConfiguracionFiscal> & { tasa_iva: number }) =>
    req<ConfiguracionFiscal>('/impuestos/config', { method: 'PUT', body: JSON.stringify(c) }),

  libroVentas: (desde: string, hasta: string) => req<LibroVentas>(`/impuestos/libro-ventas?${rango(desde, hasta)}`),
  libroCompras: (desde: string, hasta: string) => req<LibroCompras>(`/impuestos/libro-compras?${rango(desde, hasta)}`),
  resumenIva: (desde: string, hasta: string) => req<ResumenIva>(`/impuestos/resumen?${rango(desde, hasta)}`),

  /** La tasa BCV guardada para una fecha: la que se propone al cargar la de un documento. */
  tasaDeFecha: (fecha: string) => req<TasaDeUnaFecha>(`/tasas/al?fecha=${encodeURIComponent(fecha)}`),
  cambiarTasaCompra: (facturaId: number, tasa_bcv: number) =>
    req<FilaLibroCompras>(`/impuestos/compras/${facturaId}/tasa`, { method: 'PUT', body: JSON.stringify({ tasa_bcv }) }),
  cambiarTasaVenta: (pedidoId: number, tasa_bcv: number) =>
    req<{ ok: boolean }>(`/impuestos/ventas/${pedidoId}/tasa`, { method: 'PUT', body: JSON.stringify({ tasa_bcv }) }),

  /** El comprobante de retención de IVA que entregó el cliente. Sin monto, el 75 % del IVA. */
  registrarRetencionRecibida: (pedidoId: number, r: { comprobante: string; fecha: string; monto_bs?: number }) =>
    req<FilaLibroVentas>(`/impuestos/ventas/${pedidoId}/retencion`, { method: 'POST', body: JSON.stringify(r) }),
  quitarRetencionRecibida: (pedidoId: number) =>
    req<{ ok: boolean }>(`/impuestos/ventas/${pedidoId}/retencion`, { method: 'DELETE' }),

  retencionesIva: (anio: number, mes: number, quincena: number) =>
    req<RetencionesQuincena>(`/impuestos/retenciones-iva?anio=${anio}&mes=${mes}&quincena=${quincena}`),
  enterarRetenciones: (anio: number, mes: number, quincena: number, forma_pago: string, referencia?: string) =>
    req<RetencionesQuincena>('/impuestos/retenciones-iva/enterar', {
      method: 'POST',
      body: JSON.stringify({ anio, mes, quincena, forma_pago, referencia }),
    }),

  listarDeclaraciones: () => req<DeclaracionIva[]>('/impuestos/declaraciones'),
  periodosPendientes: () => req<PeriodoPendiente[]>('/impuestos/periodos-pendientes'),
  declararIva: (anio: number, mes: number) =>
    req<DeclaracionIva>('/impuestos/declaraciones', { method: 'POST', body: JSON.stringify({ anio, mes }) }),
  pagarDeclaracion: (id: number, forma_pago: string) =>
    req<DeclaracionIva>(`/impuestos/declaraciones/${id}/pagar`, { method: 'POST', body: JSON.stringify({ forma_pago }) }),
  /** Solo la ultima: el credito fiscal se arrastra en cadena de un mes al siguiente. */
  anularDeclaracion: (id: number) =>
    req<{ ok: boolean; periodo: string }>(`/impuestos/declaraciones/${id}/anular`, { method: 'POST' }),
}

/**
 * Las descargas, para `descargar()` de lib/archivos (la ruta va sin el /api):
 * los libros en la planilla del SENIAT (.xlsx), en CSV en dolares, y el TXT
 * de las retenciones de una quincena para el portal.
 */
export const descargasImpuestos = {
  libroVentasSeniat: (desde: string, hasta: string) => `/impuestos/libro-ventas/seniat?${rango(desde, hasta)}`,
  libroVentasCsv: (desde: string, hasta: string) => `/impuestos/libro-ventas/exportar?${rango(desde, hasta)}`,
  libroComprasSeniat: (desde: string, hasta: string) => `/impuestos/libro-compras/seniat?${rango(desde, hasta)}`,
  libroComprasCsv: (desde: string, hasta: string) => `/impuestos/libro-compras/exportar?${rango(desde, hasta)}`,
  retencionesTxt: (anio: number, mes: number, quincena: number) =>
    `/impuestos/retenciones-iva/txt?anio=${anio}&mes=${mes}&quincena=${quincena}`,
}
