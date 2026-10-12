import { Pressable, StyleSheet, Text, View } from 'react-native'
import { LETRA, useTema } from '../../lib/tema'
import { HojaFormulario } from '../kit'
import { Boton } from '../ui'

/*
 * A COCINA O DE LA VITRINA, RENGLON POR RENGLON. Leider (22-sep): "la tienda
 * va a tener ya comida de muestra... al darle al boton tiene que generarte
 * la opcion de si quieres mandarlo a cocina o no". Cada renglon nace con lo
 * que dice su categoria (el refresco no, la empanada si) y la cajera cambia
 * lo que haga falta.
 *
 * El mismo cuadro sirve para tres momentos de pages/POS.tsx: al mandar la
 * comanda, al guardar una edicion y al corregir despues un pedido ya tomado
 * (boton "Cocina" de cada pedido). Lo que la cocina ya hizo no se cambia.
 */

export type FilaCocina = {
  clave: number
  texto: string
  /** true = a cocina; false = de vitrina. */
  cocina: boolean
  /** La cocina ya lo termino o lo esta haciendo: queda fijo. */
  fijo?: 'hecho' | 'preparando'
  /** Por su categoria va a cocina y se marco de vitrina: ahi suele estar el error. */
  fueraDeLoNormal?: boolean
}

export function ElegirCocina({
  visible,
  titulo,
  ayuda,
  filas,
  nota,
  alAlternar,
  alTodoACocina,
  textoAceptar,
  alAceptar,
  alCerrar,
  ocupado = false,
  deshabilitado = false,
}: {
  visible: boolean
  titulo: string
  ayuda: string
  filas: FilaCocina[]
  nota?: string
  alAlternar: (clave: number) => void
  /** Solo "todo a cocina": equivocarse en esa direccion no deja a nadie esperando. */
  alTodoACocina?: () => void
  textoAceptar: string
  alAceptar: () => void
  alCerrar: () => void
  ocupado?: boolean
  deshabilitado?: boolean
}) {
  const t = useTema()
  return (
    <HojaFormulario
      visible={visible}
      alCerrar={alCerrar}
      titulo={titulo}
      subtitulo={ayuda}
      pie={
        <>
          <View style={{ flex: 1 }}>
            <Boton texto="Volver" tono="neutro" alTocar={alCerrar} />
          </View>
          <View style={{ flex: 2 }}>
            <Boton texto={textoAceptar} alTocar={alAceptar} ocupado={ocupado} deshabilitado={deshabilitado} />
          </View>
        </>
      }
    >
      {alTodoACocina ? (
        <Pressable
          onPress={alTodoACocina}
          style={({ pressed }) => [e.todo, { borderColor: t.gris200, backgroundColor: pressed ? t.gris100 : t.superficie }]}
        >
          <Text style={[e.todoTexto, { color: t.fuerte }]}>Todo a cocina</Text>
        </Pressable>
      ) : null}
      <View style={{ gap: 8 }}>
        {filas.map((f) => {
          const marco = f.fueraDeLoNormal
            ? { borderColor: t.peligro, backgroundColor: t.peligroSuave }
            : f.cocina
              ? { borderColor: t.avisoLinea, backgroundColor: t.avisoSuave }
              : { borderColor: t.gris200, backgroundColor: t.superficie }
          const pastilla =
            f.fijo === 'hecho'
              ? { fondo: t.exitoSuave, color: t.exito, texto: 'Cocina lo terminó' }
              : f.fijo === 'preparando'
                ? { fondo: t.avisoSuave, color: t.aviso, texto: 'En preparación' }
                : f.cocina
                  ? { fondo: t.aviso, color: t.avisoSuave, texto: 'A cocina' }
                  : { fondo: t.tinta, color: t.papel, texto: 'De vitrina' }
          return (
            <Pressable
              key={f.clave}
              onPress={() => alAlternar(f.clave)}
              disabled={Boolean(f.fijo)}
              accessibilityRole="switch"
              accessibilityState={{ checked: f.cocina, disabled: Boolean(f.fijo) }}
              style={({ pressed }) => [e.fila, marco, { opacity: f.fijo ? 0.6 : pressed ? 0.8 : 1 }]}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[e.texto, { color: t.tinta }]} numberOfLines={2}>
                  {f.texto}
                </Text>
                {f.fueraDeLoNormal ? (
                  <Text style={[e.alerta, { color: t.peligro }]}>Normalmente va a cocina: ¿ya está hecho en la vitrina?</Text>
                ) : null}
              </View>
              <View style={[e.pastilla, { backgroundColor: pastilla.fondo }]}>
                <Text style={[e.pastillaTexto, { color: pastilla.color }]}>{pastilla.texto}</Text>
              </View>
            </Pressable>
          )
        })}
      </View>
      {nota ? <Text style={[e.nota, { color: t.suave }]}>{nota}</Text> : null}
    </HojaFormulario>
  )
}

const e = StyleSheet.create({
  todo: { borderWidth: 1, borderRadius: 14, minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  todoTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14.5 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, minHeight: 56 },
  texto: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  alerta: { fontFamily: LETRA.textoFuerte, fontSize: 13, marginTop: 3, lineHeight: 18 },
  pastilla: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  pastillaTexto: { fontFamily: LETRA.textoFuerte, fontSize: 12.5 },
  nota: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
})
