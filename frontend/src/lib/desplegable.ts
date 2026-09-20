import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

/**
 * Un menu que cuelga de un boton de la cabecera, cuando se abre en un telefono.
 *
 * En tablet y escritorio el menu se alinea a la derecha del boton y cabe. En
 * un telefono el boton de la moneda queda en mitad de la barra y el menu es
 * mas ancho que lo que hay a su izquierda: salia cortado ("ODOS LOS MONTOS
 * COMO", 20-sep). Por debajo de `sm` el menu pasa a ocupar el ancho de la
 * pantalla menos un margen, se alinee donde se alinee su boton.
 *
 * Se corre con `absolute` y no con `fixed`: la barra lleva `backdrop-filter`,
 * que hace de contenedor de lo fijo y desplazaria las cuentas. Devuelve
 * `undefined` fuera del telefono, para que manden las clases de siempre.
 */
const MARGEN = 12
const TELEFONO = 640 // el `sm` de Tailwind

export function useAnchoDeTelefono(
  caja: RefObject<HTMLElement | null>,
  abierto: boolean,
): CSSProperties | undefined {
  const [estilo, setEstilo] = useState<CSSProperties | undefined>()
  useLayoutEffect(() => {
    if (!abierto) return
    const medir = () => {
      const el = caja.current
      if (!el || window.innerWidth >= TELEFONO) {
        setEstilo(undefined)
        return
      }
      const r = el.getBoundingClientRect()
      setEstilo({
        width: window.innerWidth - MARGEN * 2,
        right: Math.round(r.right - window.innerWidth + MARGEN),
      })
    }
    medir()
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
  }, [caja, abierto])
  return estilo
}
