import { useEffect, useMemo, useState } from 'react'
import NavBar from '../components/NavBar'
import { useSeccion } from '../components/Secciones'
import { FiltroFechas } from '../components/Fechas'
import { useRango } from '../lib/fechas'
import { useDialogo } from '../components/dialogo'
import { Tabla, Th, useOrden } from '../components/Tabla'
import { Boton, Campo, Modal, Pagina, Pastilla, Vacio } from '../components/ui'
import { api } from '../lib/api'
import { useMoneda } from '../lib/moneda'
import type { ConfiguracionFiscal, FacturaCompra, Ingrediente, Proveedor } from '../lib/types'

const MONEDAS_DE_CARGA = ['$', 'Bs'] as const

const CATEGORIAS = ['Insumos', 'Servicios', 'Activos', 'Otros']
const FORMAS_PAGO = ['Efectivo', 'Efectivo $', 'Banco', 'Credito']

type Linea = { ingrediente_id: number; cantidad: string; costo_unitario: string }

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
  const [ingredientes, setIngredientes] = useState<Ingrediente[]>([])
  const [fiscal, setFiscal] = useState<ConfiguracionFiscal>({ tasa_iva: 16 })
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [fichaProveedor, setFichaProveedor] = useState<Proveedor | 'nuevo' | null>(null)
  const [error, setError] = useState('')
  const dialogo = useDialogo()

  const { tasa } = useMoneda()
  const [numeroFactura, setNumeroFactura] = useState('')
  const [proveedor, setProveedor] = useState('')
  const [rif, setRif] = useState('')
  // La factura del proveedor puede venir en cualquiera de las dos: el que
  // vende insumos suele cobrar en dolares, pero el de servicios (luz, gas,
  // alquiler) casi siempre factura en bolivares.
  const [monedaCarga, setMonedaCarga] = useState<(typeof MONEDAS_DE_CARGA)[number]>('$')
  const [categoria, setCategoria] = useState(CATEGORIAS[0])
  const [formaPago, setFormaPago] = useState(FORMAS_PAGO[0])
  const [descripcion, setDescripcion] = useState('')

  // Con insumos: renglones por ingrediente, que reabastecen el stock solos.
  const [lineas, setLineas] = useState<Linea[]>([{ ingrediente_id: 0, cantidad: '', costo_unitario: '' }])
  // Sin insumos (servicios, activos...): un monto suelto, como antes.
  const [base, setBase] = useState('')
  const [iva, setIva] = useState('')
  const [fechaVencimiento, setFechaVencimiento] = useState('')
  // Cuantos meses dura el equipo. Define la cuota de depreciacion mensual.
  const [vidaUtil, setVidaUtil] = useState('60')

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
  // Solo de vista previa: el numero real lo calcula el backend con el mismo
  // criterio (exento por insumo) al guardar.
  const ivaLineas = useMemo(() => {
    const baseGravada = lineas.reduce((sum, l) => {
      const ing = ingredientes.find((x) => x.id === l.ingrediente_id)
      if (ing?.exento) return sum
      return sum + (Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0)
    }, 0)
    return Math.round(baseGravada * (fiscal.tasa_iva / 100) * 100) / 100
  }, [lineas, ingredientes, fiscal.tasa_iva])

  function actualizarLinea(i: number, campo: keyof Linea, valor: string) {
    setLineas((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, [campo]: campo === 'ingrediente_id' ? Number(valor) : valor } : l)),
    )
  }

  function agregarLinea() {
    setLineas((prev) => [...prev, { ingrediente_id: 0, cantidad: '', costo_unitario: '' }])
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
        titulo: 'Insumo nuevo',
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
    setProveedor('')
    setRif('')
    setDescripcion('')
    setLineas([{ ingrediente_id: 0, cantidad: '', costo_unitario: '' }])
    setBase('')
    setIva('')
    setFechaVencimiento('')
    setMonedaCarga('$')
  }

  async function agregarFactura() {
    setError('')
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
    // Todo el sistema costea en dolares (recetas, margenes, balance). Cargar
    // en bolivares es una comodidad de tecleo -la factura del gas casi
    // siempre viene en Bs-, no una segunda moneda que el resto del ERP tenga
    // que entender: se convierte aca, una sola vez, a la tasa del dia.
    if (monedaCarga === 'Bs' && !tasa?.bcv) {
      setError('No se pudo obtener la tasa del día. Intenta de nuevo o carga en dólares.')
      return
    }
    const aUsd = (monto: number) => (monedaCarga === 'Bs' ? monto / (tasa!.bcv as number) : monto)

    try {
      if (esInsumos) {
        const items = lineas
          .filter((l) => l.ingrediente_id && Number(l.cantidad) > 0 && Number(l.costo_unitario) >= 0)
          .map((l) => ({
            ingrediente_id: l.ingrediente_id,
            cantidad: Number(l.cantidad),
            costo_unitario: aUsd(Number(l.costo_unitario)),
          }))
        if (items.length === 0) {
          setError('Agrega al menos un insumo con cantidad y costo')
          return
        }
        await api.crearFacturaCompra({
          numero_factura: numeroFactura.trim(),
          proveedor_nombre: proveedor.trim(),
          proveedor_rif: rif.trim(),
          categoria,
          forma_pago: formaPago,
          descripcion: descripcion.trim(),
          items,
          iva: ivaLineas,
          fecha_vencimiento: esCredito && fechaVencimiento ? fechaVencimiento : undefined,
        })
      } else {
        const baseNum = Number(base)
        if (!Number.isFinite(baseNum) || baseNum <= 0) {
          setError('La base imponible debe ser mayor a cero')
          return
        }
        await api.crearFacturaCompra({
          numero_factura: numeroFactura.trim(),
          proveedor_nombre: proveedor.trim(),
          proveedor_rif: rif.trim(),
          categoria,
          forma_pago: formaPago,
          descripcion: descripcion.trim(),
          base_imponible: aUsd(baseNum),
          iva: aUsd(Number(iva) || 0),
          fecha_vencimiento: esCredito && fechaVencimiento ? fechaVencimiento : undefined,
          vida_util_meses: esActivo ? Number(vidaUtil) || 60 : undefined,
        })
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
      texto: 'Cuánto vuelve de cada insumo. Deja en 0 lo que se queda.',
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
        texto: 'Ya actualizó el stock de sus insumos. Si hubo un error, regístrale una nota de crédito.',
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
    setError('')
    setPagando(f.id)
    try {
      await api.pagarFacturaCompra(f.id, liquidacion[f.id] || 'Efectivo')
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

        <Tabla orden={orden} glosario="compras" className="bg-white rounded-2xl border border-neutral-200">
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
              {orden.ordenar(facturas).map((f) => (
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
                          </li>
                        ))}
                      </ul>
                    ) : (
                      f.categoria
                    )}
                  </td>
                  <td className="text-right p-3 tabular-nums">{f.base_imponible.toFixed(2)}</td>
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
                  <td className="p-3">
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
              ? 'Cada renglón reabastece el stock del insumo y recalcula su costo promedio - no hace falta cargarlo aparte en Inventario.'
              : 'Alimenta el Libro de Compras y contabiliza sola: activos entran al balance, servicios van directo a gasto.'}
          </p>
          {error && <p className="text-peligro-600 text-sm mb-2">{error}</p>}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
            <input
              value={numeroFactura}
              onChange={(e) => setNumeroFactura(e.target.value)}
              placeholder="N. de factura"
              className="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
            />
            <input
              value={proveedor}
              onChange={(e) => elegirProveedorConocido(e.target.value)}
              placeholder="Proveedor"
              list="proveedores-conocidos"
              className="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
            />
            {/* Un proveedor no registrado se puede tipear igual: el directorio
                es una comodidad, no un requisito para poder comprar. */}
            <datalist id="proveedores-conocidos">
              {proveedores.filter((p) => p.activo).map((p) => (
                <option key={p.id} value={p.nombre} />
              ))}
            </datalist>
            <input
              value={rif}
              onChange={(e) => setRif(e.target.value)}
              placeholder="RIF (ej. J-12345678-9)"
              required
              className="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
            />
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="border border-neutral-300 rounded-lg px-2 py-2 text-sm"
            >
              {CATEGORIAS.map((c) => (
                <option key={c} value={c}>
                  {c}
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
                <input
                  value={vidaUtil}
                  onChange={(e) => setVidaUtil(e.target.value)}
                  type="number"
                  min="1"
                  className="w-16 outline-none text-neutral-800 text-right"
                />
                meses
              </label>
            )}
          </div>

          {esInsumos ? (
            <div className="space-y-2 mb-3">
              {lineas.map((l, i) => {
                const ing = ingredientes.find((x) => x.id === l.ingrediente_id)
                const subtotal = (Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0)
                return (
                  <div key={i} className="flex flex-wrap gap-2 items-center bg-neutral-50 rounded-lg p-2">
                    <select
                      value={l.ingrediente_id}
                      onChange={(e) => elegirIngrediente(i, e.target.value)}
                      className="flex-1 min-w-[140px] border border-neutral-300 rounded-lg px-2 py-1.5 text-sm"
                    >
                      <option value={0}>Insumo...</option>
                      {ingredientes.map((ing2) => (
                        <option key={ing2.id} value={ing2.id}>
                          {ing2.nombre} ({ing2.unidad})
                        </option>
                      ))}
                      <option value="nuevo">+ Crear insumo nuevo...</option>
                    </select>
                    <input
                      value={l.cantidad}
                      onChange={(e) => actualizarLinea(i, 'cantidad', e.target.value)}
                      placeholder={`Cantidad${ing ? ` (${ing.unidad})` : ''}`}
                      type="number"
                      step="0.01"
                      className="w-28 border border-neutral-300 rounded-lg px-2 py-1.5 text-sm"
                    />
                    <input
                      value={l.costo_unitario}
                      onChange={(e) => actualizarLinea(i, 'costo_unitario', e.target.value)}
                      placeholder={`Costo/unidad sin IVA (${monedaCarga})`}
                      type="number"
                      step="0.01"
                      className="w-32 border border-neutral-300 rounded-lg px-2 py-1.5 text-sm"
                    />
                    {ing?.exento && <Pastilla tono="neutro">exento</Pastilla>}
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
                + insumo
              </button>
              <div className="flex justify-end gap-6 text-sm pt-2 border-t border-neutral-200">
                <span className="text-neutral-500">
                  Base <span className="font-semibold text-neutral-800">{monedaCarga}{baseLineas.toFixed(2)}</span>
                </span>
                <span className="text-neutral-500">
                  IVA ({fiscal.tasa_iva}%){' '}
                  <span className="font-semibold text-neutral-800">{monedaCarga}{ivaLineas.toFixed(2)}</span>
                </span>
                <span className="text-neutral-500">
                  Total{' '}
                  <span className="font-bold text-neutral-900">{monedaCarga}{(baseLineas + ivaLineas).toFixed(2)}</span>
                </span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
              <input
                value={base}
                onChange={(e) => actualizarBase(e.target.value)}
                placeholder={`Base imponible (${monedaCarga})`}
                type="number"
                step="0.01"
                className="border border-neutral-300 rounded-lg px-3 py-2 text-sm"
              />
              <input
                value={iva}
                onChange={(e) => setIva(e.target.value)}
                placeholder={`IVA ${fiscal.tasa_iva}% (${monedaCarga})`}
                type="number"
                step="0.01"
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
              <Tabla>
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
                    {proveedores.map((p) => (
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
        )}

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
