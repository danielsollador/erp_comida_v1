import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { unidadDe } from '../../../../frontend/src/lib/inventario'
import { ALMACEN_DE, vaEnPreparacion } from '../../../../frontend/src/lib/tiposArticulo'
import { LETRA, useTema } from '../../lib/tema'
import type { Ingrediente } from '../../lib/tipos'
import Icono from '../Icono'
import { Buscador, llano, Selector } from '../kit'
import { Ficha } from '../ui'
import { fmtCant } from './cuentas'
import { PuntoTipo } from './piezas'

/**
 * "Toca lo que lleva" / "Agregar": la materia prima que puede ir en la
 * receta (crudo, empaques y otras preparaciones; nunca la reventa, los
 * desechables ni el aceite de freir), con su buscador y su categoria, como
 * la columna de la derecha de la olla en la web. Un toque y entra a la
 * receta, con la casilla lista para escribir cuanto.
 */
export default function Agregar({
  ingredientes,
  enReceta,
  prepId,
  vacia,
  alAgregar,
  dinero,
}: {
  ingredientes: Ingrediente[]
  /** Lo que ya esta en la receta: no se ofrece otra vez. */
  enReceta: Set<number>
  /** La preparacion que se edita: no puede llevarse a si misma. */
  prepId: number | null
  /** Todavia no lleva nada: el titulo invita a tocar. */
  vacia: boolean
  alAgregar: (ing: Ingrediente) => void
  dinero: (n: number) => string
}) {
  const t = useTema()
  const [busqueda, setBusqueda] = useState('')
  const [categoria, setCategoria] = useState('')

  // Las categorias del inventario que tienen algo que puede ir aqui, con cuantas.
  const categorias = useMemo(() => {
    const cuenta = new Map<string, number>()
    for (const i of ingredientes) if (vaEnPreparacion(i)) cuenta.set(i.categoria || '', (cuenta.get(i.categoria || '') ?? 0) + 1)
    return [...cuenta.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([n, c]) => ({ valor: n || '__sin__', texto: n || 'Sin categoría', contador: c }))
  }, [ingredientes])

  // Cada palabra tiene que estar, sin importar tildes ni mayusculas (como el buscador de las tablas de la web).
  const palabras = llano(busqueda).split(/\s+/).filter(Boolean)
  const disponibles = ingredientes
    .filter((i) => vaEnPreparacion(i) && i.id !== prepId && !enReceta.has(i.id))
    .filter((i) => !categoria || (i.categoria || '__sin__') === categoria)
    .filter((i) => palabras.length === 0 || palabras.every((p) => llano(`${i.nombre} ${i.categoria}`).includes(p)))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))

  return (
    <Ficha style={{ paddingHorizontal: 0, paddingVertical: 14 }}>
      <View style={a.cabeza}>
        <Text style={[a.titulo, { color: t.tinta }]}>{vacia ? 'Toca lo que lleva' : 'Agregar'}</Text>
        <Buscador valor={busqueda} alCambiar={setBusqueda} placeholder="Buscar materia prima" />
        {categorias.length > 1 ? (
          <View style={{ flexDirection: 'row' }}>
            <Selector
              etiqueta="Categoría"
              opciones={[{ valor: '', texto: 'Todas' }, ...categorias]}
              valor={categoria}
              alCambiar={setCategoria}
            />
          </View>
        ) : null}
      </View>
      {disponibles.length === 0 ? (
        <Text style={[a.nada, { color: t.tenue }]}>
          {ingredientes.length === 0 ? 'No hay materia prima en el inventario todavía.' : 'Nada coincide.'}
        </Text>
      ) : (
        <View>
          <View style={[a.columnas, { borderBottomColor: t.gris200 }]}>
            <Text style={[a.columna, { color: t.tenue, flex: 1 }]}>Mercancía</Text>
            <Text style={[a.columna, { color: t.tenue, marginRight: 40 }]}>Hay · costo</Text>
          </View>
          {disponibles.map((ing, n) => (
            <Pressable
              key={ing.id}
              onPress={() => alAgregar(ing)}
              accessibilityRole="button"
              accessibilityLabel={`Agregar ${ing.nombre}`}
              style={({ pressed }) => [
                a.fila,
                { backgroundColor: pressed ? t.gris100 : 'transparent' },
                n < disponibles.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 },
              ]}
            >
              <PuntoTipo tipo={ing.tipo} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[a.nombre, { color: t.tinta }]} numberOfLines={2}>
                  {ing.nombre}
                </Text>
                <Text style={[a.sub, { color: t.tenue }]} numberOfLines={1}>
                  {ing.tipo === 'preparacion' ? 'preparación' : ing.categoria || ALMACEN_DE[ing.tipo].texto}
                  {ing.tipo !== 'preparacion' && ing.rendimiento_pct < 100 ? ` · se aprovecha el ${Math.round(ing.rendimiento_pct)} %` : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[a.cifra, { color: t.suave }]} numberOfLines={1}>
                  {fmtCant(ing.stock_actual)} {unidadDe(ing.stock_actual, ing.unidad)}
                </Text>
                <Text style={[a.cifra, { color: t.tenue }]} numberOfLines={1}>
                  {dinero(ing.costo_unitario)} / {ing.unidad}
                </Text>
              </View>
              <View style={[a.mas, { backgroundColor: t.gris100 }]}>
                <Icono nombre="mas" size={15} color={t.suave} />
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </Ficha>
  )
}

const a = StyleSheet.create({
  cabeza: { paddingHorizontal: 16, gap: 10, paddingBottom: 8 },
  titulo: { fontFamily: LETRA.titulo, fontSize: 17, letterSpacing: -0.2 },
  nada: { fontFamily: LETRA.texto, fontSize: 14, paddingHorizontal: 16, paddingVertical: 10 },
  columnas: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  columna: { fontFamily: LETRA.textoFuerte, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11, minHeight: 56 },
  nombre: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  sub: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 1 },
  cifra: { fontFamily: LETRA.cifra, fontSize: 13 },
  mas: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
})
