import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { LETRA, useModo, useTema } from '../lib/tema'
import Fondo from './Fondo'
import Icono, { type NombreIcono } from './Icono'

export type { NombreIcono }

/*
 * LAS PIEZAS DE LA APP, copiadas de la web (components/ui.tsx e index.css):
 * la "losa" del inicio (superficie con radio de 24 y sombra difusa, un pelo
 * de borde solo en oscuro), la etiqueta en mayusculas de 11 px, las cifras
 * en JetBrains Mono. Cuando exista `paquetes/ui`, estas piezas se escriben
 * una vez y las usan las dos.
 */

/** Una pantalla: el papel de la web detras, margen, se desliza y se refresca tirando. */
export function Pantalla({
  children,
  refrescando = false,
  alRefrescar,
  arriba,
}: {
  children: ReactNode
  refrescando?: boolean
  alRefrescar?: () => void
  /** Lo que va fijo arriba, fuera del desplazamiento (la barra de una pantalla interna). */
  arriba?: ReactNode
}) {
  const t = useTema()
  // Abajo, el aire de la barra del telefono: sin esto lo ultimo queda tapado.
  const borde = useSafeAreaInsets()
  return (
    <View style={{ flex: 1, backgroundColor: t.papel }}>
      <Fondo />
      <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1 }}>
        {arriba ? <View style={{ paddingHorizontal: 16 }}>{arriba}</View> : null}
        <ScrollView
          contentContainerStyle={[estilos.pantalla, { paddingBottom: 48 + borde.bottom }]}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            alRefrescar ? (
              <RefreshControl refreshing={refrescando} onRefresh={alRefrescar} tintColor={t.acento} colors={[t.acento]} />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    </View>
  )
}

/** La "losa" de la web: el contenedor de casi todo. `tono` la enciende cuando algo espera. */
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
  const { modo } = useModo()
  const fondo = tono === 'aviso' ? t.avisoSuave : tono === 'acento' ? t.acentoSuave : t.superficie
  const borde = tono === 'aviso' ? t.avisoLinea : modo === 'oscuro' ? 'rgba(255,255,255,0.06)' : t.linea
  return (
    <View style={[estilos.losa, { backgroundColor: fondo, borderColor: borde, shadowColor: '#17181b' }, style]}>
      {children}
    </View>
  )
}

/** Lo que se toca: se hunde un poco al apretar, como `vp-pulsable` en la web. */
export function Pulsable({
  children,
  alTocar,
  style,
  etiqueta,
  deshabilitado = false,
}: {
  children: ReactNode
  alTocar?: () => void
  style?: StyleProp<ViewStyle>
  etiqueta?: string
  deshabilitado?: boolean
}) {
  return (
    <Pressable
      onPress={alTocar}
      disabled={deshabilitado || !alTocar}
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      style={({ pressed }) => [style, { transform: [{ scale: pressed ? 0.985 : 1 }], opacity: deshabilitado ? 0.5 : 1 }]}
    >
      {children}
    </Pressable>
  )
}

/** El rotulo pequeño sobre un bloque: "HOY", "VENDER" (`vp-etiqueta`). */
export function Etiqueta({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const t = useTema()
  return <Text style={[estilos.etiqueta, { color: t.tenue }, style]}>{children}</Text>
}

export function Titulo({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const t = useTema()
  return <Text style={[estilos.titulo, { color: t.tinta }, style]}>{children}</Text>
}

/** Texto de apoyo, nunca por debajo de 13 px. */
export function Nota({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  const t = useTema()
  return <Text style={[estilos.nota, { color: t.suave }, style]}>{children}</Text>
}

/** Una cifra grande de la marca (Sora), o media/chica. */
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

/** Un renglon nombre ... valor, con un pelo entre renglones. */
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
    <View style={[estilos.fila, !ultima && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 }]}>
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
    <View style={[estilos.problema, { backgroundColor: t.peligroSuave }]}>
      <Text style={[estilos.texto, { color: t.peligro }]}>{mensaje}</Text>
      {alReintentar && (
        <Pressable onPress={alReintentar} hitSlop={8} style={{ marginTop: 10 }}>
          <Text style={[estilos.textoFuerte, { color: t.peligro }]}>Reintentar</Text>
        </Pressable>
      )}
    </View>
  )
}

/** Un aviso suave (exito o ambar), como los de la web despues de guardar. */
export function Aviso({ texto, tono = 'exito' }: { texto: string; tono?: 'exito' | 'aviso' | 'peligro' }) {
  const t = useTema()
  const fondo = tono === 'exito' ? t.exitoSuave : tono === 'aviso' ? t.avisoSuave : t.peligroSuave
  const color = tono === 'exito' ? t.exito : tono === 'aviso' ? t.aviso : t.peligro
  return (
    <View style={[estilos.problema, { backgroundColor: fondo }]}>
      <Text style={[estilos.nota, { color }]}>{texto}</Text>
    </View>
  )
}

/** El boton: `acento` (uno por pantalla), `neutro` o `peligro`. */
export function Boton({
  texto,
  alTocar,
  ocupado = false,
  icono,
  tono = 'acento',
  deshabilitado = false,
}: {
  texto: string
  alTocar: () => void
  ocupado?: boolean
  icono?: NombreIcono
  tono?: 'acento' | 'neutro' | 'peligro'
  deshabilitado?: boolean
}) {
  const t = useTema()
  const fondo = tono === 'acento' ? t.acento : tono === 'peligro' ? t.peligroSuave : t.superficie
  const tinta = tono === 'acento' ? t.acentoTinta : tono === 'peligro' ? t.peligro : t.tinta
  return (
    <Pressable
      onPress={alTocar}
      disabled={ocupado || deshabilitado}
      style={({ pressed }) => [
        estilos.boton,
        {
          backgroundColor: fondo,
          opacity: ocupado || deshabilitado ? 0.55 : pressed ? 0.88 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
        tono === 'neutro' && { borderWidth: 1, borderColor: t.gris200 },
      ]}
    >
      {ocupado ? (
        <ActivityIndicator color={tinta} />
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {icono && <Icono nombre={icono} size={17} color={tinta} />}
          <Text style={[estilos.botonTexto, { color: tinta }]}>{texto}</Text>
        </View>
      )}
    </Pressable>
  )
}

/** Un campo de texto con su rotulo y su ayuda, como los formularios de la web. */
export function Campo({
  rotulo,
  ayuda,
  error,
  style,
  ...props
}: TextInputProps & { rotulo?: string; ayuda?: string; error?: string }) {
  const t = useTema()
  return (
    <View style={{ gap: 6 }}>
      {rotulo ? <Text style={[estilos.rotulo, { color: t.suave }]}>{rotulo}</Text> : null}
      <TextInput
        placeholderTextColor={t.tenue}
        {...props}
        style={[
          estilos.campo,
          { backgroundColor: t.superficie, borderColor: error ? t.peligro : t.gris200, color: t.tinta },
          props.editable === false && { opacity: 0.6 },
          style,
        ]}
      />
      {error ? (
        <Text style={[estilos.nota, { color: t.peligro }]}>{error}</Text>
      ) : ayuda ? (
        <Text style={[estilos.nota, { color: t.tenue }]}>{ayuda}</Text>
      ) : null}
    </View>
  )
}

/** Un interruptor con su texto y su explicacion. */
export function Interruptor({
  texto,
  detalle,
  valor,
  alCambiar,
  deshabilitado = false,
}: {
  texto: string
  detalle?: string
  valor: boolean
  alCambiar: (v: boolean) => void
  deshabilitado?: boolean
}) {
  const t = useTema()
  return (
    <View style={estilos.interruptor}>
      <View style={{ flex: 1 }}>
        <Text style={[estilos.textoFuerte, { color: t.tinta }]}>{texto}</Text>
        {detalle ? <Text style={[estilos.nota, { color: t.suave, marginTop: 2 }]}>{detalle}</Text> : null}
      </View>
      <Switch
        value={valor}
        onValueChange={alCambiar}
        disabled={deshabilitado}
        trackColor={{ false: t.gris200, true: t.acento }}
        thumbColor="#ffffff"
      />
    </View>
  )
}

/**
 * Las pestañas de una pantalla (las "secciones" de la web: Mi cuenta,
 * Apariencia, Usuarios...): una fila de pastillas que se desliza de lado.
 */
export function Pestanas<T extends string>({
  opciones,
  valor,
  alCambiar,
}: {
  opciones: { id: T; texto: string }[]
  valor: T
  alCambiar: (id: T) => void
}) {
  const t = useTema()
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={estilos.pestanas}>
      <View style={[estilos.pestanasCaja, { backgroundColor: t.gris100, borderColor: t.gris200 }]}>
        {opciones.map((o) => {
          const activa = o.id === valor
          return (
            <Pressable
              key={o.id}
              onPress={() => alCambiar(o.id)}
              style={[estilos.pestana, activa && { backgroundColor: t.tinta }]}
              accessibilityState={{ selected: activa }}
            >
              <Text style={[estilos.pestanaTexto, { color: activa ? t.papel : t.suave }]}>{o.texto}</Text>
            </Pressable>
          )
        })}
      </View>
    </ScrollView>
  )
}

export const estilos = StyleSheet.create({
  pantalla: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 48, gap: 12 },
  losa: {
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    shadowOpacity: 0.12,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 2,
  },
  etiqueta: { fontFamily: LETRA.textoFuerte, fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase' },
  titulo: { fontFamily: LETRA.titulo, fontSize: 18, letterSpacing: -0.3 },
  nota: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
  texto: { fontFamily: LETRA.texto, fontSize: 15, lineHeight: 21 },
  textoFuerte: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  cifraGrande: { fontFamily: LETRA.tituloFuerte, fontSize: 46, letterSpacing: -1.4, lineHeight: 52 },
  cifraMedia: { fontFamily: LETRA.tituloFuerte, fontSize: 30, letterSpacing: -0.6 },
  cifraChica: { fontFamily: LETRA.cifra, fontSize: 15 },
  fila: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 11 },
  filaNombre: { fontFamily: LETRA.texto, fontSize: 15, flexShrink: 1 },
  filaNombreFuerte: { fontFamily: LETRA.textoFuerte, fontSize: 15, flexShrink: 1 },
  filaValor: { fontFamily: LETRA.cifra, fontSize: 15 },
  filaValorFuerte: { fontFamily: LETRA.cifraFuerte, fontSize: 16 },
  filaValorTexto: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  problema: { borderRadius: 16, padding: 14 },
  boton: { minHeight: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  botonTexto: { fontFamily: LETRA.textoFuerte, fontSize: 15.5 },
  rotulo: { fontFamily: LETRA.textoFuerte, fontSize: 13 },
  campo: { fontFamily: LETRA.texto, fontSize: 16, borderWidth: 1, borderRadius: 14, paddingHorizontal: 15, paddingVertical: 12 },
  interruptor: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 },
  pestanas: { paddingVertical: 4 },
  pestanasCaja: { flexDirection: 'row', borderRadius: 999, padding: 4, borderWidth: 1, gap: 2 },
  pestana: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999 },
  pestanaTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14 },
})
