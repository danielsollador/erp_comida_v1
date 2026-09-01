import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import { api } from '../lib/api'
import type { ConfiguracionFiscal, FacturaCompra } from '../lib/types'

const CATEGORIAS = ['Insumos', 'Servicios', 'Activos', 'Otros']
const FORMAS_PAGO = ['Efectivo', 'Banco', 'Credito']

export default function Compras() {
  const [facturas, setFacturas] = useState<FacturaCompra[]>([])
  const [fiscal, setFiscal] = useState<ConfiguracionFiscal>({ tasa_iva: 16 })
  const [error, setError] = useState('')

  const [numeroFactura, setNumeroFactura] = useState('')
  const [proveedor, setProveedor] = useState('')
  const [rif, setRif] = useState('')
  const [categoria, setCategoria] = useState(CATEGORIAS[0])
  const [formaPago, setFormaPago] = useState(FORMAS_PAGO[0])
  const [base, setBase] = useState('')
  const [iva, setIva] = useState('')
  const [descripcion, setDescripcion] = useState('')

  useEffect(() => {
    cargar()
  }, [])

  function cargar() {
    api.listarFacturasCompra().then(setFacturas)
    api.configFiscal().then(setFiscal)
  }

  // Al escribir la base, se sugiere el IVA con la tasa vigente - el usuario
  // puede corregirlo si la factura del proveedor trae un monto distinto.
  function actualizarBase(valor: string) {
    setBase(valor)
    const num = Number(valor)
    if (Number.isFinite(num) && num > 0) {
      setIva((Math.round(num * (fiscal.tasa_iva / 100) * 100) / 100).toString())
    }
  }

  async function agregarFactura() {
    setError('')
    const baseNum = Number(base)
    const ivaNum = Number(iva) || 0
    if (!numeroFactura.trim() || !proveedor.trim() || !Number.isFinite(baseNum) || baseNum <= 0) {
      setError('Completa al menos el numero de factura, el proveedor y la base imponible')
      return
    }
    try {
      await api.crearFacturaCompra({
        numero_factura: numeroFactura.trim(),
        proveedor_nombre: proveedor.trim(),
        proveedor_rif: rif.trim() || undefined,
        categoria,
        forma_pago: formaPago,
        base_imponible: baseNum,
        iva: ivaNum,
        descripcion: descripcion.trim(),
      })
      setNumeroFactura('')
      setProveedor('')
      setRif('')
      setBase('')
      setIva('')
      setDescripcion('')
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la factura')
    }
  }

  async function borrar(id: number) {
    if (!window.confirm('Borrar esta factura? Tambien se borra su asiento contable.')) return
    await api.eliminarFacturaCompra(id)
    cargar()
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Compras" />
      <div className="p-4 max-w-4xl mx-auto space-y-5">
        <div className="bg-white rounded-2xl border border-neutral-200 p-4">
          <h2 className="font-semibold mb-2">Cargar factura de proveedor</h2>
          <p className="text-xs text-neutral-500 mb-3">
            Esto alimenta el Libro de Compras y contabiliza sola: insumos o activos entran al
            balance, servicios van directo a gasto, y el IVA queda como credito fiscal.
          </p>
          {error && <p className="text-red-600 text-sm mb-2">{error}</p>}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
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
                <th className="text-left p-3">Categoria</th>
                <th className="text-right p-3">Base</th>
                <th className="text-right p-3">IVA</th>
                <th className="text-right p-3">Total</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {facturas.map((f) => (
                <tr key={f.id} className="border-t border-neutral-100">
                  <td className="p-3 whitespace-nowrap">{new Date(f.fecha).toLocaleDateString('es-VE')}</td>
                  <td className="p-3 font-mono text-xs">{f.numero_factura}</td>
                  <td className="p-3 font-medium">{f.proveedor_nombre}</td>
                  <td className="p-3 text-neutral-500">{f.categoria}</td>
                  <td className="text-right p-3 tabular-nums">{f.base_imponible.toFixed(2)}</td>
                  <td className="text-right p-3 tabular-nums">{f.iva.toFixed(2)}</td>
                  <td className="text-right p-3 tabular-nums font-semibold">{f.total.toFixed(2)}</td>
                  <td className="p-3">
                    <button onClick={() => borrar(f.id)} className="text-red-500 text-xs">
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
