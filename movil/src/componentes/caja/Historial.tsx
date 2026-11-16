import { router, type Href } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useMoneda } from '../../lib/moneda'
import type { Periodo } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import type { CierreCaja, Gasto, RetiroPropietario } from '../../lib/tipos'
import Icono from '../Icono'
import { ElegirPeriodo, FilaFiltros, useDisposicion } from '../kit'
import { Ficha, Nota } from '../ui'
import { cuadra, diaMes, plural } from './logica'
import { Cabecera, Chip, Cuadros, NOMBRE_TIPO, Tipo, type TipoMovimiento } from './piezas'

/**
 * HISTORIAL: todo junto, en orden, en una sola lista (pages/Caja.tsx).
 *
 * Tres listas separadas obligan a saltar para reconstruir un dia: "el martes
 * faltaron 6, ¿por que?" se responde mirando los gastos del martes. Puestos
 * en la misma linea de tiempo, la respuesta esta una fila mas abajo. El tipo
 * se lee por el color y la palabra, y se filtra con un toque.
 *
 * Un cierre se abre en su propia pantalla (/caja/cierre/ID): en la web se
 * despliega en la fila, pero en el telefono el detalle forma por forma y
 * "Anular este cierre" necesitan su aire.
 */
type Movimiento = {
  clave: string
  fecha: string
  tipo: TipoMovimiento
  texto: string
  detalle: string
  monto: number
  cierre?: CierreCaja
}

type Filtro = 'todo' | TipoMovimiento

export function Historial({
  gastos,
  retiros,
  cierres,
  periodo,
  alCambiarPeriodo,
  etiqueta,
  oculto,
}: {
  gastos: Gasto[]
  retiros: RetiroPropietario[]
  cierres: CierreCaja[]
  periodo: Periodo
  alCambiarPeriodo: (p: Periodo) => void
  etiqueta: string
  oculto: (clave: string) => boolean
}) {
  const t = useTema()
  const { tablet } = useDisposicion()
  const [filtro, setFiltro] = useState<Filtro>('todo')

  const susGastos = gastos.filter((g) => !oculto(`gasto:${g.id}`))
  const susRetiros = retiros.filter((r) => !oculto(`retiro:${r.id}`))

  const movimientos: Movimiento[] = [
    ...cierres.map((c) => ({
      clave: `c${c.id}`,
      fecha: c.fecha,
      tipo: 'cierre' as const,
      texto: c.anulado ? 'Cierre anulado' : 'Cierre de caja',
      detalle: [c.operador, c.nota].filter(Boolean).join(' · ') || 'sin nota',
      monto: c.total_sistema,
      cierre: c,
    })),
    ...susGastos.map((g) => ({
      clave: `g${g.id}`,
      fecha: g.fecha,
      tipo: 'gasto' as const,
      texto: g.descripcion,
      detalle: `${g.categoria} · de ${g.metodo_pago}`,
      monto: -g.monto,
    })),
    ...susRetiros.map((r) => ({
      clave: `r${r.id}`,
      fecha: r.fecha,
      tipo: 'retiro' as const,
      texto: r.nota || 'Retiro del dueño',
      detalle: `de ${r.metodo_pago}`,
      monto: -r.monto,
    })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha))

  const visibles = filtro === 'todo' ? movimientos : movimientos.filter((m) => m.tipo === filtro)
  const cuantos = (tipo: TipoMovimiento) => movimientos.filter((m) => m.tipo === tipo).length

  const totalGastos = susGastos.reduce((s, g) => s + g.monto, 0)
  const totalRetiros = susRetiros.reduce((s, r) => s + r.monto, 0)
  // El descuadre acumulado: lo que sobro menos lo que falto en los cierres
  // que de verdad cuentan. Es el numero que dice si la caja se lleva bien.
  const validos = cierres.filter((c) => !c.anulado)
  const descuadre = validos.reduce((s, c) => s + c.diferencia + c.divisas_diferencia, 0)

  return (
    <>
      <FilaFiltros>
        <ElegirPeriodo periodo={periodo} alCambiar={alCambiarPeriodo} />
      </FilaFiltros>

      <Ficha style={{ gap: 12 }}>
        <Cabecera titulo="Historial" detalle={etiqueta} />
        <Cuadros
          columnas={tablet ? 3 : 2}
          cuadros={[
            {
              titulo: 'Gastos',
              valor: totalGastos,
              detalle: plural(susGastos.length, 'registro', 'registros'),
              tono: totalGastos > 0 ? 'malo' : 'apagado',
            },
            {
              titulo: 'Retiros',
              valor: totalRetiros,
              detalle: plural(susRetiros.length, 'registro', 'registros'),
              tono: totalRetiros > 0 ? 'malo' : 'apagado',
            },
            {
              titulo: 'Descuadre',
              valor: descuadre,
              detalle: plural(validos.length, 'cierre', 'cierres'),
              tono: cuadra(descuadre) ? 'apagado' : 'malo',
            },
          ]}
        />
      </Ficha>

      <Ficha style={{ paddingHorizontal: 0, paddingVertical: 14 }}>
        <View style={{ paddingHorizontal: 16, paddingBottom: 6 }}>
          <FilaFiltros>
            <Chip texto={`Todo (${movimientos.length})`} activo={filtro === 'todo'} alTocar={() => setFiltro('todo')} />
            {(['cierre', 'gasto', 'retiro'] as const).map((tipo) => (
              <Chip
                key={tipo}
                texto={`${NOMBRE_TIPO[tipo]}s (${cuantos(tipo)})`}
                activo={filtro === tipo}
                alTocar={() => setFiltro(tipo)}
              />
            ))}
          </FilaFiltros>
        </View>
        {visibles.map((m, i) => (
          <FilaHistorial key={m.clave} m={m} ultima={i === visibles.length - 1} />
        ))}
        {visibles.length === 0 ? <Nota style={{ color: t.tenue, paddingHorizontal: 20, paddingVertical: 10 }}>Nada en este período.</Nota> : null}
      </Ficha>
    </>
  )
}

function FilaHistorial({ m, ultima }: { m: Movimiento; ultima: boolean }) {
  const t = useTema()
  const { fmt } = useMoneda()
  const c = m.cierre
  const dif = c ? c.diferencia + c.divisas_diferencia : 0

  const contenido = (
    <View
      style={[
        h.fila,
        !ultima && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 },
        c?.anulado && { opacity: 0.5 },
      ]}
    >
      <View style={h.izquierda}>
        <Text style={[h.fecha, { color: t.tenue }]}>{diaMes(m.fecha)}</Text>
        <Tipo tipo={m.tipo} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[h.texto, { color: t.tinta }]} numberOfLines={1}>
          {m.texto}
        </Text>
        <Text style={[h.detalle, { color: t.suave }]} numberOfLines={1}>
          {m.detalle}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[h.monto, { color: t.tinta }]}>{fmt(m.monto)}</Text>
        {c && !c.anulado ? (
          <Text style={[h.veredicto, { color: cuadra(dif) ? t.exito : t.peligro }]}>
            {cuadra(dif) ? 'cuadró' : `descuadre ${fmt(dif)}`}
          </Text>
        ) : null}
      </View>
      {c ? <Icono nombre="chevron" size={14} color={t.tenue} grosor={2.2} /> : null}
    </View>
  )

  if (!c) return contenido
  return (
    <Pressable
      onPress={() => router.push(`/caja/cierre/${c.id}?fecha=${c.fecha.slice(0, 10)}` as Href)}
      accessibilityRole="button"
      accessibilityLabel={`${m.texto} del ${diaMes(m.fecha)}`}
      style={({ pressed }) => ({ backgroundColor: pressed ? t.gris100 : 'transparent' })}
    >
      {contenido}
    </Pressable>
  )
}

const h = StyleSheet.create({
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11, minHeight: 60 },
  izquierda: { width: 62, gap: 4 },
  fecha: { fontFamily: LETRA.cifra, fontSize: 13 },
  texto: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  detalle: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 2 },
  monto: { fontFamily: LETRA.cifra, fontSize: 15 },
  veredicto: { fontFamily: LETRA.textoFuerte, fontSize: 13, marginTop: 2 },
})
