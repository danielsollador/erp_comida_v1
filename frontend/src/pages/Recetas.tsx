import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import { contiene, palabrasDe } from '../components/Tabla'
import { Boton, Modal, Pagina } from '../components/ui'
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

  // Que variantes ya tienen receta: sin esto la lista se ve igual para todas y
  // el dueno no tiene forma de saber cual le falta, que es justo la que despues
  // aparece con margen 100% en Reportes.
  const [conReceta, setConReceta] = useState<Set<number>>(new Set())
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    api.listarCategorias().then(async (todas) => {
      // Solo lo que sigue EN el menu: cargarle la receta a un producto que se
      // retiro no sirve de nada, y el listado lo devolvia igual.
      const cats = todas
        .filter((c) => c.activo)
        .map((c) => ({
          ...c,
          productos: c.productos
            .filter((p) => p.activo)
            .map((p) => ({ ...p, variantes: p.variantes.filter((v) => v.activo) }))
            .filter((p) => p.variantes.length > 0),
        }))
        .filter((c) => c.productos.length > 0)
      setCategorias(cats)
      const ids = cats.flatMap((c) => c.productos.flatMap((p) => p.variantes.map((v) => v.id)))
      const recetas = await Promise.all(
        ids.map((id) => api.verReceta(id).then((r) => [id, r.length > 0] as const).catch(() => [id, false] as const)),
      )
      setConReceta(new Set(recetas.filter(([, tiene]) => tiene).map(([id]) => id)))
    })
    api.listarIngredientes().then((l) => setIngredientes(l.filter((i) => i.activo !== false)))
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

  // "De 1 kg COMPRADO salen 20 unidades" -> cuanto insumo UTILIZABLE lleva cada
  // una. El dueno mide sobre lo que compra (es lo unico que puede pesar), pero
  // la receta guarda cantidad utilizable, que es lo que el sistema multiplica
  // por el costo real. Sin multiplicar por el rendimiento aca, la merma de
  // cocina se contaria dos veces: una en este numero y otra en costo_efectivo.
  function aplicarRendimiento(i: number) {
    const de = Number(filas[i].rendimientoDe)
    const salen = Number(filas[i].rendimientoSalen)
    if (!Number.isFinite(de) || de <= 0 || !Number.isFinite(salen) || salen <= 0) return
    const ing = mapaIngredientes.get(filas[i].ingrediente_id)
    const rendimiento = (ing?.rendimiento_pct ?? 100) / 100
    actualizarFila(i, {
      cantidad_por_unidad: String(round6((de * rendimiento) / salen)),
    })
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
      setError('Agrega al menos un insumo con cantidad válida')
      return
    }
    setGuardando(true)
    try {
      await api.actualizarReceta(abierta.id, items)
      setConReceta((prev) => new Set(prev).add(abierta.id))
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

  // "emp per" encuentra "Empanada - Pernil". Una categoria a la que no le
  // queda ninguna variante no se dibuja.
  const palabras = palabrasDe(busqueda)
  const visibles: Categoria[] = palabras.length
    ? categorias
        .map((cat) => ({
          ...cat,
          productos: cat.productos
            .map((p) => ({
              ...p,
              variantes: p.variantes.filter((v) =>
                contiene(`${cat.nombre} ${p.nombre} ${v.nombre}`, palabras),
              ),
            }))
            .filter((p) => p.variantes.length > 0),
        }))
        .filter((cat) => cat.productos.length > 0)
    : categorias

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Recetas y costo por producto" />
      <Pagina ancho="media">
        <p className="text-sm text-neutral-500">
          Define de qué insumos y cuánto lleva cada producto. El costo y el margen que ves en
          Reportes salen de esto.
        </p>

        {/* Con el menu entero desplegado por categorias, encontrar "Empanada
            de pernil" para cargarle la receta era recorrer la pagina. */}
        <div className="relative">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setBusqueda('')}
            placeholder="Buscar un producto por nombre"
            aria-label="Buscar un producto por nombre"
            className="w-full bg-white border border-neutral-300 rounded-xl pl-9 pr-3 py-2 text-sm"
          />
          <svg
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
            className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        </div>

        {visibles.map((cat) => (
          <div key={cat.id} className="bg-white rounded-2xl border border-neutral-200 p-4">
            <h2 className="font-semibold mb-2">{cat.nombre}</h2>
            <div className="space-y-1">
              {cat.productos.map((p) =>
                p.variantes.map((v) => {
                  const nombre = v.nombre === 'Regular' ? p.nombre : `${p.nombre} - ${v.nombre}`
                  const falta = !conReceta.has(v.id)
                  return (
                    <button
                      key={v.id}
                      onClick={() => abrir(v, nombre)}
                      className={`w-full flex justify-between items-center gap-2 px-3 py-2 rounded-lg text-sm text-left ${
                        abierta?.id === v.id ? 'bg-neutral-900 text-white' : 'hover:bg-neutral-50'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="truncate">{nombre}</span>
                        {falta && abierta?.id !== v.id && (
                          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-aviso-700 bg-aviso-50 rounded px-1.5 py-0.5">
                            sin receta
                          </span>
                        )}
                      </span>
                      <span className="tabular-nums opacity-70 shrink-0">${v.precio.toFixed(2)}</span>
                    </button>
                  )
                }),
              )}
            </div>
          </div>
        ))}

        {busqueda.trim() && visibles.length === 0 && (
          <p className="text-sm text-neutral-400 text-center py-6">
            Ningún producto coincide con «{busqueda.trim()}».
          </p>
        )}

        {abierta && (
          <Modal
            titulo={nombreAbierta}
            ayuda={`Precio de venta: $${precio.toFixed(2)}`}
            onCerrar={cerrar}
            pie={
              <Boton onClick={guardar} disabled={guardando}>
                Guardar receta
              </Boton>
            }
          >
            {error && <p className="text-peligro-600 text-sm mb-2">{error}</p>}

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
                      <button onClick={() => quitarFila(i)} className="text-peligro-400 text-sm px-1">
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
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span>De</span>
                          <input
                            value={f.rendimientoDe}
                            onChange={(e) => actualizarFila(i, { rendimientoDe: e.target.value })}
                            type="number"
                            step="0.01"
                            className="w-20 border border-neutral-300 rounded-lg px-2 py-1"
                          />
                          <span>{ing?.unidad ?? 'unidad'} que compras salen</span>
                          <input
                            value={f.rendimientoSalen}
                            onChange={(e) =>
                              actualizarFila(i, { rendimientoSalen: e.target.value })
                            }
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
                        {ing && ing.rendimiento_pct < 100 && (
                          <p className="text-xs text-aviso-700">
                            Mide sobre lo que compras, sin limpiar. El {ing.rendimiento_pct}% de
                            rendimiento de {ing.nombre} ya se descuenta solo.
                          </p>
                        )}
                      </div>
                    ) : null}

                    <div className="flex items-center gap-2 mt-2 text-sm">
                      <input
                        value={f.cantidad_por_unidad}
                        onChange={(e) => actualizarFila(i, { cantidad_por_unidad: e.target.value })}
                        placeholder={`Cantidad utilizable por unidad${ing ? ` (${ing.unidad})` : ''}`}
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

            <div className="bg-neutral-50 rounded-xl p-3 text-sm space-y-1">
              <div className="flex justify-between text-neutral-500">
                <span>Costo teórico (sin merma de cocina)</span>
                <span className="tabular-nums">${costoTeorico.toFixed(3)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Costo real</span>
                <span className="tabular-nums">${costoReal.toFixed(3)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Margen a este precio</span>
                <span className={`tabular-nums ${margenReal < 30 ? 'text-aviso-600' : 'text-exito-600'}`}>
                  {margenReal.toFixed(1)}%
                </span>
              </div>
            </div>

          </Modal>
        )}
      </Pagina>
    </div>
  )
}
