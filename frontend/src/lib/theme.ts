// El color de cada categoria del POS, para encontrar "Bebidas" o "Dulces" de
// un vistazo en la pantalla tactil sin leer las pestañas.
//
// Sale de la paleta central (index.css) y de ninguna otra parte: antes era un
// arcoiris de Tailwind (cielo, rosa, violeta...) que no aparecia en ninguna
// otra pantalla y hacia que el POS pareciera de otro aplicativo. Cinco tintes
// bastan para distinguir categorias vecinas; con mas se pierde la paleta.
//
// LO ELIGE EL DUEÑO. Antes se repartia por el `id` de la categoria: la de
// bebidas quedaba del color que le tocara, y al crear una nueva los colores
// de las viejas se corrian. Ahora cada categoria guarda el nombre de su tinte
// (Menu > Color) y si no tiene, se sigue usando el automatico de siempre.
export type NombreColor = 'ambar' | 'cobre' | 'verde' | 'gris' | 'rojo'

export type TinteCategoria = { bg: string; border: string; text: string; dot: string; barra: string }

export const COLORES: Record<NombreColor, TinteCategoria> = {
  ambar: {
    bg: 'bg-aviso-50',
    border: 'border-aviso-300',
    text: 'text-aviso-800',
    dot: 'bg-aviso-400',
    barra: 'bg-aviso-400',
  },
  cobre: {
    bg: 'bg-acento-50',
    border: 'border-acento-300',
    text: 'text-acento-800',
    dot: 'bg-acento-400',
    barra: 'bg-acento-400',
  },
  verde: {
    bg: 'bg-exito-50',
    border: 'border-exito-300',
    text: 'text-exito-800',
    dot: 'bg-exito-400',
    barra: 'bg-exito-400',
  },
  gris: {
    bg: 'bg-neutral-100',
    border: 'border-neutral-300',
    text: 'text-neutral-800',
    dot: 'bg-neutral-400',
    barra: 'bg-neutral-400',
  },
  rojo: {
    bg: 'bg-peligro-50',
    border: 'border-peligro-300',
    text: 'text-peligro-800',
    dot: 'bg-peligro-400',
    barra: 'bg-peligro-400',
  },
}

/** Como se llama cada tinte en la pantalla de Menu. */
export const NOMBRE_COLOR: Record<NombreColor, string> = {
  ambar: 'Ámbar',
  cobre: 'Cobre',
  verde: 'Verde',
  gris: 'Gris',
  rojo: 'Rojo',
}

export const NOMBRES_COLOR = Object.keys(COLORES) as NombreColor[]

const AUTOMATICO: NombreColor[] = ['ambar', 'cobre', 'verde', 'gris', 'rojo']

export function esColor(v: string | null | undefined): v is NombreColor {
  return !!v && v in COLORES
}

/**
 * El tinte de una categoria: el que eligio el dueño, o uno por su `id`.
 *
 * El automatico se conserva para los locales que ya estaban corriendo: sin
 * esto, al desplegar se les volverian todas las categorias del mismo color
 * hasta que alguien entrara a elegirlos uno por uno.
 */
export function colorCategoria(categoriaId: number, color?: string | null): TinteCategoria {
  if (esColor(color)) return COLORES[color]
  return COLORES[AUTOMATICO[categoriaId % AUTOMATICO.length]]
}
