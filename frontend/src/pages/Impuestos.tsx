import { useEffect, useState } from 'react'
import { Ayuda } from '../components/Ayuda'
import { explicar } from '../lib/glosario'
import NavBar from '../components/NavBar'
import { useSeccion } from '../components/Secciones'
import { useDialogo } from '../components/dialogo'
import { Tabla, Th, useOrden } from '../components/Tabla'
import { Pagina } from '../components/ui'
import { api } from '../lib/api'
import type {
  ConfiguracionFiscal,
  DeclaracionIva,
  FilaLibroCompras,
  FilaLibroVentas,
  LibroCompras,
  LibroVentas,
  Periodo,
  PeriodoPendiente,
  ResumenIva,
} from '../lib/types'

const PERIODOS: { valor: Periodo; texto: string }[] = [
  { valor: 'dia', texto: 'Hoy' },
  { valor: 'semana', texto: 'Esta semana' },
  { valor: 'mes', texto: 'Este mes' },
]

const SECCIONES = [
  { id: 'ventas', texto: 'Libro de ventas' },
  { id: 'compras', texto: 'Libro de compras' },
  { id: 'declaraciones', texto: 'Declaraciones' },
]

export default function Impuestos() {
  const [seccion, irA] = useSeccion(SECCIONES)
  // Los libros del SENIAT se entregan por fecha, pero revisar una factura
  // concreta o la venta mas grande del mes es buscar, no leer: por eso
  // tambien se ordenan por numero de factura, por cliente o por monto.
  const ordenVentas = useOrden<FilaLibroVentas>(
    {
      fecha: (f) => f.fecha,
      factura: (f) => f.numero_factura,
      cliente: (f) => f.cliente,
      base: (f) => f.base_imponible,
      iva: (f) => f.iva,
      total: (f) => f.total,
    },
    'fecha',
  )
  const ordenCompras = useOrden<FilaLibroCompras>(
    {
      fecha: (f) => f.fecha,
      factura: (f) => f.numero_factura,
      proveedor: (f) => f.proveedor_nombre,
      rif: (f) => f.proveedor_rif,
      base: (f) => f.base_imponible,
      iva: (f) => f.iva,
      total: (f) => f.total,
    },
    'fecha',
  )
  const [periodo, setPeriodo] = useState<Periodo>('mes')
  const [ventas, setVentas] = useState<LibroVentas | null>(null)
  const [compras, setCompras] = useState<LibroCompras | null>(null)
  const [resumen, setResumen] = useState<ResumenIva | null>(null)
  // El valor solo se usa via tasaInput; se guarda el setter para refrescarlo.
  const [, setFiscal] = useState<ConfiguracionFiscal>({ tasa_iva: 16 })
  const [tasaInput, setTasaInput] = useState('')

  useEffect(() => {
    api.libroVentas(periodo).then(setVentas)
    api.libroCompras(periodo).then(setCompras)
    api.resumenIva(periodo).then(setResumen)
  }, [periodo])

  useEffect(() => {
    api.configFiscal().then((c) => {
      setFiscal(c)
      setTasaInput(String(c.tasa_iva))
    })
  }, [])

  async function guardarTasa() {
    const valor = Number(tasaInput)
    if (!Number.isFinite(valor) || valor < 0) return
    const c = await api.actualizarConfigFiscal(valor)
    setFiscal(c)
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Impuestos" secciones={SECCIONES} seccion={seccion} alCambiarSeccion={irA} />
      <div className="sticky top-[57px] z-10 bg-neutral-50/95 backdrop-blur border-b border-neutral-200 px-4 py-2 flex gap-2 overflow-x-auto">
        {PERIODOS.map((p) => (
          <button
            key={p.valor}
            onClick={() => setPeriodo(p.valor)}
            className={`shrink-0 px-4 py-2 rounded-full text-sm font-semibold border transition ${
              periodo === p.valor
                ? 'bg-neutral-900 border-neutral-900 text-white'
                : 'bg-white border-neutral-200 text-neutral-500'
            }`}
          >
            {p.texto}
          </button>
        ))}
      </div>

      <Pagina>
        <div className="bg-white rounded-2xl border border-neutral-200 p-4">
          <h2 className="font-semibold mb-2">Alicuota de IVA</h2>
          <div className="flex flex-wrap gap-2">
            <input
              value={tasaInput}
              onChange={(e) => setTasaInput(e.target.value)}
              type="number"
              step="0.5"
              className="w-24 border border-neutral-300 rounded-lg px-3 py-2 text-sm"
            />
            <span className="flex items-center text-sm text-neutral-500">%</span>
            <button
              onClick={guardarTasa}
              className="bg-neutral-900 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              Guardar
            </button>
          </div>
          <p className="text-xs text-neutral-500 mt-2">
            Se congela en cada venta facturada al momento de cobrar, asi que cambiarla no altera
            los libros de meses ya cerrados.
          </p>
        </div>

        {resumen && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Kpi titulo="IVA debito (ventas)" ayuda="kpi.iva_debito" valor={resumen.iva_debito} />
            <Kpi titulo="IVA credito (compras)" ayuda="kpi.iva_credito" valor={resumen.iva_credito} />
            <Kpi
              titulo={resumen.iva_a_pagar >= 0 ? 'IVA a pagar' : 'IVA a favor'}
              ayuda="kpi.iva_a_pagar"
              valor={Math.abs(resumen.iva_a_pagar)}
              destacado
            />
          </div>
        )}

        {seccion === 'ventas' && ventas && (
          <div className="space-y-3">
            {ventas.ventas_no_facturadas > 0 && (
              <p className="bg-aviso-50 border border-aviso-200 text-aviso-900 rounded-xl p-3 text-sm">
                Ademas hubo <strong>{ventas.ventas_no_facturadas}</strong> venta(s) sin facturar por
                ${ventas.monto_no_facturado.toFixed(2)} en este periodo - no entran aqui porque el
                dueno no las declaro con factura.
              </p>
            )}
            <Tabla orden={ordenVentas} glosario="libroventas" className="bg-white rounded-2xl border border-neutral-200">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
                  <tr>
                    <Th clave="fecha">Fecha</Th>
                    <Th clave="factura">Factura</Th>
                    <Th clave="cliente">Cliente</Th>
                    <Th clave="base" alinear="derecha">Base</Th>
                    <Th clave="iva" alinear="derecha">IVA</Th>
                    <Th clave="total" alinear="derecha">Total</Th>
                  </tr>
                </thead>
                <tbody>
                  {ordenVentas.ordenar(ventas.filas).map((f) => (
                    <tr key={f.pedido_id} className="border-t border-neutral-100">
                      <td className="p-3 whitespace-nowrap">
                        {new Date(f.fecha).toLocaleDateString('es-VE')}
                      </td>
                      <td className="p-3 font-mono text-xs">{f.numero_factura}</td>
                      <td className="p-3">{f.cliente}</td>
                      <td className="text-right p-3 tabular-nums">{f.base_imponible.toFixed(2)}</td>
                      <td className="text-right p-3 tabular-nums">{f.iva.toFixed(2)}</td>
                      <td className="text-right p-3 tabular-nums font-semibold">{f.total.toFixed(2)}</td>
                    </tr>
                  ))}
                  {ventas.filas.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-neutral-400 py-4 text-center">
                        Sin ventas facturadas en este periodo.
                      </td>
                    </tr>
                  )}
                </tbody>
                {ventas.filas.length > 0 && (
                  <tfoot className="border-t-2 border-neutral-300 font-bold">
                    <tr>
                      <td className="p-3" colSpan={3}>
                        Total
                      </td>
                      <td className="text-right p-3 tabular-nums">{ventas.total_base.toFixed(2)}</td>
                      <td className="text-right p-3 tabular-nums">{ventas.total_iva.toFixed(2)}</td>
                      <td className="text-right p-3 tabular-nums">{ventas.total_general.toFixed(2)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </Tabla>
          </div>
        )}

        {seccion === 'compras' && compras && (
          <Tabla orden={ordenCompras} glosario="librocompras" className="bg-white rounded-2xl border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
                <tr>
                  <Th clave="fecha">Fecha</Th>
                  <Th clave="factura">Factura</Th>
                  <Th clave="proveedor">Proveedor</Th>
                  <Th clave="rif">RIF</Th>
                  <Th clave="base" alinear="derecha">Base</Th>
                  <Th clave="iva" alinear="derecha">IVA</Th>
                  <Th clave="total" alinear="derecha">Total</Th>
                </tr>
              </thead>
              <tbody>
                {ordenCompras.ordenar(compras.filas).map((f) => (
                  <tr key={f.factura_id} className="border-t border-neutral-100">
                    <td className="p-3 whitespace-nowrap">{new Date(f.fecha).toLocaleDateString('es-VE')}</td>
                    <td className="p-3 font-mono text-xs">{f.numero_factura}</td>
                    <td className="p-3">{f.proveedor_nombre}</td>
                    <td className="p-3 text-neutral-500">{f.proveedor_rif || '-'}</td>
                    <td className="text-right p-3 tabular-nums">{f.base_imponible.toFixed(2)}</td>
                    <td className="text-right p-3 tabular-nums">{f.iva.toFixed(2)}</td>
                    <td className="text-right p-3 tabular-nums font-semibold">{f.total.toFixed(2)}</td>
                  </tr>
                ))}
                {compras.filas.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-neutral-400 py-4 text-center">
                      Sin facturas de compra en este periodo.
                    </td>
                  </tr>
                )}
              </tbody>
              {compras.filas.length > 0 && (
                <tfoot className="border-t-2 border-neutral-300 font-bold">
                  <tr>
                    <td className="p-3" colSpan={4}>
                      Total
                    </td>
                    <td className="text-right p-3 tabular-nums">{compras.total_base.toFixed(2)}</td>
                    <td className="text-right p-3 tabular-nums">{compras.total_iva.toFixed(2)}</td>
                    <td className="text-right p-3 tabular-nums">{compras.total_general.toFixed(2)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </Tabla>
        )}

        {seccion === 'declaraciones' && <Declaraciones />}
      </Pagina>
    </div>
  )
}

/**
 * Declaraciones mensuales de IVA.
 *
 * Antes las dos cuentas de IVA solo crecian: nunca se neteaban ni se saldaban,
 * asi que el balance mostraba como deuda todo el debito acumulado desde
 * siempre. Declarar un mes lo cierra contra el credito fiscal y deja la
 * diferencia como deuda real hasta que se paga.
 */
function Declaraciones() {
  const [declaraciones, setDeclaraciones] = useState<DeclaracionIva[]>([])
  const [pendientes, setPendientes] = useState<PeriodoPendiente[]>([])
  const [error, setError] = useState('')
  const dialogo = useDialogo()
  const [ocupado, setOcupado] = useState(false)

  useEffect(() => {
    cargar()
  }, [])

  function cargar() {
    api.listarDeclaraciones().then(setDeclaraciones).catch(() => setDeclaraciones([]))
    api.periodosPendientes().then(setPendientes).catch(() => setPendientes([]))
  }

  async function accion(fn: () => Promise<unknown>) {
    setError('')
    setOcupado(true)
    try {
      await fn()
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ocurrio un error')
    } finally {
      setOcupado(false)
    }
  }

  async function declarar(p: PeriodoPendiente) {
    const neto = p.iva_debito - p.iva_credito
    const resumen =
      neto > 0
        ? `Quedaria por pagar hasta $${neto.toFixed(2)} (menos el credito que venga arrastrado).`
        : `El credito fiscal cubre el debito: no se paga nada y sobran $${Math.abs(neto).toFixed(2)} para el mes siguiente.`
    if (
      !(await dialogo.confirmar({
        titulo: `¿Declarar ${p.etiqueta}?`,
        texto: `IVA cobrado en ventas: $${p.iva_debito.toFixed(2)}\nIVA pagado en compras: $${p.iva_credito.toFixed(2)}\n\n${resumen}`,
        aceptar: 'Declarar',
      }))
    )
      return
    accion(() => api.declararIva(p.anio, p.mes))
  }

  async function anular(d: DeclaracionIva) {
    // No existia borrar y re-declarar el mismo mes daba 409: una declaracion
    // mal hecha se quedaba mal para siempre.
    if (
      !(await dialogo.confirmar({
        titulo: `¿Anular la declaración de ${d.etiqueta}?`,
        texto: 'Se revierten sus asientos (y el del pago, si lo hubo) y el período vuelve a quedar pendiente para declararlo bien.',
        aceptar: 'Anular',
        peligro: true,
      }))
    )
      return
    accion(() => api.anularDeclaracion(d.id))
  }

  async function pagar(d: DeclaracionIva) {
    const forma = await dialogo.elegir({
      titulo: `Pagar el IVA de ${d.etiqueta}`,
      texto: `Son $${d.iva_a_pagar.toFixed(2)}. ¿De dónde sale?`,
      opciones: [
        { valor: 'Banco', texto: 'Por banco' },
        { valor: 'Efectivo', texto: 'En efectivo', detalle: 'Sale de la gaveta.' },
      ],
    })
    if (!forma) return
    accion(() => api.pagarDeclaracion(d.id, forma))
  }

  const porPagar = declaraciones.filter((d) => !d.pagada && d.iva_a_pagar > 0)
  const ultima = declaraciones[0]

  return (
    <div className="space-y-4">
      {error && <p className="text-peligro-600 text-sm">{error}</p>}

      {pendientes.length > 0 && (
        <div className="bg-white rounded-2xl border border-aviso-300 p-4">
          <h2 className="font-semibold mb-1">Meses cerrados sin declarar</h2>
          <p className="text-xs text-neutral-500 mb-3">
            Solo aparecen meses que ya terminaron: el mes en curso todavia puede recibir ventas.
          </p>
          <div className="space-y-2">
            {pendientes.map((p) => (
              <div
                key={`${p.anio}-${p.mes}`}
                className="flex flex-wrap items-center gap-3 bg-aviso-50 rounded-lg p-2 text-sm"
              >
                <span className="font-medium flex-1 min-w-[120px]">{p.etiqueta}</span>
                <span className="text-neutral-600 tabular-nums text-xs">
                  debito ${p.iva_debito.toFixed(2)} · credito ${p.iva_credito.toFixed(2)}
                </span>
                <button
                  onClick={() => declarar(p)}
                  disabled={ocupado}
                  className="bg-neutral-900 text-white rounded-lg px-3 py-1 text-xs font-medium disabled:opacity-50"
                >
                  Declarar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {ultima && ultima.credito_excedente > 0 && (
        <div className="bg-exito-50 border border-exito-200 rounded-xl px-3 py-2 text-sm text-exito-800">
          Tienes ${ultima.credito_excedente.toFixed(2)} de credito fiscal a favor de{' '}
          {ultima.etiqueta}: se descuentan del IVA del mes siguiente.
        </div>
      )}

      <div className="bg-white rounded-2xl border border-neutral-200 p-4">
        <div className="flex flex-wrap justify-between gap-2 mb-3">
          <h2 className="font-semibold">Declaraciones presentadas</h2>
          {porPagar.length > 0 && (
            <span className="text-sm text-peligro-600 font-medium">
              {porPagar.length} sin pagar por $
              {porPagar.reduce((s, d) => s + d.iva_a_pagar, 0).toFixed(2)}
            </span>
          )}
        </div>

        {declaraciones.length === 0 && (
          <p className="text-sm text-neutral-400">
            Sin declaraciones todavia. Se declara cada mes una vez cerrado.
          </p>
        )}

        <div className="space-y-2">
          {declaraciones.map((d) => (
            <div key={d.id} className="border border-neutral-200 rounded-xl p-3 text-sm">
              <div className="flex flex-wrap justify-between items-baseline gap-2 mb-1">
                <span className="font-medium">
                  {d.etiqueta}
                  {/* Una declaracion mal hecha se quedaba mal para siempre: no
                      existia borrar y re-declarar el mes devolvia 409. */}
                  <button
                    onClick={() => anular(d)}
                    disabled={ocupado}
                    className="ml-2 text-xs font-medium text-peligro-500 disabled:opacity-40"
                    title="Revierte sus asientos y libera el periodo"
                  >
                    Anular
                  </button>
                </span>
                {d.iva_a_pagar > 0 ? (
                  d.pagada ? (
                    <span className="text-xs text-exito-700 bg-exito-50 rounded-full px-2 py-0.5 font-medium">
                      pagada · {d.forma_pago}
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <span className="font-semibold tabular-nums text-peligro-600">
                        ${d.iva_a_pagar.toFixed(2)}
                      </span>
                      <button
                        onClick={() => pagar(d)}
                        disabled={ocupado}
                        className="bg-neutral-900 text-white rounded-lg px-3 py-1 text-xs font-medium disabled:opacity-50"
                      >
                        Registrar pago
                      </button>
                    </span>
                  )
                ) : (
                  <span className="text-xs text-neutral-500">sin IVA por pagar</span>
                )}
              </div>
              <div className="text-xs text-neutral-500 tabular-nums">
                debito ${d.iva_debito.toFixed(2)} · credito ${d.iva_credito.toFixed(2)}
                {d.credito_arrastrado > 0 && ` (+ $${d.credito_arrastrado.toFixed(2)} arrastrado)`}
                {d.credito_excedente > 0 && ` · sobran $${d.credito_excedente.toFixed(2)}`}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Kpi({
  titulo,
  valor,
  ayuda,
  destacado = false,
}: {
  titulo: string
  valor: number
  /** Clave del glosario: la explicacion al posar el cursor en el titulo. */
  ayuda?: string
  destacado?: boolean
}) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4">
      <div className="text-xs text-neutral-500">
        <Ayuda explica={explicar(ayuda)} titulo={titulo}>
          {titulo}
        </Ayuda>
      </div>
      <div className={`font-bold tabular-nums ${destacado ? 'text-2xl' : 'text-xl'}`}>
        ${valor.toFixed(2)}
      </div>
    </div>
  )
}
