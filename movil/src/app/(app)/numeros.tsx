import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { Cargando, Cifra, Etiqueta, Ficha, Fila, Nota, Pantalla, Problema, Titulo } from '../../componentes/ui'
import { api } from '../../lib/api'
import { parte, useCarga, type Parte } from '../../lib/carga'
import { bolivares, dolares, nombreDelMes } from '../../lib/formato'
import { useTema } from '../../lib/tema'

/**
 * LA ZONA CONTABLE, PARA CONSULTAR (Leider, 7-oct: "app modo consulta en zona
 * contable"). Lo que el dueño se pregunta lejos del local: cuanto gane este
 * mes, cuanto me deben, cuanto debo, cuanto IVA tengo por declarar y a como
 * esta el dolar. Todo sale del mismo backend que la web; aqui no se asienta,
 * no se declara y no se edita nada: eso sigue en la web, en la PC.
 */
export default function Numeros() {
  const t = useTema()
  const { datos, error, refrescando, refrescar } = useCarga(async () => {
    const [resultados, balance, iva, fiado, tasa] = await Promise.all([
      parte(api.resultadosDelMes()),
      parte(api.balanceGeneral()),
      parte(api.ivaPendiente()),
      parte(api.fiado()),
      parte(api.tasa()),
    ])
    const todas = [resultados, balance, iva, fiado, tasa]
    if (todas.every((p) => !p.ok)) throw new Error((todas[0] as Extract<Parte<unknown>, { ok: false }>).error)
    return { resultados, balance, iva, fiado, tasa }
  }, 120)

  return (
    <Pantalla refrescando={refrescando} alRefrescar={refrescar}>
      <View style={{ marginTop: 6, marginBottom: 4 }}>
        <Etiqueta>Zona contable</Etiqueta>
        <Titulo>Números del negocio</Titulo>
        <Nota>Solo para consultar. Los asientos y las declaraciones se hacen en la web.</Nota>
      </View>

      {error && !datos ? <Problema mensaje={error} alReintentar={refrescar} /> : null}
      {!datos && !error ? <Cargando /> : null}

      {datos && (
        <>
          {/* ── El mes ─────────────────────────────────────────────── */}
          <Seccion parte={datos.resultados}>
            {(r) => (
              <Ficha>
                <Etiqueta>{nombreDelMes()}</Etiqueta>
                <View style={{ marginTop: 8 }}>
                  <Cifra tamano="grande" color={r.utilidad_neta < 0 ? t.peligro : t.tinta}>
                    {dolares(r.utilidad_neta)}
                  </Cifra>
                </View>
                <Nota>{r.utilidad_neta < 0 ? 'Pérdida del mes hasta hoy' : 'Ganancia del mes hasta hoy'}</Nota>
                <View style={{ marginTop: 12 }}>
                  <Fila nombre="Ingresos" valor={dolares(r.ingresos)} />
                  <Fila nombre="Costo de lo vendido" valor={dolares(-Math.abs(r.costos))} />
                  <Fila nombre="Ganancia bruta" valor={dolares(r.utilidad_bruta)} />
                  <Fila nombre="Gastos" valor={dolares(-Math.abs(r.gastos))} />
                  <Fila
                    nombre="Ganancia neta"
                    valor={dolares(r.utilidad_neta)}
                    fuerte
                    color={r.utilidad_neta < 0 ? t.peligro : t.exito}
                    ultima
                  />
                </View>
              </Ficha>
            )}
          </Seccion>

          {/* ── Lo que me deben y lo que debo ──────────────────────── */}
          <View style={estilos.par}>
            <Seccion parte={datos.fiado} compacta>
              {(f) => {
                const total = f.reduce((s, c) => s + c.monto, 0)
                return (
                  <Ficha style={estilos.mitad}>
                    <Etiqueta>Te deben</Etiqueta>
                    <View style={{ marginTop: 6 }}>
                      <Cifra tamano="media">{dolares(total)}</Cifra>
                    </View>
                    <Nota>
                      {f.length === 0 ? 'Nadie debe nada' : `${f.length} ${f.length === 1 ? 'venta' : 'ventas'} a crédito`}
                    </Nota>
                  </Ficha>
                )
              }}
            </Seccion>
            <Seccion parte={datos.balance} compacta>
              {(b) => (
                <Ficha style={estilos.mitad}>
                  <Etiqueta>Debes</Etiqueta>
                  <View style={{ marginTop: 6 }}>
                    <Cifra tamano="media">{dolares(b.total_pasivos)}</Cifra>
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
                      <Fila key={p.cuenta_id} nombre={p.nombre} valor={dolares(p.saldo)} ultima={i === Math.min(deudas.length, 6) - 1} />
                    ))}
                  </View>
                </Ficha>
              )
            }}
          </Seccion>

          {/* ── IVA ───────────────────────────────────────────────── */}
          <Seccion parte={datos.iva}>
            {(periodos) => (
              <Ficha>
                <Titulo>IVA por declarar</Titulo>
                {periodos.length === 0 ? (
                  <Nota style={{ marginTop: 6 }}>Nada pendiente: todos los meses están declarados.</Nota>
                ) : (
                  <View style={{ marginTop: 6 }}>
                    {periodos.map((p, i) => {
                      const neto = p.iva_debito_bs - p.iva_credito_bs - p.retenciones_bs
                      return (
                        <View key={`${p.anio}-${p.mes}`} style={{ marginTop: i ? 14 : 0 }}>
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
                            <Fila
                              nombre="Nada por pagar · a favor"
                              valor={bolivares(-neto)}
                              fuerte
                              color={t.exito}
                              ultima={!p.sin_tasa}
                            />
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
          </Seccion>

          {/* ── Balance ───────────────────────────────────────────── */}
          <Seccion parte={datos.balance}>
            {(b) => (
              <Ficha>
                <Titulo>Balance a hoy</Titulo>
                <View style={{ marginTop: 6 }}>
                  <Fila nombre="Lo que tienes (activos)" valor={dolares(b.total_activos)} />
                  <Fila nombre="Lo que debes (pasivos)" valor={dolares(b.total_pasivos)} />
                  <Fila nombre="Lo que es tuyo (patrimonio)" valor={dolares(b.total_patrimonio)} fuerte ultima />
                </View>
                {!b.cuadra && (
                  <Nota style={{ color: t.aviso, marginTop: 8 }}>El balance no cuadra: revísalo en la web, en Contabilidad.</Nota>
                )}
              </Ficha>
            )}
          </Seccion>

          {/* ── Tasa ──────────────────────────────────────────────── */}
          <Seccion parte={datos.tasa}>
            {(tasa) => (
              <Ficha>
                <Titulo>Tasa del día</Titulo>
                <View style={{ marginTop: 6 }}>
                  <Fila nombre="Dólar BCV" valor={bolivares(tasa.bcv)} />
                  <Fila nombre="Dólar paralelo" valor={bolivares(tasa.paralelo)} />
                  <Fila nombre="Euro BCV" valor={bolivares(tasa.eur)} ultima />
                </View>
                {tasa.brecha_pct !== null && (
                  <Nota style={{ marginTop: 6 }}>Brecha entre paralelo y BCV: {tasa.brecha_pct.toFixed(1).replace('.', ',')} %</Nota>
                )}
                {tasa.desactualizada && (
                  <Nota style={{ color: t.aviso, marginTop: 4 }}>La tasa no se ha podido actualizar hoy.</Nota>
                )}
              </Ficha>
            )}
          </Seccion>
        </>
      )}
    </Pantalla>
  )
}

/** Un bloque que llego, o el motivo de que no (un 403 se dice en palabras). */
function Seccion<T>({
  parte: p,
  compacta = false,
  children,
}: {
  parte: Parte<T>
  compacta?: boolean
  children: (valor: T) => ReactNode
}) {
  if (p.ok) return <>{children(p.valor)}</>
  const mensaje = p.estado === 403 ? 'Tu rol no ve esta parte.' : p.error
  return (
    <Ficha style={compacta ? estilos.mitad : undefined}>
      <Nota>{mensaje}</Nota>
    </Ficha>
  )
}

const estilos = StyleSheet.create({
  par: { flexDirection: 'row', gap: 12 },
  mitad: { flex: 1, padding: 16 },
})
