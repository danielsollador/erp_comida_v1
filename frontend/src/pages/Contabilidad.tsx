import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import { api } from '../lib/api'
import type {
  AsientoContable,
  BalanceGeneral,
  CuentaContable,
  EstadoResultadosContable,
  FilaBalanceComprobacion,
  FilaMayor,
  Periodo,
} from '../lib/types'

const TABS = [
  { id: 'plan', texto: 'Plan de cuentas' },
  { id: 'diario', texto: 'Diario' },
  { id: 'comprobacion', texto: 'Balance de comprobacion' },
  { id: 'resultados', texto: 'Estado de resultados' },
  { id: 'general', texto: 'Balance general' },
] as const

type Tab = (typeof TABS)[number]['id']

export default function Contabilidad() {
  const [tab, setTab] = useState<Tab>('plan')

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Contabilidad" />
      <div className="sticky top-[57px] z-10 bg-neutral-50/95 backdrop-blur border-b border-neutral-200 px-4 py-2 flex gap-2 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold border transition ${
              tab === t.id
                ? 'bg-neutral-900 border-neutral-900 text-white'
                : 'bg-white border-neutral-200 text-neutral-500'
            }`}
          >
            {t.texto}
          </button>
        ))}
      </div>
      <div className="p-4 max-w-4xl mx-auto">
        {tab === 'plan' && <PlanCuentas />}
        {tab === 'diario' && <Diario />}
        {tab === 'comprobacion' && <BalanceComprobacion />}
        {tab === 'resultados' && <EstadoResultados />}
        {tab === 'general' && <BalanceGeneralVista />}
      </div>
    </div>
  )
}

const TIPO_LABEL: Record<string, string> = {
  activo: 'Activo',
  pasivo: 'Pasivo',
  patrimonio: 'Patrimonio',
  ingreso: 'Ingreso',
  costo: 'Costo',
  gasto: 'Gasto',
}

function PlanCuentas() {
  const [cuentas, setCuentas] = useState<CuentaContable[]>([])
  const [mayor, setMayor] = useState<{ cuenta: CuentaContable; filas: FilaMayor[] } | null>(null)
  const [nuevoCodigo, setNuevoCodigo] = useState('')
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoTipo, setNuevoTipo] = useState('gasto')
  const [error, setError] = useState('')

  useEffect(() => {
    cargar()
  }, [])

  function cargar() {
    api.planCuentas().then(setCuentas)
  }

  async function verMayor(cuenta: CuentaContable) {
    const filas = await api.libroMayor(cuenta.id)
    setMayor({ cuenta, filas })
  }

  async function agregarCuenta() {
    setError('')
    if (!nuevoCodigo.trim() || !nuevoNombre.trim()) return
    const naturaleza = nuevoTipo === 'activo' || nuevoTipo === 'costo' || nuevoTipo === 'gasto' ? 'deudora' : 'acreedora'
    try {
      await api.crearCuenta({
        codigo: nuevoCodigo.trim(),
        nombre: nuevoNombre.trim(),
        tipo: nuevoTipo as CuentaContable['tipo'],
        naturaleza,
        activa: true,
      })
      setNuevoCodigo('')
      setNuevoNombre('')
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la cuenta')
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
            <tr>
              <th className="text-left p-3">Codigo</th>
              <th className="text-left p-3">Nombre</th>
              <th className="text-left p-3">Tipo</th>
              <th className="text-left p-3">Naturaleza</th>
            </tr>
          </thead>
          <tbody>
            {cuentas.map((c) => (
              <tr
                key={c.id}
                onClick={() => verMayor(c)}
                className="border-t border-neutral-100 cursor-pointer hover:bg-neutral-50"
              >
                <td className="p-3 font-mono text-xs">{c.codigo}</td>
                <td className="p-3 font-medium">{c.nombre}</td>
                <td className="p-3 text-neutral-500">{TIPO_LABEL[c.tipo] ?? c.tipo}</td>
                <td className="p-3 text-neutral-500">{c.naturaleza}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200 p-4">
        <h2 className="font-semibold mb-2">Agregar cuenta</h2>
        {error && <p className="text-red-600 text-sm mb-2">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <input
            value={nuevoCodigo}
            onChange={(e) => setNuevoCodigo(e.target.value)}
            placeholder="Codigo (ej. 6030)"
            className="w-32 border border-neutral-300 rounded-lg px-3 py-2 text-sm"
          />
          <input
            value={nuevoNombre}
            onChange={(e) => setNuevoNombre(e.target.value)}
            placeholder="Nombre de la cuenta"
            className="flex-1 min-w-[180px] border border-neutral-300 rounded-lg px-3 py-2 text-sm"
          />
          <select
            value={nuevoTipo}
            onChange={(e) => setNuevoTipo(e.target.value)}
            className="border border-neutral-300 rounded-lg px-2 py-2 text-sm"
          >
            {Object.entries(TIPO_LABEL).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
          <button
            onClick={agregarCuenta}
            className="bg-neutral-900 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Agregar
          </button>
        </div>
      </div>

      {mayor && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-semibold">
              Libro mayor: {mayor.cuenta.codigo} - {mayor.cuenta.nombre}
            </h2>
            <button onClick={() => setMayor(null)} className="text-neutral-400 text-sm">
              cerrar
            </button>
          </div>
          <table className="w-full text-sm">
            <thead className="text-neutral-500 text-xs uppercase">
              <tr>
                <th className="text-left py-1">Fecha</th>
                <th className="text-left py-1">Descripcion</th>
                <th className="text-right py-1">Debe</th>
                <th className="text-right py-1">Haber</th>
                <th className="text-right py-1">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {mayor.filas.map((f, i) => (
                <tr key={i} className="border-t border-neutral-100">
                  <td className="py-1">{new Date(f.fecha).toLocaleDateString('es-VE')}</td>
                  <td className="py-1">{f.descripcion}</td>
                  <td className="text-right py-1 tabular-nums">{f.debe ? f.debe.toFixed(2) : ''}</td>
                  <td className="text-right py-1 tabular-nums">{f.haber ? f.haber.toFixed(2) : ''}</td>
                  <td className="text-right py-1 tabular-nums font-medium">{f.saldo.toFixed(2)}</td>
                </tr>
              ))}
              {mayor.filas.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-neutral-400 py-3 text-center">
                    Esta cuenta no tiene movimientos todavia.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Diario() {
  const [asientos, setAsientos] = useState<AsientoContable[]>([])
  const [cuentas, setCuentas] = useState<CuentaContable[]>([])
  const [error, setError] = useState('')
  const [nuevaDescripcion, setNuevaDescripcion] = useState('')
  const [lineas, setLineas] = useState([
    { cuenta_id: 0, debe: '', haber: '' },
    { cuenta_id: 0, debe: '', haber: '' },
  ])

  useEffect(() => {
    cargar()
    api.planCuentas().then(setCuentas)
  }, [])

  function cargar() {
    api.listarAsientos().then(setAsientos)
  }

  function actualizarLinea(i: number, campo: 'cuenta_id' | 'debe' | 'haber', valor: string) {
    setLineas((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, [campo]: campo === 'cuenta_id' ? Number(valor) : valor } : l)),
    )
  }

  async function guardarAsiento() {
    setError('')
    const cuerpo = lineas
      .filter((l) => l.cuenta_id)
      .map((l) => ({ cuenta_id: l.cuenta_id, debe: Number(l.debe) || 0, haber: Number(l.haber) || 0 }))
    if (!nuevaDescripcion.trim() || cuerpo.length < 2) return
    try {
      await api.crearAsiento(nuevaDescripcion.trim(), cuerpo)
      setNuevaDescripcion('')
      setLineas([
        { cuenta_id: 0, debe: '', haber: '' },
        { cuenta_id: 0, debe: '', haber: '' },
      ])
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear el asiento')
    }
  }

  async function borrar(id: number) {
    setError('')
    try {
      await api.eliminarAsiento(id)
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo borrar')
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-neutral-200 p-4">
        <h2 className="font-semibold mb-2">Nuevo asiento manual</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Los que genera el sistema solo (ventas, gastos, compras, merma) no aparecen aqui para
          crear - solo para consultar. Este formulario es para lo que no encaja en ningun flujo,
          por ejemplo un aporte de capital.
        </p>
        {error && <p className="text-red-600 text-sm mb-2">{error}</p>}
        <input
          value={nuevaDescripcion}
          onChange={(e) => setNuevaDescripcion(e.target.value)}
          placeholder="Descripcion del asiento"
          className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mb-2"
        />
        {lineas.map((l, i) => (
          <div key={i} className="flex gap-2 mb-2">
            <select
              value={l.cuenta_id}
              onChange={(e) => actualizarLinea(i, 'cuenta_id', e.target.value)}
              className="flex-1 border border-neutral-300 rounded-lg px-2 py-2 text-sm"
            >
              <option value={0}>Selecciona cuenta...</option>
              {cuentas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.codigo} - {c.nombre}
                </option>
              ))}
            </select>
            <input
              value={l.debe}
              onChange={(e) => actualizarLinea(i, 'debe', e.target.value)}
              placeholder="Debe"
              type="number"
              step="0.01"
              className="w-24 border border-neutral-300 rounded-lg px-2 py-2 text-sm"
            />
            <input
              value={l.haber}
              onChange={(e) => actualizarLinea(i, 'haber', e.target.value)}
              placeholder="Haber"
              type="number"
              step="0.01"
              className="w-24 border border-neutral-300 rounded-lg px-2 py-2 text-sm"
            />
          </div>
        ))}
        <div className="flex gap-2">
          <button
            onClick={() => setLineas((prev) => [...prev, { cuenta_id: 0, debe: '', haber: '' }])}
            className="text-sm text-neutral-500"
          >
            + linea
          </button>
          <button
            onClick={guardarAsiento}
            className="ml-auto bg-neutral-900 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Guardar asiento
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
            <tr>
              <th className="text-left p-3">Fecha</th>
              <th className="text-left p-3">Descripcion</th>
              <th className="text-left p-3">Origen</th>
              <th className="text-left p-3">Movimientos</th>
              <th className="p-3" />
            </tr>
          </thead>
          <tbody>
            {asientos.map((a) => (
              <tr key={a.id} className="border-t border-neutral-100 align-top">
                <td className="p-3 whitespace-nowrap">{new Date(a.fecha).toLocaleDateString('es-VE')}</td>
                <td className="p-3 font-medium">{a.descripcion}</td>
                <td className="p-3 text-neutral-500 capitalize">{a.origen}</td>
                <td className="p-3">
                  {a.movimientos.map((m) => (
                    <div key={m.id} className="text-xs text-neutral-600">
                      {m.cuenta_codigo} {m.cuenta_nombre}:{' '}
                      {m.debe ? `Debe $${m.debe.toFixed(2)}` : `Haber $${m.haber.toFixed(2)}`}
                    </div>
                  ))}
                </td>
                <td className="p-3">
                  {a.origen === 'manual' && (
                    <button onClick={() => borrar(a.id)} className="text-red-500 text-xs">
                      Borrar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TablaCuentas({ filas }: { filas: FilaBalanceComprobacion[] }) {
  const totalDebe = filas.reduce((s, f) => s + f.debe, 0)
  const totalHaber = filas.reduce((s, f) => s + f.haber, 0)
  return (
    <table className="w-full text-sm">
      <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
        <tr>
          <th className="text-left p-3">Cuenta</th>
          <th className="text-right p-3">Debe</th>
          <th className="text-right p-3">Haber</th>
          <th className="text-right p-3">Saldo</th>
        </tr>
      </thead>
      <tbody>
        {filas.map((f) => (
          <tr key={f.cuenta_id} className="border-t border-neutral-100">
            <td className="p-3">
              <span className="font-mono text-xs text-neutral-400 mr-2">{f.codigo}</span>
              {f.nombre}
            </td>
            <td className="text-right p-3 tabular-nums">{f.debe.toFixed(2)}</td>
            <td className="text-right p-3 tabular-nums">{f.haber.toFixed(2)}</td>
            <td className="text-right p-3 tabular-nums font-semibold">{f.saldo.toFixed(2)}</td>
          </tr>
        ))}
        <tr className="border-t-2 border-neutral-300 font-bold">
          <td className="p-3">Total</td>
          <td className="text-right p-3 tabular-nums">{totalDebe.toFixed(2)}</td>
          <td className="text-right p-3 tabular-nums">{totalHaber.toFixed(2)}</td>
          <td className="p-3" />
        </tr>
      </tbody>
    </table>
  )
}

function BalanceComprobacion() {
  const [filas, setFilas] = useState<FilaBalanceComprobacion[]>([])

  useEffect(() => {
    api.balanceComprobacion().then(setFilas)
  }, [])

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
      <TablaCuentas filas={filas} />
    </div>
  )
}

const PERIODOS: { valor: Periodo; texto: string }[] = [
  { valor: 'dia', texto: 'Hoy' },
  { valor: 'semana', texto: 'Esta semana' },
  { valor: 'mes', texto: 'Este mes' },
]

function EstadoResultados() {
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [datos, setDatos] = useState<EstadoResultadosContable | null>(null)

  useEffect(() => {
    api.estadoResultadosContable(periodo).then(setDatos)
  }, [periodo])

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {PERIODOS.map((p) => (
          <button
            key={p.valor}
            onClick={() => setPeriodo(p.valor)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border ${
              periodo === p.valor ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white border-neutral-200'
            }`}
          >
            {p.texto}
          </button>
        ))}
      </div>
      {datos && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-4">
          <p className="text-sm text-neutral-500 mb-3 capitalize">{datos.etiqueta}</p>
          <Linea etiqueta="Ingresos por ventas" monto={datos.ingresos} />
          <Linea etiqueta="Costo de ventas" monto={-datos.costos} />
          <Linea etiqueta="Utilidad bruta" monto={datos.utilidad_bruta} subtotal />
          <Linea etiqueta="Gastos operativos" monto={-datos.gastos} />
          <Linea etiqueta="Utilidad neta" monto={datos.utilidad_neta} total />
        </div>
      )}
    </div>
  )
}

function Linea({
  etiqueta,
  monto,
  subtotal = false,
  total = false,
}: {
  etiqueta: string
  monto: number
  subtotal?: boolean
  total?: boolean
}) {
  return (
    <div
      className={`flex justify-between py-1.5 ${
        subtotal || total ? 'border-t border-neutral-200 mt-1 pt-2' : ''
      } ${total ? 'font-bold text-base' : subtotal ? 'font-semibold' : 'text-sm'}`}
    >
      <span>{etiqueta}</span>
      <span
        className={`tabular-nums ${total ? (monto < 0 ? 'text-red-600' : 'text-emerald-600') : ''}`}
      >
        {monto < 0 ? '-' : ''}${Math.abs(monto).toFixed(2)}
      </span>
    </div>
  )
}

function BalanceGeneralVista() {
  const [datos, setDatos] = useState<BalanceGeneral | null>(null)

  useEffect(() => {
    api.balanceGeneral().then(setDatos)
  }, [])

  if (!datos) return null

  return (
    <div className="space-y-4">
      <div
        className={`rounded-2xl p-4 text-sm font-medium ${
          datos.cuadra ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'
        }`}
      >
        {datos.cuadra
          ? 'Activos = Pasivos + Patrimonio. Los libros cuadran.'
          : 'Los libros no cuadran - revisa los asientos manuales.'}
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200 p-4">
        <h2 className="font-semibold mb-2">Activos</h2>
        <TablaCuentas filas={datos.activos} />
        <div className="flex justify-between mt-2 font-bold">
          <span>Total activos</span>
          <span className="tabular-nums">${datos.total_activos.toFixed(2)}</span>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200 p-4">
        <h2 className="font-semibold mb-2">Pasivos</h2>
        {datos.pasivos.length > 0 ? <TablaCuentas filas={datos.pasivos} /> : (
          <p className="text-neutral-400 text-sm">Sin deudas registradas.</p>
        )}
        <div className="flex justify-between mt-2 font-bold">
          <span>Total pasivos</span>
          <span className="tabular-nums">${datos.total_pasivos.toFixed(2)}</span>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200 p-4">
        <h2 className="font-semibold mb-2">Patrimonio</h2>
        {datos.patrimonio.length > 0 && <TablaCuentas filas={datos.patrimonio} />}
        <div className="flex justify-between mt-2 text-sm text-neutral-600">
          <span>Utilidad acumulada (no distribuida)</span>
          <span className="tabular-nums">${datos.utilidad_acumulada.toFixed(2)}</span>
        </div>
        <div className="flex justify-between mt-1 font-bold">
          <span>Total patrimonio</span>
          <span className="tabular-nums">${datos.total_patrimonio.toFixed(2)}</span>
        </div>
      </div>
    </div>
  )
}
