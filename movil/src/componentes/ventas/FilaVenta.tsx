import { memo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { etiquetaMetodo } from '../../../../frontend/src/lib/pagos'
import { fechaCorta, horaCorta } from '../../lib/numeros'
import { LETRA, useModo, useTema } from '../../lib/tema'
import type { VentaFila } from '../../lib/tipos'
import Icono from '../Icono'
import { Pastilla } from '../kit'
import { apagada as estaApagada, estadoDe } from './logica'

/**
 * UNA VENTA EN LA LISTA: la fila de la tabla de la web (#, fecha, que se
 * vendio, que paso, como se pago, quien, total) partida en dos lineas para
 * el pulgar. En la tablet entran tambien "Cómo se pagó" y "Quién", que en la
 * web aparecen desde pantalla mediana.
 *
 * Las filas forman una sola losa: la primera lleva las esquinas de arriba y
 * la ultima las de abajo, con un pelo entre ellas.
 */
function FilaVenta({
  v,
  total,
  debe,
  primera,
  ultima,
  ancha,
  alTocar,
}: {
  v: VentaFila
  /** El total ya escrito, con la tasa de ese dia. */
  total: string
  debe: string
  primera: boolean
  ultima: boolean
  ancha: boolean
  alTocar: (v: VentaFila) => void
}) {
  const t = useTema()
  const { modo } = useModo()
  const apagada = estaApagada(v)
  const estado = estadoDe(v)
  const borde = modo === 'oscuro' ? 'rgba(255,255,255,0.06)' : t.linea
  return (
    <Pressable
      onPress={() => alTocar(v)}
      accessibilityRole="button"
      accessibilityLabel={`Venta número ${v.numero}, ${v.detalle}, ${total}`}
      style={({ pressed }) => [
        e.fila,
        {
          backgroundColor: pressed ? t.gris100 : t.superficie,
          borderColor: borde,
          borderTopWidth: primera ? 1 : 0,
          borderBottomWidth: ultima ? 1 : StyleSheet.hairlineWidth,
          borderBottomColor: ultima ? borde : t.gris200,
        },
        primera && e.primera,
        ultima && e.ultima,
      ]}
    >
      <View style={e.arriba}>
        <Text style={[e.numero, { color: apagada ? t.tenue : t.suave }]}>{v.numero}</Text>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[e.detalle, { color: apagada ? t.tenue : t.tinta }, apagada && e.tachado]} numberOfLines={2}>
            {v.detalle || '—'}
          </Text>
          {v.cliente ? (
            <Text style={[e.cliente, { color: t.tenue }]} numberOfLines={1}>
              {v.cliente}
            </Text>
          ) : null}
        </View>
        {ancha ? (
          <View style={e.columna}>
            <Text style={[e.dato, { color: t.fuerte }]} numberOfLines={1}>
              {etiquetaMetodo(v.pago) || '—'}
            </Text>
            {v.facturado ? (
              <Text style={[e.cliente, { color: t.tenue }]} numberOfLines={1}>
                factura {v.numero_factura ?? ''}
              </Text>
            ) : null}
          </View>
        ) : null}
        {ancha ? (
          <View style={e.columna}>
            <Text style={[e.dato, { color: t.fuerte }]} numberOfLines={1}>
              {v.operador || '—'}
            </Text>
            {v.punto_venta ? (
              <Text style={[e.cliente, { color: t.tenue }]} numberOfLines={1}>
                {v.punto_venta}
              </Text>
            ) : null}
          </View>
        ) : null}
        <Text
          style={[e.total, { color: apagada ? t.tenue : t.tinta }, apagada ? [e.tachado, { fontFamily: LETRA.cifra }] : null]}
          numberOfLines={1}
        >
          {total}
        </Text>
      </View>
      <View style={e.abajo}>
        <Pastilla texto={estado.texto} tono={estado.tono} />
        {/* Pegada al detalle a proposito: lo que cambio son los renglones. */}
        {v.editado ? <Pastilla texto="Editada" tono="ojo" /> : null}
        {v.estado === 'fiada' && v.fiado_pendiente > 0 ? <Text style={[e.debe, { color: t.aviso }]}>debe {debe}</Text> : null}
        <Text style={[e.fecha, { color: t.tenue }]} numberOfLines={1}>
          {fechaCorta(v.fecha)} · {horaCorta(v.fecha)}
        </Text>
        <Icono nombre="chevron" size={13} color={t.tenue} grosor={2.2} />
      </View>
    </Pressable>
  )
}

export default memo(FilaVenta)

const e = StyleSheet.create({
  fila: { borderLeftWidth: 1, borderRightWidth: 1, paddingHorizontal: 16, paddingVertical: 12, gap: 8, minHeight: 64 },
  primera: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 14 },
  ultima: { borderBottomLeftRadius: 22, borderBottomRightRadius: 22, paddingBottom: 14 },
  arriba: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  numero: { fontFamily: LETRA.cifraFuerte, fontSize: 14, minWidth: 30, paddingTop: 1 },
  detalle: { fontFamily: LETRA.textoFuerte, fontSize: 15, lineHeight: 20 },
  tachado: { textDecorationLine: 'line-through' },
  cliente: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 2 },
  columna: { width: 150 },
  dato: { fontFamily: LETRA.texto, fontSize: 14 },
  total: { fontFamily: LETRA.cifraFuerte, fontSize: 15, maxWidth: '40%' },
  abajo: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingLeft: 40 },
  debe: { fontFamily: LETRA.textoFuerte, fontSize: 13 },
  fecha: { fontFamily: LETRA.texto, fontSize: 13, flexGrow: 1, textAlign: 'right' },
})
