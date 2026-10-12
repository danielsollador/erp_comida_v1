import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { apiContabilidad } from '../../lib/api-contabilidad'
import { miles } from '../../lib/formato'
import { aNumero } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import type { AsientoContable, CuentaContable } from '../../lib/tipos'
import { CampoNumero, HojaFormulario, Selector } from '../kit'
import { Boton, Campo, Etiqueta } from '../ui'
import { BotonChico, mensajeDe, p } from './piezas'

type Linea = { cuenta_id: number; debe: string; haber: string }

const VACIA: Linea = { cuenta_id: 0, debe: '', haber: '' }

/**
 * EL ASIENTO A MANO, para lo que no encaja en ningun flujo (un aporte de
 * capital): casi nunca hace falta. Las mismas reglas que la web: lleva
 * descripcion, al menos dos cuentas, y el debe y el haber tienen que dar lo
 * mismo. Abajo se ve el cuadre mientras se escribe: ambar si no cuadra,
 * verde si si. Los montos van en dolares, como toda la contabilidad.
 */
export default function AsientoManual({
  visible,
  cuentas,
  alCerrar,
  alCrear,
}: {
  visible: boolean
  cuentas: CuentaContable[]
  alCerrar: () => void
  alCrear: (asiento: AsientoContable) => void
}) {
  const t = useTema()
  const [descripcion, setDescripcion] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([VACIA, VACIA])
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  // El teclado del telefono pone coma: "12,5" vale lo mismo que "12.5".
  const debe = lineas.reduce((x, l) => x + (aNumero(l.debe) || 0), 0)
  const haber = lineas.reduce((x, l) => x + (aNumero(l.haber) || 0), 0)
  const descuadre = Math.abs(debe - haber) > 0.005

  function actualizar(i: number, cambio: Partial<Linea>) {
    setLineas((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...cambio } : l)))
  }

  function limpiar() {
    setDescripcion('')
    setLineas([VACIA, VACIA])
    setError('')
  }

  async function guardar() {
    setError('')
    const cuerpo = lineas
      .filter((l) => l.cuenta_id)
      .map((l) => ({ cuenta_id: l.cuenta_id, debe: aNumero(l.debe) || 0, haber: aNumero(l.haber) || 0 }))
    if (!descripcion.trim()) return setError('Ponle una descripción.')
    if (cuerpo.length < 2) return setError('Un asiento lleva al menos dos cuentas.')
    if (descuadre) return setError('El debe y el haber tienen que dar lo mismo.')
    setGuardando(true)
    try {
      const nuevo = await apiContabilidad.crearAsiento(descripcion.trim(), cuerpo)
      limpiar()
      alCrear(nuevo)
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo crear el asiento'))
    } finally {
      setGuardando(false)
    }
  }

  const opciones = [
    { valor: '0', texto: 'Cuenta…' },
    ...cuentas.map((c) => ({ valor: String(c.id), texto: `${c.codigo} - ${c.nombre}` })),
  ]

  return (
    <HojaFormulario
      visible={visible}
      alCerrar={alCerrar}
      titulo="Asiento manual"
      subtitulo="Las ventas, compras, gastos y mermas ya dejan su asiento solos. Esto es para lo que no encaja en ningún flujo, como un aporte de capital."
      pie={
        <>
          <View style={{ flex: 1 }}>
            <Boton texto="Cancelar" tono="neutro" alTocar={alCerrar} />
          </View>
          <View style={{ flex: 1 }}>
            <Boton texto="Guardar asiento" alTocar={guardar} ocupado={guardando} />
          </View>
        </>
      }
    >
      {error ? <Text style={[p.nota, { color: t.peligro }]}>{error}</Text> : null}
      <Campo
        rotulo="Descripción"
        value={descripcion}
        onChangeText={setDescripcion}
        placeholder="Descripción del asiento"
        autoFocus
      />
      {lineas.map((l, i) => (
        <View key={i} style={[estilos.linea, { borderColor: t.gris200, backgroundColor: t.superficie }]}>
          <Etiqueta>Línea {i + 1}</Etiqueta>
          <Selector
            etiqueta="Cuenta"
            titulo="Elegir la cuenta"
            forma="campo"
            placeholder="Cuenta…"
            opciones={opciones}
            valor={String(l.cuenta_id)}
            alCambiar={(v) => actualizar(i, { cuenta_id: Number(v) })}
          />
          <View style={estilos.montos}>
            <CampoNumero
              rotulo="Debe"
              prefijo="$"
              valor={l.debe}
              alCambiar={(v) => actualizar(i, { debe: v })}
              placeholder="Debe"
              style={{ flex: 1 }}
            />
            <CampoNumero
              rotulo="Haber"
              prefijo="$"
              valor={l.haber}
              alCambiar={(v) => actualizar(i, { haber: v })}
              placeholder="Haber"
              style={{ flex: 1 }}
            />
          </View>
        </View>
      ))}
      <View style={estilos.pie}>
        <BotonChico texto="línea" icono="mas" alTocar={() => setLineas((prev) => [...prev, VACIA])} />
        <Text style={[estilos.cuadre, { color: descuadre ? t.aviso : t.exito }]}>
          Debe {miles(debe)} · Haber {miles(haber)}
        </Text>
      </View>
    </HojaFormulario>
  )
}

const estilos = StyleSheet.create({
  linea: { borderWidth: 1, borderRadius: 20, padding: 14, gap: 10 },
  montos: { flexDirection: 'row', gap: 10 },
  pie: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  cuadre: { fontFamily: LETRA.cifraFuerte, fontSize: 14, flexShrink: 1, textAlign: 'right' },
})
