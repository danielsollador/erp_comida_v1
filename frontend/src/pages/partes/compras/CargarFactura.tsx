import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import CampoSugerido from '../../../components/CampoSugerido'
import { CasillaConUnidad } from '../../../components/Cantidad'
import { aBase, convertirTexto, otraUnidad, sinRuido } from '../../../lib/unidades'
import { useDialogo } from '../../../components/dialogo'
import { ZonaDocumento, VisorDocumento } from '../../../components/compras/Documento'
import { DestinoPlata, PuntoTipo, SelloTipo, type ParteDeLaPlata } from '../../../components/compras/Almacenes'
import ElegirMercancia from '../../../components/compras/ElegirMercancia'
import Icono from '../../../components/Icono'
import NuevaMercancia, { type Presentacion } from '../../../components/NuevaMercancia'
import { Numerico } from '../../../components/Teclado'
import { Filtros } from '../../../components/ui'
import { api, ErrorApi } from '../../../lib/api'
import {
  CONCEPTOS,
  TEXTO_CONCEPTO,
  diasDesde,
  nombreDesdePapel,
  sugerirMercancia,
  unidadDistinta,
  unidadNuestra,
} from '../../../lib/compras'
import { fmtNum } from '../../../lib/moneda'
import { necesitaReferencia } from '../../../lib/pagos'
import { anotarAntesDeGuardar, completarDespuesDeGuardar } from '../../../lib/pendientesCompras'
import { useRevision } from '../../../lib/revisionFactura'
import { ALMACEN_DE, TIPOS_DE_COMPRA } from '../../../lib/tiposArticulo'
import type {
  AlertaPrecio,
  ConceptoGasto,
  ConfiguracionFiscal,
  Equivalencia,
  Ingrediente,
  LecturaFactura,
  Proveedor,
  RenglonLeido,
  SugerenciaRenglon,
  TipoArticulo,
} from '../../../lib/types'

/**
 * Cargar una factura de proveedor, en tres pasos que se leen de arriba abajo:
 * la factura (quién, cuál, cuándo), qué trae y cómo se pagó. A mano, o desde
 * una foto o PDF que la IA lee y PRELLENA.
 *
 * LO QUE CAMBIA RESPECTO A ANTES (pizarra del 7-oct): cada renglón dice QUÉ
 * ES su mercancía --materia prima, reventa, consumible, desechable-- y eso
 * decide solo a dónde va la plata: al depósito o a gasto. Y la caja de 24
 * maltas se carga como caja y entra como 24 maltas: la presentación es del
 * proveedor, la mercancía es la malta. Abajo, "a dónde va la plata" lo
 * resume sin pasar por la contabilidad.
 *
 * Y DESDE EL 7-OCT (tarde): ya no se elige una categoría para la factura
 * entera. Cada renglón dice qué es: una mercancía (y su ficha dice a qué
 * almacén va) o algo que no es mercancía --flete, servicio, equipo, otro
 * gasto--. Así una factura de pollo que también cobra el flete se carga tal
 * cual viene. Los tres pasos se pliegan al terminarlos: en el teléfono solo
 * queda abierto el que se está llenando.
 *
 * Guardar sigue siendo `POST /api/compras/facturas`, el de siempre.
 */

const MONEDAS_DE_CARGA = ['$', 'Bs'] as const
const FORMAS_PAGO = [
  { valor: 'Efectivo', texto: 'Efectivo Bs' },
  { valor: 'Efectivo $', texto: 'Efectivo $' },
  { valor: 'Banco', texto: 'Banco' },
  { valor: 'Credito', texto: 'A crédito' },
]

// Una factura mas vieja que esto se avisa, no se bloquea: el plazo real para
// descontar ese credito fiscal lo confirma quien lleva la contabilidad.
const DIAS_FACTURA_VIEJA = 60

/** Cómo llegó el renglón: en un envase que trae varias unidades nuestras. */
type Paquete = {
  /** "caja", "bulto", "paquete": como lo llama el proveedor. */
  nombre: string
  /** Cuántas unidades NUESTRAS trae uno. */
  trae: string
  /** Cuántos vinieron. */
  paquetes: string
  /** Lo que costó UNO, sin IVA, en la moneda del papel. */
  precio: string
}

type Linea = {
  ingrediente_id: number
  /** En la unidad de la ficha: es lo que viaja al servidor. */
  cantidad: string
  /** Por unidad de la ficha, sin IVA, en la moneda del papel. */
  costo_unitario: string
  /** null = lo que diga la ficha de la mercancía; true/false = lo dice ESTA factura. */
  exento: boolean | null
  /** Lo que dice el papel de este renglón, si vino de una foto. */
  leido?: RenglonLeido
  /** Lo que se recordaba de este proveedor para este renglón, si se aplicó. */
  recordada?: SugerenciaRenglon
  /** Si vino en caja o paquete: cantidad y costo salen de aquí. */
  paquete?: Paquete
  /**
   * Si el renglón NO es mercancía: flete, servicio, equipo. Entonces no hay
   * ingrediente, la cantidad es 1 y `costo_unitario` es el monto.
   */
  concepto?: ConceptoGasto
  /** Qué es, en palabras del papel ("Internet de octubre"). Solo con concepto. */
  detalle?: string
  /** Solo para un equipo: en cuántos meses se deprecia. */
  vidaUtil?: string
  /** Desplegado para editar. Plegado, el renglón es una sola línea. */
  abierta?: boolean
  /** Qué tipo de mercancía se eligió primero: filtra la lista de mercancías. */
  tipo?: TipoArticulo
}

const LINEA_VACIA: Linea = { ingrediente_id: 0, cantidad: '', costo_unitario: '', exento: null, abierta: true }

/** Ya dice qué es y cuánto: se puede plegar en una línea. */
function lineaCompleta(l: Linea): boolean {
  return (!!l.ingrediente_id || !!l.concepto) && Number(l.cantidad) > 0 && l.costo_unitario !== ''
}

// En qué paso vive cada campo: un aviso que lleva a él primero abre su paso.
const PASO_DE: Record<string, Numero> = {
  'cf-proveedor': 1, 'cf-rif': 1, 'cf-numero': 1, 'cf-fecha': 1, 'cf-moneda': 1, 'cf-tasa': 1, 'cf-control': 1,
  'cf-referencia': 3, 'cf-vence': 3, 'cf-retencion': 3, 'cf-descripcion': 3,
}
type Numero = 1 | 2 | 3

type Tono = 'mal' | 'ojo'
/** Algo que mirar antes de guardar. `ancla` es el id del elemento al que lleva. */
type Pendiente = { texto: string; tono: Tono; ancla: string }

const soloRif = (x: string) => x.toUpperCase().replace(/[^0-9A-Z]/g, '')

/** Cantidad y costo por unidad nuestra a partir del paquete, o null si falta algo. */
function desdePaquete(p: Paquete): { cantidad: string; costo_unitario: string } | null {
  const trae = Number(p.trae)
  const paquetes = Number(p.paquetes)
  const precio = Number(p.precio)
  if (!(trae > 0)) return null
  return {
    cantidad: paquetes > 0 ? sinRuido(paquetes * trae) : '',
    costo_unitario: precio >= 0 && p.precio !== '' ? sinRuido(precio / trae) : '',
  }
}

export default function CargarFactura({
  ingredientes,
  setIngredientes,
  proveedores,
  fiscal,
  porCompletar,
  onReintentar,
  onGuardada,
  onVerFacturas,
}: {
  ingredientes: Ingrediente[]
  setIngredientes: Dispatch<SetStateAction<Ingrediente[]>>
  proveedores: Proveedor[]
  fiscal: ConfiguracionFiscal
  /** Facturas de este dispositivo que esperan conexión para terminar. */
  porCompletar: number
  onReintentar: () => void
  /** La factura entró. `alertas`: lo que llegó más caro, para mostrar. */
  onGuardada: (alertas: AlertaPrecio[]) => void
  onVerFacturas: () => void
}) {
  const dialogo = useDialogo()
  const hoyISO = new Date().toLocaleDateString('en-CA')

  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [guardando, setGuardando] = useState(false)

  const [numeroFactura, setNumeroFactura] = useState('')
  // La fecha impresa en el papel. Solo se muestra en el Libro de Compras: el
  // periodo lo decide la fecha de registro (hoy), que pone el backend.
  const [fechaEmision, setFechaEmision] = useState('')
  const [proveedor, setProveedor] = useState('')
  const [rif, setRif] = useState('')
  const [monedaCarga, setMonedaCarga] = useState<(typeof MONEDAS_DE_CARGA)[number]>('$')
  const [numeroControl, setNumeroControl] = useState('')
  // La tasa (Bs por $) con que esta factura pasa al Libro de Compras en Bs, y
  // con la que una factura en Bs se pasa a dolares. Es la de la FECHA DE LA
  // FACTURA, no la de hoy. Si el papel imprime su tasa, manda esa.
  const [tasaFactura, setTasaFactura] = useState('')
  const [origenTasa, setOrigenTasa] = useState<'' | 'papel' | 'fecha' | 'escrita'>('')
  const [notaTasa, setNotaTasa] = useState('')
  // Retencion de IVA (si se es agente): '' = la del proveedor (75 si es nuevo).
  const [retencion, setRetencion] = useState<'' | '0' | '75' | '100'>('')
  const [formaPago, setFormaPago] = useState(FORMAS_PAGO[0].valor)
  const [referenciaPago, setReferenciaPago] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([LINEA_VACIA])
  const [recargo, setRecargo] = useState('')
  const [descuentoFactura, setDescuentoFactura] = useState('')
  const [fechaVencimiento, setFechaVencimiento] = useState('')
  // El paso abierto. 0 = los tres plegados: queda el total y Guardar.
  const [paso, setPaso] = useState<Numero | 0>(1)

  // La foto o PDF leido: su soporte se engancha a la factura al guardar.
  const [lectura, setLectura] = useState<LecturaFactura | null>(null)
  const [documento, setDocumento] = useState<{ url: string; esPdf: boolean } | null>(null)

  // Lo que se recuerda de cada proveedor: las presentaciones ("caja de 24")
  // con que ya trajo cada mercancia, para ofrecerlas de un toque.
  const [memoria, setMemoria] = useState<Equivalencia[]>([])
  useEffect(() => {
    api
      .listarEquivalencias()
      .then(setMemoria)
      .catch(() => undefined)
  }, [])

  const esCredito = formaPago === 'Credito'
  const borrador = lectura?.borrador ?? null

  // ── Cuentas del formulario ──────────────────────────────────────────────
  const recargoNum = Number(recargo) || 0
  const descuentoNum = Number(descuentoFactura) || 0
  const baseLineas = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0), 0)
  const baseFinal = Math.round((baseLineas + recargoNum - descuentoNum) * 100) / 100
  // Solo de vista previa: el numero real lo calcula el backend con el mismo
  // criterio. El recargo y el descuento se reparten, asi que mueven el IVA.
  const ivaLineas = useMemo(() => {
    const gravada = lineas.reduce((s, l) => {
      const exento = exentoDe(l)
      return exento ? s : s + (Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0)
    }, 0)
    const factor = baseLineas > 0 ? (baseLineas + recargoNum - descuentoNum) / baseLineas : 1
    return Math.round(gravada * factor * (fiscal.tasa_iva / 100) * 100) / 100
  }, [lineas, ingredientes, fiscal.tasa_iva, recargoNum, descuentoNum, baseLineas])
  const baseMostrada = baseFinal
  const ivaMostrado = ivaLineas
  const proveedorConocido = proveedores.find((p) => p.rif && rif && soloRif(p.rif) === soloRif(rif))
  const retencionEfectiva = retencion || String(proveedorConocido?.porcentaje_retencion ?? 75)
  const totalFormulario = Math.round((baseMostrada + ivaMostrado) * 100) / 100

  // A donde va la plata de esta factura, por tipo de mercancia. Con el
  // recargo y el descuento repartidos, igual que lo hace el servidor.
  const partes: ParteDeLaPlata[] = useMemo(() => {
    const factor = baseLineas > 0 ? baseFinal / baseLineas : 1
    const por = new Map<string, number>()
    for (const l of lineas) {
      const ing = ingredientes.find((x) => x.id === l.ingrediente_id)
      if (!ing) continue
      const monto = (Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0) * factor
      if (monto > 0) por.set(ing.tipo, (por.get(ing.tipo) ?? 0) + monto)
    }
    return [...por].map(([tipo, monto]) => ({ tipo: tipo as Ingrediente['tipo'], monto }))
  }, [lineas, ingredientes, baseLineas, baseFinal])
  // Lo que no es mercancía, por concepto, con el mismo reparto.
  const otrosGastos = useMemo(() => {
    const factor = baseLineas > 0 ? baseFinal / baseLineas : 1
    const por = new Map<ConceptoGasto, number>()
    for (const l of lineas) {
      if (!l.concepto) continue
      const monto = (Number(l.costo_unitario) || 0) * factor
      if (monto > 0) por.set(l.concepto, (por.get(l.concepto) ?? 0) + monto)
    }
    return [...por]
  }, [lineas, baseLineas, baseFinal])

  // El cuadre contra el papel, solo en la misma moneda. Unos centimos no son
  // un error: el IVA se redondea distinto en cada factura.
  const totalPapel = borrador?.total ?? null
  const cuadreAplica = totalPapel !== null && (!borrador?.moneda || borrador.moneda === monedaCarga)
  const diferencia = totalPapel === null ? 0 : Math.round((totalFormulario - totalPapel) * 100) / 100
  const cuadra = cuadreAplica && Math.abs(diferencia) <= Math.max(0.05, Math.abs(totalPapel!) * 0.001)

  const lineasConIva = lineas.filter((l) => Number(l.cantidad) > 0 && !exentoDe(l)).length
  const clienteAjeno = !!borrador?.cliente_rif && !!fiscal.rif && soloRif(borrador.cliente_rif) !== soloRif(fiscal.rif)
  const sinIvaEnPapel =
    !!borrador && borrador.renglones.length > 0 && !borrador.iva && lineasConIva > 0 &&
    totalPapel !== null && borrador.subtotal !== null && Math.abs(totalPapel - borrador.subtotal) < 0.01

  // La tasa BCV de la fecha de la factura (o de hoy, sin fecha). No pisa la
  // que imprime el papel ni la que se escribio a mano.
  const fechaDeTasa = fechaEmision || hoyISO
  useEffect(() => {
    if (origenTasa === 'papel' || origenTasa === 'escrita') return
    let vigente = true
    api
      .tasaDeFecha(fechaDeTasa)
      .then((t) => {
        if (!vigente) return
        setOrigenTasa('fecha')
        if (t.bcv === null) {
          setTasaFactura('')
          setNotaTasa('No hay tasa guardada para esa fecha: escribe la del BCV de ese día.')
          return
        }
        setTasaFactura(String(t.bcv))
        const dia = new Date(`${t.fecha}T12:00:00`).toLocaleDateString('es-VE')
        setNotaTasa(
          t.origen === 'manual'
            ? `La que se fijó a mano el ${dia}: revisa que sea la del BCV.`
            : `BCV del ${dia}${t.fecha !== fechaDeTasa ? ' (último día con tasa antes de esa fecha)' : ''}.`,
        )
      })
      .catch(() => undefined)
    return () => {
      vigente = false
    }
  }, [fechaDeTasa, origenTasa])

  // ── Revisión del servidor: duplicado, precios, RIF ──────────────────────
  const tasaNum = Number(tasaFactura) > 0 ? Number(tasaFactura) : 0
  const aUsdVista = (monto: number) => (monedaCarga === 'Bs' && tasaNum ? monto / tasaNum : monto)
  const revision = useRevision({
    proveedor_rif: rif.trim(),
    proveedor_nombre: proveedor.trim(),
    numero_factura: numeroFactura.trim(),
    items: lineas
      .map((l, indice) => ({ indice, ingrediente_id: l.ingrediente_id, costo_unitario: aUsdVista(Number(l.costo_unitario) || 0) }))
      .filter((x) => x.ingrediente_id && x.costo_unitario > 0),
  })
  const avisoPrecio = (i: number) => revision?.precios.find((p) => p.indice === i && p.nivel !== 'normal')

  // ── Lo que falta revisar, en orden de pantalla ──────────────────────────
  const pendientes: Pendiente[] = []
  if (revision?.duplicadas.length) pendientes.push({ texto: 'Parece ya cargada', tono: 'mal', ancla: 'cf-numero' })
  if (revision?.rif_aviso) pendientes.push({ texto: 'RIF dudoso', tono: 'ojo', ancla: 'cf-rif' })
  if (fechaEmision && fechaEmision > hoyISO) pendientes.push({ texto: 'Fecha futura', tono: 'mal', ancla: 'cf-fecha' })
  else if (fechaEmision && diasDesde(fechaEmision, hoyISO) > DIAS_FACTURA_VIEJA)
    pendientes.push({ texto: 'Factura vieja', tono: 'ojo', ancla: 'cf-fecha' })
  else if (borrador && !fechaEmision) pendientes.push({ texto: 'Fecha sin leer', tono: 'ojo', ancla: 'cf-fecha' })
  {
    // El mismo problema en varios renglones es UN aviso que lleva al primero.
    const porTipo = new Map<string, { tono: Tono; renglones: number[] }>()
    lineas.forEach((l, i) => {
      const p = sinMercanciaEn(l) ? { texto: 'sin decir qué es', tono: 'mal' as Tono } : problemaDeRenglon(l, i)
      if (!p) return
      const grupo = porTipo.get(p.texto) ?? { tono: p.tono, renglones: [] }
      grupo.renglones.push(i)
      porTipo.set(p.texto, grupo)
    })
    for (const [texto, g] of porTipo)
      pendientes.push({
        texto: g.renglones.length === 1 ? `Renglón ${g.renglones[0] + 1}: ${texto}` : `${g.renglones.length} renglones ${texto}`,
        tono: g.tono,
        ancla: `cf-renglon-${g.renglones[0]}`,
      })
  }
  if (cuadreAplica && !cuadra) pendientes.push({ texto: 'No cuadra con el papel', tono: 'ojo', ancla: 'cf-totales' })
  if (!tasaNum) pendientes.push({ texto: 'Falta la tasa', tono: 'mal', ancla: 'cf-tasa' })

  function sinMercanciaEn(l: Linea) {
    return !l.ingrediente_id && !l.concepto && (Number(l.cantidad) > 0 || Number(l.costo_unitario) > 0)
  }

  /** Si el renglón paga IVA: lo que diga esta factura, o la ficha de la mercancía. */
  function exentoDe(l: Linea): boolean {
    if (l.exento !== null) return l.exento
    if (l.concepto) return false
    return Boolean(ingredientes.find((x) => x.id === l.ingrediente_id)?.exento)
  }

  function problemaDeRenglon(l: Linea, i: number): { texto: string; tono: Tono } | null {
    const aviso = avisoPrecio(i)
    if (aviso?.nivel === 'unidad') return { texto: 'con posible error de unidad', tono: 'mal' }
    const ing = ingredientes.find((x) => x.id === l.ingrediente_id)
    if (l.leido && !l.recordada && !l.paquete && ing && unidadDistinta(l.leido.unidad, ing.unidad))
      return { texto: 'con unidad distinta', tono: 'ojo' }
    if (aviso) return { texto: 'con precio fuera de lo normal', tono: 'ojo' }
    return null
  }

  // Un aviso que lleva a un campo de un paso plegado primero lo abre; uno
  // que lleva a un renglón plegado, lo despliega.
  function irA(ancla: string) {
    const renglon = /^cf-renglon-(\d+)$/.exec(ancla)
    const destino: Numero | null = PASO_DE[ancla] ?? (renglon ? 2 : null)
    const hayQueAbrir = (destino !== null && paso !== destino) || (renglon && !lineas[Number(renglon[1])]?.abierta)
    if (destino !== null) setPaso(destino)
    if (renglon) cambiarLinea(Number(renglon[1]), { abierta: true })
    if (hayQueAbrir) setTimeout(() => enfocar(ancla), 60)
    else enfocar(ancla)
  }
  function enfocar(ancla: string) {
    const el = document.getElementById(ancla)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const campo = el?.querySelector<HTMLElement>('select, input') ?? el?.querySelector<HTMLElement>('button')
    campo?.focus({ preventScroll: true })
  }

  // ── Leer un documento ───────────────────────────────────────────────────
  // La IA propone; aca solo se llena el formulario. Nada se guarda hasta que
  // alguien lo revisa y le da Guardar.
  function aplicarLectura(l: LecturaFactura, url: string, esPdf: boolean) {
    limpiarFormulario()
    setExito('')
    setLectura(l)
    setDocumento({ url, esPdf })
    const b = l.borrador
    if (!b) return
    setNumeroFactura(b.numero_factura)
    setNumeroControl(b.numero_control ?? '')
    setFechaEmision(b.fecha ?? '')
    if (b.tasa_cambio) {
      setTasaFactura(String(b.tasa_cambio))
      setOrigenTasa('papel')
      setNotaTasa('La que imprime la factura: con esa calculó el proveedor sus bolívares.')
    } else if (origenTasa === 'papel') {
      setOrigenTasa('')
    }
    // Si el RIF ya esta en el directorio, manda el nombre de alli.
    const conocido = b.proveedor_rif ? proveedores.find((p) => p.rif && soloRif(p.rif) === soloRif(b.proveedor_rif)) : undefined
    setProveedor(conocido?.nombre ?? b.proveedor_nombre)
    const rifFactura = conocido?.rif ?? b.proveedor_rif
    setRif(rifFactura)
    if (b.moneda) setMonedaCarga(b.moneda)
    setRecargo(b.recargo ? String(b.recargo) : '')
    setDescuentoFactura(b.descuento ? String(b.descuento) : '')
    // Con los datos de la factura leidos, se abre de una vez lo que trae.
    setPaso(b.proveedor_rif && b.numero_factura ? 2 : 1)
    if (b.renglones.length === 0) {
      // Un papel sin renglones (la luz, un servicio): un solo renglon de
      // servicio por el subtotal. Si es otra cosa, se cambia en el renglon.
      setLineas([
        {
          ...LINEA_VACIA,
          concepto: 'Servicio',
          cantidad: '1',
          costo_unitario: b.subtotal == null ? '' : String(b.subtotal),
          exento: b.subtotal != null && !b.iva ? true : null,
        },
      ])
      return
    }
    // Un papel que no cobra IVA (total = subtotal) deja sus renglones sin
    // IVA de entrada. Lo que el papel marca renglon por renglon manda igual.
    const papelSinIva =
      !b.iva && b.subtotal != null && b.total != null && Math.abs(b.total - (b.subtotal + b.recargo - b.descuento)) < 0.01
    setLineas(
      b.renglones.map((r) => ({
        ...LINEA_VACIA,
        cantidad: r.cantidad == null ? '' : String(r.cantidad),
        costo_unitario: r.precio_unitario == null ? '' : String(r.precio_unitario),
        exento: r.exento ?? (papelSinIva ? true : null),
        leido: r,
        abierta: false,
      })),
    )
    // Lo que ya se sabe de este proveedor: mercancia y conversion de unidad.
    // Llega despues del prellenado; si alguien ya toco ese renglon, manda lo
    // que toco. Una conversion ("1 BULTO = 20 kg") se muestra como el paquete
    // del renglon: se ve y se corrige en el mismo sitio que una escrita a mano.
    api
      .buscarEquivalencias(rifFactura, b.renglones.map((r) => ({ descripcion: r.descripcion, unidad: r.unidad })))
      .then((sugerencias) =>
        setLineas((prev) =>
          prev.map((l, i) => {
            const s = sugerencias.find((x) => x.indice === i)
            if (!s || l.leido !== b.renglones[i] || l.ingrediente_id) return l
            const enPaquete = Math.abs(s.factor - 1) > 1e-9 && s.factor > 0
            const paquete: Paquete | undefined = enPaquete
              ? {
                  nombre: s.unidad_papel || 'paquete',
                  trae: sinRuido(s.factor),
                  paquetes: l.leido.cantidad == null ? '' : String(l.leido.cantidad),
                  precio: l.leido.precio_unitario == null ? '' : String(l.leido.precio_unitario),
                }
              : undefined
            const calc = paquete ? desdePaquete(paquete) : null
            return {
              ...l,
              ingrediente_id: s.ingrediente_id,
              cantidad: calc ? calc.cantidad : l.cantidad,
              costo_unitario: calc ? calc.costo_unitario : l.costo_unitario,
              recordada: s,
              paquete,
            }
          }),
        ),
      )
      .catch(() => undefined)
  }

  // ── Renglones ───────────────────────────────────────────────────────────
  function cambiarLinea(i: number, cambio: Partial<Linea>) {
    setLineas((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...cambio } : l)))
  }

  // El renglon para el que se esta creando una mercancia nueva.
  const [creandoEn, setCreandoEn] = useState<number | null>(null)

  function elegirMercancia(i: number, id: number) {
    // Sin costo todavia, se propone lo que ya cuesta esa mercancia: solo se
    // corrige si el proveedor la vendio distinto.
    const ing = ingredientes.find((x) => x.id === id)
    setLineas((prev) =>
      prev.map((l, idx) =>
        idx === i
          ? {
              ...l,
              ingrediente_id: id,
              costo_unitario: l.costo_unitario || (ing && ing.costo_unitario ? String(ing.costo_unitario) : ''),
              // Cambio la mercancia: la conversion que se recordaba era de la otra.
              paquete: l.paquete && l.recordada && l.recordada.ingrediente_id !== id ? undefined : l.paquete,
            }
          : l,
      ),
    )
  }

  /** Las presentaciones con que este proveedor ya trajo esa mercancía. */
  function paquetesConocidos(ingredienteId: number): Equivalencia[] {
    if (!rif.trim() || !ingredienteId) return []
    const r = soloRif(rif)
    const vistos = new Set<string>()
    return memoria.filter((e) => {
      if (e.ingrediente_id !== ingredienteId || soloRif(e.proveedor_rif) !== r || Math.abs(e.factor - 1) < 1e-9) return false
      const clave = `${e.unidad_papel.toLowerCase()}|${e.factor}`
      if (vistos.has(clave)) return false
      vistos.add(clave)
      return true
    })
  }

  // El primer desplegable del renglon: que es. Un tipo de mercancia filtra el
  // segundo (y si la elegida era de otro tipo, se suelta); un concepto (flete,
  // servicio) lo vuelve un renglon de gasto.
  function elegirTipo(i: number, valor: string) {
    if (CONCEPTOS.some((c) => c.valor === valor)) return elegirConcepto(i, valor as ConceptoGasto)
    const tipo = (valor || undefined) as TipoArticulo | undefined
    if (lineas[i]?.concepto) elegirConcepto(i, undefined)
    setLineas((prev) =>
      prev.map((l, idx) => {
        if (idx !== i) return l
        const ing = ingredientes.find((x) => x.id === l.ingrediente_id)
        const suelta = !!ing && !!tipo && ing.tipo !== tipo
        return { ...l, tipo, ...(suelta ? { ingrediente_id: 0, paquete: undefined, recordada: undefined } : {}) }
      }),
    )
  }

  // El renglon deja de ser mercancia (o vuelve a serlo). Lo escrito del papel
  // se queda: el monto es lo que cobra, venga como venga.
  function elegirConcepto(i: number, concepto: ConceptoGasto | undefined) {
    setLineas((prev) =>
      prev.map((l, idx) => {
        if (idx !== i) return l
        if (!concepto) return { ...l, concepto: undefined, detalle: undefined, vidaUtil: undefined, cantidad: l.leido?.cantidad != null ? String(l.leido.cantidad) : '' }
        const monto =
          l.leido?.subtotal != null
            ? String(l.leido.subtotal)
            : Number(l.cantidad) > 0 && l.costo_unitario !== ''
              ? sinRuido(Number(l.cantidad) * Number(l.costo_unitario))
              : l.costo_unitario
        return {
          ...l,
          ingrediente_id: 0,
          paquete: undefined,
          recordada: undefined,
          concepto,
          cantidad: '1',
          costo_unitario: monto,
          detalle: l.detalle ?? l.leido?.descripcion ?? '',
          vidaUtil: concepto === 'Equipo' ? l.vidaUtil ?? '60' : undefined,
          exento: l.exento,
          abierta: true,
        }
      }),
    )
  }

  function elegirProveedorConocido(nombre: string) {
    setProveedor(nombre)
    const p = proveedores.find((x) => x.nombre === nombre)
    if (p?.rif) setRif(p.rif)
  }

  function limpiarFormulario() {
    setError('')
    setNumeroFactura('')
    setFechaEmision('')
    setProveedor('')
    setRif('')
    setDescripcion('')
    setReferenciaPago('')
    setLineas([LINEA_VACIA])
    setRecargo('')
    setDescuentoFactura('')
    setFechaVencimiento('')
    setMonedaCarga('$')
    setNumeroControl('')
    setOrigenTasa('')
    setRetencion('')
    setPaso(1)
    setLectura(null)
    setDocumento(null)
  }

  // ── Guardar ─────────────────────────────────────────────────────────────
  async function guardar(forzarDuplicado = false) {
    setError('')
    setExito('')
    if (!numeroFactura.trim() || !proveedor.trim()) return falla('Completa al menos el número de factura y el proveedor', 'cf-numero')
    if (!rif.trim()) return falla('El RIF del proveedor es obligatorio', 'cf-rif')
    if (fechaEmision && fechaEmision > hoyISO) return falla('La fecha de la factura no puede ser futura', 'cf-fecha')
    // Todo el sistema costea en dolares. Una factura en bolivares se pasa aca
    // a dolares con la tasa de SU fecha, y esa misma tasa viaja al backend.
    if (!tasaNum) return falla('Falta la tasa de cambio de la fecha de la factura: el Libro de Compras va en bolívares.', 'cf-tasa')
    const aUsd = (monto: number) => (monedaCarga === 'Bs' ? monto / tasaNum : monto)

    const sinDecir = lineas.findIndex(sinMercanciaEn)
    if (sinDecir >= 0) return falla('Falta decir qué es algún renglón: elige la mercancía, márcalo como flete o servicio, o quítalo.', `cf-renglon-${sinDecir}`)
    const gastoSinMonto = lineas.findIndex((l) => l.concepto && !(Number(l.costo_unitario) > 0))
    if (gastoSinMonto >= 0) return falla('Falta el monto de algún renglón.', `cf-renglon-${gastoSinMonto}`)

    const items = lineas
      .filter((l) => !l.concepto && l.ingrediente_id && Number(l.cantidad) > 0 && Number(l.costo_unitario) >= 0)
      .map((l) => ({
        ingrediente_id: l.ingrediente_id,
        cantidad: Number(l.cantidad),
        costo_unitario: aUsd(Number(l.costo_unitario)),
        ...(l.exento === null ? {} : { exento: l.exento }),
      }))
    const gastos = lineas
      .filter((l) => l.concepto && Number(l.costo_unitario) > 0)
      .map((l) => ({
        concepto: l.concepto!,
        descripcion: (l.detalle ?? '').trim(),
        monto: aUsd(Number(l.costo_unitario)),
        exento: exentoDe(l),
        ...(l.concepto === 'Equipo' ? { vida_util_meses: Number(l.vidaUtil) || 60 } : {}),
      }))
    if (items.length === 0 && gastos.length === 0) return falla('Agrega al menos un renglón con cantidad y costo')

    // Se pregunta al momento, no con la revision de hace un rato: pudieron
    // cargarla en otra tablet mientras tanto.
    const yaCargadas = await api
      .revisarFacturaCompra({ proveedor_rif: rif.trim(), proveedor_nombre: proveedor.trim(), numero_factura: numeroFactura.trim(), items: [] })
      .then((r) => r.duplicadas)
      .catch(() => [])
    if (
      !forzarDuplicado &&
      yaCargadas.length > 0 &&
      !(await dialogo.confirmar({
        titulo: 'Esta factura parece ya cargada',
        texto: `Ya hay una ${yaCargadas[0].numero_factura} de ${yaCargadas[0].proveedor_nombre}. Guardarla otra vez duplica la mercancía en el depósito y el gasto.`,
        aceptar: 'Guardar igual',
        peligro: true,
      }))
    )
      return

    // Lo que el papel decia y lo que quedo: de ahi aprende la memoria del
    // proveedor. Se toma ANTES de guardar, que despues se limpia el formulario.
    const cuerpoCompletar = {
      soporte_id: lectura?.soporte_id ?? null,
      proveedor_rif: rif.trim(),
      proveedor_nombre: proveedor.trim(),
      renglones: lectura
        ? lineas
            .filter((l) => l.leido && l.ingrediente_id && Number(l.cantidad) > 0)
            .map((l) => ({
              descripcion: l.leido!.descripcion,
              unidad: l.leido!.unidad,
              cantidad_papel: l.leido!.cantidad,
              precio_papel: l.leido!.precio_unitario,
              ingrediente_id: l.ingrediente_id,
              cantidad: Number(l.cantidad),
              costo_unitario: Number(l.costo_unitario),
            }))
        : [],
    }
    // Un paquete escrito a mano ("2 cajas de 24") tambien se recuerda para
    // ese proveedor: la proxima vez la caja aparece de un toque.
    const paquetesAMano = lectura
      ? []
      : lineas
          .filter((l) => l.paquete && l.ingrediente_id && Number(l.cantidad) > 0 && Number(l.paquete.trae) > 0)
          .map((l) => {
            const ing = ingredientes.find((x) => x.id === l.ingrediente_id)
            return {
              descripcion: `${ing?.nombre ?? ''} ${l.paquete!.nombre} de ${l.paquete!.trae}`.trim(),
              unidad: l.paquete!.nombre,
              cantidad_papel: Number(l.paquete!.paquetes) || null,
              precio_papel: Number(l.paquete!.precio) || null,
              ingrediente_id: l.ingrediente_id,
              cantidad: Number(l.cantidad),
              costo_unitario: Number(l.costo_unitario),
            }
          })
    const esPdf = documento?.esPdf ?? false

    setGuardando(true)
    try {
      const comun = {
        numero_factura: numeroFactura.trim(),
        fecha_emision: fechaEmision || undefined,
        numero_control: numeroControl.trim(),
        moneda: monedaCarga,
        tasa_bcv: tasaNum,
        retencion_pct: fiscal.agente_retencion ? Number(retencionEfectiva) : undefined,
        proveedor_nombre: proveedor.trim(),
        proveedor_rif: rif.trim(),
        // La categoria ya no se elige: con renglones de gasto el servidor la
        // saca de lo que trae la factura.
        categoria: 'Insumos',
        forma_pago: formaPago,
        descripcion: descripcion.trim(),
        recargo: aUsd(recargoNum),
        descuento: aUsd(descuentoNum),
        fecha_vencimiento: esCredito && fechaVencimiento ? fechaVencimiento : undefined,
        referencia_pago: referenciaPago.trim() || undefined,
        // Ya se pregunto y se dijo "guardar igual": el servidor no la rechaza.
        confirmar_duplicado: forzarDuplicado || yaCargadas.length > 0,
      }
      await anotarAntesDeGuardar(numeroFactura.trim(), cuerpoCompletar)
      const guardada = await api.crearFacturaCompra({ ...comun, items, gastos, iva: ivaLineas })
      limpiarFormulario()

      if (paquetesAMano.length > 0) {
        api
          .aprenderEquivalencias({ proveedor_rif: comun.proveedor_rif, proveedor_nombre: comun.proveedor_nombre, renglones: paquetesAMano })
          .then(() => api.listarEquivalencias().then(setMemoria))
          .catch(() => undefined)
      }

      // Foto, memoria y alertas: un pedido que se puede repetir. La factura
      // ya entro: si falla, se avisa y se reintenta, no se deshace.
      const r = await completarDespuesDeGuardar(guardada.id, cuerpoCompletar)
      let cola = ''
      if (r.estado === 'hecho') {
        if (r.fotoPerdida) cola = esPdf ? ' Ojo: el PDF ya no estaba guardado y la factura quedó sin él.' : ' Ojo: la foto ya no estaba guardada y la factura quedó sin ella.'
        else if (r.foto) cola = esPdf ? ' PDF adjunto.' : ' Foto adjunta.'
      } else if (r.estado === 'pendiente') {
        cola = cuerpoCompletar.soporte_id
          ? ' Sin conexión para terminar: la foto, la memoria del proveedor y las alertas las completa el servidor solo.'
          : ' Sin conexión para revisar los precios: el servidor lo hace solo.'
      } else {
        cola = ` Ojo: ${r.mensaje}`
      }
      setExito(
        `Factura ${guardada.numero_factura} cargada: $${guardada.total.toFixed(2)} ` +
          `(base $${guardada.base_imponible.toFixed(2)} + IVA $${guardada.iva.toFixed(2)}).` +
          (guardada.items.length ? ` ${guardada.items.length} renglón(es) de mercancía.` : '') +
          (guardada.gastos?.length ? ` ${guardada.gastos.length} de flete o servicios.` : '') +
          cola,
      )
      onGuardada(r.estado === 'hecho' ? r.alertas : [])
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
      // Otra tablet la guardo justo antes: el servidor la frena y se pregunta.
      if (e instanceof ErrorApi && e.status === 409 && e.message.startsWith('Ya está cargada')) {
        setGuardando(false)
        if (await dialogo.confirmar({ titulo: 'Esta factura ya entró', texto: `${e.message} ¿La guardo igual?`, aceptar: 'Guardar igual', peligro: true }))
          return guardar(true)
        return
      }
      setError(e instanceof Error ? e.message : 'No se pudo cargar la factura')
    } finally {
      setGuardando(false)
    }
  }

  function falla(mensaje: string, ancla?: string) {
    setError(mensaje)
    if (ancla) irA(ancla)
  }

  // ── Pantalla ────────────────────────────────────────────────────────────
  const conDocumento = documento !== null
  const datosListos = !!proveedor.trim() && !!rif.trim() && !!numeroFactura.trim() && !!tasaNum
  const fmtFecha = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-VE')
  // "Listo" pliega el paso y abre el siguiente, que queda arriba en pantalla.
  function siguiente(n: Numero | 0) {
    setPaso(n)
    if (n) setTimeout(() => document.getElementById(`cf-paso-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
    else setTimeout(() => document.getElementById('cf-totales')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
  }
  const forma = FORMAS_PAGO.find((f) => f.valor === formaPago)?.texto ?? formaPago
  return (
    <div className="space-y-4">
      {porCompletar > 0 && (
        <div className="rounded-2xl bg-aviso-500/10 px-4 py-3 text-sm text-aviso-800 flex items-center justify-between gap-3">
          <span>
            {porCompletar === 1 ? 'Una factura guardada espera' : `${porCompletar} facturas guardadas esperan`} conexión para
            terminar (foto, memoria del proveedor, alertas). Se reintenta sola.
          </span>
          <button onClick={onReintentar} className="font-semibold shrink-0 underline">
            Reintentar ahora
          </button>
        </div>
      )}
      {exito && (
        <div className="rounded-2xl bg-exito-500/10 px-4 py-3 text-sm text-exito-800 flex items-start justify-between gap-3">
          <span className="flex items-start gap-2">
            <Icono nombre="ok" size={16} className="mt-0.5 shrink-0" />
            {exito}
          </span>
          <button onClick={onVerFacturas} className="font-semibold shrink-0 underline">
            Verla
          </button>
        </div>
      )}

      {!conDocumento && <ZonaDocumento onLeida={aplicarLectura} />}

      <div className={conDocumento ? 'lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-4 lg:items-start' : ''}>
        {conDocumento && <VisorDocumento url={documento.url} esPdf={documento.esPdf} />}

        <div className="space-y-4">
          {lectura && !borrador && (
            <Nota tono="ojo">
              No se pudo leer {documento?.esPdf ? 'el PDF' : 'la foto'}: {lectura.error} Cárgala a mano mirando el
              documento: se adjunta igual al guardar.
            </Nota>
          )}
          {clienteAjeno && (
            <Nota tono="mal">
              Esta factura está a nombre del RIF {borrador?.cliente_rif}, no de {fiscal.razon_social || 'la empresa'} (
              {fiscal.rif}). Su IVA no se puede usar como crédito fiscal: pídele al proveedor una factura a nombre de la
              empresa.
            </Nota>
          )}
          {borrador?.advertencias.map((a) => (
            <Nota key={a} tono="ojo">
              La IA avisa: {a}
            </Nota>
          ))}
          {error && <Nota tono="mal">{error}</Nota>}

          {/* ── Paso 1: la factura ── */}
          <Paso
            numero={1}
            titulo="La factura"
            detalle={conDocumento ? 'Lo marcado con ✦ lo leyó la IA. Compáralo con el papel.' : 'Quién la emitió, cuál es y de cuándo.'}
            abierto={paso === 1}
            onAbrir={() => setPaso(paso === 1 ? 0 : 1)}
            onListo={() => siguiente(2)}
            hecho={datosListos}
            resumen={
              <>
                <span className="font-medium text-neutral-800">{proveedor || <Falta>falta el proveedor</Falta>}</span>
                {' · '}N.º {numeroFactura || <Falta>falta</Falta>}
                {fechaEmision && ` · ${fmtFecha(fechaEmision)}`}
                {' · '}
                {monedaCarga === '$' ? 'en $' : 'en Bs'} a {tasaNum ? fmtNum(tasaNum, 2) : <Falta>falta la tasa</Falta>}
              </>
            }
            accion={
              conDocumento ? (
                <button onClick={limpiarFormulario} className="text-xs text-neutral-500 font-medium underline">
                  Descartar
                </button>
              ) : undefined
            }
          >
            <div className="grid grid-cols-2 gap-3">
              <Dato id="cf-proveedor" etiqueta="Proveedor" ia={!!borrador && proveedor === (borrador.proveedor_nombre || proveedor)} className="col-span-2">
                <CampoSugerido
                  value={proveedor}
                  onChange={elegirProveedorConocido}
                  opciones={proveedores.filter((p) => p.activo).map((p) => p.nombre)}
                  placeholder="Nombre del proveedor"
                  vacio="Todavía no hay proveedores guardados"
                />
              </Dato>
              <Dato
                id="cf-rif"
                etiqueta="RIF"
                ia={!!borrador && rif === borrador.proveedor_rif && !!rif}
                tono={revision?.rif_aviso ? 'ojo' : undefined}
                nota={
                  revision?.rif_aviso && (
                    <>
                      {revision.rif_aviso}
                      {revision.rif_sugerido && (
                        <>
                          {' '}
                          <button
                            type="button"
                            className="font-semibold underline"
                            onClick={() => {
                              setRif(revision.rif_sugerido!.rif)
                              if (!proveedor.trim()) setProveedor(revision.rif_sugerido!.nombre)
                            }}
                          >
                            ¿Es {revision.rif_sugerido.rif} ({revision.rif_sugerido.nombre})? Usarlo
                          </button>
                        </>
                      )}
                    </>
                  )
                }
              >
                <input value={rif} onChange={(e) => setRif(e.target.value)} placeholder="J-12345678-9" className={clase(revision?.rif_aviso ? 'ojo' : undefined)} />
              </Dato>
              <Dato
                id="cf-numero"
                etiqueta="N.º de factura"
                ia={!!borrador && numeroFactura === borrador.numero_factura && !!numeroFactura}
                tono={revision?.duplicadas.length ? 'mal' : undefined}
                nota={
                  revision?.duplicadas.length
                    ? revision.duplicadas
                        .map((d) => `Ya cargada: ${d.numero_factura} de ${d.proveedor_nombre}, del ${new Date(d.fecha).toLocaleDateString('es-VE')}, por $${d.total.toFixed(2)}.`)
                        .join(' ')
                    : undefined
                }
              >
                <input value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} placeholder="00001234" className={clase(revision?.duplicadas.length ? 'mal' : undefined)} />
              </Dato>
              <Dato
                id="cf-fecha"
                etiqueta="Fecha de la factura"
                ia={!!borrador && !!fechaEmision && fechaEmision === borrador.fecha}
                tono={
                  fechaEmision && fechaEmision > hoyISO
                    ? 'mal'
                    : (fechaEmision && diasDesde(fechaEmision, hoyISO) > DIAS_FACTURA_VIEJA) || (borrador && !fechaEmision)
                      ? 'ojo'
                      : undefined
                }
                nota={
                  fechaEmision && fechaEmision > hoyISO
                    ? 'Es futura: revisa el año contra el papel.'
                    : fechaEmision && diasDesde(fechaEmision, hoyISO) > DIAS_FACTURA_VIEJA
                      ? `Tiene ${diasDesde(fechaEmision, hoyISO)} días. Revisa el año; si está bien, entra al Libro de Compras de este mes: confirma con quien lleva la contabilidad si ese crédito fiscal todavía se puede descontar.`
                      : borrador && !fechaEmision
                        ? 'La IA no la leyó con seguridad: escríbela mirando el papel.'
                        : undefined
                }
              >
                <input value={fechaEmision} onChange={(e) => setFechaEmision(e.target.value)} type="date" max={hoyISO} className={clase()} />
              </Dato>
              <Dato id="cf-control" etiqueta="N.º de control" ia={!!borrador?.numero_control && numeroControl === borrador.numero_control}>
                <input value={numeroControl} onChange={(e) => setNumeroControl(e.target.value)} placeholder="00-00000000" className={clase()} />
              </Dato>
              <Dato id="cf-moneda" etiqueta="Montos en" ia={!!borrador?.moneda && monedaCarga === borrador.moneda}>
                <Filtros
                  tamano="chico"
                  opciones={[
                    { valor: '$' as const, texto: 'Dólares' },
                    { valor: 'Bs' as const, texto: 'Bolívares' },
                  ]}
                  activo={monedaCarga}
                  alElegir={setMonedaCarga}
                />
              </Dato>
              <Dato
                id="cf-tasa"
                etiqueta="Tasa (Bs por $)"
                ia={origenTasa === 'papel'}
                tono={!tasaNum ? 'mal' : undefined}
                nota={
                  !tasaNum
                    ? notaTasa || 'Escribe la tasa BCV del día de la factura.'
                    : `${notaTasa}${monedaCarga === '$' && totalFormulario > 0 ? ` Al libro: Bs ${fmtNum(totalFormulario * tasaNum, 2)}.` : ''}`
                }
              >
                <Numerico
                  value={tasaFactura}
                  onChange={(e) => {
                    setTasaFactura(e.target.value)
                    setOrigenTasa('escrita')
                    setNotaTasa('Escrita a mano.')
                  }}
                  className={clase(!tasaNum ? 'mal' : undefined)}
                />
              </Dato>
            </div>
          </Paso>

          {/* ── Paso 2: qué trae ── */}
          <Paso
            numero={2}
            titulo="Qué trae"
            detalle="Cada renglón dice qué es: una mercancía del inventario, o flete, servicio, equipo u otro gasto."
            abierto={paso === 2}
            onAbrir={() => setPaso(paso === 2 ? 0 : 2)}
            onListo={() => siguiente(3)}
            hecho={lineas.some(lineaCompleta) && !lineas.some(sinMercanciaEn)}
            resumen={<ResumenRenglones lineas={lineas} ingredientes={ingredientes} moneda={monedaCarga} total={baseLineas} />}
          >
            <div className="space-y-2">
              {lineas.map((l, i) => (
                <Renglon
                  key={l.leido ? `papel-${i}` : `mano-${i}`}
                  indice={i}
                  linea={l}
                  ingredientes={ingredientes}
                  moneda={monedaCarga}
                  tasaIva={fiscal.tasa_iva}
                  exento={exentoDe(l)}
                  aviso={avisoPrecio(i)}
                  problema={sinMercanciaEn(l) ? { texto: 'Falta decir qué es', tono: 'mal' } : problemaDeRenglon(l, i)}
                  puedeQuitar={lineas.length > 1}
                  conocidos={paquetesConocidos(l.ingrediente_id)}
                  onCambiar={(cambio) => cambiarLinea(i, cambio)}
                  onMercancia={(id) => elegirMercancia(i, id)}
                  onTipo={(v) => elegirTipo(i, v)}
                  onCrear={() => setCreandoEn(i)}
                  onQuitar={() => setLineas((prev) => prev.filter((_, idx) => idx !== i))}
                />
              ))}
            </div>
            <button
              type="button"
              // Lo que ya esta completo se pliega: el renglon nuevo queda a la vista.
              onClick={() => setLineas((prev) => [...prev.map((l) => (lineaCompleta(l) ? { ...l, abierta: false } : l)), LINEA_VACIA])}
              className="mt-2 w-full inline-flex items-center justify-center gap-1.5 rounded-2xl border border-dashed border-neutral-300 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-500/5"
            >
              <Icono nombre="mas" size={14} />
              Otro renglón
            </button>

            {sinIvaEnPapel && (
              <div className="mt-4">
                <Nota tono="ojo">
                  La factura no trae IVA, pero {lineasConIva} renglón(es) lo están sumando.{' '}
                  <button type="button" className="font-semibold underline" onClick={() => setLineas((prev) => prev.map((l) => ({ ...l, exento: true })))}>
                    Marcar todos exentos
                  </button>
                </Nota>
              </div>
            )}

            {(partes.length > 0 || otrosGastos.length > 0) && (
              <div className="mt-4 rounded-2xl bg-neutral-500/6 p-4 space-y-2">
                {partes.length > 0 && <DestinoPlata partes={partes} moneda={monedaCarga} titulo="A dónde va la plata" />}
                {otrosGastos.length > 0 && (
                  <p className="text-xs text-neutral-600 flex flex-wrap gap-x-3 gap-y-1">
                    {partes.length === 0 && <span className="font-semibold text-neutral-700">A dónde va la plata:</span>}
                    {otrosGastos.map(([c, monto]) => (
                      <span key={c} className="inline-flex items-center gap-1.5 tabular-nums">
                        <span aria-hidden className="w-2 h-2 rounded-full ring-1 ring-neutral-400" />
                        {TEXTO_CONCEPTO[c]} {monedaCarga}
                        {fmtNum(monto, 2)} {c === 'Equipo' ? 'a equipos' : 'a gasto'}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            )}
          </Paso>

          {/* ── Paso 3: el pago ── */}
          <Paso
            numero={3}
            titulo="El pago"
            detalle={esCredito ? 'Queda en cuentas por pagar hasta que se registre el pago.' : 'La plata ya salió al cargarla.'}
            abierto={paso === 3}
            onAbrir={() => setPaso(paso === 3 ? 0 : 3)}
            onListo={() => siguiente(0)}
            hecho={!necesitaReferencia(formaPago) || !!referenciaPago.trim()}
            resumen={
              <>
                <span className="font-medium text-neutral-800">{forma}</span>
                {esCredito && fechaVencimiento && ` · vence ${fmtFecha(fechaVencimiento)}`}
                {referenciaPago.trim() && ` · ref. ${referenciaPago.trim()}`}
                {necesitaReferencia(formaPago) && !referenciaPago.trim() && (
                  <>
                    {' · '}
                    <Falta>falta la referencia</Falta>
                  </>
                )}
              </>
            }
          >
            <Filtros opciones={FORMAS_PAGO} activo={formaPago} alElegir={setFormaPago} className="mb-3" />
            <div className="grid grid-cols-2 gap-3">
              {necesitaReferencia(formaPago) && (
                <Dato id="cf-referencia" etiqueta="Referencia del pago">
                  <input value={referenciaPago} onChange={(e) => setReferenciaPago(e.target.value)} className={clase()} />
                </Dato>
              )}
              {esCredito && (
                <Dato id="cf-vence" etiqueta="Vence">
                  <input value={fechaVencimiento} onChange={(e) => setFechaVencimiento(e.target.value)} type="date" className={clase()} />
                </Dato>
              )}
              {fiscal.agente_retencion && ivaMostrado > 0 && (
                <Dato
                  id="cf-retencion"
                  etiqueta="Retención de IVA"
                  nota={
                    Number(retencionEfectiva) > 0
                      ? `Se retienen ${monedaCarga}${((ivaMostrado * Number(retencionEfectiva)) / 100).toFixed(2)} (van al SENIAT). Al proveedor: ${monedaCarga}${(totalFormulario - (ivaMostrado * Number(retencionEfectiva)) / 100).toFixed(2)}.`
                      : 'No se retiene: al proveedor se le paga el total.'
                  }
                >
                  <select value={retencionEfectiva} onChange={(e) => setRetencion(e.target.value as '0' | '75' | '100')} className={clase()}>
                    <option value="75">75 %</option>
                    <option value="100">100 %</option>
                    <option value="0">No retener</option>
                  </select>
                </Dato>
              )}
              <Dato id="cf-descripcion" etiqueta="Nota (opcional)" className="col-span-2">
                <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className={clase()} />
              </Dato>
            </div>
          </Paso>

          <Totales
            id="cf-totales"
            moneda={monedaCarga}
            recargo={recargo}
            descuento={descuentoFactura}
            onRecargo={setRecargo}
            onDescuento={setDescuentoFactura}
            iaRecargo={!!borrador?.recargo && Number(recargo) === borrador.recargo}
            iaDescuento={!!borrador?.descuento && Number(descuentoFactura) === borrador.descuento}
            papelAjustes={cuadreAplica && borrador ? { recargo: borrador.recargo, descuento: borrador.descuento } : null}
            base={baseMostrada}
            iva={ivaMostrado}
            total={totalFormulario}
            tasaIva={fiscal.tasa_iva}
            papel={cuadreAplica && borrador ? { subtotal: borrador.subtotal, iva: borrador.iva, total: totalPapel! } : null}
            cuadra={cuadra}
          />
        </div>
      </div>

      {creandoEn !== null && (
        <NuevaMercancia
          ingredientes={ingredientes}
          nombre={nombreDesdePapel(lineas[creandoEn]?.leido?.descripcion ?? '')}
          unidad={unidadNuestra(lineas[creandoEn]?.leido?.unidad ?? '') || 'kg'}
          exento={Boolean(lineas[creandoEn]?.exento ?? lineas[creandoEn]?.leido?.exento)}
          tipo={lineas[creandoEn]?.tipo ?? null}
          delPapel={lineas[creandoEn]?.leido?.descripcion}
          onUsar={(ing) => {
            const i = creandoEn
            setCreandoEn(null)
            elegirMercancia(i, ing.id)
          }}
          onCreada={(creada, presentacion: Presentacion | null) => {
            setIngredientes((prev) => [...prev, creada])
            const l = lineas[creandoEn]
            const paquete: Paquete | undefined = presentacion
              ? {
                  nombre: presentacion.nombre,
                  trae: sinRuido(presentacion.trae),
                  paquetes: l?.leido?.cantidad != null ? String(l.leido.cantidad) : l?.cantidad ?? '',
                  precio: l?.leido?.precio_unitario != null ? String(l.leido.precio_unitario) : l?.costo_unitario ?? '',
                }
              : undefined
            const calc = paquete ? desdePaquete(paquete) : null
            cambiarLinea(creandoEn, {
              ingrediente_id: creada.id,
              paquete,
              ...(calc ? { cantidad: calc.cantidad, costo_unitario: calc.costo_unitario } : {}),
            })
            setCreandoEn(null)
          }}
          onCerrar={() => setCreandoEn(null)}
        />
      )}

      <BarraGuardar
        pendientes={pendientes}
        cuadre={cuadreAplica ? (cuadra ? 'cuadra' : `No cuadra: diferencia ${monedaCarga}${diferencia.toFixed(2)}`) : null}
        total={`${monedaCarga}${fmtNum(totalFormulario, 2)}`}
        guardando={guardando}
        onIrA={irA}
        onGuardar={() => void guardar()}
      />
    </div>
  )
}

// ── Piezas ────────────────────────────────────────────────────────────────

function clase(tono?: Tono) {
  const borde = tono === 'mal' ? 'border-peligro-400 ring-1 ring-peligro-200' : tono === 'ojo' ? 'border-aviso-400 ring-1 ring-aviso-200' : 'border-neutral-300'
  return `w-full border ${borde} rounded-xl px-3 py-2 text-sm bg-white`
}

/**
 * Un paso de la carga. Abierto se llena; plegado es una línea con lo que ya
 * tiene, para que en el teléfono no haya que bajar por lo que ya se llenó.
 * "Listo" lo pliega y abre el siguiente. Tocar el título lo abre o lo pliega.
 */
function Paso({
  numero,
  titulo,
  detalle,
  accion,
  abierto,
  onAbrir,
  onListo,
  hecho,
  resumen,
  children,
}: {
  numero: Numero
  titulo: string
  detalle?: ReactNode
  accion?: ReactNode
  abierto: boolean
  onAbrir: () => void
  onListo: () => void
  /** Ya tiene lo que necesita: plegado lleva el visto en vez del número. */
  hecho: boolean
  /** Lo que se ve plegado. */
  resumen: ReactNode
  children: ReactNode
}) {
  const visto = hecho && !abierto
  return (
    <section id={`cf-paso-${numero}`} className="vp-losa scroll-mt-20">
      <div className="flex items-start gap-3 p-4 sm:px-5">
        <button type="button" onClick={onAbrir} aria-expanded={abierto} className="flex-1 min-w-0 flex items-start gap-3 text-left">
          <span
            className={`shrink-0 w-7 h-7 rounded-full grid place-items-center text-xs font-bold tabular-nums ${
              visto ? 'bg-exito-600 text-white' : abierto ? 'bg-neutral-900 text-white' : 'bg-neutral-500/15 text-neutral-600'
            }`}
          >
            {visto ? <Icono nombre="ok" size={14} /> : numero}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display font-semibold tracking-tight leading-tight">{titulo}</span>
            {abierto ? (
              detalle && <span className="block text-xs text-neutral-500 mt-0.5 leading-relaxed">{detalle}</span>
            ) : (
              <span className="block text-xs text-neutral-500 mt-0.5 leading-relaxed truncate">{resumen}</span>
            )}
          </span>
          <span aria-hidden className={`shrink-0 mt-1 text-neutral-400 transition-transform ${abierto ? 'rotate-90' : ''}`}>
            <Icono nombre="chevron" size={16} />
          </span>
        </button>
        {abierto && accion && <div className="shrink-0">{accion}</div>}
      </div>
      {abierto && (
        <div className="px-4 pb-4 sm:px-5 sm:pb-5 -mt-1">
          {children}
          <div className="mt-4 flex justify-end">
            <button type="button" onClick={onListo} className="vp-pulsable bg-neutral-900 text-white rounded-xl px-5 py-2 text-sm font-semibold">
              Listo
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

/** Un dato del formulario: su rótulo, si lo leyó la IA, y lo que hay que saber de él. */
function Dato({
  id,
  etiqueta,
  ia = false,
  tono,
  nota,
  className = '',
  children,
}: {
  id: string
  etiqueta: string
  ia?: boolean
  tono?: Tono
  nota?: ReactNode
  className?: string
  children: ReactNode
}) {
  const colorNota = tono === 'mal' ? 'text-peligro-700' : tono === 'ojo' ? 'text-aviso-800' : 'text-neutral-500'
  return (
    <div id={id} className={`scroll-mt-24 ${className}`}>
      {(etiqueta || ia) && (
        <div className="flex items-center gap-1 mb-1">
          <span className="text-xs font-medium text-neutral-600">{etiqueta}</span>
          {ia && (
            <span className="text-acento-600 text-xs" title="Lo leyó la IA de la factura">
              ✦
            </span>
          )}
        </div>
      )}
      {children}
      {nota && <p className={`text-xs mt-1 ${colorNota}`}>{nota}</p>}
    </div>
  )
}

function Nota({ tono, children }: { tono: Tono; children: ReactNode }) {
  const tonos = { mal: 'bg-peligro-500/10 text-peligro-700', ojo: 'bg-aviso-500/10 text-aviso-800' }
  return <div className={`rounded-2xl px-4 py-3 text-sm ${tonos[tono]}`}>{children}</div>
}

function Falta({ children }: { children: ReactNode }) {
  return <span className="text-peligro-600">{children}</span>
}

/** Paso 2 plegado: cuántos renglones, de qué, y cuánto suman. */
function ResumenRenglones({ lineas, ingredientes, moneda, total }: { lineas: Linea[]; ingredientes: Ingrediente[]; moneda: string; total: number }) {
  const usados = lineas.filter((l) => l.ingrediente_id || l.concepto)
  const sinDecir = lineas.filter((l) => !l.ingrediente_id && !l.concepto && (Number(l.cantidad) > 0 || Number(l.costo_unitario) > 0)).length
  if (usados.length === 0 && sinDecir === 0) return <Falta>sin renglones</Falta>
  const tipos = new Set(usados.map((l) => (l.concepto ? 'gasto' : ingredientes.find((x) => x.id === l.ingrediente_id)?.tipo ?? '')))
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex -space-x-0.5">
        {[...tipos].map((t) =>
          t === 'gasto' || !t ? (
            <span key={t || 'x'} aria-hidden className="w-2 h-2 rounded-full ring-1 ring-neutral-400 bg-white" />
          ) : (
            <PuntoTipo key={t} tipo={t as Ingrediente['tipo']} />
          ),
        )}
      </span>
      <span className="font-medium text-neutral-800">
        {usados.length} {usados.length === 1 ? 'renglón' : 'renglones'}
      </span>
      <span className="tabular-nums">
        · {moneda}
        {fmtNum(total, 2)}
      </span>
      {sinDecir > 0 && (
        <>
          {' · '}
          <Falta>{sinDecir} sin decir qué es</Falta>
        </>
      )}
    </span>
  )
}

/**
 * Un renglón: qué es (una mercancía con su color, o flete, servicio...),
 * cuánto vino y a cuánto.
 *
 * Plegado es UNA línea --nombre, "5 kg × $6,00" y el subtotal-- y se toca
 * para corregirlo: en el teléfono una factura de 15 renglones cabe en una
 * pantalla. Se pliega solo al agregar otro renglón o al tocar "Listo".
 *
 * Si vino en caja o paquete, se escribe como vino --"2 cajas de 24 a $12"-- y
 * el renglón muestra lo que entra: 48 unidades a $0,50. La cantidad y el
 * costo que viajan al servidor son siempre los de la unidad de la ficha.
 */
function Renglon({
  indice,
  linea: l,
  ingredientes,
  moneda,
  tasaIva,
  exento,
  aviso,
  problema,
  puedeQuitar,
  conocidos,
  onCambiar,
  onMercancia,
  onTipo,
  onCrear,
  onQuitar,
}: {
  indice: number
  linea: Linea
  ingredientes: Ingrediente[]
  moneda: string
  tasaIva: number
  /** Si paga IVA, ya resuelto con la ficha. */
  exento: boolean
  aviso?: { nivel: string; mensaje: string; base: string; referencia: number; muestras: number }
  problema: { texto: string; tono: Tono } | null
  puedeQuitar: boolean
  conocidos: Equivalencia[]
  onCambiar: (cambio: Partial<Linea>) => void
  onMercancia: (id: number) => void
  /** El primer desplegable: un tipo de mercancía o un concepto de gasto. */
  onTipo: (valor: string) => void
  onCrear: () => void
  onQuitar: () => void
}) {
  const ing = l.concepto ? undefined : ingredientes.find((x) => x.id === l.ingrediente_id)
  const unidad = ing?.unidad ?? ''
  // LA CANTIDAD SE ESCRIBE EN kg O EN g (la casilla con la unidad adentro).
  // La linea guarda la cantidad EN LA UNIDAD DE LA FICHA.
  const [vista, setVista] = useState(unidad)
  const [texto, setTexto] = useState(l.cantidad)
  useEffect(() => {
    setVista(unidad)
    setTexto(l.cantidad)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unidad])
  useEffect(() => {
    const enBase = !vista || vista === unidad ? texto : aBase(texto, unidad, vista)
    if (enBase !== l.cantidad) setTexto(vista && vista !== unidad ? convertirTexto(l.cantidad, unidad, unidad, vista) : l.cantidad)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [l.cantidad])
  const escribirCantidad = (t: string) => {
    setTexto(t)
    onCambiar({ cantidad: !vista || vista === unidad ? t : aBase(t, unidad, vista) })
  }
  const cambiarVista = (nueva: string) => {
    setTexto(convertirTexto(texto, unidad, vista || unidad, nueva))
    setVista(nueva)
  }

  const enPaquete = !!l.paquete
  function cambiarPaquete(cambio: Partial<Paquete>) {
    const p = { ...(l.paquete ?? { nombre: 'caja', trae: '', paquetes: '', precio: '' }), ...cambio }
    const calc = desdePaquete(p)
    onCambiar({ paquete: p, ...(calc ?? {}) })
  }
  function activarPaquete(desde?: Equivalencia) {
    cambiarPaquete({
      nombre: desde?.unidad_papel || 'caja',
      trae: desde ? sinRuido(desde.factor) : '',
      // Lo que ya estaba escrito pasa a ser "cuantos paquetes": es lo que se
      // tecleo mirando el papel.
      paquetes: l.leido?.cantidad != null ? String(l.leido.cantidad) : l.cantidad,
      precio: l.leido?.precio_unitario != null ? String(l.leido.precio_unitario) : l.costo_unitario,
    })
  }

  const subtotal = (Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0)
  const recordada = l.recordada?.ingrediente_id === l.ingrediente_id ? l.recordada : undefined
  const sugerida = !l.ingrediente_id && !l.concepto && l.leido ? sugerirMercancia(l.leido.descripcion, ingredientes) : null
  const papelNoCuadra =
    !l.concepto &&
    l.leido?.cantidad != null &&
    l.leido.precio_unitario != null &&
    l.leido.subtotal != null &&
    Math.abs(l.leido.cantidad * l.leido.precio_unitario - l.leido.subtotal) > Math.max(0.05, Math.abs(l.leido.subtotal) * 0.01)
  const unidadChoca = !!l.leido && !recordada && !enPaquete && !!ing && unidadDistinta(l.leido.unidad, ing.unidad)

  const estado = problema?.tono === 'mal' ? 'bg-peligro-500' : problema || papelNoCuadra ? 'bg-aviso-500' : ing ? ALMACEN_DE[ing.tipo].punto : 'bg-neutral-300'
  const cantidadPapel = l.leido?.cantidad ?? null
  const precioPapel = l.leido?.precio_unitario ?? null
  const trae = Number(l.paquete?.trae) || 0
  const completa = lineaCompleta(l)
  const anillo = problema?.tono === 'mal' ? 'ring-1 ring-peligro-300' : problema ? 'ring-1 ring-aviso-300' : ''
  const cant = (n: number) => fmtNum(n, n % 1 ? 2 : 0)

  // El primer desplegable: qué es. Con una mercancía elegida manda su ficha.
  const tipoElegido: TipoArticulo | undefined = ing?.tipo ?? l.tipo
  const selectorTipo = (
    <select
      value={l.concepto ?? tipoElegido ?? ''}
      onChange={(e) => onTipo(e.target.value)}
      aria-label="Qué es"
      className={clase(problema?.tono === 'mal' && !l.ingrediente_id && !l.concepto ? 'mal' : undefined)}
    >
      <option value="">Qué es…</option>
      <optgroup label="Mercancía">
        {TIPOS_DE_COMPRA.map((t) => (
          <option key={t.valor} value={t.valor}>
            {t.texto}
          </option>
        ))}
      </optgroup>
      <optgroup label="No es mercancía">
        {CONCEPTOS.map((c) => (
          <option key={c.valor} value={c.valor}>
            {c.texto}
          </option>
        ))}
      </optgroup>
    </select>
  )

  // ── Plegado: una línea ──
  if (!l.abierta && completa) {
    const concepto = l.concepto ? CONCEPTOS.find((c) => c.valor === l.concepto) : undefined
    return (
      <button
        type="button"
        id={`cf-renglon-${indice}`}
        onClick={() => onCambiar({ abierta: true })}
        className={`scroll-mt-24 w-full text-left rounded-2xl bg-neutral-500/6 hover:bg-neutral-500/10 px-3 py-2.5 flex items-center gap-3 ${anillo}`}
      >
        {l.concepto ? (
          <span aria-hidden className="shrink-0 w-2.5 h-2.5 rounded-full ring-[1.5px] ring-neutral-400" />
        ) : (
          <span aria-hidden className={`shrink-0 w-2.5 h-2.5 rounded-full ${estado}`} />
        )}
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-neutral-900 truncate">
            {l.concepto ? (
              <>
                {concepto?.texto}
                {l.detalle && <span className="font-normal text-neutral-500"> · {l.detalle}</span>}
              </>
            ) : (
              ing?.nombre
            )}
          </span>
          <span className={`block text-xs truncate tabular-nums ${problema ? (problema.tono === 'mal' ? 'text-peligro-700' : 'text-aviso-800') : 'text-neutral-500'}`}>
            {problema
              ? problema.texto
              : l.concepto
                ? `${l.concepto === 'Equipo' ? 'a equipos' : 'a gasto'}${exento ? ' · exento' : ''}`
                : `${l.paquete ? `${l.paquete.paquetes} ${l.paquete.nombre} · ` : ''}${cant(Number(l.cantidad))} ${unidad} × ${moneda}${fmtNum(Number(l.costo_unitario), 2)}${exento ? ' · exento' : ''}`}
          </span>
        </span>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-neutral-900">
          {moneda}
          {fmtNum(subtotal, 2)}
        </span>
      </button>
    )
  }

  const quitar = puedeQuitar && (
    <button
      type="button"
      onClick={onQuitar}
      className="shrink-0 -mr-1 w-8 h-8 grid place-items-center rounded-lg text-neutral-400 hover:text-peligro-600 hover:bg-peligro-500/10"
      title="Quitar renglón"
      aria-label={`Quitar el renglón ${indice + 1}`}
    >
      <Icono nombre="quitar" size={14} />
    </button>
  )
  const delPapel = l.leido && (
    <p className="mt-1.5 text-xs text-neutral-500">
      <span className="text-neutral-400">Papel:</span> {l.leido.descripcion || '(sin descripción)'} ·{' '}
      <span className="tabular-nums">
        {cantidadPapel == null ? '?' : cant(cantidadPapel)} {l.leido.unidad} × {moneda}
        {precioPapel == null ? '?' : fmtNum(precioPapel, 2)}
      </span>
      {l.leido.exento ? ' · exento' : ''}
    </p>
  )
  const listo = completa && (
    <div className="flex justify-end">
      <button type="button" onClick={() => onCambiar({ abierta: false })} className="text-xs font-semibold text-neutral-600 underline">
        Listo
      </button>
    </div>
  )

  // ── Abierto, y no es mercancía: flete, servicio, equipo ──
  if (l.concepto) {
    const concepto = CONCEPTOS.find((c) => c.valor === l.concepto)!
    return (
      <div id={`cf-renglon-${indice}`} className={`scroll-mt-24 relative rounded-2xl bg-neutral-500/6 p-3 sm:p-3.5 ${anillo}`}>
        <span aria-hidden className="absolute left-0 top-3 bottom-3 w-1 rounded-full bg-neutral-300" />
        <div className="pl-2.5 space-y-2.5">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
                {selectorTipo}
                <input value={l.detalle ?? ''} onChange={(e) => onCambiar({ detalle: e.target.value })} placeholder={`Ej. ${concepto.ejemplo}`} aria-label="Qué es" className={clase()} />
              </div>
              {delPapel}
            </div>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-neutral-900 pt-1">
              {moneda}
              {fmtNum(subtotal, 2)}
            </span>
            {quitar}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 items-end">
            <label className="block">
              <span className="block text-[11px] text-neutral-500 mb-0.5">Monto sin IVA ({moneda})</span>
              <Numerico value={l.costo_unitario} onChange={(e) => onCambiar({ costo_unitario: e.target.value, cantidad: '1' })} placeholder="0.00" className={clase()} />
            </label>
            <label className="block">
              <span className="block text-[11px] text-neutral-500 mb-0.5">IVA</span>
              <select value={exento ? 'exento' : 'grava'} onChange={(e) => onCambiar({ exento: e.target.value === 'exento' })} className={clase()}>
                <option value="grava">{tasaIva}%</option>
                <option value="exento">Exento</option>
              </select>
            </label>
            {l.concepto === 'Equipo' && (
              <label className="block">
                <span className="block text-[11px] text-neutral-500 mb-0.5">Dura (meses)</span>
                <Numerico value={l.vidaUtil ?? '60'} onChange={(e) => onCambiar({ vidaUtil: e.target.value })} min="1" className={clase()} />
              </label>
            )}
          </div>
          <p className="text-xs text-neutral-500">
            {l.concepto === 'Flete'
              ? 'Va a la cuenta de fletes, aparte de la mercancía: el flete lleva su propia retención de ISLR.'
              : l.concepto === 'Equipo'
                ? 'Entra como equipo y se deprecia solo con los meses.'
                : `${concepto.ayuda} Va a gasto, no al depósito.`}
          </p>
          {listo}
        </div>
      </div>
    )
  }

  // ── Abierto, mercancía ──
  return (
    <div id={`cf-renglon-${indice}`} className={`scroll-mt-24 relative rounded-2xl bg-neutral-500/6 p-3 sm:p-3.5 ${anillo}`}>
      <span aria-hidden className={`absolute left-0 top-3 bottom-3 w-1 rounded-full ${estado}`} />
      <div className="pl-2.5 space-y-2.5">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
              {selectorTipo}
              <ElegirMercancia
                ingredientes={ingredientes}
                valor={l.ingrediente_id}
                alElegir={onMercancia}
                alCrear={onCrear}
                tipo={tipoElegido}
                tono={problema?.tono === 'mal' && !l.ingrediente_id ? 'mal' : undefined}
                sugerencia={l.leido?.descripcion}
                placeholder={tipoElegido ? `¿Cuál ${ALMACEN_DE[tipoElegido].texto.toLowerCase()}?` : '¿Cuál mercancía?'}
              />
            </div>
            {delPapel}
          </div>
          <div className="shrink-0 text-right">
            <span className="block text-sm font-semibold tabular-nums text-neutral-900 pt-2">
              {moneda}
              {fmtNum(subtotal, 2)}
            </span>
            {ing && (
              <span className="mt-1 inline-block">
                <SelloTipo tipo={ing.tipo} />
              </span>
            )}
          </div>
          {quitar}
        </div>

        {/* Cómo vino: suelta, o en caja/paquete. */}
        {ing && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => (enPaquete ? onCambiar({ paquete: undefined }) : activarPaquete())}
              aria-pressed={enPaquete}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                enPaquete ? 'bg-neutral-900 text-white' : 'vp-control text-neutral-600'
              }`}
            >
              <Icono nombre="paquete" size={13} />
              {enPaquete ? `Viene en ${l.paquete!.nombre || 'paquete'}` : 'Viene en caja o paquete'}
            </button>
            {!enPaquete &&
              conocidos.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => activarPaquete(c)}
                  className="vp-control inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-neutral-600"
                  title={`Este proveedor ya la trajo así ${c.veces === 1 ? '1 vez' : `${c.veces} veces`}`}
                >
                  {c.unidad_papel || 'paquete'} × {sinRuido(c.factor)}
                </button>
              ))}
          </div>
        )}

        {enPaquete ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
              <label className="block">
                <span className="block text-[11px] text-neutral-500 mb-0.5">Cuántos</span>
                <Numerico value={l.paquete!.paquetes} onChange={(e) => cambiarPaquete({ paquetes: e.target.value })} placeholder="2" className={clase()} />
              </label>
              <label className="block">
                <span className="block text-[11px] text-neutral-500 mb-0.5">Envase</span>
                <input value={l.paquete!.nombre} onChange={(e) => cambiarPaquete({ nombre: e.target.value })} placeholder="caja" className={clase()} />
              </label>
              <label className="block">
                <span className="block text-[11px] text-neutral-500 mb-0.5">Cada uno trae ({unidad})</span>
                <Numerico value={l.paquete!.trae} onChange={(e) => cambiarPaquete({ trae: e.target.value })} placeholder="24" className={clase()} />
              </label>
              <label className="block">
                <span className="block text-[11px] text-neutral-500 mb-0.5">Precio c/u ({moneda})</span>
                <Numerico
                  value={l.paquete!.precio}
                  onChange={(e) => cambiarPaquete({ precio: e.target.value })}
                  placeholder="0.00"
                  className={clase(aviso ? (aviso.nivel === 'unidad' ? 'mal' : 'ojo') : undefined)}
                />
              </label>
            </div>
            <p className="text-xs text-neutral-600 flex flex-wrap items-center gap-x-2">
              <span className="inline-flex items-center gap-1 text-neutral-400">
                <Icono nombre="inventario" size={13} />
                Entra al depósito:
              </span>
              {trae > 0 && Number(l.cantidad) > 0 ? (
                <span className="font-semibold tabular-nums text-neutral-900">
                  {cant(Number(l.cantidad))} {unidad}
                  {Number(l.costo_unitario) > 0 && (
                    <span className="font-normal text-neutral-600">
                      {' '}
                      a {moneda}
                      {fmtNum(Number(l.costo_unitario), 2)} cada {unidad === 'unidad' ? 'una' : unidad}
                    </span>
                  )}
                </span>
              ) : (
                <span>escribe cuántos vinieron y cuánto trae cada uno</span>
              )}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 items-end">
            <label className="block">
              <span className="block text-[11px] text-neutral-500 mb-0.5">Cantidad{ing ? ` (${ing.unidad})` : ''}</span>
              {ing && otraUnidad(ing.unidad) ? (
                <CasillaConUnidad
                  unidad={ing.unidad}
                  vista={vista || ing.unidad}
                  alCambiarVista={cambiarVista}
                  value={texto}
                  onChange={(e) => escribirCantidad(e.target.value)}
                  placeholder="0"
                  claseCasilla={clase()}
                />
              ) : (
                <Numerico value={l.cantidad} onChange={(e) => onCambiar({ cantidad: e.target.value })} placeholder="0" className={clase()} />
              )}
            </label>
            <label className="block">
              <span className="block text-[11px] text-neutral-500 mb-0.5">Costo c/u ({moneda})</span>
              <Numerico
                value={l.costo_unitario}
                onChange={(e) => onCambiar({ costo_unitario: e.target.value })}
                placeholder="0.00"
                className={clase(aviso ? (aviso.nivel === 'unidad' ? 'mal' : 'ojo') : undefined)}
              />
            </label>
            <label className="block">
              <span className="block text-[11px] text-neutral-500 mb-0.5">IVA</span>
              <select
                value={l.exento === null ? 'ficha' : l.exento ? 'exento' : 'grava'}
                onChange={(e) => onCambiar({ exento: e.target.value === 'ficha' ? null : e.target.value === 'exento' })}
                className={clase()}
              >
                <option value="ficha">{ing ? (ing.exento ? 'Exento' : `${tasaIva}%`) : 'Ficha'}</option>
                <option value="grava">{tasaIva}%</option>
                <option value="exento">Exento</option>
              </select>
            </label>
          </div>
        )}

        {(sugerida || recordada || unidadChoca || papelNoCuadra || aviso) && (
          <div className="space-y-0.5 text-xs">
            {sugerida && (
              <button type="button" onClick={() => onMercancia(sugerida.id)} className="text-acento-700 font-medium text-left inline-flex items-center gap-1">
                <PuntoTipo tipo={sugerida.tipo} />
                ¿Es {sugerida.nombre} ({sugerida.unidad})? Usarla
              </button>
            )}
            {recordada && (
              <p className="text-exito-700">
                Recordado de este proveedor · {recordada.veces === 1 ? '1 factura' : `${recordada.veces} facturas`}
                {!recordada.exacta && <span className="text-aviso-700"> · parecido a «{recordada.descripcion_recordada}», revísalo</span>}
              </p>
            )}
            {unidadChoca && (
              <p className="text-aviso-800">
                La factura dice {l.leido!.unidad} y {ing!.nombre} se lleva en {ing!.unidad}: si viene en caja o paquete, márcalo arriba y el sistema convierte.
              </p>
            )}
            {papelNoCuadra && <p className="text-aviso-800">En el papel, cantidad × precio no da el total del renglón: revisa esos números.</p>}
            {aviso && (
              <p className={aviso.nivel === 'unidad' ? 'text-peligro-700' : 'text-aviso-800'}>
                {aviso.mensaje}{' '}
                {aviso.base === 'compras'
                  ? `Se venía pagando $${aviso.referencia.toFixed(2)} (últimas ${aviso.muestras} compras).`
                  : `Costo promedio: $${aviso.referencia.toFixed(2)}.`}
              </p>
            )}
          </div>
        )}
        {listo}
      </div>
    </div>
  )
}

/**
 * El total de la factura, con lo que el proveedor suma o rebaja encima de los
 * renglones. El recargo y el descuento viven aquí, junto al total, porque son
 * de la factura entera: se reparten entre los renglones. El flete NO va
 * aquí: es un renglón, con su cuenta y su ISLR.
 */
function Totales({
  id,
  moneda,
  recargo,
  descuento,
  onRecargo,
  onDescuento,
  iaRecargo,
  iaDescuento,
  papelAjustes,
  base,
  iva,
  total,
  tasaIva,
  papel,
  cuadra,
}: {
  id: string
  moneda: string
  recargo: string
  descuento: string
  onRecargo: (v: string) => void
  onDescuento: (v: string) => void
  iaRecargo: boolean
  iaDescuento: boolean
  papelAjustes: { recargo: number; descuento: number } | null
  base: number
  iva: number
  total: number
  tasaIva: number
  papel: { subtotal: number | null; iva: number | null; total: number } | null
  cuadra: boolean
}) {
  const monto = (n: number) => `${moneda}${fmtNum(n, 2)}`
  const delPapel = (n: number | null | undefined) => papel && <td className="py-1 pl-3 text-right tabular-nums text-neutral-500">{n == null ? '—' : monto(n)}</td>
  const fila = (rotulo: string, nuestro: number, papelN?: number | null, fuerte = false) => (
    <tr className={fuerte ? 'font-semibold text-neutral-900' : 'text-neutral-600'}>
      <td className="py-1">{rotulo}</td>
      <td className={`py-1 text-right tabular-nums ${fuerte ? 'font-display text-lg' : ''}`}>{monto(nuestro)}</td>
      {delPapel(papelN)}
    </tr>
  )
  const casilla = (rotulo: string, idCampo: string, valor: string, cambiar: (v: string) => void, ia: boolean, signo: string, papelN?: number) => (
    <tr className="text-neutral-600">
      <td className="py-1">
        <label htmlFor={idCampo}>
          {rotulo}
          {ia && <span className="text-acento-600 text-xs ml-1" title="Lo leyó la IA de la factura">✦</span>}
        </label>
      </td>
      <td className="py-1 text-right">
        <span className="inline-flex items-center justify-end gap-1">
          <span className="text-neutral-400 text-xs">{signo}</span>
          <Numerico id={idCampo} value={valor} onChange={(e) => cambiar(e.target.value)} min="0" placeholder="0.00" className={`${clase()} !w-28 text-right tabular-nums !py-1.5`} />
        </span>
      </td>
      {delPapel(papelN)}
    </tr>
  )
  return (
    <div id={id} className={`scroll-mt-24 rounded-2xl p-4 ${papel ? (cuadra ? 'bg-exito-500/10' : 'bg-aviso-500/10') : 'vp-losa'}`}>
      <table className="w-full text-sm">
        {papel && (
          <thead>
            <tr className="text-xs text-neutral-500">
              <th />
              <th className="text-right font-medium">Formulario</th>
              <th className="text-right font-medium pl-3">Papel ✦</th>
            </tr>
          </thead>
        )}
        <tbody>
          {casilla('Recargo', 'cf-recargo', recargo, onRecargo, iaRecargo, '+', papelAjustes?.recargo)}
          {casilla('Descuento', 'cf-descuento', descuento, onDescuento, iaDescuento, '−', papelAjustes?.descuento)}
          {fila('Base', base, papel?.subtotal)}
          {fila(`IVA ${tasaIva}%`, iva, papel?.iva)}
          {fila('Total', total, papel?.total, true)}
        </tbody>
      </table>
      {papel && (
        <p className={`text-xs mt-1 ${cuadra ? 'text-exito-700' : 'text-aviso-800'}`}>
          {cuadra ? 'Cuadra con el papel.' : 'No cuadra con el papel: revisa renglones, IVA de cada uno, recargo y descuento.'}
        </p>
      )}
    </div>
  )
}

/** Fija abajo: lo que falta revisar, si cuadra, y guardar. */
function BarraGuardar({
  pendientes,
  cuadre,
  total,
  guardando,
  onIrA,
  onGuardar,
}: {
  pendientes: Pendiente[]
  cuadre: string | null
  total: string
  guardando: boolean
  onIrA: (ancla: string) => void
  onGuardar: () => void
}) {
  const [abierta, setAbierta] = useState(false)
  const graves = pendientes.filter((p) => p.tono === 'mal').length
  return (
    <div className="sticky bottom-3 z-20 vp-menu px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0 relative">
          {pendientes.length > 0 ? (
            <button
              onClick={() => (pendientes.length === 1 ? onIrA(pendientes[0].ancla) : setAbierta((v) => !v))}
              className={`text-sm font-medium flex items-center gap-1.5 ${graves ? 'text-peligro-700' : 'text-aviso-800'}`}
            >
              <Icono nombre="alerta" size={16} />
              {pendientes.length === 1 ? pendientes[0].texto : `${pendientes.length} cosas por revisar`}
            </button>
          ) : (
            <p className="text-sm text-exito-700 flex items-center gap-1.5">
              <Icono nombre="ok" size={16} />
              {cuadre === 'cuadra' ? 'Todo en orden y cuadra con el papel' : 'Nada pendiente'}
            </p>
          )}
          {cuadre && cuadre !== 'cuadra' && pendientes.length > 0 && <p className="text-xs text-neutral-500 truncate">{cuadre}</p>}
          {abierta && pendientes.length > 1 && (
            <ul className="vp-menu absolute bottom-full mb-2 left-0 w-72 max-w-[85vw] max-h-[50vh] overflow-auto p-1">
              {pendientes.map((p, i) => (
                <li key={i}>
                  <button
                    onClick={() => {
                      setAbierta(false)
                      onIrA(p.ancla)
                    }}
                    className={`w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-neutral-500/10 ${p.tono === 'mal' ? 'text-peligro-700' : 'text-aviso-800'}`}
                  >
                    {p.texto}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <span className="font-display text-base font-semibold tabular-nums text-neutral-900 hidden sm:block">{total}</span>
        <button
          onClick={onGuardar}
          disabled={guardando}
          className="vp-pulsable bg-neutral-900 text-white px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 shrink-0"
        >
          {guardando ? 'Guardando…' : 'Guardar factura'}
        </button>
      </div>
    </div>
  )
}
