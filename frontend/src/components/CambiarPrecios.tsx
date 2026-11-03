import { useState } from 'react'
import { api } from '../lib/api'
import type { CambioPropuesto, PropuestaPrecios } from '../lib/api'
import { useMoneda } from '../lib/moneda'
import { useDeshacer } from './Deshacer'
import { Aviso, Boton, Modal } from './ui'
import { Chispa, Pensando, SelloIA } from './ia'

/**
 * CAMBIAR PRECIOS DICIÉNDOLO (spike de IA, idea 7).
 *
 * Con la inflación los precios se tocan seguido y casi siempre en bloque:
 * "sube 10% las arepas menos la reina". La IA solo traduce QUÉ productos y
 * QUÉ operación; la cuenta la hace el servidor con el precio de hoy. Nada se
 * guarda hasta que el dueño ve la lista de antes y después y toca Aplicar, y
 * después queda el aviso con Deshacer como en el resto del sistema.
 */
const EJEMPLOS = [
  'Sube 10% todas las bebidas',
  'Pon todas las empanadas en 1,80',
  'Sube 0,25 los pastelitos menos el de queso',
]

export default function CambiarPrecios({ onCerrar, onCambio }: { onCerrar: () => void; onCambio: () => void | Promise<void> }) {
  const { fmt } = useMoneda()
  const { deshacible } = useDeshacer()
  const [texto, setTexto] = useState('')
  const [pensando, setPensando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [propuesta, setPropuesta] = useState<PropuestaPrecios | null>(null)

  async function ver(t: string) {
    const instruccion = t.trim()
    if (!instruccion || pensando) return
    setTexto(instruccion)
    setPensando(true)
    setError('')
    setPropuesta(null)
    try {
      setPropuesta(await api.proponerPrecios(instruccion))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo armar la lista')
    } finally {
      setPensando(false)
    }
  }

  async function aplicar(cambios: CambioPropuesto[]) {
    const ida = cambios.map((c) => ({ variante_id: c.variante_id, precio_anterior: c.precio_anterior, precio_nuevo: c.precio_nuevo }))
    const vuelta = cambios.map((c) => ({ variante_id: c.variante_id, precio_anterior: c.precio_nuevo, precio_nuevo: c.precio_anterior }))
    setGuardando(true)
    try {
      // Se guarda AQUÍ y no dentro del aviso: si el precio cambió mientras
      // tanto, el error se lee en este cuadro, no en un aviso que se va solo.
      await api.aplicarPrecios(ida)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se guardaron los precios')
      setGuardando(false)
      return
    }
    onCerrar()
    await onCambio()
    deshacible({
      clave: `precios:${Date.now()}`,
      texto: cambios.length === 1 ? '1 precio cambiado' : `${cambios.length} precios cambiados`,
      ejecutar: async () => undefined,
      revertir: () => api.aplicarPrecios(vuelta),
      alTerminar: () => void onCambio(),
    })
  }

  const cambios = propuesta?.cambios ?? []
  const promedio = cambios.length
    ? cambios.reduce((acc, c) => acc + (c.precio_nuevo - c.precio_anterior) / c.precio_anterior, 0) / cambios.length
    : 0
  const pctTxt = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1).replace('.', ',')}%`

  return (
    <Modal
      titulo="Cambiar precios"
      ayuda="Dilo como se lo dirías a alguien de tu equipo. Antes de guardar ves cómo queda cada precio."
      onCerrar={onCerrar}
      ancho="lg"
      pie={
        cambios.length > 0 ? (
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <Boton tono="suave" className="min-h-11" onClick={() => setPropuesta(null)} disabled={guardando}>
              Cambiar lo que pedí
            </Boton>
            <Boton className="min-h-11 flex-1" onClick={() => void aplicar(cambios)} disabled={guardando}>
              {guardando ? 'Guardando…' : cambios.length === 1 ? 'Aplicar 1 cambio' : `Aplicar ${cambios.length} cambios`}
            </Boton>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {!propuesta && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              void ver(texto)
            }}
          >
            <div className="vp-ia-campo flex items-start gap-3 rounded-2xl bg-white px-3.5 py-3 shadow-[inset_0_0_0_1px_var(--color-neutral-300)] transition-shadow">
              <span className="mt-0.5 text-[var(--vp-acento)]">
                <Chispa tam={20} />
              </span>
              <textarea
                id="instruccion-precios"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void ver(texto)
                  }
                }}
                rows={2}
                autoFocus
                disabled={pensando}
                placeholder="Ej.: sube 10% las empanadas menos la de queso"
                aria-label="Qué precios cambiar"
                className="min-h-11 w-full resize-none bg-transparent text-base outline-none placeholder:text-neutral-400 sm:text-[15px]"
              />
            </div>
            {!pensando && (
              <div className="flex flex-wrap gap-2">
                {EJEMPLOS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setTexto(e)}
                    className="min-h-9 rounded-full bg-[var(--vp-acento-suave)] px-3.5 text-[13px] text-neutral-800 transition-transform active:scale-[.97]"
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
            {pensando ? (
              <div className="space-y-3 pt-1" aria-busy="true">
                <Pensando frases={['Buscando esos productos…', 'Calculando los precios nuevos…']} />
                <ul className="space-y-2" aria-hidden="true">
                  {[0, 1, 2].map((k) => (
                    <li key={k} className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3">
                      <span className="flex-1 space-y-2">
                        <span className="vp-ia-esqueleto block h-3.5 w-2/5 rounded-md" />
                        <span className="vp-ia-esqueleto block h-3 w-1/4 rounded-md" />
                      </span>
                      <span className="vp-ia-esqueleto block h-5 w-20 rounded-md" />
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <Boton type="submit" className="min-h-11 w-full" disabled={!texto.trim()}>
                Ver cómo quedan
              </Boton>
            )}
          </form>
        )}

        {error && <Aviso>{error}</Aviso>}

        {propuesta && (
          <div className="vp-ia-aparecer space-y-3">
            <div className="flex gap-3 rounded-2xl bg-[var(--vp-acento-suave)] px-4 py-3.5">
              <SelloIA tam={30} />
              <div className="min-w-0 text-[15px] leading-normal">
                <p className="text-[13px] text-neutral-500">Pediste «{texto}»</p>
                <p className="mt-0.5 text-neutral-900">
                  <span className="font-medium">Entendí: </span>
                  {propuesta.entendi}
                </p>
              </div>
            </div>
            {propuesta.duda && <Aviso tono="ojo">{propuesta.duda}</Aviso>}
            {cambios.length === 0 && !propuesta.duda && (
              <Aviso tono="info">Con eso ningún precio cambia. Prueba a decirlo de otra forma.</Aviso>
            )}
            {cambios.length === 0 && (
              <Boton tono="suave" className="min-h-11 w-full" onClick={() => setPropuesta(null)}>
                Decirlo de otra forma
              </Boton>
            )}
            {cambios.length > 0 && (
              <>
                <p className="px-1 text-[13px] text-neutral-500">
                  {cambios.length === 1 ? 'Cambia 1 precio' : `Cambian ${cambios.length} precios`}
                  {cambios.length > 1 && (
                    <>
                      {' · en promedio '}
                      <span className="font-medium tabular-nums text-neutral-800">{pctTxt(promedio)}</span>
                    </>
                  )}
                </p>
                <ul className="divide-y divide-neutral-200/70 overflow-hidden rounded-2xl bg-white shadow-[inset_0_0_0_1px_var(--vp-textura)]">
                  {cambios.map((c) => {
                    const pct = (c.precio_nuevo - c.precio_anterior) / c.precio_anterior
                    return (
                      <li key={c.variante_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                        <div className="min-w-0 flex-1 basis-40">
                          <p className="truncate text-[15px] font-medium">{c.nombre}</p>
                          <p className="truncate text-[13px] text-neutral-500">{c.categoria}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 tabular-nums">
                          <span className="text-[13px] text-neutral-500 line-through">{fmt(c.precio_anterior)}</span>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-400" aria-hidden="true">
                            <path d="M5 12h14M13 6l6 6-6 6" />
                          </svg>
                          <span className="text-[16px] font-semibold">{fmt(c.precio_nuevo)}</span>
                          <span
                            className={`min-w-14 rounded-full px-2 py-0.5 text-center text-[12px] font-medium ${
                              pct >= 0 ? 'bg-neutral-100 text-neutral-700' : 'bg-aviso-500/12 text-aviso-800'
                            }`}
                          >
                            {pctTxt(pct)}
                          </span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
