import { req } from './api'
import type { ConfigPabilo, OpcionBanco } from './tipos'

/**
 * CONFIGURACION > PAGO MOVIL: las mismas llamadas de la web
 * (frontend/src/lib/api.ts, bloque "Verificar pagos moviles"), con los mismos
 * cuerpos. Todas devuelven la foto completa (`ConfigPabilo`) para que la
 * pantalla se redibuje con lo que dice el servidor, no con lo que creemos.
 *
 * Las claves (la de Pabilo y las del banco) viajan aqui una sola vez y no se
 * guardan en el telefono: el servidor nunca las devuelve, solo la pista
 * enmascarada (`clave_pista`).
 */
export const apiPagos = {
  configPabilo: () => req<ConfigPabilo>('/pagos/config'),

  /** Vacia = quita la guardada en pantalla (vuelve a valer la del servidor, si hay). Solo Vertigo. */
  guardarClavePabilo: (clave: string) =>
    req<ConfigPabilo>('/pagos/config/clave', { method: 'PUT', body: JSON.stringify({ clave }) }),

  /** La cuenta principal: a la que se verifica si la caja no elige otra. */
  elegirCuentaPabilo: (user_bank_id: string) =>
    req<ConfigPabilo>('/pagos/config/cuenta', { method: 'PUT', body: JSON.stringify({ user_bank_id }) }),

  bancosPabilo: () => req<OpcionBanco[]>('/pagos/config/bancos'),

  crearCuentaPabilo: (datos: {
    proveedor: string
    descripcion: string
    usuario?: string
    clave?: string
    metadata?: Record<string, string>
    telefono?: string
    cedula?: string
  }) => req<ConfigPabilo>('/pagos/config/cuentas', { method: 'POST', body: JSON.stringify(datos) }),

  cambiarClaveCuentaPabilo: (id: string, clave: string) =>
    req<ConfigPabilo>(`/pagos/config/cuentas/${id}/clave`, { method: 'PUT', body: JSON.stringify({ clave }) }),

  borrarCuentaPabilo: (id: string) => req<ConfigPabilo>(`/pagos/config/cuentas/${id}`, { method: 'DELETE' }),
}
