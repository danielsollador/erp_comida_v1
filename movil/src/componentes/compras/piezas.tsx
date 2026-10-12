import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native'
import { ALMACEN_DE, ALMACENES } from '../../../../frontend/src/lib/tiposArticulo'
import { LETRA, useTema, type Paleta } from '../../lib/tema'
import type { TipoArticulo } from '../../lib/tipos'
import Icono, { type NombreIcono } from '../Icono'
import { Nota, Titulo } from '../ui'

/*
 * LAS PIEZAS CHICAS DE COMPRAS: el punto de color de cada almacen, el sello,
 * la barra de "a donde va la plata", la marca de lo que leyo la IA, las
 * casillas con su tono (ambar = ojo, rojo = mal) y el selector de pastillas
 * de la web (`Filtros`). Las usan la carga, la lista y el detalle; si otro
 * modulo las necesita, conviene subirlas a componentes/ui.tsx o kit.tsx.
 */

// ── Los colores de los almacenes ────────────────────────────────────────────

/**
 * El color de cada tipo, el mismo de la web (lib/tiposArticulo.ts): cobre la
 * materia prima, verde la reventa, gris el consumible, ambar el desechable.
 * Un solo color por tipo en todo Compras: quien aprende que el cobre es
 * materia prima lo reconoce en la lista sin leer.
 */
export function colorTipo(t: Paleta, tipo: TipoArticulo): { punto: string; fondo: string; tinta: string } {
  switch (tipo) {
    case 'insumo':
      return { punto: t.acento, fondo: t.acentoSuave, tinta: t.acento }
    case 'reventa':
      return { punto: t.exito500, fondo: t.exitoSuave, tinta: t.exito }
    case 'consumible':
      return { punto: t.suave, fondo: t.gris100, tinta: t.suave }
    case 'desechable':
      return { punto: t.aviso, fondo: t.avisoSuave, tinta: t.aviso }
    default:
      return { punto: t.acentoFuerte, fondo: t.acentoSuave, tinta: t.acentoFuerte }
  }
}

/** El punto de color del tipo: lo minimo que cabe en una fila apretada. */
export function PuntoTipo({ tipo, tamano = 9 }: { tipo: TipoArticulo; tamano?: number }) {
  const t = useTema()
  return <View style={{ width: tamano, height: tamano, borderRadius: tamano / 2, backgroundColor: colorTipo(t, tipo).punto }} />
}

/** Lo que no es mercancia (flete, servicio): un aro sin relleno. */
export function PuntoGasto({ tamano = 9 }: { tamano?: number }) {
  const t = useTema()
  return <View style={{ width: tamano, height: tamano, borderRadius: tamano / 2, borderWidth: 1.5, borderColor: t.tenue }} />
}

/** La pastilla con el nombre del tipo. */
export function SelloTipo({ tipo }: { tipo: TipoArticulo }) {
  const t = useTema()
  const c = colorTipo(t, tipo)
  return (
    <View style={[p.sello, { backgroundColor: c.fondo }]}>
      <PuntoTipo tipo={tipo} tamano={7} />
      <Text style={[p.selloTexto, { color: c.tinta }]} numberOfLines={1}>
        {ALMACEN_DE[tipo].texto}
      </Text>
    </View>
  )
}

export type ParteDeLaPlata = { tipo: TipoArticulo; monto: number }

/**
 * A donde va la plata de una factura (o de un periodo): una barra partida por
 * tipo y, debajo, lo que entra al inventario y lo que se va a gasto. Es la
 * respuesta a la pregunta del dueño sin pasar por la contabilidad.
 */
export function DestinoPlata({
  partes,
  monto,
  titulo,
  pie,
}: {
  partes: ParteDeLaPlata[]
  /** Como se escribe un monto: `fmt` de la moneda, o la moneda del papel. */
  monto: (n: number) => string
  titulo?: string
  pie?: ReactNode
}) {
  const t = useTema()
  const total = partes.reduce((s, x) => s + x.monto, 0)
  const deposito = partes.filter((x) => ALMACEN_DE[x.tipo].destino === 'deposito').reduce((s, x) => s + x.monto, 0)
  const gasto = total - deposito
  const ordenadas = [...ALMACENES, ALMACEN_DE.preparacion]
    .map((a) => ({ a, monto: partes.filter((x) => x.tipo === a.valor).reduce((s, x) => s + x.monto, 0) }))
    .filter((x) => x.monto > 0)
  if (total <= 0) return null
  return (
    <View>
      {titulo ? <Text style={[p.etiqueta, { color: t.tenue, marginBottom: 8 }]}>{titulo}</Text> : null}
      <View style={[p.barra, { backgroundColor: t.gris100 }]}>
        {ordenadas.map(({ a, monto: m }) => (
          // Cada tramo crece en proporcion a su monto: la barra entera es el total.
          <View key={a.valor} style={{ flex: m / total, backgroundColor: colorTipo(t, a.valor).punto }} />
        ))}
      </View>
      <View style={p.leyenda}>
        {ordenadas.map(({ a, monto: m }) => (
          <View key={a.valor} style={p.leyendaFila}>
            <PuntoTipo tipo={a.valor} tamano={8} />
            <Text style={[p.chico, { color: t.suave }]}>{a.texto}</Text>
            <Text style={[p.chicoCifra, { color: t.tinta }]}>{monto(m)}</Text>
          </View>
        ))}
      </View>
      <Text style={[p.nota, { color: t.suave, marginTop: 8 }]}>
        Al inventario <Text style={[p.cifraFuerte, { color: t.tinta }]}>{monto(deposito)}</Text>
        {gasto > 0.004 ? (
          <>
            {' · a gasto '}
            <Text style={[p.cifraFuerte, { color: t.aviso }]}>{monto(gasto)}</Text>
          </>
        ) : null}
      </Text>
      {pie}
    </View>
  )
}

// ── Lo que leyo la IA ───────────────────────────────────────────────────────

/** "Lo leyo la IA": un icono con su palabra (en la tablet no hay cursor para un `title`). */
export function MarcaIA() {
  const t = useTema()
  return (
    <View style={[p.ia, { backgroundColor: t.acentoSuave }]} accessibilityLabel="Lo leyó la IA de la factura">
      <Icono nombre="chispa" size={11} color={t.acento} grosor={2} />
      <Text style={[p.iaTexto, { color: t.acento }]}>IA</Text>
    </View>
  )
}

// ── Cabecera de una losa ────────────────────────────────────────────────────

/** La cabecera de una losa, como `Seccion` en la web: titulo, accion a la derecha y su ayuda. */
export function Cabecera({ titulo, ayuda, accion }: { titulo: string; ayuda?: ReactNode; accion?: ReactNode }) {
  return (
    <View style={{ gap: 4, marginBottom: 12 }}>
      <View style={p.cabecera}>
        <Titulo style={{ flex: 1 }}>{titulo}</Titulo>
        {accion}
      </View>
      {ayuda ? typeof ayuda === 'string' ? <Nota>{ayuda}</Nota> : ayuda : null}
    </View>
  )
}

/**
 * El boton "fantasma" de la web: solo texto. Conserva 44 px de alto tocable
 * aunque se vea chico, para no errarle con el pulgar.
 */
export function BotonTexto({
  texto,
  alTocar,
  tono = 'acento',
  deshabilitado = false,
  icono,
}: {
  texto: string
  alTocar: () => void
  tono?: 'acento' | 'neutro' | 'peligro' | 'ojo'
  deshabilitado?: boolean
  icono?: NombreIcono
}) {
  const t = useTema()
  const color = tono === 'acento' ? t.acento : tono === 'peligro' ? t.peligro : tono === 'ojo' ? t.aviso : t.suave
  return (
    <Pressable
      onPress={alTocar}
      disabled={deshabilitado}
      accessibilityRole="button"
      accessibilityState={{ disabled: deshabilitado }}
      hitSlop={6}
      style={({ pressed }) => [p.botonTexto, { opacity: deshabilitado ? 0.45 : pressed ? 0.6 : 1 }]}
    >
      {icono ? <Icono nombre={icono} size={15} color={color} grosor={2} /> : null}
      <Text style={[p.botonTextoLetra, { color }]}>{texto}</Text>
    </Pressable>
  )
}

/** Una pastilla que se toca ("Esta vez vino suelta", "caja × 24"): el `vp-control` de la web. */
export function Chip({
  texto,
  alTocar,
  icono,
  activo = false,
}: {
  texto: string
  alTocar: () => void
  icono?: NombreIcono
  activo?: boolean
}) {
  const t = useTema()
  return (
    <Pressable
      onPress={alTocar}
      accessibilityRole="button"
      hitSlop={4}
      style={({ pressed }) => [
        p.chip,
        {
          backgroundColor: activo ? t.tinta : t.superficie,
          borderColor: activo ? t.tinta : t.gris200,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
      ]}
    >
      {icono ? <Icono nombre={icono} size={14} color={activo ? t.papel : t.suave} /> : null}
      <Text style={[p.chipTexto, { color: activo ? t.papel : t.fuerte }]}>{texto}</Text>
    </Pressable>
  )
}

/** Un aviso en una caja de color: `mal` (rojo), `ojo` (ambar) o `bien` (verde). */
export function NotaTono({ tono, children, style }: { tono: 'mal' | 'ojo' | 'bien'; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTema()
  const fondo = tono === 'mal' ? t.peligroSuave : tono === 'ojo' ? t.avisoSuave : t.exitoSuave
  const color = tono === 'mal' ? t.peligro : tono === 'ojo' ? t.aviso : t.exito
  return (
    <View style={[p.notaTono, { backgroundColor: fondo }, style]}>
      {typeof children === 'string' ? <Text style={[p.nota, { color }]}>{children}</Text> : children}
    </View>
  )
}

/** El color del texto de una nota con tono. */
export function colorDeTono(t: Paleta, tono?: 'mal' | 'ojo' | 'bien'): string {
  return tono === 'mal' ? t.peligro : tono === 'ojo' ? t.aviso : tono === 'bien' ? t.exito : t.tenue
}

/** Un dato del formulario: su rotulo, si lo leyo la IA, y lo que hay que saber de el. */
export function Dato({
  etiqueta,
  ia = false,
  tono,
  nota,
  children,
  style,
}: {
  etiqueta: string
  ia?: boolean
  tono?: 'mal' | 'ojo'
  nota?: ReactNode
  children: ReactNode
  style?: StyleProp<ViewStyle>
}) {
  const t = useTema()
  return (
    <View style={[{ gap: 6 }, style]}>
      {etiqueta || ia ? (
        <View style={p.datoCabeza}>
          {etiqueta ? <Text style={[p.rotulo, { color: t.suave }]}>{etiqueta}</Text> : null}
          {ia ? <MarcaIA /> : null}
        </View>
      ) : null}
      {children}
      {nota ? typeof nota === 'string' ? <Text style={[p.nota, { color: colorDeTono(t, tono) }]}>{nota}</Text> : nota : null}
    </View>
  )
}

/** El color del borde de una casilla segun su tono. */
function bordeDe(t: Paleta, tono?: 'mal' | 'ojo') {
  return tono === 'mal' ? t.peligro : tono === 'ojo' ? t.aviso : t.gris200
}

/**
 * Una casilla para cifras con su tono (ambar = algo que mirar, rojo = falta).
 * A la derecha, la unidad o la moneda; si `accion`, esa unidad se toca y
 * cambia (kg ⇄ g). El valor viaja como texto, con coma o punto.
 */
export function Casilla({
  valor,
  alCambiar,
  prefijo,
  sufijo,
  accion,
  tono,
  placeholder = '0',
  entero = false,
  editable = true,
  etiqueta,
  style,
  ...resto
}: {
  valor: string
  alCambiar: (texto: string) => void
  prefijo?: string
  sufijo?: string
  /** La unidad de la derecha se toca: "kg ⇄". */
  accion?: { texto: string; alTocar: () => void; etiqueta: string }
  tono?: 'mal' | 'ojo'
  placeholder?: string
  entero?: boolean
  editable?: boolean
  /** Lo que dice el lector de pantalla. */
  etiqueta?: string
  style?: StyleProp<ViewStyle>
} & Omit<TextInputProps, 'value' | 'onChangeText' | 'style' | 'editable'>) {
  const t = useTema()
  return (
    <View style={[p.casilla, { backgroundColor: t.superficie, borderColor: bordeDe(t, tono) }, !editable && { opacity: 0.6 }, style]}>
      {prefijo ? <Text style={[p.afijo, { color: t.tenue }]}>{prefijo}</Text> : null}
      <TextInput
        value={valor}
        onChangeText={(v) => alCambiar(entero ? v.replace(/[^\d]/g, '') : v.replace(/[^\d.,]/g, ''))}
        keyboardType={entero ? 'number-pad' : 'decimal-pad'}
        placeholder={placeholder}
        placeholderTextColor={t.tenue}
        selectTextOnFocus
        editable={editable}
        accessibilityLabel={etiqueta}
        {...resto}
        style={[p.casillaTexto, { color: t.tinta }]}
      />
      {accion ? (
        <Pressable
          onPress={accion.alTocar}
          accessibilityLabel={accion.etiqueta}
          hitSlop={8}
          style={({ pressed }) => [p.unidadBoton, { backgroundColor: pressed ? t.gris200 : t.gris100 }]}
        >
          <Text style={[p.unidadTexto, { color: t.fuerte }]}>{accion.texto}</Text>
        </Pressable>
      ) : sufijo ? (
        <Text style={[p.afijo, { color: t.tenue }]}>{sufijo}</Text>
      ) : null}
    </View>
  )
}

/** Un campo de texto con su tono, sin rotulo (lo pone `Dato`). */
export function CampoTexto({ tono, style, editable = true, ...props }: TextInputProps & { tono?: 'mal' | 'ojo' }) {
  const t = useTema()
  return (
    <TextInput
      placeholderTextColor={t.tenue}
      editable={editable}
      {...props}
      style={[
        p.campo,
        { backgroundColor: t.superficie, borderColor: bordeDe(t, tono), color: t.tinta },
        !editable && { opacity: 0.6 },
        style,
      ]}
    />
  )
}

/**
 * Elegir una entre pocas, a la vista (lo que en la web es `Filtros`): "Dólares
 * / Bolívares", las formas de pago. Las pastillas bajan de renglon si no
 * caben: nada de deslizar de lado para encontrar "Mixto".
 */
export function Opciones<T extends string>({
  opciones,
  valor,
  alCambiar,
  chico = false,
}: {
  opciones: { valor: T; texto: string; contador?: number | null }[]
  valor: T
  alCambiar: (v: T) => void
  chico?: boolean
}) {
  const t = useTema()
  return (
    <View style={[p.opciones, { backgroundColor: t.gris100, borderColor: t.gris200 }]}>
      {opciones.map((o) => {
        const esta = o.valor === valor
        return (
          <Pressable
            key={o.valor}
            onPress={() => alCambiar(o.valor)}
            accessibilityRole="button"
            accessibilityState={{ selected: esta }}
            style={[chico ? p.opcionChica : p.opcion, esta && [p.opcionElegida, { backgroundColor: t.superficie }]]}
          >
            <Text style={[p.opcionTexto, { color: esta ? t.tinta : t.suave, fontFamily: esta ? LETRA.textoFuerte : LETRA.texto }]}>
              {o.texto}
            </Text>
            {o.contador != null && o.contador > 0 ? (
              <View style={[p.contador, { backgroundColor: t.gris200 }]}>
                <Text style={[p.contadorTexto, { color: t.fuerte }]}>{o.contador}</Text>
              </View>
            ) : null}
          </Pressable>
        )
      })}
    </View>
  )
}

/** Lo que falta en un resumen plegado: en rojo, dentro de la misma linea. */
export function Falta({ children }: { children: ReactNode }) {
  const t = useTema()
  return <Text style={{ color: t.peligro }}>{children}</Text>
}

/** El error de una llamada, dicho en palabras (ErrorApi ya trae el `detail` del servidor). */
export function mensajeDe(e: unknown, siNo: string): string {
  return e instanceof Error && e.message ? e.message : siNo
}

export const p = StyleSheet.create({
  sello: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, alignSelf: 'flex-start' },
  selloTexto: { fontFamily: LETRA.textoFuerte, fontSize: 13 },
  etiqueta: { fontFamily: LETRA.textoFuerte, fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase' },
  barra: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden' },
  leyenda: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4, marginTop: 10 },
  leyendaFila: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chico: { fontFamily: LETRA.texto, fontSize: 13 },
  chicoCifra: { fontFamily: LETRA.cifraFuerte, fontSize: 13 },
  nota: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
  cifraFuerte: { fontFamily: LETRA.cifraFuerte, fontSize: 13.5 },
  ia: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  iaTexto: { fontFamily: LETRA.textoFuerte, fontSize: 12 },
  cabecera: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  botonTexto: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6 },
  botonTextoLetra: { fontFamily: LETRA.textoFuerte, fontSize: 14.5 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 38,
    borderRadius: 19,
    borderWidth: 1,
    paddingHorizontal: 13,
    alignSelf: 'flex-start',
  },
  chipTexto: { fontFamily: LETRA.textoFuerte, fontSize: 13.5 },
  notaTono: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
  datoCabeza: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  rotulo: { fontFamily: LETRA.textoFuerte, fontSize: 13 },
  casilla: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 14, paddingLeft: 14, paddingRight: 6, minHeight: 50, gap: 6 },
  casillaTexto: { flex: 1, minWidth: 0, fontFamily: LETRA.cifra, fontSize: 16.5, paddingVertical: 11 },
  afijo: { fontFamily: LETRA.textoFuerte, fontSize: 14, paddingRight: 8 },
  unidadBoton: { minHeight: 36, minWidth: 52, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  unidadTexto: { fontFamily: LETRA.textoFuerte, fontSize: 13 },
  campo: { fontFamily: LETRA.texto, fontSize: 16, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, minHeight: 50 },
  opciones: { flexDirection: 'row', flexWrap: 'wrap', alignSelf: 'flex-start', borderRadius: 22, borderWidth: 1, padding: 4, gap: 2 },
  opcion: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingHorizontal: 14, borderRadius: 19 },
  opcionChica: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 12, borderRadius: 18 },
  opcionElegida: { shadowColor: '#17181b', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  opcionTexto: { fontSize: 14 },
  contador: { borderRadius: 999, minWidth: 20, paddingHorizontal: 6, alignItems: 'center' },
  contadorTexto: { fontFamily: LETRA.textoFuerte, fontSize: 12 },
})
