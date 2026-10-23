import { router, type Href } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { rutaDeDocumento, type DocumentoEncontrado } from '../../lib/api-ia'
import { useMoneda } from '../../lib/moneda'
import { LETRA, useModo, useTema } from '../../lib/tema'
import { frasesPara, Pensando, SelloIA, TextoRico } from '../ia'
import { ListaFicha, Renglon } from '../kit'
import { Nota, sombraLosa } from '../ui'
import type { Mensaje } from './conversacion'

/**
 * Las burbujas del chat: lo mio a la derecha en tinta llena; lo del
 * asistente con su sello y, debajo, que consulto y los documentos que
 * encontro. Mismas formas que la hoja de la web (components/Asistente.tsx).
 */

/** Lo que yo pregunte. */
export function BurbujaMia({ texto }: { texto: string }) {
  const t = useTema()
  return (
    <View style={{ alignItems: 'flex-end' }}>
      <View style={[e.mia, { backgroundColor: t.tinta }]}>
        <Text style={[e.miaTexto, { color: t.papel }]}>{texto}</Text>
      </View>
    </View>
  )
}

/** La respuesta (o el error) del asistente, con lo que trae debajo. */
export function BurbujaAsistente({ m, ultima, alReintentar }: { m: Mensaje; ultima: boolean; alReintentar: () => void }) {
  const t = useTema()
  const { modo } = useModo()
  return (
    <View style={e.fila}>
      <SelloIA tam={28} />
      <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
        {m.error ? (
          <View style={[e.burbuja, { backgroundColor: t.peligroSuave }]}>
            <Text style={[e.texto, { color: t.peligro }]}>{m.texto}</Text>
            {m.reintentar && ultima ? (
              <Pressable onPress={alReintentar} hitSlop={8} accessibilityRole="button" style={{ marginTop: 10, alignSelf: 'flex-start' }}>
                <Text style={[e.reintentar, { color: t.peligro }]}>Reintentar</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={[e.burbuja, { backgroundColor: t.superficie, borderColor: t.linea, boxShadow: sombraLosa(modo, t.sombra) }]}>
            <TextoRico texto={m.texto} />
          </View>
        )}
        {m.r?.consulto?.length ? <Text style={[e.consulto, { color: t.tenue }]}>Consultó: {m.r.consulto.join(', ')}</Text> : null}
        {m.r?.documentos?.length ? <Documentos docs={m.r.documentos} /> : null}
        {m.r?.guia?.length ? (
          <Nota style={{ color: t.suave }}>La guía paso a paso está en la versión web (vertigopro.tech).</Nota>
        ) : null}
      </View>
    </View>
  )
}

/** Mientras se espera la respuesta: el sello y las frases segun lo preguntado. */
export function BurbujaPensando({ pregunta }: { pregunta: string }) {
  const t = useTema()
  const { modo } = useModo()
  return (
    <View style={e.fila}>
      <SelloIA tam={28} />
      <View style={[e.burbuja, { backgroundColor: t.superficie, borderColor: t.linea, boxShadow: sombraLosa(modo, t.sombra) }]}>
        <Pensando frases={frasesPara(pregunta)} />
      </View>
    </View>
  )
}

const NOMBRE_DOC: Record<DocumentoEncontrado['tipo'], string> = { compra: 'Factura', venta: 'Venta', gasto: 'Gasto' }

/** dd/mm/aa, como lo muestra la web. */
function dia(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return a && m && d ? `${d}/${m}/${a.slice(2)}` : iso
}

/**
 * Lo que encontro "buscar documentos": una fila por documento. Se abre en la
 * pantalla de la app que le toca (`rutaDeDocumento`); si la app todavia no
 * la tiene, la fila se ve pero no lleva a ningun lado.
 */
function Documentos({ docs }: { docs: DocumentoEncontrado[] }) {
  const t = useTema()
  const { fmt } = useMoneda()
  return (
    <ListaFicha>
      {docs.map((d, i) => {
        const ruta = rutaDeDocumento(d)
        return (
          <Renglon
            key={`${d.tipo}-${d.id}`}
            titulo={d.titulo}
            detalle={[NOMBRE_DOC[d.tipo], dia(d.fecha), d.estado, d.detalle].filter(Boolean).join(' · ')}
            valor={fmt(d.monto_usd)}
            subvalor={ruta ? <Text style={[e.abrir, { color: t.acento }]}>Abrir</Text> : undefined}
            alTocar={ruta ? () => router.push(ruta as Href) : undefined}
            ultima={i === docs.length - 1}
          />
        )
      })}
    </ListaFicha>
  )
}

const e = StyleSheet.create({
  fila: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  // Las esquinas "continuas" son las de iOS; en los demas no cambian nada.
  mia: { maxWidth: '85%', borderRadius: 20, borderBottomRightRadius: 6, borderCurve: 'continuous', paddingHorizontal: 16, paddingVertical: 10 },
  miaTexto: { fontFamily: LETRA.texto, fontSize: 15, lineHeight: 21 },
  burbuja: { borderRadius: 20, borderTopLeftRadius: 6, borderCurve: 'continuous', paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: 'transparent' },
  texto: { fontFamily: LETRA.texto, fontSize: 15, lineHeight: 21 },
  reintentar: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  consulto: { fontFamily: LETRA.texto, fontSize: 12.5, paddingHorizontal: 4 },
  abrir: { fontFamily: LETRA.textoFuerte, fontSize: 12.5, marginTop: 2 },
})
