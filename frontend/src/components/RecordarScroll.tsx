import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * DONDE ESTABAS EN CADA PANTALLA (Leider, 8-oct).
 *
 * La primera vez que se entra a una pantalla, se entra por arriba. Si ya se
 * había entrado y se vuelve, se vuelve al mismo punto. Sin esto, el
 * navegador dejaba la página donde estaba la anterior: se entraba a
 * Inventario por la mitad.
 *
 * Se guarda por ruta (`/inventario/materia-prima`, no los filtros de la
 * dirección) en sessionStorage: aguanta una recarga y se olvida al cerrar la
 * pestaña o la app. La página llega por partes (los datos tardan), así que
 * la vuelta espera a que la página tenga el alto suficiente; si el dedo se
 * mueve antes, manda el dedo.
 */

const CLAVE = 'vp-scroll'
const ESPERA_MAXIMA = 2500

function leer(): Record<string, number> {
  try {
    const guardado = JSON.parse(sessionStorage.getItem(CLAVE) || '{}')
    return guardado && typeof guardado === 'object' ? guardado : {}
  } catch {
    return {}
  }
}

function escribir(posiciones: Record<string, number>) {
  try {
    sessionStorage.setItem(CLAVE, JSON.stringify(posiciones))
  } catch {
    // Sin almacenamiento (modo privado): se recuerda solo mientras dure la página.
  }
}

export default function RecordarScroll() {
  const { pathname } = useLocation()
  const posiciones = useRef<Record<string, number>>(leer())
  const actual = useRef(pathname)
  const volviendo = useRef(false)

  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
    let guardar = 0
    const alDesplazar = () => {
      // Mientras se vuelve al punto guardado, los saltos no son del usuario.
      if (volviendo.current) return
      posiciones.current[actual.current] = Math.round(window.scrollY)
      window.clearTimeout(guardar)
      guardar = window.setTimeout(() => escribir(posiciones.current), 150)
    }
    window.addEventListener('scroll', alDesplazar, { passive: true })
    return () => {
      window.removeEventListener('scroll', alDesplazar)
      window.clearTimeout(guardar)
      escribir(posiciones.current)
    }
  }, [])

  useLayoutEffect(() => {
    actual.current = pathname
    const destino = posiciones.current[pathname] ?? 0
    if (destino <= 0) {
      window.scrollTo(0, 0)
      return
    }
    volviendo.current = true
    let listo = false
    const terminar = () => {
      if (listo) return
      listo = true
      volviendo.current = false
      observador.disconnect()
      window.clearTimeout(limite)
      for (const e of ['wheel', 'touchstart', 'keydown'] as const) window.removeEventListener(e, terminar)
    }
    const intentar = () => {
      const maximo = document.documentElement.scrollHeight - window.innerHeight
      if (maximo >= destino - 2) {
        window.scrollTo(0, destino)
        terminar()
      }
    }
    const observador = new ResizeObserver(intentar)
    observador.observe(document.body)
    // Si la página nunca llega a ese alto (se borró algo), lo más cerca posible.
    const limite = window.setTimeout(() => {
      window.scrollTo(0, destino)
      terminar()
    }, ESPERA_MAXIMA)
    for (const e of ['wheel', 'touchstart', 'keydown'] as const) window.addEventListener(e, terminar, { passive: true })
    intentar()
    return terminar
  }, [pathname])

  return null
}
