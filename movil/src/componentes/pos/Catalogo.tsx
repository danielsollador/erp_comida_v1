import { memo, useCallback, useMemo, useState } from 'react'
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, type ListRenderItem } from 'react-native'
import { agruparPorProducto, nombreDe, tinteCategoria, type Grupo, type Tinte } from '../../lib/pos'
import { LETRA, useModo, useTema, type Paleta } from '../../lib/tema'
import type { Categoria, Producto, Variante } from '../../lib/tipos'
import { Hoja } from '../Hoja'
import Icono from '../Icono'
import { Buscador, llano } from '../kit'
import { Boton } from '../ui'

/*
 * LA LISTA DE PRODUCTOS DEL MOSTRADOR (ListaProductos de pages/POS.tsx).
 *
 * UNA LISTA, renglones agrupados por categoria: se toca el renglon y suma
 * uno; la lista no se cierra, asi que cinco productos son cinco toques. Un
 * producto con varias variantes ("Empanada": carne, pollo, queso) es un solo
 * renglon que abre sus variantes en una hoja que tampoco se cierra al
 * elegir: "dos de carne y una de pollo" son tres toques.
 *
 * NO SE PUEDE TRABAR. Es la pantalla que vive horas abierta en la tablet:
 * FlatList (solo dibuja lo que se ve), celdas memorizadas que se repintan
 * solo cuando cambia SU cantidad, y las acciones llegan estables desde
 * arriba. Escribir el nombre del cliente o que llegue una comanda por el
 * canal en vivo no repinta el menu.
 */

type ItemProducto = { producto: Producto; variantes: Variante[]; categoria: Categoria }
type Fila =
  | { tipo: 'titulo'; clave: string }
  | { tipo: 'categoria'; clave: string; categoria: Categoria }
  | { tipo: 'productos'; clave: string; items: ItemProducto[]; primera: boolean; ultima: boolean }

type Fmt = (usd: number | null | undefined, decimales?: number) => string

export const Catalogo = memo(function Catalogo({
  categorias,
  grupos,
  envioId,
  cantidades,
  recien,
  unidades,
  columnas,
  fmt,
  alAgregar,
  alQuitar,
  alQuitarTodo,
  refrescando,
  alRefrescar,
}: {
  categorias: Categoria[]
  grupos: Grupo[]
  envioId: number | null
  /** Cuantas de cada variante van en la comanda. */
  cantidades: Record<number, number>
  /** Lo recien tocado: el renglon se tiñe un instante, la confirmacion de que si se agrego. */
  recien: Set<number>
  unidades: number
  columnas: 1 | 2
  fmt: Fmt
  alAgregar: (p: Producto, v: Variante) => void
  alQuitar: (varianteId: number) => void
  alQuitarTodo: (varianteId: number) => void
  refrescando: boolean
  alRefrescar: () => void
}) {
  const t = useTema()
  // Arranca en "todas": el menu entero de una pasada, con una seccion por
  // categoria (Leider, 22-sep: "haz mas facil ver todas las categorias").
  const [activa, setActiva] = useState<number | 'todas'>('todas')
  const [busqueda, setBusqueda] = useState('')
  // El producto cuyas variantes estan a la vista.
  const [abierto, setAbierto] = useState<ItemProducto | null>(null)
  const q = llano(busqueda.trim())

  const { filas, pegajosas } = useMemo(() => {
    // El rotulo va como primera fila y no como cabecera de la lista: asi los
    // indices de las categorias pegajosas son los de los datos, sin corrimiento.
    const filas: Fila[] = [{ tipo: 'titulo', clave: 'titulo' }]
    const pegajosas: number[] = []
    for (const g of grupos) {
      if (g.filas.length === 0) continue
      // Buscando se mira el menu entero: lo que se escribe manda sobre la pastilla.
      if (!q && activa !== 'todas' && g.categoria.id !== activa) continue
      const coinciden = q ? g.filas.filter((f) => llano(`${f.producto.nombre} ${f.variante.nombre}`).includes(q)) : g.filas
      if (coinciden.length === 0) continue
      const productos = agruparPorProducto(coinciden)
      pegajosas.push(filas.length)
      filas.push({ tipo: 'categoria', clave: `c${g.categoria.id}`, categoria: g.categoria })
      for (let i = 0; i < productos.length; i += columnas) {
        const items = productos.slice(i, i + columnas).map((p) => ({ ...p, categoria: g.categoria }))
        filas.push({
          tipo: 'productos',
          clave: `p${items.map((x) => x.producto.id).join('-')}`,
          items,
          primera: i === 0,
          ultima: i + columnas >= productos.length,
        })
      }
    }
    return { filas: filas.length > 1 ? filas : [], pegajosas }
  }, [grupos, activa, q, columnas])

  const abrir = useCallback((item: ItemProducto) => setAbierto(item), [])

  // Un tinte por categoria, calculado una vez: si cada celda recibiera uno
  // nuevo en cada vuelta, la memoria de las celdas no serviria de nada.
  const tintes = useMemo(() => new Map(categorias.map((c) => [c.id, tinteCategoria(t, c.id, c.color)])), [categorias, t])

  const cabecera = useMemo(
    () => (
      <View style={e.titulo}>
        <Text style={[e.tituloTexto, { color: t.tenue }]}>
          PRODUCTOS
          {unidades > 0 ? <Text style={[e.tituloCuenta, { color: t.tenue }]}>{`  · ${unidades} en la comanda`}</Text> : null}
        </Text>
      </View>
    ),
    [t, unidades],
  )

  const renglon: ListRenderItem<Fila> = useCallback(
    ({ item: fila }) => {
      if (fila.tipo === 'titulo') return cabecera
      if (fila.tipo === 'categoria') {
        const tinte = tintes.get(fila.categoria.id) ?? tinteCategoria(t, fila.categoria.id, fila.categoria.color)
        return (
          <View style={[e.cabeza, { backgroundColor: t.papel }]}>
            <View style={[e.punto, { backgroundColor: tinte.punto }]} />
            <Text style={[e.cabezaTexto, { color: t.suave }]}>{fila.categoria.nombre}</Text>
          </View>
        )
      }
      return (
        <View
          style={[
            e.grupo,
            { backgroundColor: t.superficie, borderColor: t.gris200 },
            fila.primera && e.grupoArriba,
            fila.ultima && e.grupoAbajo,
            !fila.ultima && { borderBottomWidth: 0 },
          ]}
        >
          {fila.items.map((it, i) => {
            const tinte = tintes.get(it.categoria.id) ?? tinteCategoria(t, it.categoria.id, it.categoria.color)
            const unica = it.variantes.length === 1
            const n = unica
              ? (cantidades[it.variantes[0].id] ?? 0)
              : it.variantes.reduce((s, v) => s + (cantidades[v.id] ?? 0), 0)
            const pulsando = unica ? recien.has(it.variantes[0].id) : it.variantes.some((v) => recien.has(v.id))
            return (
              <View
                key={it.producto.id}
                style={[
                  { flex: 1, minWidth: 0 },
                  i > 0 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: t.gris200 },
                  !fila.primera && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.gris200 },
                ]}
              >
                <CeldaProducto
                  item={it}
                  tinte={tinte}
                  envio={envioId !== null && it.producto.categoria_id === envioId}
                  n={n}
                  pulsando={pulsando}
                  fmt={fmt}
                  alAgregar={alAgregar}
                  alQuitar={alQuitar}
                  alQuitarTodo={alQuitarTodo}
                  alAbrir={abrir}
                />
              </View>
            )
          })}
          {/* La fila de dos con un solo producto: el hueco no se estira. */}
          {fila.items.length < columnas ? (
            <View style={{ flex: 1, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: t.gris200 }} />
          ) : null}
        </View>
      )
    },
    [t, tintes, cantidades, recien, envioId, fmt, alAgregar, alQuitar, alQuitarTodo, abrir, columnas, cabecera],
  )

  return (
    <View style={{ flex: 1 }}>
      <View style={e.arriba}>
        <Buscador valor={busqueda} alCambiar={setBusqueda} placeholder="Buscar en el menú" />
        <Categorias categorias={categorias} activa={activa} alElegir={setActiva} t={t} />
      </View>
      <FlatList
        data={filas}
        renderItem={renglon}
        keyExtractor={(f) => f.clave}
        extraData={cantidades}
        stickyHeaderIndices={pegajosas}
        ListEmptyComponent={
          <Text style={[e.vacio, { color: t.tenue }]}>
            {q ? `Nada en el menú coincide con «${busqueda.trim()}».` : 'No hay nada para vender en esta categoría.'}
          </Text>
        }
        contentContainerStyle={e.lista}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={16}
        windowSize={9}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={alRefrescar} tintColor={t.acento} colors={[t.acento]} />}
      />
      <HojaVariantes
        item={abierto}
        cantidades={cantidades}
        recien={recien}
        fmt={fmt}
        alAgregar={alAgregar}
        alQuitar={alQuitar}
        alQuitarTodo={alQuitarTodo}
        alCerrar={() => setAbierto(null)}
      />
    </View>
  )
})

/**
 * Las categorias, siempre a la vista: "Todas" pone el menu entero. La elegida
 * se pinta del COLOR DE LA CATEGORIA, el mismo de la raya de cada producto:
 * la pastilla dice ademas "lo que estas viendo es esto".
 */
function Categorias({
  categorias,
  activa,
  alElegir,
  t,
}: {
  categorias: Categoria[]
  activa: number | 'todas'
  alElegir: (c: number | 'todas') => void
  t: Paleta
}) {
  const { modo } = useModo()
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={[e.carril, { backgroundColor: t.gris100, borderColor: t.gris200 }]}>
        <Pressable
          onPress={() => alElegir('todas')}
          accessibilityState={{ selected: activa === 'todas' }}
          style={[e.pastilla, activa === 'todas' && { backgroundColor: modo === 'oscuro' ? t.gris200 : t.superficie }]}
        >
          <Text style={[e.pastillaTexto, { color: activa === 'todas' ? t.tinta : t.suave }]}>Todas</Text>
        </Pressable>
        {categorias.map((c) => {
          const tinte = tinteCategoria(t, c.id, c.color)
          const elegida = c.id === activa
          return (
            <Pressable
              key={c.id}
              onPress={() => alElegir(c.id)}
              accessibilityState={{ selected: elegida }}
              style={[e.pastilla, elegida && { backgroundColor: tinte.fondo }]}
            >
              <Text style={[e.pastillaTexto, { color: elegida ? tinte.texto : t.suave }]}>{c.nombre}</Text>
            </Pressable>
          )
        })}
      </View>
    </ScrollView>
  )
}

/**
 * Un producto en la lista. Con una sola variante: el renglon que suma uno
 * por toque, y si ya va en la comanda, × (todas), − (una) y cuantas. Con
 * varias: un renglon que abre sus variantes.
 *
 * Sin cortar el nombre con puntos suspensivos: dos productos distintos
 * terminaban leyendose igual y la cajera tocaba el que no era.
 */
const CeldaProducto = memo(function CeldaProducto({
  item,
  tinte,
  envio,
  n,
  pulsando,
  fmt,
  alAgregar,
  alQuitar,
  alQuitarTodo,
  alAbrir,
}: {
  item: ItemProducto
  tinte: Tinte
  envio: boolean
  n: number
  pulsando: boolean
  fmt: Fmt
  alAgregar: (p: Producto, v: Variante) => void
  alQuitar: (varianteId: number) => void
  alQuitarTodo: (varianteId: number) => void
  alAbrir: (item: ItemProducto) => void
}) {
  const t = useTema()
  const { producto: p, variantes } = item
  const fondo = pulsando ? tinte.fondo : n > 0 ? t.gris100 : 'transparent'

  if (variantes.length === 1) {
    const v = variantes[0]
    const nombre = nombreDe(p, v)
    return (
      <Pressable
        onPress={() => alAgregar(p, v)}
        accessibilityLabel={`Agregar ${nombre}`}
        style={({ pressed }) => [e.celda, { backgroundColor: pressed ? t.gris200 : fondo, borderLeftColor: tinte.borde }]}
      >
        <Text style={[e.nombre, { color: t.tinta }]}>{nombre}</Text>
        {/* null = monto libre: los envios cobran lo que se diga en cada pedido. */}
        {envio ? (
          <Text style={[e.libre, { color: t.tenue }]}>monto libre</Text>
        ) : (
          <Text style={[e.precio, { color: t.fuerte }]}>{fmt(v.precio)}</Text>
        )}
        {n > 0 ? <Cantidades n={n} nombre={nombre} alQuitar={() => alQuitar(v.id)} alQuitarTodo={() => alQuitarTodo(v.id)} /> : null}
      </Pressable>
    )
  }

  const precios = variantes.map((v) => v.precio)
  const desde = Math.min(...precios)
  const igual = precios.every((x) => x === desde)
  return (
    <Pressable
      onPress={() => alAbrir(item)}
      accessibilityLabel={`Elegir la variante de ${p.nombre}`}
      style={({ pressed }) => [e.celda, { backgroundColor: pressed ? t.gris200 : fondo, borderLeftColor: tinte.borde }]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[e.nombre, { color: t.tinta, flex: 0 }]}>{p.nombre}</Text>
        <Text style={[e.variantes, { color: t.suave }]}>{variantes.length} variantes</Text>
      </View>
      <Text style={[e.precio, { color: t.fuerte, fontSize: 14 }]}>{igual ? fmt(desde) : `desde ${fmt(desde)}`}</Text>
      {n > 0 ? <Globo n={n} /> : null}
      <Icono nombre="chevron" size={14} color={t.tenue} grosor={2.2} />
    </Pressable>
  )
})

/** Las tres piezas del renglon que ya va en la comanda: × todas, − una, cuantas. */
function Cantidades({
  n,
  nombre,
  alQuitar,
  alQuitarTodo,
}: {
  n: number
  nombre: string
  alQuitar: () => void
  alQuitarTodo: () => void
}) {
  const t = useTema()
  return (
    <View style={e.cantidades}>
      {/* Todas las unidades de una vez: diez empanadas eran diez toques. */}
      <Pressable
        onPress={alQuitarTodo}
        hitSlop={4}
        accessibilityLabel={`Quitar todas las de ${nombre}`}
        style={({ pressed }) => [e.redondo, { backgroundColor: pressed ? t.peligroSuave : 'transparent' }]}
      >
        <Icono nombre="quitar" size={15} color={t.tenue} grosor={2} />
      </Pressable>
      <Pressable
        onPress={alQuitar}
        hitSlop={4}
        accessibilityLabel={`Quitar uno de ${nombre}`}
        style={({ pressed }) => [e.redondo, { borderWidth: 1, borderColor: t.gris200, backgroundColor: pressed ? t.gris200 : t.superficie }]}
      >
        <Text style={[e.menos, { color: t.fuerte }]}>−</Text>
      </Pressable>
      <Globo n={n} />
    </View>
  )
}

function Globo({ n }: { n: number }) {
  const t = useTema()
  return (
    <View style={[e.globo, { backgroundColor: t.acento }]}>
      <Text style={[e.globoTexto, { color: t.acentoTinta }]}>{n}</Text>
    </View>
  )
}

/**
 * Las variantes de un producto, en una hoja que sube desde abajo (en la web
 * es un menu flotante pegado al renglon). NO se cierra al elegir: cada toque
 * suma uno, como en el resto de la lista. Se cierra con "Listo", tocando
 * afuera o con el gesto de atras.
 */
function HojaVariantes({
  item,
  cantidades,
  recien,
  fmt,
  alAgregar,
  alQuitar,
  alQuitarTodo,
  alCerrar,
}: {
  item: ItemProducto | null
  cantidades: Record<number, number>
  recien: Set<number>
  fmt: Fmt
  alAgregar: (p: Producto, v: Variante) => void
  alQuitar: (varianteId: number) => void
  alQuitarTodo: (varianteId: number) => void
  alCerrar: () => void
}) {
  const t = useTema()
  return (
    <Hoja visible={item !== null} alCerrar={alCerrar} titulo={item ? `Variantes de ${item.producto.nombre}` : undefined}>
      <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
        {item?.variantes.map((v) => {
          const n = cantidades[v.id] ?? 0
          const nombre = nombreDe(item.producto, v)
          return (
            <Pressable
              key={v.id}
              onPress={() => alAgregar(item.producto, v)}
              accessibilityLabel={`Agregar ${nombre}`}
              style={({ pressed }) => [
                e.variante,
                { backgroundColor: pressed ? t.gris200 : recien.has(v.id) ? t.acentoSuave : 'transparent' },
              ]}
            >
              <Text style={[e.nombre, { color: t.tinta, fontSize: 16 }]}>{v.nombre}</Text>
              <Text style={[e.precio, { color: t.fuerte }]}>{fmt(v.precio)}</Text>
              {n > 0 ? (
                <Cantidades n={n} nombre={nombre} alQuitar={() => alQuitar(v.id)} alQuitarTodo={() => alQuitarTodo(v.id)} />
              ) : null}
            </Pressable>
          )
        })}
      </ScrollView>
      <View style={{ paddingTop: 10, paddingHorizontal: 4 }}>
        <Boton texto="Listo" tono="neutro" alTocar={alCerrar} />
      </View>
    </Hoja>
  )
}

const e = StyleSheet.create({
  arriba: { paddingHorizontal: 16, gap: 10, paddingBottom: 6 },
  carril: { flexDirection: 'row', borderRadius: 999, padding: 4, borderWidth: 1, gap: 2 },
  pastilla: { paddingHorizontal: 15, minHeight: 36, borderRadius: 999, justifyContent: 'center' },
  pastillaTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14 },
  lista: { paddingHorizontal: 16, paddingBottom: 24 },
  titulo: { paddingTop: 6, paddingBottom: 2 },
  tituloTexto: { fontFamily: LETRA.textoFuerte, fontSize: 11, letterSpacing: 1.3 },
  tituloCuenta: { fontFamily: LETRA.texto, fontSize: 12.5, letterSpacing: 0 },
  cabeza: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 14, paddingBottom: 8 },
  punto: { width: 8, height: 8, borderRadius: 4 },
  cabezaTexto: { fontFamily: LETRA.textoFuerte, fontSize: 11.5, letterSpacing: 1.4, textTransform: 'uppercase' },
  grupo: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  grupoArriba: { borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  grupoAbajo: { borderBottomLeftRadius: 20, borderBottomRightRadius: 20 },
  celda: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 58,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 10,
    borderLeftWidth: 4,
  },
  nombre: { flex: 1, fontFamily: LETRA.textoFuerte, fontSize: 15, lineHeight: 20 },
  variantes: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 1 },
  precio: { fontFamily: LETRA.cifraFuerte, fontSize: 15 },
  libre: { fontFamily: LETRA.texto, fontSize: 13 },
  cantidades: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  redondo: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  menos: { fontFamily: LETRA.textoFuerte, fontSize: 19, lineHeight: 21 },
  globo: { minWidth: 28, height: 28, borderRadius: 14, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  globoTexto: { fontFamily: LETRA.cifraFuerte, fontSize: 14 },
  variante: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 12, borderRadius: 14, borderCurve: 'continuous' },
  vacio: { fontFamily: LETRA.texto, fontSize: 14, textAlign: 'center', paddingVertical: 32 },
})
