import * as almacen from './almacen'
import { confirmar } from './dialogo'
import { hoyEnCaracas, inicioDelMes } from './formato'
import type {
  ArranqueLocal,
  Aviso,
  CuentaPorCobrar,
  EstadoAcceso,
  EstadoResultadosContable,
  EstadoTasa,
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
const BASE = (process.env.EXPO_PUBLIC_API_BASE ?? 'https://savora.vertigopro.tech').replace(/\/+$/, '')
// En el emulador de Android, "127.0.0.1" es el propio emulador: la laptop
// donde corre el backend de desarrollo se llama 10.0.2.2. Asi la misma
// variable sirve para el navegador y para el emulador.
const paraEsteEquipo = (url: string) =>
  process.env.EXPO_OS === 'android' ? url.replace(/\/\/(127\.0\.0\.1|localhost)(?=[:/]|$)/, '//10.0.2.2') : url

/**
 * EL SERVIDOR DEL NEGOCIO. Cada local tiene el suyo (savora.vertigopro.tech);
 * la app trae uno de fabrica y en "Entrar" se puede escribir otro ("Otro
 * negocio"): asi la misma app sirve a varios locales, y el revisor de la App
 * Store entra al de demostracion sin ver las ventas de nadie. Se recuerda en
 * el telefono.
 */
export const SERVIDOR_DE_FABRICA = paraEsteEquipo(BASE)
let base = SERVIDOR_DE_FABRICA
const CLAVE_SERVIDOR = 'vp-servidor'

/** El servidor con que se habla ahora (https://…, sin barra al final). */
export function apiBase(): string {
  return base
}

export async function cargarServidor(): Promise<string> {
  const guardado = await almacen.leer(CLAVE_SERVIDOR).catch(() => null)
  if (guardado) base = guardado
  return base
}

/** "demo.vertigopro.tech" → "https://demo.vertigopro.tech". */
export function normalizarServidor(texto: string): string {
  const limpio = texto.trim().replace(/\/+$/, '').replace(/\/api$/, '')
  if (!limpio) return ''
  return paraEsteEquipo(/^https?:\/\//i.test(limpio) ? limpio : `https://${limpio}`)
}

/**
 * Cambia de negocio: primero pregunta si ese servidor es un Vertigo Pro
 * (/api/health), y solo entonces lo guarda. La sesion de otro servidor no
 * vale aqui: se borra. `null` vuelve al de fabrica.
 */
export async function cambiarServidor(texto: string | null): Promise<string> {
  const nuevo = texto === null ? SERVIDOR_DE_FABRICA : normalizarServidor(texto)
  if (!nuevo) throw new ErrorApi('Escribe la dirección del negocio.', 0)
  if (texto !== null) {
    let ok = false
    try {
      const res = await fetch(`${nuevo}/api/health`, { headers: { Accept: 'application/json' } })
      ok = res.ok && (await res.json().catch(() => null))?.status === 'ok'
    } catch {
      throw new ErrorApi('No se encontró ese negocio. Revisa la dirección y el internet.', 0)
    }
    if (!ok) throw new ErrorApi('Esa dirección no es un negocio de Vertigo Pro.', 0)
  }
  base = nuevo
  await guardarToken(null)
  if (nuevo === SERVIDOR_DE_FABRICA) await almacen.borrar(CLAVE_SERVIDOR)
  else await almacen.guardar(CLAVE_SERVIDOR, nuevo)
  return base
}

const CLAVE_TOKEN = 'vp-token'
let token: string | null = null
let alCaducar: (() => void) | null = null

export class ErrorApi extends Error {
  /** Lo que el servidor pide antes de guardar (428): una pregunta o una firma. */
  pide?: { codigo: 'confirmar' | 'firma'; clave?: string; mensaje?: string }
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
  const url = base.replace(/^http/, 'ws') + '/ws'
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
  const metodo = opciones.method ?? 'GET'
  if (metodo === 'GET') return reqConPreguntas<T>(ruta, opciones)
  // EL DOBLE TOQUE SE MANDA UNA VEZ, como en la web (QA nov, R2): si lo mismo
  // ya va en camino, el segundo toque espera la misma respuesta.
  const clave = `${metodo} ${ruta} ${typeof opciones.body === 'string' ? opciones.body : ''}`
  const hay = enCamino.get(clave)
  if (hay) return hay as Promise<T>
  const promesa = reqConPreguntas<T>(ruta, opciones).finally(() => enCamino.delete(clave))
  enCamino.set(clave, promesa)
  return promesa
}

const enCamino = new Map<string, Promise<unknown>>()

/**
 * LO QUE EL SERVIDOR PREGUNTA ANTES DE GUARDAR (backend/app/salvaguardas.py):
 * un 428 trae una pregunta ("es cinco veces lo normal") que se confirma aqui
 * mismo y se repite, o la firma de quien autoriza. Quien autoriza ya firma
 * con su sesion; a los demas se les dice que lo haga quien autoriza.
 */
async function reqConPreguntas<T>(ruta: string, opciones: RequestInit): Promise<T> {
  const confirmados: string[] = []
  for (let vuelta = 0; vuelta < 6; vuelta++) {
    try {
      return await reqCrudo<T>(ruta, opciones, confirmados.length ? { 'X-Confirmado': confirmados.join(',') } : {})
    } catch (e) {
      if (!(e instanceof ErrorApi) || e.estado !== 428 || !e.pide) throw e
      if (e.pide.codigo === 'confirmar' && e.pide.clave && !confirmados.includes(e.pide.clave)) {
        const ok = await confirmar({ titulo: '¿Seguro?', texto: e.message, aceptar: 'Sí, guardar', cancelar: 'Revisar', peligro: true })
        if (!ok) throw new ErrorApi(e.message, 428)
        confirmados.push(e.pide.clave)
        continue
      }
      throw new ErrorApi(
        e.pide.codigo === 'firma' ? `${e.message} Pídele a quien autoriza que lo haga desde su sesión.` : e.message,
        428,
      )
    }
  }
  throw new ErrorApi('No se pudo completar: vuelve a intentarlo.', 428)
}

async function reqCrudo<T>(ruta: string, opciones: RequestInit, extra: Record<string, string>): Promise<T> {
  const cabeceras: Record<string, string> = { 'X-Vp-App': '1', Accept: 'application/json', ...extra }
  // Un archivo (la foto de una factura) va como FormData: el limite de las
  // partes lo pone fetch solo. Con "application/json" encima no llega nada.
  if (opciones.body && !(opciones.body instanceof FormData)) cabeceras['Content-Type'] = 'application/json'
  if (token) cabeceras.Authorization = `Bearer ${token}`

  let res: Response
  try {
    res = await fetch(`${base}/api${ruta}`, { ...opciones, headers: cabeceras })
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
    let pide: ErrorApi['pide'] = undefined
    try {
      const cuerpo = await res.json()
      if (typeof cuerpo?.detail === 'string') detalle = cuerpo.detail
      else if (cuerpo?.detail?.codigo) {
        pide = cuerpo.detail
        detalle = cuerpo.detail.mensaje ?? ''
      }
    } catch {
      // Sin cuerpo JSON (un 502 del proxy, por ejemplo): queda el codigo.
    }
    if (res.status === 403 && !detalle) detalle = 'Tu rol no tiene acceso a esto.'
    const error = new ErrorApi(detalle || `El servidor respondió ${res.status}.`, res.status)
    error.pide = pide
    throw error
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

export const rango = (desde: string, hasta: string) => `desde=${desde}&hasta=${hasta}`

export const api = {
  async entrar(usuario: string, clave: string) {
    await guardarToken(null)
    const res = await fetch(`${base}/api/acceso/login`, {
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

  /**
   * La portada en UNA llamada (routers/app_movil.py): con datos moviles cada
   * viaje tarda uno o dos segundos y siete viajes eran diez segundos de
   * "Cargando" (Leider, 23-oct). Las piezas sueltas quedan por si el
   * servidor es viejo y no la tiene (404).
   */
  inicio: () =>
    req<{
      resumen: ReporteResumen | null
      pedidos: unknown[]
      cocina: unknown[]
      cobrar: unknown[]
      avisos: Aviso[] | null
      recorrido: Recorrido | null
      arranque: ArranqueLocal | null
    }>('/app/inicio'),
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
  fiado: () => req<CuentaPorCobrar[]>('/caja/fiado'),
  tasa: () => req<EstadoTasa>('/tasas'),
}
