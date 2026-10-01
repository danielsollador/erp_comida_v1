import { useEffect, useState } from 'react'
import { Ayuda } from '../components/Ayuda'
import { explicar } from '../lib/glosario'
import NavBar from '../components/NavBar'
import { useSeccion } from '../components/Secciones'
import { FiltroFechas } from '../components/Fechas'
import { useRango, queryRango } from '../lib/fechas'
import { useDialogo } from '../components/dialogo'
import { Tabla, Th, useOrden } from '../components/Tabla'
import { Pagina } from '../components/ui'
import { Numerico } from '../components/Teclado'
import { api } from '../lib/api'
import { fmtNum } from '../lib/moneda'
import type {
  ConfiguracionFiscal,
  DeclaracionIva,
  FilaLibroCompras,
  FilaLibroVentas,
  LibroCompras,
  LibroVentas,
  PeriodoPendiente,
  ResumenIva,
} from '../lib/types'

const SECCIONES = [
  { id: 'ventas', texto: 'Libro de ventas' },
  { id: 'compras', texto: 'Libro de compras' },
  { id: 'declaraciones', texto: 'Declaraciones' },
]

/** Un monto en Bs para el libro: sin símbolo (la columna ya lo dice), o un guion. */
function bs(monto: number | null) {
  return monto === null ? '-' : fmtNum(monto, 2)
}

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
      base: (f) => f.gravado_bs ?? -Infinity,
      iva: (f) => f.iva_bs ?? -Infinity,
      total: (f) => f.total_bs ?? -Infinity,
    },
    'fecha',
  )
  const ordenCompras = useOrden<FilaLibroCompras>(
    {
      emision: (f) => f.fecha_emision,
      fecha: (f) => f.fecha,
      factura: (f) => f.numero_factura,
      proveedor: (f) => f.proveedor_nombre,
      rif: (f) => f.proveedor_rif,
      exento: (f) => f.exento_bs ?? -Infinity,
      base: (f) => f.gravado_bs ?? -Infinity,
      iva: (f) => f.iva_bs ?? -Infinity,
      total: (f) => f.total_bs ?? -Infinity,
    },
    'fecha',
  )
  // El SENIAT pide los libros por mes, asi que se abre en el mes en curso;
  // el filtro deja ver cualquier otro tramo para revisar una factura.
  const [rango, setRango] = useRango('mes')
  const [ventas, setVentas] = useState<LibroVentas | null>(null)
  const [compras, setCompras] = useState<LibroCompras | null>(null)
  const [resumen, setResumen] = useState<ResumenIva | null>(null)
  // El valor solo se usa via los campos; se guarda el setter para refrescarlo.
  const [, setFiscal] = useState<ConfiguracionFiscal>({ tasa_iva: 16 })
  const [tasaInput, setTasaInput] = useState('')
  // Quien lleva los libros: la cabecera de los libros del SENIAT.
  const [razonSocial, setRazonSocial] = useState('')
  const [rifEmpresa, setRifEmpresa] = useState('')
  const [direccion, setDireccion] = useState('')
  const [errorFiscal, setErrorFiscal] = useState('')
  const [guardado, setGuardado] = useState(false)
  // Revisar una factura puntual (un reclamo, una auditoria) es buscarla, no
  // hojear el libro entero mes por mes.
  const [buscarVentas, setBuscarVentas] = useState('')
  const [buscarCompras, setBuscarCompras] = useState('')

  useEffect(() => {
    api.libroVentas(rango).then(setVentas)
    api.libroCompras(rango).then(setCompras)
    api.resumenIva(rango).then(setResumen)
  }, [rango])

  useEffect(() => {
    api.configFiscal().then((c) => {
      setFiscal(c)
      setTasaInput(String(c.tasa_iva))
      setRazonSocial(c.razon_social ?? '')
      setRifEmpresa(c.rif ?? '')
      setDireccion(c.direccion ?? '')
    })
  }, [])

  async function guardarFiscal() {
    const valor = Number(tasaInput)
    if (!Number.isFinite(valor) || valor < 0) return setErrorFiscal('La alícuota no es válida.')
    setErrorFiscal('')
    try {
      const c = await api.actualizarConfigFiscal({ tasa_iva: valor, razon_social: razonSocial, rif: rifEmpresa, direccion })
      setFiscal(c)
      setRifEmpresa(c.rif ?? '')
      setGuardado(true)
      setTimeout(() => setGuardado(false), 2000)
    } catch (e) {
      setErrorFiscal(e instanceof Error ? e.message : 'No se pudo guardar')
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Impuestos" secciones={SECCIONES} seccion={seccion} alCambiarSeccion={irA} filtro={seccion !== 'declaraciones' ? <FiltroFechas rango={rango} alCambiar={setRango} /> : undefined} />
      <Pagina>
        <div className="bg-white rounded-2xl border border-neutral-200 p-4">
          <h2 className="font-semibold mb-3">Datos fiscales</h2>
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_7rem] gap-3">
            <label className="text-xs text-neutral-500">
              Razón social
              <input
                value={razonSocial}
                onChange={(e) => setRazonSocial(e.target.value)}
                placeholder="Inversiones Ejemplo, C.A."
                className="mt-1 w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm text-neutral-900"
              />
            </label>
            <label className="text-xs text-neutral-500">
              RIF
              <input
                value={rifEmpresa}
                onChange={(e) => setRifEmpresa(e.target.value)}
                placeholder="J-12345678-9"
                className="mt-1 w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm text-neutral-900"
              />
            </label>
            <label className="text-xs text-neutral-500">
              Alícuota IVA (%)
              <Numerico
                value={tasaInput}
                onChange={(e) => setTasaInput(e.target.value)}
                className="mt-1 w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm text-neutral-900"
              />
            </label>
            <label className="text-xs text-neutral-500 sm:col-span-3">
              Dirección fiscal
              <input
                value={direccion}
                onChange={(e) => setDireccion(e.target.value)}
                className="mt-1 w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm text-neutral-900"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <button
              onClick={guardarFiscal}
              className="bg-neutral-900 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              Guardar
            </button>
            {guardado && <span className="text-sm text-exito-700">Guardado</span>}
            {errorFiscal && <span className="text-sm text-peligro-600">{errorFiscal}</span>}
          </div>
          <p className="text-xs text-neutral-500 mt-2">
            La razón social, el RIF y la dirección van en la cabecera de los libros de Compras y de Ventas. La alícuota
            se congela en cada venta facturada al cobrar: cambiarla no altera meses ya cerrados.
          </p>
        </div>

        {resumen && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Kpi titulo="IVA débito (ventas)" ayuda="kpi.iva_debito" valor={resumen.iva_debito} />
            <Kpi titulo="IVA crédito (compras)" ayuda="kpi.iva_credito" valor={resumen.iva_credito} />
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
            <div className="flex flex-wrap justify-between items-center gap-2">
              <input
                value={buscarVentas}
                onChange={(e) => setBuscarVentas(e.target.value)}
                placeholder="Buscar por número de factura o cliente…"
                className="w-full sm:w-72 border border-neutral-300 rounded-lg px-3 py-2 text-sm"
              />
              <div className="flex flex-wrap items-center gap-3">
                <a
                  href={`/api/impuestos/libro-ventas/seniat?${queryRango(rango)}`}
                  className="bg-neutral-900 text-white px-4 py-2 rounded-lg text-sm font-medium"
                >
                  Descargar libro (formato SENIAT)
                </a>
                <a
                  href={`/api/impuestos/libro-ventas/exportar?${queryRango(rango)}`}
                  className="text-sm font-medium text-acento-700 hover:underline"
                >
                  CSV en dólares
                </a>
              </div>
            </div>
            <p className="text-xs text-neutral-500">
              Montos en bolívares, como se declaran: cada venta a la tasa BCV del momento en que se cobró.
            </p>
            {ventas.sin_tasa > 0 && (
              <div className="rounded-lg border border-aviso-200 bg-aviso-50 px-3 py-2 text-sm text-aviso-800">
                {ventas.sin_tasa === 1 ? 'Una venta no tiene' : `${ventas.sin_tasa} ventas no tienen`} monto en
                bolívares: no hay tasa guardada para su fecha. Están marcadas con «sin tasa» y salen vacías en el libro.
              </div>
            )}
            {/* El aviso de "además hubo N ventas sin facturar" salió de aquí:
                el Libro de Ventas es el documento que se le presenta al
                SENIAT, y lo que no se facturó no tiene por qué asomarse en él.
                Esa lectura ahora vive en Reportes, que es donde el dueño mira
                su negocio y no el fisco. */}
            <Tabla orden={ordenVentas} glosario="libroventas" className="bg-white rounded-2xl border border-neutral-200">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
                  <tr>
                    <Th clave="fecha">Fecha</Th>
                    <Th clave="factura">Documento</Th>
                    <Th clave="cliente">Cliente</Th>
                    <Th clave="base" alinear="derecha">Base Bs</Th>
                    <Th clave="iva" alinear="derecha">IVA Bs</Th>
                    <Th clave="total" alinear="derecha">Total Bs</Th>
                    <Th alinear="derecha">Tasa</Th>
                  </tr>
                </thead>
                <tbody>
                  {ordenVentas
                    .ordenar(
                      ventas.filas.filter((f) => {
                        const q = buscarVentas.trim().toLowerCase()
                        if (!q) return true
                        return (
                          f.numero_factura.toLowerCase().includes(q) ||
                          f.cliente.toLowerCase().includes(q)
                        )
                      }),
                    )
                    .map((f) => (
                      <tr key={`${f.tipo}-${f.pedido_id}`} className="border-t border-neutral-100">
                        <td className="p-3 whitespace-nowrap">
                          {new Date(f.fecha).toLocaleDateString('es-VE')}
                        </td>
                        <td className="p-3">
                          {f.tipo === 'NC' ? (
                            <>
                              <span className="font-mono text-xs">NC {f.numero_nota}</span>
                              <span className="block text-xs text-neutral-500">afecta {f.factura_afectada}</span>
                            </>
                          ) : (
                            <span className="font-mono text-xs">{f.numero_factura}</span>
                          )}
                        </td>
                        <td className="p-3">{f.cliente}</td>
                        <td className="text-right p-3 tabular-nums">{bs(f.gravado_bs)}</td>
                        <td className="text-right p-3 tabular-nums">{bs(f.iva_bs)}</td>
                        <td className="text-right p-3 tabular-nums font-semibold">
                          {f.total_bs === null ? <span className="text-aviso-700 font-normal">sin tasa</span> : bs(f.total_bs)}
                        </td>
                        <td className="text-right p-3 tabular-nums text-xs text-neutral-500 whitespace-nowrap">
                          {f.tasa_bcv === null ? '-' : fmtNum(f.tasa_bcv, 2)}
                          <span className="block">${fmtNum(f.total, 2)}</span>
                        </td>
                      </tr>
                    ))}
                  {ventas.filas.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-neutral-400 py-4 text-center">
                        Sin ventas facturadas en este período.
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
                      <td className="text-right p-3 tabular-nums">{bs(ventas.total_gravado_bs)}</td>
                      <td className="text-right p-3 tabular-nums">{bs(ventas.total_iva_bs)}</td>
                      <td className="text-right p-3 tabular-nums">{bs(ventas.total_bs)}</td>
                      <td className="text-right p-3 tabular-nums text-xs font-normal text-neutral-500">
                        ${fmtNum(ventas.total_general, 2)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </Tabla>
          </div>
        )}

        {seccion === 'compras' && compras && (
          <div className="space-y-3">
          <div className="flex flex-wrap justify-between items-center gap-2">
            <input
              value={buscarCompras}
              onChange={(e) => setBuscarCompras(e.target.value)}
              placeholder="Buscar por número de factura o proveedor…"
              className="w-full sm:w-72 border border-neutral-300 rounded-lg px-3 py-2 text-sm"
            />
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={`/api/impuestos/libro-compras/seniat?${queryRango(rango)}`}
                className="bg-neutral-900 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                Descargar libro (formato SENIAT)
              </a>
              <a
                href={`/api/impuestos/libro-compras/exportar?${queryRango(rango)}`}
                className="text-sm font-medium text-acento-700 hover:underline"
              >
                CSV en dólares
              </a>
            </div>
          </div>
          <p className="text-xs text-neutral-500">
            Montos en bolívares, como se declaran: los de las facturas en Bs tal cual el papel, y los de
            las facturas en dólares a la tasa BCV de su fecha (o la que imprime la factura).
          </p>
          {compras.sin_tasa > 0 && (
            <div className="rounded-lg border border-aviso-200 bg-aviso-50 px-3 py-2 text-sm text-aviso-800">
              {compras.sin_tasa === 1 ? 'Una factura no tiene' : `${compras.sin_tasa} facturas no tienen`} monto en
              bolívares: no hay tasa guardada para su fecha. Están marcadas con «sin tasa» y salen vacías en el libro.
            </div>
          )}
          <Tabla orden={ordenCompras} glosario="librocompras" className="bg-white rounded-2xl border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
                <tr>
                  <Th clave="emision">Fecha doc.</Th>
                  <Th clave="fecha">Registro</Th>
                  <Th clave="factura">Documento</Th>
                  <Th clave="proveedor">Proveedor</Th>
                  <Th clave="rif">RIF</Th>
                  <Th clave="exento" alinear="derecha">Exento Bs</Th>
                  <Th clave="base" alinear="derecha">Base Bs</Th>
                  <Th clave="iva" alinear="derecha">IVA Bs</Th>
                  <Th clave="total" alinear="derecha">Total Bs</Th>
                  <Th alinear="derecha">Tasa</Th>
                </tr>
              </thead>
              <tbody>
                {ordenCompras
                  .ordenar(
                    compras.filas.filter((f) => {
                      const q = buscarCompras.trim().toLowerCase()
                      if (!q) return true
                      return (
                        f.numero_factura.toLowerCase().includes(q) ||
                        f.proveedor_nombre.toLowerCase().includes(q)
                      )
                    }),
                  )
                  .map((f) => (
                    <tr key={`${f.tipo}-${f.factura_id}-${f.numero_nota}`} className="border-t border-neutral-100">
                      <td className="p-3 whitespace-nowrap">
                        {new Date(`${f.fecha_emision}T12:00:00`).toLocaleDateString('es-VE')}
                      </td>
                      <td className="p-3 whitespace-nowrap text-neutral-500">
                        {new Date(f.fecha).toLocaleDateString('es-VE')}
                      </td>
                      <td className="p-3">
                        {f.tipo === 'NC' ? (
                          <>
                            <span className="font-mono text-xs">NC {f.numero_nota}</span>
                            <span className="block text-xs text-neutral-500">afecta {f.factura_afectada}</span>
                          </>
                        ) : (
                          <>
                            <span className="font-mono text-xs">{f.numero_factura}</span>
                            {f.numero_control && (
                              <span className="block text-xs text-neutral-500">control {f.numero_control}</span>
                            )}
                          </>
                        )}
                      </td>
                      <td className="p-3">{f.proveedor_nombre}</td>
                      <td className="p-3 text-neutral-500">{f.proveedor_rif || '-'}</td>
                      <td className="text-right p-3 tabular-nums">{bs(f.exento_bs)}</td>
                      <td className="text-right p-3 tabular-nums">{bs(f.gravado_bs)}</td>
                      <td className="text-right p-3 tabular-nums">{bs(f.iva_bs)}</td>
                      <td className="text-right p-3 tabular-nums font-semibold">
                        {f.total_bs === null ? <span className="text-aviso-700 font-normal">sin tasa</span> : bs(f.total_bs)}
                      </td>
                      <td className="text-right p-3 tabular-nums text-xs text-neutral-500 whitespace-nowrap">
                        {f.tasa_bcv === null ? '-' : fmtNum(f.tasa_bcv, 2)}
                        <span className="block">
                          {f.moneda === 'Bs' ? 'factura en Bs' : `$${fmtNum(f.total, 2)}`}
                          {f.tasa_estimada && f.tasa_bcv !== null ? ' · de su fecha' : ''}
                        </span>
                      </td>
                    </tr>
                  ))}
                {compras.filas.length === 0 && (
                  <tr>
                    <td colSpan={10} className="text-neutral-400 py-4 text-center">
                      Sin facturas de compra en este período.
                    </td>
                  </tr>
                )}
              </tbody>
              {compras.filas.length > 0 && (
                <tfoot className="border-t-2 border-neutral-300 font-bold">
                  <tr>
                    <td className="p-3" colSpan={5}>
                      Total
                    </td>
                    <td className="text-right p-3 tabular-nums">{bs(compras.total_exento_bs)}</td>
                    <td className="text-right p-3 tabular-nums">{bs(compras.total_gravado_bs)}</td>
                    <td className="text-right p-3 tabular-nums">{bs(compras.total_iva_bs)}</td>
                    <td className="text-right p-3 tabular-nums">{bs(compras.total_bs)}</td>
                    <td className="text-right p-3 tabular-nums text-xs font-normal text-neutral-500">
                      ${fmtNum(compras.total_general, 2)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </Tabla>
          </div>
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
      setError(e instanceof Error ? e.message : 'Ocurrió un error')
    } finally {
      setOcupado(false)
    }
  }

  async function declarar(p: PeriodoPendiente) {
    const neto = p.iva_debito - p.iva_credito
    const resumen =
      neto > 0
        ? `Quedaría por pagar hasta $${neto.toFixed(2)} (menos el crédito que venga arrastrado).`
        : `El crédito fiscal cubre el débito: no se paga nada y sobran $${Math.abs(neto).toFixed(2)} para el mes siguiente.`
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
            Solo aparecen meses que ya terminaron: el mes en curso todavía puede recibir ventas.
          </p>
          <div className="space-y-2">
            {pendientes.map((p) => (
              <div
                key={`${p.anio}-${p.mes}`}
                className="flex flex-wrap items-center gap-3 bg-aviso-50 rounded-lg p-2 text-sm"
              >
                <span className="font-medium flex-1 min-w-[120px]">{p.etiqueta}</span>
                <span className="text-neutral-600 tabular-nums text-xs">
                  débito ${p.iva_debito.toFixed(2)} · crédito ${p.iva_credito.toFixed(2)}
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
          Tienes ${ultima.credito_excedente.toFixed(2)} de crédito fiscal a favor de{' '}
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
            Sin declaraciones todavía. Se declara cada mes una vez cerrado.
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
                    title="Revierte sus asientos y libera el período"
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
                débito ${d.iva_debito.toFixed(2)} · crédito ${d.iva_credito.toFixed(2)}
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
