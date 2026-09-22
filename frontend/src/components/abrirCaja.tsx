import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { EstadoApertura } from '../lib/types'
import { Modal } from './ui'
import { Numerico } from './Teclado'
import { fmtBs, useMoneda } from '../lib/moneda'

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
  const [montos, setMontos] = useState<Record<string, string>>({})
  const [nota, setNota] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  // En blanco NO viaja como cero: "no conté esa gaveta" es distinto de
  // "conté y estaba vacía", y la segunda asienta una diferencia.
  const fondos = estado.fondos.flatMap((f) => {
    const escrito = (montos[f.metodo] ?? '').trim()
    if (!escrito) return []
    const fondo = Number(escrito.replace(',', '.'))
    if (!Number.isFinite(fondo) || fondo < 0) return []
    return [{ metodo: f.metodo, cuenta: f.cuenta, fondo }]
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
          const escrito = (montos[f.metodo] ?? '').trim()
          const valor = Number(escrito.replace(',', '.'))
          return (
            <div key={f.metodo} className="rounded-xl border border-neutral-200 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-sm">{f.metodo}</span>
                <span className="text-[11px] text-neutral-400">cuenta los billetes</span>
              </div>
              <Numerico
                value={montos[f.metodo] ?? ''}
                onChange={(e) => setMontos((m) => ({ ...m, [f.metodo]: e.target.value }))}
                placeholder="Cuánto hay en la gaveta"
                className="mt-2 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
              {/* La gaveta de bolívares se cuenta en bolívares, pero el sistema
                  lleva todo en dólares. Se muestra la conversión debajo para
                  que nadie tenga que hacerla de cabeza --y para que se note de
                  una si alguien tecleó los bolívares en el campo de dólares. */}
              {f.metodo === 'Efectivo Bs' && escrito !== '' && Number.isFinite(valor) && (
                <p className="mt-1.5 text-xs text-neutral-500 tabular-nums">
                  {tasa?.bcv
                    ? `son ${fmtBs(valor * tasa.bcv)} a la tasa de hoy`
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
