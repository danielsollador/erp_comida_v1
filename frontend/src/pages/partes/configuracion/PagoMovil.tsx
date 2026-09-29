import { useEffect, useState, type FormEvent } from 'react'
import { useDialogo } from '../../../components/dialogo'
import { Aviso, Boton, Campo, Pastilla, Seccion, Selector, Vacio } from '../../../components/ui'
import { api } from '../../../lib/api'
import type { ConfigPabilo, CuentaPabilo, OpcionBanco } from '../../../lib/types'

/**
 * Configuracion > Pago movil: conectar el local con Pabilo para que el
 * mostrador pueda preguntarle al banco si un pago movil de verdad entro.
 *
 * TRES COSAS, EN ORDEN. Primero la clave de Pabilo (se pega una vez, se
 * prueba antes de guardarse). Con la clave puesta, las cuentas bancarias que
 * Pabilo tiene conectadas, y cual de ellas es la del local. Y por ultimo
 * conectar una cuenta nueva desde aqui mismo: se elige el banco, se llenan
 * las credenciales que ESE banco pide (usuario y contraseña de BDV en linea,
 * o el Client ID y el Secret de un banco juridico) y Pabilo la da de alta.
 *
 * LA CLAVE NUNCA VUELVE ENTERA. El servidor manda solo sus ultimos cuatro
 * caracteres, para saber cual esta puesta; las contraseñas del banco viajan
 * una vez, al conectar, y no se vuelven a ver (Pabilo las guarda cifradas).
 *
 * Lo que aqui se decide no bloquea el cobro: si algo falla, el mostrador
 * sigue cobrando anotando la referencia, como siempre.
 */
export default function PagoMovil() {
  const dialogo = useDialogo()
  const [config, setConfig] = useState<ConfigPabilo | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [conectando, setConectando] = useState(false)

  useEffect(() => {
    cargar()
  }, [])

  function cargar() {
    setCargando(true)
    api
      .configPabilo()
      .then((c) => {
        setConfig(c)
        setError('')
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setCargando(false))
  }

  function ok(texto: string, nuevo?: ConfigPabilo) {
    setError('')
    setAviso(texto)
    if (nuevo) setConfig(nuevo)
    window.setTimeout(() => setAviso(''), 4000)
  }

  async function correr(accion: () => Promise<ConfigPabilo>, texto: string) {
    try {
      const nuevo = await accion()
      ok(texto, nuevo)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo.')
      return false
    }
  }

  async function elegir(c: CuentaPabilo) {
    await correr(() => api.elegirCuentaPabilo(c.id), `El local cobra en «${c.descripcion || c.banco}».`)
  }

  async function alternar(c: CuentaPabilo) {
    await correr(
      () => api.alternarCuentaPabilo(c.id),
      c.deshabilitada ? `«${c.descripcion}» vuelve a recibir verificaciones.` : `«${c.descripcion}» quedó en pausa.`,
    )
  }

  async function quitar(c: CuentaPabilo) {
    const seguro = await dialogo.confirmar({
      titulo: `¿Quitar «${c.descripcion || c.banco}» de Pabilo?`,
      texto: 'Deja de verificarse contra esa cuenta. Las ventas ya cobradas no cambian.',
      aceptar: 'Quitar',
      peligro: true,
    })
    if (!seguro) return
    await correr(() => api.borrarCuentaPabilo(c.id), 'Cuenta quitada.')
  }

  if (cargando && !config) {
    return <p className="text-sm text-neutral-400 py-6 text-center">Consultando a Pabilo…</p>
  }

  return (
    <div className="space-y-4">
      {error && <Aviso>{error}</Aviso>}
      {aviso && <Aviso tono="bien">{aviso}</Aviso>}
      {config?.error && !error && <Aviso tono="ojo">{config.error}</Aviso>}

      <Clave config={config} onGuardada={(c, texto) => ok(texto, c)} onError={setError} />

      {config?.configurado && !config.error && (
        <Seccion
          titulo="Cuentas bancarias"
          ayuda="Las cuentas conectadas en Pabilo. Una es con la que cobra este local: contra esa se verifican los pagos móviles."
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
                ok('Cuenta conectada. Pabilo ya puede consultar sus movimientos.', c)
              }}
              onError={setError}
            />
          )}
          {config.cuentas.length === 0 ? (
            <Vacio
              icono="tasa"
              titulo="Ninguna cuenta conectada"
              detalle="Conecta la cuenta donde recibes los pagos móviles: usuario y contraseña del banco en línea, y Pabilo hace el resto."
            />
          ) : (
            <ul className="divide-y divide-neutral-100">
              {config.cuentas.map((c) => (
                <FilaCuenta
                  key={c.id}
                  c={c}
                  onElegir={() => void elegir(c)}
                  onAlternar={() => void alternar(c)}
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

// ── La clave de Pabilo ──────────────────────────────────────────────────────

function Clave({
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
      onGuardada(nuevo, nuevo.configurado ? 'Se quitó la clave guardada; vale la del servidor.' : 'Clave quitada. El mostrador cobra sin verificar.')
    } catch (err) {
      onError(err instanceof Error ? err.message : 'No se pudo quitar la clave.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Seccion
      titulo="Conexión con Pabilo"
      ayuda="Pabilo (pabilo.app) tiene la cuenta del banco conectada y responde en segundos si un pago móvil entró, cuánto fue y si ya se usó."
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
            ayuda="Cada consulta nueva gasta uno."
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
  onElegir,
  onAlternar,
  onQuitar,
  onClaveCambiada,
  onError,
}: {
  c: CuentaPabilo
  onElegir: () => void
  onAlternar: () => void
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

  const estado = c.bloqueada ? (
    <Pastilla tono="mal">bloqueada por el banco</Pastilla>
  ) : c.deshabilitada ? (
    <Pastilla tono="ojo">en pausa</Pastilla>
  ) : c.activa ? (
    <Pastilla tono="bien">cobra aquí</Pastilla>
  ) : null

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex items-start gap-3">
        {/* Elegir con cual se cobra: un solo toque, sin cuadro. */}
        <button
          type="button"
          onClick={onElegir}
          disabled={c.activa || c.deshabilitada}
          aria-label={c.activa ? 'Es la cuenta con la que cobra el local' : 'Cobrar con esta cuenta'}
          className={`mt-1 w-4 h-4 shrink-0 rounded-full border-2 ${
            c.activa ? 'border-neutral-900 bg-neutral-900 ring-2 ring-white ring-inset' : 'border-neutral-300 hover:border-neutral-500'
          } disabled:cursor-default`}
        />
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
                ayuda="Pabilo la prueba con el banco antes de guardarla (0,5 créditos si sirve)."
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
          {!c.activa && !c.deshabilitada && (
            <button type="button" onClick={onElegir} className="text-neutral-600 hover:text-neutral-900 font-medium px-2 py-1">
              Cobrar aquí
            </button>
          )}
          <button type="button" onClick={() => setCambiandoClave((v) => !v)} className="text-neutral-500 hover:text-neutral-900 px-2 py-1">
            Clave
          </button>
          <button type="button" onClick={onAlternar} className="text-neutral-500 hover:text-neutral-900 px-2 py-1">
            {c.deshabilitada ? 'Reanudar' : 'Pausar'}
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
  VE_BAN: 'Banco de Venezuela',
  VE_BAN_EMP_V2: 'Banco de Venezuela (empresas)',
  MERCANTIL_EMP_V1: 'Mercantil (empresas)',
  VE_BANESCO_V1: 'Banesco (empresas)',
  VE_BANK_PLAZA_V1: 'Banco Plaza (empresas)',
  BINANCE_APP: 'Binance Pay',
  BANK_TEST: 'Banco de prueba',
  NOTIFICATION_ACCOUNT: 'Notificaciones de Pabilo',
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
      onError(err instanceof Error ? err.message : 'Pabilo no pudo conectar la cuenta.')
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
            {o.prueba ? ' · solo pruebas' : ''}
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
          Las credenciales viajan una sola vez a Pabilo, que las guarda cifradas. Aquí no se guardan.
        </span>
      </div>
    </form>
  )
}
