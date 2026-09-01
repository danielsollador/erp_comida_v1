import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api'
import type { EstadoTasa } from './types'

/**
 * Vista cambiaria de toda la app. Portado del modulo cambiario de Vertigo
 * Flanco y recortado a lo que un restaurante necesita.
 *
 * Los precios viven en USD en la base (fuente de verdad: no se mueven cuando
 * se mueve la tasa). Esto decide como se MUESTRAN, y en Venezuela eso no es un
 * interruptor de dos posiciones:
 *
 *  - usd       -> dolares tal como estan cargados en el menu.
 *  - bs        -> bolivares a la tasa vigente. Es lo que el cliente paga.
 *  - usd_calle -> lo que valen de verdad esos bolivares si hoy compras divisas
 *                 al paralelo: USD x (tasa / paralelo). Con 12% de brecha,
 *                 $100 cobrados en Bs son ~$89 reales. Es la vista que dice si
 *                 el margen del menu es real o se lo comio la brecha.
 */
export type VistaMoneda = 'usd' | 'bs' | 'usd_calle'

const SUFIJOS: Record<VistaMoneda, string> = {
  usd: 'USD',
  bs: 'Bs',
  usd_calle: 'USD calle',
}

const CLAVE_VISTA = 'erp-vista-moneda'

type Ctx = {
  vista: VistaMoneda
  setVista: (v: VistaMoneda) => void
  tasa: EstadoTasa | null
  /** Convierte un monto en USD a la vista elegida y lo formatea. */
  fmt: (usd: number | null | undefined, decimales?: number) => string
  sufijo: string
  recargar: () => void
}

const MonedaCtx = createContext<Ctx>({
  vista: 'usd',
  setVista: () => {},
  tasa: null,
  fmt: (v) => `$${(v ?? 0).toFixed(2)}`,
  sufijo: 'USD',
  recargar: () => {},
})

export function fmtBs(bs: number, decimales = 2) {
  return `Bs ${bs.toLocaleString('es-VE', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })}`
}

export function fmtNum(n: number, decimales = 2) {
  return n.toLocaleString('es-VE', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })
}

export function MonedaProvider({ children }: { children: ReactNode }) {
  const [vista, setVistaState] = useState<VistaMoneda>(() => {
    const guardada = localStorage.getItem(CLAVE_VISTA)
    return guardada === 'bs' || guardada === 'usd_calle' ? guardada : 'usd'
  })
  const [tasa, setTasa] = useState<EstadoTasa | null>(null)

  const recargar = useCallback(() => {
    api.estadoTasa().then(setTasa).catch(() => setTasa(null))
  }, [])

  useEffect(() => {
    recargar()
    // La tasa la refresca el backend cada media hora; esto solo mantiene al dia
    // lo que ve la pantalla si el equipo queda encendido todo el turno.
    const id = setInterval(recargar, 10 * 60 * 1000)
    return () => clearInterval(id)
  }, [recargar])

  const setVista = (v: VistaMoneda) => {
    localStorage.setItem(CLAVE_VISTA, v)
    setVistaState(v)
  }

  const fmt = (usd: number | null | undefined, decimales?: number) => {
    if (usd === null || usd === undefined) return '—'
    const d = decimales ?? 2
    switch (vista) {
      case 'bs':
        // Sin tasa no se convierte: mostrar un numero en dolares bajo etiqueta
        // de bolivares seria mentir sobre la cifra que el cliente va a pagar.
        return tasa?.bcv ? fmtBs(usd * tasa.bcv, 2) : '…'
      case 'usd_calle':
        return tasa?.bcv && tasa?.paralelo
          ? `$${((usd * tasa.bcv) / tasa.paralelo).toFixed(d)}`
          : '…'
      default:
        return `$${usd.toFixed(d)}`
    }
  }

  return (
    <MonedaCtx.Provider value={{ vista, setVista, tasa, fmt, sufijo: SUFIJOS[vista], recargar }}>
      {children}
    </MonedaCtx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useMoneda = () => useContext(MonedaCtx)

/**
 * Selector de vista cambiaria para la barra superior. Un solo control que dice
 * en que moneda estas viendo los montos y a que tasa, y al abrirlo muestra las
 * tres vistas con la tasa de cada una.
 */
export function MonedaToggle({ dark = false }: { dark?: boolean }) {
  const { vista, setVista, tasa } = useMoneda()
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false)
    }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', escape)
    }
  }, [abierto])

  const opciones: {
    k: VistaMoneda
    simbolo: string
    nombre: string
    detalleTasa: string | null
    ayuda: string
    lista: boolean
  }[] = [
    {
      k: 'usd',
      simbolo: '$',
      nombre: 'Dolares',
      detalleTasa: null,
      ayuda: 'Los precios tal como estan en el menu.',
      lista: true,
    },
    {
      k: 'bs',
      simbolo: 'Bs',
      nombre: 'Bolivares',
      detalleTasa: tasa?.bcv ? `tasa ${fmtNum(tasa.bcv)}` : null,
      ayuda: 'Lo que el cliente paga en efectivo o pago movil.',
      lista: !!tasa?.bcv,
    },
    {
      k: 'usd_calle',
      simbolo: '$',
      nombre: 'Dolares a paralelo',
      detalleTasa: tasa?.paralelo
        ? `${fmtNum(tasa.paralelo)}${tasa.brecha_pct != null ? ` · brecha ${tasa.brecha_pct}%` : ''}`
        : null,
      ayuda: 'Lo que valen esos bolivares comprando divisas en la calle.',
      lista: !!(tasa?.bcv && tasa?.paralelo),
    },
  ]
  const activa = opciones.find((o) => o.k === vista) ?? opciones[0]

  return (
    <div ref={caja} className="relative">
      <button
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-haspopup="menu"
        title="Elegir en que moneda ver todos los montos"
        className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
          dark
            ? 'border-neutral-700 text-neutral-300 hover:border-neutral-500'
            : 'border-neutral-200 text-neutral-600 hover:border-neutral-400'
        }`}
      >
        {tasa?.en_vivo && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
            title="Conectado al BCV y a Binance P2P"
          />
        )}
        <span className={dark ? 'text-white' : 'text-neutral-900'}>{activa.simbolo}</span>
        <span className="hidden sm:inline">{activa.nombre}</span>
        {activa.detalleTasa && (
          <span className="hidden md:inline opacity-60 tabular-nums">· {activa.detalleTasa}</span>
        )}
        <span aria-hidden className={`transition ${abierto ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>

      {abierto && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-1.5 w-72 overflow-hidden rounded-xl border border-neutral-200 bg-white text-neutral-900 shadow-xl"
        >
          <div className="border-b border-neutral-100 px-3.5 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Ver todos los montos como
          </div>
          {opciones.map((o) => (
            <button
              key={o.k}
              role="menuitemradio"
              aria-checked={vista === o.k}
              disabled={!o.lista}
              onClick={() => {
                setVista(o.k)
                setAbierto(false)
              }}
              className={`flex w-full items-start gap-3 px-3.5 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
                vista === o.k ? 'bg-neutral-50' : 'hover:bg-neutral-50'
              }`}
            >
              <span
                className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${
                  vista === o.k ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-500'
                }`}
              >
                {o.simbolo}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">{o.nombre}</span>
                  {o.detalleTasa && (
                    <span className="text-[11px] tabular-nums text-neutral-400">{o.detalleTasa}</span>
                  )}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-neutral-500">
                  {o.ayuda}
                </span>
              </span>
              {vista === o.k && <span className="mt-1 text-neutral-900">✓</span>}
            </button>
          ))}
          <div className="flex items-center justify-between gap-2 border-t border-neutral-100 px-3.5 py-2 text-[10px] text-neutral-400">
            <span>
              {tasa?.en_vivo
                ? 'Fuente real · bcv.org.ve y Binance P2P'
                : tasa?.origen === 'manual'
                  ? 'Tasa cargada a mano'
                  : 'Sin conexion a las fuentes'}
            </span>
            <a href="/tasa" className="font-medium text-blue-600">
              Gestionar
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
