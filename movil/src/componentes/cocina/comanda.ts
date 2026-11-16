import { MINUTOS_EDITANDO } from '../../../../frontend/src/lib/comandas'
import type { Paleta } from '../../lib/tema'
import type { Pedido } from '../../lib/tipos'

/*
 * La logica de una comanda en la pantalla de cocina, la de pages/Cocina.tsx
 * y lib/comandas.ts de la web, con una diferencia a proposito: los minutos se
 * cuentan con el reloj DEL LOCAL (Caracas), no con el del aparato. El backend
 * guarda la hora local sin zona; un telefono con otra zona mostraba "240 min"
 * a una comanda recien llegada.
 */

/** Milisegundos de una hora local del backend ("2026-10-11T15:45:00.123456"), leida como reloj de pared. */
function relojDe(iso: string): number {
  const limpio = iso.replace(/(\.\d{3})\d+$/, '$1')
  // Con zona (no deberia pasar): se pasa a Caracas, UTC-4.
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(limpio)) return Date.parse(limpio) - 4 * 3600_000
  return Date.parse(`${limpio}Z`)
}

/** El reloj de pared de Caracas ahora, en la misma escala que `relojDe`. */
const ahoraEnElLocal = () => Date.now() - 4 * 3600_000

export function minutosDesde(iso: string | null): number {
  if (!iso) return 0
  const ms = relojDe(iso)
  if (Number.isNaN(ms)) return 0
  return Math.max(0, Math.floor((ahoraEnElLocal() - ms) / 60000))
}

/**
 * El punto de venta tiene la comanda abierta AHORA: la cocina no la toca.
 * La misma regla de `editandoAhora` de la web (el candado vence a los
 * MINUTOS_EDITANDO), con el reloj del local.
 */
export function editandoAhora(p: Pedido): boolean {
  if (!p.editando_desde) return false
  const ms = relojDe(p.editando_desde)
  if (Number.isNaN(ms)) return false
  return (ahoraEnElLocal() - ms) / 60000 < MINUTOS_EDITANDO
}

/** Cuanto lleva esperando: verde, ambar desde 6 min, rojo desde 12 (estiloAntiguedad de la web). */
export function antiguedad(minutos: number): 'bien' | 'ojo' | 'mal' {
  if (minutos >= 12) return 'mal'
  if (minutos >= 6) return 'ojo'
  return 'bien'
}

/**
 * EL COLOR DE LA CATEGORIA en cada renglon, igual que en el mostrador
 * (Leider, 21-sep: "los colores tienen que estar para cocina tambien"). Los
 * cinco tintes de la web (lib/theme.ts: ambar, cobre, verde, gris, rojo) con
 * los colores del tema de la app, asi el modo oscuro sale solo. Sin color
 * elegido, el automatico por el id de la categoria, como en la web.
 */
type NombreTinte = 'ambar' | 'cobre' | 'verde' | 'gris' | 'rojo'
const AUTOMATICO: NombreTinte[] = ['ambar', 'cobre', 'verde', 'gris', 'rojo']

export type Tinte = { fondo: string; borde: string }

export function tinteDeCategoria(t: Paleta, categoriaId: number, color?: string | null): Tinte {
  const nombre = (AUTOMATICO as string[]).includes(color ?? '')
    ? (color as NombreTinte)
    : AUTOMATICO[categoriaId % AUTOMATICO.length]
  // El borde es el color de la familia con transparencia: el "300" de la web.
  switch (nombre) {
    case 'ambar':
      return { fondo: t.avisoSuave, borde: t.avisoLinea }
    case 'cobre':
      return { fondo: t.acentoSuave, borde: `${t.acento400}80` }
    case 'verde':
      return { fondo: t.exitoSuave, borde: `${t.exito500}66` }
    case 'rojo':
      return { fondo: t.peligroSuave, borde: `${t.peligro}55` }
    default:
      return { fondo: t.gris100, borde: t.gris200 }
  }
}

/** Las columnas del tablero, con los mismos cortes de la web (sm 640, lg 1024, xl 1280, 2xl 1536). */
export function columnasPara(ancho: number): number {
  if (ancho >= 1536) return 5
  if (ancho >= 1280) return 4
  if (ancho >= 1024) return 3
  if (ancho >= 640) return 2
  return 1
}
