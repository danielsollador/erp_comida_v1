import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { Boton, Campo, Modal, Selector } from './ui'

/**
 * Las ventanas de pregunta del ERP: confirmar, elegir, pedir datos, avisar.
 *
 * POR QUE EXISTE. Las pantallas usaban `window.confirm` y `window.prompt`:
 * sesenta veces, en once archivos. Son ventanas del NAVEGADOR, no del
 * aplicativo: se pintan con el estilo del sistema operativo ("savora.
 * vertigopro.tech dice"), no se pueden dar estilo ni poner en dos columnas,
 * en la tablet salen diminutas, un flujo de cuatro preguntas eran cuatro
 * ventanas seguidas, y un numero se pedia como texto sin teclado numerico.
 * Leider (16-sep): "no quiero que exista ni UNA".
 *
 * COMO SE USA. Igual de simple que lo que reemplaza, pero con `await`:
 *
 *   const { confirmar, pedir, pedirNumero, elegir, avisar } = useDialogo()
 *   if (!(await confirmar({ titulo: 'Borrar este retiro?', peligro: true }))) return
 *   const monto = await pedirNumero({ titulo: 'Cuanto se lleva el dueno?', sufijo: '$' })
 *   const r = await pedir({ titulo: 'Nota de credito', campos: [...] })   // {numero, motivo} | null
 *   const forma = await elegir({ titulo: 'Como se paga?', opciones: [...] }) // 'Banco' | null
 *
 * Cada llamada devuelve una promesa que se resuelve cuando la persona acepta
 * o cancela; cancelar (X, Escape, tocar fuera) da `false` / `null`. Si se
 * pide una ventana mientras otra esta abierta, espera su turno.
 */

export type OpcionDialogo = {
  valor: string
  texto: string
  detalle?: string
  /** La opcion que destruye o pierde algo: se ve distinta. */
  peligro?: boolean
}

export type CampoDialogo = {
  nombre: string
  etiqueta: string
  tipo?: 'texto' | 'numero' | 'fecha' | 'opciones' | 'nota'
  valor?: string | number
  opciones?: OpcionDialogo[]
  /** La unidad, pegada a la etiqueta: "Cantidad (kg)". */
  sufijo?: string
  ayuda?: string
  placeholder?: string
  /** Se puede dejar vacio. Por defecto todo campo es obligatorio. */
  opcional?: boolean
  min?: number
  max?: number
}

type Base = { titulo: string; texto?: ReactNode }
export type PedidoConfirmar = Base & { aceptar?: string; cancelar?: string; peligro?: boolean }
export type PedidoElegir = Base & { opciones: OpcionDialogo[]; cancelar?: string }
export type PedidoFormulario = Base & {
  campos: CampoDialogo[]
  aceptar?: string
  peligro?: boolean
  ancho?: 'sm' | 'md' | 'lg'
}
export type PedidoAviso = Base & { tono?: 'info' | 'ojo' | 'mal' | 'bien'; aceptar?: string }
type PedidoNumero = Base & {
  etiqueta?: string
  valor?: number | string
  sufijo?: string
  ayuda?: string
  min?: number
  aceptar?: string
  peligro?: boolean
}
type PedidoTexto = Base & {
  etiqueta?: string
  valor?: string
  ayuda?: string
  placeholder?: string
  opcional?: boolean
  aceptar?: string
  peligro?: boolean
}

type Pendiente =
  | { clase: 'confirmar'; datos: PedidoConfirmar; resolver: (v: boolean) => void }
  | { clase: 'elegir'; datos: PedidoElegir; resolver: (v: string | null) => void }
  | { clase: 'pedir'; datos: PedidoFormulario; resolver: (v: Record<string, string> | null) => void }
  | { clase: 'avisar'; datos: PedidoAviso; resolver: () => void }

export type Dialogo = {
  confirmar: (d: PedidoConfirmar) => Promise<boolean>
  elegir: (d: PedidoElegir) => Promise<string | null>
  pedir: (d: PedidoFormulario) => Promise<Record<string, string> | null>
  /** Un solo numero. `null` si cancela; nunca NaN ni negativo (salvo `min`). */
  pedirNumero: (d: PedidoNumero) => Promise<number | null>
  /** Un solo texto. `null` si cancela; '' solo si es `opcional`. */
  pedirTexto: (d: PedidoTexto) => Promise<string | null>
  avisar: (d: PedidoAviso) => Promise<void>
}

const Ctx = createContext<Dialogo | null>(null)

export function useDialogo(): Dialogo {
  const d = useContext(Ctx)
  if (!d) throw new Error('useDialogo se usa dentro de <DialogoProvider>')
  return d
}

export function DialogoProvider({ children }: { children: ReactNode }) {
  // Una cola, no un solo valor: dos preguntas seguidas (el POS pregunta el
  // motivo y luego si la comida se recupera) no se pisan.
  const [cola, setCola] = useState<Pendiente[]>([])
  const encolar = useCallback((p: Pendiente) => setCola((c) => [...c, p]), [])
  const terminar = useCallback(() => setCola((c) => c.slice(1)), [])

  const api = useMemo<Dialogo>(() => {
    const pedir = (datos: PedidoFormulario) =>
      new Promise<Record<string, string> | null>((resolver) => encolar({ clase: 'pedir', datos, resolver }))
    return {
      confirmar: (datos) => new Promise((resolver) => encolar({ clase: 'confirmar', datos, resolver })),
      elegir: (datos) => new Promise((resolver) => encolar({ clase: 'elegir', datos, resolver })),
      avisar: (datos) => new Promise((resolver) => encolar({ clase: 'avisar', datos, resolver })),
      pedir,
      pedirNumero: async ({ etiqueta = 'Cantidad', valor, sufijo, ayuda, min, aceptar, peligro, ...base }) => {
        const r = await pedir({
          ...base,
          aceptar,
          peligro,
          ancho: 'sm',
          campos: [{ nombre: 'v', etiqueta, tipo: 'numero', valor, sufijo, ayuda, min }],
        })
        return r ? Number(r.v) : null
      },
      pedirTexto: async ({ etiqueta = 'Detalle', valor, ayuda, placeholder, opcional, aceptar, peligro, ...base }) => {
        const r = await pedir({
          ...base,
          aceptar,
          peligro,
          ancho: 'sm',
          campos: [{ nombre: 'v', etiqueta, tipo: 'texto', valor, ayuda, placeholder, opcional }],
        })
        return r ? r.v : null
      },
    }
  }, [encolar])

  const actual = cola[0]
  return (
    <Ctx.Provider value={api}>
      {children}
      {actual && <Ventana key={cola.length} pendiente={actual} alTerminar={terminar} />}
    </Ctx.Provider>
  )
}

// ── La ventana ─────────────────────────────────────────────────────────────

/** Los textos largos vienen con saltos de linea escritos: se respetan. */
function Texto({ children }: { children: ReactNode }) {
  if (!children) return null
  return <div className="text-sm text-neutral-600 whitespace-pre-line leading-relaxed">{children}</div>
}

function Ventana({ pendiente, alTerminar }: { pendiente: Pendiente; alTerminar: () => void }) {
  // Resolver y cerrar van juntos: una promesa sin resolver dejaria a quien
  // llamo esperando para siempre.
  const cerrarCon = <T,>(resolver: (v: T) => void, valor: T) => {
    resolver(valor)
    alTerminar()
  }

  switch (pendiente.clase) {
    case 'confirmar': {
      const { titulo, texto, aceptar = 'Aceptar', cancelar = 'Cancelar', peligro } = pendiente.datos
      const salir = () => cerrarCon(pendiente.resolver, false)
      return (
        <Modal
          titulo={titulo}
          onCerrar={salir}
          ancho="sm"
          pie={
            <>
              <Boton tono="suave" onClick={salir}>
                {cancelar}
              </Boton>
              <Boton tono={peligro ? 'peligro-fuerte' : 'principal'} autoFocus onClick={() => cerrarCon(pendiente.resolver, true)}>
                {aceptar}
              </Boton>
            </>
          }
        >
          <Texto>{texto}</Texto>
        </Modal>
      )
    }
    case 'avisar': {
      const { titulo, texto, aceptar = 'Entendido' } = pendiente.datos
      const salir = () => cerrarCon(pendiente.resolver, undefined)
      return (
        <Modal titulo={titulo} onCerrar={salir} ancho="sm" pie={<Boton autoFocus onClick={salir}>{aceptar}</Boton>}>
          <Texto>{texto}</Texto>
        </Modal>
      )
    }
    case 'elegir': {
      const { titulo, texto, opciones, cancelar = 'Cancelar' } = pendiente.datos
      const salir = () => cerrarCon(pendiente.resolver, null)
      return (
        <Modal titulo={titulo} onCerrar={salir} ancho="sm" pie={<Boton tono="suave" onClick={salir}>{cancelar}</Boton>}>
          <Texto>{texto}</Texto>
          {/* Cada opcion es un boton grande con su explicacion debajo: en la
              tablet se toca sin apuntar, y no hay que descifrar un
              "Aceptar = banco, Cancelar = gaveta". */}
          <div className={`grid gap-2 ${texto ? 'mt-3' : ''}`}>
            {opciones.map((o, i) => (
              <button
                key={o.valor}
                type="button"
                autoFocus={i === 0}
                onClick={() => cerrarCon(pendiente.resolver, o.valor)}
                className={`text-left rounded-xl border px-4 py-3 hover:border-neutral-400 hover:bg-neutral-50 ${
                  o.peligro ? 'border-peligro-200 text-peligro-700 hover:bg-peligro-50' : 'border-neutral-200'
                }`}
              >
                <span className="block font-medium text-sm">{o.texto}</span>
                {o.detalle && <span className="block text-xs text-neutral-500 mt-0.5">{o.detalle}</span>}
              </button>
            ))}
          </div>
        </Modal>
      )
    }
    case 'pedir':
      return <Formulario datos={pendiente.datos} resolver={(v) => cerrarCon(pendiente.resolver, v)} />
  }
}

/** Un numero escrito a mano: acepta coma decimal, que es como se escribe aqui. */
function aNumero(texto: string): number {
  return Number(texto.trim().replace(',', '.'))
}

function Formulario({
  datos,
  resolver,
}: {
  datos: PedidoFormulario
  resolver: (v: Record<string, string> | null) => void
}) {
  const { titulo, texto, campos, aceptar = 'Aceptar', peligro, ancho = 'sm' } = datos
  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(campos.map((c) => [c.nombre, c.valor == null ? (c.tipo === 'opciones' ? c.opciones?.[0]?.valor ?? '' : '') : String(c.valor)])),
  )
  const [errores, setErrores] = useState<Record<string, string>>({})

  function validar(): Record<string, string> | null {
    const malos: Record<string, string> = {}
    const limpios: Record<string, string> = {}
    for (const c of campos) {
      const crudo = (valores[c.nombre] ?? '').trim()
      if (crudo === '') {
        if (c.opcional) {
          limpios[c.nombre] = ''
          continue
        }
        malos[c.nombre] = 'Falta este dato'
        continue
      }
      if (c.tipo === 'numero') {
        const n = aNumero(crudo)
        if (!Number.isFinite(n)) {
          malos[c.nombre] = 'Tiene que ser un número'
          continue
        }
        const min = c.min ?? 0
        if (n < min) {
          malos[c.nombre] = min === 0 ? 'No puede ser negativo' : `Mínimo ${min}`
          continue
        }
        if (c.max != null && n > c.max) {
          malos[c.nombre] = `Máximo ${c.max}`
          continue
        }
        limpios[c.nombre] = String(n)
        continue
      }
      limpios[c.nombre] = crudo
    }
    setErrores(malos)
    return Object.keys(malos).length ? null : limpios
  }

  function enviar(e: FormEvent) {
    e.preventDefault()
    const v = validar()
    if (v) resolver(v)
  }

  const poner = (nombre: string, v: string) => setValores((a) => ({ ...a, [nombre]: v }))
  const salir = () => resolver(null)

  return (
    <Modal
      titulo={titulo}
      onCerrar={salir}
      ancho={ancho}
      pie={
        <>
          <Boton tono="suave" onClick={salir}>
            Cancelar
          </Boton>
          {/* `form` en vez de `type=submit` dentro del form: el pie del Modal
              queda fuera del <form>, y asi Enter en un campo y el boton hacen
              exactamente lo mismo. */}
          <Boton tono={peligro ? 'peligro-fuerte' : 'principal'} type="submit" form="vp-dialogo-form">
            {aceptar}
          </Boton>
        </>
      }
    >
      <form id="vp-dialogo-form" onSubmit={enviar} className="space-y-3">
        <Texto>{texto}</Texto>
        {campos.map((c, i) => {
          const etiqueta = c.sufijo ? `${c.etiqueta} (${c.sufijo})` : c.etiqueta
          const error = errores[c.nombre]
          if (c.tipo === 'opciones') {
            return (
              <div key={c.nombre}>
                <Selector etiqueta={etiqueta} value={valores[c.nombre]} onChange={(e) => poner(c.nombre, e.target.value)} autoFocus={i === 0}>
                  {c.opciones?.map((o) => (
                    <option key={o.valor} value={o.valor}>
                      {o.texto}
                    </option>
                  ))}
                </Selector>
                {c.ayuda && <p className="text-xs text-neutral-500 mt-1">{c.ayuda}</p>}
              </div>
            )
          }
          if (c.tipo === 'nota') {
            return (
              <label key={c.nombre} className="block">
                <span className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">{etiqueta}</span>
                <textarea
                  value={valores[c.nombre]}
                  onChange={(e) => poner(c.nombre, e.target.value)}
                  placeholder={c.placeholder}
                  autoFocus={i === 0}
                  rows={3}
                  className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
                />
                {(error || c.ayuda) && <span className={`block text-xs mt-1 ${error ? 'text-peligro-600' : 'text-neutral-500'}`}>{error ?? c.ayuda}</span>}
              </label>
            )
          }
          return (
            <Campo
              key={c.nombre}
              etiqueta={etiqueta}
              ayuda={error ?? c.ayuda}
              className={error ? '[&_span:last-child]:text-peligro-600 [&_input]:border-peligro-400' : ''}
              // Texto con teclado decimal, no `type=number`: acepta la coma,
              // no cambia el valor con la rueda del raton y no recorta ceros.
              type={c.tipo === 'fecha' ? 'date' : 'text'}
              inputMode={c.tipo === 'numero' ? 'decimal' : undefined}
              value={valores[c.nombre]}
              onChange={(e) => poner(c.nombre, e.target.value)}
              placeholder={c.placeholder}
              autoFocus={i === 0}
              onFocus={(e) => c.tipo === 'numero' && e.currentTarget.select()}
            />
          )
        })}
      </form>
    </Modal>
  )
}
