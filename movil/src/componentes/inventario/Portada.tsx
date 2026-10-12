import { StyleSheet, Text, View } from 'react-native'
import { ALMACENES, type Almacen } from '../../../../frontend/src/lib/tiposArticulo'
import { useMoneda } from '../../lib/moneda'
import { fechaCorta } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import type { Ingrediente, TipoArticulo } from '../../lib/tipos'
import { ListaFicha, useDisposicion } from '../kit'
import { Ficha, Pulsable } from '../ui'
import { cantidad, colorDe, Enlace, ir, PuntoTipo, RUTA_DE, SelloAlmacen, unidadDe } from './comun'
import { gastoEnDesechables, resumenes, type DatosInventario, type ResumenAlmacen } from './datos'

/*
 * LA PORTADA DE INVENTARIO (pages/partes/inventario/Almacenes.tsx de la web):
 * arriba, chico, lo que hay que vigilar; en el medio, grandes, los cuatro
 * almacenes, que es a donde se entra; abajo lo que pide atencion hoy.
 *
 *   Reventa        compra → inventario → menú → venta
 *   Materia prima  compra → crudo → preparado → menú
 *   Consumible     compra → inventario → receta
 *   Desechable     compra → gasto
 */

const CAMINO: Record<TipoArticulo, string[]> = {
  reventa: ['compra', 'inventario', 'menú', 'venta'],
  insumo: ['compra', 'crudo', 'preparado', 'menú'],
  consumible: ['compra', 'inventario', 'receta'],
  desechable: ['compra', 'gasto'],
  preparacion: ['crudo', 'cocina', 'menú'],
}

export default function Portada({
  datos,
  alComprar,
  alVerComprar,
}: {
  /** null mientras llega: las fichas dicen "…" y no ceros. */
  datos: DatosInventario | null
  alComprar: (ing: Ingrediente) => void
  alVerComprar: () => void
}) {
  const t = useTema()
  const { fmt } = useMoneda()
  const { tablet } = useDisposicion()
  const lista = datos ? resumenes(datos.ingredientes, gastoEnDesechables(datos.facturas)) : []
  const perdidas = (datos?.mermas ?? []).filter((m) => !m.revertida).reduce((s, m) => s + m.valor, 0)
  const ultimoConteo = datos?.conteos[0] ?? null
  const sugerencias = datos?.sugerencias ?? []
  const vencidas = sugerencias.length
  const control = () => ir('/inventario/control')

  const vigilados = [
    {
      titulo: 'Pérdidas · últimos 30 días',
      valor: datos ? fmt(perdidas) : '…',
      detalle: 'mermas y faltantes de conteo',
      color: perdidas > 0 ? t.peligro : t.tinta,
      alTocar: control,
    },
    {
      titulo: 'Último conteo',
      valor: ultimoConteo ? fechaCorta(ultimoConteo.fecha) : '—',
      detalle: ultimoConteo ? `${ultimoConteo.contados} contadas · ${ultimoConteo.cuadraron} cuadraron` : 'todavía no se ha contado',
      color: t.tinta,
      alTocar: control,
    },
    {
      titulo: 'Por comprar',
      valor: datos ? String(vencidas) : '…',
      detalle: vencidas === 0 ? 'todo por encima del mínimo' : 'bajo mínimo o no llega a la semana',
      color: vencidas > 0 ? t.aviso : t.exito,
      alTocar: alVerComprar,
    },
  ]

  return (
    <>
      {/* Arriba, chico: lo que hay que vigilar. Son tres cifras y se tocan.
          En el telefono, una franja de tres renglones; en la tablet, lado a lado. */}
      {tablet ? (
        <View style={s.fila3}>
          {vigilados.map((v) => (
            <Pulsable key={v.titulo} alTocar={v.alTocar} style={{ flex: 1 }} etiqueta={v.titulo}>
              <Ficha style={{ paddingVertical: 14, paddingHorizontal: 16 }}>
                <Text style={[s.vigTitulo, { color: t.tenue }]} numberOfLines={1}>
                  {v.titulo}
                </Text>
                <Text style={[s.vigValor, { color: v.color }]} numberOfLines={1} adjustsFontSizeToFit>
                  {v.valor}
                </Text>
                <Text style={[s.vigDetalle, { color: t.tenue }]} numberOfLines={1}>
                  {v.detalle}
                </Text>
              </Ficha>
            </Pulsable>
          ))}
        </View>
      ) : (
        <ListaFicha>
          {vigilados.map((v, i) => (
            <Pulsable key={v.titulo} alTocar={v.alTocar} etiqueta={v.titulo}>
              <View style={[s.vigFila, i < vigilados.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[s.vigTituloFila, { color: t.suave }]} numberOfLines={1}>
                    {v.titulo}
                  </Text>
                  <Text style={[s.vigDetalle, { color: t.tenue }]} numberOfLines={1}>
                    {v.detalle}
                  </Text>
                </View>
                <Text style={[s.vigValorFila, { color: v.color }]} numberOfLines={1}>
                  {v.valor}
                </Text>
              </View>
            </Pulsable>
          ))}
        </ListaFicha>
      )}

      {/* En el medio, grandes: los cuatro almacenes. Es a donde se entra. */}
      <View style={[s.grilla, tablet && s.grillaTablet]}>
        {ALMACENES.map((a) => (
          <View key={a.valor} style={tablet ? s.mitad : undefined}>
            <FichaAlmacen a={a} r={lista.find((x) => x.tipo === a.valor)} />
          </View>
        ))}
      </View>

      {sugerencias.length > 0 && (
        <ListaFicha
          titulo="Qué comprar"
          accion={<Enlace texto={`Ver todo (${sugerencias.length})`} alTocar={alVerComprar} />}
        >
          <Text style={[s.ayuda, { color: t.suave }]}>Lo que está bajo mínimo o no llega a la semana al ritmo de venta.</Text>
          {sugerencias.slice(0, 5).map((sg, i, todas) => {
            const ing = datos?.ingredientes.find((x) => x.id === sg.ingrediente_id)
            return (
              <View
                key={sg.ingrediente_id}
                style={[s.sugerencia, i < todas.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 }]}
              >
                {ing ? <PuntoTipo tipo={ing.tipo} /> : null}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[s.sugNombre, { color: t.tinta }]} numberOfLines={1}>
                    {sg.ingrediente_nombre}
                  </Text>
                  <Text style={[s.vigDetalle, { color: t.suave }]} numberOfLines={2}>
                    {sg.razon}
                  </Text>
                </View>
                <Text style={[s.sugCifra, { color: t.tinta }]}>
                  +{cantidad(sg.cantidad_sugerida)} {unidadDe(sg.cantidad_sugerida, sg.unidad)}
                </Text>
                {ing ? <BotonLlego alTocar={() => alComprar(ing)} /> : null}
              </View>
            )
          })}
        </ListaFicha>
      )}
    </>
  )
}

/** El "Llegó" de un renglon de Qué comprar: abre la compra sin factura. */
export function BotonLlego({ alTocar }: { alTocar: () => void }) {
  const t = useTema()
  return (
    <Pulsable alTocar={alTocar} etiqueta="Llegó" style={[s.llego, { borderColor: t.gris200, backgroundColor: t.superficie }]}>
      <Text style={[s.llegoTexto, { color: t.tinta }]}>Llegó</Text>
    </Pulsable>
  )
}

function FichaAlmacen({ a, r }: { a: Almacen; r?: ResumenAlmacen }) {
  const t = useTema()
  const { fmt } = useMoneda()
  const esGasto = a.destino === 'gasto'
  const camino = CAMINO[a.valor]
  const k = colorDe(a.valor, t)
  return (
    <Pulsable alTocar={() => ir(`/inventario/${RUTA_DE[a.valor]}`)} etiqueta={a.texto}>
      <Ficha style={{ gap: 14, padding: 18 }}>
        <View style={s.almCabeza}>
          <SelloAlmacen tipo={a.valor} tamano={44} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.almNombre, { color: t.tinta }]}>{a.texto}</Text>
            <Text style={[s.vigDetalle, { color: t.suave }]} numberOfLines={1}>
              {a.ejemplo}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[s.almCuenta, { color: t.suave }]}>{r ? `${r.mercancias} mercancía${r.mercancias === 1 ? '' : 's'}` : '…'}</Text>
            {r?.preparaciones != null && r.preparaciones > 0 ? (
              <Text style={[s.almCuenta, { color: t.suave }]}>
                {r.preparaciones} {r.preparaciones === 1 ? 'preparación' : 'preparaciones'}
              </Text>
            ) : null}
          </View>
        </View>
        <View>
          <Text style={[s.vigDetalle, { color: t.tenue }]}>{esGasto ? 'Gastado · últimos 30 días' : 'Plata en el inventario'}</Text>
          <Text style={[s.almPlata, { color: t.tinta }]} numberOfLines={1} adjustsFontSizeToFit>
            {r ? fmt(r.plata) : '…'}
          </Text>
          <Text style={[s.vigDetalle, { marginTop: 4 }]}>
            {!r ? (
              ' '
            ) : esGasto ? (
              <Text style={{ color: t.suave }}>sin stock: va directo a gasto</Text>
            ) : r.bajoMinimo > 0 ? (
              <Text style={{ color: t.aviso, fontFamily: LETRA.textoFuerte }}>{r.bajoMinimo} bajo mínimo</Text>
            ) : (
              <Text style={{ color: t.exito }}>todo por encima del mínimo</Text>
            )}
            {r && r.sinCosto > 0 ? <Text style={{ color: t.tenue }}> · {r.sinCosto} sin costo</Text> : null}
          </Text>
        </View>
        <Text style={[s.camino, { color: t.tenue }]}>
          {camino.map((paso, i) => (
            <Text key={paso}>
              {i > 0 ? '  →  ' : ''}
              <Text style={i === 1 ? { fontFamily: LETRA.textoFuerte, color: esGasto ? k.tinta : t.suave } : undefined}>{paso}</Text>
            </Text>
          ))}
        </Text>
      </Ficha>
    </Pulsable>
  )
}

const s = StyleSheet.create({
  fila3: { flexDirection: 'row', gap: 12 },
  vigTitulo: { fontFamily: LETRA.textoFuerte, fontSize: 12.5 },
  vigValor: { fontFamily: LETRA.tituloFuerte, fontSize: 22, letterSpacing: -0.4, marginTop: 2 },
  vigDetalle: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 1 },
  vigFila: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11, minHeight: 56 },
  vigTituloFila: { fontFamily: LETRA.textoFuerte, fontSize: 14 },
  vigValorFila: { fontFamily: LETRA.tituloFuerte, fontSize: 19, letterSpacing: -0.3 },
  grilla: { gap: 12 },
  grillaTablet: { flexDirection: 'row', flexWrap: 'wrap' },
  mitad: { width: '48.9%' },
  almCabeza: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  almNombre: { fontFamily: LETRA.titulo, fontSize: 18, letterSpacing: -0.3 },
  almCuenta: { fontFamily: LETRA.texto, fontSize: 13 },
  almPlata: { fontFamily: LETRA.tituloFuerte, fontSize: 30, letterSpacing: -0.8, marginTop: 2 },
  camino: { fontFamily: LETRA.texto, fontSize: 13 },
  ayuda: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19, paddingHorizontal: 16, paddingBottom: 4 },
  sugerencia: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 11 },
  sugNombre: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  sugCifra: { fontFamily: LETRA.cifraFuerte, fontSize: 14 },
  llego: { minHeight: 40, minWidth: 64, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  llegoTexto: { fontFamily: LETRA.textoFuerte, fontSize: 13.5 },
})
