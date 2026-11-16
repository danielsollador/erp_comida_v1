import { useEffect, useState, type ReactNode } from 'react'
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native'
import { LETRA, useTema } from '../lib/tema'
import Icono from './Icono'

/**
 * Piezas comunes de la IA, como `components/ia.tsx` de la web: el mismo sello,
 * el mismo "pensando" y el mismo texto con formato, para que lo que hace la IA
 * se reconozca de un vistazo en cualquier pantalla (el chat, el reporte con
 * palabras, cambiar precios).
 */

/** El sello redondo de la IA: la chispa sobre el lavado del acento. */
export function SelloIA({ tam = 32 }: { tam?: number }) {
  const t = useTema()
  return (
    <View style={[e.sello, { width: tam, height: tam, borderRadius: tam / 2, backgroundColor: t.acentoSuave }]}>
      <Icono nombre="chispa" size={Math.round(tam * 0.55)} color={t.acento} />
    </View>
  )
}

/**
 * "Pensando": tres puntos y una frase que cambia mientras se espera, para que
 * los 4-8 s de una consulta se lean como trabajo y no como cuelgue.
 */
export function Pensando({ frases }: { frases: string[] }) {
  const t = useTema()
  const [i, setI] = useState(0)
  const [punto, setPunto] = useState(0)
  useEffect(() => {
    const frase = setInterval(() => setI((x) => (x + 1) % Math.max(frases.length, 1)), 1800)
    const puntos = setInterval(() => setPunto((x) => (x + 1) % 3), 400)
    return () => {
      clearInterval(frase)
      clearInterval(puntos)
    }
  }, [frases.length])
  return (
    <View style={e.pensando} accessibilityLiveRegion="polite" accessibilityLabel={frases[i] ?? 'Pensando'}>
      <View style={e.puntos}>
        {[0, 1, 2].map((n) => (
          <View key={n} style={[e.punto, { backgroundColor: t.acento, opacity: n === punto ? 1 : 0.35 }]} />
        ))}
      </View>
      <Text style={[e.frase, { color: t.suave }]}>{frases[i] ?? 'Pensando…'}</Text>
    </View>
  )
}

/**
 * Lo que el modelo escribe: párrafos, **negrita** y listas con viñeta o
 * número. Nada más de Markdown (no hace falta y así no se rompe nada).
 */
export function TextoRico({ texto, color, estilo }: { texto: string; color?: string; estilo?: StyleProp<TextStyle> }) {
  const t = useTema()
  const tinta = color ?? t.tinta
  const bloques: ReactNode[] = []
  let lista: { tipo: 'ul' | 'ol'; items: string[] } | null = null
  let parrafo: string[] = []
  const cerrarParrafo = () => {
    if (parrafo.length) {
      bloques.push(
        <Text key={bloques.length} style={[e.parrafo, { color: tinta }, estilo]}>
          {enLinea(parrafo.join(' '), tinta)}
        </Text>,
      )
    }
    parrafo = []
  }
  const cerrarLista = () => {
    if (!lista) return
    const { tipo, items } = lista
    bloques.push(
      <View key={bloques.length} style={e.lista}>
        {items.map((item, i) => (
          <View key={i} style={e.item}>
            {tipo === 'ul' ? (
              <View style={[e.vineta, { backgroundColor: t.acento }]} />
            ) : (
              <Text style={[e.numero, { color: t.suave }]}>{i + 1}.</Text>
            )}
            <Text style={[e.parrafo, { color: tinta, flex: 1 }, estilo]}>{enLinea(item, tinta)}</Text>
          </View>
        ))}
      </View>,
    )
    lista = null
  }
  for (const linea of texto.split('\n')) {
    const l = linea.trim()
    const vineta = l.match(/^[-*•]\s+(.*)$/)
    const numero = l.match(/^\d+[.)]\s+(.*)$/)
    if (vineta || numero) {
      cerrarParrafo()
      const tipo = vineta ? 'ul' : 'ol'
      if (lista && lista.tipo !== tipo) cerrarLista()
      lista ??= { tipo, items: [] }
      lista.items.push((vineta ?? numero)![1])
    } else if (!l) {
      cerrarLista()
      cerrarParrafo()
    } else {
      cerrarLista()
      parrafo.push(l)
    }
  }
  cerrarLista()
  cerrarParrafo()
  return <View style={{ gap: 8 }}>{bloques}</View>
}

function enLinea(texto: string, tinta: string): ReactNode {
  return texto.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? (
      <Text key={i} style={{ fontFamily: LETRA.textoFuerte, color: tinta }}>
        {p.slice(2, -2)}
      </Text>
    ) : (
      p
    ),
  )
}

/** Las frases de espera según lo que se preguntó (las mismas de la web). */
export function frasesPara(pregunta: string): string[] {
  if (/ens[eé]ñ|c[oó]mo (se |hago|cargo|cambio|creo|pongo|registro)|paso a paso/i.test(pregunta))
    return ['Buscando los pasos…', 'Preparando la respuesta…']
  if (/b[uú]sca|factura|gasto|documento|venta n/i.test(pregunta)) return ['Buscando en tus documentos…', 'Revisando fechas y montos…']
  return ['Revisando tus números…', 'Comparando con días anteriores…', 'Armando la respuesta…']
}

const e = StyleSheet.create({
  sello: { alignItems: 'center', justifyContent: 'center' },
  pensando: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 28 },
  puntos: { flexDirection: 'row', gap: 4 },
  punto: { width: 6, height: 6, borderRadius: 3 },
  frase: { fontFamily: LETRA.texto, fontSize: 14 },
  parrafo: { fontFamily: LETRA.texto, fontSize: 15, lineHeight: 22 },
  lista: { gap: 4 },
  item: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  vineta: { width: 6, height: 6, borderRadius: 3, marginTop: 8 },
  numero: { fontFamily: LETRA.cifra, fontSize: 14, lineHeight: 22, minWidth: 18 },
})
