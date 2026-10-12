import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { useEffect, useState } from 'react'
import { Platform, type View } from 'react-native'
import { API_BASE, cabecerasDeSesion, ErrorApi } from './api'
import { apiCompras, type PedidoRevision } from './api-compras'
import { hoyEnCaracas, miles } from './formato'
import { aNumero, fechaCorta, sinRuido } from './numeros'
import type {
  AlertaPrecio,
  ConceptoGasto,
  CuerpoCompletarFactura,
  FacturaCompra,
  RenglonLeido,
  RevisionFactura,
  SugerenciaRenglon,
  TipoArticulo,
} from './tipos'

/*
 * LA LOGICA DE COMPRAS EN LA APP. Lo que la web tiene en archivos que tocan
 * el navegador (lib/revisionFactura.ts, lib/pendientesCompras.ts, lib/foto.ts,
 * lib/pdfDeFotos.ts) y en lo alto de pages/partes/compras/CargarFactura.tsx,
 * copiado aqui con las mismas reglas. Lo que es logica pura y no toca el
 * navegador (lib/compras.ts, lib/tiposArticulo.ts, lib/unidades.ts...) se
 * importa de la web tal cual, no se copia.
 */

// ── Cifras ──────────────────────────────────────────────────────────────────

/**
 * Lo escrito en una casilla, a numero: coma o punto (el teclado del telefono
 * en español pone coma). Vacio o basura = NaN, como `Number('')` no: asi
 * "> 0" es falso para lo que no se escribio.
 */
export const num = (t: string | number | null | undefined): number => aNumero(t)

/** Lo escrito, a numero; lo que no es numero cuenta como cero (para sumar). */
export const cero = (t: string | number | null | undefined): number => {
  const n = aNumero(t)
  return Number.isFinite(n) ? n : 0
}

/** Un numero para ponerlo en una casilla, con coma: 0,42 y no 0.42. */
export const aTexto = (n: number): string => sinRuido(n).replace('.', ',')

/** "$12,50" o "Bs 1.234,00": un monto en la moneda del PAPEL (la factura que se carga). */
export function enMoneda(n: number, moneda: string, decimales = 2): string {
  const simbolo = moneda === 'Bs' ? 'Bs ' : '$'
  return `${n < 0 ? '−' : ''}${simbolo}${miles(Math.abs(n), decimales)}`
}

/** Una cantidad: sin decimales si es entera ("48"), con dos si no ("2,50"). */
export const cant = (n: number): string => miles(n, n % 1 ? 2 : 0)

/** Una fecha AAAA-MM-DD (o ISO) corta, con el año solo si no es el de hoy. */
export function fechaDe(iso: string | null | undefined): string {
  if (!iso) return '—'
  return fechaCorta(iso, iso.slice(0, 4) !== hoyEnCaracas().slice(0, 4))
}

// ── El pago ─────────────────────────────────────────────────────────────────

export const MONEDAS_DE_CARGA = ['$', 'Bs'] as const
export type MonedaCarga = (typeof MONEDAS_DE_CARGA)[number]

/** Las formas de pago de una factura, con los mismos valores y textos de la web. */
export const FORMAS_PAGO = [
  { valor: 'Efectivo', texto: 'Efectivo Bs' },
  { valor: 'Efectivo $', texto: 'Efectivo $' },
  { valor: 'Banco', texto: 'Banco' },
  { valor: 'Credito', texto: 'A crédito' },
  { valor: 'Mixto', texto: 'Mixto' },
]
/** Con que puede ir cada parte de un pago mixto: plata de verdad, no deuda. */
export const FORMAS_PARTE = FORMAS_PAGO.filter((f) => f.valor !== 'Credito' && f.valor !== 'Mixto')
/** Una parte de un pago mixto, en la moneda del papel. */
export type ParteDePago = { forma: string; monto: string; referencia: string }
export const PARTES_INICIALES: ParteDePago[] = [
  { forma: 'Efectivo', monto: '', referencia: '' },
  { forma: 'Banco', monto: '', referencia: '' },
]
export const textoForma = (valor: string) => FORMAS_PAGO.find((f) => f.valor === valor)?.texto ?? valor

/**
 * Una factura mas vieja que esto se avisa, no se bloquea: el plazo real para
 * descontar ese credito fiscal lo confirma quien lleva la contabilidad.
 */
export const DIAS_FACTURA_VIEJA = 60

// ── Los renglones de la carga ───────────────────────────────────────────────

/** Como llego el renglon: en un envase que trae varias unidades nuestras. */
export type Paquete = {
  /** "empaque" (desde el 8-oct no se escribe), o como lo llamo el papel del proveedor. */
  nombre: string
  /** Cuantas unidades NUESTRAS trae uno. */
  trae: string
  /** Cuantos vinieron. */
  paquetes: string
}

export type Linea = {
  ingrediente_id: number
  /** En la unidad de la ficha: es lo que viaja al servidor. */
  cantidad: string
  /** Lo que dice el papel del renglon entero, sin IVA, en la moneda del papel
      (Leider, 11-oct: "en la factura lo que hay es costo total"). El costo
      por unidad sale de aqui entre la cantidad. */
  costo_total: string
  /** Por unidad de la ficha, sin IVA, en la moneda del papel. Lo saca el sistema. */
  costo_unitario: string
  /** null = lo que diga la ficha de la mercancia; true/false = lo dice ESTA factura. */
  exento: boolean | null
  /** Lo que dice el papel de este renglon, si vino de una foto. */
  leido?: RenglonLeido
  /** Lo que se recordaba de este proveedor para este renglon, si se aplico. */
  recordada?: SugerenciaRenglon
  /** Si vino en empaque: la cantidad sale de aqui. */
  paquete?: Paquete
  /** Si el renglon NO es mercancia: flete, servicio, equipo. Cantidad 1 y el costo es el monto. */
  concepto?: ConceptoGasto
  /** Que es, en palabras del papel ("Internet de octubre"). Solo con concepto. */
  detalle?: string
  /** Solo para un equipo: en cuantos meses se deprecia. */
  vidaUtil?: string
  /** Desplegado para editar. Plegado, el renglon es una sola linea. */
  abierta?: boolean
  /** Que tipo de mercancia se eligio primero: filtra la lista de mercancias. */
  tipo?: TipoArticulo
}

export const LINEA_VACIA: Linea = { ingrediente_id: 0, cantidad: '', costo_total: '', costo_unitario: '', exento: null, abierta: true }

/** El costo por unidad, derivado: total entre cantidad. Un concepto (flete, servicio) ya viene resuelto. */
export function conCostoUnitario(l: Linea): Linea {
  if (l.concepto) return l
  const cantidad = num(l.cantidad)
  const total = num(l.costo_total)
  const costo_unitario = l.costo_total !== '' && Number.isFinite(total) && cantidad > 0 ? sinRuido(total / cantidad) : ''
  return costo_unitario === l.costo_unitario ? l : { ...l, costo_unitario }
}

/** Ya dice que es y cuanto: se puede plegar en una linea. */
export function lineaCompleta(l: Linea): boolean {
  return (!!l.ingrediente_id || !!l.concepto) && num(l.cantidad) > 0 && l.costo_unitario !== ''
}

/** Todavia no dice nada: ni que es ni cuanto. Es el renglon que queda al final. */
export function renglonVacio(l: Linea): boolean {
  return !l.ingrediente_id && !l.concepto && !(num(l.cantidad) > 0) && !(num(l.costo_unitario) > 0) && !(num(l.costo_total) > 0)
}

/** Tiene cantidad o costo pero no dice que es. */
export function sinMercanciaEn(l: Linea): boolean {
  return !l.ingrediente_id && !l.concepto && (num(l.cantidad) > 0 || num(l.costo_unitario) > 0 || num(l.costo_total) > 0)
}

/** La cantidad en unidades nuestras a partir del paquete, o null si falta el "trae". */
export function desdePaquete(p: Paquete): { cantidad: string } | null {
  const trae = num(p.trae)
  const paquetes = num(p.paquetes)
  if (!(trae > 0)) return null
  return { cantidad: paquetes > 0 ? sinRuido(paquetes * trae) : '' }
}

/** "2 empaques", "1 empaque", "3 CAJA" (como lo llamo el papel). */
export function nombrePaquete(p: Paquete): string {
  const n = num(p.paquetes)
  const nombre = p.nombre || 'empaque'
  return nombre === 'empaque' && n !== 1 ? 'empaques' : nombre
}

/** El RIF sin guiones ni espacios, para comparar dos escritos distinto. */
export const soloRif = (x: string) => x.toUpperCase().replace(/[^0-9A-Z]/g, '')

// ── Los pasos y lo que falta revisar ────────────────────────────────────────

export type Numero = 1 | 2 | 3
export type Tono = 'mal' | 'ojo'
/** Algo que mirar antes de guardar. `ancla` es el sitio al que lleva. */
export type Pendiente = { texto: string; tono: Tono; ancla: string }

/** En que paso vive cada campo: un aviso que lleva a el primero abre su paso. */
export const PASO_DE: Record<string, Numero> = {
  'cf-proveedor': 1,
  'cf-rif': 1,
  'cf-numero': 1,
  'cf-fecha': 1,
  'cf-moneda': 1,
  'cf-tasa': 1,
  'cf-control': 1,
  'cf-referencia': 3,
  'cf-mixto': 3,
  'cf-vence': 3,
  'cf-retencion': 3,
  'cf-descripcion': 3,
}

// ── La revision del servidor mientras se llena ──────────────────────────────

/**
 * Pide la revision de una factura (duplicado, costos fuera de lo normal, RIF)
 * mientras se llena el formulario, con una pausa para no consultar en cada
 * tecla. Con el formulario vacio no pregunta nada. Copia de
 * frontend/src/lib/revisionFactura.ts.
 */
export function useRevision(datos: PedidoRevision): RevisionFactura | null {
  const [revision, setRevision] = useState<{ clave: string; r: RevisionFactura } | null>(null)
  const vacio = !datos.numero_factura && datos.items.length === 0
  const clave = vacio ? '' : JSON.stringify(datos)
  useEffect(() => {
    if (!clave) return
    let vigente = true
    const t = setTimeout(() => {
      apiCompras
        .revisarFactura(JSON.parse(clave) as PedidoRevision)
        .then((r) => {
          if (vigente) setRevision({ clave, r })
        })
        .catch(() => undefined)
    }, 400)
    return () => {
      vigente = false
      clearTimeout(t)
    }
  }, [clave])
  // Mientras llega la respuesta a lo nuevo se sigue mostrando la anterior (no
  // parpadea); con el formulario vacio, nada.
  return clave && revision ? revision.r : null
}

// ── Lo de despues de guardar ────────────────────────────────────────────────
//
// Copia de frontend/src/lib/pendientesCompras.ts, sin la cola local vieja
// (la app nunca la tuvo). Antes de guardar, lo que hay que hacer queda
// anotado EN EL SERVIDOR, pegado a la foto; si el "completar" de despues no
// llega, el servidor reconoce la factura por RIF y numero y lo termina solo.

const ESPERAS_MS = [0, 1500, 4000]

/** Un 4xx no se arregla reintentando; sin conexion o el servidor caido, si. */
function valeReintentar(e: unknown): boolean {
  return !(e instanceof ErrorApi) || e.estado === 0 || e.estado >= 500 || e.estado === 408 || e.estado === 429
}

/** Antes de guardar una factura leida de una foto: lo que el servidor hara cuando quede guardada. */
export async function anotarAntesDeGuardar(numero: string, cuerpo: CuerpoCompletarFactura): Promise<void> {
  if (cuerpo.soporte_id === null) return
  await apiCompras.anotarAlGuardar(cuerpo.soporte_id, {
    numero_factura: numero,
    proveedor_rif: cuerpo.proveedor_rif,
    proveedor_nombre: cuerpo.proveedor_nombre,
    renglones: cuerpo.renglones,
  })
}

export type ResultadoCompletar =
  | { estado: 'hecho'; foto: boolean; fotoPerdida: boolean; alertas: AlertaPrecio[] }
  | { estado: 'pendiente' }
  | { estado: 'fallo'; mensaje: string }

/** Justo despues de guardar: unos pocos intentos seguidos. Si no llega, lo termina el servidor. */
export async function completarDespuesDeGuardar(facturaId: number, cuerpo: CuerpoCompletarFactura): Promise<ResultadoCompletar> {
  for (const espera of ESPERAS_MS) {
    if (espera) await new Promise((r) => setTimeout(r, espera))
    try {
      const r = await apiCompras.completarFactura(facturaId, cuerpo)
      return { estado: 'hecho', foto: r.foto, fotoPerdida: r.foto_perdida, alertas: r.alertas }
    } catch (e) {
      if (!valeReintentar(e)) return { estado: 'fallo', mensaje: e instanceof Error ? e.message : 'error' }
    }
  }
  return { estado: 'pendiente' }
}

// ── Las fotos de la factura ─────────────────────────────────────────────────

/** Paginas de una misma factura que se pueden juntar (una factura larga llega en dos o tres fotos). */
export const MAX_PAGINAS = 8
/** Lo que acepta el lector del servidor (compras_lectura.py). */
export const TAMANO_MAXIMO = 8 * 1024 * 1024
/** El lado corto mas chico con que la letra de una factura todavia se lee (lib/foto.ts). */
export const LADO_CORTO_MINIMO = 700

/**
 * Lo que puede tener de malo una foto. En la web se mide tambien si salio
 * movida u oscura, sobre los pixeles en un lienzo; el telefono no tiene
 * lienzo, asi que aqui solo se mira el tamaño, que viene con la foto.
 */
export type Problema = 'pequena'
export const TEXTO_PROBLEMA: Record<Problema, string> = {
  pequena: 'es muy pequeña (¿una captura o una foto de WhatsApp?)',
}
export function problemasDeFoto(ancho: number, alto: number): Problema[] {
  if (!ancho || !alto) return []
  return Math.min(ancho, alto) < LADO_CORTO_MINIMO ? ['pequena'] : []
}

/** Lo que se va diciendo mientras la IA lee (components/compras/Documento.tsx). */
export const MENSAJES_LECTURA = [
  'Recibiendo la factura',
  'Enderezando el papel',
  'Buscando quién la emitió',
  'Leyendo el RIF dígito por dígito',
  'Copiando los renglones uno a uno',
  'Sumando los montos',
  'Comparando con el total impreso',
  'Dándole una segunda leída para ir a la segura',
  'Repasando los céntimos',
  'Afinando los últimos números',
]
export const MENSAJES_TARDE = ['Este papel tiene sus detalles, un momento más', 'Ya casi está', 'Revisando renglón por renglón']
export const MS_POR_MENSAJE = 1800
/** Constante de la barra: a los 8 s va por el 63 %, a los 20 s por el 92 %. Nunca llega sola al final. */
export const TAU_BARRA_MS = 8000

/** Una foto JPEG empieza con FF D8. */
export const esJpeg = (b: Uint8Array) => b.length > 2 && b[0] === 0xff && b[1] === 0xd8
/** Un PDF empieza con "%PDF-". */
export const esPdfBytes = (b: Uint8Array) => b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46

export type FotoPdf = { jpeg: Uint8Array; ancho: number; alto: number }

const ANCHO_PAGINA = 595 // puntos: el ancho de una hoja A4

/** Texto ASCII a bytes (todo lo que escribe el PDF, salvo las fotos, es ASCII). */
function ascii(texto: string): Uint8Array {
  const b = new Uint8Array(texto.length)
  for (let i = 0; i < texto.length; i++) b[i] = texto.charCodeAt(i) & 0x7f
  return b
}

/**
 * Varias fotos en un solo PDF, una pagina por foto: copia de
 * frontend/src/lib/pdfDeFotos.ts (`armarPdf`). Una factura larga llega en
 * dos o tres fotos; unidas, el servidor recibe un PDF como cualquier otro, el
 * lector lo lee entero y el soporte es un solo documento. Sin libreria: un
 * PDF que solo lleva fotos JPEG es poca cosa (cada foto va tal cual, con
 * /DCTDecode, y la pagina toma la forma de la foto).
 */
export function armarPdf(paginas: FotoPdf[]): Uint8Array {
  const partes: Uint8Array[] = []
  const posiciones: number[] = []
  let largo = 0
  const escribir = (x: string | Uint8Array) => {
    const bytes = typeof x === 'string' ? ascii(x) : x
    partes.push(bytes)
    largo += bytes.length
  }
  const objeto = (n: number, cuerpo: () => void) => {
    posiciones[n] = largo
    escribir(`${n} 0 obj\n`)
    cuerpo()
    escribir('\nendobj\n')
  }

  // Objetos: 1 catalogo, 2 paginas, y por cada foto 3: pagina, contenido, imagen.
  const n = paginas.length
  const pagina = (i: number) => 3 + i * 3
  escribir('%PDF-1.4\n')
  // La linea "binaria" que pide el formato: bytes altos, para que nadie lo trate como texto.
  escribir(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))
  objeto(1, () => escribir('<< /Type /Catalog /Pages 2 0 R >>'))
  objeto(2, () => escribir(`<< /Type /Pages /Count ${n} /Kids [${paginas.map((_, i) => `${pagina(i)} 0 R`).join(' ')}] >>`))
  paginas.forEach((p, i) => {
    const ancho = ANCHO_PAGINA
    const alto = Math.round((ANCHO_PAGINA * p.alto) / p.ancho)
    const dibujo = `q ${ancho} 0 0 ${alto} 0 0 cm /Foto Do Q`
    objeto(pagina(i), () =>
      escribir(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ancho} ${alto}] ` +
          `/Resources << /XObject << /Foto ${pagina(i) + 2} 0 R >> >> /Contents ${pagina(i) + 1} 0 R >>`,
      ),
    )
    objeto(pagina(i) + 1, () => escribir(`<< /Length ${dibujo.length} >>\nstream\n${dibujo}\nendstream`))
    objeto(pagina(i) + 2, () => {
      escribir(
        `<< /Type /XObject /Subtype /Image /Width ${p.ancho} /Height ${p.alto} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      )
      escribir(p.jpeg)
      escribir('\nendstream')
    })
  })

  const total = 3 + n * 3
  const inicioXref = largo
  escribir(`xref\n0 ${total}\n0000000000 65535 f \n`)
  for (let i = 1; i < total; i++) escribir(`${String(posiciones[i]).padStart(10, '0')} 00000 n \n`)
  escribir(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`)
  const pdf = new Uint8Array(largo)
  let en = 0
  for (const parte of partes) {
    pdf.set(parte, en)
    en += parte.length
  }
  return pdf
}

// ── Las facturas ya vistas ──────────────────────────────────────────────────

/*
 * El backend no tiene "una factura por id": la lista trae todo. Lo que llego
 * en la lista se recuerda aqui para abrir el detalle al instante; el detalle
 * igual la vuelve a pedir (su dia) para tener lo ultimo.
 */
const vistas = new Map<number, FacturaCompra>()

export function recordarFacturas(lista: FacturaCompra[]) {
  for (const f of lista) vistas.set(f.id, f)
}
export function recordarFactura(f: FacturaCompra) {
  vistas.set(f.id, f)
}
export function facturaRecordada(id: number): FacturaCompra | undefined {
  return vistas.get(id)
}
export function olvidarFactura(id: number) {
  vistas.delete(id)
}

/** Lo que se le debe al proveedor de una factura: sin el IVA retenido, que es del SENIAT. */
export const saldoDe = (f: FacturaCompra) => f.saldo ?? f.a_pagar ?? f.total

/** Dias desde que vencio (positivo = vencida), o null si no tiene fecha. */
export function diasVencida(f: FacturaCompra): number | null {
  if (!f.fecha_vencimiento) return null
  const hoy = hoyEnCaracas()
  return Math.round(
    (new Date(`${hoy}T12:00:00Z`).getTime() - new Date(`${f.fecha_vencimiento.slice(0, 10)}T12:00:00Z`).getTime()) / 86400000,
  )
}

// ── Los archivos de la factura (la foto, el PDF) ────────────────────────────

/** Los bytes de una foto o un PDF del telefono (o del navegador, en la vista web). */
export async function bytesDe(uri: string): Promise<Uint8Array> {
  if (Platform.OS === 'web') return new Uint8Array(await (await fetch(uri)).arrayBuffer())
  return await new File(uri).bytes()
}

/**
 * Guarda el PDF armado con varias fotos y devuelve donde quedo, para subirlo
 * y para verlo mientras se revisa. En el navegador, un enlace al Blob.
 */
export function guardarPdf(pdf: Uint8Array): string {
  if (Platform.OS === 'web') return URL.createObjectURL(new Blob([pdf as BlobPart], { type: 'application/pdf' }))
  const archivo = new File(Paths.cache, `factura-fotos-${Date.now()}.pdf`)
  archivo.create({ overwrite: true })
  archivo.write(pdf)
  return archivo.uri
}

/**
 * La foto o el PDF guardado de una factura ya cargada. Se baja primero para
 * saber que es: la lista de facturas no dice si el soporte es foto o PDF
 * (como `VerSoporte` en la web). En el telefono queda en la cache.
 */
export async function bajarSoporte(facturaId: number): Promise<{ uri: string; esPdf: boolean }> {
  const url = `${API_BASE}/api/compras/facturas/${facturaId}/soporte`
  if (Platform.OS === 'web') {
    const res = await fetch(url, { headers: cabecerasDeSesion() })
    if (!res.ok) throw new ErrorApi('No se pudo abrir el soporte de esta factura', res.status)
    const blob = await res.blob()
    return { uri: URL.createObjectURL(blob), esPdf: blob.type === 'application/pdf' }
  }
  let archivo: File
  try {
    archivo = await File.downloadFileAsync(url, new File(Paths.cache, `soporte-${facturaId}`), {
      headers: cabecerasDeSesion(),
      idempotent: true,
    })
  } catch {
    throw new ErrorApi('No se pudo abrir el soporte de esta factura', 0)
  }
  const inicio = (await archivo.bytes()).slice(0, 5)
  if (!esPdfBytes(inicio)) return { uri: archivo.uri, esPdf: false }
  // Un PDF se abre afuera, en el visor del telefono: necesita su extension.
  const pdf = new File(Paths.cache, `factura-${facturaId}.pdf`)
  if (pdf.exists) pdf.delete()
  archivo.copySync(pdf)
  return { uri: pdf.uri, esPdf: true }
}

/** Abrir un PDF: en el telefono, el menu del sistema (visor, Drive, WhatsApp); en el navegador, otra pestaña. */
export async function abrirPdf(uri: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.open?.(uri, '_blank')
    return
  }
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' })
}

/**
 * Los sitios de la pantalla a los que se puede llevar (un paso, un renglon,
 * un campo que falta): cada uno se anota al dibujarse y se mide al ir.
 */
export class Anclas {
  private sitios = new Map<string, View>()
  /** El `ref` de la vista que es el sitio `clave`. */
  anclar(clave: string) {
    return (v: View | null) => {
      if (v) this.sitios.set(clave, v)
      else this.sitios.delete(clave)
    }
  }
  tiene(clave: string): boolean {
    return this.sitios.has(clave)
  }
  /** Donde esta el sitio dentro de `base` (lo de adentro del desplazamiento). */
  medir(clave: string, base: View | null, listo: (y: number, alto: number) => void) {
    const el = this.sitios.get(clave)
    if (!el || !base) return
    el.measureLayout(base, (_x, y, _w, h) => listo(y, h), () => undefined)
  }
}
