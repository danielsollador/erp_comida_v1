import { StyleSheet, View } from 'react-native'
import { Barra } from '../../componentes/Encabezado'
import { Cargando, Cifra, Etiqueta, Ficha, Fila, Nota, Pantalla, Problema, Titulo } from '../../componentes/ui'
import { api } from '../../lib/api'
import { parte, useCarga, type Parte } from '../../lib/carga'
import { Seccion } from '../../componentes/Seccion'
import { nombreDelMes } from '../../lib/formato'
import { useMoneda } from '../../lib/moneda'
import { useTema } from '../../lib/tema'

/**
 * CONTABILIDAD, PARA CONSULTAR (Leider, 7-oct: "app modo consulta en zona
 * contable"): cuanto gane este mes, cuanto me deben, cuanto debo y a quien,
 * y el balance. Del mismo backend que la web; aqui no se asienta nada: los
 * asientos siguen en la web, en la PC.
 */
export default function Contabilidad() {
  const t = useTema()
  const { fmt } = useMoneda()
  const { datos, error, refrescando, refrescar } = useCarga(async () => {
    const [resultados, balance, fiado] = await Promise.all([
      parte(api.resultadosDelMes()),
      parte(api.balanceGeneral()),
      parte(api.fiado()),
    ])
    const todas = [resultados, balance, fiado]
    if (todas.every((p) => !p.ok)) throw new Error((todas[0] as Extract<Parte<unknown>, { ok: false }>).error)
    return { resultados, balance, fiado }
  }, 120)

  return (
    <Pantalla refrescando={refrescando} alRefrescar={refrescar} arriba={<Barra titulo="Contabilidad" />}>
      <Nota>Solo para consultar. Los asientos se hacen en la web.</Nota>
      {error && !datos ? <Problema mensaje={error} alReintentar={refrescar} /> : null}
      {!datos && !error ? <Cargando /> : null}

      {datos && (
        <>
          <Seccion parte={datos.resultados}>
            {(r) => (
              <Ficha>
                <Etiqueta>{nombreDelMes()}</Etiqueta>
                <View style={{ marginTop: 8 }}>
                  <Cifra tamano="grande" color={r.utilidad_neta < 0 ? t.peligro : t.tinta}>
                    {fmt(r.utilidad_neta)}
                  </Cifra>
                </View>
                <Nota>{r.utilidad_neta < 0 ? 'Pérdida del mes hasta hoy' : 'Ganancia del mes hasta hoy'}</Nota>
                <View style={{ marginTop: 12 }}>
                  <Fila nombre="Ingresos" valor={fmt(r.ingresos)} />
                  <Fila nombre="Costo de lo vendido" valor={fmt(-Math.abs(r.costos))} />
                  <Fila nombre="Ganancia bruta" valor={fmt(r.utilidad_bruta)} />
                  <Fila nombre="Gastos" valor={fmt(-Math.abs(r.gastos))} />
                  <Fila
                    nombre="Ganancia neta"
                    valor={fmt(r.utilidad_neta)}
                    fuerte
                    color={r.utilidad_neta < 0 ? t.peligro : t.exito}
                    ultima
                  />
                </View>
              </Ficha>
            )}
          </Seccion>

          <View style={estilos.par}>
            <Seccion parte={datos.fiado} compacta>
              {(f) => {
                const total = f.reduce((s, c) => s + c.monto, 0)
                return (
                  <Ficha style={estilos.mitad}>
                    <Etiqueta>Te deben</Etiqueta>
                    <View style={{ marginTop: 6 }}>
                      <Cifra tamano="media">{fmt(total)}</Cifra>
                    </View>
                    <Nota>{f.length === 0 ? 'Nadie debe nada' : `${f.length} ${f.length === 1 ? 'venta' : 'ventas'} a crédito`}</Nota>
                  </Ficha>
                )
              }}
            </Seccion>
            <Seccion parte={datos.balance} compacta>
              {(b) => (
                <Ficha style={estilos.mitad}>
                  <Etiqueta>Debes</Etiqueta>
                  <View style={{ marginTop: 6 }}>
                    <Cifra tamano="media">{fmt(b.total_pasivos)}</Cifra>
                  </View>
                  <Nota>proveedores, impuestos y otros</Nota>
                </Ficha>
              )}
            </Seccion>
          </View>

          <Seccion parte={datos.balance}>
            {(b) => {
              const deudas = b.pasivos.filter((p) => Math.abs(p.saldo) >= 0.005).sort((a, c) => c.saldo - a.saldo)
              return deudas.length === 0 ? null : (
                <Ficha>
                  <Titulo>A quién y por qué debes</Titulo>
                  <View style={{ marginTop: 6 }}>
                    {deudas.slice(0, 6).map((p, i) => (
                      <Fila key={p.cuenta_id} nombre={p.nombre} valor={fmt(p.saldo)} ultima={i === Math.min(deudas.length, 6) - 1} />
                    ))}
                  </View>
                </Ficha>
              )
            }}
          </Seccion>

          <Seccion parte={datos.balance}>
            {(b) => (
              <Ficha>
                <Titulo>Balance a hoy</Titulo>
                <View style={{ marginTop: 6 }}>
                  <Fila nombre="Lo que tienes (activos)" valor={fmt(b.total_activos)} />
                  <Fila nombre="Lo que debes (pasivos)" valor={fmt(b.total_pasivos)} />
                  <Fila nombre="Lo que es tuyo (patrimonio)" valor={fmt(b.total_patrimonio)} fuerte ultima />
                </View>
                {!b.cuadra && <Nota style={{ color: t.aviso, marginTop: 8 }}>El balance no cuadra: revísalo en la web, en Contabilidad.</Nota>}
              </Ficha>
            )}
          </Seccion>
        </>
      )}
    </Pantalla>
  )
}

const estilos = StyleSheet.create({
  par: { flexDirection: 'row', gap: 12 },
  mitad: { flex: 1, padding: 16 },
})
