import { Pressable, StyleSheet, Text, View } from 'react-native'
import { unidadDe } from '../../../../frontend/src/lib/inventario'
import { LETRA, useTema } from '../../lib/tema'
import type { Disponibilidad, Preparacion } from '../../lib/tipos'
import Icono from '../Icono'
import { Ficha } from '../ui'
import { fmtCant, unidadLarga } from './cuentas'
import { BotonChico, Caja, PuntoTipo } from './piezas'

/**
 * Una preparacion en una tarjeta (`TarjetaPreparacion` de la web): UN
 * numero grande (cuanto podrias hacer hoy, o cuanto hay hecho), con su
 * frase; lo que lleva, sin cifras de plata; y la receta a la vista. Tocar el
 * nombre la elige en el mapa.
 */
export function TarjetaPreparacion({
  p,
  d,
  color,
  elegida,
  alSeleccionar,
  dinero,
  alEditar,
  alTanda,
  alSobro,
}: {
  p: Preparacion
  d?: Disponibilidad
  color: string
  /** Es la que esta elegida en el mapa: se marca con su color. */
  elegida: boolean
  alSeleccionar: () => void
  dinero: (n: number) => string
  alEditar: () => void
  alTanda: () => void
  alSobro: () => void
}) {
  const t = useTema()
  const produce = p.modo_produccion === 'producir'
  const potencial = d?.potencial ?? null
  const desvio = p.rendimiento_real != null && Math.abs(p.rendimiento_real - 1) > 0.05
  return (
    <Ficha style={[{ padding: 16, gap: 12 }, elegida && { borderColor: color, borderWidth: 2 }]}>
      <View style={c.cabeza}>
        <View style={[c.raya, { backgroundColor: color }]} />
        <Pressable onPress={alSeleccionar} style={{ flex: 1, minWidth: 0 }} accessibilityRole="button" accessibilityLabel={`Ver ${p.nombre} en el mapa`}>
          <Text style={[c.nombre, { color: t.tinta }]} numberOfLines={2}>
            {p.nombre}
          </Text>
          <Text style={[c.sub, { color: t.suave }]}>
            {produce ? 'La cocina anota cada tanda' : 'Se descuenta del crudo al vender'} · cada {unidadLarga(p.unidad)} cuesta {dinero(p.costo_unitario)}
          </Text>
        </Pressable>
      </View>

      <Caja estilo={{ paddingVertical: 11 }}>
        <Text style={[c.cifra, { color: t.tinta }]} numberOfLines={1} adjustsFontSizeToFit>
          {produce
            ? `${fmtCant(p.stock_actual)} ${unidadDe(p.stock_actual, p.unidad)}`
            : potencial == null
              ? '—'
              : `${fmtCant(potencial)} ${unidadDe(potencial, p.unidad)}`}
        </Text>
        <Text style={[c.frase, { color: t.suave }]}>
          {produce
            ? potencial != null
              ? `hay hecho ahora mismo; con el crudo se podrían hacer ${fmtCant(potencial)} ${unidadDe(potencial, p.unidad)} más`
              : 'hay hecho ahora mismo'
            : d?.limita
              ? `podrías hacer hoy con el crudo que hay. Lo que se acaba primero: ${d.limita}${d.comparte_con.length > 0 ? `, que también usa ${d.comparte_con.join(' y ')}` : ''}`
              : 'podrías hacer hoy con el crudo que hay'}
        </Text>
      </Caja>

      <View style={{ gap: 5 }}>
        {p.lineas.slice(0, 3).map((l) => (
          <View key={l.ingrediente_id} style={c.linea}>
            <PuntoTipo tipo={l.tipo} />
            <Text style={[c.lineaNombre, { color: t.suave }]} numberOfLines={1}>
              {l.nombre}
            </Text>
            <Text style={[c.lineaCifra, { color: t.tenue }]}>
              {fmtCant(l.cantidad)} {unidadDe(l.cantidad, l.unidad)}
            </Text>
          </View>
        ))}
        {p.lineas.length > 3 ? <Text style={[c.mas, { color: t.tenue }]}>y {p.lineas.length - 3} más</Text> : null}
      </View>

      {desvio ? (
        <Caja tono="aviso" estilo={{ paddingVertical: 9 }}>
          <Text style={[c.frase, { color: t.avisoFuerte, marginTop: 0 }]}>
            Las últimas {p.tandas} tandas rindieron {Math.round((p.rendimiento_real ?? 1) * 100)} % de lo que dice la receta.
          </Text>
        </Caja>
      ) : null}

      <View style={c.botones}>
        <BotonChico texto="Ver la receta" icono="recetas" tono="tinta" alTocar={alEditar} />
        <BotonChico texto="Sobró hoy" alTocar={alSobro} />
        {produce ? <BotonChico texto="Anotar tanda" alTocar={alTanda} /> : null}
      </View>
    </Ficha>
  )
}

/**
 * Una tarjeta mas, al final: no le quita sitio a la lista ni ocupa una fila
 * propia arriba (Leider, 8-oct).
 */
export function TarjetaNueva({ alTocar }: { alTocar: () => void }) {
  const t = useTema()
  return (
    <Pressable
      onPress={alTocar}
      accessibilityRole="button"
      accessibilityLabel="Nueva preparación"
      style={({ pressed }) => [
        c.nueva,
        { borderColor: pressed ? t.tenue : t.barra, backgroundColor: pressed ? t.gris100 : 'transparent', transform: [{ scale: pressed ? 0.985 : 1 }] },
      ]}
    >
      <View style={[c.nuevaMas, { backgroundColor: t.fichaPrincipal }]}>
        <Icono nombre="mas" size={18} color={t.fichaPrincipalTinta} />
      </View>
      <Text style={[c.nuevaTitulo, { color: t.tinta }]}>Nueva preparación</Text>
      <Text style={[c.nuevaDetalle, { color: t.suave }]}>Qué crudo lleva 1 kilo (o 1 litro, o 1 unidad), como una receta.</Text>
    </Pressable>
  )
}

const c = StyleSheet.create({
  cabeza: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  raya: { width: 6, alignSelf: 'stretch', minHeight: 36, borderRadius: 3 },
  nombre: { fontFamily: LETRA.titulo, fontSize: 18, letterSpacing: -0.3 },
  sub: { fontFamily: LETRA.texto, fontSize: 13, lineHeight: 18, marginTop: 2 },
  cifra: { fontFamily: LETRA.tituloFuerte, fontSize: 26, letterSpacing: -0.6 },
  frase: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19, marginTop: 4 },
  linea: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lineaNombre: { flex: 1, minWidth: 0, fontFamily: LETRA.texto, fontSize: 13.5 },
  lineaCifra: { fontFamily: LETRA.cifra, fontSize: 13 },
  mas: { fontFamily: LETRA.texto, fontSize: 13, paddingLeft: 16 },
  botones: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  nueva: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: 22,
    minHeight: 150,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  nuevaMas: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  nuevaTitulo: { fontFamily: LETRA.titulo, fontSize: 16.5 },
  nuevaDetalle: { fontFamily: LETRA.texto, fontSize: 13, lineHeight: 18, textAlign: 'center', maxWidth: 260 },
})
