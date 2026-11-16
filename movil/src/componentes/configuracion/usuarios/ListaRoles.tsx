import { Alert, StyleSheet, Text, View } from 'react-native'
import { apiUsuarios } from '../../../lib/api-usuarios'
import { LETRA, useTema } from '../../../lib/tema'
import type { RolInfo, Usuario } from '../../../lib/tipos'
import { Boton, Etiqueta, Ficha, Nota } from '../../ui'
import { restaurarRol } from './FormRol'
import { Encabezado, Enlace, Modulos, Pastilla } from './piezas'

/**
 * UN ROL ES LA LISTA DE MODULOS A LOS QUE ENTRA. Cada rol muestra sus
 * modulos en pastillas y, debajo, lo que se le puede hacer: Restaurar si es
 * de fabrica y ya se recorto, Editar si el servidor lo permite, Borrar si lo
 * creo el local.
 */
export default function ListaRoles({
  roles,
  usuarios,
  nombreLocal,
  alCrear,
  alEditar,
  alOk,
  alError,
}: {
  roles: RolInfo[]
  usuarios: Usuario[]
  nombreLocal: string
  alCrear: () => void
  alEditar: (r: RolInfo) => void
  /** Algo cambio en el servidor: el texto del aviso (y se recarga la lista). */
  alOk: (texto: string) => void
  alError: (texto: string) => void
}) {
  const cuantos = (r: RolInfo) => usuarios.filter((u) => u.rol === r.rol).length

  function borrar(r: RolInfo) {
    const n = cuantos(r)
    if (n > 0) {
      Alert.alert(`«${r.nombre}» está en uso`, `${n} usuario(s) tienen este rol. Cámbialos de rol primero y vuelve a borrarlo.`)
      return
    }
    Alert.alert(`¿Borrar el rol «${r.nombre}»?`, 'Deja de poder asignarse a nuevos usuarios.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiUsuarios.borrarRol(r.rol)
            alOk(`Rol «${r.nombre}» borrado.`)
          } catch (err) {
            alError((err as Error).message)
          }
        },
      },
    ])
  }

  // DOS MUNDOS, Y NO SE MEZCLAN. `interno` es el rol de Vertigo, la empresa
  // que opera la plataforma; el servidor solo se lo manda a Vertigo, asi que
  // en la pantalla del dueño esta lista llega sin ninguno y el bloque no se
  // dibuja: no es que se esconda, es que no existe para el.
  const internos = roles.filter((r) => r.interno)
  const delNegocio = roles.filter((r) => !r.interno)

  const fila = (r: RolInfo, i: number) => (
    <FilaRol
      key={r.rol}
      r={r}
      primera={i === 0}
      cuantos={cuantos(r)}
      alEditar={() => alEditar(r)}
      alRestaurar={() => restaurarRol(r, { alOk, alError })}
      alBorrar={() => borrar(r)}
    />
  )

  return (
    <Ficha style={{ gap: 14 }}>
      <Encabezado
        titulo="Roles"
        ayuda="Un rol es la lista de módulos a los que entra. Lo que no esté en la lista, el sistema se lo niega."
      />
      <Boton texto="+ Crear rol" alTocar={alCrear} />

      {internos.length > 0 && (
        <View style={{ gap: 4 }}>
          <Etiqueta>Interno de Vertigo</Etiqueta>
          <Nota>
            De la plataforma, no del negocio. No aparece en la pantalla del local: quien entra a {nombreLocal} no ve este
            bloque ni sabe que existe.
          </Nota>
          <View>{internos.map(fila)}</View>
        </View>
      )}

      <View style={{ gap: 4 }}>
        {internos.length > 0 && <Etiqueta>Del negocio</Etiqueta>}
        <Nota>
          De mayor a menor. Dueño es el rol más alto de {nombreLocal}: entra a todo lo suyo, y a nada de fuera.
        </Nota>
        <View>{delNegocio.map(fila)}</View>
      </View>
    </Ficha>
  )
}

function FilaRol({
  r,
  primera,
  cuantos,
  alEditar,
  alRestaurar,
  alBorrar,
}: {
  r: RolInfo
  primera: boolean
  cuantos: number
  alEditar: () => void
  alRestaurar: () => void
  alBorrar: () => void
}) {
  const t = useTema()
  const hayAcciones = r.ajustado || r.editable || r.a_medida
  return (
    <View style={[estilos.fila, !primera && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.gris200 }]}>
      <View style={estilos.cabeza}>
        <Text style={[estilos.nombre, { color: t.tinta }]}>{r.nombre}</Text>
        {!r.a_medida && <Text style={[estilos.chico, { color: t.tenue }]}>de fábrica</Text>}
        {r.ajustado && <Pastilla tono="acento">a tu medida</Pastilla>}
        {r.autoriza && <Pastilla tono="bien">autoriza</Pastilla>}
        <Text style={[estilos.chico, { color: t.tenue }]}>{cuantos === 0 ? 'sin usuarios' : `${cuantos} usuario(s)`}</Text>
      </View>
      {r.descripcion ? <Nota style={{ marginTop: 2 }}>{r.descripcion}</Nota> : null}
      <Modulos modulos={r.modulos} />
      {hayAcciones && (
        <View style={estilos.acciones}>
          {/* Restaurar tambien AQUI y no solo dentro de la edicion: es la
              salida cuando un recorte dejo a alguien sin poder trabajar, y
              entonces se busca rapido, no se entra a editar. */}
          {r.ajustado && <Enlace texto="Restaurar" tono="tenue" alTocar={alRestaurar} />}
          {r.editable && <Enlace texto="Editar" alTocar={alEditar} />}
          {r.a_medida && <Enlace texto="Borrar" tono="peligro" alTocar={alBorrar} />}
        </View>
      )}
    </View>
  )
}

const estilos = StyleSheet.create({
  fila: { paddingVertical: 12 },
  cabeza: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  nombre: { fontFamily: LETRA.textoFuerte, fontSize: 15.5 },
  chico: { fontFamily: LETRA.texto, fontSize: 12.5 },
  acciones: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, marginTop: 4, marginBottom: -8 },
})
