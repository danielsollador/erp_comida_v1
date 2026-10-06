import { useCallback, useEffect, useState } from 'react'
import EnlaceDescarga from '../components/EnlaceDescarga'
import { Ayuda } from '../components/Ayuda'
import { explicar } from '../lib/glosario'
import NavBar from '../components/NavBar'
import { useSeccion } from '../components/Secciones'
import BarraFiltros from '../components/BarraFiltros'
import { useRango, queryRango } from '../lib/fechas'
import { useDialogo } from '../components/dialogo'
import { Tabla, Th, useOrden } from '../components/Tabla'
import { Pagina } from '../components/ui'
import { Numerico } from '../components/Teclado'
import { api } from '../lib/api'
import { fmtBs, fmtNum } from '../lib/moneda'
import type {
  ConfiguracionFiscal,
  DeclaracionIva,
  FilaLibroCompras,
  FilaLibroVentas,
  LibroCompras,
  LibroVentas,
  PeriodoPendiente,
  ResumenIva,
  RetencionesQuincena,
} from '../lib/types'

const SECCIONES = [
  { id: 'ventas', texto: 'Libro de ventas' },
  { id: 'compras', texto: 'Libro de compras' },
  { id: 'retenciones', texto: 'Retenciones IVA' },
  { id: 'declaraciones', texto: 'Declaraciones' },
]

/** Un monto en Bs para el libro: sin símbolo (la columna ya lo dice), o un guion. */
function bs(monto: number | null) {
  return monto === null ? '-' : fmtNum(monto, 2)
}

export default function Impuestos() {
  const [seccion, irA] = useSeccion(SECCIONES)
  const dialogo = useDialogo()
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
  const [agenteRetencion, setAgenteRetencion] = useState(false)
  const [errorFiscal, setErrorFiscal] = useState('')
  const [guardado, setGuardado] = useState(false)
  // Revisar una factura puntual (un reclamo, una auditoria) es buscarla, no
  // hojear el libro entero mes por mes.
  const [buscarVentas, setBuscarVentas] = useState('')
  const [buscarCompras, setBuscarCompras] = useState('')

  const cargarLibros = useCallback(() => {
    api.libroVentas(rango).then(setVentas)
    api.libroCompras(rango).then(setCompras)
    api.resumenIva(rango).then(setResumen)
  }, [rango])
  useEffect(() => {
    cargarLibros()
  }, [cargarLibros])

  // El comprobante de retencion que entrega un cliente contribuyente
  // especial: casi siempre el 75 % del IVA, a veces dias despues de la factura.
  async function registrarRetencion(f: FilaLibroVentas) {
    const hoyISO = new Date().toLocaleDateString('en-CA')
    const r = await dialogo.pedir({
      titulo: `Retención de IVA de la factura ${f.numero_factura}`,
      texto: `${f.cliente}${f.rif ? ` (${f.rif})` : ''}. Los datos salen del comprobante que entregó el cliente.`,
      campos: [
        { nombre: 'comprobante', etiqueta: 'N.º de comprobante (14 dígitos)', placeholder: 'AAAAMM00000000' },
        { nombre: 'fecha', etiqueta: 'Fecha del comprobante (AAAA-MM-DD)', valor: hoyISO },
        {
          nombre: 'monto',
          etiqueta: 'IVA retenido (Bs)',
          valor:
            f.retencion_pendiente_bs !== null
              ? f.retencion_pendiente_bs.toFixed(2)
              : f.iva_bs === null
                ? ''
                : (f.iva_bs * 0.75).toFixed(2),
        },
      ],
      aceptar: 'Registrar',
    })
    if (!r) return
    try {
      await api.registrarRetencionRecibida(f.pedido_id, {
        comprobante: r.comprobante,
        fecha: r.fecha,
        monto_bs: Number(String(r.monto).replace(',', '.')),
      })
      cargarLibros()
    } catch (e) {
      await dialogo.avisar({ titulo: 'No se pudo registrar', texto: e instanceof Error ? e.message : 'Intenta de nuevo.' })
    }
  }

  async function quitarRetencion(pedidoId: number) {
    if (!(await dialogo.confirmar({ titulo: '¿Quitar la retención?', texto: 'Deja de descontarse en la declaración.', aceptar: 'Quitar', peligro: true })))
      return
    try {
      await api.quitarRetencionRecibida(pedidoId)
      cargarLibros()
    } catch (e) {
      await dialogo.avisar({ titulo: 'No se pudo quitar', texto: e instanceof Error ? e.message : 'Intenta de nuevo.' })
    }
  }

  // La tasa de un documento del libro: propone la que tiene, o la BCV del dia
  // del documento si no tiene; se puede cambiar por la que diga el papel.
  async function editarTasa(tipo: 'compra' | 'venta', id: number, actual: number | null, fecha: string) {
    let propuesta = actual
    if (propuesta === null) propuesta = (await api.tasaDeFecha(fecha).catch(() => null))?.bcv ?? null
    const r = await dialogo.pedir({
      titulo: 'Tasa de cambio del documento',
      texto: `Bs por dólar con que pasa al libro. Por defecto, la BCV del ${new Date(`${fecha}T12:00:00`).toLocaleDateString('es-VE')}; cámbiala si el papel dice otra.`,
      campos: [{ nombre: 'tasa', etiqueta: 'Tasa (Bs por $)', valor: propuesta === null ? '' : String(propuesta) }],
      aceptar: 'Guardar',
    })
    if (!r) return
    const tasa = Number(String(r.tasa).replace(',', '.'))
    try {
      if (tipo === 'compra') await api.cambiarTasaCompra(id, tasa)
      else await api.cambiarTasaVenta(id, tasa)
      cargarLibros()
    } catch (e) {
      await dialogo.avisar({ titulo: 'No se pudo cambiar la tasa', texto: e instanceof Error ? e.message : 'Intenta de nuevo.' })
    }
  }

  useEffect(() => {
    api.configFiscal().then((c) => {
      setFiscal(c)
      setTasaInput(String(c.tasa_iva))
      setRazonSocial(c.razon_social ?? '')
      setRifEmpresa(c.rif ?? '')
      setDireccion(c.direccion ?? '')
      setAgenteRetencion(Boolean(c.agente_retencion))
    })
  }, [])

  async function guardarFiscal() {
    const valor = Number(tasaInput)
    if (!Number.isFinite(valor) || valor < 0) return setErrorFiscal('La alícuota no es válida.')
    setErrorFiscal('')
    try {
      const c = await api.actualizarConfigFiscal({
        tasa_iva: valor,
        razon_social: razonSocial,
        rif: rifEmpresa,
        direccion,
        agente_retencion: agenteRetencion,
      })
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
      <NavBar titulo="Impuestos" secciones={SECCIONES} seccion={seccion} alCambiarSeccion={irA} />
      <Pagina>
        {seccion !== 'declaraciones' && <BarraFiltros rango={rango} alCambiar={setRango} />}
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
          <label className="flex items-start gap-2 mt-3 text-sm">
            <input
              type="checkbox"
              checked={agenteRetencion}
              onChange={(e) => setAgenteRetencion(e.target.checked)}
              className="w-4 h-4 mt-0.5"
            />
            <span>
              Somos agente de retención de IVA (contribuyente especial)
              <span className="block text-xs text-neutral-500">
                Al cargar una factura de compra se retiene el 75 % o el 100 % de su IVA, con su comprobante, y cada
                quincena sale el TXT para el portal del SENIAT.
              </span>
            </span>
          </label>
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
            <Kpi titulo="IVA débito (ventas)" ayuda="kpi.iva_debito" valor={resumen.iva_debito_bs} />
            <Kpi titulo="IVA crédito (compras)" ayuda="kpi.iva_credito" valor={resumen.iva_credito_bs} />
            <Kpi
              titulo={resumen.iva_a_pagar_bs >= 0 ? 'IVA a pagar' : 'IVA a favor'}
              ayuda="kpi.iva_a_pagar"
              valor={Math.abs(resumen.iva_a_pagar_bs)}
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
                <EnlaceDescarga
                  ruta={`/api/impuestos/libro-ventas/seniat?${queryRango(rango)}`}
                  nombre="libro-de-ventas-seniat.xlsx"
                  className="bg-neutral-900 text-white px-4 py-2 rounded-lg text-sm font-medium"
                >
                  Descargar libro (formato SENIAT)
                </EnlaceDescarga>
                <EnlaceDescarga
                  ruta={`/api/impuestos/libro-ventas/exportar?${queryRango(rango)}`}
                  nombre="libro-de-ventas.csv"
                  className="text-sm font-medium text-acento-700 hover:underline"
                >
                  CSV en dólares
                </EnlaceDescarga>
              </div>
            </div>
            <p className="text-xs text-neutral-500">
              Montos en bolívares, como se declaran: cada venta a la tasa BCV del momento en que se cobró.
            </p>
            {ventas.sin_tasa > 0 && (
              <div className="rounded-lg border border-aviso-200 bg-aviso-50 px-3 py-2 text-sm text-aviso-800">
                {ventas.sin_tasa === 1 ? 'Una venta no tiene' : `${ventas.sin_tasa} ventas no tienen`} monto en
                bolívares: no hay tasa guardada para su fecha. Cárgala con «cargar tasa» en su fila: hasta entonces salen vacías y el mes no se puede declarar.
              </div>
            )}
            {/* El aviso de "además hubo N ventas sin facturar" salió de aquí:
                el Libro de Ventas es el documento que se le presenta al
                SENIAT, y lo que no se facturó no tiene por qué asomarse en él.
                Esa lectura ahora vive en Reportes, que es donde el dueño mira
                su negocio y no el fisco. */}
            <Tabla orden={ordenVentas} glosario="libroventas" className="bg-white rounded-2xl border border-neutral-200">
              <table className="w-full text-sm">
                <thead className="bg-neutral-500/8 text-neutral-500 text-xs uppercase">
                  <tr>
                    <Th clave="fecha">Fecha</Th>
                    <Th clave="factura">Documento</Th>
                    <Th clave="cliente">Cliente</Th>
                    <Th clave="base" alinear="derecha">Base Bs</Th>
                    <Th clave="iva" alinear="derecha">IVA Bs</Th>
                    <Th clave="total" alinear="derecha">Total Bs</Th>
                    <Th alinear="derecha">Tasa</Th>
                    <Th alinear="derecha">Retenido Bs</Th>
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
                          ) : f.tipo === 'RET' ? (
                            <>
                              <span className="text-xs">Retención</span>
                              <span className="block text-xs text-neutral-500">factura {f.factura_afectada}</span>
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
                          <button
                            onClick={() => editarTasa('venta', f.pedido_id, f.tasa_bcv, f.fecha.slice(0, 10))}
                            className={`underline decoration-dotted ${f.tasa_bcv === null ? 'text-aviso-700 font-semibold' : ''}`}
                            title="Cambiar la tasa"
                          >
                            {f.tasa_bcv === null ? 'cargar tasa' : fmtNum(f.tasa_bcv, 2)}
                          </button>
                          <span className="block">${fmtNum(f.total, 2)}</span>
                        </td>
                        <td className="text-right p-3 tabular-nums text-xs whitespace-nowrap">
                          {f.iva_retenido_bs !== null ? (
                            <>
                              <span className="font-semibold text-sm">{bs(f.iva_retenido_bs)}</span>
                              <span className="block text-neutral-500 font-mono">{f.comprobante_retencion}</span>
                              <button onClick={() => quitarRetencion(f.pedido_id)} className="text-peligro-600 underline">
                                quitar
                              </button>
                            </>
                          ) : f.retencion_pendiente_bs !== null ? (
                            <>
                              <span className="block">{bs(f.retencion_pendiente_bs)} retenido en caja</span>
                              <button onClick={() => registrarRetencion(f)} className="text-aviso-700 underline font-semibold">
                                cargar comprobante
                              </button>
                            </>
                          ) : f.tipo === 'FAC' && f.iva_bs !== null ? (
                            <button onClick={() => registrarRetencion(f)} className="text-acento-700 underline">
                              + retención
                            </button>
                          ) : (
                            '-'
                          )}
                        </td>
                      </tr>
                    ))}
                  {ventas.filas.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-neutral-400 py-4 text-center">
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
                      <td className="text-right p-3 tabular-nums">{bs(ventas.total_retenido_bs)}</td>
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
              <EnlaceDescarga
                ruta={`/api/impuestos/libro-compras/seniat?${queryRango(rango)}`}
                nombre="libro-de-compras-seniat.xlsx"
                className="bg-neutral-900 text-white px-4 py-2 rounded-lg text-sm font-medium"
              >
                Descargar libro (formato SENIAT)
              </EnlaceDescarga>
              <EnlaceDescarga
                ruta={`/api/impuestos/libro-compras/exportar?${queryRango(rango)}`}
                nombre="libro-de-compras.csv"
                className="text-sm font-medium text-acento-700 hover:underline"
              >
                CSV en dólares
              </EnlaceDescarga>
            </div>
          </div>
          <p className="text-xs text-neutral-500">
            Montos en bolívares, como se declaran: los de las facturas en Bs tal cual el papel, y los de
            las facturas en dólares a la tasa BCV de su fecha (o la que imprime la factura).
          </p>
          {compras.sin_tasa > 0 && (
            <div className="rounded-lg border border-aviso-200 bg-aviso-50 px-3 py-2 text-sm text-aviso-800">
              {compras.sin_tasa === 1 ? 'Una factura no tiene' : `${compras.sin_tasa} facturas no tienen`} monto en
              bolívares: no hay tasa guardada para su fecha. Cárgala con «cargar tasa» en su fila: hasta entonces salen vacías y el mes no se puede declarar.
            </div>
          )}
          <Tabla orden={ordenCompras} glosario="librocompras" className="bg-white rounded-2xl border border-neutral-200">
            <table className="w-full text-sm">
              <thead className="bg-neutral-500/8 text-neutral-500 text-xs uppercase">
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
                        {f.moneda === 'Bs' && !f.tasa_estimada ? (
                          fmtNum(f.tasa_bcv ?? 0, 2)
                        ) : (
                          <button
                            onClick={() => editarTasa('compra', f.factura_id, f.tasa_bcv, f.fecha_emision)}
                            className={`underline decoration-dotted ${f.tasa_bcv === null ? 'text-aviso-700 font-semibold' : ''}`}
                            title="Cambiar la tasa"
                          >
                            {f.tasa_bcv === null ? 'cargar tasa' : fmtNum(f.tasa_bcv, 2)}
                          </button>
                        )}
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

        {seccion === 'retenciones' && <Retenciones agente={agenteRetencion} />}

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
/**
 * Las retenciones de IVA de una quincena: lo que se le retuvo a cada
 * proveedor, el TXT para el portal del SENIAT y el registro del pago.
 */
function Retenciones({ agente }: { agente: boolean }) {
  const dialogo = useDialogo()
  const hoyD = new Date()
  const [anio, setAnio] = useState(hoyD.getFullYear())
  const [mes, setMes] = useState(hoyD.getMonth() + 1)
  const [quincena, setQuincena] = useState<1 | 2>(hoyD.getDate() <= 15 ? 1 : 2)
  const [datos, setDatos] = useState<RetencionesQuincena | null>(null)
  const [error, setError] = useState('')

  const cargar = useCallback(() => {
    api
      .retencionesIva(anio, mes, quincena)
      .then((d) => {
        setDatos(d)
        setError('')
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar'))
  }, [anio, mes, quincena])
  useEffect(() => {
    cargar()
  }, [cargar])

  function mover(paso: number) {
    // De quincena en quincena: 2da de un mes -> 1ra del siguiente.
    let q = quincena + paso
    let m = mes
    let a = anio
    if (q > 2) {
      q = 1
      m += 1
    } else if (q < 1) {
      q = 2
      m -= 1
    }
    if (m > 12) {
      m = 1
      a += 1
    } else if (m < 1) {
      m = 12
      a -= 1
    }
    setQuincena(q as 1 | 2)
    setMes(m)
    setAnio(a)
  }

  async function enterar() {
    if (!datos) return
    const forma = await dialogo.elegir({
      titulo: `Enterar las retenciones de la ${datos.etiqueta}`,
      texto: `Son ${fmtBs(datos.total_retenido_bs)} para el SENIAT. ¿De dónde sale?`,
      opciones: [
        { valor: 'Banco', texto: 'Por banco' },
        { valor: 'Efectivo', texto: 'En efectivo', detalle: 'Sale de la gaveta.' },
      ],
    })
    if (!forma) return
    try {
      setDatos(await api.enterarRetenciones(anio, mes, quincena, forma))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar')
    }
  }

  const txt = `/api/impuestos/retenciones-iva/txt?anio=${anio}&mes=${mes}&quincena=${quincena}`
  return (
    <div className="space-y-3">
      {!agente && (
        <div className="rounded-lg border border-aviso-200 bg-aviso-50 px-3 py-2 text-sm text-aviso-800">
          Para retener IVA, marca «Somos agente de retención» en Datos fiscales. Hasta entonces las facturas no retienen.
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button onClick={() => mover(-1)} className="px-2 py-1 rounded-lg border border-neutral-300 text-sm" aria-label="Quincena anterior">
            ‹
          </button>
          <span className="font-semibold text-sm min-w-[14rem] text-center">{datos?.etiqueta ?? '…'}</span>
          <button onClick={() => mover(1)} className="px-2 py-1 rounded-lg border border-neutral-300 text-sm" aria-label="Quincena siguiente">
            ›
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <a href={txt} className="bg-neutral-900 text-white px-4 py-2 rounded-lg text-sm font-medium">
            Descargar TXT para el SENIAT
          </a>
          {datos && datos.retenciones.length > 0 && !datos.enterada && (
            <button onClick={enterar} className="text-sm font-medium text-acento-700 hover:underline">
              Registrar pago al SENIAT
            </button>
          )}
          {datos?.enterada && (
            <span className="text-xs text-exito-700 bg-exito-50 rounded-full px-2 py-0.5 font-medium">
              enterada {datos.fecha_enterada ? new Date(datos.fecha_enterada).toLocaleDateString('es-VE') : ''}
            </span>
          )}
        </div>
      </div>
      {error && <p className="text-peligro-600 text-sm">{error}</p>}
      {datos && datos.sin_tasa > 0 && (
        <div className="rounded-lg border border-aviso-200 bg-aviso-50 px-3 py-2 text-sm text-aviso-800">
          {datos.sin_tasa} retención(es) sin tasa de cambio: cárgala en el Libro de compras para poder sacar el TXT.
        </div>
      )}
      {datos && (
        <div className="bg-white rounded-2xl border border-neutral-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
              <tr>
                <th className="text-left p-3">Comprobante</th>
                <th className="text-left p-3">Proveedor</th>
                <th className="text-left p-3">Factura</th>
                <th className="text-right p-3">IVA Bs</th>
                <th className="text-right p-3">%</th>
                <th className="text-right p-3">Retenido Bs</th>
              </tr>
            </thead>
            <tbody>
              {datos.retenciones.map((r) => (
                <tr key={r.factura_id} className="border-t border-neutral-100">
                  <td className="p-3 font-mono text-xs whitespace-nowrap">
                    {r.comprobante}
                    <span className="block text-neutral-500 font-sans">
                      {new Date(`${r.fecha_retencion}T12:00:00`).toLocaleDateString('es-VE')}
                    </span>
                  </td>
                  <td className="p-3">
                    {r.proveedor_nombre}
                    <span className="block text-xs text-neutral-500">{r.proveedor_rif}</span>
                  </td>
                  <td className="p-3 font-mono text-xs">
                    {r.numero_factura}
                    {r.numero_control && <span className="block text-neutral-500">control {r.numero_control}</span>}
                  </td>
                  <td className="text-right p-3 tabular-nums">{bs(r.iva_bs)}</td>
                  <td className="text-right p-3 tabular-nums">{r.porcentaje} %</td>
                  <td className="text-right p-3 tabular-nums font-semibold">{bs(r.retenido_bs)}</td>
                </tr>
              ))}
              {datos.retenciones.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-neutral-400 py-4 text-center">
                    Sin retenciones en esta quincena. El TXT sale vacío: es la declaración en cero.
                  </td>
                </tr>
              )}
            </tbody>
            {datos.retenciones.length > 0 && (
              <tfoot className="border-t-2 border-neutral-300 font-bold">
                <tr>
                  <td className="p-3" colSpan={5}>
                    Total a enterar
                  </td>
                  <td className="text-right p-3 tabular-nums">{bs(datos.total_retenido_bs)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  )
}

/** Lo declarado en Bs; si la declaracion es de antes de existir los Bs, en $. */
function monto(bs: number | null, usd: number) {
  return bs === null ? `$${fmtNum(usd, 2)}` : fmtBs(bs)
}

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
    if (p.sin_tasa > 0) {
      await dialogo.avisar({
        titulo: `Falta la tasa en ${p.etiqueta}`,
        texto: `${p.sin_tasa} documento(s) de ese mes no tienen tasa de cambio, y sin ella no hay bolívares que declarar. Cárgales la tasa desde el libro y vuelve a declarar.`,
      })
      return
    }
    const neto = p.iva_debito_bs - p.iva_credito_bs - p.retenciones_bs
    const resumen =
      neto > 0
        ? `Quedaría por pagar hasta ${fmtBs(neto)} (menos el crédito que venga arrastrado).`
        : `El crédito fiscal cubre el débito: no se paga nada y sobran ${fmtBs(Math.abs(neto))} para el mes siguiente.`
    if (
      !(await dialogo.confirmar({
        titulo: `¿Declarar ${p.etiqueta}?`,
        texto: `IVA cobrado en ventas: ${fmtBs(p.iva_debito_bs)}\nIVA pagado en compras: ${fmtBs(p.iva_credito_bs)}${p.retenciones_bs ? `\nRetenido por clientes: ${fmtBs(p.retenciones_bs)}` : ''}\n\n${resumen}`,
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
      texto: `Son ${monto(d.iva_a_pagar_bs, d.iva_a_pagar)}. ¿De dónde sale?`,
      opciones: [
        { valor: 'Banco', texto: 'Por banco' },
        { valor: 'Efectivo', texto: 'En efectivo', detalle: 'Sale de la gaveta.' },
      ],
    })
    if (!forma) return
    accion(() => api.pagarDeclaracion(d.id, forma))
  }

  // Lo declarado va en Bs; las declaraciones de antes de existir los Bs se
  // muestran en dolares, como se hicieron.
  const aPagar = (d: DeclaracionIva) => d.iva_a_pagar_bs ?? d.iva_a_pagar
  const porPagar = declaraciones.filter((d) => !d.pagada && aPagar(d) > 0)
  const porPagarBs = porPagar.filter((d) => d.iva_a_pagar_bs !== null)
  const porPagarUsd = porPagar.filter((d) => d.iva_a_pagar_bs === null)
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
                  débito {fmtBs(p.iva_debito_bs)} · crédito {fmtBs(p.iva_credito_bs)}
                  {p.sin_tasa > 0 && <span className="text-aviso-700"> · {p.sin_tasa} sin tasa</span>}
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

      {ultima && (ultima.credito_excedente_bs ?? ultima.credito_excedente) > 0 && (
        <div className="bg-exito-50 border border-exito-200 rounded-xl px-3 py-2 text-sm text-exito-800">
          Tienes {monto(ultima.credito_excedente_bs, ultima.credito_excedente)} de crédito fiscal a favor de{' '}
          {ultima.etiqueta}: se descuentan del IVA del mes siguiente.
        </div>
      )}

      <div className="bg-white rounded-2xl border border-neutral-200 p-4">
        <div className="flex flex-wrap justify-between gap-2 mb-3">
          <h2 className="font-semibold">Declaraciones presentadas</h2>
          {porPagar.length > 0 && (
            <span className="text-sm text-peligro-600 font-medium">
              {porPagar.length} sin pagar por{' '}
              {[
                porPagarBs.length ? fmtBs(porPagarBs.reduce((s, d) => s + (d.iva_a_pagar_bs ?? 0), 0)) : '',
                porPagarUsd.length ? `$${fmtNum(porPagarUsd.reduce((s, d) => s + d.iva_a_pagar, 0), 2)}` : '',
              ]
                .filter(Boolean)
                .join(' + ')}
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
                {aPagar(d) > 0 ? (
                  d.pagada ? (
                    <span className="text-xs text-exito-700 bg-exito-50 rounded-full px-2 py-0.5 font-medium">
                      pagada · {d.forma_pago}
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <span className="font-semibold tabular-nums text-peligro-600">
                        {monto(d.iva_a_pagar_bs, d.iva_a_pagar)}
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
                débito {monto(d.iva_debito_bs, d.iva_debito)} · crédito {monto(d.iva_credito_bs, d.iva_credito)}
                {(d.credito_arrastrado_bs ?? d.credito_arrastrado) > 0 &&
                  ` (+ ${monto(d.credito_arrastrado_bs, d.credito_arrastrado)} arrastrado)`}
                {(d.credito_excedente_bs ?? d.credito_excedente) > 0 &&
                  ` · sobran ${monto(d.credito_excedente_bs, d.credito_excedente)}`}
                {(d.retenciones_usadas_bs ?? 0) > 0 && ` · retenciones descontadas ${fmtBs(d.retenciones_usadas_bs ?? 0)}`}
                {(d.retenciones_excedente_bs ?? 0) > 0 && ` · retenciones por descontar ${fmtBs(d.retenciones_excedente_bs ?? 0)}`}
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
      {/* En Bs: es lo que se declara al SENIAT. */}
      <div className={`font-bold tabular-nums ${destacado ? 'text-2xl' : 'text-xl'}`}>{fmtBs(valor)}</div>
    </div>
  )
}
