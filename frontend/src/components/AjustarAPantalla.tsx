import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Que una pantalla quepa entera, sin desplazar, sin cambiar su diseño.
 *
 * La portada tiene que verse completa en la laptop y en la tablet aunque
 * lleguen los pasos de arranque o los avisos (Leider, 30-sep: "nunca se
 * necesite hacer scroll... que se ajuste"). Reacomodarla en columnas no
 * gusto ("devuelvelo a como estaba"), asi que aqui no se mueve nada: si el
 * contenido mide mas que la ventana, se reduce entero, parejo, lo justo para
 * caber. Si cabe, se queda en su tamaño.
 *
 * Se ensancha en la misma proporcion en que se reduce, para que al achicarse
 * siga ocupando todo el ancho y no queden franjas vacias a los lados.
 *
 * Por debajo de `desde` (el telefono) no hace nada: ahi se desplaza como
 * cualquier pagina.
 *
 * NUNCA POR DEBAJO DE `MINIMA`. En el Fire HD 8 acostado quedan 520 px de
 * alto y la portada se reducia al 47 %: letra de 6 px y botones que no se
 * atinan con el dedo (Leider, 6-oct: "se ve horrible"). Ahora la tablet
 * acostada tiene su propio acomodo en dos columnas (`apaisado:` en
 * Inicio.tsx) y esto queda solo para el ultimo ajuste. Si caber exigiera
 * bajar de la minima, se deja en su tamaño y se desplaza: una pantalla entera
 * que no se lee no sirve de nada. Con raton la minima es mas baja: la letra
 * de la laptop es grande y al 70 % se lee bien desde la silla.
 */
const minima = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 0.85 : 0.7

// La ultima escala, para volver a la pantalla con el tamaño con que se dejo:
// arrancar siempre en 1 y medir despues era un salto de tamaño al volver del
// punto de venta y al recargar (Leider, 1-oct). Vive en esta pestaña.
const CLAVE_ESCALA = 'vp-escala'
let ultimaEscala = (() => {
  try {
    const n = Number(sessionStorage.getItem(CLAVE_ESCALA))
    return n >= minima() && n <= 1 ? n : 1
  } catch {
    return 1
  }
})()

export default function AjustarAPantalla({ children, desde = 640 }: { children: ReactNode; desde?: number }) {
  const contenido = useRef<HTMLDivElement>(null)
  const [escala, setEscala] = useState(() => (typeof window !== 'undefined' && window.innerWidth >= desde ? ultimaEscala : 1))
  const actual = useRef(escala)

  useLayoutEffect(() => {
    const el = contenido.current
    if (!el) return
    const medir = () => {
      let s = 1
      if (window.innerWidth >= desde) {
        // `offsetHeight` es el alto de maquetacion: no lo cambia el
        // `transform`, asi que medir no depende de la escala puesta.
        const alto = el.offsetHeight
        if (alto > 0) s = Math.min(1, window.innerHeight / alto)
        if (s < minima()) s = 1
      }
      // Umbral chico: si se pasaba por uno o dos pixeles (un monitor con otro
      // alto, la barra del navegador), un umbral grande dejaba la escala en 1
      // y aparecia un scroll minimo (Leider, 30-sep). Pasar de 1 a menos de 1
      // siempre se aplica; entre dos escalas ya reducidas, solo si cambia algo.
      const pasaDe1 = actual.current === 1 && s < 1
      if (pasaDe1 || Math.abs(s - actual.current) > 0.001 || (s === 1 && actual.current !== 1)) {
        actual.current = s
        ultimaEscala = s
        try {
          sessionStorage.setItem(CLAVE_ESCALA, String(s))
        } catch {
          /* sin almacenamiento: dura hasta recargar */
        }
        setEscala(s)
      }
    }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    // Girar la tablet o mostrar/ocultar la barra del navegador cambia el
    // alto disponible sin cambiar el contenido.
    window.addEventListener('resize', medir)
    window.addEventListener('orientationchange', medir)
    window.visualViewport?.addEventListener('resize', medir)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', medir)
      window.removeEventListener('orientationchange', medir)
      window.visualViewport?.removeEventListener('resize', medir)
    }
  }, [desde])

  const reducido = escala < 1
  return (
    <div style={reducido ? { height: '100dvh', overflow: 'hidden' } : undefined}>
      <div
        ref={contenido}
        style={
          reducido
            ? { width: `${100 / escala}%`, transform: `scale(${escala})`, transformOrigin: 'top left' }
            : undefined
        }
      >
        {children}
      </div>
    </div>
  )
}
