import { useMemo, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { unidadDe } from '../../../../frontend/src/lib/inventario'
import { LETRA, useTema } from '../../lib/tema'
import type { Disponibilidad, Ingrediente, Preparacion, TipoArticulo } from '../../lib/tipos'
import Icono from '../Icono'
import { Selector, useDisposicion } from '../kit'
import { fmtCant, unidadLarga } from './cuentas'
import { BotonChico, PuntoTipo } from './piezas'

// Con mas preparaciones que esto, el mapa completo se vuelve una maraña de
// lineas que se cruzan: se pide elegir una, y el mapa muestra solo la suya.
const MAXIMO_MAPA_COMPLETO = 6
// El mapa de tres columnas con curvas (el de la computadora) desde este
// ancho, como el `lg:` de la web: la tablet acostada. Mas angosto, el arbol.
const ANCHO_CURVAS = 1024
const FILA = 50
const ANCHO_LINEAS = 160
const ALTO_ROTULO = 26

type Uso = { nombre: string; unidad: string; tipo: TipoArticulo; preps: { p: Preparacion; cantidad: number; costo: number }[] }

/** Lo que se pierde al limpiar o cocinar ese crudo, segun su ficha (el pollo, el pernil). */
const pierdeAlCocinar = (ing?: Ingrediente) =>
  ing && ing.rendimiento_pct < 100 ? `pierde ${Math.round(100 - ing.rendimiento_pct)} % al limpiar o cocinar` : null

/** "hay 2 kg hecho", "podrías hacer 7 kg hoy" o "receta por kilo": lo que dice el renglon de una preparacion. */
function lecturaCorta(p: Preparacion, d?: Disponibilidad) {
  if (p.modo_produccion === 'producir') return `hay ${fmtCant(p.stock_actual)} ${unidadDe(p.stock_actual, p.unidad)} hecho`
  if (d?.potencial != null) return `podrías hacer ${fmtCant(d.potencial)} ${unidadDe(d.potencial, p.unidad)} hoy`
  return `receta por ${unidadLarga(p.unidad)}`
}

/**
 * EL MAPA: cada materia prima con las preparaciones que la llevan
 * (`Mapa` de la web). Pensado para MUCHAS preparaciones (Leider, 7-oct): la
 * elegida se queda elegida (un selector, como todo filtro del ERP) y el mapa
 * se enfoca en ella: su crudo, ella, y en cada crudo quienes mas lo usan. Lo
 * que comparten dos preparaciones va en ambar: compiten por ello.
 *
 * En el telefono (y la tablet parada) es el arbol de la web para pantalla
 * angosta; en la tablet acostada, las tres columnas con sus curvas.
 */
export default function Mapa({
  preps,
  ingredientes,
  disp,
  colorDe,
  seleccion,
  alSeleccionar,
  alEditar,
  dinero,
}: {
  preps: Preparacion[]
  ingredientes: Ingrediente[]
  disp: Disponibilidad[]
  colorDe: Map<number, string>
  seleccion: number | null
  alSeleccionar: (id: number | null) => void
  alEditar: (p: Preparacion) => void
  dinero: (n: number) => string
}) {
  const t = useTema()
  const { ancho, tablet } = useDisposicion()
  const ancha = ancho >= ANCHO_CURVAS
  const porId = useMemo(() => new Map(ingredientes.map((i) => [i.id, i])), [ingredientes])
  // Que preparaciones usan cada crudo.
  const usosDe = useMemo(() => {
    const m = new Map<number, Uso>()
    for (const p of preps)
      for (const l of p.lineas) {
        const u = m.get(l.ingrediente_id) ?? { nombre: l.nombre, unidad: l.unidad, tipo: l.tipo, preps: [] }
        u.preps.push({ p, cantidad: l.cantidad, costo: l.costo })
        m.set(l.ingrediente_id, u)
      }
    return m
  }, [preps])
  const elegida = seleccion !== null ? (preps.find((p) => p.id === seleccion) ?? null) : null

  const filtro = (
    <View style={{ flexDirection: 'row', marginBottom: 14 }}>
      <Selector
        etiqueta="Preparación"
        opciones={[
          { valor: '', texto: 'Todas' },
          ...preps.map((p) => ({ valor: String(p.id), texto: p.nombre, detalle: `receta por ${unidadLarga(p.unidad)}` })),
        ]}
        valor={seleccion === null ? '' : String(seleccion)}
        alCambiar={(v) => alSeleccionar(v === '' ? null : Number(v))}
      />
    </View>
  )

  // ── Una preparacion elegida: su crudo, y quien mas lo usa ──
  if (elegida) {
    const lineas = [...elegida.lineas].sort((a, b) => b.costo - a.costo)
    const d = disp.find((x) => x.preparacion_id === elegida.id)
    const color = colorDe.get(elegida.id) ?? t.tenue
    const pastilla = (l: (typeof lineas)[number]) => {
      const ing = porId.get(l.ingrediente_id)
      const otras = (usosDe.get(l.ingrediente_id)?.preps ?? []).filter((x) => x.p.id !== elegida.id)
      const pierde = pierdeAlCocinar(ing)
      return (
        <View style={[m.pastilla, { backgroundColor: otras.length > 0 ? t.avisoSuave : t.gris100 }]}>
          <View style={m.pastillaFila}>
            <PuntoTipo tipo={l.tipo} />
            <Text style={[m.pastillaNombre, { color: t.tinta }]} numberOfLines={1}>
              {l.nombre}
            </Text>
            <Text style={[m.pastillaCifra, { color: t.tinta }]}>
              {fmtCant(l.cantidad)} {unidadDe(l.cantidad, l.unidad)}
            </Text>
          </View>
          <View style={m.pastillaDetalle}>
            {ing ? (
              <Text style={[m.detalle, { color: t.suave }]}>
                hay {fmtCant(ing.stock_actual)} {unidadDe(ing.stock_actual, ing.unidad)}
              </Text>
            ) : null}
            {pierde ? <Text style={[m.detalle, { color: t.aviso }]}>{pierde}</Text> : null}
            {otras.length > 0 ? (
              <View style={m.tambien}>
                <Text style={[m.detalle, { color: t.aviso }]}>también en</Text>
                {otras.map((o) => (
                  <Pressable key={o.p.id} onPress={() => alSeleccionar(o.p.id)} hitSlop={8} style={m.tambienBoton} accessibilityRole="button">
                    <View style={[m.puntito, { backgroundColor: colorDe.get(o.p.id) }]} />
                    <Text style={[m.detalle, { color: t.aviso, fontFamily: LETRA.textoFuerte }]}>{o.p.nombre}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        </View>
      )
    }
    // Tocar la tarjeta la suelta (como en la web); el boton de la receta va
    // adentro y no la suelta.
    const tarjeta = (
      <Pressable
        onPress={() => alSeleccionar(null)}
        accessibilityLabel="Soltar"
        style={({ pressed }) => [m.elegida, { backgroundColor: t.fichaPrincipal, transform: [{ scale: pressed ? 0.99 : 1 }] }]}
      >
        <View style={[m.raya, { backgroundColor: color }]} />
        <View style={{ flex: 1, minWidth: 0, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <Text style={[m.elegidaNombre, { color: t.fichaPrincipalTinta }]}>{elegida.nombre}</Text>
            <Pressable onPress={() => alSeleccionar(null)} hitSlop={10} accessibilityLabel="Soltar la preparación" style={m.soltar}>
              <Icono nombre="quitar" size={14} color={t.fichaPrincipalTinta} />
            </Pressable>
          </View>
          <View>
            <Text style={[m.elegidaCifra, { color: t.fichaPrincipalTinta }]}>
              {elegida.modo_produccion === 'producir'
                ? `${fmtCant(elegida.stock_actual)} ${unidadDe(elegida.stock_actual, elegida.unidad)}`
                : d?.potencial != null
                  ? `${fmtCant(d.potencial)} ${unidadDe(d.potencial, elegida.unidad)}`
                  : '—'}
            </Text>
            <Text style={[m.elegidaNota, { color: t.fichaPrincipalTinta }]}>
              {elegida.modo_produccion === 'producir'
                ? 'hay hecho ahora mismo'
                : d?.limita
                  ? `podrías hacer hoy con el crudo que hay · lo que se acaba primero: ${d.limita}`
                  : 'podrías hacer hoy con el crudo que hay'}
            </Text>
            {/* El crudo compartido se reparte: los potenciales no se suman. */}
            {elegida.modo_produccion !== 'producir' && d?.reparto_pct != null && d.limita ? (
              <Text style={[m.elegidaNota, { color: t.fichaPrincipalTinta }]}>
                Le toca el {fmtCant(d.reparto_pct)} % del {d.limita.toLowerCase()}{' '}
                {d.reparto_segun === 'ventas' ? 'según lo vendido en 14 días' : 'en partes iguales'} con {d.comparte_con.join(', ')}.
                {d.potencial_solo != null ? ` Si fuera todo para este: ${fmtCant(d.potencial_solo)} ${unidadDe(d.potencial_solo, elegida.unidad)}.` : ''}
              </Text>
            ) : null}
          </View>
          <View style={m.cuesta}>
            <Text style={[m.elegidaNota, { color: t.fichaPrincipalTinta, marginTop: 0 }]}>
              Cada {unidadLarga(elegida.unidad)} ya preparado cuesta
            </Text>
            <Text style={[m.cuestaCifra, { color: t.fichaPrincipalTinta }]}>{dinero(elegida.costo_unitario)}</Text>
          </View>
          <View style={{ flexDirection: 'row' }}>
            <BotonChico texto="Ver la receta" icono="recetas" tono="claro" alTocar={() => alEditar(elegida)} />
          </View>
        </View>
      </Pressable>
    )

    if (ancha) {
      const alto = Math.max(lineas.length, 1) * FILA
      const yCentro = alto / 2
      return (
        <View>
          {filtro}
          <View style={m.tres}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Rotulo icono="paquete" texto="Lo que lleva una tanda" />
              {lineas.map((l) => (
                <View key={l.ingrediente_id} style={{ height: FILA, justifyContent: 'center' }}>
                  {pastilla(l)}
                </View>
              ))}
            </View>
            <Svg width={ANCHO_LINEAS} height={alto} style={{ marginTop: ALTO_ROTULO }}>
              {lineas.map((l, i) => {
                const y1 = i * FILA + FILA / 2
                const peso = elegida.costo_tanda > 0 ? l.costo / elegida.costo_tanda : 1 / lineas.length
                const c = ANCHO_LINEAS * 0.45
                return (
                  <Path
                    key={l.ingrediente_id}
                    d={`M0 ${y1} C ${c} ${y1}, ${ANCHO_LINEAS - c} ${yCentro}, ${ANCHO_LINEAS} ${yCentro}`}
                    fill="none"
                    stroke={color}
                    strokeWidth={Math.max(2, Math.min(14, 2 + peso * 14))}
                    strokeLinecap="round"
                    opacity={0.85}
                  />
                )
              })}
            </Svg>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Rotulo icono="cocina" texto="Lo que sale" />
              <View style={{ minHeight: alto, justifyContent: 'center' }}>{tarjeta}</View>
            </View>
          </View>
        </View>
      )
    }
    return (
      <View>
        {filtro}
        <Arbol color={color} filas={lineas.map((l) => ({ clave: l.ingrediente_id, contenido: pastilla(l) }))} final={tarjeta} />
      </View>
    )
  }

  // ── Muchas preparaciones sin elegir: cada crudo con quienes lo llevan ──
  if (preps.length > MAXIMO_MAPA_COMPLETO) {
    const crudos = [...usosDe.entries()]
      .map(([id, u]) => ({ id, ...u }))
      .sort((a, b) => b.preps.length - a.preps.length || a.nombre.localeCompare(b.nombre))
    return (
      <View>
        {filtro}
        <Text style={[m.nota, { color: t.suave, marginBottom: 6 }]}>
          Elige una preparación arriba para ver su crudo. Aquí, cada materia prima con las preparaciones que la llevan.
        </Text>
        {crudos.map((c, n) => {
          const ing = porId.get(c.id)
          return (
            <View
              key={c.id}
              style={[m.crudo, n < crudos.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 }]}
            >
              <View style={m.pastillaFila}>
                <PuntoTipo tipo={c.tipo} />
                <Text style={[m.pastillaNombre, { color: t.tinta }]} numberOfLines={1}>
                  {c.nombre}
                </Text>
                {c.preps.length > 1 ? <Text style={[m.comparten, { color: t.aviso }]}>la comparten {c.preps.length}</Text> : null}
              </View>
              {ing ? (
                <Text style={[m.detalle, { color: t.suave }]}>
                  hay {fmtCant(ing.stock_actual)} {unidadDe(ing.stock_actual, ing.unidad)}
                </Text>
              ) : null}
              <View style={m.chips}>
                {c.preps.map((x) => (
                  <Pressable
                    key={x.p.id}
                    onPress={() => alSeleccionar(x.p.id)}
                    accessibilityRole="button"
                    style={({ pressed }) => [m.chip, { borderColor: t.gris200, backgroundColor: pressed ? t.gris100 : t.superficie }]}
                  >
                    <View style={[m.puntito, { width: 8, height: 8, backgroundColor: colorDe.get(x.p.id) }]} />
                    <Text style={[m.chipTexto, { color: t.tinta }]}>{x.p.nombre}</Text>
                    <Text style={[m.chipTexto, { color: t.suave, fontFamily: LETRA.cifra }]}>
                      {fmtCant(x.cantidad)} {unidadDe(x.cantidad, c.unidad)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )
        })}
      </View>
    )
  }

  // ── Pocas preparaciones: el mapa completo ──
  const crudos = [...usosDe.entries()]
    .map(([id, u]) => ({ id, ...u, ing: porId.get(id) }))
    .sort((a, b) => b.preps.length - a.preps.length || a.nombre.localeCompare(b.nombre))

  if (ancha) {
    const filaDe = new Map(crudos.map((c, i) => [c.id, i]))
    const alto = Math.max(crudos.length, preps.length) * FILA
    const yDe = (i: number) => i * FILA + FILA / 2
    const lineas = preps.flatMap((p, j) =>
      p.lineas.map((l) => {
        const i = filaDe.get(l.ingrediente_id) ?? 0
        const peso = p.costo_tanda > 0 ? l.costo / p.costo_tanda : 1 / p.lineas.length
        return { clave: `${p.id}-${l.ingrediente_id}`, y1: yDe(i), y2: yDe(j), peso, color: colorDe.get(p.id) ?? t.tenue }
      }),
    )
    return (
      <View>
        {filtro}
        <View style={m.tres}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Rotulo icono="paquete" texto="Crudo" />
            {crudos.map((c) => {
              const pierde = pierdeAlCocinar(c.ing)
              return (
                <View key={c.id} style={{ height: FILA, justifyContent: 'center' }}>
                  <View style={[m.pastilla, { backgroundColor: c.preps.length > 1 ? t.avisoSuave : t.gris100 }]}>
                    <View style={m.pastillaFila}>
                      <PuntoTipo tipo={c.tipo} />
                      <Text style={[m.pastillaNombre, { color: t.tinta }]} numberOfLines={1}>
                        {c.nombre}
                      </Text>
                      {c.preps.length > 1 ? <Text style={[m.comparten, { color: t.aviso }]}>la comparten {c.preps.length}</Text> : null}
                    </View>
                    <Text style={[m.detalle, { color: t.suave, paddingLeft: 16 }]} numberOfLines={1}>
                      {c.ing ? `hay ${fmtCant(c.ing.stock_actual)} ${unidadDe(c.ing.stock_actual, c.ing.unidad)}` : '—'}
                      {pierde ? <Text style={{ color: t.aviso }}> · {pierde}</Text> : null}
                    </Text>
                  </View>
                </View>
              )
            })}
          </View>
          <Svg width={ANCHO_LINEAS} height={alto} style={{ marginTop: ALTO_ROTULO }}>
            {lineas.map((l) => {
              const c = ANCHO_LINEAS * 0.45
              return (
                <Path
                  key={l.clave}
                  d={`M0 ${l.y1} C ${c} ${l.y1}, ${ANCHO_LINEAS - c} ${l.y2}, ${ANCHO_LINEAS} ${l.y2}`}
                  fill="none"
                  stroke={l.color}
                  strokeWidth={Math.max(2, Math.min(12, 2 + l.peso * 12))}
                  strokeLinecap="round"
                  opacity={0.6}
                />
              )
            })}
          </Svg>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Rotulo icono="cocina" texto="Preparado" />
            {preps.map((p) => (
              <View key={p.id} style={{ height: FILA, justifyContent: 'center' }}>
                <Pressable
                  onPress={() => alSeleccionar(p.id)}
                  accessibilityRole="button"
                  style={({ pressed }) => [m.final, { backgroundColor: pressed ? t.gris200 : t.gris100 }]}
                >
                  <View style={[m.raya, { backgroundColor: colorDe.get(p.id), minHeight: 28 }]} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[m.finalNombre, { color: t.tinta }]} numberOfLines={1}>
                      {p.nombre}
                    </Text>
                    <Text style={[m.detalle, { color: t.suave }]} numberOfLines={1}>
                      {lecturaCorta(p, disp.find((x) => x.preparacion_id === p.id))}
                    </Text>
                  </View>
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      </View>
    )
  }

  // Telefono y tablet parada: un arbol por preparacion, su crudo arriba y
  // ella abajo (en la tablet, dos por fila, como `sm:grid-cols-2` de la web).
  return (
    <View>
      {filtro}
      <View style={[m.arboles, tablet && { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }]}>
        {preps.map((p) => {
          const d = disp.find((x) => x.preparacion_id === p.id)
          const color = colorDe.get(p.id) ?? t.tenue
          return (
            <View key={p.id} style={tablet ? { width: '48%' } : undefined}>
              <Arbol
                color={color}
                filas={[...p.lineas]
                  .sort((a, b) => b.costo - a.costo)
                  .map((l) => {
                    const compartida = (usosDe.get(l.ingrediente_id)?.preps.length ?? 0) > 1
                    return {
                      clave: l.ingrediente_id,
                      contenido: (
                        <View style={[m.pastilla, m.pastillaFila, { backgroundColor: compartida ? t.avisoSuave : t.gris100 }]}>
                          <PuntoTipo tipo={l.tipo} />
                          <Text style={[m.pastillaNombre, { color: t.tinta }]} numberOfLines={1}>
                            {l.nombre}
                          </Text>
                          <Text style={[m.pastillaCifra, { color: t.suave }]}>
                            {fmtCant(l.cantidad)} {unidadDe(l.cantidad, l.unidad)}
                          </Text>
                        </View>
                      ),
                    }
                  })}
                final={
                  <Pressable
                    onPress={() => alSeleccionar(p.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Ver ${p.nombre} en el mapa`}
                    style={({ pressed }) => [m.final, { backgroundColor: pressed ? t.gris200 : t.gris100 }]}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[m.finalNombre, { color: t.tinta }]} numberOfLines={1}>
                        {p.nombre}
                      </Text>
                      <Text style={[m.detalle, { color: t.suave }]} numberOfLines={1}>
                        {lecturaCorta(p, d)}
                      </Text>
                    </View>
                    <Text style={[m.flecha, { color: t.tenue }]}>›</Text>
                  </Pressable>
                }
              />
            </View>
          )
        })}
      </View>
    </View>
  )
}

/** El rotulo de una columna del mapa ancho ("Crudo", "Preparado"). */
function Rotulo({ icono, texto }: { icono: 'paquete' | 'cocina'; texto: string }) {
  const t = useTema()
  return (
    <View style={m.rotulo}>
      <Icono nombre={icono} size={12} color={t.tenue} />
      <Text style={[m.rotuloTexto, { color: t.tenue }]}>{texto}</Text>
    </View>
  )
}

/**
 * El flujo en pantalla angosta (`Arbol` de la web): el crudo arriba, una
 * linea del color de la preparacion que lo junta y, abajo, con su flecha, lo
 * que sale. Sin un SVG de alto fijo: cada renglon dibuja su tramo, asi
 * aguanta textos de dos lineas.
 */
function Arbol({ color, filas, final }: { color: string; filas: { clave: number; contenido: ReactNode }[]; final: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      {filas.map((f, i) => (
        <View key={f.clave} style={m.rama}>
          <View style={[m.riel, { backgroundColor: color, top: i === 0 ? '50%' : -6, bottom: -6 }]} />
          <View style={[m.tramo, { backgroundColor: color }]} />
          {f.contenido}
        </View>
      ))}
      <View style={m.rama}>
        {filas.length > 0 ? <View style={[m.riel, { backgroundColor: color, top: -6, bottom: '50%' }]} /> : null}
        <View style={m.flechaArbol}>
          <Svg width={19} height={14} viewBox="0 0 19 14">
            <Path d="M1.5 7H15M10.5 2.5 15.5 7l-5 4.5" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        </View>
        {final}
      </View>
    </View>
  )
}

const m = StyleSheet.create({
  pastilla: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 7 },
  pastillaFila: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pastillaNombre: { flex: 1, minWidth: 0, fontFamily: LETRA.textoFuerte, fontSize: 14 },
  pastillaCifra: { fontFamily: LETRA.cifra, fontSize: 13.5 },
  pastillaDetalle: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 2, marginTop: 3, paddingLeft: 16 },
  detalle: { fontFamily: LETRA.texto, fontSize: 13 },
  tambien: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  tambienBoton: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  puntito: { width: 6, height: 6, borderRadius: 4 },
  elegida: { flexDirection: 'row', gap: 12, borderRadius: 18, padding: 16 },
  raya: { width: 6, alignSelf: 'stretch', borderRadius: 3, minHeight: 36 },
  elegidaNombre: { flex: 1, fontFamily: LETRA.titulo, fontSize: 18, letterSpacing: -0.3 },
  soltar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', opacity: 0.7 },
  elegidaCifra: { fontFamily: LETRA.tituloFuerte, fontSize: 26, letterSpacing: -0.6 },
  // El blanco al 70 % de la web: la nota va un paso atras de la cifra.
  elegidaNota: { fontFamily: LETRA.texto, fontSize: 13, lineHeight: 18, marginTop: 4, opacity: 0.72 },
  cuesta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 5 },
  cuestaCifra: { fontFamily: LETRA.cifraFuerte, fontSize: 14 },
  tres: { flexDirection: 'row', alignItems: 'flex-start' },
  rotulo: { height: ALTO_ROTULO, flexDirection: 'row', alignItems: 'center', gap: 6 },
  rotuloTexto: { fontFamily: LETRA.textoFuerte, fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase' },
  nota: { fontFamily: LETRA.texto, fontSize: 13, lineHeight: 18 },
  crudo: { paddingVertical: 10, gap: 4 },
  comparten: { fontFamily: LETRA.textoFuerte, fontSize: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, minHeight: 36 },
  chipTexto: { fontFamily: LETRA.textoFuerte, fontSize: 13 },
  arboles: { rowGap: 20 },
  rama: { position: 'relative', paddingLeft: 28 },
  riel: { position: 'absolute', left: 9, width: 3, borderRadius: 2 },
  tramo: { position: 'absolute', left: 9, top: '50%', marginTop: -1.5, width: 19, height: 3, borderRadius: 2 },
  flechaArbol: { position: 'absolute', left: 9, top: '50%', marginTop: -7 },
  final: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9, minHeight: 50 },
  finalNombre: { fontFamily: LETRA.titulo, fontSize: 15.5 },
  flecha: { fontFamily: LETRA.texto, fontSize: 20 },
})
