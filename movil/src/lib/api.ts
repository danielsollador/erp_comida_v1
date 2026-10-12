import { Platform } from 'react-native'
import * as almacen from './almacen'
import { hoyEnCaracas, inicioDelMes } from './formato'
import type {
  ArranqueLocal,
  Aviso,
  BalanceGeneral,
  CuentaPorCobrar,
  EstadoAcceso,
  EstadoResultadosContable,
  EstadoTasa,
  PeriodoPendiente,
  Recorrido,
  ReporteResumen,
  SolicitudAutorizacion,
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
const BASE = (process.env.EXPO_PUBLIC_API_BASE ?? 'https://prueba.vertigopro.tech').replace(/\/+$/, '')
// En el emulador de Android, "127.0.0.1" es el propio emulador: la laptop
// donde corre el backend de desarrollo se llama 10.0.2.2. Asi la misma
// variable sirve para el navegador y para el emulador.
export const API_BASE =
  Platform.OS === 'android' ? BASE.replace(/\/\/(127\.0\.0\.1|localhost)(?=[:/]|$)/, '//10.0.2.2') : BASE

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
  token = await almacen.leer(CLAVE_TOKEN)
  return token
}

async function guardarToken(nuevo: string | null) {
  token = nuevo
  if (nuevo) await almacen.guardar(CLAVE_TOKEN, nuevo)
  else await almacen.borrar(CLAVE_TOKEN)
}

/** Las cabeceras de la sesion, para lo que no pasa por `req` (descargas). */
export function cabecerasDeSesion(): Record<string, string> {
  const c: Record<string, string> = { 'X-Vp-App': '1' }
  if (token) c.Authorization = `Bearer ${token}`
  return c
}

/**
 * EL CANAL EN VIVO (/ws): la cocina se entera de una comanda nueva sin
 * preguntar cada rato. La app no tiene cookie: el token va como subprotocolo
 * ("vp", token), igual que la app de la tablet (frontend/src/lib/plataforma.ts).
 */
export function abrirCanalEnVivo(): WebSocket {
  const url = API_BASE.replace(/^http/, 'ws') + '/ws'
  return token ? new WebSocket(url, ['vp', token]) : new WebSocket(url)
}

/** Lo que hace la sesion cuando el servidor dice que ya no vale (401). */
export function cuandoCaduque(fn: () => void) {
  alCaducar = fn
}

/**
 * Una llamada a la API con la sesion de la app. Exportada para que cada
 * pantalla agregue sus llamadas en su propio modulo (lib/api-*.ts) con las
 * mismas reglas: token, renovacion, 401 = salir, errores en palabras.
 */
export async function req<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const cabeceras: Record<string, string> = { 'X-Vp-App': '1', Accept: 'application/json' }
  // Un archivo (la foto de una factura) va como FormData: el limite de las
  // partes lo pone fetch solo. Con "application/json" encima no llega nada.
  if (opciones.body && !(opciones.body instanceof FormData)) cabeceras['Content-Type'] = 'application/json'
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

export const rango = (desde: string, hasta: string) => `desde=${desde}&hasta=${hasta}`

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
  arranque: () => req<ArranqueLocal>('/reportes/arranque'),
  resumen: (desde: string, hasta: string) => req<ReporteResumen>(`/reportes/resumen?${rango(desde, hasta)}`),

  // Las autorizaciones: la caja pide permiso y quien autoriza lo resuelve aqui
  solicitudesPendientes: () => req<SolicitudAutorizacion[]>('/autorizaciones'),
  historialAutorizaciones: () => req<SolicitudAutorizacion[]>('/autorizaciones/historial'),
  aprobarSolicitud: (id: number) => req<SolicitudAutorizacion>(`/autorizaciones/${id}/aprobar`, { method: 'POST' }),
  rechazarSolicitud: (id: number) => req<SolicitudAutorizacion>(`/autorizaciones/${id}/rechazar`, { method: 'POST' }),

  // La zona contable, solo para consultar
  resultadosDelMes: () =>
    req<EstadoResultadosContable>(`/contabilidad/estado-resultados?${rango(inicioDelMes(), hoyEnCaracas())}`),
  balanceGeneral: () => req<BalanceGeneral>('/contabilidad/balance-general'),
  ivaPendiente: () => req<PeriodoPendiente[]>('/impuestos/periodos-pendientes'),
  fiado: () => req<CuentaPorCobrar[]>('/caja/fiado'),
  tasa: () => req<EstadoTasa>('/tasas'),
}
