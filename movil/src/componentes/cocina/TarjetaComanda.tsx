import { memo } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { LETRA, useModo, useTema } from '../../lib/tema'
import type { Pedido } from '../../lib/tipos'
import Icono from '../Icono'
import { antiguedad, editandoAhora, minutosDesde, type Tinte } from './comanda'

/**
 * UNA COMANDA EN EL TABLERO, como la tarjeta de pages/Cocina.tsx: el numero
 * grande (es lo que se canta cuando sale la comida) y el cliente debajo; a la
 * derecha "Editado", "Nuevo", los minutos y Anular; los renglones grandes,
 * cada uno con su color de categoria, que se tocan para marcarlos; y abajo
 * Preparar y Todo listo.
 *
 * `z` es el tamaño que eligio la cocina (Configuración > Apariencia): en la
 * web es un `zoom` sobre el tablero; aqui multiplica letras y espacios.
 */
function TarjetaComanda({
  pedido,
  nueva,
  z,
  tinteDe,
  alTocarRenglon,
  alPreparar,
  alListo,
  alAnular,
}: {
  pedido: Pedido
  nueva: boolean
  z: number
  tinteDe: (varianteId: number | null) => Tinte | undefined
  alTocarRenglon: (itemId: number) => void
  alPreparar: (pedidoId: number) => void
  alListo: (pedidoId: number) => void
  alAnular: (pedido: Pedido) => void
}) {
  const t = useTema()
  const { modo } = useModo()
  const minutos = minutosDesde(pedido.creado_en)
  const edad = antiguedad(minutos)
  // La caja la tiene abierta: no se toca hasta que termine, porque los
  // renglones que se ven pueden dejar de ser los del pedido.
  const bloqueada = editandoAhora(pedido)
  const mia = Boolean(pedido.cocinando_desde)
  // Lo de vitrina no se cocina: el refresco de la nevera solo le estorba a
  // quien esta en la plancha.
  const renglones = pedido.items.filter((i) => i.a_cocina !== false)

  // El contorno dice lo mas urgente: bloqueada, recien llegada, o vieja.
  const contorno = bloqueada
    ? { borderColor: t.aviso, borderWidth: 2, backgroundColor: t.avisoSuave }
    : nueva
      ? { borderColor: t.acento, borderWidth: 2 }
      : edad === 'mal'
        ? { borderColor: t.peligro, borderWidth: 2 }
        : edad === 'ojo'
          ? { borderColor: t.aviso, borderWidth: 1.5 }
          : { borderColor: modo === 'oscuro' ? 'rgba(255,255,255,0.06)' : t.linea, borderWidth: 1 }
  const colorMin =
    edad === 'mal' ? { bg: t.peligroSuave, tx: t.peligro } : edad === 'ojo' ? { bg: t.avisoSuave, tx: t.aviso } : { bg: t.exitoSuave, tx: t.exito }

  return (
    <View style={[e.tarjeta, { backgroundColor: t.superficie, padding: 12 * z, gap: 10 * z }, contorno]}>
      <View style={e.cabeza}>
        {/* El nombre debajo del numero y no al lado: el numero se lee de lejos. */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[e.numero, { color: t.tinta, fontSize: 26 * z, lineHeight: 30 * z }]}>#{pedido.numero}</Text>
          {pedido.cliente ? (
            <Text style={[e.cliente, { color: t.suave, fontSize: 14 * z }]} numberOfLines={1}>
              {pedido.cliente}
            </Text>
          ) : null}
        </View>
        <View style={e.marcas}>
          {/* Un pedido que cambio despues de tomado: lo primero es releer los renglones. */}
          {pedido.editado ? <Marca texto="Editado" fondo={t.avisoSuave} color={t.aviso} z={z} /> : null}
          {nueva ? <Marca texto="Nuevo" fondo={t.acento} color={t.acentoTinta} z={z} /> : null}
          <View style={[e.minutos, { backgroundColor: colorMin.bg, paddingHorizontal: 9 * z, paddingVertical: 3 * z }]}>
            <Text style={[e.minutosTexto, { color: colorMin.tx, fontSize: 13 * z }]}>{minutos} min</Text>
          </View>
          <Pressable
            onPress={() => alAnular(pedido)}
            disabled={bloqueada}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={`Anular la comanda ${pedido.numero}`}
            style={({ pressed }) => ({ opacity: bloqueada ? 0.4 : pressed ? 0.6 : 1, paddingHorizontal: 4, paddingVertical: 4 })}
          >
            <Text style={[e.anular, { color: t.tenue, fontSize: 13 * z }]}>Anular</Text>
          </Pressable>
        </View>
      </View>

      {bloqueada ? (
        <View style={[e.bloqueo, { backgroundColor: t.avisoSuave, borderColor: t.avisoLinea }]}>
          <Icono nombre="alerta" size={16 * z} color={t.aviso} />
          <Text style={[e.bloqueoTexto, { color: t.avisoFuerte, fontSize: 13.5 * z }]}>
            {pedido.editando_por || 'El punto de venta'} está editando esta comanda. Espera: los renglones pueden cambiar.
          </Text>
        </View>
      ) : null}

      <View style={{ gap: 6 * z }}>
        {renglones.map((item) => {
          const tinte = tinteDe(item.variante_id)
          const fondo = item.preparado ? t.exitoSuave : tinte?.fondo ?? t.gris100
          const borde = item.preparado ? `${t.exito500}55` : tinte?.borde ?? t.gris200
          return (
            <Pressable
              key={item.id}
              onPress={() => alTocarRenglon(item.id)}
              disabled={bloqueada}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: item.preparado, disabled: bloqueada }}
              accessibilityLabel={`${item.cantidad} ${item.nombre}`}
              style={({ pressed }) => [
                e.renglon,
                {
                  backgroundColor: fondo,
                  borderColor: borde,
                  minHeight: 48 * z,
                  paddingHorizontal: 12 * z,
                  paddingVertical: 8 * z,
                  opacity: bloqueada ? 0.5 : 1,
                  transform: [{ scale: pressed ? 0.985 : 1 }],
                },
              ]}
            >
              {/* Grande: se lee desde la plancha, no con la tablet en la mano. */}
              <Text
                style={[
                  e.renglonTexto,
                  { color: item.preparado ? t.tenue : t.tinta, fontSize: 18 * z, lineHeight: 24 * z },
                  item.preparado && e.tachado,
                ]}
              >
                <Text style={e.cantidad}>{item.cantidad}x</Text> {item.nombre}
                {item.cortesia ? <Text style={[e.cortesia, { color: t.exito, fontSize: 11 * z }]}>{'  CORTESÍA'}</Text> : null}
              </Text>
              <View
                style={[
                  e.check,
                  {
                    width: 26 * z,
                    height: 26 * z,
                    borderRadius: 13 * z,
                    backgroundColor: item.preparado ? t.exito500 : t.gris200,
                  },
                ]}
              >
                {item.preparado ? <Icono nombre="ok" size={15 * z} color="#ffffff" grosor={2.6} /> : null}
              </View>
            </Pressable>
          )
        })}
      </View>

      {/* Las dos acciones en una fila: apiladas eran media tarjeta. */}
      <View style={[e.acciones, { gap: 8 * z }]}>
        <Pressable
          onPress={() => alPreparar(pedido.id)}
          disabled={bloqueada}
          accessibilityRole="button"
          accessibilityLabel={mia && pedido.cocinando_por ? `En preparación · ${pedido.cocinando_por}` : mia ? 'Preparando' : 'Preparar'}
          style={({ pressed }) => [
            e.boton,
            { minHeight: 46 * z, backgroundColor: mia ? t.acentoSuave : t.gris100, opacity: bloqueada ? 0.4 : pressed ? 0.85 : 1 },
            mia && { borderWidth: 1, borderColor: `${t.acento400}80` },
          ]}
        >
          <Icono nombre="cocina" size={15 * z} color={mia ? t.acento : t.suave} />
          <Text style={[e.botonTexto, { color: mia ? t.acentoFuerte : t.suave, fontSize: 14.5 * z }]} numberOfLines={1}>
            {mia ? 'Preparando' : 'Preparar'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => alListo(pedido.id)}
          disabled={bloqueada}
          accessibilityRole="button"
          style={({ pressed }) => [
            e.boton,
            { minHeight: 46 * z, backgroundColor: t.exito500, opacity: bloqueada ? 0.4 : pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[e.botonTexto, { color: '#ffffff', fontSize: 14.5 * z }]}>Todo listo</Text>
        </Pressable>
      </View>
      {mia && pedido.cocinando_por ? (
        <Text style={{ fontFamily: LETRA.texto, fontSize: 13 * z, color: t.tenue, marginTop: -4 * z }} numberOfLines={1}>
          En preparación · {pedido.cocinando_por}
        </Text>
      ) : null}
    </View>
  )
}

function Marca({ texto, fondo, color, z }: { texto: string; fondo: string; color: string; z: number }) {
  return (
    <View style={[e.marca, { backgroundColor: fondo, paddingHorizontal: 8 * z, paddingVertical: 3 * z }]}>
      <Text style={[e.marcaTexto, { color, fontSize: 11 * z }]}>{texto}</Text>
    </View>
  )
}

export default memo(TarjetaComanda)

const e = StyleSheet.create({
  tarjeta: {
    borderRadius: 22, borderCurve: 'continuous',
    boxShadow: '0 8px 18px rgba(23,24,27,0.1)',
  },
  cabeza: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  numero: { fontFamily: LETRA.tituloFuerte, letterSpacing: -0.5 },
  cliente: { fontFamily: LETRA.textoFuerte, marginTop: 2 },
  marcas: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 6, maxWidth: '68%' },
  marca: { borderRadius: 999 },
  marcaTexto: { fontFamily: LETRA.textoFuerte, letterSpacing: 0.8, textTransform: 'uppercase' },
  minutos: { borderRadius: 999 },
  minutosTexto: { fontFamily: LETRA.cifraFuerte },
  anular: { fontFamily: LETRA.textoFuerte },
  bloqueo: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, borderCurve: 'continuous', borderWidth: 1, padding: 10 },
  bloqueoTexto: { flex: 1, fontFamily: LETRA.textoFuerte },
  renglon: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderRadius: 14, borderCurve: 'continuous', borderWidth: 1 },
  renglonTexto: { flex: 1, minWidth: 0, fontFamily: LETRA.textoFuerte },
  tachado: { textDecorationLine: 'line-through' },
  cantidad: { fontFamily: LETRA.cifraFuerte },
  cortesia: { fontFamily: LETRA.textoFuerte, letterSpacing: 0.8 },
  check: { alignItems: 'center', justifyContent: 'center' },
  acciones: { flexDirection: 'row' },
  boton: { flex: 1, minWidth: 0, borderRadius: 14, borderCurve: 'continuous', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8 },
  botonTexto: { fontFamily: LETRA.textoFuerte },
})
