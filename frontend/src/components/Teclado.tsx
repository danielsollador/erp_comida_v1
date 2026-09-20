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
 * El teclado numerico del ERP, para las tablets del mostrador.
 *
 * POR QUE EXISTE. En una tablet, tocar el campo "Descuento" abria el teclado
 * del sistema: alfabetico, con fila de sugerencias, y ocupando mas de la
 * mitad de la pantalla --tapaba el propio cuadro de cobro. `type="number"`
 * no lo evitaba: el teclado de Samsung lo ignora. Leider (20-sep): "cuando
 * se escribe en tablets es super engorroso, y esto se usa mucho en tablets".
 *
 * COMO FUNCIONA. Todo campo de numero del ERP es un `<Numerico>`. En una
 * pantalla tactil (`pointer: coarse`) el campo no deja salir el teclado del
 * sistema y en su lugar abre ESTE, abajo, con doce teclas grandes y una
 * linea que dice que campo se esta llenando y con que valor: asi no importa
 * si el teclado tapa el campo. En un computador con raton el campo es un
 * input normal y el teclado fisico funciona como siempre.
 *
 * El valor viaja como TEXTO, igual que antes (`e.target.value`): las
 * pantallas ya lo convertian con `Number(...)`, y asi acepta la coma decimal
 * que es como se escribe aqui.
 */

type Objetivo = {
  etiqueta: string
  valor: string
  oculto: boolean
  entero: boolean
  poner: (v: string) => void
  listo: () => void
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
  return window.matchMedia('(pointer: coarse)').matches
}

export function TecladoProvider({ children }: { children: ReactNode }) {
  const [objetivo, setObjetivo] = useState<Objetivo | null>(null)

  const abrir = useCallback((o: Objetivo) => setObjetivo(o), [])
  const cerrar = useCallback(() => setObjetivo(null), [])
  const actualizar = useCallback((valor: string) => {
    setObjetivo((o) => (o ? { ...o, valor } : o))
  }, [])

  const ctx = useMemo(() => ({ abrir, cerrar, actualizar }), [abrir, cerrar, actualizar])

  return (
    <TecladoCtx.Provider value={ctx}>
      {children}
      {objetivo && <Panel objetivo={objetivo} onCerrar={cerrar} onValor={actualizar} />}
    </TecladoCtx.Provider>
  )
}

const TECLAS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
const boton = 'h-12 rounded-xl text-xl font-semibold tabular-nums active:scale-95 transition-transform select-none'
const gris = 'bg-neutral-800 hover:bg-neutral-700'

function Digito({ t, onClick }: { t: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`${boton} ${gris}`}>
      {t}
    </button>
  )
}

function Panel({
  objetivo,
  onCerrar,
  onValor,
}: {
  objetivo: Objetivo
  onCerrar: () => void
  onValor: (v: string) => void
}) {
  const { etiqueta, valor, oculto, entero, listo } = objetivo
  // Lo que dice arriba cambia AQUI mismo, sin esperar a que la pantalla
  // vuelva a pintar el campo: si no, va una tecla por detras.
  const poner = (v: string) => {
    onValor(v)
    objetivo.poner(v)
  }

  function tecla(t: string) {
    if (t === ',') {
      if (entero || valor.includes('.') || valor.includes(',')) return
      poner((valor || '0') + '.')
      return
    }
    // "0.00" es un marcador, no un valor escrito: la primera tecla lo pisa.
    const base = valor === '0' ? '' : valor
    poner(base + t)
  }

  function borrar() {
    poner(valor.slice(0, -1))
  }

  function terminar() {
    listo()
    onCerrar()
  }

  const mostrado = oculto ? '•'.repeat(valor.length) : valor.replace('.', ',')

  return createPortal(
    <div
      role="dialog"
      aria-label={`Teclado para ${etiqueta}`}
      // Debajo de todo lo demas en la pantalla salvo los cuadros (z-50): se
      // abre desde un campo de un cuadro y tiene que quedar encima de el.
      className="fixed inset-x-0 bottom-0 z-[60] bg-neutral-900 text-white border-t border-neutral-700 shadow-2xl pb-[env(safe-area-inset-bottom)]"
      style={{ animation: 'vp-entrar .18s cubic-bezier(.2,.7,.2,1) both' }}
      // No robar el foco del campo: si el foco se va, el campo se cierra.
      onMouseDown={(e) => e.preventDefault()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <div className="max-w-md mx-auto px-3 pt-2 pb-3">
        <div className="flex items-baseline justify-between gap-3 px-1 mb-2">
          <span className="text-xs uppercase tracking-wide text-neutral-400 truncate">{etiqueta}</span>
          <span className="text-2xl font-bold tabular-nums min-h-[2rem]">{mostrado || <span className="text-neutral-600">0</span>}</span>
        </div>
        {/* Cuatro columnas: los digitos a la izquierda y, a la derecha,
            borrar, limpiar y Listo (que ocupa dos filas). */}
        <div className="grid grid-cols-4 gap-2">
          {TECLAS.slice(0, 3).map((t) => <Digito key={t} t={t} onClick={() => tecla(t)} />)}
          <button type="button" onClick={borrar} aria-label="Borrar" className={`${boton} ${gris}`}>⌫</button>
          {TECLAS.slice(3, 6).map((t) => <Digito key={t} t={t} onClick={() => tecla(t)} />)}
          <button type="button" onClick={() => poner('')} aria-label="Limpiar" className={`${boton} ${gris} text-base`}>C</button>
          {TECLAS.slice(6, 9).map((t) => <Digito key={t} t={t} onClick={() => tecla(t)} />)}
          <button type="button" onClick={terminar} className={`${boton} row-span-2 h-auto bg-acento-500 hover:bg-acento-600 text-base`}>
            Listo
          </button>
          <button type="button" onClick={() => tecla(',')} disabled={entero} className={`${boton} ${gris} disabled:opacity-30`}>
            ,
          </button>
          <Digito t="0" onClick={() => tecla('0')} />
          <button type="button" onClick={terminar} aria-label="Cerrar teclado" className={`${boton} ${gris} text-base`}>
            ▾
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

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
  /** Lo que dice el teclado arriba. Si falta, se toma del placeholder o del label que envuelve. */
  etiqueta?: string
  oculto?: boolean
  entero?: boolean
}) {
  const ctx = useContext(TecladoCtx)
  const tactil = useMemo(esTactil, [])
  const ref = useRef<HTMLInputElement>(null)
  const texto = value === undefined || value === null ? '' : String(value)
  // El teclado llama a `poner` con el valor nuevo; se envuelve para que la
  // pantalla lo reciba como si lo hubiera escrito en el input.
  const poner = useCallback(
    (v: string) => onChange({ target: { value: v }, currentTarget: { value: v } }),
    [onChange],
  )

  // Mientras el teclado esta abierto para ESTE campo, lo que dice arriba
  // sigue al valor real.
  const abiertoAqui = useRef(false)
  useEffect(() => {
    if (abiertoAqui.current && ctx) ctx.actualizar(texto)
  }, [texto, ctx])

  function rotulo(): string {
    if (etiqueta) return etiqueta
    const label = ref.current?.closest('label')
    const propio = label?.textContent?.trim()
    return propio || placeholder || 'Número'
  }

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
      ref={ref}
      type={oculto ? 'password' : 'text'}
      // `inputMode="none"` es lo que le dice al navegador que NO abra el
      // teclado del sistema; `readOnly` es la red por si algun teclado lo
      // ignora. El campo sigue recibiendo el foco y mostrando el valor.
      inputMode="none"
      readOnly
      autoComplete="off"
      value={texto}
      onChange={() => undefined}
      placeholder={placeholder}
      className={`${className} caret-transparent`}
      onFocus={(e) => {
        abiertoAqui.current = true
        ctx.abrir({
          etiqueta: rotulo(),
          valor: texto,
          oculto,
          entero,
          poner,
          listo: () => ref.current?.blur(),
        })
        onFocus?.(e)
      }}
      onClick={(e) => {
        // Ya tenia el foco y el teclado se cerro con "Listo": volver a tocar lo reabre.
        if (!abiertoAqui.current) (e.currentTarget as HTMLInputElement).focus()
      }}
      onBlur={(e) => {
        abiertoAqui.current = false
        ctx.cerrar()
        onBlur?.(e)
      }}
      {...resto}
    />
  )
}
