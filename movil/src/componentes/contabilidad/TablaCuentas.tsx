import { StyleSheet, Text, View } from 'react-native'
import { useMoneda } from '../../lib/moneda'
import { LETRA, useTema } from '../../lib/tema'
import type { FilaBalanceComprobacion } from '../../lib/tipos'
import { useDisposicion } from '../kit'
import { Monto, p } from './piezas'

export type OrdenCuentas = 'cuenta' | 'debe' | 'haber' | 'saldo'

export const ORDENES_CUENTAS: { valor: OrdenCuentas; texto: string }[] = [
  { valor: 'cuenta', texto: 'Por código' },
  { valor: 'saldo', texto: 'Saldo, mayor primero' },
  { valor: 'debe', texto: 'Debe, mayor primero' },
  { valor: 'haber', texto: 'Haber, mayor primero' },
]

export function ordenarCuentas(filas: FilaBalanceComprobacion[], orden: OrdenCuentas): FilaBalanceComprobacion[] {
  const copia = [...filas]
  if (orden === 'cuenta') return copia.sort((a, b) => a.codigo.localeCompare(b.codigo))
  return copia.sort((a, b) => b[orden] - a[orden])
}

/**
 * Las cuentas con su debe, su haber y su saldo, y el total que cuadra (la
 * `TablaCuentas` de la web). En la tablet, las cuatro columnas de la web; en
 * el telefono no caben: cada cuenta es un renglon con el saldo a la derecha
 * y el debe y el haber debajo, sin que la pagina se corra de lado.
 */
export default function TablaCuentas({ filas, orden = 'cuenta' }: { filas: FilaBalanceComprobacion[]; orden?: OrdenCuentas }) {
  const t = useTema()
  const { fmt } = useMoneda()
  const { tablet } = useDisposicion()
  const totalDebe = filas.reduce((s, f) => s + f.debe, 0)
  const totalHaber = filas.reduce((s, f) => s + f.haber, 0)
  const ordenadas = ordenarCuentas(filas, orden)
  const linea = { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.gris200 }

  if (tablet) {
    return (
      <View>
        <View style={[estilos.filaTabla, { paddingVertical: 8 }]}>
          <Text style={[p.columna, { color: t.tenue, flex: 1 }]}>Cuenta</Text>
          <Text style={[p.columna, estilos.col, { color: t.tenue }]}>Debe</Text>
          <Text style={[p.columna, estilos.col, { color: t.tenue }]}>Haber</Text>
          <Text style={[p.columna, estilos.col, { color: t.tenue }]}>Saldo</Text>
        </View>
        {ordenadas.map((f) => (
          <View key={f.cuenta_id} style={[estilos.filaTabla, linea]}>
            <Text style={[estilos.nombre, { color: t.tinta, flex: 1 }]} numberOfLines={2}>
              <Text style={[p.codigo, { color: t.tenue }]}>{f.codigo}  </Text>
              {f.nombre}
            </Text>
            <Monto ancho={ANCHO}>{fmt(f.debe)}</Monto>
            <Monto ancho={ANCHO}>{fmt(f.haber)}</Monto>
            <Monto ancho={ANCHO} fuerte>
              {fmt(f.saldo)}
            </Monto>
          </View>
        ))}
        <View style={[estilos.filaTabla, { borderTopWidth: 2, borderTopColor: t.gris200 }]}>
          <Text style={[estilos.total, { color: t.tinta, flex: 1 }]}>Total</Text>
          <Monto ancho={ANCHO} fuerte>
            {fmt(totalDebe)}
          </Monto>
          <Monto ancho={ANCHO} fuerte>
            {fmt(totalHaber)}
          </Monto>
          <View style={{ width: ANCHO }} />
        </View>
      </View>
    )
  }

  return (
    <View>
      {ordenadas.map((f, i) => (
        <View key={f.cuenta_id} style={[estilos.renglon, i > 0 && linea]}>
          <Text style={[p.codigo, estilos.codigo, { color: t.tenue }]}>{f.codigo}</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[estilos.nombre, { color: t.tinta }]} numberOfLines={2}>
              {f.nombre}
            </Text>
            <Text style={[estilos.detalle, { color: t.suave }]} numberOfLines={2}>
              debe {fmt(f.debe)} · haber {fmt(f.haber)}
            </Text>
          </View>
          <View style={{ maxWidth: '42%' }}>
            <Monto fuerte>{fmt(f.saldo)}</Monto>
          </View>
        </View>
      ))}
      <View style={[estilos.renglon, { borderTopWidth: 2, borderTopColor: t.gris200 }]}>
        <Text style={[estilos.total, { color: t.tinta, flex: 1 }]}>Total</Text>
        <View style={{ alignItems: 'flex-end', maxWidth: '70%' }}>
          <Monto fuerte>debe {fmt(totalDebe)}</Monto>
          <Monto fuerte>haber {fmt(totalHaber)}</Monto>
        </View>
      </View>
    </View>
  )
}

const ANCHO = 118

const estilos = StyleSheet.create({
  filaTabla: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11 },
  col: { width: ANCHO, textAlign: 'right' },
  renglon: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 11 },
  codigo: { width: 40, marginTop: 1.5 },
  nombre: { fontFamily: LETRA.textoFuerte, fontSize: 14.5 },
  detalle: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 2 },
  total: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
})
