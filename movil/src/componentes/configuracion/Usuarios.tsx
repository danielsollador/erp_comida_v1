import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert } from 'react-native'
import { apiUsuarios } from '../../lib/api-usuarios'
import { useSesion } from '../../lib/sesion'
import type { ListaUsuarios as Lista, Rol, Usuario } from '../../lib/tipos'
import { Aviso, Cargando, Problema } from '../ui'
import CrearUsuario from './usuarios/CrearUsuario'
import EditarUsuario from './usuarios/EditarUsuario'
import FormRol from './usuarios/FormRol'
import ListaRoles from './usuarios/ListaRoles'
import ListaUsuarios from './usuarios/ListaUsuarios'
import { nombreDeRol } from './usuarios/piezas'

/**
 * Las pestañas Usuarios y Roles de Configuracion, como `PanelUsuarios` de la
 * web (pages/Usuarios.tsx): las mismas llamadas, los mismos textos y las
 * mismas reglas. Solo quien gestiona usuarios llega aqui (la ruta lo
 * comprueba y el backend responde 403 a los demas). Los roles que se ofrecen
 * los manda el servidor: un dueño no ve la opcion de fabricar administradores.
 *
 * Crear o editar no es otra ruta: es un paso dentro de la lista, con su
 * "Volver", igual que en la web. Asi la barra de atras sigue sacando de
 * Configuracion y no de un formulario a medias.
 */
type Vista =
  | { tipo: 'lista' }
  | { tipo: 'crear' }
  | { tipo: 'editar-usuario'; usuario: string }
  | { tipo: 'editar-rol'; rol: Rol }

export default function Usuarios({ seccion }: { seccion: 'usuarios' | 'roles' }) {
  const { acceso, recargar } = useSesion()
  const [lista, setLista] = useState<Lista | null>(null)
  const [cargaFallida, setCargaFallida] = useState('')
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  // La vista recuerda de que pestaña es: al cambiar de pestaña se vuelve a la
  // lista sola, sin un efecto que la reinicie. Un formulario a medio llenar
  // de "crear usuario" no tiene por que aparecer al abrir Roles.
  const [estado, setEstado] = useState<{ seccion: string; vista: Vista }>({ seccion, vista: { tipo: 'lista' } })
  const vista: Vista = estado.seccion === seccion ? estado.vista : { tipo: 'lista' }
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null)

  const nombreLocal = acceso?.local.nombre ?? ''

  const cargar = useCallback(() => {
    apiUsuarios
      .listarUsuarios()
      .then((l) => {
        setLista(l)
        setCargaFallida('')
      })
      .catch((e: Error) => setCargaFallida(e.message))
  }, [])

  useEffect(() => {
    cargar()
    return () => {
      if (reloj.current) clearTimeout(reloj.current)
    }
  }, [cargar])

  function ir(v: Vista) {
    setError('')
    setEstado({ seccion, vista: v })
  }

  function ok(texto: string) {
    setError('')
    setAviso(texto)
    if (reloj.current) clearTimeout(reloj.current)
    reloj.current = setTimeout(() => setAviso(''), 3500)
  }

  /** Si lo que cambio es de quien esta dentro, la sesion se vuelve a pedir (menu, PIN, nombre). */
  function alDia() {
    recargar().catch(() => undefined)
  }

  async function cambiarRol(u: Usuario, nuevo: Rol) {
    try {
      await apiUsuarios.cambiarRol(u.usuario, nuevo)
      ok(`${u.usuario} ahora es ${nombreDeRol(lista?.roles ?? [], nuevo).toLowerCase()}. Sus sesiones abiertas se cerraron.`)
      cargar()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  function borrar(u: Usuario) {
    Alert.alert(`¿Borrar el usuario «${u.usuario}»?`, 'Lo que hizo queda en el historial; solo deja de poder entrar.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Borrar',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiUsuarios.borrarUsuario(u.usuario)
            ok(`Usuario «${u.usuario}» borrado.`)
            cargar()
          } catch (err) {
            setError((err as Error).message)
          }
        },
      },
    ])
  }

  if (!lista) {
    return cargaFallida ? <Problema mensaje={cargaFallida} alReintentar={cargar} /> : <Cargando />
  }

  const roles = lista.roles
  const enLista = vista.tipo === 'lista'

  // En la lista los avisos van arriba; en un formulario el error va junto a
  // su boton (lo dibuja el formulario) y aqui solo el de exito.
  const avisos = (
    <>
      {enLista && error ? <Aviso texto={error} tono="peligro" /> : null}
      {aviso ? <Aviso texto={aviso} /> : null}
    </>
  )

  if (seccion === 'usuarios') {
    if (vista.tipo === 'crear') {
      return (
        <>
          {avisos}
          <CrearUsuario
            roles={roles}
            error={error}
            alVolver={() => ir({ tipo: 'lista' })}
            alCreado={(usuario) => {
              ir({ tipo: 'lista' })
              ok(`Usuario «${usuario}» creado.`)
              cargar()
            }}
            alError={setError}
          />
        </>
      )
    }
    const editado = vista.tipo === 'editar-usuario' ? lista.usuarios.find((u) => u.usuario === vista.usuario) : undefined
    if (editado) {
      return (
        <>
          {avisos}
          <EditarUsuario
            key={editado.usuario}
            u={editado}
            autoriza={roles.find((r) => r.rol === editado.rol)?.autoriza ?? false}
            error={error}
            alVolver={() => ir({ tipo: 'lista' })}
            alCambio={(texto) => {
              ir({ tipo: 'lista' })
              ok(texto)
              cargar()
              if (editado.usuario === lista.yo) alDia()
            }}
            alError={setError}
          />
        </>
      )
    }
    return (
      <>
        {avisos}
        <ListaUsuarios
          lista={lista}
          nombreLocal={nombreLocal}
          alCrear={() => ir({ tipo: 'crear' })}
          alEditar={(u) => ir({ tipo: 'editar-usuario', usuario: u.usuario })}
          alCambiarRol={(u, r) => void cambiarRol(u, r)}
          alBorrar={borrar}
        />
      </>
    )
  }

  // ── Roles ──
  // Un rol cambiado puede ser el de quien esta dentro: sus modulos (el menu)
  // cambian con el, asi que la sesion se pide de nuevo.
  const rolCambiado = (texto: string, rol?: Rol) => {
    ir({ tipo: 'lista' })
    ok(texto)
    cargar()
    if (!rol || rol === acceso?.rol) alDia()
  }

  if (vista.tipo === 'crear') {
    return (
      <>
        {avisos}
        <FormRol
          catalogo={lista.modulos}
          error={error}
          alVolver={() => ir({ tipo: 'lista' })}
          alListo={(texto) => {
            ir({ tipo: 'lista' })
            ok(texto)
            cargar()
          }}
          alError={setError}
        />
      </>
    )
  }
  const rolEditado = vista.tipo === 'editar-rol' ? roles.find((r) => r.rol === vista.rol) : undefined
  if (rolEditado) {
    return (
      <>
        {avisos}
        <FormRol
          key={rolEditado.rol}
          rol={rolEditado}
          catalogo={lista.modulos}
          error={error}
          alVolver={() => ir({ tipo: 'lista' })}
          alListo={(texto) => rolCambiado(texto, rolEditado.rol)}
          alError={setError}
        />
      </>
    )
  }
  return (
    <>
      {avisos}
      <ListaRoles
        roles={roles}
        usuarios={lista.usuarios}
        nombreLocal={nombreLocal}
        alCrear={() => ir({ tipo: 'crear' })}
        alEditar={(r) => ir({ tipo: 'editar-rol', rol: r.rol })}
        alOk={(texto) => rolCambiado(texto)}
        alError={setError}
      />
    </>
  )
}
