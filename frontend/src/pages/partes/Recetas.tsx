import { useEffect, useMemo, useState } from 'react'
import { contiene, palabrasDe } from '../../components/Tabla'
import { Boton, FiltroDesplegable, Vacio } from '../../components/ui'
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
 * hace falta saber cuánto cuesta hacerla.
 *
 * Y ERA UN FORMULARIO. Se abría un cuadro con filas "mercancía / cantidad" y
 * un total abajo; había que leer los números para saber si el producto daba
 * plata. Ahora es un VASO (Leider, 29-sep: "que se vaya llenando ese producto
 * y que lo que sobre se rellene en verde y ese sea el margen"): a la
 * izquierda el producto con su precio, dibujado como un recipiente; cada
 * mercancía que se le pone ocupa una franja proporcional a lo que cuesta, y
 * lo que queda hasta el borde --el precio-- es el margen, en verde. Si el
 * costo se pasa del precio, el vaso se desborda y la linea del precio queda
 * por debajo: se ve la pérdida antes de leerla.
 *
 * UN SOLO DIBUJO PARA TODOS LOS PRODUCTOS. Un vaso sirve igual para un jugo,
 * una empanada o un combo: lo que importa no es la forma sino cuanto del
 * precio se lleva cada cosa. Dibujar uno por producto obligaría a dibujar
 * para cada cliente.
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

type Renglon = { variante: Variante; nombre: string; categoria: string; info?: CostoVariante }

// Los tintes de las franjas, por categoria del deposito. Salen de la paleta
// (index.css) y esquivan el verde --que es el margen-- y el rojo --que es la
// perdida--, para que el vaso se lea sin leyenda.
const TONOS = ['acento-400', 'aviso-400', 'neutral-400', 'acento-600', 'aviso-600', 'neutral-600', 'acento-300', 'aviso-300']

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

  const mapaIngredientes = useMemo(() => new Map(ingredientes.map((i) => [i.id, i])), [ingredientes])

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
      receta.map((x: RecetaItem) => ({
        ingrediente_id: x.ingrediente_id,
        cantidad_por_unidad: String(x.cantidad_por_unidad),
        rendimientoDe: '',
        rendimientoSalen: '',
        modoRendimiento: false,
      })),
    )
  }

  function cerrar() {
    setAbierta(null)
    setFilas([])
  }

  async function guardar() {
    if (!abierta) return
    setError('')
    const items = filas
      .filter((f) => f.ingrediente_id && Number(f.cantidad_por_unidad) > 0)
      .map((f) => ({ ingrediente_id: f.ingrediente_id, cantidad_por_unidad: Number(f.cantidad_por_unidad) }))
    if (items.length === 0) {
      setError('Ponle al menos una mercancía con su cantidad.')
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

  if (renglones.length === 0) {
    return (
      <div className="vp-losa">
        <Vacio
          icono="recetas"
          titulo="Todavía no hay productos"
          detalle="Crea el menú primero. La receta dice de qué mercancía y cuánto lleva cada producto, y de ahí salen el costo y el margen."
        />
      </div>
    )
  }

  if (abierta) {
    return (
      <Compositor
        renglon={abierta}
        ingredientes={ingredientes}
        mapaIngredientes={mapaIngredientes}
        filas={filas}
        setFilas={setFilas}
        error={error}
        guardando={guardando}
        onGuardar={() => void guardar()}
        onCerrar={cerrar}
      />
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
          <Lupa />
        </div>
        {/* El filtro que de verdad se usa: quién falta. Sin receta, ese
            producto sale con 100% de margen en Reportes, que es peor que no
            tener el dato porque parece uno bueno. */}
        <button
          onClick={() => setSoloFaltan((v) => !v)}
          aria-pressed={soloFaltan}
          className={`rounded-xl px-3.5 py-2.5 text-sm font-medium border ${
            soloFaltan ? 'bg-aviso-500 text-white border-aviso-500' : 'bg-white border-neutral-300 hover:border-neutral-400'
          }`}
        >
          Sin receta ({faltan})
        </button>
      </div>

      <div className="vp-losa overflow-hidden">
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
              const costo = r.info?.costo ?? null
              const precio = r.variante.precio
              // La misma idea del vaso, en miniatura y acostada: cuanto del
              // precio se lleva el costo (gris) y cuanto queda (verde).
              const parteCosto = costo != null && precio > 0 ? Math.min(costo / precio, 1) : 0
              return (
                <button
                  key={r.variante.id}
                  onClick={() => void abrir(r)}
                  className="vp-celda w-full flex items-center gap-3 px-4 py-3 text-left"
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
                    <>
                      <span className="shrink-0 text-xs text-neutral-500 tabular-nums hidden sm:inline">
                        cuesta ${costo?.toFixed(2)}
                      </span>
                      <span
                        aria-hidden
                        className={`shrink-0 hidden sm:flex w-20 h-2 rounded-full overflow-hidden ${
                          margen != null && margen < 0 ? 'bg-peligro-400' : 'bg-exito-400'
                        }`}
                      >
                        <span className="block h-full bg-neutral-300" style={{ width: `${parteCosto * 100}%` }} />
                      </span>
                    </>
                  )}
                  <span className="shrink-0 w-16 text-right text-sm tabular-nums">${precio.toFixed(2)}</span>
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
    </>
  )
}

function Lupa() {
  return (
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
  )
}

// ── El compositor: el vaso a la izquierda, la mercancía a la derecha ────────

type Parte = { id: number; nombre: string; costo: number; color: string }

function Compositor({
  renglon,
  ingredientes,
  mapaIngredientes,
  filas,
  setFilas,
  error,
  guardando,
  onGuardar,
  onCerrar,
}: {
  renglon: Renglon
  ingredientes: Ingrediente[]
  mapaIngredientes: Map<number, Ingrediente>
  filas: Fila[]
  setFilas: (f: Fila[] | ((prev: Fila[]) => Fila[])) => void
  error: string
  guardando: boolean
  onGuardar: () => void
  onCerrar: () => void
}) {
  const [busqueda, setBusqueda] = useState('')
  const [categoria, setCategoria] = useState('')
  const [resaltado, setResaltado] = useState<number | null>(null)
  const precio = renglon.variante.precio

  // Un tinte por categoria del deposito, estable mientras dure la pantalla.
  const tonoDeCategoria = useMemo(() => {
    const m = new Map<string, string>()
    for (const i of ingredientes) {
      const c = i.categoria || ''
      if (!m.has(c)) m.set(c, `var(--color-${TONOS[m.size % TONOS.length]})`)
    }
    return m
  }, [ingredientes])

  const categoriasDeposito = useMemo(() => {
    const cuenta = new Map<string, number>()
    for (const i of ingredientes) cuenta.set(i.categoria || '', (cuenta.get(i.categoria || '') ?? 0) + 1)
    return [...cuenta.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([nombre, n]) => ({ valor: nombre || '__sin__', texto: nombre || 'Sin categoría', contador: n }))
  }, [ingredientes])

  const enReceta = new Set(filas.map((f) => f.ingrediente_id))
  const palabras = palabrasDe(busqueda)
  const disponibles = ingredientes.filter((i) => {
    if (enReceta.has(i.id)) return false
    if (categoria && (i.categoria || '__sin__') !== categoria) return false
    if (palabras.length === 0) return true
    return contiene(`${i.nombre} ${i.categoria}`, palabras)
  })

  function actualizarFila(id: number, cambios: Partial<Fila>) {
    setFilas((prev) => prev.map((f) => (f.ingrediente_id === id ? { ...f, ...cambios } : f)))
  }

  function agregar(ing: Ingrediente) {
    setFilas((prev) => [
      ...prev,
      { ingrediente_id: ing.id, cantidad_por_unidad: '', rendimientoDe: '', rendimientoSalen: '', modoRendimiento: false },
    ])
    setResaltado(ing.id)
  }

  function quitar(id: number) {
    setFilas((prev) => prev.filter((f) => f.ingrediente_id !== id))
  }

  // "De 1 kg COMPRADO salen 20 unidades" -> cuanto insumo UTILIZABLE lleva
  // cada una. El dueño mide sobre lo que compra (es lo unico que puede pesar),
  // pero la receta guarda cantidad utilizable, que es lo que el sistema
  // multiplica por el costo real. Sin multiplicar por el rendimiento aca, la
  // merma de cocina se contaria dos veces.
  function aplicarRendimiento(f: Fila) {
    const de = Number(f.rendimientoDe)
    const salen = Number(f.rendimientoSalen)
    if (!Number.isFinite(de) || de <= 0 || !Number.isFinite(salen) || salen <= 0) return
    const ing = mapaIngredientes.get(f.ingrediente_id)
    const rendimiento = (ing?.rendimiento_pct ?? 100) / 100
    actualizarFila(f.ingrediente_id, {
      cantidad_por_unidad: String(Math.round(((de * rendimiento) / salen) * 1e6) / 1e6),
      modoRendimiento: false,
    })
  }

  // Costo teorico: como si cada insumo rindiera el 100% comprado. Costo real:
  // descontando la merma de cocina (`costo_efectivo`). La diferencia entre los
  // dos es justo lo que no se veia en ningun lado del sistema.
  const partes: Parte[] = []
  let costoTeorico = 0
  let costoReal = 0
  for (const f of filas) {
    const ing = mapaIngredientes.get(f.ingrediente_id)
    const cantidad = Number(f.cantidad_por_unidad) || 0
    if (!ing) continue
    costoTeorico += cantidad * ing.costo_unitario
    const costo = cantidad * ing.costo_efectivo
    costoReal += costo
    if (costo > 0) partes.push({ id: ing.id, nombre: ing.nombre, costo, color: tonoDeCategoria.get(ing.categoria || '') ?? 'var(--color-neutral-400)' })
  }
  const margen = precio - costoReal
  const margenPct = precio > 0 ? (margen / precio) * 100 : 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button type="button" onClick={onCerrar} className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Productos
        </button>
        <div className="flex items-center gap-2">
          <Boton tono="fantasma" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton onClick={onGuardar} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar receta'}
          </Boton>
        </div>
      </div>
      {error && <p className="text-peligro-600 text-sm">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start">
        {/* ── El producto ─────────────────────────────────────────────── */}
        <section className="vp-losa p-5 sm:p-6">
          <p className="text-xs text-neutral-500">{renglon.categoria}</p>
          <h2 className="font-display text-2xl font-semibold tracking-tight leading-tight mb-3">{renglon.nombre}</h2>
          <Vaso precio={precio} partes={partes} costo={costoReal} resaltado={resaltado} onResaltar={setResaltado} />
          <Margen precio={precio} costoReal={costoReal} costoTeorico={costoTeorico} margen={margen} margenPct={margenPct} vacio={filas.length === 0} />
        </section>

        {/* ── La mercancía ────────────────────────────────────────────── */}
        <section className="space-y-3">
          {filas.length > 0 && (
            <div className="vp-losa overflow-hidden">
              <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Lleva</p>
              <ul className="divide-y divide-neutral-100">
                {filas.map((f) => {
                  const ing = mapaIngredientes.get(f.ingrediente_id)
                  if (!ing) return null
                  const cantidad = Number(f.cantidad_por_unidad) || 0
                  const color = tonoDeCategoria.get(ing.categoria || '') ?? 'var(--color-neutral-400)'
                  return (
                    <li
                      key={ing.id}
                      onMouseEnter={() => setResaltado(ing.id)}
                      onMouseLeave={() => setResaltado(null)}
                      className={`px-4 py-2.5 ${resaltado === ing.id ? 'bg-neutral-50' : ''}`}
                    >
                      <div className="flex items-center gap-3">
                        <span aria-hidden className="w-1.5 self-stretch min-h-[28px] rounded-full shrink-0" style={{ background: color }} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium truncate">{ing.nombre}</span>
                          <span className="block text-[11px] text-neutral-400">
                            ${ing.costo_efectivo.toFixed(3)} por {ing.unidad}
                            {ing.categoria && ` · ${ing.categoria}`}
                          </span>
                        </span>
                        <Numerico
                          value={f.cantidad_por_unidad}
                          onChange={(e) => actualizarFila(ing.id, { cantidad_por_unidad: e.target.value })}
                          placeholder="0"
                          etiqueta={`${ing.nombre} (${ing.unidad})`}
                          aria-label={`Cantidad de ${ing.nombre} por unidad`}
                          autoFocus={f.cantidad_por_unidad === ''}
                          className="w-20 border border-neutral-300 rounded-lg px-2 py-1.5 text-sm text-right tabular-nums"
                        />
                        <span className="w-9 text-xs text-neutral-500">{ing.unidad}</span>
                        <span className="w-16 text-right text-sm tabular-nums font-semibold">
                          {cantidad > 0 ? `$${(cantidad * ing.costo_efectivo).toFixed(2)}` : '—'}
                        </span>
                        <button
                          type="button"
                          onClick={() => quitar(ing.id)}
                          aria-label={`Quitar ${ing.nombre}`}
                          className="w-8 h-8 shrink-0 grid place-items-center rounded-lg text-neutral-400 hover:bg-peligro-50 hover:text-peligro-600"
                        >
                          ×
                        </button>
                      </div>
                      {/* La calculadora "de X salen Y", plegada: sirve cuando se
                          mide sobre lo comprado y no sobre cada unidad. */}
                      {f.modoRendimiento ? (
                        <div className="mt-2 ml-4 flex flex-wrap items-center gap-2 text-sm">
                          <span>De</span>
                          <Numerico
                            value={f.rendimientoDe}
                            onChange={(e) => actualizarFila(ing.id, { rendimientoDe: e.target.value })}
                            aria-label="Cantidad que compras"
                            className="w-16 border border-neutral-300 rounded-lg px-2 py-1 text-sm"
                          />
                          <span>{ing.unidad} salen</span>
                          <Numerico
                            value={f.rendimientoSalen}
                            onChange={(e) => actualizarFila(ing.id, { rendimientoSalen: e.target.value })}
                            aria-label="Unidades que salen"
                            className="w-16 border border-neutral-300 rounded-lg px-2 py-1 text-sm"
                          />
                          <span>unidades</span>
                          <button
                            type="button"
                            onClick={() => aplicarRendimiento(f)}
                            className="rounded-lg bg-neutral-900 text-white px-2.5 py-1 text-xs font-medium"
                          >
                            Calcular
                          </button>
                          <button
                            type="button"
                            onClick={() => actualizarFila(ing.id, { modoRendimiento: false })}
                            className="text-xs text-neutral-500"
                          >
                            Cerrar
                          </button>
                          {ing.rendimiento_pct < 100 && (
                            <span className="basis-full text-[11px] text-aviso-700">
                              Mide sobre lo que compras, sin limpiar: el {ing.rendimiento_pct}% de rendimiento ya se descuenta solo.
                            </span>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => actualizarFila(ing.id, { modoRendimiento: true })}
                          className="ml-4 mt-1 text-[11px] text-neutral-400 hover:text-neutral-700"
                        >
                          ¿No sabes cuánto lleva cada una? Calcúlalo: de X salen Y
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          <div className="vp-losa overflow-hidden">
            <div className="px-4 pt-3 pb-2 flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mr-auto">
                {filas.length === 0 ? 'Toca lo que lleva' : 'Agregar'}
              </p>
              <div className="relative">
                <input
                  type="search"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setBusqueda('')}
                  placeholder="Buscar mercancía"
                  aria-label="Buscar mercancía"
                  className="w-44 bg-white border border-neutral-300 rounded-xl pl-8 pr-3 py-1.5 text-sm"
                />
                <Lupa />
              </div>
              <FiltroDesplegable
                etiqueta="Categoría"
                valor={categoria}
                alCambiar={setCategoria}
                opciones={[{ valor: '', texto: 'Todas' }, ...categoriasDeposito]}
              />
            </div>
            {disponibles.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-neutral-400">
                {ingredientes.length === 0 ? 'No hay mercancía en el depósito todavía.' : 'Nada coincide.'}
              </p>
            ) : (
              <ul className="divide-y divide-neutral-100 max-h-[28rem] overflow-y-auto">
                {disponibles.map((ing) => {
                  const color = tonoDeCategoria.get(ing.categoria || '') ?? 'var(--color-neutral-400)'
                  return (
                    <li key={ing.id}>
                      <button
                        type="button"
                        onClick={() => agregar(ing)}
                        className="vp-celda w-full flex items-center gap-3 px-4 py-2.5 text-left"
                      >
                        <span aria-hidden className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm truncate">{ing.nombre}</span>
                          <span className="block text-[11px] text-neutral-400">{ing.categoria || 'Sin categoría'}</span>
                        </span>
                        <span className="text-xs text-neutral-500 tabular-nums">
                          ${ing.costo_efectivo.toFixed(3)} / {ing.unidad}
                        </span>
                        <span className="w-7 h-7 grid place-items-center rounded-full bg-neutral-100 text-neutral-600 text-base leading-none">+</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

// ── El vaso ─────────────────────────────────────────────────────────────────

// Geometria del recipiente (viewBox 260 x 400): boca en y=60, fondo en y=370.
const BOCA = 60
const FONDO = 370
const ALTO = FONDO - BOCA
const SILUETA = 'M36 60H224Q232 60 231 68L214 356Q213 370 199 370H61Q47 370 46 356L29 68Q28 60 36 60Z'

function Vaso({
  precio,
  partes,
  costo,
  resaltado,
  onResaltar,
}: {
  precio: number
  partes: Parte[]
  costo: number
  resaltado: number | null
  onResaltar: (id: number | null) => void
}) {
  // El borde del vaso es el precio... salvo que el costo se pase: entonces la
  // escala es el costo, el vaso queda lleno de mercancia y la linea del
  // precio se dibuja por debajo del borde, donde deberia haber parado.
  const tope = Math.max(precio, costo, 0.000001)
  const px = (v: number) => (v / tope) * ALTO
  const desbordado = costo > precio + 0.0001
  let y = FONDO
  const franjas = partes.map((p) => {
    const h = px(p.costo)
    y -= h
    return { ...p, y, h }
  })
  const margenH = desbordado ? 0 : px(precio - costo)
  const yMargen = y - margenH
  const yPrecio = FONDO - px(precio)
  const id = 'vaso-recorte'

  return (
    <svg viewBox="0 0 260 400" className="w-full max-w-[280px] mx-auto block" role="img" aria-label="Cuánto del precio se lleva cada mercancía">
      <defs>
        <clipPath id={id}>
          <path d={SILUETA} />
        </clipPath>
      </defs>

      {/* El precio, arriba del vaso: es el borde hasta donde se puede llenar. */}
      <text x="130" y="22" textAnchor="middle" fontSize="11" fill="var(--color-neutral-500)">
        se vende a
      </text>
      <text
        x="130"
        y="50"
        textAnchor="middle"
        fontSize="28"
        fontWeight="600"
        fill="var(--vp-tinta)"
        style={{ fontFamily: 'var(--font-display)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}
      >
        ${precio.toFixed(2)}
      </text>

      {/* Fondo del recipiente: vacio. */}
      <path d={SILUETA} fill="var(--color-neutral-100)" />

      <g clipPath={`url(#${id})`}>
        {/* Lo que queda hasta el borde: el margen, en verde. */}
        {margenH > 0.5 && partes.length > 0 && (
          <rect x="0" y={yMargen} width="260" height={margenH} fill="var(--color-exito-500)" opacity="0.9" />
        )}
        {/* Cada mercancia, una franja desde abajo. */}
        {franjas.map((f) => (
          <g key={f.id} onMouseEnter={() => onResaltar(f.id)} onMouseLeave={() => onResaltar(null)} style={{ cursor: 'default' }}>
            <rect x="0" y={f.y} width="260" height={f.h} fill={f.color} opacity={resaltado === null || resaltado === f.id ? 1 : 0.55} />
            {f.h >= 18 && (
              <>
                <text x="48" y={f.y + f.h / 2 + 4} fontSize="11" fontWeight="600" fill="var(--color-neutral-50)" style={{ paintOrder: 'stroke', stroke: 'rgb(0 0 0 / 0.25)', strokeWidth: 2 }}>
                  {f.nombre.length > 18 ? f.nombre.slice(0, 17) + '…' : f.nombre}
                </text>
                <text x="212" y={f.y + f.h / 2 + 4} textAnchor="end" fontSize="11" fontWeight="600" fill="var(--color-neutral-50)" style={{ paintOrder: 'stroke', stroke: 'rgb(0 0 0 / 0.25)', strokeWidth: 2, fontVariantNumeric: 'tabular-nums' }}>
                  ${f.costo.toFixed(2)}
                </text>
              </>
            )}
            {resaltado === f.id && <rect x="0" y={f.y} width="260" height={f.h} fill="none" stroke="var(--vp-tinta)" strokeWidth="2" />}
          </g>
        ))}
        {/* Con el vaso desbordado, la linea del precio queda dentro. */}
        {desbordado && (
          <>
            <line x1="20" x2="240" y1={yPrecio} y2={yPrecio} stroke="var(--color-peligro-600)" strokeWidth="2" strokeDasharray="6 4" />
            <text x="130" y={yPrecio - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--color-peligro-600)">
              hasta aquí llega el precio
            </text>
          </>
        )}
      </g>

      {/* El contorno, encima de todo. */}
      <path d={SILUETA} fill="none" stroke="var(--vp-tinta)" strokeOpacity="0.55" strokeWidth="2.5" strokeLinejoin="round" />

      {partes.length === 0 && (
        <text x="130" y="220" textAnchor="middle" fontSize="13" fill="var(--color-neutral-500)">
          Toca a la derecha lo que lleva
        </text>
      )}
      {margenH >= 22 && partes.length > 0 && (
        <text x="130" y={yMargen + margenH / 2 + 5} textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--color-neutral-50)" style={{ paintOrder: 'stroke', stroke: 'rgb(0 0 0 / 0.2)', strokeWidth: 2 }}>
          margen ${(precio - costo).toFixed(2)}
        </text>
      )}
    </svg>
  )
}

function Margen({
  precio,
  costoReal,
  costoTeorico,
  margen,
  margenPct,
  vacio,
}: {
  precio: number
  costoReal: number
  costoTeorico: number
  margen: number
  margenPct: number
  vacio: boolean
}) {
  if (vacio) {
    return (
      <p className="mt-4 text-sm text-neutral-500 text-center">
        Ponle lo que lleva y verás cuánto del precio se va en mercancía y cuánto te queda.
      </p>
    )
  }
  const pierde = margen < 0
  return (
    <div className="mt-4 space-y-2">
      <p className={`text-center font-display text-lg font-semibold tracking-tight ${pierde ? 'text-peligro-600' : 'text-exito-700'}`}>
        {pierde ? (
          <>
            Pierdes ${Math.abs(margen).toFixed(2)} por unidad
            <span className="block text-sm font-medium">el costo se pasa del precio un {Math.abs(margenPct).toFixed(0)}%</span>
          </>
        ) : (
          <>
            Tu margen es ${margen.toFixed(2)}
            <span className="block text-sm font-medium">el {margenPct.toFixed(0)}% de este producto</span>
          </>
        )}
      </p>
      <div className="flex justify-between text-xs text-neutral-500 tabular-nums pt-2 border-t border-neutral-100">
        <span>Cuesta hacerlo</span>
        <span className="font-semibold text-neutral-700">${costoReal.toFixed(2)}</span>
      </div>
      {Math.abs(costoTeorico - costoReal) > 0.0005 && (
        <div className="flex justify-between text-[11px] text-neutral-400 tabular-nums">
          <span>Sin la merma de cocina costaría</span>
          <span>${costoTeorico.toFixed(2)}</span>
        </div>
      )}
      {precio <= 0 && <p className="text-xs text-aviso-700">Este producto no tiene precio: ponlo en el menú.</p>}
    </div>
  )
}
