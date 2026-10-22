import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * GUÍAS PASO A PASO (spike de IA, 22-oct-2026).
 *
 * El asistente no dibuja nada: devuelve una lista de pasos y esto los recorre
 * sobre la pantalla DE VERDAD. Cada paso dice en qué ruta está y qué
 * elemento resaltar por su `data-guia`; si hace falta, se navega solo.
 *
 * El resto de la pantalla se oscurece pero NO se bloquea: el dueño puede
 * tocar el botón resaltado y hacerlo él mismo, que es la idea (aprender
 * haciendo, no viendo una película).
 *
 * Por eso un paso de "tocar" avanza SOLO cuando el dueño toca el botón (no
 * con "Siguiente"): el paso siguiente suele estar en lo que ese toque abre
 * (la receta, el cuadro de conteo). Si el elemento del paso todavía no
 * existe, la guía lo espera y lo dice, en vez de rendirse.
 */
export type PasoGuia = {
  ruta: string
  ancla: string
  titulo: string
  texto: string
  /** tocar: avanza al tocarlo. escribir/mirar: avanza con "Siguiente". */
  accion?: 'tocar' | 'escribir' | 'mirar'
}

type Ctx = { iniciar: (pasos: PasoGuia[]) => void; activa: boolean }
const GuiaCtx = createContext<Ctx>({ iniciar: () => {}, activa: false })
export const useGuia = () => useContext(GuiaCtx)

const ESPERA_MS = 4000

export function GuiaProvider({ children }: { children: ReactNode }) {
  const [pasos, setPasos] = useState<PasoGuia[]>([])
  const [i, setI] = useState(0)
  const iniciar = useCallback((p: PasoGuia[]) => {
    setPasos(p)
    setI(0)
  }, [])
  const cerrar = () => setPasos([])
  return (
    <GuiaCtx.Provider value={{ iniciar, activa: pasos.length > 0 }}>
      {children}
      {pasos.length > 0 && (
        <Recorrido
          // Un paso nuevo es un recorrido nuevo: se monta de cero y no arrastra
          // la caja ni el "no lo veo" del paso anterior.
          key={i}
          paso={pasos[i]}
          n={i}
          total={pasos.length}
          onAtras={() => setI((x) => Math.max(0, x - 1))}
          onSiguiente={() => (i + 1 >= pasos.length ? cerrar() : setI((x) => x + 1))}
          onCerrar={cerrar}
        />
      )}
    </GuiaCtx.Provider>
  )
}

function Recorrido({
  paso,
  n,
  total,
  onAtras,
  onSiguiente,
  onCerrar,
}: {
  paso: PasoGuia
  n: number
  total: number
  onAtras: () => void
  onSiguiente: () => void
  onCerrar: () => void
}) {
  const navegar = useNavigate()
  const { pathname } = useLocation()
  const [caja, setCaja] = useState<DOMRect | null>(null)
  const [perdido, setPerdido] = useState(false)

  // 1. Llevar a la pantalla del paso si no estamos ya en ella o en una de sus
  //    pestañas (/compras/nueva cuenta como /compras: no se le cambia la
  //    pestaña que el dueño acaba de abrir siguiendo el paso anterior).
  useEffect(() => {
    if (paso.ruta && pathname !== paso.ruta && !pathname.startsWith(paso.ruta + '/')) navegar(paso.ruta)
  }, [paso.ruta, pathname, navegar])

  // 2. Esperar a que el elemento exista (los módulos cargan perezosos) y
  //    seguirlo si la pantalla se mueve.
  useLayoutEffect(() => {
    let el: Element | null = null
    const inicio = Date.now()
    let cuadro = 0
    let llevado = false
    const medir = () => {
      // Se busca en cada cuadro: el elemento puede cambiar (otra fila pasa a
      // ser la primera, la pantalla se vuelve a pintar).
      el = visible(paso.ancla)
      if (el) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) {
          // Se baja hasta el botón UNA vez, cuando aparece: si el módulo
          // tardaba en cargar, se resaltaba bien pero fuera de la pantalla.
          if (!llevado) {
            llevado = true
            if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
          }
          setCaja((antes) => (antes && antes.x === r.x && antes.y === r.y && antes.width === r.width ? antes : r))
          setPerdido(false)
        }
      } else {
        // Se sigue buscando: puede aparecer cuando el dueño haga el paso
        // anterior (abrir el producto, abrir el cuadro de conteo).
        setCaja(null)
        if (Date.now() - inicio > ESPERA_MS) setPerdido(true)
      }
      cuadro = requestAnimationFrame(medir)
    }
    const t = setTimeout(medir, 120)
    return () => {
      clearTimeout(t)
      cancelAnimationFrame(cuadro)
    }
  }, [paso.ancla, paso.ruta])

  // 3. Un paso de "tocar" avanza cuando se toca el elemento resaltado. Se
  //    escucha en captura y sin frenar el clic: el botón hace lo suyo (abrir
  //    la receta) y la guía pasa al siguiente un instante después.
  const tocar = (paso.accion ?? 'tocar') === 'tocar'
  useEffect(() => {
    if (!tocar) return
    let t = 0
    const alTocar = (e: MouseEvent) => {
      const el = visible(paso.ancla)
      if (!el || !(e.target instanceof Element) || !el.contains(e.target)) return
      // Lo que solo despliega (un producto con variantes) no es el toque que
      // se pedía: se espera al de la variante.
      const plegable = e.target.closest('[aria-expanded]')
      if (plegable && el.contains(plegable)) return
      t = window.setTimeout(onSiguiente, 450)
    }
    document.addEventListener('click', alTocar, true)
    return () => {
      document.removeEventListener('click', alTocar, true)
      window.clearTimeout(t)
    }
  }, [tocar, paso.ancla, onSiguiente])

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    document.addEventListener('keydown', tecla)
    return () => document.removeEventListener('keydown', tecla)
  }, [onCerrar])

  const M = 8
  const abajo = caja ? caja.bottom + 180 < window.innerHeight : true
  const tarjetaTop = caja ? (abajo ? caja.bottom + M + 10 : Math.max(12, caja.top - M - 10)) : window.innerHeight / 2
  const tarjetaLeft = caja ? Math.min(Math.max(12, caja.left), window.innerWidth - 332) : window.innerWidth / 2 - 160

  return createPortal(
    <div className="fixed inset-0 z-[60] pointer-events-none" aria-live="polite">
      {caja ? (
        <div
          className="fixed rounded-xl ring-2 ring-white/90 transition-all duration-200"
          style={{
            top: caja.top - M,
            left: caja.left - M,
            width: caja.width + M * 2,
            height: caja.height + M * 2,
            boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)',
            transitionTimingFunction: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-black/55" />
      )}
      <div
        role="dialog"
        aria-label={paso.titulo}
        className="fixed w-[320px] max-w-[calc(100vw-24px)] pointer-events-auto rounded-2xl bg-white p-5 shadow-[0_1px_2px_rgb(0_0_0/.06),0_12px_32px_rgb(0_0_0/.18)]"
        style={{
          top: tarjetaTop,
          left: tarjetaLeft,
          transform: caja && !abajo ? 'translateY(-100%)' : caja ? undefined : 'translateY(-50%)',
        }}
      >
        <p className="text-xs text-neutral-500 tabular-nums">
          Paso {n + 1} de {total}
        </p>
        <h3 className="mt-1 font-[Sora] text-[17px] font-semibold leading-tight tracking-[-0.01em]">{paso.titulo}</h3>
        <p className="mt-2 text-[15px] leading-normal text-neutral-700">{paso.texto}</p>
        {perdido && (
          <p className="mt-2 text-[13px] text-aviso-700">
            {n > 0
              ? 'Esto aparece cuando haces el paso anterior. Si ya lo hiciste y no lo ves, toca Atrás.'
              : 'No veo ese botón en esta pantalla. Puede que tu usuario no tenga ese permiso.'}
          </p>
        )}
        {tocar && caja && <p className="mt-2 text-[13px] font-medium text-neutral-900">Tócalo para seguir.</p>}
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={onCerrar}
            className="min-h-11 rounded-xl px-3 text-sm text-neutral-500 active:bg-neutral-100"
          >
            Salir
          </button>
          <span className="flex-1" />
          {n > 0 && (
            <button
              type="button"
              onClick={onAtras}
              className="min-h-11 rounded-xl px-4 text-sm font-medium text-neutral-700 active:bg-neutral-100"
            >
              Atrás
            </button>
          )}
          {/* En un paso de "tocar" el avance lo da el toque; el botón queda
              para saltarlo, más discreto. */}
          <button
            type="button"
            onClick={onSiguiente}
            className={
              tocar && caja
                ? 'min-h-11 rounded-xl px-4 text-sm font-medium text-neutral-500 active:bg-neutral-100'
                : 'min-h-11 rounded-xl bg-neutral-900 px-5 text-sm font-medium text-white active:scale-[.97]'
            }
          >
            {n + 1 >= total ? 'Listo' : tocar && caja ? 'Saltar' : 'Siguiente'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** El primer elemento con esa ancla que se ve (una tabla puede tener varias filas marcadas). */
function visible(ancla: string): Element | null {
  for (const el of document.querySelectorAll(`[data-guia="${ancla}"]`)) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return el
  }
  return null
}
