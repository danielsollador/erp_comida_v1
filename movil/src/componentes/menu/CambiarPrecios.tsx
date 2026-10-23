import { Host, Switch } from '@expo/ui'
import * as Haptics from 'expo-haptics'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { apiIA, type CambioPrecio, type CambioPropuesto, type PropuestaPrecios } from '../../lib/api-ia'
import { ErrorApi } from '../../lib/api'
import { useMoneda } from '../../lib/moneda'
import { LETRA, useTema } from '../../lib/tema'
import { Pensando, SelloIA } from '../ia'
import { HojaFormulario } from '../kit'
import { Aviso, Boton, Campo, Nota } from '../ui'

/**
 * CAMBIAR PRECIOS DICIÉNDOLO (components/CambiarPrecios.tsx de la web).
 *
 * Con la inflación los precios se tocan seguido y casi siempre en bloque:
 * "sube 10% las arepas menos la reina". La IA solo traduce QUÉ productos y
 * QUÉ operación; la cuenta la hace el servidor con el precio de hoy. Nada se
 * guarda hasta que el dueño ve la lista de antes y después, apaga los que no
 * quiere y toca Aplicar. Después queda "Deshacer", que manda los mismos
 * cambios al revés.
 *
 * A diferencia de la web, el aviso con Deshacer no se va solo: la hoja se
 * queda abierta con el resultado hasta que se toca "Listo". En el teléfono un
 * aviso de seis segundos abajo se pierde con el pulgar encima.
 */
const EJEMPLOS = ['Sube 10% todas las bebidas', 'Pon todas las empanadas en 1,80', 'Sube 0,25 los pastelitos menos el de queso']

type Paso = { tipo: 'pedir' } | { tipo: 'revisar'; propuesta: PropuestaPrecios } | { tipo: 'hecho'; cambios: CambioPrecio[]; deshecho: boolean }

type Falla = { texto: string; reintentar: () => void; accion: string }

export default function CambiarPrecios({
  visible,
  alCerrar,
  onCambio,
}: {
  visible: boolean
  alCerrar: () => void
  /** El menú se vuelve a pedir: los precios cambiaron en el servidor. */
  onCambio: () => void | Promise<void>
}) {
  const t = useTema()
  const { fmt } = useMoneda()
  const [texto, setTexto] = useState('')
  const [paso, setPaso] = useState<Paso>({ tipo: 'pedir' })
  const [pensando, setPensando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [falla, setFalla] = useState<Falla | null>(null)
  // Los que el dueño apagó en la lista: por id de variante.
  const [apagados, setApagados] = useState<Set<number>>(new Set())

  function cerrar() {
    // La hoja nace limpia cada vez: una instrucción vieja confunde.
    setTexto('')
    setPaso({ tipo: 'pedir' })
    setFalla(null)
    setApagados(new Set())
    setPensando(false)
    setOcupado(false)
    alCerrar()
  }

  async function ver(t0: string) {
    const instruccion = t0.trim()
    if (!instruccion || pensando) return
    setTexto(instruccion)
    setPensando(true)
    setFalla(null)
    try {
      const propuesta = await apiIA.proponerPrecios(instruccion)
      setApagados(new Set())
      setPaso({ tipo: 'revisar', propuesta })
    } catch (e) {
      setFalla({ texto: mensaje(e, 'No se pudo armar la lista.'), reintentar: () => void ver(instruccion), accion: 'Reintentar' })
    } finally {
      setPensando(false)
    }
  }

  async function aplicar(cambios: CambioPropuesto[]) {
    const ida = cambios.map((c) => ({ variante_id: c.variante_id, precio_anterior: c.precio_anterior, precio_nuevo: c.precio_nuevo }))
    setOcupado(true)
    setFalla(null)
    try {
      await apiIA.aplicarPrecios(ida)
    } catch (e) {
      // 409: un precio cambió mientras se revisaba la lista. Reintentar con
      // los mismos números volvería a chocar; se arma la lista de nuevo con
      // los precios de ahora.
      const choco = e instanceof ErrorApi && e.estado === 409
      setFalla({
        texto: mensaje(e, 'No se guardaron los precios.'),
        reintentar: choco ? () => void ver(texto) : () => void aplicar(cambios),
        accion: choco ? 'Revisar de nuevo' : 'Reintentar',
      })
      setOcupado(false)
      return
    }
    setOcupado(false)
    setPaso({ tipo: 'hecho', cambios: ida, deshecho: false })
    await onCambio()
  }

  async function deshacer(cambios: CambioPrecio[]) {
    const vuelta = cambios.map((c) => ({ variante_id: c.variante_id, precio_anterior: c.precio_nuevo, precio_nuevo: c.precio_anterior }))
    setOcupado(true)
    setFalla(null)
    try {
      await apiIA.aplicarPrecios(vuelta)
    } catch (e) {
      setFalla({ texto: mensaje(e, 'No se pudo deshacer.'), reintentar: () => void deshacer(cambios), accion: 'Reintentar' })
      setOcupado(false)
      return
    }
    setOcupado(false)
    setPaso({ tipo: 'hecho', cambios, deshecho: true })
    await onCambio()
  }

  function alternar(id: number) {
    if (process.env.EXPO_OS !== 'web') void Haptics.selectionAsync()
    setApagados((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const propuesta = paso.tipo === 'revisar' ? paso.propuesta : null
  const cambios = propuesta?.cambios ?? []
  const incluidos = cambios.filter((c) => !apagados.has(c.variante_id))
  const promedio = incluidos.length
    ? incluidos.reduce((acc, c) => acc + (c.precio_nuevo - c.precio_anterior) / c.precio_anterior, 0) / incluidos.length
    : 0

  const pie =
    paso.tipo === 'revisar' && cambios.length > 0 ? (
      <>
        <View style={{ flex: 1 }}>
          <Boton texto="Cambiar lo que pedí" tono="neutro" alTocar={() => setPaso({ tipo: 'pedir' })} deshabilitado={ocupado} />
        </View>
        <View style={{ flex: 1.3 }}>
          <Boton
            texto={incluidos.length === 1 ? 'Aplicar 1 cambio' : `Aplicar ${incluidos.length} cambios`}
            alTocar={() => void aplicar(incluidos)}
            ocupado={ocupado}
            deshabilitado={incluidos.length === 0}
          />
        </View>
      </>
    ) : paso.tipo === 'hecho' ? (
      <>
        {!paso.deshecho ? (
          <View style={{ flex: 1 }}>
            <Boton texto="Deshacer" tono="neutro" alTocar={() => void deshacer(paso.cambios)} ocupado={ocupado} />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Boton texto="Listo" alTocar={cerrar} deshabilitado={ocupado} />
        </View>
      </>
    ) : undefined

  return (
    <HojaFormulario
      visible={visible}
      alCerrar={cerrar}
      titulo="Cambiar precios"
      subtitulo="Dilo como se lo dirías a alguien de tu equipo. Antes de guardar ves cómo queda cada precio."
      pie={pie}
    >
      {paso.tipo === 'pedir' ? (
        <>
          <Campo
            value={texto}
            onChangeText={setTexto}
            placeholder="Ej.: sube 10% las empanadas menos la de queso"
            accessibilityLabel="Qué precios cambiar"
            multiline
            autoFocus
            editable={!pensando}
            returnKeyType="done"
            submitBehavior="blurAndSubmit"
            onSubmitEditing={() => void ver(texto)}
            style={{ minHeight: 76, textAlignVertical: 'top' }}
          />
          {!pensando ? (
            <View style={e.ejemplos}>
              {EJEMPLOS.map((x) => (
                <Pressable
                  key={x}
                  onPress={() => setTexto(x)}
                  accessibilityRole="button"
                  style={({ pressed }) => [e.ejemplo, { backgroundColor: t.acentoSuave, transform: [{ scale: pressed ? 0.97 : 1 }] }]}
                >
                  <Text style={[e.ejemploTexto, { color: t.tinta }]}>{x}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {pensando ? (
            <View style={{ gap: 10 }}>
              <Pensando frases={['Buscando esos productos…', 'Calculando los precios nuevos…']} />
              {/* El hueco de la lista que viene, para que la hoja no salte al llegar. */}
              <View style={[e.lista, { backgroundColor: t.superficie, borderColor: t.gris200 }]} aria-hidden>
                {[0, 1, 2].map((k) => (
                  <View key={k} style={[e.fila, k > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.gris200 }]}>
                    <View style={{ flex: 1, gap: 8 }}>
                      <View style={[e.esqueleto, { backgroundColor: t.gris100, width: '40%' }]} />
                      <View style={[e.esqueleto, { backgroundColor: t.gris100, width: '25%', height: 10 }]} />
                    </View>
                    <View style={[e.esqueleto, { backgroundColor: t.gris100, width: 80, height: 18 }]} />
                  </View>
                ))}
              </View>
            </View>
          ) : (
            <Boton texto="Ver cómo quedan" alTocar={() => void ver(texto)} deshabilitado={!texto.trim()} />
          )}
        </>
      ) : null}

      {falla ? (
        <View style={{ gap: 10 }}>
          <Aviso texto={falla.texto} tono="peligro" />
          <Boton texto={falla.accion} tono="neutro" alTocar={falla.reintentar} deshabilitado={ocupado || pensando} />
        </View>
      ) : null}

      {propuesta ? (
        <>
          <View style={[e.entendi, { backgroundColor: t.acentoSuave }]}>
            <SelloIA tam={30} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[e.pediste, { color: t.suave }]}>Pediste «{texto}»</Text>
              <Text style={[e.texto, { color: t.tinta, marginTop: 2 }]}>
                <Text style={{ fontFamily: LETRA.textoFuerte }}>Entendí: </Text>
                {propuesta.entendi}
              </Text>
            </View>
          </View>
          {propuesta.duda ? <Aviso texto={propuesta.duda} tono="aviso" /> : null}
          {cambios.length === 0 ? (
            <>
              {!propuesta.duda ? <Nota>Con eso ningún precio cambia. Prueba a decirlo de otra forma.</Nota> : null}
              <Boton texto="Decirlo de otra forma" tono="neutro" alTocar={() => setPaso({ tipo: 'pedir' })} />
            </>
          ) : (
            <>
              <Nota style={{ paddingHorizontal: 4 }}>
                {incluidos.length === 0
                  ? 'Todos apagados: no cambia ningún precio.'
                  : incluidos.length === 1
                    ? 'Cambia 1 precio'
                    : `Cambian ${incluidos.length} precios`}
                {incluidos.length > 1 ? (
                  <>
                    {' · en promedio '}
                    <Text style={{ fontFamily: LETRA.cifraFuerte, color: t.fuerte }}>{pctTxt(promedio)}</Text>
                  </>
                ) : null}
                {apagados.size > 0 && incluidos.length > 0 ? ` · ${apagados.size} fuera` : ''}
              </Nota>
              <View style={[e.lista, { backgroundColor: t.superficie, borderColor: t.gris200 }]}>
                {cambios.map((c, i) => (
                  <FilaCambio key={c.variante_id} cambio={c} incluido={!apagados.has(c.variante_id)} primera={i === 0} alAlternar={() => alternar(c.variante_id)} fmt={fmt} />
                ))}
              </View>
            </>
          )}
        </>
      ) : null}

      {paso.tipo === 'hecho' ? (
        <View style={{ gap: 12 }}>
          <Aviso
            texto={
              paso.deshecho
                ? 'Listo, los precios quedaron como estaban.'
                : paso.cambios.length === 1
                  ? '1 precio cambiado. Ya se ve así en el menú y el punto de venta.'
                  : `${paso.cambios.length} precios cambiados. Ya se ven así en el menú y el punto de venta.`
            }
          />
          {!paso.deshecho ? <Nota style={{ paddingHorizontal: 4 }}>Si no era eso, «Deshacer» los vuelve a poner como estaban.</Nota> : null}
        </View>
      ) : null}
    </HojaFormulario>
  )
}

/** Un precio que cambia: nombre y categoría, antes → después, cuánto, y el interruptor para dejarlo fuera. */
function FilaCambio({
  cambio: c,
  incluido,
  primera,
  alAlternar,
  fmt,
}: {
  cambio: CambioPropuesto
  incluido: boolean
  primera: boolean
  alAlternar: () => void
  fmt: (usd: number) => string
}) {
  const t = useTema()
  const pct = (c.precio_nuevo - c.precio_anterior) / c.precio_anterior
  return (
    <View style={[e.fila, !primera && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.gris200 }, !incluido && { opacity: 0.5 }]}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[e.nombre, { color: t.tinta }]} numberOfLines={1}>
          {c.nombre}
        </Text>
        <Text style={[e.categoria, { color: t.suave }]} numberOfLines={1}>
          {c.categoria}
        </Text>
        <View style={e.precios}>
          <Text style={[e.antes, { color: t.suave }]}>{fmt(c.precio_anterior)}</Text>
          <Text style={[e.antes, { color: t.tenue, textDecorationLine: 'none' }]}>→</Text>
          <Text style={[e.despues, { color: t.tinta }]}>{fmt(c.precio_nuevo)}</Text>
          <View style={[e.pastilla, { backgroundColor: pct >= 0 ? t.gris100 : t.avisoSuave }]}>
            <Text style={[e.pastillaTexto, { color: pct >= 0 ? t.fuerte : t.avisoFuerte }]}>{pctTxt(pct)}</Text>
          </View>
        </View>
      </View>
      {/* El interruptor del sistema, sin recolorear, como `Interruptor` de ui.tsx. */}
      <Host matchContents>
        <Switch value={incluido} onValueChange={alAlternar} />
      </Host>
    </View>
  )
}

/** "+10,0%" / "−5,0%", con coma como en el resto de la app. */
function pctTxt(x: number): string {
  return `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1).replace('.', ',')}%`
}

function mensaje(e: unknown, siNo: string): string {
  return e instanceof Error && e.message ? e.message : siNo
}

const e = StyleSheet.create({
  ejemplos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ejemplo: { minHeight: 36, borderRadius: 999, paddingHorizontal: 14, justifyContent: 'center' },
  ejemploTexto: { fontFamily: LETRA.texto, fontSize: 13.5 },
  entendi: { flexDirection: 'row', gap: 12, borderRadius: 16, borderCurve: 'continuous', padding: 14, alignItems: 'flex-start' },
  pediste: { fontFamily: LETRA.texto, fontSize: 13 },
  texto: { fontFamily: LETRA.texto, fontSize: 15, lineHeight: 21 },
  lista: { borderRadius: 16, borderCurve: 'continuous', borderWidth: 1, overflow: 'hidden' },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11, minHeight: 56 },
  nombre: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  categoria: { fontFamily: LETRA.texto, fontSize: 13 },
  precios: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  antes: { fontFamily: LETRA.cifra, fontSize: 13, textDecorationLine: 'line-through' },
  despues: { fontFamily: LETRA.cifraFuerte, fontSize: 15.5 },
  pastilla: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, minWidth: 56, alignItems: 'center' },
  pastillaTexto: { fontFamily: LETRA.cifra, fontSize: 12 },
  esqueleto: { height: 12, borderRadius: 6 },
})
