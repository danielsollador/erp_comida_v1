import { useEffect, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { etiquetaMetodo, METODOS_CON_REFERENCIA } from '../../../../frontend/src/lib/pagos'
import { apiCaja } from '../../lib/api-caja'
import { bolivares, dolares } from '../../lib/formato'
import { useMoneda } from '../../lib/moneda'
import { horaCorta } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import type { CobroDelDia, LineaMetodo, ResumenCaja } from '../../lib/tipos'
import { useDisposicion } from '../kit'
import { Ficha, Nota, Titulo } from '../ui'
import { cuadra, entradaDe, plural, salidaDe, sinReferencia } from './logica'
import { useDosMonedas } from './piezas'

/**
 * 3. POR DONDE ENTRO Y POR DONDE SALIO, forma de pago por forma de pago
 * (el `Desglose` de pages/Caja.tsx).
 *
 * SIEMPRE salen TODAS, incluso en cero: el cierre se lee como una lista de
 * chequeo, y un cobro registrado en la forma equivocada tiene que saltar a
 * los ojos en vez de desaparecer.
 *
 * LA FILA SUMA A LA VISTA: fondo + entro − salio = debes tener. Y el
 * veredicto vive aqui: con el dia cerrado aparecen lo reportado por el
 * cajero y en cuanto fallo.
 *
 * En la tablet es la tabla de la web, columna por columna. En el telefono
 * seis columnas no caben: cada forma es un bloque con "Debes tener" a la
 * derecha (es la cifra que se va a contar) y debajo, de a dos, lo que entro
 * y lo que salio, y lo reportado y la diferencia.
 */
export function Desglose({ r }: { r: ResumenCaja }) {
  const t = useTema()
  const { tablet } = useDisposicion()
  const { bcv } = useDosMonedas()

  const totalEntro = r.desglose.reduce((s, l) => s + entradaDe(l), 0)
  const totalSalio = r.desglose.reduce((s, l) => s + salidaDe(l), 0)
  const totalCuadra = r.desglose.filter((l) => l.se_cuadra).reduce((s, l) => s + l.esperado, 0)
  // Las dos columnas del veredicto solo existen si ya se conto: antes del
  // cierre serian dos columnas vacias pidiendo que se llenen a mano.
  const cerrada = r.desglose.some((l) => l.contado !== null)
  const totalContado = r.desglose.reduce((s, l) => s + (l.contado ?? 0), 0)
  const totalDif = r.desglose.reduce((s, l) => s + (l.diferencia ?? 0), 0)

  // El detalle de cada fila: cobro por cobro, con su referencia. El cierre
  // dice CUANTO falta en el punto; esto dice CUAL ticket fue. Se guarda con
  // su fecha para no mostrar los cobros de otro dia mientras llegan los nuevos.
  const [cobros, setCobros] = useState<{ fecha: string; lista: CobroDelDia[] } | null>(null)
  const [abierta, setAbierta] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    apiCaja
      .cobrosDelDia(r.fecha)
      .then((lista) => {
        if (vivo) setCobros({ fecha: r.fecha, lista })
      })
      .catch(() => {
        if (vivo) setCobros(null)
      })
    return () => {
      vivo = false
    }
  }, [r.fecha, r.cobrado])
  const delDia = cobros && cobros.fecha === r.fecha ? cobros.lista : null

  return (
    <Ficha style={{ paddingHorizontal: tablet ? 20 : 0 }}>
      <View style={{ paddingHorizontal: tablet ? 0 : 20, gap: 4 }}>
        <Titulo>Desglose por forma de pago</Titulo>
        <Nota>
          Cada forma tiene su propia fuente: los billetes se cuentan, el punto imprime su lote, el pago móvil se mira en el
          banco. &quot;Debes tener&quot; es el fondo con el que arrancó más lo que entró menos lo que salió.{' '}
          {bcv ? `Los bolívares van a ${bolivares(bcv)} por dólar, la tasa de hoy.` : 'Sin tasa del día no se pueden mostrar los bolívares.'}
        </Nota>
      </View>

      {tablet ? (
        <View style={[d.tablaCabeza, { borderBottomColor: t.gris200 }]}>
          <Text style={[d.columnaNombre, d.encabezado, { color: t.tenue }]}>Forma de pago</Text>
          <Text style={[d.columna, d.encabezado, { color: t.tenue }]}>Entró</Text>
          <Text style={[d.columna, d.encabezado, { color: t.tenue }]}>Salió</Text>
          <Text style={[d.columna, d.encabezado, { color: t.tenue }]}>Debes tener</Text>
          {cerrada ? (
            <>
              <Text style={[d.columna, d.encabezado, { color: t.tenue }]}>Reportado por cajero</Text>
              <Text style={[d.columna, d.encabezado, { color: t.tenue }]}>Diferencia</Text>
            </>
          ) : null}
        </View>
      ) : null}

      {r.desglose.map((l) => {
        const suyos = delDia?.filter((c) => c.metodo === l.metodo) ?? []
        const abiertaEsta = abierta === l.metodo
        return (
          <FilaMetodo
            key={l.metodo}
            l={l}
            tablet={tablet}
            cerrada={cerrada}
            cuantos={suyos.length}
            alertas={suyos.filter((c) => c.repetida || sinReferencia(c)).length}
            abierta={abiertaEsta}
            alAlternar={() => setAbierta(abiertaEsta ? null : l.metodo)}
          >
            {abiertaEsta ? <DetalleCobros cobros={suyos} /> : null}
          </FilaMetodo>
        )
      })}

      {/* El total: lo que entro, lo que salio y lo que hay que tener entre todas. */}
      <View style={[tablet ? d.filaTabla : d.bloque, d.total, { borderTopColor: t.gris200 }]}>
        {tablet ? (
          <>
            <Text style={[d.columnaNombre, d.metodo, { color: t.tinta }]}>Total</Text>
            <Monto usd={totalEntro} fuerte />
            <Monto usd={-totalSalio} color={t.peligro} fuerte />
            <Monto usd={totalCuadra} fuerte />
            {cerrada ? (
              <>
                <Monto usd={totalContado} fuerte />
                <Monto usd={totalDif} color={cuadra(totalDif) ? t.exito : t.peligro} fuerte />
              </>
            ) : null}
          </>
        ) : (
          <>
            <View style={d.cabezaBloque}>
              <Text style={[d.metodo, { color: t.tinta, flex: 1 }]}>Total</Text>
              <Monto usd={totalCuadra} fuerte etiqueta="Debes tener" />
            </View>
            <View style={d.par}>
              <Monto usd={totalEntro} etiqueta="Entró" izquierda fuerte />
              <Monto usd={-totalSalio} color={t.peligro} etiqueta="Salió" izquierda fuerte />
            </View>
            {cerrada ? (
              <View style={d.par}>
                <Monto usd={totalContado} etiqueta="Reportado por cajero" izquierda fuerte />
                <Monto usd={totalDif} color={cuadra(totalDif) ? t.exito : t.peligro} etiqueta="Diferencia" izquierda fuerte />
              </View>
            ) : null}
          </>
        )}
      </View>
    </Ficha>
  )
}

/**
 * Un importe en las dos monedas, una debajo de la otra. Un cero se escribe,
 * no se calla: en un cuadre "no entro nada por Zelle" es una afirmacion que
 * alguien confirma, no un dato ausente. Solo se apaga.
 */
function Monto({
  usd,
  color,
  fuerte = false,
  etiqueta,
  izquierda = false,
}: {
  usd: number
  color?: string
  fuerte?: boolean
  etiqueta?: string
  izquierda?: boolean
}) {
  const t = useTema()
  const { fmt, otra } = useDosMonedas()
  const vacia = usd === 0
  const debajo = otra(usd)
  return (
    <View style={[izquierda ? d.celdaIzquierda : d.columna, { alignItems: izquierda ? 'flex-start' : 'flex-end' }]}>
      {etiqueta ? <Text style={[d.etiquetaCelda, { color: t.tenue }]}>{etiqueta}</Text> : null}
      <Text style={[fuerte ? d.montoFuerte : d.monto, { color: vacia ? t.tenue : (color ?? t.tinta) }]} numberOfLines={1}>
        {fmt(usd)}
      </Text>
      {debajo ? (
        <Text style={[d.montoBs, { color: t.tenue }]} numberOfLines={1}>
          {debajo}
        </Text>
      ) : null}
    </View>
  )
}

/** La diferencia de una forma: cuadra, sobran (ambar) o faltan (rojo). */
function Diferencia({ l, izquierda = false }: { l: LineaMetodo; izquierda?: boolean }) {
  const t = useTema()
  const { fmt, otra } = useDosMonedas()
  const caja = [izquierda ? d.celdaIzquierda : d.columna, { alignItems: izquierda ? ('flex-start' as const) : ('flex-end' as const) }]
  const etiqueta = izquierda ? <Text style={[d.etiquetaCelda, { color: t.tenue }]}>Diferencia</Text> : null
  if (l.diferencia === null) {
    return (
      <View style={caja}>
        {etiqueta}
        <Text style={[d.monto, { color: t.tenue }]}>—</Text>
      </View>
    )
  }
  if (cuadra(l.diferencia)) {
    return (
      <View style={caja}>
        {etiqueta}
        <Text style={[d.veredicto, { color: t.exito }]}>cuadra</Text>
      </View>
    )
  }
  const color = l.diferencia < 0 ? t.peligro : t.aviso
  const debajo = otra(Math.abs(l.diferencia))
  return (
    <View style={caja}>
      {etiqueta}
      <Text style={[d.montoFuerte, { color }]} numberOfLines={1}>
        {l.diferencia > 0 ? 'sobran ' : 'faltan '}
        {fmt(Math.abs(l.diferencia))}
      </Text>
      {debajo ? <Text style={[d.montoBs, { color: t.tenue }]}>{debajo}</Text> : null}
    </View>
  )
}

/** Lo que dice cada fila debajo del nombre: como se verifica, y con cuanto arranco. */
function pistaDe(l: LineaMetodo, fmt: (usd: number) => string): string {
  const como = !l.se_cuadra
    ? 'no entró plata: es una deuda'
    : l.fisico
      ? 'se cuenta: lo que hay en la gaveta'
      : 'se coteja: el movimiento del día'
  // Un fondo contado y un saldo heredado no valen lo mismo: el primero es un
  // hecho de esta mañana, el segundo una suposicion que arrastra errores.
  const fondo = l.fondo !== 0 ? ` · arrancó con ${fmt(l.fondo)}${l.fondo_declarado ? ' contados al abrir' : ' de días anteriores'}` : ''
  return como + fondo
}

function FilaMetodo({
  l,
  tablet,
  cerrada,
  cuantos,
  alertas,
  abierta,
  alAlternar,
  children,
}: {
  l: LineaMetodo
  tablet: boolean
  cerrada: boolean
  cuantos: number
  alertas: number
  abierta: boolean
  alAlternar: () => void
  children?: ReactNode
}) {
  const t = useTema()
  const { fmt } = useDosMonedas()

  const nombre = (
    <View style={{ gap: 2 }}>
      <Text style={[d.metodo, { color: t.tinta }]}>{etiquetaMetodo(l.metodo)}</Text>
      <Text style={[d.pista, { color: t.tenue }]}>{pistaDe(l, fmt)}</Text>
      {cuantos > 0 ? (
        <Pressable
          onPress={alAlternar}
          accessibilityRole="button"
          accessibilityState={{ expanded: abierta }}
          hitSlop={6}
          style={({ pressed }) => [d.verCobros, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={[d.verCobrosTexto, { color: t.acento }]}>
            {abierta ? 'Ocultar cobros' : `Ver ${plural(cuantos, 'cobro', 'cobros')}`}
            {alertas > 0 ? <Text style={{ color: t.peligro }}> · {alertas} por revisar</Text> : null}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )

  const debesTener = (etiqueta?: string) =>
    l.se_cuadra ? (
      <Monto usd={l.esperado} fuerte etiqueta={etiqueta} />
    ) : (
      <View style={[d.columna, { alignItems: 'flex-end' }]}>
        {etiqueta ? <Text style={[d.etiquetaCelda, { color: t.tenue }]}>{etiqueta}</Text> : null}
        <Text style={[d.monto, { color: t.tenue }]}>—</Text>
      </View>
    )

  const reportado = (izquierda: boolean) =>
    l.contado === null ? (
      <View style={[izquierda ? d.celdaIzquierda : d.columna, { alignItems: izquierda ? 'flex-start' : 'flex-end' }]}>
        {izquierda ? <Text style={[d.etiquetaCelda, { color: t.tenue }]}>Reportado por cajero</Text> : null}
        <Text style={[d.pista, { color: t.tenue }]}>sin verificar</Text>
      </View>
    ) : (
      <Monto usd={l.contado} fuerte etiqueta={izquierda ? 'Reportado por cajero' : undefined} izquierda={izquierda} />
    )

  if (tablet) {
    return (
      <View style={[d.filaTablaCaja, { borderBottomColor: t.gris100 }]}>
        <View style={d.filaTabla}>
          <View style={d.columnaNombre}>{nombre}</View>
          <Monto usd={entradaDe(l)} />
          <Monto usd={-salidaDe(l)} color={t.peligro} />
          {debesTener()}
          {cerrada ? (
            <>
              {reportado(false)}
              <Diferencia l={l} />
            </>
          ) : null}
        </View>
        {children}
      </View>
    )
  }

  return (
    <View style={[d.bloque, { borderTopColor: t.gris200 }]}>
      <View style={d.cabezaBloque}>
        <View style={{ flex: 1, minWidth: 0 }}>{nombre}</View>
        {debesTener('Debes tener')}
      </View>
      <View style={d.par}>
        <Monto usd={entradaDe(l)} etiqueta="Entró" izquierda />
        <Monto usd={-salidaDe(l)} color={t.peligro} etiqueta="Salió" izquierda />
      </View>
      {cerrada ? (
        <View style={d.par}>
          {reportado(true)}
          <Diferencia l={l} izquierda />
        </View>
      ) : null}
      {children}
    </View>
  )
}

/**
 * Los cobros de una forma de pago, uno por uno y en orden de hora: el mismo
 * orden del lote del punto y del estado de cuenta, para bajar por las dos
 * listas a la vez. Los bolivares van a la tasa a la que se cobro, que es lo
 * que de verdad paso por el terminal.
 */
function DetalleCobros({ cobros }: { cobros: CobroDelDia[] }) {
  const t = useTema()
  const { fmt, otra, bcv } = useDosMonedas()
  const { vista } = useMoneda()
  if (cobros.length === 0) {
    return <Text style={[d.pista, { color: t.tenue, paddingVertical: 8 }]}>No hubo cobros por esta vía.</Text>
  }
  const conReferencia = cobros.some((c) => METODOS_CON_REFERENCIA.has(c.metodo))
  const total = cobros.reduce((s, c) => s + c.monto, 0)
  const totalBs = cobros.reduce((s, c) => s + c.monto * (c.tasa ?? bcv ?? 0), 0)
  // En la vista en bolivares, lo de abajo es el dolar; si no, los bolivares
  // de cada cobro sumados a su propia tasa.
  const totalOtra = vista === 'bs' ? dolares(total) : totalBs ? bolivares(totalBs) : '—'
  return (
    <View style={[d.cobros, { backgroundColor: t.gris100 }]}>
      {cobros.map((c, n) => (
        <View
          key={`${c.tipo}-${c.pedido_id}-${n}`}
          style={[
            d.cobro,
            n > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.gris200 },
            c.repetida && { backgroundColor: t.peligroSuave },
          ]}
        >
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={[d.cobroTexto, { color: t.tinta }]}>
              <Text style={{ color: t.suave }}>{horaCorta(c.fecha) || '—'} · </Text>
              <Text style={{ fontFamily: LETRA.textoFuerte }}>#{c.numero}</Text>
              {c.cliente ? <Text style={{ color: t.suave }}> · {c.cliente}</Text> : null}
              {c.tipo === 'abono' ? <Text style={{ color: t.suave }}> · abono de fiado</Text> : null}
            </Text>
            {conReferencia && (c.referencia || sinReferencia(c) || c.repetida) ? (
              <Text style={[d.cobroTexto, { color: t.suave }]}>
                {c.referencia ? <Text style={{ fontFamily: LETRA.cifra, color: t.tinta }}>{c.referencia}</Text> : null}
                {!c.referencia && sinReferencia(c) ? <Text style={{ color: t.aviso }}>sin referencia</Text> : null}
                {c.repetida ? <Text style={[d.repetida, { color: t.peligro }]}>  REPETIDA</Text> : null}
              </Text>
            ) : null}
            <Text style={[d.cobroTexto, { color: t.tenue }]}>cobró {c.cobrado_por || '—'}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[d.monto, { color: c.monto < 0 ? t.peligro : t.tinta }]}>{fmt(c.monto)}</Text>
            <Text style={[d.montoBs, { color: t.tenue }]}>{otra(c.monto, c.tasa) ?? '—'}</Text>
          </View>
        </View>
      ))}
      <View style={[d.cobro, { borderTopWidth: 1, borderTopColor: t.gris200 }]}>
        <Text style={[d.cobroTexto, { color: t.tinta, fontFamily: LETRA.textoFuerte, flex: 1 }]}>
          {plural(cobros.length, 'cobro', 'cobros')}
        </Text>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[d.montoFuerte, { color: t.tinta }]}>{fmt(total)}</Text>
          <Text style={[d.montoBs, { color: t.tenue }]}>{totalOtra}</Text>
        </View>
      </View>
    </View>
  )
}

const d = StyleSheet.create({
  tablaCabeza: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingTop: 14, paddingBottom: 8, borderBottomWidth: 1 },
  encabezado: { fontFamily: LETRA.textoFuerte, fontSize: 13 },
  filaTablaCaja: { borderBottomWidth: 1, paddingVertical: 10 },
  filaTabla: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  columnaNombre: { flex: 2, minWidth: 0 },
  columna: { flex: 1, minWidth: 0, alignItems: 'flex-end' },
  celdaIzquierda: { flex: 1, minWidth: 0 },
  bloque: { paddingHorizontal: 20, paddingVertical: 14, gap: 12, borderTopWidth: StyleSheet.hairlineWidth },
  cabezaBloque: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  par: { flexDirection: 'row', gap: 12 },
  total: { borderTopWidth: 2, paddingTop: 12, marginTop: 2 },
  metodo: { fontFamily: LETRA.textoFuerte, fontSize: 15.5 },
  pista: { fontFamily: LETRA.texto, fontSize: 13, lineHeight: 18 },
  verCobros: { minHeight: 34, justifyContent: 'center' },
  verCobrosTexto: { fontFamily: LETRA.textoFuerte, fontSize: 13.5 },
  etiquetaCelda: { fontFamily: LETRA.textoFuerte, fontSize: 13, marginBottom: 2 },
  monto: { fontFamily: LETRA.cifra, fontSize: 15 },
  montoFuerte: { fontFamily: LETRA.cifraFuerte, fontSize: 15.5 },
  montoBs: { fontFamily: LETRA.cifra, fontSize: 13, marginTop: 1 },
  veredicto: { fontFamily: LETRA.textoFuerte, fontSize: 14 },
  cobros: { borderRadius: 16, paddingHorizontal: 12, paddingVertical: 4, marginTop: 2 },
  cobro: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 9, paddingHorizontal: 4, borderRadius: 10 },
  cobroTexto: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
  repetida: { fontFamily: LETRA.textoFuerte, fontSize: 12, letterSpacing: 0.8 },
})
