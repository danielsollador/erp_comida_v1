import { StyleSheet, Text, View } from 'react-native'
import { ALMACEN_DE } from '../../../../frontend/src/lib/tiposArticulo'
import { useMoneda } from '../../lib/moneda'
import { LETRA, useTema } from '../../lib/tema'
import type { InflacionInsumos, Ingrediente, SugerenciaCompra } from '../../lib/tipos'
import { ListaFicha, Vacio } from '../kit'
import { Ficha } from '../ui'
import { cantidad, PuntoTipo, unidadDe } from './comun'
import { BotonLlego } from './Portada'

/*
 * QUE COMPRAR (la seccion `comprar` de pages/Inventario.tsx): lo que esta
 * bajo minimo o, al ritmo de venta de las ultimas dos semanas, no llega a la
 * proxima. Cada renglon con su "Llegó" para anotar la compra en el momento.
 * Debajo, si la mercancia subio mucho en el mes, el aviso de la inflacion.
 */
export default function QueComprar({
  sugerencias,
  ingredientes,
  inflacion,
  alComprar,
}: {
  sugerencias: SugerenciaCompra[]
  ingredientes: Ingrediente[]
  inflacion: InflacionInsumos | null
  alComprar: (ing: Ingrediente) => void
}) {
  const t = useTema()
  const { fmt } = useMoneda()
  return (
    <>
      {sugerencias.length === 0 ? (
        <Vacio
          icono="ok"
          titulo="Nada por comprar ahora mismo"
          detalle="Todo está por encima del mínimo y alcanza más de una semana al ritmo de venta de las últimas dos semanas."
        />
      ) : (
        <ListaFicha titulo="Qué comprar">
          <Text style={[s.ayuda, { color: t.suave }]}>
            Lo que está bajo mínimo o, al ritmo de venta de las últimas dos semanas, no llega a la próxima.
          </Text>
          {sugerencias.map((sg, i) => {
            const ing = ingredientes.find((x) => x.id === sg.ingrediente_id)
            return (
              <View
                key={sg.ingrediente_id}
                style={[s.renglon, i < sugerencias.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 }]}
              >
                {ing ? <PuntoTipo tipo={ing.tipo} /> : null}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[s.nombre, { color: t.tinta }]}>{sg.ingrediente_nombre}</Text>
                  <Text style={[s.detalle, { color: t.suave }]}>
                    {ing ? <Text style={{ color: t.tenue }}>{ALMACEN_DE[ing.tipo].texto} · </Text> : null}
                    {sg.razon}
                  </Text>
                  <Text style={[s.cifra, { color: t.tinta }]}>
                    +{cantidad(sg.cantidad_sugerida)} {unidadDe(sg.cantidad_sugerida, sg.unidad)}
                  </Text>
                </View>
                {ing ? <BotonLlego alTocar={() => alComprar(ing)} /> : null}
              </View>
            )
          })}
        </ListaFicha>
      )}

      {inflacion && inflacion.cambio_pct >= 15 ? (
        <Ficha tono="aviso" style={{ gap: 10 }}>
          <Text style={[s.nombre, { color: t.aviso }]}>
            Tu mercancía subió {inflacion.cambio_pct.toFixed(0)}% en {inflacion.dias} días
          </Text>
          {inflacion.insumos.slice(0, 5).map((i) => (
            <View key={i.ingrediente_id} style={s.inflacion}>
              <Text style={[s.detalle, { color: t.fuerte, flexShrink: 1 }]}>{i.nombre}</Text>
              <Text style={[s.detalleCifra, { color: t.fuerte }]}>
                {fmt(i.costo_inicial)} → {fmt(i.costo_actual)} <Text style={{ fontFamily: LETRA.cifraFuerte }}>+{i.cambio_pct.toFixed(0)}%</Text>
              </Text>
            </View>
          ))}
          {/* La web cierra con "En Menú está el precio sugerido de cada
              producto": aqui no, el margen lo decide el dueño (regla de Leider). */}
          <Text style={[s.detalle, { color: t.aviso }]}>
            Si tus precios no subieron parecido, cada venta te deja menos de lo que necesitas para reponer.
          </Text>
        </Ficha>
      ) : null}
    </>
  )
}

const s = StyleSheet.create({
  ayuda: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19, paddingHorizontal: 16, paddingBottom: 6 },
  renglon: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  nombre: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  detalle: { fontFamily: LETRA.texto, fontSize: 13, lineHeight: 18, marginTop: 2 },
  detalleCifra: { fontFamily: LETRA.cifra, fontSize: 13 },
  cifra: { fontFamily: LETRA.cifraFuerte, fontSize: 14.5, marginTop: 4 },
  inflacion: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
})
