import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { LETRA, useTema } from '../../lib/tema'
import { BotonAyuda } from '../reportes/comunes'

/**
 * Una cifra chica de Tasa (`Dato` de pages/Tasa.tsx): el titulo con su "i",
 * el valor en cifras y una nota de que es.
 */
export function Dato({ titulo, valor, nota, ayuda }: { titulo: string; valor: string; nota: string; ayuda?: string }) {
  const t = useTema()
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <View style={estilos.cabeza}>
        <Text style={[estilos.titulo, { color: t.suave }]} numberOfLines={1}>
          {titulo}
        </Text>
        {ayuda ? <BotonAyuda clave={ayuda} titulo={titulo} /> : null}
      </View>
      <Text style={[estilos.valor, { color: t.tinta }]} numberOfLines={1} adjustsFontSizeToFit>
        {valor}
      </Text>
      <Text style={[estilos.nota, { color: t.tenue }]}>{nota}</Text>
    </View>
  )
}

/** Dos datos por renglon, con aire entre renglones. */
export function ParDatos({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', gap: 16 }}>{children}</View>
}

/** El titulo y la explicacion de una losa de Tasa. */
export function Cabeza({ titulo, texto }: { titulo: string; texto?: string }) {
  const t = useTema()
  return (
    <View style={{ gap: 3 }}>
      <Text style={[estilos.losaTitulo, { color: t.tinta }]}>{titulo}</Text>
      {texto ? <Text style={[estilos.losaTexto, { color: t.suave }]}>{texto}</Text> : null}
    </View>
  )
}

export const estilos = StyleSheet.create({
  cabeza: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  titulo: { fontFamily: LETRA.textoFuerte, fontSize: 13, flexShrink: 1 },
  valor: { fontFamily: LETRA.cifraFuerte, fontSize: 18, marginTop: 4 },
  nota: { fontFamily: LETRA.texto, fontSize: 13, lineHeight: 17, marginTop: 2 },
  losaTitulo: { fontFamily: LETRA.titulo, fontSize: 16.5, letterSpacing: -0.2 },
  losaTexto: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
  texto: { fontFamily: LETRA.texto, fontSize: 14.5, lineHeight: 20 },
  cifra: { fontFamily: LETRA.cifra, fontSize: 14.5 },
})
