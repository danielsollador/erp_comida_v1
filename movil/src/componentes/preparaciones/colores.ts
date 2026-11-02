import { colorFranja as franjaDeLaWeb } from '../../../../frontend/src/lib/paleta'
import type { Paleta } from '../../lib/tema'
import type { TipoArticulo } from '../../lib/tipos'

/*
 * LOS COLORES DE LAS FRANJAS (la olla, el mapa, cada preparacion): los
 * quince tonos de la familia del acento de lib/paleta.ts de la web, que
 * nunca se parecen entre vecinos (Leider, 1-oct).
 *
 * La web los escribe como `oklch(from var(--color-acento-500) L C calc(h +
 * giro))` y React Native no entiende oklch. Aqui se lee L, C y el giro de esa
 * misma cadena (asi, si la web cambia un tono, la app lo sigue sola) y se
 * pasa a hex. El tono del acento es 42 en claro y en oscuro (index.css:
 * `--color-acento-500: oklch(60% 0.123 42)` / `oklch(70% 0.119 42)`), y L y
 * C vienen fijos: las franjas son las mismas en los dos modos, como en la web.
 */
const TONO_ACENTO = 42

/** De oklch a #rrggbb (OKLab de Björn Ottosson, recortado al sRGB). */
function oklchAHex(l: number, c: number, h: number): string {
  const rad = (h * Math.PI) / 180
  const a = c * Math.cos(rad)
  const b = c * Math.sin(rad)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lineal = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
  return (
    '#' +
    lineal
      .map((x) => {
        const g = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055
        return Math.round(Math.min(Math.max(g, 0), 1) * 255)
          .toString(16)
          .padStart(2, '0')
      })
      .join('')
  )
}

const YA: Map<number, string> = new Map()

/** El tono `i` de una serie larga de partes (hasta quince sin repetir). */
export function colorFranja(i: number): string {
  const hecho = YA.get(i)
  if (hecho) return hecho
  const m = /\)\s+([\d.]+)\s+([\d.]+)\s+calc\(h\s*\+\s*(-?[\d.]+)\)/.exec(franjaDeLaWeb(i))
  const color = m ? oklchAHex(Number(m[1]), Number(m[2]), TONO_ACENTO + Number(m[3])) : oklchAHex(0.6, 0.12, TONO_ACENTO)
  YA.set(i, color)
  return color
}

/**
 * El punto del tipo de cada mercancia (`PuntoTipo` de la web): materia prima
 * en el acento, reventa en verde, consumible en gris, desechable en ambar y la
 * preparacion en el acento fuerte. Con los colores del tema, que cambian
 * solos en oscuro.
 */
export function colorDeTipo(tipo: TipoArticulo, t: Paleta): string {
  switch (tipo) {
    case 'reventa':
      return t.exito500
    case 'consumible':
      return t.suave
    case 'desechable':
      return t.aviso
    case 'preparacion':
      return t.acentoFuerte
    default:
      return t.acento400
  }
}
