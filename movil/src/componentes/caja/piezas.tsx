import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View, type DimensionValue } from 'react-native'
import { bolivares, dolares } from '../../lib/formato'
import { useMoneda } from '../../lib/moneda'
import { LETRA, useTema } from '../../lib/tema'
import { Titulo } from '../ui'

/*
 * Las piezas chicas de Cierre de caja: el recuadro de una cifra (`Tile` de la
 * web), el enlace de texto, el par Gasto / Retiro y la etiqueta de tipo del
 * historial. Solo las usa este modulo; si otro las necesita, conviene
 * subirlas a kit.tsx.
 */

/** El error de una llamada, dicho en palabras (ErrorApi ya trae el `detail` del servidor). */
export function mensajeDe(e: unknown, siNo: string): string {
  return e instanceof Error && e.message ? e.message : siNo
}

/**
 * EN LAS DOS MONEDAS. El precio vive en dolares, pero los billetes de la
 * gaveta y el lote del punto estan en bolivares: cuadrar obliga a mirar las
 * dos cifras, y hacer la cuenta de cabeza a la medianoche es como se cuelan
 * los errores (Caja.tsx de la web).
 *
 * La cifra principal sigue la moneda elegida arriba (`fmt`); la de abajo es
 * la OTRA: bolivares a la tasa BCV de hoy o, si los montos ya se estan
 * mirando en bolivares, los dolares. Repetir los bolivares dos veces no
 * ayuda a cuadrar nada.
 */
export function useDosMonedas() {
  const { fmt, vista, tasa } = useMoneda()
  const bcv = tasa?.bcv ?? null
  /** `tasaPropia`: la de un cobro ya hecho, que es lo que de verdad paso por el terminal. */
  const otra = (usd: number, tasaPropia?: number | null): string | null => {
    if (vista === 'bs') return dolares(usd)
    const tasaUsada = tasaPropia ?? bcv
    return tasaUsada ? bolivares(usd * tasaUsada) : null
  }
  return { fmt, bcv, otra }
}

// ── Cuadros (los `Tile` de la web) ──────────────────────────────────────────

export type DatosCuadro = {
  titulo: string
  valor: number
  detalle?: string
  fuerte?: boolean
  /** malo: salio plata o fallo algo; apagado: es cero (se escribe, pero sin peso). */
  tono?: 'neutro' | 'malo' | 'apagado'
}

/**
 * Las cifras del dia en recuadros, en `columnas` por fila (dos en el
 * telefono, cuatro en la tablet, como el `grid-cols-2 sm:grid-cols-4` de la
 * web). Si sobra uno, ocupa la fila entera.
 */
export function Cuadros({ cuadros, columnas }: { cuadros: DatosCuadro[]; columnas: number }) {
  const t = useTema()
  const { fmt } = useMoneda()
  const base = `${Math.floor(100 / columnas) - 6}%` as DimensionValue
  return (
    <View style={s.cuadros}>
      {cuadros.map((c) => {
        const color = c.tono === 'apagado' ? t.tenue : c.tono === 'malo' ? t.peligro : t.tinta
        return (
          <View key={c.titulo} style={[s.cuadro, { backgroundColor: t.gris100, flexBasis: base }]}>
            <Text style={[s.cuadroTitulo, { color: t.suave }]} numberOfLines={1}>
              {c.titulo}
            </Text>
            <Text style={[c.fuerte ? s.cuadroValorFuerte : s.cuadroValor, { color }]} numberOfLines={1} adjustsFontSizeToFit>
              {fmt(c.valor)}
            </Text>
            {c.detalle ? <Text style={[s.cuadroDetalle, { color: t.tenue }]}>{c.detalle}</Text> : null}
          </View>
        )
      })}
    </View>
  )
}

// ── Cabecera de una losa ────────────────────────────────────────────────────

/** El titulo de una losa con su rotulo chico al lado ("Gastos · 12 sep – 11 oct") y algo a la derecha. */
export function Cabecera({ titulo, detalle, derecha }: { titulo: string; detalle?: string; derecha?: ReactNode }) {
  const t = useTema()
  return (
    <View style={s.cabecera}>
      <Titulo style={{ flexShrink: 1 }}>
        {titulo}
        {detalle ? <Text style={[s.cabeceraDetalle, { color: t.tenue }]}> · {detalle}</Text> : null}
      </Titulo>
      {derecha}
    </View>
  )
}

// ── Enlace ──────────────────────────────────────────────────────────────────

/**
 * El boton de solo texto de la web ("Registrar uno", "Volver a hoy"). Se ve
 * chico, pero conserva 44 px de alto tocable para no errarle con el pulgar.
 */
export function Enlace({
  texto,
  alTocar,
  tono = 'acento',
  deshabilitado = false,
}: {
  texto: string
  alTocar: () => void
  tono?: 'acento' | 'neutro' | 'peligro'
  deshabilitado?: boolean
}) {
  const t = useTema()
  const color = tono === 'acento' ? t.acento : tono === 'peligro' ? t.peligro : t.suave
  return (
    <Pressable
      onPress={alTocar}
      disabled={deshabilitado}
      accessibilityRole="button"
      hitSlop={6}
      style={({ pressed }) => [s.enlace, { opacity: deshabilitado ? 0.45 : pressed ? 0.6 : 1 }]}
    >
      <Text style={[s.enlaceTexto, { color }]}>{texto}</Text>
    </Pressable>
  )
}

// ── Segmentado ──────────────────────────────────────────────────────────────

/** Elegir entre dos o tres cosas con un toque ("Gasto" / "Retiro del dueño"). */
export function Segmentado<T extends string>({
  opciones,
  valor,
  alCambiar,
}: {
  opciones: { id: T; texto: string }[]
  valor: T
  alCambiar: (id: T) => void
}) {
  const t = useTema()
  return (
    <View style={s.segmentado}>
      {opciones.map((o) => {
        const activa = o.id === valor
        return (
          <Pressable
            key={o.id}
            onPress={() => alCambiar(o.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: activa }}
            style={({ pressed }) => [
              s.segmento,
              activa
                ? { backgroundColor: t.tinta, borderColor: t.tinta }
                : { backgroundColor: t.superficie, borderColor: t.gris200 },
              { transform: [{ scale: pressed ? 0.98 : 1 }] },
            ]}
          >
            <Text style={[s.segmentoTexto, { color: activa ? t.papel : t.suave }]}>{o.texto}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

// ── Tipo (historial) ────────────────────────────────────────────────────────

export type TipoMovimiento = 'cierre' | 'gasto' | 'retiro'

export const NOMBRE_TIPO: Record<TipoMovimiento, string> = { cierre: 'Cierre', gasto: 'Gasto', retiro: 'Retiro' }

/** El tipo de una fila del historial, por el color y la palabra: cierre en tinta, gasto en rojo, retiro en ambar. */
export function Tipo({ tipo }: { tipo: TipoMovimiento }) {
  const t = useTema()
  const fondo = tipo === 'cierre' ? t.tinta : tipo === 'gasto' ? t.peligroSuave : t.avisoSuave
  const color = tipo === 'cierre' ? t.papel : tipo === 'gasto' ? t.peligro : t.aviso
  return (
    <View style={[s.tipo, { backgroundColor: fondo }]}>
      <Text style={[s.tipoTexto, { color }]}>{NOMBRE_TIPO[tipo]}</Text>
    </View>
  )
}

/** Una pastilla de filtro que se enciende al elegirla ("Todo (12)", "Gastos (4)"). */
export function Chip({ texto, activo, alTocar }: { texto: string; activo: boolean; alTocar: () => void }) {
  const t = useTema()
  return (
    <Pressable
      onPress={alTocar}
      accessibilityRole="button"
      accessibilityState={{ selected: activo }}
      hitSlop={4}
      style={({ pressed }) => [
        s.chip,
        activo ? { backgroundColor: t.tinta, borderColor: t.tinta } : { backgroundColor: t.superficie, borderColor: t.gris200 },
        { transform: [{ scale: pressed ? 0.97 : 1 }] },
      ]}
    >
      <Text style={[s.chipTexto, { color: activo ? t.papel : t.suave }]}>{texto}</Text>
    </Pressable>
  )
}

export const s = StyleSheet.create({
  cuadros: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cuadro: { flexGrow: 1, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 11 },
  cuadroTitulo: { fontFamily: LETRA.textoFuerte, fontSize: 13 },
  cuadroValor: { fontFamily: LETRA.tituloFuerte, fontSize: 20, letterSpacing: -0.4, marginTop: 3 },
  cuadroValorFuerte: { fontFamily: LETRA.tituloFuerte, fontSize: 23, letterSpacing: -0.5, marginTop: 3 },
  cuadroDetalle: { fontFamily: LETRA.texto, fontSize: 13, lineHeight: 17, marginTop: 2 },
  cabecera: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  cabeceraDetalle: { fontFamily: LETRA.texto, fontSize: 14, letterSpacing: 0 },
  enlace: { minHeight: 44, justifyContent: 'center' },
  enlaceTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14.5 },
  segmentado: { flexDirection: 'row', gap: 8 },
  segmento: { flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  segmentoTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14.5 },
  tipo: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  tipoTexto: { fontFamily: LETRA.textoFuerte, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' },
  chip: { height: 40, borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, justifyContent: 'center' },
  chipTexto: { fontFamily: LETRA.textoFuerte, fontSize: 13.5 },
})
