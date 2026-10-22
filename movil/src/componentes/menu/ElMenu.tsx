import { router, type Href } from 'expo-router'
import { useMemo, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SUBSECCION_INICIAL } from '../../../../frontend/src/lib/menu'
import { apiMenu } from '../../lib/api-menu'
import { confirmar } from '../../lib/dialogo'
import { dolares } from '../../lib/formato'
import { useMoneda } from '../../lib/moneda'
import { LETRA, useModo, useTema } from '../../lib/tema'
import type { Categoria, CostoVariante, Producto, Variante } from '../../lib/tipos'
import { Hoja, OpcionHoja } from '../Hoja'
import Icono from '../Icono'
import { Buscador, HojaFormulario, useDisposicion, Vacio } from '../kit'
import { Boton, Ficha, Nota, Titulo } from '../ui'
import { puntoCategoria } from './colores'
import { contiene, cuantosRetirados, palabrasDe, plural, type DatosMenu } from './datos'
import { CambiarPrecio, Colores, CrearCategoria, CrearProducto, NuevaVariante } from './Formularios'
import { BotonPuntos, BotonTexto, PedirTexto, Rotulo, useTostada } from './piezas'

/**
 * EL MENU: que se vende y a cuanto (la seccion "El menú" de pages/Menu.tsx).
 *
 * UNA COSA A LA VEZ: las categorias arriba --una tira que se desliza, como
 * la web en el telefono-- y abajo los productos de LA elegida. En la tablet,
 * las categorias a un lado y los productos al otro, como la web.
 *
 * ARRASTRAR NO: en la web los productos se arrastran a otra categoria y las
 * categorias entre si. Con el pulgar, sobre una lista que ademas se desliza,
 * arrastrar se dispara sin querer; aqui eso mismo esta en el "⋯": Subir,
 * Bajar y Mover a otra categoria.
 *
 * NADA IRREVERSIBLE: quitar es retirar del menu, nunca borrar. Se hace de una
 * y abajo queda "Deshacer"; lo retirado vuelve desde "Lo que quitaste".
 */

type Tostada = ReturnType<typeof useTostada>

type Hojas =
  | { tipo: 'categoria'; cat: Categoria }
  | { tipo: 'producto'; producto: Producto; subir?: () => Promise<void>; bajar?: () => Promise<void> }
  | { tipo: 'mover'; producto: Producto }

type Cuadro =
  | { tipo: 'crear-categoria' }
  | { tipo: 'crear-producto'; categoriaId: number }
  | { tipo: 'renombrar-categoria'; cat: Categoria }
  | { tipo: 'renombrar-producto'; producto: Producto }
  | { tipo: 'variante'; producto: Producto }
  | { tipo: 'precio'; producto: Producto; variante: Variante; titulo: string; texto: string }
  | { tipo: 'retiradas' }

export default function ElMenu({
  datos,
  recargar,
  tostada,
  alCrearProducto,
}: {
  datos: DatosMenu
  recargar: () => Promise<void>
  tostada: Tostada
  /** Un producto nuevo se va derecho a su receta (Leider, 8-oct). */
  alCrearProducto: (varianteId: number) => void
}) {
  const t = useTema()
  const { tablet } = useDisposicion()
  const { categorias, costos } = datos
  const [busqueda, setBusqueda] = useState('')
  const [elegida, setElegida] = useState<number | null>(null)
  const [hoja, setHoja] = useState<Hojas | null>(null)
  const [cuadro, setCuadro] = useState<Cuadro | null>(null)
  // Cada cuadro se monta de nuevo al abrirse: nace limpio.
  const [vez, setVez] = useState(0)

  const activas = useMemo(() => categorias.filter((c) => c.activo), [categorias])
  // La primera vez, y cuando la elegida se retira, se cae en la primera.
  const actual = activas.find((c) => c.id === elegida) ?? activas[0] ?? null
  const retirados = useMemo(() => cuantosRetirados(categorias), [categorias])

  const buscando = palabrasDe(busqueda).length > 0
  const encontrados = useMemo(() => buscar(activas, palabrasDe(busqueda)), [activas, busqueda])

  function abrir(c: Cuadro) {
    setVez((v) => v + 1)
    setCuadro(c)
  }

  // La hoja se cierra ANTES de abrir lo que sigue: en iPhone un cuadro (o
  // una alerta) que se abre mientras otra hoja baja se pierde sin mostrarse.
  function cerrarHojaY(accion: () => void) {
    setHoja(null)
    setTimeout(accion, 350)
  }

  /** Lo que cambia el menu: se hace, se recarga, y si falla se dice abajo. */
  async function hacer(accion: () => Promise<unknown>) {
    try {
      await accion()
    } catch (e) {
      tostada.fallo(e)
    }
    await recargar()
  }

  // ── Categorias ──

  async function crearCategoria(nombre: string, color: string, vaACocina: boolean) {
    const cat = await apiMenu.crearCategoria(nombre, activas.length)
    // El color y lo de cocina van en un segundo paso porque el alta solo
    // acepta nombre y orden; para quien lo usa es un solo gesto.
    if (color || !vaACocina) await apiMenu.actualizarCategoria(cat.id, { color, va_a_cocina: vaACocina })
    setElegida(cat.id)
    setCuadro(null)
    await recargar()
  }

  function quitarCategoria(cat: Categoria) {
    const cuantos = cat.productos.filter((p) => p.activo).length
    void tostada.deshacible({
      texto: cuantos
        ? `«${cat.nombre}» y sus ${plural(cuantos, 'producto', 'productos')} fuera del menú`
        : `«${cat.nombre}» fuera del menú`,
      ejecutar: () => apiMenu.eliminarCategoria(cat.id),
      revertir: () => apiMenu.reactivarCategoria(cat.id),
      alTerminar: recargar,
    })
  }

  /**
   * Poner una categoria un puesto mas arriba o mas abajo. Se reescribe el
   * `orden` de todas (como `reordenar` de la web): los numeros venian de
   * cuando se creo cada una y podian estar repetidos.
   */
  function moverCategoria(cat: Categoria, paso: -1 | 1) {
    const orden = activas.map((c) => c.id)
    const i = orden.indexOf(cat.id)
    const j = i + paso
    if (i < 0 || j < 0 || j >= orden.length) return
    ;[orden[i], orden[j]] = [orden[j], orden[i]]
    void hacer(() => Promise.all(orden.map((id, puesto) => apiMenu.actualizarCategoria(id, { orden: puesto }))))
  }

  // ── Productos ──

  async function crearProducto(categoriaId: number, nombre: string, precio: number) {
    const creado = await apiMenu.crearProducto(categoriaId, nombre, [{ nombre: SUBSECCION_INICIAL, precio }])
    setElegida(categoriaId)
    setCuadro(null)
    // UN PRODUCTO NACE Y SE VA DERECHO A SU RECETA (Leider, 8-oct): sin
    // receta se vende sin saber cuanto deja, y nadie vuelve despues a
    // buscarla. Sin preguntar.
    await recargar()
    const variante = creado.variantes?.[0]
    if (variante) alCrearProducto(variante.id)
  }

  function quitarProducto(p: Producto) {
    void tostada.deshacible({
      texto: `«${p.nombre}» fuera del menú`,
      ejecutar: () => apiMenu.eliminarProducto(p.id),
      revertir: () => apiMenu.reactivarProducto(p.id),
      alTerminar: recargar,
    })
  }

  function quitarVariante(p: Producto, v: Variante) {
    void tostada.deshacible({
      texto: `«${p.nombre} - ${v.nombre}» fuera del menú`,
      ejecutar: () => apiMenu.eliminarVariante(v.id),
      revertir: () => apiMenu.reactivarVariante(v.id),
      alTerminar: recargar,
    })
  }

  async function moverA(p: Producto, cat: Categoria) {
    await hacer(() => apiMenu.actualizarProducto(p.id, { categoria_id: cat.id, nombre: p.nombre, activo: true }))
    tostada.avisar(`"${p.nombre}" pasó a ${cat.nombre}.`)
    setElegida(cat.id)
  }

  /**
   * El precio, con el costo EN la pregunta: producirlo cuesta tanto y a ese
   * precio deja tanto. Si con los precios de HOY cuesta bastante mas, se
   * dicen los dos. Los montos van en dolares, como el precio que se escribe.
   */
  function pedirPrecio(p: Producto, v: Variante) {
    const info = costos.get(v.id)
    const seEncarecio = info?.costo != null && info.costo_reposicion != null && info.costo_reposicion > info.costo * 1.05
    const texto = info?.costo
      ? `Producirlo cuesta ${dolares(info.costo)}. A ${dolares(v.precio)} te deja ${info.margen_pct?.toFixed(0)}% de margen.` +
        (seEncarecio
          ? `\n\nOJO: con los precios de HOY cuesta ${dolares(info.costo_reposicion!)}, y a ${dolares(v.precio)} eso deja solo ${info.margen_reposicion_pct?.toFixed(0)}%.`
          : '')
      : '(Este producto no tiene receta, así que no se sabe cuánto cuesta producirlo.)'
    const unaSola = p.variantes.filter((x) => x.activo).length <= 1
    abrir({ tipo: 'precio', producto: p, variante: v, titulo: `Precio de ${unaSola ? p.nombre : v.nombre}`, texto })
  }

  async function guardarPrecio(v: Variante, precio: number) {
    const info = costos.get(v.id)
    if (info?.costo && precio < info.costo) {
      const seguir = await confirmar({
        titulo: 'Venderías por debajo del costo',
        texto: `A ${dolares(precio)} pierdes ${dolares(info.costo - precio)} en cada una: producirla cuesta ${dolares(info.costo)}.`,
        aceptar: 'Ponerlo igual',
        peligro: true,
      })
      if (!seguir) return
    }
    await apiMenu.actualizarVariante(v.id, v.nombre, precio)
    setCuadro(null)
    await recargar()
  }

  function irAReceta(v: Variante) {
    router.push(`/menu/recetas/${v.id}` as Href)
  }

  // ── Lo que se dibuja ──

  if (activas.length === 0) {
    return (
      <>
        <Vacio
          icono="menu"
          titulo="Todavía no hay menú"
          detalle="Empieza por una categoría: Comida, Bebidas, Postres. Dentro van los productos y sus precios."
          accion={{ texto: 'Crear la primera categoría', alTocar: () => abrir({ tipo: 'crear-categoria' }) }}
        />
        {retirados > 0 ? (
          <BotonTexto texto={`Lo que quitaste · ${retirados}`} alTocar={() => abrir({ tipo: 'retiradas' })} />
        ) : null}
        {cuadros()}
      </>
    )
  }

  const tarjeta = (producto: Producto, categoria: Categoria, extra: { conCategoria?: boolean; subir?: () => Promise<void>; bajar?: () => Promise<void> } = {}) => (
    <TarjetaProducto
      key={producto.id}
      producto={producto}
      categoria={categoria}
      costos={costos}
      conCategoria={extra.conCategoria}
      alOpciones={() => setHoja({ tipo: 'producto', producto, subir: extra.subir, bajar: extra.bajar })}
      alVariante={() => abrir({ tipo: 'variante', producto })}
      alPrecio={(v) => pedirPrecio(producto, v)}
      alReceta={irAReceta}
      alQuitarVariante={(v) => quitarVariante(producto, v)}
    />
  )

  const pieCategorias = (
    // En la columna angosta de la tablet, uno debajo del otro.
    <View style={[estilos.pie, tablet && { flexDirection: 'column', alignItems: 'stretch' }]}>
      <View style={tablet ? undefined : { flex: 1 }}>
        <Boton texto="+ Categoría" tono="neutro" alTocar={() => abrir({ tipo: 'crear-categoria' })} />
      </View>
      {retirados > 0 ? (
        <View style={tablet ? { alignItems: 'center' } : { flex: 1 }}>
          <BotonTexto texto={`Lo que quitaste · ${retirados}`} alTocar={() => abrir({ tipo: 'retiradas' })} />
        </View>
      ) : null}
    </View>
  )

  const productos = actual ? (
    <ProductosDe categoria={actual} alCrear={() => abrir({ tipo: 'crear-producto', categoriaId: actual.id })} alOpciones={() => setHoja({ tipo: 'categoria', cat: actual })}>
      {(lista) =>
        lista.map((p, i) =>
          tarjeta(p, actual, {
            subir:
              i > 0
                ? () => hacer(() => ordenarProductos(actual, p.id, lista[i - 1].id))
                : undefined,
            // Bajar uno es que el de abajo suba por encima de el.
            bajar:
              i < lista.length - 1
                ? () => hacer(() => ordenarProductos(actual, lista[i + 1].id, p.id))
                : undefined,
          }),
        )
      }
    </ProductosDe>
  ) : null

  return (
    <>
      <Buscador valor={busqueda} alCambiar={setBusqueda} placeholder="Buscar un producto en todo el menú" />

      {buscando ? (
        <View style={{ gap: 10 }}>
          <Nota>
            {encontrados.length === 0
              ? `Ningún producto coincide con «${busqueda.trim()}».`
              : `${plural(encontrados.length, 'producto', 'productos')} con «${busqueda.trim()}»`}
          </Nota>
          {encontrados.map(({ cat, producto }) => tarjeta(producto, cat, { conCategoria: true }))}
        </View>
      ) : tablet ? (
        <View style={estilos.columnas}>
          <View style={estilos.columnaCategorias}>
            <Ficha style={{ padding: 8 }}>
              <Text style={[estilos.etiqueta, { color: t.tenue }]}>Categorías</Text>
              {activas.map((c) => (
                <FilaCategoria key={c.id} cat={c} activa={c.id === actual?.id} alTocar={() => setElegida(c.id)} />
              ))}
            </Ficha>
            {pieCategorias}
          </View>
          <View style={{ flex: 1, gap: 10 }}>{productos}</View>
        </View>
      ) : (
        <>
          {/* En el telefono, las categorias son una tira pegada arriba: antes
              ocupaban media pantalla y el primer producto caia bajo el
              pliegue (web). */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
            {activas.map((c) => (
              <ChipCategoria key={c.id} cat={c} activa={c.id === actual?.id} alTocar={() => setElegida(c.id)} />
            ))}
          </ScrollView>
          {productos}
          {pieCategorias}
        </>
      )}

      {hojas()}
      {cuadros()}
    </>
  )

  // ── Las hojas de "⋯" ──

  function hojas() {
    const h = hoja
    return (
      <>
        <Hoja visible={h?.tipo === 'categoria'} alCerrar={() => setHoja(null)} titulo={h?.tipo === 'categoria' ? h.cat.nombre : undefined}>
          {h?.tipo === 'categoria' ? (
            <OpcionesCategoria
              cat={h.cat}
              primera={activas[0]?.id === h.cat.id}
              ultima={activas[activas.length - 1]?.id === h.cat.id}
              alColor={(color) => void hacer(() => apiMenu.actualizarCategoria(h.cat.id, { color }))}
              alRenombrar={() => cerrarHojaY(() => abrir({ tipo: 'renombrar-categoria', cat: h.cat }))}
              alCocina={(va) => {
                setHoja(null)
                if (va !== (h.cat.va_a_cocina !== false)) void hacer(() => apiMenu.actualizarCategoria(h.cat.id, { va_a_cocina: va }))
              }}
              alMover={(paso) => {
                setHoja(null)
                moverCategoria(h.cat, paso)
              }}
              alQuitar={() => {
                setHoja(null)
                quitarCategoria(h.cat)
              }}
            />
          ) : null}
        </Hoja>

        <Hoja visible={h?.tipo === 'producto'} alCerrar={() => setHoja(null)} titulo={h?.tipo === 'producto' ? h.producto.nombre : undefined}>
          {h?.tipo === 'producto' ? (
            <>
              <OpcionHoja texto="Renombrar" alTocar={() => cerrarHojaY(() => abrir({ tipo: 'renombrar-producto', producto: h.producto }))} />
              {h.subir ? (
                <OpcionHoja
                 
                  texto="Subir"
                  detalle="Un puesto más arriba en el menú y el punto de venta"
                  alTocar={() => {
                    setHoja(null)
                    void h.subir?.()
                  }}
                />
              ) : null}
              {h.bajar ? (
                <OpcionHoja
                 
                  texto="Bajar"
                  detalle="Un puesto más abajo"
                  alTocar={() => {
                    setHoja(null)
                    void h.bajar?.()
                  }}
                />
              ) : null}
              {activas.length > 1 ? (
                <OpcionHoja texto="Mover a otra categoría…" alTocar={() => setHoja({ tipo: 'mover', producto: h.producto })} />
              ) : null}
              <OpcionHoja
                texto="Quitar del menú"
                peligro
                alTocar={() => {
                  setHoja(null)
                  quitarProducto(h.producto)
                }}
              />
            </>
          ) : null}
        </Hoja>

        <Hoja
          visible={h?.tipo === 'mover'}
          alCerrar={() => setHoja(null)}
          titulo={h?.tipo === 'mover' ? `¿A qué categoría pasa "${h.producto.nombre}"?` : undefined}
        >
          {h?.tipo === 'mover' ? (
            <>
              <Nota style={{ paddingHorizontal: 12, marginBottom: 6 }}>Se lleva sus variantes, sus precios y su receta.</Nota>
              <ScrollView style={{ maxHeight: 420 }}>
                {activas
                  .filter((c) => c.id !== h.producto.categoria_id)
                  .map((c) => (
                    <OpcionHoja
                      key={c.id}
                      texto={c.nombre}
                      alTocar={() => {
                        setHoja(null)
                        void moverA(h.producto, c)
                      }}
                    />
                  ))}
              </ScrollView>
            </>
          ) : null}
        </Hoja>
      </>
    )
  }

  // ── Los cuadros ──

  function cuadros() {
    const c = cuadro
    const cerrar = () => setCuadro(null)
    return (
      <>
        <CrearCategoria key={`cc${vez}`} visible={c?.tipo === 'crear-categoria'} alCerrar={cerrar} alCrear={crearCategoria} />
        {actual || c?.tipo === 'crear-producto' ? (
          <CrearProducto
            key={`cp${vez}`}
            visible={c?.tipo === 'crear-producto'}
            categorias={activas}
            categoriaId={c?.tipo === 'crear-producto' ? c.categoriaId : (actual?.id ?? 0)}
            alCerrar={cerrar}
            alCrear={crearProducto}
          />
        ) : null}
        <PedirTexto
          key={`rc${vez}`}
          visible={c?.tipo === 'renombrar-categoria'}
          titulo="Nombre de la categoría"
          etiqueta="Se ve así en el punto de venta"
          valor={c?.tipo === 'renombrar-categoria' ? c.cat.nombre : ''}
          alCerrar={cerrar}
          alAceptar={async (nombre) => {
            if (c?.tipo !== 'renombrar-categoria') return
            if (nombre !== c.cat.nombre) await apiMenu.actualizarCategoria(c.cat.id, { nombre })
            cerrar()
            await recargar()
          }}
        />
        <PedirTexto
          key={`rp${vez}`}
          visible={c?.tipo === 'renombrar-producto'}
          titulo="Nombre del producto"
          etiqueta="Se ve así en el punto de venta y en el ticket"
          valor={c?.tipo === 'renombrar-producto' ? c.producto.nombre : ''}
          alCerrar={cerrar}
          alAceptar={async (nombre) => {
            if (c?.tipo !== 'renombrar-producto') return
            const p = c.producto
            if (nombre !== p.nombre) await apiMenu.actualizarProducto(p.id, { categoria_id: p.categoria_id, nombre, activo: true })
            cerrar()
            await recargar()
          }}
        />
        <NuevaVariante
          key={`nv${vez}`}
          visible={c?.tipo === 'variante'}
          producto={c?.tipo === 'variante' ? c.producto.nombre : ''}
          alCerrar={cerrar}
          alCrear={async (nombre, precio) => {
            if (c?.tipo !== 'variante') return
            await apiMenu.crearVariante(c.producto.id, nombre, precio)
            cerrar()
            await recargar()
          }}
        />
        <CambiarPrecio
          key={`pr${vez}`}
          visible={c?.tipo === 'precio'}
          titulo={c?.tipo === 'precio' ? c.titulo : ''}
          texto={c?.tipo === 'precio' ? c.texto : ''}
          valor={c?.tipo === 'precio' ? c.variante.precio : 0}
          alCerrar={cerrar}
          alAceptar={async (precio) => {
            if (c?.tipo === 'precio') await guardarPrecio(c.variante, precio)
          }}
        />
        <HojaFormulario
          visible={c?.tipo === 'retiradas'}
          alCerrar={cerrar}
          titulo="Lo que quitaste del menú"
          subtitulo="No aparece en el punto de venta. Nada se borra: las ventas viejas siguen nombrándolo."
        >
          <Retiradas categorias={categorias} alDevolver={(accion) => hacer(accion)} />
        </HojaFormulario>
      </>
    )
  }
}

// ── Piezas de la pantalla ───────────────────────────────────────────────────

/** El chip de una categoria en la tira del telefono: su color, su nombre y cuantos lleva. */
function ChipCategoria({ cat, activa, alTocar }: { cat: Categoria; activa: boolean; alTocar: () => void }) {
  const t = useTema()
  const { modo } = useModo()
  const n = cat.productos.filter((p) => p.activo).length
  return (
    <Pressable
      onPress={alTocar}
      accessibilityRole="button"
      accessibilityState={{ selected: activa }}
      style={({ pressed }) => [
        estilos.chip,
        {
          backgroundColor: activa ? t.tinta : t.superficie,
          borderColor: activa ? t.tinta : t.gris200,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <View style={[estilos.punto, { backgroundColor: puntoCategoria(cat.id, cat.color, modo) }]} />
        <Text style={[estilos.chipNombre, { color: activa ? t.papel : t.tinta }]} numberOfLines={1}>
          {cat.nombre}
        </Text>
      </View>
      <Text style={[estilos.chipDetalle, { color: activa ? t.papel : t.tenue, opacity: activa ? 0.75 : 1 }]} numberOfLines={1}>
        {plural(n, 'producto', 'productos')}
        {cat.va_a_cocina === false ? ' · no va a cocina' : ''}
      </Text>
    </Pressable>
  )
}

/** La fila de una categoria en la columna de la tablet. */
function FilaCategoria({ cat, activa, alTocar }: { cat: Categoria; activa: boolean; alTocar: () => void }) {
  const t = useTema()
  const { modo } = useModo()
  const n = cat.productos.filter((p) => p.activo).length
  return (
    <Pressable
      onPress={alTocar}
      accessibilityRole="button"
      accessibilityState={{ selected: activa }}
      style={({ pressed }) => [estilos.filaCategoria, { backgroundColor: activa ? t.gris100 : pressed ? t.gris100 : 'transparent' }]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={[estilos.punto, { backgroundColor: puntoCategoria(cat.id, cat.color, modo) }]} />
        <Text style={[activa ? estilos.chipNombre : estilos.filaCategoriaNombre, { color: t.tinta, flex: 1 }]} numberOfLines={1}>
          {cat.nombre}
        </Text>
      </View>
      <Text style={[estilos.chipDetalle, { color: t.tenue, marginLeft: 16 }]} numberOfLines={1}>
        {plural(n, 'producto', 'productos')}
        {cat.va_a_cocina === false ? ' · no va a cocina' : ''}
      </Text>
    </Pressable>
  )
}

/** Lo que se le puede hacer a una categoria: color, nombre, cocina, puesto y quitar. */
function OpcionesCategoria({
  cat,
  primera,
  ultima,
  alColor,
  alRenombrar,
  alCocina,
  alMover,
  alQuitar,
}: {
  cat: Categoria
  primera: boolean
  ultima: boolean
  alColor: (color: string) => void
  alRenombrar: () => void
  alCocina: (va: boolean) => void
  alMover: (paso: -1 | 1) => void
  alQuitar: () => void
}) {
  const t = useTema()
  // El color se elige de un toque y la hoja no se cierra: se ve el cambio.
  const [color, setColor] = useState(cat.color)
  return (
    <ScrollView style={{ maxHeight: 560 }}>
      <View style={[estilos.coloresHoja, { borderBottomColor: t.gris200 }]}>
        <Rotulo>Color en el mostrador</Rotulo>
        <Colores
          elegido={color}
          alElegir={(c) => {
            setColor(c)
            alColor(c)
          }}
        />
      </View>
      <OpcionHoja texto="Renombrar" alTocar={alRenombrar} />
      {/* Una de dos, con la vigente marcada. Es la sugerencia al comandar:
          la cajera la cambia en cada pedido. */}
      <OpcionHoja texto="Va a cocina" marcada={cat.va_a_cocina !== false} alTocar={() => alCocina(true)} />
      <OpcionHoja texto="No va a cocina" marcada={cat.va_a_cocina === false} alTocar={() => alCocina(false)} />
      {!primera ? <OpcionHoja texto="Subir" detalle="Un puesto antes en el menú y el punto de venta" alTocar={() => alMover(-1)} /> : null}
      {!ultima ? <OpcionHoja texto="Bajar" detalle="Un puesto después" alTocar={() => alMover(1)} /> : null}
      <OpcionHoja texto="Quitar del menú" peligro alTocar={alQuitar} />
    </ScrollView>
  )
}

/** Los productos de la categoria abierta, con su cabecera: el nombre, "⋯" y "+ Producto". */
function ProductosDe({
  categoria,
  alCrear,
  alOpciones,
  children,
}: {
  categoria: Categoria
  alCrear: () => void
  alOpciones: () => void
  children: (lista: Producto[]) => ReactNode
}) {
  const t = useTema()
  const lista = categoria.productos.filter((p) => p.activo)
  return (
    <View style={{ gap: 10 }}>
      <Ficha style={estilos.cabecera}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Titulo>{categoria.nombre}</Titulo>
          <Text style={[estilos.chipDetalle, { color: t.tenue, marginTop: 2 }]}>
            {plural(lista.length, 'producto', 'productos')}
            {categoria.va_a_cocina === false ? ' · no va a cocina' : ''}
          </Text>
        </View>
        <BotonPuntos etiqueta={`Opciones de ${categoria.nombre}`} alTocar={alOpciones} />
        <Boton texto="+ Producto" alTocar={alCrear} />
      </Ficha>
      {lista.length === 0 ? (
        <Vacio
          icono="menu"
          titulo={`"${categoria.nombre}" está vacía`}
          detalle="Crea el primer producto con el botón de arriba. También puedes pasar uno de otra categoría con «Mover a otra categoría…»."
        />
      ) : (
        children(lista)
      )}
    </View>
  )
}

/** Un producto con sus variantes y precios (`TarjetaProducto` de la web). */
function TarjetaProducto({
  producto,
  categoria,
  costos,
  conCategoria = false,
  alOpciones,
  alVariante,
  alPrecio,
  alReceta,
  alQuitarVariante,
}: {
  producto: Producto
  categoria: Categoria
  costos: Map<number, CostoVariante>
  conCategoria?: boolean
  alOpciones: () => void
  alVariante: () => void
  alPrecio: (v: Variante) => void
  alReceta: (v: Variante) => void
  alQuitarVariante: (v: Variante) => void
}) {
  const t = useTema()
  const { fmt } = useMoneda()
  const variantes = producto.variantes.filter((v) => v.activo)

  // El acantilado, en una frase y solo cuando importa: el margen aguanta con
  // el inventario viejo, pero no con lo que cuesta reponer.
  const avisosReposicion = variantes.flatMap((v) => {
    const info = costos.get(v.id)
    if (
      !info ||
      info.costo == null ||
      v.precio < info.costo ||
      info.margen_pct == null ||
      info.margen_reposicion_pct == null ||
      info.margen_reposicion_pct >= info.margen_pct - 5
    )
      return []
    const quien = variantes.length > 1 ? `${v.nombre}: ` : ''
    const cuanto = info.margen_reposicion_pct < 0 ? 'lo venderías a pérdida' : `te dejaría ${info.margen_reposicion_pct.toFixed(0)}%`
    const frase = `${quien}con los precios de hoy ${cuanto}.`
    return [frase[0].toUpperCase() + frase.slice(1)]
  })

  return (
    <Ficha style={estilos.tarjeta}>
      <View style={estilos.tarjetaCabeza}>
        {/* El nombre es texto, no un boton: tocarlo abria "Renombrar" sin
            querer. Renombrar sigue en el "⋯". */}
        <Text style={[estilos.producto, { color: t.tinta }]} numberOfLines={2}>
          {producto.nombre}
          {conCategoria ? <Text style={[estilos.chipDetalle, { color: t.tenue }]}> · {categoria.nombre}</Text> : null}
        </Text>
        <BotonTexto texto="+ Variante" alTocar={alVariante} />
        <BotonPuntos etiqueta={`Opciones de ${producto.nombre}`} alTocar={alOpciones} />
      </View>

      {/* LAS VARIANTES, UN RENGLON CADA UNA: el precio para cambiarlo, el
          margen en palabras y la receta para armarla. Con una sola variante
          el renglon dice "Precio" y ya. */}
      {variantes.map((v, i) => {
        const info = costos.get(v.id)
        const bajoCosto = info?.costo != null && v.precio < info.costo
        const conMargen = info?.margen_pct != null && !info.sin_receta
        const colorMargen = bajoCosto ? t.peligro : conMargen ? (info!.margen_pct! >= 50 ? t.exito : t.aviso) : t.suave
        const nombre = variantes.length <= 1 ? 'Precio' : v.nombre
        return (
          <View key={v.id} style={[estilos.variante, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.gris200 }]}>
            <View style={estilos.varianteFila}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[estilos.varianteNombre, { color: t.fuerte }]} numberOfLines={1}>
                  {nombre}
                </Text>
                {bajoCosto || conMargen ? (
                  <Text style={[estilos.margen, { color: colorMargen }, bajoCosto && { fontFamily: LETRA.textoFuerte }]}>
                    {bajoCosto ? '¡a pérdida!' : `${info!.margen_pct!.toFixed(0)}% de ganancia`}
                  </Text>
                ) : null}
              </View>
              {/* Se ve como lo que es: un control que se toca, no una cifra suelta. */}
              <Pressable
                onPress={() => alPrecio(v)}
                accessibilityRole="button"
                accessibilityLabel={`Cambiar el precio de ${variantes.length <= 1 ? producto.nombre : v.nombre}: ${fmt(v.precio)}`}
                style={({ pressed }) => [
                  estilos.precio,
                  {
                    backgroundColor: pressed ? t.gris200 : t.gris100,
                    borderColor: bajoCosto ? t.peligro : 'transparent',
                  },
                ]}
              >
                <Text style={[estilos.precioTexto, { color: bajoCosto ? t.peligro : t.tinta }]}>{fmt(v.precio)}</Text>
              </Pressable>
            </View>
            <View style={estilos.varianteAcciones}>
              {/* LA RECETA SE TOCA DESDE AQUI: "sin receta" era una etiqueta
                  sin salida; ahora es el boton que la pide. */}
              {info?.sin_receta ? (
                <BotonTexto texto="Ponle lo que lleva" tono="acento" alTocar={() => alReceta(v)} />
              ) : (
                <BotonTexto texto="Editar receta" alTocar={() => alReceta(v)} />
              )}
              {variantes.length > 1 ? (
                <Pressable
                  onPress={() => alQuitarVariante(v)}
                  accessibilityRole="button"
                  accessibilityLabel={`Quitar ${v.nombre}`}
                  style={({ pressed }) => [estilos.quitar, { backgroundColor: pressed ? t.peligroSuave : 'transparent' }]}
                >
                  <Icono nombre="quitar" size={15} color={t.peligro} />
                </Pressable>
              ) : null}
            </View>
          </View>
        )
      })}

      {avisosReposicion.map((aviso) => (
        <Text key={aviso} style={[estilos.reposicion, { color: t.aviso }]}>
          {aviso}
        </Text>
      ))}
    </Ficha>
  )
}

/** Lo que esta fuera del menu, para devolverlo. */
function Retiradas({ categorias, alDevolver }: { categorias: Categoria[]; alDevolver: (accion: () => Promise<unknown>) => Promise<void> }) {
  const t = useTema()
  const cats = categorias.filter((c) => !c.activo)
  // Un producto retirado dentro de una categoria retirada no se lista aparte:
  // vuelve con ella.
  const productos = categorias.filter((c) => c.activo).flatMap((c) => c.productos.filter((p) => !p.activo).map((p) => ({ cat: c, p })))
  const variantes = categorias
    .filter((c) => c.activo)
    .flatMap((c) => c.productos.filter((p) => p.activo).flatMap((p) => p.variantes.filter((v) => !v.activo).map((v) => ({ p, v }))))

  if (cats.length + productos.length + variantes.length === 0) {
    return (
      <Vacio
        icono="menu"
        titulo="No has quitado nada del menú"
        detalle="Lo que quites aparece aquí para poder devolverlo. Nada se borra: las ventas viejas siguen nombrándolo."
      />
    )
  }

  const filas = [
    ...cats.map((c) => ({
      clave: `c${c.id}`,
      nombre: c.nombre,
      detalle: `categoría · ${plural(c.productos.length, 'producto', 'productos')}`,
      volver: () => apiMenu.reactivarCategoria(c.id),
    })),
    ...productos.map(({ cat, p }) => ({
      clave: `p${p.id}`,
      nombre: p.nombre,
      detalle: `producto de ${cat.nombre}`,
      volver: () => apiMenu.reactivarProducto(p.id),
    })),
    ...variantes.map(({ p, v }) => ({
      clave: `v${v.id}`,
      nombre: `${p.nombre} - ${v.nombre}`,
      detalle: 'variante',
      volver: () => apiMenu.reactivarVariante(v.id),
    })),
  ]

  return (
    <Ficha style={{ paddingVertical: 4, paddingHorizontal: 16 }}>
      {filas.map((f, i) => (
        <View key={f.clave} style={[estilos.retirada, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.gris200 }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[estilos.varianteNombre, { color: t.tinta }]}>{f.nombre}</Text>
            <Text style={[estilos.chipDetalle, { color: t.tenue }]}>{f.detalle}</Text>
          </View>
          <BotonTexto texto="Devolver al menú" tono="acento" alTocar={() => void alDevolver(f.volver)} />
        </View>
      ))}
    </Ficha>
  )
}

// ── Reglas ──────────────────────────────────────────────────────────────────

/** Los productos que coinciden, con la categoria a la que pertenecen. */
function buscar(categorias: Categoria[], palabras: string[]): { cat: Categoria; producto: Producto }[] {
  if (palabras.length === 0) return []
  return categorias.flatMap((cat) =>
    cat.productos
      .filter(
        (p) =>
          p.activo &&
          (contiene(`${cat.nombre} ${p.nombre}`, palabras) || p.variantes.some((v) => contiene(`${p.nombre} ${v.nombre}`, palabras))),
      )
      .map((producto) => ({ cat, producto })),
  )
}

/**
 * Pone el producto `id` justo antes de `sobre` dentro de la categoria y
 * guarda el orden completo de una vez: uno por uno dejaria puestos repetidos.
 */
function ordenarProductos(categoria: Categoria, id: number, sobre: number) {
  const orden = categoria.productos.filter((p) => p.activo).map((p) => p.id).filter((x) => x !== id)
  const donde = orden.indexOf(sobre)
  orden.splice(donde < 0 ? orden.length : donde, 0, id)
  return apiMenu.ordenarProductos(categoria.id, orden)
}

const estilos = StyleSheet.create({
  columnas: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  columnaCategorias: { width: 250, gap: 10 },
  etiqueta: { fontFamily: LETRA.textoFuerte, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', padding: 8, paddingBottom: 6 },
  pie: { flexDirection: 'row', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  chip: { borderWidth: 1, borderRadius: 16, borderCurve: 'continuous', paddingHorizontal: 14, paddingVertical: 8, minHeight: 50, justifyContent: 'center', maxWidth: 220 },
  punto: { width: 8, height: 8, borderRadius: 4 },
  chipNombre: { fontFamily: LETRA.textoFuerte, fontSize: 14.5 },
  chipDetalle: { fontFamily: LETRA.texto, fontSize: 13 },
  filaCategoria: { borderRadius: 12, borderCurve: 'continuous', paddingHorizontal: 10, paddingVertical: 9, minHeight: 50, justifyContent: 'center' },
  filaCategoriaNombre: { fontFamily: LETRA.texto, fontSize: 14.5 },
  cabecera: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 16 },
  coloresHoja: { paddingHorizontal: 12, paddingBottom: 12, marginBottom: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  tarjeta: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8 },
  tarjetaCabeza: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  producto: { flex: 1, fontFamily: LETRA.textoFuerte, fontSize: 16, paddingVertical: 8 },
  variante: { paddingVertical: 6 },
  varianteFila: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  varianteNombre: { fontFamily: LETRA.texto, fontSize: 15 },
  margen: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 1 },
  precio: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    borderRadius: 12, borderCurve: 'continuous',
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  precioTexto: { fontFamily: LETRA.cifraFuerte, fontSize: 15.5 },
  varianteAcciones: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: -2 },
  quitar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  reposicion: { fontFamily: LETRA.texto, fontSize: 13, lineHeight: 18, marginTop: 4 },
  retirada: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
})
