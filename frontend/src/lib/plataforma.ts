/**
 * LA APP Y LA WEB, UN SOLO CODIGO.
 *
 * Sávora corre en el navegador (el panel de siempre) y como app nativa de
 * Android y iOS (Capacitor). En la web el servidor es el mismo origen y la
 * sesion es una cookie HttpOnly. En la app las pantallas vienen DENTRO del
 * paquete --abren al instante, sin cargar una pagina de internet-- y la API
 * vive en otra direccion, donde la cookie no viaja; ahi la sesion es el mismo
 * token firmado, que el servidor entrega en `X-Vp-Token` y la app devuelve en
 * `Authorization: Bearer` (ver backend/app/acceso/auth.py).
 *
 * Todo lo que habla con el servidor pasa por aqui: `urlApi`, `cabeceras`,
 * `recogerToken`, `canalEnVivo`. Lo demas del ERP no se entera de donde corre.
 */
import { Capacitor } from '@capacitor/core'

/** Si esto es la app nativa (y no el navegador). */
export const esApp: boolean = Capacitor.isNativePlatform()

/** 'android' | 'ios' | 'web'. */
export const plataforma: string = Capacitor.getPlatform()

const CLAVE_BASE = 'vp-api-base'
const CLAVE_TOKEN = 'vp-token'

function leer(clave: string): string | null {
  try {
    return localStorage.getItem(clave)
  } catch {
    return null
  }
}

function guardar(clave: string, valor: string | null) {
  try {
    if (valor === null) localStorage.removeItem(clave)
    else localStorage.setItem(clave, valor)
  } catch {
    /* sin almacenamiento: dura lo que dure la pantalla */
  }
}

/**
 * Donde vive el servidor. En la web, el mismo origen (''). En la app, la
 * direccion del local, que se fija al compilar (`VITE_API_BASE`, ver
 * `.env.app`). Se deja escrita para la pagina de entrar (`login.html`), que no
 * pasa por Vite.
 */
export const API_BASE: string = esApp
  ? ((import.meta.env.VITE_API_BASE as string | undefined) || leer(CLAVE_BASE) || '').replace(/\/+$/, '')
  : ''
if (esApp && API_BASE) guardar(CLAVE_BASE, API_BASE)

/** La direccion completa de una ruta del servidor: `urlApi('/api/menu')`. */
export const urlApi = (ruta: string): string => `${API_BASE}${ruta}`

/** Las cabeceras que la app agrega a cada pedido al servidor. */
export function cabecerasApp(): Record<string, string> {
  if (!esApp) return {}
  const token = leer(CLAVE_TOKEN)
  return { 'X-Vp-App': '1', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
}

/** Guarda el token que el servidor entrega al entrar y en cada renovacion. */
export function recogerToken(res: Response) {
  if (!esApp) return
  const token = res.headers.get('X-Vp-Token')
  if (token) guardar(CLAVE_TOKEN, token)
}

/** Al salir de la app: el token deja de existir en el telefono. */
export function olvidarToken() {
  guardar(CLAVE_TOKEN, null)
}

/**
 * El canal en vivo (comandas, avisos). En la web, el mismo origen con su
 * cookie. En la app, la direccion del servidor y el token como subprotocolo
 * (`vp, <token>`): va en la cabecera del saludo, no en la URL.
 */
export function abrirCanalEnVivo(): WebSocket {
  if (!esApp) {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return new WebSocket(`${proto}://${window.location.host}/ws`)
  }
  const base = new URL(API_BASE)
  const proto = base.protocol === 'https:' ? 'wss' : 'ws'
  const token = leer(CLAVE_TOKEN)
  return new WebSocket(`${proto}://${base.host}/ws`, token ? ['vp', token] : undefined)
}

/**
 * Descargar un archivo del servidor (CSV, planillas, respaldos).
 *
 * En la web basta un enlace: la cookie viaja sola. En la app un enlace no
 * lleva el token, y un telefono no tiene "carpeta de descargas" a la vista:
 * se pide con el token, se guarda en la cache de la app y se abre el menu de
 * compartir del sistema, donde el dueño elige WhatsApp, Drive o Archivos.
 */
export async function descargar(ruta: string, nombre: string) {
  if (!esApp) {
    window.location.href = ruta
    return
  }
  const res = await fetch(urlApi(ruta), { headers: cabecerasApp(), cache: 'no-store' })
  if (!res.ok) throw new Error('No se pudo descargar el archivo.')
  recogerToken(res)
  // El nombre que manda el servidor (`Content-Disposition`), si lo manda.
  const disposicion = res.headers.get('Content-Disposition') ?? ''
  const delServidor = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposicion)?.[1]
  if (delServidor) nombre = decodeURIComponent(delServidor)
  const blob = await res.blob()
  const base64 = await new Promise<string>((ok, mal) => {
    const lector = new FileReader()
    lector.onload = () => ok(String(lector.result).split(',')[1] ?? '')
    lector.onerror = () => mal(lector.error)
    lector.readAsDataURL(blob)
  })
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')
  const archivo = await Filesystem.writeFile({ path: nombre, data: base64, directory: Directory.Cache })
  await Share.share({ title: nombre, url: archivo.uri })
}
