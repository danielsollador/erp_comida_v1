import * as SecureStore from 'expo-secure-store'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from './api'
import { miles } from './formato'
import type { EstadoTasa } from './tipos'

/**
 * EN QUE MONEDA SE MIRAN LOS MONTOS, como el selector de la web
 * (frontend/src/lib/moneda.tsx): todo se guarda en dolares BCV y se muestra
 * en la vista elegida con la tasa del dia. Las mismas cuatro vistas y el
 * mismo formato: "$113.30" en dolares, "Bs 98.535,95" en bolivares.
 */
export type VistaMoneda = 'usd' | 'bs' | 'usd_calle' | 'eur'

export const VISTAS: { id: VistaMoneda; nombre: string; detalle: string }[] = [
  { id: 'usd', nombre: 'Dólares BCV', detalle: 'Lo que dice el sistema' },
  { id: 'bs', nombre: 'Bolívares', detalle: 'A la tasa BCV de hoy' },
  { id: 'usd_calle', nombre: 'Dólares calle', detalle: 'Convertidos a la tasa paralela' },
  { id: 'eur', nombre: 'Euros', detalle: 'A la tasa BCV del euro' },
]

const CLAVE = 'erp-vista-moneda'

type Ctx = {
  vista: VistaMoneda
  setVista: (v: VistaMoneda) => void
  tasa: EstadoTasa | null
  fmt: (usd: number | null | undefined, decimales?: number) => string
  recargar: () => void
}

const Contexto = createContext<Ctx | null>(null)

/** El signo menos delante del simbolo: "−$4.42", no "$-4.42" (como la web). */
function conSigno(simbolo: string, valor: number, cuerpo: string) {
  return valor < 0 ? `−${simbolo}${cuerpo}` : `${simbolo}${cuerpo}`
}

export function fmtBs(bs: number, decimales = 2) {
  return conSigno('Bs ', bs, miles(Math.abs(bs), decimales))
}

export function MonedaProvider({ children, activa }: { children: ReactNode; activa: boolean }) {
  const [vista, setVistaEstado] = useState<VistaMoneda>('usd')
  const [tasa, setTasa] = useState<EstadoTasa | null>(null)

  useEffect(() => {
    SecureStore.getItemAsync(CLAVE)
      .then((v) => {
        if (v === 'bs' || v === 'usd_calle' || v === 'eur' || v === 'usd') setVistaEstado(v)
      })
      .catch(() => undefined)
  }, [])

  const recargar = useCallback(() => {
    api.tasa().then(setTasa).catch(() => setTasa(null))
  }, [])

  // La tasa se pide solo con sesion; y cada 10 minutos, como la web.
  useEffect(() => {
    if (!activa) return
    recargar()
    const id = setInterval(recargar, 10 * 60 * 1000)
    return () => clearInterval(id)
  }, [activa, recargar])

  const setVista = useCallback((v: VistaMoneda) => {
    setVistaEstado(v)
    SecureStore.setItemAsync(CLAVE, v).catch(() => undefined)
  }, [])

  const fmt = useCallback(
    (usd: number | null | undefined, decimales?: number) => {
      if (usd === null || usd === undefined) return '—'
      const d = decimales ?? 2
      const bcv = tasa?.bcv
      switch (vista) {
        case 'bs':
          return bcv ? fmtBs(usd * bcv, 2) : '…'
        case 'usd_calle': {
          if (!bcv || !tasa?.paralelo) return '…'
          const v = (usd * bcv) / tasa.paralelo
          return conSigno('$', v, Math.abs(v).toFixed(d))
        }
        case 'eur': {
          if (!bcv || !tasa?.eur) return '…'
          const v = (usd * bcv) / tasa.eur
          return conSigno('€', v, Math.abs(v).toFixed(d))
        }
        default:
          return conSigno('$', usd, Math.abs(usd).toFixed(d))
      }
    },
    [vista, tasa],
  )

  const valor = useMemo(() => ({ vista, setVista, tasa, fmt, recargar }), [vista, setVista, tasa, fmt, recargar])
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

export function useMoneda(): Ctx {
  const c = useContext(Contexto)
  if (!c) throw new Error('useMoneda fuera de MonedaProvider')
  return c
}
