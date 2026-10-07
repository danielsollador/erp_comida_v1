import { useMemo, useState } from 'react'
import { api } from '../lib/api'
import { parecidos } from '../lib/parecidos'
import type { Ingrediente } from '../lib/types'
import { Boton, Modal } from './ui'

/**
 * Fundir una mercancía duplicada en la que se queda.
 *
 * Pasa a la que queda lo vivo: el stock (al costo de la que se va, así que el
 * depósito vale lo mismo), las recetas y lo aprendido de los proveedores. La
 * que se va queda archivada con su historia intacta (ver el endpoint
 * `fusionar` en el backend).
 *
 * Primero salen las parecidas: casi siempre la gemela está ahí.
 */
export default function FusionarMercancia({
  origen,
  ingredientes,
  onHecho,
  onCerrar,
}: {
  origen: Ingrediente
  ingredientes: Ingrediente[]
  onHecho: (destino: Ingrediente) => void
  onCerrar: () => void
}) {
  const otras = useMemo(() => ingredientes.filter((i) => i.activo && i.id !== origen.id), [ingredientes, origen.id])
  const sugeridas = useMemo(() => parecidos(origen.nombre, otras).map((x) => x.ing), [origen.nombre, otras])
  const resto = useMemo(
    () => otras.filter((i) => !sugeridas.some((s) => s.id === i.id)).sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [otras, sugeridas],
  )
  const [destinoId, setDestinoId] = useState<number>(sugeridas[0]?.id ?? 0)
  const [factor, setFactor] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const destino = otras.find((i) => i.id === destinoId)
  const otraUnidad = !!destino && destino.unidad !== origen.unidad
  const factorNum = otraUnidad ? Number(factor.replace(',', '.')) : 1
  const stock = origen.stock_actual || 0
  const fmt = (n: number) => n.toLocaleString('es-VE', { maximumFractionDigits: 3 })

  async function fundir() {
    setError('')
    if (!destino) return setError('Elige con cuál se queda.')
    if (!(factorNum > 0)) return setError(`Di cuántos ${destino.unidad} trae 1 ${origen.unidad}.`)
    setGuardando(true)
    try {
      onHecho(await api.fusionarIngrediente(origen.id, destino.id, factorNum))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo fusionar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      titulo={`Fusionar «${origen.nombre}»`}
      onCerrar={onCerrar}
      ancho="sm"
      pie={
        <>
          <Boton tono="suave" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton onClick={() => void fundir()} disabled={guardando || !destino}>
            {guardando ? 'Fusionando…' : 'Fusionar'}
          </Boton>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-neutral-600">
          Para cuando dos fichas son la misma mercancía. Esta se archiva y la otra se queda con su stock, sus recetas y lo
          que se aprendió de los proveedores. Las compras y movimientos viejos no cambian.
        </p>
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">Se queda</span>
          <select
            value={destinoId}
            onChange={(e) => {
              setDestinoId(Number(e.target.value))
              setFactor('')
            }}
            className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value={0}>Elige la mercancía…</option>
            {sugeridas.length > 0 && (
              <optgroup label="Parecidas">
                {sugeridas.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.nombre} ({i.unidad})
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label="Todas">
              {resto.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.nombre} ({i.unidad})
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        {otraUnidad && destino && (
          <label className="block">
            <span className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">
              ¿Cuántos {destino.unidad} trae 1 {origen.unidad}?
            </span>
            <input
              value={factor}
              onChange={(e) => setFactor(e.target.value)}
              inputMode="decimal"
              placeholder={destino.unidad === 'kg' ? 'Ej. 0,25 (una lata de 250 g)' : 'Ej. 1'}
              className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
            />
          </label>
        )}
        {destino && factorNum > 0 && (
          <p className="rounded-lg bg-neutral-50 px-3 py-2 text-neutral-700">
            {stock
              ? `Pasan ${fmt(stock)} ${origen.unidad}${otraUnidad ? ` (= ${fmt(stock * factorNum)} ${destino.unidad})` : ''} a ${destino.nombre}.`
              : `${origen.nombre} no tiene stock: solo pasan sus recetas y la memoria de proveedores.`}
          </p>
        )}
        {error && <p className="text-peligro-600">{error}</p>}
      </div>
    </Modal>
  )
}
