import { useState, type FormEvent, type ReactNode } from 'react'
import NavBar from '../components/NavBar'
import { useSeccion } from '../components/Secciones'
import { Pagina, Pastilla } from '../components/ui'
import { useDialogo } from '../components/dialogo'
import {
  Numerico,
  POSICIONES,
  esTelefono,
  usaTecladoPropio,
  guardarPreferenciasTeclado,
  leerPreferenciasTeclado,
  type Posicion,
  type PreferenciasTeclado,
} from '../components/Teclado'
import { NOMBRE_ROL, useAcceso } from '../lib/acceso'
import { api } from '../lib/api'
import { useTema } from '../lib/tema'

/**
 * Mi usuario: quien soy y como quiero ver el sistema.
 *
 *   MI CUENTA    mi nombre, mi contrasena y --si mi rol autoriza-- mi PIN.
 *   APARIENCIA   el tema y como se escribe en esta tablet.
 *
 * El nombre lo escribe cada quien: es como se le saluda y como aparece en lo
 * que autoriza, no una llave. La contrasena y el PIN piden la contrasena
 * actual aunque haya sesion: si alguien deja el POS abierto, otro no puede
 * quedarse con la cuenta ni ponerse un PIN a su nombre.
 */
const SECCIONES = [
  { id: 'cuenta', texto: 'Mi cuenta' },
  { id: 'apariencia', texto: 'Apariencia' },
]

export default function MiUsuario() {
  const { estado, recargar } = useAcceso()
  const [seccion, irA] = useSeccion(SECCIONES)
  const nombre = estado.nombre_visible || estado.usuario || ''

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Mi usuario" moneda={false} secciones={SECCIONES} seccion={seccion} alCambiarSeccion={irA} />
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

        {seccion === 'cuenta' ? (
          <>
            <MiNombre nombre={estado.nombre} apellido={estado.apellido} onCambio={recargar} />
            {estado.puede.autoriza && <MiPin tienePin={estado.tiene_pin} onCambio={recargar} />}
            <CambiarClave />
          </>
        ) : (
          <Apariencia />
        )}
      </Pagina>
    </div>
  )
}

const campo =
  'w-full border border-neutral-200 rounded-xl px-3 py-2.5 bg-white text-sm focus:outline-none focus:border-neutral-900'

function Tarjeta({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-neutral-200 p-4 space-y-3">
      <div>
        <h2 className="font-semibold">{titulo}</h2>
        {ayuda && <p className="text-xs text-neutral-500 mt-0.5">{ayuda}</p>}
      </div>
      {children}
    </section>
  )
}

function Error_({ texto }: { texto: string }) {
  if (!texto) return null
  return (
    <p role="alert" className="text-sm text-peligro-700 bg-peligro-50 border border-peligro-200 rounded-xl px-3 py-2">
      {texto}
    </p>
  )
}

function Listo({ texto }: { texto: string }) {
  if (!texto) return null
  return <p className="text-sm text-exito-700 bg-exito-50 border border-exito-200 rounded-xl px-3 py-2">{texto}</p>
}

function Rotulo({ children }: { children: string }) {
  return <span className="text-xs text-neutral-500 uppercase font-semibold">{children}</span>
}

const boton = 'w-full bg-neutral-900 text-white rounded-xl py-2.5 font-medium disabled:opacity-50'

// ── Mi cuenta ───────────────────────────────────────────────────────────────

/** Como me llamo: lo que se ve al saludar y en lo que autorizo. */
function MiNombre({ nombre, apellido, onCambio }: { nombre: string; apellido: string; onCambio: () => void }) {
  const [n, setN] = useState(nombre)
  const [a, setA] = useState(apellido)
  const [error, setError] = useState('')
  const [listo, setListo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const sinCambios = n === nombre && a === apellido

  async function guardar(e: FormEvent) {
    e.preventDefault()
    setError('')
    setListo('')
    setGuardando(true)
    try {
      await api.cambiarMiNombre(n, a)
      setListo('Listo. Así se te va a saludar de ahora en adelante.')
      onCambio()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={guardar}>
      <Tarjeta
        titulo="Mi nombre"
        ayuda="Con este nombre te saluda el sistema y queda escrito en lo que autorizas. Tu usuario para entrar no cambia."
      >
        <Error_ texto={error} />
        <Listo texto={listo} />
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <Rotulo>Nombre</Rotulo>
            <input value={n} onChange={(e) => setN(e.target.value)} className={campo} placeholder="ej. Daniel" />
          </label>
          <label className="block text-sm">
            <Rotulo>Apellido</Rotulo>
            <input value={a} onChange={(e) => setA(e.target.value)} className={campo} placeholder="ej. Sollador" />
          </label>
        </div>
        <button type="submit" disabled={guardando || sinCambios} className={boton}>
          {guardando ? 'Guardando...' : 'Guardar mi nombre'}
        </button>
      </Tarjeta>
    </form>
  )
}

/**
 * Mi PIN: con el firmo en el mostrador sin escribir usuario ni contrasena.
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
    <form onSubmit={guardar}>
      <Tarjeta
        titulo={tienePin ? 'Cambiar mi PIN' : 'Crear mi PIN'}
        ayuda="De 4 a 6 números. Con él autorizas en el mostrador (por ejemplo, editar una venta ya cobrada) sin escribir usuario ni contraseña. Cuando no estés en el local, las solicitudes te llegan a la aplicación."
      >
        <Error_ texto={error} />
        <Listo texto={listo} />
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
            <Numerico
              etiqueta={'PIN nuevo'}
              oculto
              entero
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              className={`${campo} text-center text-xl tracking-[0.4em]`}
            />
          </label>
          <label className="block text-sm">
            <Rotulo>Repetir PIN</Rotulo>
            <Numerico
              etiqueta={'Repetir PIN'}
              oculto
              entero
              maxLength={6}
              value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              className={`${campo} text-center text-xl tracking-[0.4em]`}
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={guardando || pin.length < 4} className={boton}>
            {guardando ? 'Guardando...' : tienePin ? 'Cambiar PIN' : 'Crear PIN'}
          </button>
          {tienePin && (
            <button type="button" onClick={() => void quitar()} className="text-sm text-peligro-600 font-medium shrink-0">
              Quitar PIN
            </button>
          )}
        </div>
      </Tarjeta>
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
    <form onSubmit={guardar}>
      <Tarjeta titulo="Cambiar mi contraseña">
        {listo ? (
          <Listo texto="Listo. Por seguridad se cerraron tus sesiones: vuelve a entrar con la clave nueva." />
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
            <button type="submit" disabled={guardando} className={boton}>
              {guardando ? 'Guardando...' : 'Cambiar contraseña'}
            </button>
          </>
        )}
      </Tarjeta>
    </form>
  )
}

// ── Apariencia ──────────────────────────────────────────────────────────────

/**
 * Como se ve y como se escribe. Vive aparte de la cuenta porque no es quien
 * eres: es de ESTE equipo. La tablet del mostrador y la de cocina se ajustan
 * distinto, y quien las usa no siempre es la misma persona -- por eso se
 * guarda en el navegador y no en el usuario.
 */
function Apariencia() {
  const { tema, cambiar } = useTema()
  const [teclado, setTeclado] = useState<PreferenciasTeclado>(leerPreferenciasTeclado)
  const tactil = usaTecladoPropio()
  const telefono = esTelefono()

  function ponerTeclado(p: Partial<PreferenciasTeclado>) {
    guardarPreferenciasTeclado(p)
    setTeclado((t) => ({ ...t, ...p }))
  }

  return (
    <>
      <Tarjeta titulo="Tema" ayuda="Vale para todo el sistema en este equipo.">
        <div className="grid grid-cols-2 gap-3">
          <Opcion
            marcada={tema === 'claro'}
            titulo="Claro"
            detalle="Para el mostrador con luz de día."
            onElegir={() => cambiar('claro')}
          >
            {/* Colores fijos, no los del tema: una muestra del modo claro
                tiene que verse clara aunque el sistema este en oscuro. Con
                los tokens del tema las dos muestras salian al reves. */}
            <div
              className="h-12 rounded-lg border grid place-items-center"
              style={{ background: '#ffffff', borderColor: '#e5e5e5' }}
            >
              <span className="w-8 h-1.5 rounded-full" style={{ background: '#d4d4d4' }} />
            </div>
          </Opcion>
          <Opcion
            marcada={tema === 'oscuro'}
            titulo="Oscuro"
            detalle="Para la cocina y el turno de noche."
            onElegir={() => cambiar('oscuro')}
          >
            <div
              className="h-12 rounded-lg border grid place-items-center"
              style={{ background: '#171717', borderColor: '#404040' }}
            >
              <span className="w-8 h-1.5 rounded-full" style={{ background: '#525252' }} />
            </div>
          </Opcion>
        </div>
      </Tarjeta>

      {/* En un telefono manda el teclado del propio telefono, asi que no hay
          nada que ajustar: se dice y ya, en vez de ofrecer opciones que no
          harian nada. */}
      {telefono ? (
        <Tarjeta
          titulo="Teclado en pantalla"
          ayuda="En un teléfono se escribe con el teclado del propio teléfono: el del sistema ya está hecho para el pulgar. El teclado de Sávora es para las tablets del mostrador."
        >
          <p className="text-sm text-neutral-500">Sin opciones en este equipo.</p>
        </Tarjeta>
      ) : (
        <>
        <Tarjeta
          titulo="Teclado en pantalla"
          ayuda={
            tactil
              ? 'Cómo se abre el teclado al escribir en esta tablet. El cambio se nota en el próximo campo que toques.'
              : 'Este equipo se maneja con ratón y teclado físico, así que el teclado en pantalla no aparece. Lo que elijas aquí vale si el mismo navegador se usa en una tablet.'
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <Opcion
              marcada={teclado.dividido}
              titulo="Dividido"
              detalle="En dos mitades, bajo los pulgares. Para sostener la tablet con las dos manos."
              onElegir={() => ponerTeclado({ dividido: true })}
            >
              <TeclasDemo dividido />
            </Opcion>
            <Opcion
              marcada={!teclado.dividido}
              titulo="Convencional"
              detalle="Entero y centrado, como el de siempre. Para la tablet apoyada en la mesa."
              onElegir={() => ponerTeclado({ dividido: false })}
            >
              <TeclasDemo />
            </Opcion>
          </div>
        </Tarjeta>

        <Tarjeta
          titulo="Dónde aparece el teclado"
          ayuda="Abajo tapa menos; a un costado deja ver la pantalla entera y queda bajo la mano con la que sostienes la tablet. En pantallas angostas siempre sale abajo, porque una columna no cabría."
        >
          <div className="grid grid-cols-3 gap-3">
            {POSICIONES.map((pos) => (
              <button
                key={pos}
                type="button"
                onClick={() => ponerTeclado({ posicion: pos })}
                aria-pressed={teclado.posicion === pos}
                className={`text-left rounded-xl border p-2.5 ${
                  teclado.posicion === pos
                    ? 'border-neutral-900 bg-neutral-50'
                    : 'border-neutral-200 hover:border-neutral-300'
                }`}
              >
                <Croquis posicion={pos} />
                <div className="flex items-center gap-1.5 mt-2">
                  <span
                    className={`w-3.5 h-3.5 rounded-full border-[3px] shrink-0 ${
                      teclado.posicion === pos ? 'border-neutral-900' : 'border-neutral-300'
                    }`}
                  />
                  <span className="text-sm font-medium">{NOMBRE_POSICION[pos]}</span>
                </div>
              </button>
            ))}
          </div>
        </Tarjeta>

        {teclado.posicion === 'abajo' && (
          <Tarjeta
            titulo="Teclado de números"
            ayuda="Con el teclado abajo, de qué lado de la barra quedan las teclas: del lado de la mano con la que cobras."
          >
            <div className="grid grid-cols-3 gap-2">
              {(['izquierda', 'centro', 'derecha'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => ponerTeclado({ lado: l })}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-medium capitalize ${
                    teclado.lado === l ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200 hover:border-neutral-300'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </Tarjeta>
        )}
        </>
      )}
    </>
  )
}

function Opcion({
  marcada,
  titulo,
  detalle,
  onElegir,
  children,
}: {
  marcada: boolean
  titulo: string
  detalle: string
  onElegir: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onElegir}
      aria-pressed={marcada}
      className={`text-left rounded-xl border p-3 ${
        marcada ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200 hover:border-neutral-300'
      }`}
    >
      {children}
      <div className="flex items-center gap-1.5 mt-2">
        <span
          className={`w-3.5 h-3.5 rounded-full border-[3px] shrink-0 ${
            marcada ? 'border-neutral-900' : 'border-neutral-300'
          }`}
        />
        <span className="text-sm font-medium">{titulo}</span>
      </div>
      <p className="text-xs text-neutral-500 mt-0.5">{detalle}</p>
    </button>
  )
}

/** El dibujo de las teclas, para elegir mirando y no leyendo. */
function TeclasDemo({ dividido = false }: { dividido?: boolean }) {
  const fila = (n: number, clave: string) => (
    <div key={clave} className={`flex gap-[3px] ${dividido ? 'justify-between' : ''}`}>
      {dividido ? (
        <>
          <span className="flex gap-[3px]">
            {Array.from({ length: Math.ceil(n / 2) }, (_, i) => (
              <span key={i} className="w-2 h-2 rounded-[2px] bg-neutral-300" />
            ))}
          </span>
          <span className="flex gap-[3px]">
            {Array.from({ length: Math.floor(n / 2) }, (_, i) => (
              <span key={i} className="w-2 h-2 rounded-[2px] bg-neutral-300" />
            ))}
          </span>
        </>
      ) : (
        Array.from({ length: n }, (_, i) => <span key={i} className="w-2 h-2 rounded-[2px] bg-neutral-300" />)
      )}
    </div>
  )
  return (
    <div className="h-12 rounded-lg border border-neutral-200 bg-white px-2 flex flex-col justify-center gap-[3px]">
      {fila(8, 'a')}
      {fila(8, 'b')}
      {fila(6, 'c')}
    </div>
  )
}

const NOMBRE_POSICION: Record<Posicion, string> = {
  abajo: 'Abajo',
  izquierda: 'A la izquierda',
  derecha: 'A la derecha',
}

/**
 * El croquis de la pantalla con el teclado puesto donde se elige.
 *
 * Se dibuja y no se describe con palabras a proposito: "a la derecha" no
 * dice cuanto ocupa ni que le pasa a lo que se estaba viendo. Aqui se ve de
 * un vistazo que el contenido se corre y no queda tapado.
 */
function Croquis({ posicion }: { posicion: Posicion }) {
  const teclas = (n: number, ancho: string) => (
    <div className="flex flex-wrap gap-[2px] content-end justify-center">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={`${ancho} h-[5px] rounded-[1px] bg-neutral-400`} />
      ))}
    </div>
  )
  const contenido = (
    <div className="flex-1 min-w-0 p-1.5 flex flex-col gap-1">
      <span className="h-1.5 w-2/3 rounded-full bg-neutral-200" />
      <span className="h-1.5 w-full rounded-full bg-neutral-200" />
      <span className="h-1.5 w-1/2 rounded-full bg-neutral-200" />
    </div>
  )
  const panel = (clase: string, n: number, ancho: string) => (
    <div className={`bg-neutral-100 border-neutral-300 p-1.5 flex flex-col justify-end ${clase}`}>
      {teclas(n, ancho)}
    </div>
  )
  return (
    <div className="h-16 rounded-lg border border-neutral-300 bg-white overflow-hidden flex">
      {/* La tablet, vista de frente: lo gris claro es la pantalla del ERP y
          lo gris oscuro, las teclas. */}
      {posicion === 'izquierda' && panel('w-[38%] border-r shrink-0', 12, 'w-[9px]')}
      {posicion === 'abajo' ? (
        <div className="flex-1 flex flex-col">
          {contenido}
          {panel('h-[38%] border-t', 14, 'w-[9px]')}
        </div>
      ) : (
        contenido
      )}
      {posicion === 'derecha' && panel('w-[38%] border-l shrink-0', 12, 'w-[9px]')}
    </div>
  )
}
