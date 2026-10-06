/**
 * Las fotos de factura antes de subirlas: achicarlas sin perder la letra y
 * revisarlas antes de gastar una lectura de IA.
 */

// ── Achicar ─────────────────────────────────────────────────────────────────

/**
 * Cuantos pixeles se suben, como mucho: ~4 megapixeles.
 *
 * POR AREA Y NO POR LADO. Antes se limitaba el lado largo a 2000 px, y eso
 * destrozaba los tickets termicos: angostos y muy largos (1080 x 4000), al
 * dejarlos en 2000 de alto quedaban de 540 de ancho y la letra chica dejaba
 * de leerse. Con un tope de area, una hoja carta queda en ~1760 x 2270 (igual
 * de legible que antes) y el ticket conserva su ancho.
 */
export const MAX_PIXELES = 4_200_000
// El lado largo nunca pasa de esto: un panorama raro no deja la foto en 8000 px.
const LADO_TOPE = 4500

/** El tamaño al que se achica una foto de `ancho` x `alto`. Nunca se agranda. */
export function tamanoDeSubida(ancho: number, alto: number): { ancho: number; alto: number } {
  const porArea = Math.sqrt(MAX_PIXELES / Math.max(ancho * alto, 1))
  const porLado = LADO_TOPE / Math.max(ancho, alto, 1)
  const escala = Math.min(1, porArea, porLado)
  return { ancho: Math.max(1, Math.round(ancho * escala)), alto: Math.max(1, Math.round(alto * escala)) }
}

/**
 * La foto lista para subir: derecha y a tamaño de lectura.
 *
 * La foto de un teléfono pesa 3-8 MB y trae más píxeles de los que hacen falta
 * para leer una factura. Achicada queda en unos cientos de KB: sube rápido con
 * datos móviles, ocupa poco en la base, y la lectura con IA cobra por tamaño
 * de imagen.
 *
 * DERECHA: los telefonos guardan la foto acostada y anotan aparte (EXIF) como
 * girarla. `imageOrientation: 'from-image'` la gira al leerla; sin eso, una
 * factura fotografiada en vertical llegaba de lado y la IA la leia peor.
 *
 * Si el navegador no sabe abrirla (algún formato raro), se sube tal cual y el
 * servidor dice qué formatos acepta.
 */
export async function achicarFoto(archivo: File | Blob, calidad = 0.85): Promise<Blob> {
  // Un PDF no es una foto: se sube tal cual y el lector lo lee entero.
  if (archivo.type === 'application/pdf') return archivo
  try {
    const imagen = await createImageBitmap(archivo, { imageOrientation: 'from-image' })
    const { ancho, alto } = tamanoDeSubida(imagen.width, imagen.height)
    const lienzo = document.createElement('canvas')
    lienzo.width = ancho
    lienzo.height = alto
    const ctx = lienzo.getContext('2d')
    if (!ctx) return archivo
    // Fondo blanco: un PNG con transparencia saldría negro en JPEG.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, ancho, alto)
    ctx.drawImage(imagen, 0, 0, ancho, alto)
    imagen.close()
    const achicada = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, 'image/jpeg', calidad))
    return achicada ?? archivo
  } catch {
    return archivo
  }
}

// ── Revisar ─────────────────────────────────────────────────────────────────
//
// Antes de gastar una lectura de IA (y el tiempo de quien espera), se mira si
// la foto se va a poder leer. Todo pasa en el telefono, en milisegundos, sobre
// una copia chica en gris. Los umbrales se calibraron con 80 facturas reales
// escaneadas (Impuestos/10. Facturas asociadas..., 2550 x 3300): nitidas,
// ninguna baja de 189 y su brillo medio nunca de 223; desenfocadas hasta que
// cuesta leerlas, el 98% cae por debajo de 40.

/** Lado largo de la copia que se mide: suficiente para ver las letras. */
export const LADO_REVISION = 800
/** Por debajo de esto la foto esta movida o desenfocada. */
export const NITIDEZ_MINIMA = 40
/** Brillo medio (0-255) por debajo del cual falta luz. */
export const BRILLO_MINIMO = 90
/** El lado corto mas chico con que la letra de una factura todavia se lee. */
export const LADO_CORTO_MINIMO = 700

export type Problema = 'movida' | 'oscura' | 'pequena'

export const TEXTO_PROBLEMA: Record<Problema, string> = {
  movida: 'salió movida o desenfocada',
  oscura: 'está muy oscura',
  pequena: 'es muy pequeña (¿una captura o una foto de WhatsApp?)',
}

export type Medidas = { nitidez: number; brillo: number; ladoCorto: number }

/**
 * Nitidez: la varianza del laplaciano sobre la imagen en gris. Una letra
 * nitida tiene bordes bruscos (el laplaciano se dispara en el borde y es cero
 * en el papel); movida, el borde se difumina y la varianza se desploma.
 */
export function medir(gris: ArrayLike<number>, ancho: number, alto: number, ladoCorto: number): Medidas {
  let suma = 0
  for (let i = 0; i < gris.length; i++) suma += gris[i]
  const brillo = gris.length ? suma / gris.length : 0
  let n = 0
  let media = 0
  let m2 = 0
  for (let y = 1; y < alto - 1; y++) {
    for (let x = 1; x < ancho - 1; x++) {
      const i = y * ancho + x
      const lap = 4 * gris[i] - gris[i - 1] - gris[i + 1] - gris[i - ancho] - gris[i + ancho]
      // Varianza en una sola pasada (Welford): sin guardar el laplaciano entero.
      n++
      const d = lap - media
      media += d / n
      m2 += d * (lap - media)
    }
  }
  return { nitidez: n ? m2 / n : 0, brillo, ladoCorto }
}

export function diagnosticar(m: Medidas): Problema[] {
  const problemas: Problema[] = []
  if (m.ladoCorto < LADO_CORTO_MINIMO) problemas.push('pequena')
  else if (m.nitidez < NITIDEZ_MINIMA) problemas.push('movida')
  if (m.brillo < BRILLO_MINIMO) problemas.push('oscura')
  return problemas
}

/** Lo que tiene de malo esta foto, o nada. Si no se puede abrir, nada: que decida el servidor. */
export async function revisarFoto(archivo: File | Blob): Promise<Problema[]> {
  try {
    const imagen = await createImageBitmap(archivo, { imageOrientation: 'from-image' })
    const escala = Math.min(1, LADO_REVISION / Math.max(imagen.width, imagen.height))
    const ancho = Math.max(3, Math.round(imagen.width * escala))
    const alto = Math.max(3, Math.round(imagen.height * escala))
    const ladoCorto = Math.min(imagen.width, imagen.height)
    const lienzo = document.createElement('canvas')
    lienzo.width = ancho
    lienzo.height = alto
    const ctx = lienzo.getContext('2d', { willReadFrequently: true })
    if (!ctx) return []
    ctx.drawImage(imagen, 0, 0, ancho, alto)
    imagen.close()
    const { data } = ctx.getImageData(0, 0, ancho, alto)
    const gris = new Float32Array(ancho * alto)
    for (let i = 0, j = 0; j < gris.length; i += 4, j++) {
      gris[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    }
    return diagnosticar(medir(gris, ancho, alto, ladoCorto))
  } catch {
    return []
  }
}
