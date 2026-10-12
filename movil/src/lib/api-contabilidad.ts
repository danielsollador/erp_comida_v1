import { rango, req } from './api'
import type {
  ActivoFijo,
  AsientoContable,
  BalanceGeneral,
  CuentaContable,
  EstadoRespaldos,
  EstadoResultadosContable,
  FilaBalanceComprobacion,
  FilaMayor,
  PrevisualizacionRestauracion,
  Respaldo,
  Restauracion,
} from './tipos'

/**
 * Contabilidad y respaldos: las MISMAS llamadas de la web
 * (frontend/src/lib/api.ts), con los mismos cuerpos. El backend no distingue
 * si le habla la PC o el telefono; si una cambia alla, cambia aqui.
 *
 * Los respaldos van aqui porque en la web viven dentro de Contabilidad
 * (pages/partes/Respaldos.tsx): es el modulo de quien administra el negocio,
 * que es justo quien restaura el dia que algo se rompe.
 */
const respaldo = (nombre: string) => `/respaldos/${encodeURIComponent(nombre)}`

export const apiContabilidad = {
  planCuentas: () => req<CuentaContable[]>('/contabilidad/plan-cuentas'),
  crearCuenta: (c: Omit<CuentaContable, 'id'>) =>
    req<CuentaContable>('/contabilidad/plan-cuentas', { method: 'POST', body: JSON.stringify(c) }),
  libroMayor: (cuentaId: number) => req<FilaMayor[]>(`/contabilidad/mayor/${cuentaId}`),

  /** El diario de un periodo (con rango el servidor sube el limite a 2000). */
  listarAsientos: (desde: string, hasta: string) =>
    req<AsientoContable[]>(`/contabilidad/asientos?${rango(desde, hasta)}`),
  crearAsiento: (descripcion: string, lineas: { cuenta_id: number; debe: number; haber: number }[]) =>
    req<AsientoContable>('/contabilidad/asientos', { method: 'POST', body: JSON.stringify({ descripcion, lineas }) }),
  /** Solo los manuales: los del sistema se deshacen desde donde nacieron. */
  eliminarAsiento: (id: number) => req<{ ok: boolean }>(`/contabilidad/asientos/${id}`, { method: 'DELETE' }),

  balanceComprobacion: () => req<FilaBalanceComprobacion[]>('/contabilidad/balance-comprobacion'),
  estadoResultados: (desde: string, hasta: string) =>
    req<EstadoResultadosContable>(`/contabilidad/estado-resultados?${rango(desde, hasta)}`),
  balanceGeneral: () => req<BalanceGeneral>('/contabilidad/balance-general'),

  // Los equipos (activos fijos) y su depreciacion, que se asienta sola al leerlos.
  listarActivos: () => req<ActivoFijo[]>('/contabilidad/activos'),
  actualizarActivo: (id: number, cambios: { nombre?: string; vida_util_meses?: number }) =>
    req<ActivoFijo>(`/contabilidad/activos/${id}`, { method: 'PUT', body: JSON.stringify(cambios) }),
  darDeBajaActivo: (id: number, motivo: string) =>
    req<ActivoFijo>(`/contabilidad/activos/${id}/baja`, { method: 'POST', body: JSON.stringify({ motivo }) }),
  reactivarActivo: (id: number) => req<ActivoFijo>(`/contabilidad/activos/${id}/reactivar`, { method: 'POST' }),
  registrarActivoExistente: (datos: { nombre: string; valor: number; vida_util_meses: number; fecha_compra?: string }) =>
    req<ActivoFijo>('/contabilidad/activos', { method: 'POST', body: JSON.stringify(datos) }),
  cerrarEjercicio: (anio: number) =>
    req<{ ok: boolean; anio: number; resultado: number }>('/contabilidad/cerrar-ejercicio', {
      method: 'POST',
      body: JSON.stringify({ anio }),
    }),

  // Respaldos de la base
  listarRespaldos: () => req<Respaldo[]>('/respaldos'),
  estadoRespaldos: () => req<EstadoRespaldos>('/respaldos/estado'),
  crearRespaldo: () => req<{ ok: boolean; archivo: string }>('/respaldos/crear', { method: 'POST' }),
  /** Lo que se perderia al restaurar ese respaldo. No cambia nada. */
  previsualizarRestauracion: (nombre: string) => req<PrevisualizacionRestauracion>(`${respaldo(nombre)}/previsualizar`),
  /** Sin `confirmar: true` el servidor no restaura: se manda despues de mostrar lo que se pierde. */
  restaurarRespaldo: (nombre: string) =>
    req<Restauracion>(`${respaldo(nombre)}/restaurar`, { method: 'POST', body: JSON.stringify({ confirmar: true }) }),
  /** El archivo que trae el dueño (USB, correo, telefono), como FormData con el campo `archivo`. */
  restaurarDesdeArchivo: (datos: FormData) =>
    req<Restauracion>('/respaldos/restaurar-archivo?confirmar=true', { method: 'POST', body: datos }),
  /** Para `descargar()` de lib/archivos: la ruta va sin el /api. */
  rutaDescargaRespaldo: (nombre: string) => `${respaldo(nombre)}/descargar`,
}
