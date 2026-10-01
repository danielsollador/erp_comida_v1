import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { conversion } from '../lib/compras'
import type { Equivalencia, Proveedor } from '../lib/types'
import { Modal, Vacio } from './ui'

/**
 * Las piezas de la factura con foto que se usan fuera de la carga: ver el
 * original guardado, y lo que se recuerda de cada proveedor. La carga misma
 * vive en `pages/partes/compras/CargarFactura.tsx`.
 */

/** La foto o el PDF de la factura, a tamaño de lectura. */
export function VistaSoporte({ url, esPdf, alto = 'h-[75vh]' }: { url: string; esPdf: boolean; alto?: string }) {
  return esPdf ? (
    <iframe src={url} title="Factura en PDF" className={`w-full ${alto} rounded-lg border`} />
  ) : (
    <img src={url} alt="Foto de la factura" className="w-full rounded-lg" />
  )
}

/**
 * La foto o el PDF guardado de una factura ya cargada. Se baja primero para
 * saber qué es: la lista de facturas no dice si el soporte es foto o PDF.
 */
export function VerSoporte({ facturaId, onCerrar }: { facturaId: number; onCerrar: () => void }) {
  const [soporte, setSoporte] = useState<{ url: string; esPdf: boolean } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let url = ''
    fetch(api.urlSoporteFactura(facturaId), { credentials: 'same-origin' })
      .then((r) => {
        if (!r.ok) throw new Error('No se pudo abrir el soporte de esta factura')
        return r.blob()
      })
      .then((b) => {
        url = URL.createObjectURL(b)
        setSoporte({ url, esPdf: b.type === 'application/pdf' })
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo abrir'))
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [facturaId])

  return (
    <Modal titulo="Factura del proveedor" onCerrar={onCerrar} ancho="lg">
      {error && <p className="text-peligro-600 text-sm">{error}</p>}
      {soporte && <VistaSoporte url={soporte.url} esPdf={soporte.esPdf} />}
    </Modal>
  )
}

/**
 * Lo que el sistema recuerda de las facturas de cada proveedor. Olvidar una
 * asociación mal aprendida es seguro: la próxima factura la vuelve a aprender
 * de lo que quede guardado.
 */
export function MemoriaProveedores({ proveedores }: { proveedores: Proveedor[] }) {
  const [filas, setFilas] = useState<Equivalencia[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .listarEquivalencias()
      .then(setFilas)
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar'))
  }, [])

  const soloRif = (x: string) => x.toUpperCase().replace(/[^0-9A-Z]/g, '')
  // La ficha manda; sin ficha, como venia en la ultima factura.
  const nombreDe = (e: Equivalencia) =>
    proveedores.find((p) => p.rif && soloRif(p.rif) === e.proveedor_rif)?.nombre || e.proveedor_nombre || e.proveedor_rif

  async function olvidar(e: Equivalencia) {
    setError('')
    try {
      await api.olvidarEquivalencia(e.id)
      setFilas((prev) => (prev ?? []).filter((x) => x.id !== e.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo olvidar')
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 mt-4">
      <h2 className="font-semibold">Lo que se recuerda de sus facturas</h2>
      <p className="text-xs text-neutral-500 mb-3">
        Se aprende al guardar una factura cargada desde foto: qué mercancía es cada renglón y cómo se convierte su
        unidad. La próxima factura de ese proveedor llega con esos renglones ya asociados.
      </p>
      {error && <p className="text-peligro-600 text-sm mb-2">{error}</p>}
      {filas !== null && filas.length === 0 ? (
        <Vacio titulo="Todavía no se recuerda nada" detalle="Carga una factura desde foto y guárdala." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
              <tr>
                <th className="p-2 text-left">Proveedor</th>
                <th className="p-2 text-left">En su factura</th>
                <th className="p-2 text-left">Es</th>
                <th className="p-2 text-left">Conversión</th>
                <th className="p-2 text-right">Facturas</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {(filas ?? []).map((e) => (
                <tr key={e.id} className="border-t border-neutral-100">
                  <td className="p-2">{nombreDe(e)}</td>
                  <td className="p-2 font-mono text-xs">{e.descripcion}</td>
                  <td className="p-2">
                    {e.ingrediente_nombre} <span className="text-neutral-400">({e.unidad})</span>
                  </td>
                  <td className="p-2 text-neutral-500">{conversion(e.factor, e.unidad_papel, e.unidad) || '—'}</td>
                  <td className="p-2 text-right tabular-nums">{e.veces}</td>
                  <td className="p-2 text-right">
                    <button onClick={() => olvidar(e)} className="text-xs text-neutral-500 font-medium">
                      Olvidar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
