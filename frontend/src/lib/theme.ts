// El color de cada categoria del POS, para encontrar "Bebidas" o "Dulces" de
// un vistazo en la pantalla tactil sin leer las pestañas.
//
// Sale de la paleta central (index.css) y de ninguna otra parte: antes era un
// arcoiris de Tailwind (cielo, rosa, violeta...) que no aparecia en ninguna
// otra pantalla y hacia que el POS pareciera de otro aplicativo. Cinco tintes
// bastan para distinguir categorias vecinas; con mas se pierde la paleta.
const PALETA = [
  { bg: 'bg-aviso-50', border: 'border-aviso-300', text: 'text-aviso-800', dot: 'bg-aviso-400' },
  { bg: 'bg-acento-50', border: 'border-acento-300', text: 'text-acento-800', dot: 'bg-acento-400' },
  { bg: 'bg-exito-50', border: 'border-exito-300', text: 'text-exito-800', dot: 'bg-exito-400' },
  { bg: 'bg-neutral-100', border: 'border-neutral-300', text: 'text-neutral-800', dot: 'bg-neutral-400' },
  { bg: 'bg-peligro-50', border: 'border-peligro-300', text: 'text-peligro-800', dot: 'bg-peligro-400' },
]

export function colorCategoria(categoriaId: number) {
  return PALETA[categoriaId % PALETA.length]
}
