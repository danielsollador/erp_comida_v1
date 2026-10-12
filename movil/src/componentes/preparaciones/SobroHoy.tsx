import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { unidadDe } from '../../../../frontend/src/lib/inventario'
import { apiPreparaciones } from '../../lib/api-preparaciones'
import { useMoneda } from '../../lib/moneda'
import { aNumero } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import type { Preparacion } from '../../lib/tipos'
import { CampoNumero, HojaFormulario } from '../kit'
import { fmtCant } from './cuentas'
import { mensajeDe } from './piezas'

/**
 * EL CIERRE DEL PREPARADO (`SobroHoy` de la web): sobro guiso. Guardarlo no
 * mueve nada (mañana se vende y se descuenta el crudo ahi). Botarlo saca el
 * crudo por la receta y queda como perdida: si no, la carne de ese guiso
 * nunca sale del sistema.
 */
export default function SobroHoy({
  p,
  alCerrar,
  alHecho,
}: {
  p: Preparacion
  alCerrar: () => void
  /** Con el mensaje que la lista muestra arriba. */
  alHecho: (mensaje: string) => void
}) {
  const t = useTema()
  const { fmt: dinero } = useMoneda()
  const [cantidad, setCantidad] = useState(p.modo_produccion === 'producir' && p.stock_actual > 0 ? String(p.stock_actual) : '')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const n = aNumero(cantidad)
  const valor = n > 0 ? n * p.costo_unitario : 0

  async function decidir(accion: 'botar' | 'guardar') {
    setError('')
    if (!(n > 0)) return setError('¿Cuánto sobró?')
    setOcupado(true)
    try {
      const r = await apiPreparaciones.sobrante(p.id, { cantidad: n, accion })
      alHecho(
        accion === 'guardar'
          ? `${fmtCant(n)} ${unidadDe(n, p.unidad)} de ${p.nombre} se guardan para mañana. No se mueve nada: al venderse se descuenta el crudo.`
          : `Se botaron ${fmtCant(n)} ${unidadDe(n, p.unidad)} de ${p.nombre}: ${dinero(r.valor ?? valor)} de pérdida, descontados del crudo.`,
      )
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo anotar'))
    } finally {
      setOcupado(false)
    }
  }

  // Las dos salidas son las dos caras de la decision, con su consecuencia
  // escrita debajo: por eso son tarjetas y no un "Guardar" de formulario.
  const opcion = (accion: 'guardar' | 'botar', titulo: string, detalle: string) => {
    const guardar = accion === 'guardar'
    return (
      <Pressable
        onPress={() => void decidir(accion)}
        disabled={ocupado}
        accessibilityRole="button"
        accessibilityLabel={titulo}
        style={({ pressed }) => [
          s.opcion,
          {
            backgroundColor: guardar ? t.fichaPrincipal : t.peligroSuave,
            opacity: ocupado ? 0.5 : 1,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          },
        ]}
      >
        <Text style={[s.opcionTitulo, { color: guardar ? t.fichaPrincipalTinta : t.peligro }]}>{titulo}</Text>
        <Text style={[s.opcionDetalle, { color: guardar ? t.fichaPrincipalTinta : t.peligro }]}>{detalle}</Text>
      </Pressable>
    )
  }

  return (
    <HojaFormulario visible alCerrar={alCerrar} titulo={`Sobró ${p.nombre}`} subtitulo="Al cierre. Lo que diga la olla manda.">
      <CampoNumero
        rotulo={`Cuánto sobró (${p.unidad})`}
        valor={cantidad}
        alCambiar={setCantidad}
        sufijo={p.unidad}
        autoFocus
        ayuda={valor > 0 ? `Vale unos ${dinero(valor)} en materia prima.` : undefined}
      />
      <View style={s.par}>
        {opcion('guardar', 'Lo guardo', 'para mañana · no se mueve nada')}
        {opcion('botar', 'Lo boto', 'queda como pérdida · sale el crudo')}
      </View>
      {error ? <Text style={[s.error, { color: t.peligro }]}>{error}</Text> : null}
    </HojaFormulario>
  )
}

const s = StyleSheet.create({
  par: { flexDirection: 'row', gap: 10 },
  opcion: { flex: 1, borderRadius: 18, padding: 15, minHeight: 84, gap: 4 },
  opcionTitulo: { fontFamily: LETRA.textoFuerte, fontSize: 16 },
  opcionDetalle: { fontFamily: LETRA.texto, fontSize: 13, lineHeight: 18, opacity: 0.8 },
  error: { fontFamily: LETRA.texto, fontSize: 14 },
})
