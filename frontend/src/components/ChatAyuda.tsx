import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { api } from '../lib/api'
import type { BorradorCaso, RespuestaNegocio, TurnoAyuda } from '../lib/types'
import Icono from './Icono'

/**
 * El chat de ayuda: el "?" de la barra de arriba, en todas las pantallas.
 *
 * Dos pestañas:
 *  - «Cómo se hace»: responde con el manual del sistema (ver
 *    backend/app/asistente_ayuda.py), sabiendo en qué pantalla está quien
 *    pregunta y a qué entra su rol.
 *  - «Mis números»: pregúntale a tu negocio (pregunta_negocio.py). La IA
 *    elige una consulta de los reportes y la dice en palabras; el número lo
 *    calcula el sistema y su tabla va debajo. Solo si el rol entra a algún
 *    reporte.
 * Ninguna de las dos cambia nada.
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

const DE_NUMEROS = [
  '¿Cuánto vendí hoy?',
  '¿Qué fue lo que más vendí esta semana?',
  '¿Qué día de la semana vendo más?',
  '¿Cuánto le compré a cada proveedor este mes?',
]

type Modo = 'ayuda' | 'negocio'
/** Un turno y, si es de «Mis números», la tabla que calculó el sistema. */
type Turno = TurnoAyuda & { tabla?: RespuestaNegocio }

let estadoCache: Promise<{ activo: boolean; negocio: boolean }> | null = null
function estadoAyuda() {
  estadoCache ??= api.estadoAyuda().catch(() => ({ activo: false, negocio: false }))
  return estadoCache
}

function leerGuardado(modo: Modo): Turno[] {
  try {
    const crudo = sessionStorage.getItem(`${CLAVE}:${modo}`)
    return crudo ? (JSON.parse(crudo) as Turno[]) : []
  } catch {
    return []
  }
}

function guardar(modo: Modo, turnos: Turno[]) {
  try {
    sessionStorage.setItem(`${CLAVE}:${modo}`, JSON.stringify(turnos.slice(-30)))
  } catch {
    // sin almacenamiento la conversacion dura lo que dure la pantalla
  }
}

export default function ChatAyuda({ dark = false }: { dark?: boolean }) {
  const { pathname } = useLocation()
  const [activa, setActiva] = useState(false)
  const [conNumeros, setConNumeros] = useState(false)
  const [abierto, setAbierto] = useState(false)
  const [modo, setModo] = useState<Modo>('ayuda')
  const [turnos, setTurnos] = useState<Turno[]>(() => leerGuardado('ayuda'))
  const [texto, setTexto] = useState('')
  const [pensando, setPensando] = useState(false)
  // El caso para soporte: armándose, o el borrador que la persona revisa.
  const [caso, setCaso] = useState<BorradorCaso | 'armando' | null>(null)
  const [enviandoCaso, setEnviandoCaso] = useState(false)
  const lista = useRef<HTMLDivElement>(null)
  const campo = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    void estadoAyuda().then((e) => {
      setActiva(e.activo)
      setConNumeros(e.negocio)
    })
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
  const sugerencias = modo === 'negocio' ? DE_NUMEROS : (SUGERENCIAS[modulo] ?? GENERALES)

  const cambiarModo = (nuevo: Modo) => {
    if (nuevo === modo || pensando) return
    setModo(nuevo)
    setTurnos(leerGuardado(nuevo))
    campo.current?.focus()
  }

  const preguntar = async (pregunta: string) => {
    pregunta = pregunta.trim()
    if (!pregunta || pensando) return
    const antes = turnos
    const enModo = modo
    const conPregunta: Turno[] = [...antes, { rol: 'usuario', texto: pregunta }]
    setTurnos(conPregunta)
    guardar(enModo, conPregunta)
    setTexto('')
    setPensando(true)
    // Al servidor va solo lo dicho, no las tablas.
    const historial = antes.map(({ rol, texto }) => ({ rol, texto }))
    let respuesta: Turno
    try {
      if (enModo === 'negocio') {
        const r = await api.preguntarNegocio(pregunta, historial)
        respuesta = { rol: 'asistente', texto: r.texto, tabla: r.columnas.length ? r : undefined }
      } else {
        respuesta = { rol: 'asistente', texto: (await api.preguntarAyuda(pregunta, pathname, historial)).texto }
      }
    } catch {
      respuesta = { rol: 'asistente', texto: 'No pude responder ahora: revisa la conexión y prueba otra vez.' }
    }
    const conRespuesta = [...conPregunta, respuesta]
    setTurnos(conRespuesta)
    guardar(enModo, conRespuesta)
    setPensando(false)
  }

  // «Soporte»: la IA arma el caso desde la conversación y la persona lo
  // revisa antes de mandarlo (ver backend/app/triaje.py).
  const pedirSoporte = async () => {
    setCaso('armando')
    try {
      setCaso(await api.borradorCaso(pathname, turnos.map(({ rol, texto }) => ({ rol, texto }))))
    } catch {
      setCaso({ tipo: 'duda', titulo: turnos.find((t) => t.rol === 'usuario')?.texto.slice(0, 90) ?? '', resumen: '', con_ia: false })
    }
  }

  const mandarCaso = async () => {
    if (!caso || caso === 'armando' || !caso.titulo.trim()) return
    setEnviandoCaso(true)
    let aviso: string
    try {
      const r = await api.registrarCaso({ ...caso, pantalla: pathname, historial: turnos.map(({ rol, texto }) => ({ rol, texto })) })
      aviso = `Listo: tu caso #${r.id} quedó registrado y el equipo lo va a revisar.`
      setCaso(null)
    } catch {
      aviso = 'No pude registrar el caso: revisa la conexión y prueba otra vez.'
    }
    const con = [...turnos, { rol: 'asistente' as const, texto: aviso }]
    setTurnos(con)
    guardar(modo, con)
    setEnviandoCaso(false)
  }

  const reiniciar = () => {
    setCaso(null)
    setTurnos([])
    guardar(modo, [])
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
                    <button
                      type="button"
                      onClick={() => void pedirSoporte()}
                      disabled={caso !== null || pensando}
                      className="text-xs font-medium text-neutral-500 hover:text-neutral-900 px-2 py-1.5 disabled:opacity-40"
                    >
                      Soporte
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

              {conNumeros && (
                <div role="tablist" className="flex gap-1 px-4 pt-3 shrink-0">
                  {(
                    [
                      ['ayuda', 'Cómo se hace'],
                      ['negocio', 'Mis números'],
                    ] as const
                  ).map(([id, nombre]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={modo === id}
                      onClick={() => cambiarModo(id)}
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${
                        modo === id ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'
                      }`}
                    >
                      {nombre}
                    </button>
                  ))}
                </div>
              )}

              <div ref={lista} className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
                {turnos.length === 0 && (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm text-neutral-600 text-pretty">
                      {modo === 'negocio'
                        ? 'Pregunta por tus ventas, productos, compras o la caja. El número lo calcula el sistema con tus reportes.'
                        : 'Pregunta cómo se hace algo o qué significa lo que ves. Respondo con el manual del sistema.'}
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
                    <div key={i} className="max-w-[92%] flex flex-col gap-2">
                      <div className="rounded-2xl rounded-bl-md bg-neutral-100 px-3.5 py-2.5 text-sm leading-relaxed">
                        <Respuesta texto={t.texto} />
                      </div>
                      {t.tabla && <TablaDelSistema r={t.tabla} />}
                    </div>
                  ),
                )}
                {pensando && (
                  <p className="self-start rounded-2xl bg-neutral-100 px-3.5 py-2 text-sm text-neutral-500" aria-live="polite">
                    {modo === 'negocio' ? 'Calculando…' : 'Buscando en el manual…'}
                  </p>
                )}
                {caso === 'armando' && (
                  <p className="self-start rounded-2xl bg-neutral-100 px-3.5 py-2 text-sm text-neutral-500" aria-live="polite">
                    Armando el caso para el equipo…
                  </p>
                )}
                {caso && caso !== 'armando' && (
                  <div className="rounded-2xl border border-acento-200 bg-acento-50 p-3.5 flex flex-col gap-2.5 text-sm">
                    <p className="font-semibold">Pasar al equipo de soporte</p>
                    <p className="text-xs text-neutral-600">Revisa lo que va a recibir el equipo. Va con esta conversación y la pantalla donde estás.</p>
                    <select
                      value={caso.tipo}
                      onChange={(e) => setCaso({ ...caso, tipo: e.target.value })}
                      className="rounded-lg border border-neutral-200 bg-white px-2 py-2"
                    >
                      <option value="duda">Duda de uso</option>
                      <option value="error">Algo no funciona</option>
                      <option value="pedido">Quiero algo que el sistema no tiene</option>
                      <option value="dato">Un dato está mal cargado</option>
                    </select>
                    <input
                      value={caso.titulo}
                      onChange={(e) => setCaso({ ...caso, titulo: e.target.value })}
                      maxLength={120}
                      placeholder="En una línea, qué pasa"
                      className="rounded-lg border border-neutral-200 bg-white px-3 py-2"
                    />
                    <textarea
                      value={caso.resumen}
                      onChange={(e) => setCaso({ ...caso, resumen: e.target.value })}
                      rows={4}
                      placeholder="Qué querías hacer y qué pasó"
                      className="rounded-lg border border-neutral-200 bg-white px-3 py-2 resize-y"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void mandarCaso()}
                        disabled={enviandoCaso || !caso.titulo.trim()}
                        className="flex-1 rounded-lg bg-neutral-900 text-white py-2 font-medium disabled:opacity-50"
                      >
                        {enviandoCaso ? 'Enviando…' : 'Enviar al equipo'}
                      </button>
                      <button type="button" onClick={() => setCaso(null)} className="rounded-lg px-3 py-2 text-neutral-600 hover:bg-white">
                        Cancelar
                      </button>
                    </div>
                  </div>
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
                  {modo === 'negocio'
                    ? 'La IA elige la consulta y la dice en palabras; los números de la tabla salen del sistema. No cambia nada.'
                    : 'Solo explica: no cambia nada. Si no lo resuelve, toca «Soporte» y le llega al equipo.'}
                </p>
              </form>
            </section>
          </div>,
          document.body,
        )}
    </>
  )
}

/** La tabla que calculó el sistema, tal cual: es la que manda, no la frase. */
function TablaDelSistema({ r }: { r: RespuestaNegocio }) {
  const alinear = (j: number) => (j < r.agrupado ? 'text-left' : 'text-right tabular-nums whitespace-nowrap')
  return (
    <div className="rounded-xl border border-neutral-200 bg-white text-[13px]">
      <p className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-neutral-500">{r.titulo}</p>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-neutral-500">
              {r.columnas.map((c, j) => (
                <th key={j} className={`px-3 py-1 font-medium ${j < r.agrupado ? 'text-left' : 'text-right'}`}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.filas.length === 0 && (
              <tr>
                <td colSpan={r.columnas.length} className="px-3 py-2 text-neutral-500">
                  Sin movimientos en ese período.
                </td>
              </tr>
            )}
            {r.filas.map((f, i) => (
              <tr key={i} className="border-t border-neutral-100">
                {f.map((v, j) => (
                  <td key={j} className={`px-3 py-1 ${alinear(j)}`}>
                    {v}
                  </td>
                ))}
              </tr>
            ))}
            {r.total.length > 0 && (
              <tr className="border-t border-neutral-200 font-semibold">
                {r.total.map((v, j) => (
                  <td key={j} className={`px-3 py-1 ${alinear(j)}`}>
                    {v}
                  </td>
                ))}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {r.mas > 0 && <p className="px-3 pb-2 text-[11px] text-neutral-500">Y {r.mas} más: el detalle completo está en Reportes.</p>}
    </div>
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
