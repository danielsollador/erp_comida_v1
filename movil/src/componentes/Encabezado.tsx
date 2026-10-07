import { router } from 'expo-router'
import { useEffect, useState, type ReactNode } from 'react'
import { Image, Pressable, StyleSheet, Text, View } from 'react-native'
import { api } from '../lib/api'
import { useMoneda, VISTAS } from '../lib/moneda'
import { useSesion } from '../lib/sesion'
import { LETRA, useModo, useTema } from '../lib/tema'
import { miles } from '../lib/formato'
import { Hoja, OpcionHoja } from './Hoja'
import Icono from './Icono'
import Svg, { Path } from 'react-native-svg'

/*
 * La cabecera de la web (pages/Inicio.tsx y components/NavBar.tsx): la marca
 * del local a la izquierda y, a la derecha, los mismos controles en el mismo
 * orden: moneda, campana, tema y la cuenta. Sin "pantalla completa": en el
 * telefono la app ya ocupa la pantalla.
 */

/** El logo del local, como en la web. En oscuro se aclara para no hundirse. */
export function Marca() {
  const t = useTema()
  const { modo } = useModo()
  const { acceso } = useSesion()
  const [falla, setFalla] = useState(false)
  const logo = acceso?.local.logo
  const base = acceso?.local.dominio
  const uri = logo && base && !falla ? `${base.replace(/\/+$/, '')}${logo}` : null
  if (!uri) {
    return <Text style={[estilos.marcaTexto, { color: t.tinta }]}>{acceso?.local.nombre || 'Vertigo Pro'}</Text>
  }
  return (
    <Image
      source={{ uri }}
      onError={() => setFalla(true)}
      resizeMode="contain"
      style={[estilos.logo, modo === 'oscuro' && { tintColor: '#e7e1d8' }]}
      accessibilityLabel={acceso?.local.nombre}
    />
  )
}

/** El circulo de un control del encabezado: borde fino, fondo de superficie. */
function Control({
  children,
  alTocar,
  etiqueta,
  ancho,
}: {
  children: ReactNode
  alTocar: () => void
  etiqueta: string
  ancho?: boolean
}) {
  const t = useTema()
  return (
    <Pressable
      onPress={alTocar}
      accessibilityLabel={etiqueta}
      hitSlop={4}
      style={({ pressed }) => [
        ancho ? estilos.controlAncho : estilos.control,
        { borderColor: t.gris200, backgroundColor: t.superficie, transform: [{ scale: pressed ? 0.94 : 1 }] },
      ]}
    >
      {children}
    </Pressable>
  )
}

/** Luna en claro, sol en oscuro: el boton de la web (lib/tema.tsx). */
export function BotonTema() {
  const t = useTema()
  const { modo, alternar } = useModo()
  const aOscuro = modo === 'claro'
  return (
    <Control alTocar={alternar} etiqueta={aOscuro ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}>
      <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
        {aOscuro ? (
          <Path d="M20.5 14.2A8.6 8.6 0 1 1 9.8 3.5a6.9 6.9 0 0 0 10.7 10.7z" stroke={t.suave} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <Path
            d="M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"
            stroke={t.suave}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </Svg>
    </Control>
  )
}

/** "$ Dólares BCV · 873,87": en que moneda se ven los montos, y la tasa. */
export function BotonMoneda() {
  const t = useTema()
  const { vista, setVista, tasa } = useMoneda()
  const [abierto, setAbierto] = useState(false)
  const simbolo = vista === 'bs' ? 'Bs' : vista === 'eur' ? '€' : '$'
  return (
    <>
      <Control alTocar={() => setAbierto(true)} etiqueta="Elegir en qué moneda ver los montos" ancho>
        <View style={[estilos.puntoVivo, { backgroundColor: tasa && !tasa.desactualizada ? t.exito500 : t.aviso }]} />
        <Text style={[estilos.monedaTexto, { color: t.tinta }]}>{simbolo}</Text>
        <Icono nombre="chevron" size={12} color={t.tenue} grosor={2.4} />
      </Control>
      <Hoja visible={abierto} alCerrar={() => setAbierto(false)} titulo="Ver los montos en">
        {VISTAS.map((v) => (
          <OpcionHoja
            key={v.id}
            texto={v.nombre}
            detalle={
              v.id === 'usd'
                ? `BCV ${tasa?.bcv ? miles(tasa.bcv) : '…'} Bs`
                : v.id === 'usd_calle'
                  ? `Paralelo ${tasa?.paralelo ? miles(tasa.paralelo) : '…'} Bs`
                  : v.id === 'eur'
                    ? `Euro ${tasa?.eur ? miles(tasa.eur) : '…'} Bs`
                    : v.detalle
            }
            marcada={vista === v.id}
            alTocar={() => {
              setVista(v.id)
              setAbierto(false)
            }}
          />
        ))}
      </Hoja>
    </>
  )
}

/** La campana: las autorizaciones que esperan a quien puede darlas. */
export function Campana() {
  const t = useTema()
  const { acceso } = useSesion()
  const autoriza = acceso?.puede.autoriza ?? false
  const [pendientes, setPendientes] = useState(0)

  useEffect(() => {
    if (!autoriza) return
    const cargar = () =>
      api
        .solicitudesPendientes()
        .then((s) => setPendientes(s.filter((x) => x.estado === 'pendiente').length))
        .catch(() => undefined)
    cargar()
    const id = setInterval(cargar, 30_000)
    return () => clearInterval(id)
  }, [autoriza])

  return (
    <Control alTocar={() => router.push('/notificaciones')} etiqueta={`${pendientes} notificaciones`}>
      <Icono nombre="campana" size={17} color={t.suave} />
      {pendientes > 0 && (
        <View style={[estilos.globo, { backgroundColor: t.tinta, borderColor: t.papel }]}>
          <Text style={[estilos.globoTexto, { color: t.papel }]}>{pendientes > 9 ? '9+' : pendientes}</Text>
        </View>
      )}
    </Control>
  )
}

/** La inicial de quien esta dentro; abre Mi cuenta, Configuración y Salir. */
export function MenuUsuario() {
  const t = useTema()
  const { acceso, salir } = useSesion()
  const [abierto, setAbierto] = useState(false)
  const nombre = acceso?.nombre_visible || acceso?.usuario || ''
  const inicial = (nombre[0] || '·').toUpperCase()
  const ir = (seccion: 'cuenta' | 'usuarios') => {
    setAbierto(false)
    router.push({ pathname: '/configuracion/[seccion]', params: { seccion } })
  }
  const gestiona = acceso?.puede.modulos.includes('usuarios') ?? false
  return (
    <>
      <Pressable
        onPress={() => setAbierto(true)}
        accessibilityLabel="Tu cuenta"
        style={({ pressed }) => [estilos.avatar, { backgroundColor: t.tinta, transform: [{ scale: pressed ? 0.94 : 1 }] }]}
      >
        <Text style={[estilos.avatarTexto, { color: t.papel }]}>{inicial}</Text>
      </Pressable>
      <Hoja visible={abierto} alCerrar={() => setAbierto(false)}>
        <View style={estilos.quien}>
          <Text style={[estilos.quienNombre, { color: t.tinta }]}>{nombre}</Text>
          <Text style={[estilos.quienRol, { color: t.tenue }]}>
            {acceso?.rol ?? ''} · {acceso?.local.nombre ?? ''}
          </Text>
        </View>
        <OpcionHoja icono="cuenta" texto="Mi cuenta" alTocar={() => ir('cuenta')} />
        {gestiona && <OpcionHoja icono="configuracion" texto="Configuración" alTocar={() => ir('usuarios')} />}
        <OpcionHoja
          icono="salir"
          texto="Salir"
          peligro
          alTocar={() => {
            setAbierto(false)
            void salir()
          }}
        />
      </Hoja>
    </>
  )
}

/** Los cuatro controles, en el orden de la web. */
export function Controles() {
  const { acceso } = useSesion()
  return (
    <View style={estilos.controles}>
      {acceso?.puede.operar && <BotonMoneda />}
      <Campana />
      <BotonTema />
      <MenuUsuario />
    </View>
  )
}

/** La barra de las pantallas de adentro: volver, el titulo y el tema. */
export function Barra({ titulo }: { titulo: string }) {
  const t = useTema()
  return (
    <View style={estilos.barra}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        accessibilityLabel="Volver"
        hitSlop={6}
        style={({ pressed }) => [estilos.control, { borderColor: t.gris200, backgroundColor: t.superficie, opacity: pressed ? 0.7 : 1 }]}
      >
        <Icono nombre="atras" size={17} color={t.suave} />
      </Pressable>
      <Text style={[estilos.barraTitulo, { color: t.tinta }]} numberOfLines={1}>
        {titulo}
      </Text>
      <BotonTema />
    </View>
  )
}

const estilos = StyleSheet.create({
  marcaTexto: { fontFamily: LETRA.tituloFuerte, fontSize: 20, letterSpacing: -0.4 },
  logo: { width: 104, height: 34 },
  controles: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  control: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  controlAncho: {
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  puntoVivo: { width: 6, height: 6, borderRadius: 3 },
  monedaTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14 },
  globo: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  globoTexto: { fontFamily: LETRA.textoFuerte, fontSize: 10 },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  avatarTexto: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  quien: { paddingHorizontal: 12, paddingBottom: 10 },
  quienNombre: { fontFamily: LETRA.titulo, fontSize: 18 },
  quienRol: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 2 },
  barra: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  barraTitulo: { flex: 1, fontFamily: LETRA.tituloFuerte, fontSize: 20, letterSpacing: -0.4 },
})
