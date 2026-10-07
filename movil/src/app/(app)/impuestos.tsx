import { View } from 'react-native'
import { Barra } from '../../componentes/Encabezado'
import { Cargando, Etiqueta, Ficha, Fila, Nota, Pantalla, Problema, Titulo } from '../../componentes/ui'
import { api } from '../../lib/api'
import { useCarga } from '../../lib/carga'
import { bolivares } from '../../lib/formato'
import { useTema } from '../../lib/tema'

/**
 * IMPUESTOS, PARA CONSULTAR: el IVA de cada mes que falta declarar, en
 * bolivares, como lo pide el SENIAT. Declarar sigue en la web.
 */
export default function Impuestos() {
  const t = useTema()
  const { datos: periodos, error, refrescando, refrescar } = useCarga(() => api.ivaPendiente(), 300)

  return (
    <Pantalla refrescando={refrescando} alRefrescar={refrescar} arriba={<Barra titulo="Impuestos" />}>
      <Nota>Solo para consultar. Las declaraciones se hacen en la web.</Nota>
      {error && !periodos ? <Problema mensaje={error} alReintentar={refrescar} /> : null}
      {!periodos && !error ? <Cargando /> : null}

      {periodos && (
        <Ficha>
          <Titulo>IVA por declarar</Titulo>
          {periodos.length === 0 ? (
            <Nota style={{ marginTop: 6 }}>Nada pendiente: todos los meses están declarados.</Nota>
          ) : (
            <View style={{ marginTop: 6 }}>
              {periodos.map((p, i) => {
                const neto = p.iva_debito_bs - p.iva_credito_bs - p.retenciones_bs
                return (
                  <View key={`${p.anio}-${p.mes}`} style={{ marginTop: i ? 16 : 0 }}>
                    <Etiqueta style={{ marginBottom: 2 }}>{p.etiqueta}</Etiqueta>
                    <Fila nombre="IVA cobrado en ventas" valor={bolivares(p.iva_debito_bs)} />
                    <Fila nombre="IVA pagado en compras" valor={bolivares(-p.iva_credito_bs)} />
                    {p.retenciones_bs > 0 && <Fila nombre="Retenciones" valor={bolivares(-p.retenciones_bs)} />}
                    {/* Si las compras pagaron mas IVA que el que se cobro, no se
                        paga nada y lo que sobra queda A FAVOR para el mes
                        siguiente: eso tambien es una respuesta, no un cero. */}
                    {neto >= 0 ? (
                      <Fila nombre="Por pagar" valor={bolivares(neto)} fuerte ultima={!p.sin_tasa} />
                    ) : (
                      <Fila nombre="Nada por pagar · a favor" valor={bolivares(-neto)} fuerte color={t.exito} ultima={!p.sin_tasa} />
                    )}
                    {p.sin_tasa > 0 && (
                      <Nota style={{ color: t.aviso, marginTop: 6 }}>
                        {p.sin_tasa} documento{p.sin_tasa === 1 ? '' : 's'} sin tasa de cambio: hasta cargarla no se puede declarar.
                      </Nota>
                    )}
                  </View>
                )
              })}
            </View>
          )}
        </Ficha>
      )}
    </Pantalla>
  )
}
