import { useEffect, useMemo, useState } from 'react'
import NavBar from '../components/NavBar'
import { useSeccion } from '../components/Secciones'
import { useDialogo } from '../components/dialogo'
import { Aviso, Boton, Campo, Cifra, Modal, Pagina, Pastilla, Seccion, Selector, Vacio } from '../components/ui'
import { api } from '../lib/api'
import { fmtNum } from '../lib/moneda'
import { METODOS_PAGO, necesitaReferencia } from '../lib/pagos'
import type { ClienteConSaldo, ClienteCredito, CobroCliente, EstadoDeCuenta, ResumenCxC, TipoCliente, VentaPorCobrar } from '../lib/types'

/**
 * Cuentas por cobrar: lo que se vendió a crédito y falta cobrar.
 *
 * La venta a crédito nace en el punto de venta (el pago "A crédito"). Aquí se
 * ve quién debe, desde cuándo, y se cobra. Lo que esta pantalla agrega sobre
 * el cobro de a uno de Ventas es el COBRO AGRUPADO: PedidosYa paga la semana
 * de una vez y ya restada su comisión, así que se marcan las ventas, se pone
 * lo que entró al banco y la diferencia queda como comisión (un gasto), no
 * como una deuda que nunca se termina de pagar.
 */
const SECCIONES = [
  { id: 'deben', texto: 'Quién me debe' },
  { id: 'cobros', texto: 'Cobros hechos' },
]

const TIPOS: { id: TipoCliente; texto: string }[] = [
  { id: 'plataforma', texto: 'Plataforma de delivery' },
  { id: 'empresa', texto: 'Empresa' },
  { id: 'persona', texto: 'Persona' },
]

function dinero(n: number) {
  return `${n < 0 ? '−' : ''}$${fmtNum(Math.abs(n))}`
}

function fecha(s: string) {
  return new Date(s).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export default function CuentasPorCobrar() {
  const [seccion, irA] = useSeccion(SECCIONES)
  const [resumen, setResumen] = useState<ResumenCxC | null>(null)
  const [cobros, setCobros] = useState<CobroCliente[]>([])
  const [abierto, setAbierto] = useState<number | null>(null)
  const [ficha, setFicha] = useState<Partial<ClienteCredito> | null>(null)
  const [error, setError] = useState('')

  function cargar() {
    setError('')
    api.resumenCxC().then(setResumen).catch((e) => setError(e.message))
    api.listarCobrosClientes().then(setCobros).catch(() => setCobros([]))
  }
  useEffect(cargar, [])

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Cuentas por cobrar" secciones={SECCIONES} seccion={seccion} alCambiarSeccion={irA} />
      <Pagina ancho="media">
        {error && <Aviso>{error}</Aviso>}

        {seccion === 'deben' && resumen && abierto == null && (
          <QuienDebe
            r={resumen}
            alAbrir={setAbierto}
            alNuevo={() => setFicha({ tipo: 'plataforma', comision_pct: 0, dias_credito: 7 })}
            alCambiar={cargar}
          />
        )}
        {seccion === 'deben' && abierto != null && (
          <Detalle
            clienteId={abierto}
            alVolver={() => {
              setAbierto(null)
              cargar()
            }}
            alEditar={setFicha}
          />
        )}
        {seccion === 'cobros' && <Cobros cobros={cobros} alCambiar={cargar} />}
      </Pagina>

      {ficha && (
        <FichaCliente
          inicial={ficha}
          alCerrar={() => setFicha(null)}
          alGuardar={() => {
            setFicha(null)
            cargar()
            if (abierto != null) setAbierto(abierto)
          }}
        />
      )}
    </div>
  )
}

function QuienDebe({
  r,
  alAbrir,
  alNuevo,
  alCambiar,
}: {
  r: ResumenCxC
  alAbrir: (id: number) => void
  alNuevo: () => void
  alCambiar: () => void
}) {
  const conDeuda = r.clientes.filter((c) => c.saldo > 0)
  const sinDeuda = r.clientes.filter((c) => c.saldo <= 0)
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Cifra titulo="Por cobrar" valor={dinero(r.total)} detalle="todo lo vendido a crédito que falta" />
        <Cifra
          titulo="Vencido"
          valor={dinero(r.vencido)}
          detalle="pasó el plazo del cliente"
          tono={r.vencido > 0 ? 'alerta' : 'normal'}
        />
        <Cifra titulo="Clientes que deben" valor={String(conDeuda.length + (r.sin_ficha.length ? 1 : 0))} />
      </div>

      <Seccion
        titulo="Clientes"
        ayuda="Toca uno para ver lo que debe, su estado de cuenta y cobrarle."
        accion={
          <Boton tono="suave" icono="mas" onClick={alNuevo}>
            Nuevo cliente
          </Boton>
        }
        plano
      >
        {r.clientes.length === 0 ? (
          <Vacio
            icono="cobrar"
            titulo="Todavía no hay clientes a crédito"
            detalle="Crea a PedidosYa (o a la empresa que te paga después) y las ventas a crédito a ese nombre entran solas en su cuenta."
          />
        ) : (
          <ul className="divide-y divide-neutral-100">
            {[...conDeuda, ...sinDeuda].map((c) => (
              <FilaCliente key={c.id} c={c} alAbrir={() => alAbrir(c.id)} />
            ))}
          </ul>
        )}
      </Seccion>

      {r.sin_ficha.length > 0 && <SinFicha ventas={r.sin_ficha} clientes={r.clientes} alCambiar={alCambiar} />}
    </>
  )
}

function FilaCliente({ c, alAbrir }: { c: ClienteConSaldo; alAbrir: () => void }) {
  return (
    <li>
      <button onClick={alAbrir} className="w-full text-left px-4 sm:px-5 py-3 flex items-center gap-3 hover:bg-neutral-50">
        <span className="min-w-0 flex-1">
          <span className="font-medium">{c.nombre}</span>{' '}
          {c.tipo === 'plataforma' && <Pastilla tono="acento">delivery</Pastilla>}
          {!c.activo && <Pastilla>inactivo</Pastilla>}
          <span className="block text-xs text-neutral-500">
            {c.ventas > 0
              ? `${c.ventas} venta(s) · la más vieja de hace ${c.mas_vieja_dias} día(s)`
              : 'No debe nada'}
            {c.dias_credito > 0 && ` · plazo ${c.dias_credito} días`}
          </span>
        </span>
        {c.vencido > 0 && <Pastilla tono="ojo">vencido {dinero(c.vencido)}</Pastilla>}
        <span className={`font-semibold tabular-nums ${c.saldo > 0 ? '' : 'text-neutral-400'}`}>{dinero(c.saldo)}</span>
      </button>
    </li>
  )
}

/** Fiados hechos con un nombre que no es de ninguna ficha. */
function SinFicha({ ventas, clientes, alCambiar }: { ventas: VentaPorCobrar[]; clientes: ClienteConSaldo[]; alCambiar: () => void }) {
  const [error, setError] = useState('')
  async function asignar(v: VentaPorCobrar, id: string) {
    if (!id) return
    try {
      await api.asignarClienteAVenta(v.pedido_id, Number(id))
      alCambiar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo asignar')
    }
  }
  return (
    <Seccion
      titulo="A crédito sin ficha"
      ayuda="Se fiaron con un nombre escrito a mano. Si son de un cliente, asígnalos para que entren en su cuenta; si no, se cobran igual desde Ventas."
      plano
    >
      {error && <div className="px-4 pt-3"><Aviso>{error}</Aviso></div>}
      <ul className="divide-y divide-neutral-100">
        {ventas.map((v) => (
          <li key={v.pedido_id} className="px-4 sm:px-5 py-3 flex flex-wrap items-center gap-3 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{v.cliente}</span>
              <span className="block text-xs text-neutral-500">
                Venta #{v.numero} · {fecha(v.fecha)} · hace {v.dias} día(s)
              </span>
            </span>
            <span className="font-semibold tabular-nums">{dinero(v.saldo)}</span>
            {clientes.length > 0 && (
              <select
                defaultValue=""
                onChange={(e) => void asignar(v, e.target.value)}
                className="border border-neutral-300 rounded-lg px-2 py-1.5 text-sm"
                aria-label={`Asignar la venta #${v.numero} a un cliente`}
              >
                <option value="">Asignar a…</option>
                {clientes.filter((c) => c.activo).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            )}
          </li>
        ))}
      </ul>
    </Seccion>
  )
}

/** Un cliente: lo que debe, el cobro agrupado y su estado de cuenta. */
function Detalle({
  clienteId,
  alVolver,
  alEditar,
}: {
  clienteId: number
  alVolver: () => void
  alEditar: (c: ClienteCredito) => void
}) {
  const [estado, setEstado] = useState<EstadoDeCuenta | null>(null)
  const [marcadas, setMarcadas] = useState<Set<number>>(new Set())
  const [metodo, setMetodo] = useState('Transferencia')
  const [referencia, setReferencia] = useState('')
  const [entro, setEntro] = useState('')
  const [nota, setNota] = useState('')
  const [error, setError] = useState('')
  const [hecho, setHecho] = useState('')
  const [enviando, setEnviando] = useState(false)

  function cargar() {
    api
      .estadoDeCuenta(clienteId)
      .then((e) => {
        setEstado(e)
        // Lo comun es cobrar todo lo pendiente: se arranca con todo marcado.
        setMarcadas(new Set(e.pendientes.map((p) => p.pedido_id)))
      })
      .catch((e) => setError(e.message))
  }
  useEffect(cargar, [clienteId])

  const total = useMemo(
    () => Math.round((estado?.pendientes.filter((p) => marcadas.has(p.pedido_id)).reduce((s, p) => s + p.saldo, 0) ?? 0) * 100) / 100,
    [estado, marcadas],
  )
  const pct = estado?.cliente.comision_pct ?? 0
  // Lo que se espera que entre, con la comision pactada. Se puede cambiar:
  // lo que manda es lo que de verdad llego al banco.
  const sugerido = Math.round(total * (1 - pct / 100) * 100) / 100
  const recibido = entro.trim() === '' ? sugerido : Number(entro.replace(',', '.'))
  const comision = Math.round((total - recibido) * 100) / 100

  if (!estado) return error ? <Aviso>{error}</Aviso> : null
  const c = estado.cliente

  function alternar(id: number) {
    const n = new Set(marcadas)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    setMarcadas(n)
    setEntro('')
  }

  async function cobrar() {
    setError('')
    setHecho('')
    if (!Number.isFinite(recibido) || recibido <= 0) return setError('Pon cuánto entró.')
    if (comision < 0) return setError(`Entró más de lo que se debe (${dinero(total)}). Revisa el monto o marca más ventas.`)
    if (necesitaReferencia(metodo) && !referencia.trim()) return setError(`Un cobro por ${metodo} necesita su referencia.`)
    setEnviando(true)
    try {
      const r = await api.cobrarVentas({
        cliente_id: c.id,
        pedido_ids: [...marcadas],
        metodo_pago: metodo,
        referencia: referencia.trim(),
        comision,
        nota: nota.trim(),
      })
      setHecho(
        `Cobradas ${r.ventas.length} venta(s): entró ${dinero(r.recibido)}` +
          (r.comision ? ` y ${dinero(r.comision)} quedó como comisión.` : '.'),
      )
      setReferencia('')
      setEntro('')
      setNota('')
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cobrar')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Boton tono="fantasma" icono="atras" onClick={alVolver}>
          Clientes
        </Boton>
        <h1 className="font-display text-xl font-semibold tracking-tight flex-1 min-w-0">{c.nombre}</h1>
        <Boton tono="suave" onClick={() => alEditar(c)}>
          Editar ficha
        </Boton>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Cifra titulo="Debe" valor={dinero(estado.saldo)} detalle={`${estado.pendientes.length} venta(s)`} />
        <Cifra titulo="Comisión pactada" valor={`${fmtNum(pct, pct % 1 ? 1 : 0)} %`} detalle="se resta al cobrar" />
        <Cifra titulo="Plazo" valor={c.dias_credito ? `${c.dias_credito} días` : 'Sin plazo'} />
      </div>

      {hecho && <Aviso tono="bien">{hecho}</Aviso>}

      {estado.pendientes.length > 0 && (
        <Seccion titulo="Cobrar" ayuda="Marca las ventas que te están pagando y pon lo que entró de verdad." plano>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-neutral-500 border-b border-neutral-100">
                  <th className="px-4 py-2 w-8">
                    <input
                      type="checkbox"
                      aria-label="Marcar todas"
                      checked={marcadas.size === estado.pendientes.length}
                      onChange={(e) => {
                        setMarcadas(new Set(e.target.checked ? estado.pendientes.map((p) => p.pedido_id) : []))
                        setEntro('')
                      }}
                    />
                  </th>
                  <th className="py-2">Venta</th>
                  <th className="py-2">Fecha</th>
                  <th className="py-2 text-right pr-4">Debe</th>
                </tr>
              </thead>
              <tbody>
                {estado.pendientes.map((p) => (
                  <tr key={p.pedido_id} className="border-b border-neutral-50">
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Cobrar la venta #${p.numero}`}
                        checked={marcadas.has(p.pedido_id)}
                        onChange={() => alternar(p.pedido_id)}
                      />
                    </td>
                    <td className="py-2">
                      #{p.numero}
                      {p.numero_factura && <span className="text-xs text-neutral-500"> · fact. {p.numero_factura}</span>}
                      {p.abonado > 0 && <span className="text-xs text-neutral-500"> · abonó {dinero(p.abonado)}</span>}
                    </td>
                    <td className="py-2 tabular-nums">
                      {fecha(p.fecha)} {p.vencida && <Pastilla tono="ojo">vencida</Pastilla>}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{dinero(p.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="p-4 sm:p-5 grid gap-3 sm:grid-cols-2 border-t border-neutral-100">
            <Selector etiqueta="Cómo pagó" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
              {METODOS_PAGO.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Selector>
            {necesitaReferencia(metodo) ? (
              <Campo etiqueta="Referencia" value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Número del depósito" />
            ) : (
              <div />
            )}
            <Campo
              etiqueta="Lo que entró ($)"
              inputMode="decimal"
              value={entro}
              placeholder={fmtNum(sugerido)}
              onChange={(e) => setEntro(e.target.value)}
              ayuda={pct ? `Con ${fmtNum(pct, 1)} % de comisión deberían entrar ${dinero(sugerido)}.` : undefined}
            />
            <Campo etiqueta="Nota (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej. semana del 19 al 25" />
          </div>
          <div className="px-4 sm:px-5 pb-4 sm:pb-5 space-y-3">
            <div className="text-sm grid grid-cols-3 gap-2 tabular-nums">
              <span>
                Se debía <strong className="block text-base">{dinero(total)}</strong>
              </span>
              <span>
                Entra <strong className="block text-base">{Number.isFinite(recibido) ? dinero(recibido) : '—'}</strong>
              </span>
              <span className={comision < 0 ? 'text-peligro-600' : ''}>
                Comisión <strong className="block text-base">{Number.isFinite(comision) ? dinero(comision) : '—'}</strong>
              </span>
            </div>
            {error && <Aviso>{error}</Aviso>}
            <Boton ancho onClick={() => void cobrar()} disabled={enviando || marcadas.size === 0}>
              Cobrar {marcadas.size} venta(s)
            </Boton>
          </div>
        </Seccion>
      )}

      <Seccion titulo="Estado de cuenta" ayuda="Lo que se le vendió a crédito y lo que ha pagado, con el saldo de cada momento." plano>
        {estado.movimientos.length === 0 ? (
          <Vacio titulo="Sin movimientos" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-neutral-500 border-b border-neutral-100">
                  <th className="px-4 py-2">Fecha</th>
                  <th className="py-2">Detalle</th>
                  <th className="py-2 text-right">Cargo</th>
                  <th className="py-2 text-right">Pago</th>
                  <th className="py-2 pr-4 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {estado.movimientos.map((m, i) => (
                  <tr key={i} className="border-b border-neutral-50">
                    <td className="px-4 py-2 tabular-nums">{fecha(m.fecha)}</td>
                    <td className="py-2">{m.detalle}</td>
                    <td className="py-2 text-right tabular-nums">{m.cargo ? dinero(m.cargo) : ''}</td>
                    <td className="py-2 text-right tabular-nums">{m.abono ? dinero(m.abono) : ''}</td>
                    <td className="py-2 pr-4 text-right tabular-nums font-medium">{dinero(m.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Seccion>
    </>
  )
}

function Cobros({ cobros, alCambiar }: { cobros: CobroCliente[]; alCambiar: () => void }) {
  const dialogo = useDialogo()
  const [error, setError] = useState('')
  async function anular(c: CobroCliente) {
    const ok = await dialogo.confirmar({
      titulo: 'Anular este cobro',
      texto: `Las ${c.ventas.length} venta(s) vuelven a deberse y el asiento se reversa. Úsalo solo si el cobro se anotó mal.`,
      aceptar: 'Anular cobro',
      peligro: true,
    })
    if (!ok) return
    try {
      await api.anularCobroCliente(c.id)
      alCambiar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo anular')
    }
  }
  return (
    <Seccion titulo="Cobros hechos" ayuda="Los cobros agrupados. Los abonos sueltos de una sola venta se ven en Ventas." plano>
      {error && <div className="px-4 pt-3"><Aviso>{error}</Aviso></div>}
      {cobros.length === 0 ? (
        <Vacio icono="cobrar" titulo="Todavía no hay cobros" />
      ) : (
        <ul className="divide-y divide-neutral-100">
          {cobros.map((c) => (
            <li key={c.id} className={`px-4 sm:px-5 py-3 flex flex-wrap items-center gap-3 text-sm ${c.anulado ? 'opacity-50' : ''}`}>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{c.cliente || 'Sin ficha'}</span> {c.anulado && <Pastilla tono="mal">anulado</Pastilla>}
                <span className="block text-xs text-neutral-500">
                  {fecha(c.fecha)} · {c.metodo_pago}
                  {c.referencia && ` ref. ${c.referencia}`} · {c.ventas.length || '—'} venta(s)
                  {c.comision > 0 && ` · comisión ${dinero(c.comision)}`}
                  {c.nota && ` · ${c.nota}`}
                </span>
              </span>
              <span className="text-right tabular-nums">
                <strong>{dinero(c.recibido)}</strong>
                <span className="block text-xs text-neutral-500">de {dinero(c.monto)}</span>
              </span>
              {!c.anulado && (
                <button onClick={() => void anular(c)} className="text-xs underline text-neutral-500 hover:text-peligro-600">
                  Anular
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Seccion>
  )
}

function FichaCliente({
  inicial,
  alCerrar,
  alGuardar,
}: {
  inicial: Partial<ClienteCredito>
  alCerrar: () => void
  alGuardar: () => void
}) {
  const [c, setC] = useState({
    nombre: '',
    tipo: 'persona' as TipoCliente,
    rif: '',
    telefono: '',
    comision_pct: 0,
    dias_credito: 0,
    nota: '',
    activo: true,
    ...inicial,
  })
  const [error, setError] = useState('')
  const poner = (k: keyof typeof c, v: unknown) => setC({ ...c, [k]: v })

  async function guardar() {
    setError('')
    if (!c.nombre.trim()) return setError('Ponle un nombre.')
    try {
      const { id, ...datos } = c as typeof c & { id?: number }
      await api.guardarClienteCredito(datos, id)
      alGuardar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    }
  }

  return (
    <Modal
      titulo={'id' in inicial ? 'Editar cliente' : 'Nuevo cliente a crédito'}
      ayuda="Las ventas a crédito con este nombre entran solas en su cuenta, aunque se escriba distinto (PedidosYa, Pedidos ya)."
      onCerrar={alCerrar}
      pie={
        <Boton ancho onClick={() => void guardar()}>
          Guardar
        </Boton>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Nombre" value={c.nombre} onChange={(e) => poner('nombre', e.target.value)} placeholder="Ej. PedidosYa" className="sm:col-span-2" />
        <Selector etiqueta="Tipo" value={c.tipo} onChange={(e) => poner('tipo', e.target.value)}>
          {TIPOS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.texto}
            </option>
          ))}
        </Selector>
        <Campo etiqueta="RIF o cédula" value={c.rif} onChange={(e) => poner('rif', e.target.value)} />
        <Campo
          etiqueta="Comisión (%)"
          inputMode="decimal"
          value={String(c.comision_pct)}
          onChange={(e) => poner('comision_pct', Number(e.target.value.replace(',', '.')) || 0)}
          ayuda="Lo que se queda de cada venta. Solo se propone al cobrar."
        />
        <Campo
          etiqueta="Plazo (días)"
          inputMode="numeric"
          value={String(c.dias_credito)}
          onChange={(e) => poner('dias_credito', Number(e.target.value) || 0)}
          ayuda="Pasado el plazo, la deuda sale como vencida. 0 = sin plazo."
        />
        <Campo etiqueta="Teléfono" value={c.telefono} onChange={(e) => poner('telefono', e.target.value)} />
        <Campo etiqueta="Nota" value={c.nota} onChange={(e) => poner('nota', e.target.value)} />
        {'id' in inicial && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={c.activo} onChange={(e) => poner('activo', e.target.checked)} />
            Activo (desmarca si ya no se le vende a crédito)
          </label>
        )}
      </div>
      {error && <div className="mt-3"><Aviso>{error}</Aviso></div>}
    </Modal>
  )
}
