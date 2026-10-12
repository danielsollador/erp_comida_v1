import { Pressable, StyleSheet, Text, View } from 'react-native'
import { etiquetaMetodo } from '../../../../frontend/src/lib/pagos'
import { useMoneda } from '../../lib/moneda'
import { hora24, plural } from '../../lib/pos'
import { LETRA, useTema } from '../../lib/tema'
import type { Pedido } from '../../lib/tipos'
import Icono from '../Icono'
import { HojaFormulario } from '../kit'
import { Boton } from '../ui'

/*
 * LAS VENTAS DE HOY, para consultarlas sin salir del mostrador (el cuadro
 * "Ventas de hoy" de pages/POS.tsx). Se piden al abrir, no al cargar la
 * pantalla: se miran de vez en cuando y el punto de venta tiene que arrancar
 * rapido. El nombre primero: es lo que se viene a buscar aqui. Cada una
 * comparte su ticket (en la web, lo imprime).
 */
export function VentasDeHoy({
  ventas,
  cargando,
  alTicket,
  alCerrar,
}: {
  ventas: Pedido[]
  cargando: boolean
  alTicket: (id: number) => void
  alCerrar: () => void
}) {
  const t = useTema()
  const { fmt } = useMoneda()
  return (
    <HojaFormulario
      visible
      alCerrar={alCerrar}
      titulo="Ventas de hoy"
      subtitulo={cargando ? 'Buscando…' : `${plural(ventas.length, 'venta', 'ventas')} · ${fmt(ventas.reduce((s, v) => s + v.a_cobrar, 0))}`}
      pie={
        <View style={{ flex: 1 }}>
          <Boton texto="Cerrar" tono="neutro" alTocar={alCerrar} />
        </View>
      }
    >
      {ventas.length === 0 ? (
        <Text style={[e.vacio, { color: t.tenue }]}>{cargando ? 'Buscando…' : 'Todavía no se ha cobrado nada hoy.'}</Text>
      ) : (
        <View>
          {[...ventas].reverse().map((v, i, lista) => (
            <View key={v.id} style={[e.fila, i < lista.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 }]}>
              <Text style={[e.hora, { color: t.tenue }]}>{hora24(v.cerrado_en ?? v.creado_en)}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[e.nombre, { color: v.cliente ? t.tinta : t.tenue }]} numberOfLines={1}>
                  {v.cliente || 'sin nombre'}
                </Text>
                <Text style={[e.detalle, { color: t.tenue }]} numberOfLines={1}>
                  #{v.numero} · {etiquetaMetodo(v.metodo_pago || '')}
                  {v.devuelto ? ' · devuelta' : ''}
                </Text>
              </View>
              <Text style={[e.cifra, { color: v.devuelto ? t.tenue : t.tinta }, v.devuelto && { textDecorationLine: 'line-through' }]}>
                {fmt(v.a_cobrar)}
              </Text>
              <Pressable
                onPress={() => alTicket(v.id)}
                accessibilityLabel={`Compartir el ticket del pedido #${v.numero}`}
                style={({ pressed }) => [e.ticket, { backgroundColor: pressed ? t.gris200 : t.gris100 }]}
              >
                <Icono nombre="ventas" size={16} color={t.suave} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </HojaFormulario>
  )
}

const e = StyleSheet.create({
  vacio: { fontFamily: LETRA.texto, fontSize: 14, textAlign: 'center', paddingVertical: 24 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, minHeight: 56 },
  hora: { fontFamily: LETRA.cifra, fontSize: 13, width: 44 },
  nombre: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  detalle: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 1 },
  cifra: { fontFamily: LETRA.cifraFuerte, fontSize: 15 },
  ticket: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
})
