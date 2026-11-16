import { memo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { unidadDe } from '../../../../frontend/src/lib/inventario'
import { factorEntre } from '../../../../frontend/src/lib/unidades'
import { aNumero } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import type { Ingrediente } from '../../lib/tipos'
import CasillaConUnidad from '../preparaciones/CasillaConUnidad'
import { fmtCant } from '../preparaciones/cuentas'

/**
 * Una mercancia del conteo: el nombre y su unidad, y la casilla de lo
 * contado (kg ⇄ g). A ciegas, nada mas. Sin ciegas, como las columnas
 * "Sistema" y "Diferencia" de la web: lo que el sistema espera debajo del
 * nombre y la diferencia (con su valor) debajo de la casilla.
 */
function RenglonConteo({
  ing,
  texto,
  vista,
  ciego,
  alEscribir,
  alCambiarVista,
  dinero,
}: {
  ing: Ingrediente
  texto: string
  vista: string
  ciego: boolean
  alEscribir: (id: number, texto: string) => void
  alCambiarVista: (ing: Ingrediente, nueva: string) => void
  dinero: (n: number) => string
}) {
  const t = useTema()
  const real = texto.trim() === '' ? null : aNumero(texto) / factorEntre(ing.unidad, vista)
  const valido = real !== null && Number.isFinite(real) && real >= 0
  const dif = valido ? Math.round((real - ing.stock_actual) * 1e6) / 1e6 : null
  return (
    <View style={[r.renglon, { borderBottomColor: t.gris200 }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[r.nombre, { color: t.tinta }]} numberOfLines={2}>
          {ing.nombre}
        </Text>
        <Text style={[r.sub, { color: t.tenue }]}>
          {ing.unidad}
          {!ciego ? <Text style={{ color: t.suave }}>{`  ·  Sistema ${fmtCant(ing.stock_actual)}`}</Text> : null}
        </Text>
      </View>
      <View style={{ width: 160, gap: 4 }}>
        <CasillaConUnidad
          unidad={ing.unidad}
          vista={vista}
          alCambiarVista={(nueva) => alCambiarVista(ing, nueva)}
          valor={texto}
          alCambiar={(v) => alEscribir(ing.id, v)}
          placeholder="—"
          etiqueta={`Contado de ${ing.nombre}, en ${vista}`}
          error={texto !== '' && !valido}
        />
        {!ciego && dif !== null ? (
          dif === 0 ? (
            <Text style={[r.dif, { color: t.exito }]}>cuadra</Text>
          ) : (
            <Text style={[r.dif, { color: dif < 0 ? t.peligro : t.aviso }]}>
              {dif > 0 ? '+' : ''}
              {fmtCant(dif)} {unidadDe(dif, ing.unidad)}
              <Text style={[r.valor, { color: t.suave }]}>{`  ${dinero(Math.abs(dif) * (ing.costo_unitario || 0))}`}</Text>
            </Text>
          )
        ) : null}
      </View>
    </View>
  )
}

export default memo(RenglonConteo)

const r = StyleSheet.create({
  renglon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  nombre: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  sub: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 2 },
  dif: { fontFamily: LETRA.cifraFuerte, fontSize: 13, textAlign: 'right' },
  valor: { fontFamily: LETRA.cifra, fontSize: 13 },
})
