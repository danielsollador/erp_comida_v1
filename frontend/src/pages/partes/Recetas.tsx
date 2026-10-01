import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Tabla, Th, contiene, palabrasDe, useOrden } from '../../components/Tabla'
import { Boton, Cifra, FiltroDesplegable, Vacio } from '../../components/ui'
import { Numerico } from '../../components/Teclado'
import { useDialogo } from '../../components/dialogo'
import { useGuardiaDeSalida } from '../../lib/sinGuardar'
import Vaso, { ResumenVaso, type ParteVaso } from '../../components/Vaso'
import { api } from '../../lib/api'
import { etiquetaVariante } from '../../lib/menu'
import { PALETA } from '../../lib/paleta'
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
  // Se escribe en la unidad chica (g en vez de kg, ml en vez de lt). La receta
  // se guarda siempre en la unidad de la mercancia; esto es solo como se ve.
  enChica?: boolean
}

/** La unidad "chica" de una grande, y al reves: kg⇄g, lt⇄ml. */
const OTRA_UNIDAD: Record<string, string> = { kg: 'g', g: 'kg', lt: 'ml', ml: 'lt' }
const esGrande = (u: string) => u === 'kg' || u === 'lt'
const sinRuido = (n: number) => String(Math.round(n * 1e6) / 1e6)

type Renglon = {
  variante: Variante
  nombre: string
  categoria: string
  info?: CostoVariante
  // El producto al que pertenece: la tabla agrupa sus variantes bajo el.
  productoId: number
  producto: string
  varianteNombre: string
}

// Los tintes de las franjas. Salen de la paleta (index.css) y esquivan el
// verde --que es el margen-- y el rojo --que es la perdida--, para que el
// vaso se lea sin leyenda.
//
// UNO POR MERCANCIA, EN EL ORDEN DE LA RECETA, y no por categoria: harina y
// carne molida son las dos "Secos" y salian del mismo color, pegadas, como
// una sola franja (Leider, 29-sep). Vecinas siempre distintas.
// De la paleta de datos (lib/paleta.ts): cobre, cobre oscuro, cobre claro
// y neutros calidos, alternados para que dos vecinas nunca se parezcan.
const TONOS = [PALETA.serie[0], PALETA.serie[3], PALETA.serie[2], PALETA.serie[1], PALETA.serie[5], PALETA.serie[6], PALETA.serie[4], PALETA.serie[7]]
const tono = (i: number) => TONOS[i % TONOS.length]
const dolares = (n: number) => `$${n.toFixed(2)}`

/** Lo que se cuenta por piezas y no se pesa: el vaso, la tapa, el pitillo,
 *  la caja. Tambien es costo, y va en su propio apartado. */
const porUnidad = (ing: Ingrediente) => ing.unidad === 'unidad' || ing.unidad === 'paquete'


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
  // Lo que se guardo por ultima vez, para saber si hay cambios sin guardar.
  const [huellaGuardada, setHuellaGuardada] = useState('')
  const dialogo = useDialogo()
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [soloFaltan, setSoloFaltan] = useState(false)
  // Por categoria del menu, como en todas las pantallas: "" = todas.
  const [categoria, setCategoria] = useState('')
  // `?v=<variante>` ES LA RECETA ABIERTA. Asi llegan "Ponle lo que lleva"
  // desde la tarjeta del menu y el paso que sigue a crear un producto, y
  // asi la flecha de volver (o el boton atras del navegador) cierra la
  // receta y vuelve a la lista en vez de saltar a la portada (Leider,
  // 1-oct). Abrir empuja `v`; cerrar lo quita.
  const [params, setParams] = useSearchParams()
  // Las columnas se ordenan y cada una explica que es (Leider, 1-oct: "le
  // faltan campos arriba, que expliquen que es cada cosa").
  const orden = useOrden<Renglon>({
    producto: (r) => r.nombre,
    categoria: (r) => r.categoria,
    // Sin receta no hay costo: va al final, que es donde no estorba.
    costo: (r) => r.info?.costo ?? -1,
    precio: (r) => r.variante.precio,
    // Por la plata que deja, que es lo primero que dice la columna.
    ganancia: (r) => (r.info?.sin_receta === false && r.info.costo != null ? r.variante.precio - r.info.costo : -1e9),
  })
  // Que productos estan desglosados en sus variantes. Buscando o filtrando
  // se abren todos: lo que se busca esta dentro.
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set())

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
                  productoId: p.id,
                  producto: p.nombre,
                  varianteNombre: v.nombre,
                })),
            ),
        ),
    [categorias, costos],
  )

  const faltan = renglones.filter((r) => r.info?.sin_receta !== false).length

  const palabras = palabrasDe(busqueda)
  const visibles = renglones.filter((r) => {
    if (categoria && r.categoria !== categoria) return false
    if (soloFaltan && r.info?.sin_receta === false) return false
    if (palabras.length === 0) return true
    return contiene(`${r.categoria} ${r.nombre}`, palabras)
  })

  const opcionesCategoria = useMemo(() => {
    const cuenta = new Map<string, number>()
    for (const r of renglones) cuenta.set(r.categoria, (cuenta.get(r.categoria) ?? 0) + 1)
    return [
      { valor: '', texto: 'Todas', contador: renglones.length },
      ...[...cuenta.entries()].map(([nombre, n]) => ({ valor: nombre, texto: nombre, contador: n })),
    ]
  }, [renglones])

  // Las dos cifras de arriba, de lo que se esta viendo (la categoria
  // filtrada): cuantos tienen receta, y cuanto deja el producto TIPICO.
  // La mediana y no el promedio: un solo producto a perdida (-3050%) volvia
  // el promedio "-314% del precio", un numero que no era de nadie (Leider,
  // 1-oct). Y cuantos estan a perdida, que es lo que hay que ir a arreglar.
  const delFiltro = renglones.filter((r) => !categoria || r.categoria === categoria)
  const conReceta = delFiltro.filter((r) => r.info?.sin_receta === false && r.info.costo != null)
  const margenes = conReceta.map((r) => r.info!.margen_pct ?? 0).sort((a, b) => a - b)
  const margenTipico = margenes.length
    ? margenes.length % 2
      ? margenes[(margenes.length - 1) / 2]
      : (margenes[margenes.length / 2 - 1] + margenes[margenes.length / 2]) / 2
    : 0
  const aPerdida = margenes.filter((m) => m < 0).length

  const pedida = params.get('v')
  useEffect(() => {
    if (pedida) {
      if (abierta && String(abierta.variante.id) === pedida) return
      if (renglones.length === 0) return
      const r = renglones.find((x) => String(x.variante.id) === pedida)
      if (r) void abrir(r, true)
      else {
        const p = new URLSearchParams(params)
        p.delete('v')
        setParams(p, { replace: true })
      }
    } else if (abierta) {
      // Se fue `v` (atras del navegador, la flecha): la receta se cierra.
      setAbierta(null)
      setFilas([])
    }
    // Solo cuando cambia `v` o aparecen los renglones; `abrir` no cambia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedida, renglones])

  async function abrir(r: Renglon, desdeUrl = false) {
    setError('')
    setAbierta(r)
    if (!desdeUrl) {
      const p = new URLSearchParams(params)
      p.set('v', String(r.variante.id))
      setParams(p)
    }
    const receta = await api.verReceta(r.variante.id)
    const iniciales: Fila[] = receta.map((x: RecetaItem) => ({
      ingrediente_id: x.ingrediente_id,
      cantidad_por_unidad: String(x.cantidad_por_unidad),
      rendimientoDe: '',
      rendimientoSalen: '',
      modoRendimiento: false,
    }))
    setFilas(iniciales)
    setHuellaGuardada(huella(iniciales))
  }

  // Solo lo que se guarda: mercancia y cantidad. Abrir la calculadora o
  // cambiar de kg a g no es un cambio de receta.
  function huella(fs: Fila[]): string {
    // Una mercancia recien agregada, aun sin cantidad, ya es un cambio.
    return fs
      .filter((f) => f.ingrediente_id)
      .map((f) => `${f.ingrediente_id}:${Number(f.cantidad_por_unidad) || 0}`)
      .sort()
      .join('|')
  }

  function cerrar() {
    setAbierta(null)
    setFilas([])
    if (params.get('v')) {
      const p = new URLSearchParams(params)
      p.delete('v')
      setParams(p, { replace: true })
    }
  }

  /** Salir con cambios sin guardar pide confirmacion (Leider, 29-sep). */
  const hayCambios = abierta !== null && huella(filas) !== huellaGuardada
  const preguntar = useCallback(
    () =>
      dialogo.confirmar({
        titulo: `¿Salir sin guardar la receta de ${abierta?.nombre ?? 'este producto'}?`,
        texto: 'Lo que cambiaste se pierde. Si quieres conservarlo, vuelve y toca «Guardar receta».',
        aceptar: 'Salir sin guardar',
        peligro: true,
      }),
    [dialogo, abierta],
  )
  // Y no solo "← Productos": la flecha de volver, las pestañas, la barra
  // lateral y recargar tambien preguntan mientras haya cambios.
  useGuardiaDeSalida(hayCambios, preguntar)

  async function salir() {
    if (hayCambios && !(await preguntar())) return
    cerrar()
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
        onCerrar={() => void salir()}
      />
    )
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Cifra
          titulo="Productos con receta"
          valor={`${conReceta.length} de ${delFiltro.length}`}
          detalle={
            delFiltro.length - conReceta.length > 0
              ? `${delFiltro.length - conReceta.length} sin receta: no se sabe cuánto cuestan ni cuánto dejan`
              : 'Todos tienen receta: el costo y el margen son de fiar'
          }
          tono={delFiltro.length - conReceta.length > 0 ? 'alerta' : 'bien'}
        />
        <Cifra
          titulo="Ganancia que deja el producto típico"
          valor={conReceta.length ? `${margenTipico.toFixed(0)}% del precio` : '—'}
          detalle={
            !conReceta.length
              ? 'Ponles receta para saberlo'
              : aPerdida > 0
                ? `${aPerdida} ${aPerdida === 1 ? 'producto se vende' : 'productos se venden'} a pérdida`
                : 'ninguno a pérdida'
          }
          tono={!conReceta.length ? 'normal' : aPerdida > 0 || margenTipico < 30 ? 'alerta' : 'bien'}
        />
      </div>

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
        <FiltroDesplegable etiqueta="Categoría" valor={categoria} alCambiar={setCategoria} opciones={opcionesCategoria} />
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
            titulo={
              soloFaltan
                ? `Todos tienen receta${categoria ? ` en ${categoria}` : ''}`
                : busqueda.trim()
                  ? `Nada coincide con «${busqueda.trim()}»`
                  : `Nada en ${categoria || 'esta categoría'}`
            }
            detalle={soloFaltan ? 'El costo y el margen de Reportes son de fiar.' : undefined}
          />
        ) : (
          <Tabla orden={orden} glosario="recetas">
            <table className="w-full text-sm">
              <thead className="text-neutral-500 text-xs uppercase">
                <tr>
                  <Th clave="producto" className="py-2 pl-4 pr-0">Producto</Th>
                  <Th clave="costo" alinear="derecha" className="py-2 px-0 hidden sm:table-cell">Cuesta hacerlo</Th>
                  <Th clave="precio" alinear="derecha" className="py-2 px-0">Precio</Th>
                  <Th clave="ganancia" alinear="derecha" className="py-2 pl-0 pr-4">Ganancia</Th>
                </tr>
              </thead>
              <tbody>
                {/* JERARQUIA: un producto con varias variantes es UNA fila
                    que se toca para desglosarlas (Leider, 1-oct). La fila
                    del producto no lleva cifras --cada variante tiene las
                    suyas-- solo cuantas son y cuantas faltan. Con una sola
                    variante, el producto es la fila y ya. */}
                {agrupar(orden.ordenar(visibles)).map((g) => {
                  if (g.renglones.length === 1) {
                    const r = g.renglones[0]
                    return <FilaReceta key={r.variante.id} r={r} nombre={r.nombre} onAbrir={() => void abrir(r)} />
                  }
                  const desglosado = abiertos.has(g.productoId) || palabras.length > 0 || soloFaltan
                  const sinReceta = g.renglones.filter((r) => r.info?.sin_receta !== false).length
                  return (
                    <Fragment key={`p${g.productoId}`}>
                      <tr
                        role="button"
                        tabIndex={0}
                        aria-expanded={desglosado}
                        onClick={() =>
                          setAbiertos((prev) => {
                            const n = new Set(prev)
                            if (n.has(g.productoId)) n.delete(g.productoId)
                            else n.add(g.productoId)
                            return n
                          })
                        }
                        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLElement).click()}
                        className="vp-celda cursor-pointer border-t border-neutral-100"
                      >
                        <td colSpan={4} className="py-2.5 pl-4 pr-4">
                          <span className="flex items-center gap-2 min-w-0">
                            <span
                              aria-hidden
                              className={`vp-flecha shrink-0 opacity-60 transition-transform ${desglosado ? 'rotate-180' : ''}`}
                            />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{g.producto}</span>
                              <span className="block text-[11px] text-neutral-400 truncate">
                                {g.categoria}
                                <span className="text-neutral-300"> · </span>
                                {g.renglones.length} variantes
                                {sinReceta > 0 && (
                                  <>
                                    <span className="text-neutral-300"> · </span>
                                    <span className="font-semibold text-acento-700">
                                      {sinReceta === g.renglones.length ? 'sin receta' : `${sinReceta} sin receta`}
                                    </span>
                                  </>
                                )}
                                <span className="text-neutral-300"> · </span>
                                {desglosado ? 'Toca para plegar' : 'Toca para ver las variantes'}
                              </span>
                            </span>
                          </span>
                        </td>
                      </tr>
                      {desglosado &&
                        g.renglones.map((r) => (
                          <FilaReceta key={r.variante.id} r={r} nombre={r.varianteNombre} sangria onAbrir={() => void abrir(r)} />
                        ))}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </Tabla>
        )}
      </div>
    </>
  )
}

/** Las filas ya ordenadas, juntas por producto y en el orden en que aparece el primero de cada uno. */
function agrupar(renglones: Renglon[]) {
  const grupos: { productoId: number; producto: string; categoria: string; renglones: Renglon[] }[] = []
  const porId = new Map<number, (typeof grupos)[number]>()
  for (const r of renglones) {
    let g = porId.get(r.productoId)
    if (!g) {
      g = { productoId: r.productoId, producto: r.producto, categoria: r.categoria, renglones: [] }
      porId.set(r.productoId, g)
      grupos.push(g)
    }
    g.renglones.push(r)
  }
  return grupos
}

/**
 * Una fila de la tabla: un producto de una sola variante, o una variante
 * dentro de su producto (con sangria). Se toca para armar o cambiar la
 * receta, y lo dice.
 */
function FilaReceta({ r, nombre, sangria = false, onAbrir }: { r: Renglon; nombre: string; sangria?: boolean; onAbrir: () => void }) {
  const falta = r.info?.sin_receta !== false
  const margen = falta ? null : r.info?.margen_pct
  const costo = falta ? null : (r.info?.costo ?? null)
  const precio = r.variante.precio
  // La ganancia en plata y en porcentaje, las dos (Leider, 1-oct): lo que
  // deja cada uno y que parte del precio es. A perdida, en negativo y rojo.
  const ganancia = costo != null ? precio - costo : null
  return (
    <tr
      role="button"
      tabIndex={0}
      onClick={onAbrir}
      onKeyDown={(e) => e.key === 'Enter' && onAbrir()}
      className={`vp-celda cursor-pointer border-t border-neutral-100 ${sangria ? 'bg-neutral-50/60' : ''}`}
    >
      <td className={`py-2.5 pr-2 min-w-0 ${sangria ? 'pl-10' : 'pl-4'}`}>
        <span className={`block truncate ${sangria ? '' : 'font-medium'}`}>{nombre}</span>
        {/* QUE SE TOCA, DICHO. Una fila que abre algo no se distingue de una
            que solo informa; el dueño no sabia que aqui se arma la receta
            (Leider, 1-oct). Y la que no tiene receta lo pide en cobre. */}
        <span className="block text-[11px] text-neutral-400 truncate">
          {!sangria && (
            <>
              {r.categoria}
              <span className="text-neutral-300"> · </span>
            </>
          )}
          {falta ? (
            <span className="font-semibold text-acento-700">Toca para crear la receta</span>
          ) : (
            <span>Toca para editar la receta</span>
          )}
        </span>
      </td>
      <td className="py-2.5 text-right tabular-nums text-neutral-600 hidden sm:table-cell whitespace-nowrap">
        {costo != null ? `$${costo.toFixed(2)}` : <span className="text-neutral-300">—</span>}
      </td>
      <td className="py-2.5 text-right tabular-nums whitespace-nowrap">${precio.toFixed(2)}</td>
      <td
        className={`py-2.5 pr-4 text-right tabular-nums whitespace-nowrap ${
          ganancia == null ? '' : ganancia < 0 ? 'text-peligro-600' : margen != null && margen >= 50 ? 'text-exito-600' : 'text-aviso-600'
        }`}
      >
        {ganancia == null || margen == null ? (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-aviso-700 bg-aviso-50 rounded px-1.5 py-0.5">
            sin receta
          </span>
        ) : (
          <>
            <span className="block font-semibold">
              {ganancia < 0 ? '−' : '+'}${Math.abs(ganancia).toFixed(2)}
            </span>
            <span className="block text-[11px]">{ganancia < 0 ? 'a pérdida' : `${margen.toFixed(0)}% del precio`}</span>
          </>
        )}
      </td>
    </tr>
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
  const [resaltado, setResaltado] = useState<number | string | null>(null)
  const precio = renglon.variante.precio

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
      {
        ingrediente_id: ing.id,
        // Un vaso es un vaso: lo que se cuenta por piezas entra con 1.
        cantidad_por_unidad: porUnidad(ing) ? '1' : '',
        rendimientoDe: '',
        rendimientoSalen: '',
        modoRendimiento: false,
        // Gramos y mililitros por defecto (Leider, 1-oct).
        enChica: esGrande(ing.unidad),
      },
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

  // Costo real: descontando la merma de cocina (`costo_efectivo`).
  const partes: ParteVaso[] = []
  const colorDe = new Map<number, string>()
  let costoReal = 0
  filas.forEach((f, i) => {
    const ing = mapaIngredientes.get(f.ingrediente_id)
    if (!ing) return
    colorDe.set(ing.id, tono(i))
    const cantidad = Number(f.cantidad_por_unidad) || 0
    const costo = cantidad * ing.costo_efectivo
    costoReal += costo
    if (costo > 0) partes.push({ id: ing.id, nombre: ing.nombre, valor: costo, color: tono(i) })
  })
  const esPieza = (f: Fila) => {
    const ing = mapaIngredientes.get(f.ingrediente_id)
    return Boolean(ing && porUnidad(ing))
  }
  const pesadas = filas.filter((f) => mapaIngredientes.has(f.ingrediente_id) && !esPieza(f))
  const piezas = filas.filter(esPieza)
  const disponiblesPesadas = disponibles.filter((i) => !porUnidad(i))
  const disponiblesPiezas = disponibles.filter(porUnidad)

  return (
    <div className="space-y-3 lg:h-[calc(100dvh-11.25rem)] lg:flex lg:flex-col">
      <div className="flex items-center justify-between gap-3 flex-wrap shrink-0">
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

      {/* EN UNA PANTALLA, sin desplazar la pagina (Leider, 29-sep): la
          cuadricula mide lo que queda de ventana y lo que no cabe se
          desplaza dentro de su columna. */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start lg:items-stretch lg:flex-1 lg:min-h-0">
        {/* ── El producto ─────────────────────────────────────────────── */}
        <section className="vp-losa p-4 sm:p-5 lg:flex lg:flex-col lg:min-h-0">
          <p className="text-xs text-neutral-500">{renglon.categoria}</p>
          <h2 className="font-display text-xl font-semibold tracking-tight leading-tight mb-2">{renglon.nombre}</h2>
          {/* El vaso ocupa lo que queda entre el titulo y el resumen: asi la
              tarjeta nunca es mas alta que la ventana. */}
          <div className="lg:flex-1 lg:min-h-0 flex justify-center">
          <Vaso
            className="w-full max-w-[260px] lg:w-auto lg:max-w-none lg:h-full lg:min-h-0"
            tope={precio}
            topeTitulo="se vende a"
            partes={partes}
            restoNombre="margen"
            desbordeTexto="hasta aquí llega el precio"
            vacioTexto="Toca a la derecha lo que lleva"
            formato={dolares}
            resaltado={resaltado}
            onResaltar={setResaltado}
          />
          </div>
          <Margen precio={precio} costoReal={costoReal} vacio={filas.length === 0} />
        </section>

        {/* ── La mercancía ────────────────────────────────────────────── */}
        <section className="space-y-3 lg:flex lg:flex-col lg:min-h-0">
          {filas.length > 0 && (
            <div className="vp-losa overflow-hidden lg:shrink lg:min-h-0 lg:max-h-[45%] lg:overflow-y-auto">
              {pesadas.length > 0 && (
                <>
                  <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Lleva</p>
                  <ul className="divide-y divide-neutral-100">
                    {pesadas.map((f) => (
                      <RenglonReceta
                        key={f.ingrediente_id}
                        f={f}
                        ing={mapaIngredientes.get(f.ingrediente_id)!}
                        color={colorDe.get(f.ingrediente_id) ?? 'var(--color-neutral-400)'}
                        resaltado={resaltado === f.ingrediente_id}
                        onResaltar={setResaltado}
                        onCambio={(c) => actualizarFila(f.ingrediente_id, c)}
                        onQuitar={() => quitar(f.ingrediente_id)}
                        onRendimiento={() => aplicarRendimiento(f)}
                      />
                    ))}
                  </ul>
                </>
              )}
              {/* Lo que se cuenta por piezas va aparte: el vaso, la tapa, la
                  caja. No se pesa, no lleva rendimiento, y es tan costo como
                  la carne (Leider, 29-sep). */}
              {piezas.length > 0 && (
                <>
                  <p
                    className={`px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 ${
                      pesadas.length > 0 ? 'border-t border-neutral-100' : ''
                    }`}
                  >
                    Por unidad · vaso, tapa, empaque
                  </p>
                  <ul className="divide-y divide-neutral-100">
                    {piezas.map((f) => (
                      <RenglonReceta
                        key={f.ingrediente_id}
                        f={f}
                        ing={mapaIngredientes.get(f.ingrediente_id)!}
                        color={colorDe.get(f.ingrediente_id) ?? 'var(--color-neutral-400)'}
                        resaltado={resaltado === f.ingrediente_id}
                        onResaltar={setResaltado}
                        onCambio={(c) => actualizarFila(f.ingrediente_id, c)}
                        onQuitar={() => quitar(f.ingrediente_id)}
                        onRendimiento={() => aplicarRendimiento(f)}
                      />
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          <div className="vp-losa overflow-hidden lg:flex-1 lg:min-h-0 lg:flex lg:flex-col">
            <div className="px-4 pt-3 pb-2 flex flex-wrap items-center gap-2 shrink-0">
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
              <div className="max-h-[30rem] lg:max-h-none lg:flex-1 lg:min-h-0 overflow-y-auto">
                {disponiblesPesadas.length > 0 && (
                  <ul className="divide-y divide-neutral-100">
                    {disponiblesPesadas.map((ing) => (
                      <OpcionMercancia key={ing.id} ing={ing} onAgregar={() => agregar(ing)} />
                    ))}
                  </ul>
                )}
                {disponiblesPiezas.length > 0 && (
                  <>
                    <p className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500 border-t border-neutral-100">
                      Por unidad · vaso, tapa, empaque
                    </p>
                    <ul className="divide-y divide-neutral-100">
                      {disponiblesPiezas.map((ing) => (
                        <OpcionMercancia key={ing.id} ing={ing} onAgregar={() => agregar(ing)} />
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function RenglonReceta({
  f,
  ing,
  color,
  resaltado,
  onResaltar,
  onCambio,
  onQuitar,
  onRendimiento,
}: {
  f: Fila
  ing: Ingrediente
  color: string
  resaltado: boolean
  onResaltar: (id: number | null) => void
  onCambio: (c: Partial<Fila>) => void
  onQuitar: () => void
  onRendimiento: () => void
}) {
  const cantidad = Number(f.cantidad_por_unidad) || 0
  const pieza = porUnidad(ing)
  // MUCHOS MIDEN EN GRAMOS Y MILILITROS aunque compren por kilo y por litro
  // (Leider, 29-sep). La unidad es un boton: kg ⇄ g, lt ⇄ ml. Lo que se
  // escribe en la chica se guarda convertido a la de la mercancia, asi el
  // costo y el inventario no se enteran del cambio.
  const otra = OTRA_UNIDAD[ing.unidad]
  // Sin decision escrita, en la chica: gramos y mililitros por defecto
  // (Leider, 1-oct). Asi vale tambien para las recetas que se cargan antes
  // de que llegue la lista de mercancia.
  const enChica = Boolean(otra && (f.enChica ?? esGrande(ing.unidad)))
  const factor = enChica ? (esGrande(ing.unidad) ? 1000 : 1 / 1000) : 1
  const unidadVista = enChica ? otra : ing.unidad
  const valorVisto = f.cantidad_por_unidad === '' ? '' : sinRuido((Number(f.cantidad_por_unidad) || 0) * factor)
  const escribir = (texto: string) => {
    if (!enChica) return onCambio({ cantidad_por_unidad: texto })
    const n = Number(String(texto).replace(',', '.'))
    onCambio({ cantidad_por_unidad: texto === '' || !Number.isFinite(n) ? texto : sinRuido(n / factor) })
  }
  return (
    <li
      onMouseEnter={() => onResaltar(ing.id)}
      onMouseLeave={() => onResaltar(null)}
      className={`px-4 py-2.5 ${resaltado ? 'bg-neutral-50' : ''}`}
    >
      <div className="flex items-center gap-3">
        <span aria-hidden className="w-1.5 self-stretch min-h-[28px] rounded-full shrink-0" style={{ background: color }} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium truncate">{ing.nombre}</span>
          <span className="block text-[11px] text-neutral-400">
            {enChica ? `$${(ing.costo_efectivo / factor).toFixed(4)} por ${otra}` : `$${ing.costo_efectivo.toFixed(3)} por ${ing.unidad}`}
            {ing.categoria && ` · ${ing.categoria}`}
          </span>
        </span>
        <Numerico
          value={valorVisto}
          onChange={(e) => escribir(e.target.value)}
          placeholder="0"
          entero={pieza}
          etiqueta={`${ing.nombre} (${unidadVista})`}
          aria-label={`Cantidad de ${ing.nombre} por unidad, en ${unidadVista}`}
          autoFocus={f.cantidad_por_unidad === ''}
          className="w-20 border border-neutral-300 rounded-lg px-2 py-1.5 text-sm text-right tabular-nums"
        />
        {otra ? (
          <button
            type="button"
            onClick={() => onCambio({ enChica: !enChica })}
            title={`Ver en ${enChica ? ing.unidad : otra}`}
            className="w-12 shrink-0 rounded-md bg-neutral-100 hover:bg-neutral-200 px-1 py-1 text-xs font-semibold text-neutral-700 tabular-nums"
          >
            {unidadVista} ⇄
          </button>
        ) : (
          <span className="w-12 shrink-0 text-xs text-neutral-500">{pieza ? (cantidad === 1 ? 'pieza' : 'piezas') : ing.unidad}</span>
        )}
        <span className="w-16 text-right text-sm tabular-nums font-semibold">
          {cantidad > 0 ? `$${(cantidad * ing.costo_efectivo).toFixed(2)}` : '—'}
        </span>
        <button
          type="button"
          onClick={onQuitar}
          aria-label={`Quitar ${ing.nombre}`}
          className="w-8 h-8 shrink-0 grid place-items-center rounded-lg text-neutral-400 hover:bg-peligro-50 hover:text-peligro-600"
        >
          ×
        </button>
      </div>
      {/* La calculadora "de X salen Y", plegada: sirve cuando se mide sobre
          lo comprado y no sobre cada unidad. Una pieza no se calcula. */}
      {pieza ? null : f.modoRendimiento ? (
        <div className="mt-2 ml-4 flex flex-wrap items-center gap-2 text-sm">
          <span>De</span>
          <Numerico
            value={f.rendimientoDe}
            onChange={(e) => onCambio({ rendimientoDe: e.target.value })}
            aria-label="Cantidad que compras"
            className="w-16 border border-neutral-300 rounded-lg px-2 py-1 text-sm"
          />
          <span>{ing.unidad} salen</span>
          <Numerico
            value={f.rendimientoSalen}
            onChange={(e) => onCambio({ rendimientoSalen: e.target.value })}
            aria-label="Unidades que salen"
            className="w-16 border border-neutral-300 rounded-lg px-2 py-1 text-sm"
          />
          <span>unidades</span>
          <button type="button" onClick={onRendimiento} className="rounded-lg bg-neutral-900 text-white px-2.5 py-1 text-xs font-medium">
            Calcular
          </button>
          <button type="button" onClick={() => onCambio({ modoRendimiento: false })} className="text-xs text-neutral-500">
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
          onClick={() => onCambio({ modoRendimiento: true })}
          className="ml-4 mt-1 text-[11px] text-neutral-400 hover:text-neutral-700"
        >
          ¿No sabes cuánto lleva cada una? Calcúlalo: de X salen Y
        </button>
      )}
    </li>
  )
}

function OpcionMercancia({ ing, onAgregar }: { ing: Ingrediente; onAgregar: () => void }) {
  return (
    <li>
      <button type="button" onClick={onAgregar} className="vp-celda w-full flex items-center gap-3 px-4 py-2.5 text-left">
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
}

function Margen({ precio, costoReal, vacio }: { precio: number; costoReal: number; vacio: boolean }) {
  if (vacio) {
    return (
      <p className="mt-4 text-sm text-neutral-500 text-center">
        Ponle lo que lleva y verás cuánto del precio se va en mercancía y cuánto te queda.
      </p>
    )
  }
  return (
    <div className="mt-4 space-y-2">
      <ResumenVaso tope={precio} costo={costoReal} formato={dolares} queda="Tu margen es" pierde="Pierdes por unidad" de="de este producto" />
      <div className="flex justify-between text-xs text-neutral-500 tabular-nums pt-2 border-t border-neutral-100">
        <span>Cuesta hacerlo</span>
        <span className="font-semibold text-neutral-700">${costoReal.toFixed(2)}</span>
      </div>
      {precio <= 0 && <p className="text-xs text-aviso-700">Este producto no tiene precio: ponlo en el menú.</p>}
    </div>
  )
}
