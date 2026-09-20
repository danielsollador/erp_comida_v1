import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import { flushSync } from 'react-dom'

/**
 * Tema claro / oscuro.
 *
 * El valor vive en `<html data-tema>` y en localStorage con la misma clave que
 * usan login.html e inicio.html: se elige una vez y vale para todo el
 * producto. El script del <head> lo aplica antes de pintar; aqui solo se lee
 * y se cambia.
 *
 * COMO SE ANIMA. No con `transition` en cada nodo: eso obligaba al navegador
 * a recalcular y repintar los 1.600 elementos del POS en cada fotograma, y de
 * ahi los saltos de FPS. Se usa View Transitions: el navegador toma una foto
 * del antes, se cambia el atributo, toma la foto del despues, y el compositor
 * revela la nueva en circulo desde el boton que se pulso (`--vp-x/--vp-y`,
 * ver index.css). Un fotograma de trabajo real; el resto es GPU.
 *
 * `flushSync` es obligatorio y no una optimizacion: `startViewTransition` toma
 * la foto del "despues" cuando su callback retorna, y React agrupa los
 * `setState` para aplicarlos mas tarde. Sin forzar el volcado, la foto saldria
 * con el icono viejo del interruptor.
 */
export type Tema = 'claro' | 'oscuro'

const CLAVE = 'vertigo_tema'
const EVENTO = 'vertigo:tema'

type DocConTransicion = Document & {
  startViewTransition?: (cb: () => void) => { finished: Promise<void> }
}

function leerActual(): Tema {
  return document.documentElement.dataset.tema === 'oscuro' ? 'oscuro' : 'claro'
}

function reducirMovimiento(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

export function useTema() {
  const [tema, setTema] = useState<Tema>(leerActual)

  useEffect(() => {
    const sync = () => setTema(leerActual())
    window.addEventListener(EVENTO, sync)
    return () => window.removeEventListener(EVENTO, sync)
  }, [])

  const cambiar = useCallback((nuevo: Tema, origen?: { x: number; y: number }) => {
    const raiz = document.documentElement
    const aplicar = () => {
      raiz.dataset.tema = nuevo
      try {
        localStorage.setItem(CLAVE, nuevo)
      } catch {
        // sin localStorage (modo privado estricto) el tema vale solo esta visita
      }
      flushSync(() => setTema(nuevo))
      window.dispatchEvent(new Event(EVENTO))
    }

    const doc = document as DocConTransicion
    if (doc.startViewTransition && !reducirMovimiento()) {
      // Desde donde se revela: el boton pulsado, o el centro si no hay origen.
      // El radio llega a la esquina mas lejana para que el circulo cubra todo.
      const x = origen?.x ?? window.innerWidth / 2
      const y = origen?.y ?? window.innerHeight / 2
      const radio = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
      raiz.style.setProperty('--vp-x', `${x}px`)
      raiz.style.setProperty('--vp-y', `${y}px`)
      raiz.style.setProperty('--vp-radio', `${Math.ceil(radio)}px`)
      doc.startViewTransition(aplicar)
      return
    }

    // Respaldo: transicion corta solo en los contenedores grandes (index.css).
    raiz.classList.add('vp-cambiando-tema')
    aplicar()
    window.setTimeout(() => raiz.classList.remove('vp-cambiando-tema'), 240)
  }, [])

  const alternar = useCallback(
    (origen?: { x: number; y: number }) => cambiar(leerActual() === 'oscuro' ? 'claro' : 'oscuro', origen),
    [cambiar],
  )

  return { tema, cambiar, alternar }
}

/** El interruptor. El icono dice a DONDE lleva pulsar, no donde estas. */
export function TemaToggle({ dark = false }: { dark?: boolean }) {
  const { tema, alternar } = useTema()
  const aOscuro = tema === 'claro'

  function onClick(e: MouseEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    alternar({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={aOscuro ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
      title={aOscuro ? 'Modo oscuro' : 'Modo claro'}
      className={`w-9 h-9 rounded-full border grid place-items-center ${
        dark
          ? 'border-neutral-700 text-neutral-400 hover:text-white hover:border-neutral-500'
          : 'border-neutral-200 text-neutral-500 hover:text-neutral-900 hover:border-neutral-400 bg-white'
      }`}
    >
      {aOscuro ? (
        <svg key="luna" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.5 14.2A8.6 8.6 0 1 1 9.8 3.5a6.9 6.9 0 0 0 10.7 10.7z" />
        </svg>
      ) : (
        <svg key="sol" viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
        </svg>
      )}
    </button>
  )
}
