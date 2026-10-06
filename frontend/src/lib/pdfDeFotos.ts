/**
 * Une varias fotos en un solo PDF, una página por foto.
 *
 * Una factura larga no cabe en una foto: llega en dos o tres. Unirlas aquí,
 * en el navegador, hace que el resto no se entere: el servidor recibe un PDF
 * como cualquier otro, el lector lo lee entero (todas las páginas son la
 * misma factura), y el soporte guardado es un solo documento que se ve en el
 * visor de PDF de siempre.
 *
 * Sin librería: un PDF que solo lleva fotos JPEG es poca cosa. Cada foto va
 * tal cual (el PDF entiende JPEG nativo, /DCTDecode), sin volver a
 * comprimirla, y la página toma la forma de la foto.
 */

const ANCHO_PAGINA = 595 // puntos: el ancho de una hoja A4

export type Foto = { jpeg: Uint8Array; ancho: number; alto: number }

/** La foto como JPEG y su tamaño. Si no es JPEG (PNG, WEBP), se convierte. */
async function comoJpeg(foto: Blob): Promise<Foto> {
  const imagen = await createImageBitmap(foto)
  const { width: ancho, height: alto } = imagen
  let jpeg: Blob = foto
  if (foto.type !== 'image/jpeg') {
    const lienzo = document.createElement('canvas')
    lienzo.width = ancho
    lienzo.height = alto
    const ctx = lienzo.getContext('2d')
    if (!ctx) throw new Error('El navegador no pudo preparar la foto.')
    // Fondo blanco: un PNG con transparencia saldría negro en JPEG.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, ancho, alto)
    ctx.drawImage(imagen, 0, 0)
    const convertida = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, 'image/jpeg', 0.9))
    if (!convertida) throw new Error('El navegador no pudo preparar la foto.')
    jpeg = convertida
  }
  imagen.close()
  return { jpeg: new Uint8Array(await jpeg.arrayBuffer()), ancho, alto }
}

export async function unirFotosEnPdf(fotos: Blob[]): Promise<Blob> {
  const pdf = armarPdf(await Promise.all(fotos.map(comoJpeg)))
  return new Blob([pdf as BlobPart], { type: 'application/pdf' })
}

/** El PDF con una página por foto. Aparte del navegador para poder probarlo. */
export function armarPdf(paginas: Foto[]): Uint8Array {
  const codificar = new TextEncoder()
  const partes: Uint8Array[] = []
  const posiciones: number[] = [] // donde empieza cada objeto, para la tabla xref
  let largo = 0
  const escribir = (x: string | Uint8Array) => {
    const bytes = typeof x === 'string' ? codificar.encode(x) : x
    partes.push(bytes)
    largo += bytes.length
  }
  const objeto = (n: number, cuerpo: () => void) => {
    posiciones[n] = largo
    escribir(`${n} 0 obj\n`)
    cuerpo()
    escribir('\nendobj\n')
  }

  // Objetos: 1 catalogo, 2 paginas, y por cada foto 3: pagina, contenido, imagen.
  const n = paginas.length
  const pagina = (i: number) => 3 + i * 3
  escribir('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  objeto(1, () => escribir('<< /Type /Catalog /Pages 2 0 R >>'))
  objeto(2, () =>
    escribir(`<< /Type /Pages /Count ${n} /Kids [${paginas.map((_, i) => `${pagina(i)} 0 R`).join(' ')}] >>`),
  )
  paginas.forEach((p, i) => {
    const ancho = ANCHO_PAGINA
    const alto = Math.round((ANCHO_PAGINA * p.alto) / p.ancho)
    const dibujo = `q ${ancho} 0 0 ${alto} 0 0 cm /Foto Do Q`
    objeto(pagina(i), () =>
      escribir(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ancho} ${alto}] ` +
          `/Resources << /XObject << /Foto ${pagina(i) + 2} 0 R >> >> /Contents ${pagina(i) + 1} 0 R >>`,
      ),
    )
    objeto(pagina(i) + 1, () => escribir(`<< /Length ${dibujo.length} >>\nstream\n${dibujo}\nendstream`))
    objeto(pagina(i) + 2, () => {
      escribir(
        `<< /Type /XObject /Subtype /Image /Width ${p.ancho} /Height ${p.alto} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      )
      escribir(p.jpeg)
      escribir('\nendstream')
    })
  })

  const total = 3 + n * 3
  const inicioXref = largo
  escribir(`xref\n0 ${total}\n0000000000 65535 f \n`)
  for (let i = 1; i < total; i++) escribir(`${String(posiciones[i]).padStart(10, '0')} 00000 n \n`)
  escribir(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`)
  const pdf = new Uint8Array(largo)
  let en = 0
  for (const parte of partes) {
    pdf.set(parte, en)
    en += parte.length
  }
  return pdf
}
