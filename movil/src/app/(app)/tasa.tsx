import { View } from 'react-native'
import { Barra } from '../../componentes/Encabezado'
import { Cargando, Cifra, Etiqueta, Ficha, Fila, Nota, Pantalla, Problema } from '../../componentes/ui'
import { api } from '../../lib/api'
import { useCarga } from '../../lib/carga'
import { bolivares, miles } from '../../lib/formato'
import { useTema } from '../../lib/tema'

/** TASA DE CAMBIO, PARA CONSULTAR: bolivares por dolar y por euro, hoy. */
export default function Tasa() {
  const t = useTema()
  const { datos: tasa, error, refrescando, refrescar } = useCarga(() => api.tasa(), 300)

  return (
    <Pantalla refrescando={refrescando} alRefrescar={refrescar} arriba={<Barra titulo="Tasa de cambio" />}>
      {error && !tasa ? <Problema mensaje={error} alReintentar={refrescar} /> : null}
      {!tasa && !error ? <Cargando /> : null}
      {tasa && (
        <>
          <Ficha>
            <Etiqueta>Dólar BCV · {tasa.fecha}</Etiqueta>
            <View style={{ marginTop: 8 }}>
              <Cifra tamano="grande">{tasa.bcv ? `Bs ${miles(tasa.bcv)}` : '—'}</Cifra>
            </View>
            <Nota>
              {tasa.origen === 'manual' ? 'Cargada a mano' : 'Del Banco Central de Venezuela'}
              {tasa.variacion_semana_pct !== null
                ? ` · ${tasa.variacion_semana_pct >= 0 ? '+' : ''}${tasa.variacion_semana_pct.toFixed(1).replace('.', ',')} % en la semana`
                : ''}
            </Nota>
          </Ficha>
          <Ficha>
            <Fila nombre="Dólar paralelo" valor={bolivares(tasa.paralelo)} />
            <Fila nombre="Euro BCV" valor={bolivares(tasa.eur)} ultima />
            {tasa.brecha_pct !== null && (
              <Nota style={{ marginTop: 6 }}>Brecha entre paralelo y BCV: {tasa.brecha_pct.toFixed(1).replace('.', ',')} %</Nota>
            )}
            {tasa.desactualizada && <Nota style={{ color: t.aviso, marginTop: 4 }}>La tasa no se ha podido actualizar hoy.</Nota>}
          </Ficha>
        </>
      )}
    </Pantalla>
  )
}
