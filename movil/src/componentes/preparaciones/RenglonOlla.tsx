import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { unidadDe } from '../../../../frontend/src/lib/inventario'
import { aNumero, sinRuido } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import type { Ingrediente } from '../../lib/tipos'
import Icono from '../Icono'
import CasillaConUnidad from './CasillaConUnidad'
import { aNum, esGrande, fmtCant, OTRA_UNIDAD, type FilaOlla } from './cuentas'

/**
 * Un crudo de la receta: cuanto entra, que % se aprovecha y cuanto queda
 * (`RenglonOlla` de la web). En el telefono, el nombre arriba y debajo cuanto
 * entra y cuanto queda; el costo de cada cosa ya esta en la olla y aqui no
 * cabe, como en la web. En la tablet, todo en una linea con su costo.
 *
 * Lo que se escribe puede ir en gramos (kg ⇄ g): lo que se guarda va en la
 * unidad de la ficha. Mientras se escribe, la casilla muestra lo tecleado tal
 * cual ("0," mientras llega el 5); en la web se perdia la coma.
 */
export default function RenglonOlla({
  f,
  ing,
  color,
  resaltado,
  alResaltar,
  alCambiar,
  alQuitar,
  dinero,
  ancha,
  ultima,
}: {
  f: FilaOlla
  ing: Ingrediente
  color: string
  resaltado: boolean
  alResaltar: (id: number | null) => void
  alCambiar: (c: Partial<FilaOlla>) => void
  alQuitar: () => void
  dinero: (n: number, d?: number) => string
  /** Tablet: una linea con sus columnas. */
  ancha: boolean
  ultima: boolean
}) {
  const t = useTema()
  const otra = OTRA_UNIDAD[ing.unidad]
  const enChica = Boolean(otra && (f.enChica ?? esGrande(ing.unidad)))
  const factor = enChica ? (esGrande(ing.unidad) ? 1000 : 1 / 1000) : 1
  const unidadVista = enChica ? otra : ing.unidad
  const cantidad = aNum(f.cantidad)
  const pct = Math.min(Math.max(aNum(f.aprovechable), 0), 100)
  const queda = cantidad * (pct / 100)
  const costoU = ing.costo_unitario || 0
  const esPrep = ing.tipo === 'preparacion'

  // Lo tecleado tal cual, mientras siga diciendo lo mismo que la cantidad
  // guardada. Si la cantidad cambio por otro lado ("Ajustar al kilo"), manda
  // la guardada.
  const [borrador, setBorrador] = useState<string | null>(null)
  const coincide =
    borrador !== null &&
    (borrador === f.cantidad ||
      (borrador.trim() === '' ? f.cantidad === '' : Math.abs(aNumero(borrador) / factor - aNum(f.cantidad)) < 1e-6))
  const visto = coincide ? (borrador as string) : f.cantidad === '' ? '' : sinRuido(cantidad * factor)

  const escribir = (texto: string) => {
    setBorrador(texto)
    if (!enChica) return alCambiar({ cantidad: texto })
    const n = aNumero(texto)
    alCambiar({ cantidad: texto === '' || !Number.isFinite(n) ? texto : sinRuido(n / factor) })
  }

  const casilla = (
    <CasillaConUnidad
      unidad={ing.unidad}
      vista={unidadVista}
      alCambiarVista={() => {
        setBorrador(null)
        alCambiar({ enChica: !enChica })
      }}
      valor={visto}
      alCambiar={escribir}
      placeholder="0"
      etiqueta={`Cantidad de ${ing.nombre} que entra, en ${unidadVista}`}
      autoFocus={f.cantidad === ''}
      estilo={ancha ? { width: 150 } : { flex: 1 }}
    />
  )

  const cuantoQueda = (
    <View style={[e.queda, ancha && { width: 92 }]}>
      <Text style={[e.quedaCifra, { color: cantidad > 0 ? t.tinta : t.tenue }]} numberOfLines={1}>
        {cantidad > 0 ? (enChica ? `${fmtCant(queda * factor)} ${otra}` : `${fmtCant(queda)} ${unidadDe(queda, ing.unidad)}`) : '—'}
      </Text>
      {/* El % que se aprovecha es de la ficha del crudo; una preparacion
          dentro de otra no se "limpia": va entera. */}
      {cantidad > 0 && !esPrep ? (
        <View style={[e.pct, { borderBottomColor: t.barra }]}>
          <TextInput
            value={f.aprovechable}
            onChangeText={(v) => alCambiar({ aprovechable: v.replace(/[^\d.,]/g, '') })}
            keyboardType="decimal-pad"
            selectTextOnFocus
            accessibilityLabel={`Porcentaje de ${ing.nombre} que queda al cocinar`}
            style={[e.pctTexto, { color: t.suave }]}
          />
          <Text style={[e.pctSigno, { color: t.tenue }]}>%</Text>
        </View>
      ) : null}
    </View>
  )

  const quitar = (
    <Pressable
      onPress={alQuitar}
      accessibilityRole="button"
      accessibilityLabel={`Quitar ${ing.nombre}`}
      hitSlop={6}
      style={({ pressed }) => [e.quitar, { backgroundColor: pressed ? t.peligroSuave : 'transparent' }]}
    >
      <Icono nombre="quitar" size={15} color={t.tenue} />
    </Pressable>
  )

  const nombre = (
    <Pressable onPress={() => alResaltar(resaltado ? null : ing.id)} style={{ flex: 1, minWidth: 0 }} accessibilityLabel={`Ver ${ing.nombre} en la olla`}>
      <Text style={[e.nombre, { color: t.tinta }]} numberOfLines={2}>
        {ing.nombre}
      </Text>
      <Text style={[e.detalle, { color: t.tenue }]} numberOfLines={2}>
        {dinero(costoU, 2)} por {ing.unidad} · hay {fmtCant(ing.stock_actual)} {unidadDe(ing.stock_actual, ing.unidad)}
      </Text>
    </Pressable>
  )

  return (
    <View
      style={[
        e.renglon,
        { backgroundColor: resaltado ? t.acentoSuave : 'transparent' },
        !ultima && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 },
      ]}
    >
      <View style={[e.raya, { backgroundColor: color }]} />
      {ancha ? (
        <View style={e.linea}>
          {nombre}
          {casilla}
          {cuantoQueda}
          <Text style={[e.costo, { color: t.tinta }]} numberOfLines={1}>
            {cantidad > 0 ? dinero(cantidad * costoU) : '—'}
          </Text>
          {quitar}
        </View>
      ) : (
        <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
          <View style={e.linea}>
            {nombre}
            {quitar}
          </View>
          <View style={e.linea}>
            {casilla}
            {cuantoQueda}
          </View>
        </View>
      )}
    </View>
  )
}

const e = StyleSheet.create({
  renglon: { flexDirection: 'row', alignItems: 'stretch', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  raya: { width: 6, borderRadius: 3, minHeight: 28 },
  linea: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nombre: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  detalle: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 2 },
  queda: { width: 88, alignItems: 'flex-end', gap: 2 },
  quedaCifra: { fontFamily: LETRA.cifraFuerte, fontSize: 14.5 },
  pct: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, minHeight: 34 },
  pctTexto: { fontFamily: LETRA.cifra, fontSize: 14, minWidth: 34, textAlign: 'right', paddingVertical: 4 },
  pctSigno: { fontFamily: LETRA.texto, fontSize: 13, marginLeft: 2 },
  costo: { width: 72, textAlign: 'right', fontFamily: LETRA.cifraFuerte, fontSize: 14.5 },
  quitar: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
})
