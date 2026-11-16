import { Directory, File, Paths } from 'expo-file-system'
import { apiBase } from './api'

/**
 * LO ULTIMO QUE SE VIO, guardado en el telefono para pintarlo al instante.
 *
 * Con datos moviles cada llamada al servidor tarda uno o dos segundos; abrir
 * la portada o el punto de venta y quedarse mirando "Cargando" diez segundos
 * era lo primero que Leider noto (23-oct). Ahora la pantalla sale con lo
 * ultimo que se vio y se corrige sola cuando llega lo nuevo.
 *
 * Va en la carpeta de cache del sistema (el telefono la puede vaciar; no
 * importa, se vuelve a pedir) y separado por servidor: lo de la demo no se
 * cuela en Savora. No es SecureStore: ahi caben 2 KB y una portada pesa 20.
 */
const CARPETA = 'vp-ultimo'

function archivo(clave: string): File {
  const dir = new Directory(Paths.cache, CARPETA)
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
  const servidor = apiBase().replace(/[^a-z0-9]/gi, '_')
  return new File(dir, `${clave}-${servidor}.json`)
}

export function leerCache<T>(clave: string): T | null {
  if (process.env.EXPO_OS === 'web') return null
  try {
    const f = archivo(clave)
    if (!f.exists) return null
    return JSON.parse(f.textSync()) as T
  } catch {
    return null
  }
}

export function guardarCache(clave: string, valor: unknown): void {
  if (process.env.EXPO_OS === 'web') return
  try {
    archivo(clave).write(JSON.stringify(valor))
  } catch {
    // Sin espacio o sin permiso: la proxima vez se pide al servidor, como antes.
  }
}

/** Al salir de la cuenta: lo que se vio no se le queda al siguiente que entre. */
export function vaciarCache(): void {
  if (process.env.EXPO_OS === 'web') return
  try {
    const dir = new Directory(Paths.cache, CARPETA)
    if (dir.exists) dir.delete()
  } catch {
    // nada que vaciar
  }
}
