import { useMemo, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { CONCEPTOS } from '../../../../frontend/src/lib/compras'
import { unidadDe } from '../../../../frontend/src/lib/inventario'
import { ALMACEN_DE, TIPOS_DE_COMPRA } from '../../../../frontend/src/lib/tiposArticulo'
import { miles } from '../../lib/formato'
import { LETRA, useTema } from '../../lib/tema'
import type { ConceptoGasto, Ingrediente, TipoArticulo } from '../../lib/tipos'
import { Hoja, OpcionHoja } from '../Hoja'
import Icono from '../Icono'
import { Buscador, llano, useDisposicion } from '../kit'
import { PuntoGasto, PuntoTipo } from './piezas'

/*
 * EL RENGLON DICE QUE ES: primero el tipo (o que no es mercancia) y despues
 * cual mercancia. Son los dos desplegables del renglon de la web
 * (CargarFactura.tsx `selectorTipo` y components/compras/ElegirMercancia.tsx),
 * aqui como campos que abren su lista desde abajo.
 */

/** El campo que abre una lista: lo elegido (o lo que falta) y la flecha. */
function Disparador({
  children,
  alTocar,
  etiqueta,
  tono,
}: {
  children: ReactNode
  alTocar: () => void
  etiqueta: string
  tono?: 'mal' | 'ojo'
}) {
  const t = useTema()
  const borde = tono === 'mal' ? t.peligro : tono === 'ojo' ? t.aviso : t.gris200
  return (
    <Pressable
      onPress={alTocar}
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      style={({ pressed }) => [m.campo, { backgroundColor: t.superficie, borderColor: borde, opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={m.campoDentro}>{children}</View>
      <View style={{ transform: [{ rotate: '90deg' }] }}>
        <Icono nombre="chevron" size={14} color={t.tenue} grosor={2.4} />
      </View>
    </Pressable>
  )
}

/**
 * "Que es": un tipo de mercancia (filtra la lista de mercancias) o algo que
 * no es mercancia (flete, servicio, equipo, otro gasto). Los mismos dos
 * grupos del `<select>` de la web.
 */
export function ElegirQueEs({
  valor,
  alElegir,
  tono,
}: {
  /** El tipo o el concepto elegido; '' si todavia nada. */
  valor: string
  alElegir: (v: string) => void
  tono?: 'mal' | 'ojo'
}) {
  const t = useTema()
  const [abierto, setAbierto] = useState(false)
  const tipo = TIPOS_DE_COMPRA.find((x) => x.valor === valor)
  const concepto = CONCEPTOS.find((c) => c.valor === valor)
  const elegir = (v: string) => {
    setAbierto(false)
    alElegir(v)
  }
  return (
    <>
      <Disparador alTocar={() => setAbierto(true)} etiqueta="Qué es" tono={tono}>
        {tipo ? (
          <>
            <PuntoTipo tipo={tipo.valor} />
            <Text style={[m.campoTexto, { color: t.tinta }]} numberOfLines={1}>
              {tipo.texto}
            </Text>
          </>
        ) : concepto ? (
          <>
            <PuntoGasto />
            <Text style={[m.campoTexto, { color: t.tinta }]} numberOfLines={1}>
              {concepto.texto}
            </Text>
          </>
        ) : (
          <Text style={[m.campoTexto, { color: t.tenue }]}>Qué es…</Text>
        )}
      </Disparador>
      <Hoja visible={abierto} alCerrar={() => setAbierto(false)} titulo="Qué es">
        <ScrollView style={{ maxHeight: 520 }}>
          <Text style={[m.grupo, { color: t.tenue }]}>Mercancía</Text>
          {TIPOS_DE_COMPRA.map((x) => (
            <OpcionHoja key={x.valor} texto={x.texto} detalle={x.ejemplo} marcada={x.valor === valor} alTocar={() => elegir(x.valor)} />
          ))}
          <Text style={[m.grupo, { color: t.tenue, marginTop: 8 }]}>No es mercancía</Text>
          {CONCEPTOS.map((c) => (
            <OpcionHoja key={c.valor} texto={c.texto} detalle={c.ayuda} marcada={c.valor === valor} alTocar={() => elegir(c.valor)} />
          ))}
        </ScrollView>
      </Hoja>
    </>
  )
}

/**
 * Elegir la mercancia de un renglon: se escribe y aparece. Escribiendo "har"
 * se encuentra la harina. Cada opcion dice que es (su punto de color) y
 * cuanto hay, para no confundir "Queso" en kg con "Queso" en unidad. Debajo
 * de la lista, FIJO y sin taparle nada a nadie, "Crear mercancia nueva".
 */
export function ElegirMercancia({
  ingredientes,
  valor,
  alElegir,
  alCrear,
  tono,
  sugerencia,
  placeholder,
  tipo,
  alConcepto,
}: {
  ingredientes: Ingrediente[]
  valor: number
  alElegir: (id: number) => void
  /** Con lo que se escribio en la busqueda, para empezar el nombre. */
  alCrear: (texto: string) => void
  tono?: 'mal' | 'ojo'
  /** Lo que dice el papel: para tenerlo a la vista mientras se busca. */
  sugerencia?: string
  placeholder?: string
  /** Solo las de este tipo (el renglon ya dijo que es). */
  tipo?: TipoArticulo
  /** Para un renglon de factura: marcarlo como flete, servicio, equipo u otro. */
  alConcepto?: (c: ConceptoGasto) => void
}) {
  const t = useTema()
  const { alto } = useDisposicion()
  const [abierto, setAbierto] = useState(false)
  const [texto, setTexto] = useState('')
  const elegida = ingredientes.find((i) => i.id === valor) ?? null

  const visibles = useMemo(() => {
    const q = llano(texto.trim())
    const activas = ingredientes.filter((i) => i.activo !== false && i.tipo !== 'preparacion' && (!tipo || i.tipo === tipo))
    if (!q) return activas.slice(0, 40)
    const palabras = q.split(/\s+/)
    return activas
      .map((i) => {
        const nombre = llano(i.nombre)
        const puntos = palabras.every((p) => nombre.includes(p)) ? (nombre.startsWith(q) ? 2 : 1) : 0
        return { i, puntos }
      })
      .filter((x) => x.puntos > 0)
      .sort((a, b) => b.puntos - a.puntos || a.i.nombre.localeCompare(b.i.nombre))
      .slice(0, 40)
      .map((x) => x.i)
  }, [texto, ingredientes, tipo])

  function abrir() {
    setTexto('')
    setAbierto(true)
  }

  return (
    <>
      <Disparador alTocar={abrir} etiqueta={elegida ? `Mercancía: ${elegida.nombre}` : 'Elegir la mercancía'} tono={tono}>
        {elegida ? (
          <>
            <PuntoTipo tipo={elegida.tipo} />
            <Text style={[m.campoTexto, { color: t.tinta, fontFamily: LETRA.textoFuerte }]} numberOfLines={1}>
              {elegida.nombre}
            </Text>
            <Text style={[m.unidad, { color: t.tenue }]}>· {elegida.unidad}</Text>
          </>
        ) : (
          <>
            <Icono nombre="buscar" size={15} color={t.tenue} />
            <Text style={[m.campoTexto, { color: t.tenue }]} numberOfLines={1}>
              {placeholder ?? '¿Qué mercancía es?'}
            </Text>
          </>
        )}
      </Disparador>
      <Hoja visible={abierto} alCerrar={() => setAbierto(false)} titulo={tipo ? ALMACEN_DE[tipo].texto : 'Mercancía'}>
        <View style={{ paddingHorizontal: 4, paddingBottom: 6, gap: 6 }}>
          {sugerencia ? (
            <Text style={[m.nota, { color: t.tenue, paddingHorizontal: 8 }]} numberOfLines={2}>
              El papel dice «{sugerencia}»
            </Text>
          ) : null}
          <Buscador valor={texto} alCambiar={setTexto} placeholder="Escribe para buscar" />
        </View>
        {/* La lista se desplaza por dentro; "Crear" va debajo, fijo. */}
        <ScrollView style={{ maxHeight: alto * 0.42 }} keyboardShouldPersistTaps="handled">
          {visibles.map((i) => (
            <Pressable
              key={i.id}
              onPress={() => {
                setAbierto(false)
                alElegir(i.id)
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: i.id === valor }}
              style={({ pressed }) => [m.opcion, { backgroundColor: pressed ? t.gris100 : 'transparent' }]}
            >
              <PuntoTipo tipo={i.tipo} />
              {/* El nombre es lo que se busca: se lleva el ancho y puede partir en dos lineas. */}
              <Text style={[m.opcionNombre, { color: t.tinta }]} numberOfLines={2}>
                {i.nombre}
              </Text>
              <Text style={[m.opcionHay, { color: t.tenue }]}>
                {i.tipo === 'desechable'
                  ? 'sin stock'
                  : `hay ${miles(Number(i.stock_actual || 0), Number(i.stock_actual || 0) % 1 ? 2 : 0)} ${unidadDe(Number(i.stock_actual || 0), i.unidad)}`}
              </Text>
              {i.id === valor ? <Icono nombre="ok" size={16} color={t.acento} grosor={2.2} /> : null}
            </Pressable>
          ))}
          {visibles.length === 0 ? (
            <Text style={[m.nota, { color: t.tenue, padding: 12 }]}>
              {tipo && !texto.trim() ? `Todavía no hay ${ALMACEN_DE[tipo].texto.toLowerCase()}.` : 'Ninguna se llama así.'}
            </Text>
          ) : null}
        </ScrollView>
        <View style={[m.fijo, { borderTopColor: t.gris200 }]}>
          <Pressable
            onPress={() => {
              setAbierto(false)
              alCrear(texto.trim())
            }}
            accessibilityRole="button"
            style={({ pressed }) => [m.crear, { backgroundColor: pressed ? t.gris100 : 'transparent' }]}
          >
            <Icono nombre="mas" size={16} color={t.acento} grosor={2.2} />
            <Text style={[m.crearTexto, { color: t.acento }]} numberOfLines={2}>
              Crear mercancía nueva{texto.trim() ? `: «${texto.trim()}»` : ''}
            </Text>
          </Pressable>
          {alConcepto ? (
            <View style={{ paddingHorizontal: 12, paddingTop: 6, gap: 8 }}>
              <Text style={[m.grupo, { color: t.tenue, paddingHorizontal: 0 }]}>No es mercancía</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {CONCEPTOS.map((c) => (
                  <Pressable
                    key={c.valor}
                    onPress={() => {
                      setAbierto(false)
                      alConcepto(c.valor)
                    }}
                    style={({ pressed }) => [m.concepto, { borderColor: t.gris200, backgroundColor: pressed ? t.gris100 : t.superficie }]}
                  >
                    <Text style={[m.conceptoTexto, { color: t.fuerte }]}>{c.texto}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      </Hoja>
    </>
  )
}

const m = StyleSheet.create({
  campo: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, minHeight: 50 },
  campoDentro: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  campoTexto: { flexShrink: 1, fontFamily: LETRA.texto, fontSize: 16 },
  unidad: { fontFamily: LETRA.texto, fontSize: 13.5 },
  grupo: { fontFamily: LETRA.textoFuerte, fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase', paddingHorizontal: 12, marginBottom: 2 },
  nota: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
  opcion: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11, borderRadius: 12, minHeight: 48 },
  opcionNombre: { flex: 1, fontFamily: LETRA.textoFuerte, fontSize: 15 },
  opcionHay: { fontFamily: LETRA.cifra, fontSize: 13 },
  fijo: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 4, paddingTop: 4 },
  crear: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, minHeight: 50, borderRadius: 12 },
  crearTexto: { flex: 1, fontFamily: LETRA.textoFuerte, fontSize: 15 },
  concepto: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 13, minHeight: 36, justifyContent: 'center' },
  conceptoTexto: { fontFamily: LETRA.textoFuerte, fontSize: 13.5 },
})
