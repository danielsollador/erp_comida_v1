import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import { useSeccion } from '../components/Secciones'
import { FiltroFechas } from '../components/Fechas'
import { useRango, etiquetaRango } from '../lib/fechas'
import { useDialogo } from '../components/dialogo'
import { Tabla, Th, useBuscador, useOrden } from '../components/Tabla'
import Cajas from './partes/Cajas'
import { Modal, Pagina } from '../components/ui'
import { Numerico } from '../components/Teclado'
import { api } from '../lib/api'
import { METODOS_PAGO, etiquetaMetodo, pedirReferencia } from '../lib/pagos'
import type {
  CierreCaja,
  Configuracion,
  CuentaPorCobrar,
  Gasto,
  PuntoVenta,
  ResumenCaja,
  RetiroPropietario,
} from '../lib/types'

const CATEGORIAS_GASTO = ['Insumos', 'Servicios', 'Sueldos', 'Otros']
const METODOS_GASTO = ['Efectivo', 'Efectivo $', 'Banco']

// Cerrar la caja es lo que se hace todos los dias; lo demas se mira de vez
// en cuando. Las cajas fisicas venian del modulo "Sistema", que se quito: su
// sitio es aqui, que es donde se echan de menos.
const SECCIONES = [
  { id: 'cierre', texto: 'Cierre del día' },
  { id: 'gastos', texto: 'Gastos y retiros' },
  { id: 'fiado', texto: 'A crédito y propinas' },
  { id: 'historial', texto: 'Historial' },
  { id: 'cajas', texto: 'Cajas' },
]

export default function Caja() {
  const [seccion, irA] = useSeccion(SECCIONES)
  // Gastos, retiros e historial de cierres se ven por periodo; el cierre del
  // dia es de hoy y el fiado es lo que se debe: ahi el filtro no aplica.
  const [rango, setRango] = useRango('30d')
  const conPeriodo = seccion === 'gastos' || seccion === 'historial'
  const [resumen, setResumen] = useState<ResumenCaja | null>(null)
  // El valor solo se usa via tasaInput; se guarda el setter para refrescarlo.
  const [, setConfig] = useState<Configuracion>({ tasa_bcv: 0 })
  const [tasaInput, setTasaInput] = useState('')
  // Lo contado, destino por destino, tal como se teclea. Cuenta -> texto:
  // vacio es "no lo verifique" y no "habia cero", que son cosas distintas y
  // el backend las trata distinto (vacio no asienta diferencia).
  const [contados, setContados] = useState<Record<string, string>>({})
  const [cerrando, setCerrando] = useState(false)
  // El arqueo es CIEGO por defecto: quien cuenta no ve lo que el sistema
  // espera. Si lo ve, el numero esperado se convierte en la respuesta que hay
  // que teclear y el arqueo deja de verificar nada -- es el mismo motivo por
  // el que el conteo de inventario nace ciego. Se puede destapar, porque a
  // veces el dueno cuenta su propia caja y solo quiere confirmar.
  const [verEsperado, setVerEsperado] = useState(false)
  const [nota, setNota] = useState('')
  const [cierres, setCierres] = useState<CierreCaja[]>([])
  // El ultimo cierre arriba; pero ordenar por Diferencia pone de primeras las
  // cuadraturas que no dieron, que es lo que un dueno viene a buscar aqui.
  const orden = useOrden<CierreCaja>(
    {
      fecha: (c) => new Date(c.fecha),
      sistema: (c) => c.total_sistema,
      contado: (c) => c.efectivo_contado,
      // Por valor absoluto: da igual si falto o sobro, lo que importa es
      // cuanto se despego de lo que decia el sistema.
      diferencia: (c) => Math.abs(c.diferencia),
    },
    '-fecha',
  )
  // Un cierre por turno: en un mes son sesenta filas. Se busca por quien
  // cerro, por caja, por la nota -- y por fecha, escrita como se ve en la
  // tabla ("18/09/2026" o "18/09").
  const buscador = useBuscador<CierreCaja>(
    (c) => [
      new Date(c.fecha).toLocaleDateString('es-VE'),
      c.operador,
      c.punto_venta,
      c.nota,
      c.motivo_anulacion,
    ],
    'Buscar por fecha, quien cerró o caja',
  )
  const [resultado, setResultado] = useState<CierreCaja | null>(null)
  const [gastos, setGastos] = useState<Gasto[]>([])
  const [gastoDesc, setGastoDesc] = useState('')
  const [gastoMonto, setGastoMonto] = useState('')
  const [gastoCategoria, setGastoCategoria] = useState(CATEGORIAS_GASTO[0])
  const [gastoMetodo, setGastoMetodo] = useState(METODOS_GASTO[0])
  const [retiros, setRetiros] = useState<RetiroPropietario[]>([])
  const [fiado, setFiado] = useState<CuentaPorCobrar[]>([])
  const [puntos, setPuntos] = useState<PuntoVenta[]>([])
  const [puntoId, setPuntoId] = useState<number | null>(() => {
    const v = localStorage.getItem('erp-punto-venta')
    return v ? Number(v) : null
  })
  const [error, setError] = useState('')
  const dialogo = useDialogo()

  useEffect(() => {
    cargar()
  }, [rango])

  function cargar() {
    api.resumenCaja().then(setResumen)
    api.obtenerConfig().then((c) => {
      setConfig(c)
      setTasaInput(String(c.tasa_bcv))
    })
    api.listarCierres(rango).then(setCierres)
    api.listarGastos(rango).then(setGastos)
    api.listarRetiros(rango).then(setRetiros).catch(() => setRetiros([]))
    api.listarFiado().then(setFiado).catch(() => {})
    api.listarPuntosVenta().then(setPuntos).catch(() => {})
  }

  // Sacar plata del negocio NO es un gasto: es capital del dueno que sale, asi
  // que va contra patrimonio y no baja la ganancia. Antes la unica via era
  // cargarlo como Gasto, que hacia ver al negocio menos rentable de lo que es.
  async function registrarRetiro() {
    const r = await dialogo.pedir({
      titulo: 'Retiro del dueño',
      texto:
        `En la gaveta debería haber $${resumen?.efectivo_esperado.toFixed(2) ?? '0.00'}.\n` +
        'No cuenta como gasto del negocio: sale del patrimonio.',
      campos: [
        { nombre: 'monto', etiqueta: 'Cuánto se lleva', sufijo: '$', tipo: 'numero', min: 0.01 },
        {
          nombre: 'origen',
          etiqueta: 'De dónde sale',
          tipo: 'opciones',
          opciones: [
            { valor: 'Efectivo', texto: 'De la gaveta' },
            { valor: 'Banco', texto: 'Del banco' },
          ],
        },
      ],
      aceptar: 'Registrar retiro',
    })
    if (!r) return
    const monto = Number(r.monto)
    const porBanco = r.origen === 'Banco'
    setError('')
    try {
      await api.crearRetiro(monto, porBanco ? 'Banco' : 'Efectivo', '')
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar el retiro')
    }
  }

  async function borrarRetiro(id: number) {
    if (!(await dialogo.confirmar({ titulo: '¿Borrar este retiro?', aceptar: 'Borrar', peligro: true }))) return
    await api.eliminarRetiro(id)
    cargar()
  }

  async function agregarGasto() {
    const monto = Number(gastoMonto)
    if (!gastoDesc.trim() || !Number.isFinite(monto) || monto <= 0) return
    await api.crearGasto(gastoDesc.trim(), gastoCategoria, monto, gastoMetodo)
    setGastoDesc('')
    setGastoMonto('')
    cargar()
  }

  async function borrarGasto(id: number) {
    await api.eliminarGasto(id)
    cargar()
  }

  // Los gastos ya vienen del periodo elegido arriba.
  const totalGastos = gastos.reduce((s, g) => s + g.monto, 0)

  async function guardarTasa() {
    const tasa = Number(tasaInput)
    if (!Number.isFinite(tasa) || tasa < 0) return
    const c = await api.actualizarConfig(tasa)
    setConfig(c)
  }

  async function anularCierre(id: number) {
    const motivo = await dialogo.pedirTexto({
      titulo: 'Anular este cierre',
      texto: 'El cierre no se borra: se revierte su diferencia y el día se puede volver a cerrar.',
      etiqueta: 'Por qué se anula (queda registrado)',
      aceptar: 'Anular cierre',
      peligro: true,
    })
    if (motivo === null) return
    setError('')
    try {
      await api.anularCierre(id, motivo)
      setResultado(null)
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo anular el cierre')
    }
  }

  async function entregarPropinas() {
    const pendiente = resumen?.propinas_por_entregar ?? 0
    const r = await dialogo.pedir({
      titulo: 'Entregar propinas',
      texto: `Hay $${pendiente.toFixed(2)} de propinas en la gaveta.`,
      campos: [
        { nombre: 'monto', etiqueta: 'Cuánto se entrega', sufijo: '$', tipo: 'numero', valor: pendiente.toFixed(2), min: 0.01 },
        { nombre: 'nota', etiqueta: 'A quién', ayuda: 'Queda en el asiento.', opcional: true },
      ],
      aceptar: 'Entregar',
    })
    if (!r) return
    const monto = Number(r.monto)
    const nota_ = r.nota
    setError('')
    try {
      await api.entregarPropinas(monto, 'Efectivo Bs', nota_)
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo entregar')
    }
  }

  async function cobrarFiado(cuenta: CuentaPorCobrar) {
    // Primero cuánto y después cómo: el monto viene ya puesto en lo que debe,
    // así que cobrar todo -que es lo normal- sigue siendo dar Aceptar dos
    // veces, y abonar es borrar y escribir otra cifra.
    const monto = await dialogo.pedirNumero({
      titulo: `Cobrar a ${cuenta.cliente}`,
      etiqueta: 'Cuánto entrega',
      valor: cuenta.monto,
      sufijo: '$',
      min: 0.01,
      ayuda:
        cuenta.abonado > 0
          ? `Debe $${cuenta.monto.toFixed(2)} de $${cuenta.original.toFixed(2)} (ya abonó $${cuenta.abonado.toFixed(2)}).`
          : `Debe $${cuenta.monto.toFixed(2)}. Si entrega menos, queda abonado.`,
    })
    if (monto === null) return
    const metodo = await dialogo.elegir({
      titulo: `Cobrar a ${cuenta.cliente}`,
      texto: `$${monto.toFixed(2)}. ¿Cómo paga?`,
      opciones: METODOS_PAGO.map((m) => ({ valor: m, texto: m })),
    })
    if (!metodo) return
    // Cobrar un crédito es aplicar un pago: si no entra por la gaveta, lleva
    // comprobante, igual que en el punto de venta.
    const referencia = await pedirReferencia(metodo, dialogo.pedirTexto)
    if (referencia === null) return
    setError('')
    try {
      const r = await api.cobrarFiado(cuenta.pedido_id, metodo, monto, referencia)
      if (!r.saldado) {
        await dialogo.avisar({
          titulo: 'Abono registrado',
          texto: `${cuenta.cliente} entregó $${r.cobrado.toFixed(2)} y queda debiendo $${r.queda.toFixed(2)}.`,
        })
      }
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cobrar')
    }
  }

  // Lo que se va a mandar: solo los destinos con un numero escrito. Un campo
  // en blanco NO viaja como cero -- eso diria "conte y no habia nada" y
  // asentaria un faltante por todo lo esperado.
  const conteosAMandar = (resumen?.arqueo ?? [])
    .flatMap((l) => {
      const escrito = (contados[l.cuenta] ?? '').trim()
      if (!escrito) return []
      const contado = Number(escrito.replace(',', '.'))
      if (!Number.isFinite(contado) || contado < 0) return []
      return [{ cuenta: l.cuenta, contado }]
    })

  function abrirCierre() {
    setContados({})
    setNota('')
    setVerEsperado(false)
    setError('')
    setResultado(null)
    setCerrando(true)
  }

  async function hacerCierre() {
    if (conteosAMandar.length === 0) return
    setError('')
    try {
      const cierre = await api.cerrarCaja(conteosAMandar, nota, { punto_venta_id: puntoId })
      setResultado(cierre)
      setCerrando(false)
      setContados({})
      setNota('')
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cerrar la caja')
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Cierre de caja" secciones={SECCIONES} seccion={seccion} alCambiarSeccion={irA} filtro={conPeriodo ? <FiltroFechas rango={rango} alCambiar={setRango} /> : undefined} />
      <Pagina ancho="media">
        {seccion === 'cierre' && (
          <>
        {/* ---------- 1. QUE PASO HOY ----------
            Arriba lo que se vendio y lo que no llego a venderse. Es la
            pregunta con la que el dueno abre esta pantalla; el arqueo viene
            despues, y solo cuando decide cerrar. */}
        {resumen && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <h2 className="font-semibold">Ventas de hoy</h2>
              <span className="text-xs text-neutral-400 tabular-nums">{resumen.fecha}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-neutral-50 rounded-xl p-3">
                <div className="text-xs text-neutral-500">Vendido</div>
                <div className="text-xl font-bold tabular-nums">
                  ${resumen.total_ventas.toFixed(2)}
                </div>
                <div className="text-[11px] text-neutral-400">
                  {resumen.cantidad_pedidos} pedido{resumen.cantidad_pedidos === 1 ? '' : 's'}
                </div>
              </div>
              {/* Anulado y devuelto NO son lo mismo y por eso van separados:
                  en el anulado nunca entro plata, en el devuelto entro y
                  volvio a salir (y por eso el arqueo ya lo tiene contado). */}
              <div className="bg-neutral-50 rounded-xl p-3">
                <div className="text-xs text-neutral-500">Anulado</div>
                <div
                  className={`text-xl font-bold tabular-nums ${
                    resumen.anulados_hoy > 0 ? 'text-peligro-600' : 'text-neutral-300'
                  }`}
                >
                  ${resumen.anulado_monto_hoy.toFixed(2)}
                </div>
                <div className="text-[11px] text-neutral-400">
                  {resumen.anulados_hoy} comanda{resumen.anulados_hoy === 1 ? '' : 's'} botada
                  {resumen.anulados_hoy === 1 ? '' : 's'}
                </div>
              </div>
              <div className="bg-neutral-50 rounded-xl p-3">
                <div className="text-xs text-neutral-500">Devuelto</div>
                <div
                  className={`text-xl font-bold tabular-nums ${
                    resumen.devueltos_hoy > 0 ? 'text-aviso-600' : 'text-neutral-300'
                  }`}
                >
                  ${resumen.devuelto_monto_hoy.toFixed(2)}
                </div>
                <div className="text-[11px] text-neutral-400">
                  {resumen.devueltos_hoy} venta{resumen.devueltos_hoy === 1 ? '' : 's'} reembolsada
                  {resumen.devueltos_hoy === 1 ? '' : 's'}
                </div>
              </div>
              <div className="bg-neutral-50 rounded-xl p-3">
                <div className="text-xs text-neutral-500">Descuentos</div>
                <div
                  className={`text-xl font-bold tabular-nums ${
                    resumen.descuentos_hoy > 0 ? 'text-neutral-700' : 'text-neutral-300'
                  }`}
                >
                  ${resumen.descuentos_hoy.toFixed(2)}
                </div>
                {resumen.propinas_hoy > 0 && (
                  <div className="text-[11px] text-neutral-400">
                    ${resumen.propinas_hoy.toFixed(2)} de propina
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ---------- 2. COMO SE COBRO ----------
            El detalle por forma de pago, agrupado por DONDE cayo la plata.
            Agrupado y no en una lista plana porque es justo el corte que
            despues hay que arquear: la gaveta de bolivares junta el efectivo
            en Bs, y el banco junta punto, pago movil y transferencia. Ver el
            grupo aqui es lo que hace que el conteo de despues tenga sentido. */}
        {resumen && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-4">
            <h2 className="font-semibold mb-1">Cómo se cobró</h2>
            <p className="text-xs text-neutral-500 mb-3">
              Lo que el sistema tiene registrado, agrupado por dónde cayó la plata.
            </p>
            {resumen.arqueo.length === 0 && (
              <p className="text-neutral-400 text-sm">Aún no hay ventas cobradas hoy.</p>
            )}
            <div className="space-y-3">
              {resumen.arqueo.map((linea) => {
                const metodos = Object.entries(linea.metodos)
                return (
                  <div key={linea.cuenta} className="rounded-xl bg-neutral-50 p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-sm">{linea.etiqueta}</span>
                      <span className="text-xs text-neutral-400">
                        {linea.fisico ? 'se cuenta' : 'se coteja'}
                      </span>
                    </div>
                    {metodos.length > 0 ? (
                      <div className="mt-2 space-y-1 text-sm">
                        {metodos.map(([metodo, monto]) => (
                          <div key={metodo} className="flex justify-between">
                            <span className="text-neutral-600">{etiquetaMetodo(metodo)}</span>
                            <span className="font-medium tabular-nums">${monto.toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-neutral-400">
                        Sin ventas cobradas por aquí hoy.
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ---------- 3. CERRAR ---------- */}
        <div className="bg-white rounded-2xl border border-neutral-200 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
            <h2 className="font-semibold">Cerrar la caja</h2>
            {/* Con dos pisos hay dos gavetas y cada una cierra la suya: antes
                el segundo cierre del dia devolvia 409. */}
            {puntos.length > 0 && (
              <label className="text-xs text-neutral-500 flex items-center gap-1">
                Cerrando la caja
                <select
                  value={puntoId ?? ''}
                  onChange={(e) => {
                    const v = e.target.value ? Number(e.target.value) : null
                    setPuntoId(v)
                    if (v) localStorage.setItem('erp-punto-venta', String(v))
                    else localStorage.removeItem('erp-punto-venta')
                  }}
                  className="rounded-lg border border-neutral-300 px-2 py-1 text-neutral-900"
                >
                  <option value="">principal</option>
                  {puntos.map((pv) => (
                    <option key={pv.id} value={pv.id}>
                      {pv.nombre}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p className="text-xs text-neutral-500 mb-3">
            Cuenta los billetes y coteja el banco. El sistema compara con lo que debería haber y
            te dice si cuadró.
          </p>
          {error && !cerrando && <p className="text-peligro-600 text-sm mb-2">{error}</p>}
          <button
            onClick={abrirCierre}
            disabled={!resumen || resumen.arqueo.length === 0}
            className="w-full bg-neutral-900 text-white rounded-xl py-3 font-medium disabled:opacity-30"
          >
            Cerrar caja
          </button>

          {/* El veredicto, fila por fila. Se queda despues de cerrar el
              cuadro: es lo que el cajero le enseña al dueno. */}
          {resultado && (
            <div className="mt-4 rounded-xl border border-neutral-200 overflow-hidden">
              <div
                className={`px-3 py-2 text-sm font-medium ${
                  resultado.lineas.every((l) => Math.abs(l.diferencia) < 0.01)
                    ? 'bg-exito-50 text-exito-800'
                    : 'bg-aviso-50 text-aviso-800'
                }`}
              >
                {resultado.lineas.every((l) => Math.abs(l.diferencia) < 0.01)
                  ? 'Cuadró: todo lo contado coincide con el sistema.'
                  : 'No cuadró. El descuadre queda asentado en los libros:'}
              </div>
              <div className="divide-y divide-neutral-100">
                {resultado.lineas.map((l) => (
                  <div key={l.cuenta} className="flex items-baseline justify-between gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block font-medium truncate">{l.etiqueta}</span>
                      <span className="block text-[11px] text-neutral-400 tabular-nums">
                        sistema ${l.esperado.toFixed(2)} · contado ${l.contado.toFixed(2)}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 font-semibold tabular-nums ${
                        Math.abs(l.diferencia) < 0.01
                          ? 'text-exito-600'
                          : l.diferencia < 0
                            ? 'text-peligro-600'
                            : 'text-aviso-600'
                      }`}
                    >
                      {Math.abs(l.diferencia) < 0.01
                        ? 'cuadra'
                        : l.diferencia > 0
                          ? `sobran $${l.diferencia.toFixed(2)}`
                          : `faltan $${Math.abs(l.diferencia).toFixed(2)}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* La tasa se edita de verdad en su propio modulo; aqui queda el
            atajo, abajo, porque el cajero la toca al abrir y no al cerrar. */}
        <div className="bg-white rounded-2xl border border-neutral-200 p-4">
          <h2 className="font-semibold mb-2">Tasa BCV (Bs por USD)</h2>
          <div className="flex flex-wrap gap-2">
            <Numerico
              value={tasaInput}
              onChange={(e) => setTasaInput(e.target.value)}
              className="flex-1 border border-neutral-300 rounded-lg px-3 py-2 text-sm"
              placeholder="Ej. 190.50"
            />
            <button
              onClick={guardarTasa}
              className="bg-neutral-900 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              Guardar
            </button>
          </div>
          <p className="text-xs text-neutral-500 mt-2">
            Se usa para mostrar el equivalente en bolívares al cobrar. En el módulo Tasa se
            actualiza sola desde el BCV.
          </p>
        </div>

        {/* ---------- El conteo, en un cuadro aparte ----------
            Aparte y no en la pagina a proposito: contar la caja es un acto
            con principio y fin, y mientras dura no hay nada mas que hacer
            aqui. Ademas asi el arqueo ciego es de verdad ciego -- en la
            pagina, lo esperado estaria a dos dedos de los campos. */}
        {cerrando && resumen && (
          <Modal
            titulo="Contar la caja"
            ayuda="Escribe lo que hay DE VERDAD en cada sitio. Lo que dejes en blanco no se verifica."
            onCerrar={() => setCerrando(false)}
            pie={
              <div className="flex gap-2">
                <button
                  onClick={() => setCerrando(false)}
                  className="flex-1 rounded-xl border border-neutral-300 py-3 text-sm font-medium"
                >
                  Cancelar
                </button>
                <button
                  onClick={hacerCierre}
                  disabled={conteosAMandar.length === 0}
                  className="flex-1 rounded-xl bg-neutral-900 py-3 text-sm font-medium text-white disabled:opacity-30"
                >
                  Cerrar y conciliar
                </button>
              </div>
            }
          >
            {error && <p className="text-peligro-600 text-sm mb-3">{error}</p>}
            <div className="space-y-3">
              {resumen.arqueo.map((linea) => (
                <div key={linea.cuenta} className="rounded-xl border border-neutral-200 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-sm">{linea.etiqueta}</span>
                    <span className="text-[11px] text-neutral-400">
                      {linea.fisico ? 'cuenta los billetes' : 'coteja el saldo'}
                    </span>
                  </div>
                  {Object.keys(linea.metodos).length > 0 && (
                    <p className="text-[11px] text-neutral-400 mt-0.5">
                      {Object.keys(linea.metodos).map(etiquetaMetodo).join(' · ')}
                    </p>
                  )}
                  <Numerico
                    value={contados[linea.cuenta] ?? ''}
                    onChange={(e) =>
                      setContados((c) => ({ ...c, [linea.cuenta]: e.target.value }))
                    }
                    placeholder={linea.fisico ? 'Cuánto contaste' : 'Cuánto dice el saldo'}
                    className="mt-2 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
                  />
                  {/* Destapado, queda debajo del campo ya escrito: sirve para
                      confirmar, no para copiar. */}
                  {verEsperado && (
                    <p className="mt-1.5 text-xs text-neutral-500 tabular-nums">
                      El sistema dice ${linea.esperado.toFixed(2)}
                      {linea.saldo_anterior !== 0 &&
                        ` (${linea.saldo_anterior.toFixed(2)} de ayer + ${linea.entradas_hoy.toFixed(2)} − ${linea.salidas_hoy.toFixed(2)})`}
                    </p>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={() => setVerEsperado((v) => !v)}
              className="mt-3 text-xs font-medium text-neutral-500 underline"
            >
              {verEsperado ? 'Ocultar lo que dice el sistema' : 'Ver lo que dice el sistema'}
            </button>
            <input
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="Nota (opcional): por qué faltó, quién contó…"
              className="mt-3 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </Modal>
        )}
          </>
        )}

        {seccion === 'gastos' && (
          <>
        <div className="bg-white rounded-2xl border border-neutral-200 p-4">
          <div className="flex justify-between items-center mb-2">
            <h2 className="font-semibold">
              Gastos <span className="text-neutral-400 font-normal text-sm">· {etiquetaRango(rango)}</span>
            </h2>
            <span className="font-bold">${totalGastos.toFixed(2)}</span>
          </div>
          <p className="text-xs text-neutral-500 mb-3">
            Gas, bolsas, un adelanto, el mandado. Si lo pagaste en efectivo se descuenta de la
            gaveta; si fue por transferencia, no.
          </p>

          <div className="space-y-1 mb-3">
            {gastos.map((g) => (
              <div key={g.id} className="flex justify-between items-center text-sm">
                <span>
                  <span className="text-xs text-neutral-400 tabular-nums mr-1.5">
                    {new Date(g.fecha).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' })}
                  </span>
                  {g.descripcion}{' '}
                  <span className="text-xs text-neutral-400">
                    ({g.categoria}
                    {g.metodo_pago === 'Banco' ? ' · banco' : ''})
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-medium">${g.monto.toFixed(2)}</span>
                  <button onClick={() => borrarGasto(g.id)} className="text-peligro-400 text-xs">
                    x
                  </button>
                </span>
              </div>
            ))}
            {gastos.length === 0 && (
              <p className="text-neutral-400 text-sm">Sin gastos en este período.</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <input
              value={gastoDesc}
              onChange={(e) => setGastoDesc(e.target.value)}
              placeholder="Ej. Bombona de gas"
              className="flex-1 border border-neutral-300 rounded-lg px-3 py-2 text-sm"
            />
            <select
              value={gastoCategoria}
              onChange={(e) => setGastoCategoria(e.target.value)}
              className="border border-neutral-300 rounded-lg px-2 py-2 text-sm"
            >
              {CATEGORIAS_GASTO.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              value={gastoMetodo}
              onChange={(e) => setGastoMetodo(e.target.value)}
              className="border border-neutral-300 rounded-lg px-2 py-2 text-sm"
              title="De dónde salió la plata"
            >
              {METODOS_GASTO.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <Numerico
              value={gastoMonto}
              onChange={(e) => setGastoMonto(e.target.value)}
              placeholder="$"
              className="w-20 border border-neutral-300 rounded-lg px-2 py-2 text-sm"
            />
            <button
              onClick={agregarGasto}
              className="bg-neutral-900 text-white px-3 py-2 rounded-lg text-sm font-medium"
            >
              +
            </button>
          </div>
        </div>

        {/* Separado de Gastos a proposito: el dueno sacando su plata no es un
            gasto del negocio y no debe bajar la ganancia. */}
        <div className="bg-white rounded-2xl border border-neutral-200 p-4">
          <div className="flex justify-between items-center mb-2">
            <h2 className="font-semibold">Retiros del dueño</h2>
            <button
              onClick={registrarRetiro}
              className="bg-neutral-100 hover:bg-neutral-200 px-3 py-1.5 rounded-lg text-sm font-medium"
            >
              Registrar retiro
            </button>
          </div>
          <p className="text-xs text-neutral-500 mb-3">
            Plata que te llevas del negocio. No cuenta como gasto ni baja la ganancia: sale de tu
            patrimonio.
          </p>
          <div className="space-y-1">
            {retiros.map((r) => (
              <div key={r.id} className="flex justify-between items-center text-sm">
                <span className="text-neutral-600">
                  {new Date(r.fecha).toLocaleDateString('es-VE')}
                  {r.metodo_pago === 'Banco' && (
                    <span className="text-xs text-neutral-400"> · banco</span>
                  )}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-medium tabular-nums">${r.monto.toFixed(2)}</span>
                  <button onClick={() => borrarRetiro(r.id)} className="text-peligro-400 text-xs">
                    x
                  </button>
                </span>
              </div>
            ))}
            {retiros.length === 0 && (
              <p className="text-neutral-400 text-sm">Sin retiros en este período.</p>
            )}
          </div>
        </div>
          </>
        )}

        {seccion === 'fiado' && (
          <>
        {/* Plata que esta en la gaveta y NO es del negocio. Antes la propina
            aparecia como sobrante y terminaba engordando la utilidad, y el
            fiado no tenia donde registrarse. */}
        {((resumen?.propinas_por_entregar ?? 0) > 0 || fiado.length > 0) && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-4 space-y-3">
            <h2 className="font-semibold">Plata que no es del negocio</h2>
            {(resumen?.propinas_por_entregar ?? 0) > 0 && (
              <div className="flex items-center justify-between rounded-xl bg-acento-50 border border-acento-200 p-3">
                <div>
                  <div className="font-medium text-acento-900">Propinas por entregar</div>
                  <div className="text-xs text-acento-700">
                    Está en la gaveta pero es del empleado, no ingreso tuyo.
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold tabular-nums text-acento-900">
                    ${(resumen?.propinas_por_entregar ?? 0).toFixed(2)}
                  </span>
                  <button
                    onClick={entregarPropinas}
                    className="rounded-lg bg-acento-600 px-3 py-1.5 text-sm font-medium text-white"
                  >
                    Entregar
                  </button>
                </div>
              </div>
            )}
            {fiado.length > 0 && (
              <div className="rounded-xl bg-aviso-50 border border-aviso-200 p-3">
                <div className="flex justify-between font-medium text-aviso-900">
                  <span>A crédito por cobrar</span>
                  <span className="tabular-nums">
                    ${(resumen?.fiado_por_cobrar ?? 0).toFixed(2)}
                  </span>
                </div>
                <div className="mt-2 space-y-1">
                  {fiado.map((f) => (
                    <div
                      key={f.pedido_id}
                      className="flex items-center justify-between gap-2 text-sm text-aviso-900"
                    >
                      <span className="truncate">
                        {f.cliente}
                        <span className="ml-1 text-xs text-aviso-700">
                          #{f.numero} · hace {f.dias} día(s)
                          {f.abonado > 0 && ` · abonó $${f.abonado.toFixed(2)} de $${f.original.toFixed(2)}`}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="font-semibold tabular-nums">${f.monto.toFixed(2)}</span>
                        <button
                          onClick={() => cobrarFiado(f)}
                          className="rounded-lg border border-aviso-400 px-2 py-1 text-xs font-medium"
                        >
                          Cobrar
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
          </>
        )}

        {seccion === 'historial' && (
          <>
        {cierres.length > 0 && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-4">
            <h2 className="font-semibold mb-2">Historial de cierres</h2>
            <Tabla orden={orden} buscador={buscador} glosario="cierres">
            <table className="w-full text-sm">
              <thead className="text-neutral-500">
                <tr>
                  <Th clave="fecha" className="py-1 px-0">Fecha</Th>
                  <Th clave="sistema" alinear="derecha" className="py-1 px-0">Sistema</Th>
                  <Th clave="contado" alinear="derecha" className="py-1 px-0">Contado</Th>
                  <Th clave="diferencia" alinear="derecha" className="py-1 px-0">Diferencia</Th>
                  <Th className="py-1 px-0" />
                </tr>
              </thead>
              <tbody>
                {orden.ordenar(buscador.filtrar(cierres)).map((c) => (
                  <tr
                    key={c.id}
                    className={`border-t border-neutral-100 ${c.anulado ? 'opacity-50' : ''}`}
                  >
                    <td className="py-1">
                      {new Date(c.fecha).toLocaleString('es-VE')}
                      {(c.operador || c.punto_venta) && (
                        <span className="block text-[11px] text-neutral-400">
                          {[c.punto_venta, c.operador].filter(Boolean).join(' · ')}
                        </span>
                      )}
                      {c.anulado && (
                        <span className="block text-[11px] text-peligro-500">
                          anulado{c.motivo_anulacion ? `: ${c.motivo_anulacion}` : ''}
                        </span>
                      )}
                    </td>
                    <td className="text-right py-1">${c.efectivo_esperado.toFixed(2)}</td>
                    <td className="text-right py-1">${c.efectivo_contado.toFixed(2)}</td>
                    <td
                      className={`text-right py-1 font-medium ${
                        c.diferencia === 0
                          ? 'text-exito-600'
                          : c.diferencia < 0
                            ? 'text-peligro-600'
                            : 'text-aviso-600'
                      }`}
                    >
                      {c.anulado ? '—' : `${c.diferencia > 0 ? '+' : ''}${c.diferencia.toFixed(2)}`}
                      {/* El desglose por destino. Las columnas de la tabla
                          son las de la gaveta de bolivares y nada mas; desde
                          que se arquea el banco y Zelle, un descuadre de ahi
                          no aparecia por ningun lado. Los cierres viejos no
                          tienen detalle y caen al aviso de divisas de antes. */}
                      {!c.anulado && c.lineas.length > 0
                        ? c.lineas
                            .filter((l) => l.cuenta !== '1010' && Math.abs(l.diferencia) >= 0.01)
                            .map((l) => (
                              <span key={l.cuenta} className="block text-[11px]">
                                {l.etiqueta.toLowerCase()} {l.diferencia > 0 ? '+' : ''}
                                {l.diferencia.toFixed(2)}
                              </span>
                            ))
                        : !c.anulado &&
                          c.divisas_diferencia !== 0 && (
                            <span className="block text-[11px]">
                              divisas {c.divisas_diferencia > 0 ? '+' : ''}
                              {c.divisas_diferencia.toFixed(2)}
                            </span>
                          )}
                    </td>
                    <td className="py-1 text-right">
                      {/* Un digito de mas al contar metia un sobrante ficticio
                          en los libros para siempre: no habia como corregirlo. */}
                      {!c.anulado && (
                        <button
                          onClick={() => anularCierre(c.id)}
                          className="text-xs font-medium text-peligro-500"
                        >
                          Anular
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </Tabla>
          </div>
        )}
          </>
        )}

        {seccion === 'cajas' && <Cajas />}
      </Pagina>
    </div>
  )
}
