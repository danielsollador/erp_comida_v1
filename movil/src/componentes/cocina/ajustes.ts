import * as Haptics from 'expo-haptics'
import { Vibration } from 'react-native'
import * as almacen from '../../lib/almacen'

/*
 * LO QUE LA COCINA ELIGE PARA ESTE EQUIPO: si avisa al llegar una comanda y
 * de que tamaño se ven las letras. Como en la web, se guarda en el aparato
 * (la tablet de la cocina tiene su distancia y sus ojos), con las mismas
 * claves que usa la web en el navegador.
 */

// ── El aviso ────────────────────────────────────────────────────────────────

const CLAVE_AVISO = 'cocina.sonido'

/** Encendido salvo que alguien lo apague (Leider, 28-sep: arrancaba apagado y nadie lo tenia puesto). */
export async function leerAviso(): Promise<boolean> {
  try {
    return (await almacen.leer(CLAVE_AVISO)) !== 'off'
  } catch {
    return true
  }
}

export function guardarAviso(encendido: boolean) {
  almacen.guardar(CLAVE_AVISO, encendido ? 'on' : 'off').catch(() => undefined)
}

/**
 * Entro una comanda. En el telefono y la tablet, vibracion larga: dos
 * golpes repetidos, que se sienten en el bolsillo aunque haya licuadora (la
 * app no trae un modulo de audio, y agregar uno es una dependencia nueva). En
 * la vista web, el mismo timbre de dos tonos de la web.
 */
export function avisarComanda() {
  if (process.env.EXPO_OS === 'web') {
    timbreWeb()
    return
  }
  // En Android el patron son esperas y vibraciones alternadas; en iPhone
  // cada vibracion dura lo que el sistema decide y el patron son las pausas.
  Vibration.vibrate(process.env.EXPO_OS === 'android' ? [0, 380, 160, 380, 160, 380] : [0, 250, 250])
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined)
}

type ConstructorAudio = new () => AudioContext
let audio: AudioContext | null = null

/** El timbre de pages/Cocina.tsx: 880 y 1175 Hz, dos veces. Solo en el navegador. */
function timbreWeb() {
  try {
    const g = globalThis as unknown as { AudioContext?: ConstructorAudio; webkitAudioContext?: ConstructorAudio }
    const Ctor = g.AudioContext ?? g.webkitAudioContext
    if (!Ctor) return
    if (!audio) audio = new Ctor()
    const ctx = audio
    if (ctx.state === 'suspended') void ctx.resume()
    const ahora = ctx.currentTime
    ;[880, 1175, 880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      osc.type = 'sine'
      const t = ahora + i * 0.26
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.7, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.24)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.26)
    })
  } catch {
    // Sin audio la pantalla sigue igual: el resaltado de "Nuevo" queda.
  }
}

// ── El tamaño del texto ─────────────────────────────────────────────────────

const CLAVE_TAMANO = 'vp-cocina-texto'

/**
 * Los cuatro tamaños de la web (lib/cocinaTexto.ts), con los mismos textos.
 * Se eligen en Configuración > Apariencia; esta pantalla solo los lee. Ahi
 * se puede importar `TAMANOS` y `guardarTamano` para ofrecer la eleccion.
 */
export const TAMANOS = [
  { id: 'pequeno', zoom: 0.85, titulo: 'Pequeño', detalle: 'Caben más comandas a la vez.' },
  { id: 'normal', zoom: 1, titulo: 'Normal', detalle: 'Como viene de fábrica.' },
  { id: 'grande', zoom: 1.2, titulo: 'Grande', detalle: 'Se lee desde el fogón.' },
  { id: 'enorme', zoom: 1.45, titulo: 'Enorme', detalle: 'Para una pantalla lejos o alta.' },
] as const

export type TamanoCocina = (typeof TAMANOS)[number]['id']

export async function leerTamano(): Promise<TamanoCocina> {
  try {
    const v = await almacen.leer(CLAVE_TAMANO)
    if (TAMANOS.some((t) => t.id === v)) return v as TamanoCocina
  } catch {
    // sin almacen: el de fabrica
  }
  return 'normal'
}

export function guardarTamano(t: TamanoCocina) {
  almacen.guardar(CLAVE_TAMANO, t).catch(() => undefined)
}

export const zoomDe = (t: TamanoCocina) => TAMANOS.find((x) => x.id === t)?.zoom ?? 1
