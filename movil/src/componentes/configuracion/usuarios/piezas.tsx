import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { LETRA, useTema } from '../../../lib/tema'
import type { Modulo, Rol, RolInfo } from '../../../lib/tipos'
import Icono from '../../Icono'
import { Nota, Titulo } from '../../ui'

/*
 * Las piezas que comparten las pantallas de Usuarios y Roles. Son las de la
 * web (Pastilla, la casilla con borde, el "← Volver") dibujadas con la paleta
 * de la app, para que el modo oscuro salga solo.
 */

/** Los nombres de los cuatro de fabrica, por si un usuario trae uno que no se reparte aqui (lib/acceso.tsx). */
const NOMBRE_ROL: Record<string, string> = {
  admin: 'Vertigo',
  dueno: 'Dueño',
  caja: 'Caja',
  cocina: 'Cocina',
}

export function nombreDeRol(roles: RolInfo[], rol: Rol, respaldo = ''): string {
  return roles.find((r) => r.rol === rol)?.nombre ?? (respaldo || NOMBRE_ROL[rol] || rol)
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic']

/**
 * "07 oct, 10:30 a. m.", como lo escribe la web con es-VE. A mano y en hora
 * de Caracas (UTC-4 fijo): el telefono no siempre trae Intl, y la hora del
 * ultimo acceso es la del local, no la de donde este el telefono.
 */
export function fechaCorta(segundos: number): string {
  const d = new Date(segundos * 1000 - 4 * 3600_000)
  const h = d.getUTCHours()
  const h12 = h % 12 === 0 ? 12 : h % 12
  const dos = (n: number) => String(n).padStart(2, '0')
  return `${dos(d.getUTCDate())} ${MESES[d.getUTCMonth()]}, ${dos(h12)}:${dos(d.getUTCMinutes())} ${h < 12 ? 'a. m.' : 'p. m.'}`
}

/** Sin acentos y en minusculas, para ordenar "Ángel" junto a "Andrea" y no al final. */
export function sinAcentos(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/** El "← Volver a la lista" de la web: saca del formulario sin guardar. */
export function Volver({ texto, alTocar }: { texto: string; alTocar: () => void }) {
  const t = useTema()
  return (
    <Pressable
      onPress={alTocar}
      accessibilityRole="button"
      hitSlop={6}
      style={({ pressed }) => [estilos.volver, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Icono nombre="atras" size={16} color={t.suave} />
      <Text style={[estilos.volverTexto, { color: t.suave }]}>{texto}</Text>
    </Pressable>
  )
}

/** Titulo y su linea de ayuda, como el encabezado de `Seccion` en la web. */
export function Encabezado({ titulo, ayuda }: { titulo: string; ayuda?: ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <Titulo>{titulo}</Titulo>
      {ayuda ? <Nota>{ayuda}</Nota> : null}
    </View>
  )
}

export function Pastilla({
  children,
  tono = 'neutro',
}: {
  children: ReactNode
  tono?: 'neutro' | 'bien' | 'ojo' | 'acento'
}) {
  const t = useTema()
  const fondo = tono === 'bien' ? t.exitoSuave : tono === 'ojo' ? t.avisoSuave : tono === 'acento' ? t.acentoSuave : t.gris100
  const color = tono === 'bien' ? t.exito : tono === 'ojo' ? t.aviso : tono === 'acento' ? t.acento : t.suave
  return (
    <View style={[estilos.pastilla, { backgroundColor: fondo }]}>
      <Text style={[estilos.pastillaTexto, { color }]}>{children}</Text>
    </View>
  )
}

/** Los modulos de un rol, en pastillas. */
export function Modulos({ modulos }: { modulos: Modulo[] }) {
  const t = useTema()
  if (modulos.length === 0) return <Nota style={{ color: t.tenue, marginTop: 6 }}>Ningún módulo.</Nota>
  return (
    <View style={estilos.pastillas}>
      {modulos.map((m) => (
        <Pastilla key={m.id}>{m.nombre}</Pastilla>
      ))}
    </View>
  )
}

/**
 * La casilla con borde de la web (`<label>` + checkbox): marcada, el borde se
 * oscurece. `fija` = la manda el servidor (el dueño autoriza siempre) y no se
 * toca, pero se ve, para que nadie la busque.
 */
export function Casilla({
  texto,
  detalle,
  marcada,
  fija = false,
  alCambiar,
}: {
  texto: string
  detalle?: string
  marcada: boolean
  fija?: boolean
  alCambiar: (v: boolean) => void
}) {
  const t = useTema()
  const borde = fija ? t.gris200 : marcada ? t.tinta : t.gris200
  const fondo = fija || marcada ? t.gris100 : 'transparent'
  return (
    <Pressable
      onPress={() => alCambiar(!marcada)}
      disabled={fija}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: marcada, disabled: fija }}
      style={({ pressed }) => [estilos.casilla, { borderColor: borde, backgroundColor: fondo, opacity: pressed ? 0.75 : 1 }]}
    >
      <View
        style={[
          estilos.cuadro,
          { borderColor: marcada ? t.tinta : t.barra, backgroundColor: marcada ? t.tinta : 'transparent', opacity: fija ? 0.55 : 1 },
        ]}
      >
        {marcada && <Icono nombre="ok" size={13} color={t.papel} grosor={2.6} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[estilos.casillaTexto, { color: t.tinta }]}>{texto}</Text>
        {detalle ? <Text style={[estilos.casillaDetalle, { color: t.suave }]}>{detalle}</Text> : null}
      </View>
    </Pressable>
  )
}

/** La lista de modulos para marcar al crear o editar un rol. */
export function ElegirModulos({
  catalogo,
  elegidos,
  alCambiar,
}: {
  catalogo: Modulo[]
  elegidos: string[]
  alCambiar: (ids: string[]) => void
}) {
  const alternar = (id: string) =>
    alCambiar(elegidos.includes(id) ? elegidos.filter((x) => x !== id) : [...elegidos, id])
  return (
    <View style={{ gap: 8 }}>
      {catalogo.map((m) => (
        <Casilla key={m.id} texto={m.nombre} marcada={elegidos.includes(m.id)} alCambiar={() => alternar(m.id)} />
      ))}
    </View>
  )
}

/** La casilla de "este rol ve las cifras del dia" (Vendido hoy, Pedidos). */
export function CasillaKpis({ marcada, fija, alCambiar }: { marcada: boolean; fija: boolean; alCambiar: (v: boolean) => void }) {
  return (
    <Casilla
      texto="Ve las cifras del día en el inicio"
      detalle={`«Vendido hoy» y «Pedidos» en la portada. Si no, ve un guion en su lugar.${fija ? ' El dueño las ve siempre.' : ''}`}
      marcada={marcada}
      fija={fija}
      alCambiar={alCambiar}
    />
  )
}

/**
 * La casilla de "este rol autoriza". Es una sola porque son las dos caras de
 * la misma autoridad: quien autoriza tiene PIN para firmar en el mostrador Y
 * recibe las solicitudes en su aplicacion para aprobarlas desde donde este.
 */
export function CasillaAutoriza({
  marcada,
  fija,
  alCambiar,
}: {
  marcada: boolean
  fija: boolean
  alCambiar: (v: boolean) => void
}) {
  return (
    <Casilla
      texto="Autoriza operaciones delicadas"
      detalle={`Puede tener PIN para firmar en el mostrador (editar una venta ya cobrada) y le llegan las solicitudes para aprobarlas desde su aplicación cuando no está en el local.${fija ? ' El dueño autoriza siempre.' : ''}`}
      marcada={marcada}
      fija={fija}
      alCambiar={alCambiar}
    />
  )
}

/** Un enlace de texto con area de toque de telefono (Editar, Borrar, Restaurar). */
export function Enlace({
  texto,
  alTocar,
  tono = 'neutro',
}: {
  texto: string
  alTocar: () => void
  tono?: 'neutro' | 'acento' | 'peligro' | 'tenue'
}) {
  const t = useTema()
  const color = tono === 'acento' ? t.acento : tono === 'peligro' ? t.peligro : tono === 'tenue' ? t.suave : t.tinta
  return (
    <Pressable
      onPress={alTocar}
      accessibilityRole="button"
      style={({ pressed }) => [estilos.enlace, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={[estilos.enlaceTexto, { color }]}>{texto}</Text>
    </Pressable>
  )
}

const estilos = StyleSheet.create({
  volver: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, alignSelf: 'flex-start' },
  volverTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14 },
  pastilla: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' },
  pastillaTexto: { fontFamily: LETRA.textoFuerte, fontSize: 12 },
  pastillas: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  casilla: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 48,
  },
  cuadro: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  casillaTexto: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  casillaDetalle: { fontFamily: LETRA.texto, fontSize: 13, lineHeight: 18, marginTop: 3 },
  enlace: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  enlaceTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14.5 },
})
