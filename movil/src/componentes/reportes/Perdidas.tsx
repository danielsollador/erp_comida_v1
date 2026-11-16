import { Text, View } from 'react-native'
import { fechaCorta, horaCorta } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import type { Merma, ReportePerdidas } from '../../lib/tipos'
import { Pastilla } from '../kit'
import { Ficha } from '../ui'
import { Bloque, c, Cifra, DosColumnas, Lecturas, Linea, Rejilla, Seccion, SerieTiempo, SinDatos, Vacio } from './comunes'
import { cantidad, grano, type Dinero } from './cuentas'
import { BarrasApiladas, GraficoDona, Variacion } from './Grafico'
import { usePaletaDatos } from './paleta'
import { TablaDatos } from './Tabla'

/**
 * ANALISIS DE PERDIDAS, como pages/partes/reportes/Perdidas.tsx de la web:
 * que se merma mas y que menos, por que, y cuanto pesa sobre la venta.
 *
 * La merma viene separada en dos: la que alguien REGISTRO (se cayo, se
 * quemo) y la que aparecio en un CONTEO (el sistema decia 10 y habia 7). Las
 * dos son plata perdida, pero se arreglan distinto.
 */
export default function Perdidas({ datos, dinero, corto }: { datos: ReportePerdidas; dinero: Dinero; corto: (x: number) => string }) {
  const t = useTema()
  const p = usePaletaDatos()
  const de = datos.filtro ? datos.filtro.ingrediente || datos.filtro.categoria : ''
  const top = datos.por_insumo.slice(0, 8)
  // "Lo que menos se merma": lo de abajo de la lista, sin repetir lo de arriba.
  const menos = datos.por_insumo.length > 3 ? datos.por_insumo.slice(-5).reverse().filter((x) => !top.includes(x)) : []
  const hayVentasQueNoLlegaron = datos.anulados > 0 || datos.devoluciones > 0 || datos.con_descuento > 0 || datos.cortesias > 0

  return (
    <>
      <Rejilla>
        <Cifra
          titulo={de ? `Merma de ${de}` : 'Merma del período'}
          ayuda="kpi.perdidas"
          valor={dinero(datos.merma)}
          tono={datos.merma > 0 ? 'malo' : undefined}
          destacado
          delta={datos.merma_anterior > 0 || datos.merma > 0 ? <Variacion pct={datos.cambio_pct} invertir texto="vs el período anterior" /> : undefined}
          nota={`${datos.registros} registro(s)`}
        />
        <Cifra
          titulo="Peso sobre la venta"
          ayuda="kpi.merma_inventario"
          valor={datos.ventas > 0 ? `${datos.peso_pct.toFixed(1).replace('.', ',')}%` : '—'}
          tono={datos.peso_pct > 3 ? 'malo' : datos.merma > 0 ? undefined : 'bueno'}
          destacado
          nota={datos.ventas > 0 ? `de ${corto(datos.ventas)} vendidos` : 'sin ventas en el período'}
        />
        <Cifra titulo="Faltantes de conteo" valor={dinero(datos.merma_por_conteo)} nota="lo que el conteo encontró de menos" />
        <Cifra titulo="Consumo del personal" valor={dinero(datos.consumo_personal)} nota="no es merma: es un costo autorizado" />
      </Rejilla>

      {datos.insights.length > 0 ? <Lecturas items={datos.insights} /> : null}

      {datos.merma <= 0 ? (
        <Vacio>
          No hay mermas {de ? `de ${de} ` : ''}registradas en este período.{' '}
          {datos.sin_merma > 0 ? `Las ${datos.sin_merma} mercancías activas están sin ninguna pérdida anotada.` : ''}
        </Vacio>
      ) : null}

      {/* ── Cuando ── Barras, no linea: una merma es un hecho suelto. */}
      {datos.serie.length > 1 || datos.merma <= 0 ? (
        <Bloque titulo="Cuándo se perdió">
          <Seccion titulo={`Merma por ${grano(datos.granularidad)}`} ayuda="Al costo congelado del momento en que se registró.">
            {datos.merma <= 0 ? (
              <SinDatos que="mermas" alto={180} />
            ) : (
              <SerieTiempo
                alto={180}
                formato={corto}
                formatoDetalle={(n) => dinero(n)}
                color={p.mal}
                nombres={{ actual: 'Merma', anterior: 'Período anterior' }}
                puntos={datos.serie.map((x) => ({ etiqueta: x.etiqueta, valor: x.valor, detalle: `${x.veces} ${x.veces === 1 ? 'registro' : 'registros'}` }))}
              />
            )}
          </Seccion>
        </Bloque>
      ) : null}

      {/* ── Que ── */}
      <Bloque titulo="Qué se merma más y qué menos" descripcion="Por mercancía, en plata.">
        <DosColumnas>
          <Seccion titulo="Lo que más se pierde" ayuda="La barra completa es lo perdido; la parte ámbar salió de un conteo, no de un registro.">
            {top.length === 0 ? (
              <SinDatos que="mermas" alto={160} />
            ) : (
              <BarrasApiladas
                formato={dinero}
                leyenda={[
                  { nombre: 'Registrada (se botó, se dañó)', color: p.mal },
                  { nombre: 'Faltante de conteo', color: p.ojo },
                ]}
                filas={top.map((x) => ({
                  nombre: x.nombre,
                  detalle: `${x.pct.toFixed(0)}% · ${cantidad(x.cantidad)} ${x.unidad}`,
                  partes: [
                    { nombre: 'Registrada', valor: Math.max(x.valor - x.valor_conteo, 0), color: p.mal },
                    { nombre: 'Faltante de conteo', valor: x.valor_conteo, color: p.ojo },
                  ],
                }))}
              />
            )}
          </Seccion>

          <Seccion titulo="Lo que menos se pierde" ayuda="Y lo que no se perdió nada, que también es un dato.">
            {menos.length > 0 ? (
              <View>
                {menos.map((x, i) => (
                  <View
                    key={x.ingrediente_id}
                    style={[
                      { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
                      i > 0 && { borderTopWidth: 1, borderTopColor: t.gris100 },
                    ]}
                  >
                    <Text style={[c.texto, { color: t.fuerte, flex: 1 }]} numberOfLines={1}>
                      {x.nombre}
                    </Text>
                    <Text style={[c.nota, { color: t.tenue, fontFamily: LETRA.cifra }]}>
                      {cantidad(x.cantidad)} {x.unidad}
                    </Text>
                    <Text style={[c.valor, { color: t.tinta, minWidth: 72, textAlign: 'right' }]}>{dinero(x.valor)}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={[c.texto, { color: t.suave }]}>
                Con {datos.por_insumo.length} mercancía(s) con merma, todas están en la lista de {'"Lo que más se pierde"'}.
              </Text>
            )}
            <Text style={[c.texto, { color: t.suave, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.gris100 }]}>
              <Text style={{ fontFamily: LETRA.textoFuerte, color: t.exito }}>{datos.sin_merma}</Text> mercancía(s) activas sin ninguna merma en el período.
            </Text>
          </Seccion>
        </DosColumnas>
      </Bloque>

      {/* ── Por que ── */}
      <Bloque titulo="Por qué se perdió">
        <DosColumnas>
          <Seccion titulo="Motivos" ayuda="El motivo que se escribió al registrar. Los faltantes de conteo van aparte.">
            {datos.por_motivo.length === 0 ? (
              <SinDatos que="mermas" alto={160} />
            ) : (
              <GraficoDona
                formato={dinero}
                centro={{ valor: corto(datos.merma), texto: 'perdidos' }}
                partes={datos.por_motivo.map((m) => ({
                  nombre: m.motivo,
                  valor: m.valor,
                  detalle: `${m.veces} vez/veces`,
                  color: m.motivo === 'Conteo fisico' ? p.ojo : undefined,
                }))}
              />
            )}
          </Seccion>
          <Seccion titulo="Registrada contra encontrada">
            <Linea dinero={dinero} etiqueta="Merma registrada a mano" monto={datos.merma_registrada} />
            <Linea dinero={dinero} etiqueta="Faltantes que encontró un conteo" monto={datos.merma_por_conteo} />
            <Linea dinero={dinero} etiqueta="Total perdido" monto={datos.merma} total />
            {(datos.por_operador?.length ?? 0) > 0 ? (
              <View style={{ marginTop: 14 }}>
                <Text style={[c.etiqueta, { color: t.suave, marginBottom: 2 }]}>Quién la anotó</Text>
                {datos.por_operador!.map((o) => (
                  <Linea key={o.operador} dinero={dinero} etiqueta={`${o.operador} · ${o.veces} ${o.veces === 1 ? 'vez' : 'veces'}`} monto={o.valor} />
                ))}
              </View>
            ) : null}
            <Text style={[c.nota, { color: t.suave, marginTop: 12 }]}>
              Lo registrado a mano se arregla en la cocina: porciones, almacenamiento, compras de más. Lo que aparece en un conteo nadie lo anotó cuando
              pasó: o se bota sin avisar, o se está yendo por la puerta.
            </Text>
          </Seccion>
        </DosColumnas>
      </Bloque>

      {/* ── Detalle ── */}
      <Bloque titulo="Registro por registro">
        <Ficha>
          {datos.detalle.length === 0 ? (
            <SinDatos que="registros de merma" alto={100} />
          ) : (
            <TablaDatos<Merma>
              filas={datos.detalle}
              claveFila={(m) => String(m.id)}
              ordenInicial="-fecha"
              columnas={[
                {
                  clave: 'insumo',
                  titulo: 'Mercancía',
                  ancho: 140,
                  orden: (m) => m.ingrediente_nombre,
                  celda: (m) => m.ingrediente_nombre,
                },
                {
                  clave: 'fecha',
                  titulo: 'Fecha',
                  ancho: 128,
                  orden: (m) => m.fecha,
                  celda: (m) => `${fechaCorta(m.fecha)}, ${horaCorta(m.fecha)}`,
                  color: () => t.suave,
                },
                { clave: 'cantidad', titulo: 'Cantidad', ancho: 96, derecha: true, orden: (m) => m.cantidad, celda: (m) => `${cantidad(m.cantidad)} ${m.unidad}` },
                {
                  clave: 'motivo',
                  titulo: 'Motivo',
                  ancho: 150,
                  orden: (m) => (m.por_conteo ? 'Conteo físico' : m.motivo),
                  celda: (m) =>
                    m.por_conteo ? (
                      <Pastilla texto="conteo físico" tono="ojo" />
                    ) : (
                      <Text style={[c.nota, { color: m.motivo ? t.suave : t.tenue }]} numberOfLines={2}>
                        {m.motivo || 'sin motivo'}
                      </Text>
                    ),
                },
                { clave: 'valor', titulo: 'Valor', ancho: 96, derecha: true, fuerte: true, orden: (m) => m.valor, celda: (m) => dinero(m.valor) },
              ]}
            />
          )}
        </Ficha>
      </Bloque>

      {/* ── Ventas que no llegaron ── */}
      {hayVentasQueNoLlegaron ? (
        <Bloque titulo="Ventas que no llegaron a serlo" descripcion="No son merma, pero es plata que se dejó de cobrar.">
          <Rejilla>
            <Cifra
              titulo="Cortesías"
              valor={dinero(datos.valor_cortesias)}
              nota={`${datos.cortesias} regalo(s) a precio de lista · costaron ${dinero(datos.costo_cortesias)}`}
            />
            <Cifra
              titulo="Comandas anuladas"
              ayuda="kpi.anuladas"
              valor={dinero(datos.valor_anulado)}
              nota={`${datos.anulados} comanda(s). Si ya se habían preparado, sí es pérdida.`}
            />
            <Cifra titulo="Ventas devueltas" ayuda="kpi.devueltas" valor={dinero(datos.valor_devuelto)} nota={`${datos.devoluciones} venta(s) devueltas por el cliente`} />
            <Cifra titulo="Descuentos" ayuda="kpi.descuentos" valor={dinero(datos.valor_descuentos)} nota={`en ${datos.con_descuento} venta(s)`} />
          </Rejilla>
        </Bloque>
      ) : null}
    </>
  )
}
