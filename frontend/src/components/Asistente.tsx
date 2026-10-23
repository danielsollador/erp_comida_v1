import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as EventoPuntero } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import type { DocumentoEncontrado, RespuestaAsistente } from '../lib/api'
import { useMoneda } from '../lib/moneda'
import { sinBarraLateral } from './Rail'
import { useGuia } from './Guia'
import { Chispa, Pensando, SelloIA, TextoRico } from './ia'
import { sinMovimiento } from '../lib/movimiento'

/**
 * EL ASISTENTE (spike de IA, 22-oct-2026): una sola puerta para preguntarle
 * al negocio ("¿cuánto vendí ayer?") y para pedir que te enseñen ("¿cómo cargo
 * una factura?"). Lo segundo no se contesta con un párrafo: se ofrece una guía
 * que recorre la pantalla real (ver `Guia.tsx`).
 *
 * No va en el mostrador ni en la cocina: ahí la pantalla es de la cajera y un
 * botón flotante taparía el de cobrar.
 *
 * FORMA (23-oct). En el teléfono es una hoja que sube desde abajo, con su
 * manija para bajarla con el dedo y el campo siempre encima del teclado; desde
 * 640 px es un panel a la derecha que deja ver la pantalla. El botón flotante
 * se esconde al bajar por la página en el teléfono (no tapa lo último de la
 * lista) y vuelve al subir. La conversación sobrevive a cambiar de pantalla y
 * a recargar (sessionStorage), porque abrir un documento que encontró lleva a
 * otra pantalla y lo natural es volver y seguir preguntando.
 */
type Mensaje = { rol: 'yo' | 'asistente'; texto: string; r?: RespuestaAsistente; error?: boolean; reintentar?: string }

const LLAVE = 'vp-asistente-conversacion'

const GRUPOS = [
  {
    id: 'numeros',
    titulo: 'Tus números',
    preguntas: ['¿Cuánto vendí hoy y cómo voy contra ayer?', '¿Qué se me está acabando?', '¿Qué producto me deja más ganancia?'],
  },
  { id: 'aprender', titulo: 'Te enseño en la pantalla', preguntas: ['Enséñame a cargar una factura', '¿Cómo cambio el precio de un producto?'] },
  { id: 'buscar', titulo: 'Encuentra un documento', preguntas: ['Búscame la última factura de carne'] },
] as const

const MODULOS: [string, string, (typeof GRUPOS)[number]['id']][] = [
  ['/compras', 'Compras', 'buscar'],
  ['/inventario', 'Inventario', 'numeros'],
  ['/menu', 'Menú', 'aprender'],
  ['/recetas', 'Recetas', 'aprender'],
  ['/caja', 'Cierre de caja', 'numeros'],
  ['/ventas', 'Ventas', 'buscar'],
  ['/reportes', 'Reportes', 'numeros'],
  ['/contabilidad', 'Contabilidad', 'buscar'],
  ['/impuestos', 'Impuestos', 'buscar'],
  ['/configuracion', 'Configuración', 'aprender'],
]

function frasesPara(pregunta: string): string[] {
  if (/ens[eé]ñ|c[oó]mo (se |hago|cargo|cambio|creo|pongo|registro)|paso a paso/i.test(pregunta))
    return ['Buscando los pasos…', 'Preparando la guía…']
  if (/b[uú]sca|factura|gasto|documento|venta n/i.test(pregunta)) return ['Buscando en tus documentos…', 'Revisando fechas y montos…']
  return ['Revisando tus números…', 'Comparando con días anteriores…', 'Armando la respuesta…']
}

function leerConversacion(): Mensaje[] {
  try {
    const m = JSON.parse(sessionStorage.getItem(LLAVE) ?? '[]')
    return Array.isArray(m) ? m : []
  } catch {
    return []
  }
}

export default function Asistente() {
  const { pathname, search } = useLocation()
  const { iniciar, activa } = useGuia()
  const [fase, setFase] = useState<'cerrado' | 'abierto' | 'saliendo'>('cerrado')
  const [mensajes, setMensajes] = useState<Mensaje[]>(leerConversacion)
  const [texto, setTexto] = useState('')
  const [pensando, setPensando] = useState<string | null>(null)
  const [oculto, setOculto] = useState(false)
  const fondo = useRef<HTMLDivElement>(null)
  const campo = useRef<HTMLTextAreaElement>(null)
  const hoja = useRef<HTMLElement>(null)
  const arrastre = useRef<{ y0: number; dy: number } | null>(null)
  const abierto = fase !== 'cerrado'
  const [, modulo, primero] = MODULOS.find(([r]) => pathname.startsWith(r)) ?? ['', '', 'numeros']

  useEffect(() => {
    try {
      sessionStorage.setItem(LLAVE, JSON.stringify(mensajes.slice(-30)))
    } catch {
      /* sin almacenamiento: la conversación vive solo en memoria */
    }
  }, [mensajes])

  useEffect(() => {
    fondo.current?.scrollTo({ top: fondo.current.scrollHeight, behavior: sinMovimiento() ? 'auto' : 'smooth' })
  }, [mensajes, pensando, fase])

  const cerrar = useCallback(() => {
    if (sinMovimiento()) return setFase('cerrado')
    setFase('saliendo')
    window.setTimeout(() => setFase('cerrado'), 210)
  }, [])

  useEffect(() => {
    if (!abierto) return
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && cerrar()
    document.addEventListener('keydown', tecla)
    // En el teléfono la hoja ocupa la pantalla: lo de atrás no se desplaza.
    const chico = window.matchMedia('(max-width: 639px)').matches
    const overflow = document.body.style.overflow
    if (chico) document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', tecla)
      document.body.style.overflow = overflow
    }
  }, [abierto, cerrar])

  // El campo siempre por encima del teclado del teléfono: en el navegador el
  // teclado no achica la ventana, achica `visualViewport`.
  useLayoutEffect(() => {
    const vv = window.visualViewport
    if (!abierto || !vv || !hoja.current) return
    const ajustar = () => {
      const tapa = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      hoja.current?.style.setProperty('--vp-ia-teclado', `${tapa}px`)
    }
    ajustar()
    vv.addEventListener('resize', ajustar)
    vv.addEventListener('scroll', ajustar)
    return () => {
      vv.removeEventListener('resize', ajustar)
      vv.removeEventListener('scroll', ajustar)
    }
  }, [abierto])

  // En el teléfono el botón flotante se aparta al bajar por la página.
  useEffect(() => {
    let antes = window.scrollY
    const alDesplazar = () => {
      if (!window.matchMedia('(max-width: 639px)').matches) return setOculto(false)
      const y = window.scrollY
      if (y > antes + 6 && y > 120) setOculto(true)
      else if (y < antes - 6) setOculto(false)
      antes = y
    }
    window.addEventListener('scroll', alDesplazar, { passive: true })
    return () => window.removeEventListener('scroll', alDesplazar)
  }, [])

  // Durante una guía el botón taparía justo lo que se está señalando.
  if (sinBarraLateral(pathname) || activa) return null

  async function enviar(t: string, previos: Mensaje[] = mensajes) {
    const pregunta = t.trim()
    if (!pregunta || pensando) return
    const nuevos: Mensaje[] = [...previos, { rol: 'yo', texto: pregunta }]
    setMensajes(nuevos)
    setTexto('')
    // El campo vuelve a un renglón (había crecido con lo escrito).
    if (campo.current) campo.current.style.height = ''
    setPensando(pregunta)
    try {
      const historial = nuevos.filter((m) => !m.error).slice(-10).map(({ rol, texto }) => ({ rol, texto }))
      const r = await api.preguntarAsistente(historial, pathname + search)
      setMensajes((m) => [...m, { rol: 'asistente', texto: r.texto, r }])
    } catch (e) {
      setMensajes((m) => [...m, { rol: 'asistente', texto: (e as Error).message, error: true, reintentar: pregunta }])
    } finally {
      setPensando(null)
    }
  }

  function reintentar(i: number) {
    const m = mensajes[i]
    if (!m.reintentar) return
    // Se quita la pregunta que falló y su error, y se vuelve a mandar igual.
    void enviar(m.reintentar, mensajes.slice(0, i - 1))
  }

  function mostrar(r: RespuestaAsistente) {
    if (!r.guia?.length) return
    setFase('cerrado')
    iniciar(r.guia)
  }

  // Bajar la hoja con el dedo (solo en el teléfono, desde la manija o la cabecera).
  const alBajar = (e: EventoPuntero) => {
    if (e.pointerType === 'mouse' || !window.matchMedia('(max-width: 639px)').matches) return
    arrastre.current = { y0: e.clientY, dy: 0 }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const alMover = (e: EventoPuntero) => {
    if (!arrastre.current || !hoja.current) return
    arrastre.current.dy = Math.max(0, e.clientY - arrastre.current.y0)
    hoja.current.style.transform = `translateY(${arrastre.current.dy}px)`
  }
  const alSoltar = () => {
    if (!arrastre.current || !hoja.current) return
    const { dy } = arrastre.current
    arrastre.current = null
    hoja.current.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1)'
    hoja.current.style.transform = dy > 110 ? 'translateY(100%)' : ''
    const h = hoja.current
    window.setTimeout(() => {
      h.style.transition = ''
      if (dy > 110) {
        h.style.transform = ''
        setFase('cerrado')
      }
    }, 220)
  }

  const grupos = [...GRUPOS].sort((a, b) => (a.id === primero ? -1 : b.id === primero ? 1 : 0))

  return (
    <>
      {!abierto && (
        <button
          type="button"
          onClick={() => setFase('abierto')}
          data-oculto={oculto || undefined}
          className="vp-ia-lanzador fixed right-4 z-40 flex h-14 w-14 items-center justify-center gap-2 rounded-full bg-neutral-900 text-white shadow-[0_1px_2px_rgb(0_0_0/.1),0_10px_28px_rgb(0_0_0/.22)] active:scale-[.96] sm:right-5 sm:h-12 sm:w-auto sm:pl-4 sm:pr-5"
          style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom) + var(--vp-teclado-abajo, 0px))' }}
          aria-label="Abrir el asistente"
        >
          <Chispa tam={20} />
          <span className="hidden text-sm font-medium sm:inline">Pregúntame</span>
          {mensajes.length > 0 && (
            <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-[var(--vp-acento)] ring-2 ring-neutral-900 sm:static sm:ring-0" aria-hidden="true" />
          )}
        </button>
      )}
      {abierto &&
        createPortal(
          <div
            data-saliendo={fase === 'saliendo' || undefined}
            className="vp-ia-velo fixed inset-0 z-50 flex items-end justify-end bg-black/35 sm:items-stretch sm:bg-black/15"
            onClick={cerrar}
          >
            <section
              ref={hoja}
              role="dialog"
              aria-modal="true"
              aria-label="Asistente"
              data-saliendo={fase === 'saliendo' || undefined}
              onClick={(e) => e.stopPropagation()}
              className="vp-ia-hoja flex h-[calc(100dvh-12px)] w-full flex-col overflow-hidden rounded-t-[28px] bg-neutral-50 shadow-[inset_0_0_0_1px_var(--vp-textura),0_-8px_40px_-12px_rgb(23_24_27/.35)] sm:m-3 sm:h-[calc(100dvh-1.5rem)] sm:w-[440px] sm:rounded-3xl sm:shadow-[inset_0_0_0_1px_var(--vp-textura),0_28px_60px_-22px_rgb(23_24_27/.38)]"
              style={{ paddingBottom: 'max(var(--vp-ia-teclado, 0px), var(--vp-teclado-abajo, 0px))' }}
            >
              <header
                className="shrink-0 touch-none select-none px-5 pb-3 pt-2 sm:pt-5"
                onPointerDown={alBajar}
                onPointerMove={alMover}
                onPointerUp={alSoltar}
                onPointerCancel={alSoltar}
              >
                <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-neutral-300 sm:hidden" aria-hidden="true" />
                <div className="flex items-center gap-3">
                  <SelloIA tam={36} />
                  <div className="min-w-0 flex-1">
                    <h2 className="font-[Sora] text-[19px] font-semibold leading-tight tracking-[-0.01em]">Pregúntame</h2>
                    <p className="truncate text-[13px] text-neutral-500">
                      {modulo ? `Estás en ${modulo}` : 'Tus números, o cómo hacer algo'}
                    </p>
                  </div>
                  {mensajes.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setMensajes([])}
                      disabled={!!pensando}
                      aria-label="Empezar una conversación nueva"
                      title="Conversación nueva"
                      className="grid h-11 w-11 place-items-center rounded-full text-neutral-500 hover:bg-neutral-200/60 active:bg-neutral-200 disabled:opacity-40"
                    >
                      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                      </svg>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={cerrar}
                    aria-label="Cerrar"
                    title="Cerrar (Esc)"
                    className="grid h-11 w-11 place-items-center rounded-full text-neutral-500 hover:bg-neutral-200/60 active:bg-neutral-200"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
              </header>

              <div ref={fondo} className="flex-1 overflow-y-auto overscroll-contain px-4 pb-4 sm:px-5">
                {mensajes.length === 0 ? (
                  <div className="space-y-5 pt-2">
                    <p className="vp-ia-aparecer px-1 font-[Sora] text-[22px] font-semibold leading-snug tracking-[-0.015em] text-neutral-900">
                      ¿Qué quieres saber hoy?
                    </p>
                    {grupos.map((g, gi) => (
                      <div key={g.id} className="vp-ia-aparecer space-y-2" style={{ animationDelay: `${60 + gi * 60}ms` }}>
                        <p className="px-1 text-[12px] font-medium uppercase tracking-[0.06em] text-neutral-500">{g.titulo}</p>
                        {g.preguntas.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => enviar(s)}
                            className="group flex min-h-12 w-full items-center gap-3 rounded-2xl bg-white px-4 py-3 text-left text-[15px] text-neutral-800 shadow-[inset_0_0_0_1px_var(--vp-textura)] transition-colors hover:bg-neutral-100/70 active:bg-neutral-100"
                          >
                            <span className="flex-1">{s}</span>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-neutral-400 transition-transform group-hover:translate-x-0.5" aria-hidden="true">
                              <path d="M5 12h14M13 6l6 6-6 6" />
                            </svg>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <ol className="space-y-4 pt-1" aria-label="Conversación">
                    {mensajes.map((m, i) =>
                      m.rol === 'yo' ? (
                        <li key={i} className="vp-ia-mensaje flex justify-end">
                          <p className="max-w-[85%] whitespace-pre-line rounded-[20px] rounded-br-md bg-neutral-900 px-4 py-2.5 text-[15px] leading-normal text-white">
                            {m.texto}
                          </p>
                        </li>
                      ) : (
                        <li key={i} className="vp-ia-mensaje flex gap-2.5">
                          <SelloIA tam={28} />
                          <div className="min-w-0 max-w-[92%] flex-1">
                            {m.error ? (
                              <div className="rounded-[20px] rounded-tl-md bg-peligro-500/10 px-4 py-3 text-[15px] text-peligro-700">
                                <p>{m.texto}</p>
                                {m.reintentar && i === mensajes.length - 1 && (
                                  <button
                                    type="button"
                                    onClick={() => reintentar(i)}
                                    className="mt-2 min-h-10 rounded-xl bg-white px-3.5 text-sm font-medium text-neutral-900 active:scale-[.97]"
                                  >
                                    Intentar de nuevo
                                  </button>
                                )}
                              </div>
                            ) : (
                              <div className="rounded-[20px] rounded-tl-md bg-white px-4 py-3 text-[15px] leading-relaxed text-neutral-800 shadow-[inset_0_0_0_1px_var(--vp-textura)]">
                                <TextoRico texto={m.texto} />
                              </div>
                            )}
                            {m.r?.documentos?.length ? <Documentos docs={m.r.documentos} onAbrir={() => setFase('cerrado')} /> : null}
                            {m.r?.guia?.length ? (
                              <button
                                type="button"
                                onClick={() => mostrar(m.r!)}
                                className="mt-2 flex min-h-12 w-full items-center gap-3 rounded-2xl bg-neutral-900 px-4 text-left text-white active:scale-[.98]"
                              >
                                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/15" aria-hidden="true">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M8 5.5v13l11-6.5z" />
                                  </svg>
                                </span>
                                <span className="flex-1">
                                  <span className="block text-[15px] font-medium">Muéstrame en la pantalla</span>
                                  <span className="block text-[12px] text-white/70">
                                    {m.r.guia.length} {m.r.guia.length === 1 ? 'paso' : 'pasos'} · lo haces tú, yo te señalo dónde
                                  </span>
                                </span>
                              </button>
                            ) : null}
                            {!m.error && <PieRespuesta texto={m.texto} consulto={m.r?.consulto ?? []} />}
                          </div>
                        </li>
                      ),
                    )}
                    {pensando && (
                      <li className="vp-ia-mensaje flex items-center gap-2.5">
                        <SelloIA tam={28} />
                        <div className="rounded-[20px] rounded-tl-md bg-white px-4 py-3 shadow-[inset_0_0_0_1px_var(--vp-textura)]">
                          <Pensando frases={frasesPara(pensando)} />
                        </div>
                      </li>
                    )}
                  </ol>
                )}
              </div>

              <form
                className="shrink-0 px-3 pb-3 pt-2 sm:px-4 sm:pb-4"
                style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
                onSubmit={(e) => {
                  e.preventDefault()
                  void enviar(texto)
                }}
              >
                <div className="vp-ia-campo flex items-end gap-2 rounded-[22px] bg-white p-1.5 pl-4 shadow-[inset_0_0_0_1px_var(--vp-textura),0_1px_2px_rgb(0_0_0/.04)] transition-shadow">
                  <textarea
                    ref={campo}
                    value={texto}
                    onChange={(e) => {
                      setTexto(e.target.value)
                      // Crece con lo que se escribe, hasta 5 renglones.
                      e.target.style.height = 'auto'
                      e.target.style.height = `${Math.min(e.target.scrollHeight, 132)}px`
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void enviar(texto)
                      }
                    }}
                    rows={1}
                    placeholder={pensando ? 'Espera la respuesta…' : 'Escribe tu pregunta'}
                    aria-label="Tu pregunta"
                    enterKeyHint="send"
                    className="max-h-[132px] min-h-11 flex-1 resize-none bg-transparent py-2.5 text-base outline-none placeholder:text-neutral-400 sm:text-[15px]"
                  />
                  <button
                    type="submit"
                    disabled={!texto.trim() || !!pensando}
                    aria-label="Enviar"
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-neutral-900 text-white transition-[opacity,transform] active:scale-[.94] disabled:opacity-25"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 19V5M5 12l7-7 7 7" />
                    </svg>
                  </button>
                </div>
                <p className="mt-1.5 hidden px-2 text-[12px] text-neutral-500 sm:block">
                  Enter para enviar · Shift + Enter para otro renglón. Solo lee tus datos: no cambia nada sin preguntarte.
                </p>
              </form>
            </section>
          </div>,
          document.body,
        )}
    </>
  )
}

/** Debajo de cada respuesta: qué revisó y un botón para copiarla. */
function PieRespuesta({ texto, consulto }: { texto: string; consulto: string[] }) {
  const [copiado, setCopiado] = useState(false)
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 px-1">
      {consulto.length > 0 && (
        <>
          <span className="text-[12px] text-neutral-500">Revisé</span>
          {consulto.map((c) => (
            <span key={c} className="rounded-full bg-neutral-200/60 px-2 py-0.5 text-[12px] text-neutral-600">
              {c}
            </span>
          ))}
        </>
      )}
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(texto.replace(/\*\*/g, '')).then(() => {
            setCopiado(true)
            window.setTimeout(() => setCopiado(false), 1600)
          })
        }}
        className="ml-auto min-h-8 rounded-lg px-2 text-[12px] text-neutral-500 hover:bg-neutral-200/60 hover:text-neutral-800"
      >
        {copiado ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  )
}

const ICONO_DOC: Record<DocumentoEncontrado['tipo'], string> = {
  compra: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  venta: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  gasto: 'M3 7h18v12H3zM3 11h18M16 15h2',
}
const NOMBRE_DOC: Record<DocumentoEncontrado['tipo'], string> = { compra: 'Factura', venta: 'Venta', gasto: 'Gasto' }

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
    <ul className="mt-2 divide-y divide-neutral-200/70 overflow-hidden rounded-2xl bg-white shadow-[inset_0_0_0_1px_var(--vp-textura)]">
      {docs.map((d) => (
        <li key={`${d.tipo}-${d.id}`}>
          <button
            type="button"
            onClick={() => {
              onAbrir()
              navegar(d.enlace)
            }}
            className="flex min-h-14 w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-neutral-100/60 active:bg-neutral-100"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-neutral-100 text-neutral-600" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d={ICONO_DOC[d.tipo]} />
              </svg>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium text-neutral-900">{d.titulo}</span>
              <span className="block truncate text-[13px] text-neutral-500">
                {NOMBRE_DOC[d.tipo]} · {dia(d.fecha)}
                {d.estado && ` · ${d.estado}`}
                {d.detalle && ` · ${d.detalle}`}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-[15px] font-semibold tabular-nums">{fmt(d.monto_usd)}</span>
              <span className="inline-flex items-center gap-0.5 text-[12px] font-medium text-[var(--vp-acento)]">
                Abrir
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
