import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import { useSeccion } from '../components/Secciones'
import { FiltroFechas } from '../components/Fechas'
import { useRango, type Rango } from '../lib/fechas'
import { useDialogo } from '../components/dialogo'
import { Tabla, Th, useBuscador, useOrden } from '../components/Tabla'
import { Boton, Campo, Modal, Pagina, Selector } from '../components/ui'
import { Numerico } from '../components/Teclado'
import Respaldos from './partes/Respaldos'
import { api } from '../lib/api'
import type {
  ActivoFijo,
  AsientoContable,
  BalanceGeneral,
  CuentaContable,
  EstadoResultadosContable,
  FilaBalanceComprobacion,
  FilaMayor,
  SaludContable,
} from '../lib/types'

// Los respaldos vivian en el modulo "Sistema", que se quito. Van aqui porque
// este es el modulo de quien administra el negocio, que es justo quien
// restaura el dia que algo se rompe.
const SECCIONES = [
  { id: 'plan', texto: 'Plan de cuentas' },
  { id: 'diario', texto: 'Diario' },
  { id: 'comprobacion', texto: 'Balance de comprobación' },
  { id: 'resultados', texto: 'Estado de resultados' },
  { id: 'general', texto: 'Balance general' },
  { id: 'activos', texto: 'Equipos' },
  { id: 'respaldos', texto: 'Respaldos' },
]

export default function Contabilidad() {
  const [seccion, irA] = useSeccion(SECCIONES)
  // El diario y el estado de resultados son "de un periodo"; el plan, los
  // balances y los equipos son "a hoy": el filtro solo se muestra donde aplica.
  const [rango, setRango] = useRango('mes')
  const conPeriodo = seccion === 'diario' || seccion === 'resultados'
  const [salud, setSalud] = useState<SaludContable | null>(null)

  useEffect(() => {
    api.saludContable().then(setSalud).catch(() => setSalud(null))
  }, [])

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Contabilidad" secciones={SECCIONES} seccion={seccion} alCambiarSeccion={irA} filtro={conPeriodo ? <FiltroFechas rango={rango} alCambiar={setRango} /> : undefined} />
      <Pagina>
        {/* El "cuadra" del balance nunca falla (es una identidad de la partida
            doble). Estos chequeos si pueden fallar, y son los que avisan que
            los libros dejaron de reflejar la realidad. */}
        {salud && !salud.sano && (
          <div className="mb-4 space-y-2">
            {salud.problemas.map((p, i) => (
              <div
                key={i}
                className={`rounded-xl border p-3 ${
                  p.gravedad === 'grave'
                    ? 'bg-peligro-50 border-peligro-200'
                    : 'bg-aviso-50 border-aviso-200'
                }`}
              >
                <p
                  className={`text-sm font-semibold ${
                    p.gravedad === 'grave' ? 'text-peligro-800' : 'text-aviso-800'
                  }`}
                >
                  {p.titulo}
                </p>
                <p
                  className={`text-xs mt-0.5 ${
                    p.gravedad === 'grave' ? 'text-peligro-700' : 'text-aviso-700'
                  }`}
                >
                  {p.detalle}
                </p>
              </div>
            ))}
          </div>
        )}
        {salud?.sano && (
          <div className="mb-4 rounded-xl border border-exito-200 bg-exito-50 px-3 py-2">
            <p className="text-sm text-exito-800">
              Libros sanos: sin movimientos huérfanos, sin activos en negativo, e inventario
              contable acorde a las existencias reales.
            </p>
          </div>
        )}
        {seccion === 'plan' && <PlanCuentas />}
        {seccion === 'diario' && <Diario rango={rango} />}
        {seccion === 'comprobacion' && <BalanceComprobacion />}
        {seccion === 'resultados' && <EstadoResultados rango={rango} />}
        {seccion === 'general' && <BalanceGeneralVista />}
        {seccion === 'activos' && <Activos />}
        {seccion === 'respaldos' && <Respaldos />}
      </Pagina>
    </div>
  )
}

// El `origen` viene en snake_case desde la API; en pantalla se lee en castellano.
const ORIGEN_LABEL: Record<string, string> = {
  manual: 'Manual',
  venta: 'Venta',
  gasto: 'Gasto',
  merma: 'Merma',
  compra_insumo: 'Compra de insumo',
  factura_compra: 'Factura de compra',
  pago_factura: 'Pago a proveedor',
  cierre_caja: 'Cierre de caja',
  apertura: 'Apertura',
  reverso_merma: 'Reverso de merma',
  ajuste_inventario: 'Ajuste de inventario',
  sobrante_inventario: 'Sobrante de inventario',
  reverso_sobrante: 'Reverso de sobrante',
  reverso_cierre_caja: 'Anulación de cierre de caja',
  reverso_baja_activo: 'Anulación de baja de activo',
  reverso_declaracion_iva: 'Anulación de declaración de IVA',
  nota_credito_compra: 'Nota de crédito del proveedor',
  depreciacion: 'Depreciación',
  baja_activo: 'Baja de equipo',
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
  const [creando, setCreando] = useState(false)
  // El plan abre por codigo, que es el orden contable de toda la vida; pero
  // buscar "Gastos" por nombre o agrupar por tipo es un clic.
  const ordenCuentas = useOrden<CuentaContable>(
    {
      codigo: (c) => c.codigo,
      nombre: (c) => c.nombre,
      tipo: (c) => TIPO_LABEL[c.tipo] ?? c.tipo,
      naturaleza: (c) => c.naturaleza,
    },
    'codigo',
  )
  // Por codigo Y por nombre: quien lleva la contabilidad busca "6020", quien
  // no la lleva busca "merma". Las dos tienen que servir.
  const buscador = useBuscador<CuentaContable>(
    (c) => [c.codigo, c.nombre, TIPO_LABEL[c.tipo] ?? c.tipo],
    'Buscar por código o nombre',
  )
  const ordenMayor = useOrden<FilaMayor>(
    {
      fecha: (f) => new Date(f.fecha),
      descripcion: (f) => f.descripcion,
      debe: (f) => f.debe,
      haber: (f) => f.haber,
      saldo: (f) => f.saldo,
    },
    'fecha',
  )

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

  return (
    <div className="space-y-3">
      {/* El boton de crear, ARRIBA. El formulario estaba DEBAJO de la tabla:
          con el plan entero delante, agregar una cuenta pedia bajar
          veinticuatro filas hasta algo que ni se veia al entrar. */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold">Plan de cuentas</h2>
          <p className="text-xs text-neutral-500">Toca una cuenta para ver su libro mayor.</p>
        </div>
        <Boton onClick={() => setCreando(true)}>+ Nueva cuenta</Boton>
      </div>

      <Tabla
        orden={ordenCuentas}
        buscador={buscador}
        glosario="plan"
        className="bg-white rounded-2xl border border-neutral-200 overflow-hidden"
      >
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
            <tr>
              <Th clave="codigo">Código</Th>
              <Th clave="nombre">Nombre</Th>
              <Th clave="tipo">Tipo</Th>
              <Th clave="naturaleza">Naturaleza</Th>
            </tr>
          </thead>
          <tbody>
            {ordenCuentas.ordenar(buscador.filtrar(cuentas)).map((c) => (
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
      </Tabla>

      {creando && (
        <NuevaCuenta
          onCerrar={() => setCreando(false)}
          onCreada={() => {
            setCreando(false)
            cargar()
          }}
        />
      )}

      {/* El libro mayor se abre ENCIMA, no debajo. Antes se renderizaba al
          final del contenedor: con el plan entero y el formulario en medio,
          tocar una cuenta parecia no hacer nada hasta que uno bajaba. */}
      {mayor && (
        <Modal
          titulo={`Libro mayor · ${mayor.cuenta.codigo} ${mayor.cuenta.nombre}`}
          ayuda="El saldo es el que queda DESPUÉS de cada movimiento: solo se lee como acumulado en orden cronológico, que es como abre."
          ancho="lg"
          onCerrar={() => setMayor(null)}
        >
          <Tabla orden={ordenMayor} glosario="mayor">
            <table className="w-full text-sm">
              <thead className="text-neutral-500 text-xs uppercase">
                <tr>
                  <Th clave="fecha" className="py-1 px-0">Fecha</Th>
                  <Th clave="descripcion" className="py-1 px-0">Descripción</Th>
                  <Th clave="debe" alinear="derecha" className="py-1 px-0">Debe</Th>
                  <Th clave="haber" alinear="derecha" className="py-1 px-0">Haber</Th>
                  <Th clave="saldo" alinear="derecha" className="py-1 px-0">Saldo</Th>
                </tr>
              </thead>
              <tbody>
                {ordenMayor.ordenar(mayor.filas).map((f, i) => (
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
                      Esta cuenta no tiene movimientos todavía.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Tabla>
        </Modal>
      )}
    </div>
  )
}

/** El alta de una cuenta, en ventana flotante. */
function NuevaCuenta({ onCerrar, onCreada }: { onCerrar: () => void; onCreada: () => void }) {
  const [codigo, setCodigo] = useState('')
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState('gasto')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    setError('')
    if (!codigo.trim() || !nombre.trim()) {
      setError('Hacen falta el código y el nombre.')
      return
    }
    // La naturaleza no se pregunta: la decide el tipo, y equivocarse ahi deja
    // una cuenta que suma al reves para siempre.
    const naturaleza =
      tipo === 'activo' || tipo === 'costo' || tipo === 'gasto' ? 'deudora' : 'acreedora'
    setGuardando(true)
    try {
      await api.crearCuenta({
        codigo: codigo.trim(),
        nombre: nombre.trim(),
        tipo: tipo as CuentaContable['tipo'],
        naturaleza,
        activa: true,
      })
      onCreada()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la cuenta')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      titulo="Nueva cuenta"
      ayuda="El código decide dónde entra en los reportes: 1 activo, 2 pasivo, 3 patrimonio, 4 ingreso, 5 costo, 6 gasto."
      onCerrar={onCerrar}
      pie={
        <>
          <Boton tono="suave" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton onClick={guardar} disabled={guardando}>
            {guardando ? 'Creando…' : 'Crear cuenta'}
          </Boton>
        </>
      }
    >
      {error && <p className="text-peligro-600 text-sm mb-3">{error}</p>}
      <div className="space-y-3">
        {/* `Campo` ES el input, no lo envuelve: los `<input>` van como props. */}
        <Campo
          etiqueta="Código"
          autoFocus
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          placeholder="6030"
        />
        <Campo
          etiqueta="Nombre de la cuenta"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && guardar()}
          placeholder="Faltante de caja"
        />
        <Selector etiqueta="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          {Object.entries(TIPO_LABEL).map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </Selector>
      </div>
    </Modal>
  )
}

function Diario({ rango }: { rango: Rango }) {
  const [asientos, setAsientos] = useState<AsientoContable[]>([])
  // Lo ultimo asentado arriba; por Origen se separa de un vistazo lo que
  // escribio una persona a mano de lo que asento el sistema solo.
  const ordenAsientos = useOrden<AsientoContable>(
    {
      fecha: (a) => new Date(a.fecha),
      descripcion: (a) => a.descripcion,
      origen: (a) => ORIGEN_LABEL[a.origen] ?? a.origen,
    },
    '-fecha',
  )
  // La descripcion es lo unico por lo que se busca un asiento: "alquiler",
  // "#412", "Zelle". El origen entra tambien, para aislar lo manual.
  const buscadorAsientos = useBuscador<AsientoContable>(
    (a) => [
      a.descripcion,
      ORIGEN_LABEL[a.origen] ?? a.origen,
      ...a.movimientos.map((m) => `${m.cuenta_codigo} ${m.cuenta_nombre}`),
    ],
    'Buscar por descripción, cuenta u origen',
  )
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
  }, [rango])

  function cargar() {
    api.listarAsientos(rango).then(setAsientos)
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
          Los que genera el sistema solo (ventas, gastos, compras, merma) no aparecen aquí para
          crear - solo para consultar. Este formulario es para lo que no encaja en ningún flujo,
          por ejemplo un aporte de capital.
        </p>
        {error && <p className="text-peligro-600 text-sm mb-2">{error}</p>}
        <input
          value={nuevaDescripcion}
          onChange={(e) => setNuevaDescripcion(e.target.value)}
          placeholder="Descripción del asiento"
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
            <Numerico
              value={l.debe}
              onChange={(e) => actualizarLinea(i, 'debe', e.target.value)}
              placeholder="Debe"
              className="w-24 border border-neutral-300 rounded-lg px-2 py-2 text-sm"
            />
            <Numerico
              value={l.haber}
              onChange={(e) => actualizarLinea(i, 'haber', e.target.value)}
              placeholder="Haber"
              className="w-24 border border-neutral-300 rounded-lg px-2 py-2 text-sm"
            />
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
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

      <Tabla
        orden={ordenAsientos}
        buscador={buscadorAsientos}
        glosario="diario"
        className="bg-white rounded-2xl border border-neutral-200 overflow-hidden"
      >
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
            <tr>
              <Th clave="fecha">Fecha</Th>
              <Th clave="descripcion">Descripción</Th>
              <Th clave="origen">Origen</Th>
              <Th ayuda="diario.movimientos">Movimientos</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {ordenAsientos.ordenar(buscadorAsientos.filtrar(asientos)).map((a) => (
              <tr key={a.id} className="border-t border-neutral-100 align-top">
                <td className="p-3 whitespace-nowrap">{new Date(a.fecha).toLocaleDateString('es-VE')}</td>
                <td className="p-3 font-medium">{a.descripcion}</td>
                <td className="p-3 text-neutral-500">{ORIGEN_LABEL[a.origen] ?? a.origen}</td>
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
                    <button onClick={() => borrar(a.id)} className="text-peligro-500 text-xs">
                      Borrar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Tabla>
    </div>
  )
}

function TablaCuentas({ filas }: { filas: FilaBalanceComprobacion[] }) {
  const totalDebe = filas.reduce((s, f) => s + f.debe, 0)
  const totalHaber = filas.reduce((s, f) => s + f.haber, 0)
  const orden = useOrden<FilaBalanceComprobacion>(
    {
      cuenta: (f) => f.codigo,
      debe: (f) => f.debe,
      haber: (f) => f.haber,
      saldo: (f) => f.saldo,
    },
    'cuenta',
  )
  return (
    <Tabla orden={orden} glosario="balance">
    <table className="w-full text-sm">
      <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
        <tr>
          <Th clave="cuenta">Cuenta</Th>
          <Th clave="debe" alinear="derecha">Debe</Th>
          <Th clave="haber" alinear="derecha">Haber</Th>
          <Th clave="saldo" alinear="derecha">Saldo</Th>
        </tr>
      </thead>
      <tbody>
        {orden.ordenar(filas).map((f) => (
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
    </Tabla>
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

function EstadoResultados({ rango }: { rango: Rango }) {
  const [datos, setDatos] = useState<EstadoResultadosContable | null>(null)

  useEffect(() => {
    api.estadoResultadosContable(rango).then(setDatos)
  }, [rango])

  return (
    <div className="space-y-4">
      {datos && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-4">
          <p className="text-sm text-neutral-500 mb-3">{datos.etiqueta}</p>
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
        className={`tabular-nums ${total ? (monto < 0 ? 'text-peligro-600' : 'text-exito-600') : ''}`}
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
          datos.cuadra ? 'bg-exito-50 text-exito-800' : 'bg-peligro-50 text-peligro-800'
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

/**
 * Equipos que se gastan con los años: nevera, horno, mesas.
 *
 * Antes una compra de activos entraba a 1050 y se quedaba ahi a valor de
 * compra para siempre: el desgaste nunca llegaba al estado de resultados y el
 * balance mostraba equipos viejos valiendo como nuevos. La depreciacion se
 * asienta sola al abrir esta pantalla (o cualquier estado financiero).
 */
function Activos() {
  const [activos, setActivos] = useState<ActivoFijo[]>([])
  const [error, setError] = useState('')
  const dialogo = useDialogo()

  useEffect(() => {
    cargar()
  }, [])

  function cargar() {
    api.listarActivos().then(setActivos).catch(() => setActivos([]))
  }

  async function accion(fn: () => Promise<unknown>) {
    setError('')
    try {
      await fn()
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ocurrió un error')
    }
  }

  async function cambiarVida(a: ActivoFijo) {
    const meses = await dialogo.pedirNumero({
      titulo: `Vida útil de ${a.nombre}`,
      texto: `A ${a.vida_util_meses} meses se gasta $${a.cuota_mensual.toFixed(2)} al mes.`,
      etiqueta: 'Cuántos meses dura',
      valor: a.vida_util_meses,
      min: 1,
    })
    if (meses === null) return
    accion(() => api.actualizarActivo(a.id, { vida_util_meses: meses }))
  }

  async function reactivar(a: ActivoFijo) {
    // Marcar el equipo equivocado lo sacaba de los libros para siempre: el
    // PUT devolvia 409 y no habia otra via.
    if (
      !(await dialogo.confirmar({
        titulo: `¿Devolver ${a.nombre} a los libros?`,
        texto: 'Vuelve con su valor y su depreciación acumulada tal como estaban, no como equipo nuevo.',
        aceptar: 'Devolver a los libros',
      }))
    )
      return
    accion(() => api.reactivarActivo(a.id))
  }

  async function altaExistente() {
    // Los activos solo nacian de una factura de compra: el horno que el dueno
    // tenia desde antes de instalar el ERP no existia contablemente, asi que
    // el balance subestimaba los activos y ese equipo nunca se depreciaba.
    const r = await dialogo.pedir({
      titulo: 'Equipo que ya tenías',
      texto: 'Lo que compraste antes de usar el sistema también se deprecia y cuenta en el balance.',
      campos: [
        { nombre: 'nombre', etiqueta: 'Qué equipo es', placeholder: 'Horno, nevera, moto...' },
        { nombre: 'valor', etiqueta: 'Cuánto vale hoy, aproximadamente', sufijo: '$', tipo: 'numero', min: 0.01 },
        { nombre: 'meses', etiqueta: 'En cuántos meses se gasta', tipo: 'numero', valor: 60, min: 1, ayuda: '60 = cinco años.' },
        { nombre: 'fecha', etiqueta: 'Cuándo lo compraste (aproximado)', tipo: 'fecha', opcional: true },
      ],
      aceptar: 'Dar de alta',
    })
    if (!r) return
    const nombre = r.nombre
    const valor = Number(r.valor)
    const meses = Number(r.meses) || 60
    const fecha = r.fecha
    accion(() =>
      api.registrarActivoExistente({
        nombre,
        valor,
        vida_util_meses: meses,
        fecha_compra: fecha ? `${fecha}T00:00:00` : undefined,
      }),
    )
  }

  async function cerrarAnio() {
    const anio = new Date().getFullYear() - 1
    if (
      !(await dialogo.confirmar({
        titulo: `¿Cerrar el ejercicio ${anio}?`,
        texto:
          'Su resultado pasa a Utilidades retenidas y las cuentas de ingresos, costos y ' +
          'gastos de ese año quedan en cero. Sin esto, la utilidad acumulada del balance ' +
          'mezcla todos los años en un solo número.',
        aceptar: 'Cerrar ejercicio',
      }))
    )
      return
    try {
      const r = await api.cerrarEjercicio(anio)
      await dialogo.avisar({
        titulo: `Ejercicio ${r.anio} cerrado`,
        texto: `Resultado del año: $${r.resultado.toFixed(2)}`,
        tono: 'bien',
      })
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cerrar el ejercicio')
    }
  }

  async function darDeBaja(a: ActivoFijo) {
    const motivo = await dialogo.pedirTexto({
      titulo: `Dar de baja ${a.nombre}`,
      texto: `Le quedan $${a.valor_en_libros.toFixed(2)} sin depreciar, que se van a reconocer como pérdida de una vez.`,
      etiqueta: 'Qué pasó',
      valor: 'Se dañó',
      aceptar: 'Dar de baja',
      peligro: true,
    })
    if (motivo === null) return
    accion(() => api.darDeBajaActivo(a.id, motivo))
  }

  const enUso = activos.filter((a) => !a.dado_de_baja)
  const valorLibros = enUso.reduce((s, a) => s + a.valor_en_libros, 0)
  const cuotaMes = enUso
    .filter((a) => a.meses_depreciados < a.vida_util_meses)
    .reduce((s, a) => s + a.cuota_mensual, 0)

  return (
    <div className="space-y-4">
      {error && <p className="text-peligro-600 text-sm">{error}</p>}

      <div className="bg-white rounded-2xl border border-neutral-200 p-4">
        <div className="flex flex-wrap justify-between gap-3 mb-1">
          <h2 className="font-semibold">
            Equipos y mobiliario
            <button
              onClick={altaExistente}
              className="ml-3 text-sm font-medium text-acento-600"
              title="Un equipo que ya tenías antes de instalar el sistema"
            >
              + ya lo tenia
            </button>
            <button
              onClick={cerrarAnio}
              className="ml-3 text-sm font-medium text-neutral-500"
              title="Manda el resultado del año pasado a Utilidades retenidas"
            >
              Cerrar ejercicio
            </button>
          </h2>
          <span className="text-sm text-neutral-500">
            valen hoy{' '}
            <span className="font-semibold text-neutral-800 tabular-nums">
              ${valorLibros.toFixed(2)}
            </span>
            {cuotaMes > 0 && (
              <>
                {' '}· se gastan{' '}
                <span className="font-semibold text-neutral-800 tabular-nums">
                  ${cuotaMes.toFixed(2)}
                </span>{' '}
                al mes
              </>
            )}
          </span>
        </div>
        <p className="text-xs text-neutral-500 mb-3">
          Cada equipo se va convirtiendo en gasto a lo largo de su vida útil. Ese desgaste ya
          está descontado de la ganancia que ves en Reportes.
        </p>

        {activos.length === 0 && (
          <p className="text-sm text-neutral-400">
            Sin equipos registrados. Se crean solos al cargar una factura de categoría Activos en
            Compras.
          </p>
        )}

        <div className="space-y-2">
          {activos.map((a) => {
            const pct = a.valor > 0 ? (a.depreciacion_acumulada / a.valor) * 100 : 0
            const agotado = a.meses_depreciados >= a.vida_util_meses
            return (
              <div
                key={a.id}
                className={`border rounded-xl p-3 ${
                  a.dado_de_baja ? 'border-neutral-200 opacity-50' : 'border-neutral-200'
                }`}
              >
                <div className="flex flex-wrap justify-between items-baseline gap-2 mb-2">
                  <span className="font-medium">
                    {a.nombre}
                    {a.dado_de_baja && (
                      <button
                        onClick={() => reactivar(a)}
                        className="ml-2 text-xs font-medium text-acento-600"
                      >
                        Fue un error, devolverlo
                      </button>
                    )}
                    {a.dado_de_baja && (
                      <span className="ml-2 text-xs text-neutral-500">
                        dado de baja{a.motivo_baja ? `: ${a.motivo_baja}` : ''}
                      </span>
                    )}
                    {!a.dado_de_baja && agotado && (
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-aviso-700 bg-aviso-50 rounded px-1.5 py-0.5">
                        ya depreciado
                      </span>
                    )}
                  </span>
                  <span className="text-sm tabular-nums">
                    <span className="text-neutral-400">${a.valor.toFixed(2)}</span>
                    {' → '}
                    <span className="font-semibold">${a.valor_en_libros.toFixed(2)}</span>
                  </span>
                </div>

                {!a.dado_de_baja && (
                  <>
                    <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden mb-2">
                      <div
                        className={`h-full ${agotado ? 'bg-aviso-400' : 'bg-neutral-700'}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <div className="flex flex-wrap justify-between gap-2 text-xs text-neutral-500">
                      <span>
                        {a.meses_depreciados} de {a.vida_util_meses} meses · $
                        {a.cuota_mensual.toFixed(2)}/mes
                      </span>
                      <span className="flex gap-3">
                        <button onClick={() => cambiarVida(a)} className="text-acento-600 font-medium">
                          Cambiar duración
                        </button>
                        <button onClick={() => darDeBaja(a)} className="text-peligro-500 font-medium">
                          Dar de baja
                        </button>
                      </span>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
