import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { CLARO, LETRA, OSCURO, useModo, useTema } from '../../lib/tema'
import { Nota } from '../ui'
import { Tarjeta } from './MiCuenta'

/**
 * Apariencia: como se ve. Vive aparte de la cuenta porque no es quien eres:
 * es de ESTE telefono, por eso se guarda en el telefono y no en el usuario
 * (lo mismo que hace la web con el navegador).
 *
 * De la web quedan las tarjetas que tienen sentido en un telefono: el Tema y
 * el aviso del teclado (la web, abierta en un telefono, muestra ese mismo
 * aviso en vez de las opciones). El tamano del texto en Cocina no esta: la
 * app no tiene la pantalla de Cocina, y elegirlo aqui no cambiaria nada.
 */
export default function Apariencia() {
  const { modo, cambiar } = useModo()

  return (
    <>
      <Tarjeta titulo="Tema" ayuda="Vale para todo el sistema en este equipo.">
        <View style={estilos.par}>
          <Opcion marcada={modo === 'claro'} titulo="Claro" detalle="Para el mostrador con luz de día." alElegir={() => cambiar('claro')}>
            {/* Colores fijos de cada paleta, no los del tema que se ve: una
                muestra del modo claro tiene que verse clara aunque la app
                este en oscuro. Con los del tema las dos muestras salian al
                reves (en la web paso lo mismo). */}
            <Muestra fondo={CLARO.superficie} borde={CLARO.gris200} raya={CLARO.barra} />
          </Opcion>
          <Opcion
            marcada={modo === 'oscuro'}
            titulo="Oscuro"
            detalle="Para la cocina y el turno de noche."
            alElegir={() => cambiar('oscuro')}
          >
            <Muestra fondo={OSCURO.superficie} borde={OSCURO.gris200} raya={OSCURO.barra} />
          </Opcion>
        </View>
      </Tarjeta>

      {/* En un telefono manda el teclado del propio telefono, asi que no hay
          nada que ajustar: se dice y ya, como la web en un telefono, en vez de
          ofrecer opciones que no harian nada. */}
      <Tarjeta
        titulo="Teclado en pantalla"
        ayuda="En un teléfono se escribe con el teclado del propio teléfono: el del sistema ya está hecho para el pulgar. El teclado de Sávora es para las tablets del mostrador."
      >
        <Nota>Sin opciones en este equipo.</Nota>
      </Tarjeta>
    </>
  )
}

/** Una opcion para elegir mirando: la muestra, el circulo de marcada, el nombre y para que sirve. */
function Opcion({
  marcada,
  titulo,
  detalle,
  alElegir,
  children,
}: {
  marcada: boolean
  titulo: string
  detalle: string
  alElegir: () => void
  children: ReactNode
}) {
  const t = useTema()
  return (
    <Pressable
      onPress={alElegir}
      accessibilityRole="radio"
      accessibilityState={{ checked: marcada }}
      accessibilityLabel={titulo}
      style={({ pressed }) => [
        estilos.opcion,
        { borderColor: marcada ? t.tinta : t.gris200, backgroundColor: marcada ? t.papel : 'transparent' },
        pressed && { transform: [{ scale: 0.985 }] },
      ]}
    >
      {children}
      <View style={estilos.nombre}>
        <View style={[estilos.circulo, { borderColor: marcada ? t.tinta : t.barra }]} />
        <Text style={[estilos.titulo, { color: t.tinta }]}>{titulo}</Text>
      </View>
      <Text style={[estilos.detalle, { color: t.suave }]}>{detalle}</Text>
    </Pressable>
  )
}

/** La pantallita de muestra: un fondo con una raya, en los colores de ese tema. */
function Muestra({ fondo, borde, raya }: { fondo: string; borde: string; raya: string }) {
  return (
    <View style={[estilos.muestra, { backgroundColor: fondo, borderColor: borde }]}>
      <View style={[estilos.raya, { backgroundColor: raya }]} />
    </View>
  )
}

const estilos = StyleSheet.create({
  par: { flexDirection: 'row', gap: 12 },
  opcion: { flex: 1, borderWidth: 1, borderRadius: 14, padding: 12 },
  muestra: { height: 48, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  raya: { width: 32, height: 6, borderRadius: 3 },
  nombre: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  circulo: { width: 14, height: 14, borderRadius: 7, borderWidth: 3 },
  titulo: { fontFamily: LETRA.textoFuerte, fontSize: 14 },
  detalle: { fontFamily: LETRA.texto, fontSize: 12.5, lineHeight: 17, marginTop: 2 },
})
