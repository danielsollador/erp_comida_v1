import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { LETRA, useTema } from '../../lib/tema'
import type { TipoArticulo } from '../../lib/tipos'
import Icono, { type NombreIcono } from '../Icono'
import { Nota, Titulo } from '../ui'
import { colorDeTipo } from './colores'

/*
 * Las piezas chicas que repiten Preparado, el conteo y el control: el punto
 * del tipo, el boton chico de una tarjeta, la cabecera de una losa (como
 * `Seccion` de la web) y el enlace de texto. Viven aqui para no tocar
 * ui.tsx ni kit.tsx, que son de todos.
 */

/** El error de una llamada, dicho en palabras (ErrorApi ya trae el `detail` del servidor). */
export function mensajeDe(e: unknown, siNo: string): string {
  return e instanceof Error && e.message ? e.message : siNo
}

/** El punto de color del tipo de mercancia (`PuntoTipo` de la web). */
export function PuntoTipo({ tipo }: { tipo: TipoArticulo }) {
  const t = useTema()
  return <View style={[p.punto, { backgroundColor: colorDeTipo(tipo, t) }]} />
}

/** La raya de color de una preparacion: la misma en el mapa, en su tarjeta y en la olla. */
export function Raya({ color, alto = 36 }: { color: string; alto?: number }) {
  return <View style={[p.raya, { backgroundColor: color, minHeight: alto }]} />
}

/** La cabecera de una losa, como `Seccion` en la web: titulo, su ayuda y una accion a la derecha. */
export function Cabecera({ titulo, ayuda, accion }: { titulo: string; ayuda?: ReactNode; accion?: ReactNode }) {
  return (
    <View style={p.cabecera}>
      <View style={p.cabeceraFila}>
        <Titulo style={{ flex: 1, fontSize: 17 }}>{titulo}</Titulo>
        {accion}
      </View>
      {ayuda ? typeof ayuda === 'string' ? <Nota>{ayuda}</Nota> : ayuda : null}
    </View>
  )
}

/**
 * El boton de una tarjeta ("Ver la receta", "Sobró hoy", "Anotar tanda"):
 * chico a la vista, con 44 px tocables. `tinta` es el lleno de la web
 * (bg-neutral-900); `claro` va sobre la tarjeta oscura; `neutro`, con borde.
 * Nunca acento: el acento es uno por pantalla.
 */
export function BotonChico({
  texto,
  alTocar,
  tono = 'neutro',
  icono,
  deshabilitado = false,
  estilo,
}: {
  texto: string
  alTocar: () => void
  tono?: 'tinta' | 'neutro' | 'claro' | 'peligro'
  icono?: NombreIcono
  deshabilitado?: boolean
  estilo?: StyleProp<ViewStyle>
}) {
  const t = useTema()
  // La ficha llena del tema (tinta en claro, clara en oscuro) y su letra.
  const fondo =
    tono === 'tinta' ? t.fichaPrincipal : tono === 'claro' ? t.fichaPrincipalTinta : tono === 'peligro' ? t.peligroSuave : t.superficie
  const tinta = tono === 'tinta' ? t.fichaPrincipalTinta : tono === 'claro' ? t.fichaPrincipal : tono === 'peligro' ? t.peligro : t.tinta
  return (
    <Pressable
      onPress={alTocar}
      disabled={deshabilitado}
      accessibilityRole="button"
      accessibilityLabel={texto}
      style={({ pressed }) => [
        p.botonChico,
        { backgroundColor: fondo, opacity: deshabilitado ? 0.5 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
        tono === 'neutro' && { borderWidth: 1, borderColor: t.gris200 },
        estilo,
      ]}
    >
      {icono ? <Icono nombre={icono} size={15} color={tinta} /> : null}
      <Text style={[p.botonChicoTexto, { color: tinta }]}>{texto}</Text>
    </Pressable>
  )
}

/** Un enlace de texto con area de toque de telefono ("Decidir", "Revertir", "Cerrar"). */
export function Enlace({
  texto,
  alTocar,
  tono = 'neutro',
  subrayado = false,
}: {
  texto: string
  alTocar: () => void
  tono?: 'neutro' | 'acento' | 'aviso' | 'peligro' | 'tenue'
  subrayado?: boolean
}) {
  const t = useTema()
  const color =
    tono === 'acento' ? t.acento : tono === 'aviso' ? t.avisoFuerte : tono === 'peligro' ? t.peligro : tono === 'tenue' ? t.suave : t.tinta
  return (
    <Pressable
      onPress={alTocar}
      accessibilityRole="button"
      hitSlop={6}
      style={({ pressed }) => [p.enlace, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={[p.enlaceTexto, { color }, subrayado && { textDecorationLine: 'underline' }]}>{texto}</Text>
    </Pressable>
  )
}

/** Una caja tenue (la `bg-neutral-500/6` de la web) o de aviso, sin borde: agrupa sin otra losa. */
export function Caja({
  children,
  tono = 'neutro',
  estilo,
}: {
  children: ReactNode
  tono?: 'neutro' | 'aviso' | 'peligro' | 'exito'
  estilo?: StyleProp<ViewStyle>
}) {
  const t = useTema()
  const fondo = tono === 'aviso' ? t.avisoSuave : tono === 'peligro' ? t.peligroSuave : tono === 'exito' ? t.exitoSuave : t.gris100
  return <View style={[p.caja, { backgroundColor: fondo }, estilo]}>{children}</View>
}

export const p = StyleSheet.create({
  punto: { width: 8, height: 8, borderRadius: 4 },
  raya: { width: 6, alignSelf: 'stretch', borderRadius: 3 },
  cabecera: { gap: 4, marginBottom: 12 },
  cabeceraFila: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  botonChico: {
    minHeight: 44,
    borderRadius: 13,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  botonChicoTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14.5 },
  enlace: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  enlaceTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14.5 },
  caja: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
})
