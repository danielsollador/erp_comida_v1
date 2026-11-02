import { useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { LETRA, useTema } from '../../lib/tema'
import { Hoja, OpcionHoja } from '../Hoja'
import Icono from '../Icono'
import { Buscador, llano, useDisposicion } from '../kit'

/**
 * Un campo de texto con su lista de sugerencias (components/CampoSugerido.tsx
 * de la web). Sigue siendo texto libre, no un selector, y eso es a proposito:
 * un proveedor que no esta en el directorio se puede teclear igual. La lista
 * es una comodidad para no volver a escribir "Distribuidora La Montaña" cada
 * vez, no un requisito para poder comprar.
 *
 * EN EL TELEFONO la lista no cuelga encima del campo de abajo: mientras se
 * escribe, las que coinciden aparecen DEBAJO, empujando lo demas; la flecha
 * de la derecha abre la lista entera desde abajo.
 */
export default function CampoSugerido({
  valor,
  alCambiar,
  opciones,
  placeholder,
  vacio = 'Ninguno guardado todavía',
  titulo,
  etiqueta,
  tono,
}: {
  valor: string
  alCambiar: (v: string) => void
  opciones: string[]
  placeholder?: string
  /** Que decir cuando no hay ninguna coincidencia. */
  vacio?: string
  /** El titulo de la lista entera. */
  titulo?: string
  /** Lo que dice el lector de pantalla. */
  etiqueta?: string
  tono?: 'mal' | 'ojo'
}) {
  const t = useTema()
  const { alto } = useDisposicion()
  const [enfocado, setEnfocado] = useState(false)
  const [abierta, setAbierta] = useState(false)
  const [busqueda, setBusqueda] = useState('')

  // Mientras se escribe: las que coinciden, sin la que ya esta escrita tal cual.
  const cerca = useMemo(() => {
    const q = llano(valor.trim())
    if (!q) return []
    return opciones.filter((o) => llano(o).includes(q) && llano(o) !== q).slice(0, 5)
  }, [opciones, valor])

  const todas = useMemo(() => {
    const q = llano(busqueda.trim())
    return q ? opciones.filter((o) => llano(o).includes(q)) : opciones
  }, [opciones, busqueda])

  const borde = tono === 'mal' ? t.peligro : tono === 'ojo' ? t.aviso : t.gris200

  return (
    <View style={{ gap: 6 }}>
      <View style={[s.caja, { backgroundColor: t.superficie, borderColor: borde }]}>
        <TextInput
          value={valor}
          onChangeText={alCambiar}
          placeholder={placeholder}
          placeholderTextColor={t.tenue}
          onFocus={() => setEnfocado(true)}
          // Un respiro antes de esconder la lista: el toque en una sugerencia
          // llega despues de que el campo pierde el foco.
          onBlur={() => setTimeout(() => setEnfocado(false), 180)}
          autoCorrect={false}
          accessibilityLabel={etiqueta}
          style={[s.texto, { color: t.tinta }]}
        />
        <Pressable
          onPress={() => {
            setBusqueda('')
            setAbierta(true)
          }}
          hitSlop={6}
          accessibilityLabel="Ver la lista"
          style={({ pressed }) => [s.flecha, { backgroundColor: pressed ? t.gris100 : 'transparent' }]}
        >
          <View style={{ transform: [{ rotate: '90deg' }] }}>
            <Icono nombre="chevron" size={14} color={t.suave} grosor={2.4} />
          </View>
        </Pressable>
      </View>

      {enfocado && valor.trim() ? (
        cerca.length > 0 ? (
          <View style={[s.lista, { backgroundColor: t.superficie, borderColor: t.gris200 }]}>
            {cerca.map((o, i) => (
              <Pressable
                key={o}
                onPress={() => {
                  alCambiar(o)
                  setEnfocado(false)
                }}
                style={({ pressed }) => [
                  s.sugerencia,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.gris200 },
                  pressed && { backgroundColor: t.gris100 },
                ]}
              >
                <Text style={[s.sugerenciaTexto, { color: t.tinta }]} numberOfLines={2}>
                  {o}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : !opciones.some((o) => llano(o) === llano(valor.trim())) ? (
          <Text style={[s.nota, { color: t.tenue }]}>Sin coincidencias · se guardará «{valor.trim()}»</Text>
        ) : null
      ) : null}

      <Hoja visible={abierta} alCerrar={() => setAbierta(false)} titulo={titulo ?? placeholder}>
        {opciones.length > 8 ? (
          <View style={{ paddingHorizontal: 4, paddingBottom: 8 }}>
            <Buscador valor={busqueda} alCambiar={setBusqueda} />
          </View>
        ) : null}
        <ScrollView style={{ maxHeight: alto * 0.55 }} keyboardShouldPersistTaps="handled">
          {todas.map((o) => (
            <OpcionHoja
              key={o}
              texto={o}
              marcada={o === valor}
              alTocar={() => {
                alCambiar(o)
                setAbierta(false)
              }}
            />
          ))}
          {todas.length === 0 ? <Text style={[s.nota, { color: t.tenue, padding: 12 }]}>{opciones.length ? 'Nada coincide.' : vacio}</Text> : null}
        </ScrollView>
      </Hoja>
    </View>
  )
}

const s = StyleSheet.create({
  caja: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 14, borderCurve: 'continuous', minHeight: 50, paddingLeft: 14 },
  texto: { flex: 1, minWidth: 0, fontFamily: LETRA.texto, fontSize: 16, paddingVertical: 12 },
  flecha: { width: 46, height: 46, borderRadius: 12, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  lista: { borderWidth: 1, borderRadius: 14, borderCurve: 'continuous', overflow: 'hidden' },
  sugerencia: { minHeight: 46, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 8 },
  sugerenciaTexto: { fontFamily: LETRA.texto, fontSize: 15 },
  nota: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
})
