import { useState, type ReactNode } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { apiCuenta } from '../../lib/api-cuenta'
import { useSesion } from '../../lib/sesion'
import { LETRA, useTema } from '../../lib/tema'
import Icono from '../Icono'
import { Aviso, Boton, Campo, Cargando, Ficha, Nota, Titulo } from '../ui'

/**
 * Mi cuenta: quien soy (la ficha de arriba), mi nombre, mi PIN si mi rol
 * autoriza, y mi contrasena. Lo mismo que MiCuenta en la web
 * (frontend/src/pages/MiUsuario.tsx), con los mismos textos.
 *
 * El nombre lo escribe cada quien: es como se le saluda y como aparece en lo
 * que autoriza, no una llave. La contrasena y el PIN piden la contrasena
 * actual aunque haya sesion: si alguien deja el telefono abierto, otro no
 * puede quedarse con la cuenta ni ponerse un PIN a su nombre.
 */

// Los nombres de los roles, como NOMBRE_ROL de la web (lib/acceso.tsx). Se
// copian porque ese archivo toca el navegador y no puede entrar a la app.
const NOMBRE_ROL: Record<string, string> = {
  admin: 'Vertigo',
  dueno: 'Dueño',
  caja: 'Caja',
  cocina: 'Cocina',
}

type Cual = 'nombre' | 'pin' | 'clave'

export default function MiCuenta() {
  const t = useTema()
  const { acceso, recargar, salir } = useSesion()
  // TRES RENGLONES CERRADOS, NO TRES FORMULARIOS ABIERTOS, como en la web:
  // casi nunca se cambia mas de uno. Cada renglon dice como esta y se abre
  // al tocarlo; abrir otro cierra el que estaba abierto. En el telefono
  // pesa mas todavia: seis casillas abiertas no caben en una pantalla.
  const [abierta, setAbierta] = useState<Cual | null>(null)
  const alternar = (cual: Cual) => () => setAbierta((a) => (a === cual ? null : cual))

  if (!acceso) return <Cargando />

  const nombre = acceso.nombre_visible || acceso.usuario || ''
  // El encabezado se refresca con el nombre o el PIN nuevos; si falla la
  // recarga no se dice nada: el cambio ya quedo guardado en el servidor.
  const alCambiar = () => {
    recargar().catch(() => undefined)
  }

  return (
    <>
      <Ficha style={estilos.quien}>
        <View style={[estilos.inicial, { backgroundColor: t.tinta }]}>
          <Text style={[estilos.inicialTexto, { color: t.papel }]}>{nombre.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[estilos.quienNombre, { color: t.tinta }]} numberOfLines={1}>
            {nombre}
          </Text>
          <Text style={[estilos.resumen, { color: t.suave }]} numberOfLines={1}>
            {nombre !== acceso.usuario ? `@${acceso.usuario} · ` : ''}
            {NOMBRE_ROL[acceso.rol ?? ''] ?? acceso.rol} · {acceso.local.nombre}
          </Text>
        </View>
        {acceso.puede.autoriza && (
          <Pastilla tono={acceso.tiene_pin ? 'bien' : 'ojo'}>{acceso.tiene_pin ? 'PIN listo' : 'sin PIN'}</Pastilla>
        )}
      </Ficha>

      <MiNombre
        nombre={acceso.nombre}
        apellido={acceso.apellido}
        alCambiar={alCambiar}
        abierta={abierta === 'nombre'}
        alAlternar={alternar('nombre')}
      />
      {acceso.puede.autoriza && (
        <MiPin
          tienePin={acceso.tiene_pin}
          alCambiar={alCambiar}
          abierta={abierta === 'pin'}
          alAlternar={alternar('pin')}
        />
      )}
      <CambiarClave abierta={abierta === 'clave'} alAlternar={alternar('clave')} alTerminar={salir} />
    </>
  )
}

// ── Piezas ──────────────────────────────────────────────────────────────────
// La Tarjeta la usa tambien Apariencia: en la web las dos secciones viven en
// el mismo archivo (MiUsuario.tsx) y comparten la misma tarjeta.

/** La pastilla de estado de la web (`Pastilla` bien / ojo). */
function Pastilla({ children, tono }: { children: string; tono: 'bien' | 'ojo' }) {
  const t = useTema()
  return (
    <View style={[estilos.pastilla, { backgroundColor: tono === 'bien' ? t.exitoSuave : t.avisoSuave }]}>
      <Text style={[estilos.pastillaTexto, { color: tono === 'bien' ? t.exito : t.aviso }]}>{children}</Text>
    </View>
  )
}

/**
 * La tarjeta de una seccion: titulo, ayuda y su contenido. Con `plegable` es
 * un renglon que se abre: cerrado dice `resumen` (como esta) y nada mas, y
 * todo el renglon se toca, no solo la flecha.
 */
export function Tarjeta({
  titulo,
  ayuda,
  children,
  plegable,
}: {
  titulo: string
  ayuda?: string
  children: ReactNode
  plegable?: { abierta: boolean; alAlternar: () => void; resumen: string }
}) {
  const t = useTema()
  if (plegable) {
    return (
      <Ficha style={{ padding: 0 }}>
        <Pressable
          onPress={plegable.alAlternar}
          accessibilityRole="button"
          accessibilityState={{ expanded: plegable.abierta }}
          style={({ pressed }) => [estilos.renglon, pressed && { opacity: 0.7 }]}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Titulo style={estilos.tarjetaTitulo}>{titulo}</Titulo>
            <Text style={[estilos.resumen, { color: t.suave }]} numberOfLines={1}>
              {plegable.resumen}
            </Text>
          </View>
          {/* El chevron de la web apunta a la derecha: se gira para decir "abre hacia abajo". */}
          <View style={{ transform: [{ rotate: plegable.abierta ? '-90deg' : '90deg' }], opacity: 0.6 }}>
            <Icono nombre="chevron" size={18} color={t.tinta} />
          </View>
        </Pressable>
        {plegable.abierta && (
          <View style={estilos.cuerpo}>
            {ayuda ? <Nota style={{ fontSize: 13, color: t.tenue }}>{ayuda}</Nota> : null}
            {children}
          </View>
        )}
      </Ficha>
    )
  }
  return (
    <Ficha style={{ gap: 12 }}>
      <View style={{ gap: 2 }}>
        <Titulo style={estilos.tarjetaTitulo}>{titulo}</Titulo>
        {ayuda ? <Nota style={{ fontSize: 13, color: t.tenue }}>{ayuda}</Nota> : null}
      </View>
      {children}
    </Ficha>
  )
}

/** Error y "listo" con el mismo lugar y el mismo tono que en la web. */
function Mensajes({ error, listo }: { error: string; listo: string }) {
  return (
    <>
      {error ? <Aviso tono="peligro" texto={error} /> : null}
      {listo ? <Aviso tono="exito" texto={listo} /> : null}
    </>
  )
}

const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : 'No se pudo guardar.')

// Lo que comparten los campos de clave: nada de mayusculas ni correcciones,
// que en una contrasena cambian lo que se escribio sin que se note.
const CLAVE = { secureTextEntry: true, autoCapitalize: 'none', autoCorrect: false } as const

// ── Mi nombre ───────────────────────────────────────────────────────────────

/** Como me llamo: lo que se ve al saludar y en lo que autorizo. */
function MiNombre({
  nombre,
  apellido,
  alCambiar,
  abierta,
  alAlternar,
}: {
  nombre: string
  apellido: string
  alCambiar: () => void
  abierta: boolean
  alAlternar: () => void
}) {
  const [n, setN] = useState(nombre)
  const [a, setA] = useState(apellido)
  const [error, setError] = useState('')
  const [listo, setListo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const sinCambios = n === nombre && a === apellido

  async function guardar() {
    if (guardando || sinCambios) return
    setError('')
    setListo('')
    setGuardando(true)
    try {
      await apiCuenta.cambiarMiNombre(n, a)
      setListo('Listo. Así se te va a saludar de ahora en adelante.')
      alCambiar()
    } catch (e) {
      setError(mensajeDe(e))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Tarjeta
      titulo="Mi nombre"
      ayuda="Con este nombre te saluda el sistema y queda escrito en lo que autorizas. Tu usuario para entrar no cambia."
      plegable={{ abierta, alAlternar, resumen: [nombre, apellido].filter(Boolean).join(' ') || 'Sin nombre todavía' }}
    >
      <Mensajes error={error} listo={listo} />
      <View style={estilos.par}>
        <View style={{ flex: 1 }}>
          <Campo
            rotulo="Nombre"
            value={n}
            onChangeText={setN}
            placeholder="ej. Daniel"
            autoCapitalize="words"
            autoComplete="given-name"
            textContentType="givenName"
            returnKeyType="next"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Campo
            rotulo="Apellido"
            value={a}
            onChangeText={setA}
            placeholder="ej. Sollador"
            autoCapitalize="words"
            autoComplete="family-name"
            textContentType="familyName"
            returnKeyType="done"
            onSubmitEditing={() => void guardar()}
          />
        </View>
      </View>
      <Boton
        texto={guardando ? 'Guardando...' : 'Guardar mi nombre'}
        alTocar={() => void guardar()}
        ocupado={guardando}
        deshabilitado={sinCambios}
      />
    </Tarjeta>
  )
}

// ── Mi PIN ──────────────────────────────────────────────────────────────────

/**
 * Mi PIN: con el firmo en el mostrador sin escribir usuario ni contrasena.
 * Solo se ofrece a quien tiene un rol que autoriza.
 */
function MiPin({
  tienePin,
  alCambiar,
  abierta,
  alAlternar,
}: {
  tienePin: boolean
  alCambiar: () => void
  abierta: boolean
  alAlternar: () => void
}) {
  const t = useTema()
  const [clave, setClave] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [error, setError] = useState('')
  const [listo, setListo] = useState('')
  const [guardando, setGuardando] = useState(false)
  // En la web el formulario no se envia con la contrasena vacia (`required`);
  // aqui no hay validacion del navegador, asi que el boton espera.
  const listoParaGuardar = clave.length > 0 && pin.length >= 4

  async function guardar() {
    if (guardando || !listoParaGuardar) return
    setError('')
    setListo('')
    if (pin !== pin2) {
      setError('Los dos PIN no coinciden.')
      return
    }
    setGuardando(true)
    try {
      await apiCuenta.ponerMiPin(clave, pin)
      setListo(tienePin ? 'PIN cambiado.' : 'PIN listo. Ya puedes autorizar en el mostrador con él.')
      setClave('')
      setPin('')
      setPin2('')
      alCambiar()
    } catch (e) {
      setError(mensajeDe(e))
    } finally {
      setGuardando(false)
    }
  }

  function quitar() {
    // El dialogo nativo del telefono hace de `dialogo.confirmar` de la web:
    // mismo titulo, mismo texto y el boton de quitar en rojo.
    Alert.alert(
      '¿Quitar tu PIN?',
      'Dejas de poder autorizar con PIN en el mostrador; desde tu aplicación sigues pudiendo.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Quitar PIN',
          style: 'destructive',
          onPress: async () => {
            setError('')
            setListo('')
            try {
              await apiCuenta.quitarMiPin()
              setListo('PIN quitado.')
              alCambiar()
            } catch (e) {
              setError(mensajeDe(e))
            }
          },
        },
      ],
    )
  }

  // Solo numeros y hasta seis, como el `Numerico entero` de la web: lo que se
  // pega con letras se limpia en vez de rechazarse.
  const soloNumeros = (v: string) => v.replace(/\D/g, '').slice(0, 6)

  return (
    <Tarjeta
      plegable={{
        abierta,
        alAlternar,
        resumen: tienePin
          ? 'Ya tienes PIN: autorizas en el mostrador sin tu contraseña'
          : 'Todavía no tienes: créalo para autorizar en el mostrador',
      }}
      titulo={tienePin ? 'Mi PIN' : 'Crear mi PIN'}
      ayuda="De 4 a 6 números. Con él autorizas en el mostrador (por ejemplo, editar una venta ya cobrada) sin escribir usuario ni contraseña. Cuando no estés en el local, las solicitudes te llegan a la aplicación."
    >
      <Mensajes error={error} listo={listo} />
      <Campo
        rotulo="Tu contraseña"
        value={clave}
        onChangeText={setClave}
        {...CLAVE}
        autoComplete="current-password"
        textContentType="password"
      />
      <View style={estilos.par}>
        <View style={{ flex: 1 }}>
          <Campo
            rotulo="PIN nuevo"
            accessibilityLabel="PIN nuevo"
            value={pin}
            onChangeText={(v) => setPin(soloNumeros(v))}
            secureTextEntry
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="off"
            style={estilos.pin}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Campo
            rotulo="Repetir PIN"
            accessibilityLabel="Repetir PIN"
            value={pin2}
            onChangeText={(v) => setPin2(soloNumeros(v))}
            secureTextEntry
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="off"
            style={estilos.pin}
          />
        </View>
      </View>
      <View style={estilos.acciones}>
        <View style={{ flex: 1 }}>
          <Boton
            texto={guardando ? 'Guardando...' : tienePin ? 'Cambiar PIN' : 'Crear PIN'}
            alTocar={() => void guardar()}
            ocupado={guardando}
            deshabilitado={!listoParaGuardar}
          />
        </View>
        {tienePin && (
          <Pressable
            onPress={quitar}
            accessibilityRole="button"
            hitSlop={6}
            style={({ pressed }) => [estilos.quitar, pressed && { opacity: 0.6 }]}
          >
            <Text style={[estilos.quitarTexto, { color: t.peligro }]}>Quitar PIN</Text>
          </Pressable>
        )}
      </View>
    </Tarjeta>
  )
}

// ── Mi contrasena ───────────────────────────────────────────────────────────

function CambiarClave({
  abierta,
  alAlternar,
  alTerminar,
}: {
  abierta: boolean
  alAlternar: () => void
  /** Lo que pasa despues de cambiarla: salir, porque el servidor cerro las sesiones. */
  alTerminar: () => Promise<void>
}) {
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [nueva2, setNueva2] = useState('')
  const [error, setError] = useState('')
  const [listo, setListo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  // La web lo exige con `required` y `minLength={8}`; aqui el boton espera a
  // que se cumpla, y el rotulo "Nueva (8 o más)" dice por que.
  const completa = actual.length > 0 && nueva.length >= 8 && nueva2.length >= 8

  async function guardar() {
    if (guardando || !completa) return
    setError('')
    if (nueva !== nueva2) {
      setError('Las dos contraseñas nuevas no coinciden.')
      return
    }
    setGuardando(true)
    try {
      await apiCuenta.cambiarMiClave(actual, nueva)
      setListo(true)
      // Cambiar la clave cierra todas las sesiones anteriores, incluida esta.
      // Se deja leer el aviso y se vuelve a la pantalla de entrar, como la web
      // vuelve a /login.html.
      setTimeout(() => void alTerminar(), 1800)
    } catch (e) {
      setError(mensajeDe(e))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Tarjeta titulo="Mi contraseña" plegable={{ abierta, alAlternar, resumen: 'Para cambiarla se pide la actual' }}>
      {listo ? (
        <Aviso texto="Listo. Por seguridad se cerraron tus sesiones: vuelve a entrar con la clave nueva." />
      ) : (
        <>
          {error ? <Aviso tono="peligro" texto={error} /> : null}
          <Campo
            rotulo="Contraseña actual"
            value={actual}
            onChangeText={setActual}
            {...CLAVE}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="next"
          />
          <Campo
            rotulo="Nueva (8 o más)"
            value={nueva}
            onChangeText={setNueva}
            {...CLAVE}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
          />
          <Campo
            rotulo="Repetir la nueva"
            value={nueva2}
            onChangeText={setNueva2}
            {...CLAVE}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="done"
            onSubmitEditing={() => void guardar()}
          />
          <Boton
            texto={guardando ? 'Guardando...' : 'Cambiar contraseña'}
            alTocar={() => void guardar()}
            ocupado={guardando}
            deshabilitado={!completa}
          />
        </>
      )}
    </Tarjeta>
  )
}

const estilos = StyleSheet.create({
  quien: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  inicial: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  inicialTexto: { fontFamily: LETRA.tituloFuerte, fontSize: 18 },
  quienNombre: { fontFamily: LETRA.textoFuerte, fontSize: 16 },
  resumen: { fontFamily: LETRA.texto, fontSize: 13, lineHeight: 18, marginTop: 1 },
  pastilla: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0 },
  pastillaTexto: { fontFamily: LETRA.textoFuerte, fontSize: 12 },
  renglon: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, minHeight: 64 },
  cuerpo: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  tarjetaTitulo: { fontSize: 16 },
  par: { flexDirection: 'row', gap: 12 },
  pin: { textAlign: 'center', fontSize: 20, letterSpacing: 8 },
  acciones: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  quitar: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  quitarTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14 },
})
