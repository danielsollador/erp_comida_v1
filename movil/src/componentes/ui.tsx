import Feather from '@expo/vector-icons/Feather'
import type { ComponentProps, ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LETRA, useTema } from '../lib/tema'

/*
 * Las piezas de la app. Son las mismas ideas de la web (components/ui.tsx):
 * superficies con radio grande, una cifra grande por bloque, textos que se
 * leen de un vistazo. Cuando exista `paquetes/ui`, estas piezas pasan alli y
 * la web las usa tambien.
 */

export type NombreIcono = ComponentProps<typeof Feather>['name']

/** Una pantalla: fondo de papel, margen, se desliza y se refresca tirando hacia abajo. */
export function Pantalla({
  children,
  refrescando = false,
  alRefrescar,
}: {
  children: ReactNode
  refrescando?: boolean
  alRefrescar?: () => void
}) {
  const t = useTema()
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: t.papel }}>
      <ScrollView
        contentContainerStyle={estilos.pantalla}
        refreshControl={
          alRefrescar ? (
            <RefreshControl refreshing={refrescando} onRefresh={alRefrescar} tintColor={t.acento} colors={[t.acento]} />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  )
}

/** Una superficie: el contenedor de casi todo. `tono` la enciende cuando algo espera. */
export function Ficha({
  children,
  tono,
  style,
}: {
  children: ReactNode
  tono?: 'aviso' | 'acento'
  style?: StyleProp<ViewStyle>
}) {
  const t = useTema()
  const fondo = tono === 'aviso' ? t.avisoSuave : tono === 'acento' ? t.acentoSuave : t.superficie
  const borde = tono === 'aviso' ? t.avisoLinea : t.linea
  return <View style={[estilos.ficha, { backgroundColor: fondo, borderColor: borde }, style]}>{children}</View>
}

/** El rotulo pequeño sobre un bloque: "HOY", "ESTE MES". */
export function Etiqueta({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const t = useTema()
  return <Text style={[estilos.etiqueta, { color: t.tenue }, style]}>{children}</Text>
}

export function Titulo({ children }: { children: ReactNode }) {
  const t = useTema()
  return <Text style={[estilos.titulo, { color: t.tinta }]}>{children}</Text>
}

/** Texto de apoyo, nunca por debajo de 13 px. */
export function Nota({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const t = useTema()
  return <Text style={[estilos.nota, { color: t.suave }, style]}>{children}</Text>
}

/** Una cifra con cifras de ancho fijo: las columnas de numeros no bailan. */
export function Cifra({
  children,
  tamano = 'media',
  color,
}: {
  children: ReactNode
  tamano?: 'grande' | 'media' | 'chica'
  color?: string
}) {
  const t = useTema()
  const medida = tamano === 'grande' ? estilos.cifraGrande : tamano === 'media' ? estilos.cifraMedia : estilos.cifraChica
  return (
    <Text style={[medida, { color: color ?? t.tinta }]} numberOfLines={1} adjustsFontSizeToFit>
      {children}
    </Text>
  )
}

/** Un renglon nombre ... monto, con linea fina entre renglones. */
export function Fila({
  nombre,
  valor,
  fuerte = false,
  color,
  ultima = false,
  texto = false,
}: {
  nombre: string
  valor: string
  fuerte?: boolean
  color?: string
  ultima?: boolean
  /** El valor es una palabra (un usuario, un local), no una cifra: va en la letra del texto. */
  texto?: boolean
}) {
  const t = useTema()
  return (
    <View style={[estilos.fila, !ultima && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.linea }]}>
      <Text style={[fuerte ? estilos.filaNombreFuerte : estilos.filaNombre, { color: fuerte ? t.tinta : t.suave }]} numberOfLines={2}>
        {nombre}
      </Text>
      <Text
        style={[texto ? estilos.filaValorTexto : fuerte ? estilos.filaValorFuerte : estilos.filaValor, { color: color ?? t.tinta }]}
      >
        {valor}
      </Text>
    </View>
  )
}

export function Cargando() {
  const t = useTema()
  return (
    <View style={{ paddingVertical: 48, alignItems: 'center' }}>
      <ActivityIndicator color={t.acento} />
    </View>
  )
}

/** Un problema dicho en palabras, con su boton para reintentar. */
export function Problema({ mensaje, alReintentar }: { mensaje: string; alReintentar?: () => void }) {
  const t = useTema()
  return (
    <Ficha style={{ backgroundColor: t.peligroSuave, borderColor: 'transparent' }}>
      <Text style={[estilos.texto, { color: t.peligro }]}>{mensaje}</Text>
      {alReintentar && (
        <Pressable onPress={alReintentar} hitSlop={8} style={{ marginTop: 10 }}>
          <Text style={[estilos.textoFuerte, { color: t.peligro }]}>Reintentar</Text>
        </Pressable>
      )}
    </Ficha>
  )
}

/** El boton principal: uno por pantalla, en el color de la marca. */
export function Boton({
  texto,
  alTocar,
  ocupado = false,
  icono,
  tono = 'acento',
}: {
  texto: string
  alTocar: () => void
  ocupado?: boolean
  icono?: NombreIcono
  tono?: 'acento' | 'neutro'
}) {
  const t = useTema()
  const fondo = tono === 'acento' ? t.acento : t.superficie
  const tinta = tono === 'acento' ? t.acentoTinta : t.tinta
  return (
    <Pressable
      onPress={alTocar}
      disabled={ocupado}
      style={({ pressed }) => [
        estilos.boton,
        { backgroundColor: fondo, opacity: ocupado ? 0.6 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] },
        tono === 'neutro' && { borderWidth: 1, borderColor: t.linea },
      ]}
    >
      {ocupado ? (
        <ActivityIndicator color={tinta} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {icono && <Feather name={icono} size={17} color={tinta} />}
          <Text style={[estilos.botonTexto, { color: tinta }]}>{texto}</Text>
        </View>
      )}
    </Pressable>
  )
}

export const estilos = StyleSheet.create({
  pantalla: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 40, gap: 14 },
  ficha: {
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    shadowColor: '#17181b',
    shadowOpacity: 0.05,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 1,
  },
  etiqueta: { fontFamily: LETRA.textoFuerte, fontSize: 12, letterSpacing: 1.1, textTransform: 'uppercase' },
  titulo: { fontFamily: LETRA.titulo, fontSize: 19, letterSpacing: -0.3 },
  nota: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
  texto: { fontFamily: LETRA.texto, fontSize: 15, lineHeight: 21 },
  textoFuerte: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  cifraGrande: { fontFamily: LETRA.tituloFuerte, fontSize: 44, letterSpacing: -1.4, lineHeight: 50 },
  cifraMedia: { fontFamily: LETRA.tituloFuerte, fontSize: 28, letterSpacing: -0.6 },
  cifraChica: { fontFamily: LETRA.cifra, fontSize: 15 },
  fila: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 11 },
  filaNombre: { fontFamily: LETRA.texto, fontSize: 15, flexShrink: 1 },
  filaNombreFuerte: { fontFamily: LETRA.textoFuerte, fontSize: 15, flexShrink: 1 },
  filaValor: { fontFamily: LETRA.cifra, fontSize: 15 },
  filaValorFuerte: { fontFamily: LETRA.cifraFuerte, fontSize: 16 },
  filaValorTexto: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  boton: { minHeight: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  botonTexto: { fontFamily: LETRA.textoFuerte, fontSize: 16 },
})
