import { useState } from 'react'
import { api } from '../lib/api'
import type { CambioPropuesto, PropuestaPrecios } from '../lib/api'
import { useMoneda } from '../lib/moneda'
import { useDeshacer } from './Deshacer'
import { Aviso, Boton, Modal } from './ui'

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

  return (
    <Modal
      titulo="Cambiar precios"
      ayuda="Dilo como se lo dirías a alguien de tu equipo. Antes de guardar ves cómo queda cada precio."
      onCerrar={onCerrar}
      ancho="lg"
      pie={
        cambios.length > 0 ? (
          <div className="flex flex-wrap gap-2">
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
              placeholder="Ej.: sube 10% las empanadas menos la de queso"
              aria-label="Qué precios cambiar"
              className="w-full min-h-11 rounded-xl border border-neutral-300 bg-white px-3 py-2.5 text-[15px]"
            />
            <div className="flex flex-wrap gap-2">
              {EJEMPLOS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setTexto(e)}
                  className="min-h-9 rounded-full bg-neutral-500/8 px-3 text-[13px] text-neutral-700 active:bg-neutral-500/15"
                >
                  {e}
                </button>
              ))}
            </div>
            <Boton type="submit" className="min-h-11 w-full" disabled={!texto.trim() || pensando}>
              {pensando ? 'Armando la lista…' : 'Ver cómo quedan'}
            </Boton>
          </form>
        )}

        {error && <Aviso>{error}</Aviso>}

        {propuesta && (
          <div className="space-y-3">
            <p className="text-[15px] text-neutral-700">
              <span className="text-neutral-500">Pediste: </span>
              {texto}
            </p>
            <p className="text-[15px]">
              <span className="text-neutral-500">Entendí: </span>
              {propuesta.entendi}
            </p>
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
              <ul className="divide-y divide-neutral-200/70 rounded-2xl bg-white">
                {cambios.map((c) => {
                  const pct = ((c.precio_nuevo - c.precio_anterior) / c.precio_anterior) * 100
                  return (
                    <li key={c.variante_id} className="flex items-center gap-3 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-medium">{c.nombre}</p>
                        <p className="text-[13px] text-neutral-500">{c.categoria}</p>
                      </div>
                      <p className="text-right tabular-nums">
                        <span className="text-[13px] text-neutral-500 line-through">{fmt(c.precio_anterior)}</span>{' '}
                        <span className="text-[15px] font-semibold">{fmt(c.precio_nuevo)}</span>
                        <span className={`block text-[12px] ${pct >= 0 ? 'text-neutral-500' : 'text-aviso-700'}`}>
                          {pct >= 0 ? '+' : ''}
                          {pct.toFixed(1).replace('.', ',')}%
                        </span>
                      </p>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
