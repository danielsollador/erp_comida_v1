/** La variante que nace con el producto se llama «Regular» (routers/menu.py)
 *  y no es un sabor ni un tamaño: sola, el renglón del menú dice "Precio".
 *  Cualquier otro nombre es del dueño y se muestra aunque sea la única: si no,
 *  al quitar «Limón» la «Toronja» que queda se leía "Precio" y parecía borrada
 *  (video de Yeimer, 20-oct-2026). */
export function esVarianteSinNombre(variante: string, producto: string): boolean {
  const n = (variante || '').trim().toLowerCase()
  return !n || n === 'regular' || n === (producto || '').trim().toLowerCase()
}
