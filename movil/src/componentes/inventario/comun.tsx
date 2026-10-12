import { router, type Href } from 'expo-router'
import { useEffect, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { cantidad as cantidadWeb, CHICA, unidadDe } from '../../../../frontend/src/lib/inventario'
import { ALMACEN_DE } from '../../../../frontend/src/lib/tiposArticulo'
import { aBase, convertirTexto, otraUnidad } from '../../../../frontend/src/lib/unidades'
import { ErrorApi } from '../../lib/api'
import { LETRA, useTema, type Paleta } from '../../lib/tema'
import type { TipoArticulo } from '../../lib/tipos'
import { usePalabras } from '../configuracion/Lenguaje'
import Icono from '../Icono'

/*
 * LO QUE COMPARTEN LAS PANTALLAS DE INVENTARIO: el color de cada almacen, la
 * casilla de una cantidad (kg ⇄ g), las palabras que cambian con el modo de
 * lenguaje, los enlaces de texto y las rutas. Lo que es de una sola pantalla
 * va en su archivo.
 */

export const cantidad = cantidadWeb
export { unidadDe }

/**
 * Lo poco en la unidad chica ("43 g" y no "0.043 kg"), como `legible` de la
 * web, pero con la unidad en plural cuando toca ("3 unidades").
 */
export function legible(n: number, unidad: string): string {
  const chica = CHICA[unidad]
  if (chica && Math.abs(n) < 1 && n !== 0) return `${Math.round(Math.abs(n) * chica.factor)} ${chica.nombre}`
  return `${cantidad(Math.abs(n))} ${unidadDe(Math.abs(n), unidad)}`
}

/** "10 kg", "1 unidad", "18 unidades". */
export const conUnidad = (n: number, unidad: string) => `${cantidad(n)} ${unidadDe(n, unidad)}`

// ── Rutas ───────────────────────────────────────────────────────────────────

/** La seccion de la ruta de cada almacen, como la web (pages/Inventario.tsx). */
export const RUTA_DE: Record<TipoArticulo, string> = {
  insumo: 'materia-prima',
  reventa: 'reventa',
  consumible: 'consumibles',
  desechable: 'desechables',
  preparacion: 'materia-prima',
}
export const TIPO_DE: Record<string, TipoArticulo> = {
  'materia-prima': 'insumo',
  reventa: 'reventa',
  consumibles: 'consumible',
  desechables: 'desechable',
}

/**
 * Ir a otra pantalla del inventario. Las rutas tipadas solo conocen las que
 * ya existen al revisar tipos; las de Preparaciones, Conteo y Control las hace
 * otra parte del equipo a la vez, por eso aqui va como texto.
 */
export function ir(ruta: string) {
  router.push(ruta as Href)
}

/** El error de una llamada dicho en palabras (ErrorApi ya trae el `detail` del servidor). */
export function mensaje(e: unknown, respaldo = 'Ocurrió un error'): string {
  return e instanceof Error && e.message ? e.message : respaldo
}

/** El 409 de "más de lo que hay": el servidor lo frena y se pregunta antes de anotarlo igual. */
export function esMasDeLoQueHay(e: unknown): e is ErrorApi {
  return e instanceof ErrorApi && e.estado === 409 && e.message.startsWith('Hay ')
}

/** El 409 de "Confirmar: ...": pasar a desechable con stock, archivar algo que va en recetas. */
export function pideConfirmar(e: unknown): e is ErrorApi {
  return e instanceof ErrorApi && e.estado === 409 && e.message.startsWith('Confirmar: ')
}

// ── El color de cada almacen ────────────────────────────────────────────────

/**
 * Un solo color por tipo, en todas partes, como en la web (lib/tiposArticulo:
 * cobre la materia prima, verde la reventa, gris el consumible, ambar el
 * desechable). Aqui sale de la paleta del tema, asi el oscuro sale solo.
 */
export function colorDe(tipo: TipoArticulo, t: Paleta): { punto: string; fondo: string; tinta: string } {
  switch (tipo) {
    case 'insumo':
      return { punto: t.acento, fondo: t.acentoSuave, tinta: t.acento }
    case 'reventa':
      return { punto: t.exito500, fondo: t.exitoSuave, tinta: t.exito }
    case 'consumible':
      return { punto: t.tenue, fondo: t.gris100, tinta: t.suave }
    case 'desechable':
      return { punto: t.aviso, fondo: t.avisoSuave, tinta: t.aviso }
    default:
      return { punto: t.acentoFuerte, fondo: t.acentoSuave, tinta: t.acentoFuerte }
  }
}

export function PuntoTipo({ tipo }: { tipo: TipoArticulo }) {
  const t = useTema()
  return <View style={[c.punto, { backgroundColor: colorDe(tipo, t).punto }]} />
}

/** El sello del almacen: su icono en un cuadrito de su color. */
export function SelloAlmacen({ tipo, tamano = 40 }: { tipo: TipoArticulo; tamano?: number }) {
  const t = useTema()
  const k = colorDe(tipo, t)
  return (
    <View style={[c.sello, { width: tamano, height: tamano, borderRadius: tamano * 0.32, backgroundColor: k.fondo }]}>
      <Icono nombre={ALMACEN_DE[tipo].icono} size={Math.round(tamano * 0.48)} color={k.tinta} />
    </View>
  )
}

// ── Las palabras que cambian con el modo de lenguaje ────────────────────────

/** Los titulos de la web (lib/palabras.ts) que tienen dos nombres. */
const TERMINOS = {
  stock: { tecnico: 'Stock', sencillo: 'Hay' },
  costo: { tecnico: 'Costo compra', sencillo: 'Costo promedio' },
  reponer: { tecnico: 'Costo última compra', sencillo: 'Costo última compra' },
  rendimiento: { tecnico: 'Rendimiento', sencillo: 'Aprovechable' },
}

export function usePalabra() {
  const { modo } = usePalabras()
  return (clave: keyof typeof TERMINOS) => TERMINOS[clave][modo]
}

// ── Enlace de texto ─────────────────────────────────────────────────────────

/** Un enlace de texto con area de toque de telefono ("Ver todo", "Mover a…"). */
export function Enlace({
  texto,
  alTocar,
  tono = 'acento',
  deshabilitado = false,
}: {
  texto: string
  alTocar: () => void
  tono?: 'acento' | 'neutro' | 'peligro' | 'tenue'
  deshabilitado?: boolean
}) {
  const t = useTema()
  const color = tono === 'acento' ? t.acento : tono === 'peligro' ? t.peligro : tono === 'tenue' ? t.suave : t.tinta
  return (
    <Pressable
      onPress={alTocar}
      disabled={deshabilitado}
      accessibilityRole="button"
      hitSlop={4}
      style={({ pressed }) => [c.enlace, { opacity: deshabilitado ? 0.4 : pressed ? 0.6 : 1 }]}
    >
      <Text style={[c.enlaceTexto, { color }]}>{texto}</Text>
    </Pressable>
  )
}

/** El rotulo chico de un bloque ("ANOTAR", "CÓMO TE LLEGA"). */
export function Rotulo({ children, derecha }: { children: ReactNode; derecha?: ReactNode }) {
  const t = useTema()
  return (
    <View style={c.rotuloFila}>
      <Text style={[c.rotulo, { color: t.tenue }]}>{children}</Text>
      {derecha}
    </View>
  )
}

// ── La casilla de una cantidad ──────────────────────────────────────────────

/**
 * La casilla de una cantidad con su unidad ADENTRO, pegada a la derecha:
 * "1 ......... kg ⇄". Un toque en "kg ⇄" y se escribe en gramos; otro y
 * vuelve a kilos (components/Cantidad.tsx de la web). Lo que no tiene otra
 * cara (unidad) lleva solo el rotulo, en el mismo sitio. Controlada: quien la
 * usa guarda el texto y la unidad en que se esta escribiendo.
 */
export function CasillaCantidad({
  rotulo,
  unidad,
  vista,
  alCambiarVista,
  texto,
  alCambiarTexto,
  ayuda,
  error,
  placeholder = '0',
  autoFocus = false,
}: {
  rotulo?: string
  /** La unidad en que se guarda la mercancia. */
  unidad: string
  /** En la que se esta escribiendo ahora. */
  vista: string
  alCambiarVista: (vista: string) => void
  texto: string
  alCambiarTexto: (texto: string) => void
  ayuda?: string
  error?: string
  placeholder?: string
  autoFocus?: boolean
}) {
  const t = useTema()
  const otra = otraUnidad(unidad)
  const siguiente = vista === unidad ? otra : unidad
  const numero = Number(texto.replace(',', '.'))
  return (
    <View style={{ gap: 6 }}>
      {rotulo ? <Text style={[c.rotuloCampo, { color: t.suave }]}>{rotulo}</Text> : null}
      <View style={[c.casilla, { backgroundColor: t.superficie, borderColor: error ? t.peligro : t.gris200 }]}>
        <TextInput
          value={texto}
          onChangeText={(v) => alCambiarTexto(v.replace(/[^\d.,]/g, ''))}
          keyboardType="decimal-pad"
          placeholder={placeholder}
          placeholderTextColor={t.tenue}
          autoFocus={autoFocus}
          selectTextOnFocus
          accessibilityLabel={rotulo ? (vista ? `${rotulo} (${vista})` : rotulo) : vista}
          style={[c.casillaTexto, { color: t.tinta }]}
        />
        {otra && siguiente ? (
          <Pressable
            onPress={() => alCambiarVista(siguiente)}
            accessibilityLabel={`Cambiar a ${siguiente}`}
            hitSlop={6}
            style={({ pressed }) => [c.cambiaUnidad, { backgroundColor: pressed ? t.gris200 : t.gris100 }]}
          >
            <Text style={[c.cambiaUnidadTexto, { color: t.fuerte }]}>{vista} ⇄</Text>
          </Pressable>
        ) : (
          <Text style={[c.unidadFija, { color: t.tenue }]}>
            {unidadDe(Number.isFinite(numero) && texto !== '' ? numero : 2, unidad)}
          </Text>
        )}
      </View>
      {error ? (
        <Text style={[c.nota, { color: t.peligro }]}>{error}</Text>
      ) : ayuda ? (
        <Text style={[c.nota, { color: t.tenue }]}>{ayuda}</Text>
      ) : null}
    </View>
  )
}

/**
 * La casilla con su rotulo que recibe y entrega el valor en la unidad de la
 * mercancia (`unidad`), aunque se escriba en la otra cara. Si la mercancia
 * cambia de unidad (se elige "lt" en vez de "kg"), vuelve a la nueva.
 */
export function CampoCantidad({
  rotulo,
  unidad,
  valor,
  alCambiar,
  ayuda,
  error,
  placeholder,
}: {
  rotulo: string
  unidad: string
  /** En `unidad`, como texto ('' = vacio). */
  valor: string
  alCambiar: (enUnidad: string) => void
  ayuda?: string
  error?: string
  placeholder?: string
}) {
  const [vista, setVista] = useState(unidad)
  const [texto, setTexto] = useState(valor)
  // Otra unidad de fondo (se cambio "Se mide en"): se vuelve a escribir en
  // ella, con el valor tal como estaba. Ajuste durante el render, no en un
  // efecto: asi no hay un cuadro con la unidad vieja.
  const [unidadVista, setUnidadVista] = useState(unidad)
  if (unidadVista !== unidad) {
    setUnidadVista(unidad)
    setVista(unidad)
    setTexto(valor)
  }
  return (
    <CasillaCantidad
      rotulo={rotulo}
      unidad={unidad}
      vista={vista}
      alCambiarVista={(nueva) => {
        setTexto((x) => convertirTexto(x, unidad, vista, nueva))
        setVista(nueva)
      }}
      texto={texto}
      alCambiarTexto={(x) => {
        setTexto(x)
        alCambiar(aBase(x, unidad, vista))
      }}
      ayuda={ayuda}
      error={error}
      placeholder={placeholder}
    />
  )
}

// ── Opciones en fila ────────────────────────────────────────────────────────

/** Pocas opciones a la vista, de un toque (la moneda, de donde salio la plata, la unidad). */
export function Opciones<T extends string>({
  rotulo,
  opciones,
  valor,
  alCambiar,
}: {
  rotulo?: string
  opciones: { valor: T; texto: string; detalle?: string }[]
  valor: T
  alCambiar: (v: T) => void
}) {
  const t = useTema()
  return (
    <View style={{ gap: 6 }}>
      {rotulo ? <Text style={[c.rotuloCampo, { color: t.suave }]}>{rotulo}</Text> : null}
      <View style={c.opciones}>
        {opciones.map((o) => {
          const esta = o.valor === valor
          return (
            <Pressable
              key={o.valor}
              onPress={() => alCambiar(o.valor)}
              accessibilityRole="radio"
              accessibilityState={{ checked: esta }}
              style={({ pressed }) => [
                c.opcion,
                {
                  backgroundColor: esta ? t.tinta : t.superficie,
                  borderColor: esta ? t.tinta : t.gris200,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                },
              ]}
            >
              <Text style={[c.opcionTexto, { color: esta ? t.papel : t.tinta }]}>{o.texto}</Text>
              {o.detalle ? (
                <Text style={[c.opcionDetalle, { color: esta ? t.papel : t.suave, opacity: esta ? 0.75 : 1 }]}>{o.detalle}</Text>
              ) : null}
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

/** La casilla con borde de la web (`<label>` + checkbox): No paga IVA, costo indirecto. */
export function Casilla({
  texto,
  detalle,
  marcada,
  alCambiar,
}: {
  texto: string
  detalle?: string
  marcada: boolean
  alCambiar: (v: boolean) => void
}) {
  const t = useTema()
  return (
    <Pressable
      onPress={() => alCambiar(!marcada)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: marcada }}
      style={({ pressed }) => [
        c.casillaMarca,
        { borderColor: marcada ? t.tinta : t.gris200, backgroundColor: marcada ? t.gris100 : 'transparent', opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <View style={[c.cuadro, { borderColor: marcada ? t.tinta : t.barra, backgroundColor: marcada ? t.tinta : 'transparent' }]}>
        {marcada ? <Icono nombre="ok" size={13} color={t.papel} grosor={2.6} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[c.marcaTexto, { color: t.tinta }]}>{texto}</Text>
        {detalle ? <Text style={[c.nota, { color: t.suave, marginTop: 2 }]}>{detalle}</Text> : null}
      </View>
    </Pressable>
  )
}

/** Un aviso que se va solo a los segundos, como los de la web despues de guardar. */
export function useAvisoPasajero(segundos = 4) {
  const [aviso, setAviso] = useState<{ texto: string; tono: 'exito' | 'peligro' | 'aviso' } | null>(null)
  useEffect(() => {
    if (!aviso || aviso.tono === 'peligro') return
    const id = setTimeout(() => setAviso(null), segundos * 1000)
    return () => clearTimeout(id)
  }, [aviso, segundos])
  return {
    aviso,
    bien: (texto: string) => setAviso({ texto, tono: 'exito' }),
    mal: (texto: string) => setAviso({ texto, tono: 'peligro' }),
    ojo: (texto: string) => setAviso({ texto, tono: 'aviso' }),
    quitar: () => setAviso(null),
  }
}

export const c = StyleSheet.create({
  punto: { width: 9, height: 9, borderRadius: 5 },
  sello: { alignItems: 'center', justifyContent: 'center' },
  enlace: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 2 },
  enlaceTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14.5 },
  rotuloFila: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 28 },
  rotulo: { fontFamily: LETRA.textoFuerte, fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase' },
  rotuloCampo: { fontFamily: LETRA.textoFuerte, fontSize: 13 },
  nota: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
  casilla: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingLeft: 15,
    paddingRight: 6,
    minHeight: 50,
    gap: 8,
  },
  casillaTexto: { flex: 1, fontFamily: LETRA.cifra, fontSize: 17, paddingVertical: 11 },
  cambiaUnidad: { minWidth: 58, minHeight: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  cambiaUnidadTexto: { fontFamily: LETRA.textoFuerte, fontSize: 13.5 },
  unidadFija: { fontFamily: LETRA.textoFuerte, fontSize: 14, paddingRight: 9 },
  opciones: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  opcion: { minHeight: 44, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9, justifyContent: 'center', flexGrow: 1 },
  opcionTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14.5 },
  opcionDetalle: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 1 },
  casillaMarca: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  cuadro: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  marcaTexto: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
})
