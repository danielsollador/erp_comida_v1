import { useEffect, useMemo, useState } from 'react'
import { contiene, palabrasDe } from '../../components/Tabla'
import { Boton, Modal, Vacio } from '../../components/ui'
import { Numerico } from '../../components/Teclado'
import { api } from '../../lib/api'
import { etiquetaVariante } from '../../lib/menu'
import type { Categoria, CostoVariante, Ingrediente, RecetaItem, Variante } from '../../lib/types'

/**
 * Qué lleva cada producto: la receta, y con ella el costo y el margen.
 *
 * ERA UN MODULO APARTE. Se mudó aquí dentro del menú (Leider, 21-sep: "el
 * módulo de receta lo vamos a eliminar y va a ser un submódulo de menú"), que
 * es donde se hace la pregunta: se está poniendo el precio de la empanada y
 * hace falta saber cuánto cuesta hacerla. Con dos módulos había que salir,
 * buscar el mismo producto otra vez y volver.
 *
 * LO QUE SE ARREGLO AL MUDARLO:
 *
 *   CIEN PETICIONES     Para saber cuáles ya tenían receta se preguntaba una
 *                       por una: `verReceta` por cada subsección del menú.
 *                       Con cien subsecciones eran cien llamadas para dibujar
 *                       una lista. El dato ya venía en `/menu/costos`, que es
 *                       UNA, y es la que el menú carga de todos modos.
 *   LA LISTA NO DECIA   Se veía el precio, no el costo ni el margen. Lo que
 *   NADA UTIL           se viene a mirar aquí es dónde se está perdiendo
 *                       plata; ahora se ve en la fila y se puede filtrar por
 *                       "sin receta", que son justo los que salen con 100% de
 *                       margen mentiroso en Reportes.
 */
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

type Renglon = { variante: Variante; nombre: string; categoria: string; info?: CostoVariante }

export default function Recetas({
  categorias,
  costos,
  onCambio,
}: {
  categorias: Categoria[]
  costos: Map<number, CostoVariante>
  onCambio: () => void
}) {
  const [ingredientes, setIngredientes] = useState<Ingrediente[]>([])
  const [abierta, setAbierta] = useState<Renglon | null>(null)
  const [filas, setFilas] = useState<Fila[]>([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [soloFaltan, setSoloFaltan] = useState(false)

  useEffect(() => {
    api.listarIngredientes().then((l) => setIngredientes(l.filter((i) => i.activo !== false)))
  }, [])

  const mapaIngredientes = useMemo(
    () => new Map(ingredientes.map((i) => [i.id, i])),
    [ingredientes],
  )

  // Solo lo que sigue EN el menú: cargarle la receta a algo retirado no sirve.
  const renglones: Renglon[] = useMemo(
    () =>
      categorias
        .filter((c) => c.activo)
        .flatMap((c) =>
          c.productos
            .filter((p) => p.activo)
            .flatMap((p) =>
              p.variantes
                .filter((v) => v.activo)
                .map((v) => ({
                  variante: v,
                  nombre: etiquetaVariante(p, v),
                  categoria: c.nombre,
                  info: costos.get(v.id),
                })),
            ),
        ),
    [categorias, costos],
  )

  const faltan = renglones.filter((r) => r.info?.sin_receta !== false).length

  const palabras = palabrasDe(busqueda)
  const visibles = renglones.filter((r) => {
    if (soloFaltan && r.info?.sin_receta === false) return false
    if (palabras.length === 0) return true
    return contiene(`${r.categoria} ${r.nombre}`, palabras)
  })

  async function abrir(r: Renglon) {
    setError('')
    setAbierta(r)
    const receta = await api.verReceta(r.variante.id)
    setFilas(
      receta.length > 0
        ? receta.map((x: RecetaItem) => ({
            ingrediente_id: x.ingrediente_id,
            cantidad_por_unidad: String(x.cantidad_por_unidad),
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

  // "De 1 kg COMPRADO salen 20 unidades" -> cuanto insumo UTILIZABLE lleva
  // cada una. El dueño mide sobre lo que compra (es lo unico que puede pesar),
  // pero la receta guarda cantidad utilizable, que es lo que el sistema
  // multiplica por el costo real. Sin multiplicar por el rendimiento aca, la
  // merma de cocina se contaria dos veces.
  function aplicarRendimiento(i: number) {
    const de = Number(filas[i].rendimientoDe)
    const salen = Number(filas[i].rendimientoSalen)
    if (!Number.isFinite(de) || de <= 0 || !Number.isFinite(salen) || salen <= 0) return
    const ing = mapaIngredientes.get(filas[i].ingrediente_id)
    const rendimiento = (ing?.rendimiento_pct ?? 100) / 100
    actualizarFila(i, { cantidad_por_unidad: String(Math.round(((de * rendimiento) / salen) * 1e6) / 1e6) })
  }

  async function guardar() {
    if (!abierta) return
    setError('')
    const items = filas
      .filter((f) => f.ingrediente_id && Number(f.cantidad_por_unidad) > 0)
      .map((f) => ({ ingrediente_id: f.ingrediente_id, cantidad_por_unidad: Number(f.cantidad_por_unidad) }))
    if (items.length === 0) {
      setError('Agrega al menos una mercancía con su cantidad.')
      return
    }
    setGuardando(true)
    try {
      await api.actualizarReceta(abierta.variante.id, items)
      cerrar()
      // El costo y el margen de todo el menú cambian con esto.
      onCambio()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la receta')
    } finally {
      setGuardando(false)
    }
  }

  // Costo teorico: como si cada insumo rindiera el 100% comprado. Costo real:
  // descontando la merma de cocina (`costo_efectivo`). La diferencia entre los
  // dos es justo lo que no se veia en ningun lado del sistema.
  let costoTeorico = 0
  let costoReal = 0
  for (const f of filas) {
    const ing = mapaIngredientes.get(f.ingrediente_id)
    const cantidad = Number(f.cantidad_por_unidad) || 0
    if (!ing) continue
    costoTeorico += cantidad * ing.costo_unitario
    costoReal += cantidad * ing.costo_efectivo
  }
  const precio = abierta?.variante.precio ?? 0
  const margenReal = precio > 0 ? ((precio - costoReal) / precio) * 100 : 0

  if (renglones.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-neutral-200">
        <Vacio
          icono="recetas"
          titulo="Todavía no hay productos"
          detalle="Crea el menú primero. La receta dice de qué mercancía y cuánto lleva cada producto, y de ahí salen el costo y el margen."
        />
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setBusqueda('')}
            placeholder="Buscar un producto"
            aria-label="Buscar un producto"
            className="w-full bg-white border border-neutral-300 rounded-xl pl-9 pr-3 py-2.5 text-sm"
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
        {/* El filtro que de verdad se usa: quién falta. Sin receta, ese
            producto sale con 100% de margen en Reportes, que es peor que no
            tener el dato porque parece uno bueno. */}
        <button
          onClick={() => setSoloFaltan((v) => !v)}
          aria-pressed={soloFaltan}
          className={`rounded-xl px-3.5 py-2.5 text-sm font-medium border ${
            soloFaltan
              ? 'bg-aviso-500 text-white border-aviso-500'
              : 'bg-white border-neutral-300 hover:border-neutral-400'
          }`}
        >
          Sin receta ({faltan})
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
        {visibles.length === 0 ? (
          <Vacio
            titulo={soloFaltan ? 'Todos tienen receta' : `Nada coincide con «${busqueda.trim()}»`}
            detalle={soloFaltan ? 'El costo y el margen de Reportes son de fiar.' : undefined}
          />
        ) : (
          <div className="divide-y divide-neutral-100">
            {visibles.map((r) => {
              const falta = r.info?.sin_receta !== false
              const margen = r.info?.margen_pct
              return (
                <button
                  key={r.variante.id}
                  onClick={() => abrir(r)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-neutral-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-sm">{r.nombre}</span>
                    <span className="block text-[11px] text-neutral-400">{r.categoria}</span>
                  </span>
                  {falta ? (
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-aviso-700 bg-aviso-50 rounded px-1.5 py-0.5">
                      sin receta
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs text-neutral-500 tabular-nums">
                      cuesta ${r.info?.costo?.toFixed(2)}
                    </span>
                  )}
                  <span className="shrink-0 w-16 text-right text-sm tabular-nums">
                    ${r.variante.precio.toFixed(2)}
                  </span>
                  <span
                    className={`shrink-0 w-12 text-right text-sm tabular-nums ${
                      margen == null
                        ? 'text-neutral-300'
                        : margen < 0
                          ? 'text-peligro-600 font-semibold'
                          : margen >= 50
                            ? 'text-exito-600'
                            : 'text-aviso-600'
                    }`}
                  >
                    {margen == null ? '—' : `${margen.toFixed(0)}%`}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {abierta && (
        <Modal
          titulo={abierta.nombre}
          ayuda={`Se vende a $${precio.toFixed(2)}. Escribe de qué lleva y cuánto, por unidad.`}
          onCerrar={cerrar}
          pie={
            <div className="flex items-center justify-between w-full gap-3">
              <Boton tono="fantasma" onClick={cerrar}>
                Cancelar
              </Boton>
              <Boton onClick={guardar} disabled={guardando}>
                {guardando ? 'Guardando…' : 'Guardar receta'}
              </Boton>
            </div>
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
                      aria-label="Mercancía"
                      className="flex-1 min-w-0 border border-neutral-300 rounded-lg px-2 py-2 text-sm"
                    >
                      <option value={0}>Mercancía…</option>
                      {ingredientes.map((otro) => (
                        <option key={otro.id} value={otro.id}>
                          {otro.nombre} ({otro.unidad})
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => setFilas((p) => (p.length > 1 ? p.filter((_, x) => x !== i) : p))}
                      aria-label="Quitar esta mercancía"
                      disabled={filas.length <= 1}
                      className="w-9 h-9 shrink-0 grid place-items-center rounded-lg text-neutral-400 hover:bg-peligro-50 hover:text-peligro-600 disabled:opacity-30"
                    >
                      ×
                    </button>
                  </div>

                  <div className="flex gap-1 mb-2">
                    {[
                      { modo: false, texto: 'Cantidad por unidad' },
                      { modo: true, texto: 'De X salen Y' },
                    ].map((op) => (
                      <button
                        key={op.texto}
                        onClick={() => actualizarFila(i, { modoRendimiento: op.modo })}
                        className={`flex-1 rounded-lg py-1.5 text-xs font-medium ${
                          f.modoRendimiento === op.modo
                            ? 'bg-neutral-900 text-white'
                            : 'bg-neutral-100 text-neutral-600'
                        }`}
                      >
                        {op.texto}
                      </button>
                    ))}
                  </div>

                  {f.modoRendimiento ? (
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span>De</span>
                        <Numerico
                          value={f.rendimientoDe}
                          onChange={(e) => actualizarFila(i, { rendimientoDe: e.target.value })}
                          aria-label="Cantidad que compras"
                          className="w-20 border border-neutral-300 rounded-lg px-2 py-1.5"
                        />
                        <span>{ing?.unidad ?? 'unidad'} que compras salen</span>
                        <Numerico
                          value={f.rendimientoSalen}
                          onChange={(e) => actualizarFila(i, { rendimientoSalen: e.target.value })}
                          aria-label="Unidades que salen"
                          className="w-20 border border-neutral-300 rounded-lg px-2 py-1.5"
                        />
                        <span>unidades</span>
                        <button
                          onClick={() => aplicarRendimiento(i)}
                          className="bg-neutral-100 hover:bg-neutral-200 rounded-lg px-2.5 py-1.5 text-xs font-medium"
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
                    <Numerico
                      value={f.cantidad_por_unidad}
                      onChange={(e) => actualizarFila(i, { cantidad_por_unidad: e.target.value })}
                      placeholder={`Cuánto lleva cada una${ing ? ` (${ing.unidad})` : ''}`}
                      aria-label="Cantidad por unidad"
                      className="flex-1 min-w-0 border border-neutral-300 rounded-lg px-2 py-2"
                    />
                    {ing && Number(f.cantidad_por_unidad) > 0 && (
                      <span className="text-xs text-neutral-500 whitespace-nowrap tabular-nums">
                        = ${(Number(f.cantidad_por_unidad) * ing.costo_efectivo).toFixed(3)}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <button
            onClick={() => setFilas((p) => [...p, filaVacia()])}
            className="w-full rounded-xl border border-dashed border-neutral-300 py-2.5 text-sm font-medium text-neutral-500 hover:border-neutral-400 hover:text-neutral-800 mb-4"
          >
            + Otra mercancía
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
    </>
  )
}
