import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Categoria, Ingrediente } from '../lib/types'
import { Boton, Modal } from './ui'

/**
 * Una mercancía de reventa (el refresco) pasa al menú de una vez: su producto,
 * su precio y su receta de 1 unidad. Antes eran dos cosas que alguien tenía
 * que unir a mano, nadie lo hacía, y vender una Pepsi no descontaba la Pepsi.
 */
export default function VenderEnMenu({
  mercancia,
  onHecho,
  onCerrar,
}: {
  mercancia: Ingrediente
  onHecho: () => void
  onCerrar: () => void
}) {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [categoriaId, setCategoriaId] = useState(0)
  const [nombre, setNombre] = useState(mercancia.nombre)
  const [precio, setPrecio] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .listarCategorias()
      .then((cs) => {
        const activas = cs.filter((c) => c.activo !== false)
        setCategorias(activas)
        // Lo que se vende tal cual suele ir con las bebidas.
        setCategoriaId((activas.find((c) => c.bebida) ?? activas[0])?.id ?? 0)
      })
      .catch(() => setError('No se pudieron traer las categorías del menú.'))
  }, [])

  const precioNum = Number(precio.replace(',', '.'))
  const margen = precioNum > 0 ? Math.round(((precioNum - (mercancia.costo_unitario || 0)) / precioNum) * 100) : null

  async function crear() {
    setError('')
    if (!categoriaId) return setError('Elige en qué categoría del menú va.')
    if (!(precioNum > 0)) return setError('Ponle precio de venta.')
    setGuardando(true)
    try {
      await api.productoDesdeMercancia(mercancia.id, { categoria_id: categoriaId, precio: precioNum, nombre: nombre.trim() })
      onHecho()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear')
    } finally {
      setGuardando(false)
    }
  }

  const clase = 'w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm'
  const rotulo = 'block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1'
  return (
    <Modal
      titulo="Venderla en el menú"
      onCerrar={onCerrar}
      ancho="sm"
      pie={
        <>
          <Boton tono="suave" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton onClick={() => void crear()} disabled={guardando}>
            {guardando ? 'Creando…' : 'Agregar al menú'}
          </Boton>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-neutral-600">
          Se crea el producto con su receta de 1 {mercancia.unidad}: cada venta descuenta una del depósito.
        </p>
        <label className="block">
          <span className={rotulo}>Nombre en el menú</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} className={clase} />
        </label>
        <label className="block">
          <span className={rotulo}>Categoría</span>
          <select value={categoriaId} onChange={(e) => setCategoriaId(Number(e.target.value))} className={clase}>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={rotulo}>Precio de venta ($)</span>
          <input value={precio} onChange={(e) => setPrecio(e.target.value)} inputMode="decimal" placeholder="0.00" className={clase} />
          {margen !== null && (
            <span className={`block text-xs mt-1 ${margen < 0 ? 'text-peligro-600' : 'text-neutral-500'}`}>
              Cuesta ${(mercancia.costo_unitario || 0).toFixed(2)}: {margen < 0 ? 'lo venderías a pérdida' : `te deja ${margen} %`}.
            </span>
          )}
        </label>
        {error && <p className="text-peligro-600">{error}</p>}
      </div>
    </Modal>
  )
}
