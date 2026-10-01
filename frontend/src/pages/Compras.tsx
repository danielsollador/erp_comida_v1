import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertasAlGuardar, BandejaAlertas } from '../components/AlertasPrecio'
import { MemoriaProveedores, VerSoporte } from '../components/FacturaDesdeFoto'
import NavBar from '../components/NavBar'
import { useSeccion } from '../components/Secciones'
import { FiltroFechas } from '../components/Fechas'
import { useRango } from '../lib/fechas'
import { useDialogo } from '../components/dialogo'
import { Tabla, Th, useBuscador, useOrden } from '../components/Tabla'
import { Boton, Campo, Modal, Pagina, Pastilla, Vacio } from '../components/ui'
import { api } from '../lib/api'
import { TEXTO_CATEGORIA } from '../lib/compras'
import CargarFactura from './partes/compras/CargarFactura'
import { cuantosPendientes, procesarPendientes } from '../lib/pendientesCompras'
import { pedirReferencia } from '../lib/pagos'
import type {
  AlertaPrecio,
  ConfiguracionFiscal,
  FacturaCompra,
  Ingrediente,
  Proveedor,
} from '../lib/types'

const SECCIONES = [
  { id: 'facturas', texto: 'Facturas' },
  { id: 'nueva', texto: 'Cargar factura' },
  { id: 'alertas', texto: 'Alertas' },
  { id: 'proveedores', texto: 'Proveedores' },
]

export default function Compras() {
  const [seccion, irA] = useSeccion(SECCIONES)
  // Las alertas de precio sin ver, en el nombre de la pestaña: es lo que hace
  // que el dueño se entere aunque la factura la haya cargado otro.
  const [alertasPendientes, setAlertasPendientes] = useState(0)
  const [alertasAlGuardar, setAlertasAlGuardar] = useState<AlertaPrecio[]>([])
  const secciones = useMemo(
    () =>
      SECCIONES.map((s) =>
        s.id === 'alertas' && alertasPendientes > 0 ? { ...s, texto: `Alertas (${alertasPendientes})` } : s,
      ),
    [alertasPendientes],
  )
  const alCambiarPendientes = useCallback((n: number) => setAlertasPendientes(n), [])
  // Facturas guardadas desde ESTE dispositivo a las que les falta la foto, la
  // memoria o las alertas porque se cayo la conexion justo despues.
  const [porCompletar, setPorCompletar] = useState(cuantosPendientes())
  const reintentarPendientes = useCallback(async () => {
    if (cuantosPendientes() === 0) return
    if ((await procesarPendientes()) > 0) {
      api
        .listarAlertasPrecio(true)
        .then((l) => setAlertasPendientes(l.length))
        .catch(() => undefined)
    }
    setPorCompletar(cuantosPendientes())
  }, [])
  useEffect(() => {
    // Al abrir Compras, lo que quedo de antes; y cada vez que vuelve la red.
    const t = setTimeout(reintentarPendientes, 0)
    window.addEventListener('online', reintentarPendientes)
    return () => {
      clearTimeout(t)
      window.removeEventListener('online', reintentarPendientes)
    }
  }, [reintentarPendientes])
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

  const [verSoporte, setVerSoporte] = useState<number | null>(null)

  // Con que forma de pago se va a saldar cada factura a credito pendiente -
  // una por fila, para el boton "Marcar pagada" de cuentas por pagar.
  const [liquidacion, setLiquidacion] = useState<Record<number, string>>({})
  const [pagando, setPagando] = useState<number | null>(null)

  useEffect(() => {
    cargar()
  }, [rango])

  function cargar() {
    api.listarFacturasCompra(rango).then(setFacturas)
    api.listarIngredientes().then((l) => setIngredientes(l.filter((i) => i.activo !== false)))
    api.configFiscal().then(setFiscal)
    api.listarProveedores().then(setProveedores)
    api
      .listarAlertasPrecio(true)
      .then((l) => setAlertasPendientes(l.length))
      .catch(() => undefined)
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
      <NavBar titulo="Compras" secciones={secciones} seccion={seccion} alCambiarSeccion={irA} filtro={seccion === 'facturas' ? <FiltroFechas rango={rango} alCambiar={setRango} /> : undefined} />
      <Pagina>
        {seccion === 'facturas' && (
          <>
        {/* Borrar o pagar una factura puede fallar: antes el mensaje solo se
            veia en "Cargar factura", donde nadie lo estaba mirando. */}
        {error && <p className="text-peligro-600 text-sm">{error}</p>}
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
                        Original
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
          <CargarFactura
            ingredientes={ingredientes}
            setIngredientes={setIngredientes}
            proveedores={proveedores}
            fiscal={fiscal}
            porCompletar={porCompletar}
            onReintentar={reintentarPendientes}
            onGuardada={(alertas) => {
              if (alertas.length > 0) setAlertasAlGuardar(alertas)
              setPorCompletar(cuantosPendientes())
              cargar()
            }}
            onVerFacturas={() => irA('facturas')}
          />
        )}

        {seccion === 'alertas' && <BandejaAlertas onPendientes={alCambiarPendientes} />}

        {alertasAlGuardar.length > 0 && (
          <AlertasAlGuardar alertas={alertasAlGuardar} onCerrar={() => setAlertasAlGuardar([])} />
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
