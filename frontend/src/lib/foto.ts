/**
 * Achica una foto antes de subirla.
 *
 * La foto de un teléfono pesa 3-8 MB y trae más píxeles de los que hacen falta
 * para leer una factura. Achicada queda en unos cientos de KB: sube rápido con
 * datos móviles, ocupa poco en la base, y la lectura con IA cobra por tamaño
 * de imagen. 2000 px del lado largo siguen dejando legible la letra chica.
 *
 * Si el navegador no sabe abrirla (algún formato raro), se sube tal cual y el
 * servidor dice qué formatos acepta.
 */
export async function achicarFoto(archivo: File, ladoMaximo = 2000, calidad = 0.85): Promise<Blob> {
  try {
    const imagen = await createImageBitmap(archivo)
    const escala = Math.min(1, ladoMaximo / Math.max(imagen.width, imagen.height))
    const lienzo = document.createElement('canvas')
    lienzo.width = Math.round(imagen.width * escala)
    lienzo.height = Math.round(imagen.height * escala)
    const ctx = lienzo.getContext('2d')
    if (!ctx) return archivo
    ctx.drawImage(imagen, 0, 0, lienzo.width, lienzo.height)
    imagen.close()
    const achicada = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, 'image/jpeg', calidad))
    return achicada ?? archivo
  } catch {
    return archivo
  }
}
