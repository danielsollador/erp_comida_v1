import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { hoyEnCaracas, inicioDelMes } from '../../lib/formato'
import { fechaCorta, periodoDe } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import { Hoja, OpcionHoja } from '../Hoja'
import Icono from '../Icono'
import { useDisposicion } from '../kit'

/*
 * EL PERIODO DE LA ZONA CONTABLE: los atajos del filtro de la web
 * (lib/fechas.ts: Hoy, Ayer, Este mes, Mes anterior, 7/30/90 dias, Este año,
 * Año anterior) y, debajo, los meses por su nombre. El SENIAT pide los
 * libros por mes y el contador pregunta "¿cuánto se ganó en junio?": en la
 * web eso se marca en el calendario; aqui es un toque.
 *
 * El dia es el del local (Caracas), no el del telefono.
 */

export type PeriodoContable = { clave: string; desde: string; hasta: string; etiqueta: string }

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

const ATAJOS: { clave: string; texto: string }[] = [
  { clave: 'hoy', texto: 'Hoy' },
  { clave: 'ayer', texto: 'Ayer' },
  { clave: 'mes', texto: 'Este mes' },
  { clave: 'mes_pasado', texto: 'Mes anterior' },
  { clave: '7d', texto: 'Últimos 7 días' },
  { clave: '30d', texto: 'Últimos 30 días' },
  { clave: '90d', texto: 'Últimos 90 días' },
  { clave: 'anio', texto: 'Este año' },
  { clave: 'anio_pasado', texto: 'Año anterior' },
]

const dos = (n: number) => String(n).padStart(2, '0')
const mayuscula = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`

/** El ultimo dia de un mes (mes de 1 a 12). */
function finDeMes(anio: number, mes: number): string {
  const d = new Date(Date.UTC(anio, mes, 0))
  return `${anio}-${dos(mes)}-${dos(d.getUTCDate())}`
}

/** "Agosto 2026": el nombre de un mes. */
export function nombreDeMes(anio: number, mes: number): string {
  return `${mayuscula(MESES[mes - 1])} ${anio}`
}

/** Las fechas de una clave del periodo, hoy: `mes`, `anio`, `m-2026-08`… */
export function periodoContable(clave: string): PeriodoContable {
  const hoy = hoyEnCaracas()
  const anio = Number(hoy.slice(0, 4))
  const mesNombrado = /^m-(\d{4})-(\d{2})$/.exec(clave)
  if (mesNombrado) {
    const a = Number(mesNombrado[1])
    const m = Number(mesNombrado[2])
    return { clave, desde: `${a}-${dos(m)}-01`, hasta: finDeMes(a, m), etiqueta: nombreDeMes(a, m) }
  }
  if (clave === 'anio') return { clave, desde: `${anio}-01-01`, hasta: hoy, etiqueta: 'Este año' }
  if (clave === 'anio_pasado') return { clave, desde: `${anio - 1}-01-01`, hasta: `${anio - 1}-12-31`, etiqueta: 'Año anterior' }
  const conocido = ['hoy', 'ayer', '7d', '30d', 'mes', 'mes_pasado', '90d'].includes(clave)
  const p = periodoDe(conocido ? (clave as Parameters<typeof periodoDe>[0]) : 'mes')
  const texto = ATAJOS.find((a) => a.clave === p.id)?.texto ?? p.etiqueta
  return { clave: p.id, desde: p.desde, hasta: p.hasta, etiqueta: texto }
}

/** Los meses ya cerrados antes del mes anterior, del mas reciente al mas viejo (un año). */
function mesesAnteriores(): { clave: string; texto: string }[] {
  const [a, m] = inicioDelMes().split('-').map(Number)
  const lista: { clave: string; texto: string }[] = []
  for (let atras = 2; atras <= 13; atras++) {
    const total = a * 12 + (m - 1) - atras
    const anio = Math.floor(total / 12)
    const mes = (total % 12) + 1
    lista.push({ clave: `m-${anio}-${dos(mes)}`, texto: nombreDeMes(anio, mes) })
  }
  return lista
}

function detalleDe(p: PeriodoContable): string {
  return p.desde === p.hasta ? fechaCorta(p.desde, true) : `${fechaCorta(p.desde)} → ${fechaCorta(p.hasta, true)}`
}

/**
 * La pastilla "Periodo · Este mes" de arriba de una lista. Siempre dice que
 * periodo se esta viendo (tambien el de por defecto), y al tocarla sube la
 * hoja con los atajos y los meses.
 */
export function ElegirPeriodoContable({
  periodo,
  alCambiar,
}: {
  periodo: PeriodoContable
  alCambiar: (p: PeriodoContable) => void
}) {
  const t = useTema()
  const { alto } = useDisposicion()
  const [abierto, setAbierto] = useState(false)
  const opciones = useMemo(() => [...ATAJOS, ...mesesAnteriores()].map((o) => periodoContable(o.clave)), [])

  return (
    <>
      <Pressable
        onPress={() => setAbierto(true)}
        accessibilityRole="button"
        accessibilityLabel={`Periodo: ${periodo.etiqueta}`}
        style={({ pressed }) => [
          estilos.pastilla,
          { backgroundColor: t.superficie, borderColor: t.gris200, transform: [{ scale: pressed ? 0.97 : 1 }] },
        ]}
      >
        <Icono nombre="calendario" size={15} color={t.tenue} />
        <Text style={[estilos.etiqueta, { color: t.tenue }]}>Periodo</Text>
        <Text style={[estilos.valor, { color: t.tinta }]} numberOfLines={1}>
          {periodo.etiqueta}
        </Text>
        <View style={{ transform: [{ rotate: '90deg' }] }}>
          <Icono nombre="chevron" size={12} color={t.tenue} grosor={2.4} />
        </View>
      </Pressable>
      <Hoja visible={abierto} alCerrar={() => setAbierto(false)} titulo="Ver el periodo">
        <ScrollView style={{ maxHeight: alto * 0.62 }}>
          {opciones.map((o, i) => (
            <View key={o.clave}>
              {i === ATAJOS.length ? <Text style={[estilos.grupo, { color: t.tenue }]}>Un mes</Text> : null}
              <OpcionHoja
                texto={o.etiqueta}
                detalle={detalleDe(o)}
                marcada={o.clave === periodo.clave}
                alTocar={() => {
                  setAbierto(false)
                  alCambiar(o)
                }}
              />
            </View>
          ))}
        </ScrollView>
      </Hoja>
    </>
  )
}

const estilos = StyleSheet.create({
  pastilla: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 7,
    minHeight: 44,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 14,
    maxWidth: '100%',
  },
  etiqueta: { fontFamily: LETRA.texto, fontSize: 14 },
  valor: { fontFamily: LETRA.textoFuerte, fontSize: 14, flexShrink: 1 },
  grupo: {
    fontFamily: LETRA.textoFuerte,
    fontSize: 11,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 4,
  },
})
