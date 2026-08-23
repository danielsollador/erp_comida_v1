import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import { api } from '../lib/api'
import type { CierreCaja, Configuracion, ResumenCaja } from '../lib/types'

export default function Caja() {
  const [resumen, setResumen] = useState<ResumenCaja | null>(null)
  const [config, setConfig] = useState<Configuracion>({ tasa_bcv: 0 })
  const [tasaInput, setTasaInput] = useState('')
  const [contado, setContado] = useState('')
  const [nota, setNota] = useState('')
  const [cierres, setCierres] = useState<CierreCaja[]>([])
  const [resultado, setResultado] = useState<CierreCaja | null>(null)

  useEffect(() => {
    cargar()
  }, [])

  function cargar() {
    api.resumenCaja().then(setResumen)
    api.obtenerConfig().then((c) => {
      setConfig(c)
      setTasaInput(String(c.tasa_bcv))
    })
    api.listarCierres().then(setCierres)
  }

  async function guardarTasa() {
    const tasa = Number(tasaInput)
    if (!Number.isFinite(tasa) || tasa < 0) return
    const c = await api.actualizarConfig(tasa)
    setConfig(c)
  }

  async function hacerCierre() {
    const valor = Number(contado)
    if (!Number.isFinite(valor) || valor < 0) return
    const cierre = await api.cerrarCaja(valor, nota)
    setResultado(cierre)
    setContado('')
    setNota('')
    cargar()
  }

  return (
    <div className="min-h-screen bg-neutral-100">
      <NavBar titulo="Cierre de caja" />
      <div className="p-4 max-w-2xl mx-auto space-y-6">
        <div className="bg-white rounded-2xl shadow p-4">
          <h2 className="font-semibold mb-2">Tasa BCV (Bs por USD)</h2>
          <div className="flex gap-2">
            <input
              value={tasaInput}
              onChange={(e) => setTasaInput(e.target.value)}
              type="number"
              step="0.01"
              className="flex-1 border border-neutral-300 rounded-lg px-3 py-2 text-sm"
              placeholder="Ej. 190.50"
            />
            <button
              onClick={guardarTasa}
              className="bg-neutral-900 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              Guardar
            </button>
          </div>
          <p className="text-xs text-neutral-500 mt-2">
            Se usa para mostrar el equivalente en bolivares al cobrar. Actualizala tu mismo cada dia
            (no se consulta ninguna fuente externa).
          </p>
        </div>

        {resumen && (
          <div className="bg-white rounded-2xl shadow p-4">
            <h2 className="font-semibold mb-3">Ventas de hoy ({resumen.fecha})</h2>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="bg-neutral-50 rounded-xl p-3">
                <div className="text-xs text-neutral-500">Total vendido</div>
                <div className="text-xl font-bold">${resumen.total_ventas.toFixed(2)}</div>
              </div>
              <div className="bg-neutral-50 rounded-xl p-3">
                <div className="text-xs text-neutral-500">Pedidos cobrados</div>
                <div className="text-xl font-bold">{resumen.cantidad_pedidos}</div>
              </div>
            </div>
            <div className="text-sm space-y-1">
              {Object.entries(resumen.por_metodo_pago).map(([metodo, monto]) => (
                <div key={metodo} className="flex justify-between">
                  <span className="text-neutral-600">{metodo}</span>
                  <span className="font-medium">${monto.toFixed(2)}</span>
                </div>
              ))}
              {Object.keys(resumen.por_metodo_pago).length === 0 && (
                <p className="text-neutral-400">Aun no hay ventas cobradas hoy.</p>
              )}
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow p-4">
          <h2 className="font-semibold mb-2">Contar efectivo fisico</h2>
          <p className="text-sm text-neutral-500 mb-3">
            Efectivo esperado segun el sistema:{' '}
            <span className="font-semibold text-neutral-800">
              ${resumen?.efectivo_esperado.toFixed(2) ?? '0.00'}
            </span>
          </p>
          <div className="flex gap-2 mb-2">
            <input
              value={contado}
              onChange={(e) => setContado(e.target.value)}
              type="number"
              step="0.01"
              placeholder="Cuanto efectivo hay en caja"
              className="flex-1 border border-neutral-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <input
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Nota (opcional)"
            className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mb-3"
          />
          <button
            onClick={hacerCierre}
            disabled={!contado}
            className="w-full bg-blue-600 text-white rounded-xl py-3 font-medium disabled:opacity-30"
          >
            Cerrar caja
          </button>

          {resultado && (
            <div
              className={`mt-4 rounded-xl p-3 text-sm ${
                resultado.diferencia === 0
                  ? 'bg-green-50 text-green-800'
                  : 'bg-amber-50 text-amber-800'
              }`}
            >
              {resultado.diferencia === 0 && 'Cuadra exacto. Buen cierre.'}
              {resultado.diferencia > 0 &&
                `Sobran $${resultado.diferencia.toFixed(2)} respecto a lo esperado.`}
              {resultado.diferencia < 0 &&
                `Faltan $${Math.abs(resultado.diferencia).toFixed(2)} respecto a lo esperado.`}
            </div>
          )}
        </div>

        {cierres.length > 0 && (
          <div className="bg-white rounded-2xl shadow p-4">
            <h2 className="font-semibold mb-2">Historial de cierres</h2>
            <table className="w-full text-sm">
              <thead className="text-neutral-500">
                <tr>
                  <th className="text-left py-1">Fecha</th>
                  <th className="text-right py-1">Sistema</th>
                  <th className="text-right py-1">Contado</th>
                  <th className="text-right py-1">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {cierres.map((c) => (
                  <tr key={c.id} className="border-t border-neutral-100">
                    <td className="py-1">{new Date(c.fecha).toLocaleString('es-VE')}</td>
                    <td className="text-right py-1">${c.efectivo_esperado.toFixed(2)}</td>
                    <td className="text-right py-1">${c.efectivo_contado.toFixed(2)}</td>
                    <td
                      className={`text-right py-1 font-medium ${
                        c.diferencia === 0
                          ? 'text-green-600'
                          : c.diferencia < 0
                            ? 'text-red-600'
                            : 'text-amber-600'
                      }`}
                    >
                      {c.diferencia > 0 ? '+' : ''}
                      {c.diferencia.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
