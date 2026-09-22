import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { EstadoApertura } from '../lib/types'
import { Modal } from './ui'
import { Numerico } from './Teclado'
import { useMoneda } from '../lib/moneda'

/**
 * Abrir la caja: contar el fondo antes de empezar a vender.
 *
 * POR QUE ESTA EN EL PUNTO DE VENTA Y NO SOLO EN CAJA. Abrir es lo primero
 * que pasa en el turno y lo hace quien atiende, no quien administra. Si vive
 * en otro módulo, no se hace; y una caja que nunca se abrió arrastra al
 * cierre cualquier error viejo de los libros.
 *
 * QUE RESUELVE DE VERDAD. Fija el punto de partida. Sin él, lo que se espera
 * esta noche sale del saldo contable, que hereda todo lo que pasó antes; con
 * él, el cierre es la resta de un solo día: fondo + lo que entró − lo que
 * salió. Y separa culpas: si la gaveta amaneció con menos, eso pasó antes del
 * turno, y descubrirlo a las once de la noche lo vuelve inseparable de lo que
 * hizo el cajero de hoy.
 *
 * Vive aparte de las dos pantallas porque las dos lo necesitan igual.
 */
// Los billetes que de verdad andan. Lo que no sea un billete entero va en
// "sueltos", asi que una denominacion que falte aqui no impide contar.
const BILLETES_USD = [100, 50, 20, 10, 5, 2, 1]
const BILLETES_BS = [500, 200, 100, 50, 20, 10, 5]

export function useApertura(fecha?: string) {
  const [estado, setEstado] = useState<EstadoApertura | null>(null)

  const recargar = useCallback(() => {
    api
      .estadoDeApertura(fecha)
      .then(setEstado)
      .catch(() => setEstado(null))
  }, [fecha])

  useEffect(() => {
    recargar()
  }, [recargar])

  return { estado, recargar }
}

export function AbrirCaja({
  estado,
  fecha,
  alCerrar,
  alAbrir,
}: {
  estado: EstadoApertura
  fecha?: string
  alCerrar: () => void
  alAbrir: () => void
}) {
  const { tasa } = useMoneda()
  // Por gaveta: cuantos billetes de cada uno, y los sueltos (monedas y lo
  // que no es un billete entero). Se cuenta por billete y no como un total
  // porque un total no se puede volver a contar: si la gaveta amanece
  // distinta, con el desglose se sabe QUE billete falta (Leider, 21-sep).
  const [conteo, setConteo] = useState<Record<string, Record<string, string>>>({})
  const [nota, setNota] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  function poner(metodo: string, clave: string, valor: string) {
    setConteo((c) => ({ ...c, [metodo]: { ...(c[metodo] ?? {}), [clave]: valor } }))
  }

  /** El desglose limpio de una gaveta, y su total. null = no se toco. */
  function desgloseDe(metodo: string): { desglose: Record<string, number>; total: number } | null {
    const filas = conteo[metodo]
    if (!filas) return null
    const desglose: Record<string, number> = {}
    let total = 0
    for (const [clave, texto] of Object.entries(filas)) {
      const n = Number(String(texto).replace(',', '.'))
      if (!texto.trim() || !Number.isFinite(n) || n < 0) continue
      if (n === 0) continue
      desglose[clave] = n
      total += clave === 'sueltos' ? n : Number(clave) * n
    }
    if (Object.keys(desglose).length === 0) return null
    return { desglose, total: Math.round(total * 100) / 100 }
  }

  // Una gaveta sin tocar NO viaja como cero: "no conté esa gaveta" es
  // distinto de "conté y estaba vacía", y la segunda asienta una diferencia.
  const fondos = estado.fondos.flatMap((f) => {
    const d = desgloseDe(f.metodo)
    if (!d) return []
    // La gaveta de bolivares se cuenta en bolivares y se guarda en dolares,
    // que es la moneda de los libros. El desglose se guarda tal como se
    // conto, en su moneda: es para volver a contar, no para sumar.
    const enBs = f.metodo === 'Efectivo Bs'
    if (enBs && !tasa?.bcv) return []
    const fondo = enBs ? Math.round((d.total / (tasa?.bcv ?? 1)) * 100) / 100 : d.total
    return [{ metodo: f.metodo, cuenta: f.cuenta, fondo, desglose: d.desglose }]
  })

  async function abrir() {
    if (fondos.length === 0) return
    setGuardando(true)
    setError('')
    try {
      await api.abrirCaja(fondos, { fecha, nota })
      alAbrir()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir la caja')
      setGuardando(false)
    }
  }

  return (
    <Modal
      titulo="Abrir caja"
      ayuda="Cuenta lo que hay AHORA en cada gaveta. Es el punto de partida del cuadre de esta noche."
      onCerrar={alCerrar}
      pie={
        <div className="flex gap-2">
          <button
            onClick={alCerrar}
            className="flex-1 rounded-xl border border-neutral-300 py-3 text-sm font-medium"
          >
            Cancelar
          </button>
          <button
            onClick={abrir}
            disabled={fondos.length === 0 || guardando}
            className="flex-1 rounded-xl bg-neutral-900 py-3 text-sm font-medium text-white disabled:opacity-30"
          >
            {guardando ? 'Abriendo…' : 'Abrir caja'}
          </button>
        </div>
      }
    >
      {error && <p className="text-peligro-600 text-sm mb-3">{error}</p>}
      <div className="space-y-3">
        {estado.fondos.map((f) => {
          const enBs = f.metodo === 'Efectivo Bs'
          const billetes = enBs ? BILLETES_BS : BILLETES_USD
          const simbolo = enBs ? 'Bs' : '$'
          const d = desgloseDe(f.metodo)
          const filas = conteo[f.metodo] ?? {}
          return (
            <div key={f.metodo} className="rounded-xl border border-neutral-200 p-3">
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <span className="font-medium text-sm">{f.metodo}</span>
                <span className="text-[11px] text-neutral-400">cuántos billetes de cada uno</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {billetes.map((b) => {
                  const n = Number(filas[String(b)] ?? 0) || 0
                  return (
                    <label key={b} className="rounded-lg border border-neutral-200 px-2 py-1.5">
                      <span className="block text-[11px] font-semibold text-neutral-500 tabular-nums">
                        {simbolo} {b}
                      </span>
                      <div className="flex items-baseline gap-1.5">
                        <Numerico
                          entero
                          value={filas[String(b)] ?? ''}
                          onChange={(e) => poner(f.metodo, String(b), e.target.value)}
                          placeholder="0"
                          aria-label={`Billetes de ${simbolo} ${b}`}
                          className="w-full min-w-0 bg-transparent text-base font-semibold tabular-nums outline-none"
                        />
                        {n > 0 && (
                          <span className="text-[11px] text-neutral-400 tabular-nums whitespace-nowrap">
                            = {simbolo} {(n * b).toLocaleString('es-VE')}
                          </span>
                        )}
                      </div>
                    </label>
                  )
                })}
                <label className="rounded-lg border border-dashed border-neutral-300 px-2 py-1.5 col-span-2 sm:col-span-4">
                  <span className="block text-[11px] font-semibold text-neutral-500">
                    Monedas y sueltos ({simbolo})
                  </span>
                  <Numerico
                    value={filas.sueltos ?? ''}
                    onChange={(e) => poner(f.metodo, 'sueltos', e.target.value)}
                    placeholder="0.00"
                    aria-label={`Monedas y sueltos en ${simbolo}`}
                    className="w-full bg-transparent text-base font-semibold tabular-nums outline-none"
                  />
                </label>
              </div>
              <div className="mt-2 flex items-baseline justify-between text-sm">
                <span className="text-neutral-500">Total en la gaveta</span>
                <span className="font-bold tabular-nums">
                  {d ? `${simbolo} ${d.total.toLocaleString('es-VE', { minimumFractionDigits: 2 })}` : '—'}
                </span>
              </div>
              {/* La gaveta de bolívares se cuenta en bolívares, pero el sistema
                  lleva todo en dólares: la conversión va debajo para que nadie
                  la haga de cabeza. */}
              {enBs && d && (
                <p className="mt-0.5 text-right text-xs text-neutral-500 tabular-nums">
                  {tasa?.bcv
                    ? `son $${(d.total / tasa.bcv).toFixed(2)} a la tasa de hoy`
                    : 'sin tasa para convertir'}
                </p>
              )}
            </div>
          )
        })}
      </div>
      {/* Lo que dicen los libros NO se muestra y el campo no viene
          rellenado: si se ve el número esperado, contar deja de ser una
          verificación y pasa a ser copiarlo. */}
      <input
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        placeholder="Nota (opcional): quién abrió, de dónde salió el fondo…"
        className="mt-3 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
      />
    </Modal>
  )
}
