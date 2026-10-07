import * as SecureStore from 'expo-secure-store'
import { hoyEnCaracas, inicioDelMes } from './formato'
import type {
  Aviso,
  BalanceGeneral,
  CuentaPorCobrar,
  EstadoAcceso,
  EstadoResultadosContable,
  EstadoTasa,
  PeriodoPendiente,
  Recorrido,
  ReporteResumen,
} from './tipos'

/**
 * La app habla con el MISMO backend que la web, con la sesion de la app
 * nativa que ya existe (backend/app/acceso/auth.py):
 *   - se identifica con `X-Vp-App: 1`;
 *   - al entrar recibe su token en la cabecera `X-Vp-Token` (y cada vez que
 *     el servidor lo renueva);
 *   - lo devuelve en `Authorization: Bearer`.
 * El token se guarda en el almacen cifrado del telefono (Keychain en iOS,
 * Keystore en Android), no en un archivo cualquiera.
 */
export const API_BASE = (process.env.EXPO_PUBLIC_API_BASE ?? 'https://prueba.vertigopro.tech').replace(/\/+$/, '')

const CLAVE_TOKEN = 'vp-token'
let token: string | null = null
let alCaducar: (() => void) | null = null

export class ErrorApi extends Error {
  constructor(
    mensaje: string,
    public estado: number,
  ) {
    super(mensaje)
  }
}

export async function cargarToken(): Promise<string | null> {
  token = await SecureStore.getItemAsync(CLAVE_TOKEN)
  return token
}

async function guardarToken(nuevo: string | null) {
  token = nuevo
  if (nuevo) await SecureStore.setItemAsync(CLAVE_TOKEN, nuevo)
  else await SecureStore.deleteItemAsync(CLAVE_TOKEN)
}

/** Lo que hace la sesion cuando el servidor dice que ya no vale (401). */
export function cuandoCaduque(fn: () => void) {
  alCaducar = fn
}

async function req<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const cabeceras: Record<string, string> = { 'X-Vp-App': '1', Accept: 'application/json' }
  if (opciones.body) cabeceras['Content-Type'] = 'application/json'
  if (token) cabeceras.Authorization = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`${API_BASE}/api${ruta}`, { ...opciones, headers: cabeceras })
  } catch {
    throw new ErrorApi('No hay conexión con el servidor. Revisa el internet.', 0)
  }

  const renovado = res.headers.get('x-vp-token')
  if (renovado) await guardarToken(renovado)

  if (res.status === 401 && token && !ruta.startsWith('/acceso/')) {
    await guardarToken(null)
    alCaducar?.()
    throw new ErrorApi('Tu sesión terminó. Vuelve a entrar.', 401)
  }
  if (!res.ok) {
    let detalle = ''
    try {
      const cuerpo = await res.json()
      if (typeof cuerpo?.detail === 'string') detalle = cuerpo.detail
    } catch {
      // Sin cuerpo JSON (un 502 del proxy, por ejemplo): queda el codigo.
    }
    if (res.status === 403 && !detalle) detalle = 'Tu rol no tiene acceso a esto.'
    throw new ErrorApi(detalle || `El servidor respondió ${res.status}.`, res.status)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

const rango = (desde: string, hasta: string) => `desde=${desde}&hasta=${hasta}`

export const api = {
  async entrar(usuario: string, clave: string) {
    await guardarToken(null)
    const res = await fetch(`${API_BASE}/api/acceso/login`, {
      method: 'POST',
      headers: { 'X-Vp-App': '1', 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ usuario: usuario.trim(), clave }),
    }).catch(() => {
      throw new ErrorApi('No hay conexión con el servidor. Revisa el internet.', 0)
    })
    if (!res.ok) {
      let detalle = ''
      try {
        const cuerpo = await res.json()
        if (typeof cuerpo?.detail === 'string') detalle = cuerpo.detail
      } catch {
        // sin cuerpo
      }
      throw new ErrorApi(detalle || 'No se pudo entrar.', res.status)
    }
    const nuevo = res.headers.get('x-vp-token')
    if (!nuevo) throw new ErrorApi('El servidor no entregó la sesión de la app.', res.status)
    await guardarToken(nuevo)
  },
  async salir() {
    try {
      await req('/acceso/logout', { method: 'POST' })
    } finally {
      await guardarToken(null)
    }
  },
  olvidar: () => guardarToken(null),

  estado: () => req<EstadoAcceso>('/acceso/estado'),

  // La portada (mismas llamadas que pages/Inicio.tsx de la web)
  resumenDeHoy: () => req<ReporteResumen>(`/reportes/resumen?${rango(hoyEnCaracas(), hoyEnCaracas())}`),
  pedidosDelDia: () => req<unknown[]>('/pedidos?del_dia=true'),
  enCocina: () => req<unknown[]>('/pedidos?en_cocina=true'),
  porCobrar: () => req<unknown[]>('/pedidos?estado=listo'),
  avisos: () => req<Aviso[]>('/reportes/avisos'),
  recorrido: () => req<Recorrido>('/reportes/recorrido'),

  // La zona contable, solo para consultar
  resultadosDelMes: () =>
    req<EstadoResultadosContable>(`/contabilidad/estado-resultados?${rango(inicioDelMes(), hoyEnCaracas())}`),
  balanceGeneral: () => req<BalanceGeneral>('/contabilidad/balance-general'),
  ivaPendiente: () => req<PeriodoPendiente[]>('/impuestos/periodos-pendientes'),
  fiado: () => req<CuentaPorCobrar[]>('/caja/fiado'),
  tasa: () => req<EstadoTasa>('/tasas'),
}
