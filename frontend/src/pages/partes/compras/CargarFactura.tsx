import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import CampoSugerido from '../../../components/CampoSugerido'
import { useDialogo } from '../../../components/dialogo'
import { VistaSoporte } from '../../../components/FacturaDesdeFoto'
import Icono from '../../../components/Icono'
import { Numerico } from '../../../components/Teclado'
import { api } from '../../../lib/api'
import {
  CATEGORIAS,
  conversion,
  diasDesde,
  nombreDesdePapel,
  sugerirMercancia,
  unidadDistinta,
  unidadNuestra,
} from '../../../lib/compras'
import { achicarFoto } from '../../../lib/foto'
import { useMoneda } from '../../../lib/moneda'
import { necesitaReferencia } from '../../../lib/pagos'
import { completarDespuesDeGuardar } from '../../../lib/pendientesCompras'
import { useRevision } from '../../../lib/revisionFactura'
import type {
  AlertaPrecio,
  ConfiguracionFiscal,
  Ingrediente,
  LecturaFactura,
  Proveedor,
  RenglonLeido,
  SugerenciaRenglon,
} from '../../../lib/types'

/**
 * Cargar una factura de proveedor: a mano, o desde una foto o PDF que la IA
 * lee y PRELLENA. Pensada para revisar rápido: la factura queda a la vista
 * junto al formulario, cada dato dudoso se marca en su campo, y la barra de
 * abajo dice si cuadra con el papel y cuánto falta revisar.
 *
 * Guardar sigue siendo `POST /api/compras/facturas`, el de siempre.
 */

const MONEDAS_DE_CARGA = ['$', 'Bs'] as const
const FORMAS_PAGO = ['Efectivo', 'Efectivo $', 'Banco', 'Credito']

// Una factura mas vieja que esto se avisa, no se bloquea: el plazo real para
// descontar ese credito fiscal lo confirma quien lleva la contabilidad.
const DIAS_FACTURA_VIEJA = 60

type Linea = {
  ingrediente_id: number
  cantidad: string
  costo_unitario: string
  /** null = lo que diga la ficha de la mercancía; true/false = lo dice ESTA factura. */
  exento: boolean | null
  /** Lo que dice el papel de este renglón, si vino de una foto. */
  leido?: RenglonLeido
  /** Lo que se recordaba de este proveedor para este renglón, si se aplicó. */
  recordada?: SugerenciaRenglon
}

const LINEA_VACIA: Linea = { ingrediente_id: 0, cantidad: '', costo_unitario: '', exento: null }

type Tono = 'mal' | 'ojo'
/** Algo que mirar antes de guardar. `ancla` es el id del elemento al que lleva. */
type Pendiente = { texto: string; tono: Tono; ancla: string }

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
  const { tasa } = useMoneda()
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
  const [categoria, setCategoria] = useState(CATEGORIAS[0].valor)
  const [formaPago, setFormaPago] = useState(FORMAS_PAGO[0])
  const [referenciaPago, setReferenciaPago] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([LINEA_VACIA])
  const [recargo, setRecargo] = useState('')
  const [descuentoFactura, setDescuentoFactura] = useState('')
  const [base, setBase] = useState('')
  const [iva, setIva] = useState('')
  const [fechaVencimiento, setFechaVencimiento] = useState('')
  const [vidaUtil, setVidaUtil] = useState('60')

  // La foto o PDF leido: su soporte se engancha a la factura al guardar.
  const [lectura, setLectura] = useState<LecturaFactura | null>(null)
  const [documento, setDocumento] = useState<{ url: string; esPdf: boolean } | null>(null)

  const esInsumos = categoria === 'Insumos'
  const esCredito = formaPago === 'Credito'
  const esActivo = categoria === 'Activos'
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
      const ing = ingredientes.find((x) => x.id === l.ingrediente_id)
      const exento = l.exento === null ? Boolean(ing?.exento) : l.exento
      return exento ? s : s + (Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0)
    }, 0)
    const factor = baseLineas > 0 ? (baseLineas + recargoNum - descuentoNum) / baseLineas : 1
    return Math.round(gravada * factor * (fiscal.tasa_iva / 100) * 100) / 100
  }, [lineas, ingredientes, fiscal.tasa_iva, recargoNum, descuentoNum, baseLineas])
  const baseMostrada = esInsumos ? baseFinal : Number(base) || 0
  const ivaMostrado = esInsumos ? ivaLineas : Number(iva) || 0
  const totalFormulario = Math.round((baseMostrada + ivaMostrado) * 100) / 100

  // El cuadre contra el papel, solo en la misma moneda. El IVA se redondea
  // renglón por renglón en unas facturas y al final en otras: unos centavos
  // no son un error.
  const totalPapel = borrador?.total ?? null
  const cuadreAplica = totalPapel !== null && (!borrador?.moneda || borrador.moneda === monedaCarga)
  const diferencia = totalPapel === null ? 0 : Math.round((totalFormulario - totalPapel) * 100) / 100
  const cuadra = cuadreAplica && Math.abs(diferencia) <= Math.max(0.05, Math.abs(totalPapel!) * 0.001)

  // Notas de entrega y facturas informales no traen IVA: si el papel no lo
  // trae y el formulario lo esta sumando (por la ficha de cada mercancia),
  // se ofrece corregirlo de un toque en vez de renglon por renglon.
  const lineasConIva = esInsumos
    ? lineas.filter((l) => {
        const ing = ingredientes.find((x) => x.id === l.ingrediente_id)
        return Number(l.cantidad) > 0 && !(l.exento === null ? ing?.exento : l.exento)
      }).length
    : 0
  const sinIvaEnPapel =
    !!borrador && borrador.renglones.length > 0 && !borrador.iva && esInsumos && lineasConIva > 0 &&
    totalPapel !== null && borrador.subtotal !== null && Math.abs(totalPapel - borrador.subtotal) < 0.01

  // ── Revisión del servidor: duplicado, precios, RIF ──────────────────────
  const aUsdVista = (monto: number) => (monedaCarga === 'Bs' && tasa?.bcv ? monto / tasa.bcv : monto)
  const revision = useRevision({
    proveedor_rif: rif.trim(),
    proveedor_nombre: proveedor.trim(),
    numero_factura: numeroFactura.trim(),
    items: esInsumos
      ? lineas
          .map((l, indice) => ({
            indice,
            ingrediente_id: l.ingrediente_id,
            costo_unitario: aUsdVista(Number(l.costo_unitario) || 0),
          }))
          .filter((x) => x.ingrediente_id && x.costo_unitario > 0)
      : [],
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
  if (esInsumos) {
    lineas.forEach((l, i) => {
      if (!l.ingrediente_id && (Number(l.cantidad) > 0 || Number(l.costo_unitario) > 0))
        pendientes.push({ texto: `Renglón ${i + 1}: falta la mercancía`, tono: 'mal', ancla: `cf-renglon-${i}` })
      else if (problemaDeRenglon(l, i)) pendientes.push({ ...problemaDeRenglon(l, i)!, ancla: `cf-renglon-${i}` })
    })
  }
  if (cuadreAplica && !cuadra) pendientes.push({ texto: 'No cuadra con el papel', tono: 'ojo', ancla: 'cf-totales' })

  function problemaDeRenglon(l: Linea, i: number): { texto: string; tono: Tono } | null {
    const aviso = avisoPrecio(i)
    if (aviso?.nivel === 'unidad') return { texto: `Renglón ${i + 1}: posible error de unidad`, tono: 'mal' }
    const ing = ingredientes.find((x) => x.id === l.ingrediente_id)
    if (l.leido && !l.recordada && ing && unidadDistinta(l.leido.unidad, ing.unidad))
      return { texto: `Renglón ${i + 1}: unidad distinta`, tono: 'ojo' }
    if (aviso) return { texto: `Renglón ${i + 1}: precio fuera de lo normal`, tono: 'ojo' }
    return null
  }

  function irA(ancla: string) {
    const el = document.getElementById(ancla)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // El campo antes que los botones: en un renglon el primero es el de quitarlo.
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
    setFechaEmision(b.fecha ?? '')
    // Si el RIF ya esta en el directorio, manda el nombre de alli: es el que
    // agrupa las compras de ese proveedor.
    const soloRif = (x: string) => x.toUpperCase().replace(/[^0-9A-Z]/g, '')
    const conocido = b.proveedor_rif
      ? proveedores.find((p) => p.rif && soloRif(p.rif) === soloRif(b.proveedor_rif))
      : undefined
    setProveedor(conocido?.nombre ?? b.proveedor_nombre)
    const rifFactura = conocido?.rif ?? b.proveedor_rif
    setRif(rifFactura)
    if (b.moneda) setMonedaCarga(b.moneda)
    setRecargo(b.recargo ? String(b.recargo) : '')
    setDescuentoFactura(b.descuento ? String(b.descuento) : '')
    if (b.renglones.length === 0) {
      setCategoria('Servicios')
      setBase(b.subtotal == null ? '' : String(b.subtotal))
      setIva(b.iva == null ? '' : String(b.iva))
      return
    }
    setCategoria('Insumos')
    // La mercancia de cada renglon la elige quien revisa: el papel dice
    // "HARINA PAN 1KG", no cual de nuestras mercancias es.
    setLineas(
      b.renglones.map((r) => ({
        ...LINEA_VACIA,
        cantidad: r.cantidad == null ? '' : String(r.cantidad),
        costo_unitario: r.precio_unitario == null ? '' : String(r.precio_unitario),
        exento: r.exento,
        leido: r,
      })),
    )
    // Lo que ya se sabe de este proveedor: mercancia y conversion de unidad.
    // Llega despues del prellenado; si alguien ya toco ese renglon, manda
    // lo que toco.
    api
      .buscarEquivalencias(
        rifFactura,
        b.renglones.map((r) => ({ descripcion: r.descripcion, unidad: r.unidad })),
      )
      .then((sugerencias) =>
        setLineas((prev) =>
          prev.map((l, i) => {
            const s = sugerencias.find((x) => x.indice === i)
            if (!s || l.leido !== b.renglones[i] || l.ingrediente_id) return l
            const redondeo = (x: number) => String(Math.round(x * 10000) / 10000)
            return {
              ...l,
              ingrediente_id: s.ingrediente_id,
              cantidad: l.leido.cantidad == null ? l.cantidad : redondeo(l.leido.cantidad * s.factor),
              costo_unitario:
                l.leido.precio_unitario == null ? l.costo_unitario : redondeo(l.leido.precio_unitario / s.factor),
              recordada: s,
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

  async function elegirMercancia(i: number, valor: string) {
    if (valor === 'nuevo') {
      // Un insumo que llega por primera vez obligaba a salir de Compras, ir a
      // Inventario a crearlo y volver a cargar la factura desde cero.
      const datos = await dialogo.pedir({
        titulo: 'Mercancía nueva',
        campos: [
          {
            nombre: 'nombre',
            etiqueta: 'Nombre',
            placeholder: 'Ej. Pollo',
            valor: nombreDesdePapel(lineas[i]?.leido?.descripcion ?? ''),
          },
          {
            nombre: 'unidad',
            etiqueta: 'Unidad',
            tipo: 'opciones',
            valor: unidadNuestra(lineas[i]?.leido?.unidad ?? '') || 'kg',
            opciones: ['kg', 'g', 'lt', 'ml', 'unidad', 'paquete'].map((u) => ({ valor: u, texto: u })),
          },
        ],
      })
      if (!datos) return
      const creado = await api.crearIngrediente({
        nombre: datos.nombre,
        unidad: datos.unidad,
        stock_actual: 0,
        stock_minimo: 0,
        stock_objetivo: 0,
        costo_unitario: 0,
        rendimiento_pct: 100,
        tipo: 'insumo',
        activo: true,
        // Lo que dice el papel de este renglón: si la factura lo marca
        // exento, la ficha nace exenta.
        exento: Boolean(lineas[i]?.exento ?? lineas[i]?.leido?.exento),
      })
      setIngredientes((prev) => [...prev, creado])
      cambiarLinea(i, { ingrediente_id: creado.id })
      return
    }
    // Sin costo todavia, se propone lo que ya cuesta esa mercancia: solo se
    // corrige si el proveedor la vendio distinto.
    const ing = ingredientes.find((x) => x.id === Number(valor))
    setLineas((prev) =>
      prev.map((l, idx) =>
        idx === i
          ? {
              ...l,
              ingrediente_id: Number(valor),
              costo_unitario: l.costo_unitario || (ing ? String(ing.costo_unitario) : ''),
            }
          : l,
      ),
    )
  }

  // Al escribir la base (solo cuando NO es mercancia), se sugiere el IVA con
  // la tasa vigente; se corrige si la factura trae otro monto.
  function actualizarBase(valor: string) {
    setBase(valor)
    const num = Number(valor)
    if (Number.isFinite(num) && num > 0) setIva((Math.round(num * (fiscal.tasa_iva / 100) * 100) / 100).toString())
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
    setBase('')
    setIva('')
    setRecargo('')
    setDescuentoFactura('')
    setFechaVencimiento('')
    setMonedaCarga('$')
    setCategoria(CATEGORIAS[0].valor)
    setLectura(null)
    setDocumento(null)
  }

  // ── Guardar ─────────────────────────────────────────────────────────────
  async function guardar() {
    setError('')
    setExito('')
    if (!numeroFactura.trim() || !proveedor.trim()) return falla('Completa al menos el número de factura y el proveedor', 'cf-numero')
    // Sin RIF el Libro de Compras queda incompleto para el SENIAT. El backend
    // valida el formato exacto; aca solo se evita el viaje si esta vacio.
    if (!rif.trim()) return falla('El RIF del proveedor es obligatorio', 'cf-rif')
    if (fechaEmision && fechaEmision > hoyISO) return falla('La fecha de la factura no puede ser futura', 'cf-fecha')
    // Todo el sistema costea en dolares. Cargar en bolivares es una comodidad
    // de tecleo: se convierte aca, una sola vez, a la tasa del dia.
    if (monedaCarga === 'Bs' && !tasa?.bcv) return falla('No se pudo obtener la tasa del día. Intenta de nuevo o carga en dólares.')
    const aUsd = (monto: number) => (monedaCarga === 'Bs' ? monto / (tasa!.bcv as number) : monto)

    // Un renglon con cantidad o costo pero sin mercancia se quedaba afuera
    // en silencio.
    const sinMercancia = esInsumos
      ? lineas.findIndex((l) => !l.ingrediente_id && (Number(l.cantidad) > 0 || Number(l.costo_unitario) > 0))
      : -1
    if (sinMercancia >= 0) return falla('Falta elegir la mercancía de algún renglón. Elígela o quita el renglón.', `cf-renglon-${sinMercancia}`)

    const items = lineas
      .filter((l) => l.ingrediente_id && Number(l.cantidad) > 0 && Number(l.costo_unitario) >= 0)
      .map((l) => ({
        ingrediente_id: l.ingrediente_id,
        cantidad: Number(l.cantidad),
        costo_unitario: aUsd(Number(l.costo_unitario)),
        // Solo viaja cuando ESTA factura contradice a la ficha.
        ...(l.exento === null ? {} : { exento: l.exento }),
      }))
    if (esInsumos && items.length === 0) return falla('Agrega al menos un renglón con cantidad y costo')
    const baseNum = Number(base)
    if (!esInsumos && (!Number.isFinite(baseNum) || baseNum <= 0)) return falla('La base imponible debe ser mayor a cero', 'cf-totales')

    // Se pregunta al momento, no con la revision de hace un rato: pudieron
    // cargarla en otra tablet mientras tanto.
    const yaCargadas = await api
      .revisarFacturaCompra({ proveedor_rif: rif.trim(), proveedor_nombre: proveedor.trim(), numero_factura: numeroFactura.trim(), items: [] })
      .then((r) => r.duplicadas)
      .catch(() => [])
    if (
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
    const esPdf = documento?.esPdf ?? false

    setGuardando(true)
    try {
      const comun = {
        numero_factura: numeroFactura.trim(),
        fecha_emision: fechaEmision || undefined,
        proveedor_nombre: proveedor.trim(),
        proveedor_rif: rif.trim(),
        categoria,
        forma_pago: formaPago,
        descripcion: descripcion.trim(),
        recargo: aUsd(recargoNum),
        descuento: aUsd(descuentoNum),
        fecha_vencimiento: esCredito && fechaVencimiento ? fechaVencimiento : undefined,
        referencia_pago: referenciaPago.trim() || undefined,
      }
      const guardada = await api.crearFacturaCompra(
        esInsumos
          ? { ...comun, items, iva: ivaLineas }
          : {
              ...comun,
              base_imponible: aUsd(baseNum),
              iva: aUsd(Number(iva) || 0),
              vida_util_meses: esActivo ? Number(vidaUtil) || 60 : undefined,
            },
      )
      limpiarFormulario()

      // Foto, memoria y alertas: un pedido que se puede repetir. La factura
      // ya entro: si falla, se avisa y se reintenta, no se deshace.
      const r = await completarDespuesDeGuardar(guardada.id, guardada.numero_factura, cuerpoCompletar)
      let cola = ''
      if (r.estado === 'hecho') {
        if (r.fotoPerdida) cola = esPdf ? ' Ojo: el PDF ya no estaba guardado y la factura quedó sin él.' : ' Ojo: la foto ya no estaba guardada y la factura quedó sin ella.'
        else if (r.foto) cola = esPdf ? ' PDF adjunto.' : ' Foto adjunta.'
      } else if (r.estado === 'pendiente') {
        cola = cuerpoCompletar.soporte_id
          ? ' Sin conexión para terminar: la foto, la memoria del proveedor y las alertas se completan solas al volver.'
          : ' Sin conexión para revisar los precios: se hace solo al volver.'
      } else {
        cola = ` Ojo: ${r.mensaje}`
      }
      setExito(
        `Factura ${guardada.numero_factura} cargada: $${guardada.total.toFixed(2)} ` +
          `(base $${guardada.base_imponible.toFixed(2)} + IVA $${guardada.iva.toFixed(2)}).` +
          (guardada.items.length ? ` ${guardada.items.length} renglón(es) al depósito.` : '') +
          cola,
      )
      onGuardada(r.estado === 'hecho' ? r.alertas : [])
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {
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
  return (
    <div className="space-y-3">
      {porCompletar > 0 && (
        <div className="rounded-lg bg-aviso-50 ring-1 ring-aviso-200 px-3 py-2 text-sm text-aviso-800 flex items-center justify-between gap-3">
          <span>
            {porCompletar === 1 ? 'Una factura guardada espera' : `${porCompletar} facturas guardadas esperan`} conexión para
            terminar (foto, memoria del proveedor, alertas). Se reintenta sola.
          </span>
          <button onClick={onReintentar} className="font-semibold shrink-0 underline">
            Reintentar ahora
          </button>
        </div>
      )}
      {/* Salir bien tiene que decirse: sin esto quedaba la duda de si darle
          otra vez, que es como se cargan dos facturas iguales. */}
      {exito && (
        <div className="rounded-lg bg-exito-500/10 ring-1 ring-exito-500/30 px-3 py-2 text-sm text-exito-800 flex items-start justify-between gap-3">
          <span>{exito}</span>
          <button onClick={onVerFacturas} className="font-semibold shrink-0 underline">
            Verla
          </button>
        </div>
      )}

      {!conDocumento && <ZonaDocumento onLeida={aplicarLectura} />}

      <div className={conDocumento ? 'lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-4 lg:items-start' : ''}>
        {conDocumento && <VisorDocumento url={documento.url} esPdf={documento.esPdf} />}

        <div className="bg-white rounded-2xl border border-neutral-200 p-4 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-semibold">{conDocumento ? 'Revisa contra la factura' : 'Cargar factura de proveedor'}</h2>
              <p className="text-xs text-neutral-500 mt-0.5">
                {conDocumento
                  ? 'Lo marcado con ✦ lo leyó la IA. Compáralo con el papel y corrige lo que haga falta.'
                  : esInsumos
                    ? 'Cada renglón reabastece el stock de esa mercancía y recalcula su costo promedio.'
                    : 'Alimenta el Libro de Compras y contabiliza sola: activos entran al balance, servicios van a gasto.'}
              </p>
            </div>
            {conDocumento && (
              <button onClick={limpiarFormulario} className="text-xs text-neutral-500 font-medium shrink-0 underline">
                Descartar
              </button>
            )}
          </div>

          {lectura && !borrador && (
            <Nota tono="ojo">
              No se pudo leer {documento?.esPdf ? 'el PDF' : 'la foto'}: {lectura.error} Cárgala a mano mirando el
              documento: se adjunta igual al guardar.
            </Nota>
          )}
          {borrador?.advertencias.map((a) => (
            <Nota key={a} tono="ojo">
              La IA avisa: {a}
            </Nota>
          ))}
          {error && <Nota tono="mal">{error}</Nota>}

          {/* ── Datos de la factura ── */}
          <Grupo titulo="Factura">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Dato
                id="cf-proveedor"
                etiqueta="Proveedor"
                ia={!!borrador && proveedor === (borrador.proveedor_nombre || proveedor)}
                className="sm:col-span-2"
              >
                {/* Un proveedor no registrado se puede tipear igual: el
                    directorio es una comodidad, no un requisito. */}
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
                etiqueta="RIF del proveedor"
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
                <input value={numeroFactura} onChange={(e) => setNumeroFactura(e.target.value)} placeholder="El de la factura, no el de control" className={clase(revision?.duplicadas.length ? 'mal' : undefined)} />
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
                        : 'La del papel. El mes del Libro de Compras lo decide el día en que se registra.'
                }
              >
                <input value={fechaEmision} onChange={(e) => setFechaEmision(e.target.value)} type="date" max={hoyISO} className={clase()} />
              </Dato>
              <Dato id="cf-moneda" etiqueta="Montos en" ia={!!borrador?.moneda && monedaCarga === borrador.moneda}>
                <select value={monedaCarga} onChange={(e) => setMonedaCarga(e.target.value as (typeof MONEDAS_DE_CARGA)[number])} className={clase()}>
                  {MONEDAS_DE_CARGA.map((m) => (
                    <option key={m} value={m}>
                      {m === '$' ? 'Dólares' : `Bolívares${tasa?.bcv ? ` (a ${tasa.bcv.toFixed(2)})` : ''}`}
                    </option>
                  ))}
                </select>
              </Dato>
              <Dato id="cf-categoria" etiqueta="Qué se compró">
                <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className={clase()}>
                  {CATEGORIAS.map((c) => (
                    <option key={c.valor} value={c.valor}>
                      {c.texto}
                    </option>
                  ))}
                </select>
              </Dato>
            </div>
          </Grupo>

          {/* ── Pago ── */}
          <Grupo titulo="Pago">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Dato id="cf-pago" etiqueta="Forma de pago">
                <select value={formaPago} onChange={(e) => setFormaPago(e.target.value)} className={clase()}>
                  {FORMAS_PAGO.map((f) => (
                    <option key={f} value={f}>
                      {f === 'Credito' ? 'A crédito (por pagar)' : f}
                    </option>
                  ))}
                </select>
              </Dato>
              {/* Solo cuando la plata ya salió y no fue en billetes. */}
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
              {/* Un equipo se gasta con los años: sin este dato entraba al
                  balance a valor de compra para siempre. */}
              {esActivo && (
                <Dato id="cf-vida" etiqueta="Dura (meses)">
                  <Numerico value={vidaUtil} onChange={(e) => setVidaUtil(e.target.value)} min="1" className={clase()} />
                </Dato>
              )}
              <Dato id="cf-descripcion" etiqueta="Nota (opcional)" className="sm:col-span-2">
                <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} className={clase()} />
              </Dato>
            </div>
          </Grupo>

          {/* ── Renglones o monto ── */}
          {esInsumos ? (
            <Grupo titulo={`Renglones (${lineas.length})`}>
              <div className="space-y-2">
                {lineas.map((l, i) => (
                  <Renglon
                    key={i}
                    indice={i}
                    linea={l}
                    ingredientes={ingredientes}
                    moneda={monedaCarga}
                    tasaIva={fiscal.tasa_iva}
                    aviso={avisoPrecio(i)}
                    problema={!l.ingrediente_id && (Number(l.cantidad) > 0 || Number(l.costo_unitario) > 0) ? { texto: 'Falta elegir la mercancía', tono: 'mal' } : problemaDeRenglon(l, i)}
                    puedeQuitar={lineas.length > 1}
                    onCambiar={(cambio) => cambiarLinea(i, cambio)}
                    onMercancia={(v) => elegirMercancia(i, v)}
                    onQuitar={() => setLineas((prev) => prev.filter((_, idx) => idx !== i))}
                  />
                ))}
                <button onClick={() => setLineas((prev) => [...prev, LINEA_VACIA])} className="text-sm text-neutral-600 font-medium">
                  + renglón
                </button>
              </div>
              {/* Casi ninguna factura es la suma limpia de sus renglones: sin
                  donde poner el flete o la rebaja habia que falsear un costo
                  unitario, y ahi el costo de receta empieza a mentir. */}
              <div className="grid grid-cols-2 gap-3 mt-3">
                <Dato id="cf-recargo" etiqueta="Recargo / flete" ia={!!borrador?.recargo && Number(recargo) === borrador.recargo}>
                  <Numerico value={recargo} onChange={(e) => setRecargo(e.target.value)} min="0" placeholder="0.00" className={clase()} />
                </Dato>
                <Dato id="cf-descuento" etiqueta="Descuento" ia={!!borrador?.descuento && Number(descuentoFactura) === borrador.descuento}>
                  <Numerico value={descuentoFactura} onChange={(e) => setDescuentoFactura(e.target.value)} min="0" placeholder="0.00" className={clase()} />
                </Dato>
              </div>
            </Grupo>
          ) : (
            <Grupo titulo="Monto">
              <div className="grid grid-cols-2 gap-3">
                <Dato id="cf-base" etiqueta={`Base imponible (${monedaCarga})`} ia={!!borrador && Number(base) === borrador.subtotal}>
                  <Numerico value={base} onChange={(e) => actualizarBase(e.target.value)} className={clase()} />
                </Dato>
                <Dato id="cf-iva" etiqueta={`IVA ${fiscal.tasa_iva}% (${monedaCarga})`} ia={!!borrador && Number(iva) === borrador.iva}>
                  <Numerico value={iva} onChange={(e) => setIva(e.target.value)} className={clase()} />
                </Dato>
              </div>
            </Grupo>
          )}

          {sinIvaEnPapel && (
            <Nota tono="ojo">
              La factura no trae IVA, pero {lineasConIva} renglón(es) lo están sumando según la ficha de la mercancía.{' '}
              <button
                type="button"
                className="font-semibold underline"
                onClick={() => setLineas((prev) => prev.map((l) => ({ ...l, exento: true })))}
              >
                Marcar todos exentos
              </button>
            </Nota>
          )}

          <Totales
            id="cf-totales"
            moneda={monedaCarga}
            base={baseMostrada}
            iva={ivaMostrado}
            total={totalFormulario}
            tasaIva={fiscal.tasa_iva}
            papel={cuadreAplica && borrador ? { subtotal: borrador.subtotal, iva: borrador.iva, total: totalPapel! } : null}
            cuadra={cuadra}
          />
        </div>
      </div>

      <BarraGuardar
        pendientes={pendientes}
        cuadre={cuadreAplica ? (cuadra ? 'cuadra' : `No cuadra: diferencia ${monedaCarga}${diferencia.toFixed(2)}`) : null}
        total={`${monedaCarga}${totalFormulario.toFixed(2)}`}
        guardando={guardando}
        onIrA={irA}
        onGuardar={guardar}
      />
    </div>
  )
}

// ── Piezas ────────────────────────────────────────────────────────────────

function clase(tono?: Tono) {
  const borde = tono === 'mal' ? 'border-peligro-400 ring-1 ring-peligro-200' : tono === 'ojo' ? 'border-aviso-400 ring-1 ring-aviso-200' : 'border-neutral-300'
  return `w-full border ${borde} rounded-lg px-3 py-2 text-sm bg-white`
}

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-2">{titulo}</h3>
      {children}
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
      <div className="flex items-center gap-1 mb-1">
        <span className="text-xs font-medium text-neutral-600">{etiqueta}</span>
        {ia && (
          <span className="text-acento-600 text-xs" title="Lo leyó la IA de la factura">
            ✦
          </span>
        )}
      </div>
      {children}
      {nota && <p className={`text-xs mt-1 ${colorNota}`}>{nota}</p>}
    </div>
  )
}

function Nota({ tono, children }: { tono: Tono; children: ReactNode }) {
  const tonos = { mal: 'bg-peligro-50 border-peligro-200 text-peligro-700', ojo: 'bg-aviso-50 border-aviso-200 text-aviso-800' }
  return <div className={`rounded-lg border px-3 py-2 text-sm ${tonos[tono]}`}>{children}</div>
}

/** Un renglón: lo que dice el papel arriba, y lo que va a entrar al depósito abajo. */
function Renglon({
  indice,
  linea: l,
  ingredientes,
  moneda,
  tasaIva,
  aviso,
  problema,
  puedeQuitar,
  onCambiar,
  onMercancia,
  onQuitar,
}: {
  indice: number
  linea: Linea
  ingredientes: Ingrediente[]
  moneda: string
  tasaIva: number
  aviso?: { nivel: string; mensaje: string; base: string; referencia: number; muestras: number }
  problema: { texto: string; tono: Tono } | null
  puedeQuitar: boolean
  onCambiar: (cambio: Partial<Linea>) => void
  onMercancia: (valor: string) => void
  onQuitar: () => void
}) {
  const ing = ingredientes.find((x) => x.id === l.ingrediente_id)
  const subtotal = (Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0)
  const recordada = l.recordada?.ingrediente_id === l.ingrediente_id ? l.recordada : undefined
  const sugerida = !l.ingrediente_id && l.leido ? sugerirMercancia(l.leido.descripcion, ingredientes) : null
  const conv = recordada ? conversion(recordada.factor, recordada.unidad_papel, recordada.unidad) : ''
  // La linea del papel tiene que cuadrar consigo misma: si cantidad x precio
  // no da su total, la IA leyo mal alguno de los tres.
  const papelNoCuadra =
    l.leido?.cantidad != null &&
    l.leido.precio_unitario != null &&
    l.leido.subtotal != null &&
    Math.abs(l.leido.cantidad * l.leido.precio_unitario - l.leido.subtotal) > Math.max(0.05, Math.abs(l.leido.subtotal) * 0.01)
  const estado = problema?.tono === 'mal' ? 'bg-peligro-500' : problema || papelNoCuadra ? 'bg-aviso-500' : l.ingrediente_id ? 'bg-exito-500' : 'bg-neutral-300'

  return (
    <div id={`cf-renglon-${indice}`} className="scroll-mt-24 rounded-xl border border-neutral-200 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${estado}`} />
        <div className="flex-1 min-w-0 text-xs">
          {l.leido ? (
            <p className="text-neutral-700">
              <span className="font-medium">{l.leido.descripcion || '(sin descripción)'}</span>
              <span className="text-neutral-500">
                {' · '}
                {l.leido.cantidad ?? '?'} {l.leido.unidad} × {moneda}
                {l.leido.precio_unitario ?? '?'}
                {l.leido.subtotal != null ? ` = ${moneda}${l.leido.subtotal}` : ''}
                {l.leido.exento ? ' · exento' : ''}
              </span>
            </p>
          ) : (
            <p className="text-neutral-400">Renglón {indice + 1}</p>
          )}
        </div>
        {puedeQuitar && (
          <button onClick={onQuitar} className="text-neutral-400 hover:text-peligro-600 text-sm px-1" title="Quitar renglón">
            ✕
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_7rem_8rem_8.5rem] gap-2 items-center">
        <select
          value={l.ingrediente_id}
          onChange={(e) => onMercancia(e.target.value)}
          className={`${clase(!l.ingrediente_id && (Number(l.cantidad) > 0 || Number(l.costo_unitario) > 0) ? 'mal' : undefined)} col-span-2 sm:col-span-1`}
        >
          <option value={0}>Mercancía…</option>
          {ingredientes.map((x) => (
            <option key={x.id} value={x.id}>
              {x.nombre} ({x.unidad})
            </option>
          ))}
          <option value="nuevo">+ Crear mercancía nueva…</option>
        </select>
        <Numerico
          value={l.cantidad}
          onChange={(e) => onCambiar({ cantidad: e.target.value })}
          placeholder={`Cant.${ing ? ` (${ing.unidad})` : ''}`}
          className={clase()}
        />
        <Numerico
          value={l.costo_unitario}
          onChange={(e) => onCambiar({ costo_unitario: e.target.value })}
          placeholder={`Costo/u (${moneda})`}
          className={clase(aviso ? (aviso.nivel === 'unidad' ? 'mal' : 'ojo') : undefined)}
        />
        {/* La ficha es el valor por defecto, no la ultima palabra: la misma
            cosa puede venir exenta de un proveedor y gravada de otro. */}
        <select
          value={l.exento === null ? 'ficha' : l.exento ? 'exento' : 'grava'}
          onChange={(e) => onCambiar({ exento: e.target.value === 'ficha' ? null : e.target.value === 'exento' })}
          title="Si este renglón paga IVA"
          className={clase()}
        >
          <option value="ficha">{ing ? (ing.exento ? 'Exento (ficha)' : `IVA ${tasaIva}% (ficha)`) : 'IVA: ficha'}</option>
          <option value="grava">IVA {tasaIva}%</option>
          <option value="exento">Exento</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <div className="space-y-0.5 min-w-0">
          {sugerida && (
            <button onClick={() => onMercancia(String(sugerida.id))} className="text-acento-700 font-medium">
              ¿Es {sugerida.nombre} ({sugerida.unidad})? Usarla
            </button>
          )}
          {recordada && (
            <p className="text-exito-700">
              Recordado de este proveedor{conv ? `: ${conv}, ya convertido` : ''} ·{' '}
              {recordada.veces === 1 ? '1 factura' : `${recordada.veces} facturas`}
              {!recordada.exacta && <span className="text-aviso-700"> · parecido a «{recordada.descripcion_recordada}», revísalo</span>}
            </p>
          )}
          {l.leido && !recordada && ing && unidadDistinta(l.leido.unidad, ing.unidad) && (
            <p className="text-aviso-800">
              La factura dice {l.leido.unidad} y {ing.nombre} se lleva en {ing.unidad}: ajusta cantidad y costo si no es
              uno a uno.
            </p>
          )}
          {papelNoCuadra && (
            <p className="text-aviso-800">En el papel, cantidad × precio no da el total del renglón: revisa esos números.</p>
          )}
          {aviso && (
            <p className={aviso.nivel === 'unidad' ? 'text-peligro-700' : 'text-aviso-800'}>
              {aviso.mensaje}{' '}
              {aviso.base === 'compras'
                ? `Se venía pagando $${aviso.referencia.toFixed(2)} (últimas ${aviso.muestras} compras).`
                : `Costo promedio: $${aviso.referencia.toFixed(2)}.`}
            </p>
          )}
        </div>
        <span className="font-semibold text-neutral-700 tabular-nums ml-auto">
          {moneda}
          {subtotal.toFixed(2)}
        </span>
      </div>
    </div>
  )
}

function Totales({
  id,
  moneda,
  base,
  iva,
  total,
  tasaIva,
  papel,
  cuadra,
}: {
  id: string
  moneda: string
  base: number
  iva: number
  total: number
  tasaIva: number
  papel: { subtotal: number | null; iva: number | null; total: number } | null
  cuadra: boolean
}) {
  const fila = (rotulo: string, nuestro: number, delPapel?: number | null, fuerte = false) => (
    <tr className={fuerte ? 'font-semibold text-neutral-900' : 'text-neutral-600'}>
      <td className="py-1">{rotulo}</td>
      <td className="py-1 text-right tabular-nums">
        {moneda}
        {nuestro.toFixed(2)}
      </td>
      {papel && (
        <td className="py-1 text-right tabular-nums text-neutral-500">{delPapel == null ? '—' : `${moneda}${delPapel.toFixed(2)}`}</td>
      )}
    </tr>
  )
  return (
    <div id={id} className={`scroll-mt-24 rounded-xl p-3 ${papel ? (cuadra ? 'bg-exito-50' : 'bg-aviso-50') : 'bg-neutral-50'}`}>
      <table className="w-full text-sm">
        {papel && (
          <thead>
            <tr className="text-xs text-neutral-500">
              <th />
              <th className="text-right font-medium">Formulario</th>
              <th className="text-right font-medium">Papel ✦</th>
            </tr>
          </thead>
        )}
        <tbody>
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
    <div className="sticky bottom-3 z-20 rounded-2xl border border-neutral-200 bg-white/95 backdrop-blur shadow-lg px-4 py-3">
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
            <ul className="absolute bottom-full mb-2 left-0 w-72 max-w-[85vw] rounded-xl border border-neutral-200 bg-white shadow-lg p-1">
              {pendientes.map((p, i) => (
                <li key={i}>
                  <button
                    onClick={() => {
                      setAbierta(false)
                      onIrA(p.ancla)
                    }}
                    className={`w-full text-left text-sm px-3 py-2 rounded-lg hover:bg-neutral-50 ${p.tono === 'mal' ? 'text-peligro-700' : 'text-aviso-800'}`}
                  >
                    {p.texto}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <span className="text-sm font-semibold tabular-nums text-neutral-800 hidden sm:block">{total}</span>
        <button
          onClick={onGuardar}
          disabled={guardando}
          className="bg-neutral-900 text-white px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-50 shrink-0"
        >
          {guardando ? 'Guardando…' : 'Guardar factura'}
        </button>
      </div>
    </div>
  )
}

/**
 * Donde entra la factura: arrastrarla, tocar para elegir (en el teléfono:
 * cámara, galería o el PDF del correo), o pegarla con Ctrl+V. No aparece si
 * la lectura con IA no está activada.
 */
function ZonaDocumento({ onLeida }: { onLeida: (l: LecturaFactura, url: string, esPdf: boolean) => void }) {
  const [activo, setActivo] = useState(false)
  const [leyendo, setLeyendo] = useState(false)
  const [segundos, setSegundos] = useState(0)
  const [encima, setEncima] = useState(false)
  const [error, setError] = useState('')
  const entrada = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api
      .estadoLectorFacturas()
      .then((e) => setActivo(e.activo))
      .catch(() => setActivo(false))
  }, [])

  // Leer tarda segundos (mas si el servicio esta saturado): un contador dice
  // que sigue trabajando y no que se colgo.
  useEffect(() => {
    if (!leyendo) return
    const t = setInterval(() => setSegundos((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [leyendo])

  async function leer(archivo: File | undefined) {
    if (!archivo || leyendo) return
    if (!archivo.type.startsWith('image/') && archivo.type !== 'application/pdf') {
      setError('Tiene que ser una foto o un PDF.')
      return
    }
    setError('')
    setSegundos(0)
    setLeyendo(true)
    try {
      const subido = await achicarFoto(archivo)
      const lectura = await api.leerFacturaCompra(subido)
      onLeida(lectura, URL.createObjectURL(subido), subido.type === 'application/pdf')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer el archivo')
    } finally {
      setLeyendo(false)
      if (entrada.current) entrada.current.value = ''
    }
  }

  // Pegar una captura o un PDF copiado (Ctrl+V), sin pasar por el disco.
  useEffect(() => {
    if (!activo) return
    const alPegar = (e: ClipboardEvent) => {
      const archivo = Array.from(e.clipboardData?.files ?? []).find(
        (f) => f.type.startsWith('image/') || f.type === 'application/pdf',
      )
      if (archivo) {
        e.preventDefault()
        leer(archivo)
      }
    }
    window.addEventListener('paste', alPegar)
    return () => window.removeEventListener('paste', alPegar)
  })

  if (!activo) return null
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setEncima(true)
      }}
      onDragLeave={() => setEncima(false)}
      onDrop={(e) => {
        e.preventDefault()
        setEncima(false)
        leer(e.dataTransfer.files?.[0])
      }}
      className={`rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
        encima ? 'border-acento-500 bg-acento-50' : 'border-neutral-300 bg-white'
      }`}
    >
      <input ref={entrada} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => leer(e.target.files?.[0])} />
      {leyendo ? (
        <div className="space-y-1">
          <p className="font-semibold">Leyendo la factura… {segundos}s</p>
          <p className="text-xs text-neutral-500">
            {segundos < 15 ? 'Suele tardar unos segundos.' : 'El servicio está lento; sigue intentando. Si tarda mucho, puedes cargarla a mano abajo.'}
          </p>
        </div>
      ) : (
        <>
          <button onClick={() => entrada.current?.click()} className="inline-flex items-center gap-2 bg-neutral-900 text-white px-5 py-2.5 rounded-lg text-sm font-semibold">
            <Icono nombre="chispa" size={16} />
            Cargar factura desde foto o PDF
          </button>
          <p className="text-xs text-neutral-500 mt-2">
            O arrástrala aquí, o pégala con Ctrl+V. La IA llena el formulario y tú lo revisas antes de guardar.
          </p>
        </>
      )}
      {error && <p className="text-peligro-600 text-sm mt-2">{error}</p>}
    </div>
  )
}

/**
 * La factura a la vista mientras se revisa. En pantalla ancha queda fija al
 * lado del formulario; en el teléfono, arriba y plegable. Se puede girar:
 * muchas llegan escaneadas de lado.
 */
function VisorDocumento({ url, esPdf }: { url: string; esPdf: boolean }) {
  const [giro, setGiro] = useState(0)
  const [cerca, setCerca] = useState(false)
  const [abierto, setAbierto] = useState(true)
  return (
    <div className="mb-3 lg:mb-0 lg:sticky lg:top-4 bg-white rounded-2xl border border-neutral-200 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-neutral-100">
        <button onClick={() => setAbierto((v) => !v)} className="text-sm font-semibold lg:pointer-events-none">
          Factura {esPdf ? '(PDF)' : ''} <span className="lg:hidden text-neutral-400">{abierto ? '▾' : '▸'}</span>
        </button>
        {!esPdf && abierto && (
          <div className="flex gap-1">
            <button onClick={() => setGiro((g) => (g + 90) % 360)} className="text-xs px-2 py-1 rounded-md border border-neutral-200" title="Girar">
              ↻ Girar
            </button>
            <button onClick={() => setCerca((v) => !v)} className="text-xs px-2 py-1 rounded-md border border-neutral-200">
              {cerca ? 'Ajustar' : 'Acercar'}
            </button>
          </div>
        )}
      </div>
      {abierto &&
        (esPdf ? (
          <div className="h-[60vh] lg:h-[calc(100vh-7rem)]">
            <VistaSoporte url={url} esPdf alto="h-full" />
          </div>
        ) : (
          <div className="h-[60vh] lg:h-[calc(100vh-7rem)] overflow-auto bg-neutral-100 flex items-start justify-center">
            <img
              src={url}
              alt="Factura del proveedor"
              style={{ transform: `rotate(${giro}deg)`, transformOrigin: 'center' }}
              className={`${cerca ? 'max-w-none w-[200%]' : giro % 180 ? 'max-h-full max-w-[75%] mt-16' : 'max-w-full'} transition-transform`}
            />
          </div>
        ))}
    </div>
  )
}
