import { useEffect, useMemo, useState } from 'react'
import NavBar from '../components/NavBar'
import { api } from '../lib/api'
import type { ConfiguracionFiscal, FacturaCompra, Ingrediente } from '../lib/types'

const CATEGORIAS = ['Insumos', 'Servicios', 'Activos', 'Otros']
const FORMAS_PAGO = ['Efectivo', 'Banco', 'Credito']

type Linea = { ingrediente_id: number; cantidad: string; costo_unitario: string }

export default function Compras() {
  const [facturas, setFacturas] = useState<FacturaCompra[]>([])
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

  const esInsumos = categoria === 'Insumos'

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
        })
      }
      limpiarFormulario()
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la factura')
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

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Compras" />
      <div className="p-4 max-w-4xl mx-auto space-y-5">
        <div className="bg-white rounded-2xl border border-neutral-200 p-4">
          <h2 className="font-semibold mb-2">Cargar factura de proveedor</h2>
          <p className="text-xs text-neutral-500 mb-3">
            {esInsumos
              ? 'Cada renglon reabastece el stock del insumo y recalcula su costo promedio - no hace falta cargarlo aparte en Inventario.'
              : 'Alimenta el Libro de Compras y contabiliza sola: activos entran al balance, servicios van directo a gasto.'}
          </p>
          {error && <p className="text-red-600 text-sm mb-2">{error}</p>}

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
                      className="text-red-400 text-sm px-1"
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
            <div className="grid grid-cols-3 gap-2 mb-3">
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

        <div className="bg-white rounded-2xl border border-neutral-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
              <tr>
                <th className="text-left p-3">Fecha</th>
                <th className="text-left p-3">Factura</th>
                <th className="text-left p-3">Proveedor</th>
                <th className="text-left p-3">Detalle</th>
                <th className="text-right p-3">Base</th>
                <th className="text-right p-3">IVA</th>
                <th className="text-right p-3">Total</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {facturas.map((f) => (
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
                  <td className="text-right p-3 tabular-nums font-semibold">{f.total.toFixed(2)}</td>
                  <td className="p-3">
                    <button onClick={() => borrar(f)} className="text-red-500 text-xs">
                      Borrar
                    </button>
                  </td>
                </tr>
              ))}
              {facturas.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-neutral-400 py-4 text-center">
                    Sin facturas cargadas todavia.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
