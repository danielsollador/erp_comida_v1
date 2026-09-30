import { useEffect, useMemo, useState } from 'react'
import CampoSugerido from '../components/CampoSugerido'
import {
  BotonFoto,
  MemoriaProveedores,
  PanelRevision,
  RenglonDelPapel,
  VerSoporte,
} from '../components/FacturaDesdeFoto'
import NavBar from '../components/NavBar'
import { useSeccion } from '../components/Secciones'
import { FiltroFechas } from '../components/Fechas'
import { useRango } from '../lib/fechas'
import { useDialogo } from '../components/dialogo'
import { Tabla, Th, useBuscador, useOrden } from '../components/Tabla'
import { Boton, Campo, Modal, Pagina, Pastilla, Vacio } from '../components/ui'
import { Numerico } from '../components/Teclado'
import { api } from '../lib/api'
import { useMoneda } from '../lib/moneda'
import { useRevision } from '../lib/revisionFactura'
import { necesitaReferencia, pedirReferencia } from '../lib/pagos'
import type {
  ConfiguracionFiscal,
  FacturaCompra,
  Ingrediente,
  LecturaFactura,
  Proveedor,
  RenglonLeido,
  SugerenciaRenglon,
} from '../lib/types'

const MONEDAS_DE_CARGA = ['$', 'Bs'] as const

// El valor que viaja y se guarda NO cambia: "Insumos" es la clave con la que
// la contabilidad decide a que cuenta va cada compra, y la llevan las facturas
// que ya estan cargadas. Lo que cambia es la palabra que se lee: quien carga
// una factura de proveedor compra mercancia, no "insumos" -- esa palabra es de
// Inventario, donde lo mismo ya entro al deposito y va a una receta.
const CATEGORIAS = [
  { valor: 'Insumos', texto: 'Mercancía' },
  { valor: 'Servicios', texto: 'Servicios' },
  { valor: 'Activos', texto: 'Activos' },
  { valor: 'Otros', texto: 'Otros' },
]
const FORMAS_PAGO = ['Efectivo', 'Efectivo $', 'Banco', 'Credito']

// Una factura mas vieja que esto se avisa, no se bloquea: el plazo real para
// descontar ese credito fiscal lo confirma quien lleva la contabilidad.
const DIAS_FACTURA_VIEJA = 60

/** Como se lee una categoria guardada. Es el mismo mapa, al reves. */
const TEXTO_CATEGORIA = Object.fromEntries(CATEGORIAS.map((c) => [c.valor, c.texto]))

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

const SECCIONES = [
  { id: 'facturas', texto: 'Facturas' },
  { id: 'nueva', texto: 'Cargar factura' },
  { id: 'proveedores', texto: 'Proveedores' },
]

export default function Compras() {
  const [seccion, irA] = useSeccion(SECCIONES)
  // Tres meses: una factura a credito se paga a 30 o 60 dias, y hay que verla.
  const [rango, setRango] = useRango('90d')
  const [facturas, setFacturas] = useState<FacturaCompra[]>([])
  // Lo mas reciente arriba, que es lo que se acaba de cargar; pero ordenar por
  // Estado junta lo pendiente de pagar, que es la otra razon para entrar aqui.
  const orden = useOrden<FacturaCompra>(
    {
      fecha: (f) => new Date(f.fecha),
      factura: (f) => f.numero_factura,
      proveedor: (f) => f.proveedor_nombre,
      base: (f) => f.base_imponible,
      iva: (f) => f.iva,
      total: (f) => f.total,
      estado: (f) => (f.pagada ? 'Pagada' : 'Pendiente'),
    },
    '-fecha',
  )
  // Es la lista que mas crece del ERP: una fila por factura, para siempre.
  // Se busca por el numero que trae el papel y por el proveedor.
  const buscador = useBuscador<FacturaCompra>(
    (f) => [f.numero_factura, f.proveedor_nombre, f.proveedor_rif, f.descripcion],
    'Buscar por factura, proveedor o RIF',
  )
  const buscadorProveedores = useBuscador<Proveedor>(
    (p) => [p.nombre, p.rif, p.telefono, p.contacto],
    'Buscar por nombre, RIF o teléfono',
  )
  const [ingredientes, setIngredientes] = useState<Ingrediente[]>([])
  const [fiscal, setFiscal] = useState<ConfiguracionFiscal>({ tasa_iva: 16 })
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [fichaProveedor, setFichaProveedor] = useState<Proveedor | 'nuevo' | null>(null)
  const [error, setError] = useState('')
  const dialogo = useDialogo()

  const { tasa } = useMoneda()
  const [numeroFactura, setNumeroFactura] = useState('')
  // La fecha impresa en el papel. Solo se muestra en el Libro de Compras: el
  // periodo lo decide la fecha de registro (hoy), que pone el backend.
  const hoyISO = new Date().toLocaleDateString('en-CA')
  const [fechaEmision, setFechaEmision] = useState('')
  const diasDeLaFactura = fechaEmision
    ? Math.round(
        (new Date(`${hoyISO}T12:00:00`).getTime() - new Date(`${fechaEmision}T12:00:00`).getTime()) / 86400000,
      )
    : 0
  const [proveedor, setProveedor] = useState('')
  const [rif, setRif] = useState('')
  // La factura del proveedor puede venir en cualquiera de las dos: el que
  // vende insumos suele cobrar en dolares, pero el de servicios (luz, gas,
  // alquiler) casi siempre factura en bolivares.
  const [monedaCarga, setMonedaCarga] = useState<(typeof MONEDAS_DE_CARGA)[number]>('$')
  const [categoria, setCategoria] = useState(CATEGORIAS[0].valor)
  const [formaPago, setFormaPago] = useState(FORMAS_PAGO[0])
  // El comprobante de con qué se le pagó al proveedor. Solo cuando la factura
  // se carga ya pagada y no en efectivo (a crédito todavía no ha salido plata).
  const [referenciaPago, setReferenciaPago] = useState('')
  const [descripcion, setDescripcion] = useState('')

  // Con insumos: renglones por ingrediente, que reabastecen el stock solos.
  const [lineas, setLineas] = useState<Linea[]>([
    { ingrediente_id: 0, cantidad: '', costo_unitario: '', exento: null },
  ])
  // Lo que el proveedor suma o rebaja sobre el total: flete, recargo por pagar
  // a credito, descuento por volumen. Van en positivo los dos.
  const [recargo, setRecargo] = useState('')
  const [descuentoFactura, setDescuentoFactura] = useState('')
  // Cargar una factura no decia nada al salir bien: el formulario se limpiaba
  // y ya. Eso deja a quien la cargo sin saber si entro, y la unica salida era
  // ir a la lista a buscarla.
  const [exito, setExito] = useState('')
  // Sin insumos (servicios, activos...): un monto suelto, como antes.
  const [base, setBase] = useState('')
  const [iva, setIva] = useState('')
  const [fechaVencimiento, setFechaVencimiento] = useState('')
  // Cuantos meses dura el equipo. Define la cuota de depreciacion mensual.
  const [vidaUtil, setVidaUtil] = useState('60')
  // La foto leida: su soporte se engancha a la factura al guardar.
  const [lectura, setLectura] = useState<LecturaFactura | null>(null)
  const [fotoLectura, setFotoLectura] = useState('')
  const [verSoporte, setVerSoporte] = useState<number | null>(null)

  // Con que forma de pago se va a saldar cada factura a credito pendiente -
  // una por fila, para el boton "Marcar pagada" de cuentas por pagar.
  const [liquidacion, setLiquidacion] = useState<Record<number, string>>({})
  const [pagando, setPagando] = useState<number | null>(null)

  const esInsumos = categoria === 'Insumos'
  const esCredito = formaPago === 'Credito'
  const esActivo = categoria === 'Activos'

  useEffect(() => {
    cargar()
  }, [rango])

  function cargar() {
    api.listarFacturasCompra(rango).then(setFacturas)
    api.listarIngredientes().then((l) => setIngredientes(l.filter((i) => i.activo !== false)))
    api.configFiscal().then(setFiscal)
    api.listarProveedores().then(setProveedores)
  }

  // Elegir un proveedor del directorio completa nombre y RIF solos, para no
  // volver a tipearlos cada vez con el riesgo de que un error de tecleo
  // separe "Carnes SA" de "Carnes S.A." en dos proveedores para siempre.
  function elegirProveedorConocido(nombre: string) {
    setProveedor(nombre)
    const p = proveedores.find((x) => x.nombre === nombre)
    if (p?.rif) setRif(p.rif)
  }

  async function guardarProveedor(datos: Omit<Proveedor, 'id' | 'activo'>) {
    if (fichaProveedor && fichaProveedor !== 'nuevo') {
      await api.editarProveedor(fichaProveedor.id, datos)
    } else {
      await api.crearProveedor(datos)
    }
    setFichaProveedor(null)
    api.listarProveedores().then(setProveedores)
  }

  async function archivarProveedor(p: Proveedor) {
    if (!(await dialogo.confirmar({ titulo: `${p.activo ? 'Archivar' : 'Reactivar'} a ${p.nombre}?` }))) return
    await api.archivarProveedor(p.id, !p.activo)
    api.listarProveedores().then(setProveedores)
  }

  const baseLineas = useMemo(
    () =>
      lineas.reduce((sum, l) => {
        const cantidad = Number(l.cantidad) || 0
        const costo = Number(l.costo_unitario) || 0
        return sum + cantidad * costo
      }, 0),
    [lineas],
  )
  const recargoNum = Number(recargo) || 0
  const descuentoNum = Number(descuentoFactura) || 0
  // La base que de verdad se va a guardar: los renglones, mas el recargo,
  // menos el descuento.
  const baseFinal = Math.round((baseLineas + recargoNum - descuentoNum) * 100) / 100
  // Solo de vista previa: el numero real lo calcula el backend con el mismo
  // criterio al guardar. El recargo y el descuento se reparten entre los
  // renglones, asi que tambien mueven el IVA.
  const ivaLineas = useMemo(() => {
    const bruta = lineas.reduce(
      (sum, l) => sum + (Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0),
      0,
    )
    const gravada = lineas.reduce((sum, l) => {
      const ing = ingredientes.find((x) => x.id === l.ingrediente_id)
      const exento = l.exento === null ? Boolean(ing?.exento) : l.exento
      if (exento) return sum
      return sum + (Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0)
    }, 0)
    const factor = bruta > 0 ? (bruta + recargoNum - descuentoNum) / bruta : 1
    return Math.round(gravada * factor * (fiscal.tasa_iva / 100) * 100) / 100
  }, [lineas, ingredientes, fiscal.tasa_iva, recargoNum, descuentoNum])

  // Duplicado y precios fuera de lo normal, mientras se llena. Sirve igual
  // para una factura tecleada que para una leida de una foto.
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

  // La IA propone; aca solo se llena el formulario. Nada se guarda hasta que
  // alguien lo revisa y le da "Cargar factura".
  function aplicarLectura(l: LecturaFactura, foto: string) {
    setError('')
    setExito('')
    setLectura(l)
    setFotoLectura(foto)
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
    if (b.renglones.length > 0) {
      setCategoria('Insumos')
      // La mercancia de cada renglon la elige quien revisa: el papel dice
      // "HARINA PAN 1KG", no cual de nuestras mercancias es.
      setLineas(
        b.renglones.map((r) => ({
          ingrediente_id: 0,
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
    } else {
      setBase(b.subtotal == null ? '' : String(b.subtotal))
      setIva(b.iva == null ? '' : String(b.iva))
    }
  }

  function actualizarLinea(i: number, campo: keyof Linea, valor: string) {
    setLineas((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, [campo]: campo === 'ingrediente_id' ? Number(valor) : valor } : l)),
    )
  }

  function agregarLinea() {
    setLineas((prev) => [...prev, { ingrediente_id: 0, cantidad: '', costo_unitario: '', exento: null }])
  }

  function quitarLinea(i: number) {
    setLineas((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))
  }

  // Al escribir un costo unitario, se rellena con lo que ya cuesta ese insumo
  // hoy en el sistema - el dueno solo corrige si el proveedor le vendio distinto.
  async function elegirIngrediente(i: number, ingredienteId: string) {
    if (ingredienteId === 'nuevo') {
      // Sin esto, un insumo que llega por primera vez (un proveedor nuevo
      // trae algo que no estaba en el menu todavia) obligaba a salir de
      // Compras, ir a Inventario a crearlo, y volver a cargar la factura
      // desde cero.
      const datos = await dialogo.pedir({
        titulo: 'Mercancía nueva',
        campos: [
          { nombre: 'nombre', etiqueta: 'Nombre', placeholder: 'Ej. Pollo' },
          {
            nombre: 'unidad',
            etiqueta: 'Unidad',
            tipo: 'opciones',
            valor: 'kg',
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
        exento: false,
      })
      setIngredientes((prev) => [...prev, creado])
      setLineas((prev) => prev.map((l, idx) => (idx === i ? { ...l, ingrediente_id: creado.id } : l)))
      return
    }

    const ing = ingredientes.find((x) => x.id === Number(ingredienteId))
    setLineas((prev) =>
      prev.map((l, idx) =>
        idx === i
          ? {
              ...l,
              ingrediente_id: Number(ingredienteId),
              costo_unitario: l.costo_unitario || (ing ? String(ing.costo_unitario) : ''),
            }
          : l,
      ),
    )
  }

  // Al escribir la base (solo cuando NO es Insumos), se sugiere el IVA con la
  // tasa vigente - el usuario puede corregirlo si la factura trae otro monto.
  function actualizarBase(valor: string) {
    setBase(valor)
    const num = Number(valor)
    if (Number.isFinite(num) && num > 0) {
      setIva((Math.round(num * (fiscal.tasa_iva / 100) * 100) / 100).toString())
    }
  }

  function limpiarFormulario() {
    setNumeroFactura('')
    setFechaEmision('')
    setProveedor('')
    setRif('')
    setDescripcion('')
    setLineas([{ ingrediente_id: 0, cantidad: '', costo_unitario: '', exento: null }])
    setBase('')
    setIva('')
    setRecargo('')
    setDescuentoFactura('')
    setFechaVencimiento('')
    setMonedaCarga('$')
    setLectura(null)
    setFotoLectura('')
  }

  async function agregarFactura() {
    setError('')
    setExito('')
    if (!numeroFactura.trim() || !proveedor.trim()) {
      setError('Completa al menos el número de factura y el proveedor')
      return
    }
    // Sin RIF el Libro de Compras queda incompleto para el SENIAT. El backend
    // valida el formato exacto; aca solo se evita el viaje si esta vacio.
    if (!rif.trim()) {
      setError('El RIF del proveedor es obligatorio')
      return
    }
    if (fechaEmision && fechaEmision > hoyISO) {
      setError('La fecha de la factura no puede ser futura')
      return
    }
    // Todo el sistema costea en dolares (recetas, margenes, balance). Cargar
    // en bolivares es una comodidad de tecleo -la factura del gas casi
    // siempre viene en Bs-, no una segunda moneda que el resto del ERP tenga
    // que entender: se convierte aca, una sola vez, a la tasa del dia.
    if (monedaCarga === 'Bs' && !tasa?.bcv) {
      setError('No se pudo obtener la tasa del día. Intenta de nuevo o carga en dólares.')
      return
    }
    const aUsd = (monto: number) => (monedaCarga === 'Bs' ? monto / (tasa!.bcv as number) : monto)

    // Un renglon con cantidad o costo pero sin mercancia se quedaba afuera
    // en silencio. Con la foto pasa mas facil: el renglon llega lleno y solo
    // falta elegir la mercancia.
    const sinMercancia = esInsumos
      ? lineas.filter((l) => !l.ingrediente_id && (Number(l.cantidad) > 0 || Number(l.costo_unitario) > 0)).length
      : 0
    if (sinMercancia > 0) {
      setError(`Falta elegir la mercancía de ${sinMercancia} renglón(es). Elígela o quita el renglón.`)
      return
    }

    // Se pregunta al momento, no con la revision de hace un rato: pudieron
    // cargarla en otra tablet mientras tanto.
    const yaCargadas = await api
      .revisarFacturaCompra({
        proveedor_rif: rif.trim(),
        proveedor_nombre: proveedor.trim(),
        numero_factura: numeroFactura.trim(),
        items: [],
      })
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
    const paraRecordar = lectura
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
      : []
    const rifGuardado = rif.trim()
    const proveedorGuardado = proveedor.trim()

    // La foto se engancha despues del guardado de siempre. Si falla, la
    // factura ya entro: se avisa, no se deshace.
    async function adjuntarFoto(facturaId: number): Promise<string> {
      if (!lectura) return ''
      try {
        await api.adjuntarSoporteFactura(facturaId, lectura.soporte_id)
        return ' Foto adjunta.'
      } catch (e) {
        return ` Ojo: la foto no se pudo adjuntar (${e instanceof Error ? e.message : 'error'}).`
      }
    }

    // Si no se puede recordar, la factura igual entro: solo se avisa.
    async function recordar(): Promise<string> {
      if (paraRecordar.length === 0) return ''
      try {
        await api.aprenderEquivalencias(rifGuardado, proveedorGuardado, paraRecordar)
        return ''
      } catch {
        return ' (No se pudo recordar la asociación de sus renglones para la próxima.)'
      }
    }

    try {
      if (esInsumos) {
        const items = lineas
          .filter((l) => l.ingrediente_id && Number(l.cantidad) > 0 && Number(l.costo_unitario) >= 0)
          .map((l) => ({
            ingrediente_id: l.ingrediente_id,
            cantidad: Number(l.cantidad),
            costo_unitario: aUsd(Number(l.costo_unitario)),
            // Solo viaja cuando ESTA factura contradice a la ficha; si no, se
            // omite y manda lo que diga la mercancía.
            ...(l.exento === null ? {} : { exento: l.exento }),
          }))
        if (items.length === 0) {
          setError('Agrega al menos un renglón con cantidad y costo')
          return
        }
        const guardada = await api.crearFacturaCompra({
          numero_factura: numeroFactura.trim(),
          fecha_emision: fechaEmision || undefined,
          proveedor_nombre: proveedor.trim(),
          proveedor_rif: rif.trim(),
          categoria,
          forma_pago: formaPago,
          descripcion: descripcion.trim(),
          items,
          iva: ivaLineas,
          recargo: aUsd(recargoNum),
          descuento: aUsd(descuentoNum),
          fecha_vencimiento: esCredito && fechaVencimiento ? fechaVencimiento : undefined,
          referencia_pago: referenciaPago.trim() || undefined,
        })
        setExito(
          `Factura ${guardada.numero_factura} cargada: $${guardada.total.toFixed(2)} ` +
            `(base $${guardada.base_imponible.toFixed(2)} + IVA $${guardada.iva.toFixed(2)}). ` +
            `${guardada.items.length} renglón(es) al depósito.` +
            (await adjuntarFoto(guardada.id)) +
            (await recordar()),
        )
      } else {
        const baseNum = Number(base)
        if (!Number.isFinite(baseNum) || baseNum <= 0) {
          setError('La base imponible debe ser mayor a cero')
          return
        }
        const guardada = await api.crearFacturaCompra({
          numero_factura: numeroFactura.trim(),
          fecha_emision: fechaEmision || undefined,
          proveedor_nombre: proveedor.trim(),
          proveedor_rif: rif.trim(),
          categoria,
          forma_pago: formaPago,
          descripcion: descripcion.trim(),
          base_imponible: aUsd(baseNum),
          iva: aUsd(Number(iva) || 0),
          recargo: aUsd(recargoNum),
          descuento: aUsd(descuentoNum),
          fecha_vencimiento: esCredito && fechaVencimiento ? fechaVencimiento : undefined,
          vida_util_meses: esActivo ? Number(vidaUtil) || 60 : undefined,
          referencia_pago: referenciaPago.trim() || undefined,
        })
        setExito(
          `Factura ${guardada.numero_factura} cargada: $${guardada.total.toFixed(2)} ` +
            `(base $${guardada.base_imponible.toFixed(2)} + IVA $${guardada.iva.toFixed(2)}).` +
            (await adjuntarFoto(guardada.id)),
        )
      }
      limpiarFormulario()
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar la factura')
    }
  }

  async function notaCredito(f: FacturaCompra) {
    // El espejo de la devolucion de venta. Sin esto, el unico camino era un
    // ajuste de inventario, que registra la diferencia como MERMA: una perdida
    // que no ocurrio, credito fiscal de mas en el Libro de Compras y una deuda
    // inflada con el proveedor.
    const tipo = (await dialogo.elegir({
      titulo: `Nota de crédito de ${f.proveedor_nombre}`,
      texto: `Sobre la factura ${f.numero_factura}. ¿Qué pasó?`,
      opciones: [
        { valor: 'devolucion', texto: 'Devolución', detalle: 'La mercancía vuelve al proveedor y sale del inventario.' },
        { valor: 'descuento', texto: 'Descuento', detalle: 'Te quedas la mercancía y te rebajan el precio.' },
      ],
    })) as 'devolucion' | 'descuento' | null
    if (!tipo) return

    if (tipo === 'descuento') {
      const r = await dialogo.pedir({
        titulo: 'Descuento del proveedor',
        campos: [
          { nombre: 'numero', etiqueta: 'Número de la nota de crédito' },
          { nombre: 'base', etiqueta: 'Cuánto te acreditaron, sin IVA', sufijo: '$', tipo: 'numero', min: 0.01 },
          { nombre: 'motivo', etiqueta: 'Motivo', placeholder: 'Mandó menos, llegó dañado, descuento...', opcional: true },
        ],
        aceptar: 'Registrar',
      })
      if (!r) return
      await accionFactura(() =>
        api.crearNotaCredito(f.id, { numero: r.numero, tipo, motivo: r.motivo, base_imponible: Number(r.base) }),
      )
      return
    }

    // Devolucion: de que insumos y cuanto vuelve de cada uno. Un solo
    // formulario con una linea por insumo, no una pregunta por insumo.
    const r = await dialogo.pedir({
      titulo: 'Devolución al proveedor',
      texto: 'Cuánto vuelve de cada renglón. Deja en 0 lo que se queda.',
      ancho: 'md',
      campos: [
        { nombre: 'numero', etiqueta: 'Número de la nota de crédito' },
        { nombre: 'motivo', etiqueta: 'Motivo', placeholder: 'Mandó menos, llegó dañado...', opcional: true },
        ...f.items.map((it) => ({
          nombre: `item_${it.ingrediente_id}`,
          etiqueta: it.ingrediente_nombre,
          sufijo: `${it.unidad}, la factura trae ${it.cantidad}`,
          tipo: 'numero' as const,
          valor: 0,
          max: it.cantidad,
        })),
      ],
      aceptar: 'Registrar devolución',
    })
    if (!r) return
    const items = f.items
      .map((it) => ({ ingrediente_id: it.ingrediente_id, cantidad: Number(r[`item_${it.ingrediente_id}`]) }))
      .filter((it) => it.cantidad > 0)
    if (items.length === 0) {
      await dialogo.avisar({ titulo: 'Nada que devolver', texto: 'No se indicó ninguna cantidad a devolver.', tono: 'ojo' })
      return
    }
    await accionFactura(() => api.crearNotaCredito(f.id, { numero: r.numero, tipo, motivo: r.motivo, items }))
  }

  async function accionFactura(fn: () => Promise<unknown>) {
    try {
      await fn()
      cargar()
    } catch (e) {
      await dialogo.avisar({
        titulo: 'No se pudo registrar la nota de crédito',
        texto: e instanceof Error ? e.message : undefined,
        tono: 'mal',
      })
    }
  }

  async function borrar(f: FacturaCompra) {
    if (f.items.length > 0) {
      await dialogo.avisar({
        titulo: 'Esta factura no se puede borrar',
        texto: 'Ya actualizó el stock de su mercancía. Si hubo un error, regístrale una nota de crédito.',
        tono: 'ojo',
      })
      return
    }
    if (
      !(await dialogo.confirmar({
        titulo: '¿Borrar esta factura?',
        texto: 'También se borra su asiento contable.',
        aceptar: 'Borrar',
        peligro: true,
      }))
    )
      return
    try {
      await api.eliminarFacturaCompra(f.id)
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo borrar')
    }
  }

  async function marcarPagada(f: FacturaCompra) {
    const forma = liquidacion[f.id] || 'Efectivo'
    // Pagarle al proveedor es aplicar un pago: si no sale en billetes, lleva
    // comprobante, igual que cobrar en el punto de venta.
    const referencia = await pedirReferencia(forma, dialogo.pedirTexto)
    if (referencia === null) return
    setError('')
    setPagando(f.id)
    try {
      await api.pagarFacturaCompra(f.id, forma, referencia)
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar el pago')
    } finally {
      setPagando(null)
    }
  }

  const hoy = new Date()
  const pendientes = facturas
    .filter((f) => f.forma_pago === 'Credito' && !f.pagada)
    .sort((a, b) => {
      const va = a.fecha_vencimiento ? new Date(a.fecha_vencimiento).getTime() : Infinity
      const vb = b.fecha_vencimiento ? new Date(b.fecha_vencimiento).getTime() : Infinity
      return va - vb
    })
  const totalPendiente = pendientes.reduce((sum, f) => sum + f.total, 0)

  function diasVencida(f: FacturaCompra): number | null {
    if (!f.fecha_vencimiento) return null
    const dias = Math.floor((hoy.getTime() - new Date(f.fecha_vencimiento).getTime()) / 86400000)
    return dias
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Compras" secciones={SECCIONES} seccion={seccion} alCambiarSeccion={irA} filtro={seccion === 'facturas' ? <FiltroFechas rango={rango} alCambiar={setRango} /> : undefined} />
      <Pagina>
        {seccion === 'facturas' && (
          <>
        {pendientes.length > 0 && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-4">
            <div className="flex justify-between items-baseline mb-3">
              <h2 className="font-semibold">Cuentas por pagar</h2>
              <span className="text-sm text-neutral-500">
                Debemos <span className="font-semibold text-neutral-800">${totalPendiente.toFixed(2)}</span>
              </span>
            </div>
            <div className="space-y-2">
              {pendientes.map((f) => {
                const dias = diasVencida(f)
                const vencida = dias !== null && dias > 0
                return (
                  <div
                    key={f.id}
                    className={`flex flex-wrap items-center gap-2 rounded-lg p-2 text-sm ${
                      vencida ? 'bg-peligro-50' : 'bg-neutral-50'
                    }`}
                  >
                    <span className="font-medium flex-1 min-w-[140px]">{f.proveedor_nombre}</span>
                    <span className="text-neutral-500 font-mono text-xs">{f.numero_factura}</span>
                    <span
                      className={`text-xs ${vencida ? 'text-peligro-600 font-semibold' : 'text-neutral-500'}`}
                    >
                      {f.fecha_vencimiento
                        ? vencida
                          ? `Vencida hace ${dias} días`
                          : `Vence ${new Date(f.fecha_vencimiento).toLocaleDateString('es-VE')}`
                        : 'Sin fecha de vencimiento'}
                    </span>
                    <span className="font-semibold tabular-nums w-20 text-right">${f.total.toFixed(2)}</span>
                    <select
                      value={liquidacion[f.id] || 'Efectivo'}
                      onChange={(e) => setLiquidacion((prev) => ({ ...prev, [f.id]: e.target.value }))}
                      className="border border-neutral-300 rounded-lg px-2 py-1 text-xs"
                    >
                      <option value="Efectivo">Efectivo</option>
                      <option value="Banco">Banco</option>
                    </select>
                    <button
                      onClick={() => marcarPagada(f)}
                      disabled={pagando === f.id}
                      className="bg-neutral-900 text-white rounded-lg px-3 py-1 text-xs font-medium disabled:opacity-50"
                    >
                      Marcar pagada
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <Tabla
          orden={orden}
          buscador={buscador}
          glosario="compras"
          className="bg-white rounded-2xl border border-neutral-200"
        >
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
              <tr>
                <Th clave="fecha">Fecha</Th>
                <Th clave="factura">Factura</Th>
                <Th clave="proveedor">Proveedor</Th>
                <Th ayuda="compras.detalle">Detalle</Th>
                <Th clave="base" alinear="derecha">Base</Th>
                <Th clave="iva" alinear="derecha">IVA</Th>
                <Th clave="total" alinear="derecha">Total</Th>
                <Th clave="estado">Estado</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {orden.ordenar(buscador.filtrar(facturas)).map((f) => (
                <tr key={f.id} className="border-t border-neutral-100 align-top">
                  <td className="p-3 whitespace-nowrap">{new Date(f.fecha).toLocaleDateString('es-VE')}</td>
                  <td className="p-3 font-mono text-xs">{f.numero_factura}</td>
                  <td className="p-3 font-medium">{f.proveedor_nombre}</td>
                  <td className="p-3 text-neutral-500">
                    {f.items.length > 0 ? (
                      <ul className="space-y-0.5">
                        {f.items.map((it) => (
                          <li key={it.id} className="text-xs">
                            {it.cantidad} {it.unidad} {it.ingrediente_nombre}
                            {it.exento && <span className="text-neutral-400"> · exento</span>}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      TEXTO_CATEGORIA[f.categoria] ?? f.categoria
                    )}
                  </td>
                  <td className="text-right p-3 tabular-nums">
                    {f.base_imponible.toFixed(2)}
                    {/* Sin esto, la suma de los renglones no da la base y no
                        hay forma de saber por que. */}
                    {(f.recargo > 0 || f.descuento > 0) && (
                      <span className="block text-[11px] text-neutral-400">
                        {f.recargo > 0 && `+${f.recargo.toFixed(2)} recargo`}
                        {f.recargo > 0 && f.descuento > 0 && ' · '}
                        {f.descuento > 0 && `-${f.descuento.toFixed(2)} desc.`}
                      </span>
                    )}
                  </td>
                  <td className="text-right p-3 tabular-nums">{f.iva.toFixed(2)}</td>
                  <td className="text-right p-3 tabular-nums font-semibold">
                    {f.total.toFixed(2)}
                    <button
                      onClick={() => notaCredito(f)}
                      className="block w-full text-right text-[11px] font-medium text-acento-600"
                      title="El proveedor mandó menos, o te dio un descuento"
                    >
                      Nota de crédito
                    </button>
                  </td>
                  <td className="p-3">
                    {f.forma_pago === 'Credito' ? (
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          f.pagada
                            ? 'bg-exito-50 text-exito-700'
                            : 'bg-aviso-50 text-aviso-700'
                        }`}
                      >
                        {f.pagada ? 'Pagada' : 'Pendiente'}
                      </span>
                    ) : (
                      <span className="text-neutral-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    {f.tiene_soporte && (
                      <button onClick={() => setVerSoporte(f.id)} className="text-acento-700 text-xs mr-3">
                        Foto
                      </button>
                    )}
                    <button onClick={() => borrar(f)} className="text-peligro-500 text-xs">
                      Borrar
                    </button>
                  </td>
                </tr>
              ))}
              {facturas.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-neutral-400 py-4 text-center">
                    Sin facturas cargadas todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Tabla>
          </>
        )}

        {seccion === 'nueva' && (
          <>
        <div className="bg-white rounded-2xl border border-neutral-200 p-4">
          <h2 className="font-semibold mb-2">Cargar factura de proveedor</h2>
          <p className="text-xs text-neutral-500 mb-3">
            {esInsumos
              ? 'Cada renglón reabastece el stock de esa mercancía y recalcula su costo promedio - no hace falta cargarlo aparte en Inventario.'
              : 'Alimenta el Libro de Compras y contabiliza sola: activos entran al balance, servicios van directo a gasto.'}
          </p>
          {error && <p className="text-peligro-600 text-sm mb-2">{error}</p>}
          {/* Antes salir bien no decia nada: el formulario se limpiaba y ya, y
              quien la cargo se quedaba sin saber si entro -- con la duda de si
              darle otra vez, que es como se cargan dos facturas iguales. */}
          {exito && (
            <div className="mb-3 rounded-lg bg-exito-500/10 ring-1 ring-exito-500/30 px-3 py-2 text-sm text-exito-800 flex items-start justify-between gap-3">
              <span>{exito}</span>
              <button onClick={() => irA('facturas')} className="font-semibold shrink-0 underline">
                Verla
              </button>
            </div>
          )}

          <BotonFoto alLeer={aplicarLectura} />
          <PanelRevision
            lectura={lectura}
            foto={fotoLectura}
            monedaFormulario={monedaCarga}
            totalFormulario={
              esInsumos
                ? Math.round((baseFinal + ivaLineas) * 100) / 100
                : Math.round(((Number(base) || 0) + (Number(iva) || 0)) * 100) / 100
            }
            baseFormulario={esInsumos ? baseFinal : Number(base) || 0}
            ivaFormulario={esInsumos ? ivaLineas : Number(iva) || 0}
            revision={revision}
          />

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
            <input
              value={numeroFactura}
              onChange={(e) => setNumeroFactura(e.target.value)}
              placeholder="N. de factura"
              className="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
            />
            {/* Un proveedor no registrado se puede tipear igual: el directorio
                es una comodidad, no un requisito para poder comprar. */}
            <CampoSugerido
              value={proveedor}
              onChange={elegirProveedorConocido}
              opciones={proveedores.filter((p) => p.activo).map((p) => p.nombre)}
              placeholder="Proveedor"
              vacio="Todavía no hay proveedores guardados"
            />
            <input
              value={rif}
              onChange={(e) => setRif(e.target.value)}
              placeholder="RIF (ej. J-12345678-9)"
              required
              className="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
            />
            {/* La del papel. No mueve la factura de mes: una de agosto que
                llega en octubre se registra en octubre. */}
            <label
              className="flex items-center gap-2 text-sm text-neutral-500 border border-neutral-300 rounded-lg px-3 py-2"
              title="La impresa en la factura. El mes del Libro de Compras lo decide el día en que se registra."
            >
              Fecha factura
              <input
                value={fechaEmision}
                onChange={(e) => setFechaEmision(e.target.value)}
                type="date"
                max={hoyISO}
                className="flex-1 min-w-0 outline-none text-neutral-800 bg-transparent"
              />
            </label>
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="border border-neutral-300 rounded-lg px-2 py-2 text-sm"
            >
              {CATEGORIAS.map((c) => (
                <option key={c.valor} value={c.valor}>
                  {c.texto}
                </option>
              ))}
            </select>
            <select
              value={formaPago}
              onChange={(e) => setFormaPago(e.target.value)}
              className="border border-neutral-300 rounded-lg px-2 py-2 text-sm"
            >
              {FORMAS_PAGO.map((f) => (
                <option key={f} value={f}>
                  {f === 'Credito' ? 'A crédito (por pagar)' : f}
                </option>
              ))}
            </select>
            {/* Solo cuando la plata ya salió y no fue en billetes. El backend
                la exige igual, así que se pide antes de mandar la factura. */}
            {necesitaReferencia(formaPago) && (
              <input
                value={referenciaPago}
                onChange={(e) => setReferenciaPago(e.target.value)}
                placeholder="Referencia del pago"
                required
                className="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
              />
            )}
            <input
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Descripción (opcional)"
              className="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
            />
            <label className="flex items-center gap-2 text-sm border border-neutral-300 rounded-lg px-3 py-2">
              <span className="text-neutral-500">Factura en</span>
              <select
                value={monedaCarga}
                onChange={(e) => setMonedaCarga(e.target.value as (typeof MONEDAS_DE_CARGA)[number])}
                className="flex-1 outline-none bg-transparent"
              >
                {MONEDAS_DE_CARGA.map((m) => (
                  <option key={m} value={m}>
                    {m === '$' ? 'Dólares' : `Bolívares${tasa?.bcv ? ` (a ${tasa.bcv.toFixed(2)})` : ''}`}
                  </option>
                ))}
              </select>
            </label>
            {esCredito && (
              <label className="flex items-center gap-2 text-sm text-neutral-500 border border-neutral-300 rounded-lg px-3 py-2">
                Vence
                <input
                  value={fechaVencimiento}
                  onChange={(e) => setFechaVencimiento(e.target.value)}
                  type="date"
                  className="flex-1 outline-none text-neutral-800"
                />
              </label>
            )}
            {/* Un equipo se gasta con los años: sin este dato entraba al
                balance a valor de compra y se quedaba ahi para siempre. */}
            {esActivo && (
              <label className="flex items-center gap-2 text-sm text-neutral-500 border border-neutral-300 rounded-lg px-3 py-2">
                Dura
                <Numerico
                  value={vidaUtil}
                  onChange={(e) => setVidaUtil(e.target.value)}
                  min="1"
                  className="w-16 outline-none text-neutral-800 text-right"
                />
                meses
              </label>
            )}
          </div>

          {diasDeLaFactura > DIAS_FACTURA_VIEJA && (
            <p className="text-xs text-aviso-700 -mt-1 mb-3">
              Esta factura tiene {diasDeLaFactura} días. Se registra en el Libro de Compras de este mes;
              confirma con quien lleva la contabilidad si ese crédito fiscal todavía se puede descontar.
            </p>
          )}

          {esInsumos ? (
            <div className="space-y-2 mb-3">
              {lineas.map((l, i) => {
                const ing = ingredientes.find((x) => x.id === l.ingrediente_id)
                const subtotal = (Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0)
                return (
                  <div key={i} className="flex flex-wrap gap-2 items-center bg-neutral-50 rounded-lg p-2">
                    <RenglonDelPapel
                      leido={l.leido}
                      moneda={monedaCarga}
                      unidadNuestra={ing?.unidad}
                      aviso={revision?.precios.find((p) => p.indice === i)}
                      recordada={l.recordada?.ingrediente_id === l.ingrediente_id ? l.recordada : undefined}
                    />
                    <select
                      value={l.ingrediente_id}
                      onChange={(e) => elegirIngrediente(i, e.target.value)}
                      className="flex-1 min-w-[140px] border border-neutral-300 rounded-lg px-2 py-1.5 text-sm"
                    >
                      <option value={0}>Mercancía...</option>
                      {ingredientes.map((ing2) => (
                        <option key={ing2.id} value={ing2.id}>
                          {ing2.nombre} ({ing2.unidad})
                        </option>
                      ))}
                      <option value="nuevo">+ Crear mercancía nueva...</option>
                    </select>
                    <Numerico
                      value={l.cantidad}
                      onChange={(e) => actualizarLinea(i, 'cantidad', e.target.value)}
                      placeholder={`Cantidad${ing ? ` (${ing.unidad})` : ''}`}
                      className="w-28 border border-neutral-300 rounded-lg px-2 py-1.5 text-sm"
                    />
                    <Numerico
                      value={l.costo_unitario}
                      onChange={(e) => actualizarLinea(i, 'costo_unitario', e.target.value)}
                      placeholder={`Costo/unidad sin IVA (${monedaCarga})`}
                      className="w-32 border border-neutral-300 rounded-lg px-2 py-1.5 text-sm"
                    />
                    {/* La ficha de la mercancía es el valor por defecto, no la
                        ultima palabra: la misma cosa puede venir exenta de un
                        proveedor y gravada de otro, y quien tiene el papel
                        delante es quien sabe. */}
                    <select
                      value={l.exento === null ? 'ficha' : l.exento ? 'exento' : 'grava'}
                      onChange={(e) =>
                        setLineas((prev) =>
                          prev.map((x, idx) =>
                            idx === i
                              ? { ...x, exento: e.target.value === 'ficha' ? null : e.target.value === 'exento' }
                              : x,
                          ),
                        )
                      }
                      title="Si este renglón paga IVA"
                      className="w-32 border border-neutral-300 rounded-lg px-2 py-1.5 text-sm"
                    >
                      <option value="ficha">
                        {ing ? (ing.exento ? 'Exento (ficha)' : `IVA ${fiscal.tasa_iva}% (ficha)`) : 'Según la ficha'}
                      </option>
                      <option value="grava">Lleva IVA {fiscal.tasa_iva}%</option>
                      <option value="exento">Exento</option>
                    </select>
                    <span className="text-sm font-medium text-neutral-600 w-24 text-right">
                      {monedaCarga}
                      {subtotal.toFixed(2)}
                    </span>
                    <button
                      onClick={() => quitarLinea(i)}
                      className="text-peligro-400 text-sm px-1"
                      disabled={lineas.length === 1}
                    >
                      x
                    </button>
                  </div>
                )
              })}
              <button onClick={agregarLinea} className="text-sm text-neutral-500 font-medium">
                + renglón
              </button>

              {/* Casi ninguna factura es la suma limpia de sus renglones: viene
                  con flete, con recargo por pagar a credito, o con un descuento
                  por volumen. Sin donde ponerlos habia que falsear un costo
                  unitario -- y ahi el costo de receta empieza a mentir. */}
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-neutral-200">
                <label className="flex items-center gap-2 text-sm text-neutral-500 border border-neutral-300 rounded-lg px-3 py-2">
                  Recargo
                  <Numerico
                    value={recargo}
                    onChange={(e) => setRecargo(e.target.value)}
                    min="0"
                    placeholder="0.00"
                    className="w-full outline-none text-neutral-800 text-right"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-neutral-500 border border-neutral-300 rounded-lg px-3 py-2">
                  Descuento
                  <Numerico
                    value={descuentoFactura}
                    onChange={(e) => setDescuentoFactura(e.target.value)}
                    min="0"
                    placeholder="0.00"
                    className="w-full outline-none text-neutral-800 text-right"
                  />
                </label>
              </div>
              <p className="text-xs text-neutral-500">
                Se reparten entre los renglones: la mercancía entra al depósito por lo que de
                verdad costó, flete y rebajas incluidos.
              </p>

              <div className="flex justify-end gap-6 text-sm pt-2 border-t border-neutral-200 flex-wrap">
                <span className="text-neutral-500">
                  Renglones{' '}
                  <span className="font-semibold text-neutral-800">{monedaCarga}{baseLineas.toFixed(2)}</span>
                </span>
                {(recargoNum > 0 || descuentoNum > 0) && (
                  <span className="text-neutral-500">
                    Base{' '}
                    <span className="font-semibold text-neutral-800">{monedaCarga}{baseFinal.toFixed(2)}</span>
                  </span>
                )}
                <span className="text-neutral-500">
                  IVA ({fiscal.tasa_iva}%){' '}
                  <span className="font-semibold text-neutral-800">{monedaCarga}{ivaLineas.toFixed(2)}</span>
                </span>
                <span className="text-neutral-500">
                  Total{' '}
                  <span className="font-bold text-neutral-900">{monedaCarga}{(baseFinal + ivaLineas).toFixed(2)}</span>
                </span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
              <Numerico
                value={base}
                onChange={(e) => actualizarBase(e.target.value)}
                placeholder={`Base imponible (${monedaCarga})`}
                className="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
              />
              <Numerico
                value={iva}
                onChange={(e) => setIva(e.target.value)}
                placeholder={`IVA ${fiscal.tasa_iva}% (${monedaCarga})`}
                className="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
              />
              <div className="flex items-center justify-between bg-neutral-50 rounded-lg px-3 text-sm font-medium">
                <span className="text-neutral-500">Total</span>
                <span>{monedaCarga}{((Number(base) || 0) + (Number(iva) || 0)).toFixed(2)}</span>
              </div>
            </div>
          )}

          <button
            onClick={agregarFactura}
            className="bg-neutral-900 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Cargar factura
          </button>
        </div>
          </>
        )}

        {seccion === 'proveedores' && (
          <>
          <div className="bg-white rounded-2xl border border-neutral-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="font-semibold">Proveedores</h2>
                <p className="text-xs text-neutral-500">
                  Elegir uno al cargar una factura completa su nombre y su RIF solos.
                </p>
              </div>
              <Boton onClick={() => setFichaProveedor('nuevo')}>Nuevo proveedor</Boton>
            </div>

            {proveedores.length === 0 ? (
              <Vacio titulo="Sin proveedores registrados" detalle="Se pueden seguir cargando facturas igual, tipeando el nombre." />
            ) : (
              <Tabla buscador={buscadorProveedores}>
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
                    <tr>
                      <Th>Nombre</Th>
                      <Th>RIF</Th>
                      <Th>Teléfono</Th>
                      <Th>Contacto</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {buscadorProveedores.filtrar(proveedores).map((p) => (
                      <tr key={p.id} className={`border-t border-neutral-100 ${!p.activo ? 'opacity-50' : ''}`}>
                        <td className="p-2 font-medium">{p.nombre}</td>
                        <td className="p-2 tabular-nums text-neutral-500">{p.rif || '—'}</td>
                        <td className="p-2 text-neutral-500">{p.telefono || '—'}</td>
                        <td className="p-2 text-neutral-500">{p.contacto || '—'}</td>
                        <td className="p-2 text-right whitespace-nowrap">
                          {!p.activo && <Pastilla tono="neutro">archivado</Pastilla>}{' '}
                          <button
                            onClick={() => setFichaProveedor(p)}
                            className="text-xs text-acento-700 font-medium mr-3"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => archivarProveedor(p)}
                            className="text-xs text-neutral-500 font-medium"
                          >
                            {p.activo ? 'Archivar' : 'Reactivar'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Tabla>
            )}
          </div>
          <MemoriaProveedores proveedores={proveedores} />
          </>
        )}

        {verSoporte !== null && <VerSoporte facturaId={verSoporte} onCerrar={() => setVerSoporte(null)} />}

        {fichaProveedor && (
          <FichaProveedor
            proveedor={fichaProveedor === 'nuevo' ? null : fichaProveedor}
            onCerrar={() => setFichaProveedor(null)}
            onGuardar={guardarProveedor}
          />
        )}
      </Pagina>
    </div>
  )
}

function FichaProveedor({
  proveedor,
  onCerrar,
  onGuardar,
}: {
  proveedor: Proveedor | null
  onCerrar: () => void
  onGuardar: (datos: Omit<Proveedor, 'id' | 'activo'>) => Promise<void>
}) {
  const [nombre, setNombre] = useState(proveedor?.nombre ?? '')
  const [rif, setRif] = useState(proveedor?.rif ?? '')
  const [telefono, setTelefono] = useState(proveedor?.telefono ?? '')
  const [direccion, setDireccion] = useState(proveedor?.direccion ?? '')
  const [contacto, setContacto] = useState(proveedor?.contacto ?? '')
  const [nota, setNota] = useState(proveedor?.nota ?? '')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    if (!nombre.trim()) {
      setError('El nombre es obligatorio')
      return
    }
    setError('')
    setGuardando(true)
    try {
      await onGuardar({ nombre: nombre.trim(), rif: rif.trim() || null, telefono, direccion, contacto, nota })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      titulo={proveedor ? proveedor.nombre : 'Nuevo proveedor'}
      onCerrar={onCerrar}
      pie={
        <>
          <Boton tono="suave" onClick={onCerrar}>Cancelar</Boton>
          <Boton onClick={guardar} disabled={guardando}>Guardar</Boton>
        </>
      }
    >
      {error && <p className="text-peligro-600 text-sm mb-3">{error}</p>}
      <div className="space-y-3">
        <Campo etiqueta="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <Campo
          etiqueta="RIF"
          value={rif}
          onChange={(e) => setRif(e.target.value)}
          placeholder="J-12345678-9 (opcional)"
        />
        <Campo etiqueta="Teléfono" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
        <Campo etiqueta="Dirección" value={direccion} onChange={(e) => setDireccion(e.target.value)} />
        <Campo etiqueta="Persona de contacto" value={contacto} onChange={(e) => setContacto(e.target.value)} />
        <Campo etiqueta="Nota" value={nota} onChange={(e) => setNota(e.target.value)} />
      </div>
    </Modal>
  )
}
