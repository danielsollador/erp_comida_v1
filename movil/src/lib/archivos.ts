import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { Platform } from 'react-native'
import { API_BASE, cabecerasDeSesion, ErrorApi } from './api'

/**
 * DESCARGAR UN ARCHIVO DEL SERVIDOR (el libro de compras en .xlsx, una
 * planilla de conteo, un CSV) y ofrecerlo para compartir.
 *
 * Un telefono no tiene "carpeta de descargas" a la vista: el archivo se pide
 * con el token, se guarda en la cache de la app y se abre el menu de
 * compartir del sistema, donde el dueño elige WhatsApp, Drive o Archivos.
 * Es lo mismo que hace la app de la tablet (frontend/src/lib/plataforma.ts).
 * En el navegador, la descarga de siempre.
 */
export async function descargar(ruta: string, nombre: string): Promise<void> {
  const url = `${API_BASE}/api${ruta}`
  if (Platform.OS === 'web') {
    const res = await fetch(url, { headers: cabecerasDeSesion() })
    if (!res.ok) throw new ErrorApi(`No se pudo descargar (${res.status}).`, res.status)
    const blob = await res.blob()
    const enlace = globalThis.document.createElement('a')
    enlace.href = URL.createObjectURL(blob)
    enlace.download = nombre
    enlace.click()
    URL.revokeObjectURL(enlace.href)
    return
  }
  const destino = new File(Paths.cache, nombre)
  let archivo: File
  try {
    archivo = await File.downloadFileAsync(url, destino, { headers: cabecerasDeSesion(), idempotent: true })
  } catch (e) {
    const texto = e instanceof Error ? e.message : ''
    const estado = Number(/(\d{3})/.exec(texto)?.[1] ?? 0)
    throw new ErrorApi(
      estado === 403 ? 'Tu rol no tiene acceso a esto.' : 'No se pudo descargar el archivo. Revisa el internet.',
      estado,
    )
  }
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(archivo.uri)
}

/**
 * Lo que sale de la camara, la galeria o el selector de documentos, listo
 * para ir en un FormData. En el telefono basta { uri, name, type }; en el
 * navegador hace falta el archivo de verdad (un Blob).
 */
export async function paraSubir(
  uri: string,
  nombre: string,
  tipo: string,
): Promise<Blob | { uri: string; name: string; type: string }> {
  if (Platform.OS === 'web') {
    const res = await fetch(uri)
    return await res.blob()
  }
  return { uri, name: nombre, type: tipo }
}

/** Arma el FormData con un archivo bajo `campo` (y otros campos de texto). */
export async function formularioConArchivo(
  campo: string,
  archivo: { uri: string; nombre: string; tipo: string },
  extra: Record<string, string> = {},
): Promise<FormData> {
  const datos = new FormData()
  const parte = await paraSubir(archivo.uri, archivo.nombre, archivo.tipo)
  if (parte instanceof Blob) datos.append(campo, parte, archivo.nombre)
  // React Native acepta el objeto { uri, name, type } como archivo.
  else datos.append(campo, parte as unknown as Blob)
  for (const [k, v] of Object.entries(extra)) datos.append(k, v)
  return datos
}
