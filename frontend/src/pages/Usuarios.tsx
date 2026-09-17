import { useEffect, useState, type FormEvent } from 'react'
import NavBar from '../components/NavBar'
import { useSeccion } from '../components/Secciones'
import { useDialogo } from '../components/dialogo'
import { Tabla, Th, useOrden } from '../components/Tabla'
import { Aviso, Boton, Campo, Etiqueta, Pagina, Pastilla, Seccion, Selector, Vacio } from '../components/ui'
import { NOMBRE_ROL, useAcceso } from '../lib/acceso'
import { api } from '../lib/api'
import type { ListaUsuarios, Modulo, Rol, RolInfo, Usuario } from '../lib/types'

/**
 * Los usuarios del local y lo que cada uno puede abrir.
 *
 * Solo quien administra llega aqui (la ruta lo comprueba y el backend responde
 * 403 a los demas). El dueño ve y crea a SU gente y lo que crea nace en su
 * local, y en el orden de la jerarquia. Vertigo, ademas, ve sus propios usuarios y reparte locales desde el
 * hub. Los roles que se ofrecen los manda el servidor: un dueño no ve la
 * opcion de fabricar administradores.
 *
 * UN ROL ES LA LISTA DE MODULOS A LOS QUE ENTRA. Antes cada rol se describia
 * con una frase ("Mostrador: vende, cobra, cierra caja") que no respondia lo
 * unico que se pregunta quien reparte una llave: a que pantallas entra. Ahora
 * se ven los modulos, y si los cuatro de fabrica no encajan --un mesonero que
 * solo toma pedidos, un encargado sin contabilidad-- se crea uno.
 */
const SECCIONES = [
  { id: 'usuarios', texto: 'Usuarios' },
  { id: 'crear', texto: 'Crear usuario' },
  { id: 'roles', texto: 'Roles' },
  { id: 'crear-rol', texto: 'Crear rol' },
]

export default function Usuarios() {
  const { estado } = useAcceso()
  const [seccion, irA] = useSeccion(SECCIONES)
  const [lista, setLista] = useState<ListaUsuarios | null>(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const dialogo = useDialogo()

  const roles = lista?.roles ?? []
  const nombreRol = (rol: Rol) => roles.find((r) => r.rol === rol)?.nombre ?? NOMBRE_ROL[rol] ?? rol

  const orden = useOrden<Usuario>(
    {
      usuario: (u) => u.usuario,
      rol: (u) => nombreRol(u.rol),
      // El que nunca ha entrado no tiene fecha: con `null` cae al final de la
      // lista se ordene como se ordene, que es donde se le ve.
      acceso: (u) => (u.ultimo_acceso ? new Date(u.ultimo_acceso * 1000) : null),
    },
    'usuario',
  )

  useEffect(() => {
    cargar()
  }, [])

  function cargar() {
    api
      .listarUsuarios()
      .then(setLista)
      .catch((e: Error) => setError(e.message))
  }

  function ok(texto: string) {
    setError('')
    setAviso(texto)
    window.setTimeout(() => setAviso(''), 3500)
  }

  async function cambiarRol(u: Usuario, nuevo: Rol) {
    try {
      await api.cambiarRol(u.usuario, nuevo)
      ok(`${u.usuario} ahora es ${nombreRol(nuevo).toLowerCase()}. Sus sesiones abiertas se cerraron.`)
      cargar()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function borrar(u: Usuario) {
    if (
      !(await dialogo.confirmar({
        titulo: `¿Borrar el usuario «${u.usuario}»?`,
        texto: 'Lo que hizo queda en el historial; solo deja de poder entrar.',
        aceptar: 'Borrar',
        peligro: true,
      }))
    )
      return
    try {
      await api.borrarUsuario(u.usuario)
      ok(`Usuario «${u.usuario}» borrado.`)
      cargar()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Usuarios" moneda={false} secciones={SECCIONES} seccion={seccion} alCambiarSeccion={irA} />
      <Pagina ancho="media">
        {error && <Aviso>{error}</Aviso>}
        {aviso && <Aviso tono="bien">{aviso}</Aviso>}

        {seccion === 'usuarios' && (
          <Seccion
            titulo={`Quién entra a ${estado.local.nombre}`}
            ayuda="Cada persona entra con su usuario: así el sistema sabe quién cobró, quién anuló y quién cerró la caja."
            accion={<span className="text-xs text-neutral-400">{lista ? `${lista.usuarios.length} usuarios` : ''}</span>}
            plano
          >
            <Tabla orden={orden} glosario="usuarios">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
                  <tr>
                    <Th clave="usuario">Usuario</Th>
                    <Th clave="rol">Rol</Th>
                    <Th clave="acceso" className="hidden sm:table-cell">Último acceso</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {orden.ordenar(lista?.usuarios ?? []).map((u) => (
                    <FilaUsuario
                      key={u.usuario}
                      u={u}
                      soyYo={u.usuario === lista?.yo}
                      roles={roles}
                      onRol={(r) => void cambiarRol(u, r)}
                      onBorrar={() => void borrar(u)}
                      onClave={ok}
                      onError={setError}
                    />
                  ))}
                  {lista && lista.usuarios.length === 0 && (
                    <tr>
                      <td colSpan={4}>
                        <Vacio icono="usuarios" titulo="Sin usuarios todavía" />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </Tabla>
          </Seccion>
        )}

        {seccion === 'crear' && (
          <CrearUsuario
            roles={roles}
            onCreado={(usuario) => {
              ok(`Usuario «${usuario}» creado.`)
              cargar()
              irA('usuarios')
            }}
            onError={setError}
          />
        )}

        {seccion === 'roles' && (
          <ListaRoles
            roles={roles}
            usuarios={lista?.usuarios ?? []}
            nombreLocal={estado.local.nombre}
            onCambio={cargar}
            onOk={ok}
            onError={setError}
            onCrear={() => irA('crear-rol')}
          />
        )}

        {seccion === 'crear-rol' && (
          <CrearRol
            modulos={lista?.modulos ?? []}
            onCreado={(nombre) => {
              ok(`Rol «${nombre}» creado. Ya se puede asignar a un usuario.`)
              cargar()
              irA('roles')
            }}
            onError={setError}
          />
        )}
      </Pagina>
    </div>
  )
}

// ── Usuarios ───────────────────────────────────────────────────────────────

function FilaUsuario({
  u,
  soyYo,
  roles,
  onRol,
  onBorrar,
  onClave,
  onError,
}: {
  u: Usuario
  soyYo: boolean
  roles: RolInfo[]
  onRol: (r: Rol) => void
  onBorrar: () => void
  onClave: (texto: string) => void
  onError: (texto: string) => void
}) {
  const [reiniciando, setReiniciando] = useState(false)
  const [claveNueva, setClaveNueva] = useState('')

  async function reiniciar() {
    try {
      await api.reiniciarClave(u.usuario, claveNueva)
      setReiniciando(false)
      setClaveNueva('')
      onClave(`Clave de ${u.usuario} cambiada. Tendrá que entrar de nuevo.`)
    } catch (err) {
      onError((err as Error).message)
    }
  }

  return (
    <tr className="border-t border-neutral-100 align-top">
      <td className="p-3">
        <div className="font-medium">
          {u.usuario}
          {soyYo && <span className="ml-2 text-xs text-neutral-400">(tú)</span>}
        </div>
        {reiniciando && (
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Clave nueva (8 o más)"
              value={claveNueva}
              onChange={(e) => setClaveNueva(e.target.value)}
              className="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
            />
            <Boton onClick={() => void reiniciar()}>Guardar</Boton>
            <Boton
              tono="fantasma"
              onClick={() => {
                setReiniciando(false)
                setClaveNueva('')
              }}
            >
              Cancelar
            </Boton>
          </div>
        )}
      </td>
      <td className="p-3">
        <select
          value={u.rol}
          disabled={soyYo}
          onChange={(e) => onRol(e.target.value)}
          className="border border-neutral-200 rounded-lg px-2 py-1.5 bg-white text-sm disabled:opacity-60"
          aria-label={`Rol de ${u.usuario}`}
        >
          {/* Su rol puede no estar entre los que se reparten en este local
              (se lo puso Vertigo). Se muestra igual: dejar el selector en
              blanco sobre su propia gente seria peor que mostrarlo. */}
          {!roles.some((r) => r.rol === u.rol) && <option value={u.rol}>{u.rol_nombre || u.rol}</option>}
          {roles.map((r) => (
            <option key={r.rol} value={r.rol}>
              {r.nombre}
            </option>
          ))}
        </select>
      </td>
      <td className="p-3 text-neutral-500 hidden sm:table-cell tabular-nums">
        {u.ultimo_acceso
          ? new Date(u.ultimo_acceso * 1000).toLocaleString('es-VE', {
              day: '2-digit',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })
          : 'Todavía no ha entrado'}
      </td>
      <td className="p-3 text-right whitespace-nowrap">
        <button onClick={() => setReiniciando(true)} className="text-acento-600 font-medium text-sm mr-3">
          Clave
        </button>
        {!soyYo && (
          <button onClick={onBorrar} className="text-peligro-600 font-medium text-sm">
            Borrar
          </button>
        )}
      </td>
    </tr>
  )
}

function CrearUsuario({
  roles,
  onCreado,
  onError,
}: {
  roles: RolInfo[]
  onCreado: (usuario: string) => void
  onError: (texto: string) => void
}) {
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [clave2, setClave2] = useState('')
  const [rol, setRol] = useState<Rol>('caja')
  const [creando, setCreando] = useState(false)
  const elegido = roles.find((r) => r.rol === rol)

  async function crear(e: FormEvent) {
    e.preventDefault()
    if (clave !== clave2) {
      onError('Las dos contraseñas no coinciden.')
      return
    }
    setCreando(true)
    try {
      await api.crearUsuario({ usuario, clave, rol })
      onCreado(usuario.trim().toLowerCase())
      setUsuario('')
      setClave('')
      setClave2('')
    } catch (err) {
      onError((err as Error).message)
    } finally {
      setCreando(false)
    }
  }

  return (
    <form onSubmit={crear}>
      <Seccion
        titulo="Nuevo usuario"
        ayuda="El usuario va en minúsculas y sin espacios; la clave, 8 caracteres como mínimo."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Campo
            etiqueta="Usuario"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            required
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="ej. maria"
          />
          <Selector etiqueta="Rol" value={rol} onChange={(e) => setRol(e.target.value)}>
            {roles.map((r) => (
              <option key={r.rol} value={r.rol}>
                {r.nombre}
              </option>
            ))}
          </Selector>
          <Campo
            etiqueta="Contraseña"
            type="password"
            autoComplete="new-password"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            required
            minLength={8}
          />
          <Campo
            etiqueta="Repetir contraseña"
            type="password"
            autoComplete="new-password"
            value={clave2}
            onChange={(e) => setClave2(e.target.value)}
            required
            minLength={8}
          />
        </div>

        {/* Lo que se le está entregando, antes de entregarlo. */}
        {elegido && (
          <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Con ese rol va a entrar a
            </p>
            <Modulos modulos={elegido.modulos} />
            {elegido.descripcion && <p className="text-xs text-neutral-500 mt-2">{elegido.descripcion}</p>}
          </div>
        )}

        <div className="mt-4">
          <Boton type="submit" disabled={creando}>
            {creando ? 'Creando…' : 'Crear usuario'}
          </Boton>
        </div>
      </Seccion>
    </form>
  )
}

// ── Roles ──────────────────────────────────────────────────────────────────

function Modulos({ modulos }: { modulos: Modulo[] }) {
  if (modulos.length === 0) return <p className="text-sm text-neutral-400 mt-1">Ningún módulo.</p>
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {modulos.map((m) => (
        <Pastilla key={m.id}>{m.nombre}</Pastilla>
      ))}
    </div>
  )
}

function ListaRoles({
  roles,
  usuarios,
  nombreLocal,
  onCambio,
  onOk,
  onError,
  onCrear,
}: {
  roles: RolInfo[]
  usuarios: Usuario[]
  nombreLocal: string
  onCambio: () => void
  onOk: (texto: string) => void
  onError: (texto: string) => void
  onCrear: () => void
}) {
  const dialogo = useDialogo()

  async function borrar(r: RolInfo) {
    const cuantos = usuarios.filter((u) => u.rol === r.rol).length
    if (cuantos > 0) {
      await dialogo.avisar({
        titulo: `«${r.nombre}» está en uso`,
        texto: `${cuantos} usuario(s) tienen este rol. Cámbialos de rol primero y vuelve a borrarlo.`,
        tono: 'ojo',
      })
      return
    }
    if (
      !(await dialogo.confirmar({
        titulo: `¿Borrar el rol «${r.nombre}»?`,
        texto: 'Deja de poder asignarse a nuevos usuarios.',
        aceptar: 'Borrar',
        peligro: true,
      }))
    )
      return
    try {
      await api.borrarRol(r.rol)
      onOk(`Rol «${r.nombre}» borrado.`)
      onCambio()
    } catch (err) {
      onError((err as Error).message)
    }
  }

  // DOS MUNDOS, Y NO SE MEZCLAN. `interno` es el rol de Vertigo, la empresa
  // que opera la plataforma; el servidor solo se lo manda a Vertigo, así que
  // en la pantalla del dueño esta lista llega sin ninguno y el bloque no se
  // dibuja: no es que se esconda, es que no existe para él.
  const internos = roles.filter((r) => r.interno)
  const delNegocio = roles.filter((r) => !r.interno)

  const fila = (r: RolInfo) => {
    const cuantos = usuarios.filter((u) => u.rol === r.rol).length
    return (
      <div key={r.rol} className="py-3 first:pt-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="font-semibold">{r.nombre}</span>
            {!r.a_medida && <span className="ml-2 text-xs text-neutral-400">de fábrica</span>}
            <span className="ml-2 text-xs text-neutral-400">
              {cuantos === 0 ? 'sin usuarios' : `${cuantos} usuario(s)`}
            </span>
            {r.descripcion && <p className="text-xs text-neutral-500 mt-0.5">{r.descripcion}</p>}
          </div>
          {r.a_medida && (
            <button onClick={() => void borrar(r)} className="text-peligro-600 font-medium text-sm shrink-0">
              Borrar
            </button>
          )}
        </div>
        <Modulos modulos={r.modulos} />
      </div>
    )
  }

  return (
    <Seccion
      titulo="Roles"
      ayuda="Un rol es la lista de módulos a los que entra. Lo que no esté en la lista, el sistema se lo niega."
      accion={<Boton onClick={onCrear}>+ Crear rol</Boton>}
    >
      {internos.length > 0 && (
        <div className="mb-4">
          <Etiqueta>Interno de Vertigo</Etiqueta>
          <p className="text-xs text-neutral-500 -mt-1 mb-1">
            De la plataforma, no del negocio. No aparece en la pantalla del local: quien entra a{' '}
            {nombreLocal} no ve este bloque ni sabe que existe.
          </p>
          <div className="divide-y divide-neutral-100">{internos.map(fila)}</div>
        </div>
      )}
      {internos.length > 0 && <Etiqueta>Del negocio</Etiqueta>}
      <p className="text-xs text-neutral-500 -mt-1 mb-1">
        De mayor a menor. Dueño es el rol más alto de {nombreLocal}: entra a todo lo suyo, y a nada
        de fuera.
      </p>
      <div className="divide-y divide-neutral-100">{delNegocio.map(fila)}</div>
    </Seccion>
  )
}

function CrearRol({
  modulos,
  onCreado,
  onError,
}: {
  modulos: Modulo[]
  onCreado: (nombre: string) => void
  onError: (texto: string) => void
}) {
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [elegidos, setElegidos] = useState<string[]>([])
  const [creando, setCreando] = useState(false)

  const alternar = (id: string) =>
    setElegidos((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]))

  async function crear(e: FormEvent) {
    e.preventDefault()
    setCreando(true)
    try {
      await api.crearRol({ nombre, descripcion, modulos: elegidos })
      onCreado(nombre.trim())
      setNombre('')
      setDescripcion('')
      setElegidos([])
    } catch (err) {
      onError((err as Error).message)
    } finally {
      setCreando(false)
    }
  }

  return (
    <form onSubmit={crear}>
      <Seccion
        titulo="Crear un rol"
        ayuda="Para cuando los roles de fábrica no encajan: un mesonero que solo toma pedidos, un encargado sin acceso a la contabilidad."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Campo
            etiqueta="Nombre del rol"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
            placeholder="ej. Mesonero"
          />
          <Campo
            etiqueta="Para qué es (opcional)"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Toma pedidos en mesa y los manda a cocina"
          />
        </div>

        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mt-5 mb-2">
          A qué módulos entra
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {modulos.map((m) => {
            const marcado = elegidos.includes(m.id)
            return (
              <label
                key={m.id}
                className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer ${
                  marcado ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200 hover:border-neutral-300'
                }`}
              >
                <input
                  type="checkbox"
                  checked={marcado}
                  onChange={() => alternar(m.id)}
                  className="w-4 h-4 accent-neutral-900"
                />
                <span className="text-sm font-medium">{m.nombre}</span>
              </label>
            )
          })}
        </div>
        <p className="text-xs text-neutral-500 mt-3">
          Lo que no marques, el sistema se lo niega: no es que la pantalla se esconda, es que el servidor
          responde que no. Crear usuarios no está en la lista a propósito: eso se queda contigo.
        </p>

        <div className="mt-4">
          <Boton type="submit" disabled={creando || elegidos.length === 0 || !nombre.trim()}>
            {creando ? 'Creando…' : 'Crear rol'}
          </Boton>
        </div>
      </Seccion>
    </form>
  )
}
