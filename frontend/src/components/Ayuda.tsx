import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * La explicacion de un dato: que es, de donde sale, como se calcula y para que
 * sirve.
 *
 * POR QUE EXISTE. El ERP muestra noventa y tantas columnas y quince tarjetas de
 * cifras. Quien lo abre por primera vez --y tambien quien lo usa todos los
 * dias-- se encuentra "Reponer", "Costo real", "Confianza", "Base", "Debe" y
 * "Haber" sin nada que diga de que hablan. Un ERP de comida lo maneja gente
 * que no es contador, y la mitad de estos numeros solo sirven si se entiende
 * de donde salen: el margen que se calcula con el costo promedio miente
 * cuando hay inflacion, y esa diferencia es justo la que decide un precio.
 *
 * Leider (16-sep): "cada vez que pose el cursor sobre el titulo de un campo
 * en una tabla, o de una tarjeta, necesita que expliques detalladamente de
 * que trata ese campo o ese KPI, de donde sale, como se calcula, y un ejemplo
 * de como se usa o para que".
 *
 * Las cuatro partes son a proposito y no un texto libre: obligan a que cada
 * definicion responda las mismas cuatro preguntas. Estan todas juntas en
 * `lib/glosario.ts`, que se lee como el manual del sistema.
 */
export type Explicacion = {
  /** Que es, en una linea. */
  que: string
  /** De donde sale el dato: quien lo escribe o que lo mueve. */
  origen?: string
  /** La cuenta, con sus palabras. */
  calculo?: string
  /** Un caso concreto, con numeros, o para que decision sirve. */
  ejemplo?: string
}

const RETRASO_MS = 140
const MARGEN = 8
const ANCHO = 320

type Lado = 'abajo' | 'arriba'

/**
 * Los props que abren la explicacion, para pegarlos a cualquier elemento.
 *
 * Es un hook y no un componente envoltorio porque el sitio donde mas hace
 * falta es el `<th>` de una tabla, que por dentro ya tiene el boton de
 * ordenar: un envoltorio dejaria un boton dentro de otro boton, que ni es
 * HTML valido ni se puede enfocar con el teclado.
 */
export function useAyuda(
  explica: Explicacion | undefined,
  titulo: string,
  { tactil = true }: { tactil?: boolean } = {},
) {
  const [abierta, setAbierta] = useState(false)
  const [caja, setCaja] = useState<{ x: number; y: number; lado: Lado } | null>(null)
  const ancla = useRef<HTMLElement | null>(null)
  const temporizador = useRef<number | undefined>(undefined)
  const id = useId()

  const cerrar = useCallback(() => {
    window.clearTimeout(temporizador.current)
    setAbierta(false)
  }, [])

  const abrir = useCallback((el: HTMLElement, ya = false) => {
    ancla.current = el
    window.clearTimeout(temporizador.current)
    const mostrar = () => {
      const r = el.getBoundingClientRect()
      // Debajo del titulo salvo que no quepa: entonces encima. Se mide contra
      // la PANTALLA (no contra la pagina) porque el panel va `fixed`, que es
      // lo unico que no se recorta dentro de una tabla con scroll propio.
      const alto = 260
      const lado: Lado = r.bottom + alto + MARGEN > window.innerHeight && r.top > alto ? 'arriba' : 'abajo'
      const x = Math.min(Math.max(MARGEN, r.left), window.innerWidth - ANCHO - MARGEN)
      setCaja({ x, y: lado === 'abajo' ? r.bottom + 6 : r.top - 6, lado })
      setAbierta(true)
    }
    if (ya) mostrar()
    else temporizador.current = window.setTimeout(mostrar, RETRASO_MS)
  }, [])

  useEffect(() => () => window.clearTimeout(temporizador.current), [])

  useEffect(() => {
    if (!abierta) return
    // Al desplazar o redimensionar, el ancla se movio y el panel quedaria
    // flotando en el aire: se cierra en vez de perseguirla.
    const alSalir = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return
      cerrar()
    }
    window.addEventListener('scroll', alSalir, true)
    window.addEventListener('resize', alSalir)
    window.addEventListener('keydown', alSalir)
    return () => {
      window.removeEventListener('scroll', alSalir, true)
      window.removeEventListener('resize', alSalir)
      window.removeEventListener('keydown', alSalir)
    }
  }, [abierta, cerrar])

  if (!explica) return { props: {}, panel: null, abierta: false }

  const props = {
    'aria-describedby': abierta ? id : undefined,
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
      // Solo el raton: en una pantalla tactil el "hover" llega pegado al
      // toque y abriria la explicacion cada vez que alguien ordena una
      // columna.
      if (e.pointerType === 'mouse') abrir(e.currentTarget)
    },
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse') cerrar()
    },
    // Con el teclado: al tabular hasta el titulo se abre igual que al pasar
    // el raton, y Escape la cierra.
    onFocus: (e: React.FocusEvent<HTMLElement>) => abrir(e.currentTarget, true),
    onBlur: cerrar,
    ...(tactil
      ? {
          onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
            if (e.pointerType === 'mouse') return
            if (abierta) cerrar()
            else abrir(e.currentTarget, true)
          },
        }
      : {}),
  }

  return { props, abierta, panel: <Panel id={id} titulo={titulo} explica={explica} caja={abierta ? caja : null} /> }
}

function Panel({
  id,
  titulo,
  explica,
  caja,
}: {
  id: string
  titulo: string
  explica: Explicacion
  caja: { x: number; y: number; lado: Lado } | null
}) {
  if (!caja) return null
  return createPortal(
    <div
      id={id}
      role="tooltip"
      style={{
        position: 'fixed',
        left: caja.x,
        top: caja.lado === 'abajo' ? caja.y : undefined,
        bottom: caja.lado === 'arriba' ? window.innerHeight - caja.y : undefined,
        width: ANCHO,
        maxWidth: `calc(100vw - ${MARGEN * 2}px)`,
        zIndex: 60,
        // No intercepta el raton: si lo hiciera, el panel que aparece bajo el
        // cursor se comeria el clic que iba al titulo para ordenar.
        pointerEvents: 'none',
        animation: 'vp-entrar .14s cubic-bezier(.2,.7,.2,1) backwards',
      }}
      className="vp-ayuda rounded-xl border border-neutral-200 bg-white p-3.5 shadow-lg text-left"
    >
      <p className="font-display font-semibold text-sm leading-tight">{titulo}</p>
      <p className="text-[13px] leading-relaxed text-neutral-700 mt-1.5">{explica.que}</p>
      {explica.origen && <Parte rotulo="De dónde sale">{explica.origen}</Parte>}
      {explica.calculo && <Parte rotulo="Cómo se calcula">{explica.calculo}</Parte>}
      {explica.ejemplo && <Parte rotulo="Para qué sirve">{explica.ejemplo}</Parte>}
    </div>,
    document.body,
  )
}

function Parte({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <p className="text-[12px] leading-relaxed text-neutral-600 mt-2">
      <span className="font-semibold text-neutral-500">{rotulo}: </span>
      {children}
    </p>
  )
}

/**
 * La version envoltorio, para un titulo suelto (la cifra de una tarjeta).
 *
 * Marca el texto con un subrayado punteado: sin eso nadie sabe que hay algo
 * que leer ahi.
 */
export function Ayuda({
  explica,
  titulo,
  children,
  className = '',
  tactil = true,
}: {
  explica: Explicacion | undefined
  /** El encabezado del panel. Por defecto, el propio texto del titulo. */
  titulo?: string
  children: ReactNode
  className?: string
  tactil?: boolean
}) {
  const { props, panel } = useAyuda(explica, titulo ?? (typeof children === 'string' ? children : ''), { tactil })
  if (!explica) return <span className={className}>{children}</span>
  return (
    <span {...props} tabIndex={0} className={`vp-con-ayuda ${className}`}>
      {children}
      {panel}
    </span>
  )
}
