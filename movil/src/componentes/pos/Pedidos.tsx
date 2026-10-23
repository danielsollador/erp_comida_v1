import { memo, useCallback, useMemo, type ReactElement } from 'react'
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View, type ListRenderItem } from 'react-native'
import { enPreparacion, estadoCocina, porQueNoSeEdita } from '../../../../frontend/src/lib/comandas'
import type { Tinte } from '../../lib/pos'
import { LETRA, useTema } from '../../lib/tema'
import type { Pedido, PuntoVenta } from '../../lib/tipos'
import Icono from '../Icono'
import { Selector } from '../kit'
import { BotonChico } from './piezas'

/*
 * PEDIDOS EN CURSO (la seccion "Pedidos" de pages/POS.tsx): lo que esta vivo
 * en el piso, la ultima que llego primero.
 *
 * TRES SITUACIONES, CUATRO COLORES. Verde: listo, falta cobrar. Cobre: ya se
 * cobro y se cocino, solo falta darsela a su dueño. Ambar: en cocina y sin
 * cobrar. Gris: cobrado, esperando la comida. Que alguien la este
 * preparando se dice con un anillo cobre ENCIMA del color, no en vez de el.
 */

type Fmt = (usd: number | null | undefined, decimales?: number) => string

export type AccionesPedidos = {
  anular: (p: Pedido) => void
  cocina: (p: Pedido) => void
  editar: (p: Pedido) => void
  cobrar: (p: Pedido) => void
  entregar: (p: Pedido) => void
}

const faltaCocina = (p: Pedido) => p.items.some((i) => !i.preparado)

export function Pedidos({
  pedidos,
  cargando,
  columnas,
  yo,
  puntos,
  puntoId,
  alElegirPunto,
  tinteDeVariante,
  fmt,
  acciones,
  alVerVentas,
  aviso,
  refrescando,
  alRefrescar,
}: {
  pedidos: Pedido[]
  cargando: boolean
  columnas: 1 | 2
  yo: string
  puntos: PuntoVenta[]
  puntoId: number | null
  alElegirPunto: (id: number | null) => void
  tinteDeVariante: (varianteId: number | null) => Tinte | null
  fmt: Fmt
  acciones: AccionesPedidos
  alVerVentas: () => void
  /** El error de la ultima accion, arriba de la lista: donde se ve. */
  aviso: ReactElement | null
  refrescando: boolean
  alRefrescar: () => void
}) {
  const t = useTema()
  const cuentas = useMemo(
    () => ({
      porCobrar: pedidos.filter((p) => !faltaCocina(p) && p.estado !== 'pagado').length,
      porEntregar: pedidos.filter((p) => p.estado === 'pagado' && !faltaCocina(p)).length,
      enCocina: pedidos.filter((p) => faltaCocina(p) && p.estado !== 'pagado').length,
      cobradosEnCocina: pedidos.filter((p) => faltaCocina(p) && p.estado === 'pagado').length,
    }),
    [pedidos],
  )

  // De dos en dos en la tablet: con una sola columna, cada fila es media pantalla vacia.
  const filas = useMemo(() => {
    const r: Pedido[][] = []
    for (let i = 0; i < pedidos.length; i += columnas) r.push(pedidos.slice(i, i + columnas))
    return r
  }, [pedidos, columnas])

  const renglon: ListRenderItem<Pedido[]> = useCallback(
    ({ item }) => (
      <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
        {item.map((p) => (
          <View key={p.id} style={{ flex: 1, minWidth: 0 }}>
            <TarjetaPedido pedido={p} yo={yo} fmt={fmt} tinteDeVariante={tinteDeVariante} acciones={acciones} />
          </View>
        ))}
        {item.length < columnas ? <View style={{ flex: 1 }} /> : null}
      </View>
    ),
    [yo, fmt, tinteDeVariante, acciones, columnas],
  )

  const punto = (color: string) => <View style={[e.puntoLeyenda, { backgroundColor: color }]} />

  return (
    <FlatList
      data={filas}
      renderItem={renglon}
      keyExtractor={(f) => f.map((p) => p.id).join('-')}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refrescando} onRefresh={alRefrescar} tintColor={t.acento} colors={[t.acento]} />}
      initialNumToRender={8}
      ListHeaderComponent={
        <View style={{ gap: 10, marginBottom: 12 }}>
          {aviso}
          <View style={e.cabeza}>
            <Text style={[e.etiqueta, { color: t.tenue }]}>PEDIDOS EN CURSO</Text>
            {/* Aqui y no flotando en una esquina: una pastilla suelta parecia de otra aplicacion. */}
            <Pressable
              onPress={alVerVentas}
              style={({ pressed }) => [e.ventas, { borderColor: t.gris200, backgroundColor: pressed ? t.gris100 : t.superficie }]}
            >
              <Icono nombre="ventas" size={14} color={t.suave} />
              <Text style={[e.ventasTexto, { color: t.fuerte }]}>Ventas de hoy</Text>
            </Pressable>
          </View>
          {/* La leyenda: el color de cada tarjeta dice donde esta el pedido. */}
          <View style={e.leyenda}>
            <View style={e.itemLeyenda}>
              {punto(t.exito500)}
              <Text style={[e.textoLeyenda, { color: t.suave }]}>{cuentas.porCobrar} listos, falta cobrar</Text>
            </View>
            <View style={e.itemLeyenda}>
              {punto(t.acento)}
              <Text style={[e.textoLeyenda, { color: t.suave }]}>{cuentas.porEntregar} para entregar</Text>
            </View>
            <View style={e.itemLeyenda}>
              {punto(t.aviso)}
              <Text style={[e.textoLeyenda, { color: t.suave }]}>{cuentas.enCocina} en cocina sin cobrar</Text>
            </View>
            <View style={e.itemLeyenda}>
              {punto(t.tenue)}
              <Text style={[e.textoLeyenda, { color: t.suave }]}>{cuentas.cobradosEnCocina} cobrados, en cocina</Text>
            </View>
          </View>
        </View>
      }
      ListEmptyComponent={
        <Text style={[e.vacio, { color: t.tenue }]}>
          {cargando ? 'Buscando…' : 'Nada en curso: ni pedidos por cobrar ni comida en cocina.'}
        </Text>
      }
      ListFooterComponent={
        // En que caja se cobra: se elige una vez por turno, no en cada venta.
        puntos.length > 0 ? (
          <View style={{ marginTop: 8, alignSelf: 'flex-start' }}>
            <Selector<string>
              etiqueta="Caja"
              titulo="En qué caja se cobra"
              opciones={[{ valor: '', texto: 'principal' }, ...puntos.map((p) => ({ valor: String(p.id), texto: p.nombre }))]}
              valor={puntoId === null ? '' : String(puntoId)}
              alCambiar={(v) => alElegirPunto(v ? Number(v) : null)}
            />
          </View>
        ) : null
      }
    />
  )
}

const TarjetaPedido = memo(function TarjetaPedido({
  pedido,
  yo,
  fmt,
  tinteDeVariante,
  acciones,
}: {
  pedido: Pedido
  yo: string
  fmt: Fmt
  tinteDeVariante: (varianteId: number | null) => Tinte | null
  acciones: AccionesPedidos
}) {
  const t = useTema()
  // Falta comida por hacer: la misma pregunta que responde la cocina, no el
  // estado del pedido (cobrar lo deja "pagado" aunque no se haya cocinado).
  const falta = faltaCocina(pedido)
  const cocina = estadoCocina(pedido)
  const preparando = enPreparacion(pedido)
  const yaPagado = pedido.estado === 'pagado'
  const entregar = yaPagado && !falta
  const marco = entregar
    ? { borderColor: t.acento400, backgroundColor: t.acentoSuave }
    : yaPagado
      ? { borderColor: t.gris200, backgroundColor: t.gris100 }
      : falta
        ? { borderColor: t.avisoLinea, backgroundColor: t.avisoSuave }
        : { borderColor: t.exito500, backgroundColor: t.exitoSuave }
  const estado = entregar
    ? { texto: 'Para entregar', fondo: t.acento, color: t.acentoTinta }
    : yaPagado
      ? { texto: 'Cobrado · falta cocina', fondo: t.gris200, color: t.fuerte }
      : falta
        ? { texto: 'Cuenta abierta · falta cocina', fondo: t.avisoLinea, color: t.avisoFuerte }
        : cocina === 'lista'
          ? { texto: 'Cuenta abierta · cocina lista', fondo: t.exito, color: t.exitoSuave }
          : { texto: 'Cuenta abierta · falta cobrar', fondo: t.exito, color: t.exitoSuave }
  const impedimento = porQueNoSeEdita(pedido, yo)

  return (
    <View style={[e.anillo, { borderColor: preparando ? t.acento400 : 'transparent' }]}>
      <View style={[e.tarjeta, marco]}>
        <View style={e.arriba}>
          {/* El numero y, debajo, de quien es: entre ocho comandas vivas el nombre es lo que las distingue. */}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[e.numero, { color: t.tinta }]}>#{pedido.numero}</Text>
            {/* En tinta y grande: en gris chico no se leia a quien es (Leider, 23-oct). */}
            {pedido.cliente ? (
              <Text style={[entregar ? e.clienteFuerte : e.cliente, { color: entregar ? t.acentoFuerte : t.tinta }]} numberOfLines={1}>
                {pedido.cliente}
              </Text>
            ) : entregar ? (
              <Text style={[e.cliente, { color: t.tenue }]}>sin nombre</Text>
            ) : null}
          </View>
          {entregar ? (
            // Ya se le dio al cliente: la tarjeta sale del mostrador (la venta no se borra).
            <Pressable
              onPress={() => acciones.entregar(pedido)}
              hitSlop={4}
              accessibilityLabel={`Marcar el pedido #${pedido.numero} como entregado`}
              style={({ pressed }) => [e.entregado, { backgroundColor: pressed ? t.acento400 : 'transparent' }]}
            >
              <Icono nombre="quitar" size={16} color={t.acentoFuerte} grosor={2} />
            </Pressable>
          ) : null}
        </View>
        <View style={e.pastillas}>
          <View style={[e.pastilla, { backgroundColor: estado.fondo }]}>
            <Text style={[e.pastillaTexto, { color: estado.color }]}>{estado.texto}</Text>
          </View>
          {pedido.editado ? (
            <View style={[e.pastilla, { backgroundColor: t.avisoSuave }]}>
              <Text style={[e.pastillaTexto, { color: t.avisoFuerte }]}>EDITADO</Text>
            </View>
          ) : null}
          {!pedido.a_cocina ? (
            <View style={[e.pastilla, { backgroundColor: t.tinta }]}>
              <Text style={[e.pastillaTexto, { color: t.papel }]}>SIN COCINA</Text>
            </View>
          ) : null}
          {preparando ? (
            <View style={[e.pastilla, { backgroundColor: t.acentoSuave }]}>
              <Text style={[e.pastillaTexto, { color: t.acentoFuerte }]}>
                {pedido.cocinando_por ? `${pedido.cocinando_por} la prepara` : 'En preparación'}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={{ gap: 3 }}>
          {pedido.items.map((i) => {
            const tinte = tinteDeVariante(i.variante_id)
            return (
              <View key={i.id} style={e.item}>
                <View style={[e.puntito, { backgroundColor: tinte ? tinte.punto : t.barra }]} />
                {/* La cantidad mas grande que el nombre: es lo que se lee de lejos. */}
                <Text style={[e.cantidad, { color: t.tinta }]}>{i.cantidad}x</Text>
                <Text style={[e.itemNombre, { color: t.fuerte }]} numberOfLines={2}>
                  {i.nombre}
                </Text>
                {/* Renglon por renglon: que se entrega de la vitrina y que espera de cocina. */}
                <Text
                  style={[
                    e.marca,
                    i.a_cocina === false
                      ? { color: t.suave, backgroundColor: t.gris100 }
                      : i.preparado
                        ? { color: t.exito, backgroundColor: t.exitoSuave }
                        : { color: t.aviso, backgroundColor: t.avisoSuave },
                  ]}
                >
                  {i.a_cocina === false ? 'vitrina' : i.preparado ? 'listo' : 'en cocina'}
                </Text>
                {i.cortesia ? <Text style={[e.marca, { color: t.exito, backgroundColor: t.exitoSuave }]}>CORTESÍA</Text> : null}
              </View>
            )
          })}
        </View>
        <View style={e.abajo}>
          <Text style={[e.total, { color: t.tinta }]}>{fmt(pedido.total)}</Text>
          <View style={e.acciones}>
            {!yaPagado ? <BotonChico texto="Anular" color={t.peligro} alTocar={() => acciones.anular(pedido)} /> : null}
            {pedido.estado !== 'anulado' && !pedido.devuelto && !pedido.entregado_en ? (
              <BotonChico texto="Cocina" color={t.fuerte} alTocar={() => acciones.cocina(pedido)} />
            ) : null}
            {/* Se toca aunque no se pueda: el motivo se dice en palabras, en vez de un boton gris mudo. */}
            <Pressable
              onPress={() => acciones.editar(pedido)}
              hitSlop={6}
              accessibilityHint={impedimento ?? 'Cambiar los renglones del pedido'}
              style={({ pressed }) => [e.editar, { opacity: impedimento ? 0.35 : pressed ? 0.55 : 1 }]}
            >
              <Text style={[e.editarTexto, { color: t.fuerte }]}>Editar</Text>
            </Pressable>
            {/* Un pedido cobrado no se vuelve a cobrar ni se anula: para eso esta Devolver, en Ventas. */}
            {!yaPagado ? (
              <Pressable
                onPress={() => acciones.cobrar(pedido)}
                style={({ pressed }) => [e.cobrar, { backgroundColor: t.tinta, opacity: pressed ? 0.85 : 1 }]}
              >
                <Text style={[e.cobrarTexto, { color: t.papel }]}>Cobrar</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  )
})

const e = StyleSheet.create({
  cabeza: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  etiqueta: { fontFamily: LETRA.textoFuerte, fontSize: 11.5, letterSpacing: 1.3 },
  ventas: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, minHeight: 40 },
  ventasTexto: { fontFamily: LETRA.textoFuerte, fontSize: 13.5 },
  leyenda: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 6 },
  itemLeyenda: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  puntoLeyenda: { width: 9, height: 9, borderRadius: 5 },
  textoLeyenda: { fontFamily: LETRA.texto, fontSize: 13 },
  vacio: { fontFamily: LETRA.texto, fontSize: 14, paddingVertical: 24, textAlign: 'center' },
  anillo: { borderWidth: 2, borderRadius: 24, borderCurve: 'continuous', padding: 2 },
  tarjeta: { borderWidth: 2, borderRadius: 20, borderCurve: 'continuous', padding: 14, gap: 10 },
  arriba: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  numero: { fontFamily: LETRA.tituloFuerte, fontSize: 18 },
  cliente: { fontFamily: LETRA.tituloFuerte, fontSize: 17 },
  clienteFuerte: { fontFamily: LETRA.tituloFuerte, fontSize: 16 },
  entregado: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginTop: -6, marginRight: -6 },
  pastillas: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pastilla: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pastillaTexto: { fontFamily: LETRA.textoFuerte, fontSize: 12 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  puntito: { width: 6, height: 6, borderRadius: 3 },
  cantidad: { fontFamily: LETRA.cifraFuerte, fontSize: 15 },
  itemNombre: { fontFamily: LETRA.texto, fontSize: 14, flexShrink: 1 },
  marca: { fontFamily: LETRA.textoFuerte, fontSize: 11, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  abajo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' },
  total: { fontFamily: LETRA.cifraFuerte, fontSize: 17 },
  acciones: { flexDirection: 'row', alignItems: 'center', gap: 2, flexWrap: 'wrap', justifyContent: 'flex-end', flexShrink: 1 },
  editar: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 },
  editarTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14 },
  cobrar: { minHeight: 44, borderRadius: 14, borderCurve: 'continuous', paddingHorizontal: 18, justifyContent: 'center', marginLeft: 4 },
  cobrarTexto: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
})
