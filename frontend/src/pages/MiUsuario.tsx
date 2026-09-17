import { useState, type FormEvent } from 'react'
import NavBar from '../components/NavBar'
import { Pagina } from '../components/ui'
import { NOMBRE_ROL, useAcceso } from '../lib/acceso'
import { api } from '../lib/api'

/** Cambiar la propia clave. Pide la actual aunque haya sesion: si alguien deja
 *  el POS abierto, otro no puede quedarse con el usuario. */
export default function MiUsuario() {
  const { estado } = useAcceso()
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [nueva2, setNueva2] = useState('')
  const [error, setError] = useState('')
  const [listo, setListo] = useState(false)
  const [guardando, setGuardando] = useState(false)

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (nueva !== nueva2) {
      setError('Las dos contraseñas nuevas no coinciden.')
      return
    }
    setGuardando(true)
    try {
      await api.cambiarMiClave(actual, nueva)
      setListo(true)
      // Cambiar la clave cierra todas las sesiones anteriores, incluida esta.
      window.setTimeout(() => window.location.replace('/login.html'), 1800)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setGuardando(false)
    }
  }

  const campo =
    'w-full border border-neutral-200 rounded-xl px-3 py-2.5 bg-white text-sm focus:outline-none focus:border-neutral-900'

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Mi usuario" moneda={false} />
      <Pagina ancho="angosta">
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 flex items-center gap-3">
          <span className="w-11 h-11 rounded-full bg-neutral-900 text-white grid place-items-center text-lg font-bold">
            {(estado.usuario ?? '?').slice(0, 1).toUpperCase()}
          </span>
          <div>
            <div className="font-semibold">{estado.usuario}</div>
            <div className="text-sm text-neutral-500">
              {NOMBRE_ROL[estado.rol ?? ''] ?? estado.rol} · {estado.local.nombre}
            </div>
          </div>
        </div>

        <form onSubmit={guardar} className="bg-white rounded-2xl border border-neutral-200 p-4 space-y-3">
          <h2 className="font-semibold">Cambiar mi contraseña</h2>
          {listo ? (
            <p className="text-sm text-exito-700 bg-exito-50 border border-exito-200 rounded-xl px-3 py-2">
              Listo. Por seguridad se cerraron tus sesiones: vuelve a entrar con la clave nueva.
            </p>
          ) : (
            <>
              {error && (
                <p role="alert" className="text-sm text-peligro-700 bg-peligro-50 border border-peligro-200 rounded-xl px-3 py-2">
                  {error}
                </p>
              )}
              <label className="block text-sm">
                <span className="text-xs text-neutral-500 uppercase font-semibold">Contraseña actual</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={actual}
                  onChange={(e) => setActual(e.target.value)}
                  required
                  className={campo}
                />
              </label>
              <label className="block text-sm">
                <span className="text-xs text-neutral-500 uppercase font-semibold">Nueva (8 o mas)</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={nueva}
                  onChange={(e) => setNueva(e.target.value)}
                  required
                  minLength={8}
                  className={campo}
                />
              </label>
              <label className="block text-sm">
                <span className="text-xs text-neutral-500 uppercase font-semibold">Repetir la nueva</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={nueva2}
                  onChange={(e) => setNueva2(e.target.value)}
                  required
                  minLength={8}
                  className={campo}
                />
              </label>
              <button
                type="submit"
                disabled={guardando}
                className="w-full bg-neutral-900 text-white rounded-xl py-2.5 font-medium disabled:opacity-50"
              >
                {guardando ? 'Guardando...' : 'Cambiar contraseña'}
              </button>
            </>
          )}
        </form>
      </Pagina>
    </div>
  )
}
