import { colorFranja } from '../../../../frontend/src/lib/paleta'
import type { Modo } from '../../lib/tema'

/*
 * LOS COLORES DEL MENU, sacados de la paleta de la web.
 *
 * La web los escribe en oklch y con variables de CSS (`oklch(from
 * var(--color-acento-500) …)`); React Native no entiende ninguna de las dos.
 * Aqui se hace la misma cuenta a mano y sale el hex: el mismo tono que se ve
 * en la tablet, sin copiar los numeros a ojo.
 */

/** oklch → "#rrggbb" (la conversion de Björn Ottosson, la que usa CSS). */
export function oklch(l: number, c: number, h: number): string {
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
        const g = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(x, 0), 1 / 2.4) - 0.055
        return Math.round(Math.min(Math.max(g, 0), 1) * 255)
          .toString(16)
          .padStart(2, '0')
      })
      .join('')
  )
}

// El tono del acento de la marca (index.css: --color-acento-*, h = 42 en
// claro y en oscuro). Las franjas toman ESTE tono y le cambian luz y fuerza.
const TONO_ACENTO = 42

type Franja = { color: string; clara: boolean }

/**
 * Las quince franjas del vaso, una por mercancia y en el orden de la receta
 * (lib/paleta.ts, `colorFranja`). Se leen de la misma funcion de la web
 * --"oklch(from … 0.6 0.12 calc(h + 0))"-- para que si alla cambia la tabla,
 * aqui cambie sola. `clara` dice si encima va tinta oscura: el blanco sobre
 * un durazno claro no se lee (la web lo salva con un contorno que SVG en el
 * telefono no dibuja).
 */
const FRANJAS: Franja[] = Array.from({ length: 15 }, (_, i) => {
  const m = /\)\s+([\d.]+)\s+([\d.]+)\s+calc\(h \+ (-?[\d.]+)\)\)/.exec(colorFranja(i))
  if (!m) return { color: oklch(0.6, 0.12, TONO_ACENTO), clara: false }
  const l = Number(m[1])
  return { color: oklch(l, Number(m[2]), TONO_ACENTO + Number(m[3])), clara: l >= 0.7 }
})

export function franja(i: number): Franja {
  return FRANJAS[i % FRANJAS.length]
}

/** El aceite de freir: su propio color, el de la web. */
export const COLOR_ACEITE = '#b8a27a'

// ── El color de cada categoria en el mostrador (lib/theme.ts de la web) ─────

export type NombreColor = 'ambar' | 'cobre' | 'verde' | 'gris' | 'rojo'

export const NOMBRES_COLOR: NombreColor[] = ['ambar', 'cobre', 'verde', 'gris', 'rojo']

export const NOMBRE_COLOR: Record<NombreColor, string> = {
  ambar: 'Ámbar',
  cobre: 'Cobre',
  verde: 'Verde',
  gris: 'Gris',
  rojo: 'Rojo',
}

// El punto de cada tinte es el "400" de su familia, que en oscuro se apaga.
const PUNTO: Record<Modo, Record<NombreColor, string>> = {
  claro: {
    ambar: oklch(0.69, 0.138, 72),
    cobre: oklch(0.69, 0.106, 42),
    verde: oklch(0.69, 0.125, 152),
    gris: '#98948b',
    rojo: oklch(0.69, 0.163, 24),
  },
  oscuro: {
    ambar: oklch(0.62, 0.132, 72),
    cobre: oklch(0.62, 0.102, 42),
    verde: oklch(0.62, 0.12, 152),
    gris: '#7c8290',
    rojo: oklch(0.62, 0.156, 24),
  },
}

export function esColor(v: string | null | undefined): v is NombreColor {
  return !!v && (NOMBRES_COLOR as string[]).includes(v)
}

/**
 * El punto de una categoria: el tinte que eligio el dueño o, si no eligio,
 * el automatico por su `id` (el mismo reparto que el mostrador).
 */
export function puntoCategoria(id: number, color: string | null | undefined, modo: Modo): string {
  const nombre = esColor(color) ? color : NOMBRES_COLOR[id % NOMBRES_COLOR.length]
  return PUNTO[modo][nombre]
}

export function puntoColor(nombre: NombreColor, modo: Modo): string {
  return PUNTO[modo][nombre]
}
