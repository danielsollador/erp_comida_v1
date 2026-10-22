import { useState } from 'react'
import { Aviso, Boton, Modal } from './ui'
import { api } from '../lib/api'
import { useMoneda } from '../lib/moneda'
import type { BorradorWhatsApp } from '../lib/types'

/**
 * Pegar el mensaje de WhatsApp de un cliente y que quede la comanda armada
 * (22-oct). Dos pasos: pegar y revisar. No crea el pedido: «Pasar a la
 * comanda» carga los renglones en la comanda actual, donde se revisan y se
 * mandan a cocina como cualquier otro (ver backend/app/pedido_whatsapp.py).
 */
export type RenglonElegido = { variante_id: number; cantidad: number }

export default function PedidoDeWhatsApp({
  onCerrar,
  onCargar,
}: {
  onCerrar: () => void
  onCargar: (renglones: RenglonElegido[], cliente: string) => void
}) {
  const { fmt } = useMoneda()
  const [texto, setTexto] = useState('')
  const [leyendo, setLeyendo] = useState(false)
  const [error, setError] = useState('')
  const [b, setB] = useState<BorradorWhatsApp | null>(null)
  // Lo que la cajera deja: producto y cantidad por renglon (0 = no va).
  const [elegidos, setElegidos] = useState<{ variante_id: number | null; cantidad: number }[]>([])
  const [cliente, setCliente] = useState('')

  const leer = async () => {
    if (!texto.trim()) return
    setLeyendo(true)
    setError('')
    try {
      const r = await api.borradorWhatsApp(texto)
      setB(r)
      setElegidos(r.lineas.map((l) => ({ variante_id: l.variante_id, cantidad: l.cantidad })))
      setCliente(r.cliente)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer el mensaje.')
    } finally {
      setLeyendo(false)
    }
  }

  const listos = elegidos.filter((e) => e.variante_id && e.cantidad > 0) as RenglonElegido[]
  const precioDe = (id: number | null) => b?.lineas.flatMap((l) => l.opciones).find((o) => o.variante_id === id)?.precio ?? 0
  const total = listos.reduce((s, e) => s + precioDe(e.variante_id) * e.cantidad, 0)
  const cambiar = (i: number, cambio: Partial<{ variante_id: number | null; cantidad: number }>) =>
    setElegidos((lista) => lista.map((e, j) => (j === i ? { ...e, ...cambio } : e)))

  if (!b) {
    return (
      <Modal
        titulo="Pedido de WhatsApp"
        onCerrar={onCerrar}
        pie={
          <Boton onClick={() => void leer()} disabled={!texto.trim() || leyendo} ancho>
            {leyendo ? 'Leyendo…' : 'Armar la comanda'}
          </Boton>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-neutral-600">Pega el mensaje del cliente tal como llegó. Lo revisas antes de que vaya a cocina.</p>
          <textarea
            autoFocus
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={7}
            placeholder="Buenas, me mandas 3 empanadas de queso y un jugo, a nombre de Luis…"
            className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-base sm:text-sm focus:outline-none focus:border-acento-400"
          />
          {error && <Aviso tono="mal">{error}</Aviso>}
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      titulo="Revisa el pedido"
      onCerrar={onCerrar}
      pie={
        <div className="flex gap-2 w-full">
          <Boton tono="suave" onClick={() => setB(null)}>
            Volver
          </Boton>
          <Boton onClick={() => onCargar(listos, cliente.trim())} disabled={listos.length === 0} ancho>
            Pasar a la comanda{listos.length ? ` · ${fmt(total)}` : ''}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-500">A nombre de</span>
          <input
            value={cliente}
            onChange={(e) => setCliente(e.target.value)}
            placeholder="¿A nombre de quién?"
            className="rounded-lg border border-neutral-200 bg-white px-3 py-2"
          />
        </label>
        {b.nota && (
          <Aviso tono="info">
            <span className="font-semibold">Dice el cliente: </span>
            {b.nota}
          </Aviso>
        )}
        <ul className="flex flex-col divide-y divide-neutral-500/10">
          {b.lineas.map((l, i) => {
            const e = elegidos[i]
            return (
              <li key={i} className="py-2.5 flex flex-col gap-1.5">
                <span className="text-xs text-neutral-500">«{l.texto}»</span>
                <div className="flex items-center gap-2">
                  <div className="flex items-center rounded-lg border border-neutral-200 shrink-0">
                    <button
                      type="button"
                      aria-label="Uno menos"
                      onClick={() => cambiar(i, { cantidad: Math.max(0, e.cantidad - 1) })}
                      className="w-9 h-9 grid place-items-center text-lg"
                    >
                      −
                    </button>
                    <span className="w-7 text-center tabular-nums font-semibold">{e.cantidad}</span>
                    <button
                      type="button"
                      aria-label="Uno más"
                      onClick={() => cambiar(i, { cantidad: e.cantidad + 1 })}
                      className="w-9 h-9 grid place-items-center text-lg"
                    >
                      +
                    </button>
                  </div>
                  <select
                    value={e.variante_id ?? ''}
                    onChange={(ev) => cambiar(i, { variante_id: ev.target.value ? Number(ev.target.value) : null })}
                    className={`min-w-0 flex-1 rounded-lg border px-2 py-2 text-sm bg-white ${
                      e.variante_id ? 'border-neutral-200' : 'border-aviso-400 bg-aviso-50'
                    }`}
                  >
                    <option value="">{l.opciones.length ? '¿Cuál es? Elige…' : 'No está en el menú: no va'}</option>
                    {l.opciones.map((o) => (
                      <option key={o.variante_id} value={o.variante_id}>
                        {o.nombre} · {fmt(o.precio)}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            )
          })}
        </ul>
        {b.lineas.length === 0 && <p className="text-sm text-neutral-500">No encontré productos del menú en ese mensaje.</p>}
        {elegidos.some((e) => !e.variante_id && e.cantidad > 0) && (
          <p className="text-xs text-aviso-700">Lo que quede sin elegir no se pasa a la comanda.</p>
        )}
      </div>
    </Modal>
  )
}
