import * as DocumentPicker from 'expo-document-picker'
import { Image } from 'expo-image'
import * as ImagePicker from 'expo-image-picker'
import { useEffect, useState } from 'react'
import { Image as ImagenRN, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { apiCompras } from '../../lib/api-compras'
import {
  abrirPdf,
  armarPdf,
  bytesDe,
  esJpeg,
  guardarPdf,
  MAX_PAGINAS,
  MENSAJES_LECTURA,
  MENSAJES_TARDE,
  MS_POR_MENSAJE,
  problemasDeFoto,
  TAMANO_MAXIMO,
  TAU_BARRA_MS,
  TEXTO_PROBLEMA,
  type Problema,
} from '../../lib/compras-app'
import { pedirConsentimiento, PROVEEDOR_IA } from '../../lib/consentimiento-ia'
import { confirmar } from '../../lib/dialogo'
import { Ancla } from '../../lib/guia'
import { LETRA, useTema } from '../../lib/tema'
import type { LecturaFactura } from '../../lib/tipos'
import Icono from '../Icono'
import { Boton, Ficha } from '../ui'
import { BotonTexto, mensajeDe, NotaTono } from './piezas'

/*
 * LA FACTURA DESDE FOTO, lo que mas brilla en el telefono
 * (components/compras/Documento.tsx de la web). La camara trasera directo,
 * la galeria (varias hojas de la misma factura) o un PDF que llego por
 * correo o WhatsApp. Lo lee el MISMO lector de la web (POST /compras/lectura)
 * y el formulario se prellena; nada se guarda hasta que alguien lo revisa.
 *
 * Varias fotos se unen en un PDF de una pagina por foto (`armarPdf`, la
 * misma cuenta de la web): para el resto del sistema es un PDF como
 * cualquier otro. La web achica cada foto en un lienzo; el telefono no tiene
 * lienzo, asi que la foto sale ya comprimida de la camara (calidad 0,7).
 */

/** Lo que salio de la lectura y donde quedo el documento, para verlo al lado. */
export type DocumentoLeido = { uri: string; esPdf: boolean; ancho?: number; alto?: number }

type Pagina = { uri: string; ancho: number; alto: number; tipo: string; tamano: number; problemas: Problema[] }

const CALIDAD = 0.7

export function ZonaDocumento({ onLeida }: { onLeida: (l: LecturaFactura, doc: DocumentoLeido) => void }) {
  const t = useTema()
  const [activo, setActivo] = useState(false)
  const [leyendo, setLeyendo] = useState(false)
  const [terminando, setTerminando] = useState(false)
  const [error, setError] = useState('')
  const [paginas, setPaginas] = useState<Pagina[]>([])

  useEffect(() => {
    apiCompras
      .estadoLector()
      .then((e) => setActivo(e.activo))
      .catch(() => setActivo(false))
  }, [])

  function recibir(assets: ImagePicker.ImagePickerAsset[]) {
    if (assets.length === 0) return
    setError('')
    if (paginas.length + assets.length > MAX_PAGINAS) return setError(`Hasta ${MAX_PAGINAS} fotos por factura.`)
    setPaginas((prev) => [
      ...prev,
      ...assets.map((a) => ({
        uri: a.uri,
        ancho: a.width,
        alto: a.height,
        tipo: a.mimeType ?? 'image/jpeg',
        tamano: a.fileSize ?? 0,
        problemas: problemasDeFoto(a.width, a.height),
      })),
    ])
  }

  async function camara() {
    if (leyendo) return
    setError('')
    try {
      const permiso = await ImagePicker.requestCameraPermissionsAsync()
      if (!permiso.granted) return setError('Sin permiso para usar la cámara: dalo en los ajustes del teléfono, o elige la foto de la galería.')
      const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: CALIDAD })
      if (!r.canceled) recibir(r.assets)
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo abrir la cámara.'))
    }
  }

  async function galeria() {
    if (leyendo) return
    setError('')
    try {
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: CALIDAD,
        allowsMultipleSelection: true,
        orderedSelection: true,
        selectionLimit: Math.max(1, MAX_PAGINAS - paginas.length),
      })
      if (!r.canceled) recibir(r.assets)
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo abrir la galería.'))
    }
  }

  async function pdf() {
    if (leyendo) return
    setError('')
    // Un PDF ya es el documento entero: no se mezcla con fotos.
    if (paginas.length > 0) return setError('Un PDF se carga solo, sin fotos al lado.')
    try {
      const r = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true })
      if (r.canceled || !r.assets[0]) return
      const a = r.assets[0]
      if ((a.size ?? 0) > TAMANO_MAXIMO) return setError('El archivo pesa demasiado (máximo 8 MB).')
      await leer({ uri: a.uri, nombre: a.name || 'factura.pdf', tipo: 'application/pdf' }, { uri: a.uri, esPdf: true })
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo abrir el PDF.'))
    }
  }

  async function leer(archivo: { uri: string; nombre: string; tipo: string }, doc: DocumentoLeido) {
    // Nada sale del telefono sin que la persona sepa a donde va (Apple 5.1.2(i)).
    if (!(await pedirConsentimiento())) return
    setLeyendo(true)
    try {
      const lectura = await apiCompras.leerFactura(archivo)
      // La barra llega al final antes de cambiar de pantalla: que se vea que
      // termino, no que se corto.
      setTerminando(true)
      await new Promise((r) => setTimeout(r, 350))
      setPaginas([])
      onLeida(lectura, doc)
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo leer el archivo'))
    } finally {
      setLeyendo(false)
      setTerminando(false)
    }
  }

  async function leerFotos() {
    if (paginas.length === 0 || leyendo) return
    setError('')
    // Una foto se sube sola; varias se unen en un PDF de una pagina por foto.
    if (paginas.length === 1) {
      const p = paginas[0]
      if (p.tamano > TAMANO_MAXIMO) return setError('La foto pesa demasiado (máximo 8 MB): tómala de nuevo.')
      const ext = p.tipo === 'image/png' ? 'png' : p.tipo === 'image/webp' ? 'webp' : 'jpg'
      return leer({ uri: p.uri, nombre: `factura.${ext}`, tipo: p.tipo }, { uri: p.uri, esPdf: false, ancho: p.ancho, alto: p.alto })
    }
    setLeyendo(true)
    let pdfUri = ''
    try {
      const fotos = []
      for (const [i, p] of paginas.entries()) {
        const jpeg = await bytesDe(p.uri)
        if (!esJpeg(jpeg)) throw new Error(`La foto ${i + 1} no es JPG: tómala con la cámara, o léela sola.`)
        fotos.push({ jpeg, ancho: p.ancho, alto: p.alto })
      }
      const bytes = armarPdf(fotos)
      if (bytes.length > TAMANO_MAXIMO) throw new Error('Las fotos juntas pesan más de 8 MB: quita alguna o léelas en dos facturas.')
      pdfUri = guardarPdf(bytes)
    } catch (e) {
      setLeyendo(false)
      return setError(mensajeDe(e, 'No se pudieron juntar las fotos.'))
    }
    await leer({ uri: pdfUri, nombre: 'factura.pdf', tipo: 'application/pdf' }, { uri: pdfUri, esPdf: true })
  }

  // Antes de leer: si alguna foto salio mal, se dice cual y por que. Repetirla
  // cuesta un toque; leerla mal cuesta una lectura y llenar a mano.
  async function leerRevisadas() {
    const malas = paginas.map((p, i) => ({ i, problemas: p.problemas })).filter((p) => p.problemas.length > 0)
    if (malas.length > 0) {
      const sola = paginas.length === 1
      const lineas = malas.map((m) => `${sola ? 'La foto' : `La foto ${m.i + 1}`} ${m.problemas.map((x) => TEXTO_PROBLEMA[x]).join(' y ')}.`)
      const seguir = await confirmar({
        titulo: sola ? 'Esta foto puede leerse mal' : 'Hay fotos que pueden leerse mal',
        texto: `${lineas.join(' ')} La IA puede equivocarse o no leer nada. Si puedes, tómala de nuevo con buena luz y el teléfono quieto.`,
        aceptar: 'Leer igual',
        cancelar: 'Volver',
      })
      if (!seguir) return
    }
    await leerFotos()
  }

  // Sin lector activado no se ofrece: mejor que no aparezca a que falle.
  if (!activo) return null
  const conProblemas = paginas.filter((p) => p.problemas.length > 0).length

  return (
    <View style={[z.zona, { borderColor: t.gris200, backgroundColor: t.superficie }]}>
      {leyendo ? (
        <EsperaLectura terminando={terminando} />
      ) : paginas.length > 0 ? (
        <View style={{ gap: 12, alignItems: 'center' }}>
          <Text style={[z.titulo, { color: t.tinta }]}>
            {paginas.length === 1 ? '1 foto' : `${paginas.length} fotos`} de la misma factura
          </Text>
          <View style={z.miniaturas}>
            {paginas.map((p, i) => {
              const mala = p.problemas.length > 0
              return (
                <View key={p.uri} style={z.miniatura}>
                  <Image source={{ uri: p.uri }} style={[z.foto, { borderColor: mala ? t.aviso : t.gris200, borderWidth: mala ? 2 : 1 }]} />
                  <View style={[z.numero, { backgroundColor: 'rgba(23,24,27,0.8)' }]}>
                    <Text style={z.numeroTexto}>{i + 1}</Text>
                  </View>
                  {mala ? (
                    <View style={[z.mala, { backgroundColor: t.aviso }]}>
                      <Text style={z.malaTexto}>Muy chica</Text>
                    </View>
                  ) : null}
                  <Pressable
                    onPress={() => setPaginas((prev) => prev.filter((_, j) => j !== i))}
                    accessibilityLabel={`Quitar la foto ${i + 1}`}
                    hitSlop={8}
                    style={[z.quitar, { backgroundColor: t.superficie, borderColor: t.gris200 }]}
                  >
                    <Icono nombre="quitar" size={12} color={t.fuerte} grosor={2.2} />
                  </Pressable>
                </View>
              )
            })}
            {paginas.length < MAX_PAGINAS ? (
              <Pressable onPress={() => void camara()} style={[z.otra, { borderColor: t.gris200 }]} accessibilityRole="button">
                <Icono nombre="camara" size={18} color={t.tenue} />
                <Text style={[z.otraTexto, { color: t.tenue }]}>Otra{'\n'}página</Text>
              </Pressable>
            ) : null}
          </View>
          {conProblemas > 0 ? (
            <Text style={[z.nota, { color: t.aviso, textAlign: 'center' }]}>
              {conProblemas === 1 ? 'Una foto' : `${conProblemas} fotos`} pueden leerse mal: toca ✕ y tómala de nuevo.
            </Text>
          ) : null}
          <Pressable
            onPress={() => void leerRevisadas()}
            accessibilityRole="button"
            style={({ pressed }) => [z.principal, { alignSelf: 'stretch', backgroundColor: t.tinta, opacity: pressed ? 0.88 : 1 }]}
          >
            <Icono nombre="chispa" size={18} color={t.papel} />
            <Text style={[z.principalTexto, { color: t.papel }]}>Leer factura</Text>
          </Pressable>
          <Text style={[z.nota, { color: t.tenue, textAlign: 'center' }]}>
            Si la factura sigue en otra hoja, agrega esa foto antes de leer. En orden: la IA junta los renglones de todas.
          </Text>
          <BotonTexto texto="Agregar desde la galería" icono="imagen" tono="neutro" alTocar={() => void galeria()} />
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {/* La guía resalta el botón principal (la web marca la fila entera; aquí Galería y PDF van aparte). */}
          <Ancla nombre="compras.subir">
            <Pressable
              onPress={() => void camara()}
              accessibilityRole="button"
              style={({ pressed }) => [z.principal, { backgroundColor: t.tinta, opacity: pressed ? 0.88 : 1 }]}
            >
              <Icono nombre="camara" size={20} color={t.papel} />
              <Text style={[z.principalTexto, { color: t.papel }]}>Tomar foto de la factura</Text>
            </Pressable>
          </Ancla>
          <View style={z.fila}>
            <View style={{ flex: 1 }}>
              <Boton texto="Galería" icono="imagen" tono="neutro" alTocar={() => void galeria()} />
            </View>
            <View style={{ flex: 1 }}>
              <Boton texto="PDF" icono="factura" tono="neutro" alTocar={() => void pdf()} />
            </View>
          </View>
          <Text style={[z.nota, { color: t.tenue, textAlign: 'center' }]}>
            La factura entera, derecha, con buena luz y el teléfono quieto. ¿Varias hojas? Una foto por hoja. La lee {PROVEEDOR_IA} y tú revisas
            el formulario antes de guardar.
          </Text>
        </View>
      )}
      {error ? <NotaTono tono="mal" style={{ marginTop: 10 }}>{error}</NotaTono> : null}
    </View>
  )
}

/**
 * La espera mientras se lee: una barra que avanza rapido al principio y se
 * frena despues (sin prometer un tiempo que no se sabe) y mensajes cortos de
 * lo que se esta haciendo.
 */
export function EsperaLectura({ terminando }: { terminando: boolean }) {
  const t = useTema()
  const [ms, setMs] = useState(0)
  useEffect(() => {
    const inicio = Date.now()
    const id = setInterval(() => setMs(Date.now() - inicio), 100)
    return () => clearInterval(id)
  }, [])
  const i = Math.floor(ms / MS_POR_MENSAJE)
  const mensaje = terminando
    ? 'Listo'
    : i < MENSAJES_LECTURA.length
      ? MENSAJES_LECTURA[i]
      : MENSAJES_TARDE[(i - MENSAJES_LECTURA.length) % MENSAJES_TARDE.length]
  const avance = terminando ? 100 : 95 * (1 - Math.exp(-ms / TAU_BARRA_MS))
  return (
    <View accessibilityLiveRegion="polite" style={{ gap: 8 }}>
      <View style={z.esperaCabeza}>
        <Icono nombre="chispa" size={15} color={t.acento} />
        <Text style={[z.esperaTexto, { color: t.tinta }]} numberOfLines={2}>
          {mensaje}
          {!terminando ? '…' : ''}
        </Text>
        <Text style={[z.segundos, { color: t.tenue }]}>{Math.floor(ms / 1000)} s</Text>
      </View>
      <View style={[z.pista, { backgroundColor: t.gris100 }]}>
        <View style={[z.avance, { backgroundColor: t.acento, flex: avance / 100 }]} />
        <View style={{ flex: 1 - avance / 100 }} />
      </View>
      <Text style={[z.nota, { color: t.tenue }]}>
        {ms < 30000 ? 'La IA lee y el sistema revisa que todo cuadre.' : 'El servicio está lento hoy. Si prefieres, cárgala a mano abajo.'}
      </Text>
    </View>
  )
}

/**
 * La factura a la vista mientras se revisa (o la guardada, en el detalle).
 * Una foto se ve aqui mismo, se puede girar (muchas llegan de lado) y
 * acercar; un PDF se abre en el visor del telefono. `plegable`: en el
 * telefono arranca plegada, para no ocupar media pantalla antes del primer
 * campo.
 */
export function VistaDocumento({
  doc,
  plegable = false,
  altoMaximo,
  titulo = 'Factura',
}: {
  doc: DocumentoLeido
  plegable?: boolean
  altoMaximo: number
  titulo?: string
}) {
  const t = useTema()
  const [abierto, setAbierto] = useState(!plegable)
  const [giro, setGiro] = useState(0)
  const [cerca, setCerca] = useState(false)
  const [medida, setMedida] = useState<{ ancho: number; alto: number } | null>(doc.ancho && doc.alto ? { ancho: doc.ancho, alto: doc.alto } : null)
  const [ancho, setAncho] = useState(0)

  useEffect(() => {
    if (doc.esPdf || (doc.ancho && doc.alto)) return
    ImagenRN.getSize(
      doc.uri,
      (w, h) => setMedida({ ancho: w, alto: h }),
      () => undefined,
    )
  }, [doc])

  const proporcion = medida ? (giro % 180 ? medida.alto / medida.ancho : medida.ancho / medida.alto) : 0.75
  const anchoFoto = (cerca ? 2 : 1) * ancho
  const altoFoto = anchoFoto / proporcion

  return (
    <Ficha style={{ padding: 0, overflow: 'hidden' }}>
      <View style={[z.visorCabeza, { borderBottomColor: abierto ? t.gris200 : 'transparent' }]}>
        <Pressable
          onPress={() => plegable && setAbierto((v) => !v)}
          disabled={!plegable}
          accessibilityRole="button"
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}
        >
          <Icono nombre="factura" size={17} color={t.suave} />
          <Text style={[z.titulo, { color: t.tinta }]}>
            {abierto || !plegable ? titulo : 'Ver la factura'} {doc.esPdf ? '(PDF)' : ''}
          </Text>
          {plegable ? (
            <View style={{ transform: [{ rotate: abierto ? '-90deg' : '90deg' }] }}>
              <Icono nombre="chevron" size={14} color={t.tenue} grosor={2.4} />
            </View>
          ) : null}
        </Pressable>
        {!doc.esPdf && abierto ? (
          <View style={{ flexDirection: 'row' }}>
            <BotonTexto texto="Girar" tono="neutro" alTocar={() => setGiro((g) => (g + 90) % 360)} />
            <BotonTexto texto={cerca ? 'Ajustar' : 'Acercar'} tono="neutro" alTocar={() => setCerca((v) => !v)} />
          </View>
        ) : null}
      </View>
      {abierto ? (
        doc.esPdf ? (
          <View style={{ padding: 16, gap: 10 }}>
            <Text style={[z.nota, { color: t.suave }]}>El PDF se abre en el visor del teléfono, para compararlo con el formulario.</Text>
            <Boton texto="Abrir el PDF" icono="factura" tono="neutro" alTocar={() => void abrirPdf(doc.uri)} />
          </View>
        ) : (
          <View style={{ height: Math.min(altoMaximo, Math.max(240, altoFoto || 240)), backgroundColor: t.gris100 }} onLayout={(e) => setAncho(e.nativeEvent.layout.width)}>
            <ScrollView nestedScrollEnabled contentContainerStyle={{ alignItems: 'center' }}>
              <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={cerca}>
                {ancho > 0 ? (
                  <View style={{ width: anchoFoto, height: altoFoto, alignItems: 'center', justifyContent: 'center' }}>
                    <Image
                      source={{ uri: doc.uri }}
                      accessibilityLabel="Factura del proveedor"
                      contentFit="contain"
                      style={
                        giro % 180
                          ? { width: altoFoto, height: anchoFoto, transform: [{ rotate: `${giro}deg` }] }
                          : { width: anchoFoto, height: altoFoto, transform: [{ rotate: `${giro}deg` }] }
                      }
                    />
                  </View>
                ) : null}
              </ScrollView>
            </ScrollView>
          </View>
        )
      ) : null}
    </Ficha>
  )
}

const z = StyleSheet.create({
  zona: { borderWidth: 2, borderStyle: 'dashed', borderRadius: 24, borderCurve: 'continuous', padding: 16 },
  titulo: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  nota: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
  fila: { flexDirection: 'row', gap: 10 },
  principal: { minHeight: 56, borderRadius: 16, borderCurve: 'continuous', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  principalTexto: { fontFamily: LETRA.textoFuerte, fontSize: 16 },
  miniaturas: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  miniatura: { width: 80, height: 100 },
  foto: { width: 80, height: 100, borderRadius: 10, borderCurve: 'continuous' },
  numero: { position: 'absolute', left: 4, top: 4, borderRadius: 6, paddingHorizontal: 6 },
  numeroTexto: { fontFamily: LETRA.textoFuerte, fontSize: 13, color: '#ffffff' },
  mala: { position: 'absolute', left: 4, right: 4, bottom: 4, borderRadius: 6, alignItems: 'center' },
  malaTexto: { fontFamily: LETRA.textoFuerte, fontSize: 13, color: '#ffffff' },
  quitar: { position: 'absolute', right: -8, top: -8, width: 26, height: 26, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  otra: { width: 80, height: 100, borderRadius: 10, borderCurve: 'continuous', borderWidth: 2, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 4 },
  otraTexto: { fontFamily: LETRA.textoFuerte, fontSize: 13, textAlign: 'center' },
  esperaCabeza: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  esperaTexto: { flex: 1, fontFamily: LETRA.textoFuerte, fontSize: 15 },
  segundos: { fontFamily: LETRA.cifra, fontSize: 13 },
  pista: { height: 8, borderRadius: 4, overflow: 'hidden', flexDirection: 'row' },
  avance: { height: 8, borderRadius: 4 },
  visorCabeza: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 16, paddingRight: 6, borderBottomWidth: StyleSheet.hairlineWidth },
})
