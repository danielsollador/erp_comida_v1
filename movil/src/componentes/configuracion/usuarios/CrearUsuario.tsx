import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { apiUsuarios } from '../../../lib/api-usuarios'
import { LETRA, useTema } from '../../../lib/tema'
import type { Rol, RolInfo } from '../../../lib/tipos'
import { Hoja, OpcionHoja } from '../../Hoja'
import Icono from '../../Icono'
import { Aviso, Boton, Campo, Etiqueta, Ficha, Nota } from '../../ui'
import { Encabezado, Modulos, Volver } from './piezas'

/**
 * Crear un usuario, paso dentro de la lista (como en la web: no es una
 * pestaña aparte). El rol se elige en una hoja desde abajo, y antes de crear
 * se ve a que modulos va a entrar: lo que se entrega, antes de entregarlo.
 */
export default function CrearUsuario({
  roles,
  error,
  alVolver,
  alCreado,
  alError,
}: {
  roles: RolInfo[]
  error: string
  alVolver: () => void
  alCreado: (usuario: string) => void
  alError: (texto: string) => void
}) {
  const t = useTema()
  const [nombre, setNombre] = useState('')
  const [apellido, setApellido] = useState('')
  const [usuario, setUsuario] = useState('')
  const [usuarioTocado, setUsuarioTocado] = useState(false)
  const [clave, setClave] = useState('')
  const [clave2, setClave2] = useState('')
  // Caja por defecto, como la web; si este local no la reparte, el primero de la lista.
  const [rol, setRol] = useState<Rol>(() => (roles.some((r) => r.rol === 'caja') ? 'caja' : (roles[0]?.rol ?? 'caja')))
  const [eligiendoRol, setEligiendoRol] = useState(false)
  const [creando, setCreando] = useState(false)
  // Los "required" y "minLength" del formulario de la web los revisa el
  // navegador; aqui se marcan en el campo despues del primer intento.
  const [intentado, setIntentado] = useState(false)
  const elegido = roles.find((r) => r.rol === rol)

  // El usuario se propone solo a partir del nombre ("maria"), hasta que
  // alguien lo escriba a mano.
  function proponerUsuario(n: string) {
    if (usuarioTocado) return
    setUsuario(
      n
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9._-]/g, '')
        .slice(0, 32),
    )
  }

  const faltaNombre = !nombre.trim() ? 'Escribe su nombre.' : ''
  const faltaUsuario = !usuario.trim() ? 'Escribe el usuario con el que va a entrar.' : ''
  const claveCorta = clave.length < 8 ? '8 caracteres como mínimo.' : ''
  const clave2Corta = clave2.length < 8 ? '8 caracteres como mínimo.' : ''

  async function crear() {
    setIntentado(true)
    if (faltaNombre || faltaUsuario || claveCorta || clave2Corta) return
    if (clave !== clave2) {
      alError('Las dos contraseñas no coinciden.')
      return
    }
    setCreando(true)
    try {
      await apiUsuarios.crearUsuario({ usuario, clave, rol, nombre, apellido })
      alCreado(nombre.trim() || usuario.trim().toLowerCase())
    } catch (err) {
      alError((err as Error).message)
    } finally {
      setCreando(false)
    }
  }

  return (
    <>
      <Volver texto="Volver a la lista" alTocar={alVolver} />
      <Ficha style={{ gap: 16 }}>
        <Encabezado
          titulo="Nuevo usuario"
          ayuda="Su nombre es con el que se le saluda y el que queda en lo que hace. El usuario va en minúsculas y sin espacios; la clave, 8 caracteres como mínimo."
        />
        <Campo
          rotulo="Nombre"
          value={nombre}
          onChangeText={(v) => {
            setNombre(v)
            proponerUsuario(v)
          }}
          autoCapitalize="words"
          placeholder="ej. María"
          error={intentado ? faltaNombre : ''}
        />
        <Campo rotulo="Apellido" value={apellido} onChangeText={setApellido} autoCapitalize="words" placeholder="ej. Pérez" />
        <Campo
          rotulo="Usuario (para entrar)"
          value={usuario}
          onChangeText={(v) => {
            setUsuarioTocado(true)
            setUsuario(v)
          }}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          placeholder="ej. maria"
          error={intentado ? faltaUsuario : ''}
        />

        <View style={{ gap: 6 }}>
          <Text style={[estilos.rotulo, { color: t.suave }]}>Rol</Text>
          <Pressable
            onPress={() => setEligiendoRol(true)}
            accessibilityRole="button"
            accessibilityLabel="Elegir rol"
            style={({ pressed }) => [
              estilos.selector,
              { backgroundColor: t.superficie, borderColor: t.gris200, opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <Text style={[estilos.selectorTexto, { color: t.tinta }]}>{elegido?.nombre ?? rol}</Text>
            <View style={{ transform: [{ rotate: '90deg' }] }}>
              <Icono nombre="chevron" size={18} color={t.tenue} />
            </View>
          </Pressable>
        </View>

        <Campo
          rotulo="Contraseña"
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          autoCapitalize="none"
          autoCorrect={false}
          value={clave}
          onChangeText={setClave}
          error={intentado ? claveCorta : ''}
        />
        <Campo
          rotulo="Repetir contraseña"
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          autoCapitalize="none"
          autoCorrect={false}
          value={clave2}
          onChangeText={setClave2}
          error={intentado ? clave2Corta : ''}
        />

        {/* Lo que se le está entregando, antes de entregarlo. */}
        {elegido && (
          <View style={[estilos.resumen, { borderColor: t.gris200, backgroundColor: t.gris100 }]}>
            <Etiqueta>Con ese rol va a entrar a</Etiqueta>
            <Modulos modulos={elegido.modulos} />
            {elegido.autoriza && (
              <Nota style={{ marginTop: 10 }}>
                Este rol <Text style={{ fontFamily: LETRA.textoFuerte, color: t.tinta }}>autoriza</Text> operaciones:
                después de crearlo, ponle su PIN desde «Editar».
              </Nota>
            )}
            {elegido.descripcion ? <Nota style={{ marginTop: 8, color: t.tenue }}>{elegido.descripcion}</Nota> : null}
          </View>
        )}

        {/* El error va junto al boton: arriba, con el teclado abierto, no se ve. */}
        {error ? <Aviso texto={error} tono="peligro" /> : null}
        <Boton texto={creando ? 'Creando…' : 'Crear usuario'} alTocar={() => void crear()} deshabilitado={creando} />
      </Ficha>

      <Hoja visible={eligiendoRol} alCerrar={() => setEligiendoRol(false)} titulo="Rol">
        {roles.map((r) => (
          <OpcionHoja
            key={r.rol}
            texto={r.nombre}
            detalle={r.modulos.length ? r.modulos.map((m) => m.nombre).join(', ') : 'Ningún módulo.'}
            marcada={r.rol === rol}
            alTocar={() => {
              setRol(r.rol)
              setEligiendoRol(false)
            }}
          />
        ))}
      </Hoja>
    </>
  )
}

const estilos = StyleSheet.create({
  rotulo: { fontFamily: LETRA.textoFuerte, fontSize: 13 },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 15,
    minHeight: 50,
  },
  selectorTexto: { fontFamily: LETRA.texto, fontSize: 16 },
  resumen: { borderWidth: 1, borderRadius: 16, padding: 14 },
})
