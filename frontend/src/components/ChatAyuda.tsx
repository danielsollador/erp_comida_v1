import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { api } from '../lib/api'
import type { TurnoAyuda } from '../lib/types'
import Icono from './Icono'

/**
 * El chat de ayuda: el "?" de la barra de arriba, en todas las pantallas.
 *
 * Responde con el manual del sistema (ver backend/app/asistente_ayuda.py),
 * sabiendo en qué pantalla está quien pregunta y a qué entra su rol. Solo
 * explica: no ve las ventas ni toca nada.
 *
 * La conversación vive en `sessionStorage` y no en el componente: la barra
 * se vuelve a montar en cada pantalla, y "¿y eso dónde está?" tiene que
 * seguir entendiéndose después de ir a donde dijo.
 */

const CLAVE = 'erp-chat-ayuda'

/** Para empezar sin tener que escribir, según dónde se está. */
const SUGERENCIAS: Record<string, string[]> = {
  pos: ['¿Qué significa «Para entregar»?', 'El cliente pagó y viene a buscarlo después', '¿Cómo cobro con dos formas de pago?'],
  cocina: ['¿Cómo marco una comanda lista?', '¿Qué hago si un pedido cambió?'],
  caja: ['¿Qué es «Debes tener»?', 'Me equivoqué en el conteo del cierre', 'Me falta plata en Zelle y sobra en el punto'],
  inventario: ['¿Cómo cargo una receta?', 'No me deja vender por falta de stock', '¿Cómo cargo el aceite de freír?'],
  menu: ['¿Cómo calculo el precio con el margen que quiero?', '¿Cómo agrego un producto nuevo?'],
  compras: ['La factura trae el flete aparte', 'Me facturaron más de lo que llegó', '¿Cargo la caja de 24 como 1 o como 24?'],
  ventas: ['¿Cómo devuelvo un pedido ya cobrado?', '¿Cómo cobro algo que quedó fiado?'],
}
const GENERALES = ['¿Cómo es el día en el sistema, de punta a punta?', '¿Qué hago si no me cuadra la caja?']

let estadoCache: Promise<boolean> | null = null
function ayudaActiva(): Promise<boolean> {
  estadoCache ??= api.estadoAyuda().then((e) => e.activo, () => false)
  return estadoCache
}

function leerGuardado(): TurnoAyuda[] {
  try {
    const crudo = sessionStorage.getItem(CLAVE)
    return crudo ? (JSON.parse(crudo) as TurnoAyuda[]) : []
  } catch {
    return []
  }
}

function guardar(turnos: TurnoAyuda[]) {
  try {
    sessionStorage.setItem(CLAVE, JSON.stringify(turnos.slice(-30)))
  } catch {
    // sin almacenamiento la conversacion dura lo que dure la pantalla
  }
}

export default function ChatAyuda({ dark = false }: { dark?: boolean }) {
  const { pathname } = useLocation()
  const [activa, setActiva] = useState(false)
  const [abierto, setAbierto] = useState(false)
  const [turnos, setTurnos] = useState<TurnoAyuda[]>(leerGuardado)
  const [texto, setTexto] = useState('')
  const [pensando, setPensando] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const lista = useRef<HTMLDivElement>(null)
  const campo = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    void ayudaActiva().then(setActiva)
  }, [])

  useEffect(() => {
    if (!abierto) return
    const alEscape = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false)
    window.addEventListener('keydown', alEscape)
    campo.current?.focus()
    return () => window.removeEventListener('keydown', alEscape)
  }, [abierto])

  useEffect(() => {
    lista.current?.scrollTo({ top: lista.current.scrollHeight })
  }, [turnos, pensando, abierto])

  if (!activa) return null

  const modulo = pathname.split('/')[1] || ''
  const sugerencias = SUGERENCIAS[modulo] ?? GENERALES

  const preguntar = async (pregunta: string) => {
    pregunta = pregunta.trim()
    if (!pregunta || pensando) return
    const antes = turnos
    const conPregunta = [...antes, { rol: 'usuario' as const, texto: pregunta }]
    setTurnos(conPregunta)
    guardar(conPregunta)
    setTexto('')
    setPensando(true)
    let respuesta: string
    try {
      respuesta = (await api.preguntarAyuda(pregunta, pathname, antes)).texto
    } catch {
      respuesta = 'No pude responder ahora: revisa la conexión y prueba otra vez.'
    }
    const conRespuesta = [...conPregunta, { rol: 'asistente' as const, texto: respuesta }]
    setTurnos(conRespuesta)
    guardar(conRespuesta)
    setPensando(false)
  }

  const copiar = async () => {
    const todo = turnos.map((t) => `${t.rol === 'usuario' ? 'Yo' : 'Ayuda'}: ${t.texto}`).join('\n\n')
    try {
      await navigator.clipboard.writeText(`Pantalla: ${pathname}\n\n${todo}`)
      setCopiado(true)
      window.setTimeout(() => setCopiado(false), 2000)
    } catch {
      // sin portapapeles (http sin cifrar): no hay nada que hacer
    }
  }

  const reiniciar = () => {
    setTurnos([])
    guardar([])
    campo.current?.focus()
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-label="Ayuda"
        title="Ayuda: pregúntale al sistema"
        className={`vp-control relative w-11 h-11 rounded-full border grid place-items-center shrink-0 ${
          dark
            ? 'border-neutral-700 text-neutral-400 hover:text-white hover:border-neutral-500'
            : 'border-neutral-200 text-neutral-500 hover:text-neutral-900 hover:border-neutral-400 bg-white'
        }`}
      >
        <Icono nombre="pregunta" size={17} />
      </button>

      {abierto &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex justify-end">
            {/* El fondo cierra; en el telefono el panel lo tapa entero. */}
            <button
              type="button"
              aria-label="Cerrar la ayuda"
              onClick={() => setAbierto(false)}
              className="absolute inset-0 bg-neutral-950/25 cursor-default"
            />
            <section
              role="dialog"
              aria-label="Ayuda"
              className="relative flex flex-col w-full sm:w-[400px] h-full bg-white text-neutral-900 sm:border-l border-neutral-200 shadow-2xl"
              style={{ animation: 'vp-entrar .18s cubic-bezier(.2,.7,.2,1) both' }}
            >
              <header className="flex items-center gap-2 px-4 h-14 border-b border-neutral-200 shrink-0">
                <Icono nombre="pregunta" size={18} className="text-acento-600" />
                <h2 className="font-display font-semibold text-[17px] flex-1">Ayuda</h2>
                {turnos.length > 0 && (
                  <>
                    <button type="button" onClick={() => void copiar()} className="text-xs font-medium text-neutral-500 hover:text-neutral-900 px-2 py-1.5">
                      {copiado ? 'Copiada' : 'Copiar'}
                    </button>
                    <button type="button" onClick={reiniciar} className="text-xs font-medium text-neutral-500 hover:text-neutral-900 px-2 py-1.5">
                      Nueva
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setAbierto(false)}
                  aria-label="Cerrar"
                  className="grid place-items-center w-10 h-10 rounded-xl hover:bg-neutral-100"
                >
                  <Icono nombre="quitar" size={18} />
                </button>
              </header>

              <div ref={lista} className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
                {turnos.length === 0 && (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm text-neutral-600 text-pretty">
                      Pregunta cómo se hace algo o qué significa lo que ves. Respondo con el manual del sistema.
                    </p>
                    <div className="flex flex-col gap-2">
                      {sugerencias.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => void preguntar(s)}
                          className="text-left text-sm rounded-xl border border-neutral-200 px-3 py-2.5 hover:border-acento-300 hover:bg-acento-50"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {turnos.map((t, i) =>
                  t.rol === 'usuario' ? (
                    <p key={i} className="self-end max-w-[85%] rounded-2xl rounded-br-md bg-neutral-900 text-white px-3.5 py-2 text-sm whitespace-pre-wrap">
                      {t.texto}
                    </p>
                  ) : (
                    <div key={i} className="max-w-[92%] rounded-2xl rounded-bl-md bg-neutral-100 px-3.5 py-2.5 text-sm leading-relaxed">
                      <Respuesta texto={t.texto} />
                    </div>
                  ),
                )}
                {pensando && (
                  <p className="self-start rounded-2xl bg-neutral-100 px-3.5 py-2 text-sm text-neutral-500" aria-live="polite">
                    Buscando en el manual…
                  </p>
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  void preguntar(texto)
                }}
                className="border-t border-neutral-200 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shrink-0"
              >
                <div className="flex items-end gap-2">
                  <textarea
                    ref={campo}
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void preguntar(texto)
                      }
                    }}
                    rows={1}
                    maxLength={1500}
                    placeholder="Escribe tu pregunta…"
                    className="flex-1 resize-none rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-base sm:text-sm max-h-32 focus:outline-none focus:border-acento-400"
                  />
                  <button
                    type="submit"
                    disabled={!texto.trim() || pensando}
                    aria-label="Enviar"
                    className="grid place-items-center w-11 h-11 rounded-xl bg-neutral-900 text-white disabled:opacity-40 shrink-0"
                  >
                    <Icono nombre="enviar" size={17} />
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-neutral-500">
                  Solo explica: no ve tus ventas ni cambia nada. Si no lo resuelve, toca «Copiar» y mándaselo a soporte.
                </p>
              </form>
            </section>
          </div>,
          document.body,
        )}
    </>
  )
}

/**
 * Lo poco de formato que usa la respuesta: **negrita**, `codigo`, y listas
 * con "1." o "-". Sin una libreria de markdown para cuatro reglas.
 */
function Respuesta({ texto }: { texto: string }) {
  const bloques: ReactNode[] = []
  let lista: { ordenada: boolean; items: string[] } | null = null
  const cerrarLista = () => {
    if (!lista) return
    const items = lista.items.map((it, i) => <li key={i}>{enLinea(it)}</li>)
    bloques.push(
      lista.ordenada ? (
        <ol key={bloques.length} className="list-decimal pl-5 space-y-1">{items}</ol>
      ) : (
        <ul key={bloques.length} className="list-disc pl-5 space-y-1">{items}</ul>
      ),
    )
    lista = null
  }
  for (const linea of texto.split('\n')) {
    const ordenada = linea.match(/^\s*\d+[.)]\s+(.*)$/)
    const vineta = linea.match(/^\s*[-*•]\s+(.*)$/)
    const item = ordenada ?? vineta
    if (item) {
      const esOrdenada = !!ordenada
      if (lista && lista.ordenada !== esOrdenada) cerrarLista()
      lista ??= { ordenada: esOrdenada, items: [] }
      lista.items.push(item[1])
      continue
    }
    cerrarLista()
    if (linea.trim()) bloques.push(<p key={bloques.length}>{enLinea(linea)}</p>)
  }
  cerrarLista()
  return <div className="flex flex-col gap-2">{bloques}</div>
}

function enLinea(texto: string): ReactNode {
  return texto.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((parte, i) => {
    if (parte.startsWith('**') && parte.endsWith('**') && parte.length > 4) return <strong key={i}>{parte.slice(2, -2)}</strong>
    if (parte.startsWith('`') && parte.endsWith('`') && parte.length > 2)
      return <code key={i} className="font-mono text-[12px] bg-white/70 rounded px-1">{parte.slice(1, -1)}</code>
    return <Fragment key={i}>{parte}</Fragment>
  })
}
