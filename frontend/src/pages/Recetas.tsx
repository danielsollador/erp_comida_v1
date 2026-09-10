import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import { api } from '../lib/api'
import type { Categoria, Ingrediente, RecetaItem, Variante } from '../lib/types'

type Fila = {
  ingrediente_id: number
  cantidad_por_unidad: string
  // Calculadora opcional: "de tanto sale tanto" - solo para ayudar a escribir
  // el numero de arriba, no se guarda aparte.
  rendimientoDe: string
  rendimientoSalen: string
  modoRendimiento: boolean
}

function filaVacia(): Fila {
  return { ingrediente_id: 0, cantidad_por_unidad: '', rendimientoDe: '', rendimientoSalen: '', modoRendimiento: false }
}

export default function Recetas() {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [ingredientes, setIngredientes] = useState<Ingrediente[]>([])
  const [abierta, setAbierta] = useState<Variante | null>(null)
  const [nombreAbierta, setNombreAbierta] = useState('')
  const [filas, setFilas] = useState<Fila[]>([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.listarCategorias().then(setCategorias)
    api.listarIngredientes().then(setIngredientes)
  }, [])

  const mapaIngredientes = new Map(ingredientes.map((i) => [i.id, i]))

  async function abrir(variante: Variante, nombre: string) {
    setError('')
    setAbierta(variante)
    setNombreAbierta(nombre)
    const receta = await api.verReceta(variante.id)
    setFilas(
      receta.length > 0
        ? receta.map((r: RecetaItem) => ({
            ingrediente_id: r.ingrediente_id,
            cantidad_por_unidad: String(r.cantidad_por_unidad),
            rendimientoDe: '',
            rendimientoSalen: '',
            modoRendimiento: false,
          }))
        : [filaVacia()],
    )
  }

  function cerrar() {
    setAbierta(null)
    setFilas([])
  }

  function actualizarFila(i: number, cambios: Partial<Fila>) {
    setFilas((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...cambios } : f)))
  }

  // "De 1 kg salen 20 unidades" -> 0.05 kg por unidad. Es solo una forma mas
  // natural de escribir la misma fraccion que ya usa la receta.
  function aplicarRendimiento(i: number) {
    const de = Number(filas[i].rendimientoDe)
    const salen = Number(filas[i].rendimientoSalen)
    if (!Number.isFinite(de) || de <= 0 || !Number.isFinite(salen) || salen <= 0) return
    actualizarFila(i, { cantidad_por_unidad: String(round6(de / salen)) })
  }

  function round6(n: number) {
    return Math.round(n * 1e6) / 1e6
  }

  function agregarFila() {
    setFilas((prev) => [...prev, filaVacia()])
  }

  function quitarFila(i: number) {
    setFilas((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))
  }

  async function guardar() {
    if (!abierta) return
    setError('')
    const items = filas
      .filter((f) => f.ingrediente_id && Number(f.cantidad_por_unidad) > 0)
      .map((f) => ({ ingrediente_id: f.ingrediente_id, cantidad_por_unidad: Number(f.cantidad_por_unidad) }))
    if (items.length === 0) {
      setError('Agrega al menos un insumo con cantidad valida')
      return
    }
    setGuardando(true)
    try {
      await api.actualizarReceta(abierta.id, items)
      cerrar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la receta')
    } finally {
      setGuardando(false)
    }
  }

  // Costo teorico: como si cada insumo rindiera el 100% comprado.
  // Costo real: descontando la merma de cocina (costo_efectivo). La
  // diferencia entre estos dos es justo lo que antes no se veia en ningun
  // lado del sistema.
  let costoTeorico = 0
  let costoReal = 0
  for (const f of filas) {
    const ing = mapaIngredientes.get(f.ingrediente_id)
    const cantidad = Number(f.cantidad_por_unidad) || 0
    if (!ing) continue
    costoTeorico += cantidad * ing.costo_unitario
    costoReal += cantidad * ing.costo_efectivo
  }
  const precio = abierta?.precio ?? 0
  const margenReal = precio > 0 ? ((precio - costoReal) / precio) * 100 : 0

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Recetas y costo por producto" />
      <div className="p-4 max-w-3xl mx-auto space-y-4">
        <p className="text-sm text-neutral-500">
          Define de que insumos y cuanto lleva cada producto. El costo y el margen que ves en
          Reportes salen de esto.
        </p>

        {categorias.map((cat) => (
          <div key={cat.id} className="bg-white rounded-2xl border border-neutral-200 p-4">
            <h2 className="font-semibold mb-2">{cat.nombre}</h2>
            <div className="space-y-1">
              {cat.productos.map((p) =>
                p.variantes.map((v) => {
                  const nombre = v.nombre === 'Regular' ? p.nombre : `${p.nombre} - ${v.nombre}`
                  return (
                    <button
                      key={v.id}
                      onClick={() => abrir(v, nombre)}
                      className={`w-full flex justify-between items-center px-3 py-2 rounded-lg text-sm text-left ${
                        abierta?.id === v.id ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-50'
                      }`}
                    >
                      <span>{nombre}</span>
                      <span className="tabular-nums opacity-70">${v.precio.toFixed(2)}</span>
                    </button>
                  )
                }),
              )}
            </div>
          </div>
        ))}

        {abierta && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-30 p-4">
            <div className="bg-white rounded-2xl p-5 w-full max-w-xl max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-start mb-1">
                <h3 className="font-semibold text-lg">{nombreAbierta}</h3>
                <button onClick={cerrar} className="text-neutral-400 text-sm">
                  cerrar
                </button>
              </div>
              <p className="text-xs text-neutral-500 mb-4">Precio de venta: ${precio.toFixed(2)}</p>
              {error && <p className="text-red-600 text-sm mb-2">{error}</p>}

              <div className="space-y-3 mb-3">
                {filas.map((f, i) => {
                  const ing = mapaIngredientes.get(f.ingrediente_id)
                  return (
                    <div key={i} className="border border-neutral-200 rounded-xl p-3">
                      <div className="flex gap-2 items-center mb-2">
                        <select
                          value={f.ingrediente_id}
                          onChange={(e) => actualizarFila(i, { ingrediente_id: Number(e.target.value) })}
                          className="flex-1 border border-neutral-300 rounded-lg px-2 py-1.5 text-sm"
                        >
                          <option value={0}>Insumo...</option>
                          {ingredientes.map((ing2) => (
                            <option key={ing2.id} value={ing2.id}>
                              {ing2.nombre} ({ing2.unidad})
                            </option>
                          ))}
                        </select>
                        <button onClick={() => quitarFila(i)} className="text-red-400 text-sm px-1">
                          x
                        </button>
                      </div>

                      <div className="flex gap-3 items-center mb-2 text-xs">
                        <button
                          onClick={() => actualizarFila(i, { modoRendimiento: false })}
                          className={`font-medium ${!f.modoRendimiento ? 'text-neutral-900' : 'text-neutral-400'}`}
                        >
                          Cantidad directa
                        </button>
                        <button
                          onClick={() => actualizarFila(i, { modoRendimiento: true })}
                          className={`font-medium ${f.modoRendimiento ? 'text-neutral-900' : 'text-neutral-400'}`}
                        >
                          De X sale Y
                        </button>
                      </div>

                      {f.modoRendimiento ? (
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span>De</span>
                          <input
                            value={f.rendimientoDe}
                            onChange={(e) => actualizarFila(i, { rendimientoDe: e.target.value })}
                            type="number"
                            step="0.01"
                            className="w-20 border border-neutral-300 rounded-lg px-2 py-1"
                          />
                          <span>{ing?.unidad ?? 'unidad'} salen</span>
                          <input
                            value={f.rendimientoSalen}
                            onChange={(e) => actualizarFila(i, { rendimientoSalen: e.target.value })}
                            type="number"
                            step="1"
                            className="w-20 border border-neutral-300 rounded-lg px-2 py-1"
                          />
                          <span>unidades</span>
                          <button
                            onClick={() => aplicarRendimiento(i)}
                            className="bg-neutral-100 hover:bg-neutral-200 rounded-lg px-2 py-1 text-xs font-medium"
                          >
                            Calcular
                          </button>
                        </div>
                      ) : null}

                      <div className="flex items-center gap-2 mt-2 text-sm">
                        <input
                          value={f.cantidad_por_unidad}
                          onChange={(e) => actualizarFila(i, { cantidad_por_unidad: e.target.value })}
                          placeholder={`Cantidad por unidad vendida${ing ? ` (${ing.unidad})` : ''}`}
                          type="number"
                          step="0.0001"
                          className="flex-1 border border-neutral-300 rounded-lg px-2 py-1.5"
                        />
                        {ing && Number(f.cantidad_por_unidad) > 0 && (
                          <span className="text-xs text-neutral-500 whitespace-nowrap">
                            = ${(Number(f.cantidad_por_unidad) * ing.costo_efectivo).toFixed(3)}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              <button onClick={agregarFila} className="text-sm text-neutral-500 font-medium mb-4">
                + insumo
              </button>

              <div className="bg-neutral-50 rounded-xl p-3 text-sm space-y-1 mb-4">
                <div className="flex justify-between text-neutral-500">
                  <span>Costo teorico (sin merma de cocina)</span>
                  <span className="tabular-nums">${costoTeorico.toFixed(3)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Costo real</span>
                  <span className="tabular-nums">${costoReal.toFixed(3)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Margen a este precio</span>
                  <span className={`tabular-nums ${margenReal < 30 ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {margenReal.toFixed(1)}%
                  </span>
                </div>
              </div>

              <button
                onClick={guardar}
                disabled={guardando}
                className="w-full bg-neutral-900 text-white rounded-xl py-3 font-semibold disabled:opacity-50"
              >
                Guardar receta
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
