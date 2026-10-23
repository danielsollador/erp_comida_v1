import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import type { DocumentoEncontrado, RespuestaAsistente } from '../lib/api'
import { useMoneda } from '../lib/moneda'
import { sinBarraLateral } from './Rail'
import { useGuia } from './Guia'

/**
 * EL ASISTENTE (spike de IA, 22-oct-2026): una sola puerta para preguntarle
 * al negocio ("¿cuánto vendí ayer?") y para pedir que te enseñen ("¿cómo cargo
 * una factura?"). Lo segundo no se contesta con un párrafo: se ofrece una guía
 * que recorre la pantalla real (ver `Guia.tsx`).
 *
 * No va en el mostrador ni en la cocina: ahí la pantalla es de la cajera y un
 * botón flotante taparía el de cobrar.
 */
type Mensaje = { rol: 'yo' | 'asistente'; texto: string; r?: RespuestaAsistente; error?: boolean }

const SUGERENCIAS = [
  '¿Cuánto vendí hoy y cómo voy contra ayer?',
  '¿Qué se me está acabando?',
  '¿Qué producto me deja más ganancia?',
  'Enséñame a cargar una factura',
  'Búscame la última factura de carne',
]

export default function Asistente() {
  const { pathname, search } = useLocation()
  const { iniciar, activa } = useGuia()
  const [abierto, setAbierto] = useState(false)
  const [mensajes, setMensajes] = useState<Mensaje[]>([])
  const [texto, setTexto] = useState('')
  const [pensando, setPensando] = useState(false)
  const fondo = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fondo.current?.scrollTo({ top: fondo.current.scrollHeight, behavior: 'smooth' })
  }, [mensajes, pensando])

  useEffect(() => {
    if (!abierto) return
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false)
    document.addEventListener('keydown', tecla)
    return () => document.removeEventListener('keydown', tecla)
  }, [abierto])

  // Durante una guía el botón taparía justo lo que se está señalando.
  if (sinBarraLateral(pathname) || activa) return null

  async function enviar(t: string) {
    const pregunta = t.trim()
    if (!pregunta || pensando) return
    const nuevos: Mensaje[] = [...mensajes, { rol: 'yo', texto: pregunta }]
    setMensajes(nuevos)
    setTexto('')
    setPensando(true)
    try {
      const historial = nuevos.filter((m) => !m.error).slice(-10).map(({ rol, texto }) => ({ rol, texto }))
      const r = await api.preguntarAsistente(historial, pathname + search)
      setMensajes((m) => [...m, { rol: 'asistente', texto: r.texto, r }])
    } catch (e) {
      setMensajes((m) => [...m, { rol: 'asistente', texto: (e as Error).message, error: true }])
    } finally {
      setPensando(false)
    }
  }

  function mostrar(r: RespuestaAsistente) {
    if (!r.guia?.length) return
    setAbierto(false)
    iniciar(r.guia)
  }

  return (
    <>
      {!abierto && (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="fixed bottom-5 right-5 z-40 flex min-h-12 items-center gap-2 rounded-full bg-neutral-900 pl-4 pr-5 text-sm font-medium text-white shadow-[0_1px_2px_rgb(0_0_0/.08),0_8px_24px_rgb(0_0_0/.16)] active:scale-[.97]"
          aria-label="Abrir el asistente"
        >
          <Chispa />
          Pregúntame
        </button>
      )}
      {abierto &&
        createPortal(
          <div className="fixed inset-0 z-50 flex justify-end bg-black/30 sm:bg-black/20" onClick={() => setAbierto(false)}>
            <section
              role="dialog"
              aria-label="Asistente"
              onClick={(e) => e.stopPropagation()}
              className="flex h-full w-full flex-col bg-neutral-50 sm:m-3 sm:h-[calc(100%-1.5rem)] sm:w-[420px] sm:rounded-3xl sm:shadow-[0_1px_2px_rgb(0_0_0/.06),0_16px_40px_rgb(0_0_0/.18)]"
            >
              <header className="flex items-center gap-3 px-5 pt-5 pb-3">
                <div className="flex-1">
                  <h2 className="font-[Sora] text-[19px] font-semibold tracking-[-0.01em]">Pregúntame</h2>
                  <p className="text-[13px] text-neutral-500">Sobre tu negocio, o cómo hacer algo aquí.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setAbierto(false)}
                  aria-label="Cerrar"
                  className="grid h-11 w-11 place-items-center rounded-full text-neutral-500 active:bg-neutral-200"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </header>

              <div ref={fondo} className="flex-1 space-y-3 overflow-y-auto px-5 pb-4">
                {mensajes.length === 0 && (
                  <div className="space-y-2 pt-2">
                    {SUGERENCIAS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => enviar(s)}
                        className="block min-h-11 w-full rounded-2xl bg-white px-4 py-3 text-left text-[15px] text-neutral-800 active:bg-neutral-100"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
                {mensajes.map((m, i) =>
                  m.rol === 'yo' ? (
                    <p key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl bg-neutral-900 px-4 py-2.5 text-[15px] text-white">
                      {m.texto}
                    </p>
                  ) : (
                    <div key={i} className="max-w-[92%]">
                      <div
                        className={`whitespace-pre-line rounded-2xl bg-white px-4 py-3 text-[15px] leading-normal ${
                          m.error ? 'text-peligro-700' : 'text-neutral-800'
                        }`}
                      >
                        {m.error ? m.texto : <TextoRico texto={m.texto} />}
                      </div>
                      {m.r?.documentos?.length ? (
                        <Documentos
                          docs={m.r.documentos}
                          onAbrir={() => setAbierto(false)}
                        />
                      ) : null}
                      {m.r?.guia?.length ? (
                        <button
                          type="button"
                          onClick={() => mostrar(m.r!)}
                          className="mt-2 min-h-11 rounded-xl bg-neutral-900 px-4 text-sm font-medium text-white active:scale-[.97]"
                        >
                          Muéstrame en la pantalla · {m.r.guia.length} {m.r.guia.length === 1 ? 'paso' : 'pasos'}
                        </button>
                      ) : null}
                      {m.r && m.r.consulto.length > 0 && (
                        <p className="mt-1.5 px-1 text-xs text-neutral-500">Revisé: {m.r.consulto.join(' · ')}</p>
                      )}
                    </div>
                  ),
                )}
                {pensando && <p className="px-1 text-sm text-neutral-500">Revisando tus números…</p>}
              </div>

              <form
                className="flex items-end gap-2 border-t border-neutral-200/70 p-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  enviar(texto)
                }}
              >
                <textarea
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      enviar(texto)
                    }
                  }}
                  rows={1}
                  placeholder="Escribe tu pregunta"
                  aria-label="Tu pregunta"
                  className="max-h-32 min-h-11 flex-1 resize-none rounded-xl bg-white px-3 py-2.5 text-[15px]"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={!texto.trim() || pensando}
                  className="min-h-11 rounded-xl bg-neutral-900 px-4 text-sm font-medium text-white disabled:opacity-40"
                >
                  Enviar
                </button>
              </form>
            </section>
          </div>,
          document.body,
        )}
    </>
  )
}

/**
 * Lo que encontró «buscar documentos»: cada uno se abre en su pantalla, ya
 * desplegado (ver lib/abrirDeUrl.ts). La lista la arma el servidor con lo que
 * hay en la base; el modelo solo dice cuál le parece.
 */
function Documentos({ docs, onAbrir }: { docs: DocumentoEncontrado[]; onAbrir: () => void }) {
  const navegar = useNavigate()
  const { fmt } = useMoneda()
  const dia = (iso: string) => {
    const [a, m, d] = iso.split('-')
    return `${d}/${m}/${a.slice(2)}`
  }
  return (
    <ul className="mt-2 divide-y divide-neutral-200/70 overflow-hidden rounded-2xl bg-white">
      {docs.map((d) => (
        <li key={`${d.tipo}-${d.id}`}>
          <button
            type="button"
            onClick={() => {
              onAbrir()
              navegar(d.enlace)
            }}
            className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left active:bg-neutral-100"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium text-neutral-900">{d.titulo}</span>
              <span className="block truncate text-[13px] text-neutral-500">
                {dia(d.fecha)}
                {d.estado && ` · ${d.estado}`}
                {d.detalle && ` · ${d.detalle}`}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-[15px] font-semibold tabular-nums">{fmt(d.monto_usd)}</span>
              <span className="block text-[12px] font-medium text-acento-700">Abrir</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Lo único de Markdown que usa el modelo: **negrita** y viñetas. */
function TextoRico({ texto }: { texto: string }) {
  const limpio = texto.replace(/^\s*[*-]\s+/gm, '• ')
  return (
    <>
      {limpio.split(/(\*\*[^*]+\*\*)/g).map((t, i) =>
        t.startsWith('**') && t.endsWith('**') ? (
          <b key={i} className="font-semibold text-neutral-900">
            {t.slice(2, -2)}
          </b>
        ) : (
          t
        ),
      )}
    </>
  )
}

function Chispa() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </svg>
  )
}
