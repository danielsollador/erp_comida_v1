import { router, Stack, useLocalSearchParams, type Href } from 'expo-router'
import { useCallback, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View, type ListRenderItem } from 'react-native'
import { etiquetaMetodo } from '../../../../frontend/src/lib/pagos'
import { apiVentas } from '../../lib/api-ventas'
import { useCarga } from '../../lib/carga'
import { LETRA, useTema } from '../../lib/tema'
import type { VentaFila } from '../../lib/tipos'
import { Buscador, FilaFiltros, llano, PantallaLista, Selector, useDisposicion, Vacio } from '../kit'
import { Aviso, Cargando, Nota, Pantalla, Pestanas, Problema, Titulo } from '../ui'
import FilaVenta from './FilaVenta'
import {
  apagada,
  ATAJOS,
  claveDeFila,
  ESTADOS,
  etiquetaRango,
  nombreRango,
  RANGO_POR_DEFECTO,
  rangoDeUrl,
  useDinero,
  type FiltroEstado,
  type Rango,
} from './logica'
import Perdidas from './Perdidas'
import Resumen from './Resumen'

/**
 * VENTAS, como pages/Ventas.tsx de la web: cada venta del periodo, que paso
 * con ella, y los numeros de arriba. Tres secciones (Historial, Resumen,
 * Pérdidas) y la misma fila de filtros: el periodo, "Qué pasó" y "Factura".
 *
 * TODO VIVE EN LA RUTA, como en la web: la seccion (/ventas/resumen), el
 * periodo (?r=90d, o ?d=…&h=…) y los filtros (?e=fiada, ?f=si). Asi el aviso
 * del servidor que manda a "/ventas?e=fiada&r=90d" abre justo eso, y volver
 * atras desde una venta deja la lista como estaba.
 *
 * Aparte de la web, "Cómo se pagó" (?p=) como filtro: en la web eso se busca
 * escribiendo, y en el telefono escribir "pago movil" es mas lento que tocar.
 */
type IdSeccion = 'historial' | 'resumen' | 'perdidas'
const SECCIONES: { id: IdSeccion; texto: string }[] = [
  { id: 'historial', texto: 'Historial' },
  { id: 'resumen', texto: 'Resumen' },
  { id: 'perdidas', texto: 'Pérdidas' },
]

type Orden = '-fecha' | 'fecha' | '-total' | 'total' | 'numero'
const ORDENES: { valor: Orden; texto: string }[] = [
  { valor: '-fecha', texto: 'Más recientes' },
  { valor: 'fecha', texto: 'Más antiguas' },
  { valor: '-total', texto: 'Mayor total' },
  { valor: 'total', texto: 'Menor total' },
  { valor: 'numero', texto: 'Por número' },
]

type Params = { seccion?: string; r?: string; d?: string; h?: string; e?: string; f?: string; p?: string }

export default function PantallaVentas() {
  const t = useTema()
  const { tablet } = useDisposicion()
  const dinero = useDinero()
  const params = useLocalSearchParams<Params>()
  const seccion: IdSeccion = SECCIONES.some((s) => s.id === params.seccion) ? (params.seccion as IdSeccion) : 'historial'
  const rango = useMemo(() => rangoDeUrl(params.r, params.d, params.h), [params.r, params.d, params.h])
  const estado: FiltroEstado = ESTADOS.some((x) => x.clave === params.e) ? (params.e as FiltroEstado) : 'todas'
  const factura: 'todas' | 'si' | 'no' = params.f === 'si' || params.f === 'no' ? params.f : 'todas'
  const pago = params.p ?? ''
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState<Orden>('-fecha')

  // Lo que llego dice de que periodo es: si no es el de ahora, se esta cargando.
  const clave = `${rango.desde}/${rango.hasta}`
  const { datos, error, refrescando, refrescar } = useCarga(
    async () => {
      const [lista, resumen] = await Promise.all([apiVentas.ventas(rango.desde, rango.hasta), apiVentas.resumen(rango.desde, rango.hasta)])
      return { clave, lista, resumen }
    },
    // Una lista de un mes pesa: se vuelve a pedir al entrar y al tirar, y
    // cada diez minutos mientras se mira, no cada minuto.
    600,
    clave,
  )
  const cargando = datos?.clave !== clave
  const lista = datos?.lista ?? null

  /** Cambia filtros en la URL; vacio = se quita (como `useFiltrosUrl` de la web). */
  const fijar = useCallback((cambios: Partial<Record<keyof Params, string>>) => {
    const limpio: Record<string, string | undefined> = {}
    for (const [k, v] of Object.entries(cambios)) limpio[k] = v ? v : undefined
    router.setParams(limpio)
  }, [])

  const cambiarRango = (nuevo: Rango) =>
    // Se guarda solo lo que se aparta del defecto: la ruta limpia es "este mes".
    fijar({ r: nuevo.clave === RANGO_POR_DEFECTO ? '' : nuevo.clave, d: '', h: '' })

  const conteo = useMemo(() => {
    const c: Record<string, number> = { todas: lista?.filas.length ?? 0 }
    for (const v of lista?.filas ?? []) c[claveDeFila(v)] = (c[claveDeFila(v)] ?? 0) + 1
    return c
  }, [lista])

  // Las formas de pago que aparecen en el periodo, con cuantas ventas cada una.
  const formas = useMemo(() => {
    const c = new Map<string, number>()
    for (const v of lista?.filas ?? []) for (const m of v.pago.split(' + ').filter(Boolean)) c.set(m, (c.get(m) ?? 0) + 1)
    return [...c.entries()].sort((a, b) => b[1] - a[1])
  }, [lista])

  const visibles = useMemo(() => {
    if (!lista) return []
    const q = llano(busqueda.trim())
    const filtradas = lista.filas.filter((v) => {
      if (estado !== 'todas' && claveDeFila(v) !== estado) return false
      if (factura === 'si' && !v.facturado) return false
      if (factura === 'no' && v.facturado) return false
      if (pago && !v.pago.split(' + ').includes(pago)) return false
      if (!q) return true
      return (
        String(v.numero).includes(q) ||
        llano(v.cliente).includes(q) ||
        llano(v.detalle).includes(q) ||
        llano(v.operador).includes(q) ||
        llano(v.pago).includes(q) ||
        llano(v.numero_factura ?? '').includes(q)
      )
    })
    const signo = orden.startsWith('-') ? -1 : 1
    return filtradas.sort((a, b) => {
      if (orden === 'numero') return a.numero - b.numero
      if (orden.endsWith('total')) return signo * (a.total - b.total)
      return signo * (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0)
    })
  }, [lista, estado, factura, pago, busqueda, orden])

  // Lo que suma lo visible, sin lo que no se vendio. En bolivares, cada venta
  // entro a la tasa de SU dia: se suma con la tasa media ponderada.
  const cuentan = visibles.filter((v) => !apagada(v))
  const totalVisible = cuentan.reduce((s, v) => s + v.total, 0)
  const tasaMedia = totalVisible > 0 ? cuentan.reduce((s, v) => s + v.total * (v.tasa_bcv ?? 0), 0) / totalVisible || null : null

  const hayFiltros = estado !== 'todas' || factura !== 'todas' || pago !== ''

  const abrir = useCallback(
    (v: VentaFila) =>
      // La fecha va en la ruta: el detalle pide las ventas de ESE dia y busca
      // la suya, que es la misma fila que ve la lista.
      router.push(`/ventas/pedido/${v.id}?f=${v.fecha.slice(0, 10)}` as Href),
    [],
  )

  const renglon: ListRenderItem<VentaFila> = useCallback(
    ({ item, index }) => (
      <FilaVenta
        v={item}
        total={dinero(item.total, item.tasa_bcv)}
        debe={dinero(item.fiado_pendiente, item.tasa_bcv)}
        primera={index === 0}
        ultima={index === visibles.length - 1}
        ancha={tablet}
        alTocar={abrir}
      />
    ),
    [dinero, visibles.length, tablet, abrir],
  )

  // ── Lo de arriba: secciones y filtros (los mismos en las tres) ──
  const opcionesPeriodo = [
    ...ATAJOS.map((a) => ({ valor: a.clave as string, texto: a.texto })),
    ...(rango.clave === 'personal' ? [{ valor: 'personal', texto: 'Personalizado' }] : []),
  ]
  const filtros = (
    <View style={{ gap: 10 }}>
      <Pestanas opciones={SECCIONES} valor={seccion} alCambiar={(id) => fijar({ seccion: id })} />
      <FilaFiltros>
        <Selector
          etiqueta="Período"
          titulo="Ver el período"
          opciones={opcionesPeriodo.map((o) => ({
            ...o,
            detalle: o.valor === rango.clave ? etiquetaRango(rango) : undefined,
          }))}
          valor={rango.clave}
          alCambiar={(c) => {
            const a = ATAJOS.find((x) => x.clave === c)
            if (a) cambiarRango(rangoDeUrl(a.clave))
          }}
          placeholder={nombreRango(rango)}
        />
        {seccion === 'historial' ? (
          <>
            <Selector<FiltroEstado>
              etiqueta="Qué pasó"
              opciones={ESTADOS.filter((e) => e.clave === 'todas' || (conteo[e.clave] ?? 0) > 0).map((e) => ({
                valor: e.clave,
                texto: e.texto,
                contador: e.clave === 'todas' ? null : conteo[e.clave] ?? 0,
              }))}
              valor={estado}
              alCambiar={(v) => fijar({ e: v === 'todas' ? '' : v })}
            />
            <Selector
              etiqueta="Factura"
              opciones={[
                { valor: 'todas', texto: 'Todas' },
                { valor: 'si', texto: 'Con factura' },
                { valor: 'no', texto: 'Sin factura' },
              ]}
              valor={factura}
              alCambiar={(v) => fijar({ f: v === 'todas' ? '' : v })}
            />
            <Selector
              etiqueta="Cómo se pagó"
              opciones={[{ valor: '', texto: 'Todas' }, ...formas.map(([m, n]) => ({ valor: m, texto: etiquetaMetodo(m), contador: n }))]}
              valor={pago}
              alCambiar={(v) => fijar({ p: v })}
            />
            <Selector etiqueta="Orden" opciones={ORDENES} valor={orden} alCambiar={setOrden} />
            {hayFiltros ? (
              <Pressable
                onPress={() => fijar({ e: '', f: '', p: '' })}
                accessibilityRole="button"
                hitSlop={4}
                style={({ pressed }) => [estilos.quitar, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={[estilos.quitarTexto, { color: t.suave }]}>Quitar filtros</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </FilaFiltros>
    </View>
  )

  const problema = error && !datos ? <Problema mensaje={error} alReintentar={refrescar} /> : null
  const titulo = <Stack.Screen options={{ title: 'Ventas' }} />

  if (seccion !== 'historial') {
    return (
      <Pantalla refrescando={refrescando} alRefrescar={refrescar}>
        {titulo}
        {filtros}
        {problema}
        {!datos && !error ? <Cargando /> : null}
        {datos && cargando ? <Nota style={{ color: t.tenue }}>Cargando…</Nota> : null}
        {datos && seccion === 'resumen' ? (
          <Resumen r={datos.resumen} nombre={nombreRango(rango)} consulta={consultaDe(params)} />
        ) : null}
        {datos && seccion === 'perdidas' ? <Perdidas r={datos.resumen} lista={datos.lista} /> : null}
      </Pantalla>
    )
  }

  return (
    <>
    {titulo}
    <PantallaLista
      datos={visibles}
      renglon={renglon}
      clave={(v) => String(v.id)}
      refrescando={refrescando}
      alRefrescar={refrescar}
      cabecera={
        <View style={{ gap: 12 }}>
          {filtros}
          {problema}
          {lista ? (
            <View style={estilos.cabeza}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Titulo>{`Ventas · ${etiquetaRango(rango)}`}</Titulo>
                <Nota>
                  {cargando ? 'Cargando…' : `${lista.total} venta(s) en el período. Toca una fila para ver el detalle.`}
                </Nota>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[estilos.vendidoRotulo, { color: t.tenue }]}>Vendido</Text>
                <Text style={[estilos.vendido, { color: t.tinta }]} numberOfLines={1}>
                  {dinero(totalVisible, tasaMedia)}
                </Text>
              </View>
            </View>
          ) : null}
          {lista ? <Buscador valor={busqueda} alCambiar={setBusqueda} placeholder="Buscar: número, cliente, producto, quién cobró…" /> : null}
          {lista?.recortado ? (
            <Aviso
              tono="aviso"
              texto={`Hay más de ${lista.filas.length} ventas en este período y solo se muestran las más recientes. Acorta el período arriba para verlas todas.`}
            />
          ) : null}
        </View>
      }
      vacio={
        !lista ? (
          error ? <View /> : <Cargando />
        ) : (
          <Vacio
            icono="ventas"
            titulo={lista.filas.length === 0 ? 'Sin ventas en este período' : 'Nada coincide con el filtro'}
            detalle={lista.filas.length === 0 ? 'Cambia el período arriba, o cobra un pedido en el punto de venta.' : undefined}
          />
        )
      }
    />
    </>
  )
}

/** El periodo de esta pantalla, para llevarlo a otra (Reportes) tal cual. */
function consultaDe(p: Params): string {
  const q = [p.r ? `r=${p.r}` : '', p.d ? `d=${p.d}` : '', p.h ? `h=${p.h}` : ''].filter(Boolean).join('&')
  return q ? `?${q}` : ''
}

const estilos = StyleSheet.create({
  cabeza: { flexDirection: 'row', alignItems: 'flex-end', gap: 12, marginTop: 2 },
  vendidoRotulo: { fontFamily: LETRA.textoFuerte, fontSize: 12.5 },
  vendido: { fontFamily: LETRA.cifraFuerte, fontSize: 17 },
  quitar: { height: 38, justifyContent: 'center', paddingHorizontal: 8 },
  quitarTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14 },
})
