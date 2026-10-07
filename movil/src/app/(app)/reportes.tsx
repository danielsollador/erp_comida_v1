import { useState } from 'react'
import { Text, View } from 'react-native'
import { Barra } from '../../componentes/Encabezado'
import { Cargando, Cifra, Etiqueta, Ficha, Fila, Nota, Pantalla, Pestanas, Problema, Titulo } from '../../componentes/ui'
import { api } from '../../lib/api'
import { useCarga } from '../../lib/carga'
import { hoyEnCaracas, inicioDelMes } from '../../lib/formato'
import { useMoneda } from '../../lib/moneda'
import { LETRA, useTema } from '../../lib/tema'

type Periodo = 'hoy' | '7d' | 'mes'

function rangoDe(p: Periodo): [string, string] {
  const hoy = hoyEnCaracas()
  if (p === 'hoy') return [hoy, hoy]
  if (p === 'mes') return [inicioDelMes(), hoy]
  const d = new Date(`${hoy}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 6)
  return [d.toISOString().slice(0, 10), hoy]
}

/**
 * REPORTES, LO ESENCIAL: "¿como va el negocio?" en el periodo que se elija,
 * con las mismas cifras del resumen de la web (/reportes/resumen) y el
 * cambio contra el periodo anterior. Los reportes a medida siguen en la web.
 */
export default function Reportes() {
  const t = useTema()
  const { fmt } = useMoneda()
  const [periodo, setPeriodo] = useState<Periodo>('hoy')
  const { datos: vigente, error, refrescando, refrescar } = useCarga(
    () => {
      const [desde, hasta] = rangoDe(periodo)
      return api.resumen(desde, hasta)
    },
    60,
    periodo,
  )

  const cambio = (pct: number | null | undefined) =>
    pct === null || pct === undefined ? '' : `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)} %`

  return (
    <Pantalla refrescando={refrescando} alRefrescar={refrescar} arriba={<Barra titulo="Reportes" />}>
      <Pestanas
        opciones={[
          { id: 'hoy', texto: 'Hoy' },
          { id: '7d', texto: 'Últimos 7 días' },
          { id: 'mes', texto: 'Este mes' },
        ]}
        valor={periodo}
        alCambiar={setPeriodo}
      />
      {error && !vigente ? <Problema mensaje={error} alReintentar={refrescar} /> : null}
      {!vigente && !error ? <Cargando /> : null}
      {vigente && (
        <>
          <Ficha>
            <Etiqueta>{vigente.etiqueta}</Etiqueta>
            <View style={{ marginTop: 8 }}>
              <Cifra tamano="grande">{fmt(vigente.ventas)}</Cifra>
            </View>
            <Nota>
              Vendido · {vigente.pedidos} {vigente.pedidos === 1 ? 'pedido' : 'pedidos'}
              {vigente.anterior ? `  ${cambio(vigente.anterior.cambio_ventas_pct)} vs. ${vigente.anterior.etiqueta.toLowerCase()}` : ''}
            </Nota>
            <View style={{ marginTop: 12 }}>
              <Fila nombre="Ticket promedio" valor={fmt(vigente.ticket_promedio)} />
              <Fila nombre="Costo de lo vendido" valor={fmt(-Math.abs(vigente.costo_insumos))} />
              <Fila nombre="Ganancia bruta" valor={fmt(vigente.ganancia_bruta)} />
              <Fila nombre="Gastos" valor={fmt(-Math.abs(vigente.gastos))} />
              <Fila
                nombre="Ganancia neta"
                valor={fmt(vigente.ganancia_neta)}
                fuerte
                color={vigente.ganancia_neta < 0 ? t.peligro : t.exito}
                ultima
              />
            </View>
          </Ficha>

          {Object.keys(vigente.por_metodo_pago).length > 0 && (
            <Ficha>
              <Titulo>Cómo se cobró</Titulo>
              <View style={{ marginTop: 6 }}>
                {Object.entries(vigente.por_metodo_pago)
                  .sort((a, b) => b[1] - a[1])
                  .map(([metodo, monto], i, lista) => (
                    <Fila key={metodo} nombre={metodo} valor={fmt(monto)} ultima={i === lista.length - 1} />
                  ))}
              </View>
            </Ficha>
          )}

          {vigente.top_productos.length > 0 && (
            <Ficha>
              <Titulo>Lo que más se vendió</Titulo>
              <View style={{ marginTop: 6 }}>
                {vigente.top_productos.slice(0, 8).map((p, i, lista) => (
                  <View
                    key={`${p.nombre}-${i}`}
                    style={{ paddingVertical: 10, borderBottomWidth: i === lista.length - 1 ? 0 : 0.5, borderBottomColor: t.gris200 }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                      <Text style={{ fontFamily: LETRA.textoFuerte, fontSize: 15, color: t.tinta, flexShrink: 1 }}>{p.nombre}</Text>
                      <Text style={{ fontFamily: LETRA.cifra, fontSize: 15, color: t.tinta }}>{fmt(p.ingresos)}</Text>
                    </View>
                    <Text style={{ fontFamily: LETRA.texto, fontSize: 13, color: t.suave, marginTop: 2 }}>
                      {p.unidades} {p.unidades === 1 ? 'unidad' : 'unidades'}
                      {p.sin_receta ? ' · sin receta' : ` · deja ${fmt(p.ganancia)} (${p.margen_pct.toFixed(0)} %)`}
                    </Text>
                  </View>
                ))}
              </View>
            </Ficha>
          )}

          {vigente.pedidos_anulados > 0 && (
            <Nota style={{ color: t.aviso }}>
              {vigente.pedidos_anulados} {vigente.pedidos_anulados === 1 ? 'pedido anulado' : 'pedidos anulados'} por {fmt(vigente.valor_anulado)}.
            </Nota>
          )}
        </>
      )}
    </Pantalla>
  )
}
