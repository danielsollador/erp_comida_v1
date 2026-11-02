import { StyleSheet, Text, View } from 'react-native'
import { conVariacion, queLePaso } from '../../../../../frontend/src/lib/inventario'
import { descargar } from '../../../lib/archivos'
import { useMoneda } from '../../../lib/moneda'
import { fechaCorta, periodoDe } from '../../../lib/numeros'
import { LETRA, useTema } from '../../../lib/tema'
import type { CompraDeInsumo, ExtractoInsumo, MovimientoInventario, RenglonPorTipo } from '../../../lib/tipos'
import { FilaFiltros, Selector } from '../../kit'
import { Aviso } from '../../ui'
import { conUnidad, Enlace, legible, Rotulo } from '../comun'

/*
 * LO QUE LE PASO A UNA MERCANCIA: lo ultimo, en frases, y detras de "Ver
 * todo" el extracto completo (el kardex) con su resumen por motivo, la
 * descarga en CSV y lo que se ha pagado por ella compra a compra. Las mismas
 * piezas de pages/partes/inventario/FichaMercancia.tsx.
 */

/** "12/10/2026": la fecha del extracto completo, sin depender de Intl. */
function fechaLarga(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return a && m && d ? `${d}/${m}/${a}` : iso
}

/**
 * El movimiento dicho como lo diria el dueño (queLePaso de la web). El alta
 * con existencia el backend la anota "Existencia declarada al crear el
 * insumo", que la web no reconoce y lee como "Al contar, había de más".
 */
function queFue(m: MovimientoInventario): string {
  if (m.tipo === 'ajuste' && /existencia (declarada|al empezar)/i.test(m.nota)) return 'Lo que había al empezar'
  return queLePaso(m)
}

/** Un saldo con su signo: lo que queda puede ser negativo (se saco mas de lo que habia). */
const conSigno = (n: number, unidad: string) => `${n < 0 ? '−' : ''}${legible(n, unidad)}`

/** Un movimiento: cuando, que paso (y la nota y quien), cuanto y cuanto quedo. */
function Movimiento({ m, unidad, ultima, completo }: { m: MovimientoInventario; unidad: string; ultima: boolean; completo: boolean }) {
  const t = useTema()
  const { fmt } = useMoneda()
  const nota = [m.nota, m.operador].filter(Boolean).join(' · ')
  return (
    <View style={[s.mov, !ultima && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 }]}>
      <Text style={[s.movFecha, { color: t.suave }]}>{completo ? fechaLarga(m.fecha) : fechaCorta(m.fecha)}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[s.movQue, { color: t.tinta }]} numberOfLines={2}>
          {queFue(m)}
        </Text>
        {nota ? (
          <Text style={[s.chico, { color: t.tenue }]} numberOfLines={2}>
            {nota}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[s.movCantidad, { color: m.cantidad < 0 ? t.peligro : t.exito }]}>
          {m.cantidad > 0 ? '+' : '−'}
          {legible(m.cantidad, unidad)}
        </Text>
        {/* El equivalente en plata: sin esto, "-0.025" no dice si eso que
            salio costo un centavo o un dolar. */}
        {completo ? <Text style={[s.chicoCifra, { color: m.valor < 0 ? t.peligro : t.tenue }]}>{fmt(Math.abs(m.valor))}</Text> : null}
        <Text style={[s.chico, { color: t.tenue }]}>quedó {conUnidad(m.saldo, unidad)}</Text>
      </View>
    </View>
  )
}

/** Los ultimos seis movimientos, del mas nuevo al mas viejo. */
export function Ultimos({ extracto, unidad }: { extracto: ExtractoInsumo; unidad: string }) {
  const t = useTema()
  const ultimos = extracto.movimientos
    .slice()
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .slice(0, 6)
  return (
    <View style={[s.caja, { borderColor: t.gris200 }]}>
      {ultimos.map((m, i) => (
        <Movimiento key={m.id} m={m} unidad={unidad} ultima={i === ultimos.length - 1} completo={false} />
      ))}
    </View>
  )
}

// Los grupos del resumen, dichos como en la lista de movimientos.
const GRUPO: Record<string, string> = {
  compra: 'Compras',
  venta: 'Ventas',
  merma: 'Se dañó o se botó',
  consumo_personal: 'La usó el personal',
  ajuste: 'Conteos',
  reverso: 'Movimientos deshechos',
}

/**
 * El extracto completo: el periodo, la descarga, de donde salio y de donde
 * entro (agrupado por motivo, con la cuenta inicial + entradas − salidas =
 * final), cada movimiento y lo que se ha pagado.
 */
export function ExtractoCompleto({
  extracto,
  historial,
  unidad,
  nombre,
  idMercancia,
  rutaCsv,
  desde,
  alCambiarDesde,
  alError,
}: {
  extracto: ExtractoInsumo
  historial: CompraDeInsumo[] | null
  unidad: string
  nombre: string
  idMercancia: number
  rutaCsv: string
  desde: string
  alCambiarDesde: (desde: string) => void
  alError: (texto: string) => void
}) {
  const t = useTema()
  const { fmt } = useMoneda()
  const opciones = [
    { valor: '', texto: 'Desde el principio' },
    { valor: periodoDe('7d').desde, texto: 'Últimos 7 días' },
    { valor: periodoDe('30d').desde, texto: 'Últimos 30 días' },
    { valor: periodoDe('mes').desde, texto: 'Este mes' },
    { valor: periodoDe('90d').desde, texto: 'Últimos 90 días' },
  ].filter((o, k, todas) => todas.findIndex((x) => x.valor === o.valor) === k)
  const movimientos = extracto.movimientos.slice().sort((a, b) => b.fecha.localeCompare(a.fecha))

  return (
    <View style={{ gap: 14 }}>
      <View style={s.filaFiltros}>
        <View style={{ flex: 1 }}>
          <FilaFiltros>
            <Selector etiqueta="Período" opciones={opciones} valor={desde} alCambiar={alCambiarDesde} />
          </FilaFiltros>
        </View>
        <Enlace
          texto="Descargar la lista"
          alTocar={() =>
            void descargar(rutaCsv, `movimientos-${nombre}-${idMercancia}.csv`).catch((e: Error) => alError(e.message || 'No se pudo descargar'))
          }
        />
      </View>

      {extracto.movimientos.length === 0 ? (
        <Text style={[s.texto, { color: t.suave }]}>No se movió nada en ese período.</Text>
      ) : (
        <>
          <ResumenDelExtracto e={extracto} desde={desde} />
          {!extracto.cuadra ? (
            <Aviso
              tono="peligro"
              texto={`El libro suma ${conUnidad(extracto.saldo_segun_libro, unidad)} y la existencia dice ${conUnidad(extracto.stock_actual, unidad)}. Algo movió el stock sin anotarlo: avísale a quien mantiene el sistema.`}
            />
          ) : null}
          <View style={[s.caja, { borderColor: t.gris200 }]}>
            {movimientos.map((m, i) => (
              <Movimiento key={m.id} m={m} unidad={unidad} ultima={i === movimientos.length - 1} completo />
            ))}
          </View>
        </>
      )}

      {/* Lo que se ha pagado por ella, compra a compra. */}
      <View style={{ gap: 6 }}>
        <Rotulo>Lo que has pagado</Rotulo>
        {historial === null ? (
          <Text style={[s.texto, { color: t.tenue }]}>Cargando…</Text>
        ) : historial.length === 0 ? (
          <Text style={[s.texto, { color: t.suave }]}>Todavía no hay compras registradas.</Text>
        ) : (
          <View style={[s.caja, { borderColor: t.gris200 }]}>
            {conVariacion(historial)
              .slice()
              .sort((a, b) => b.fecha.localeCompare(a.fecha))
              .map((c, i, todas) => (
                <View
                  key={`${c.fecha}-${i}`}
                  style={[s.mov, i < todas.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 }]}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[s.movQue, { color: t.tinta }]}>{fechaLarga(c.fecha)}</Text>
                    <Text style={[s.chico, { color: t.tenue }]} numberOfLines={1}>
                      {c.origen} · {conUnidad(c.cantidad, unidad)}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[s.movCantidad, { color: t.tinta }]}>{fmt(c.costo_unitario)}</Text>
                    {c.cambio != null && Math.abs(c.cambio) >= 1 ? (
                      <Text style={[s.chicoCifra, { color: c.cambio > 0 ? t.aviso : t.exito }]}>
                        {c.cambio > 0 ? '+' : ''}
                        {c.cambio.toFixed(0)}%
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))}
          </View>
        )}
      </View>
    </View>
  )
}

/**
 * De donde salio y de donde entro, agrupado por motivo: responde "de donde
 * salieron los 3 kg que faltan" sin sumar doscientas filas a ojo. Con un
 * "desde" cierra con la cuenta completa: apertura + entradas − salidas = final.
 */
function ResumenDelExtracto({ e, desde }: { e: ExtractoInsumo; desde: string }) {
  const t = useTema()
  return (
    <View style={[s.caja, { borderColor: t.gris200, paddingVertical: 4 }]}>
      <View style={s.resFila}>
        <Text style={[s.resCabeza, { color: t.tenue, flex: 1 }]}>Qué pasó</Text>
        <Text style={[s.resCabeza, s.colVeces, { color: t.tenue }]}>Veces</Text>
        <Text style={[s.resCabeza, s.colCant, { color: t.tenue }]}>Cantidad</Text>
        <Text style={[s.resCabeza, s.colVale, { color: t.tenue }]}>Vale</Text>
      </View>
      {desde ? (
        <View style={[s.resFila, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.gris200 }]}>
          <Text style={[s.resGrupo, { color: t.suave, flex: 1 }]}>Había al empezar</Text>
          <Text style={[s.resCifraFuerte, s.colCantAncha, { color: t.tinta }]}>{conSigno(e.saldo_inicial, e.unidad)}</Text>
        </View>
      ) : null}
      <Grupo titulo="Entró" filas={e.entradas} total={e.total_entradas} signo="+" color={t.exito} unidad={e.unidad} />
      <Grupo titulo="Salió" filas={e.salidas} total={e.total_salidas} signo="−" color={t.peligro} unidad={e.unidad} />
      <View style={[s.resFila, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.gris200 }]}>
        <Text style={[s.resGrupo, { color: t.fuerte, flex: 1 }]}>Quedan</Text>
        <Text style={[s.resCifraFuerte, s.colCantAncha, { color: t.tinta }]}>{conSigno(desde ? e.saldo_final : e.stock_actual, e.unidad)}</Text>
      </View>
    </View>
  )
}

function Grupo({
  titulo,
  filas,
  total,
  signo,
  color,
  unidad,
}: {
  titulo: string
  filas: RenglonPorTipo[]
  total: number
  signo: '+' | '−'
  color: string
  unidad: string
}) {
  const t = useTema()
  const { fmt } = useMoneda()
  const valor = filas.reduce((x, f) => x + Math.abs(f.valor), 0)
  return (
    <>
      <View style={[s.resFila, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.gris200 }]}>
        <Text style={[s.resGrupo, { color: t.suave, flex: 1 }]}>{titulo}</Text>
        <View style={s.colVeces} />
        <Text style={[s.resCifraFuerte, s.colCant, { color }]}>
          {signo}
          {legible(total, unidad)}
        </Text>
        <Text style={[s.resCifra, s.colVale, { color: t.tenue }]}>{fmt(valor)}</Text>
      </View>
      {filas.length === 0 ? (
        <Text style={[s.chico, { color: t.tenue, paddingLeft: 26, paddingBottom: 8 }]}>Nada en este período.</Text>
      ) : (
        filas.map((f) => (
          <View key={f.tipo} style={[s.resFila, { paddingVertical: 6 }]}>
            <Text style={[s.resNombre, { color: t.fuerte, flex: 1, paddingLeft: 12 }]} numberOfLines={2}>
              {GRUPO[f.tipo] ?? f.etiqueta}
            </Text>
            <Text style={[s.resCifra, s.colVeces, { color: t.tenue }]}>{f.movimientos}</Text>
            <Text style={[s.resCifra, s.colCant, { color: t.tinta }]}>{legible(f.cantidad, unidad)}</Text>
            <Text style={[s.resCifra, s.colVale, { color: t.tenue }]}>{fmt(Math.abs(f.valor))}</Text>
          </View>
        ))
      )}
    </>
  )
}

const s = StyleSheet.create({
  caja: { borderWidth: 1, borderRadius: 16, borderCurve: 'continuous', overflow: 'hidden' },
  mov: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11 },
  movFecha: { width: 64, fontFamily: LETRA.cifra, fontSize: 13 },
  movQue: { fontFamily: LETRA.textoFuerte, fontSize: 14.5 },
  movCantidad: { fontFamily: LETRA.cifraFuerte, fontSize: 14 },
  chico: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 1 },
  chicoCifra: { fontFamily: LETRA.cifra, fontSize: 13, marginTop: 1 },
  texto: { fontFamily: LETRA.texto, fontSize: 14.5, lineHeight: 20 },
  filaFiltros: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  resFila: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9 },
  resCabeza: { fontFamily: LETRA.textoFuerte, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' },
  resGrupo: { fontFamily: LETRA.textoFuerte, fontSize: 12, letterSpacing: 1, textTransform: 'uppercase' },
  resNombre: { fontFamily: LETRA.texto, fontSize: 13.5 },
  resCifra: { fontFamily: LETRA.cifra, fontSize: 13 },
  resCifraFuerte: { fontFamily: LETRA.cifraFuerte, fontSize: 13 },
  colVeces: { width: 40, textAlign: 'right' },
  colCant: { width: 84, textAlign: 'right' },
  colVale: { width: 78, textAlign: 'right' },
  colCantAncha: { textAlign: 'right' },
})
