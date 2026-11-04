import { useEffect, useRef, useState } from 'react'
import NavBar from '../components/NavBar'
import { useSeccion } from '../components/Secciones'
import { Tabla, Th, useBuscador, useOrden } from '../components/Tabla'
import { useDialogo } from '../components/dialogo'
import { Aviso, Boton, Campo, Cifra, Modal, Pagina, Pastilla, Seccion, Selector, Vacio } from '../components/ui'
import { api } from '../lib/api'
import { llano } from '../lib/filtros'
import { fmtBs, fmtNum, useMoneda } from '../lib/moneda'
import { EN_BOLIVARES, METODOS_PAGO, necesitaReferencia } from '../lib/pagos'
import type { CobroCliente, ResumenCxC, VentaPorCobrar } from '../lib/types'
import { claveDeReintento } from '../lib/uuid'

/**
 * Cuentas por cobrar: lo que se vendió a crédito y falta cobrar.
 *
 * Se busca al cliente, se marcan las ventas y se paga o se abona. No hace
 * falta crear nada antes: la venta a crédito ya trae el nombre (3-nov: con
 * fichas de cliente de por medio, sin clientes creados no se podía hacer nada).
 */
const SECCIONES = [
  { id: 'deben', texto: 'Quién me debe' },
  { id: 'cobros', texto: 'Cobros hechos' },
]

const redondear = (n: number) => Math.round(n * 100) / 100
const cuantasVentas = (n: number) => (n === 1 ? '1 venta' : `${n} ventas`)
const cuantosDias = (n: number) => (n === 0 ? 'hoy' : n === 1 ? 'hace 1 día' : `hace ${n} días`)

function dinero(n: number) {
  return `${n < 0 ? '−' : ''}$${fmtNum(Math.abs(n))}`
}

function fecha(s: string) {
  return new Date(s).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

export default function CuentasPorCobrar() {
  const [seccion, irA] = useSeccion(SECCIONES)
  const [resumen, setResumen] = useState<ResumenCxC | null>(null)
  const [cobros, setCobros] = useState<CobroCliente[]>([])
  const [error, setError] = useState('')

  function cargar() {
    setError('')
    api.resumenCxC().then(setResumen).catch((e) => setError(e.message))
    api.listarCobrosClientes().then(setCobros).catch(() => setCobros([]))
  }
  useEffect(cargar, [seccion])

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Cuentas por cobrar" secciones={SECCIONES} seccion={seccion} alCambiarSeccion={irA} />
      <Pagina ancho="media">
        {error && <Aviso>{error}</Aviso>}
        {seccion === 'deben' && resumen && <QuienDebe r={resumen} alCambiar={cargar} />}
        {seccion === 'cobros' && <Cobros cobros={cobros} alCambiar={cargar} />}
        {seccion === 'cobros' && resumen && resumen.dadas_de_baja.length > 0 && (
          <DadasDeBaja ventas={resumen.dadas_de_baja} alCambiar={cargar} />
        )}
      </Pagina>
    </div>
  )
}

function QuienDebe({ r, alCambiar }: { r: ResumenCxC; alCambiar: () => void }) {
  const dialogo = useDialogo()
  const [marcadas, setMarcadas] = useState<Set<number>>(new Set())
  const [pagando, setPagando] = useState(false)
  const [hecho, setHecho] = useState('')
  const [error, setError] = useState('')
  const orden = useOrden<VentaPorCobrar>(
    {
      cliente: (v) => v.cliente,
      venta: (v) => v.numero,
      fecha: (v) => new Date(v.fecha),
      saldo: (v) => v.saldo,
    },
    'fecha',
  )
  const buscador = useBuscador<VentaPorCobrar>((v) => [v.cliente], 'Buscar cliente')
  const filas = orden.ordenar(buscador.filtrar(r.ventas))
  const elegidas = r.ventas.filter((v) => marcadas.has(v.pedido_id))
  const total = redondear(elegidas.reduce((s, v) => s + v.saldo, 0))
  const todasVisibles = filas.length > 0 && filas.every((v) => marcadas.has(v.pedido_id))
  const clientes = new Set(r.ventas.map((v) => llano(v.cliente.trim()))).size

  function alternar(id: number) {
    const n = new Set(marcadas)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    setMarcadas(n)
    setHecho('')
  }

  function alternarVisibles() {
    const n = new Set(marcadas)
    for (const v of filas) {
      if (todasVisibles) n.delete(v.pedido_id)
      else n.add(v.pedido_id)
    }
    setMarcadas(n)
    setHecho('')
  }

  async function pagarOAbonar() {
    setError('')
    const nombres = new Set(elegidas.map((v) => llano(v.cliente.trim())))
    if (nombres.size > 1) {
      const ok = await dialogo.confirmar({
        titulo: 'Marcaste ventas de varios clientes',
        texto: `Son ${nombres.size} nombres distintos. Sigue solo si las paga la misma persona; si no, cóbralas por separado.`,
        aceptar: 'Las paga la misma persona',
        cancelar: 'Revisar',
      })
      if (!ok) return
    }
    setPagando(true)
  }

  async function darDeBaja() {
    setError('')
    const motivo = await dialogo.pedirTexto({
      titulo: `Dar de baja ${cuantasVentas(elegidas.length)}`,
      texto: `Los ${dinero(total)} dejan de deberse y pasan a gasto (incobrables). La venta no se toca. Si al final pagan, se recupera en «Cobros hechos».`,
      etiqueta: 'Por qué',
      placeholder: 'Ej. El cliente no va a pagar',
      aceptar: 'Dar de baja',
      peligro: true,
    })
    if (motivo == null) return
    const hechas: number[] = []
    try {
      for (const v of elegidas) {
        await api.darPorPerdida(v.pedido_id, motivo)
        hechas.push(v.pedido_id)
      }
      setHecho(`${hechas.length === 1 ? '1 venta dada' : `${hechas.length} ventas dadas`} de baja por ${dinero(total)}.`)
    } catch (e) {
      const texto = e instanceof Error ? e.message : 'No se pudo dar de baja'
      setError(hechas.length ? `Se dieron de baja ${hechas.length} de ${elegidas.length}. ${texto}` : texto)
    }
    setMarcadas(new Set())
    alCambiar()
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Cifra titulo="Por cobrar" valor={dinero(r.total)} detalle={cuantasVentas(r.ventas.length)} />
        <Cifra titulo="Clientes que deben" valor={String(clientes)} />
      </div>

      {hecho && <Aviso tono="bien">{hecho}</Aviso>}
      {error && <Aviso>{error}</Aviso>}

      {r.ventas.length === 0 ? (
        <Vacio icono="cobrar" titulo="Nadie te debe" detalle="Lo que vendas con «A crédito» en el punto de venta aparece aquí." />
      ) : (
        <Tabla orden={orden} buscador={buscador} glosario="cobranzas" className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-500/8 text-neutral-500 text-xs uppercase">
              <tr>
                <th className="p-3 w-10">
                  <input type="checkbox" aria-label="Marcar todas las que se ven" checked={todasVisibles} onChange={alternarVisibles} />
                </th>
                <Th clave="cliente">Cliente</Th>
                <Th clave="venta">Venta</Th>
                <Th clave="fecha">Fecha</Th>
                <Th clave="saldo" alinear="derecha">Debe</Th>
              </tr>
            </thead>
            <tbody>
              {filas.map((v) => (
                <tr
                  key={v.pedido_id}
                  onClick={() => alternar(v.pedido_id)}
                  className={`border-t border-neutral-100 cursor-pointer ${marcadas.has(v.pedido_id) ? 'bg-acento-500/10' : 'hover:bg-neutral-50'}`}
                >
                  <td className="p-3">
                    <input
                      type="checkbox"
                      aria-label={`Marcar la venta #${v.numero} de ${v.cliente}`}
                      checked={marcadas.has(v.pedido_id)}
                      onChange={() => alternar(v.pedido_id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className="p-3 font-medium">{v.cliente}</td>
                  <td className="p-3">
                    #{v.numero}
                    {v.abonado > 0 && <span className="block text-xs text-neutral-500">abonó {dinero(v.abonado)}</span>}
                  </td>
                  <td className="p-3 tabular-nums">
                    {fecha(v.fecha)}
                    <span className="block text-xs text-neutral-500">{cuantosDias(v.dias)}</span>
                  </td>
                  <td className="p-3 text-right font-semibold tabular-nums">{dinero(v.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tabla>
      )}

      {elegidas.length > 0 && (
        <div className="sticky bottom-0 sm:bottom-3 z-20 vp-menu -mx-4 sm:mx-0 max-sm:!rounded-none px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:py-3 flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[140px]">
            <div className="text-xs text-neutral-500">{cuantasVentas(elegidas.length)}</div>
            <div className="text-xl font-bold tabular-nums">{dinero(total)}</div>
          </div>
          <Boton tono="suave" onClick={() => void darDeBaja()}>
            Dar de baja
          </Boton>
          <Boton onClick={() => void pagarOAbonar()}>Pagar o abonar</Boton>
        </div>
      )}

      {pagando && (
        <PagarOAbonar
          ventas={elegidas}
          alCerrar={() => setPagando(false)}
          alHecho={(texto) => {
            setPagando(false)
            setHecho(texto)
            setMarcadas(new Set())
            alCambiar()
          }}
        />
      )}
    </>
  )
}

/**
 * Lo que sigue después de marcar. El monto dice qué pasa: igual a lo que se
 * debe, se paga; menos, se abona de la más vieja a la más nueva (o se cierra
 * si la diferencia es comisión); más, lo de más es otro ingreso.
 */
function PagarOAbonar({ ventas, alCerrar, alHecho }: { ventas: VentaPorCobrar[]; alCerrar: () => void; alHecho: (texto: string) => void }) {
  const dialogo = useDialogo()
  const { tasa } = useMoneda()
  const bcv = tasa?.bcv ?? 0
  const [metodo, setMetodo] = useState('Efectivo $')
  const [referencia, setReferencia] = useState('')
  const [montoTexto, setMontoTexto] = useState('')
  const [loQueFalta, setLoQueFalta] = useState<'abono' | 'cerrar'>('abono')
  const [retencion, setRetencion] = useState(0)
  const [nota, setNota] = useState('')
  const [error, setError] = useState('')
  const [enviando, setEnviando] = useState(false)
  const claves = useRef(claveDeReintento())

  const total = redondear(ventas.reduce((s, v) => s + v.saldo, 0))
  const facturadas = ventas.filter((v) => v.facturado)
  // El IVA que retiene el contribuyente especial, aproximado (16 % incluido en
  // el precio). El exacto lo calcula el servidor con la tasa de cada factura.
  const retenido = redondear(facturadas.reduce((s, v) => s + (v.original * 16) / 116, 0) * (retencion / 100))
  const esperado = redondear(total - retenido)
  const enBs = EN_BOLIVARES.has(metodo) && bcv > 0
  const esperadoBs = redondear(esperado * bcv)

  const tecleado = Number(montoTexto.replace(',', '.'))
  let recibido = esperado
  if (montoTexto.trim() !== '') {
    recibido = enBs ? (Math.abs(tecleado - esperadoBs) <= 0.01 ? esperado : redondear(tecleado / bcv)) : tecleado
  }
  const falta = Number.isFinite(recibido) ? redondear(esperado - recibido) : 0
  const cierra = falta <= 0 || retencion > 0 || loQueFalta === 'cerrar'

  async function confirmar() {
    setError('')
    if (!Number.isFinite(recibido) || recibido <= 0) return setError('Pon cuánto pagó.')
    if (necesitaReferencia(metodo) && !referencia.trim()) return setError(`Un pago por ${metodo} necesita su referencia.`)
    if (falta < 0) {
      const ok = await dialogo.confirmar({
        titulo: 'Pagó más de lo que debe',
        texto: `Se debían ${dinero(esperado)} y entraron ${dinero(recibido)}. Los ${dinero(-falta)} de más quedan como otro ingreso. ¿Es así?`,
        aceptar: 'Sí, es así',
        cancelar: 'Corregir',
      })
      if (!ok) return
    }
    setEnviando(true)
    const pedido_ids = ventas.map((v) => v.pedido_id)
    const clave_cliente = claves.current.para(JSON.stringify([pedido_ids, metodo, recibido, cierra, retencion, referencia.trim()]))
    try {
      if (cierra) {
        const fichas = new Set(ventas.map((v) => v.cliente_id))
        const r = await api.cobrarVentas({
          cliente_id: fichas.size === 1 ? [...fichas][0] : null,
          pedido_ids,
          metodo_pago: metodo,
          referencia: referencia.trim(),
          recibido,
          retencion_iva_pct: retencion || null,
          nota: nota.trim(),
          clave_cliente,
        })
        alHecho(
          `Cobrado: ${cuantasVentas(ventas.length)}, entraron ${dinero(r.recibido)}` +
            (r.comision ? `, ${dinero(r.comision)} quedó como comisión` : '') +
            (r.retencion_iva ? `, ${dinero(r.retencion_iva)} de IVA retenido (falta cargar el comprobante en Impuestos)` : '') +
            (r.excedente ? `, ${dinero(r.excedente)} de más como otro ingreso` : '') +
            '.',
        )
      } else {
        const r = await api.abonarVentas({ pedido_ids, monto: recibido, metodo_pago: metodo, referencia: referencia.trim(), nota: nota.trim(), clave_cliente })
        alHecho(`Abono de ${dinero(r.monto)} registrado. Quedan ${dinero(redondear(total - r.monto))} por cobrar de esas ventas.`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar')
      setEnviando(false)
    }
  }

  const textoBoton = !cierra ? `Abonar ${dinero(recibido)}` : falta > 0 ? `Cobrar ${dinero(recibido)} y cerrar` : `Pagar ${dinero(recibido)}`

  return (
    <Modal
      titulo="Pagar o abonar"
      ayuda={`${cuantasVentas(ventas.length)} por ${dinero(total)}. Si paga menos, queda debiendo el resto.`}
      onCerrar={alCerrar}
      pie={
        <Boton ancho onClick={() => void confirmar()} disabled={enviando}>
          {textoBoton}
        </Boton>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Selector
          etiqueta="Cómo pagó"
          value={metodo}
          onChange={(e) => {
            setMetodo(e.target.value)
            setMontoTexto('')
          }}
        >
          {METODOS_PAGO.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </Selector>
        <Campo
          etiqueta={enBs ? 'Cuánto pagó (Bs)' : 'Cuánto pagó ($)'}
          inputMode="decimal"
          value={montoTexto}
          placeholder={fmtNum(enBs ? esperadoBs : esperado)}
          onChange={(e) => setMontoTexto(e.target.value)}
          ayuda={enBs ? `Son ${dinero(Number.isFinite(recibido) ? recibido : 0)} a ${fmtNum(bcv)} Bs por dólar. Se deben ${fmtBs(esperadoBs)}.` : 'Vacío = paga todo lo marcado.'}
        />
        {necesitaReferencia(metodo) && (
          <Campo etiqueta="Referencia" value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Número de la operación" />
        )}
        {facturadas.length > 0 && (
          <Selector etiqueta="¿Retuvo IVA?" value={String(retencion)} onChange={(e) => setRetencion(Number(e.target.value))}>
            <option value="0">No retuvo</option>
            <option value="75">Retuvo el 75 %</option>
            <option value="100">Retuvo el 100 %</option>
          </Selector>
        )}
        <Campo etiqueta="Nota (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ej. semana del 19 al 25" />
        {falta > 0 && retencion === 0 && (
          <Selector
            etiqueta={`¿Qué pasa con los ${dinero(falta)} que faltan?`}
            value={loQueFalta}
            onChange={(e) => setLoQueFalta(e.target.value as 'abono' | 'cerrar')}
          >
            <option value="abono">Quedan debiendo</option>
            <option value="cerrar">No se cobran: son comisión o descuento, se cierra la deuda</option>
          </Selector>
        )}
      </div>
      {retenido > 0 && (
        <p className="mt-3 text-xs text-neutral-500">
          IVA retenido ≈ {dinero(retenido)} (el exacto sale de cada factura). No entra al banco: se descuenta del IVA a pagar.
        </p>
      )}
      {error && <div className="mt-3"><Aviso>{error}</Aviso></div>}
    </Modal>
  )
}

function DadasDeBaja({ ventas, alCambiar }: { ventas: VentaPorCobrar[]; alCambiar: () => void }) {
  const [error, setError] = useState('')
  async function recuperar(v: VentaPorCobrar) {
    setError('')
    try {
      await api.recuperarPerdida(v.pedido_id)
      alCambiar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo recuperar')
    }
  }
  return (
    <Seccion titulo="Dadas de baja" ayuda="Dejaron de deberse y pasaron a gasto. Si al final pagan, recupéralas y vuelven a la lista." plano>
      {error && <div className="px-4 pt-3"><Aviso>{error}</Aviso></div>}
      <ul className="divide-y divide-neutral-100">
        {ventas.map((v) => (
          <li key={v.pedido_id} className="px-4 sm:px-5 py-3 flex flex-wrap items-center gap-3 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{v.cliente}</span>
              <span className="block text-xs text-neutral-500">Venta #{v.numero} · {fecha(v.fecha)}</span>
            </span>
            <span className="font-semibold tabular-nums">{dinero(v.saldo)}</span>
            <button onClick={() => void recuperar(v)} className="text-xs underline text-neutral-500 hover:text-neutral-900">
              Recuperar
            </button>
          </li>
        ))}
      </ul>
    </Seccion>
  )
}

function Cobros({ cobros, alCambiar }: { cobros: CobroCliente[]; alCambiar: () => void }) {
  const dialogo = useDialogo()
  const [error, setError] = useState('')
  async function anular(c: CobroCliente) {
    const ok = await dialogo.confirmar({
      titulo: 'Anular este cobro',
      texto: `${c.ventas.length === 1 ? 'La venta vuelve' : `Las ${c.ventas.length} ventas vuelven`} a deberse y el asiento se reversa. Úsalo solo si el cobro se anotó mal.`,
      aceptar: 'Anular cobro',
      peligro: true,
    })
    if (!ok) return
    try {
      await api.anularCobroCliente(c.id)
      alCambiar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo anular')
    }
  }
  return (
    <Seccion titulo="Cobros hechos" ayuda="Lo que se ha cobrado desde aquí. Si uno se anotó mal, anúlalo y las ventas vuelven a deberse." plano>
      {error && <div className="px-4 pt-3"><Aviso>{error}</Aviso></div>}
      {cobros.length === 0 ? (
        <Vacio icono="cobrar" titulo="Todavía no hay cobros" />
      ) : (
        <ul className="divide-y divide-neutral-100">
          {cobros.map((c) => (
            <li key={c.id} className={`px-4 sm:px-5 py-3 flex flex-wrap items-center gap-3 text-sm ${c.anulado ? 'opacity-50' : ''}`}>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{c.cliente || 'Sin nombre'}</span> {c.anulado && <Pastilla tono="mal">anulado</Pastilla>}
                <span className="block text-xs text-neutral-500">
                  {fecha(c.fecha)} · {c.metodo_pago}
                  {c.referencia && ` ref. ${c.referencia}`}
                  {c.ventas.length > 0 && ` · ${c.ventas.length === 1 ? '1 venta' : `${c.ventas.length} ventas`}`}
                  {c.comision > 0 && ` · comisión ${dinero(c.comision)}`}
                  {c.retencion_iva > 0 && ` · IVA retenido ${dinero(c.retencion_iva)}`}
                  {c.excedente > 0 && ` · de más ${dinero(c.excedente)}`}
                  {c.nota && ` · ${c.nota}`}
                </span>
              </span>
              <span className="text-right tabular-nums">
                <strong>{dinero(c.recibido)}</strong>
                <span className="block text-xs text-neutral-500">de {dinero(c.monto)}</span>
              </span>
              {!c.anulado && (
                <button onClick={() => void anular(c)} className="text-xs underline text-neutral-500 hover:text-peligro-600">
                  Anular
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Seccion>
  )
}
