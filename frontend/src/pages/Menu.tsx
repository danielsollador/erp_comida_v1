import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import { api } from '../lib/api'
import type { Categoria, CostoVariante } from '../lib/types'

export default function Menu() {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [nuevaCategoria, setNuevaCategoria] = useState('')
  // Cuanto cuesta producir cada variante: el precio se fija mirando esto, no a
  // ciegas. Antes se podia poner un precio por debajo del costo sin que nada
  // lo dijera, y la perdida quedaba escondida en el promedio del reporte.
  const [costos, setCostos] = useState<Map<number, CostoVariante>>(new Map())

  useEffect(() => {
    cargar()
  }, [])

  function cargar() {
    api.listarCategorias().then(setCategorias)
    api.costosVariantes().then((cs) => setCostos(new Map(cs.map((c) => [c.variante_id, c]))))
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
          <CategoriaCard
            key={cat.id}
            categoria={cat}
            costos={costos}
            onCambio={cargar}
            onBorrar={borrarCategoria}
          />
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
  costos,
  onCambio,
  onBorrar,
}: {
  categoria: Categoria
  costos: Map<number, CostoVariante>
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
          <ProductoRow
            key={producto.id}
            producto={producto}
            costos={costos}
            onCambio={onCambio}
          />
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
  costos,
  onCambio,
}: {
  producto: Categoria['productos'][number]
  costos: Map<number, CostoVariante>
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
    // El costo va en la pregunta, no despues: es el dato que decide si el
    // precio tiene sentido, y el sistema ya lo tiene.
    const info = costos.get(varianteId)
    const contexto = info?.costo
      ? `\n\nProducirlo cuesta $${info.costo.toFixed(2)}. A $${precioActual.toFixed(2)} te deja ${info.margen_pct?.toFixed(0)}% de margen.`
      : '\n\n(Este producto no tiene receta, asi que no se sabe cuanto cuesta producirlo.)'
    const texto = window.prompt(`Nuevo precio para ${nombre}${contexto}`, String(precioActual))
    if (texto === null) return
    const precio = Number(texto)
    if (!Number.isFinite(precio) || precio < 0) return

    if (info?.costo && precio < info.costo) {
      const perdida = (info.costo - precio).toFixed(2)
      const seguir = window.confirm(
        `A $${precio.toFixed(2)} venderias por DEBAJO del costo ($${info.costo.toFixed(2)}): ` +
          `pierdes $${perdida} en cada una.\n\nPonerlo igual?`,
      )
      if (!seguir) return
    }

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
        {producto.variantes.map((v) => {
          const info = costos.get(v.id)
          const bajoCosto = info?.costo != null && v.precio < info.costo
          return (
          <span
            key={v.id}
            className={`rounded-full px-3 py-1 text-xs flex items-center gap-2 ${
              bajoCosto ? 'bg-red-50 ring-1 ring-red-300' : 'bg-neutral-100'
            }`}
          >
            <button onClick={() => cambiarPrecio(v.id, v.nombre, v.precio)}>
              {v.nombre === 'Regular' && producto.variantes.length === 1
                ? `$${v.precio.toFixed(2)}`
                : `${v.nombre}: $${v.precio.toFixed(2)}`}
            </button>
            {/* El margen a la vista: sin esto habia que abrir cada producto
                para saber si el precio todavia tiene sentido. */}
            {info?.margen_pct != null && (
              <span
                className={`tabular-nums ${
                  bajoCosto
                    ? 'text-red-600 font-semibold'
                    : info.margen_pct >= 50
                      ? 'text-emerald-600'
                      : 'text-amber-600'
                }`}
                title={`Cuesta $${info.costo?.toFixed(2)} producirlo`}
              >
                {bajoCosto ? '¡a perdida!' : `${info.margen_pct.toFixed(0)}%`}
              </span>
            )}
            {info?.sin_receta && (
              <span className="text-amber-700" title="Sin receta: no se sabe cuanto cuesta">
                sin receta
              </span>
            )}
            {producto.variantes.length > 1 && (
              <button onClick={() => borrarVariante(v.id)} className="text-red-400">
                x
              </button>
            )}
          </span>
          )
        })}
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
