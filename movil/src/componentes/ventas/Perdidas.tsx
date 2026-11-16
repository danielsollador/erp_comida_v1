import { useMemo } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useMoneda } from '../../lib/moneda'
import { fechaCorta, horaCorta } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import type { ListaVentas, ResumenVentas } from '../../lib/tipos'
import { usePalabras } from '../configuracion/Lenguaje'
import { Kpi, ListaFicha, Pastilla, Renglon, useDisposicion, Vacio } from '../kit'
import { Nota } from '../ui'
import { useDinero } from './logica'

type FilaPerdida = {
  id: string
  numero: number
  fecha: string
  tipo: 'Devuelta' | 'Descuento' | 'Anulada' | 'A crédito por cobrar'
  detalle: string
  quien: string
  monto: number
  /** La tasa a la que se cobro esa venta: en bolivares manda esa, no la de hoy. */
  tasa: number | null
  nota: string
}

const TONO: Record<FilaPerdida['tipo'], 'mal' | 'ojo' | 'neutro'> = {
  Devuelta: 'mal',
  Descuento: 'ojo',
  Anulada: 'neutro',
  'A crédito por cobrar': 'ojo',
}

/**
 * PÉRDIDAS, como la seccion de la web: las seis cifras de la plata que se va
 * (devuelto, rebajado, botado, anulado, fiado) y, debajo, cada venta que se
 * devolvio, se rebajo, se anulo o quedo a credito, la mas reciente primero.
 * Sale de la misma lista del historial: no se pide nada aparte.
 */
export default function Perdidas({ r, lista }: { r: ResumenVentas; lista: ListaVentas }) {
  const t = useTema()
  const { fmt } = useMoneda()
  const dinero = useDinero()
  const { modo } = usePalabras()
  const { tablet } = useDisposicion()
  const p = r.perdidas

  const filas = useMemo<FilaPerdida[]>(() => {
    const salida: FilaPerdida[] = []
    for (const v of lista.filas) {
      const base = { numero: v.numero, fecha: v.fecha, detalle: v.detalle, tasa: v.tasa_bcv }
      if (v.estado === 'devuelta')
        salida.push({ ...base, id: `d${v.id}`, tipo: 'Devuelta', quien: v.operador, monto: v.total, nota: v.motivo_devolucion })
      if (v.estado === 'anulada')
        salida.push({
          ...base,
          id: `a${v.id}`,
          tipo: 'Anulada',
          quien: v.anulado_por || v.operador,
          monto: v.total,
          nota:
            v.anulado_es_perdida === true ? 'Pérdida: se preparó' : v.anulado_es_perdida === false ? 'Sin tocar: volvió al inventario' : '',
        })
      if (v.descuento > 0 && v.estado !== 'anulada' && v.estado !== 'devuelta')
        salida.push({ ...base, id: `r${v.id}`, tipo: 'Descuento', quien: v.operador, monto: v.descuento, nota: '' })
      if (v.estado === 'fiada')
        salida.push({ ...base, id: `f${v.id}`, tipo: 'A crédito por cobrar', quien: v.operador, monto: v.fiado_pendiente, nota: v.cliente })
    }
    // Como abre la tabla de la web: la mas reciente arriba.
    return salida.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0))
  }, [lista])

  const ancho = { flexBasis: tablet ? '31%' : '46%', flexGrow: 1 } as const
  const pct = (n: number) => n.toFixed(1).replace('.', ',')

  return (
    <>
      <View style={estilos.rejilla}>
        <Kpi
          style={ancho}
          etiqueta="Dinero perdido"
          cifra={fmt(p.total)}
          tono={p.pct_sobre_ventas > 3 ? 'aviso' : undefined}
          nota={`${pct(p.pct_sobre_ventas)}% de lo vendido · devuelto + descuentos + merma`}
        />
        <Kpi
          style={ancho}
          etiqueta="Devueltas"
          cifra={fmt(p.valor_devuelto)}
          tono={p.devueltas ? 'aviso' : undefined}
          nota={`${p.devueltas} venta(s) que el cliente devolvió`}
        />
        <Kpi style={ancho} etiqueta="Descuentos" cifra={fmt(p.valor_descuentos)} nota={`En ${p.con_descuento} venta(s)`} />
        <Kpi
          style={ancho}
          etiqueta="Merma de inventario"
          cifra={fmt(p.merma_inventario)}
          tono={p.merma_inventario > 0 ? 'aviso' : undefined}
          nota="Lo que se botó o se dañó, según el libro"
        />
        <Kpi style={ancho} etiqueta="Anuladas" cifra={fmt(p.valor_anulado)} nota={`${p.anuladas} pedido(s). No entró: no se suma arriba`} />
        <Kpi
          style={ancho}
          etiqueta={modo === 'tecnico' ? 'A crédito por cobrar' : 'Te deben'}
          cifra={fmt(p.valor_fiado_pendiente)}
          tono={p.valor_fiado_pendiente > 0 ? 'aviso' : undefined}
          nota={`${p.fiado_pendiente} venta(s) de este período aún sin pagar`}
        />
      </View>

      <View style={{ gap: 2, marginTop: 6 }}>
        <Text style={[estilos.titulo, { color: t.tinta }]}>Una por una</Text>
        <Nota>Cada venta que se devolvió, se rebajó, se anuló o quedó a crédito en el período.</Nota>
      </View>
      {filas.length === 0 ? (
        <Vacio
          icono="ok"
          titulo="Nada que lamentar"
          detalle="En este período no hubo devoluciones, descuentos, anulaciones ni ventas a crédito pendientes."
        />
      ) : (
        <ListaFicha>
          {filas.map((f, i) => (
            <Renglon
              key={f.id}
              titulo={f.detalle || '—'}
              detalle={
                <View style={{ gap: 4, marginTop: 4 }}>
                  <View style={estilos.linea}>
                    <Pastilla texto={f.tipo} tono={TONO[f.tipo]} />
                    {f.nota ? (
                      <Text style={[estilos.nota, { color: t.tenue }]} numberOfLines={1}>
                        {f.nota}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[estilos.nota, { color: t.suave }]} numberOfLines={1}>
                    #{f.numero} · {fechaCorta(f.fecha)} {horaCorta(f.fecha)}
                    {f.quien ? ` · ${f.quien}` : ''}
                  </Text>
                </View>
              }
              valor={dinero(f.monto, f.tasa)}
              ultima={i === filas.length - 1}
            />
          ))}
        </ListaFicha>
      )}
    </>
  )
}

const estilos = StyleSheet.create({
  rejilla: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  titulo: { fontFamily: LETRA.titulo, fontSize: 18, letterSpacing: -0.3 },
  linea: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  nota: { fontFamily: LETRA.texto, fontSize: 13, flexShrink: 1 },
})
