import { useCallback, useEffect, useState } from 'react'

/**
 * EL ALTO QUE LE QUEDA A UN ELEMENTO HASTA EL FONDO DE LA VENTANA.
 *
 * Para las pantallas que tienen que caber enteras sin desplazar la pagina,
 * como la portada (Leider, 1-oct: "que pueda caber TODO sin hacer scroll,
 * asi como el hub"): lo de arriba (cifras, filtros) queda quieto, y la lista
 * toma el alto que sobra y se desplaza por dentro, con su cabecera fija.
 *
 * Solo desde `desde` px de ancho (tablet en adelante). En el telefono la
 * pagina se desplaza entera, que es lo natural con el dedo.
 *
 * El `ref` es de callback: la lista suele aparecer despues de cargar los
 * datos, y un `useRef` medido al montar la pantalla la encontraria vacia.
 */
export function useAltoRestante<T extends HTMLElement>({ margen = 44, desde = 768, minimo = 220 } = {}) {
  const [el, setEl] = useState<T | null>(null)
  const [alto, setAlto] = useState<number | undefined>(undefined)
  const ref = useCallback((nodo: T | null) => setEl(nodo), [])

  useEffect(() => {
    if (!el) return
    // Sin requestAnimationFrame: en una pestaña de fondo no corre, y la
    // lista se quedaba sin alto. Medir es barato y React junta los cambios.
    const medir = () => {
      if (window.innerWidth < desde) {
        setAlto(undefined)
        return
      }
      const arriba = el.getBoundingClientRect().top + window.scrollY
      setAlto(Math.max(minimo, Math.floor(window.innerHeight - arriba - margen)))
    }
    medir()
    // Y otra vez cuando terminan de cargar las fuentes: con la tipografia
    // definitiva una fila de filtros puede bajar de renglon.
    const tarde = window.setTimeout(medir, 400)
    void document.fonts?.ready.then(medir)
    window.addEventListener('resize', medir)
    window.visualViewport?.addEventListener('resize', medir)
    // Lo de arriba puede cambiar de alto (un aviso que aparece, los filtros
    // que bajan de renglon): se vuelve a medir cuando cambia la pagina.
    const ro = new ResizeObserver(medir)
    if (el.parentElement) ro.observe(el.parentElement)
    ro.observe(document.documentElement)
    return () => {
      window.clearTimeout(tarde)
      window.removeEventListener('resize', medir)
      window.visualViewport?.removeEventListener('resize', medir)
      ro.disconnect()
    }
  }, [el, margen, desde, minimo])

  return { ref, alto }
}
