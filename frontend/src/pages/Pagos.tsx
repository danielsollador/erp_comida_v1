import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import { useSeccion } from '../components/Secciones'
import BarraFiltros from '../components/BarraFiltros'
import { useDialogo } from '../components/dialogo'
import { Aviso, Boton, Campo, Cifra, Modal, Pagina, Pastilla, Seccion, Selector, Vacio } from '../components/ui'
import { api } from '../lib/api'
import { etiquetaRango, useRango } from '../lib/fechas'
import { fmtBs, fmtNum, useMoneda } from '../lib/moneda'
import { METODOS_PAGO, necesitaReferencia, pedirReferencia } from '../lib/pagos'
import type { AnticipoPendiente, Frecuencia, NuevoPago, PagoFijo, PagoSinFactura, ResumenPagos } from '../lib/types'

/**
 * Pagos: lo que el negocio paga SIN factura.
 *
 * La nómina, los honorarios de un externo, el alquiler, un técnico. No es
 * Caja › Retiros de caja (eso es solo la plata que sale de la gaveta, para
 * que el cierre cuadre) ni Compras (con factura, o mercancía que entra al
 * inventario). Cada concepto va a su cuenta de gasto --así se sabe cuánto
 * cuesta la nómina al mes--, sin IVA porque no hay factura, y si se retiene
 * ISLR, lo retenido queda debiéndose al SENIAT. Si se paga en efectivo, el
 * cierre de caja del día ya lo descuenta solo.
 */
const SECCIONES = [
  { id: 'pagos', texto: 'Pagos' },
  { id: 'fijos', texto: 'Pagos fijos' },
]

// La clave es la del servidor (contabilidad.CUENTA_POR_CONCEPTO_PAGO).
const CONCEPTOS: { id: string; texto: string; ejemplo: string }[] = [
  { id: 'Sueldos', texto: 'Sueldos y nómina', ejemplo: 'Quincena de la cocinera' },
  { id: 'Honorarios', texto: 'Honorarios y servicios', ejemplo: 'Mensualidad del sistema, contador' },
  { id: 'Alquiler', texto: 'Alquiler', ejemplo: 'Local de octubre' },
  { id: 'Servicios publicos', texto: 'Servicios públicos', ejemplo: 'Luz, agua, internet' },
  { id: 'Mantenimiento', texto: 'Mantenimiento y reparaciones', ejemplo: 'Técnico de la nevera' },
  { id: 'Impuestos', texto: 'Impuestos y tasas municipales', ejemplo: 'Patente, aseo urbano' },
  { id: 'Anticipo', texto: 'Anticipo de sueldo', ejemplo: 'Adelanto a mitad de quincena' },
  { id: 'Otros', texto: 'Otros', ejemplo: '' },
]

// Lo que muchas veces SI trae factura con IVA (CANTV, Corpoelec, el
// arrendador que es empresa). Pagado aqui, ese IVA se pierde.
const SUELEN_TRAER_FACTURA = new Set(['Servicios publicos', 'Alquiler', 'Mantenimiento', 'Honorarios'])

/** Mismo criterio que el servidor: "José Pérez" y "jose perez" son uno. */
function clave(nombre: string) {
  return nombre.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}
const TEXTO_CONCEPTO = Object.fromEntries(CONCEPTOS.map((c) => [c.id, c.texto]))

const FRECUENCIAS: { id: Frecuencia; texto: string }[] = [
  { id: 'quincenal', texto: 'Cada quincena' },
  { id: 'mensual', texto: 'Cada mes' },
  { id: 'semanal', texto: 'Cada semana' },
]

const SOLO_DOLARES = new Set(['Efectivo $', 'Zelle'])

function dinero(n: number) {
  return `${n < 0 ? '−' : ''}$${fmtNum(Math.abs(n))}`
}

function fecha(s: string) {
  return new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function numero(s: string) {
  return Number(s.replace(/\./g, '').replace(',', '.'))
}

const VACIO: NuevoPago = {
  beneficiario: '',
  concepto: 'Sueldos',
  descripcion: '',
  monto: 0,
  moneda: 'USD',
  metodo_pago: 'Pago movil',
  referencia: '',
  retencion_islr_pct: 0,
}

export default function Pagos() {
  const [seccion, irA] = useSeccion(SECCIONES)
  const [rango, setRango] = useRango('30d')
  const [pagos, setPagos] = useState<PagoSinFactura[]>([])
  const [resumen, setResumen] = useState<ResumenPagos | null>(null)
  const [fijos, setFijos] = useState<PagoFijo[]>([])
  const [nombres, setNombres] = useState<string[]>([])
  const [anticipos, setAnticipos] = useState<AnticipoPendiente[]>([])
  const [pagadoFijo, setPagadoFijo] = useState('')
  const [error, setError] = useState('')

  function cargar() {
    setError('')
    api.listarPagos(rango).then(setPagos).catch((e) => setError(e.message))
    api.resumenPagos(rango).then(setResumen).catch(() => setResumen(null))
    api.listarPagosFijos().then(setFijos).catch(() => setFijos([]))
    api.beneficiarios().then(setNombres).catch(() => setNombres([]))
    api.anticipos().then(setAnticipos).catch(() => setAnticipos([]))
  }
  useEffect(cargar, [rango])

  const tocan = fijos.filter((f) => f.toca)

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Pagos" secciones={SECCIONES} seccion={seccion} alCambiarSeccion={irA} />
      <Pagina ancho="media">
        {seccion === 'pagos' && <BarraFiltros rango={rango} alCambiar={setRango} />}
        {error && <Aviso>{error}</Aviso>}
        <datalist id="beneficiarios">
          {nombres.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>

        {pagadoFijo && <Aviso tono="bien">{pagadoFijo}</Aviso>}
        {tocan.length > 0 && (
          <TocaPagar
            fijos={tocan}
            anticipos={anticipos}
            alPagar={(texto) => {
              setPagadoFijo(texto)
              cargar()
            }}
          />
        )}

        {seccion === 'pagos' && (
          <>
            {resumen && <Resumen r={resumen} etiqueta={etiquetaRango(rango)} alCambiar={cargar} />}
            <Formulario anticipos={anticipos} alGuardar={cargar} />
            <Lista pagos={pagos} etiqueta={etiquetaRango(rango)} alCambiar={cargar} />
          </>
        )}
        {seccion === 'fijos' && <Fijos fijos={fijos} alCambiar={cargar} />}
      </Pagina>
    </div>
  )
}

function Resumen({ r, etiqueta, alCambiar }: { r: ResumenPagos; etiqueta: string; alCambiar: () => void }) {
  const dialogo = useDialogo()
  const [aviso, setAviso] = useState('')
  const sueldos = r.por_concepto['Sueldos'] ?? 0

  // Lo retenido de ISLR es del SENIAT: se le paga con la planilla del mes.
  async function enterar() {
    setAviso('')
    const datos = await dialogo.pedir({
      titulo: 'Pagar al SENIAT el ISLR retenido',
      texto: `Hay ${dinero(r.islr_por_enterar)} retenidos. Anótalo cuando hagas el pago de la planilla.`,
      campos: [
        { nombre: 'monto', etiqueta: 'Monto ($)', tipo: 'numero', valor: r.islr_por_enterar },
        {
          nombre: 'metodo',
          etiqueta: 'Cómo se pagó',
          tipo: 'opciones',
          opciones: ['Transferencia', 'Pago movil', 'Efectivo Bs'].map((m) => ({ valor: m, texto: m })),
          valor: 'Transferencia',
        },
        { nombre: 'referencia', etiqueta: 'Referencia de la planilla o del pago', opcional: true },
      ],
      aceptar: 'Registrar pago',
    })
    if (!datos) return
    try {
      const res = await api.enterarIslr({
        monto: numero(String(datos.monto)) || undefined,
        metodo_pago: String(datos.metodo),
        referencia: String(datos.referencia ?? ''),
      })
      setAviso(`Pagados ${dinero(res.enterado)} al SENIAT.` + (res.queda > 0 ? ` Quedan ${dinero(res.queda)}.` : ''))
      alCambiar()
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'No se pudo registrar')
    }
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Cifra titulo="Pagado" valor={dinero(r.total)} detalle={etiqueta} />
        <Cifra titulo="Nómina" valor={dinero(sueldos)} detalle={etiqueta} />
        <Cifra
          titulo="Anticipos por descontar"
          valor={dinero(r.anticipos_pendientes)}
          detalle="se descuentan del próximo sueldo"
        />
        <Cifra
          titulo="ISLR retenido por enterar"
          valor={dinero(r.islr_por_enterar)}
          detalle="se le debe al SENIAT"
          tono={r.islr_por_enterar > 0 ? 'alerta' : 'normal'}
        />
      </div>
      {r.islr_por_enterar > 0 && (
        <div className="flex justify-end -mt-2">
          <Boton tono="suave" onClick={() => void enterar()}>
            Pagar al SENIAT
          </Boton>
        </div>
      )}
      {aviso && <Aviso tono="info">{aviso}</Aviso>}
    </>
  )
}

/** Los pagos fijos cuyo día ya llegó: se confirman con un toque. */
function TocaPagar({ fijos, anticipos, alPagar }: { fijos: PagoFijo[]; anticipos: AnticipoPendiente[]; alPagar: (texto: string) => void }) {
  const dialogo = useDialogo()
  const [error, setError] = useState('')
  async function pagar(f: PagoFijo) {
    setError('')
    const adelantado = f.concepto === 'Sueldos' ? anticipos.find((a) => clave(a.beneficiario) === clave(f.beneficiario))?.saldo ?? 0 : 0
    const monto = await dialogo.pedirTexto({
      titulo: `Pagar a ${f.beneficiario}`,
      etiqueta: `Monto (${f.moneda === 'Bs' ? 'Bs' : '$'})`,
      valor: String(f.monto),
      ayuda:
        'Cámbialo si este mes es distinto.' +
        (adelantado > 0 ? ` Se le descuentan ${dinero(adelantado)} que ya se le adelantaron.` : ''),
      aceptar: 'Seguir',
    })
    if (monto == null) return
    const referencia = await pedirReferencia(f.metodo_pago, dialogo.pedirTexto)
    if (referencia == null) return
    try {
      await api.pagarFijo(f.id, { monto: numero(monto) || undefined, referencia })
      alPagar(`Pagado a ${f.beneficiario}. El próximo queda para la fecha que le toca.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo pagar')
    }
  }
  return (
    <Seccion titulo="Toca pagar" ayuda="Pagos fijos cuyo día ya llegó. Nada se paga solo: confírmalo cuando lo hagas." plano>
      {error && <div className="px-4 pt-3"><Aviso>{error}</Aviso></div>}
      <ul className="divide-y divide-neutral-100">
        {fijos.map((f) => (
          <li key={f.id} className="px-4 sm:px-5 py-3 flex flex-wrap items-center gap-3 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{f.beneficiario}</span>
              <span className="block text-xs text-neutral-500">
                {TEXTO_CONCEPTO[f.concepto] ?? f.concepto} · tocaba el {fecha(f.proximo)} · por {f.metodo_pago}
              </span>
            </span>
            <span className="font-semibold tabular-nums">{f.moneda === 'Bs' ? fmtBs(f.monto) : dinero(f.monto)}</span>
            <Boton onClick={() => void pagar(f)}>Pagar</Boton>
          </li>
        ))}
      </ul>
    </Seccion>
  )
}

function CamposDePago({
  p,
  poner,
  conReferencia = true,
  adelantado = 0,
}: {
  p: NuevoPago
  poner: (k: keyof NuevoPago, v: string | number) => void
  conReferencia?: boolean
  /** Lo que se le adelanto a este beneficiario y falta por descontar. */
  adelantado?: number
}) {
  const concepto = CONCEPTOS.find((c) => c.id === p.concepto)
  const { tasa: delDia } = useMoneda()
  const [cualTasa, setCualTasa] = useState<'bcv' | 'eur' | 'paralelo' | 'otra'>('bcv')
  const [otraTasa, setOtraTasa] = useState('')
  const opcionesTasa = [
    { id: 'bcv', texto: 'BCV', valor: delDia?.bcv },
    { id: 'eur', texto: 'Euro BCV', valor: delDia?.eur },
    { id: 'paralelo', texto: 'Paralelo', valor: delDia?.paralelo },
  ] as const
  const tasaUsada = p.tasa || delDia?.bcv || 0
  function elegirTasa(id: typeof cualTasa, escrita = otraTasa) {
    setCualTasa(id)
    const elegida = id === 'otra' ? numero(escrita) : opcionesTasa.find((o) => o.id === id)?.valor
    // La BCV es lo que el servidor usa si no se le dice otra.
    poner('tasa', id === 'bcv' ? 0 : elegida || 0)
  }
  // El punto de venta solo cobra: no es de donde sale un pago.
  const deDondeSale = METODOS_PAGO.filter((m) => m !== 'Punto de venta')
  const metodos = p.moneda === 'Bs' ? deDondeSale.filter((m) => !SOLO_DOLARES.has(m)) : deDondeSale
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Campo
        etiqueta="A quién"
        list="beneficiarios"
        value={p.beneficiario}
        onChange={(e) => poner('beneficiario', e.target.value)}
        placeholder="Nombre de la persona o empresa"
      />
      <Selector etiqueta="Concepto" value={p.concepto} onChange={(e) => poner('concepto', e.target.value)}>
        {/* Un anticipo es un adelanto suelto: no se repite como pago fijo. */}
        {CONCEPTOS.filter((c) => conReferencia || c.id !== 'Anticipo').map((c) => (
          <option key={c.id} value={c.id}>
            {c.texto}
          </option>
        ))}
      </Selector>
      <Campo
        etiqueta="Detalle (opcional)"
        value={p.descripcion}
        onChange={(e) => poner('descripcion', e.target.value)}
        placeholder={concepto?.ejemplo ? `Ej. ${concepto.ejemplo}` : ''}
        className="sm:col-span-2"
      />
      <div>
        <span className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">Moneda</span>
        <div className="flex gap-2">
          {(['USD', 'Bs'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                poner('moneda', m)
                if (m === 'Bs' && SOLO_DOLARES.has(p.metodo_pago)) poner('metodo_pago', 'Pago movil')
              }}
              className={`flex-1 rounded-lg py-2 text-sm font-medium border ${
                p.moneda === m ? 'bg-neutral-900 text-white border-neutral-900' : 'border-neutral-300 text-neutral-600'
              }`}
            >
              {m === 'USD' ? 'Dólares' : 'Bolívares'}
            </button>
          ))}
        </div>
      </div>
      <Campo
        etiqueta={p.moneda === 'Bs' ? 'Monto (Bs)' : 'Monto ($)'}
        inputMode="decimal"
        value={p.monto ? String(p.monto) : ''}
        onChange={(e) => poner('monto', numero(e.target.value) || 0)}
        ayuda={p.moneda === 'Bs' && p.monto > 0 && tasaUsada > 0 ? `Son ${dinero(p.monto / tasaUsada)} a ${fmtNum(tasaUsada)} Bs por dólar.` : undefined}
      />
      {/* En un pago fijo se confirma la tasa del día que toca: aquí no se elige. */}
      {p.moneda === 'Bs' && conReferencia && (
        <Selector etiqueta="Tasa" value={cualTasa} onChange={(e) => elegirTasa(e.target.value as typeof cualTasa)}>
          {opcionesTasa.map((o) => (
            <option key={o.id} value={o.id} disabled={!o.valor}>
              {o.texto}
              {o.valor ? ` · ${fmtNum(o.valor)}` : ' · sin dato hoy'}
            </option>
          ))}
          <option value="otra">Otra (la escribo)</option>
        </Selector>
      )}
      {p.moneda === 'Bs' && conReferencia && cualTasa === 'otra' && (
        <Campo
          etiqueta="Bs por dólar"
          inputMode="decimal"
          value={otraTasa}
          onChange={(e) => {
            setOtraTasa(e.target.value)
            elegirTasa('otra', e.target.value)
          }}
        />
      )}
      <Selector etiqueta="De dónde salió" value={p.metodo_pago} onChange={(e) => poner('metodo_pago', e.target.value)}>
        {metodos.map((m) => (
          <option key={m}>{m}</option>
        ))}
      </Selector>
      {conReferencia && necesitaReferencia(p.metodo_pago) ? (
        <Campo etiqueta="Referencia" value={p.referencia} onChange={(e) => poner('referencia', e.target.value)} placeholder="Número de la operación" />
      ) : (
        <div />
      )}
      <Campo
        etiqueta="Retención ISLR (%)"
        inputMode="decimal"
        value={p.retencion_islr_pct ? String(p.retencion_islr_pct) : ''}
        onChange={(e) => poner('retencion_islr_pct', numero(e.target.value) || 0)}
        placeholder="0"
        ayuda="Solo si te toca retenerle (honorarios, por ejemplo). Pregúntale al contador el porcentaje."
      />
      {p.concepto === 'Sueldos' && adelantado > 0 && (
        <Campo
          etiqueta="Descontar anticipo ($)"
          inputMode="decimal"
          value={p.descontar_anticipo != null ? String(p.descontar_anticipo) : ''}
          onChange={(e) => poner('descontar_anticipo', numero(e.target.value) || 0)}
          ayuda={`Se le adelantaron ${dinero(adelantado)}. Lo que pongas aquí se resta de lo que se le entrega.`}
        />
      )}
      {SUELEN_TRAER_FACTURA.has(p.concepto) && (
        <p className="text-xs text-aviso-700 sm:col-span-2">
          ¿Te dieron factura con IVA (CANTV, Corpoelec, una empresa)? Cárgala en Compras como servicio: así recuperas el IVA. Aquí va solo lo que no tiene factura.
        </p>
      )}
    </div>
  )
}

function Formulario({ anticipos, alGuardar }: { anticipos: AnticipoPendiente[]; alGuardar: () => void }) {
  const [p, setP] = useState<NuevoPago>(VACIO)
  const adelantado = anticipos.find((a) => clave(a.beneficiario) === clave(p.beneficiario))?.saldo ?? 0
  // Por defecto se descuenta todo lo adelantado; se puede bajar a mano.
  const conDescuento: NuevoPago =
    p.concepto === 'Sueldos' && adelantado > 0 && p.descontar_anticipo == null ? { ...p, descontar_anticipo: adelantado } : p
  const [error, setError] = useState('')
  const [hecho, setHecho] = useState('')
  const poner = (k: keyof NuevoPago, v: string | number) => setP((x) => ({ ...x, [k]: v }))

  async function guardar() {
    setError('')
    setHecho('')
    if (!p.beneficiario.trim()) return setError('Falta a quién se le pagó.')
    if (!(p.monto > 0)) return setError('Falta el monto.')
    if (p.moneda === 'Bs' && p.tasa !== undefined && p.tasa !== 0 && !(p.tasa > 0)) return setError('Revisa la tasa.')
    if (necesitaReferencia(p.metodo_pago) && !p.referencia.trim()) return setError(`Un pago por ${p.metodo_pago} necesita su referencia.`)
    const datos = p.concepto === 'Sueldos' ? conDescuento : { ...p, descontar_anticipo: 0 }
    try {
      const r = await api.registrarPago({ ...datos, tasa: datos.moneda === 'Bs' && datos.tasa ? datos.tasa : undefined })
      setHecho(
        `Pago a ${r.beneficiario} registrado: ${dinero(r.monto)}` +
          (r.retencion_islr ? ` (${dinero(r.retencion_islr)} quedan retenidos de ISLR)` : '') +
          (r.anticipo_descontado ? ` (se descontaron ${dinero(r.anticipo_descontado)} de anticipo)` : '') +
          (r.neto !== r.monto ? `. Se le entregaron ${dinero(r.neto)}.` : '.'),
      )
      setP({ ...VACIO, concepto: p.concepto, metodo_pago: p.metodo_pago, moneda: p.moneda, tasa: p.tasa })
      alGuardar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar')
    }
  }

  return (
    <Seccion
      titulo="Registrar un pago"
      ayuda="Para lo que pagas sin factura. Mercancía sin factura va por Compras (mueve el inventario); lo que el dueño se lleva, por Caja › Retiros de caja."
    >
      <CamposDePago p={conDescuento} poner={poner} adelantado={adelantado} />
      {error && <div className="mt-3"><Aviso>{error}</Aviso></div>}
      {hecho && <div className="mt-3"><Aviso tono="bien">{hecho}</Aviso></div>}
      <div className="mt-4">
        <Boton ancho onClick={() => void guardar()}>
          Registrar pago
        </Boton>
      </div>
    </Seccion>
  )
}

function Lista({ pagos, etiqueta, alCambiar }: { pagos: PagoSinFactura[]; etiqueta: string; alCambiar: () => void }) {
  const dialogo = useDialogo()
  const [error, setError] = useState('')
  async function anular(p: PagoSinFactura) {
    const ok = await dialogo.confirmar({
      titulo: 'Anular este pago',
      texto: 'El gasto sale de los libros y la plata vuelve a donde estaba. Úsalo solo si el pago se anotó mal.',
      aceptar: 'Anular pago',
      peligro: true,
    })
    if (!ok) return
    try {
      await api.anularPago(p.id)
      alCambiar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo anular')
    }
  }
  return (
    <Seccion titulo={`Pagos · ${etiqueta}`} plano>
      {error && <div className="px-4 pt-3"><Aviso>{error}</Aviso></div>}
      {pagos.length === 0 ? (
        <Vacio icono="pagar" titulo="Sin pagos en este período" />
      ) : (
        <ul className="divide-y divide-neutral-100">
          {pagos.map((p) => (
            <li key={p.id} className={`px-4 sm:px-5 py-3 flex flex-wrap items-center gap-3 text-sm ${p.anulado ? 'opacity-50' : ''}`}>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{p.beneficiario}</span>{' '}
                <Pastilla>{TEXTO_CONCEPTO[p.concepto] ?? p.concepto}</Pastilla> {p.anulado && <Pastilla tono="mal">anulado</Pastilla>}
                <span className="block text-xs text-neutral-500">
                  {fecha(p.fecha)} · {p.metodo_pago}
                  {p.referencia && ` ref. ${p.referencia}`}
                  {p.descripcion && ` · ${p.descripcion}`}
                  {p.monto_bs != null && ` · ${fmtBs(p.monto_bs)} a ${fmtNum(p.tasa ?? 0)}`}
                  {p.retencion_islr > 0 && ` · ISLR retenido ${dinero(p.retencion_islr)}`}
                  {p.anticipo_descontado > 0 && ` · anticipo descontado ${dinero(p.anticipo_descontado)}`}
                </span>
              </span>
              <span className="font-semibold tabular-nums">{dinero(p.monto)}</span>
              {!p.anulado && (
                <button onClick={() => void anular(p)} className="text-xs underline text-neutral-500 hover:text-peligro-600">
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

function hoyISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function Fijos({ fijos, alCambiar }: { fijos: PagoFijo[]; alCambiar: () => void }) {
  const [editando, setEditando] = useState<(Partial<PagoFijo> & NuevoPago) | null>(null)
  return (
    <>
      <Seccion
        titulo="Pagos fijos"
        ayuda="La nómina, el alquiler, la mensualidad del sistema. El día que tocan aparecen arriba listos para confirmar."
        accion={
          <Boton
            tono="suave"
            icono="mas"
            onClick={() => setEditando({ ...VACIO, frecuencia: 'quincenal', proximo: hoyISO(), activo: true })}
          >
            Nuevo
          </Boton>
        }
        plano
      >
        {fijos.length === 0 ? (
          <Vacio icono="calendario" titulo="Sin pagos fijos" detalle="Crea la quincena de cada empleado o el alquiler y deja de anotarlos a mano cada vez." />
        ) : (
          <ul className="divide-y divide-neutral-100">
            {fijos.map((f) => (
              <li key={f.id} className={`px-4 sm:px-5 py-3 flex flex-wrap items-center gap-3 text-sm ${f.activo ? '' : 'opacity-50'}`}>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{f.beneficiario}</span> {f.toca && <Pastilla tono="ojo">toca pagar</Pastilla>}
                  {!f.activo && <Pastilla>pausado</Pastilla>}
                  <span className="block text-xs text-neutral-500">
                    {TEXTO_CONCEPTO[f.concepto] ?? f.concepto} · {FRECUENCIAS.find((x) => x.id === f.frecuencia)?.texto.toLowerCase()} · próximo {fecha(f.proximo)} · por {f.metodo_pago}
                  </span>
                </span>
                <span className="font-semibold tabular-nums">{f.moneda === 'Bs' ? fmtBs(f.monto) : dinero(f.monto)}</span>
                <button onClick={() => setEditando({ ...f, referencia: '' })} className="text-xs underline text-neutral-500">
                  Editar
                </button>
              </li>
            ))}
          </ul>
        )}
      </Seccion>
      {editando && (
        <EditarFijo
          inicial={editando}
          alCerrar={() => setEditando(null)}
          alGuardar={() => {
            setEditando(null)
            alCambiar()
          }}
        />
      )}
    </>
  )
}

function EditarFijo({
  inicial,
  alCerrar,
  alGuardar,
}: {
  inicial: Partial<PagoFijo> & NuevoPago
  alCerrar: () => void
  alGuardar: () => void
}) {
  const [p, setP] = useState(inicial)
  const [error, setError] = useState('')
  const poner = (k: string, v: string | number | boolean) => setP((x) => ({ ...x, [k]: v }))

  async function guardar() {
    setError('')
    if (!p.beneficiario.trim()) return setError('Falta a quién se le paga.')
    if (!(p.monto > 0)) return setError('Falta el monto.')
    try {
      await api.guardarPagoFijo(
        {
          beneficiario: p.beneficiario,
          concepto: p.concepto,
          descripcion: p.descripcion,
          monto: p.monto,
          moneda: p.moneda,
          metodo_pago: p.metodo_pago,
          retencion_islr_pct: p.retencion_islr_pct,
          frecuencia: p.frecuencia ?? 'mensual',
          proximo: p.proximo ?? hoyISO(),
          activo: p.activo ?? true,
        },
        p.id,
      )
      alGuardar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    }
  }

  return (
    <Modal
      titulo={p.id ? 'Editar pago fijo' : 'Nuevo pago fijo'}
      onCerrar={alCerrar}
      ancho="lg"
      pie={
        <Boton ancho onClick={() => void guardar()}>
          Guardar
        </Boton>
      }
    >
      <CamposDePago p={p} poner={poner} conReferencia={false} />
      <div className="grid gap-3 sm:grid-cols-2 mt-3">
        <Selector etiqueta="Cada cuánto" value={p.frecuencia} onChange={(e) => poner('frecuencia', e.target.value)}>
          {FRECUENCIAS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.texto}
            </option>
          ))}
        </Selector>
        <Campo etiqueta="Próximo pago" type="date" value={p.proximo} onChange={(e) => poner('proximo', e.target.value)} />
        {p.id != null && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={p.activo ?? true} onChange={(e) => poner('activo', e.target.checked)} />
            Activo (desmarca para pausarlo)
          </label>
        )}
      </div>
      {error && <div className="mt-3"><Aviso>{error}</Aviso></div>}
    </Modal>
  )
}
