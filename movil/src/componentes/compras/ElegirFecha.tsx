import { DateTimePicker } from '@expo/ui/community/datetime-picker'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { hoyEnCaracas } from '../../lib/formato'
import { fechaCorta } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import { Hoja } from '../Hoja'
import Icono from '../Icono'
import { BotonTexto } from './piezas'

/*
 * ELEGIR UNA FECHA. En la web es el `<input type="date">` del navegador, y
 * teclear "2026-09-28" con el pulgar es buscar errores. En el telefono la
 * fecha se toca en el calendario del sistema (@expo/ui: el DatePicker de
 * SwiftUI, el de Material 3), dentro de una hoja y con los atajos de siempre
 * (hoy, ayer) a un toque. En la web, el mes dibujado a mano de antes. El
 * dia de los atajos es el del local (Caracas), no el del telefono.
 */

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const DIAS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

const dos = (n: number) => String(n).padStart(2, '0')
const iso = (a: number, m: number, d: number) => `${a}-${dos(m + 1)}-${dos(d)}`

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

// El calendario nativo trabaja con la hora del telefono. Un dia AAAA-MM-DD
// se le da al mediodia local y se lee con los getters locales: asi el dia
// que se toca es el dia que se guarda, sin que el huso lo corra.
function aFecha(dia: string): Date {
  const [a, m, d] = dia.slice(0, 10).split('-').map(Number)
  return new Date(a, m - 1, d, 12)
}
function aDia(fecha: Date): string {
  return iso(fecha.getFullYear(), fecha.getMonth(), fecha.getDate())
}

export default function ElegirFecha({
  valor,
  alCambiar,
  maximo,
  placeholder = 'Elegir la fecha',
  titulo = 'La fecha',
  tono,
  atajos = 'pasado',
  quitable = true,
}: {
  /** AAAA-MM-DD, o '' sin fecha. */
  valor: string
  alCambiar: (v: string) => void
  /** La ultima fecha que se puede elegir (la de una factura no puede ser futura). */
  maximo?: string
  placeholder?: string
  titulo?: string
  tono?: 'mal' | 'ojo'
  /** Los atajos de abajo: hoy y ayer (una factura), o en 15 y 30 dias (un vencimiento). */
  atajos?: 'pasado' | 'futuro'
  quitable?: boolean
}) {
  const t = useTema()
  const hoy = hoyEnCaracas()
  const [abierto, setAbierto] = useState(false)
  const base = valor || (maximo && maximo < hoy ? maximo : hoy)
  const [mes, setMes] = useState({ a: Number(base.slice(0, 4)), m: Number(base.slice(5, 7)) - 1 })

  function abrir() {
    const b = valor || (maximo && maximo < hoy ? maximo : hoy)
    setMes({ a: Number(b.slice(0, 4)), m: Number(b.slice(5, 7)) - 1 })
    setAbierto(true)
  }
  function elegir(f: string) {
    alCambiar(f)
    setAbierto(false)
  }
  const borde = tono === 'mal' ? t.peligro : tono === 'ojo' ? t.aviso : t.gris200

  const accesos =
    atajos === 'pasado'
      ? [
          { texto: 'Hoy', fecha: hoy },
          { texto: 'Ayer', fecha: sumarDias(hoy, -1) },
        ]
      : [
          { texto: 'En 15 días', fecha: sumarDias(hoy, 15) },
          { texto: 'En 30 días', fecha: sumarDias(hoy, 30) },
        ]

  return (
    <>
      <Pressable
        onPress={abrir}
        accessibilityRole="button"
        accessibilityLabel={valor ? `${titulo}: ${fechaCorta(valor, true)}` : placeholder}
        style={({ pressed }) => [e.campo, { backgroundColor: t.superficie, borderColor: borde, opacity: pressed ? 0.85 : 1 }]}
      >
        <Icono nombre="calendario" size={17} color={t.tenue} />
        <Text style={[e.campoTexto, { color: valor ? t.tinta : t.tenue }]} numberOfLines={1}>
          {valor ? fechaCorta(valor, true) : placeholder}
        </Text>
      </Pressable>
      <Hoja visible={abierto} alCerrar={() => setAbierto(false)} titulo={titulo}>
        {process.env.EXPO_OS === 'web' ? (
          <MesDibujado mes={mes} setMes={setMes} valor={valor} hoy={hoy} maximo={maximo} elegir={elegir} />
        ) : (
          <DateTimePicker
            value={aFecha(base)}
            mode="date"
            // iOS: el calendario completo (graphical); Android: el de Material, en la hoja y no en un dialogo.
            display="inline"
            presentation="inline"
            maximumDate={maximo ? aFecha(maximo) : undefined}
            accentColor={t.acento}
            onValueChange={(_, fecha) => elegir(aDia(fecha))}
          />
        )}
        <View style={e.pie}>
          {accesos.map((a) => (
            <BotonTexto key={a.texto} texto={a.texto} alTocar={() => elegir(a.fecha)} tono="neutro" />
          ))}
          <View style={{ flex: 1 }} />
          {quitable && valor ? <BotonTexto texto="Sin fecha" alTocar={() => elegir('')} tono="peligro" /> : null}
        </View>
      </Hoja>
    </>
  )
}

/** Web: el mes dibujado a mano, con la semana empezando el lunes como en el calendario de pared. */
function MesDibujado({
  mes,
  setMes,
  valor,
  hoy,
  maximo,
  elegir,
}: {
  mes: { a: number; m: number }
  setMes: (f: (m: { a: number; m: number }) => { a: number; m: number }) => void
  valor: string
  hoy: string
  maximo?: string
  elegir: (f: string) => void
}) {
  const t = useTema()
  function mover(delta: number) {
    setMes(({ a, m }) => {
      const n = m + delta
      return { a: a + Math.floor(n / 12), m: ((n % 12) + 12) % 12 }
    })
  }
  const primero = new Date(Date.UTC(mes.a, mes.m, 1)).getUTCDay()
  const hueco = (primero + 6) % 7
  const diasDelMes = new Date(Date.UTC(mes.a, mes.m + 1, 0)).getUTCDate()
  const celdas: (number | null)[] = [...Array(hueco).fill(null), ...Array.from({ length: diasDelMes }, (_, i) => i + 1)]
  while (celdas.length % 7) celdas.push(null)
  const siguienteBloqueado = !!maximo && iso(mes.a, mes.m, 1) >= maximo.slice(0, 8) + '01'

  return (
    <>
      <View style={e.cabeza}>
        <Pressable onPress={() => mover(-1)} hitSlop={8} accessibilityLabel="Mes anterior" style={[e.flecha, { backgroundColor: t.gris100 }]}>
          <View style={{ transform: [{ rotate: '180deg' }] }}>
            <Icono nombre="chevron" size={16} color={t.fuerte} grosor={2.2} />
          </View>
        </Pressable>
        <Text style={[e.mes, { color: t.tinta }]}>
          {MESES[mes.m]} {mes.a}
        </Text>
        <Pressable
          onPress={() => mover(1)}
          disabled={siguienteBloqueado}
          hitSlop={8}
          accessibilityLabel="Mes siguiente"
          style={[e.flecha, { backgroundColor: t.gris100, opacity: siguienteBloqueado ? 0.35 : 1 }]}
        >
          <Icono nombre="chevron" size={16} color={t.fuerte} grosor={2.2} />
        </Pressable>
      </View>
      <View style={e.semana}>
        {DIAS.map((d, i) => (
          <Text key={i} style={[e.diaSemana, { color: t.tenue }]}>
            {d}
          </Text>
        ))}
      </View>
      <View style={e.grilla}>
        {celdas.map((d, i) => {
          if (d === null) return <View key={i} style={e.celda} />
          const f = iso(mes.a, mes.m, d)
          const elegida = f === valor
          const esHoy = f === hoy
          const bloqueada = !!maximo && f > maximo
          return (
            <View key={i} style={e.celda}>
              <Pressable
                onPress={() => elegir(f)}
                disabled={bloqueada}
                accessibilityLabel={fechaCorta(f, true)}
                accessibilityState={{ selected: elegida, disabled: bloqueada }}
                style={({ pressed }) => [
                  e.dia,
                  elegida && { backgroundColor: t.tinta },
                  !elegida && esHoy && { borderWidth: 1, borderColor: t.acento },
                  pressed && !elegida && { backgroundColor: t.gris100 },
                ]}
              >
                <Text
                  style={[
                    e.diaTexto,
                    { color: elegida ? t.papel : bloqueada ? t.gris200 : t.tinta },
                    esHoy && !elegida && { color: t.acento },
                  ]}
                >
                  {d}
                </Text>
              </Pressable>
            </View>
          )
        })}
      </View>
    </>
  )
}

const e = StyleSheet.create({
  campo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    borderCurve: 'continuous',
    paddingHorizontal: 14,
    minHeight: 50,
  },
  campoTexto: { flex: 1, fontFamily: LETRA.texto, fontSize: 16 },
  cabeza: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 6 },
  flecha: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  mes: { fontFamily: LETRA.titulo, fontSize: 17 },
  semana: { flexDirection: 'row', paddingHorizontal: 8, marginTop: 6 },
  diaSemana: { flex: 1, textAlign: 'center', fontFamily: LETRA.textoFuerte, fontSize: 13 },
  grilla: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8, marginTop: 4 },
  celda: { width: '14.2857%', alignItems: 'center', paddingVertical: 2 },
  dia: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  diaTexto: { fontFamily: LETRA.cifra, fontSize: 15.5 },
  pie: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingTop: 6 },
})
