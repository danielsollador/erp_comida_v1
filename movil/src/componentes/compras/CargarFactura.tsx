import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { CONCEPTOS, diasDesde, nombreDesdePapel, TEXTO_CONCEPTO, unidadDistinta, unidadNuestra } from '../../../../frontend/src/lib/compras'
import { necesitaReferencia } from '../../../../frontend/src/lib/pagos'
import { ErrorApi } from '../../lib/api'
import { apiCompras } from '../../lib/api-compras'
import {
  Anclas,
  aTexto,
  anotarAntesDeGuardar,
  cero,
  completarDespuesDeGuardar,
  conCostoUnitario,
  desdePaquete,
  DIAS_FACTURA_VIEJA,
  enMoneda,
  FORMAS_PAGO,
  FORMAS_PARTE,
  LINEA_VACIA,
  lineaCompleta,
  num,
  PARTES_INICIALES,
  PASO_DE,
  renglonVacio,
  sinMercanciaEn,
  soloRif,
  textoForma,
  useRevision,
  type Linea,
  type MonedaCarga,
  type Numero,
  type Paquete,
  type ParteDePago,
  type Pendiente,
  type Tono,
} from '../../lib/compras-app'
import { confirmar } from '../../lib/dialogo'
import { hoyEnCaracas } from '../../lib/formato'
import { fechaCorta, sinRuido } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import type {
  AlertaPrecio,
  ConceptoGasto,
  ConfiguracionFiscal,
  Equivalencia,
  Ingrediente,
  LecturaFactura,
  Proveedor,
  TipoArticulo,
} from '../../lib/tipos'
import Fondo from '../Fondo'
import Icono from '../Icono'
import { Selector, useDisposicion } from '../kit'
import CampoSugerido from './CampoSugerido'
import ElegirFecha from './ElegirFecha'
import { VistaDocumento, ZonaDocumento, type DocumentoLeido } from './FacturaDesdeFoto'
import NuevaMercancia, { type Presentacion } from './NuevaMercancia'
import { BarraGuardar, Paso, Totales } from './PiezasCarga'
import { BotonTexto, Casilla, CampoTexto, Dato, DestinoPlata, Falta, NotaTono, Opciones, PuntoGasto, type ParteDeLaPlata } from './piezas'
import RenglonFactura from './RenglonFactura'

/**
 * CARGAR UNA FACTURA DE PROVEEDOR, en tres pasos que se leen de arriba abajo:
 * la factura (quien, cual, cuando), que trae y como se pago. A mano, o desde
 * una foto o PDF que la IA lee y PRELLENA (pages/partes/compras/
 * CargarFactura.tsx de la web, con las mismas reglas y los mismos textos).
 *
 * Cada renglon dice QUE ES: una mercancia (su ficha dice a que almacen va la
 * plata) o algo que no es mercancia --flete, servicio, equipo, otro gasto--.
 * Los pasos se pliegan al terminarlos: en el telefono solo queda abierto el
 * que se esta llenando. Guardar es `POST /compras/facturas`, el de siempre.
 *
 * La pantalla lleva su propio desplazamiento (no `Pantalla`): un aviso de
 * abajo tiene que poder LLEVAR al campo que falta, y para eso hace falta
 * mover la pagina. En la tablet, con una factura leida, el documento va a la
 * izquierda y el formulario a la derecha, como en la web.
 */
export default function CargarFactura({
  arriba,
  ingredientes,
  setIngredientes,
  proveedores,
  fiscal,
  onGuardada,
  onVerFacturas,
}: {
  /** La barra y las pestañas de Compras. */
  arriba: ReactNode
  ingredientes: Ingrediente[]
  setIngredientes: Dispatch<SetStateAction<Ingrediente[]>>
  proveedores: Proveedor[]
  fiscal: ConfiguracionFiscal
  /** La factura entro. `alertas`: lo que llego mas caro, para mostrar. */
  onGuardada: (alertas: AlertaPrecio[]) => void
  onVerFacturas: () => void
}) {
  const t = useTema()
  const borde = useSafeAreaInsets()
  const { tablet, alto } = useDisposicion()
  const hoyISO = hoyEnCaracas()

  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [guardando, setGuardando] = useState(false)

  const [numeroFactura, setNumeroFactura] = useState('')
  // La fecha impresa en el papel. El periodo lo decide la fecha de registro (hoy).
  const [fechaEmision, setFechaEmision] = useState('')
  const [proveedor, setProveedor] = useState('')
  const [rif, setRif] = useState('')
  const [monedaCarga, setMonedaCarga] = useState<MonedaCarga>('$')
  const [numeroControl, setNumeroControl] = useState('')
  // La tasa (Bs por $) de la FECHA DE LA FACTURA, no la de hoy. Si el papel
  // imprime su tasa, manda esa.
  const [tasaFactura, setTasaFactura] = useState('')
  const [origenTasa, setOrigenTasa] = useState<'' | 'papel' | 'fecha' | 'escrita'>('')
  const [notaTasa, setNotaTasa] = useState('')
  // Retencion de IVA (si se es agente): '' = la del proveedor (75 si es nuevo).
  const [retencion, setRetencion] = useState<'' | '0' | '75' | '100'>('')
  const [formaPago, setFormaPago] = useState(FORMAS_PAGO[0].valor)
  const [referenciaPago, setReferenciaPago] = useState('')
  // Pago mixto: con que, cuanto y el comprobante de cada parte (Leider, 8-oct).
  const [partesPago, setPartesPago] = useState<ParteDePago[]>(PARTES_INICIALES)
  // Los servicios ya cargados (Internet, Luz): se ofrecen de un toque.
  const [servicios, setServicios] = useState<string[]>([])
  const [descripcion, setDescripcion] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([LINEA_VACIA])
  const [recargo, setRecargo] = useState('')
  const [descuentoFactura, setDescuentoFactura] = useState('')
  const [fechaVencimiento, setFechaVencimiento] = useState('')
  // El paso abierto. 0 = los tres plegados: queda el total y Guardar.
  const [paso, setPaso] = useState<Numero | 0>(1)
  // El pago nace con "Efectivo" puesto, pero no esta revisado hasta que
  // alguien lo abre: un visto verde en algo que nadie miro es un visto falso.
  const [pagoRevisado, setPagoRevisado] = useState(false)
  // La foto o PDF leido: su soporte se engancha a la factura al guardar.
  const [lectura, setLectura] = useState<LecturaFactura | null>(null)
  const [documento, setDocumento] = useState<DocumentoLeido | null>(null)
  // Lo primero es decidir COMO se carga (Leider, 12-oct): dos cuadros, foto
  // o archivo / a mano, y nada mas. Cada uno lleva a su camino y de ahi sigue
  // el flujo de siempre. Sin el lector de facturas activo va directo a mano.
  const [modo, setModo] = useState<'elegir' | 'foto' | 'manual'>('elegir')
  const [lectorActivo, setLectorActivo] = useState<boolean | null>(null)
  // Lo que se recuerda de cada proveedor: las presentaciones ("caja de 24").
  const [memoria, setMemoria] = useState<Equivalencia[]>([])
  // El renglon para el que se esta creando una mercancia nueva, y el nombre con que empieza.
  const [creando, setCreando] = useState<{ en: number; texto: string } | null>(null)

  useEffect(() => {
    apiCompras
      .estadoLector()
      .then((e) => setLectorActivo(e.activo))
      .catch(() => setLectorActivo(false))
    apiCompras
      .servicios()
      .then(setServicios)
      .catch(() => undefined)
    apiCompras
      .equivalencias()
      .then(setMemoria)
      .catch(() => undefined)
  }, [])

  // ── Llevar la pantalla a un sitio ───────────────────────────────────────
  const scroll = useRef<ScrollView>(null)
  const contenido = useRef<View>(null)
  const [anclas] = useState(() => new Anclas())
  const anclar = (clave: string) => anclas.anclar(clave)
  function enfocar(ancla: string, arriba = false) {
    anclas.medir(ancla, contenido.current, (y, h) =>
      scroll.current?.scrollTo({ y: Math.max(0, arriba ? y - 12 : y - Math.max(80, (alto - h) / 3)), animated: true }),
    )
  }
  const llevarA = (ancla: string, arriba = false) => setTimeout(() => enfocar(ancla, arriba), 90)

  function abrirPaso(n: Numero | 0) {
    setPaso(n)
    if (n === 3) setPagoRevisado(true)
  }

  const esCredito = formaPago === 'Credito'
  const esMixto = formaPago === 'Mixto'
  const borrador = lectura?.borrador ?? null

  // ── Cuentas del formulario ──────────────────────────────────────────────
  const recargoNum = cero(recargo)
  const descuentoNum = cero(descuentoFactura)
  const baseLineas = lineas.reduce((s, l) => s + cero(l.cantidad) * cero(l.costo_unitario), 0)
  const baseFinal = Math.round((baseLineas + recargoNum - descuentoNum) * 100) / 100

  /** Si el renglon paga IVA: lo que diga esta factura, o la ficha de la mercancia. */
  const exentoDe = (l: Linea): boolean => {
    if (l.exento !== null) return l.exento
    if (l.concepto) return false
    return Boolean(ingredientes.find((x) => x.id === l.ingrediente_id)?.exento)
  }
  // Solo de vista previa: el numero real lo calcula el backend con el mismo
  // criterio. El recargo y el descuento se reparten, asi que mueven el IVA.
  const gravada = lineas.reduce((s, l) => (exentoDe(l) ? s : s + cero(l.cantidad) * cero(l.costo_unitario)), 0)
  const factorAjuste = baseLineas > 0 ? (baseLineas + recargoNum - descuentoNum) / baseLineas : 1
  const ivaLineas = Math.round(gravada * factorAjuste * (fiscal.tasa_iva / 100) * 100) / 100
  const proveedorConocido = proveedores.find((p) => p.rif && rif && soloRif(p.rif) === soloRif(rif))
  const retencionEfectiva = retencion || String(proveedorConocido?.porcentaje_retencion ?? 75)
  const totalFormulario = Math.round((baseFinal + ivaLineas) * 100) / 100

  // A donde va la plata de esta factura, por tipo de mercancia, con el
  // recargo y el descuento repartidos igual que lo hace el servidor.
  const partes: ParteDeLaPlata[] = useMemo(() => {
    const factor = baseLineas > 0 ? baseFinal / baseLineas : 1
    const por = new Map<TipoArticulo, number>()
    for (const l of lineas) {
      const ing = ingredientes.find((x) => x.id === l.ingrediente_id)
      if (!ing || l.concepto) continue
      const monto = cero(l.cantidad) * cero(l.costo_unitario) * factor
      if (monto > 0) por.set(ing.tipo, (por.get(ing.tipo) ?? 0) + monto)
    }
    return [...por].map(([tipo, monto]) => ({ tipo, monto }))
  }, [lineas, ingredientes, baseLineas, baseFinal])
  // Lo que no es mercancia, por concepto, con el mismo reparto.
  const otrosGastos = useMemo(() => {
    const factor = baseLineas > 0 ? baseFinal / baseLineas : 1
    const por = new Map<ConceptoGasto, number>()
    for (const l of lineas) {
      if (!l.concepto) continue
      const monto = cero(l.costo_unitario) * factor
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

  const lineasConIva = lineas.filter((l) => num(l.cantidad) > 0 && !exentoDe(l)).length
  const clienteAjeno = !!borrador?.cliente_rif && !!fiscal.rif && soloRif(borrador.cliente_rif) !== soloRif(fiscal.rif)
  const sinIvaEnPapel =
    !!borrador &&
    borrador.renglones.length > 0 &&
    !borrador.iva &&
    lineasConIva > 0 &&
    totalPapel !== null &&
    borrador.subtotal !== null &&
    Math.abs(totalPapel - borrador.subtotal) < 0.01

  // La tasa BCV de la fecha de la factura (o de hoy, sin fecha). No pisa la
  // que imprime el papel ni la que se escribio a mano.
  const fechaDeTasa = fechaEmision || hoyISO
  useEffect(() => {
    if (origenTasa === 'papel' || origenTasa === 'escrita') return
    let vigente = true
    apiCompras
      .tasaDeFecha(fechaDeTasa)
      .then((r) => {
        if (!vigente) return
        setOrigenTasa('fecha')
        if (r.bcv === null) {
          setTasaFactura('')
          setNotaTasa('No hay tasa guardada para esa fecha: escribe la del BCV de ese día.')
          return
        }
        setTasaFactura(aTexto(r.bcv))
        const dia = fechaCorta(r.fecha, true)
        setNotaTasa(
          r.origen === 'manual'
            ? `La que se fijó a mano el ${dia}: revisa que sea la del BCV.`
            : `BCV del ${dia}${r.fecha !== fechaDeTasa ? ' (último día con tasa antes de esa fecha)' : ''}.`,
        )
      })
      .catch(() => undefined)
    return () => {
      vigente = false
    }
  }, [fechaDeTasa, origenTasa])

  // ── Revision del servidor: duplicado, costos, RIF ───────────────────────
  const tasaNum = num(tasaFactura) > 0 ? num(tasaFactura) : 0
  const aUsdVista = (monto: number) => (monedaCarga === 'Bs' && tasaNum ? monto / tasaNum : monto)
  const revision = useRevision({
    proveedor_rif: rif.trim(),
    proveedor_nombre: proveedor.trim(),
    numero_factura: numeroFactura.trim(),
    items: lineas
      .map((l, indice) => ({
        indice,
        ingrediente_id: l.concepto ? 0 : l.ingrediente_id,
        costo_unitario: aUsdVista(cero(l.costo_unitario)),
        cantidad: num(l.cantidad) > 0 ? num(l.cantidad) : undefined,
      }))
      .filter((x) => x.ingrediente_id && x.costo_unitario > 0),
  })
  const avisoPrecio = (i: number) => revision?.precios.find((p) => p.indice === i && p.nivel !== 'normal')
  const avisoCantidad = (i: number) => revision?.cantidades?.find((c) => c.indice === i)

  // ── El pago mixto: las partes tienen que dar lo que se le paga ──────────
  const retenidoFormulario = fiscal.agente_retencion && ivaLineas > 0 ? (ivaLineas * num(retencionEfectiva)) / 100 : 0
  const aPagarFormulario = Math.round((totalFormulario - retenidoFormulario) * 100) / 100
  const sumaPartes = Math.round(partesPago.reduce((s, x) => s + cero(x.monto), 0) * 100) / 100
  const faltaMixto = Math.round((aPagarFormulario - sumaPartes) * 100) / 100
  const partesListas =
    partesPago.length >= 2 &&
    Math.abs(faltaMixto) < 0.005 &&
    partesPago.every((x) => num(x.monto) > 0 && (!necesitaReferencia(x.forma) || !!x.referencia.trim()))
  const m = (n: number) => enMoneda(n, monedaCarga)
  const problemaMixto = !esMixto
    ? ''
    : faltaMixto > 0.004
      ? `Al pago mixto le faltan ${m(faltaMixto)}`
      : faltaMixto < -0.004
        ? `El pago mixto se pasa por ${m(-faltaMixto)}`
        : partesListas
          ? ''
          : 'Falta una referencia en el pago mixto'
  const cambiarParte = (i: number, cambio: Partial<ParteDePago>) =>
    setPartesPago((prev) => prev.map((x, k) => (k === i ? { ...x, ...cambio } : x)))

  function problemaDeRenglon(l: Linea, i: number): { texto: string; tono: Tono } | null {
    const aviso = avisoPrecio(i)
    // Un costo muy distinto es una sospecha, no un error: se avisa, no se tacha.
    if (aviso?.nivel === 'unidad') return { texto: 'con posible error de unidad', tono: 'ojo' }
    const ing = ingredientes.find((x) => x.id === l.ingrediente_id)
    if (l.leido && !l.recordada && !l.paquete && ing && unidadDistinta(l.leido.unidad, ing.unidad)) return { texto: 'con unidad distinta', tono: 'ojo' }
    if (aviso) return { texto: 'con costo fuera de lo normal', tono: 'ojo' }
    if (avisoCantidad(i)) return { texto: 'con cantidad fuera de lo normal', tono: 'ojo' }
    return null
  }

  // ── Lo que falta revisar, en orden de pantalla ──────────────────────────
  const pendientes: Pendiente[] = []
  if (revision?.duplicadas.length) pendientes.push({ texto: 'Parece ya cargada', tono: 'mal', ancla: 'cf-numero' })
  if (revision?.rif_aviso) pendientes.push({ texto: 'RIF dudoso', tono: 'ojo', ancla: 'cf-rif' })
  if (fechaEmision && fechaEmision > hoyISO) pendientes.push({ texto: 'Fecha futura', tono: 'mal', ancla: 'cf-fecha' })
  else if (fechaEmision && diasDesde(fechaEmision, hoyISO) > DIAS_FACTURA_VIEJA) pendientes.push({ texto: 'Factura vieja', tono: 'ojo', ancla: 'cf-fecha' })
  else if (borrador && !fechaEmision) pendientes.push({ texto: 'Fecha sin leer', tono: 'ojo', ancla: 'cf-fecha' })
  {
    // El mismo problema en varios renglones es UN aviso que lleva al primero.
    const porTipo = new Map<string, { tono: Tono; renglones: number[] }>()
    lineas.forEach((l, i) => {
      const x = sinMercanciaEn(l) ? { texto: 'sin decir qué es', tono: 'mal' as Tono } : problemaDeRenglon(l, i)
      if (!x) return
      const grupo = porTipo.get(x.texto) ?? { tono: x.tono, renglones: [] }
      grupo.renglones.push(i)
      porTipo.set(x.texto, grupo)
    })
    for (const [texto, g] of porTipo)
      pendientes.push({
        texto: g.renglones.length === 1 ? `Renglón ${g.renglones[0] + 1}: ${texto}` : `${g.renglones.length} renglones ${texto}`,
        tono: g.tono,
        ancla: `cf-renglon-${g.renglones[0]}`,
      })
    // Cada renglon se cierra con "Listo" antes de guardar (Leider, 8-oct).
    const sinListo = lineas.map((l, i) => (l.abierta && !renglonVacio(l) ? i : -1)).filter((i) => i >= 0)
    if (sinListo.length > 0)
      pendientes.push({
        texto: sinListo.length === 1 ? `Renglón ${sinListo[0] + 1}: dale Listo` : `${sinListo.length} renglones sin Listo`,
        tono: 'mal',
        ancla: `cf-renglon-${sinListo[0]}`,
      })
  }
  if (cuadreAplica && !cuadra) pendientes.push({ texto: 'No cuadra con el papel', tono: 'ojo', ancla: 'cf-totales' })
  if (problemaMixto) pendientes.push({ texto: problemaMixto, tono: 'mal', ancla: 'cf-mixto' })
  if (!tasaNum) pendientes.push({ texto: 'Falta la tasa', tono: 'mal', ancla: 'cf-tasa' })

  // Un aviso que lleva a un campo de un paso plegado primero lo abre; uno
  // que lleva a un renglon plegado, lo despliega.
  function irA(ancla: string) {
    const renglon = /^cf-renglon-(\d+)$/.exec(ancla)
    const destino: Numero | null = PASO_DE[ancla] ?? (renglon ? 2 : null)
    if (destino !== null && paso !== destino) abrirPaso(destino)
    if (renglon) cambiarLinea(Number(renglon[1]), { abierta: true })
    // El campo vive dentro de su paso: se lleva al paso si el campo no tiene ancla propia.
    llevarA(anclas.tiene(ancla) || renglon ? ancla : destino ? `cf-paso-${destino}` : ancla)
  }

  // ── Leer un documento ───────────────────────────────────────────────────
  // La IA propone; aca solo se llena el formulario. Nada se guarda hasta que
  // alguien lo revisa y le da Guardar.
  function aplicarLectura(l: LecturaFactura, doc: DocumentoLeido) {
    limpiarFormulario()
    setExito('')
    setLectura(l)
    setDocumento(doc)
    const b = l.borrador
    if (!b) return
    setNumeroFactura(b.numero_factura)
    setNumeroControl(b.numero_control ?? '')
    setFechaEmision(b.fecha ?? '')
    if (b.tasa_cambio) {
      setTasaFactura(aTexto(b.tasa_cambio))
      setOrigenTasa('papel')
      setNotaTasa('La que imprime la factura: con esa calculó el proveedor sus bolívares.')
    }
    // Si el RIF ya esta en el directorio, manda el nombre de alli.
    const conocido = b.proveedor_rif ? proveedores.find((p) => p.rif && soloRif(p.rif) === soloRif(b.proveedor_rif)) : undefined
    setProveedor(conocido?.nombre ?? b.proveedor_nombre)
    const rifFactura = conocido?.rif ?? b.proveedor_rif
    setRif(rifFactura)
    if (b.moneda) setMonedaCarga(b.moneda)
    setRecargo(b.recargo ? aTexto(b.recargo) : '')
    setDescuentoFactura(b.descuento ? aTexto(b.descuento) : '')
    // Con los datos de la factura leidos, se abre de una vez lo que trae.
    setPaso(b.proveedor_rif && b.numero_factura ? 2 : 1)
    if (b.renglones.length === 0) {
      // Un papel sin renglones (la luz, un servicio): un solo renglon de
      // servicio por el subtotal. Si es otra cosa, se cambia en el renglon.
      const monto = b.subtotal == null ? '' : aTexto(b.subtotal)
      setLineas([{ ...LINEA_VACIA, concepto: 'Servicio', cantidad: '1', costo_unitario: monto, costo_total: monto, exento: b.subtotal != null && !b.iva ? true : null }])
      return
    }
    // Un papel que no cobra IVA (total = subtotal) deja sus renglones sin IVA
    // de entrada. Lo que el papel marca renglon por renglon manda igual.
    const papelSinIva = !b.iva && b.subtotal != null && b.total != null && Math.abs(b.total - (b.subtotal + b.recargo - b.descuento)) < 0.01
    setLineas(
      b.renglones.map((r) =>
        conCostoUnitario({
          ...LINEA_VACIA,
          cantidad: r.cantidad == null ? '' : aTexto(r.cantidad),
          costo_total: r.subtotal != null ? aTexto(r.subtotal) : r.cantidad != null && r.precio_unitario != null ? aTexto(r.cantidad * r.precio_unitario) : '',
          exento: r.exento ?? (papelSinIva ? true : null),
          leido: r,
          abierta: false,
        }),
      ),
    )
    // Lo que ya se sabe de este proveedor: mercancia y conversion de unidad.
    // Llega despues del prellenado; si alguien ya toco ese renglon, manda lo
    // que toco. Una conversion ("1 BULTO = 20 kg") se muestra como el
    // empaque del renglon: se ve y se corrige en el mismo sitio.
    apiCompras
      .buscarEquivalencias(rifFactura, b.renglones.map((r) => ({ descripcion: r.descripcion, unidad: r.unidad })))
      .then((sugerencias) =>
        setLineas((prev) =>
          prev.map((l, i) => {
            const s = sugerencias.find((x) => x.indice === i)
            if (!s || l.leido !== b.renglones[i] || l.ingrediente_id) return l
            const enPaquete = Math.abs(s.factor - 1) > 1e-9 && s.factor > 0
            const paquete: Paquete | undefined = enPaquete
              ? { nombre: s.unidad_papel || 'empaque', trae: aTexto(s.factor), paquetes: l.leido.cantidad == null ? '' : aTexto(l.leido.cantidad) }
              : undefined
            const calc = paquete ? desdePaquete(paquete) : null
            return conCostoUnitario({ ...l, ingrediente_id: s.ingrediente_id, cantidad: calc ? calc.cantidad : l.cantidad, recordada: s, paquete })
          }),
        ),
      )
      .catch(() => undefined)
  }

  // ── Renglones ───────────────────────────────────────────────────────────
  function cambiarLinea(i: number, cambio: Partial<Linea>) {
    setLineas((prev) => prev.map((l, idx) => (idx === i ? conCostoUnitario({ ...l, ...cambio }) : l)))
  }

  function elegirMercancia(i: number, id: number) {
    const ing = ingredientes.find((x) => x.id === id)
    setLineas((prev) =>
      prev.map((l, idx) => {
        if (idx !== i) return l
        // Cambio la mercancia: el empaque era de la otra. Se suelta.
        let paquete = l.ingrediente_id === id ? l.paquete : undefined
        // EL EMPAQUE LO DICE LA FICHA (Leider, 11-oct): si la mercancia esta
        // marcada "viene en empaque de N", el renglon arranca en empaque y
        // "Esta vez vino suelta" es la excepcion.
        if (!paquete && ing?.empaque_trae) {
          paquete = { nombre: 'empaque', trae: aTexto(ing.empaque_trae), paquetes: l.leido?.cantidad != null ? aTexto(l.leido.cantidad) : l.cantidad }
        }
        const calc = paquete ? desdePaquete(paquete) : null
        return conCostoUnitario({ ...l, ingrediente_id: id, paquete, ...(calc && calc.cantidad ? { cantidad: calc.cantidad } : {}) })
      }),
    )
  }

  /** Las presentaciones con que este proveedor ya trajo esa mercancia. */
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

  // El primer selector del renglon: que es. Un tipo filtra la lista de
  // mercancias (y si la elegida era de otro tipo, se suelta); un concepto lo
  // vuelve un renglon de gasto.
  function elegirTipo(i: number, valor: string) {
    if (CONCEPTOS.some((c) => c.valor === valor)) return elegirConcepto(i, valor as ConceptoGasto)
    const tipo = (valor || undefined) as TipoArticulo | undefined
    setLineas((prev) =>
      prev.map((l, idx) => {
        if (idx !== i) return l
        const base: Linea = l.concepto
          ? { ...l, concepto: undefined, detalle: undefined, vidaUtil: undefined, cantidad: l.leido?.cantidad != null ? aTexto(l.leido.cantidad) : '', costo_unitario: '' }
          : l
        const ing = ingredientes.find((x) => x.id === base.ingrediente_id)
        const suelta = !!ing && !!tipo && ing.tipo !== tipo
        return conCostoUnitario({ ...base, tipo, ...(suelta ? { ingrediente_id: 0, paquete: undefined, recordada: undefined } : {}) })
      }),
    )
  }

  // El renglon deja de ser mercancia. Lo escrito del papel se queda: el
  // monto es lo que cobra, venga como venga.
  function elegirConcepto(i: number, concepto: ConceptoGasto) {
    setLineas((prev) =>
      prev.map((l, idx) => {
        if (idx !== i) return l
        const monto =
          l.leido?.subtotal != null
            ? aTexto(l.leido.subtotal)
            : num(l.cantidad) > 0 && l.costo_unitario !== ''
              ? aTexto(num(l.cantidad) * num(l.costo_unitario))
              : l.costo_total || l.costo_unitario
        return {
          ...l,
          ingrediente_id: 0,
          paquete: undefined,
          recordada: undefined,
          concepto,
          cantidad: '1',
          costo_unitario: monto,
          costo_total: monto,
          detalle: l.detalle ?? l.leido?.descripcion ?? '',
          vidaUtil: concepto === 'Equipo' ? (l.vidaUtil ?? '60') : undefined,
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
    setPagoRevisado(false)
    setNumeroFactura('')
    setFechaEmision('')
    setProveedor('')
    setRif('')
    setDescripcion('')
    setReferenciaPago('')
    setFormaPago(FORMAS_PAGO[0].valor)
    setPartesPago(PARTES_INICIALES)
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
  function falla(mensaje: string, ancla?: string) {
    setError(mensaje)
    if (ancla) irA(ancla)
    else llevarA('cf-arriba', true)
  }

  async function guardar(forzarDuplicado = false): Promise<void> {
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
    const gastoSinMonto = lineas.findIndex((l) => l.concepto && !(num(l.costo_unitario) > 0))
    if (gastoSinMonto >= 0) return falla('Falta el monto de algún renglón.', `cf-renglon-${gastoSinMonto}`)
    const sinListo = lineas.findIndex((l) => l.abierta && !renglonVacio(l))
    if (sinListo >= 0) return falla('Dale «Listo» a cada renglón antes de guardar.', `cf-renglon-${sinListo}`)
    if (problemaMixto) return falla(`${problemaMixto}.`, 'cf-mixto')

    const items = lineas
      .filter((l) => !l.concepto && l.ingrediente_id && num(l.cantidad) > 0 && cero(l.costo_unitario) >= 0)
      .map((l) => ({
        ingrediente_id: l.ingrediente_id,
        cantidad: num(l.cantidad),
        costo_unitario: aUsd(cero(l.costo_unitario)),
        ...(l.exento === null ? {} : { exento: l.exento }),
        ...(l.paquete && num(l.paquete.trae) > 0 ? { empaque_trae: num(l.paquete.trae) } : {}),
      }))
    const gastos = lineas
      .filter((l) => l.concepto && num(l.costo_unitario) > 0)
      .map((l) => ({
        concepto: l.concepto!,
        // El flete es el flete: no lleva nombre.
        descripcion: l.concepto === 'Flete' ? '' : (l.detalle ?? '').trim(),
        monto: aUsd(num(l.costo_unitario)),
        exento: exentoDe(l),
        ...(l.concepto === 'Equipo' ? { vida_util_meses: num(l.vidaUtil) || 60 } : {}),
      }))
    if (items.length === 0 && gastos.length === 0) return falla('Agrega al menos un renglón con cantidad y costo')

    // Se pregunta al momento, no con la revision de hace un rato: pudieron
    // cargarla en otra tablet mientras tanto.
    const yaCargadas = await apiCompras
      .revisarFactura({ proveedor_rif: rif.trim(), proveedor_nombre: proveedor.trim(), numero_factura: numeroFactura.trim(), items: [] })
      .then((r) => r.duplicadas)
      .catch(() => [])
    if (
      !forzarDuplicado &&
      yaCargadas.length > 0 &&
      !(await confirmar({
        titulo: 'Esta factura parece ya cargada',
        texto: `Ya hay una ${yaCargadas[0].numero_factura} de ${yaCargadas[0].proveedor_nombre}. Guardarla otra vez duplica la mercancía en el inventario y el gasto.`,
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
            .filter((l) => l.leido && l.ingrediente_id && num(l.cantidad) > 0)
            .map((l) => ({
              descripcion: l.leido!.descripcion,
              unidad: l.leido!.unidad,
              cantidad_papel: l.leido!.cantidad,
              precio_papel: l.leido!.precio_unitario,
              ingrediente_id: l.ingrediente_id,
              cantidad: num(l.cantidad),
              costo_unitario: cero(l.costo_unitario),
            }))
        : [],
    }
    // Un empaque escrito a mano ("2 cajas de 24") tambien se recuerda para
    // ese proveedor: la proxima vez aparece de un toque.
    const paquetesAMano = lectura
      ? []
      : lineas
          .filter((l) => l.paquete && l.ingrediente_id && num(l.cantidad) > 0 && num(l.paquete.trae) > 0)
          .map((l) => {
            const ing = ingredientes.find((x) => x.id === l.ingrediente_id)
            const cuantos = num(l.paquete!.paquetes)
            return {
              descripcion: `${ing?.nombre ?? ''} ${l.paquete!.nombre} de ${sinRuido(num(l.paquete!.trae))}`.trim(),
              unidad: l.paquete!.nombre,
              cantidad_papel: cuantos > 0 ? cuantos : null,
              // Lo que costo UN empaque: el total entre los que vinieron.
              precio_papel: cuantos > 0 && num(l.costo_total) > 0 ? num(l.costo_total) / cuantos : null,
              ingrediente_id: l.ingrediente_id,
              cantidad: num(l.cantidad),
              costo_unitario: cero(l.costo_unitario),
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
        retencion_pct: fiscal.agente_retencion ? num(retencionEfectiva) : undefined,
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
        referencia_pago: esMixto ? undefined : referenciaPago.trim() || undefined,
        // Las partes van en dolares, como todo lo demas; el servidor cuadra
        // el ultimo centavo contra lo que se le paga al proveedor.
        pagos: esMixto ? partesPago.map((x) => ({ forma_pago: x.forma, monto: aUsd(cero(x.monto)), referencia: x.referencia.trim() || undefined })) : undefined,
        // Ya se pregunto y se dijo "guardar igual": el servidor no la rechaza.
        confirmar_duplicado: forzarDuplicado || yaCargadas.length > 0,
      }
      await anotarAntesDeGuardar(numeroFactura.trim(), cuerpoCompletar)
      const guardada = await apiCompras.crearFactura({ ...comun, items, gastos, iva: ivaLineas })
      // La ficha ya aprendio el empaque en el servidor; aqui, sin volver a pedir la lista.
      const aprendidos = new Map(items.filter((it) => it.empaque_trae).map((it) => [it.ingrediente_id, it.empaque_trae!]))
      if (aprendidos.size) setIngredientes((prev) => prev.map((ing) => (aprendidos.has(ing.id) ? { ...ing, empaque_trae: aprendidos.get(ing.id)! } : ing)))
      limpiarFormulario()
      setModo('elegir')

      if (paquetesAMano.length > 0) {
        apiCompras
          .aprenderEquivalencias({ proveedor_rif: comun.proveedor_rif, proveedor_nombre: comun.proveedor_nombre, renglones: paquetesAMano })
          .then(() => apiCompras.equivalencias().then(setMemoria))
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
          : ' Sin conexión para revisar los costos: el servidor lo hace solo.'
      } else {
        cola = ` Ojo: ${r.mensaje}`
      }
      setExito(
        `Factura ${guardada.numero_factura} cargada: ${enMoneda(guardada.total, '$')} ` +
          `(base ${enMoneda(guardada.base_imponible, '$')} + IVA ${enMoneda(guardada.iva, '$')}).` +
          (guardada.items.length ? ` ${guardada.items.length} renglón(es) de mercancía.` : '') +
          (guardada.gastos?.length ? ` ${guardada.gastos.length} de flete o servicios.` : '') +
          cola,
      )
      onGuardada(r.estado === 'hecho' ? r.alertas : [])
      scroll.current?.scrollTo({ y: 0, animated: true })
    } catch (e) {
      // Otra tablet la guardo justo antes: el servidor la frena y se pregunta.
      if (e instanceof ErrorApi && e.estado === 409 && e.message.startsWith('Ya está cargada')) {
        setGuardando(false)
        if (await confirmar({ titulo: 'Esta factura ya entró', texto: `${e.message} ¿La guardo igual?`, aceptar: 'Guardar igual', peligro: true }))
          return guardar(true)
        return
      }
      setError(e instanceof Error ? e.message : 'No se pudo cargar la factura')
      llevarA('cf-arriba', true)
    } finally {
      setGuardando(false)
    }
  }

  // ── Pantalla ────────────────────────────────────────────────────────────
  const conDocumento = documento !== null
  const camino = lectorActivo === false ? 'manual' : modo
  const verFormulario = conDocumento || camino === 'manual'
  const datosListos = !!proveedor.trim() && !!rif.trim() && !!numeroFactura.trim() && !!tasaNum
  // "Listo" en un renglon lo pliega y deja el SIGUIENTE arriba en pantalla
  // (Leider, 8-oct): la factura se llena de arriba abajo.
  function plegarRenglon(i: number) {
    cambiarLinea(i, { abierta: false })
    llevarA(i + 1 < lineas.length ? `cf-renglon-${i + 1}` : 'cf-otro-renglon', true)
  }
  function otroRenglon() {
    const nuevo = lineas.length
    // Lo que ya esta completo se pliega: el renglon nuevo queda a la vista.
    setLineas((prev) => [...prev.map((l) => (lineaCompleta(l) ? { ...l, abierta: false } : l)), LINEA_VACIA])
    llevarA(`cf-renglon-${nuevo}`, true)
  }
  // "Listo" pliega el paso y abre el siguiente, que queda arriba en pantalla.
  function siguiente(n: Numero | 0) {
    abrirPaso(n)
    llevarA(n ? `cf-paso-${n}` : 'cf-totales', !!n)
  }
  const forma = textoForma(formaPago)
  const resumenMixto = partesPago
    .filter((x) => num(x.monto) > 0)
    .map((x) => `${textoForma(x.forma)} ${m(num(x.monto))}`)
    .join(' + ')
  const ia = (cond: boolean) => !!borrador && cond

  const rifTono = revision?.rif_aviso ? ('ojo' as const) : undefined
  const fechaTono: Tono | undefined =
    fechaEmision && fechaEmision > hoyISO
      ? 'mal'
      : (fechaEmision && diasDesde(fechaEmision, hoyISO) > DIAS_FACTURA_VIEJA) || (borrador && !fechaEmision)
        ? 'ojo'
        : undefined

  const formulario = (
    <View style={{ gap: 12 }}>
      {lectura && !borrador ? (
        <NotaTono tono="ojo">
          {`No se pudo leer ${documento?.esPdf ? 'el PDF' : 'la foto'}: ${lectura.error} Cárgala a mano mirando el documento: se adjunta igual al guardar.`}
        </NotaTono>
      ) : null}
      {clienteAjeno ? (
        <NotaTono tono="mal">
          {`Esta factura está a nombre del RIF ${borrador?.cliente_rif}, no de ${fiscal.razon_social || 'la empresa'} (${fiscal.rif}). Su IVA no se puede usar como crédito fiscal: pídele al proveedor una factura a nombre de la empresa.`}
        </NotaTono>
      ) : null}
      {borrador?.advertencias.map((a) => (
        <NotaTono key={a} tono="ojo">{`La IA avisa: ${a}`}</NotaTono>
      ))}
      {error ? <NotaTono tono="mal">{error}</NotaTono> : null}

      {/* ── Paso 1: la factura ── */}
      <Paso
        numero={1}
        titulo="Información de la factura"
        detalle={conDocumento ? 'Lo marcado con «IA» lo leyó la IA de la foto. Compáralo con el papel.' : 'Quién la emitió, cuál es y de cuándo.'}
        abierto={paso === 1}
        onAbrir={() => abrirPaso(paso === 1 ? 0 : 1)}
        onListo={() => siguiente(2)}
        hecho={datosListos}
        anclar={anclar('cf-paso-1')}
        accion={conDocumento ? <BotonTexto texto="Descartar" tono="neutro" alTocar={limpiarFormulario} /> : undefined}
        resumen={
          <>
            <Text style={{ fontFamily: LETRA.textoFuerte, color: t.fuerte }}>{proveedor || <Falta>falta el proveedor</Falta>}</Text>
            {' · N.º '}
            {numeroFactura || <Falta>falta</Falta>}
            {fechaEmision ? ` · ${fechaCorta(fechaEmision, true)}` : ''}
            {` · ${monedaCarga === '$' ? 'en $' : 'en Bs'} a `}
            {tasaNum ? aTexto(tasaNum) : <Falta>falta la tasa</Falta>}
          </>
        }
      >
        <View style={s.grilla}>
          <View ref={anclar('cf-proveedor')} collapsable={false} style={s.entera}>
            <Dato etiqueta="Proveedor" ia={ia(!!proveedor && proveedor === (borrador?.proveedor_nombre || proveedor))}>
              <CampoSugerido
                valor={proveedor}
                alCambiar={elegirProveedorConocido}
                opciones={proveedores.filter((p) => p.activo).map((p) => p.nombre)}
                placeholder="Nombre del proveedor"
                vacio="Todavía no hay proveedores guardados"
                titulo="Proveedores"
                etiqueta="Proveedor"
              />
            </Dato>
          </View>
          <View ref={anclar('cf-rif')} collapsable={false} style={s.celda}>
            <Dato
              etiqueta="RIF"
              ia={ia(!!rif && rif === borrador?.proveedor_rif)}
              tono={rifTono}
              nota={
                revision?.rif_aviso ? (
                  <View style={{ gap: 2 }}>
                    <Text style={[s.nota, { color: t.aviso }]}>{revision.rif_aviso}</Text>
                    {revision.rif_sugerido ? (
                      <BotonTexto
                        texto={`¿Es ${revision.rif_sugerido.rif} (${revision.rif_sugerido.nombre})? Usarlo`}
                        tono="ojo"
                        alTocar={() => {
                          setRif(revision.rif_sugerido!.rif)
                          if (!proveedor.trim()) setProveedor(revision.rif_sugerido!.nombre)
                        }}
                      />
                    ) : null}
                  </View>
                ) : undefined
              }
            >
              <CampoTexto value={rif} onChangeText={setRif} placeholder="J-12345678-9" autoCapitalize="characters" autoCorrect={false} tono={rifTono} accessibilityLabel="RIF" />
            </Dato>
          </View>
          <View ref={anclar('cf-numero')} collapsable={false} style={s.celda}>
            <Dato
              etiqueta="N.º de factura"
              ia={ia(!!numeroFactura && numeroFactura === borrador?.numero_factura)}
              tono={revision?.duplicadas.length ? 'mal' : undefined}
              nota={
                revision?.duplicadas.length
                  ? revision.duplicadas
                      .map((d) => `Ya cargada: ${d.numero_factura} de ${d.proveedor_nombre}, del ${fechaCorta(d.fecha, true)}, por ${enMoneda(d.total, '$')}.`)
                      .join(' ')
                  : undefined
              }
            >
              <CampoTexto
                value={numeroFactura}
                onChangeText={setNumeroFactura}
                placeholder="00001234"
                autoCapitalize="characters"
                autoCorrect={false}
                tono={revision?.duplicadas.length ? 'mal' : undefined}
                accessibilityLabel="Número de factura"
              />
            </Dato>
          </View>
          <View ref={anclar('cf-fecha')} collapsable={false} style={s.celda}>
            <Dato
              etiqueta="Fecha de la factura"
              ia={ia(!!fechaEmision && fechaEmision === borrador?.fecha)}
              tono={fechaTono}
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
              <ElegirFecha valor={fechaEmision} alCambiar={setFechaEmision} maximo={hoyISO} titulo="Fecha de la factura" tono={fechaTono} />
            </Dato>
          </View>
          <View ref={anclar('cf-control')} collapsable={false} style={s.celda}>
            <Dato etiqueta="N.º de control" ia={!!borrador?.numero_control && numeroControl === borrador.numero_control}>
              <CampoTexto value={numeroControl} onChangeText={setNumeroControl} placeholder="00-00000000" autoCorrect={false} accessibilityLabel="Número de control" />
            </Dato>
          </View>
          <View ref={anclar('cf-moneda')} collapsable={false} style={s.celda}>
            <Dato etiqueta="Montos en" ia={!!borrador?.moneda && monedaCarga === borrador.moneda}>
              <Opciones
                opciones={[
                  { valor: '$' as const, texto: 'Dólares' },
                  { valor: 'Bs' as const, texto: 'Bolívares' },
                ]}
                valor={monedaCarga}
                alCambiar={setMonedaCarga}
              />
            </Dato>
          </View>
          <View ref={anclar('cf-tasa')} collapsable={false} style={s.celda}>
            <Dato
              etiqueta="Tasa (Bs por $)"
              ia={origenTasa === 'papel'}
              tono={!tasaNum ? 'mal' : undefined}
              nota={
                !tasaNum
                  ? notaTasa || 'Escribe la tasa BCV del día de la factura.'
                  : `${notaTasa}${monedaCarga === '$' && totalFormulario > 0 ? ` Al libro: ${enMoneda(totalFormulario * tasaNum, 'Bs')}.` : ''}`
              }
            >
              <Casilla
                valor={tasaFactura}
                alCambiar={(v) => {
                  setTasaFactura(v)
                  setOrigenTasa('escrita')
                  setNotaTasa('Escrita a mano.')
                }}
                tono={!tasaNum ? 'mal' : undefined}
                etiqueta="Tasa en bolívares por dólar"
              />
            </Dato>
          </View>
        </View>
      </Paso>

      {/* ── Paso 2: que trae ── */}
      <Paso
        numero={2}
        titulo="Qué trae"
        detalle="Cada renglón dice qué es: una mercancía del inventario, o flete, servicio, equipo u otro gasto."
        abierto={paso === 2}
        onAbrir={() => abrirPaso(paso === 2 ? 0 : 2)}
        onListo={() => siguiente(3)}
        hecho={lineas.some(lineaCompleta) && !lineas.some(sinMercanciaEn)}
        anclar={anclar('cf-paso-2')}
        resumen={<ResumenRenglones lineas={lineas} ingredientes={ingredientes} total={m(baseLineas)} />}
      >
        <View style={{ gap: 10 }}>
          {lineas.map((l, i) => (
            <RenglonFactura
              key={l.leido ? `papel-${i}` : `mano-${i}`}
              indice={i}
              linea={l}
              ingredientes={ingredientes}
              moneda={monedaCarga}
              tasaIva={fiscal.tasa_iva}
              exento={exentoDe(l)}
              aviso={avisoPrecio(i)}
              avisoCantidad={avisoCantidad(i)?.mensaje}
              problema={sinMercanciaEn(l) ? { texto: 'Falta decir qué es', tono: 'mal' } : problemaDeRenglon(l, i)}
              puedeQuitar={lineas.length > 1}
              conocidos={paquetesConocidos(l.ingrediente_id)}
              servicios={servicios}
              anclar={anclar(`cf-renglon-${i}`)}
              onListo={() => plegarRenglon(i)}
              onCambiar={(cambio) => cambiarLinea(i, cambio)}
              onMercancia={(id) => elegirMercancia(i, id)}
              onTipo={(v) => elegirTipo(i, v)}
              // Despues de que se cierra la lista: dos ventanas a la vez no abren en el iPhone.
              onCrear={(texto) => setTimeout(() => setCreando({ en: i, texto }), 350)}
              onQuitar={() => setLineas((prev) => prev.filter((_, idx) => idx !== i))}
            />
          ))}
          <View ref={anclar('cf-otro-renglon')} collapsable={false}>
            <Pressable
              onPress={otroRenglon}
              accessibilityRole="button"
              style={({ pressed }) => [s.otro, { borderColor: t.gris200, backgroundColor: pressed ? t.gris100 : 'transparent' }]}
            >
              <Icono nombre="mas" size={15} color={t.suave} grosor={2.2} />
              <Text style={[s.otroTexto, { color: t.suave }]}>Otro renglón</Text>
            </Pressable>
          </View>
          {sinIvaEnPapel ? (
            <NotaTono tono="ojo">
              <Text style={[s.nota, { color: t.aviso }]}>
                La factura no trae IVA, pero {lineasConIva} renglón(es) lo están sumando.
              </Text>
              <BotonTexto texto="Marcar todos exentos" tono="ojo" alTocar={() => setLineas((prev) => prev.map((l) => ({ ...l, exento: true })))} />
            </NotaTono>
          ) : null}
          {partes.length > 0 || otrosGastos.length > 0 ? (
            <View style={[s.plata, { backgroundColor: t.gris100 }]}>
              {partes.length > 0 ? <DestinoPlata partes={partes} monto={m} titulo="A dónde va la plata" /> : null}
              {otrosGastos.length > 0 ? (
                <View style={{ gap: 4, marginTop: partes.length ? 8 : 0 }}>
                  {partes.length === 0 ? <Text style={[s.etiqueta, { color: t.tenue }]}>A dónde va la plata</Text> : null}
                  {otrosGastos.map(([c, monto]) => (
                    <View key={c} style={s.gastoFila}>
                      <PuntoGasto tamano={8} />
                      <Text style={[s.nota, { color: t.suave }]}>
                        {TEXTO_CONCEPTO[c]} <Text style={{ fontFamily: LETRA.cifraFuerte, color: t.tinta }}>{m(monto)}</Text>{' '}
                        {c === 'Equipo' ? 'a equipos' : 'a gasto'}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </Paso>

      {/* ── Paso 3: el pago ── */}
      <Paso
        numero={3}
        titulo="El pago"
        detalle={esCredito ? 'Queda en cuentas por pagar hasta que se registre el pago.' : 'La plata ya salió al cargarla.'}
        abierto={paso === 3}
        onAbrir={() => abrirPaso(paso === 3 ? 0 : 3)}
        onListo={() => siguiente(0)}
        hecho={pagoRevisado && (esMixto ? partesListas : !necesitaReferencia(formaPago) || !!referenciaPago.trim())}
        anclar={anclar('cf-paso-3')}
        resumen={
          <>
            <Text style={{ fontFamily: LETRA.textoFuerte, color: t.fuerte }}>{esMixto && resumenMixto ? resumenMixto : forma}</Text>
            {esCredito && fechaVencimiento ? ` · vence ${fechaCorta(fechaVencimiento, true)}` : ''}
            {referenciaPago.trim() && !esMixto ? ` · ref. ${referenciaPago.trim()}` : ''}
            {(esMixto ? !!problemaMixto : necesitaReferencia(formaPago) && !referenciaPago.trim()) ? (
              <>
                {' · '}
                <Falta>{esMixto ? problemaMixto.toLowerCase() : 'falta la referencia'}</Falta>
              </>
            ) : null}
          </>
        }
      >
        <View style={{ gap: 14 }}>
          <Opciones opciones={FORMAS_PAGO} valor={formaPago} alCambiar={setFormaPago} />
          {esMixto ? (
            <View ref={anclar('cf-mixto')} collapsable={false} style={{ gap: 10 }}>
              {partesPago.map((x, i) => (
                <View key={i} style={[s.parte, { backgroundColor: t.gris100 }]}>
                  <View style={s.parteFila}>
                    <View style={{ flex: 1 }}>
                      <Selector
                        etiqueta="Con qué"
                        forma="campo"
                        opciones={FORMAS_PARTE.map((f) => ({ valor: f.valor, texto: f.texto }))}
                        valor={x.forma}
                        alCambiar={(v) => cambiarParte(i, { forma: v })}
                      />
                    </View>
                    <Dato etiqueta={`Cuánto (${monedaCarga})`} style={{ width: 130 }}>
                      <Casilla valor={x.monto} alCambiar={(v) => cambiarParte(i, { monto: v })} placeholder="0,00" etiqueta={`Parte ${i + 1}: cuánto`} />
                    </Dato>
                  </View>
                  <View style={s.parteFila}>
                    <View style={{ flex: 1 }}>
                      <CampoTexto
                        value={x.referencia}
                        onChangeText={(v) => cambiarParte(i, { referencia: v })}
                        editable={necesitaReferencia(x.forma)}
                        placeholder={necesitaReferencia(x.forma) ? 'Referencia' : 'no lleva referencia'}
                        accessibilityLabel={`Parte ${i + 1}: referencia`}
                        tono={necesitaReferencia(x.forma) && !x.referencia.trim() && num(x.monto) > 0 ? 'mal' : undefined}
                      />
                    </View>
                    <Pressable
                      onPress={() => setPartesPago((prev) => prev.filter((_, k) => k !== i))}
                      disabled={partesPago.length <= 2}
                      accessibilityLabel={`Quitar la parte ${i + 1}`}
                      style={({ pressed }) => [s.quitarParte, { opacity: partesPago.length <= 2 ? 0.3 : pressed ? 0.6 : 1 }]}
                    >
                      <Icono nombre="quitar" size={15} color={t.suave} />
                    </Pressable>
                  </View>
                </View>
              ))}
              <View style={s.mixtoPie}>
                <BotonTexto
                  texto="Otra parte"
                  icono="mas"
                  tono="neutro"
                  alTocar={() => setPartesPago((prev) => [...prev, { forma: 'Efectivo $', monto: '', referencia: '' }])}
                />
                {faltaMixto > 0.004 && partesPago.some((x) => !(num(x.monto) > 0)) ? (
                  // Lo que falta, de un toque, en la primera parte vacia.
                  <BotonTexto
                    texto={`Faltan ${m(faltaMixto)} de ${m(aPagarFormulario)}: ponerlos`}
                    tono="ojo"
                    alTocar={() => cambiarParte(partesPago.findIndex((x) => !(num(x.monto) > 0)), { monto: aTexto(faltaMixto) })}
                  />
                ) : (
                  <Text style={[s.nota, { color: Math.abs(faltaMixto) < 0.005 ? t.exito : t.aviso, flexShrink: 1 }]}>
                    {Math.abs(faltaMixto) < 0.005
                      ? `Cuadra: ${m(aPagarFormulario)}`
                      : faltaMixto > 0
                        ? `Faltan ${m(faltaMixto)} de ${m(aPagarFormulario)}`
                        : `Se pasa por ${m(-faltaMixto)}`}
                  </Text>
                )}
              </View>
            </View>
          ) : null}
          {!esMixto && necesitaReferencia(formaPago) ? (
            <View ref={anclar('cf-referencia')} collapsable={false}>
              <Dato etiqueta="Referencia del pago">
                <CampoTexto value={referenciaPago} onChangeText={setReferenciaPago} tono={!referenciaPago.trim() ? 'mal' : undefined} accessibilityLabel="Referencia del pago" />
              </Dato>
            </View>
          ) : null}
          {esCredito ? (
            <View ref={anclar('cf-vence')} collapsable={false}>
              <Dato etiqueta="Vence">
                <ElegirFecha valor={fechaVencimiento} alCambiar={setFechaVencimiento} titulo="Vence" placeholder="Sin fecha de vencimiento" atajos="futuro" />
              </Dato>
            </View>
          ) : null}
          {fiscal.agente_retencion && ivaLineas > 0 ? (
            <View ref={anclar('cf-retencion')} collapsable={false}>
              <Selector
                etiqueta="Retención de IVA"
                forma="campo"
                opciones={[
                  { valor: '75', texto: '75 %' },
                  { valor: '100', texto: '100 %' },
                  { valor: '0', texto: 'No retener' },
                ]}
                valor={retencionEfectiva}
                alCambiar={(v) => setRetencion(v as '0' | '75' | '100')}
              />
              <Text style={[s.nota, { color: t.tenue, marginTop: 6 }]}>
                {num(retencionEfectiva) > 0
                  ? `Se retienen ${m((ivaLineas * num(retencionEfectiva)) / 100)} (van al SENIAT). Al proveedor: ${m(totalFormulario - (ivaLineas * num(retencionEfectiva)) / 100)}.`
                  : 'No se retiene: al proveedor se le paga el total.'}
              </Text>
            </View>
          ) : null}
          <View ref={anclar('cf-descripcion')} collapsable={false}>
            <Dato etiqueta="Nota (opcional)">
              <CampoTexto value={descripcion} onChangeText={setDescripcion} accessibilityLabel="Nota" />
            </Dato>
          </View>
        </View>
      </Paso>

      <Totales
        moneda={monedaCarga}
        recargo={recargo}
        descuento={descuentoFactura}
        onRecargo={setRecargo}
        onDescuento={setDescuentoFactura}
        iaRecargo={!!borrador?.recargo && num(recargo) === borrador.recargo}
        iaDescuento={!!borrador?.descuento && num(descuentoFactura) === borrador.descuento}
        papelAjustes={cuadreAplica && borrador ? { recargo: borrador.recargo, descuento: borrador.descuento } : null}
        base={baseFinal}
        iva={ivaLineas}
        total={totalFormulario}
        tasaIva={fiscal.tasa_iva}
        papel={cuadreAplica && borrador ? { subtotal: borrador.subtotal, iva: borrador.iva, total: totalPapel! } : null}
        cuadra={cuadra}
        anclar={anclar('cf-totales')}
      />
    </View>
  )

  const creandoLinea = creando ? lineas[creando.en] : undefined
  const dosColumnas = tablet && conDocumento

  return (
    <View style={{ flex: 1, backgroundColor: t.papel }}>
      <Fondo />
      <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 16 }}>{arriba}</View>
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {dosColumnas && documento ? (
            // La factura a la vista, fija al lado del formulario.
            <View style={{ flex: 5, paddingLeft: 16, paddingTop: 8, paddingBottom: 12 }}>
              <VistaDocumento doc={documento} altoMaximo={alto - 220} />
            </View>
          ) : null}
          <ScrollView
            ref={scroll}
            style={{ flex: 7 }}
            contentContainerStyle={s.pantalla}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
          >
            <View ref={contenido} collapsable={false} style={{ gap: 12 }}>
              <View ref={anclar('cf-arriba')} collapsable={false} />
              {exito ? (
                <View style={[s.exito, { backgroundColor: t.exitoSuave }]}>
                  <Icono nombre="ok" size={16} color={t.exito} grosor={2.2} />
                  <Text style={[s.nota, { color: t.exito, flex: 1 }]}>{exito}</Text>
                  <BotonTexto texto="Verla" alTocar={onVerFacturas} tono="neutro" />
                </View>
              ) : null}
              {!conDocumento && camino === 'elegir' && lectorActivo !== null ? (
                <ElegirCarga onFoto={() => setModo('foto')} onManual={() => setModo('manual')} />
              ) : null}
              {!conDocumento && camino !== 'elegir' && lectorActivo ? (
                <Pressable
                  onPress={() => setModo(camino === 'foto' ? 'manual' : 'foto')}
                  style={({ pressed }) => [s.cambiarForma, { opacity: pressed ? 0.6 : 1 }]}
                  accessibilityRole="button"
                >
                  <Icono nombre="atras" size={16} color={t.suave} />
                  <Text style={[s.cambiarFormaTexto, { color: t.suave }]}>
                    {camino === 'foto' ? 'Mejor la anoto a mano' : 'Mejor con foto o archivo'}
                  </Text>
                </Pressable>
              ) : null}
              {!conDocumento && camino === 'foto' ? <ZonaDocumento onLeida={aplicarLectura} /> : null}
              {conDocumento && documento && !dosColumnas ? <VistaDocumento doc={documento} plegable altoMaximo={alto * 0.5} /> : null}
              {verFormulario ? formulario : null}
            </View>
          </ScrollView>
        </View>
        <View style={{ paddingBottom: borde.bottom, display: verFormulario ? 'flex' : 'none' }}>
          <BarraGuardar
            pendientes={pendientes}
            cuadre={cuadreAplica ? (cuadra ? 'cuadra' : `No cuadra: diferencia ${m(diferencia)}`) : null}
            total={m(totalFormulario)}
            guardando={guardando}
            onIrA={irA}
            onGuardar={() => void guardar()}
          />
        </View>
      </SafeAreaView>

      <NuevaMercancia
        visible={creando !== null}
        ingredientes={ingredientes}
        nombreInicial={creando?.texto || nombreDesdePapel(creandoLinea?.leido?.descripcion ?? '')}
        unidadInicial={unidadNuestra(creandoLinea?.leido?.unidad ?? '') || 'kg'}
        exentoInicial={Boolean(creandoLinea?.exento ?? creandoLinea?.leido?.exento)}
        tipoInicial={creandoLinea?.tipo ?? null}
        delPapel={creandoLinea?.leido?.descripcion}
        onUsar={(ing) => {
          const i = creando!.en
          setCreando(null)
          elegirMercancia(i, ing.id)
        }}
        onCreada={(creada, presentacion: Presentacion | null) => {
          const i = creando!.en
          setIngredientes((prev) => [...prev, creada])
          const l = lineas[i]
          const paquete: Paquete | undefined = presentacion
            ? { nombre: presentacion.nombre, trae: aTexto(presentacion.trae), paquetes: l?.leido?.cantidad != null ? aTexto(l.leido.cantidad) : (l?.cantidad ?? '') }
            : undefined
          const calc = paquete ? desdePaquete(paquete) : null
          cambiarLinea(i, { ingrediente_id: creada.id, paquete, ...(calc ? { cantidad: calc.cantidad } : {}) })
          setCreando(null)
        }}
        onCerrar={() => setCreando(null)}
      />
    </View>
  )
}

/**
 * La primera pantalla de la carga: COMO la quieres cargar. Dos cuadros
 * grandes y nada mas, para que nadie tenga que entender el formulario antes
 * de empezar.
 */
function ElegirCarga({ onFoto, onManual }: { onFoto: () => void; onManual: () => void }) {
  const t = useTema()
  const opciones = [
    {
      icono: 'camara' as const,
      titulo: 'Foto o archivo',
      texto: 'Tómale foto a la factura o sube el PDF. La IA la llena y tú la revisas.',
      alTocar: onFoto,
      principal: true,
    },
    {
      icono: 'factura' as const,
      titulo: 'A mano',
      texto: 'Escribe tú los datos de la factura, renglón por renglón.',
      alTocar: onManual,
      principal: false,
    },
  ]
  return (
    <View style={{ gap: 16 }}>
      <Text style={[s.elegirTitulo, { color: t.tinta }]}>¿Cómo quieres cargar la factura?</Text>
      {opciones.map((o) => (
        <Pressable
          key={o.titulo}
          onPress={o.alTocar}
          accessibilityRole="button"
          accessibilityLabel={o.titulo}
          style={({ pressed }) => [
            s.elegirCuadro,
            { backgroundColor: t.superficie, borderColor: t.gris200, transform: [{ scale: pressed ? 0.985 : 1 }] },
          ]}
        >
          <View style={[s.elegirIcono, { backgroundColor: o.principal ? t.tinta : t.gris100 }]}>
            <Icono nombre={o.icono} size={26} color={o.principal ? t.papel : t.tinta} />
          </View>
          <View>
            <Text style={[s.elegirNombre, { color: t.tinta }]}>{o.titulo}</Text>
            <Text style={[s.elegirTexto, { color: t.suave }]}>{o.texto}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  )
}

/** Paso 2 plegado: cuantos renglones, de que, y cuanto suman. */
function ResumenRenglones({ lineas, ingredientes, total }: { lineas: Linea[]; ingredientes: Ingrediente[]; total: string }) {
  const t = useTema()
  const usados = lineas.filter((l) => l.ingrediente_id || l.concepto)
  const sinDecir = lineas.filter(sinMercanciaEn).length
  if (usados.length === 0 && sinDecir === 0) return <Falta>sin renglones</Falta>
  const tipos = [...new Set(usados.map((l) => (l.concepto ? 'gasto' : ingredientes.find((x) => x.id === l.ingrediente_id)?.tipo ?? '')))]
  return (
    <>
      {tipos.map((x) => (x === 'gasto' || !x ? '○ ' : '● ')).join('')}
      <Text style={{ fontFamily: LETRA.textoFuerte, color: t.fuerte }}>
        {usados.length} {usados.length === 1 ? 'renglón' : 'renglones'}
      </Text>
      {` · ${total}`}
      {sinDecir > 0 ? (
        <>
          {' · '}
          <Falta>{sinDecir} sin decir qué es</Falta>
        </>
      ) : null}
    </>
  )
}

const s = StyleSheet.create({
  elegirTitulo: { fontFamily: LETRA.titulo, fontSize: 26, lineHeight: 31, letterSpacing: -0.4, marginTop: 8 },
  elegirCuadro: { borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, padding: 24, minHeight: 200, justifyContent: 'space-between', gap: 28 },
  elegirIcono: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  elegirNombre: { fontFamily: LETRA.titulo, fontSize: 24, letterSpacing: -0.3 },
  elegirTexto: { fontFamily: LETRA.texto, fontSize: 15, lineHeight: 22, marginTop: 6 },
  cambiarForma: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, alignSelf: 'flex-start' },
  cambiarFormaTexto: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  pantalla: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 },
  nota: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
  etiqueta: { fontFamily: LETRA.textoFuerte, fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase' },
  exito: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 16, paddingLeft: 14, paddingRight: 6, paddingVertical: 6 },
  grilla: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  entera: { width: '100%' },
  celda: { flexGrow: 1, flexBasis: 140, minWidth: 0 },
  otro: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 48, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed' },
  otroTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14.5 },
  plata: { borderRadius: 18, padding: 14 },
  gastoFila: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  parte: { borderRadius: 16, padding: 10, gap: 8 },
  parteFila: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  quitarParte: { width: 44, height: 50, alignItems: 'center', justifyContent: 'center' },
  mixtoPie: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
})
