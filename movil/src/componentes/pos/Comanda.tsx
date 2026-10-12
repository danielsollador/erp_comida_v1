import { memo, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { nombreDe, type Carrito, type Libre, type LineaCarrito, type Tinte } from '../../lib/pos'
import { LETRA, useModo, useTema } from '../../lib/tema'
import type { Pedido, Producto, Variante } from '../../lib/tipos'
import Icono from '../Icono'
import { Contador, HojaFormulario } from '../kit'
import { Boton, Campo } from '../ui'
import { BotonChico } from './piezas'

/*
 * LA COMANDA QUE SE ESTA ARMANDO (la columna derecha de pages/POS.tsx).
 *
 * En la tablet va al lado del catalogo, como en la web. En el telefono no
 * caben las dos: la comanda vive en una hoja que se abre desde la barra de
 * abajo. Las piezas son las mismas y dicen lo mismo; solo cambia el marco.
 *
 * Lo que se abre desde aqui (¿Qué va a cocina?, la diferencia de una venta
 * ya cobrada, el monto del envio) llega en `extra` y se dibuja DENTRO de la
 * comanda: en el telefono la comanda ya es una hoja, y un cuadro encima de
 * otro solo se ve si va dentro del primero.
 */

type Fmt = (usd: number | null | undefined, decimales?: number) => string

export type AccionesComanda = {
  sumar: (p: Producto, v: Variante) => void
  restar: (varianteId: number) => void
  quitarTodo: (varianteId: number) => void
  cortesia: (varianteId: number) => void
  quitarLibre: (id: string) => void
  vaciar: () => void
  delivery: () => void
  cambiarCliente: (v: string) => void
  enviar: () => void
  cancelarEdicion: () => void
}

export function Comanda({
  forma,
  visible = false,
  alCerrar,
  carrito,
  libres,
  total,
  enEdicion,
  cliente,
  faltaNombre,
  enviada,
  error,
  tinteDe,
  fmt,
  acciones,
  extra,
}: {
  forma: 'columna' | 'hoja'
  visible?: boolean
  alCerrar?: () => void
  carrito: Carrito
  libres: Libre[]
  total: number
  enEdicion: Pedido | null
  cliente: string
  faltaNombre: boolean
  enviada: { numero: number; cliente: string } | null
  error: string
  tinteDe: (categoriaId: number) => Tinte
  fmt: Fmt
  acciones: AccionesComanda
  extra?: ReactNode
}) {
  const t = useTema()
  const { modo } = useModo()
  const vacia = Object.keys(carrito).length === 0 && libres.length === 0

  const cuerpo = (
    <>
      {enEdicion ? (
        <View style={[e.edicion, { backgroundColor: t.avisoSuave, borderColor: t.avisoLinea }]}>
          <View style={{ flex: 1 }}>
            <Text style={[e.edicionTitulo, { color: t.avisoFuerte }]}>Editando el pedido #{enEdicion.numero}</Text>
            {enEdicion.estado === 'pagado' ? (
              <Text style={[e.edicionNota, { color: t.aviso }]}>Ya está cobrado: si cambia el total, se cuadra la diferencia.</Text>
            ) : null}
          </View>
          <BotonChico texto="Cancelar" color={t.avisoFuerte} alTocar={acciones.cancelarEdicion} />
        </View>
      ) : null}
      {!enEdicion && (forma === 'columna' || !vacia) ? (
        <View style={e.cabeza}>
          {forma === 'columna' ? <Text style={[e.titulo, { color: t.tinta }]}>Comanda actual</Text> : <View />}
          {!vacia ? <BotonChico texto="Vaciar" color={t.tenue} alTocar={acciones.vaciar} /> : null}
        </View>
      ) : null}
      {/* El envio cobra distinto segun la distancia: no es un producto de
          precio fijo, se escribe el monto en cada pedido. */}
      <Pressable
        onPress={acciones.delivery}
        style={({ pressed }) => [e.delivery, { borderColor: t.acento400, backgroundColor: pressed ? t.acentoSuave : 'transparent' }]}
      >
        <Text style={[e.deliveryTexto, { color: t.acento }]}>+ Delivery</Text>
      </Pressable>
      {error ? <Text style={[e.error, { color: t.peligro }]}>{error}</Text> : null}
      <View style={{ gap: 4 }}>
        {Object.values(carrito).map((c) => (
          <LineaComanda
            key={c.variante.id}
            linea={c}
            tinte={tinteDe(c.producto.categoria_id)}
            fmt={fmt}
            alSumar={acciones.sumar}
            alRestar={acciones.restar}
            alQuitarTodo={acciones.quitarTodo}
            alCortesia={acciones.cortesia}
          />
        ))}
        {libres.map((l) => (
          <View key={l.id} style={[e.libre, { borderBottomColor: t.gris200 }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[e.nombre, { color: t.tinta }]} numberOfLines={2}>
                {l.nombre}
              </Text>
              <Text style={[e.detalle, { color: t.suave }]}>{fmt(l.precio)}</Text>
            </View>
            <BotonQuitar etiqueta={`Quitar ${l.nombre}`} alTocar={() => acciones.quitarLibre(l.id)} />
          </View>
        ))}
        {vacia ? <Text style={[e.detalle, { color: t.tenue, paddingVertical: 10 }]}>Toca un producto para agregarlo.</Text> : null}
      </View>
    </>
  )

  const pie = (
    <View style={{ flex: 1, gap: 8 }}>
      {/* A nombre de quien va: con ocho comandas vivas, "#14" no le dice a
          nadie de quien es. OBLIGATORIO: cuatro comandas sin dueño se
          reparten preguntando en voz alta, y una fiada no tendria a quien
          cobrarle. */}
      <Campo
        value={cliente}
        onChangeText={acciones.cambiarCliente}
        placeholder="¿A nombre de quién?"
        autoCapitalize="words"
        error={faltaNombre ? 'Sin nombre no se puede comandar.' : undefined}
        returnKeyType="done"
      />
      {/* La comanda salio: aqui, donde la cajera ya esta mirando cuando toca
          "Enviar". Se va sola a los cuatro segundos. */}
      {enviada && !faltaNombre ? (
        <View style={e.enviada} accessibilityLiveRegion="polite">
          <View style={[e.check, { backgroundColor: t.exito }]}>
            <Icono nombre="ok" size={11} color={t.exitoSuave} grosor={3} />
          </View>
          <Text style={[e.enviadaTexto, { color: t.exito }]} numberOfLines={1}>
            Comanda #{enviada.numero} enviada{enviada.cliente ? ` · ${enviada.cliente}` : ''}
          </Text>
        </View>
      ) : null}
      <View style={e.total}>
        <Text style={[e.totalRotulo, { color: t.suave }]}>Total</Text>
        <Text style={[e.totalCifra, { color: t.tinta }]}>{fmt(total)}</Text>
      </View>
      {enEdicion ? (
        <View style={[e.total, { marginTop: -6 }]}>
          <Text style={[e.detalle, { color: t.suave }]}>Antes</Text>
          <Text style={[e.detalleCifra, { color: t.suave }]}>{fmt(enEdicion.total + (enEdicion.descuento || 0))}</Text>
        </View>
      ) : null}
      <Boton texto={enEdicion ? 'Guardar cambios' : 'Enviar comanda'} alTocar={acciones.enviar} deshabilitado={vacia} />
    </View>
  )

  if (forma === 'hoja') {
    return (
      <HojaFormulario
        visible={visible}
        alCerrar={alCerrar ?? (() => undefined)}
        titulo={enEdicion ? `Pedido #${enEdicion.numero}` : 'Comanda actual'}
        pie={pie}
      >
        {cuerpo}
        {extra}
      </HojaFormulario>
    )
  }

  return (
    <View
      style={[
        e.columna,
        { backgroundColor: t.superficie, borderLeftColor: modo === 'oscuro' ? 'rgba(255,255,255,0.06)' : t.gris200 },
      ]}
    >
      <ScrollView contentContainerStyle={{ padding: 14, gap: 10 }} keyboardShouldPersistTaps="handled">
        {cuerpo}
      </ScrollView>
      <View style={[e.pieColumna, { borderTopColor: t.gris200 }]}>{pie}</View>
      {extra}
    </View>
  )
}

/**
 * Un renglon de la comanda: el nombre con la raya del color de su categoria,
 * cuanto suma, la cortesia (un toque la marca, otro la desmarca) y las
 * cantidades. Memorizado: escribir el nombre del cliente no lo repinta.
 */
const LineaComanda = memo(function LineaComanda({
  linea,
  tinte,
  fmt,
  alSumar,
  alRestar,
  alQuitarTodo,
  alCortesia,
}: {
  linea: LineaCarrito
  tinte: Tinte
  fmt: Fmt
  alSumar: (p: Producto, v: Variante) => void
  alRestar: (varianteId: number) => void
  alQuitarTodo: (varianteId: number) => void
  alCortesia: (varianteId: number) => void
}) {
  const t = useTema()
  const { producto, variante, cantidad, cortesia, precio } = linea
  const unidad = precio ?? variante.precio
  const nombre = nombreDe(producto, variante)
  return (
    <View style={[e.linea, { borderBottomColor: t.gris200 }]}>
      <View style={[e.raya, { backgroundColor: tinte.punto }]} />
      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <Text style={[e.nombre, { color: t.tinta, flex: 1 }]} numberOfLines={2}>
            {nombre}
          </Text>
          <BotonQuitar etiqueta={`Quitar todas las de ${nombre}`} alTocar={() => alQuitarTodo(variante.id)} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            {cortesia ? (
              <>
                <Text style={[e.detalleCifra, { color: t.tenue, textDecorationLine: 'line-through' }]}>{fmt(unidad * cantidad)}</Text>
                <Text style={[e.detalleCifra, { color: t.exito, fontFamily: LETRA.cifraFuerte }]}>{fmt(0)}</Text>
              </>
            ) : (
              <Text style={[e.detalleCifra, { color: t.suave }]}>
                {cantidad} x {fmt(unidad)} = <Text style={{ color: t.fuerte, fontFamily: LETRA.cifraFuerte }}>{fmt(unidad * cantidad)}</Text>
              </Text>
            )}
            {/* Regalar el renglon: chico y a la mano, sin cuadro ni motivo. */}
            <Pressable
              onPress={() => alCortesia(variante.id)}
              hitSlop={8}
              accessibilityRole="switch"
              accessibilityState={{ checked: cortesia }}
              style={[
                e.cortesia,
                cortesia ? { backgroundColor: t.exitoSuave, borderColor: t.exito500 } : { borderColor: t.gris200 },
              ]}
            >
              <Text style={[e.cortesiaTexto, { color: cortesia ? t.exito : t.tenue }]}>{cortesia ? '✓ Cortesía' : 'Cortesía'}</Text>
            </Pressable>
          </View>
          <Contador
            valor={cantidad}
            alCambiar={(n) => (n > cantidad ? alSumar(producto, variante) : alRestar(variante.id))}
            minimo={0}
          />
        </View>
      </View>
    </View>
  )
})

/** La × de quitar: 44 px tocables aunque se vea chica. */
function BotonQuitar({ etiqueta, alTocar }: { etiqueta: string; alTocar: () => void }) {
  const t = useTema()
  return (
    <Pressable
      onPress={alTocar}
      hitSlop={6}
      accessibilityLabel={etiqueta}
      style={({ pressed }) => [e.quitar, { backgroundColor: pressed ? t.peligroSuave : 'transparent' }]}
    >
      <Icono nombre="quitar" size={15} color={t.tenue} grosor={2} />
    </Pressable>
  )
}

const e = StyleSheet.create({
  columna: { flex: 1, borderLeftWidth: StyleSheet.hairlineWidth },
  pieColumna: { padding: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  cabeza: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 40 },
  titulo: { fontFamily: LETRA.titulo, fontSize: 17, letterSpacing: -0.2 },
  edicion: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1, paddingLeft: 14, paddingRight: 6, paddingVertical: 6 },
  edicionTitulo: { fontFamily: LETRA.textoFuerte, fontSize: 14.5 },
  edicionNota: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 2, lineHeight: 18 },
  delivery: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 14, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  deliveryTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14 },
  error: { fontFamily: LETRA.texto, fontSize: 14, lineHeight: 20 },
  linea: { flexDirection: 'row', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  raya: { width: 4, borderRadius: 2, alignSelf: 'stretch', minHeight: 30 },
  nombre: { fontFamily: LETRA.textoFuerte, fontSize: 15, lineHeight: 20 },
  detalle: { fontFamily: LETRA.texto, fontSize: 13.5 },
  detalleCifra: { fontFamily: LETRA.cifra, fontSize: 13.5 },
  cortesia: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  cortesiaTexto: { fontFamily: LETRA.textoFuerte, fontSize: 11.5, letterSpacing: 0.6, textTransform: 'uppercase' },
  quitar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginTop: -8, marginRight: -6 },
  libre: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  enviada: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  check: { width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  enviadaTexto: { flex: 1, fontFamily: LETRA.textoFuerte, fontSize: 13.5 },
  total: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  totalRotulo: { fontFamily: LETRA.textoFuerte, fontSize: 13 },
  totalCifra: { fontFamily: LETRA.tituloFuerte, fontSize: 24, letterSpacing: -0.5 },
})
