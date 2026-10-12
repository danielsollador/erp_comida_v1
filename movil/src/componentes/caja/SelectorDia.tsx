import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { hoyEnCaracas } from '../../lib/formato'
import { LETRA, useTema } from '../../lib/tema'
import { Hoja, OpcionHoja } from '../Hoja'
import Icono from '../Icono'
import { Pastilla, useDisposicion } from '../kit'
import { Etiqueta, Ficha } from '../ui'
import { diaLargo, nombreDelDia, sumarDias } from './logica'
import { Enlace } from './piezas'

/** Cuantos dias hacia atras ofrece la lista. Mas atras se llega con la flecha. */
const DIAS_EN_LISTA = 45

/**
 * QUE DIA SE ESTA CUADRANDO. Ayer, anteayer o el que sea: si anoche no dio
 * tiempo, se elige la fecha y el sistema trae los datos de ese dia (obligar
 * a cuadrar "hoy o nunca" es lo que hace que se dejen de cerrar cajas). En
 * la web es un campo de fecha; en el telefono, las flechas para ir de un dia
 * al de al lado y la lista de los ultimos dias para saltar de una. Hacia
 * adelante no se pasa de hoy: el servidor no cuadra un dia que no llego.
 */
export function SelectorDia({ dia, alCambiar, cerrada }: { dia: string; alCambiar: (d: string) => void; cerrada: boolean }) {
  const t = useTema()
  const { alto } = useDisposicion()
  const [abierto, setAbierto] = useState(false)
  const hoy = hoyEnCaracas()
  const esHoy = dia === hoy
  const dias = Array.from({ length: DIAS_EN_LISTA }, (_, i) => sumarDias(hoy, -i))

  const flecha = (atras: boolean) => {
    const deshabilitada = !atras && dia >= hoy
    return (
      <Pressable
        onPress={() => alCambiar(sumarDias(dia, atras ? -1 : 1))}
        disabled={deshabilitada}
        accessibilityRole="button"
        accessibilityLabel={atras ? 'El día anterior' : 'El día siguiente'}
        hitSlop={4}
        style={({ pressed }) => [
          estilos.flecha,
          { borderColor: t.gris200, backgroundColor: pressed ? t.gris100 : t.superficie, opacity: deshabilitada ? 0.35 : 1 },
        ]}
      >
        <View style={atras ? { transform: [{ rotate: '180deg' }] } : undefined}>
          <Icono nombre="chevron" size={16} color={t.suave} grosor={2.2} />
        </View>
      </Pressable>
    )
  }

  return (
    <Ficha style={{ paddingVertical: 16 }}>
      <View style={estilos.arriba}>
        <Etiqueta>Cuadrando el día</Etiqueta>
        {cerrada ? <Pastilla texto="Ya cerrada" tono="bien" /> : null}
      </View>
      <View style={estilos.fila}>
        <Pressable
          onPress={() => setAbierto(true)}
          accessibilityRole="button"
          accessibilityLabel={`Cuadrando el día ${diaLargo(dia, hoy)}. Elegir otro día`}
          style={({ pressed }) => [estilos.fecha, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={[estilos.fechaTexto, { color: t.tinta }]} numberOfLines={2}>
            {diaLargo(dia, hoy)}
          </Text>
          <View style={{ transform: [{ rotate: '90deg' }] }}>
            <Icono nombre="chevron" size={13} color={t.tenue} grosor={2.4} />
          </View>
        </Pressable>
        {flecha(true)}
        {flecha(false)}
      </View>
      {!esHoy ? (
        <View style={{ alignSelf: 'flex-start', marginBottom: -8 }}>
          <Enlace texto="Volver a hoy" alTocar={() => alCambiar(hoy)} />
        </View>
      ) : null}

      <Hoja visible={abierto} alCerrar={() => setAbierto(false)} titulo="Cuadrar otro día">
        <ScrollView style={{ maxHeight: alto * 0.6 }}>
          {dias.map((d) => (
            <OpcionHoja
              key={d}
              texto={nombreDelDia(d, hoy)}
              detalle={d === hoy || d === sumarDias(hoy, -1) ? diaLargo(d, hoy) : undefined}
              marcada={d === dia}
              alTocar={() => {
                setAbierto(false)
                alCambiar(d)
              }}
            />
          ))}
        </ScrollView>
      </Hoja>
    </Ficha>
  )
}

const estilos = StyleSheet.create({
  arriba: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 26 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  fecha: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  fechaTexto: { flexShrink: 1, fontFamily: LETRA.titulo, fontSize: 19, letterSpacing: -0.3 },
  flecha: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
})
