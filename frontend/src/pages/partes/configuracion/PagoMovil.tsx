import { useEffect, useState, type FormEvent } from 'react'
import { useDialogo } from '../../../components/dialogo'
import { Aviso, Boton, Campo, Pastilla, Seccion, Selector, Vacio } from '../../../components/ui'
import { useAcceso } from '../../../lib/acceso'
import { api } from '../../../lib/api'
import type { ConfigPabilo, CuentaPabilo, OpcionBanco } from '../../../lib/types'

/**
 * Configuracion > Pago movil: las cuentas del banco contra las que el
 * mostrador verifica que un pago movil de verdad entro.
 *
 * DOS PANTALLAS EN UNA, SEGUN QUIEN MIRA. La verificacion la presta Vertigo
 * a traves de un tercero (Pabilo); con quien esta hecha, la clave, los
 * creditos y el plan son de la plataforma. Eso lo ve y lo toca SOLO Vertigo.
 * El dueño del local ve "verificacion de pagos" y sus cuentas bancarias: cual
 * es la principal, conectar otra, cambiarle la clave del banco, quitarla
 * (Leider, 29-sep: "si no eres admin, no tienes por que ver con quien
 * estamos integrados").
 *
 * UNA PRINCIPAL, Y LA CAJA ELIGE SI HAY MAS. Un local con dos bancos recibe
 * pagos en los dos; la principal es a la que se verifica por defecto, y al
 * cobrar la caja marca a cual le pagaron. No hay "pausar": una cuenta que no
 * se usa se quita.
 *
 * LAS CREDENCIALES NO SE GUARDAN AQUI. La contraseña del banco viaja una vez,
 * al conectar, cifrada al verificador, y no se vuelve a ver.
 */
export default function PagoMovil() {
  const { estado } = useAcceso()
  const vertigo = estado.puede.vertigo
  const dialogo = useDialogo()
  const [config, setConfig] = useState<ConfigPabilo | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [conectando, setConectando] = useState(false)

  useEffect(() => {
    api
      .configPabilo()
      .then((c) => {
        setConfig(c)
        setError('')
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setCargando(false))
  }, [])

  function ok(texto: string, nuevo?: ConfigPabilo) {
    setError('')
    setAviso(texto)
    if (nuevo) setConfig(nuevo)
    window.setTimeout(() => setAviso(''), 4000)
  }

  async function correr(accion: () => Promise<ConfigPabilo>, texto: string) {
    try {
      ok(texto, await accion())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo.')
    }
  }

  async function elegir(c: CuentaPabilo) {
    await correr(() => api.elegirCuentaPabilo(c.id), `«${c.descripcion || nombreBanco(c.banco)}» es ahora la cuenta principal.`)
  }

  async function quitar(c: CuentaPabilo) {
    const seguro = await dialogo.confirmar({
      titulo: `¿Quitar «${c.descripcion || nombreBanco(c.banco)}»?`,
      texto: 'Deja de verificarse contra esa cuenta. Las ventas ya cobradas no cambian.',
      aceptar: 'Quitar',
      peligro: true,
    })
    if (!seguro) return
    await correr(() => api.borrarCuentaPabilo(c.id), 'Cuenta quitada.')
  }

  if (cargando && !config) {
    return <p className="text-sm text-neutral-400 py-6 text-center">Consultando…</p>
  }

  const configurado = Boolean(config?.configurado)
  const varias = (config?.cuentas.length ?? 0) > 1

  return (
    <div className="space-y-4">
      {error && <Aviso>{error}</Aviso>}
      {aviso && <Aviso tono="bien">{aviso}</Aviso>}
      {config?.error && !error && <Aviso tono="ojo">{config.error}</Aviso>}

      {vertigo && <Conexion config={config} onGuardada={(c, texto) => ok(texto, c)} onError={setError} />}

      {!vertigo && !configurado && (
        <Seccion titulo="Verificación de pagos móviles">
          <p className="text-sm text-neutral-600">
            Con la verificación, el mostrador le pregunta al banco si un pago móvil de verdad entró antes de
            cobrar: nada de capturas retocadas ni referencias repetidas. La activa Vertigo para tu local;
            escríbenos y la dejamos lista.
          </p>
        </Seccion>
      )}

      {configurado && !config?.error && (
        <Seccion
          titulo="Cuentas del banco"
          ayuda={
            varias
              ? 'La principal es a la que se verifica por defecto. Al cobrar, la caja marca a cuál de las cuentas le pagaron.'
              : 'La cuenta donde recibes los pagos móviles. Contra esa se verifica cada pago antes de cobrarlo.'
          }
          accion={
            <Boton tono="fantasma" onClick={() => setConectando((v) => !v)}>
              {conectando ? 'Cerrar' : 'Conectar una cuenta'}
            </Boton>
          }
        >
          {conectando && (
            <ConectarCuenta
              onConectada={(c) => {
                setConectando(false)
                ok('Cuenta conectada: ya se verifican los pagos que entren ahí.', c)
              }}
              onError={setError}
            />
          )}
          {config!.cuentas.length === 0 ? (
            <Vacio
              icono="tasa"
              titulo="Ninguna cuenta conectada"
              detalle="Conecta la cuenta donde recibes los pagos móviles: con el usuario y la contraseña del banco en línea basta."
            />
          ) : (
            <ul className="divide-y divide-neutral-100">
              {config!.cuentas.map((c) => (
                <FilaCuenta
                  key={c.id}
                  c={c}
                  varias={varias}
                  onElegir={() => void elegir(c)}
                  onQuitar={() => void quitar(c)}
                  onClaveCambiada={(nuevo) => ok('Clave del banco actualizada y probada.', nuevo)}
                  onError={setError}
                />
              ))}
            </ul>
          )}
        </Seccion>
      )}
    </div>
  )
}

// ── La conexion con el verificador (solo Vertigo) ──────────────────────────

function Conexion({
  config,
  onGuardada,
  onError,
}: {
  config: ConfigPabilo | null
  onGuardada: (c: ConfigPabilo, texto: string) => void
  onError: (t: string) => void
}) {
  const [editando, setEditando] = useState(false)
  const [clave, setClave] = useState('')
  const [guardando, setGuardando] = useState(false)
  const configurado = Boolean(config?.configurado)

  async function guardar(e: FormEvent) {
    e.preventDefault()
    if (!clave.trim()) return
    setGuardando(true)
    try {
      const nuevo = await api.guardarClavePabilo(clave.trim())
      setClave('')
      setEditando(false)
      onGuardada(nuevo, 'Clave guardada: Pabilo la reconoció.')
    } catch (err) {
      onError(err instanceof Error ? err.message : 'No se pudo guardar la clave.')
    } finally {
      setGuardando(false)
    }
  }

  async function quitar() {
    setGuardando(true)
    try {
      const nuevo = await api.guardarClavePabilo('')
      onGuardada(
        nuevo,
        nuevo.configurado ? 'Se quitó la clave guardada; vale la del servidor.' : 'Clave quitada. El mostrador cobra sin verificar.',
      )
    } catch (err) {
      onError(err instanceof Error ? err.message : 'No se pudo quitar la clave.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Seccion
      titulo="Integración con Pabilo"
      ayuda="Solo Vertigo ve esto. Pabilo (pabilo.app) tiene las cuentas del banco conectadas y responde si un pago entró, cuánto fue y si ya se usó. Cada consulta nueva gasta un crédito."
      accion={
        configurado && !editando ? (
          <span className="flex items-center gap-2">
            <Boton tono="fantasma" onClick={() => setEditando(true)}>
              Cambiar clave
            </Boton>
            {config?.origen_clave === 'pantalla' && (
              <Boton tono="fantasma" onClick={() => void quitar()} disabled={guardando}>
                Quitar
              </Boton>
            )}
          </span>
        ) : undefined
      }
    >
      {configurado && !editando ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Dato titulo="Cuenta de Pabilo" valor={config?.perfil?.empresa || config?.perfil?.usuario || '—'} />
          <Dato
            titulo="Créditos"
            valor={config?.perfil?.creditos == null ? '—' : String(config.perfil.creditos)}
            ojo={config?.perfil?.creditos != null && config.perfil.creditos < 10}
          />
          <Dato
            titulo="Plan"
            valor={config?.perfil ? (config.perfil.plan_activo ? 'Activo' : 'Vencido') : '—'}
            ojo={config?.perfil ? !config.perfil.plan_activo : false}
          />
          <Dato
            titulo="Clave"
            valor={config?.clave_pista || '••••'}
            ayuda={config?.origen_clave === 'servidor' ? 'Puesta en el servidor' : 'Guardada aquí'}
          />
        </div>
      ) : (
        <form onSubmit={(e) => void guardar(e)} className="space-y-3">
          <p className="text-sm text-neutral-600">
            Entra a <span className="font-medium">pabilo.app → Integraciones → API Keys</span>, genera una clave
            para este local y pégala aquí. Se prueba antes de guardarse: una clave mal copiada no se queda puesta.
          </p>
          <Campo
            etiqueta="Clave de Pabilo (API key)"
            type="password"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            autoComplete="off"
            autoFocus={editando}
          />
          <div className="flex items-center gap-2">
            <Boton type="submit" disabled={!clave.trim() || guardando}>
              {guardando ? 'Probando…' : 'Guardar y probar'}
            </Boton>
            {editando && (
              <Boton tono="fantasma" onClick={() => setEditando(false)}>
                Cancelar
              </Boton>
            )}
          </div>
        </form>
      )}
    </Seccion>
  )
}

function Dato({ titulo, valor, ayuda, ojo = false }: { titulo: string; valor: string; ayuda?: string; ojo?: boolean }) {
  return (
    <div className="min-w-0">
      <span className="block text-[11px] uppercase tracking-wide text-neutral-500 font-semibold">{titulo}</span>
      <span className={`block font-semibold truncate tabular-nums ${ojo ? 'text-aviso-700' : ''}`}>{valor}</span>
      {ayuda && <span className="block text-xs text-neutral-400">{ayuda}</span>}
    </div>
  )
}

// ── Cada cuenta conectada ───────────────────────────────────────────────────

function FilaCuenta({
  c,
  varias,
  onElegir,
  onQuitar,
  onClaveCambiada,
  onError,
}: {
  c: CuentaPabilo
  varias: boolean
  onElegir: () => void
  onQuitar: () => void
  onClaveCambiada: (nuevo: ConfigPabilo) => void
  onError: (t: string) => void
}) {
  const [cambiandoClave, setCambiandoClave] = useState(false)
  const [clave, setClave] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function guardarClave(e: FormEvent) {
    e.preventDefault()
    if (!clave) return
    setGuardando(true)
    try {
      const nuevo = await api.cambiarClaveCuentaPabilo(c.id, clave)
      setClave('')
      setCambiandoClave(false)
      onClaveCambiada(nuevo)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'No se pudo cambiar la clave.')
    } finally {
      setGuardando(false)
    }
  }

  const fueraDeServicio = c.bloqueada || c.deshabilitada
  const estado = c.bloqueada ? (
    <Pastilla tono="mal">bloqueada por el banco</Pastilla>
  ) : c.deshabilitada ? (
    <Pastilla tono="ojo">fuera de servicio</Pastilla>
  ) : c.activa && varias ? (
    <Pastilla tono="bien">principal</Pastilla>
  ) : null

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        {/* La principal se marca con un toque; con una sola cuenta no hay
            nada que elegir y el circulo sobra. */}
        {varias && (
          <button
            type="button"
            onClick={onElegir}
            disabled={c.activa || fueraDeServicio}
            aria-label={c.activa ? 'Es la cuenta principal' : 'Hacerla la principal'}
            className={`mt-1 w-4 h-4 shrink-0 rounded-full border-2 ${
              c.activa ? 'border-neutral-900 bg-neutral-900 ring-2 ring-white ring-inset' : 'border-neutral-300 hover:border-neutral-500'
            } disabled:cursor-default`}
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold truncate">{c.descripcion || nombreBanco(c.banco)}</span>
            {estado}
          </div>
          <div className="text-xs text-neutral-500 mt-0.5 tabular-nums">
            {nombreBanco(c.banco)}
            {c.numero && ` · cuenta ${c.numero}`}
            {c.telefono && ` · ${c.telefono}`}
            {c.moneda && c.moneda !== 'VEF' && ` · ${c.moneda}`}
          </div>
          {cambiandoClave && (
            <form onSubmit={(e) => void guardarClave(e)} className="mt-2 flex items-end gap-2 max-w-md">
              <Campo
                etiqueta="Clave nueva del banco"
                type="password"
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                autoComplete="new-password"
                autoFocus
                className="flex-1"
                ayuda="Se prueba con el banco antes de guardarse."
              />
              <Boton type="submit" disabled={!clave || guardando}>
                {guardando ? 'Probando…' : 'Guardar'}
              </Boton>
              <Boton tono="fantasma" onClick={() => setCambiandoClave(false)}>
                Cancelar
              </Boton>
            </form>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0 text-xs">
          {varias && !c.activa && !fueraDeServicio && (
            <button type="button" onClick={onElegir} className="text-neutral-600 hover:text-neutral-900 font-medium px-2 py-1">
              Hacer principal
            </button>
          )}
          <button type="button" onClick={() => setCambiandoClave((v) => !v)} className="text-neutral-500 hover:text-neutral-900 px-2 py-1">
            Clave del banco
          </button>
          <button type="button" onClick={onQuitar} className="text-neutral-400 hover:text-peligro-600 px-2 py-1">
            Quitar
          </button>
        </div>
      </div>
    </li>
  )
}

const NOMBRES: Record<string, string> = {
  banco_venezuela: 'Banco de Venezuela',
  banesco: 'Banesco',
  banco_mercantil_ca: 'Mercantil',
  provincial: 'Provincial',
  bancamiga: 'Bancamiga',
  binance: 'Binance',
  test: 'Banco de prueba',
  notificaciones: 'Notificaciones del banco',
  VE_BAN: 'Banco de Venezuela',
  VE_BAN_EMP_V2: 'Banco de Venezuela (empresas)',
  MERCANTIL_EMP_V1: 'Mercantil (empresas)',
  VE_BANESCO_V1: 'Banesco (empresas)',
  VE_BANK_PLAZA_V1: 'Banco Plaza (empresas)',
  BINANCE_APP: 'Binance Pay',
  BANK_TEST: 'Banco de prueba',
  NOTIFICATION_ACCOUNT: 'Notificaciones del banco',
}

function nombreBanco(clave: string): string {
  return NOMBRES[clave] ?? clave.replace(/_/g, ' ')
}

// ── Conectar una cuenta nueva ───────────────────────────────────────────────

function ConectarCuenta({
  onConectada,
  onError,
}: {
  onConectada: (c: ConfigPabilo) => void
  onError: (t: string) => void
}) {
  const [opciones, setOpciones] = useState<OpcionBanco[] | null>(null)
  const [proveedor, setProveedor] = useState('')
  const [valores, setValores] = useState<Record<string, string>>({})
  const [descripcion, setDescripcion] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    api
      .bancosPabilo()
      .then((lista) => {
        setOpciones(lista)
        if (lista.length > 0) setProveedor(lista[0].proveedor)
      })
      .catch((e: Error) => onError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const opcion = opciones?.find((o) => o.proveedor === proveedor)
  const completo = Boolean(opcion) && (opcion?.campos ?? []).every((c) => !c.requerido || (valores[c.clave] ?? '').trim())

  async function conectar(e: FormEvent) {
    e.preventDefault()
    if (!opcion || !completo) return
    setGuardando(true)
    try {
      const metadata: Record<string, string> = {}
      for (const [k, v] of Object.entries(valores)) {
        if (k.startsWith('metadata.') && v.trim()) metadata[k.slice('metadata.'.length)] = v.trim()
      }
      const nuevo = await api.crearCuentaPabilo({
        proveedor: opcion.proveedor,
        descripcion: descripcion.trim() || opcion.nombre,
        usuario: valores.usuario,
        clave: valores.clave,
        telefono: valores.telefono,
        cedula: valores.cedula,
        metadata,
      })
      setValores({})
      setDescripcion('')
      onConectada(nuevo)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'No se pudo conectar la cuenta.')
    } finally {
      setGuardando(false)
    }
  }

  if (opciones === null) return <p className="text-sm text-neutral-400 py-3">Buscando los bancos disponibles…</p>

  return (
    <form onSubmit={(e) => void conectar(e)} className="rounded-xl bg-neutral-50 p-4 mb-4 space-y-3">
      <Selector
        etiqueta="Banco"
        value={proveedor}
        onChange={(e) => {
          setProveedor(e.target.value)
          setValores({})
        }}
      >
        {opciones.map((o) => (
          <option key={o.proveedor} value={o.proveedor}>
            {o.nombre}
          </option>
        ))}
      </Selector>
      {opcion?.ayuda && <p className="text-xs text-neutral-500 leading-snug">{opcion.ayuda}</p>}

      <div className="grid sm:grid-cols-2 gap-3">
        {opcion?.campos.map((c) => (
          <Campo
            key={c.clave}
            etiqueta={c.rotulo + (c.requerido ? '' : ' (opcional)')}
            type={c.secreto ? 'password' : 'text'}
            value={valores[c.clave] ?? ''}
            onChange={(e) => setValores((v) => ({ ...v, [c.clave]: e.target.value }))}
            autoComplete={c.secreto ? 'new-password' : 'off'}
            ayuda={c.ayuda || undefined}
          />
        ))}
        <Campo
          etiqueta="Nombre para reconocerla"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder={opcion ? `Ej. ${opcion.nombre.split(' ·')[0]} del local` : ''}
        />
      </div>

      <div className="flex items-center gap-3">
        <Boton type="submit" disabled={!completo || guardando}>
          {guardando ? 'Conectando…' : 'Conectar'}
        </Boton>
        <span className="text-xs text-neutral-500">
          La contraseña del banco viaja una sola vez, cifrada, al verificador de pagos. Aquí no se guarda.
        </span>
      </div>
    </form>
  )
}
