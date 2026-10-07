import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { LETRA, useTema } from '../../../lib/tema'
import Icono, { type NombreIcono } from '../../Icono'
import { Nota, Titulo } from '../../ui'

/*
 * Las piezas chicas de Pago movil que la web saca de components/ui.tsx
 * (Seccion, Pastilla, Vacio) y que la app todavia no tiene en ui.tsx. Viven
 * aqui para no tocar el archivo compartido; si otra seccion las necesita,
 * conviene subirlas a ui.tsx.
 */

/** El error de una llamada, dicho en palabras (ErrorApi ya trae el `detail` del servidor). */
export function mensajeDe(e: unknown, siNo: string): string {
  return e instanceof Error && e.message ? e.message : siNo
}

/** La cabecera de una losa, como `Seccion` en la web: titulo, accion a la derecha y su ayuda. */
export function Cabecera({ titulo, ayuda, accion }: { titulo: string; ayuda?: string; accion?: ReactNode }) {
  return (
    <View style={{ gap: 4, marginBottom: 14 }}>
      <View style={estilos.cabecera}>
        <Titulo style={{ flex: 1 }}>{titulo}</Titulo>
        {accion}
      </View>
      {ayuda ? <Nota>{ayuda}</Nota> : null}
    </View>
  )
}

/**
 * El boton "fantasma" de la web: solo texto. En el telefono conserva 44 px
 * de alto tocable aunque se vea chico, para no errarle con el pulgar.
 */
export function BotonTexto({
  texto,
  alTocar,
  tono = 'acento',
  deshabilitado = false,
}: {
  texto: string
  alTocar: () => void
  tono?: 'acento' | 'neutro' | 'peligro'
  deshabilitado?: boolean
}) {
  const t = useTema()
  const color = tono === 'acento' ? t.acento : tono === 'peligro' ? t.peligro : t.suave
  return (
    <Pressable
      onPress={alTocar}
      disabled={deshabilitado}
      accessibilityRole="button"
      accessibilityState={{ disabled: deshabilitado }}
      hitSlop={6}
      style={({ pressed }) => [estilos.botonTexto, { opacity: deshabilitado ? 0.45 : pressed ? 0.6 : 1 }]}
    >
      <Text style={[estilos.botonTextoLetra, { color }]}>{texto}</Text>
    </Pressable>
  )
}

/** La pastilla de estado de la web (`Pastilla`): bien, ojo o mal. */
export function Pastilla({ texto, tono }: { texto: string; tono: 'bien' | 'ojo' | 'mal' }) {
  const t = useTema()
  const fondo = tono === 'bien' ? t.exitoSuave : tono === 'ojo' ? t.avisoSuave : t.peligroSuave
  const color = tono === 'bien' ? t.exito : tono === 'ojo' ? t.aviso : t.peligro
  return (
    <View style={[estilos.pastilla, { backgroundColor: fondo }]}>
      <Text style={[estilos.pastillaTexto, { color }]}>{texto}</Text>
    </View>
  )
}

/** Un dato chico con su rotulo en mayusculas (los cuatro de la integracion). */
export function Dato({ titulo, valor, ayuda, ojo = false }: { titulo: string; valor: string; ayuda?: string; ojo?: boolean }) {
  const t = useTema()
  return (
    <View style={estilos.dato}>
      <Text style={[estilos.datoTitulo, { color: t.tenue }]}>{titulo}</Text>
      <Text style={[estilos.datoValor, { color: ojo ? t.aviso : t.tinta }]} numberOfLines={1}>
        {valor}
      </Text>
      {ayuda ? <Text style={[estilos.datoAyuda, { color: t.tenue }]}>{ayuda}</Text> : null}
    </View>
  )
}

/** Lo que se ve cuando todavia no hay nada (`Vacio` en la web): nunca una lista en blanco. */
export function Vacio({ icono, titulo, detalle }: { icono: NombreIcono; titulo: string; detalle: string }) {
  const t = useTema()
  return (
    <View style={estilos.vacio}>
      <View style={[estilos.vacioIcono, { backgroundColor: t.gris100 }]}>
        <Icono nombre={icono} size={24} color={t.tenue} />
      </View>
      <Text style={[estilos.vacioTitulo, { color: t.tinta }]}>{titulo}</Text>
      <Nota style={{ textAlign: 'center' }}>{detalle}</Nota>
    </View>
  )
}

const NOMBRES: Record<string, string> = {
  banco_venezuela: 'Banco de Venezuela',
  banesco: 'Banesco',
  banco_mercantil_ca: 'Mercantil',
  provincial: 'Provincial',
  bancamiga: 'Bancamiga',
  binance: 'Binance',
  test: 'Banco de prueba',
  notificaciones: 'Notificaciones del banco',
  VE_BAN: 'Banco de Venezuela',
  VE_BAN_EMP_V2: 'Banco de Venezuela (empresas)',
  MERCANTIL_EMP_V1: 'Mercantil (empresas)',
  VE_BANESCO_V1: 'Banesco (empresas)',
  VE_BANK_PLAZA_V1: 'Banco Plaza (empresas)',
  BINANCE_APP: 'Binance Pay',
  BANK_TEST: 'Banco de prueba',
  NOTIFICATION_ACCOUNT: 'Notificaciones del banco',
}

/** El nombre del banco en palabras; los mismos de la web (PagoMovil.tsx). */
export function nombreBanco(clave: string): string {
  return NOMBRES[clave] ?? clave.replace(/_/g, ' ')
}

const estilos = StyleSheet.create({
  cabecera: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  botonTexto: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
  botonTextoLetra: { fontFamily: LETRA.textoFuerte, fontSize: 14.5 },
  pastilla: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' },
  pastillaTexto: { fontFamily: LETRA.textoFuerte, fontSize: 12 },
  dato: { width: '50%', paddingRight: 10, paddingVertical: 8 },
  datoTitulo: { fontFamily: LETRA.textoFuerte, fontSize: 11, letterSpacing: 1.1, textTransform: 'uppercase' },
  datoValor: { fontFamily: LETRA.cifraFuerte, fontSize: 15, marginTop: 3 },
  datoAyuda: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 1 },
  vacio: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 8, gap: 6 },
  vacioIcono: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  vacioTitulo: { fontFamily: LETRA.titulo, fontSize: 17, letterSpacing: -0.2, textAlign: 'center' },
})
