import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Arrastrar y soltar con el dedo.
 *
 * POR QUE NO EL DEL NAVEGADOR. El arrastre de HTML (`draggable` + `dragstart`)
 * no existe en pantallas tactiles: en iPad y en Android no dispara nada, y
 * este ERP se usa en tablets. Asi que se hace con eventos de puntero, que son
 * los mismos para el dedo, el lapiz y el raton.
 *
 * COMO SE USA. Quien arrastra llama a `empezar` desde `onPointerDown` con lo
 * que esta moviendo. Quien recibe se marca con `data-soltar="<id>"` en el DOM;
 * este modulo mira debajo del puntero con `elementFromPoint` --no con
 * `onDragOver`-- y por eso funciona aunque el destino este dentro de una
 * lista que se desplaza.
 *
 * EL UMBRAL. No se arrastra hasta que el dedo se mueve `UMBRAL` pixeles: sin
 * eso, cada toque para abrir un producto empezaba un arrastre y la pantalla
 * temblaba. Debajo del umbral el toque sigue su curso normal (el `click` se
 * dispara como siempre).
 */
const UMBRAL = 8

export type Arrastre<T> = {
  /** Lo que se esta moviendo, o null si no hay nada en el aire. */
  carga: T | null
  /** El `data-soltar` que hay debajo del dedo, para resaltarlo. */
  sobre: string | null
  /** Donde esta el dedo, para dibujar el fantasma. */
  punto: { x: number; y: number } | null
  empezar: (e: React.PointerEvent, carga: T) => void
}

export function useArrastre<T>(alSoltar: (carga: T, destino: string) => void): Arrastre<T> {
  const [carga, setCarga] = useState<T | null>(null)
  const [sobre, setSobre] = useState<string | null>(null)
  const [punto, setPunto] = useState<{ x: number; y: number } | null>(null)
  // En refs ademas de en estado: los escuchas del documento se registran una
  // sola vez y leerian el estado viejo de la clausura.
  const cargaRef = useRef<T | null>(null)
  const sobreRef = useRef<string | null>(null)
  const inicio = useRef<{ x: number; y: number } | null>(null)
  const candidata = useRef<T | null>(null)
  const alSoltarRef = useRef(alSoltar)
  alSoltarRef.current = alSoltar

  const limpiar = useCallback(() => {
    cargaRef.current = null
    candidata.current = null
    inicio.current = null
    sobreRef.current = null
    setCarga(null)
    setSobre(null)
    setPunto(null)
  }, [])

  useEffect(() => {
    const mover = (e: PointerEvent) => {
      if (!candidata.current && !cargaRef.current) return
      const p0 = inicio.current
      if (!cargaRef.current && p0) {
        if (Math.hypot(e.clientX - p0.x, e.clientY - p0.y) < UMBRAL) return
        cargaRef.current = candidata.current
        setCarga(candidata.current)
      }
      // Sin esto la pagina se desplaza debajo de lo que se esta moviendo.
      e.preventDefault()
      setPunto({ x: e.clientX, y: e.clientY })
      const bajo = document.elementFromPoint(e.clientX, e.clientY)
      const zona = bajo?.closest('[data-soltar]')?.getAttribute('data-soltar') ?? null
      if (zona !== sobreRef.current) {
        sobreRef.current = zona
        setSobre(zona)
      }
    }
    const soltar = () => {
      const c = cargaRef.current
      const destino = sobreRef.current
      limpiar()
      if (c !== null && destino) alSoltarRef.current(c, destino)
    }
    // `passive: false` para poder frenar el desplazamiento de la pagina.
    document.addEventListener('pointermove', mover, { passive: false })
    document.addEventListener('pointerup', soltar)
    document.addEventListener('pointercancel', limpiar)
    return () => {
      document.removeEventListener('pointermove', mover)
      document.removeEventListener('pointerup', soltar)
      document.removeEventListener('pointercancel', limpiar)
    }
  }, [limpiar])

  const empezar = useCallback((e: React.PointerEvent, c: T) => {
    // Solo el boton principal: con el derecho se abre el menu del sistema.
    if (e.button !== 0) return
    candidata.current = c
    inicio.current = { x: e.clientX, y: e.clientY }
  }, [])

  return { carga, sobre, punto, empezar }
}
