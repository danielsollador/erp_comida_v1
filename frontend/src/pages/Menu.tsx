import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import NavBar from '../components/NavBar'
import { useSeccion } from '../components/Secciones'
import { useDialogo } from '../components/dialogo'
import { contiene, palabrasDe } from '../components/Tabla'
import { Pagina, Vacio } from '../components/ui'
import { Numerico } from '../components/Teclado'
import { api } from '../lib/api'
import { useArrastre } from '../lib/arrastre'
import { SUBSECCION_INICIAL } from '../lib/menu'
import { COLORES, NOMBRES_COLOR, NOMBRE_COLOR, colorCategoria } from '../lib/theme'
import Recetas from './partes/Recetas'
import type { Categoria, CostoVariante, Producto } from '../lib/types'

/**
 * El menú: qué se vende, a cuánto, y qué lleva cada cosa.
 *
 * COMO ESTABA. Todo desplegado en una sola columna: ocho categorías, cada una
 * con sus productos, cada producto con sus subsecciones, y tres formularios de
 * "agregar" siempre abiertos. Encontrar algo era recorrer la página entera con
 * el ojo, las acciones de borrar eran enlaces de texto pegados al contenido
 * --en una tablet, a un dedo de distancia-- y no había forma de renombrar una
 * categoría ni de mover un producto de una a otra: había que borrar y volver a
 * crear, perdiendo las subsecciones y las recetas.
 *
 * COMO ESTA. Leider (21-sep): "mucho más fácil de manejar, mucho más
 * intuitivo... si tengo un producto en una categoría y la quiero pasar para
 * otra, que lo pueda hacer con un drag and drop". Las reglas que se siguieron:
 *
 *   UNA COSA A LA VEZ    Las categorías a un lado y los productos de LA
 *                        elegida al otro. Lo que no estás mirando no compite.
 *   MANIPULACION DIRECTA Se arrastra el producto a la categoría, y las
 *                        categorías entre sí para ordenarlas. Con el dedo
 *                        (ver `lib/arrastre.ts`), que es como se usa esto.
 *   NADA IRREVERSIBLE    Quitar es retirar del menú, nunca borrar: las ventas
 *                        viejas siguen nombrando el producto. Se dice en el
 *                        momento y se deshace desde "Fuera del menú".
 *   LO PELIGROSO APARTE  Quitar vive dentro del menú de "⋯", no al lado del
 *                        nombre donde se toca sin querer.
 *   EDITAR DONDE SE LEE  El nombre y el precio se tocan y se cambian ahí
 *                        mismo.
 *
 * LAS RECETAS SON UNA SECCION DE AQUI, no un módulo aparte: qué lleva un
 * producto es parte de qué es ese producto, y separarlas obligaba a abrir dos
 * pantallas para una sola pregunta --"¿cuánto me deja esta empanada?".
 */
const SECCIONES = [
  { id: 'menu', texto: 'El menú' },
  { id: 'recetas', texto: 'Qué lleva cada uno' },
  { id: 'retiradas', texto: 'Fuera del menú' },
]

const BR = '\n\n'

export default function Menu() {
  const [seccion, irA] = useSeccion(SECCIONES)
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [costos, setCostos] = useState<Map<number, CostoVariante>>(new Map())
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    cargar()
  }, [])

  function cargar() {
    api.listarCategorias().then((cs) => {
      setCategorias(cs)
      setCargando(false)
    })
    // Una sola llamada para todo el menú: cuánto cuesta cada subsección y
    // cuál no tiene receta. Las recetas preguntaban variante por variante
    // --cien peticiones para abrir una pantalla-- y esto ya venía calculado.
    api.costosVariantes().then((cs) => setCostos(new Map(cs.map((c) => [c.variante_id, c]))))
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Menú y recetas" secciones={SECCIONES} seccion={seccion} alCambiarSeccion={irA} />
      <Pagina ancho="ancha">
        {seccion === 'menu' && (
          <ElMenu categorias={categorias} costos={costos} cargando={cargando} onCambio={cargar} />
        )}
        {seccion === 'recetas' && <Recetas categorias={categorias} costos={costos} onCambio={cargar} />}
        {seccion === 'retiradas' && <Retiradas categorias={categorias} onCambio={cargar} />}
      </Pagina>
    </div>
  )
}

// ── El menú ─────────────────────────────────────────────────────────────────

function ElMenu({
  categorias,
  costos,
  cargando,
  onCambio,
}: {
  categorias: Categoria[]
  costos: Map<number, CostoVariante>
  cargando: boolean
  onCambio: () => void
}) {
  const dialogo = useDialogo()
  const [busqueda, setBusqueda] = useState('')
  const [elegida, setElegida] = useState<number | null>(null)
  const [nuevaCategoria, setNuevaCategoria] = useState('')
  const [aviso, setAviso] = useState('')

  const activas = useMemo(() => categorias.filter((c) => c.activo), [categorias])
  // La primera vez, y cuando la elegida se retira, se cae en la primera.
  const actual = activas.find((c) => c.id === elegida) ?? activas[0] ?? null

  const buscando = palabrasDe(busqueda).length > 0
  const encontrados = useMemo(
    () => (buscando ? buscar(activas, busqueda) : []),
    [activas, busqueda, buscando],
  )

  /** Mover un producto a otra categoría, o una categoría a otro puesto. */
  const arrastre = useArrastre<{ tipo: 'producto'; producto: Producto } | { tipo: 'categoria'; id: number }>(
    async (carga, destino) => {
      const idDestino = Number(destino.replace('cat-', ''))
      if (!Number.isFinite(idDestino)) return
      if (carga.tipo === 'producto') {
        if (carga.producto.categoria_id === idDestino) return
        await api.actualizarProducto(carga.producto.id, {
          categoria_id: idDestino,
          nombre: carga.producto.nombre,
          activo: true,
        })
        const nombre = activas.find((c) => c.id === idDestino)?.nombre
        setAviso(`"${carga.producto.nombre}" pasó a ${nombre}.`)
        setElegida(idDestino)
      } else {
        if (carga.id === idDestino) return
        await reordenar(activas, carga.id, idDestino)
      }
      onCambio()
    },
  )

  // El aviso de "se movió" se retira solo: es una confirmación, no algo que
  // haya que cerrar.
  useEffect(() => {
    if (!aviso) return
    const t = window.setTimeout(() => setAviso(''), 4000)
    return () => window.clearTimeout(t)
  }, [aviso])

  async function agregarCategoria() {
    const nombre = nuevaCategoria.trim()
    if (!nombre) return
    const cat = await api.crearCategoria(nombre, activas.length)
    setNuevaCategoria('')
    setElegida(cat.id)
    onCambio()
  }

  async function quitarCategoria(cat: Categoria) {
    const cuantos = cat.productos.filter((p) => p.activo).length
    const ok = await dialogo.confirmar({
      titulo: `¿Quitar "${cat.nombre}" del menú?`,
      texto:
        `Deja de aparecer en el punto de venta junto con sus ${cuantos} producto(s).` +
        BR +
        'Las ventas que ya se hicieron se conservan intactas, y se puede devolver desde "Fuera del menú".',
      aceptar: 'Quitar del menú',
      peligro: true,
    })
    if (!ok) return
    await api.eliminarCategoria(cat.id)
    onCambio()
  }

  async function renombrarCategoria(cat: Categoria) {
    const nombre = await dialogo.pedirTexto({
      titulo: 'Nombre de la categoría',
      etiqueta: 'Se ve así en el punto de venta',
      valor: cat.nombre,
      aceptar: 'Guardar',
    })
    if (nombre === null || !nombre.trim() || nombre.trim() === cat.nombre) return
    await api.actualizarCategoria(cat.id, { nombre: nombre.trim() })
    onCambio()
  }

  if (cargando) return <p className="text-sm text-neutral-400 py-10 text-center">Cargando el menú…</p>

  if (activas.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-neutral-200">
        <Vacio
          icono="menu"
          titulo="Todavía no hay menú"
          detalle="Empieza por una categoría: Comida, Bebidas, Postres. Dentro van los productos y sus precios."
          accion={
            <div className="flex gap-2 max-w-sm mx-auto">
              <input
                value={nuevaCategoria}
                onChange={(e) => setNuevaCategoria(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && agregarCategoria()}
                placeholder="Ej. Comida"
                className="flex-1 border border-neutral-300 rounded-lg px-3 py-2 text-sm"
              />
              <button
                onClick={agregarCategoria}
                className="bg-neutral-900 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                Crear
              </button>
            </div>
          }
        />
      </div>
    )
  }

  return (
    <>
      <Buscador valor={busqueda} onCambio={setBusqueda} />

      {buscando ? (
        <div className="space-y-3">
          <p className="text-sm text-neutral-500">
            {encontrados.length === 0
              ? `Ningún producto coincide con «${busqueda.trim()}».`
              : `${encontrados.length} producto(s) con «${busqueda.trim()}»`}
          </p>
          {encontrados.map(({ cat, producto }) => (
            <TarjetaProducto
              key={producto.id}
              producto={producto}
              categoria={cat}
              categorias={activas}
              costos={costos}
              onCambio={onCambio}
              arrastre={arrastre}
              conCategoria
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[15rem_1fr] lg:grid-cols-[17rem_1fr] gap-4 lg:gap-5 items-start">
          <ListaCategorias
            categorias={activas}
            elegida={actual?.id ?? null}
            onElegir={setElegida}
            onRenombrar={renombrarCategoria}
            onQuitar={quitarCategoria}
            onCambio={onCambio}
            arrastre={arrastre}
            nueva={nuevaCategoria}
            onNueva={setNuevaCategoria}
            onAgregar={agregarCategoria}
          />
          {actual && (
            <ProductosDe
              categoria={actual}
              categorias={activas}
              costos={costos}
              onCambio={onCambio}
              arrastre={arrastre}
            />
          )}
        </div>
      )}

      {/* El fantasma de lo que se está moviendo, pegado al dedo. Sin esto, al
          arrastrar no pasa nada visible hasta soltar y no se sabe si el gesto
          fue tomado. */}
      {arrastre.carga && arrastre.punto && (
        <div
          className="fixed z-50 pointer-events-none rounded-xl bg-neutral-900 text-white text-sm font-medium px-3 py-2 shadow-xl"
          style={{ left: arrastre.punto.x + 12, top: arrastre.punto.y - 14 }}
        >
          {arrastre.carga.tipo === 'producto'
            ? arrastre.carga.producto.nombre
            : activas.find((c) => c.id === (arrastre.carga as { id: number }).id)?.nombre}
        </div>
      )}

      {aviso && (
        <p
          role="status"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 rounded-full bg-neutral-900 text-white text-sm px-4 py-2 shadow-lg"
        >
          {aviso}
        </p>
      )}
    </>
  )
}

/**
 * Las categorías: la columna de la izquierda y, a la vez, el sitio donde se
 * sueltan los productos.
 */
function ListaCategorias({
  categorias,
  elegida,
  onElegir,
  onRenombrar,
  onQuitar,
  onCambio,
  arrastre,
  nueva,
  onNueva,
  onAgregar,
}: {
  categorias: Categoria[]
  elegida: number | null
  onElegir: (id: number) => void
  onRenombrar: (c: Categoria) => void
  onQuitar: (c: Categoria) => void
  onCambio: () => void
  arrastre: Arrastre
  nueva: string
  onNueva: (v: string) => void
  onAgregar: () => void
}) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-2 md:sticky md:top-[84px]">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400 px-2 pt-1.5 pb-2">
        Categorías
      </p>
      <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-1 md:pb-0">
        {categorias.map((cat) => {
          const activa = cat.id === elegida
          const encima = arrastre.sobre === `cat-${cat.id}` && arrastre.carga !== null
          return (
            <div
              key={cat.id}
              data-soltar={`cat-${cat.id}`}
              className={`group flex items-center gap-1 rounded-xl shrink-0 md:shrink transition ${
                encima
                  ? 'bg-acento-50 ring-2 ring-acento-400'
                  : activa
                    ? 'bg-neutral-100'
                    : 'hover:bg-neutral-50'
              }`}
            >
              {/* El agarre es suyo y no de toda la fila: así tocar la
                  categoría la abre, que es lo que se hace mil veces, y
                  arrastrar es un gesto aparte que no se dispara sin querer. */}
              <button
                aria-label={`Mover ${cat.nombre} de puesto`}
                onPointerDown={(e) => arrastre.empezar(e, { tipo: 'categoria', id: cat.id })}
                className="hidden md:grid place-items-center w-7 h-10 shrink-0 text-neutral-300 group-hover:text-neutral-500 cursor-grab touch-none"
              >
                <Puntos />
              </button>
              <button
                onClick={() => onElegir(cat.id)}
                aria-current={activa ? 'true' : undefined}
                className="flex-1 min-w-0 text-left px-2 md:px-1 py-2.5 min-h-[40px]"
              >
                <span className={`flex items-center gap-1.5 text-sm ${activa ? 'font-semibold' : ''}`}>
                  {/* El mismo color con el que se pinta en el mostrador: aqui
                      se elige y aqui se ve, sin tener que ir a mirar. */}
                  <span
                    aria-hidden
                    className={`w-2 h-2 rounded-full shrink-0 ${colorCategoria(cat.id, cat.color).dot}`}
                  />
                  <span className="truncate">{cat.nombre}</span>
                </span>
                <span className="block text-[11px] text-neutral-400">
                  {cat.productos.filter((p) => p.activo).length} producto(s)
                  {cat.bebida && ' · bebidas'}
                </span>
              </button>
              <MenuAcciones
                etiqueta={`Opciones de ${cat.nombre}`}
                encabezado={
                  <Colores
                    elegido={cat.color}
                    onElegir={async (color) => {
                      await api.actualizarCategoria(cat.id, { color })
                      onCambio()
                    }}
                  />
                }
                opciones={[
                  { texto: 'Renombrar', onElegir: () => onRenombrar(cat) },
                  {
                    texto: cat.bebida ? 'No son bebidas' : 'Son bebidas',
                    ayuda: 'El mostrador ofrece las bebidas para acompañar la comida',
                    onElegir: async () => {
                      await api.actualizarCategoria(cat.id, { bebida: !cat.bebida })
                      onCambio()
                    },
                  },
                  { texto: 'Quitar del menú', peligro: true, onElegir: () => onQuitar(cat) },
                ]}
              />
            </div>
          )
        })}
      </div>

      <div className="flex gap-1.5 p-2 pt-2.5 mt-1 border-t border-neutral-100">
        <input
          value={nueva}
          onChange={(e) => onNueva(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAgregar()}
          placeholder="Nueva categoría"
          aria-label="Nueva categoría"
          className="flex-1 min-w-0 border border-neutral-200 rounded-lg px-2.5 py-2 text-sm"
        />
        <button
          onClick={onAgregar}
          disabled={!nueva.trim()}
          className="bg-neutral-900 text-white px-3 rounded-lg text-sm font-medium disabled:opacity-30"
        >
          +
        </button>
      </div>
    </div>
  )
}

type Arrastre = ReturnType<
  typeof useArrastre<{ tipo: 'producto'; producto: Producto } | { tipo: 'categoria'; id: number }>
>

/** Los productos de la categoría abierta. */
function ProductosDe({
  categoria,
  categorias,
  costos,
  onCambio,
  arrastre,
}: {
  categoria: Categoria
  categorias: Categoria[]
  costos: Map<number, CostoVariante>
  onCambio: () => void
  arrastre: Arrastre
}) {
  const [nuevo, setNuevo] = useState('')
  const productos = categoria.productos.filter((p) => p.activo)

  async function agregar() {
    const nombre = nuevo.trim()
    if (!nombre) return
    await api.crearProducto(categoria.id, nombre, [{ nombre: SUBSECCION_INICIAL, precio: 0 }])
    setNuevo('')
    onCambio()
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl border border-neutral-200 p-3 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold text-lg px-1 mr-auto">{categoria.nombre}</h2>
        <input
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && agregar()}
          placeholder="Nuevo producto (ej. Empanada)"
          aria-label="Nuevo producto"
          className="flex-1 min-w-[11rem] border border-neutral-200 rounded-lg px-3 py-2 text-sm"
        />
        <button
          onClick={agregar}
          disabled={!nuevo.trim()}
          className="bg-neutral-900 text-white px-3.5 py-2 rounded-lg text-sm font-medium disabled:opacity-30"
        >
          + Producto
        </button>
      </div>

      {productos.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200">
          <Vacio
            titulo={`"${categoria.nombre}" está vacía`}
            detalle="Escribe arriba el primer producto. También puedes arrastrar uno de otra categoría hasta aquí."
          />
        </div>
      ) : (
        productos.map((producto) => (
          <TarjetaProducto
            key={producto.id}
            producto={producto}
            categoria={categoria}
            categorias={categorias}
            costos={costos}
            onCambio={onCambio}
            arrastre={arrastre}
          />
        ))
      )}
    </div>
  )
}

/** Un producto con sus subsecciones y precios. */
function TarjetaProducto({
  producto,
  categoria,
  categorias,
  costos,
  onCambio,
  arrastre,
  conCategoria = false,
}: {
  producto: Producto
  categoria: Categoria
  categorias: Categoria[]
  costos: Map<number, CostoVariante>
  onCambio: () => void
  arrastre: Arrastre
  /** En los resultados de búsqueda se dice de qué categoría es cada uno. */
  conCategoria?: boolean
}) {
  const dialogo = useDialogo()
  const [nuevaVariante, setNuevaVariante] = useState('')
  const [nuevoPrecio, setNuevoPrecio] = useState('')
  const [abierto, setAbierto] = useState(false)
  const variantes = producto.variantes.filter((v) => v.activo)
  const moviendose = arrastre.carga?.tipo === 'producto' && arrastre.carga.producto.id === producto.id

  async function renombrar() {
    const nombre = await dialogo.pedirTexto({
      titulo: 'Nombre del producto',
      etiqueta: 'Se ve así en el punto de venta y en el ticket',
      valor: producto.nombre,
      aceptar: 'Guardar',
    })
    if (nombre === null || !nombre.trim() || nombre.trim() === producto.nombre) return
    await api.actualizarProducto(producto.id, {
      categoria_id: producto.categoria_id,
      nombre: nombre.trim(),
      activo: true,
    })
    onCambio()
  }

  async function mover() {
    const otras = categorias.filter((c) => c.id !== producto.categoria_id)
    if (otras.length === 0) return
    const destino = await dialogo.elegir({
      titulo: `¿A qué categoría pasa "${producto.nombre}"?`,
      texto: 'Se lleva sus subsecciones, sus precios y su receta.',
      opciones: otras.map((c) => ({ valor: String(c.id), texto: c.nombre })),
    })
    if (destino === null) return
    await api.actualizarProducto(producto.id, {
      categoria_id: Number(destino),
      nombre: producto.nombre,
      activo: true,
    })
    onCambio()
  }

  async function quitar() {
    const ok = await dialogo.confirmar({
      titulo: `¿Quitar "${producto.nombre}" del menú?`,
      texto:
        'Deja de aparecer en el punto de venta.' +
        BR +
        'Las ventas que ya se hicieron se conservan intactas, y se puede devolver desde "Fuera del menú".',
      aceptar: 'Quitar del menú',
      peligro: true,
    })
    if (!ok) return
    await api.eliminarProducto(producto.id)
    onCambio()
  }

  async function cambiarPrecio(varianteId: number, nombre: string, precioActual: number) {
    // El costo va EN la pregunta, no después: es el dato que decide si el
    // precio tiene sentido, y el sistema ya lo tiene.
    const info = costos.get(varianteId)
    // El costo promedio mira hacia atrás. Para poner un precio hoy lo que
    // manda es cuánto cuesta reponer los insumos, que con inflación puede ser
    // varias veces más. Si difieren, se muestran los dos y el precio sugerido.
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

  async function agregarVariante() {
    const precio = Number(String(nuevoPrecio).replace(',', '.'))
    if (!nuevaVariante.trim() || !Number.isFinite(precio) || precio < 0) return
    await api.crearVariante(producto.id, nuevaVariante.trim(), precio)
    setNuevaVariante('')
    setNuevoPrecio('')
    onCambio()
  }

  return (
    <div
      className={`bg-white rounded-2xl border p-3 transition ${
        moviendose ? 'border-acento-400 opacity-50' : 'border-neutral-200'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <button
          aria-label={`Mover ${producto.nombre} a otra categoría`}
          title="Arrástralo hasta la categoría a la que va"
          onPointerDown={(e) => arrastre.empezar(e, { tipo: 'producto', producto })}
          className="grid place-items-center w-7 h-10 shrink-0 text-neutral-300 hover:text-neutral-500 cursor-grab touch-none"
        >
          <Puntos />
        </button>
        <button onClick={renombrar} className="min-w-0 text-left flex-1 py-1.5">
          <span className="font-medium">{producto.nombre}</span>
          {conCategoria && <span className="text-xs text-neutral-400"> · {categoria.nombre}</span>}
        </button>
        <MenuAcciones
          etiqueta={`Opciones de ${producto.nombre}`}
          opciones={[
            { texto: 'Renombrar', onElegir: renombrar },
            { texto: 'Mover a otra categoría…', onElegir: mover },
            { texto: 'Quitar del menú', peligro: true, onElegir: quitar },
          ]}
        />
      </div>

      <div className="flex flex-wrap gap-1.5 mt-2 pl-8">
        {variantes.map((v) => {
          const info = costos.get(v.id)
          const bajoCosto = info?.costo != null && v.precio < info.costo
          // El acantilado: el margen aguanta con el inventario viejo, pero no
          // con lo que cuesta reponer. Cuando ese stock se acabe, el margen
          // que queda es el de la derecha -- y así se ve venir.
          const seDesploma =
            !bajoCosto &&
            info?.margen_pct != null &&
            info.margen_reposicion_pct != null &&
            info.margen_reposicion_pct < info.margen_pct - 5
          return (
            <span
              key={v.id}
              className={`rounded-full pl-3 pr-1 py-1 text-xs flex items-center gap-2 ${
                bajoCosto ? 'bg-peligro-50 ring-1 ring-peligro-300' : 'bg-neutral-100'
              }`}
            >
              <button
                onClick={() => cambiarPrecio(v.id, v.nombre, v.precio)}
                className="py-1 font-medium tabular-nums"
              >
                {/* Con una sola subsección, su nombre no aporta nada: la
                    pastilla dice el precio del producto y ya. */}
                {variantes.length <= 1 ? `$${v.precio.toFixed(2)}` : `${v.nombre}: $${v.precio.toFixed(2)}`}
              </button>
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
                  {bajoCosto ? '¡a pérdida!' : `${info.margen_pct.toFixed(0)}%`}
                </span>
              )}
              {seDesploma && (
                <span
                  className={`tabular-nums ${
                    info!.margen_reposicion_pct! < 0 ? 'text-peligro-600 font-semibold' : 'text-aviso-600'
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
              {variantes.length > 1 ? (
                <button
                  onClick={async () => {
                    await api.eliminarVariante(v.id)
                    onCambio()
                  }}
                  aria-label={`Quitar ${v.nombre}`}
                  className="w-6 h-6 grid place-items-center rounded-full text-neutral-400 hover:bg-peligro-100 hover:text-peligro-600"
                >
                  ×
                </button>
              ) : (
                <span className="w-1" />
              )}
            </span>
          )
        })}

        {/* Agregar una subsección se pide, no estorba: el formulario vivía
            abierto en cada producto y triplicaba lo que hay que leer. */}
        {abierto ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <input
              value={nuevaVariante}
              onChange={(e) => setNuevaVariante(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && agregarVariante()}
              placeholder="Ej. Grande"
              aria-label="Nombre de la subsección"
              autoFocus
              className="w-28 border border-neutral-300 rounded-lg px-2 py-1.5 text-xs"
            />
            <Numerico
              value={nuevoPrecio}
              onChange={(e) => setNuevoPrecio(e.target.value)}
              placeholder="Precio"
              aria-label="Precio de la subsección"
              className="w-20 border border-neutral-300 rounded-lg px-2 py-1.5 text-xs"
            />
            <button
              onClick={agregarVariante}
              className="bg-neutral-900 text-white px-2.5 py-1.5 rounded-lg text-xs font-medium"
            >
              Agregar
            </button>
            <button
              onClick={() => setAbierto(false)}
              className="text-neutral-500 px-1.5 py-1.5 text-xs"
            >
              Cancelar
            </button>
          </span>
        ) : (
          <button
            onClick={() => setAbierto(true)}
            className="rounded-full px-3 py-1.5 text-xs font-medium text-neutral-500 border border-dashed border-neutral-300 hover:border-neutral-400 hover:text-neutral-800"
          >
            + Subsección
          </button>
        )}
      </div>
    </div>
  )
}

// ── Fuera del menú ──────────────────────────────────────────────────────────

function Retiradas({ categorias, onCambio }: { categorias: Categoria[]; onCambio: () => void }) {
  const cats = categorias.filter((c) => !c.activo)
  // Un producto retirado dentro de una categoría retirada no se lista aparte:
  // vuelve con ella.
  const productos = categorias
    .filter((c) => c.activo)
    .flatMap((c) => c.productos.filter((p) => !p.activo).map((p) => ({ cat: c, p })))
  const variantes = categorias
    .filter((c) => c.activo)
    .flatMap((c) =>
      c.productos
        .filter((p) => p.activo)
        .flatMap((p) => p.variantes.filter((v) => !v.activo).map((v) => ({ p, v }))),
    )
  const hay = cats.length > 0 || productos.length > 0 || variantes.length > 0

  if (!hay) {
    return (
      <div className="bg-white rounded-2xl border border-neutral-200">
        <Vacio
          titulo="No has quitado nada del menú"
          detalle="Lo que quites aparece aquí para poder devolverlo. Nada se borra: las ventas viejas siguen nombrándolo."
        />
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4">
      <h2 className="font-semibold">Fuera del menú</h2>
      <p className="text-xs text-neutral-500 mt-0.5 mb-3">
        No aparecen en el punto de venta. Sus ventas anteriores se conservan.
      </p>
      <div className="divide-y divide-neutral-100">
        {cats.map((c) => (
          <FilaRetirada
            key={`c${c.id}`}
            nombre={c.nombre}
            detalle={`categoría · ${c.productos.length} producto(s)`}
            onVolver={async () => {
              await api.reactivarCategoria(c.id)
              onCambio()
            }}
          />
        ))}
        {productos.map(({ cat, p }) => (
          <FilaRetirada
            key={`p${p.id}`}
            nombre={p.nombre}
            detalle={`producto de ${cat.nombre}`}
            onVolver={async () => {
              await api.reactivarProducto(p.id)
              onCambio()
            }}
          />
        ))}
        {variantes.map(({ p, v }) => (
          <FilaRetirada
            key={`v${v.id}`}
            nombre={`${p.nombre} - ${v.nombre}`}
            detalle="subsección"
            onVolver={async () => {
              await api.reactivarVariante(v.id)
              onCambio()
            }}
          />
        ))}
      </div>
    </div>
  )
}

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
    <div className="flex justify-between items-center gap-3 text-sm py-2">
      <span className="min-w-0">
        {nombre}
        <span className="text-xs text-neutral-400"> · {detalle}</span>
      </span>
      <button
        onClick={onVolver}
        className="text-acento-600 text-sm font-medium shrink-0 px-2 py-1.5 rounded-lg hover:bg-acento-50"
      >
        Devolver al menú
      </button>
    </div>
  )
}

// ── Piezas sueltas ──────────────────────────────────────────────────────────

function Buscador({ valor, onCambio }: { valor: string; onCambio: (v: string) => void }) {
  return (
    <div className="relative">
      <input
        type="search"
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCambio('')}
        placeholder="Buscar un producto en todo el menú"
        aria-label="Buscar un producto en todo el menú"
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
  )
}

/** El agarre: seis puntos, que es como se dibuja "esto se arrastra". */
function Puntos() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden>
      <circle cx="6" cy="3" r="1.3" />
      <circle cx="10" cy="3" r="1.3" />
      <circle cx="6" cy="8" r="1.3" />
      <circle cx="10" cy="8" r="1.3" />
      <circle cx="6" cy="13" r="1.3" />
      <circle cx="10" cy="13" r="1.3" />
    </svg>
  )
}

type Opcion = { texto: string; ayuda?: string; peligro?: boolean; onElegir: () => void }

/**
 * El menú de "⋯".
 *
 * Lo que borra no puede estar al lado de lo que se toca todo el día: en una
 * tablet, "Borrar categoría" como enlace de texto pegado al nombre estaba a un
 * dedo mal puesto de distancia.
 */
function MenuAcciones({
  etiqueta,
  opciones,
  encabezado,
}: {
  etiqueta: string
  opciones: Opcion[]
  /** Algo que se elige de un toque y no cierra el menu, como el color. */
  encabezado?: ReactNode
}) {
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false)
    }
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false)
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', escape)
    }
  }, [abierto])

  return (
    <div ref={caja} className="relative shrink-0">
      <button
        onClick={() => setAbierto((v) => !v)}
        aria-label={etiqueta}
        aria-haspopup="menu"
        aria-expanded={abierto}
        className="w-9 h-9 grid place-items-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden>
          <circle cx="3" cy="8" r="1.5" />
          <circle cx="8" cy="8" r="1.5" />
          <circle cx="13" cy="8" r="1.5" />
        </svg>
      </button>
      {abierto && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-30 w-56 rounded-xl border border-neutral-200 bg-white shadow-lg p-1"
        >
          {encabezado}
          {opciones.map((o) => (
            <button
              key={o.texto}
              role="menuitem"
              onClick={() => {
                setAbierto(false)
                o.onElegir()
              }}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm hover:bg-neutral-50 ${
                o.peligro ? 'text-peligro-600' : ''
              }`}
            >
              {o.texto}
              {o.ayuda && <span className="block text-[11px] text-neutral-400">{o.ayuda}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Reglas ──────────────────────────────────────────────────────────────────

/** Los productos que coinciden, con la categoría a la que pertenecen. */
function buscar(categorias: Categoria[], texto: string): { cat: Categoria; producto: Producto }[] {
  const palabras = palabrasDe(texto)
  if (palabras.length === 0) return []
  return categorias.flatMap((cat) =>
    cat.productos
      .filter(
        (p) =>
          p.activo &&
          (contiene(`${cat.nombre} ${p.nombre}`, palabras) ||
            p.variantes.some((v) => contiene(`${p.nombre} ${v.nombre}`, palabras))),
      )
      .map((producto) => ({ cat, producto })),
  )
}

/**
 * Poner una categoría en el puesto de otra.
 *
 * Se reescribe el `orden` de todas y no solo el de la que se movió: los
 * números venían de cuándo se creó cada una (0, 1, 2…) y podían estar
 * repetidos, así que un solo cambio dejaba dos con el mismo puesto y el
 * mostrador las ordenaba como le diera la gana.
 */
async function reordenar(categorias: Categoria[], id: number, sobre: number) {
  const orden = categorias.map((c) => c.id).filter((x) => x !== id)
  const donde = orden.indexOf(sobre)
  if (donde < 0) return
  orden.splice(donde, 0, id)
  await Promise.all(orden.map((cid, i) => api.actualizarCategoria(cid, { orden: i })))
}

/**
 * Los cinco tintes, para elegir de un toque.
 *
 * Cinco y no una rueda de color: la paleta del sistema tiene cinco y con mas
 * se pierde --un menu de doce colores inventados deja de parecer el mismo
 * aplicativo, y en modo oscuro la mitad no se leen. Ver `lib/theme.ts`.
 */
function Colores({
  elegido,
  onElegir,
}: {
  elegido: string
  onElegir: (color: string) => void
}) {
  return (
    <div className="px-2 pt-1.5 pb-2 border-b border-neutral-100 mb-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-1.5">
        Color en el mostrador
      </p>
      <div className="flex gap-1.5">
        {NOMBRES_COLOR.map((c) => (
          <button
            key={c}
            onClick={() => onElegir(c)}
            aria-label={NOMBRE_COLOR[c]}
            aria-pressed={elegido === c}
            title={NOMBRE_COLOR[c]}
            className={`w-8 h-8 rounded-lg grid place-items-center border-2 ${
              elegido === c ? 'border-neutral-900' : 'border-transparent hover:border-neutral-300'
            }`}
          >
            <span className={`w-5 h-5 rounded-md ${COLORES[c].dot}`} />
          </button>
        ))}
      </div>
    </div>
  )
}
