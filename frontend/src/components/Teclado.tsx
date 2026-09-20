import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

/**
 * El teclado propio del ERP, para las tablets del mostrador.
 *
 * POR QUE EXISTE. En una tablet, tocar un campo abria el teclado del sistema:
 * alfabetico con sugerencias para un monto, ocupando mas de media pantalla y
 * tapando el propio cuadro de cobro. Leider (20-sep): "necesito que se vea a
 * teclado abajo, lo mas pequeno posible... y tambien para texto,
 * porque para texto literalmente no existe nada".
 *
 * COMO FUNCIONA. En una pantalla tactil (`pointer: coarse`) el teclado del
 * sistema no sale nunca: se le dice al navegador `inputmode="none"` y en su
 * lugar se abre este, abajo y lo mas bajo posible; el cuadro abierto se
 * recentra en lo que queda. Dos teclados:
 *
 *   NUMERICO  para todo campo de numero (`<Numerico>`): doce teclas grandes.
 *   TEXTO     para cualquier otro campo de texto o area de texto del ERP, sin
 *             tocar las pantallas: se engancha al foco de la pagina y escribe
 *             en el campo igual que lo haria una persona (React se entera por
 *             el evento `input`).
 *
 * Arriba de las teclas se ve que campo se esta llenando y con que valor, asi
 * da igual si el campo quedo detras. En un computador con raton nada de esto
 * existe: los campos son inputs normales.
 */

type Objetivo =
  | {
      tipo: 'numero'
      etiqueta: string
      valor: string
      oculto: boolean
      entero: boolean
      poner: (v: string) => void
      listo: () => void
    }
  | {
      tipo: 'texto'
      etiqueta: string
      valor: string
      oculto: boolean
      el: HTMLInputElement | HTMLTextAreaElement
    }

type Ctx = {
  abrir: (o: Objetivo) => void
  cerrar: () => void
  actualizar: (valor: string) => void
}

const TecladoCtx = createContext<Ctx | null>(null)

/** Si esta pantalla se maneja con el dedo. Se decide una vez por carga. */
export function esTactil(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  // Para probarlo en un computador: localStorage.setItem('vp-teclado', 'siempre').
  try {
    const forzado = window.localStorage.getItem('vp-teclado')
    if (forzado === 'siempre') return true
    if (forzado === 'nunca') return false
  } catch {
    // sin almacenamiento local, se decide por el puntero
  }
  return window.matchMedia('(pointer: coarse)').matches
}

// ── El panel ────────────────────────────────────────────────────────────────
//
// ABAJO, Y LO MAS BAJO POSIBLE. Se probo anclado al costado y era incomodo
// para escribir: con la tablet apoyada, los pulgares estan abajo. Asi que va
// abajo como un teclado, pero con lo minimo: teclas de 36 px, sin fila de
// sugerencias, y el numerico ocupa solo su bloque al lado de la barra y deja
// el resto para decir que se esta escribiendo. El cuadro abierto se recentra
// en lo que queda de pantalla (variable `--vp-teclado-abajo`).

const tecla =
  'rounded-md font-medium select-none active:scale-95 transition-transform bg-neutral-100 text-neutral-900 hover:bg-neutral-200 disabled:opacity-30'
const especial = 'bg-neutral-200 text-neutral-700 hover:bg-neutral-300'
const principal = 'bg-neutral-900 text-white hover:bg-neutral-800'

// Alto del panel, para que el cuadro de arriba sepa cuanto correrse.
const ALTO_NUMERO = 176
const ALTO_TEXTO = 236

function Panel({
  objetivo,
  onCerrar,
  onValor,
}: {
  objetivo: Objetivo
  onCerrar: () => void
  onValor: (v: string) => void
}) {
  const alto = objetivo.tipo === 'numero' ? ALTO_NUMERO : ALTO_TEXTO

  useEffect(() => {
    const raiz = document.documentElement.style
    raiz.setProperty('--vp-teclado-abajo', `${alto}px`)
    return () => raiz.setProperty('--vp-teclado-abajo', '0px')
  }, [alto])

  const mostrado = objetivo.oculto ? '•'.repeat(objetivo.valor.length) : objetivo.valor

  return createPortal(
    <div
      data-teclado="1"
      role="dialog"
      aria-label={`Teclado para ${objetivo.etiqueta}`}
      className="fixed inset-x-0 bottom-0 z-[60] bg-white text-neutral-900 shadow-2xl border-t border-neutral-200 pb-[env(safe-area-inset-bottom)]"
      style={{ height: alto, animation: 'vp-entrar .18s cubic-bezier(.2,.7,.2,1) both' }}
      // No robar el foco del campo: si el foco se va, el campo se cierra.
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => e.preventDefault()}
    >
      {objetivo.tipo === 'numero' ? (
        // La barra: a un lado que se escribe, al otro las teclas.
        <div className="h-full max-w-3xl mx-auto px-3 py-2 flex items-stretch gap-4">
          <div className="flex-1 min-w-0 flex flex-col justify-center text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 truncate">{objetivo.etiqueta}</div>
            <div className="text-2xl font-semibold tabular-nums leading-tight truncate">
              {mostrado || <span className="text-neutral-300">0</span>}
            </div>
          </div>
          <div className="w-[260px] shrink-0">
            <Numeros objetivo={objetivo} onCerrar={onCerrar} onValor={onValor} />
          </div>
        </div>
      ) : (
        <div className="h-full max-w-4xl mx-auto px-2 py-1.5 flex flex-col">
          <div className="flex items-baseline gap-3 px-1 h-7 shrink-0">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 truncate shrink-0 max-w-[40%]">
              {objetivo.etiqueta}
            </span>
            <span className="text-sm font-semibold truncate min-w-0">
              {mostrado || <span className="text-neutral-300">…</span>}
              <span className="inline-block w-px h-3.5 bg-neutral-900 align-middle ml-px animate-pulse" />
            </span>
          </div>
          <Letras objetivo={objetivo} onCerrar={onCerrar} onValor={onValor} />
        </div>
      )}
    </div>,
    document.body,
  )
}

// ── Numerico ────────────────────────────────────────────────────────────────

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

function Numeros({
  objetivo,
  onCerrar,
  onValor,
}: {
  objetivo: Extract<Objetivo, { tipo: 'numero' }>
  onCerrar: () => void
  onValor: (v: string) => void
}) {
  const { valor, entero, listo } = objetivo
  // Lo que dice arriba cambia AQUI mismo, sin esperar a que la pantalla
  // vuelva a pintar el campo: si no, va una tecla por detras.
  const poner = (v: string) => {
    onValor(v)
    objetivo.poner(v)
  }

  function pulsar(t: string) {
    if (t === ',') {
      if (entero || valor.includes('.') || valor.includes(',')) return
      poner((valor || '0') + '.')
      return
    }
    // "0" solo es un marcador: la primera tecla lo pisa.
    poner((valor === '0' ? '' : valor) + t)
  }

  function terminar() {
    listo()
    onCerrar()
  }

  const alto = 'h-9 text-lg'
  const d = (t: string) => (
    <button key={t} type="button" onClick={() => pulsar(t)} className={`${tecla} ${alto}`}>
      {t}
    </button>
  )

  return (
    <div className="grid grid-cols-4 gap-1">
      {TECLAS.slice(0, 3).map(d)}
      <button type="button" onClick={() => poner(valor.slice(0, -1))} aria-label="Borrar" className={`${tecla} ${especial} ${alto}`}>
        ⌫
      </button>
      {TECLAS.slice(3, 6).map(d)}
      <button type="button" onClick={() => poner('')} aria-label="Limpiar" className={`${tecla} ${especial} ${alto} text-base`}>
        C
      </button>
      {TECLAS.slice(6, 9).map(d)}
      <button type="button" onClick={terminar} className={`${tecla} ${principal} row-span-2 h-auto text-base`}>
        Listo
      </button>
      <button type="button" onClick={() => pulsar(',')} disabled={entero} className={`${tecla} ${alto}`}>
        ,
      </button>
      {d('0')}
      <button type="button" onClick={terminar} aria-label="Cerrar teclado" className={`${tecla} ${especial} ${alto} text-base`}>
        ▾
      </button>
    </div>
  )
}

// ── Texto ───────────────────────────────────────────────────────────────────

const FILA_NUMEROS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']
const FILA_ACENTOS = ['á', 'é', 'í', 'ó', 'ú', 'ü', '¿', '?', '¡', '!']
const FILAS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ñ'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.'],
]

function Letras({
  objetivo,
  onCerrar,
  onValor,
}: {
  objetivo: Extract<Objetivo, { tipo: 'texto' }>
  onCerrar: () => void
  onValor: (v: string) => void
}) {
  const { el } = objetivo
  const [mayus, setMayus] = useState(() => !el.value)
  const [acentos, setAcentos] = useState(false)

  function insertar(texto: string) {
    const inicio = el.selectionStart ?? el.value.length
    const fin = el.selectionEnd ?? el.value.length
    const nuevo = el.value.slice(0, inicio) + texto + el.value.slice(fin)
    escribirEn(el, nuevo, inicio + texto.length)
    onValor(nuevo)
    // Como en un telefono: mayuscula al empezar y despues de un punto.
    if (mayus && /[a-zñ]/i.test(texto)) setMayus(false)
    if (/[.!?]\s?$/.test(nuevo)) setMayus(true)
  }

  function borrar() {
    const inicio = el.selectionStart ?? el.value.length
    const fin = el.selectionEnd ?? el.value.length
    if (inicio === 0 && fin === 0) return
    const desde = inicio === fin ? inicio - 1 : inicio
    const nuevo = el.value.slice(0, desde) + el.value.slice(fin)
    escribirEn(el, nuevo, desde)
    onValor(nuevo)
    if (!nuevo) setMayus(true)
  }

  function intro() {
    if (el instanceof HTMLTextAreaElement) {
      insertar('\n')
      return
    }
    // Enter en un campo de un formulario es "enviar", como con teclado fisico.
    const form = el.closest('form')
    if (form) {
      form.requestSubmit()
      return
    }
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    el.blur()
    onCerrar()
  }

  function listo() {
    el.blur()
    onCerrar()
  }

  const letra = (t: string) => {
    const texto = mayus ? t.toUpperCase() : t
    return (
      <button key={t} type="button" onClick={() => insertar(texto)} className={`${tecla} h-9 text-base flex-1 min-w-0`}>
        {texto}
      </button>
    )
  }

  return (
    <div className="space-y-1 flex-1 flex flex-col justify-end">
      <div className="flex gap-1">
        {(acentos ? FILA_ACENTOS : FILA_NUMEROS).map((t) => (
          <button key={t} type="button" onClick={() => insertar(mayus && acentos ? t.toUpperCase() : t)} className={`${tecla} h-9 text-sm flex-1 min-w-0`}>
            {mayus && acentos ? t.toUpperCase() : t}
          </button>
        ))}
      </div>
      <div className="flex gap-1">{FILAS[0].map(letra)}</div>
      <div className="flex gap-1 px-4">{FILAS[1].map(letra)}</div>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => setMayus((m) => !m)}
          aria-label="Mayúsculas"
          aria-pressed={mayus}
          className={`${tecla} ${mayus ? principal : especial} h-9 text-base flex-[1.4] min-w-0`}
        >
          ⇧
        </button>
        {FILAS[2].map(letra)}
        <button type="button" onClick={borrar} aria-label="Borrar" className={`${tecla} ${especial} h-9 text-base flex-[1.4] min-w-0`}>
          ⌫
        </button>
      </div>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => setAcentos((a) => !a)}
          aria-pressed={acentos}
          className={`${tecla} ${acentos ? principal : especial} h-9 text-xs flex-[1.4] min-w-0`}
        >
          {acentos ? '123' : 'áé'}
        </button>
        <button type="button" onClick={() => insertar('@')} className={`${tecla} h-9 text-base flex-1 min-w-0`}>
          @
        </button>
        <button type="button" onClick={() => insertar(' ')} aria-label="Espacio" className={`${tecla} h-9 flex-[5] min-w-0`}>
          <span className="block mx-6 h-px bg-neutral-400" />
        </button>
        <button type="button" onClick={() => insertar('-')} className={`${tecla} h-9 text-base flex-1 min-w-0`}>
          -
        </button>
        <button type="button" onClick={intro} aria-label="Intro" className={`${tecla} ${especial} h-9 text-base flex-[1.4] min-w-0`}>
          ↵
        </button>
        <button type="button" onClick={listo} className={`${tecla} ${principal} h-9 text-xs flex-[1.6] min-w-0`}>
          Listo
        </button>
      </div>
    </div>
  )
}

// ── El campo de numero ──────────────────────────────────────────────────────

type CambioComoEvento = { target: { value: string }; currentTarget: { value: string } }

/**
 * Un campo de numero. Mismos props que `<input>` (value, onChange, placeholder,
 * className...), y `onChange` recibe algo con `target.value`, igual que un
 * input: las pantallas no cambian.
 *
 *   oculto  muestra puntos en vez de digitos (el PIN).
 *   entero  sin coma decimal (cantidades, dias).
 */
export function Numerico({
  value,
  onChange,
  etiqueta,
  oculto = false,
  entero = false,
  onBlur,
  onFocus,
  placeholder,
  className = '',
  ...resto
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'type'> & {
  value: string | number | undefined
  onChange: (e: CambioComoEvento) => void
  /** Lo que dice el teclado arriba. Si falta, se toma del label que envuelve o del placeholder. */
  etiqueta?: string
  oculto?: boolean
  entero?: boolean
}) {
  const ctx = useContext(TecladoCtx)
  const tactil = useMemo(esTactil, [])
  const ref = useRef<HTMLInputElement>(null)
  const texto = value === undefined || value === null ? '' : String(value)
  const poner = useCallback(
    (v: string) => onChange({ target: { value: v }, currentTarget: { value: v } }),
    [onChange],
  )

  // Si la pantalla cambia el valor por su cuenta mientras el teclado esta
  // abierto para ESTE campo, lo de arriba lo sigue.
  const abiertoAqui = useRef(false)
  useEffect(() => {
    if (abiertoAqui.current && ctx) ctx.actualizar(texto)
  }, [texto, ctx])

  if (!tactil || !ctx) {
    // Computador: un input de texto con teclado decimal. No `type=number`,
    // que cambia el valor con la rueda del raton y no acepta la coma.
    return (
      <input
        ref={ref}
        type={oculto ? 'password' : 'text'}
        inputMode={entero ? 'numeric' : 'decimal'}
        autoComplete="off"
        value={texto}
        onChange={(e) => onChange(e)}
        onBlur={onBlur}
        onFocus={onFocus}
        placeholder={placeholder}
        className={className}
        {...resto}
      />
    )
  }

  return (
    <input
      // Lo que venga de la pantalla va primero: lo de abajo no se puede pisar
      // (un `inputMode="decimal"` heredado volveria a abrir el teclado del sistema).
      {...resto}
      ref={ref}
      type={oculto ? 'password' : 'text'}
      // `inputMode="none"`: que el navegador NO abra su teclado. `readOnly` es
      // la red por si algun teclado lo ignora; el campo igual recibe el foco.
      inputMode="none"
      readOnly
      data-numerico="1"
      autoComplete="off"
      value={texto}
      onChange={() => undefined}
      placeholder={placeholder}
      className={`${className} caret-transparent`}
      onFocus={(e) => {
        abiertoAqui.current = true
        ctx.abrir({
          tipo: 'numero',
          etiqueta: etiqueta || (ref.current ? rotuloDe(ref.current, 'Número') : 'Número'),
          valor: texto,
          oculto,
          entero,
          poner,
          listo: () => ref.current?.blur(),
        })
        onFocus?.(e)
      }}
      onBlur={(e) => {
        abiertoAqui.current = false
        ctx.cerrar()
        onBlur?.(e)
      }}
    />
  )
}
