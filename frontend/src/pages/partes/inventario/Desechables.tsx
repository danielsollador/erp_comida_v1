import { useMemo } from 'react'
import { Seccion, Vacio, Boton } from '../../../components/ui'
import { useMoneda } from '../../../lib/moneda'
import type { FacturaCompra, Ingrediente } from '../../../lib/types'

/**
 * Los desechables no se cuentan: servilletas, bolsas, cloro. Van directo a
 * gasto al comprarlos, así que aquí no hay stock que mirar; hay plata. Cuánto
 * se gastó en el período, en qué y a quién se le compró.
 */
export default function Desechables({
  ingredientes,
  facturas,
  nombreRango,
  onAbrir,
  onNueva,
}: {
  ingredientes: Ingrediente[]
  /** Las facturas del período: de ahí sale lo gastado por mercancía y proveedor. */
  facturas: FacturaCompra[]
  nombreRango: string
  onAbrir: (id: number) => void
  onNueva: () => void
}) {
  const { fmt: dinero } = useMoneda()
  const activos = ingredientes.filter((i) => i.activo !== false)

  const gasto = useMemo(() => {
    const porMercancia = new Map<number, { monto: number; cantidad: number; veces: number; ultima: string }>()
    const porProveedor = new Map<string, number>()
    let total = 0
    for (const f of facturas) {
      for (const it of f.items) {
        if (it.tipo !== 'desechable') continue
        total += it.subtotal
        const m = porMercancia.get(it.ingrediente_id) ?? { monto: 0, cantidad: 0, veces: 0, ultima: f.fecha }
        m.monto += it.subtotal
        m.cantidad += it.cantidad
        m.veces += 1
        if (f.fecha > m.ultima) m.ultima = f.fecha
        porMercancia.set(it.ingrediente_id, m)
        porProveedor.set(f.proveedor_nombre, (porProveedor.get(f.proveedor_nombre) ?? 0) + it.subtotal)
      }
    }
    return { total, porMercancia, proveedores: [...porProveedor].sort((a, b) => b[1] - a[1]) }
  }, [facturas])

  const filas = activos
    .map((i) => ({ i, g: gasto.porMercancia.get(i.id) }))
    .sort((a, b) => (b.g?.monto ?? 0) - (a.g?.monto ?? 0) || a.i.nombre.localeCompare(b.i.nombre))

  if (activos.length === 0) {
    return (
      <div className="vp-losa">
        <Vacio
          icono="servilleta"
          titulo="Todavía no hay desechables"
          detalle="Servilletas, bolsas, cloro, papel: lo que no se puede contar por venta. Al cargar una factura con ellos van directo a gasto."
          accion={<Boton onClick={onNueva}>+ Nueva mercancía</Boton>}
        />
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-4 items-start">
      <Seccion
        titulo={`Gastado en desechables · ${nombreRango.toLowerCase()}`}
        ayuda="Sin stock: cada factura va entera al gasto del mes (cuenta 6050). Lo que más pesa, arriba."
        accion={<span className="font-display text-xl font-semibold tabular-nums">{dinero(gasto.total)}</span>}
        plano
      >
        <ul className="divide-y divide-neutral-500/10">
          {filas.map(({ i, g }) => {
            const pct = gasto.total > 0 && g ? (g.monto / gasto.total) * 100 : 0
            return (
              <li key={i.id}>
                <button type="button" onClick={() => onAbrir(i.id)} className="vp-celda w-full text-left px-4 py-3 flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium truncate">{i.nombre}</span>
                    <span className="block text-xs text-neutral-500">
                      {g
                        ? `${g.veces} compra${g.veces === 1 ? '' : 's'} · ${Number(g.cantidad.toFixed(2))} ${i.unidad} · última ${new Date(g.ultima).toLocaleDateString('es-VE')}`
                        : i.costo_reposicion != null
                          ? `Sin compras en el período · último costo ${dinero(i.costo_reposicion)}`
                          : 'Sin compras todavía'}
                    </span>
                    {g && (
                      <span className="mt-1.5 block h-1.5 w-full max-w-xs rounded-full bg-neutral-500/10 overflow-hidden">
                        <span className="block h-full rounded-full bg-aviso-500" style={{ width: `${Math.max(pct, 2)}%` }} />
                      </span>
                    )}
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block font-semibold tabular-nums">{g ? dinero(g.monto) : '—'}</span>
                    {g && <span className="block text-[11px] text-neutral-400 tabular-nums">{pct.toFixed(0)} %</span>}
                  </span>
                  <span aria-hidden className="text-neutral-300 text-lg leading-none">›</span>
                </button>
              </li>
            )
          })}
        </ul>
      </Seccion>

      <Seccion titulo="A quién se le compró" ayuda="Los proveedores de desechables en el período.">
        {gasto.proveedores.length === 0 ? (
          <p className="text-sm text-neutral-500">Sin compras de desechables en este período.</p>
        ) : (
          <ul className="divide-y divide-neutral-500/10 text-sm">
            {gasto.proveedores.map(([nombre, monto]) => (
              <li key={nombre} className="py-2 flex items-center justify-between gap-3">
                <span className="truncate">{nombre}</span>
                <span className="font-semibold tabular-nums shrink-0">{dinero(monto)}</span>
              </li>
            ))}
          </ul>
        )}
      </Seccion>
    </div>
  )
}
