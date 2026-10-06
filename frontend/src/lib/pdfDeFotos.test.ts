import { describe, expect, it } from 'vitest'
import { armarPdf } from './pdfDeFotos'

// Bytes cualquiera: el PDF lleva la foto tal cual, sin mirarla.
const foto = (n: number, ancho: number, alto: number) => ({
  jpeg: new Uint8Array(n).fill(0xff),
  ancho,
  alto,
})

const texto = (pdf: Uint8Array) => new TextDecoder('latin1').decode(pdf)

describe('armarPdf', () => {
  const pdf = armarPdf([foto(1000, 1200, 1600), foto(500, 1600, 800)])
  const t = texto(pdf)

  it('es un PDF con una página por foto', () => {
    expect(t.startsWith('%PDF-1.4')).toBe(true)
    expect(t).toContain('/Type /Pages /Count 2')
    expect(t.trimEnd().endsWith('%%EOF')).toBe(true)
  })

  it('cada foto va entera, con su tamaño, y la página toma su forma', () => {
    expect(t).toContain('/Width 1200 /Height 1600')
    expect(t).toContain('/Filter /DCTDecode /Length 1000')
    expect(t).toContain('/Length 500')
    // Ancho A4 (595) y el alto proporcional a la foto.
    expect(t).toContain('/MediaBox [0 0 595 793]')
    expect(t).toContain('/MediaBox [0 0 595 298]')
  })

  it('la tabla xref apunta al inicio de cada objeto', () => {
    // Si un desplazamiento esta corrido, los visores dicen "PDF dañado".
    const inicioXref = Number(t.match(/startxref\n(\d+)/)![1])
    expect(t.slice(inicioXref, inicioXref + 4)).toBe('xref')
    const filas = t.slice(inicioXref).split('\n').slice(3)
    const total = Number(t.match(/xref\n0 (\d+)/)![1])
    for (let i = 1; i < total; i++) {
      const desde = Number(filas[i - 1].slice(0, 10))
      expect(t.slice(desde, desde + `${i} 0 obj`.length)).toBe(`${i} 0 obj`)
    }
  })
})
