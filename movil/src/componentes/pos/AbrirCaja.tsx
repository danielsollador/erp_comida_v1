import { useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { apiPos } from '../../lib/api-pos'
import { miles } from '../../lib/formato'
import { useMoneda } from '../../lib/moneda'
import { aNumero } from '../../lib/numeros'
import { usdComa } from '../../lib/pos'
import { LETRA, useTema } from '../../lib/tema'
import type { EstadoApertura } from '../../lib/tipos'
import { HojaFormulario, useDisposicion } from '../kit'
import { Boton, Campo } from '../ui'

/*
 * ABRIR LA CAJA: contar el fondo antes de empezar a vender
 * (components/abrirCaja.tsx de la web).
 *
 * Esta en el punto de venta porque abrir es lo primero del turno y lo hace
 * quien atiende, no quien administra. Fija el punto de partida del cuadre de
 * esta noche: fondo + lo que entro − lo que salio.
 *
 * Por gaveta, cuantos billetes de cada uno: un total no se puede volver a
 * contar; con el desglose se sabe QUE billete falta. Lo que dicen los libros
 * NO se muestra: si se ve el numero esperado, contar pasa a ser copiarlo.
 */
const BILLETES_USD = [100, 50, 20, 10, 5, 2, 1]
const BILLETES_BS = [500, 200, 100, 50, 20, 10, 5]

export function AbrirCaja({
  estado,
  alCerrar,
  alAbrir,
}: {
  estado: EstadoApertura
  alCerrar: () => void
  alAbrir: () => void
}) {
  const t = useTema()
  const { tasa } = useMoneda()
  const { ancho } = useDisposicion()
  const [conteo, setConteo] = useState<Record<string, Record<string, string>>>({})
  const [nota, setNota] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const porFila = ancho >= 600 ? 4 : 2

  function poner(metodo: string, clave: string, valor: string) {
    setConteo((c) => ({ ...c, [metodo]: { ...(c[metodo] ?? {}), [clave]: valor } }))
  }

  /** El desglose limpio de una gaveta y su total. null = no se toco. */
  function desgloseDe(metodo: string): { desglose: Record<string, number>; total: number } | null {
    const filas = conteo[metodo]
    if (!filas) return null
    const desglose: Record<string, number> = {}
    let total = 0
    for (const [clave, texto] of Object.entries(filas)) {
      const n = aNumero(texto)
      if (!texto.trim() || !Number.isFinite(n) || n <= 0) continue
      desglose[clave] = n
      total += clave === 'sueltos' ? n : Number(clave) * n
    }
    if (Object.keys(desglose).length === 0) return null
    return { desglose, total: Math.round(total * 100) / 100 }
  }

  // Una gaveta sin tocar NO viaja como cero: "no conte" no es "conte y
  // estaba vacia". La de bolivares se cuenta en Bs y se guarda en dolares.
  const fondos = estado.fondos.flatMap((f) => {
    const d = desgloseDe(f.metodo)
    if (!d) return []
    const enBs = f.metodo === 'Efectivo Bs'
    if (enBs && !tasa?.bcv) return []
    const fondo = enBs ? Math.round((d.total / (tasa?.bcv ?? 1)) * 100) / 100 : d.total
    return [{ metodo: f.metodo, cuenta: f.cuenta, fondo, desglose: d.desglose }]
  })

  async function abrir() {
    if (fondos.length === 0) return
    setGuardando(true)
    setError('')
    try {
      await apiPos.abrirCaja(fondos, nota)
      alAbrir()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir la caja')
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
            <Boton
              texto={guardando ? 'Abriendo…' : 'Abrir caja'}
              alTocar={() => void abrir()}
              ocupado={guardando}
              deshabilitado={fondos.length === 0}
            />
          </View>
        </>
      }
    >
      {error ? <Text style={[e.nota, { color: t.peligro }]}>{error}</Text> : null}
      {estado.fondos.map((f) => {
        const enBs = f.metodo === 'Efectivo Bs'
        const billetes = enBs ? BILLETES_BS : BILLETES_USD
        const simbolo = enBs ? 'Bs' : '$'
        const d = desgloseDe(f.metodo)
        const filas = conteo[f.metodo] ?? {}
        return (
          <View key={f.metodo} style={[e.gaveta, { borderColor: t.gris200, backgroundColor: t.superficie }]}>
            <View style={e.cabeza}>
              <Text style={[e.metodo, { color: t.tinta }]}>{f.metodo}</Text>
              <Text style={[e.mini, { color: t.tenue }]}>cuántos billetes de cada uno</Text>
            </View>
            <View style={e.rejilla}>
              {billetes.map((b) => {
                const n = Number(filas[String(b)] ?? 0) || 0
                return (
                  <View key={b} style={[e.celda, { borderColor: t.gris200, width: `${100 / porFila - 3}%` }]}>
                    <Text style={[e.mini, { color: t.suave, fontFamily: LETRA.textoFuerte }]}>
                      {simbolo} {b}
                    </Text>
                    <TextInput
                      value={filas[String(b)] ?? ''}
                      onChangeText={(v) => poner(f.metodo, String(b), v.replace(/[^\d]/g, ''))}
                      keyboardType="number-pad"
                      placeholder="0"
                      placeholderTextColor={t.tenue}
                      accessibilityLabel={`Billetes de ${simbolo} ${b}`}
                      selectTextOnFocus
                      style={[e.entrada, { color: t.tinta }]}
                    />
                    {n > 0 ? (
                      <Text style={[e.mini, { color: t.tenue }]}>
                        = {simbolo} {miles(n * b, 0)}
                      </Text>
                    ) : null}
                  </View>
                )
              })}
              <View style={[e.celda, { borderColor: t.gris200, borderStyle: 'dashed', width: '98%' }]}>
                <Text style={[e.mini, { color: t.suave, fontFamily: LETRA.textoFuerte }]}>Monedas y sueltos ({simbolo})</Text>
                <TextInput
                  value={filas.sueltos ?? ''}
                  onChangeText={(v) => poner(f.metodo, 'sueltos', v.replace(/[^\d.,]/g, ''))}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={t.tenue}
                  accessibilityLabel={`Monedas y sueltos en ${simbolo}`}
                  selectTextOnFocus
                  style={[e.entrada, { color: t.tinta }]}
                />
              </View>
            </View>
            <View style={e.total}>
              <Text style={[e.nota, { color: t.suave }]}>Total en la gaveta</Text>
              <Text style={[e.totalCifra, { color: t.tinta }]}>{d ? `${simbolo} ${miles(d.total)}` : '—'}</Text>
            </View>
            {/* La gaveta de Bs se cuenta en Bs; la conversion va debajo para que nadie la haga de cabeza. */}
            {enBs && d ? (
              <Text style={[e.mini, { color: t.suave, textAlign: 'right' }]}>
                {tasa?.bcv ? `son ${usdComa(d.total / tasa.bcv)} a la tasa de hoy` : 'sin tasa para convertir'}
              </Text>
            ) : null}
          </View>
        )
      })}
      <Campo value={nota} onChangeText={setNota} placeholder="Nota (opcional): quién abrió, de dónde salió el fondo…" />
    </HojaFormulario>
  )
}

const e = StyleSheet.create({
  nota: { fontFamily: LETRA.texto, fontSize: 14, lineHeight: 20 },
  gaveta: { borderWidth: 1, borderRadius: 20, borderCurve: 'continuous', padding: 14, gap: 10 },
  cabeza: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  metodo: { fontFamily: LETRA.textoFuerte, fontSize: 15.5 },
  mini: { fontFamily: LETRA.texto, fontSize: 13 },
  rejilla: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  celda: { borderWidth: 1, borderRadius: 12, borderCurve: 'continuous', paddingHorizontal: 10, paddingVertical: 6 },
  entrada: { fontFamily: LETRA.cifraFuerte, fontSize: 18, paddingVertical: 4, minHeight: 36 },
  total: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  totalCifra: { fontFamily: LETRA.cifraFuerte, fontSize: 17 },
})
