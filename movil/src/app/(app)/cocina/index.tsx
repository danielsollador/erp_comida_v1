import { Stack, useFocusEffect, useIsFocused } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native'
import { useEnVivo } from '../../../componentes/cocina/enVivo'
import { avisarComanda, guardarAviso, leerAviso, leerTamano, zoomDe } from '../../../componentes/cocina/ajustes'
import { columnasPara, tinteDeCategoria, type Tinte } from '../../../componentes/cocina/comanda'
import ElegirAnulacion from '../../../componentes/cocina/ElegirAnulacion'
import TarjetaComanda from '../../../componentes/cocina/TarjetaComanda'
import Icono from '../../../componentes/Icono'
import { useDisposicion, Vacio } from '../../../componentes/kit'
import { Aviso, Cargando, Pantalla, Problema } from '../../../componentes/ui'
import { apiCocina } from '../../../lib/api-cocina'
import { avisar } from '../../../lib/dialogo'
import { LETRA, useTema } from '../../../lib/tema'
import type { Pedido } from '../../../lib/tipos'

// Cuanto se resalta un pedido recien llegado antes de verse como los demas.
const MS_RESALTADO = 25000
// Con el canal vivo, se repintan los minutos y se pregunta cada medio minuto
// (por si el socket murio sin avisar). Con el canal caido, cada pocos segundos.
const CADA_CON_CANAL = 30000
const CADA_SIN_CANAL = 5000

/**
 * COCINA, como pages/Cocina.tsx de la web: las comandas que faltan por
 * preparar, cobradas o no, ordenadas por numero. Llegan en vivo por el canal
 * (/ws); si el canal se cae, la pantalla pregunta sola cada pocos segundos.
 * Cada comanda nueva avisa (vibra) y se resalta 25 segundos.
 *
 * En el telefono, una columna; en la tablet, las columnas de la web segun el
 * ancho (dos en la Fire HD 8 de lado, como la web en ese mismo ancho).
 *
 * La pantalla encendida mientras se mira pediria `expo-keep-awake`, que la
 * app todavia no trae: por ahora manda el ajuste de pantalla del equipo.
 */
export default function Cocina() {
  const t = useTema()
  const { ancho } = useDisposicion()
  const enfocada = useIsFocused()
  const [pedidos, setPedidos] = useState<Pedido[] | null>(null)
  const [error, setError] = useState('')
  const [refrescando, setRefrescando] = useState(false)
  const [nuevos, setNuevos] = useState<Set<number>>(() => new Set())
  const [aviso, setAviso] = useState(true)
  const [z, setZ] = useState(1)
  const [, setTick] = useState(0)
  const [anulando, setAnulando] = useState<Pedido | null>(null)

  const conocidos = useRef<Set<number> | null>(null)
  const avisoRef = useRef(true)
  const relojes = useRef<ReturnType<typeof setTimeout>[]>([])
  const enCurso = useRef(false)
  const otraVez = useRef(false)
  const pronto = useRef<ReturnType<typeof setTimeout> | null>(null)

  // El color de cada renglon sale de su categoria: el menu se pide una vez.
  // Se guarda el id y el color y se pinta con el tema del momento.
  const [categorias, setCategorias] = useState<{ variante: number; categoria: number; color: string }[]>([])
  useEffect(() => {
    apiCocina
      .categorias()
      .then((cs) =>
        setCategorias(cs.flatMap((c) => c.productos.flatMap((p) => p.variantes.map((v) => ({ variante: v.id, categoria: c.id, color: c.color }))))),
      )
      .catch(() => setCategorias([]))
  }, [])
  const tintes = useMemo(
    () => new Map<number, Tinte>(categorias.map((x) => [x.variante, tinteDeCategoria(t, x.categoria, x.color)])),
    [categorias, t],
  )
  const tinteDe = useCallback((id: number | null) => (id == null ? undefined : tintes.get(id)), [tintes])

  const refrescar = useCallback(async (manual = false) => {
    // Una a la vez: si llegan tres avisos del canal seguidos, se pide una vez
    // mas al terminar, no tres consultas encimadas.
    if (enCurso.current) {
      otraVez.current = true
      return
    }
    enCurso.current = true
    if (manual) setRefrescando(true)
    try {
      let ps = await apiCocina.enCocina()
      while (otraVez.current) {
        otraVez.current = false
        ps = await apiCocina.enCocina()
      }
      const ordenados = [...ps].sort((a, b) => a.numero - b.numero)
      setPedidos(ordenados)
      setError('')
      const ids = new Set(ordenados.map((p) => p.id))
      const previos = conocidos.current
      conocidos.current = ids
      // En la primera carga no se avisa: son los pedidos que ya estaban.
      if (previos !== null) {
        const recien = ordenados.filter((p) => !previos.has(p.id)).map((p) => p.id)
        if (recien.length > 0) {
          if (avisoRef.current) avisarComanda()
          setNuevos((prev) => new Set([...prev, ...recien]))
          relojes.current.push(
            setTimeout(() => {
              setNuevos((prev) => {
                const sig = new Set(prev)
                for (const id of recien) sig.delete(id)
                return sig
              })
            }, MS_RESALTADO),
          )
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar.')
    } finally {
      enCurso.current = false
      otraVez.current = false
      setRefrescando(false)
    }
  }, [])

  // Un aviso del canal (comanda nueva, renglon marcado, cobrada, anulada):
  // se juntan los que llegan casi a la vez.
  const refrescarPronto = useCallback(() => {
    if (pronto.current) return
    pronto.current = setTimeout(() => {
      pronto.current = null
      void refrescar()
    }, 250)
  }, [refrescar])

  const { conectado } = useEnVivo(refrescarPronto, enfocada)

  useFocusEffect(
    useCallback(() => {
      void refrescar()
      // El tamaño se puede haber cambiado en Configuración: se relee al volver.
      leerTamano().then((v) => setZ(zoomDe(v)))
      leerAviso().then((v) => {
        avisoRef.current = v
        setAviso(v)
      })
      const sub = AppState.addEventListener('change', (estado) => {
        if (estado === 'active') void refrescar()
      })
      return () => sub.remove()
    }, [refrescar]),
  )

  // El reloj: repinta los minutos y pregunta, mas seguido si el canal esta caido.
  useEffect(() => {
    if (!enfocada) return
    const id = setInterval(
      () => {
        setTick((n) => n + 1)
        if (AppState.currentState === 'active') void refrescar()
      },
      conectado ? CADA_CON_CANAL : CADA_SIN_CANAL,
    )
    return () => clearInterval(id)
  }, [enfocada, conectado, refrescar])

  useEffect(
    () => () => {
      for (const r of relojes.current) clearTimeout(r)
      if (pronto.current) clearTimeout(pronto.current)
    },
    [],
  )

  function alternarAviso() {
    const nuevo = !aviso
    avisoRef.current = nuevo
    setAviso(nuevo)
    guardarAviso(nuevo)
    // Confirmacion de que quedo activo: se siente (o suena, en el navegador).
    if (nuevo) avisarComanda()
  }

  /**
   * Las acciones de cocina pueden ser rechazadas: si la caja abrio la comanda
   * para editarla, el servidor dice que no. Se dice el motivo en vez de
   * tragarselo, y la cola se vuelve a pedir.
   */
  const intentar = useCallback(
    async (accion: () => Promise<unknown>) => {
      try {
        await accion()
      } catch (e) {
        await avisar('No se pudo', e instanceof Error ? e.message : '')
      }
      void refrescar()
    },
    [refrescar],
  )

  const alTocarRenglon = useCallback((id: number) => void intentar(() => apiCocina.marcarItemPreparado(id)), [intentar])
  const alPreparar = useCallback((id: number) => void intentar(() => apiCocina.marcarCocinando(id)), [intentar])
  const alListo = useCallback((id: number) => void intentar(() => apiCocina.marcarPedidoListo(id)), [intentar])
  const alAnular = useCallback((p: Pedido) => setAnulando(p), [])

  const elegirAnulacion = (perdida: boolean) => {
    const p = anulando
    setAnulando(null)
    if (!p) return
    // Pasa de verdad: si la caja cobro mientras la cocina lo tenia abierto,
    // el servidor rechaza la anulacion y aqui se dice por que. Se espera a
    // que baje la hoja: un aviso lanzado encima de ella se pierde en iPhone.
    setTimeout(() => void intentar(() => apiCocina.anularPedido(p.id, perdida)), 350)
  }

  const columnas = columnasPara(ancho)
  const hueco = 10
  const anchoTarjeta = useMemo(() => (ancho - 32 - hueco * (columnas - 1)) / columnas, [ancho, columnas])

  return (
    <Pantalla
      refrescando={refrescando}
      alRefrescar={() => void refrescar(true)}
      arriba={
        // El interruptor del aviso queda fijo bajo el encabezado, no a la
        // derecha de el: con la moneda, la campana y el tema ya no cabe un
        // boton con texto en un telefono.
        <View style={estilos.fila}>
          {!conectado && pedidos ? <Text style={[estilos.estado, { color: t.tenue }]}>Sin canal en vivo: se revisa cada 5 s</Text> : <View />}
          {/* Apagado es la unica accion pendiente de la pantalla, y por eso
              es el unico boton con color: hay que tocarlo al abrir el turno.
              Encendido es un control mas, con un punto verde. */}
          <Pressable
            onPress={alternarAviso}
            accessibilityRole="switch"
            accessibilityState={{ checked: aviso }}
            style={({ pressed }) => [
              estilos.aviso,
              aviso
                ? { backgroundColor: t.superficie, borderColor: t.gris200 }
                : { backgroundColor: t.acento, borderColor: t.acento },
              { transform: [{ scale: pressed ? 0.97 : 1 }] },
            ]}
          >
            {aviso ? (
              <View style={[estilos.punto, { backgroundColor: t.exito500 }]} />
            ) : (
              <Icono nombre="campana-muda" size={16} color={t.acentoTinta} />
            )}
            <Text style={[estilos.avisoTexto, { color: aviso ? t.fuerte : t.acentoTinta }]}>
              {aviso ? 'Aviso activo' : 'Activar aviso'}
            </Text>
          </Pressable>
        </View>
      }
    >
      <Stack.Screen options={{ title: 'Cocina' }} />
      {!aviso ? (
        <Aviso tono="aviso" texto="El aviso está apagado: toca Activar aviso para que vibre cuando entre una comanda." />
      ) : null}
      {error && !pedidos ? <Problema mensaje={error} alReintentar={() => void refrescar(true)} /> : null}
      {error && pedidos ? <Aviso tono="aviso" texto={`${error} Se vuelve a intentar sola.`} /> : null}
      {!pedidos && !error ? <Cargando /> : null}

      {pedidos && pedidos.length === 0 ? <Vacio icono="cocina" titulo="No hay pedidos pendientes." /> : null}
      {pedidos && pedidos.length > 0 ? (
        <View style={[estilos.tablero, { gap: hueco }]}>
          {pedidos.map((p) => (
            <View key={p.id} style={{ width: anchoTarjeta }}>
              <TarjetaComanda
                pedido={p}
                nueva={nuevos.has(p.id)}
                z={z}
                tinteDe={tinteDe}
                alTocarRenglon={alTocarRenglon}
                alPreparar={alPreparar}
                alListo={alListo}
                alAnular={alAnular}
              />
            </View>
          ))}
        </View>
      ) : null}

      <ElegirAnulacion pedido={anulando} alCerrar={() => setAnulando(null)} alElegir={elegirAnulacion} />
    </Pantalla>
  )
}

const estilos = StyleSheet.create({
  fila: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 8, paddingBottom: 6 },
  estado: { fontFamily: LETRA.texto, fontSize: 13, flexShrink: 1 },
  aviso: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
  },
  punto: { width: 8, height: 8, borderRadius: 4 },
  avisoTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14 },
  tablero: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' },
})
