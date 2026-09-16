import { useEffect, useMemo, useState } from 'react'
import NavBar from '../components/NavBar'
import { Tabla, Th, useOrden } from '../components/Tabla'
import { Pagina } from '../components/ui'
import { api } from '../lib/api'
import type { ConfiguracionFiscal, FacturaCompra, Ingrediente } from '../lib/types'

const CATEGORIAS = ['Insumos', 'Servicios', 'Activos', 'Otros']
const FORMAS_PAGO = ['Efectivo', 'Efectivo $', 'Banco', 'Credito']

type Linea = { ingrediente_id: number; cantidad: string; costo_unitario: string }

export default function Compras() {
  const [facturas, setFacturas] = useState<FacturaCompra[]>([])
  // Lo mas reciente arriba, que es lo que se acaba de cargar; pero ordenar por
  // Estado junta lo pendiente de pagar, que es la otra razon para entrar aqui.
  const orden = useOrden<FacturaCompra>(
    {
      fecha: (f) => new Date(f.fecha),
      factura: (f) => f.numero_factura,
      proveedor: (f) => f.proveedor_nombre,
      base: (f) => f.base_imponible,
      iva: (f) => f.iva,
      total: (f) => f.total,
      estado: (f) => (f.pagada ? 'Pagada' : 'Pendiente'),
    },
    '-fecha',
  )
  const [ingredientes, setIngredientes] = useState<Ingrediente[]>([])
  const [fiscal, setFiscal] = useState<ConfiguracionFiscal>({ tasa_iva: 16 })
  const [error, setError] = useState('')

  const [numeroFactura, setNumeroFactura] = useState('')
  const [proveedor, setProveedor] = useState('')
  const [rif, setRif] = useState('')
  const [categoria, setCategoria] = useState(CATEGORIAS[0])
  const [formaPago, setFormaPago] = useState(FORMAS_PAGO[0])
  const [descripcion, setDescripcion] = useState('')

  // Con insumos: renglones por ingrediente, que reabastecen el stock solos.
  const [lineas, setLineas] = useState<Linea[]>([{ ingrediente_id: 0, cantidad: '', costo_unitario: '' }])
  // Sin insumos (servicios, activos...): un monto suelto, como antes.
  const [base, setBase] = useState('')
  const [iva, setIva] = useState('')
  const [fechaVencimiento, setFechaVencimiento] = useState('')
  // Cuantos meses dura el equipo. Define la cuota de depreciacion mensual.
  const [vidaUtil, setVidaUtil] = useState('60')

  // Con que forma de pago se va a saldar cada factura a credito pendiente -
  // una por fila, para el boton "Marcar pagada" de cuentas por pagar.
  const [liquidacion, setLiquidacion] = useState<Record<number, string>>({})
  const [pagando, setPagando] = useState<number | null>(null)

  const esInsumos = categoria === 'Insumos'
  const esCredito = formaPago === 'Credito'
  const esActivo = categoria === 'Activos'

  useEffect(() => {
    cargar()
  }, [])

  function cargar() {
    api.listarFacturasCompra().then(setFacturas)
    api.listarIngredientes().then(setIngredientes)
    api.configFiscal().then(setFiscal)
  }

  const baseLineas = useMemo(
    () =>
      lineas.reduce((sum, l) => {
        const cantidad = Number(l.cantidad) || 0
        const costo = Number(l.costo_unitario) || 0
        return sum + cantidad * costo
      }, 0),
    [lineas],
  )
  const ivaLineas = useMemo(
    () => Math.round(baseLineas * (fiscal.tasa_iva / 100) * 100) / 100,
    [baseLineas, fiscal.tasa_iva],
  )

  function actualizarLinea(i: number, campo: keyof Linea, valor: string) {
    setLineas((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, [campo]: campo === 'ingrediente_id' ? Number(valor) : valor } : l)),
    )
  }

  function agregarLinea() {
    setLineas((prev) => [...prev, { ingrediente_id: 0, cantidad: '', costo_unitario: '' }])
  }

  function quitarLinea(i: number) {
    setLineas((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))
  }

  // Al escribir un costo unitario, se rellena con lo que ya cuesta ese insumo
  // hoy en el sistema - el dueno solo corrige si el proveedor le vendio distinto.
  function elegirIngrediente(i: number, ingredienteId: string) {
    const ing = ingredientes.find((x) => x.id === Number(ingredienteId))
    setLineas((prev) =>
      prev.map((l, idx) =>
        idx === i
          ? {
              ...l,
              ingrediente_id: Number(ingredienteId),
              costo_unitario: l.costo_unitario || (ing ? String(ing.costo_unitario) : ''),
            }
          : l,
      ),
    )
  }

  // Al escribir la base (solo cuando NO es Insumos), se sugiere el IVA con la
  // tasa vigente - el usuario puede corregirlo si la factura trae otro monto.
  function actualizarBase(valor: string) {
    setBase(valor)
    const num = Number(valor)
    if (Number.isFinite(num) && num > 0) {
      setIva((Math.round(num * (fiscal.tasa_iva / 100) * 100) / 100).toString())
    }
  }

  function limpiarFormulario() {
    setNumeroFactura('')
    setProveedor('')
    setRif('')
    setDescripcion('')
    setLineas([{ ingrediente_id: 0, cantidad: '', costo_unitario: '' }])
    setBase('')
    setIva('')
    setFechaVencimiento('')
  }

  async function agregarFactura() {
    setError('')
    if (!numeroFactura.trim() || !proveedor.trim()) {
      setError('Completa al menos el numero de factura y el proveedor')
      return
    }

    try {
      if (esInsumos) {
        const items = lineas
          .filter((l) => l.ingrediente_id && Number(l.cantidad) > 0 && Number(l.costo_unitario) >= 0)
          .map((l) => ({
            ingrediente_id: l.ingrediente_id,
            cantidad: Number(l.cantidad),
            costo_unitario: Number(l.costo_unitario),
          }))
        if (items.length === 0) {
          setError('Agrega al menos un insumo con cantidad y costo')
          return
        }
        await api.crearFacturaCompra({
          numero_factura: numeroFactura.trim(),
          proveedor_nombre: proveedor.trim(),
          proveedor_rif: rif.trim() || undefined,
          categoria,
          forma_pago: formaPago,
          descripcion: descripcion.trim(),
          items,
          iva: ivaLineas,
          fecha_vencimiento: esCredito && fechaVencimiento ? fechaVencimiento : undefined,
        })
      } else {
        const baseNum = Number(base)
        if (!Number.isFinite(baseNum) || baseNum <= 0) {
          setError('La base imponible debe ser mayor a cero')
          return
        }
        await api.crearFacturaCompra({
          numero_factura: numeroFactura.trim(),
          proveedor_nombre: proveedor.trim(),
          proveedor_rif: rif.trim() || undefined,
          categoria,
          forma_pago: formaPago,
          descripcion: descripcion.trim(),
          base_imponible: baseNum,
          iva: Number(iva) || 0,
          fecha_vencimiento: esCredito && fechaVencimiento ? fechaVencimiento : undefined,
          vida_util_meses: esActivo ? Number(vidaUtil) || 60 : undefined,
        })
      }
      limpiarFormulario()
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la factura')
    }
  }

  async function notaCredito(f: FacturaCompra) {
    // El espejo de la devolucion de venta. Sin esto, el unico camino era un
    // ajuste de inventario, que registra la diferencia como MERMA: una perdida
    // que no ocurrio, credito fiscal de mas en el Libro de Compras y una deuda
    // inflada con el proveedor.
    const tipo = window.confirm(
      `Nota de credito de ${f.proveedor_nombre} sobre la factura ${f.numero_factura}.\n\n` +
        'Aceptar = DEVOLUCION (la mercancia vuelve al proveedor)\n' +
        'Cancelar = DESCUENTO (te quedas la mercancia y te rebajan el precio)',
    )
      ? 'devolucion'
      : 'descuento'

    const numero = window.prompt('Numero de la nota de credito que emitio el proveedor')
    if (!numero) return
    const motivo = window.prompt('Motivo (mando menos, llego dañado, descuento...)') ?? ''

    if (tipo === 'descuento') {
      const montoTxt = window.prompt('Cuanto te acreditaron, sin IVA?')
      if (!montoTxt) return
      const base = Number(montoTxt)
      if (!Number.isFinite(base) || base <= 0) return
      await accionFactura(() =>
        api.crearNotaCredito(f.id, { numero, tipo, motivo, base_imponible: base }),
      )
      return
    }

    // Devolucion: hay que decir de que insumos y cuanto vuelve de cada uno.
    const items: { ingrediente_id: number; cantidad: number }[] = []
    for (const it of f.items) {
      const txt = window.prompt(
        `Cuanto vuelve de ${it.ingrediente_nombre}? (la factura trae ${it.cantidad} ${it.unidad})`,
        '0',
      )
      if (txt === null) return
      const cantidad = Number(txt)
      if (Number.isFinite(cantidad) && cantidad > 0) {
        items.push({ ingrediente_id: it.ingrediente_id, cantidad })
      }
    }
    if (items.length === 0) {
      window.alert('No se indico ninguna cantidad a devolver.')
      return
    }
    await accionFactura(() => api.crearNotaCredito(f.id, { numero, tipo, motivo, items }))
  }

  async function accionFactura(fn: () => Promise<unknown>) {
    try {
      await fn()
      cargar()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'No se pudo registrar la nota de credito')
    }
  }

  async function borrar(f: FacturaCompra) {
    const aviso =
      f.items.length > 0
        ? 'Esta factura ya actualizo el stock de sus insumos, asi que no se puede borrar.'
        : 'Borrar esta factura? Tambien se borra su asiento contable.'
    if (f.items.length > 0) {
      window.alert(aviso)
      return
    }
    if (!window.confirm(aviso)) return
    try {
      await api.eliminarFacturaCompra(f.id)
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo borrar')
    }
  }

  async function marcarPagada(f: FacturaCompra) {
    setError('')
    setPagando(f.id)
    try {
      await api.pagarFacturaCompra(f.id, liquidacion[f.id] || 'Efectivo')
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar el pago')
    } finally {
      setPagando(null)
    }
  }

  const hoy = new Date()
  const pendientes = facturas
    .filter((f) => f.forma_pago === 'Credito' && !f.pagada)
    .sort((a, b) => {
      const va = a.fecha_vencimiento ? new Date(a.fecha_vencimiento).getTime() : Infinity
      const vb = b.fecha_vencimiento ? new Date(b.fecha_vencimiento).getTime() : Infinity
      return va - vb
    })
  const totalPendiente = pendientes.reduce((sum, f) => sum + f.total, 0)

  function diasVencida(f: FacturaCompra): number | null {
    if (!f.fecha_vencimiento) return null
    const dias = Math.floor((hoy.getTime() - new Date(f.fecha_vencimiento).getTime()) / 86400000)
    return dias
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Compras" />
      <Pagina>
        <div className="bg-white rounded-2xl border border-neutral-200 p-4">
          <h2 className="font-semibold mb-2">Cargar factura de proveedor</h2>
          <p className="text-xs text-neutral-500 mb-3">
            {esInsumos
              ? 'Cada renglon reabastece el stock del insumo y recalcula su costo promedio - no hace falta cargarlo aparte en Inventario.'
              : 'Alimenta el Libro de Compras y contabiliza sola: activos entran al balance, servicios van directo a gasto.'}
          </p>
          {error && <p className="text-peligro-600 text-sm mb-2">{error}</p>}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
            <input
              value={numeroFactura}
              onChange={(e) => setNumeroFactura(e.target.value)}
              placeholder="N. de factura"
              className="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
            />
            <input
              value={proveedor}
              onChange={(e) => setProveedor(e.target.value)}
              placeholder="Proveedor"
              className="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
            />
            <input
              value={rif}
              onChange={(e) => setRif(e.target.value)}
              placeholder="RIF (opcional)"
              className="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
            />
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="border border-neutral-300 rounded-lg px-2 py-2 text-sm"
            >
              {CATEGORIAS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={formaPago}
              onChange={(e) => setFormaPago(e.target.value)}
              className="border border-neutral-300 rounded-lg px-2 py-2 text-sm"
            >
              {FORMAS_PAGO.map((f) => (
                <option key={f} value={f}>
                  {f === 'Credito' ? 'A credito (por pagar)' : f}
                </option>
              ))}
            </select>
            <input
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Descripcion (opcional)"
              className="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
            />
            {esCredito && (
              <label className="flex items-center gap-2 text-sm text-neutral-500 border border-neutral-300 rounded-lg px-3 py-2">
                Vence
                <input
                  value={fechaVencimiento}
                  onChange={(e) => setFechaVencimiento(e.target.value)}
                  type="date"
                  className="flex-1 outline-none text-neutral-800"
                />
              </label>
            )}
            {/* Un equipo se gasta con los años: sin este dato entraba al
                balance a valor de compra y se quedaba ahi para siempre. */}
            {esActivo && (
              <label className="flex items-center gap-2 text-sm text-neutral-500 border border-neutral-300 rounded-lg px-3 py-2">
                Dura
                <input
                  value={vidaUtil}
                  onChange={(e) => setVidaUtil(e.target.value)}
                  type="number"
                  min="1"
                  className="w-16 outline-none text-neutral-800 text-right"
                />
                meses
              </label>
            )}
          </div>

          {esInsumos ? (
            <div className="space-y-2 mb-3">
              {lineas.map((l, i) => {
                const ing = ingredientes.find((x) => x.id === l.ingrediente_id)
                const subtotal = (Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0)
                return (
                  <div key={i} className="flex flex-wrap gap-2 items-center bg-neutral-50 rounded-lg p-2">
                    <select
                      value={l.ingrediente_id}
                      onChange={(e) => elegirIngrediente(i, e.target.value)}
                      className="flex-1 min-w-[140px] border border-neutral-300 rounded-lg px-2 py-1.5 text-sm"
                    >
                      <option value={0}>Insumo...</option>
                      {ingredientes.map((ing2) => (
                        <option key={ing2.id} value={ing2.id}>
                          {ing2.nombre} ({ing2.unidad})
                        </option>
                      ))}
                    </select>
                    <input
                      value={l.cantidad}
                      onChange={(e) => actualizarLinea(i, 'cantidad', e.target.value)}
                      placeholder={`Cantidad${ing ? ` (${ing.unidad})` : ''}`}
                      type="number"
                      step="0.01"
                      className="w-28 border border-neutral-300 rounded-lg px-2 py-1.5 text-sm"
                    />
                    <input
                      value={l.costo_unitario}
                      onChange={(e) => actualizarLinea(i, 'costo_unitario', e.target.value)}
                      placeholder="Costo/unidad sin IVA"
                      type="number"
                      step="0.01"
                      className="w-32 border border-neutral-300 rounded-lg px-2 py-1.5 text-sm"
                    />
                    <span className="text-sm font-medium text-neutral-600 w-20 text-right">
                      ${subtotal.toFixed(2)}
                    </span>
                    <button
                      onClick={() => quitarLinea(i)}
                      className="text-peligro-400 text-sm px-1"
                      disabled={lineas.length === 1}
                    >
                      x
                    </button>
                  </div>
                )
              })}
              <button onClick={agregarLinea} className="text-sm text-neutral-500 font-medium">
                + insumo
              </button>
              <div className="flex justify-end gap-6 text-sm pt-2 border-t border-neutral-200">
                <span className="text-neutral-500">
                  Base <span className="font-semibold text-neutral-800">${baseLineas.toFixed(2)}</span>
                </span>
                <span className="text-neutral-500">
                  IVA ({fiscal.tasa_iva}%){' '}
                  <span className="font-semibold text-neutral-800">${ivaLineas.toFixed(2)}</span>
                </span>
                <span className="text-neutral-500">
                  Total{' '}
                  <span className="font-bold text-neutral-900">${(baseLineas + ivaLineas).toFixed(2)}</span>
                </span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
              <input
                value={base}
                onChange={(e) => actualizarBase(e.target.value)}
                placeholder="Base imponible"
                type="number"
                step="0.01"
                className="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
              />
              <input
                value={iva}
                onChange={(e) => setIva(e.target.value)}
                placeholder={`IVA (${fiscal.tasa_iva}%)`}
                type="number"
                step="0.01"
                className="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
              />
              <div className="flex items-center justify-between bg-neutral-50 rounded-lg px-3 text-sm font-medium">
                <span className="text-neutral-500">Total</span>
                <span>${((Number(base) || 0) + (Number(iva) || 0)).toFixed(2)}</span>
              </div>
            </div>
          )}

          <button
            onClick={agregarFactura}
            className="bg-neutral-900 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Cargar factura
          </button>
        </div>

        {pendientes.length > 0 && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-4">
            <div className="flex justify-between items-baseline mb-3">
              <h2 className="font-semibold">Cuentas por pagar</h2>
              <span className="text-sm text-neutral-500">
                Debemos <span className="font-semibold text-neutral-800">${totalPendiente.toFixed(2)}</span>
              </span>
            </div>
            <div className="space-y-2">
              {pendientes.map((f) => {
                const dias = diasVencida(f)
                const vencida = dias !== null && dias > 0
                return (
                  <div
                    key={f.id}
                    className={`flex flex-wrap items-center gap-2 rounded-lg p-2 text-sm ${
                      vencida ? 'bg-peligro-50' : 'bg-neutral-50'
                    }`}
                  >
                    <span className="font-medium flex-1 min-w-[140px]">{f.proveedor_nombre}</span>
                    <span className="text-neutral-500 font-mono text-xs">{f.numero_factura}</span>
                    <span
                      className={`text-xs ${vencida ? 'text-peligro-600 font-semibold' : 'text-neutral-500'}`}
                    >
                      {f.fecha_vencimiento
                        ? vencida
                          ? `Vencida hace ${dias} dias`
                          : `Vence ${new Date(f.fecha_vencimiento).toLocaleDateString('es-VE')}`
                        : 'Sin fecha de vencimiento'}
                    </span>
                    <span className="font-semibold tabular-nums w-20 text-right">${f.total.toFixed(2)}</span>
                    <select
                      value={liquidacion[f.id] || 'Efectivo'}
                      onChange={(e) => setLiquidacion((prev) => ({ ...prev, [f.id]: e.target.value }))}
                      className="border border-neutral-300 rounded-lg px-2 py-1 text-xs"
                    >
                      <option value="Efectivo">Efectivo</option>
                      <option value="Banco">Banco</option>
                    </select>
                    <button
                      onClick={() => marcarPagada(f)}
                      disabled={pagando === f.id}
                      className="bg-neutral-900 text-white rounded-lg px-3 py-1 text-xs font-medium disabled:opacity-50"
                    >
                      Marcar pagada
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <Tabla orden={orden} className="bg-white rounded-2xl border border-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
              <tr>
                <Th clave="fecha">Fecha</Th>
                <Th clave="factura">Factura</Th>
                <Th clave="proveedor">Proveedor</Th>
                <Th>Detalle</Th>
                <Th clave="base" alinear="derecha">Base</Th>
                <Th clave="iva" alinear="derecha">IVA</Th>
                <Th clave="total" alinear="derecha">Total</Th>
                <Th clave="estado">Estado</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {orden.ordenar(facturas).map((f) => (
                <tr key={f.id} className="border-t border-neutral-100 align-top">
                  <td className="p-3 whitespace-nowrap">{new Date(f.fecha).toLocaleDateString('es-VE')}</td>
                  <td className="p-3 font-mono text-xs">{f.numero_factura}</td>
                  <td className="p-3 font-medium">{f.proveedor_nombre}</td>
                  <td className="p-3 text-neutral-500">
                    {f.items.length > 0 ? (
                      <ul className="space-y-0.5">
                        {f.items.map((it) => (
                          <li key={it.id} className="text-xs">
                            {it.cantidad} {it.unidad} {it.ingrediente_nombre}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      f.categoria
                    )}
                  </td>
                  <td className="text-right p-3 tabular-nums">{f.base_imponible.toFixed(2)}</td>
                  <td className="text-right p-3 tabular-nums">{f.iva.toFixed(2)}</td>
                  <td className="text-right p-3 tabular-nums font-semibold">
                    {f.total.toFixed(2)}
                    <button
                      onClick={() => notaCredito(f)}
                      className="block w-full text-right text-[11px] font-medium text-acento-600"
                      title="El proveedor mando menos, o te dio un descuento"
                    >
                      Nota de credito
                    </button>
                  </td>
                  <td className="p-3">
                    {f.forma_pago === 'Credito' ? (
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          f.pagada
                            ? 'bg-exito-50 text-exito-700'
                            : 'bg-aviso-50 text-aviso-700'
                        }`}
                      >
                        {f.pagada ? 'Pagada' : 'Pendiente'}
                      </span>
                    ) : (
                      <span className="text-neutral-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    <button onClick={() => borrar(f)} className="text-peligro-500 text-xs">
                      Borrar
                    </button>
                  </td>
                </tr>
              ))}
              {facturas.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-neutral-400 py-4 text-center">
                    Sin facturas cargadas todavia.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Tabla>
      </Pagina>
    </div>
  )
}
