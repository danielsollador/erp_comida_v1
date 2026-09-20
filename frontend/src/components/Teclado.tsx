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

/** Los campos de texto a los que se engancha el teclado de texto. */
function campoDeTexto(el: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (!(el instanceof HTMLElement)) return null
  if (el.closest('[data-teclado]')) return null
  if (el instanceof HTMLTextAreaElement) return el.readOnly ? null : el
  if (!(el instanceof HTMLInputElement)) return null
  if (el.readOnly || el.disabled) return null
  const tipo = (el.getAttribute('type') || 'text').toLowerCase()
  if (!['text', 'search', 'password', 'email', 'tel', 'url'].includes(tipo)) return null
  // Los de numero ya traen su teclado (<Numerico>).
  if (el.dataset.numerico === '1') return null
  return el
}

function rotuloDe(el: HTMLElement, porDefecto: string): string {
  const aria = el.getAttribute('aria-label')
  if (aria) return aria
  const label = el.closest('label')
  const texto = label?.textContent?.trim()
  if (texto) return texto.split('\n')[0].slice(0, 40)
  if (el.id) {
    const l = document.querySelector(`label[for="${el.id}"]`)
    if (l?.textContent?.trim()) return l.textContent.trim()
  }
  return (el as HTMLInputElement).placeholder || porDefecto
}

/** Escribe en el campo como lo haria la persona: React lo ve por `input`. */
function escribirEn(el: HTMLInputElement | HTMLTextAreaElement, valor: string, caret: number) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(el, valor)
  else el.value = valor
  el.dispatchEvent(new Event('input', { bubbles: true }))
  try {
    el.setSelectionRange(caret, caret)
  } catch {
    // email y algunos tipos no dejan mover el cursor
  }
}

export function TecladoProvider({ children }: { children: ReactNode }) {
  const [objetivo, setObjetivo] = useState<Objetivo | null>(null)
  const tactil = useMemo(esTactil, [])

  const abrir = useCallback((o: Objetivo) => setObjetivo(o), [])
  const cerrar = useCallback(() => setObjetivo(null), [])
  const actualizar = useCallback((valor: string) => {
    setObjetivo((o) => (o ? { ...o, valor } : o))
  }, [])
  const ctx = useMemo(() => ({ abrir, cerrar, actualizar }), [abrir, cerrar, actualizar])

  // El teclado de TEXTO se engancha a la pagina entera: cualquier campo de
  // texto del ERP, sin que cada pantalla tenga que saberlo.
  useEffect(() => {
    if (!tactil) return
    // ANTES del foco: es lo que evita que el navegador abra el suyo.
    const alTocar = (e: Event) => {
      const el = campoDeTexto(e.target)
      if (el) el.setAttribute('inputmode', 'none')
    }
    const alEnfocar = (e: FocusEvent) => {
      const el = campoDeTexto(e.target)
      if (!el) return
      el.setAttribute('inputmode', 'none')
      setObjetivo({
        tipo: 'texto',
        el,
        etiqueta: rotuloDe(el, 'Texto'),
        valor: el.value,
        oculto: el instanceof HTMLInputElement && el.type === 'password',
      })
    }
    const alSoltar = (e: FocusEvent) => {
      const el = campoDeTexto(e.target)
      if (!el) return
      setObjetivo((o) => (o && o.tipo === 'texto' && o.el === el ? null : o))
    }
    document.addEventListener('touchstart', alTocar, true)
    document.addEventListener('pointerdown', alTocar, true)
    document.addEventListener('focusin', alEnfocar)
    document.addEventListener('focusout', alSoltar)
    return () => {
      document.removeEventListener('touchstart', alTocar, true)
      document.removeEventListener('pointerdown', alTocar, true)
      document.removeEventListener('focusin', alEnfocar)
      document.removeEventListener('focusout', alSoltar)
    }
  }, [tactil])

  return (
    <TecladoCtx.Provider value={ctx}>
      {children}
      {objetivo && <Panel objetivo={objetivo} onCerrar={cerrar} onValor={actualizar} />}
    </TecladoCtx.Provider>
  )
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

// Preferencias de ergonomia, guardadas en ESTA tablet: como se sostiene y
// con que mano se cobra no es igual en todos los mostradores.
type Lado = 'izquierda' | 'centro' | 'derecha'

function leerPreferencia<T extends string>(clave: string, valido: readonly T[], porDefecto: T): T {
  try {
    const v = window.localStorage.getItem(clave)
    if (v && (valido as readonly string[]).includes(v)) return v as T
  } catch {
    // sin almacenamiento local
  }
  return porDefecto
}

function guardarPreferencia(clave: string, valor: string) {
  try {
    window.localStorage.setItem(clave, valor)
  } catch {
    // sin almacenamiento local
  }
}

/** Con la tablet apaisada y ancha, las dos mitades caen bajo los pulgares. */
function convieneDividir(): boolean {
  return window.innerWidth > window.innerHeight && window.innerWidth >= 900
}

const LADOS: readonly Lado[] = ['izquierda', 'centro', 'derecha']
const JUSTIFICAR: Record<Lado, string> = {
  izquierda: 'justify-start',
  centro: 'justify-center',
  derecha: 'justify-end',
}

// Alto del panel, para que el cuadro de arriba sepa cuanto correrse.
const ALTO_NUMERO = 172
const ALTO_TEXTO = 196

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
  const [lado, setLado] = useState<Lado>(() => leerPreferencia('vp-teclado-lado', LADOS, 'centro'))
  const [dividido, setDividido] = useState(() =>
    leerPreferencia('vp-teclado-dividido', ['si', 'no'] as const, convieneDividir() ? 'si' : 'no') === 'si',
  )

  function cambiarLado() {
    const siguiente = LADOS[(LADOS.indexOf(lado) + 1) % LADOS.length]
    setLado(siguiente)
    guardarPreferencia('vp-teclado-lado', siguiente)
  }

  function alternarDividido() {
    setDividido((d) => {
      guardarPreferencia('vp-teclado-dividido', d ? 'no' : 'si')
      return !d
    })
  }

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
        // El bloque (valor + teclas) va al lado que prefiera quien cobra:
        // bajo el pulgar derecho, el izquierdo o al centro. Se cambia con la
        // flecha y la tablet lo recuerda.
        <div className={`h-full px-3 py-2 flex items-stretch gap-4 ${JUSTIFICAR[lado]}`}>
          <div className="w-40 min-w-0 flex flex-col justify-center text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 truncate">{objetivo.etiqueta}</div>
            <div className="text-2xl font-semibold tabular-nums leading-tight truncate">
              {mostrado || <span className="text-neutral-300">0</span>}
            </div>
            <button
              type="button"
              onClick={cambiarLado}
              title="Mover el teclado"
              className="self-end mt-1 text-[11px] text-neutral-500 hover:text-neutral-900"
            >
              {lado === 'izquierda' ? 'Mover al centro →' : lado === 'centro' ? 'Mover a la derecha →' : '← Mover a la izquierda'}
            </button>
          </div>
          <div className="w-[260px] shrink-0">
            <Numeros objetivo={objetivo} onCerrar={onCerrar} onValor={onValor} />
          </div>
        </div>
      ) : (
        <div className={`h-full mx-auto px-2 py-1.5 flex flex-col ${dividido ? 'w-full' : 'max-w-4xl'}`}>
          <div className="flex items-baseline gap-3 px-1 h-7 shrink-0">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 truncate shrink-0 max-w-[40%]">
              {objetivo.etiqueta}
            </span>
            <span className="text-sm font-semibold truncate min-w-0 flex-1">
              {mostrado || <span className="text-neutral-300">…</span>}
              <span className="inline-block w-px h-3.5 bg-neutral-900 align-middle ml-px animate-pulse" />
            </span>
            <button
              type="button"
              onClick={alternarDividido}
              aria-pressed={dividido}
              title={dividido ? 'Juntar el teclado' : 'Dividir el teclado para los pulgares'}
              className="shrink-0 text-[11px] text-neutral-500 hover:text-neutral-900"
            >
              {dividido ? 'Juntar teclado' : 'Dividir teclado'}
            </button>
          </div>
          <Letras objetivo={objetivo} onCerrar={onCerrar} onValor={onValor} dividido={dividido} />
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
//
// CUATRO FILAS, como el teclado de un telefono: tres de letras y la de
// abajo. Los numeros y los simbolos estan detras de la tecla "123", que
// cambia las tres filas de letras por numeros, acentos y signos. Una fila
// menos son 40 px menos de pantalla tapada, y se teclean muchas mas letras
// que numeros (para los montos hay teclado aparte).

const LETRAS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ñ'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
]
const SIMBOLOS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['á', 'é', 'í', 'ó', 'ú', 'ü', '¿', '?', '¡', '!'],
  ['@', '#', '$', '%', '&', '/', '(', ')', '-', ':'],
]

function Letras({
  objetivo,
  onCerrar,
  onValor,
  dividido,
}: {
  objetivo: Extract<Objetivo, { tipo: 'texto' }>
  onCerrar: () => void
  onValor: (v: string) => void
  /** En dos mitades pegadas a los bordes, bajo los pulgares. */
  dividido: boolean
}) {
  const { el } = objetivo
  const [mayus, setMayus] = useState(() => !el.value)
  const [simbolos, setSimbolos] = useState(false)

  function insertar(texto: string) {
    const inicio = el.selectionStart ?? el.value.length
    const fin = el.selectionEnd ?? el.value.length
    const nuevo = el.value.slice(0, inicio) + texto + el.value.slice(fin)
    escribirEn(el, nuevo, inicio + texto.length)
    onValor(nuevo)
    // Como en un telefono: mayuscula al empezar y despues de un punto.
    if (mayus && /[a-zñáéíóúü]/i.test(texto)) setMayus(false)
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

  const filas = simbolos ? SIMBOLOS : LETRAS
  // Juntas, las teclas se reparten el ancho; divididas, cada una mide lo
  // que un pulgar (44 px) y las mitades se pegan a los bordes.
  const fija = dividido ? 'w-11 shrink-0' : 'flex-1 min-w-0'
  const k = (t: string) => {
    const texto = mayus ? t.toUpperCase() : t
    return (
      <button key={t} type="button" onClick={() => insertar(texto)} className={`${tecla} h-9 text-base ${fija}`}>
        {texto}
      </button>
    )
  }
  const ancha = dividido ? 'h-9 text-base w-14 shrink-0' : 'h-9 text-base flex-[1.5] min-w-0'

  const mayusK = (
    <button
      key="mayus"
      type="button"
      onClick={() => setMayus((m) => !m)}
      aria-label="Mayúsculas"
      aria-pressed={mayus}
      className={`${tecla} ${mayus ? principal : especial} ${ancha}`}
    >
      ⇧
    </button>
  )
  const borrarK = (
    <button key="borrar" type="button" onClick={borrar} aria-label="Borrar" className={`${tecla} ${especial} ${ancha}`}>
      ⌫
    </button>
  )
  const simbolosK = (
    <button
      key="simbolos"
      type="button"
      onClick={() => setSimbolos((v) => !v)}
      aria-pressed={simbolos}
      className={`${tecla} ${simbolos ? principal : especial} h-9 text-xs ${dividido ? 'w-14 shrink-0' : 'flex-[1.5] min-w-0'}`}
    >
      {simbolos ? 'abc' : '123'}
    </button>
  )
  const comaK = (
    <button key="coma" type="button" onClick={() => insertar(',')} className={`${tecla} h-9 text-base ${fija}`}>
      ,
    </button>
  )
  const puntoK = (
    <button key="punto" type="button" onClick={() => insertar('.')} className={`${tecla} h-9 text-base ${fija}`}>
      .
    </button>
  )
  const espacioK = (clave: string, clase: string) => (
    <button key={clave} type="button" onClick={() => insertar(' ')} aria-label="Espacio" className={`${tecla} h-9 ${clase}`}>
      <span className="block mx-5 h-px bg-neutral-400" />
    </button>
  )
  const introK = (
    <button key="intro" type="button" onClick={intro} aria-label="Intro" className={`${tecla} ${especial} ${ancha}`}>
      ↵
    </button>
  )
  const listoK = (
    <button
      key="listo"
      type="button"
      onClick={listo}
      className={`${tecla} ${principal} h-9 text-xs ${dividido ? 'w-16 shrink-0' : 'flex-[1.8] min-w-0'}`}
    >
      Listo
    </button>
  )

  if (!dividido) {
    return (
      <div className="space-y-1 flex-1 flex flex-col justify-end">
        <div className="flex gap-1">{filas[0].map(k)}</div>
        <div className={`flex gap-1 ${simbolos ? '' : 'px-4'}`}>{filas[1].map(k)}</div>
        <div className="flex gap-1">
          {mayusK}
          {filas[2].map(k)}
          {borrarK}
        </div>
        <div className="flex gap-1">
          {simbolosK}
          {comaK}
          {espacioK('espacio', 'flex-[5] min-w-0')}
          {puntoK}
          {introK}
          {listoK}
        </div>
      </div>
    )
  }

  // DIVIDIDO: cada fila se parte por la mitad y las dos mitades se van a los
  // bordes; el hueco del medio es donde no llega ningun pulgar.
  const mitad = (fila: string[]) => {
    const corte = Math.ceil(fila.length / 2)
    return [fila.slice(0, corte), fila.slice(corte)]
  }
  const [f0i, f0d] = mitad(filas[0])
  const [f1i, f1d] = mitad(filas[1])
  const [f2i, f2d] = mitad(filas[2])
  const grupo = 'flex gap-1'

  return (
    <div className="space-y-1 flex-1 flex flex-col justify-end">
      <div className="flex justify-between">
        <div className={grupo}>{f0i.map(k)}</div>
        <div className={grupo}>{f0d.map(k)}</div>
      </div>
      <div className="flex justify-between px-4">
        <div className={grupo}>{f1i.map(k)}</div>
        <div className={grupo}>{f1d.map(k)}</div>
      </div>
      <div className="flex justify-between">
        <div className={grupo}>
          {mayusK}
          {f2i.map(k)}
        </div>
        <div className={grupo}>
          {f2d.map(k)}
          {borrarK}
        </div>
      </div>
      <div className="flex justify-between">
        <div className={grupo}>
          {simbolosK}
          {comaK}
          {espacioK('espacio-izq', 'w-28 shrink-0')}
        </div>
        <div className={grupo}>
          {espacioK('espacio-der', 'w-28 shrink-0')}
          {puntoK}
          {introK}
          {listoK}
        </div>
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
