import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import { Secciones, useSeccion } from '../components/Secciones'
import { useDialogo } from '../components/dialogo'
import { contiene, palabrasDe } from '../components/Tabla'
import { Boton, Modal, Pagina } from '../components/ui'
import { Numerico } from '../components/Teclado'
import { api } from '../lib/api'
import { SUBSECCION_INICIAL } from '../lib/menu'
import { etiquetaVariante } from '../lib/menu'
import type { Categoria, CostoVariante, Ingrediente, RecetaItem, Variante } from '../lib/types'

const SUBSECCIONES_MENU = [
  { id: 'menu', texto: 'El menú' },
  { id: 'retiradas', texto: 'Fuera del menú' },
]

const SECCIONES_MODULO = [
  { id: 'menu', texto: 'Menú' },
  { id: 'recetas', texto: 'Recetas' },
]

const BR = '\n\n'

/**
 * Menú y recetas: un solo módulo con dos sub-secciones.
 *
 * Antes eran dos pantallas separadas en la barra lateral. Se unifican aquí
 * porque son la misma conversación --"qué vendo" y "de qué está hecho"-- pero
 * CADA UNA CONSERVA SU LÓGICA TAL CUAL ESTABA: `MenuSeccion` es exactamente
 * el antiguo módulo Menu y `RecetasSeccion` el antiguo módulo Recetas, solo
 * que ya no dibujan su propio NavBar ni su propia página: la envolvente de
 * abajo pone una sola vez el encabezado con las dos pestañas.
 */
export default function MenuYRecetas() {
  const [seccion, irA] = useSeccion(SECCIONES_MODULO)
  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Menú y recetas" secciones={SECCIONES_MODULO} seccion={seccion} alCambiarSeccion={irA} />
      <Pagina ancho="media">
        {seccion === 'menu' && <MenuSeccion />}
        {seccion === 'recetas' && <RecetasSeccion />}
      </Pagina>
    </div>
  )
}

function MenuSeccion() {
  const [seccion, irA] = useSeccion(SUBSECCIONES_MENU, 'ms')
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
    <>
      <Secciones secciones={SUBSECCIONES_MENU} activa={seccion} alCambiar={irA} />
      <div className="space-y-4">
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
      </div>
    </>
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
    await api.crearProducto(categoria.id, nuevoProducto.trim(), [{ nombre: SUBSECCION_INICIAL, precio: 0 }])
    setNuevoProducto('')
    onCambio()
  }

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
        <h2 className="font-semibold text-lg">{categoria.nombre}</h2>
        <div className="flex items-center gap-3">
          {/* Antes se adivinaba buscando la palabra "bebida" en el nombre de
              la categoria: una llamada "Jugos" o "Refrescos" dejaba de
              ofrecerse para acompañar la comida y nada lo decia. Lo marca el
              dueño, que es el unico que lo sabe. */}
          <label
            className="flex items-center gap-1.5 text-xs text-neutral-500 cursor-pointer"
            title="El mostrador ofrece estos productos para acompañar la comida"
          >
            <input
              type="checkbox"
              checked={categoria.bebida}
              onChange={async (e) => {
                await api.actualizarCategoria(categoria.id, { bebida: e.target.checked })
                onCambio()
              }}
              className="accent-acento-600"
            />
            Son bebidas
          </label>
          <button onClick={() => onBorrar(categoria.id)} className="text-peligro-500 text-xs">
            Borrar categoría
          </button>
        </div>
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
              {/* Con una sola subseccion, su nombre no aporta nada: la
                  pastilla dice el precio del producto y ya. Se mira cuantas
                  hay y no como se llama (ver lib/menu.ts). */}
              {producto.variantes.filter((x) => x.activo).length <= 1
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

function RecetasSeccion() {
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
    <>
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
                  const nombre = etiquetaVariante(p, v)
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
                          <Numerico
                            value={f.rendimientoDe}
                            onChange={(e) => actualizarFila(i, { rendimientoDe: e.target.value })}
                            className="w-20 border border-neutral-300 rounded-lg px-2 py-1"
                          />
                          <span>{ing?.unidad ?? 'unidad'} que compras salen</span>
                          <Numerico
                            value={f.rendimientoSalen}
                            onChange={(e) =>
                              actualizarFila(i, { rendimientoSalen: e.target.value })
                            }
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
                      <Numerico
                        value={f.cantidad_por_unidad}
                        onChange={(e) => actualizarFila(i, { cantidad_por_unidad: e.target.value })}
                        placeholder={`Cantidad utilizable por unidad${ing ? ` (${ing.unidad})` : ''}`}
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
    </>
  )
}
