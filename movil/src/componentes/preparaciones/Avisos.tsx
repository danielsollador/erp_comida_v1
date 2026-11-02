import { StyleSheet, Text, View } from 'react-native'
import { unidadDe } from '../../../../frontend/src/lib/inventario'
import type { RendimientoReal } from '../../lib/api-preparaciones'
import { horaCorta } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import type { Preparacion, Produccion } from '../../lib/tipos'
import { Ficha } from '../ui'
import { diaCorto, fmtCant } from './cuentas'
import { Cabecera, Caja, Enlace } from './piezas'

/**
 * Lo que la lista de Preparado avisa arriba, con las palabras de la web:
 * la receta que rinde distinto en las ultimas tandas (8-oct, caso 21) y lo
 * que sobro de antes y ya paso su tiempo. Abajo, las tandas de la semana.
 */

/** "Guiso: las últimas 3 tandas salieron al 88 % de lo esperado…" con su arreglo a un toque. */
export function RindeDistinto({ r, alAjustar }: { r: RendimientoReal; alAjustar: () => void }) {
  const t = useTema()
  const fuerte = { fontFamily: LETRA.textoFuerte }
  return (
    <Caja tono="aviso" estilo={{ gap: 4 }}>
      <Text style={[v.texto, { color: t.avisoFuerte }]}>
        <Text style={fuerte}>{r.nombre}</Text>: las últimas {r.tandas} tandas salieron al <Text style={fuerte}>{fmtCant(r.real_pct)} %</Text> de lo
        esperado.
        {r.sugerida_cantidad != null ? (
          <>
            {' '}
            La receta dice {fmtCant(r.receta_cantidad ?? 0)} {unidadDe(r.receta_cantidad ?? 0, r.unidad)} de {r.crudo}; con{' '}
            <Text style={fuerte}>
              {fmtCant(r.sugerida_cantidad)} {unidadDe(r.sugerida_cantidad, r.unidad)}
            </Text>{' '}
            el costo diría la verdad.
          </>
        ) : null}
      </Text>
      {r.sugerida_cantidad != null ? (
        <View style={{ flexDirection: 'row' }}>
          <Enlace
            texto={`Ajustar la receta a ${fmtCant(r.sugerida_cantidad)} ${unidadDe(r.sugerida_cantidad, r.unidad)}`}
            tono="aviso"
            subrayado
            alTocar={alAjustar}
          />
        </View>
      ) : null}
    </Caja>
  )
}

/** "Sobró de antes y ya pasó su tiempo": lo producido que vencio, con "Decidir". */
export function Vencidas({ lista, alDecidir }: { lista: Preparacion[]; alDecidir: (p: Preparacion) => void }) {
  const t = useTema()
  return (
    <Caja tono="aviso" estilo={{ gap: 2 }}>
      <Text style={[v.titulo, { color: t.avisoFuerte }]}>Sobró de antes y ya pasó su tiempo</Text>
      {lista.map((p) => (
        <View key={p.id} style={v.fila}>
          <Text style={[v.texto, { color: t.tinta, flex: 1 }]}>
            {p.nombre}:{' '}
            <Text style={{ fontFamily: LETRA.cifraFuerte }}>
              {fmtCant(p.stock_actual)} {unidadDe(p.stock_actual, p.unidad)}
            </Text>
          </Text>
          <Enlace texto="Decidir" tono="aviso" subrayado alTocar={() => alDecidir(p)} />
        </View>
      ))}
    </Caja>
  )
}

/** Las tandas de la semana: lo que la cocina anoto, con lo que rindio contra la receta. */
export function TandasDeLaSemana({ tandas, dinero }: { tandas: Produccion[]; dinero: (n: number) => string }) {
  const t = useTema()
  return (
    <Ficha>
      <Cabecera titulo="Tandas de esta semana" ayuda="Lo que la cocina anotó, con lo que rindió contra la receta." />
      {tandas.map((x, i) => {
        const lejos = x.rendimiento_real != null && Math.abs(x.rendimiento_real - 1) > 0.05
        return (
          <View
            key={x.id}
            style={[v.tanda, i < tandas.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 }]}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[v.tandaNombre, { color: t.tinta }]} numberOfLines={1}>
                {x.preparacion}
              </Text>
              <Text style={[v.tandaDetalle, { color: t.suave }]}>
                {diaCorto(x.fecha)}, {horaCorta(x.fecha)} · costó {dinero(x.costo_total)}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[v.tandaCifra, { color: t.tinta }]}>
                {fmtCant(x.cantidad)} {unidadDe(x.cantidad, x.unidad)}
              </Text>
              {x.rendimiento_real != null ? (
                <Text style={[v.tandaDetalle, { color: lejos ? t.aviso : t.suave }]}>
                  {Math.round(x.rendimiento_real * 100)} % de lo esperado
                </Text>
              ) : null}
            </View>
          </View>
        )
      })}
    </Ficha>
  )
}

const v = StyleSheet.create({
  titulo: { fontFamily: LETRA.textoFuerte, fontSize: 14.5, marginBottom: 2 },
  texto: { fontFamily: LETRA.texto, fontSize: 14, lineHeight: 20 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tanda: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  tandaNombre: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  tandaDetalle: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 2 },
  tandaCifra: { fontFamily: LETRA.cifraFuerte, fontSize: 15 },
})
