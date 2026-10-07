import { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { Controles, Marca } from '../../componentes/Encabezado'
import { Arranque, Avisos, BotonContador, Espera, TarjetaVender } from '../../componentes/inicio/Fichas'
import Recorrido, { FilaReportes } from '../../componentes/inicio/Recorrido'
import { Etiqueta, Ficha, Pantalla, Problema } from '../../componentes/ui'
import { api } from '../../lib/api'
import { parte, useCarga } from '../../lib/carga'
import { fechaDeHoy, saludo } from '../../lib/formato'
import { MODULOS, entraA } from '../../lib/modulos'
import { useMoneda } from '../../lib/moneda'
import { useSesion } from '../../lib/sesion'
import { LETRA, useTema } from '../../lib/tema'

/**
 * EL INICIO, igual que la portada de la web (pages/Inicio.tsx) en un telefono:
 * la marca y los controles arriba, el saludo, las misiones de arranque, el
 * panel de hoy con lo que espera, los avisos, vender, el recorrido del
 * negocio, reportes y la zona contable. Las mismas llamadas a la API, el
 * mismo orden y las mismas palabras.
 */
let yaSeVio = false

export default function Inicio() {
  const t = useTema()
  const { acceso } = useSesion()
  const { fmt } = useMoneda()
  const puede = acceso?.puede
  const veCifras = puede?.ve_kpis ?? false

  const { datos, error, refrescando, refrescar } = useCarga(async () => {
    const [resumen, pedidos, cocina, cobrar, avisos, recorrido, arranque] = await Promise.all([
      veCifras ? parte(api.resumenDeHoy()) : Promise.resolve(null),
      parte(api.pedidosDelDia()),
      parte(api.enCocina()),
      parte(api.porCobrar()),
      veCifras ? parte(api.avisos()) : Promise.resolve(null),
      veCifras ? parte(api.recorrido()) : Promise.resolve(null),
      puede?.administrar ? parte(api.arranque()) : Promise.resolve(null),
    ])
    const todas = [resumen, pedidos, cocina, cobrar].filter((p) => p !== null)
    const caida = todas.find((p) => !p.ok)
    if (caida && !caida.ok && todas.every((p) => !p.ok)) throw new Error(caida.error)
    return { resumen, pedidos, cocina, cobrar, avisos, recorrido, arranque }
  })

  // La portada entra entera, de una vez, con un fundido corto (vp-aparece),
  // y solo la primera vez: al volver de otra pantalla ya esta.
  const aparece = useSharedValue(yaSeVio ? 1 : 0)
  useEffect(() => {
    if (datos && !yaSeVio) {
      yaSeVio = true
      aparece.set(withTiming(1, { duration: 320 }))
    }
  }, [datos, aparece])
  const estiloAparece = useAnimatedStyle(() => ({ opacity: aparece.value }))

  const nombre = acceso?.nombre || acceso?.nombre_visible || acceso?.usuario || ''
  const ventas = datos?.resumen?.ok ? datos.resumen.valor.ventas : null
  const nPedidos = datos?.pedidos?.ok ? datos.pedidos.valor.length : null
  const enCocina = datos?.cocina?.ok ? datos.cocina.valor.length : null
  const porCobrar = datos?.cobrar?.ok ? datos.cobrar.valor.length : null
  const avisos = datos?.avisos?.ok ? datos.avisos.valor : []
  const recorrido = datos ? (datos.recorrido?.ok ? datos.recorrido.valor : veCifras ? null : undefined) : null
  const arranque = datos?.arranque?.ok ? datos.arranque.valor : null

  const modulos = puede?.modulos ?? []
  const vender = MODULOS.filter((m) => (m.to === '/pos' || m.to === '/cocina') && entraA(modulos, m))
  const rutas = MODULOS.filter((m) => entraA(modulos, m)).map((m) => m.to)
  const contador = MODULOS.filter((m) => ['/contabilidad', '/impuestos', '/tasa'].includes(m.to) && entraA(modulos, m))

  return (
    <Pantalla refrescando={refrescando} alRefrescar={refrescar}>
      {/* Cabecera: la marca del local y los controles. */}
      <View style={estilos.cabecera}>
        <Marca />
        <Controles />
      </View>
      <Text style={[estilos.saludo, { color: t.suave }]}>
        {saludo()}, <Text style={{ color: t.fuerte, fontFamily: LETRA.textoFuerte }}>{nombre}</Text>
        <Text style={{ color: t.tenue }}> · </Text>
        {fechaDeHoy()}
      </Text>

      {error && !datos ? <Problema mensaje={error} alReintentar={refrescar} /> : null}

      <Animated.View style={[{ gap: 12 }, estiloAparece]}>
        <Arranque datos={arranque} />

        {/* ── Hoy ── */}
        <Etiqueta style={{ marginTop: 4, marginBottom: -4 }}>Hoy</Etiqueta>
        <Ficha style={{ paddingVertical: 22 }}>
          <Text style={[estilos.vendido, { color: t.tinta }]} numberOfLines={1} adjustsFontSizeToFit>
            {veCifras && ventas !== null ? fmt(ventas) : '—'}
          </Text>
          <Text style={[estilos.vendidoNota, { color: t.suave }]}>
            Vendido hoy
            {nPedidos !== null && (
              <>
                <Text style={{ color: t.tenue }}> · </Text>
                <Text style={{ color: t.fuerte, fontFamily: LETRA.textoFuerte }}>{nPedidos}</Text> {nPedidos === 1 ? 'pedido' : 'pedidos'}
              </>
            )}
          </Text>
        </Ficha>
        <View style={estilos.par}>
          <Espera titulo="En cocina" valor={enCocina} nota="comandas preparándose" to="/cocina" />
          <Espera titulo="Por cobrar" valor={porCobrar} nota="listas, falta cobrar" to={puede?.operar ? '/pos' : undefined} />
        </View>

        {veCifras && <Avisos lista={avisos} />}

        {/* ── Vender ── */}
        {vender.length > 0 && (
          <View style={{ gap: 10 }}>
            <Etiqueta style={{ marginTop: 4 }}>Vender</Etiqueta>
            {vender.map((m, i) => (
              <TarjetaVender
                key={m.to}
                to={m.to}
                icono={m.icono}
                titulo={m.titulo}
                desc={m.to === '/pos' ? 'Tomar la comanda y cobrar' : 'Las comandas que llegan'}
                principal={i === 0 && Boolean(puede?.operar)}
              />
            ))}
          </View>
        )}

        {/* ── El recorrido del negocio y Reportes ── */}
        <Recorrido datos={recorrido} modulos={rutas} />
        {rutas.includes('/reportes') && <FilaReportes dias={datos?.recorrido?.ok ? datos.recorrido.valor.ultimos_7_dias : undefined} />}

        {/* ── Zona contable ── */}
        {contador.length > 0 && (
          <View style={[estilos.contable, { borderTopColor: t.gris200 }]}>
            <View style={estilos.contableCabeza}>
              <Etiqueta>Zona contable</Etiqueta>
              <Text style={[estilos.contableNota, { color: t.tenue }]}>Se arma solo con lo de arriba</Text>
            </View>
            <View style={{ gap: 8 }}>
              {contador.map((m) => (
                <BotonContador key={m.to} to={m.to} icono={m.icono} titulo={m.titulo} desc={m.pregunta} />
              ))}
            </View>
          </View>
        )}
      </Animated.View>
    </Pantalla>
  )
}

const estilos = StyleSheet.create({
  cabecera: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 4 },
  saludo: { fontFamily: LETRA.texto, fontSize: 15, marginTop: 2, marginBottom: 2 },
  vendido: { fontFamily: LETRA.tituloFuerte, fontSize: 48, letterSpacing: -1.5, lineHeight: 52 },
  vendidoNota: { fontFamily: LETRA.texto, fontSize: 15, marginTop: 8 },
  par: { flexDirection: 'row', gap: 12 },
  contable: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, marginTop: 4, gap: 8 },
  contableCabeza: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  contableNota: { fontFamily: LETRA.texto, fontSize: 12 },
})
