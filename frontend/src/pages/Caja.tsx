import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import { useSeccion } from '../components/Secciones'
import { FiltroFechas } from '../components/Fechas'
import { useRango, etiquetaRango } from '../lib/fechas'
import { useDialogo } from '../components/dialogo'
import { Modal, Pagina } from '../components/ui'
import { Numerico } from '../components/Teclado'
import { api } from '../lib/api'
import { METODOS_PAGO } from '../lib/pagos'
import type {
  CierreCaja,
  DestinoApertura,
  Gasto,
  LineaMetodo,
  ResumenCaja,
  RetiroPropietario,
} from '../lib/types'

/**
 * Cierre de caja.
 *
 * EL ORDEN ES EL DE LA CABEZA DEL DUEÑO, no el del modelo de datos:
 *
 *   1. Qué vendí.              (y qué se anuló, que es la otra mitad)
 *   2. Qué salió.              (gastos y retiros)
 *   3. Por dónde entró.        (desglose por forma de pago)
 *   4. ¿Cuadra?                (el desglose contra las ventas)
 *   5. Contar.                 (un número por forma de pago)
 *
 * Y se cuadra UN DÍA, no "hoy": si anoche no dio tiempo, se elige la fecha y
 * el sistema trae los datos de ese día. Obligar a cuadrar "hoy o nunca" es lo
 * que hace que se dejen de cerrar cajas.
 */
const SECCIONES = [
  { id: 'cierre', texto: 'Cierre de caja' },
  { id: 'movimientos', texto: 'Gastos y retiros' },
  { id: 'historial', texto: 'Historial' },
]

const CATEGORIAS_GASTO = ['Insumos', 'Servicios', 'Sueldos', 'Otros']

function hoyISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dinero(n: number) {
  return `${n < 0 ? '−' : ''}$${Math.abs(n).toFixed(2)}`
}

export default function Caja() {
  const [seccion, irA] = useSeccion(SECCIONES)
  // El día que se está cuadrando. NO es un rango: cuadrar es de un día.
  const [dia, setDia] = useState(hoyISO)
  const [resumen, setResumen] = useState<ResumenCaja | null>(null)
  const [apertura, setApertura] = useState<DestinoApertura[]>([])
  const [error, setError] = useState('')

  // Solo el historial mira períodos.
  const [rango, setRango] = useRango('30d')
  const [gastos, setGastos] = useState<Gasto[]>([])
  const [retiros, setRetiros] = useState<RetiroPropietario[]>([])
  const [cierres, setCierres] = useState<CierreCaja[]>([])

  const [contando, setContando] = useState(false)
  const [resultado, setResultado] = useState<CierreCaja | null>(null)
  const dialogo = useDialogo()

  useEffect(() => {
    cargarDia()
  }, [dia])

  useEffect(() => {
    cargarPeriodo()
  }, [rango])

  function cargarDia() {
    setError('')
    api.resumenCaja(dia).then(setResumen).catch((e) => setError(e.message))
    api.estadoApertura().then(setApertura).catch(() => setApertura([]))
  }

  function cargarPeriodo() {
    api.listarGastos(rango).then(setGastos).catch(() => setGastos([]))
    api.listarRetiros(rango).then(setRetiros).catch(() => setRetiros([]))
    api.listarCierres(rango).then(setCierres).catch(() => setCierres([]))
  }

  function recargar() {
    cargarDia()
    cargarPeriodo()
  }

  async function declararApertura(destino: DestinoApertura) {
    const monto = await dialogo.pedirNumero({
      titulo: `¿Con cuánto arrancó ${destino.etiqueta.toLowerCase()}?`,
      etiqueta: 'Lo que había cuando empezaste a usar el sistema',
      sufijo: '$',
      min: 0,
      ayuda:
        'Es plata tuya que ya estaba ahí, no una venta: entra contra tu capital y no ' +
        'sube la ganancia. Se declara una sola vez.',
    })
    if (monto === null) return
    try {
      await api.declararApertura(destino.cuenta, monto)
      recargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo declarar el saldo inicial')
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar
        titulo="Cierre de caja"
        secciones={SECCIONES}
        seccion={seccion}
        alCambiarSeccion={irA}
        filtro={
          seccion === 'historial' ? <FiltroFechas rango={rango} alCambiar={setRango} /> : undefined
        }
      />
      <Pagina ancho="media">
        {error && <p className="text-peligro-600 text-sm">{error}</p>}

        {seccion === 'cierre' && resumen && (
          <>
            {/* Una gaveta en negativo: mientras siga así, el cierre miente. */}
            {apertura
              .filter((d) => d.urge)
              .map((d) => (
                <div key={d.cuenta} className="bg-peligro-50 border border-peligro-300 rounded-2xl p-4">
                  <h2 className="font-semibold text-peligro-900">
                    {d.etiqueta} está en −${Math.abs(d.saldo).toFixed(2)}
                  </h2>
                  <p className="text-sm text-peligro-800 mt-1">
                    Una gaveta no puede tener menos de cero. Pasa cuando se paga algo en efectivo
                    con plata que ya estaba ahí el día que empezaste a usar el sistema.
                  </p>
                  <button
                    onClick={() => declararApertura(d)}
                    className="mt-3 rounded-xl bg-peligro-600 px-4 py-2.5 text-sm font-medium text-white"
                  >
                    Declarar con cuánto arrancaste
                  </button>
                </div>
              ))}

            <SelectorDia dia={dia} alCambiar={setDia} resumen={resumen} />
            <Ventas r={resumen} />
            <Salidas r={resumen} irAMovimientos={() => irA('movimientos')} />
            <Desglose r={resumen} />
            <Cuadre r={resumen} />

            <button
              onClick={() => {
                setResultado(null)
                setContando(true)
              }}
              disabled={resumen.cerrada}
              className="w-full bg-neutral-900 text-white rounded-xl py-3.5 font-medium disabled:opacity-30"
            >
              {resumen.cerrada ? 'Esta caja ya se cerró' : 'Hacer cierre de caja'}
            </button>

            {resultado && <Veredicto cierre={resultado} />}
          </>
        )}

        {seccion === 'movimientos' && (
          <Movimientos gastos={gastos} retiros={retiros} rango={rango} alCambiar={recargar} />
        )}

        {seccion === 'historial' && (
          <Historial
            gastos={gastos}
            retiros={retiros}
            cierres={cierres}
            rango={rango}
            alAnular={recargar}
          />
        )}
      </Pagina>

      {contando && resumen && (
        <CuadrarCaja
          resumen={resumen}
          dia={dia}
          alCerrar={() => setContando(false)}
          alListo={(c) => {
            setResultado(c)
            setContando(false)
            recargar()
          }}
        />
      )}
    </div>
  )
}


/** Qué día se está cuadrando. Ayer, anteayer o el que sea. */
function SelectorDia({
  dia,
  alCambiar,
  resumen,
}: {
  dia: string
  alCambiar: (d: string) => void
  resumen: ResumenCaja
}) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">
          Cuadrando el día
        </label>
        <input
          type="date"
          value={dia}
          max={hoyISO()}
          onChange={(e) => e.target.value && alCambiar(e.target.value)}
          className="border border-neutral-300 rounded-lg px-3 py-2 text-sm tabular-nums"
        />
      </div>
      <div className="text-right">
        {!resumen.es_hoy && (
          <button
            onClick={() => alCambiar(hoyISO())}
            className="text-xs font-medium text-acento-600 underline"
          >
            Volver a hoy
          </button>
        )}
        {resumen.cerrada && (
          <span className="block mt-1 text-xs font-medium text-exito-700">Ya cerrada</span>
        )}
      </div>
    </div>
  )
}

/** 1. Qué se vendió, y qué no llegó a venderse. */
function Ventas({ r }: { r: ResumenCaja }) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4">
      <h2 className="font-semibold mb-3">Ventas</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile titulo="Vendido" valor={r.vendido} detalle={`${r.cantidad_pedidos} pedido(s)`} fuerte />
        <Tile
          titulo="Descuentos"
          valor={r.descuentos}
          detalle="rebajas a clientes"
          tono={r.descuentos > 0 ? 'neutro' : 'apagado'}
        />
        <Tile
          titulo="Anuladas"
          valor={r.anulado_monto_hoy}
          detalle={`${r.anulados_hoy} comanda(s) botada(s)`}
          tono={r.anulados_hoy > 0 ? 'malo' : 'apagado'}
        />
        <Tile
          titulo="Propinas"
          valor={r.propinas}
          detalle="del empleado, no del negocio"
          tono={r.propinas > 0 ? 'neutro' : 'apagado'}
        />
      </div>
      {/* Devolver no es anular: ahi la plata entro y volvio a salir, asi que
          el desglose de abajo si se entero. */}
      {r.devueltos_hoy > 0 && (
        <p className="text-xs text-neutral-500 mt-3">
          Además se devolvieron {r.devueltos_hoy} venta(s) por {dinero(r.devuelto_monto_hoy)}: esa
          plata entró y volvió a salir.
        </p>
      )}
    </div>
  )
}

/** 2. Qué salió de la caja que no fue una venta. */
function Salidas({ r, irAMovimientos }: { r: ResumenCaja; irAMovimientos: () => void }) {
  const hay = r.gastos > 0 || r.retiros > 0 || r.otros_movimientos.length > 0
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4">
      <div className="flex items-baseline justify-between gap-2 mb-3">
        <h2 className="font-semibold">Gastos y retiros</h2>
        <button onClick={irAMovimientos} className="text-xs font-medium text-acento-600 underline">
          Registrar uno
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Tile
          titulo="Gastos"
          valor={r.gastos}
          detalle="bombona, vasos, pitillos…"
          tono={r.gastos > 0 ? 'malo' : 'apagado'}
        />
        <Tile
          titulo="Retiros del dueño"
          valor={r.retiros}
          detalle="no es gasto: sale del patrimonio"
          tono={r.retiros > 0 ? 'malo' : 'apagado'}
        />
      </div>
      {/* Pagarle a un proveedor tambien mueve la caja, y no es ninguno de los
          dos. Si no se dijera, al contar apareceria como un descuadre sin
          explicacion. */}
      {r.otros_movimientos.map((o) => (
        <p key={o.cuenta} className="text-xs text-neutral-500 mt-3">
          En {o.etiqueta.toLowerCase()} hubo {dinero(o.monto)} de otros movimientos (pagos a
          proveedores, compras sueltas, impuestos). No salieron de aquí, pero cuentan al cotejar.
        </p>
      ))}
      {!hay && <p className="text-xs text-neutral-400 mt-3">No salió nada de la caja este día.</p>}
    </div>
  )
}

/** 3. Por dónde entró y por dónde salió, forma de pago por forma de pago. */
function Desglose({ r }: { r: ResumenCaja }) {
  // Las que no se movieron se esconden, salvo el efectivo: esas se cuentan
  // siempre, aunque el dia haya sido de puro pago movil.
  const visibles = r.desglose.filter(
    (l) => l.fisico || l.ventas !== 0 || l.salidas !== 0 || l.otros !== 0,
  )
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4">
      <h2 className="font-semibold mb-1">Desglose por forma de pago</h2>
      <p className="text-xs text-neutral-500 mb-3">
        Lo que el sistema tiene registrado. Cada forma tiene su propia fuente: los billetes se
        cuentan, el punto imprime su lote, el pago móvil se mira en el banco.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-neutral-500">
            <tr className="border-b border-neutral-200">
              <th className="text-left font-medium py-1.5">Forma de pago</th>
              <th className="text-right font-medium py-1.5">Entró</th>
              <th className="text-right font-medium py-1.5">Salió</th>
              <th className="text-right font-medium py-1.5">Debe cuadrar</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((l) => (
              <FilaMetodo key={l.metodo} l={l} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FilaMetodo({ l }: { l: LineaMetodo }) {
  // Lo que salio por esta via: gastos y retiros, mas lo que los libros saben
  // y el desglose no puede atribuir (pagarle a un proveedor en efectivo).
  const salidaTotal = l.salidas - Math.min(l.otros, 0)
  return (
    <tr className="border-b border-neutral-100 last:border-0">
      <td className="py-2">
        <span className="font-medium">{l.metodo}</span>
        <span className="block text-[11px] text-neutral-400">
          {!l.se_cuadra
            ? 'no entró plata: es una deuda'
            : l.fisico
              ? 'se cuenta: lo que hay en la gaveta'
              : 'se coteja: el movimiento del día'}
          {l.saldo_anterior !== 0 && ` · ${dinero(l.saldo_anterior)} de días anteriores`}
        </span>
      </td>
      <td className="text-right tabular-nums">{l.ventas ? dinero(l.ventas) : '—'}</td>
      <td className="text-right tabular-nums text-peligro-600">
        {salidaTotal ? dinero(-salidaTotal) : '—'}
      </td>
      <td className="text-right tabular-nums font-semibold">
        {l.se_cuadra ? dinero(l.esperado) : '—'}
      </td>
    </tr>
  )
}

/** 4. ¿Cuadra? Las ventas contra el desglose, y lo que debería quedar. */
function Cuadre({ r }: { r: ResumenCaja }) {
  const quedaEfectivo = r.desglose.filter((l) => l.fisico).reduce((s, l) => s + l.esperado, 0)
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4">
      <h2 className="font-semibold mb-3">Resumen</h2>
      <div className="space-y-1.5 text-sm">
        <Fila texto="Vendido" monto={r.vendido} />
        {r.descuentos > 0 && <Fila texto="− Descuentos" monto={-r.descuentos} />}
        {r.propinas > 0 && <Fila texto="+ Propinas" monto={r.propinas} />}
        <Fila texto="Había que cobrar" monto={r.a_cobrar} negrita />
        <div className="border-t border-neutral-200 pt-1.5" />
        <Fila texto="Suma del desglose" monto={r.cobrado} />
      </div>

      {/* LA comprobacion: si el desglose no suma las ventas, hay un pago mal
          registrado y contar la caja no va a servir de nada. */}
      <div
        className={`mt-3 rounded-xl px-3 py-2.5 text-sm ${
          r.cuadra_ventas ? 'bg-exito-50 text-exito-800' : 'bg-peligro-50 text-peligro-800'
        }`}
      >
        {r.cuadra_ventas ? (
          <span className="font-medium">
            Cuadra: cada bolívar vendido está en alguna forma de pago.
          </span>
        ) : (
          <>
            <span className="font-medium">
              No cuadra por {dinero(Math.abs(r.a_cobrar - r.cobrado))}.
            </span>{' '}
            Hay una venta cobrada sin pago registrado. Revísala antes de contar.
          </>
        )}
      </div>

      <div className="mt-3 space-y-1.5 text-sm">
        {r.gastos > 0 && <Fila texto="− Gastos" monto={-r.gastos} />}
        {r.retiros > 0 && <Fila texto="− Retiros" monto={-r.retiros} />}
        <div className="border-t border-neutral-200 pt-1.5" />
        <Fila texto="Debería quedar en efectivo" monto={quedaEfectivo} negrita />
      </div>
      <p className="text-[11px] text-neutral-400 mt-2">
        Solo el efectivo se arrastra de un día a otro. Lo del banco, el punto y Zelle se coteja
        contra el movimiento del día.
      </p>
    </div>
  )
}

function Fila({ texto, monto, negrita }: { texto: string; monto: number; negrita?: boolean }) {
  return (
    <div className={`flex justify-between ${negrita ? 'font-semibold' : 'text-neutral-600'}`}>
      <span>{texto}</span>
      <span className="tabular-nums">{dinero(monto)}</span>
    </div>
  )
}

function Tile({
  titulo,
  valor,
  detalle,
  fuerte,
  tono = 'neutro',
}: {
  titulo: string
  valor: number
  detalle?: string
  fuerte?: boolean
  tono?: 'neutro' | 'malo' | 'apagado'
}) {
  const color =
    tono === 'apagado'
      ? 'text-neutral-300'
      : tono === 'malo'
        ? 'text-peligro-600'
        : 'text-neutral-900'
  return (
    <div className="bg-neutral-50 rounded-xl p-3">
      <div className="text-xs text-neutral-500">{titulo}</div>
      <div className={`font-bold tabular-nums ${fuerte ? 'text-xl' : 'text-lg'} ${color}`}>
        {dinero(valor)}
      </div>
      {detalle && <div className="text-[11px] text-neutral-400 leading-tight mt-0.5">{detalle}</div>}
    </div>
  )
}


/**
 * 5. Contar. Un número por forma de pago.
 *
 * CIEGO a proposito: quien cuenta no ve lo que el sistema espera. Si lo ve,
 * el numero esperado deja de ser una verificacion y pasa a ser la respuesta
 * que hay que teclear. Se puede destapar, porque a veces el dueño cuenta su
 * propia caja y solo quiere confirmar.
 */
function CuadrarCaja({
  resumen,
  dia,
  alCerrar,
  alListo,
}: {
  resumen: ResumenCaja
  dia: string
  alCerrar: () => void
  alListo: (c: CierreCaja) => void
}) {
  const [contados, setContados] = useState<Record<string, string>>({})
  const [verEsperado, setVerEsperado] = useState(false)
  const [nota, setNota] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const aCuadrar = resumen.desglose.filter((l) => l.se_cuadra)

  // Lo que se va a mandar: solo lo que tenga un numero escrito. En blanco NO
  // viaja como cero -- eso diria "conte y no habia nada" y asentaria un
  // faltante por todo lo esperado.
  const conteos = aCuadrar.flatMap((l) => {
    const escrito = (contados[l.metodo] ?? '').trim()
    if (!escrito) return []
    const contado = Number(escrito.replace(',', '.'))
    if (!Number.isFinite(contado) || contado < 0) return []
    return [{ metodo: l.metodo, contado }]
  })

  async function cerrar() {
    if (conteos.length === 0) return
    setGuardando(true)
    setError('')
    try {
      alListo(await api.cerrarCaja(conteos, { fecha: dia, nota }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cerrar la caja')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      titulo="Contar la caja"
      ayuda="Escribe lo que hay DE VERDAD en cada sitio. Lo que dejes en blanco no se verifica."
      onCerrar={alCerrar}
      pie={
        <div className="flex gap-2">
          <button
            onClick={alCerrar}
            className="flex-1 rounded-xl border border-neutral-300 py-3 text-sm font-medium"
          >
            Cancelar
          </button>
          <button
            onClick={cerrar}
            disabled={conteos.length === 0 || guardando}
            className="flex-1 rounded-xl bg-neutral-900 py-3 text-sm font-medium text-white disabled:opacity-30"
          >
            {guardando ? 'Cerrando…' : 'Cerrar y conciliar'}
          </button>
        </div>
      }
    >
      {error && <p className="text-peligro-600 text-sm mb-3">{error}</p>}
      {!resumen.es_hoy && (
        <p className="text-xs text-aviso-700 bg-aviso-50 border border-aviso-200 rounded-lg px-3 py-2 mb-3">
          Estás cuadrando el día {new Date(dia + 'T00:00:00').toLocaleDateString('es-VE')}, no hoy.
        </p>
      )}
      <div className="space-y-3">
        {aCuadrar.map((l) => (
          <div key={l.metodo} className="rounded-xl border border-neutral-200 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium text-sm">{l.metodo}</span>
              <span className="text-[11px] text-neutral-400">
                {l.fisico ? 'cuenta los billetes' : 'mira el lote o el banco'}
              </span>
            </div>
            <Numerico
              value={contados[l.metodo] ?? ''}
              onChange={(e) => setContados((c) => ({ ...c, [l.metodo]: e.target.value }))}
              placeholder={l.fisico ? 'Cuánto contaste' : 'Cuánto dice el banco'}
              className="mt-2 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
            {/* Destapado, queda DEBAJO del campo ya escrito: sirve para
                confirmar, no para copiar. */}
            {verEsperado && (
              <p className="mt-1.5 text-xs text-neutral-500 tabular-nums">
                El sistema dice {dinero(l.esperado)}
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
  )
}

/** El veredicto, forma de pago por forma de pago. */
function Veredicto({ cierre }: { cierre: CierreCaja }) {
  const cuadra = cierre.lineas.every((l) => Math.abs(l.diferencia) < 0.01)
  return (
    <div className="rounded-2xl border border-neutral-200 overflow-hidden">
      <div
        className={`px-3 py-2.5 text-sm font-medium ${
          cuadra ? 'bg-exito-50 text-exito-800' : 'bg-aviso-50 text-aviso-800'
        }`}
      >
        {cuadra
          ? 'Cuadró: todo lo contado coincide con el sistema.'
          : 'No cuadró. El descuadre queda asentado en los libros:'}
      </div>
      <div className="divide-y divide-neutral-100 bg-white">
        {cierre.lineas.map((l) => (
          <div key={l.cuenta + l.metodo} className="flex items-baseline justify-between gap-2 px-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="block font-medium truncate">{l.metodo || l.etiqueta}</span>
              <span className="block text-[11px] text-neutral-400 tabular-nums">
                sistema {dinero(l.esperado)} · contado {dinero(l.contado)}
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
                  ? `sobran ${dinero(l.diferencia)}`
                  : `faltan ${dinero(Math.abs(l.diferencia))}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Gastos y retiros.
 *
 * Los dos salen de la caja, y por eso hay que decir POR DONDE: si se cobro
 * 100 en efectivo y salieron 50 para una bombona, al contar tienen que
 * aparecer 50. Sin esa pregunta, el cierre siempre iba a dar faltante.
 *
 * NADA DE MERCANCIA. Un gasto no mueve inventario: para eso estan Compras e
 * Inventario, que si registran lo que entro al deposito y a que costo.
 */
function Movimientos({
  gastos,
  retiros,
  rango,
  alCambiar,
}: {
  gastos: Gasto[]
  retiros: RetiroPropietario[]
  rango: ReturnType<typeof useRango>[0]
  alCambiar: () => void
}) {
  const [tipo, setTipo] = useState<'gasto' | 'retiro'>('gasto')
  const [descripcion, setDescripcion] = useState('')
  const [categoria, setCategoria] = useState(CATEGORIAS_GASTO[0])
  const [monto, setMonto] = useState('')
  const [metodo, setMetodo] = useState(METODOS_PAGO[0])
  const [error, setError] = useState('')
  const dialogo = useDialogo()

  async function registrar() {
    const n = Number(monto.replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) return
    if (tipo === 'gasto' && !descripcion.trim()) return
    setError('')
    try {
      if (tipo === 'gasto') {
        await api.crearGasto(descripcion.trim(), categoria, n, metodo)
      } else {
        await api.crearRetiro(n, metodo, descripcion.trim())
      }
      setDescripcion('')
      setMonto('')
      alCambiar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar')
    }
  }

  async function borrarGasto(id: number) {
    if (!(await dialogo.confirmar({ titulo: '¿Borrar este gasto?', aceptar: 'Borrar', peligro: true })))
      return
    await api.eliminarGasto(id)
    alCambiar()
  }

  async function borrarRetiro(id: number) {
    if (!(await dialogo.confirmar({ titulo: '¿Borrar este retiro?', aceptar: 'Borrar', peligro: true })))
      return
    await api.eliminarRetiro(id)
    alCambiar()
  }

  const esGasto = tipo === 'gasto'

  return (
    <>
      <div className="bg-white rounded-2xl border border-neutral-200 p-4">
        <h2 className="font-semibold mb-1">Registrar</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Un <strong>gasto</strong> es algo que el negocio pagó (bombona, vasos, pitillos). Un{' '}
          <strong>retiro</strong> es plata que se lleva el dueño. Ninguno de los dos es mercancía:
          eso va por Compras, que sí mueve el inventario.
        </p>

        <div className="flex gap-2 mb-3">
          {(['gasto', 'retiro'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTipo(t)}
              className={`flex-1 rounded-xl py-2 text-sm font-medium border ${
                tipo === t
                  ? 'bg-neutral-900 text-white border-neutral-900'
                  : 'border-neutral-300 text-neutral-600'
              }`}
            >
              {t === 'gasto' ? 'Gasto' : 'Retiro del dueño'}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <input
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder={esGasto ? 'Ej. Bombona de gas' : 'Nota (opcional)'}
            className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            {esGasto && (
              <select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                className="border border-neutral-300 rounded-lg px-2 py-2 text-sm"
              >
                {CATEGORIAS_GASTO.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
            {/* POR DONDE sale la plata. Es lo que hace que el cierre cuadre:
                sin esto, un sueldo pagado por transferencia bajaba igual el
                efectivo esperado. */}
            <select
              value={metodo}
              onChange={(e) => setMetodo(e.target.value)}
              className="flex-1 min-w-[10rem] border border-neutral-300 rounded-lg px-2 py-2 text-sm"
              title="De dónde sale la plata"
            >
              {METODOS_PAGO.map((m) => (
                <option key={m} value={m}>
                  De {m}
                </option>
              ))}
            </select>
            <Numerico
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              placeholder="$"
              className="w-24 border border-neutral-300 rounded-lg px-2 py-2 text-sm"
            />
            <button
              onClick={registrar}
              className="bg-neutral-900 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              Registrar
            </button>
          </div>
        </div>
        {error && <p className="text-peligro-600 text-sm mt-2">{error}</p>}
      </div>

      <ListaMovimientos
        titulo="Gastos"
        etiqueta={etiquetaRango(rango)}
        filas={gastos.map((g) => ({
          id: g.id,
          fecha: g.fecha,
          texto: g.descripcion,
          detalle: `${g.categoria} · de ${g.metodo_pago}`,
          monto: g.monto,
          borrar: () => borrarGasto(g.id),
        }))}
      />
      <ListaMovimientos
        titulo="Retiros del dueño"
        etiqueta={etiquetaRango(rango)}
        filas={retiros.map((r) => ({
          id: r.id,
          fecha: r.fecha,
          texto: r.nota || 'Retiro',
          detalle: `de ${r.metodo_pago}`,
          monto: r.monto,
          borrar: () => borrarRetiro(r.id),
        }))}
      />
    </>
  )
}

type FilaMovimiento = {
  id: number
  fecha: string
  texto: string
  detalle: string
  monto: number
  borrar: () => void
}

function ListaMovimientos({
  titulo,
  etiqueta,
  filas,
}: {
  titulo: string
  etiqueta: string
  filas: FilaMovimiento[]
}) {
  const total = filas.reduce((s, f) => s + f.monto, 0)
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4">
      <div className="flex justify-between items-baseline mb-2">
        <h2 className="font-semibold">
          {titulo} <span className="text-neutral-400 font-normal text-sm">· {etiqueta}</span>
        </h2>
        <span className="font-bold tabular-nums">{dinero(total)}</span>
      </div>
      <div className="space-y-1">
        {filas.map((f) => (
          <div key={f.id} className="flex justify-between items-center gap-2 text-sm">
            <span className="min-w-0">
              <span className="text-xs text-neutral-400 tabular-nums mr-1.5">
                {new Date(f.fecha).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' })}
              </span>
              {f.texto}
              <span className="text-xs text-neutral-400"> ({f.detalle})</span>
            </span>
            <span className="flex items-center gap-2 shrink-0">
              <span className="font-medium tabular-nums">{dinero(f.monto)}</span>
              <button onClick={f.borrar} className="text-peligro-400 text-xs">
                x
              </button>
            </span>
          </div>
        ))}
        {filas.length === 0 && (
          <p className="text-neutral-400 text-sm">Nada en este período.</p>
        )}
      </div>
    </div>
  )
}


/**
 * Historial: TODO junto, en orden, en una sola pantalla.
 *
 * Tres listas separadas --una de cierres, otra de gastos, otra de retiros--
 * obligan a saltar entre pestañas para reconstruir un día: "el martes faltaron
 * 6, ¿por qué?" se responde mirando los gastos del martes, no los cierres.
 * Puestos en la misma línea de tiempo, la respuesta está una fila más abajo.
 *
 * El tipo se lee por el color y la palabra, y se puede filtrar con un toque.
 * Un cierre se despliega para ver qué pasó forma de pago por forma de pago.
 */
type Movimiento = {
  clave: string
  fecha: string
  tipo: 'cierre' | 'gasto' | 'retiro'
  texto: string
  detalle: string
  monto: number
  cierre?: CierreCaja
}

const ESTILO_TIPO = {
  cierre: { etiqueta: 'Cierre', clase: 'bg-neutral-900 text-white' },
  gasto: { etiqueta: 'Gasto', clase: 'bg-peligro-100 text-peligro-700' },
  retiro: { etiqueta: 'Retiro', clase: 'bg-aviso-100 text-aviso-700' },
} as const

function Historial({
  gastos,
  retiros,
  cierres,
  rango,
  alAnular,
}: {
  gastos: Gasto[]
  retiros: RetiroPropietario[]
  cierres: CierreCaja[]
  rango: ReturnType<typeof useRango>[0]
  alAnular: () => void
}) {
  const [filtro, setFiltro] = useState<'todo' | 'cierre' | 'gasto' | 'retiro'>('todo')
  const [abierto, setAbierto] = useState<number | null>(null)
  const dialogo = useDialogo()

  const movimientos: Movimiento[] = [
    ...cierres.map((c) => ({
      clave: `c${c.id}`,
      fecha: c.fecha,
      tipo: 'cierre' as const,
      texto: c.anulado ? 'Cierre anulado' : 'Cierre de caja',
      detalle: [c.operador, c.nota].filter(Boolean).join(' · ') || 'sin nota',
      monto: c.total_sistema,
      cierre: c,
    })),
    ...gastos.map((g) => ({
      clave: `g${g.id}`,
      fecha: g.fecha,
      tipo: 'gasto' as const,
      texto: g.descripcion,
      detalle: `${g.categoria} · de ${g.metodo_pago}`,
      monto: -g.monto,
    })),
    ...retiros.map((r) => ({
      clave: `r${r.id}`,
      fecha: r.fecha,
      tipo: 'retiro' as const,
      texto: r.nota || 'Retiro del dueño',
      detalle: `de ${r.metodo_pago}`,
      monto: -r.monto,
    })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha))

  const visibles = filtro === 'todo' ? movimientos : movimientos.filter((m) => m.tipo === filtro)

  const totalGastos = gastos.reduce((s, g) => s + g.monto, 0)
  const totalRetiros = retiros.reduce((s, r) => s + r.monto, 0)
  // El descuadre acumulado: lo que sobró menos lo que faltó en los cierres
  // que de verdad cuentan. Es el número que dice si la caja se lleva bien.
  const descuadre = cierres
    .filter((c) => !c.anulado)
    .reduce((s, c) => s + c.diferencia + c.divisas_diferencia, 0)

  async function anular(c: CierreCaja) {
    const motivo = await dialogo.pedirTexto({
      titulo: 'Anular este cierre',
      texto: 'El cierre no se borra: se revierte su diferencia y el día se puede volver a cerrar.',
      etiqueta: 'Por qué se anula (queda registrado)',
      aceptar: 'Anular cierre',
      peligro: true,
    })
    if (motivo === null) return
    await api.anularCierre(c.id, motivo)
    alAnular()
  }

  return (
    <>
      <div className="bg-white rounded-2xl border border-neutral-200 p-4">
        <h2 className="font-semibold mb-3">
          Historial <span className="text-neutral-400 font-normal text-sm">· {etiquetaRango(rango)}</span>
        </h2>
        <div className="grid grid-cols-3 gap-3">
          <Tile titulo="Gastos" valor={totalGastos} detalle={`${gastos.length} registro(s)`} tono={totalGastos > 0 ? 'malo' : 'apagado'} />
          <Tile titulo="Retiros" valor={totalRetiros} detalle={`${retiros.length} registro(s)`} tono={totalRetiros > 0 ? 'malo' : 'apagado'} />
          <Tile
            titulo="Descuadre"
            valor={descuadre}
            detalle={`${cierres.filter((c) => !c.anulado).length} cierre(s)`}
            tono={Math.abs(descuadre) >= 0.01 ? 'malo' : 'apagado'}
          />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200 p-4">
        <div className="flex flex-wrap gap-2 mb-3">
          {(['todo', 'cierre', 'gasto', 'retiro'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFiltro(t)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium border ${
                filtro === t
                  ? 'bg-neutral-900 text-white border-neutral-900'
                  : 'border-neutral-300 text-neutral-600'
              }`}
            >
              {t === 'todo'
                ? `Todo (${movimientos.length})`
                : `${ESTILO_TIPO[t].etiqueta}s (${movimientos.filter((m) => m.tipo === t).length})`}
            </button>
          ))}
        </div>

        <div className="divide-y divide-neutral-100">
          {visibles.map((m) => {
            const c = m.cierre
            const desplegado = c != null && abierto === c.id
            return (
              <div key={m.clave}>
                <div
                  className={`flex items-center gap-3 py-2.5 ${c ? 'cursor-pointer' : ''} ${
                    c?.anulado ? 'opacity-50' : ''
                  }`}
                  onClick={() => c && setAbierto(desplegado ? null : c.id)}
                >
                  <span className="text-xs text-neutral-400 tabular-nums w-14 shrink-0">
                    {new Date(m.fecha).toLocaleDateString('es-VE', {
                      day: '2-digit',
                      month: '2-digit',
                    })}
                  </span>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0 ${
                      ESTILO_TIPO[m.tipo].clase
                    }`}
                  >
                    {ESTILO_TIPO[m.tipo].etiqueta}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm truncate">{m.texto}</span>
                    <span className="block text-[11px] text-neutral-400 truncate">{m.detalle}</span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-sm font-medium tabular-nums">
                      {dinero(m.monto)}
                    </span>
                    {c && !c.anulado && (
                      <span
                        className={`block text-[11px] tabular-nums ${
                          Math.abs(c.diferencia + c.divisas_diferencia) < 0.01
                            ? 'text-exito-600'
                            : 'text-peligro-600'
                        }`}
                      >
                        {Math.abs(c.diferencia + c.divisas_diferencia) < 0.01
                          ? 'cuadró'
                          : `descuadre ${dinero(c.diferencia + c.divisas_diferencia)}`}
                      </span>
                    )}
                  </span>
                </div>

                {/* El cierre se abre y cuenta qué pasó en cada forma de pago.
                    Es la diferencia entre "faltaron 6" y "faltaron 6 en
                    efectivo, el resto cuadró". */}
                {desplegado && c && (
                  <div className="pb-3 pl-14 pr-1">
                    {c.anulado && (
                      <p className="text-xs text-peligro-600 mb-2">
                        Anulado{c.motivo_anulacion ? `: ${c.motivo_anulacion}` : ''}
                      </p>
                    )}
                    <div className="rounded-xl bg-neutral-50 divide-y divide-neutral-200">
                      {c.lineas.map((l) => (
                        <div key={l.cuenta + l.metodo} className="px-3 py-2 text-xs">
                          <div className="flex justify-between gap-2">
                            <span className="font-medium">{l.metodo || l.etiqueta}</span>
                            <span
                              className={`tabular-nums font-medium shrink-0 ${
                                Math.abs(l.diferencia) < 0.01
                                  ? 'text-exito-600'
                                  : 'text-peligro-600'
                              }`}
                            >
                              {Math.abs(l.diferencia) < 0.01 ? 'cuadra' : dinero(l.diferencia)}
                            </span>
                          </div>
                          <div className="tabular-nums text-neutral-400 mt-0.5">
                            sistema {dinero(l.esperado)} · contado {dinero(l.contado)}
                          </div>
                        </div>
                      ))}
                      {c.lineas.length === 0 && (
                        <p className="px-3 py-1.5 text-xs text-neutral-400">
                          Cierre viejo, sin detalle por forma de pago.
                        </p>
                      )}
                    </div>
                    {!c.anulado && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          anular(c)
                        }}
                        className="mt-2 text-xs font-medium text-peligro-500"
                      >
                        Anular este cierre
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {visibles.length === 0 && (
            <p className="text-neutral-400 text-sm py-4">Nada en este período.</p>
          )}
        </div>
      </div>
    </>
  )
}
