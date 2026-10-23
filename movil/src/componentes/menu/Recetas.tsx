import { router, type Href } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Ancla } from '../../lib/guia'
import { useMoneda } from '../../lib/moneda'
import { LETRA, useTema } from '../../lib/tema'
import Icono from '../Icono'
import { Buscador, FilaFiltros, Kpi, ListaFicha, Selector, useDisposicion, Vacio } from '../kit'
import { contiene, palabrasDe, renglonesDe, type DatosMenu, type RenglonReceta } from './datos'

/**
 * RECETAS: que lleva cada producto, y con eso cuanto cuesta y cuanto deja
 * (la lista de pages/partes/Recetas.tsx). Las dos cifras de arriba, buscar,
 * la categoria del menu y "Sin receta", que es el filtro que de verdad se
 * usa: sin receta un producto sale con 100 % de margen en Reportes, que es
 * peor que no tener el dato porque parece uno bueno.
 *
 * Tocar una fila abre su receta (/menu/recetas/<variante>). Un producto con
 * varias variantes es UNA fila que se toca para desglosarlas.
 */
type Orden = 'menu' | 'producto' | 'costo' | 'precio' | 'ganancia'

const ORDENES: { valor: Orden; texto: string; detalle?: string }[] = [
  { valor: 'menu', texto: 'Como en el menú' },
  { valor: 'producto', texto: 'Producto', detalle: 'De la A a la Z' },
  { valor: 'costo', texto: 'Cuesta hacerlo', detalle: 'De más a menos' },
  { valor: 'precio', texto: 'Precio', detalle: 'De más a menos' },
  { valor: 'ganancia', texto: 'Ganancia', detalle: 'La que más deja primero' },
]

const ganancia = (r: RenglonReceta) => (r.info?.sin_receta === false && r.info.costo != null ? r.variante.precio - r.info.costo : -1e9)

export default function Recetas({ datos }: { datos: DatosMenu }) {
  const t = useTema()
  const [busqueda, setBusqueda] = useState('')
  const [soloFaltan, setSoloFaltan] = useState(false)
  // Por categoria del menu, como en todas las pantallas: "" = todas.
  const [categoria, setCategoria] = useState('')
  const [orden, setOrden] = useState<Orden>('menu')
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set())

  const renglones = useMemo(() => renglonesDe(datos), [datos])
  const faltan = renglones.filter((r) => r.info?.sin_receta !== false).length

  const opcionesCategoria = useMemo(() => {
    const cuenta = new Map<string, number>()
    for (const r of renglones) cuenta.set(r.categoria, (cuenta.get(r.categoria) ?? 0) + 1)
    return [
      { valor: '', texto: 'Todas', contador: renglones.length },
      ...[...cuenta.entries()].map(([nombre, n]) => ({ valor: nombre, texto: nombre, contador: n })),
    ]
  }, [renglones])

  if (renglones.length === 0) {
    return (
      <Vacio
        icono="recetas"
        titulo="Todavía no hay productos"
        detalle="Crea el menú primero. La receta dice de qué mercancía y cuánto lleva cada producto, y de ahí salen el costo y el margen."
      />
    )
  }

  const palabras = palabrasDe(busqueda)
  const visibles = renglones.filter((r) => {
    if (categoria && r.categoria !== categoria) return false
    if (soloFaltan && r.info?.sin_receta === false) return false
    return palabras.length === 0 || contiene(`${r.categoria} ${r.nombre}`, palabras)
  })
  const ordenados =
    orden === 'menu'
      ? visibles
      : [...visibles].sort((a, b) => {
          if (orden === 'producto') return a.nombre.localeCompare(b.nombre)
          // Sin receta no hay costo: va al final, que es donde no estorba.
          if (orden === 'costo') return (b.info?.costo ?? -1) - (a.info?.costo ?? -1)
          if (orden === 'precio') return b.variante.precio - a.variante.precio
          return ganancia(b) - ganancia(a)
        })

  // Las dos cifras de arriba, de lo que se esta viendo (la categoria
  // filtrada): cuantos tienen receta, y cuanto deja el producto TIPICO. La
  // mediana y no el promedio: un solo producto a perdida volvia el promedio
  // un numero que no era de nadie (Leider, 1-oct).
  const delFiltro = renglones.filter((r) => !categoria || r.categoria === categoria)
  const conReceta = delFiltro.filter((r) => r.info?.sin_receta === false && r.info.costo != null)
  const margenes = conReceta.map((r) => r.info!.margen_pct ?? 0).sort((a, b) => a - b)
  const margenTipico = margenes.length
    ? margenes.length % 2
      ? margenes[(margenes.length - 1) / 2]
      : (margenes[margenes.length / 2 - 1] + margenes[margenes.length / 2]) / 2
    : 0
  const aPerdida = margenes.filter((m) => m < 0).length
  const sinReceta = delFiltro.length - conReceta.length
  const bien = { backgroundColor: t.exitoSuave, borderColor: t.exitoSuave }

  const grupos = agrupar(ordenados)
  const abrir = (r: RenglonReceta) => router.push(`/menu/recetas/${r.variante.id}` as Href)

  return (
    <>
      <View style={estilos.kpis}>
        <Kpi
          etiqueta="Productos con receta"
          cifra={`${conReceta.length} de ${delFiltro.length}`}
          nota={sinReceta > 0 ? `${sinReceta} sin receta: no se sabe cuánto cuestan ni cuánto dejan` : 'Todos tienen receta: el costo y el margen son de fiar'}
          tono={sinReceta > 0 ? 'aviso' : undefined}
          style={sinReceta > 0 ? undefined : bien}
        />
        <Kpi
          etiqueta="Ganancia que deja el producto típico"
          cifra={conReceta.length ? `${margenTipico.toFixed(0)}% del precio` : '—'}
          nota={
            !conReceta.length
              ? 'Ponles receta para saberlo'
              : aPerdida > 0
                ? `${aPerdida} ${aPerdida === 1 ? 'producto se vende' : 'productos se venden'} a pérdida`
                : 'ninguno a pérdida'
          }
          tono={conReceta.length > 0 && (aPerdida > 0 || margenTipico < 30) ? 'aviso' : undefined}
          style={conReceta.length > 0 && !(aPerdida > 0 || margenTipico < 30) ? bien : undefined}
        />
      </View>

      <Buscador valor={busqueda} alCambiar={setBusqueda} placeholder="Buscar un producto" />
      <FilaFiltros>
        <Selector<string> etiqueta="Categoría" opciones={opcionesCategoria} valor={categoria} alCambiar={setCategoria} />
        <Pressable
          onPress={() => setSoloFaltan((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ selected: soloFaltan }}
          style={({ pressed }) => [
            estilos.pastilla,
            {
              backgroundColor: soloFaltan ? t.aviso : t.superficie,
              borderColor: soloFaltan ? t.aviso : t.gris200,
              transform: [{ scale: pressed ? 0.97 : 1 }],
            },
          ]}
        >
          <Text style={[estilos.pastillaTexto, { color: soloFaltan ? t.papel : t.tinta }]}>Sin receta ({faltan})</Text>
        </Pressable>
        <Selector<Orden> etiqueta="Orden" titulo="Ordenar por" opciones={ORDENES} valor={orden} alCambiar={setOrden} />
      </FilaFiltros>

      {visibles.length === 0 ? (
        <Vacio
          icono="recetas"
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
        <ListaFicha>
          {grupos.map((g, i) => {
            const ultimo = i === grupos.length - 1
            if (g.renglones.length === 1) {
              const r = g.renglones[0]
              return <FilaReceta key={r.variante.id} r={r} nombre={r.nombre} ultima={ultimo} alTocar={() => abrir(r)} />
            }
            const desglosado = abiertos.has(g.productoId) || palabras.length > 0 || soloFaltan
            const faltanAqui = g.renglones.filter((r) => r.info?.sin_receta !== false).length
            return (
              <View key={`p${g.productoId}`}>
                {/* La guía señala la primera fila ("toca el producto"): cada
                    fila tocable lleva el ancla, como en la web. */}
                <Ancla nombre="recetas.lista">
                  <Pressable
                    onPress={() =>
                      setAbiertos((prev) => {
                        const n = new Set(prev)
                        if (n.has(g.productoId)) n.delete(g.productoId)
                        else n.add(g.productoId)
                        return n
                      })
                    }
                    accessibilityRole="button"
                    accessibilityState={{ expanded: desglosado }}
                    style={({ pressed }) => [
                      estilos.fila,
                      (!ultimo || desglosado) && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 },
                      pressed && { backgroundColor: t.gris100 },
                    ]}
                  >
                    <View style={{ transform: [{ rotate: desglosado ? '-90deg' : '90deg' }] }}>
                      <Icono nombre="chevron" size={14} color={t.tenue} grosor={2.2} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[estilos.nombre, { color: t.tinta }]} numberOfLines={1}>
                        {g.producto}
                      </Text>
                      <Text style={[estilos.detalle, { color: t.tenue }]} numberOfLines={2}>
                        {g.categoria} · {g.renglones.length} variantes
                        {faltanAqui > 0 ? (
                          <Text style={{ color: t.acento, fontFamily: LETRA.textoFuerte }}>
                            {' · '}
                            {faltanAqui === g.renglones.length ? 'sin receta' : `${faltanAqui} sin receta`}
                          </Text>
                        ) : null}
                        {desglosado ? ' · Toca para plegar' : ' · Toca para ver las variantes'}
                      </Text>
                    </View>
                  </Pressable>
                </Ancla>
                {desglosado
                  ? g.renglones.map((r, j) => (
                      <FilaReceta
                        key={r.variante.id}
                        r={r}
                        nombre={r.varianteNombre}
                        sangria
                        ultima={ultimo && j === g.renglones.length - 1}
                        alTocar={() => abrir(r)}
                      />
                    ))
                  : null}
              </View>
            )
          })}
        </ListaFicha>
      )}
    </>
  )
}

/** Las filas ya ordenadas, juntas por producto y en el orden en que aparece el primero de cada uno. */
function agrupar(renglones: RenglonReceta[]) {
  const grupos: { productoId: number; producto: string; categoria: string; renglones: RenglonReceta[] }[] = []
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
 * Una fila: el producto (o la variante, con sangria), lo que cuesta hacerlo
 * en la tablet, el precio y la ganancia en plata y en porcentaje. Dice que se
 * toca: la que no tiene receta lo pide en cobre.
 */
function FilaReceta({
  r,
  nombre,
  sangria = false,
  ultima,
  alTocar,
}: {
  r: RenglonReceta
  nombre: string
  sangria?: boolean
  ultima: boolean
  alTocar: () => void
}) {
  const t = useTema()
  const { fmt } = useMoneda()
  const { tablet } = useDisposicion()
  const falta = r.info?.sin_receta !== false
  const margen = falta ? null : r.info?.margen_pct
  const costo = falta ? null : (r.info?.costo ?? null)
  const precio = r.variante.precio
  const gan = costo != null ? precio - costo : null
  const colorGan = gan == null ? t.tinta : gan < 0 ? t.peligro : margen != null && margen >= 50 ? t.exito : t.aviso
  return (
    // Cada fila lleva el ancla de la guía: se resalta la primera y tocar
    // cualquiera avanza el paso.
    <Ancla nombre="recetas.lista">
      <Pressable
        onPress={alTocar}
        accessibilityRole="button"
        accessibilityLabel={`${nombre}: ${falta ? 'crear la receta' : 'editar la receta'}`}
        style={({ pressed }) => [
          estilos.fila,
          sangria && { paddingLeft: 42, backgroundColor: t.gris100 },
          !ultima && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 },
          pressed && { backgroundColor: t.gris200 },
        ]}
      >
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[sangria ? estilos.nombreSuave : estilos.nombre, { color: t.tinta }]} numberOfLines={2}>
            {nombre}
          </Text>
          <Text style={[estilos.detalle, { color: t.tenue }]} numberOfLines={1}>
            {sangria ? '' : `${r.categoria} · `}
            {falta ? (
              <Text style={{ color: t.acento, fontFamily: LETRA.textoFuerte }}>Toca para crear la receta</Text>
            ) : (
              'Toca para editar la receta'
            )}
          </Text>
        </View>
        {tablet ? (
          <View style={estilos.columna}>
            <Text style={[estilos.rotulo, { color: t.tenue }]}>Cuesta hacerlo</Text>
            <Text style={[estilos.cifra, { color: t.suave }]}>{costo != null ? fmt(costo) : '—'}</Text>
          </View>
        ) : null}
        <View style={estilos.columna}>
          {tablet ? <Text style={[estilos.rotulo, { color: t.tenue }]}>Precio</Text> : null}
          <Text style={[estilos.cifra, { color: t.tinta }]}>{fmt(precio)}</Text>
        </View>
        <View style={[estilos.columna, { minWidth: 86 }]}>
          {gan == null || margen == null ? (
            <View style={[estilos.sinReceta, { backgroundColor: t.avisoSuave }]}>
              <Text style={[estilos.sinRecetaTexto, { color: t.aviso }]}>SIN RECETA</Text>
            </View>
          ) : (
            <>
              <Text style={[estilos.cifraFuerte, { color: colorGan }]}>
                {gan < 0 ? '−' : '+'}
                {fmt(Math.abs(gan))}
              </Text>
              <Text style={[estilos.rotulo, { color: colorGan }]}>{gan < 0 ? 'a pérdida' : `${margen.toFixed(0)}% del precio`}</Text>
            </>
          )}
        </View>
      </Pressable>
    </Ancla>
  )
}

const estilos = StyleSheet.create({
  kpis: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  pastilla: { height: 38, borderRadius: 19, borderWidth: 1, paddingHorizontal: 14, justifyContent: 'center' },
  pastillaTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, minHeight: 60 },
  nombre: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  nombreSuave: { fontFamily: LETRA.texto, fontSize: 15 },
  detalle: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 2 },
  columna: { alignItems: 'flex-end' },
  rotulo: { fontFamily: LETRA.texto, fontSize: 12.5 },
  cifra: { fontFamily: LETRA.cifra, fontSize: 14.5 },
  cifraFuerte: { fontFamily: LETRA.cifraFuerte, fontSize: 14.5 },
  sinReceta: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  sinRecetaTexto: { fontFamily: LETRA.textoFuerte, fontSize: 11, letterSpacing: 0.6 },
})
