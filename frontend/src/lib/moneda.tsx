import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api'
import type { EstadoTasa } from './types'
import { useAnchoDeTelefono } from './desplegable'

/**
 * Vista cambiaria de toda la app. Portado del modulo cambiario de Vertigo
 * Flanco y recortado a lo que un restaurante necesita.
 *
 * Los precios viven en USD en la base (fuente de verdad: no se mueven cuando
 * se mueve la tasa). Esto decide como se MUESTRAN, y en Venezuela eso no es un
 * interruptor de dos posiciones:
 *
 *  - bs        -> bolivares a la tasa vigente. Es lo que el cliente paga.
 *  - usd       -> el dolar oficial: los precios tal como estan en el menu.
 *  - usd_calle -> lo que valen de verdad esos bolivares si hoy compras divisas
 *                 al paralelo: USD x (tasa / paralelo). Con 12% de brecha,
 *                 $100 cobrados en Bs son ~$89 reales. Es la vista que dice si
 *                 el margen del menu es real o se lo comio la brecha.
 *  - eur       -> al euro oficial: USD x (tasa / euro). OJO: el euro del BCV
 *                 NO es el dolar pasado por el cruce EUR/USD -- el banco lo
 *                 fija aparte y da distinto (841,03 derivado contra 840,86
 *                 publicado). Por eso se lee del BCV y no se calcula.
 */
export type VistaMoneda = 'usd' | 'bs' | 'usd_calle' | 'eur'

const SUFIJOS: Record<VistaMoneda, string> = {
  usd: 'USD',
  bs: 'Bs',
  usd_calle: 'USD calle',
  eur: 'EUR',
}

const CLAVE_VISTA = 'erp-vista-moneda'

type Ctx = {
  vista: VistaMoneda
  setVista: (v: VistaMoneda) => void
  tasa: EstadoTasa | null
  /** Convierte un monto en USD a la vista elegida y lo formatea. */
  fmt: (usd: number | null | undefined, decimales?: number) => string
  /**
   * Igual que `fmt`, pero para montos historicos: usa la tasa a la que se
   * cobro ese pedido, no la de hoy. Sin esto el reporte en bolivares del mes
   * pasado se movia solo cada vez que subia el dolar.
   */
  fmtCongelado: (
    usd: number | null | undefined,
    tasaCongelada: number | null | undefined,
    decimales?: number,
  ) => string
  sufijo: string
  recargar: () => void
}

const MonedaCtx = createContext<Ctx>({
  vista: 'usd',
  setVista: () => {},
  tasa: null,
  fmt: (v) => `$${(v ?? 0).toFixed(2)}`,
  fmtCongelado: (v) => `$${(v ?? 0).toFixed(2)}`,
  sufijo: 'USD',
  recargar: () => {},
})

/**
 * El signo MENOS delante del simbolo, no entre el simbolo y el numero.
 *
 * `$-4.42` se lee como un precio raro y hay que releerlo para entender que es
 * negativo; `-$4.42` se lee de una. Importa donde mas duele: "Ganancia neta"
 * en rojo, un faltante de caja, una gaveta sobregirada.
 */
function conSigno(simbolo: string, valor: number, cuerpo: string) {
  return valor < 0 ? `−${simbolo}${cuerpo}` : `${simbolo}${cuerpo}`
}

export function fmtBs(bs: number, decimales = 2) {
  return conSigno(
    'Bs ',
    bs,
    Math.abs(bs).toLocaleString('es-VE', {
      minimumFractionDigits: decimales,
      maximumFractionDigits: decimales,
    }),
  )
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
    return guardada === 'bs' || guardada === 'usd_calle' || guardada === 'eur' ? guardada : 'usd'
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

  // `tasaBase` permite pasar la tasa congelada de un pedido viejo; si no se
  // pasa ninguna se usa la vigente, que es lo correcto para precios de menu.
  const formatear = (
    usd: number | null | undefined,
    decimales: number | undefined,
    tasaBase: number | null | undefined,
  ) => {
    if (usd === null || usd === undefined) return '—'
    const d = decimales ?? 2
    const bcv = tasaBase ?? tasa?.bcv
    switch (vista) {
      case 'bs':
        // Sin tasa no se convierte: mostrar un numero en dolares bajo etiqueta
        // de bolivares seria mentir sobre la cifra que el cliente va a pagar.
        return bcv ? fmtBs(usd * bcv, 2) : '…'
      case 'usd_calle': {
        if (!bcv || !tasa?.paralelo) return '…'
        const v = (usd * bcv) / tasa.paralelo
        return conSigno('$', v, Math.abs(v).toFixed(d))
      }
      case 'eur': {
        // Se pasa por bolivares a proposito: el precio vale lo que vale en Bs,
        // y el euro dice cuantos euros son esos bolivares al cambio oficial.
        if (!bcv || !tasa?.eur) return '…'
        const v = (usd * bcv) / tasa.eur
        return conSigno('€', v, Math.abs(v).toFixed(d))
      }
      default:
        return conSigno('$', usd, Math.abs(usd).toFixed(d))
    }
  }

  const fmt = (usd: number | null | undefined, decimales?: number) =>
    formatear(usd, decimales, null)

  const fmtCongelado = (
    usd: number | null | undefined,
    tasaCongelada: number | null | undefined,
    decimales?: number,
  ) => formatear(usd, decimales, tasaCongelada)

  return (
    <MonedaCtx.Provider
      value={{ vista, setVista, tasa, fmt, fmtCongelado, sufijo: SUFIJOS[vista], recargar }}
    >
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
  const enTelefono = useAnchoDeTelefono(caja, abierto)

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

  // EL ORDEN ES EL DE LA CAJA, no el del sistema: primero en lo que se cobra
  // (bolivares), despues los dolares oficial y de calle, y el euro al final,
  // que es el que menos se toca.
  const opciones: {
    k: VistaMoneda
    simbolo: string
    nombre: string
    detalleTasa: string | null
    /** Solo dentro del menu: la pastilla cerrada tiene que quedar corta. */
    variacion?: string | null
    ayuda: string
    lista: boolean
  }[] = [
    {
      k: 'bs',
      simbolo: 'Bs',
      nombre: 'Bolívares',
      detalleTasa: tasa?.bcv ? `tasa ${fmtNum(tasa.bcv)}` : null,
      ayuda: 'Lo que el cliente paga en efectivo o pago móvil.',
      lista: !!tasa?.bcv,
    },
    {
      k: 'usd',
      simbolo: '$',
      nombre: 'Dólares BCV',
      detalleTasa: tasa?.bcv ? fmtNum(tasa.bcv) : null,
      // Si el dolar se movio esta semana es LA pregunta al poner precios, y
      // este menu se abre veinte veces al dia: se responde aqui y no solo en
      // la pantalla de Tasa, que casi nadie abre.
      variacion:
        tasa?.variacion_semana_pct != null && tasa.variacion_semana_pct !== 0
          ? `${tasa.variacion_semana_pct > 0 ? '+' : ''}${tasa.variacion_semana_pct}% en 7 días`
          : null,
      ayuda: 'Los precios tal como están en el menú, al dólar oficial.',
      lista: true,
    },
    {
      k: 'usd_calle',
      simbolo: '$',
      nombre: 'Dólares Paralelo',
      detalleTasa: tasa?.paralelo
        ? `${fmtNum(tasa.paralelo)}${tasa.brecha_pct != null ? ` · brecha ${tasa.brecha_pct}%` : ''}`
        : null,
      ayuda: 'Lo que valen esos bolívares comprando divisas en la calle.',
      lista: !!(tasa?.bcv && tasa?.paralelo),
    },
    {
      k: 'eur',
      simbolo: '€',
      nombre: 'Euro BCV',
      detalleTasa: tasa?.eur ? fmtNum(tasa.eur) : null,
      ayuda: 'Al euro oficial. El BCV lo fija aparte: no es el dólar convertido.',
      lista: !!(tasa?.bcv && tasa?.eur),
    },
  ]
  const activa = opciones.find((o) => o.k === vista) ?? opciones[0]

  return (
    <div ref={caja} className="relative">
      <button
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        aria-haspopup="menu"
        title="Elegir en qué moneda ver todos los montos"
        className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
          dark
            ? 'border-neutral-700 text-neutral-300 hover:border-neutral-500'
            : 'border-neutral-200 text-neutral-600 hover:border-neutral-400'
        }`}
      >
        {/* El punto solo se pone verde si de verdad hubo contacto hace poco.
            Antes se quedaba verde con dias sin internet, porque preguntaba por
            un cache que nunca olvida el ultimo valor bueno. */}
        {tasa?.en_vivo ? (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-exito-500"
            title="Conectado al BCV y a Binance P2P"
          />
        ) : tasa?.bcv ? (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-aviso-500"
            title={
              tasa.minutos_sin_contacto == null
                ? 'Sin contacto con las fuentes: la tasa puede estar vieja'
                : `Sin internet hace ${Math.round(tasa.minutos_sin_contacto)} min: la tasa puede estar vieja`
            }
          />
        ) : null}
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
          style={enTelefono}
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
                  {/* Que suba el dolar encarece reponer: se marca como aviso,
                      no como algo bueno. */}
                  {o.variacion && (
                    <span
                      className={`text-[11px] tabular-nums ${
                        o.variacion.startsWith('+') ? 'text-aviso-600' : 'text-exito-600'
                      }`}
                    >
                      {o.variacion}
                    </span>
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
                  : tasa?.minutos_sin_contacto != null
                    ? `Sin internet hace ${Math.round(tasa.minutos_sin_contacto)} min · se sigue usando la última tasa`
                    : 'Sin conexión a las fuentes'}
            </span>
            <a href="/tasa" className="font-medium text-acento-600">
              Gestionar
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
