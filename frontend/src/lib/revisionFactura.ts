import { useEffect, useState } from 'react'
import { api } from './api'
import type { RevisionFactura } from './types'

/**
 * Pide la revisión de una factura de compra (duplicado y precios fuera de lo
 * normal) mientras se llena el formulario, con una pausa para no consultar en
 * cada tecla. Con el formulario vacío no pregunta nada.
 */
export function useRevision(datos: {
  proveedor_rif: string
  proveedor_nombre: string
  numero_factura: string
  /** `costo_unitario` en dólares, como se va a guardar. */
  items: { indice: number; ingrediente_id: number; costo_unitario: number }[]
}): RevisionFactura | null {
  const [revision, setRevision] = useState<{ clave: string; r: RevisionFactura } | null>(null)
  const vacio = !datos.numero_factura && datos.items.length === 0
  const clave = vacio ? '' : JSON.stringify(datos)
  useEffect(() => {
    if (!clave) return
    let vigente = true
    const t = setTimeout(() => {
      api
        .revisarFacturaCompra(JSON.parse(clave))
        .then((r) => vigente && setRevision({ clave, r }))
        .catch(() => undefined)
    }, 400)
    return () => {
      vigente = false
      clearTimeout(t)
    }
  }, [clave])
  // Mientras llega la respuesta a lo nuevo se sigue mostrando la anterior (no
  // parpadea); con el formulario vacio, nada.
  return clave && revision ? revision.r : null
}
