import { useEffect, useState, type FormEvent } from 'react'
import NavBar from '../components/NavBar'
import { Tabla, Th, useOrden } from '../components/Tabla'
import { Pagina } from '../components/ui'
import { NOMBRE_ROL, useAcceso } from '../lib/acceso'
import { api } from '../lib/api'
import type { ListaUsuarios, Rol, Usuario } from '../lib/types'

/**
 * Las cuentas del local. Solo quien administra llega aqui (la ruta lo
 * comprueba y el backend responde 403 a los demas).
 *
 * El dueño ve y crea a SU gente (dueño, caja, cocina) y lo que crea nace en
 * su local. Vertigo, ademas, ve sus propias cuentas y puede repartir locales
 * desde el hub. Los roles que se ofrecen los manda el servidor: un dueño no
 * ve la opcion de fabricar administradores. Cada persona entra con la suya, y
 * por eso cada pedido puede decir quien lo tomo, quien lo cobro y quien lo
 * anulo.
 */
export default function Usuarios() {
  const { estado } = useAcceso()
  const [lista, setLista] = useState<ListaUsuarios | null>(null)
  const orden = useOrden<Usuario>(
    {
      usuario: (u) => u.usuario,
      rol: (u) => NOMBRE_ROL[u.rol],
      // El que nunca ha entrado no tiene fecha: con `null` cae al final de la
      // lista se ordene como se ordene, que es donde se le ve.
      acceso: (u) => (u.ultimo_acceso ? new Date(u.ultimo_acceso * 1000) : null),
    },
    'usuario',
  )
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  // Alta
  const [usuario, setUsuario] = useState('')
  const [clave, setClave] = useState('')
  const [clave2, setClave2] = useState('')
  const [rol, setRol] = useState<Rol>('caja')
  const [creando, setCreando] = useState(false)

  // Reinicio de clave, en linea
  const [reiniciando, setReiniciando] = useState<string | null>(null)
  const [claveNueva, setClaveNueva] = useState('')

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

  async function crear(e: FormEvent) {
    e.preventDefault()
    if (clave !== clave2) {
      setError('Las dos contraseñas no coinciden.')
      return
    }
    setCreando(true)
    try {
      await api.crearUsuario({ usuario, clave, rol })
      setUsuario('')
      setClave('')
      setClave2('')
      setRol('caja')
      ok(`Usuario «${usuario.trim().toLowerCase()}» creado.`)
      cargar()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCreando(false)
    }
  }

  async function cambiarRol(u: Usuario, nuevo: Rol) {
    try {
      await api.cambiarRol(u.usuario, nuevo)
      ok(`${u.usuario} ahora es ${NOMBRE_ROL[nuevo].toLowerCase()}. Sus sesiones abiertas se cerraron.`)
      cargar()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function reiniciar(u: Usuario) {
    try {
      await api.reiniciarClave(u.usuario, claveNueva)
      setReiniciando(null)
      setClaveNueva('')
      ok(`Clave de ${u.usuario} cambiada. Tendra que entrar de nuevo.`)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function borrar(u: Usuario) {
    if (!window.confirm(`Borrar el usuario «${u.usuario}»? Lo que hizo queda en el historial; solo deja de poder entrar.`)) return
    try {
      await api.borrarUsuario(u.usuario)
      ok(`Usuario «${u.usuario}» borrado.`)
      cargar()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const campo =
    'w-full border border-neutral-200 rounded-xl px-3 py-2.5 bg-white text-sm focus:outline-none focus:border-neutral-900'

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Usuarios" moneda={false} />
      <Pagina ancho="media">
        {(error || aviso) && (
          <div
            role="status"
            className={`rounded-2xl border px-4 py-3 text-sm ${
              error ? 'bg-peligro-50 border-peligro-200 text-peligro-700' : 'bg-exito-50 border-exito-200 text-exito-800'
            }`}
          >
            {error || aviso}
          </div>
        )}

        <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-neutral-100 flex items-baseline gap-2">
            <h2 className="font-semibold">Quien entra a {estado.local.nombre}</h2>
            <span className="text-xs text-neutral-400">{lista ? `${lista.usuarios.length} cuentas` : ''}</span>
          </div>
          <Tabla orden={orden}>
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
              <tr>
                <Th clave="usuario">Usuario</Th>
                <Th clave="rol">Rol</Th>
                <Th clave="acceso" className="hidden sm:table-cell">Ultimo acceso</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {orden.ordenar(lista?.usuarios ?? []).map((u) => {
                const soyYo = u.usuario === lista?.yo
                return (
                  <tr key={u.usuario} className="border-t border-neutral-100 align-top">
                    <td className="p-3">
                      <div className="font-medium">
                        {u.usuario}
                        {soyYo && <span className="ml-2 text-xs text-neutral-400">(tu)</span>}
                      </div>
                      {reiniciando === u.usuario && (
                        <div className="mt-2 flex gap-2">
                          <input
                            type="password"
                            autoComplete="new-password"
                            placeholder="Clave nueva (8 o mas)"
                            value={claveNueva}
                            onChange={(e) => setClaveNueva(e.target.value)}
                            className={campo}
                          />
                          <button
                            onClick={() => void reiniciar(u)}
                            className="bg-neutral-900 text-white rounded-xl px-3 text-sm font-medium"
                          >
                            Guardar
                          </button>
                          <button
                            onClick={() => {
                              setReiniciando(null)
                              setClaveNueva('')
                            }}
                            className="text-neutral-500 text-sm px-2"
                          >
                            Cancelar
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="p-3">
                      <select
                        value={u.rol}
                        disabled={soyYo}
                        onChange={(e) => void cambiarRol(u, e.target.value as Rol)}
                        className="border border-neutral-200 rounded-lg px-2 py-1.5 bg-white text-sm disabled:opacity-60"
                        aria-label={`Rol de ${u.usuario}`}
                      >
                        {(lista?.roles ?? []).map((r) => (
                          <option key={r.rol} value={r.rol}>
                            {NOMBRE_ROL[r.rol] ?? r.rol}
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
                        : 'Todavia no ha entrado'}
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => {
                          setReiniciando(u.usuario)
                          setClaveNueva('')
                        }}
                        className="text-acento-600 font-medium text-sm mr-3"
                      >
                        Clave
                      </button>
                      {!soyYo && (
                        <button onClick={() => void borrar(u)} className="text-peligro-600 font-medium text-sm">
                          Borrar
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
              {lista && lista.usuarios.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-4 text-center text-neutral-400">
                    Sin usuarios.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </Tabla>
        </div>

        <form onSubmit={crear} className="bg-white rounded-2xl border border-neutral-200 p-4 space-y-3">
          <h2 className="font-semibold">Nueva cuenta</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="text-xs text-neutral-500 uppercase font-semibold">Usuario</span>
              <input
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
                required
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="ej. maria"
                className={campo}
              />
            </label>
            <label className="block text-sm">
              <span className="text-xs text-neutral-500 uppercase font-semibold">Rol</span>
              <select value={rol} onChange={(e) => setRol(e.target.value as Rol)} className={campo}>
                {(lista?.roles ?? []).map((r) => (
                  <option key={r.rol} value={r.rol}>
                    {NOMBRE_ROL[r.rol] ?? r.rol} — {r.descripcion}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-xs text-neutral-500 uppercase font-semibold">Contraseña</span>
              <input
                type="password"
                autoComplete="new-password"
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                required
                minLength={8}
                className={campo}
              />
            </label>
            <label className="block text-sm">
              <span className="text-xs text-neutral-500 uppercase font-semibold">Repetir contraseña</span>
              <input
                type="password"
                autoComplete="new-password"
                value={clave2}
                onChange={(e) => setClave2(e.target.value)}
                required
                minLength={8}
                className={campo}
              />
            </label>
          </div>
          <p className="text-xs text-neutral-500">
            El usuario va en minusculas, sin espacios. La clave, 8 caracteres como minimo. Cada persona
            entra con la suya: asi el sistema sabe quien cobro y quien anulo cada pedido.
          </p>
          <button
            type="submit"
            disabled={creando}
            className="w-full sm:w-auto bg-neutral-900 text-white rounded-xl px-5 py-2.5 font-medium disabled:opacity-50"
          >
            {creando ? 'Creando...' : 'Crear usuario'}
          </button>
        </form>
      </Pagina>
    </div>
  )
}
