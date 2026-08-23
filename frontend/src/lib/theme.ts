// Paleta rotativa por categoria, inspirada en POS de referencia (Toast/Square):
// colores pastel de alto contraste para escaneo rapido en pantalla tactil.
const PALETA = [
  { bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-800', dot: 'bg-amber-400' },
  { bg: 'bg-sky-50', border: 'border-sky-300', text: 'text-sky-800', dot: 'bg-sky-400' },
  { bg: 'bg-rose-50', border: 'border-rose-300', text: 'text-rose-800', dot: 'bg-rose-400' },
  { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-800', dot: 'bg-emerald-400' },
  { bg: 'bg-violet-50', border: 'border-violet-300', text: 'text-violet-800', dot: 'bg-violet-400' },
  { bg: 'bg-orange-50', border: 'border-orange-300', text: 'text-orange-800', dot: 'bg-orange-400' },
]

export function colorCategoria(categoriaId: number) {
  return PALETA[categoriaId % PALETA.length]
}
