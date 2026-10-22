import { useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { apiCaja, type FondoContado } from '../../lib/api-caja'
import { dolares, miles } from '../../lib/formato'
import { useMoneda } from '../../lib/moneda'
import { LETRA, useTema } from '../../lib/tema'
import type { EstadoApertura } from '../../lib/tipos'
import { HojaFormulario, useDisposicion } from '../kit'
import { Aviso, Boton, Campo } from '../ui'
import { aNumero } from '../../lib/numeros'
import { BILLETES_BS, BILLETES_USD, desgloseDe, redondear2, type FilasGaveta } from './logica'
import { mensajeDe } from './piezas'

/**
 * ABRIR LA CAJA: contar el fondo antes de empezar a vender, como
 * components/abrirCaja.tsx de la web (la misma pieza la puede usar el punto
 * de venta).
 *
 * Fija el punto de partida: con el, el cierre de esta noche es la resta de un
 * solo dia. Y separa culpas: si la gaveta amanecio con menos, eso paso antes
 * del turno.
 *
 * SE CUENTA POR BILLETE y no como un total: un total no se puede volver a
 * contar; con el desglose se sabe QUE billete falta (Leider, 21-sep).
 *
 * Lo que dicen los libros NO se muestra y los campos no vienen rellenos: si
 * se ve el numero esperado, contar deja de ser una verificacion y pasa a ser
 * copiarlo.
 */
export function AbrirCaja({
  estado,
  fecha,
  alCerrar,
  alAbrir,
}: {
  estado: EstadoApertura
  fecha?: string
  alCerrar: () => void
  alAbrir: () => void
}) {
  const { tasa } = useMoneda()
  const bcv = tasa?.bcv ?? 0
  const [conteo, setConteo] = useState<Record<string, FilasGaveta>>({})
  const [nota, setNota] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const poner = (metodo: string, clave: string, valor: string) =>
    setConteo((c) => ({ ...c, [metodo]: { ...(c[metodo] ?? {}), [clave]: valor } }))

  // Una gaveta sin tocar NO viaja como cero: "no conte esa gaveta" es
  // distinto de "conte y estaba vacia". La de bolivares se cuenta en
  // bolivares y se guarda en dolares, a la tasa del dia; el desglose viaja
  // tal como se conto, en su moneda.
  const fondos: FondoContado[] = estado.fondos.flatMap((f) => {
    const d = desgloseDe(conteo[f.metodo])
    if (!d) return []
    const enBs = f.metodo === 'Efectivo Bs'
    if (enBs && !bcv) return []
    const fondo = enBs ? redondear2(d.total / bcv) : d.total
    return [{ metodo: f.metodo, cuenta: f.cuenta, fondo, desglose: d.desglose }]
  })

  async function abrir() {
    if (fondos.length === 0 || guardando) return
    setGuardando(true)
    setError('')
    try {
      await apiCaja.abrir(fondos, { fecha, nota })
      alAbrir()
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo abrir la caja'))
      setGuardando(false)
    }
  }

  return (
    <HojaFormulario
      visible
      alCerrar={alCerrar}
      titulo="Abrir caja"
      subtitulo="Cuenta lo que hay AHORA en cada gaveta. Es el punto de partida del cuadre de esta noche."
      pie={
        <>
          <View style={{ flex: 1 }}>
            <Boton texto="Cancelar" tono="neutro" alTocar={alCerrar} />
          </View>
          <View style={{ flex: 1 }}>
            <Boton texto="Abrir caja" alTocar={abrir} ocupado={guardando} deshabilitado={fondos.length === 0} />
          </View>
        </>
      }
    >
      {error ? <Aviso texto={error} tono="peligro" /> : null}
      {estado.fondos.map((f) => (
        <Gaveta key={f.metodo} metodo={f.metodo} filas={conteo[f.metodo] ?? {}} bcv={bcv} alPoner={(clave, v) => poner(f.metodo, clave, v)} />
      ))}
      <Campo value={nota} onChangeText={setNota} placeholder="Nota (opcional): quién abrió, de dónde salió el fondo…" />
    </HojaFormulario>
  )
}

/** Una gaveta: cuantos billetes de cada uno, los sueltos y el total. */
function Gaveta({
  metodo,
  filas,
  bcv,
  alPoner,
}: {
  metodo: string
  filas: FilasGaveta
  bcv: number
  alPoner: (clave: string, valor: string) => void
}) {
  const t = useTema()
  const { tablet } = useDisposicion()
  const enBs = metodo === 'Efectivo Bs'
  const billetes = enBs ? BILLETES_BS : BILLETES_USD
  const simbolo = enBs ? 'Bs' : '$'
  const d = desgloseDe(filas)
  const campo = [g.campo, { borderColor: t.gris200, backgroundColor: t.papel, color: t.tinta }]

  return (
    <View style={[g.gaveta, { borderColor: t.gris200, backgroundColor: t.superficie }]}>
      <View style={g.cabeza}>
        <Text style={[g.nombre, { color: t.tinta }]}>{metodo}</Text>
        <Text style={[g.pista, { color: t.tenue }]}>cuántos billetes de cada uno</Text>
      </View>
      <View style={g.billetes}>
        {billetes.map((b) => {
          const n = aNumero(filas[String(b)] ?? '') || 0
          return (
            <View key={b} style={[g.billete, { width: tablet ? '48%' : '100%' }]}>
              <Text style={[g.billeteNombre, { color: t.suave }]}>
                {simbolo} {b}
              </Text>
              <TextInput
                value={filas[String(b)] ?? ''}
                onChangeText={(v) => alPoner(String(b), v.replace(/[^\d]/g, ''))}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={t.tenue}
                selectTextOnFocus
                accessibilityLabel={`Billetes de ${simbolo} ${b}`}
                style={campo}
              />
              <Text style={[g.billeteTotal, { color: t.suave }]} numberOfLines={1}>
                {n > 0 ? `= ${simbolo} ${miles(n * b, 0)}` : ''}
              </Text>
            </View>
          )
        })}
      </View>
      <View style={[g.sueltos, { borderColor: t.gris200 }]}>
        <Text style={[g.billeteNombre, { color: t.suave, flex: 1, width: undefined, fontFamily: LETRA.textoFuerte }]}>
          Monedas y sueltos ({simbolo})
        </Text>
        <TextInput
          value={filas.sueltos ?? ''}
          onChangeText={(v) => alPoner('sueltos', v.replace(/[^\d.,]/g, ''))}
          keyboardType="decimal-pad"
          placeholder="0,00"
          placeholderTextColor={t.tenue}
          selectTextOnFocus
          accessibilityLabel={`Monedas y sueltos en ${simbolo}`}
          style={[campo, { width: 120 }]}
        />
      </View>
      <View style={g.total}>
        <Text style={[g.pista, { color: t.suave, fontSize: 14 }]}>Total en la gaveta</Text>
        <Text style={[g.totalCifra, { color: t.tinta }]}>{d ? `${simbolo} ${miles(d.total)}` : '—'}</Text>
      </View>
      {/* La gaveta de bolivares se cuenta en bolivares, pero el sistema lleva
          todo en dolares: la conversion va debajo para que nadie la haga de cabeza. */}
      {enBs && d ? (
        <Text style={[g.pista, { color: t.suave, textAlign: 'right' }]}>
          {bcv ? `son ${dolares(d.total / bcv)} a la tasa de hoy` : 'sin tasa para convertir'}
        </Text>
      ) : null}
    </View>
  )
}

const g = StyleSheet.create({
  gaveta: { borderWidth: 1, borderRadius: 20, borderCurve: 'continuous', padding: 14, gap: 10 },
  cabeza: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  nombre: { fontFamily: LETRA.textoFuerte, fontSize: 16 },
  pista: { fontFamily: LETRA.texto, fontSize: 13 },
  billetes: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 },
  billete: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  billeteNombre: { fontFamily: LETRA.cifraFuerte, fontSize: 14.5, width: 64 },
  billeteTotal: { flex: 1, fontFamily: LETRA.cifra, fontSize: 13.5, textAlign: 'right' },
  campo: {
    width: 84,
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12, borderCurve: 'continuous',
    paddingHorizontal: 10,
    fontFamily: LETRA.cifraFuerte,
    fontSize: 17,
    textAlign: 'center',
  },
  sueltos: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  total: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 },
  totalCifra: { fontFamily: LETRA.cifraFuerte, fontSize: 17 },
})
