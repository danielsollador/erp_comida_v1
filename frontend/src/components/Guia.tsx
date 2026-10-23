import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { SelloIA } from './ia'

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
  // En el teléfono la tarjeta va pegada abajo (o arriba, si lo señalado está
  // abajo), a todo el ancho: flotando junto al botón tapaba media pantalla.
  const chico = window.innerWidth < 640
  const abajo = caja ? caja.bottom + 200 < window.innerHeight : true
  const tarjetaTop = caja ? (abajo ? caja.bottom + M + 10 : Math.max(12, caja.top - M - 10)) : window.innerHeight / 2
  const tarjetaLeft = caja ? Math.min(Math.max(12, caja.left), window.innerWidth - 352) : window.innerWidth / 2 - 170
  const arribaEnTel = !!caja && caja.top + caja.height / 2 > window.innerHeight * 0.55
  const posicion: CSSProperties = chico
    ? arribaEnTel
      ? { left: 12, right: 12, top: 'calc(12px + env(safe-area-inset-top))' }
      : { left: 12, right: 12, bottom: 'calc(12px + env(safe-area-inset-bottom))' }
    : {
        top: tarjetaTop,
        left: tarjetaLeft,
        transform: caja && !abajo ? 'translateY(-100%)' : caja ? undefined : 'translateY(-50%)',
      }

  return createPortal(
    <div className="fixed inset-0 z-[60] pointer-events-none" aria-live="polite">
      {caja ? (
        <>
          <div
            className="fixed rounded-2xl transition-all duration-300"
            style={{
              top: caja.top - M,
              left: caja.left - M,
              width: caja.width + M * 2,
              height: caja.height + M * 2,
              boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)',
              transitionTimingFunction: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
            }}
          />
          {/* El anillo va aparte: su pulso anima `box-shadow` y pisaría el velo. */}
          <div
            className={`fixed rounded-2xl ring-2 ring-white transition-all duration-300 ${tocar ? 'vp-ia-pulso' : ''}`}
            style={{
              top: caja.top - M,
              left: caja.left - M,
              width: caja.width + M * 2,
              height: caja.height + M * 2,
              transitionTimingFunction: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
            }}
          />
        </>
      ) : (
        <div className="vp-ia-velo fixed inset-0 bg-black/55" />
      )}
      <div
        role="dialog"
        aria-label={paso.titulo}
        className={`vp-ia-aparecer fixed pointer-events-auto rounded-3xl bg-white p-5 shadow-[0_1px_2px_rgb(0_0_0/.06),0_16px_40px_rgb(0_0_0/.22)] ${chico ? '' : 'w-[340px] max-w-[calc(100vw-24px)]'}`}
        style={posicion}
      >
        <div className="flex items-center gap-2.5">
          <SelloIA tam={26} />
          <p className="text-xs font-medium text-neutral-500 tabular-nums">
            Paso {n + 1} de {total}
          </p>
        </div>
        <div className="mt-2.5 flex gap-1" aria-hidden="true">
          {Array.from({ length: total }, (_, k) => (
            <span
              key={k}
              className={`h-1 flex-1 rounded-full transition-colors duration-300 ${k <= n ? 'bg-[var(--vp-acento)]' : 'bg-neutral-200'}`}
            />
          ))}
        </div>
        <h3 className="mt-3 font-[Sora] text-[18px] font-semibold leading-tight tracking-[-0.01em]">{paso.titulo}</h3>
        <p className="mt-1.5 text-[15px] leading-normal text-neutral-700">{paso.texto}</p>
        {perdido && (
          <p className="mt-2 rounded-xl bg-aviso-500/10 px-3 py-2 text-[13px] text-aviso-800">
            {n > 0
              ? 'Esto aparece cuando haces el paso anterior. Si ya lo hiciste y no lo ves, toca Atrás.'
              : 'No veo ese botón en esta pantalla. Puede que tu usuario no tenga ese permiso.'}
          </p>
        )}
        {tocar && caja && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-neutral-900">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 11V5a2 2 0 1 1 4 0v6M13 10.5V9a2 2 0 1 1 4 0v4.5a6.5 6.5 0 0 1-13 0V12a2 2 0 1 1 4 0" />
            </svg>
            Tócalo tú para seguir
          </p>
        )}
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
