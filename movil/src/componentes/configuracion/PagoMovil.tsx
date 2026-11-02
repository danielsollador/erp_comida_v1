import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, View } from 'react-native'
import { apiPagos } from '../../lib/api-pagos'
import { useSesion } from '../../lib/sesion'
import type { ConfigPabilo, CuentaPabilo } from '../../lib/tipos'
import { Aviso, Cargando, Ficha, Nota, Problema } from '../ui'
import { BotonTexto, Cabecera, mensajeDe, nombreBanco, Vacio } from './pagomovil/comun'
import ConectarCuenta from './pagomovil/ConectarCuenta'
import Conexion from './pagomovil/Conexion'
import FilaCuenta from './pagomovil/FilaCuenta'

/**
 * Configuracion > Pago movil: las cuentas del banco contra las que el
 * mostrador verifica que un pago movil de verdad entro. Es la misma seccion
 * de la web (pages/partes/configuracion/PagoMovil.tsx), con las mismas
 * llamadas y los mismos textos.
 *
 * DOS PANTALLAS EN UNA, SEGUN QUIEN MIRA. Con quien esta hecha la
 * verificacion (Pabilo), la clave, los creditos y el plan son de la
 * plataforma: eso lo ve y lo toca SOLO Vertigo. El dueño ve "verificacion de
 * pagos" y sus cuentas: cual es la principal, conectar otra, cambiarle la
 * clave del banco, quitarla.
 *
 * LAS CREDENCIALES NO SE GUARDAN AQUI. La contraseña del banco viaja una vez,
 * al conectar, cifrada al verificador, y no se vuelve a ver: ni en pantalla
 * ni en el telefono.
 */
export default function PagoMovil() {
  const { acceso } = useSesion()
  const vertigo = acceso?.puede.vertigo ?? false
  const [config, setConfig] = useState<ConfigPabilo | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [conectando, setConectando] = useState(false)
  // Las que se estan quitando no se ven (como el "oculto" de Deshacer en la
  // web); si el servidor falla, vuelven a aparecer.
  const [quitando, setQuitando] = useState<string[]>([])
  const [eligiendo, setEligiendo] = useState(false)
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Solo toca el estado cuando el servidor contesta: asi el efecto de abajo
  // no redibuja en cascada al montar.
  const pedir = useCallback(
    () =>
      apiPagos
        .configPabilo()
        .then((c) => {
          setConfig(c)
          setError('')
        })
        .catch((e: unknown) => setError(mensajeDe(e, 'No se pudo consultar la verificación de pagos.')))
        .finally(() => setCargando(false)),
    [],
  )

  useEffect(() => {
    void pedir()
    return () => {
      if (reloj.current) clearTimeout(reloj.current)
    }
  }, [pedir])

  function reintentar() {
    setCargando(true)
    setError('')
    void pedir()
  }

  function ok(texto: string, nuevo?: ConfigPabilo) {
    setError('')
    setAviso(texto)
    if (nuevo) setConfig(nuevo)
    if (reloj.current) clearTimeout(reloj.current)
    reloj.current = setTimeout(() => setAviso(''), 4000)
  }

  async function elegir(c: CuentaPabilo) {
    if (eligiendo) return
    setEligiendo(true)
    try {
      const nuevo = await apiPagos.elegirCuentaPabilo(c.id)
      ok(`«${c.descripcion || nombreBanco(c.banco)}» es ahora la cuenta principal.`, nuevo)
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo.'))
    } finally {
      setEligiendo(false)
    }
  }

  async function quitar(c: CuentaPabilo) {
    setQuitando((q) => [...q, c.id])
    try {
      ok('Cuenta quitada.', await apiPagos.borrarCuentaPabilo(c.id))
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo.'))
    } finally {
      setQuitando((q) => q.filter((id) => id !== c.id))
    }
  }

  // En la web se quita al instante con unos segundos para deshacer; la app
  // no tiene Deshacer, asi que se pregunta antes. Las ventas ya cobradas no
  // cambian.
  function confirmarQuitar(c: CuentaPabilo) {
    const nombre = c.descripcion || nombreBanco(c.banco)
    Alert.alert(
      `¿Quitar «${nombre}»?`,
      'Los pagos que entren a esta cuenta dejan de verificarse. Las ventas ya cobradas no cambian.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Quitar', style: 'destructive', onPress: () => void quitar(c) },
      ],
    )
  }

  if (cargando && !config) return <Cargando />
  // Sin la foto inicial no hay nada que mostrar (ni a Vertigo): mejor el
  // motivo y reintentar que una pantalla a medias.
  if (!config) return <Problema mensaje={error || 'No se pudo consultar la verificación de pagos.'} alReintentar={reintentar} />

  const configurado = config.configurado
  const visibles = config.cuentas.filter((c) => !quitando.includes(c.id))
  const varias = config.cuentas.length > 1

  return (
    <View style={{ gap: 12 }}>
      {error ? <Aviso texto={error} tono="peligro" /> : null}
      {aviso ? <Aviso texto={aviso} tono="exito" /> : null}
      {config.error && !error ? <Aviso texto={config.error} tono="aviso" /> : null}

      {vertigo && <Conexion config={config} alGuardar={(c, texto) => ok(texto, c)} alFallar={setError} />}

      {!vertigo && !configurado && (
        <Ficha>
          <Cabecera titulo="Verificación de pagos móviles" />
          <Nota>
            Con la verificación, el mostrador le pregunta al banco si un pago móvil de verdad entró antes de cobrar: nada
            de capturas retocadas ni referencias repetidas. La activa Vertigo para tu local; escríbenos y la dejamos lista.
          </Nota>
        </Ficha>
      )}

      {configurado && !config.error && (
        <Ficha>
          <Cabecera
            titulo="Cuentas del banco"
            ayuda={
              varias
                ? 'La principal es a la que se verifica por defecto. Al cobrar, la caja marca a cuál de las cuentas le pagaron.'
                : 'La cuenta donde recibes los pagos móviles. Contra esa se verifica cada pago antes de cobrarlo.'
            }
            accion={
              <BotonTexto texto={conectando ? 'Cerrar' : 'Conectar una cuenta'} alTocar={() => setConectando((v) => !v)} />
            }
          />

          {/* Conectar reemplaza a la lista mientras esta abierto: en el
              telefono, el formulario y la lista juntos son demasiado largo. */}
          {conectando ? (
            <ConectarCuenta
              alConectar={(c) => {
                setConectando(false)
                ok('Cuenta conectada: ya se verifican los pagos que entren ahí.', c)
              }}
            />
          ) : config.cuentas.length === 0 ? (
            <Vacio
              icono="tasa"
              titulo="Ninguna cuenta conectada"
              detalle="Conecta la cuenta donde recibes los pagos móviles: con el usuario y la contraseña del banco en línea basta."
            />
          ) : (
            <View>
              {visibles.map((c, i) => (
                <FilaCuenta
                  key={c.id}
                  c={c}
                  varias={varias}
                  ultima={i === visibles.length - 1}
                  alElegir={() => void elegir(c)}
                  alQuitar={() => confirmarQuitar(c)}
                  alCambiarClave={(nuevo) => ok('Clave del banco actualizada y probada.', nuevo)}
                />
              ))}
            </View>
          )}
        </Ficha>
      )}
    </View>
  )
}
