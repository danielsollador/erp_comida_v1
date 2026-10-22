import { Children, useMemo, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'
import { LETRA, useTema } from '../../lib/tema'
import type { Insight } from '../../lib/tipos'
import { Hoja } from '../Hoja'
import { useDisposicion } from '../kit'
import { Ficha } from '../ui'
import { usePalabra } from './cuentas'
import { explicar } from './glosario'
import { GraficoBarras, GraficoLineas, type LineaSobreBarras } from './Grafico'
import { colorSerie, usePaletaDatos } from './paleta'

/*
 * LO QUE COMPARTEN LAS SECCIONES DE REPORTES (y Tasa), como
 * pages/partes/reportes/comunes.tsx de la web: el mismo esqueleto en todas
 * --las cifras, las lecturas y despues bloques con nombre-- para que se lean
 * igual.
 */

/**
 * Un bloque con nombre: la pestaña dice DONDE estas (Ventas), el bloque dice
 * QUE estas mirando (Cuándo se vende).
 */
export function Bloque({ titulo, descripcion, children }: { titulo: string; descripcion?: string; children: ReactNode }) {
  const t = useTema()
  return (
    <View style={{ gap: 12, marginTop: 6 }}>
      <View style={{ paddingHorizontal: 2, gap: 2 }}>
        <Text style={[c.etiqueta, { color: t.suave }]}>{titulo}</Text>
        {descripcion ? <Text style={[c.nota, { color: t.tenue }]}>{descripcion}</Text> : null}
      </View>
      {children}
    </View>
  )
}

/** Una losa con su titulo, una linea de ayuda y, si hace falta, un ajuste (Pedidos / Ventas). */
export function Seccion({
  titulo,
  ayuda,
  accion,
  explica,
  children,
}: {
  titulo: string
  ayuda?: string
  accion?: ReactNode
  /** Clave del glosario: la "i" junto al titulo. */
  explica?: string
  children?: ReactNode
}) {
  const t = useTema()
  return (
    <Ficha>
      <View style={c.seccionCabeza}>
        <Text style={[c.seccionTitulo, { color: t.tinta }]}>{titulo}</Text>
        {explica ? <BotonAyuda clave={explica} titulo={titulo} /> : null}
      </View>
      {ayuda ? <Text style={[c.nota, { color: t.suave, marginTop: 3 }]}>{ayuda}</Text> : null}
      {accion ? <View style={{ marginTop: 10, alignSelf: 'flex-start' }}>{accion}</View> : null}
      {children ? <View style={{ marginTop: 14 }}>{children}</View> : null}
    </Ficha>
  )
}

/** Dos columnas en el telefono, cuatro en la tablet: la fila de cifras de arriba. */
export function Rejilla({ children, columnas }: { children: ReactNode; columnas?: number }) {
  const { tablet } = useDisposicion()
  const n = columnas ?? (tablet ? 4 : 2)
  const hijos = Children.toArray(children).filter(Boolean)
  const filas: ReactNode[][] = []
  hijos.forEach((h, i) => {
    if (i % n === 0) filas.push([])
    filas[filas.length - 1].push(h)
  })
  return (
    <View style={{ gap: 12 }}>
      {filas.map((f, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 12 }}>
          {f.map((h, k) => (
            <View key={k} style={{ flex: 1, minWidth: 0 }}>
              {h}
            </View>
          ))}
          {Array.from({ length: n - f.length }, (_, k) => (
            <View key={`v${k}`} style={{ flex: 1 }} />
          ))}
        </View>
      ))}
    </View>
  )
}

/** Dos losas lado a lado en la tablet (donde la web las pone en dos columnas); una sobre otra en el telefono. */
export function DosColumnas({ children }: { children: ReactNode }) {
  const { tablet } = useDisposicion()
  const hijos = Children.toArray(children).filter(Boolean)
  if (!tablet || hijos.length < 2) return <View style={{ gap: 12 }}>{hijos}</View>
  return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
      {hijos.map((h, i) => (
        <View key={i} style={{ flex: 1, minWidth: 0, gap: 12 }}>
          {h}
        </View>
      ))}
    </View>
  )
}

/**
 * Una cifra de las de arriba (`Kpi` de la web): el titulo con su "i", la
 * cifra en la letra de titulares, el cambio contra el periodo anterior y
 * una nota cuando el numero solo puede engañar.
 */
export function Cifra({
  titulo,
  valor,
  ayuda,
  destacado = false,
  tono,
  nota,
  delta,
}: {
  titulo: string
  valor: string
  /** Clave del glosario: la explicacion al tocar la "i". */
  ayuda?: string
  destacado?: boolean
  tono?: 'bueno' | 'malo'
  nota?: string
  delta?: ReactNode
}) {
  const t = useTema()
  const color = tono === 'malo' ? t.peligro : tono === 'bueno' ? t.exito : t.tinta
  return (
    <Ficha style={c.cifra}>
      <View style={c.cifraCabeza}>
        <Text style={[c.cifraTitulo, { color: t.suave }]} numberOfLines={3}>
          {titulo}
        </Text>
        {ayuda ? <BotonAyuda clave={ayuda} titulo={titulo} /> : null}
      </View>
      <Text style={[destacado ? c.cifraGrande : c.cifraMedia, { color }]} numberOfLines={1} adjustsFontSizeToFit>
        {valor}
      </Text>
      {delta ? <View style={{ marginTop: 6 }}>{delta}</View> : null}
      {nota ? <Text style={[c.cifraNota, { color: t.suave }]}>{nota}</Text> : null}
    </Ficha>
  )
}

/**
 * La "i" de una cifra: se toca y sube la explicacion (que es, de donde sale,
 * como se calcula, para que sirve). En la web es un globo; aqui, una hoja.
 */
export function BotonAyuda({ clave, titulo }: { clave: string; titulo: string }) {
  const t = useTema()
  const { otroNombre } = usePalabra()
  const [abierta, setAbierta] = useState(false)
  const explica = explicar(clave)
  if (!explica) return null
  const alias = otroNombre(clave === 'kpi.bajo_minimo_agotadas' ? 'kpi.bajo_minimo' : clave)
  return (
    <>
      <Pressable
        onPress={() => setAbierta(true)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={`Qué es «${titulo}»`}
        style={({ pressed }) => [c.ayuda, { backgroundColor: pressed ? t.gris100 : 'transparent' }]}
      >
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
          <Circle cx={12} cy={12} r={9} stroke={t.tenue} strokeWidth={1.8} />
          <Path d="M12 11v5.5M12 7.6v.01" stroke={t.tenue} strokeWidth={2.2} strokeLinecap="round" />
        </Svg>
      </Pressable>
      <Hoja visible={abierta} alCerrar={() => setAbierta(false)}>
        <View style={{ paddingHorizontal: 12, paddingBottom: 8, gap: 8 }}>
          <Text style={[c.seccionTitulo, { color: t.tinta }]}>{titulo}</Text>
          {alias ? <Text style={[c.texto, { color: t.acento, fontFamily: LETRA.textoFuerte }]}>{alias}</Text> : null}
          <Text style={[c.texto, { color: t.fuerte }]}>{explica.que}</Text>
          {explica.origen ? <Parte rotulo="De dónde sale">{explica.origen}</Parte> : null}
          {explica.calculo ? <Parte rotulo="Cómo se calcula">{explica.calculo}</Parte> : null}
          {explica.ejemplo ? <Parte rotulo="Para qué sirve">{explica.ejemplo}</Parte> : null}
        </View>
      </Hoja>
    </>
  )
}

function Parte({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  const t = useTema()
  return (
    <Text style={[c.nota, { color: t.suave }]}>
      <Text style={{ fontFamily: LETRA.textoFuerte, color: t.tenue }}>{rotulo}: </Text>
      {children}
    </Text>
  )
}

/**
 * Lo que el sistema lee en los numeros (`Lecturas` de la web): verde es "asi
 * esta bien", ambar "esto te cuesta plata", cobre es contexto.
 */
export function Lecturas({ items }: { items: Insight[] }) {
  const t = useTema()
  if (items.length === 0) return null
  return (
    <View style={{ gap: 8 }}>
      {items.map((l, i) => {
        const tono =
          l.tipo === 'bueno'
            ? { fondo: t.exitoSuave, tinta: t.exito, icono: '✓' }
            : l.tipo === 'alerta'
              ? { fondo: t.avisoSuave, tinta: t.avisoFuerte, icono: '!' }
              : { fondo: t.acentoSuave, tinta: t.acentoFuerte, icono: 'i' }
        return (
          <View key={i} style={[c.lectura, { backgroundColor: tono.fondo }]}>
            <View style={[c.lecturaIcono, { borderColor: tono.tinta }]}>
              <Text style={[c.lecturaIconoTexto, { color: tono.tinta }]}>{tono.icono}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[c.lecturaTitulo, { color: tono.tinta }]}>{l.titulo}</Text>
              <Text style={[c.nota, { color: tono.tinta, opacity: 0.85, marginTop: 2 }]}>{l.detalle}</Text>
            </View>
          </View>
        )
      })}
    </View>
  )
}

/**
 * El sitio de un grafico cuando no hay nada que dibujar: el grafico no
 * desaparece (Leider, 1-oct: "yo pense que era un error"), dice por que esta vacio.
 */
export function SinDatos({ que, alto = 160 }: { que: string; alto?: number }) {
  const t = useTema()
  return (
    <View style={[c.sinDatos, { minHeight: alto, borderColor: t.gris200 }]}>
      <Text style={[c.texto, { color: t.suave, textAlign: 'center' }]}>No hay {que} en el período elegido.</Text>
      <Text style={[c.nota, { color: t.tenue, textAlign: 'center', marginTop: 4 }]}>Aparece solo cuando las haya.</Text>
    </View>
  )
}

/** Una losa que dice que no hay nada, sin dejar el hueco. */
export function Vacio({ children }: { children: ReactNode }) {
  const t = useTema()
  return (
    <Ficha style={{ padding: 18 }}>
      <Text style={[c.texto, { color: t.suave }]}>{children}</Text>
    </Ficha>
  )
}

/** Un renglon de cuenta: nombre ... monto, con subtotal o total. */
export function Linea({
  etiqueta,
  monto,
  dinero,
  total = false,
}: {
  etiqueta: string
  monto: number
  dinero: (x: number) => string
  total?: boolean
}) {
  const t = useTema()
  return (
    <View style={[c.linea, total && { borderTopWidth: 1, borderTopColor: t.gris200, marginTop: 4, paddingTop: 10 }]}>
      <Text style={[total ? c.textoFuerte : c.texto, { color: monto < 0 ? t.suave : t.tinta, flex: 1 }]}>{etiqueta}</Text>
      <Text style={[total ? c.valorFuerte : c.valor, { color: total && monto < 0 ? t.peligro : monto < 0 ? t.suave : t.tinta }]}>
        {monto < 0 ? '-' : ''}
        {dinero(Math.abs(monto))}
      </Text>
    </View>
  )
}

/**
 * Las opciones cortas y fijas de un ajuste (Pedidos / Ventas, Auto / Día…):
 * el `Filtros tamano="chico"` de la web.
 */
export function Segmentado<T extends string>({
  opciones,
  activo,
  alElegir,
}: {
  opciones: { valor: T; texto: string }[]
  activo: T
  alElegir: (v: T) => void
}) {
  const t = useTema()
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={[c.segmentado, { backgroundColor: t.gris100, borderColor: t.gris200 }]}>
        {opciones.map((o) => {
          const esta = o.valor === activo
          return (
            <Pressable
              key={o.valor}
              onPress={() => alElegir(o.valor)}
              accessibilityState={{ selected: esta }}
              style={[c.segmento, esta && { backgroundColor: t.superficie }]}
            >
              <Text style={[c.segmentoTexto, { color: esta ? t.tinta : t.suave }]}>{o.texto}</Text>
            </Pressable>
          )
        })}
      </View>
    </ScrollView>
  )
}

/** Un enlace en el texto ("Cargar recetas"). */
export function Enlace({ texto, alTocar }: { texto: string; alTocar: () => void }) {
  const t = useTema()
  return (
    <Text onPress={alTocar} suppressHighlighting style={{ fontFamily: LETRA.textoFuerte, textDecorationLine: 'underline', color: t.tinta }}>
      {texto}
    </Text>
  )
}

/** Un punto de una serie en el tiempo, ya con lo que se dibuja de el. */
export type PuntoTiempo = { etiqueta: string; valor: number; detalle?: string }

// Hasta aqui, barras; de aqui en adelante, linea. Un mes por dias son 31
// barras y se leen; 90 dias ya son una tendencia.
const MAX_BARRAS = 31

/**
 * UNA serie en el tiempo dibujada como toca segun su largo (SerieTiempo de la
 * web): con pocos tramos, barras con el periodo anterior detras; con muchos,
 * la linea. La misma regla en Resumen, Ventas y Perdidas.
 */
export function SerieTiempo({
  puntos,
  anterior,
  nombres,
  formato,
  formatoDetalle,
  alto = 220,
  color,
  referencia,
  lineas,
  formatoDerecha,
  pie,
}: {
  puntos: PuntoTiempo[]
  anterior?: number[]
  nombres?: { actual: string; anterior: string }
  formato: (n: number) => string
  formatoDetalle?: (n: number) => string
  alto?: number
  color?: string
  referencia?: { valor: number; texto: string }
  lineas?: LineaSobreBarras[]
  formatoDerecha?: (n: number) => string
  pie?: string
}) {
  const p = usePaletaDatos()
  const colorSerie0 = color ?? p.serie[0]
  const conAnterior = anterior != null && anterior.length === puntos.length
  const etiquetas = useMemo(() => puntos.map((x) => x.etiqueta), [puntos])
  // El eje con centavos cuando la escala es chica: "$1 $1 $0" no dice nada.
  const mayor = Math.max(...puntos.map((x) => x.valor), ...(conAnterior ? anterior : [0]), 0)
  const formatoEje = mayor < 10 && formatoDetalle ? formatoDetalle : formato
  if (puntos.length === 0) return null
  if (puntos.length <= MAX_BARRAS) {
    return (
      <GraficoBarras
        alto={alto}
        ejeY
        formato={formatoDetalle ?? formato}
        formatoEje={formatoEje}
        datos={puntos.map((x) => ({ etiqueta: x.etiqueta, valor: x.valor, detalle: x.detalle, color: colorSerie0 }))}
        anterior={conAnterior ? anterior : undefined}
        nombres={nombres}
        referencia={referencia}
        lineas={lineas}
        formatoDerecha={formatoDerecha}
        pie={pie}
      />
    )
  }
  return (
    <GraficoLineas
      alto={alto}
      etiquetas={etiquetas}
      formato={formatoEje}
      formatoDetalle={formatoDetalle}
      formatoDerecha={formatoDerecha}
      series={[
        { nombre: nombres?.actual ?? 'Este período', color: colorSerie0, valores: puntos.map((x) => x.valor), relleno: true },
        ...(conAnterior ? [{ nombre: nombres?.anterior ?? 'Período anterior', color: p.referencia, valores: anterior, punteada: true }] : []),
        ...(lineas ?? []).map((l, k) => ({ nombre: l.nombre, color: l.color ?? colorSerie(p, k + 1), valores: l.valores, eje: 'der' as const })),
      ]}
      pie={pie}
    />
  )
}

export const c = StyleSheet.create({
  etiqueta: { fontFamily: LETRA.textoFuerte, fontSize: 11.5, letterSpacing: 1.2, textTransform: 'uppercase' },
  nota: { fontFamily: LETRA.texto, fontSize: 13, lineHeight: 18 },
  texto: { fontFamily: LETRA.texto, fontSize: 14.5, lineHeight: 20 },
  textoFuerte: { fontFamily: LETRA.textoFuerte, fontSize: 15.5 },
  valor: { fontFamily: LETRA.cifra, fontSize: 14.5 },
  valorFuerte: { fontFamily: LETRA.cifraFuerte, fontSize: 16 },
  seccionCabeza: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  seccionTitulo: { flex: 1, fontFamily: LETRA.titulo, fontSize: 16.5, letterSpacing: -0.2, lineHeight: 22 },
  cifra: { padding: 16, flex: 1 },
  cifraCabeza: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  cifraTitulo: { flex: 1, fontFamily: LETRA.textoFuerte, fontSize: 13, lineHeight: 17 },
  cifraGrande: { fontFamily: LETRA.tituloFuerte, fontSize: 26, letterSpacing: -0.6, marginTop: 6 },
  cifraMedia: { fontFamily: LETRA.tituloFuerte, fontSize: 22, letterSpacing: -0.4, marginTop: 6 },
  cifraNota: { fontFamily: LETRA.texto, fontSize: 13, lineHeight: 17, marginTop: 6 },
  ayuda: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', margin: -5 },
  lectura: { flexDirection: 'row', gap: 12, borderRadius: 16, borderCurve: 'continuous', padding: 14 },
  lecturaIcono: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  lecturaIconoTexto: { fontFamily: LETRA.textoFuerte, fontSize: 12 },
  lecturaTitulo: { fontFamily: LETRA.textoFuerte, fontSize: 14.5, lineHeight: 20 },
  sinDatos: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 14, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  linea: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  segmentado: { flexDirection: 'row', borderRadius: 999, padding: 3, borderWidth: 1, gap: 2 },
  segmento: { paddingHorizontal: 14, minHeight: 34, justifyContent: 'center', borderRadius: 999 },
  segmentoTexto: { fontFamily: LETRA.textoFuerte, fontSize: 13.5 },
})
