import { useState, type FormEvent } from 'react'
import NavBar from '../components/NavBar'
import { Pagina, Pastilla } from '../components/ui'
import { useDialogo } from '../components/dialogo'
import { NOMBRE_ROL, useAcceso } from '../lib/acceso'
import { api } from '../lib/api'

/**
 * Quien soy: mi nombre, cambiar mi contraseña y --si mi rol autoriza-- mi PIN.
 *
 * La contraseña y el PIN se cambian con la contraseña actual delante aunque
 * haya sesion: si alguien deja el POS abierto, otro no puede quedarse con la
 * cuenta ni ponerse un PIN a su nombre.
 */
export default function MiUsuario() {
  const { estado, recargar } = useAcceso()
  const nombre = estado.nombre_visible || estado.usuario || ''

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Mi usuario" moneda={false} />
      <Pagina ancho="angosta">
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 flex items-center gap-3">
          <span className="w-11 h-11 rounded-full bg-neutral-900 text-white grid place-items-center text-lg font-bold">
            {nombre.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="font-semibold truncate">{nombre}</div>
            <div className="text-sm text-neutral-500 truncate">
              {nombre !== estado.usuario && <>@{estado.usuario} · </>}
              {NOMBRE_ROL[estado.rol ?? ''] ?? estado.rol} · {estado.local.nombre}
            </div>
          </div>
          {estado.puede.autoriza && (
            <span className="ml-auto shrink-0">
              {estado.tiene_pin ? <Pastilla tono="bien">PIN listo</Pastilla> : <Pastilla tono="ojo">sin PIN</Pastilla>}
            </span>
          )}
        </div>

        {estado.puede.autoriza && <MiPin tienePin={estado.tiene_pin} onCambio={recargar} />}

        <CambiarClave />
      </Pagina>
    </div>
  )
}

const campo =
  'w-full border border-neutral-200 rounded-xl px-3 py-2.5 bg-white text-sm focus:outline-none focus:border-neutral-900'

function Error_({ texto }: { texto: string }) {
  if (!texto) return null
  return (
    <p role="alert" className="text-sm text-peligro-700 bg-peligro-50 border border-peligro-200 rounded-xl px-3 py-2">
      {texto}
    </p>
  )
}

function Rotulo({ children }: { children: string }) {
  return <span className="text-xs text-neutral-500 uppercase font-semibold">{children}</span>
}

/**
 * Mi PIN: con el firmo en el mostrador sin escribir usuario ni contraseña.
 * Solo se ofrece a quien tiene un rol que autoriza.
 */
function MiPin({ tienePin, onCambio }: { tienePin: boolean; onCambio: () => void }) {
  const [clave, setClave] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [error, setError] = useState('')
  const [listo, setListo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const dialogo = useDialogo()

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setError('')
    setListo('')
    if (pin !== pin2) {
      setError('Los dos PIN no coinciden.')
      return
    }
    setGuardando(true)
    try {
      await api.ponerMiPin(clave, pin)
      setListo(tienePin ? 'PIN cambiado.' : 'PIN listo. Ya puedes autorizar en el mostrador con él.')
      setClave('')
      setPin('')
      setPin2('')
      onCambio()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setGuardando(false)
    }
  }

  async function quitar() {
    if (
      !(await dialogo.confirmar({
        titulo: '¿Quitar tu PIN?',
        texto: 'Dejas de poder autorizar con PIN en el mostrador; desde tu aplicación sigues pudiendo.',
        aceptar: 'Quitar PIN',
        peligro: true,
      }))
    )
      return
    try {
      await api.quitarMiPin()
      setListo('PIN quitado.')
      onCambio()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <form onSubmit={guardar} className="bg-white rounded-2xl border border-neutral-200 p-4 space-y-3">
      <div>
        <h2 className="font-semibold">{tienePin ? 'Cambiar mi PIN' : 'Crear mi PIN'}</h2>
        <p className="text-xs text-neutral-500 mt-0.5">
          De 4 a 6 números. Con él autorizas en el mostrador (por ejemplo, editar una venta ya cobrada) sin
          escribir usuario ni contraseña. Cuando no estés en el local, las solicitudes te llegan a la aplicación y
          las apruebas desde allí.
        </p>
      </div>
      <Error_ texto={error} />
      {listo && (
        <p className="text-sm text-exito-700 bg-exito-50 border border-exito-200 rounded-xl px-3 py-2">{listo}</p>
      )}
      <label className="block text-sm">
        <Rotulo>Tu contraseña</Rotulo>
        <input
          type="password"
          autoComplete="current-password"
          value={clave}
          onChange={(e) => setClave(e.target.value)}
          required
          className={campo}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">
          <Rotulo>PIN nuevo</Rotulo>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            required
            className={`${campo} text-center text-xl tracking-[0.4em]`}
          />
        </label>
        <label className="block text-sm">
          <Rotulo>Repetir PIN</Rotulo>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="off"
            value={pin2}
            onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))}
            required
            className={`${campo} text-center text-xl tracking-[0.4em]`}
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={guardando || pin.length < 4}
          className="flex-1 bg-neutral-900 text-white rounded-xl py-2.5 font-medium disabled:opacity-50"
        >
          {guardando ? 'Guardando...' : tienePin ? 'Cambiar PIN' : 'Crear PIN'}
        </button>
        {tienePin && (
          <button type="button" onClick={() => void quitar()} className="text-sm text-peligro-600 font-medium">
            Quitar PIN
          </button>
        )}
      </div>
    </form>
  )
}

function CambiarClave() {
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

  return (
    <form onSubmit={guardar} className="bg-white rounded-2xl border border-neutral-200 p-4 space-y-3">
      <h2 className="font-semibold">Cambiar mi contraseña</h2>
      {listo ? (
        <p className="text-sm text-exito-700 bg-exito-50 border border-exito-200 rounded-xl px-3 py-2">
          Listo. Por seguridad se cerraron tus sesiones: vuelve a entrar con la clave nueva.
        </p>
      ) : (
        <>
          <Error_ texto={error} />
          <label className="block text-sm">
            <Rotulo>Contraseña actual</Rotulo>
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
            <Rotulo>Nueva (8 o más)</Rotulo>
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
            <Rotulo>Repetir la nueva</Rotulo>
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
  )
}
