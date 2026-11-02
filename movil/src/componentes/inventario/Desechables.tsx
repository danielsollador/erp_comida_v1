import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useMoneda } from '../../lib/moneda'
import { fechaCorta } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import type { FacturaCompra, Ingrediente } from '../../lib/tipos'
import Icono from '../Icono'
import { ListaFicha, useDisposicion, Vacio } from '../kit'
import { Pulsable } from '../ui'
import { ir, unidadDe } from './comun'

/*
 * LOS DESECHABLES (pages/partes/inventario/Desechables.tsx): servilletas,
 * bolsas, cloro. No se cuentan: van directo a gasto al comprarlos, asi que
 * aqui no hay stock que mirar; hay plata. Cuanto se gasto en el periodo, en
 * que y a quien se le compro. En la tablet, lo gastado y los proveedores
 * van lado a lado, como en la web.
 */
export default function Desechables({ ingredientes, facturas }: { ingredientes: Ingrediente[]; facturas: FacturaCompra[] }) {
  const t = useTema()
  const { fmt } = useMoneda()
  const { tablet } = useDisposicion()
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
      <Vacio
        icono="servilleta"
        titulo="Todavía no hay desechables"
        detalle="Servilletas, bolsas, cloro, papel: lo que no se puede contar por venta. Al cargar una factura con ellos van directo a gasto."
        accion={{ texto: '+ Nueva mercancía', alTocar: () => ir('/inventario/mercancia/nueva?tipo=desechable') }}
      />
    )
  }

  const lista = (
    <ListaFicha>
      <View style={s.cabeza}>
        <View style={{ flex: 1 }}>
          <Text style={[s.titulo, { color: t.tinta }]}>Gastado en desechables · últimos 30 días</Text>
          <Text style={[s.ayuda, { color: t.suave }]}>
            Sin stock: cada factura va entera al gasto del mes (cuenta 6050). Lo que más pesa, arriba.
          </Text>
        </View>
        <Text style={[s.total, { color: t.tinta }]}>{fmt(gasto.total)}</Text>
      </View>
      {filas.map(({ i, g }, n) => {
        const pct = gasto.total > 0 && g ? (g.monto / gasto.total) * 100 : 0
        return (
          <Pulsable key={i.id} alTocar={() => ir(`/inventario/mercancia/${i.id}`)} etiqueta={i.nombre}>
            <View style={[s.renglon, n < filas.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[s.nombre, { color: t.tinta }]} numberOfLines={2}>
                  {i.nombre}
                </Text>
                <Text style={[s.detalle, { color: t.suave }]}>
                  {g
                    ? `${g.veces} compra${g.veces === 1 ? '' : 's'} · ${Number(g.cantidad.toFixed(2))} ${unidadDe(g.cantidad, i.unidad)} · última ${fechaCorta(g.ultima)}`
                    : i.costo_reposicion != null
                      ? `Sin compras en el período · último costo ${fmt(i.costo_reposicion)}`
                      : 'Sin compras todavía'}
                </Text>
                {g ? (
                  <View style={[s.barra, { backgroundColor: t.gris100 }]}>
                    <View style={[s.barraLlena, { width: `${Math.max(pct, 2)}%`, backgroundColor: t.aviso }]} />
                  </View>
                ) : null}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[s.monto, { color: t.tinta }]}>{g ? fmt(g.monto) : '—'}</Text>
                {g ? <Text style={[s.detalle, { color: t.tenue }]}>{pct.toFixed(0)} %</Text> : null}
              </View>
              <Icono nombre="chevron" size={15} color={t.tenue} grosor={2.2} />
            </View>
          </Pulsable>
        )
      })}
    </ListaFicha>
  )

  const proveedores = (
    <ListaFicha titulo="A quién se le compró">
      <Text style={[s.ayuda, { color: t.suave, paddingHorizontal: 16 }]}>Los proveedores de desechables en el período.</Text>
      {gasto.proveedores.length === 0 ? (
        <Text style={[s.detalle, { color: t.suave, padding: 16 }]}>Sin compras de desechables en este período.</Text>
      ) : (
        gasto.proveedores.map(([nombre, monto], n) => (
          <View
            key={nombre}
            style={[s.proveedor, n < gasto.proveedores.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 }]}
          >
            <Text style={[s.detalle, { color: t.tinta, flex: 1, fontSize: 15 }]} numberOfLines={1}>
              {nombre}
            </Text>
            <Text style={[s.monto, { color: t.tinta }]}>{fmt(monto)}</Text>
          </View>
        ))
      )}
    </ListaFicha>
  )

  return tablet ? (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
      <View style={{ flex: 3 }}>{lista}</View>
      <View style={{ flex: 2 }}>{proveedores}</View>
    </View>
  ) : (
    <>
      {lista}
      {proveedores}
    </>
  )
}

const s = StyleSheet.create({
  cabeza: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  titulo: { fontFamily: LETRA.titulo, fontSize: 16.5, letterSpacing: -0.2 },
  ayuda: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19, marginTop: 4 },
  total: { fontFamily: LETRA.tituloFuerte, fontSize: 22, letterSpacing: -0.5 },
  renglon: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 56 },
  nombre: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  detalle: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 2 },
  barra: { height: 6, borderRadius: 3, marginTop: 8, overflow: 'hidden', maxWidth: 280 },
  barraLlena: { height: 6, borderRadius: 3 },
  monto: { fontFamily: LETRA.cifraFuerte, fontSize: 15 },
  proveedor: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
})
