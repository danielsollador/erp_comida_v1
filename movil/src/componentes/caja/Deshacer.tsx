import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { LETRA, useModo, useTema } from '../../lib/tema'

/**
 * "DESHACER" EN VEZ DE "¿ESTAS SEGURO?", como components/Deshacer.tsx de la
 * web (Leider, 30-sep: "pide demasiada confirmacion"). Borrar un gasto o un
 * retiro no tiene reverso en el servidor, asi que la orden ESPERA unos
 * segundos: la fila se esconde, abajo queda "Gasto borrado · Deshacer", y
 * solo si nadie la deshizo se borra de verdad.
 *
 * Salir de la pantalla en esos segundos la ejecuta igual (en la web, cerrar
 * la pestaña): lo que se vio borrado queda borrado.
 */
export type Pendiente = {
  /** Identifica la fila: "gasto:12". Sirve para esconderla mientras espera. */
  clave: string
  /** Lo que dice el aviso: "Gasto borrado". */
  texto: string
  ejecutar: () => Promise<unknown>
  /** Cuando termino (hecho o fallido): para recargar la lista. */
  alTerminar?: () => void
  alFallar?: (e: unknown) => void
}

const ESPERA_MS = 6000

export function useDeshacer() {
  const [vivos, setVivos] = useState<Pendiente[]>([])
  // Los relojes y lo que espera, fuera del estado: los leen los temporizadores
  // y la salida de la pantalla, que no ven el estado de React del momento.
  const relojes = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const esperando = useRef(new Map<string, Pendiente>())

  const soltar = useCallback((clave: string) => {
    const reloj = relojes.current.get(clave)
    if (reloj) clearTimeout(reloj)
    relojes.current.delete(clave)
    esperando.current.delete(clave)
    setVivos((v) => v.filter((x) => x.clave !== clave))
  }, [])

  const correr = useCallback(
    async (p: Pendiente) => {
      soltar(p.clave)
      try {
        await p.ejecutar()
      } catch (e) {
        p.alFallar?.(e)
      }
      p.alTerminar?.()
    },
    [soltar],
  )

  const deshacible = useCallback(
    (p: Pendiente) => {
      // Dos avisos de la misma fila no tienen sentido: manda el ultimo.
      const previo = relojes.current.get(p.clave)
      if (previo) clearTimeout(previo)
      esperando.current.set(p.clave, p)
      relojes.current.set(
        p.clave,
        setTimeout(() => void correr(p), ESPERA_MS),
      )
      setVivos((v) => [...v.filter((x) => x.clave !== p.clave), p])
    },
    [correr],
  )

  // Deshacer es simplemente no ejecutar: la fila vuelve sola porque deja de
  // estar escondida.
  const deshacer = useCallback((clave: string) => soltar(clave), [soltar])

  useEffect(() => {
    const relojesVivos = relojes.current
    const pendientes = esperando.current
    return () => {
      for (const reloj of relojesVivos.values()) clearTimeout(reloj)
      for (const p of pendientes.values()) void p.ejecutar().catch(() => undefined)
      relojesVivos.clear()
      pendientes.clear()
    }
  }, [])

  const oculto = useCallback((clave: string) => vivos.some((p) => p.clave === clave), [vivos])

  return { deshacible, deshacer, oculto, visible: vivos.length > 0 ? vivos[vivos.length - 1] : null }
}

/** El aviso de abajo: lo que se hizo y el boton para deshacerlo. Flota sobre la pantalla. */
export function AvisoDeshacer({ texto, alDeshacer, abajo }: { texto: string; alDeshacer: () => void; abajo: number }) {
  const t = useTema()
  const { modo } = useModo()
  return (
    <View pointerEvents="box-none" style={[estilos.capa, { bottom: abajo }]}>
      <View accessibilityRole="alert" style={[estilos.aviso, { backgroundColor: t.tinta }]}>
        <Text style={[estilos.texto, { color: t.papel }]} numberOfLines={1}>
          {texto}
        </Text>
        <Pressable
          onPress={alDeshacer}
          accessibilityRole="button"
          hitSlop={6}
          style={({ pressed }) => [
            estilos.boton,
            { backgroundColor: modo === 'oscuro' ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.14)', opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={[estilos.botonTexto, { color: t.papel }]}>Deshacer</Text>
        </Pressable>
      </View>
    </View>
  )
}

const estilos = StyleSheet.create({
  capa: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  aviso: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 999,
    paddingLeft: 20,
    paddingRight: 6,
    paddingVertical: 6,
    maxWidth: '100%',
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  texto: { fontFamily: LETRA.texto, fontSize: 14.5, flexShrink: 1 },
  boton: { minHeight: 40, borderRadius: 999, paddingHorizontal: 15, justifyContent: 'center' },
  botonTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14.5 },
})
