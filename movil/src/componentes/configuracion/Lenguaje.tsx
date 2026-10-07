import * as SecureStore from 'expo-secure-store'
import { useSyncExternalStore } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { LETRA, useTema } from '../../lib/tema'
import { Ficha, Nota, Titulo } from '../ui'

/**
 * Configuracion › Lenguaje: con que palabras habla el sistema. Lo mismo que
 * la web (frontend/src/pages/partes/configuracion/Lenguaje.tsx), con los
 * mismos textos.
 *
 * Dos modos para las mismas cifras: el SENCILLO, con las palabras del
 * negocio, y el TECNICO, como estaba antes. Aqui se explica que cambia en
 * cada uno con una muestra de verdad, y abajo va la lista completa de lo que
 * tiene dos nombres, para que nadie tenga que adivinar que es que.
 */

// ── El modo elegido, guardado en el telefono ────────────────────────────────
//
// La web lo guarda en el navegador (localStorage, lib/palabras.ts) porque
// vale para ESTE equipo, como el tema. Aqui va en el almacen del telefono con
// la MISMA clave, igual que hace lib/tema.tsx con el tema.

export type ModoPalabras = 'sencillo' | 'tecnico'

const CLAVE = 'vertigo_palabras'
let modoActual: ModoPalabras = 'sencillo'
let leido = false
const oyentes = new Set<() => void>()

function avisar() {
  oyentes.forEach((fn) => fn())
}

// Se lee una sola vez, la primera vez que alguien mira el modo. Mientras
// llega se muestra "sencillo", que es el de fabrica tambien en la web.
function leerGuardado() {
  if (leido) return
  leido = true
  SecureStore.getItemAsync(CLAVE)
    .then((v) => {
      if (v === 'tecnico' && modoActual !== 'tecnico') {
        modoActual = 'tecnico'
        avisar()
      }
    })
    .catch(() => undefined)
}

export function cambiarModo(nuevo: ModoPalabras) {
  if (nuevo === modoActual) return
  modoActual = nuevo
  // Sin almacen vale solo hasta cerrar la app; no es motivo para avisar.
  SecureStore.setItemAsync(CLAVE, nuevo).catch(() => undefined)
  avisar()
}

function suscribir(fn: () => void) {
  oyentes.add(fn)
  leerGuardado()
  return () => {
    oyentes.delete(fn)
  }
}

/** El modo de palabras y como cambiarlo; cualquier pantalla que lo use se entera del cambio. */
export function usePalabras() {
  const modo = useSyncExternalStore(suscribir, () => modoActual)
  return { modo, cambiar: cambiarModo }
}

// ── Lo que tiene dos nombres ────────────────────────────────────────────────
//
// TERMINOS de la web (lib/palabras.ts) con el "que" de cada uno sacado del
// glosario (lib/glosario.ts). Se copian porque esos dos archivos tocan el
// navegador y la app solo lee de la web archivos de datos puros. Si la web
// cambia un nombre o una explicacion, cambia aqui tambien.

type Termino = { tecnico: string; sencillo: string; donde: string; que: string }

const TERMINOS: Record<string, Termino> = {
  'kpi.ganancia_neta': {
    tecnico: 'Ganancia neta',
    sencillo: 'Te quedó',
    donde: 'Reportes',
    que: 'Lo que de verdad te quedó después de todo.',
  },
  'kpi.ticket_promedio': {
    tecnico: 'Ticket promedio',
    sencillo: 'Gasta en promedio cada cliente',
    donde: 'Reportes y Ventas',
    que: 'Cuánto gasta un cliente en promedio.',
  },
  'kpi.fiado_pendiente': {
    tecnico: 'A crédito por cobrar',
    sencillo: 'Te deben',
    donde: 'Ventas',
    que: 'Ventas de este período que se entregaron y todavía no se han pagado.',
  },
  'kpi.valor_deposito': {
    tecnico: 'Valor en depósito',
    sencillo: 'Plata en mercancía',
    donde: 'Inventario y Reportes',
    que: 'Cuánta plata tienes guardada en forma de mercancía.',
  },
  'kpi.bajo_minimo': {
    tecnico: 'Bajo mínimo',
    sencillo: 'Por debajo del mínimo',
    donde: 'Inventario',
    que: 'Cuánta mercancía ya cruzó su punto de reposición.',
  },
  // La web no tiene glosario propio para este: usa el de 'kpi.bajo_minimo'.
  'kpi.bajo_minimo_agotadas': {
    tecnico: 'Bajo mínimo o agotadas',
    sencillo: 'Por debajo del mínimo o agotadas',
    donde: 'Reportes',
    que: 'Cuánta mercancía ya cruzó su punto de reposición.',
  },
  'inventario.stock': {
    tecnico: 'Stock',
    sencillo: 'Hay',
    donde: 'Inventario',
    que: 'Cuánto hay ahora mismo, según el sistema.',
  },
  'inventario.costo': {
    tecnico: 'Costo compra',
    sencillo: 'Costo promedio',
    donde: 'Inventario',
    que: 'Lo que te costó, en promedio, lo que tienes guardado. No es el último precio.',
  },
  'inventario.reponer': {
    tecnico: 'Reponer',
    sencillo: 'Última compra',
    donde: 'Inventario',
    que: 'Lo que pagaste la última vez. Es lo que te va a costar comprar más.',
  },
  'inventario.rendimiento': {
    tecnico: 'Rendimiento',
    sencillo: 'Aprovechable',
    donde: 'Inventario',
    que: 'Cuánto de lo que compras queda realmente utilizable después de limpiar, pelar o cocinar.',
  },
  'productos.uds': {
    tecnico: 'Uds',
    sencillo: 'Vendidos',
    donde: 'Reportes',
    que: 'Cuántas unidades se vendieron en el período.',
  },
  'compras.base': {
    tecnico: 'Base',
    sencillo: 'Sin IVA',
    donde: 'Compras',
    que: 'El precio sin IVA. En la ley se llama "base imponible": es sobre este número que se calcula el impuesto.',
  },
}

// ── La pantalla ─────────────────────────────────────────────────────────────

export default function Lenguaje() {
  const t = useTema()
  const { modo, cambiar } = usePalabras()
  const ticket = TERMINOS['kpi.ticket_promedio']

  return (
    <>
      <Ficha style={{ gap: 14 }}>
        <View style={{ gap: 8 }}>
          <Titulo style={{ fontSize: 20 }}>Cómo te habla el sistema</Titulo>
          <Text style={[estilos.parrafo, { color: t.suave }]}>
            Los mismos números pueden llamarse de dos formas: como lo diría el dueño del negocio, o como lo diría un
            contador. Elige la que te resulte más clara. No cambia ninguna cifra ni se pierde ninguna explicación: solo
            cambia la palabra que ves en los títulos.
          </Text>
        </View>

        <Modo
          marcado={modo === 'sencillo'}
          alElegir={() => cambiar('sencillo')}
          titulo="Sencillo"
          para="Para quien no viene de la contabilidad."
          puntos={[
            'Los títulos dicen literalmente qué es el número: «Gasta en promedio cada cliente», «Te quedó», «Hay».',
            'Al pasar el cursor (o dejar el dedo apretado en la tablet) sobre un título, la ayuda explica qué es y te dice cómo se le suele llamar: «A esto se le suele llamar ticket promedio».',
          ]}
        />
        <Modo
          marcado={modo === 'tecnico'}
          alElegir={() => cambiar('tecnico')}
          titulo="Técnico"
          para="Para quien viene de otro sistema o le pasa los números al contador."
          puntos={[
            'Los títulos usan las palabras de siempre: «Ticket promedio», «Ganancia neta», «Stock».',
            'La ayuda de cada título es la misma de antes: qué es, de dónde sale, cómo se calcula y para qué sirve.',
          ]}
        />

        <Nota>Se cambia solo aquí, y vale para este equipo: cada tablet o teléfono guarda su elección.</Nota>
      </Ficha>

      {/* La muestra: la misma cifra y su ayuda, en los dos modos, una sobre otra. */}
      <Ficha style={{ gap: 12 }}>
        <Titulo>Así se ve una cifra en cada modo</Titulo>
        <Muestra
          modo="sencillo"
          activo={modo === 'sencillo'}
          titulo={ticket.sencillo}
          que={ticket.que}
          alias={`A esto se le suele llamar «${ticket.tecnico}».`}
        />
        <Muestra modo="tecnico" activo={modo === 'tecnico'} titulo={ticket.tecnico} que={ticket.que} />
      </Ficha>

      {/* La lista completa: todo lo que tiene dos nombres. */}
      <Ficha>
        <Titulo>Todo lo que tiene dos nombres</Titulo>
        <Nota style={{ marginTop: 4 }}>En negrita, el que estás viendo ahora.</Nota>
        <View style={{ marginTop: 12 }}>
          {Object.entries(TERMINOS).map(([clave, termino], i, todos) => (
            <View
              key={clave}
              style={[
                estilos.termino,
                i === 0 && { paddingTop: 0 },
                i === todos.length - 1
                  ? { paddingBottom: 0 }
                  : { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 },
              ]}
            >
              <View style={estilos.nombres}>
                <Text style={[modo === 'sencillo' ? estilos.elegido : estilos.otro, { color: modo === 'sencillo' ? t.tinta : t.suave }]}>
                  {termino.sencillo}
                </Text>
                <Text style={[estilos.otro, { color: t.barra }]} accessibilityElementsHidden importantForAccessibility="no">
                  ·
                </Text>
                <Text style={[modo === 'tecnico' ? estilos.elegido : estilos.otro, { color: modo === 'tecnico' ? t.tinta : t.suave }]}>
                  {termino.tecnico}
                </Text>
                <Text style={[estilos.donde, { color: t.tenue }]}>{termino.donde}</Text>
              </View>
              <Text style={[estilos.que, { color: t.suave }]}>{termino.que}</Text>
            </View>
          ))}
        </View>
      </Ficha>
    </>
  )
}

function Modo({
  marcado,
  alElegir,
  titulo,
  para,
  puntos,
}: {
  marcado: boolean
  alElegir: () => void
  titulo: string
  para: string
  puntos: string[]
}) {
  const t = useTema()
  return (
    <Pressable
      onPress={alElegir}
      accessibilityRole="radio"
      accessibilityState={{ checked: marcado }}
      accessibilityLabel={titulo}
      style={({ pressed }) => [
        estilos.modo,
        { borderColor: marcado ? t.tinta : t.gris200, backgroundColor: marcado ? t.papel : 'transparent' },
        pressed && { transform: [{ scale: 0.985 }] },
      ]}
    >
      <View style={estilos.modoArriba}>
        <Text style={[estilos.modoTitulo, { color: t.tinta }]}>{titulo}</Text>
        <View style={[estilos.radio, { borderColor: marcado ? t.tinta : t.barra }]}>
          {marcado && <View style={[estilos.punto, { backgroundColor: t.tinta }]} />}
        </View>
      </View>
      <Text style={[estilos.para, { color: t.suave }]}>{para}</Text>
      <View style={{ marginTop: 12, gap: 6 }}>
        {puntos.map((p) => (
          <View key={p} style={{ flexDirection: 'row', gap: 8 }}>
            <View style={[estilos.vineta, { backgroundColor: t.tenue }]} />
            <Text style={[estilos.puntoTexto, { color: t.fuerte }]}>{p}</Text>
          </View>
        ))}
      </View>
    </Pressable>
  )
}

/** Una tarjeta de cifra con su ayuda abierta debajo, como se veria de verdad. */
function Muestra({
  modo,
  activo,
  titulo,
  que,
  alias,
}: {
  modo: ModoPalabras
  activo: boolean
  titulo: string
  que: string
  alias?: string
}) {
  const t = useTema()
  return (
    <View style={[estilos.muestra, { backgroundColor: activo ? t.gris100 : t.papel }]}>
      <Text style={[estilos.muestraModo, { color: t.suave }]}>
        {modo === 'sencillo' ? 'En sencillo' : 'En técnico'}
        {activo ? <Text style={{ color: t.exito }}>{'  · el tuyo'}</Text> : null}
      </Text>
      <View style={[estilos.caja, { backgroundColor: t.superficie, borderColor: t.gris200 }]}>
        <Text style={[estilos.cifraTitulo, { color: t.suave, textDecorationColor: t.tenue }]}>{titulo}</Text>
        <Text style={[estilos.cifra, { color: t.tinta }]}>$4.80</Text>
      </View>
      <View style={[estilos.caja, { backgroundColor: t.superficie, borderColor: t.gris200, marginTop: 8 }]}>
        <Text style={[estilos.ayudaTitulo, { color: t.tinta }]}>{titulo}</Text>
        {alias ? <Text style={[estilos.alias, { color: t.acento }]}>{alias}</Text> : null}
        <Text style={[estilos.ayudaQue, { color: t.fuerte }]}>{que}</Text>
        <Text style={[estilos.ayudaMas, { color: t.tenue }]}>…y de dónde sale, cómo se calcula y para qué sirve.</Text>
      </View>
    </View>
  )
}

const estilos = StyleSheet.create({
  parrafo: { fontFamily: LETRA.texto, fontSize: 15, lineHeight: 22 },
  modo: { borderWidth: 2, borderRadius: 18, padding: 16 },
  modoArriba: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  modoTitulo: { fontFamily: LETRA.titulo, fontSize: 18 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  punto: { width: 10, height: 10, borderRadius: 5 },
  para: { fontFamily: LETRA.texto, fontSize: 14, marginTop: 2 },
  vineta: { width: 4, height: 4, borderRadius: 2, marginTop: 8 },
  puntoTexto: { fontFamily: LETRA.texto, fontSize: 14, lineHeight: 19, flex: 1 },
  muestra: { borderRadius: 18, padding: 12 },
  muestraModo: { fontFamily: LETRA.textoFuerte, fontSize: 12, marginBottom: 8 },
  caja: { borderWidth: 1, borderRadius: 14, padding: 14 },
  cifraTitulo: {
    fontFamily: LETRA.textoFuerte,
    fontSize: 12,
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
  },
  cifra: { fontFamily: LETRA.tituloFuerte, fontSize: 24, marginTop: 4, fontVariant: ['tabular-nums'] },
  ayudaTitulo: { fontFamily: LETRA.titulo, fontSize: 14 },
  alias: { fontFamily: LETRA.textoFuerte, fontSize: 13, marginTop: 4 },
  ayudaQue: { fontFamily: LETRA.texto, fontSize: 13, lineHeight: 20, marginTop: 6 },
  ayudaMas: { fontFamily: LETRA.texto, fontSize: 12, marginTop: 6 },
  termino: { paddingVertical: 12 },
  nombres: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8, rowGap: 2 },
  elegido: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  otro: { fontFamily: LETRA.texto, fontSize: 15 },
  donde: { fontFamily: LETRA.texto, fontSize: 12, marginLeft: 'auto' },
  que: { fontFamily: LETRA.texto, fontSize: 14, lineHeight: 19, marginTop: 2 },
})
