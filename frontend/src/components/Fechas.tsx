import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import Icono from './Icono'
import {
  ATAJOS,
  MESES,
  aIso,
  deIso,
  etiquetaRango,
  hoy,
  nombreRango,
  rangoDe,
  type Rango,
} from '../lib/fechas'

/**
 * EL CONTROL DEL RANGO DE FECHAS. Uno solo, el mismo en todas las pantallas.
 *
 * Una pastilla en el encabezado con lo que se esta viendo ("Este mes · 1–16
 * sep") que abre un panel con dos mitades: los atajos ("filtros exactos": hoy,
 * este mes, mes anterior, 90 dias, este año...) y un calendario para marcar
 * cualquier tramo a dos toques ("filtros dinamicos").
 *
 * ES NUESTRO, NO DEL NAVEGADOR. El `<input type="date">` abre el selector del
 * sistema operativo --justo el tipo de ventana que se pidio que no exista ni
 * una-- y ademas no sabe marcar un rango. Este calendario obedece la paleta y
 * el modo oscuro como todo lo demas.
 *
 * Que es el rango y donde vive (la URL): `lib/fechas.ts`.
 */
export function FiltroFechas({
  rango,
  alCambiar,
  dark = false,
}: {
  rango: Rango
  alCambiar: (r: Rango) => void
  dark?: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const boton = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button
        ref={boton}
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        title="Elegir el periodo"
        // En el telefono solo el icono: con el texto, el titulo del modulo se
        // quedaba sin sitio. El periodo se lee igual en el titulo de la tarjeta.
        className={`inline-flex items-center justify-center gap-1.5 h-9 w-9 sm:w-auto sm:px-3 rounded-xl border text-sm font-medium whitespace-nowrap ${
          dark
            ? 'border-neutral-700 hover:bg-neutral-800'
            : 'border-neutral-200 bg-white hover:bg-neutral-100'
        }`}
      >
        <Icono nombre="calendario" size={16} className="shrink-0 opacity-70" />
        <span className="hidden sm:inline truncate">
          <span className="hidden md:inline">{nombreRango(rango)}</span>
          <span className={`hidden md:inline ${dark ? 'text-neutral-600' : 'text-neutral-300'}`}> · </span>
          <span className="tabular-nums">{etiquetaRango(rango)}</span>
        </span>
        <Icono
          nombre="chevron"
          size={14}
          className={`hidden sm:block shrink-0 opacity-60 transition-transform ${abierto ? '-rotate-90' : 'rotate-90'}`}
        />
      </button>
      {abierto && (
        <PanelFechas
          ancla={boton}
          rango={rango}
          onCerrar={() => setAbierto(false)}
          onElegir={(r) => {
            alCambiar(r)
            setAbierto(false)
          }}
        />
      )}
    </>
  )
}

const ANCHO_PANEL = 560

function PanelFechas({
  ancla,
  rango,
  onCerrar,
  onElegir,
}: {
  ancla: RefObject<HTMLElement | null>
  rango: Rango
  onCerrar: () => void
  onElegir: (r: Rango) => void
}) {
  // En pantalla ancha, anclado bajo el boton; en el telefono, hoja desde abajo.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  useEffect(() => {
    const medir = () => {
      const el = ancla.current
      if (!el || window.innerWidth < 640) {
        setPos(null)
        return
      }
      const r = el.getBoundingClientRect()
      const left = Math.max(8, Math.min(r.right - ANCHO_PANEL, window.innerWidth - ANCHO_PANEL - 8))
      setPos({ top: r.bottom + 6, left })
    }
    medir()
    window.addEventListener('resize', medir)
    return () => window.removeEventListener('resize', medir)
  }, [ancla])

  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar()
    }
    document.addEventListener('keydown', alPulsar)
    return () => document.removeEventListener('keydown', alPulsar)
  }, [onCerrar])

  // La seleccion en el calendario: primer toque marca el inicio, segundo el
  // fin. Hasta el segundo toque se ve el tramo que quedaria bajo el cursor.
  const [desde, setDesde] = useState<string | null>(rango.desde)
  const [hasta, setHasta] = useState<string | null>(rango.hasta)
  const [sobre, setSobre] = useState<string | null>(null)
  const [mesVisto, setMesVisto] = useState(() => {
    const h = deIso(rango.hasta)
    return new Date(h.getFullYear(), h.getMonth(), 1)
  })

  const tocar = (iso: string) => {
    if (!desde || (desde && hasta)) {
      setDesde(iso)
      setHasta(null)
      return
    }
    if (iso < desde) {
      setHasta(desde)
      setDesde(iso)
    } else {
      setHasta(iso)
    }
  }

  const aplicar = () => {
    if (!desde) return
    const h = hasta ?? desde
    // Si el tramo coincide con un atajo, se guarda como atajo: la URL queda
    // `?r=mes` y no dos fechas que dentro de un mes ya no significan "este mes".
    const atajo = ATAJOS.find((a) => {
      const x = rangoDe(a.clave)
      return x.desde === desde && x.hasta === h
    })
    onElegir(atajo ? rangoDe(atajo.clave) : { desde, hasta: h, clave: 'personal' })
  }

  const provisional: [string, string] | null = desde
    ? hasta
      ? [desde, hasta]
      : sobre
        ? sobre < desde
          ? [sobre, desde]
          : [desde, sobre]
        : [desde, desde]
    : null

  const panel = (
    <div
      role="dialog"
      aria-label="Elegir el periodo"
      onClick={(e) => e.stopPropagation()}
      className={`bg-white border border-neutral-200 shadow-lg flex flex-col ${
        pos
          ? 'fixed rounded-2xl'
          : 'fixed inset-x-0 bottom-0 rounded-t-2xl max-h-[92vh] pb-[env(safe-area-inset-bottom)] overflow-y-auto'
      }`}
      style={{
        ...(pos ? { top: pos.top, left: pos.left, width: ANCHO_PANEL } : {}),
        animation: 'vp-entrar .18s cubic-bezier(.2,.7,.2,1) backwards',
      }}
    >
      <div className="flex flex-col sm:flex-row">
        {/* Los atajos: el 90% de las veces basta con esto. */}
        <div className="sm:w-[180px] sm:border-r border-neutral-100 p-2 grid grid-cols-3 sm:grid-cols-1 gap-0.5 sm:max-h-[380px] sm:overflow-y-auto">
          {ATAJOS.map((a) => {
            const activo = rango.clave === a.clave
            return (
              <button
                key={a.clave}
                type="button"
                onClick={() => onElegir(rangoDe(a.clave))}
                aria-current={activo ? 'true' : undefined}
                className={`text-left px-3 py-1.5 rounded-lg text-sm whitespace-nowrap truncate ${
                  activo ? 'bg-neutral-900 text-white font-medium' : 'hover:bg-neutral-100 text-neutral-700'
                }`}
              >
                {a.texto}
              </button>
            )
          })}
        </div>

        {/* El calendario: cualquier tramo, a dos toques. */}
        <div className="flex-1 p-3 border-t sm:border-t-0 border-neutral-100">
          <Calendario
            mes={mesVisto}
            alMoverMes={setMesVisto}
            seleccion={provisional}
            alTocar={tocar}
            alPasar={setSobre}
          />
          <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-neutral-100">
            <p className="text-xs text-neutral-500 tabular-nums min-w-0 truncate">
              {desde && hasta
                ? etiquetaRango({ desde, hasta, clave: 'personal' })
                : desde
                  ? `Desde el ${etiquetaRango({ desde, hasta: desde, clave: 'personal' })} — toca el último día`
                  : 'Toca el primer día'}
            </p>
            <div className="flex gap-1.5 shrink-0">
              <button type="button" onClick={onCerrar} className="px-3 py-1.5 rounded-lg text-sm text-neutral-600 hover:bg-neutral-100">
                Cancelar
              </button>
              <button
                type="button"
                onClick={aplicar}
                disabled={!desde}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-neutral-900 text-white disabled:opacity-40"
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )

  // Al `body`: el encabezado es `sticky` con `backdrop-filter`, que hace de
  // bloque contenedor y recortaria un panel `fixed` escrito dentro de el.
  return createPortal(
    <div
      className={`fixed inset-0 z-40 ${pos ? '' : 'bg-black/40 backdrop-blur-[2px]'}`}
      onClick={onCerrar}
      role="presentation"
    >
      {panel}
    </div>,
    document.body,
  )
}

const DIAS_SEMANA = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

function Calendario({
  mes,
  alMoverMes,
  seleccion,
  alTocar,
  alPasar,
}: {
  mes: Date
  alMoverMes: (m: Date) => void
  seleccion: [string, string] | null
  alTocar: (iso: string) => void
  alPasar: (iso: string | null) => void
}) {
  const hoyIso = aIso(hoy())
  const primero = new Date(mes.getFullYear(), mes.getMonth(), 1)
  const relleno = (primero.getDay() + 6) % 7 // lunes primero
  const diasDelMes = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate()
  const celdas: (Date | null)[] = [
    ...Array<null>(relleno).fill(null),
    ...Array.from({ length: diasDelMes }, (_, i) => new Date(mes.getFullYear(), mes.getMonth(), i + 1)),
  ]
  while (celdas.length % 7) celdas.push(null)

  const mover = (n: number) => alMoverMes(new Date(mes.getFullYear(), mes.getMonth() + n, 1))
  const esFuturo = new Date(mes.getFullYear(), mes.getMonth() + 1, 1) > hoy()

  return (
    <div onPointerLeave={() => alPasar(null)}>
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={() => mover(-1)} aria-label="Mes anterior" className="w-8 h-8 grid place-items-center rounded-lg hover:bg-neutral-100">
          <Icono nombre="chevron" size={16} className="rotate-180" />
        </button>
        <button
          type="button"
          onClick={() => alMoverMes(new Date(hoy().getFullYear(), hoy().getMonth(), 1))}
          className="text-sm font-semibold capitalize hover:underline"
          title="Ir al mes actual"
        >
          {MESES[mes.getMonth()]} {mes.getFullYear()}
        </button>
        <button
          type="button"
          onClick={() => mover(1)}
          disabled={esFuturo}
          aria-label="Mes siguiente"
          className="w-8 h-8 grid place-items-center rounded-lg hover:bg-neutral-100 disabled:opacity-30"
        >
          <Icono nombre="chevron" size={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-neutral-400 mb-1">
        {DIAS_SEMANA.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {celdas.map((d, i) => {
          if (!d) return <span key={i} />
          const iso = aIso(d)
          const futuro = iso > hoyIso
          const dentro = !!seleccion && iso >= seleccion[0] && iso <= seleccion[1]
          const inicio = !!seleccion && iso === seleccion[0]
          const fin = !!seleccion && iso === seleccion[1]
          return (
            <button
              key={iso}
              type="button"
              disabled={futuro}
              onClick={() => alTocar(iso)}
              onPointerEnter={(e) => {
                // Un dia futuro no se puede elegir: tampoco se previsualiza.
                if (e.pointerType === 'mouse' && !futuro) alPasar(iso)
              }}
              aria-label={`${d.getDate()} de ${MESES[d.getMonth()]}`}
              aria-pressed={inicio || fin}
              className={`relative h-9 text-sm tabular-nums disabled:text-neutral-300 ${
                dentro ? 'bg-neutral-100' : ''
              } ${inicio ? 'rounded-l-lg' : ''} ${fin ? 'rounded-r-lg' : ''}`}
            >
              <span
                className={`inline-grid place-items-center w-8 h-8 rounded-lg ${
                  inicio || fin
                    ? 'bg-neutral-900 text-white font-semibold'
                    : iso === hoyIso
                      ? 'font-bold text-acento-600'
                      : futuro
                        ? ''
                        : 'hover:bg-neutral-200'
                }`}
              >
                {d.getDate()}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
