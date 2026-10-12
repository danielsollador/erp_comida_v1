import { useState, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import { LETRA, useTema } from '../../lib/tema'
import { comparar, type ValorOrden } from './cuentas'

/**
 * UNA TABLA DE LA WEB EN EL TELEFONO: Producto por producto, Registro por
 * registro, Para cuántos días alcanza, el historial de la tasa, la tabla de
 * un reporte a medida.
 *
 * La primera columna (el nombre, la fecha) queda FIJA y el resto se desliza
 * de lado dentro de la losa cuando no cabe: la pagina nunca se mueve de
 * lado, solo la tabla. Si cabe todo, la primera columna se estira y no hay
 * nada que deslizar.
 *
 * Se ordena como en la web: tocar el titulo de una columna ordena por ella;
 * tocarlo otra vez, al reves. Lo vacio siempre al final.
 */
export type Columna<T> = {
  clave: string
  titulo: string
  /** Ancho en pixeles. El de la primera es el minimo: se estira si sobra. */
  ancho: number
  derecha?: boolean
  /** Lo que va en la celda: un texto (se le pone la letra que toca) o algo propio (una pastilla). */
  celda: (f: T) => ReactNode
  /** Con que valor se ordena. Sin esto, la columna no se ordena. */
  orden?: (f: T) => ValorOrden
  /** La celda en negrita (el total de la fila). */
  fuerte?: boolean
  /** El color del texto de la celda. */
  color?: (f: T) => string | undefined
}

export function TablaDatos<T>({
  columnas,
  filas,
  claveFila,
  ordenInicial = '',
  pie,
  altoFila = 48,
}: {
  columnas: Columna<T>[]
  filas: T[]
  claveFila: (f: T, i: number) => string
  /** La columna con que abre; con guion delante, al reves ('-fecha'). */
  ordenInicial?: string
  /** La fila del total, una celda por columna. */
  pie?: ReactNode[]
  altoFila?: number
}) {
  const t = useTema()
  const [ancho, setAncho] = useState(0)
  const [orden, setOrden] = useState<{ clave: string | null; dir: 'asc' | 'desc' }>({
    clave: ordenInicial ? ordenInicial.replace(/^-/, '') : null,
    dir: ordenInicial.startsWith('-') ? 'desc' : 'asc',
  })
  const medir = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width)
    setAncho((a) => (a === w ? a : w))
  }

  const columnaOrden = columnas.find((c) => c.clave === orden.clave)
  const vista = columnaOrden?.orden ? [...filas].sort((a, b) => comparar(columnaOrden.orden!(a), columnaOrden.orden!(b), orden.dir)) : filas
  const alternar = (c: Columna<T>) => {
    if (!c.orden) return
    setOrden((o) => ({ clave: c.clave, dir: o.clave === c.clave && o.dir === 'asc' ? 'desc' : 'asc' }))
  }

  const [primera, ...resto] = columnas
  const anchoResto = resto.reduce((s, c) => s + c.ancho, 0)
  const anchoPrimera = Math.max(primera.ancho, ancho - anchoResto)

  const cabeza = (c: Columna<T>, w: number) => {
    const marcada = orden.clave === c.clave
    return (
      <Pressable
        key={c.clave}
        onPress={() => alternar(c)}
        disabled={!c.orden}
        accessibilityLabel={c.orden ? `Ordenar por ${c.titulo}` : c.titulo}
        style={[e.cabeza, { width: w, justifyContent: c.derecha ? 'flex-end' : 'flex-start' }]}
      >
        <Text style={[e.cabezaTexto, { color: marcada ? t.tinta : t.tenue }]} numberOfLines={1}>
          {c.titulo}
          {marcada ? (orden.dir === 'asc' ? ' ▲' : ' ▼') : ''}
        </Text>
      </Pressable>
    )
  }

  const celda = (c: Columna<T>, f: T, w: number, esPrimera: boolean) => {
    const contenido = c.celda(f)
    return (
      <View key={c.clave} style={[e.celda, { width: w, height: altoFila, alignItems: c.derecha ? 'flex-end' : 'flex-start' }]}>
        {typeof contenido === 'string' || typeof contenido === 'number' ? (
          <Text
            numberOfLines={esPrimera ? 2 : 1}
            style={[
              esPrimera ? e.textoPrimera : c.derecha ? e.cifra : e.texto,
              c.fuerte && { fontFamily: c.derecha ? LETRA.cifraFuerte : LETRA.textoFuerte },
              { color: c.color?.(f) ?? (esPrimera ? t.tinta : t.fuerte) },
            ]}
          >
            {contenido}
          </Text>
        ) : (
          contenido
        )}
      </View>
    )
  }

  const raya = { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 }
  const rayaPie = { borderTopWidth: 1, borderTopColor: t.gris200 }
  const celdaPie = (c: Columna<T>, i: number, w: number) => (
    <View key={c.clave} style={[e.celda, { width: w, height: altoFila, alignItems: c.derecha ? 'flex-end' : 'flex-start' }]}>
      {typeof pie?.[i] === 'string' ? (
        <Text style={[c.derecha ? e.cifra : e.textoPrimera, { fontFamily: c.derecha ? LETRA.cifraFuerte : LETRA.textoFuerte, color: t.tinta }]} numberOfLines={1}>
          {pie[i]}
        </Text>
      ) : (
        pie?.[i]
      )}
    </View>
  )

  return (
    <View style={{ flexDirection: 'row' }} onLayout={medir}>
      <View style={{ width: anchoPrimera }}>
        <View style={[e.filaCabeza, raya]}>{cabeza(primera, anchoPrimera)}</View>
        {vista.map((f, i) => (
          <View key={claveFila(f, i)} style={i < vista.length - 1 || pie ? raya : undefined}>
            {celda(primera, f, anchoPrimera, true)}
          </View>
        ))}
        {pie ? <View style={rayaPie}>{celdaPie(primera, 0, anchoPrimera)}</View> : null}
      </View>
      {resto.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
          <View>
            <View style={[e.filaCabeza, raya, { flexDirection: 'row' }]}>{resto.map((c) => cabeza(c, c.ancho))}</View>
            {vista.map((f, i) => (
              <View key={claveFila(f, i)} style={[{ flexDirection: 'row' }, i < vista.length - 1 || pie ? raya : undefined]}>
                {resto.map((c) => celda(c, f, c.ancho, false))}
              </View>
            ))}
            {pie ? <View style={[{ flexDirection: 'row' }, rayaPie]}>{resto.map((c, k) => celdaPie(c, k + 1, c.ancho))}</View> : null}
          </View>
        </ScrollView>
      ) : null}
    </View>
  )
}

const e = StyleSheet.create({
  filaCabeza: { height: 36 },
  cabeza: { height: 36, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6 },
  cabezaTexto: { fontFamily: LETRA.textoFuerte, fontSize: 11.5, letterSpacing: 0.8, textTransform: 'uppercase' },
  celda: { justifyContent: 'center', paddingHorizontal: 6 },
  textoPrimera: { fontFamily: LETRA.textoFuerte, fontSize: 14, lineHeight: 18 },
  texto: { fontFamily: LETRA.texto, fontSize: 14 },
  cifra: { fontFamily: LETRA.cifra, fontSize: 14 },
})
