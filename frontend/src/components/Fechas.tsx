import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
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
        title="Elegir el período"
        // LA MISMA PASTILLA QUE LOS DEMAS FILTROS (`FiltroDesplegable`): el
        // rotulo en gris, lo elegido en negrita, la flecha. Vive en la fila de
        // filtros de cada modulo (`BarraFiltros`) y ya no en el encabezado,
        // asi que tiene sitio para decir el periodo entero, tambien en el
        // telefono, donde antes era solo un icono.
        className={`vp-control inline-flex items-center gap-1.5 h-9 rounded-full px-3 text-sm shrink-0 select-none whitespace-nowrap ${
          dark ? 'text-white' : 'text-neutral-900'
        }`}
      >
        <span className="shrink-0 text-neutral-500">Período</span>
        <span className="font-semibold truncate max-w-[15rem]">
          <span className="hidden sm:inline">{nombreRango(rango)} · </span>
          <span className="tabular-nums">{etiquetaRango(rango)}</span>
        </span>
        <span aria-hidden className="vp-flecha shrink-0 opacity-60" />
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
  //
  // SE MIDE ANTES DE PINTAR. Esto vivia en un `useEffect`, que corre cuando el
  // navegador YA pinto, asi que el primer fotograma salia con `pos` en null --
  // y con `pos` en null este panel es la hoja de telefono: fondo negro al 40 %
  // con desenfoque tapando la pantalla entera y el panel pegado abajo. En el
  // fotograma siguiente saltaba a su sitio bajo el boton y el fondo se volvia
  // transparente. Ese destello negro en cada toque del filtro era el parpadeo
  // que Leider reporto cuatro veces (24-sep: "cuando aprieto el filtro de
  // fecha se reinicia la pantalla").
  //
  // Ahora el valor ya viene medido en el estado inicial --el boton existe
  // antes que este panel, asi que se puede medir durante el render-- y
  // `useLayoutEffect` lo corrige antes de pintar si cambia el tamaño de la
  // ventana. El primer fotograma ya es el definitivo.
  const medir = useCallback(() => {
    const el = ancla.current
    if (!el || window.innerWidth < 640) return null
    const r = el.getBoundingClientRect()
    // Alineado con el borde izquierdo de la pastilla, que es donde esta el
    // ojo; si no cabe hacia la derecha, se corre lo justo.
    const left = Math.max(8, Math.min(r.left, window.innerWidth - ANCHO_PANEL - 8))
    return { top: r.bottom + 6, left }
  }, [ancla])
  const [pos, setPos] = useState<{ top: number; left: number } | null>(medir)
  useLayoutEffect(() => {
    const alCambiar = () => setPos(medir())
    alCambiar()
    window.addEventListener('resize', alCambiar)
    return () => window.removeEventListener('resize', alCambiar)
  }, [medir])

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
      aria-label="Elegir el período"
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
