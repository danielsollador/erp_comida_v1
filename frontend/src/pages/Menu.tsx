import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import { api } from '../lib/api'
import type { Categoria } from '../lib/types'

export default function Menu() {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [nuevaCategoria, setNuevaCategoria] = useState('')

  useEffect(() => {
    cargar()
  }, [])

  function cargar() {
    api.listarCategorias().then(setCategorias)
  }

  async function agregarCategoria() {
    if (!nuevaCategoria.trim()) return
    await api.crearCategoria(nuevaCategoria.trim(), categorias.length)
    setNuevaCategoria('')
    cargar()
  }

  async function borrarCategoria(id: number) {
    if (!window.confirm('Esto borra la categoria y todos sus productos. Continuar?')) return
    await api.eliminarCategoria(id)
    cargar()
  }

  return (
    <div className="min-h-screen bg-neutral-100">
      <NavBar titulo="Menu" />
      <div className="p-4 max-w-2xl mx-auto space-y-6">
        {categorias.map((cat) => (
          <CategoriaCard key={cat.id} categoria={cat} onCambio={cargar} onBorrar={borrarCategoria} />
        ))}

        <div className="bg-white rounded-2xl shadow p-4 flex gap-2">
          <input
            value={nuevaCategoria}
            onChange={(e) => setNuevaCategoria(e.target.value)}
            placeholder="Nueva categoria (ej. Bebidas)"
            className="flex-1 border border-neutral-300 rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={agregarCategoria}
            className="bg-neutral-900 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Agregar
          </button>
        </div>
      </div>
    </div>
  )
}

function CategoriaCard({
  categoria,
  onCambio,
  onBorrar,
}: {
  categoria: Categoria
  onCambio: () => void
  onBorrar: (id: number) => void
}) {
  const [nuevoProducto, setNuevoProducto] = useState('')

  async function agregarProducto() {
    if (!nuevoProducto.trim()) return
    await api.crearProducto(categoria.id, nuevoProducto.trim(), [{ nombre: 'Regular', precio: 0 }])
    setNuevoProducto('')
    onCambio()
  }

  return (
    <div className="bg-white rounded-2xl shadow p-4">
      <div className="flex justify-between items-center mb-3">
        <h2 className="font-semibold text-lg">{categoria.nombre}</h2>
        <button onClick={() => onBorrar(categoria.id)} className="text-red-500 text-xs">
          Borrar categoria
        </button>
      </div>

      <div className="space-y-3">
        {categoria.productos.map((producto) => (
          <ProductoRow key={producto.id} producto={producto} onCambio={onCambio} />
        ))}
      </div>

      <div className="flex gap-2 mt-3">
        <input
          value={nuevoProducto}
          onChange={(e) => setNuevoProducto(e.target.value)}
          placeholder="Nuevo producto (ej. Empanada)"
          className="flex-1 border border-neutral-300 rounded-lg px-3 py-1.5 text-sm"
        />
        <button
          onClick={agregarProducto}
          className="bg-neutral-100 hover:bg-neutral-200 px-3 py-1.5 rounded-lg text-sm"
        >
          + Producto
        </button>
      </div>
    </div>
  )
}

function ProductoRow({
  producto,
  onCambio,
}: {
  producto: Categoria['productos'][number]
  onCambio: () => void
}) {
  const [nuevaVariante, setNuevaVariante] = useState('')
  const [nuevoPrecio, setNuevoPrecio] = useState('')

  async function agregarVariante() {
    const precio = Number(nuevoPrecio)
    if (!nuevaVariante.trim() || !Number.isFinite(precio) || precio < 0) return
    await api.crearVariante(producto.id, nuevaVariante.trim(), precio)
    setNuevaVariante('')
    setNuevoPrecio('')
    onCambio()
  }

  async function cambiarPrecio(varianteId: number, nombre: string, precioActual: number) {
    const texto = window.prompt(`Nuevo precio para ${nombre}`, String(precioActual))
    if (texto === null) return
    const precio = Number(texto)
    if (!Number.isFinite(precio) || precio < 0) return
    await api.actualizarVariante(varianteId, nombre, precio)
    onCambio()
  }

  async function borrarVariante(varianteId: number) {
    await api.eliminarVariante(varianteId)
    onCambio()
  }

  async function borrarProducto() {
    if (!window.confirm(`Quitar "${producto.nombre}" del menu?`)) return
    await api.eliminarProducto(producto.id)
    onCambio()
  }

  return (
    <div className="border border-neutral-200 rounded-xl p-3">
      <div className="flex justify-between items-center mb-2">
        <span className="font-medium">{producto.nombre}</span>
        <button onClick={borrarProducto} className="text-red-500 text-xs">
          Quitar
        </button>
      </div>
      <div className="flex flex-wrap gap-2 mb-2">
        {producto.variantes.map((v) => (
          <span
            key={v.id}
            className="bg-neutral-100 rounded-full px-3 py-1 text-xs flex items-center gap-2"
          >
            <button onClick={() => cambiarPrecio(v.id, v.nombre, v.precio)}>
              {v.nombre === 'Regular' && producto.variantes.length === 1
                ? `$${v.precio.toFixed(2)}`
                : `${v.nombre}: $${v.precio.toFixed(2)}`}
            </button>
            {producto.variantes.length > 1 && (
              <button onClick={() => borrarVariante(v.id)} className="text-red-400">
                x
              </button>
            )}
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={nuevaVariante}
          onChange={(e) => setNuevaVariante(e.target.value)}
          placeholder="Subseccion (ej. Grande)"
          className="flex-1 border border-neutral-300 rounded-lg px-2 py-1 text-xs"
        />
        <input
          value={nuevoPrecio}
          onChange={(e) => setNuevoPrecio(e.target.value)}
          placeholder="Precio"
          type="number"
          step="0.01"
          className="w-20 border border-neutral-300 rounded-lg px-2 py-1 text-xs"
        />
        <button
          onClick={agregarVariante}
          className="bg-neutral-100 hover:bg-neutral-200 px-2 py-1 rounded-lg text-xs"
        >
          + Subseccion
        </button>
      </div>
    </div>
  )
}
