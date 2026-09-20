import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import { useSeccion } from '../components/Secciones'
import { useDialogo } from '../components/dialogo'
import { contiene, palabrasDe } from '../components/Tabla'
import { Pagina } from '../components/ui'
import { Numerico } from '../components/Teclado'
import { api } from '../lib/api'
import type { Categoria, CostoVariante } from '../lib/types'

const SECCIONES = [
  { id: 'menu', texto: 'El menú' },
  { id: 'retiradas', texto: 'Fuera del menú' },
]

const BR = '\n\n'

export default function Menu() {
  const [seccion, irA] = useSeccion(SECCIONES)
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const dialogo = useDialogo()
  const [nuevaCategoria, setNuevaCategoria] = useState('')
  // Con un menu de cien variantes, encontrar "Empanada de pernil" para
  // cambiarle el precio era recorrer la pagina con el ojo. Busca por producto,
  // por variante y por categoria, sin acentos.
  const [busqueda, setBusqueda] = useState('')
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
    const cat = categorias.find((c) => c.id === id)
    const productos = cat?.productos.length ?? 0
    if (
      !(await dialogo.confirmar({
        titulo: `¿Quitar "${cat?.nombre}" del menú?`,
        texto:
          `Deja de aparecer en el punto de venta junto con sus ${productos} producto(s), ` +
          'pero las ventas que ya se hicieron se conservan intactas.\n\nSe puede volver a activar desde "Fuera del menú".',
        aceptar: 'Quitar',
        peligro: true,
      }))
    )
      return
    await api.eliminarCategoria(id)
    cargar()
  }

  async function reactivarCategoria(id: number) {
    await api.reactivarCategoria(id)
    cargar()
  }

  // Una categoria entra si coincide su nombre --y entonces se ve entera-- o
  // si algun producto suyo coincide, y entonces se ve solo con esos.
  const visibles = filtrarMenu(categorias.filter((c) => c.activo), busqueda)

  // Lo que se quito del menu, para poder devolverlo. Un producto retirado
  // dentro de una categoria retirada no se lista aparte: vuelve con ella.
  const catsRetiradas = categorias.filter((c) => !c.activo)
  const productosRetirados = categorias
    .filter((c) => c.activo)
    .flatMap((c) => c.productos.filter((p) => !p.activo).map((p) => ({ cat: c, p })))
  const variantesRetiradas = categorias
    .filter((c) => c.activo)
    .flatMap((c) =>
      c.productos
        .filter((p) => p.activo)
        .flatMap((p) => p.variantes.filter((v) => !v.activo).map((v) => ({ p, v }))),
    )
  const hayRetirados =
    catsRetiradas.length > 0 || productosRetirados.length > 0 || variantesRetiradas.length > 0

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Menú" secciones={SECCIONES} seccion={seccion} alCambiarSeccion={irA} />
      <Pagina ancho="media">
        {seccion === 'menu' && (
          <>
        {/* Agregar y buscar, ARRIBA. La caja de "nueva categoria" estaba al
            final de la pagina: con ocho categorias desplegadas habia que
            bajarlas todas para crear la novena. */}
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 flex flex-wrap gap-2">
          <input
            value={nuevaCategoria}
            onChange={(e) => setNuevaCategoria(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && agregarCategoria()}
            placeholder="Nueva categoría (ej. Bebidas)"
            className="flex-1 min-w-[12rem] border border-neutral-300 rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={agregarCategoria}
            className="bg-neutral-900 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Agregar
          </button>
        </div>

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
          <CategoriaCard
            key={cat.id}
            categoria={cat}
            costos={costos}
            onCambio={cargar}
            onBorrar={borrarCategoria}
          />
        ))}
        {busqueda.trim() && visibles.length === 0 && (
          <p className="text-sm text-neutral-400 text-center py-6">
            Ningún producto coincide con «{busqueda.trim()}».
          </p>
        )}
          </>
        )}

        {seccion === 'retiradas' && (
          <>
        {/* Retiradas del menu, no borradas: sus ventas siguen en el historico
            y se pueden volver a activar. Antes solo se listaban las
            CATEGORIAS; un producto o una presentacion que se quitaba no
            aparecia por ningun lado y no habia forma de traerlo de vuelta. */}
        {hayRetirados ? (
          <div className="bg-white rounded-2xl border border-neutral-200 p-4">
            <h2 className="font-semibold mb-1">Fuera del menú</h2>
            <p className="text-xs text-neutral-500 mb-3">
              No aparecen en el punto de venta. Sus ventas anteriores se conservan.
            </p>
            <div className="space-y-1">
              {catsRetiradas.map((c) => (
                <FilaRetirada
                  key={`c${c.id}`}
                  nombre={c.nombre}
                  detalle={`categoría · ${c.productos.length} producto(s)`}
                  onVolver={() => reactivarCategoria(c.id)}
                />
              ))}
              {productosRetirados.map(({ cat, p }) => (
                <FilaRetirada
                  key={`p${p.id}`}
                  nombre={p.nombre}
                  detalle={`producto de ${cat.nombre}`}
                  onVolver={async () => {
                    await api.reactivarProducto(p.id)
                    cargar()
                  }}
                />
              ))}
              {variantesRetiradas.map(({ p, v }) => (
                <FilaRetirada
                  key={`v${v.id}`}
                  nombre={`${p.nombre} - ${v.nombre}`}
                  detalle="presentación"
                  onVolver={async () => {
                    await api.reactivarVariante(v.id)
                    cargar()
                  }}
                />
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-neutral-400 text-center py-6">
            No has quitado nada del menú.
          </p>
        )}
          </>
        )}
      </Pagina>
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
    <div className="bg-white rounded-2xl border border-neutral-200 p-4">
      <div className="flex justify-between items-center mb-3">
        <h2 className="font-semibold text-lg">{categoria.nombre}</h2>
        <button onClick={() => onBorrar(categoria.id)} className="text-peligro-500 text-xs">
          Borrar categoría
        </button>
      </div>

      {/* Igual que la categoria: agregar va arriba. En una categoria con
          quince productos, el campo quedaba al fondo de la tarjeta. */}
      <div className="flex gap-2 mb-3">
        <input
          value={nuevoProducto}
          onChange={(e) => setNuevoProducto(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && agregarProducto()}
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

      {/* Solo lo que esta EN el menu. Quitar un producto lo retira
          (`activo = false`) para no romper las ventas viejas que lo
          nombran; mostrarlo igual hacia parecer que el boton no servia. Lo
          retirado se recupera desde "Fuera del menu". */}
      <div className="space-y-3">
        {categoria.productos
          .filter((producto) => producto.activo)
          .map((producto) => (
            <ProductoRow
              key={producto.id}
              producto={producto}
              costos={costos}
              onCambio={onCambio}
            />
          ))}
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
  const dialogo = useDialogo()
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
    // El costo promedio mira hacia atras. Para poner un precio hoy lo que
    // manda es cuanto cuesta reponer los insumos, que con inflacion puede ser
    // varias veces mas. Si difieren, se muestran los dos y el precio sugerido.
    const seEncarecio =
      info?.costo != null &&
      info.costo_reposicion != null &&
      info.costo_reposicion > info.costo * 1.05
    const contexto = info?.costo
      ? `\n\nProducirlo cuesta $${info.costo.toFixed(2)}. A $${precioActual.toFixed(2)} te deja ${info.margen_pct?.toFixed(0)}% de margen.` +
        (seEncarecio
          ? `\n\nOJO: con los precios de HOY cuesta $${info.costo_reposicion!.toFixed(2)}, ` +
            `y a $${precioActual.toFixed(2)} eso deja solo ${info.margen_reposicion_pct?.toFixed(0)}%.` +
            (info.precio_sugerido != null
              ? `\nPara mantener tu margen tendrías que cobrar $${info.precio_sugerido.toFixed(2)}.`
              : '')
          : '')
      : '\n\n(Este producto no tiene receta, así que no se sabe cuánto cuesta producirlo.)'
    const precio = await dialogo.pedirNumero({
      titulo: `Precio de ${nombre}`,
      texto: contexto.trim(),
      etiqueta: 'Nuevo precio',
      sufijo: '$',
      valor: precioActual,
    })
    if (precio === null) return

    if (info?.costo && precio < info.costo) {
      const perdida = (info.costo - precio).toFixed(2)
      const seguir = await dialogo.confirmar({
        titulo: 'Venderías por debajo del costo',
        texto: `A $${precio.toFixed(2)} pierdes $${perdida} en cada una: producirla cuesta $${info.costo.toFixed(2)}.`,
        aceptar: 'Ponerlo igual',
        peligro: true,
      })
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
    if (
      !(await dialogo.confirmar({
        titulo: `¿Quitar "${producto.nombre}" del menú?`,
        texto:
          'Deja de aparecer en el punto de venta, pero las ventas que ya se hicieron se ' +
          'conservan intactas.' +
          BR +
          'Se puede volver a activar desde "Fuera del menú".',
        aceptar: 'Quitar',
        peligro: true,
      }))
    )
      return
    await api.eliminarProducto(producto.id)
    onCambio()
  }

  return (
    <div className="border border-neutral-200 rounded-xl p-3">
      <div className="flex justify-between items-center mb-2">
        <span className="font-medium">{producto.nombre}</span>
        <button onClick={borrarProducto} className="text-peligro-500 text-xs">
          Quitar
        </button>
      </div>
      <div className="flex flex-wrap gap-2 mb-2">
        {/* Las retiradas no: la `x` las quita de la base pero seguian
            dibujadas, asi que el boton parecia no hacer nada. Se recuperan
            desde "Fuera del menu". */}
        {producto.variantes
          .filter((v) => v.activo)
          .map((v) => {
          const info = costos.get(v.id)
          const bajoCosto = info?.costo != null && v.precio < info.costo
          // El acantilado: el margen aguanta con el inventario viejo, pero no
          // con lo que cuesta reponer. Cuando ese stock se acabe, el margen que
          // queda es el de la derecha - y hasta ahora no se veia venir.
          const seDesploma =
            !bajoCosto &&
            info?.margen_pct != null &&
            info.margen_reposicion_pct != null &&
            info.margen_reposicion_pct < info.margen_pct - 5
          return (
          <span
            key={v.id}
            className={`rounded-full px-3 py-1 text-xs flex items-center gap-2 ${
              bajoCosto ? 'bg-peligro-50 ring-1 ring-peligro-300' : 'bg-neutral-100'
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
                    ? 'text-peligro-600 font-semibold'
                    : info.margen_pct >= 50
                      ? 'text-exito-600'
                      : 'text-aviso-600'
                }`}
                title={`Cuesta $${info.costo?.toFixed(2)} producirlo`}
              >
                {bajoCosto ? '¡a perdida!' : `${info.margen_pct.toFixed(0)}%`}
              </span>
            )}
            {seDesploma && (
              <span
                className={`tabular-nums ${
                  info!.margen_reposicion_pct! < 0
                    ? 'text-peligro-600 font-semibold'
                    : 'text-aviso-600'
                }`}
                title={
                  `Con los precios de hoy cuesta $${info!.costo_reposicion?.toFixed(2)} producirlo. ` +
                  (info!.precio_sugerido != null
                    ? `Para mantener tu margen: $${info!.precio_sugerido.toFixed(2)}.`
                    : '')
                }
              >
                → {info!.margen_reposicion_pct!.toFixed(0)}%
              </span>
            )}
            {info?.sin_receta && (
              <span className="text-aviso-700" title="Sin receta: no se sabe cuánto cuesta">
                sin receta
              </span>
            )}
            {producto.variantes.length > 1 && (
              <button onClick={() => borrarVariante(v.id)} className="text-peligro-400">
                x
              </button>
            )}
          </span>
          )
          })}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          value={nuevaVariante}
          onChange={(e) => setNuevaVariante(e.target.value)}
          placeholder="Subsección (ej. Grande)"
          className="flex-1 border border-neutral-300 rounded-lg px-2 py-1 text-xs"
        />
        <Numerico
          value={nuevoPrecio}
          onChange={(e) => setNuevoPrecio(e.target.value)}
          placeholder="Precio"
          className="w-20 border border-neutral-300 rounded-lg px-2 py-1 text-xs"
        />
        <button
          onClick={agregarVariante}
          className="bg-neutral-100 hover:bg-neutral-200 px-2 py-1 rounded-lg text-xs"
        >
          + Subsección
        </button>
      </div>
    </div>
  )
}

/**
 * El menu filtrado por texto, sin acentos y por palabras sueltas.
 *
 * Si coincide el nombre de la categoria se muestra entera; si no, se muestra
 * con los productos que coinciden. Una categoria sin nada que mostrar
 * desaparece: dejarla vacia haria parecer que el producto no existe.
 */
function filtrarMenu(categorias: Categoria[], texto: string): Categoria[] {
  const palabras = palabrasDe(texto)
  if (palabras.length === 0) return categorias

  const coincide = (donde: string) => contiene(donde, palabras)

  return categorias.flatMap((cat) => {
    if (coincide(cat.nombre)) return [cat]
    const productos = cat.productos.filter(
      (p) => coincide(`${cat.nombre} ${p.nombre}`) ||
        p.variantes.some((v) => coincide(`${p.nombre} ${v.nombre}`)),
    )
    return productos.length ? [{ ...cat, productos }] : []
  })
}

/** Una cosa retirada del menu, con su boton para devolverla. */
function FilaRetirada({
  nombre,
  detalle,
  onVolver,
}: {
  nombre: string
  detalle: string
  onVolver: () => void
}) {
  return (
    <div className="flex justify-between items-center gap-3 text-sm py-1">
      <span className="min-w-0">
        {nombre}
        <span className="text-xs text-neutral-400"> · {detalle}</span>
      </span>
      <button onClick={onVolver} className="text-acento-600 text-xs font-medium shrink-0">
        Volver a activar
      </button>
    </div>
  )
}
