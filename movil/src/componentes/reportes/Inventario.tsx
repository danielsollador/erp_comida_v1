import { Text, View } from 'react-native'
import { abrir } from '../../lib/modulos'
import { LETRA, useTema } from '../../lib/tema'
import type { EstadoDeposito, InsumoDelDeposito, InsumoInflacion, ReporteInventario } from '../../lib/tipos'
import { Pastilla } from '../kit'
import { Ficha } from '../ui'
import { Bloque, c, Cifra, DosColumnas, Enlace, Lecturas, Rejilla, Seccion, Vacio } from './comunes'
import { cantidad, usePalabra, type Dinero } from './cuentas'
import { BarrasApiladas, GraficoDona } from './Grafico'
import { colorSerie, usePaletaDatos } from './paleta'
import { TablaDatos } from './Tabla'

// Lo urgente primero cuando se ordena por estado.
const ORDEN_ESTADO: Record<EstadoDeposito, number> = { agotado: 0, bajo: 1, ok: 2, sobra: 3, quieto: 4 }
const ESTADOS: Record<EstadoDeposito, { texto: string; tono: 'mal' | 'ojo' | 'bien' | 'neutro' }> = {
  agotado: { texto: 'Agotado', tono: 'mal' },
  bajo: { texto: 'Bajo mínimo', tono: 'ojo' },
  ok: { texto: 'Bien', tono: 'bien' },
  sobra: { texto: 'Sobra', tono: 'neutro' },
  quieto: { texto: 'Sin movimiento', tono: 'neutro' },
}

/**
 * ANALISIS DE INVENTARIO, como pages/partes/reportes/Inventario.tsx de la
 * web: donde esta la plata, para cuantos dias alcanza cada cosa, que no se
 * mueve y que hay que comprar. El stock es de HOY; el consumo con que se lee
 * es el del periodo elegido arriba.
 */
export default function Inventario({ datos, dinero, corto }: { datos: ReporteInventario; dinero: Dinero; corto: (x: number) => string }) {
  const t = useTema()
  const p = usePaletaDatos()
  const { nombre } = usePalabra()
  const de = datos.filtro ? datos.filtro.ingrediente || datos.filtro.categoria : ''
  const top = datos.por_insumo.filter((i) => i.valor > 0).slice(0, 10)
  const colorDias = (i: InsumoDelDeposito) =>
    i.dias_de_stock == null ? t.tenue : i.dias_de_stock <= 3 ? t.peligro : i.dias_de_stock <= 7 ? t.aviso : undefined

  return (
    <>
      <Rejilla>
        <Cifra
          titulo={de ? `${nombre('kpi.valor_deposito')} · ${de}` : nombre('kpi.valor_deposito')}
          ayuda="kpi.valor_deposito"
          valor={dinero(datos.valor_total)}
          destacado
          nota={`${datos.activos} mercancía(s) activas, al costo promedio`}
        />
        <Cifra
          titulo="Salió a costo en el período"
          valor={dinero(datos.consumido)}
          destacado
          nota={datos.rotacion != null ? `el inventario rotó ${cantidad(Math.round(datos.rotacion * 10) / 10)} vez/veces` : undefined}
        />
        <Cifra
          titulo={nombre('kpi.bajo_minimo_agotadas')}
          ayuda="kpi.bajo_minimo_agotadas"
          valor={String(datos.bajo_minimo + datos.agotados)}
          tono={datos.agotados > 0 ? 'malo' : datos.bajo_minimo > 0 ? undefined : 'bueno'}
          nota={datos.agotados > 0 ? `${datos.agotados} agotada(s)` : 'ninguna agotada'}
        />
        <Cifra
          titulo="Subida de precios"
          valor={datos.inflacion_pct != null ? `${datos.inflacion_pct > 0 ? '+' : ''}${datos.inflacion_pct.toFixed(0)}%` : '—'}
          tono={datos.inflacion_pct != null && datos.inflacion_pct >= 10 ? 'malo' : undefined}
          nota={
            datos.inflacion_pct != null ? `lo que subió la mercancía en ${datos.dias} día(s)` : 'hacen falta dos compras del mismo insumo para medirla'
          }
        />
      </Rejilla>

      {datos.insights.length > 0 ? <Lecturas items={datos.insights} /> : null}

      {datos.valor_total <= 0 && datos.activos === 0 ? (
        <Vacio>
          Todavía no hay mercancía cargada. Se carga desde <Enlace texto="Inventario" alTocar={() => abrir('/inventario')} />.
        </Vacio>
      ) : (
        <>
          {/* ── Donde esta la plata ── */}
          <Bloque titulo="Dónde está la plata" descripcion="Lo que hay en el estante, valorado al costo promedio.">
            <DosColumnas>
              <Seccion titulo="Las mercancías que más valen" ayuda="Las diez con más plata parada. Conviene contarlas más seguido.">
                {top.length > 0 ? (
                  <BarrasApiladas
                    formato={dinero}
                    leyenda={[
                      { nombre: 'Materia prima', color: colorSerie(p, 0) },
                      { nombre: 'Reventa', color: colorSerie(p, 2) },
                    ]}
                    filas={top.map((i) => ({
                      nombre: i.nombre,
                      detalle: `${i.pct.toFixed(0)}%`,
                      partes: [
                        {
                          nombre: i.tipo === 'reventa' ? 'Reventa' : 'Materia prima',
                          valor: i.valor,
                          color: i.tipo === 'reventa' ? colorSerie(p, 2) : colorSerie(p, 0),
                        },
                      ],
                    }))}
                  />
                ) : (
                  <Text style={[c.texto, { color: t.tenue, textAlign: 'center', paddingVertical: 18 }]}>Sin existencias con valor.</Text>
                )}
              </Seccion>
              <View style={{ gap: 12 }}>
                <Seccion titulo="Materia prima y reventa">
                  <GraficoDona
                    formato={dinero}
                    centro={{ valor: corto(datos.valor_total), texto: 'en el inventario' }}
                    partes={[
                      { nombre: 'Materia prima', valor: datos.valor_insumos, color: colorSerie(p, 0) },
                      { nombre: 'Reventa', valor: datos.valor_reventa, color: colorSerie(p, 2) },
                    ].filter((x) => x.valor > 0)}
                  />
                </Seccion>
                {datos.quietos > 0 ? (
                  <Seccion titulo="Plata quieta" ayuda={`Mercancía sin ninguna salida en ${datos.dias} día(s).`}>
                    <Text style={{ fontFamily: LETRA.tituloFuerte, fontSize: 24, color: t.tinta }}>{dinero(datos.valor_quieto)}</Text>
                    <Text style={[c.texto, { color: t.suave, marginTop: 4 }]}>
                      en {datos.quietos} mercancía(s) que no se tocaron:{' '}
                      {datos.por_insumo
                        .filter((i) => i.estado === 'quieto' && i.valor > 0)
                        .slice(0, 4)
                        .map((i) => i.nombre)
                        .join(', ')}
                      {datos.quietos > 4 ? '…' : ''}
                    </Text>
                  </Seccion>
                ) : null}
              </View>
            </DosColumnas>
          </Bloque>

          {/* ── Para cuantos dias alcanza ── */}
          <Bloque
            titulo="Para cuántos días alcanza"
            descripcion={`Al ritmo de consumo de los últimos ${datos.dias} día(s): ventas, mermas y consumo del personal.`}
          >
            <Ficha>
              <TablaDatos<InsumoDelDeposito>
                filas={datos.por_insumo}
                claveFila={(i) => String(i.ingrediente_id)}
                ordenInicial="dias"
                columnas={[
                  {
                    clave: 'nombre',
                    titulo: 'Mercancía',
                    ancho: 140,
                    orden: (i) => i.nombre,
                    celda: (i) => (
                      <View>
                        <Text style={[c.texto, { color: t.tinta, fontFamily: LETRA.textoFuerte, fontSize: 14 }]} numberOfLines={1}>
                          {i.nombre}
                        </Text>
                        {i.tipo === 'reventa' ? <Text style={[c.nota, { color: t.tenue }]}>reventa</Text> : null}
                      </View>
                    ),
                  },
                  // Lo que no se consume (null) va al final: lo urgente es lo que se acaba.
                  {
                    clave: 'dias',
                    titulo: 'Días',
                    ancho: 64,
                    derecha: true,
                    fuerte: true,
                    orden: (i) => (i.dias_de_stock == null ? 1e9 : i.dias_de_stock),
                    celda: (i) => (i.dias_de_stock == null ? '—' : i.dias_de_stock >= 999 ? '∞' : i.dias_de_stock.toFixed(0)),
                    color: colorDias,
                  },
                  {
                    clave: 'estado',
                    titulo: 'Estado',
                    ancho: 128,
                    derecha: true,
                    orden: (i) => ORDEN_ESTADO[i.estado],
                    celda: (i) => (<View style={{ alignSelf: 'flex-end' }}><Pastilla texto={ESTADOS[i.estado].texto} tono={ESTADOS[i.estado].tono} /></View>),
                  },
                  { clave: 'hay', titulo: 'Hay', ancho: 96, derecha: true, orden: (i) => i.cantidad, celda: (i) => `${cantidad(i.cantidad)} ${i.unidad}` },
                  { clave: 'valor', titulo: 'Vale', ancho: 96, derecha: true, orden: (i) => i.valor, celda: (i) => dinero(i.valor) },
                  {
                    clave: 'consumo',
                    titulo: 'Por día',
                    ancho: 84,
                    derecha: true,
                    orden: (i) => i.por_dia,
                    celda: (i) => (i.por_dia > 0 ? cantidad(i.por_dia) : '—'),
                    color: () => t.suave,
                  },
                ]}
              />
            </Ficha>
          </Bloque>

          {/* ── Que comprar ── */}
          <Bloque titulo="Qué hay que comprar" descripcion="Lo que cruzó el mínimo o no llega a la semana al ritmo actual.">
            {datos.por_comprar.length === 0 ? (
              <Vacio>Nada por comprar ahora mismo: todo está por encima del mínimo y alcanza más de una semana.</Vacio>
            ) : (
              <Ficha>
                {datos.por_comprar.map((s, i) => (
                  <View key={s.ingrediente_id} style={[{ paddingVertical: 10 }, i > 0 && { borderTopWidth: 1, borderTopColor: t.gris100 }]}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 10 }}>
                      <Text style={[c.texto, { color: t.tinta, fontFamily: LETRA.textoFuerte }]}>{s.ingrediente_nombre}</Text>
                      <Text style={[c.texto, { color: t.acento, fontFamily: LETRA.cifraFuerte, fontSize: 14 }]}>
                        comprar {cantidad(s.cantidad_sugerida)} {s.unidad}
                      </Text>
                    </View>
                    <Text style={[c.nota, { color: t.suave, marginTop: 2 }]}>{s.razon}</Text>
                  </View>
                ))}
                <Text style={[c.nota, { color: t.suave, marginTop: 10 }]}>
                  La lista completa, con proveedores y precios, está en{' '}
                  <Enlace texto="Inventario · Qué comprar" alTocar={() => abrir('/inventario/comprar')} />.
                </Text>
              </Ficha>
            )}
          </Bloque>

          {/* ── Que subio de precio ── */}
          {datos.inflacion.length > 0 ? (
            <Bloque titulo="Qué subió de precio" descripcion="Última compra contra la primera del período, por mercancía.">
              <Ficha>
                <TablaDatos<InsumoInflacion>
                  filas={datos.inflacion}
                  claveFila={(i) => String(i.ingrediente_id)}
                  columnas={[
                    { clave: 'nombre', titulo: 'Mercancía', ancho: 130, celda: (i) => i.nombre },
                    { clave: 'antes', titulo: 'Antes', ancho: 90, derecha: true, celda: (i) => dinero(i.costo_inicial, 2), color: () => t.suave },
                    { clave: 'ahora', titulo: 'Ahora', ancho: 90, derecha: true, celda: (i) => dinero(i.costo_actual, 2) },
                    {
                      clave: 'cambio',
                      titulo: 'Cambio',
                      ancho: 76,
                      derecha: true,
                      fuerte: true,
                      celda: (i) => `${i.cambio_pct > 0 ? '+' : ''}${i.cambio_pct.toFixed(0)}%`,
                      color: (i) => (i.cambio_pct >= 10 ? t.peligro : i.cambio_pct > 0 ? t.aviso : t.exito),
                    },
                  ]}
                />
              </Ficha>
            </Bloque>
          ) : null}
        </>
      )}
    </>
  )
}
