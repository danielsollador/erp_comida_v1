import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { LETRA, useTema } from '../../lib/tema'
import Icono from '../Icono'
import { HojaFormulario } from '../kit'
import { Boton, Campo } from '../ui'
import { mensajeDe } from './datos'

/*
 * Las piezas chicas del menu que la web saca de sus componentes comunes
 * (Deshacer, el "⋯" de MenuAcciones, `dialogo.pedirTexto`) y que la app no
 * tiene en ui.tsx ni en kit.tsx. Viven aqui para no tocar lo compartido.
 */

// ── El aviso de abajo, con "Deshacer" ───────────────────────────────────────

type Tostada = {
  clave: number
  texto: string
  tono: 'normal' | 'peligro'
  deshacer?: () => void
}

const ESPERA_MS = 6000

/**
 * "DESHACER" EN VEZ DE "¿ESTAS SEGURO?" (components/Deshacer.tsx de la web).
 * Quitar del menu corre YA y durante unos segundos queda abajo el aviso con
 * "Deshacer": quien se equivoco lo toca, quien no sigue trabajando. Solo
 * para lo que tiene reverso en el servidor (retirar ↔ reactivar).
 *
 * El mismo aviso sirve para las confirmaciones que se retiran solas ("pasó a
 * Bebidas") y para los errores, en rojo. La pantalla lo pone en su `abajo`.
 */
export function useTostada() {
  const [actual, setActual] = useState<Tostada | null>(null)
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cuenta = useRef(0)

  useEffect(
    () => () => {
      if (reloj.current) clearTimeout(reloj.current)
    },
    [],
  )

  const mostrar = useCallback((t: Omit<Tostada, 'clave'>) => {
    if (reloj.current) clearTimeout(reloj.current)
    cuenta.current += 1
    const clave = cuenta.current
    setActual({ ...t, clave })
    reloj.current = setTimeout(() => setActual((a) => (a?.clave === clave ? null : a)), ESPERA_MS)
  }, [])

  const avisar = useCallback((texto: string) => mostrar({ texto, tono: 'normal' }), [mostrar])
  const fallo = useCallback((e: unknown, siNo?: string) => mostrar({ texto: mensajeDe(e, siNo), tono: 'peligro' }), [mostrar])

  /** Corre `ejecutar` ya; "Deshacer" llama a `revertir`. `alTerminar` recarga la lista. */
  const deshacible = useCallback(
    async (p: { texto: string; ejecutar: () => Promise<unknown>; revertir: () => Promise<unknown>; alTerminar: () => unknown }) => {
      try {
        await p.ejecutar()
      } catch (e) {
        fallo(e)
        return
      }
      void p.alTerminar()
      mostrar({
        texto: p.texto,
        tono: 'normal',
        deshacer: () => {
          setActual(null)
          p.revertir()
            .catch((e: unknown) => fallo(e))
            .finally(() => void p.alTerminar())
        },
      })
    },
    [fallo, mostrar],
  )

  const nodo = actual ? <AvisoAbajo key={actual.clave} tostada={actual} alCerrar={() => setActual(null)} /> : null
  return { avisar, fallo, deshacible, nodo }
}

function AvisoAbajo({ tostada, alCerrar }: { tostada: Tostada; alCerrar: () => void }) {
  const t = useTema()
  const fondo = tostada.tono === 'peligro' ? t.peligro : t.tinta
  return (
    <View style={estilos.tostadaCaja} accessibilityLiveRegion="polite">
      <View style={[estilos.tostada, { backgroundColor: fondo }]}>
        <Text style={[estilos.tostadaTexto, { color: t.papel }]} numberOfLines={3}>
          {tostada.texto}
        </Text>
        {tostada.deshacer ? (
          <Pressable
            onPress={tostada.deshacer}
            accessibilityRole="button"
            style={({ pressed }) => [estilos.tostadaBoton, { backgroundColor: pressed ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.12)' }]}
          >
            <Text style={[estilos.tostadaBotonTexto, { color: t.papel }]}>Deshacer</Text>
          </Pressable>
        ) : (
          <Pressable onPress={alCerrar} hitSlop={10} accessibilityLabel="Cerrar el aviso" style={estilos.tostadaCerrar}>
            <Icono nombre="quitar" size={15} color={t.papel} />
          </Pressable>
        )}
      </View>
    </View>
  )
}

// ── Botones chicos ──────────────────────────────────────────────────────────

/**
 * El boton "fantasma" de la web: solo texto ("Editar receta", "+ Variante").
 * Se ve chico pero conserva 44 px tocables, para no errarle con el pulgar.
 */
export function BotonTexto({
  texto,
  alTocar,
  tono = 'neutro',
  etiqueta,
}: {
  texto: string
  alTocar: () => void
  tono?: 'acento' | 'neutro' | 'peligro'
  etiqueta?: string
}) {
  const t = useTema()
  const color = tono === 'acento' ? t.acento : tono === 'peligro' ? t.peligro : t.suave
  return (
    <Pressable
      onPress={alTocar}
      accessibilityRole="button"
      accessibilityLabel={etiqueta ?? texto}
      hitSlop={4}
      style={({ pressed }) => [estilos.botonTexto, { opacity: pressed ? 0.55 : 1 }]}
    >
      <Text style={[estilos.botonTextoLetra, { color }]} numberOfLines={1}>
        {texto}
      </Text>
    </Pressable>
  )
}

/** El "⋯" de cada fila: abre lo que se le puede hacer (lo peligroso vive aqui, no al lado del nombre). */
export function BotonPuntos({ etiqueta, alTocar }: { etiqueta: string; alTocar: () => void }) {
  const t = useTema()
  return (
    <Pressable
      onPress={alTocar}
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      style={({ pressed }) => [estilos.puntos, { backgroundColor: pressed ? t.gris100 : 'transparent' }]}
    >
      <View style={estilos.puntosFila}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[estilos.punto, { backgroundColor: t.tenue }]} />
        ))}
      </View>
    </Pressable>
  )
}

/** Un rotulo de seccion dentro de una hoja ("COLOR EN EL MOSTRADOR"). */
export function Rotulo({ children }: { children: ReactNode }) {
  const t = useTema()
  return <Text style={[estilos.rotulo, { color: t.tenue }]}>{children}</Text>
}

// ── Pedir un texto (dialogo.pedirTexto de la web) ───────────────────────────

/**
 * "Nombre de la categoría", "Nombre del producto": un solo campo con su
 * rotulo, Cancelar y Guardar. Vacio o igual al de antes, no se manda nada.
 */
export function PedirTexto({
  visible,
  titulo,
  etiqueta,
  valor,
  aceptar = 'Guardar',
  alCerrar,
  alAceptar,
}: {
  visible: boolean
  titulo: string
  etiqueta: string
  valor: string
  aceptar?: string
  alCerrar: () => void
  /** Devuelve una promesa: mientras corre, el boton dice que esta ocupado. */
  alAceptar: (texto: string) => Promise<void>
}) {
  // Se monta de nuevo cada vez que se abre (key en quien llama), asi el
  // campo nace con el valor de ese momento sin un efecto que lo copie.
  const [texto, setTexto] = useState(valor)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function guardar() {
    if (!texto.trim()) {
      setError('Falta este dato')
      return
    }
    setOcupado(true)
    try {
      await alAceptar(texto.trim())
    } catch (e) {
      setError(mensajeDe(e))
    } finally {
      setOcupado(false)
    }
  }

  return (
    <HojaFormulario
      visible={visible}
      alCerrar={alCerrar}
      titulo={titulo}
      pie={
        <>
          <View style={{ flex: 1 }}>
            <Boton texto="Cancelar" tono="neutro" alTocar={alCerrar} />
          </View>
          <View style={{ flex: 1 }}>
            <Boton texto={aceptar} alTocar={() => void guardar()} ocupado={ocupado} />
          </View>
        </>
      }
    >
      <Campo
        rotulo={etiqueta}
        value={texto}
        onChangeText={(v) => {
          setTexto(v)
          setError('')
        }}
        returnKeyType="done"
        onSubmitEditing={() => void guardar()}
        error={error}
      />
    </HojaFormulario>
  )
}

const estilos = StyleSheet.create({
  tostadaCaja: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, alignItems: 'center' },
  tostada: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 22,
    paddingLeft: 18,
    paddingRight: 6,
    paddingVertical: 6,
    minHeight: 48,
    maxWidth: 560,
    alignSelf: 'stretch',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  tostadaTexto: { flex: 1, fontFamily: LETRA.textoFuerte, fontSize: 14, lineHeight: 19 },
  tostadaBoton: { minHeight: 38, borderRadius: 19, paddingHorizontal: 14, justifyContent: 'center' },
  tostadaBotonTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14 },
  tostadaCerrar: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  botonTexto: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
  botonTextoLetra: { fontFamily: LETRA.textoFuerte, fontSize: 14 },
  puntos: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  puntosFila: { flexDirection: 'row', gap: 3 },
  punto: { width: 4.5, height: 4.5, borderRadius: 3 },
  rotulo: {
    fontFamily: LETRA.textoFuerte,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
})
