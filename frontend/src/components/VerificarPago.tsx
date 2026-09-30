import { useState } from 'react'
import { api } from '../lib/api'
import { fmtBs } from '../lib/moneda'
import type { EstadoPabilo, VerificacionPago } from '../lib/types'
import { Numerico } from './Teclado'

/**
 * Lo que devuelve el paso de pago movil: la referencia y, si el banco la
 * confirmo, el id de esa consulta para que el cobro quede pegado a ella.
 * Sin `verificacion_id` es una referencia anotada a mano, como siempre.
 *
 * `monto_usd` es lo que el banco dijo que ENTRO, pasado a dolares a la tasa
 * del cobro SIN redondear a centavos (Bs 0,18 son $0,0002: redondeado, la
 * diferencia desaparecia), y `decision` que hacer con la diferencia contra
 * la cuenta. NUNCA se decide sola: cualquier diferencia de un centimo para
 * arriba la decide la cajera (Leider, 30-sep: "si me redondean de menos,
 * igual confirma el pago y no pasa mas nada").
 *
 *   exacto    entro exactamente la cuenta: se cobra.
 *   propina   entro de mas: lo que sobra se suma a la propina, y se dice.
 *   otro_pago entro de menos: lo que falta se cobra con OTRO pago movil.
 *   resto     entro de menos: lo que falta se cobra con otra forma (pago
 *             partido).
 *   perdonar  entro de menos y el local lo deja pasar: descuento.
 */
export type PagoVerificado = {
  referencia: string
  verificacion_id?: number
  monto_usd?: number
  /** Lo que entro, en bolivares, tal cual lo dijo el banco. */
  monto_bs?: number
  decision?: 'exacto' | 'propina' | 'otro_pago' | 'resto' | 'perdonar'
}

const redondear = (n: number) => Math.round(n * 100) / 100

/** Bs con coma decimal, como se escribe en Venezuela: 1.650,00 → "1650,00". */
const enBs = (n: number) => n.toFixed(2).replace('.', ',')

/** Lo que tecleo la cajera: acepta "1650,50", "1.650,50" y "1650.50". */
function leerBs(texto: string): number {
  const t = String(texto).trim()
  const limpio = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  return Number(limpio)
}

/**
 * El paso de cobrar por pago movil o transferencia cuando el local tiene
 * Pabilo: se escribe la referencia, se le pregunta al banco y se cobra con la
 * respuesta a la vista.
 *
 * NUNCA BLOQUEA EL COBRO. Si el banco no responde, si se acabaron los
 * creditos o si la referencia no aparece todavia, "Cobrar sin verificar"
 * hace exactamente lo que hacia el ERP antes: anota la referencia y cobra.
 * Lo unico que se cierra es cobrar con una referencia que YA cobro otro
 * pedido de este local: ahi no hay nada que anotar, hay que pedir otro
 * comprobante.
 *
 * EL MONTO SE PUEDE CORREGIR antes de consultar. La gente redondea al
 * escribir en su banco --Bs 1.700 por una cuenta de Bs 1.650-- y el cliente
 * dice "te mande mil setecientos". La cajera lo escribe tal cual, el banco
 * confirma que eso entro, y con las dos cifras delante decide: lo que sobra
 * es propina; lo que falta se cobra con otra forma o se perdona (Leider,
 * 29-sep).
 *
 * Vive dentro del cuadro de cobro, en el lugar de los botones de forma de
 * pago, igual que el paso del efectivo con vuelto: un solo cuadro, un paso a
 * la vez.
 */
export default function VerificarPago({
  metodo,
  montoUsd,
  tasa,
  estado,
  pedidoId,
  enMixto = false,
  onListo,
  onCancelar,
}: {
  metodo: string
  /** Lo que la cuenta pide (o esta parte, en pago partido), en dolares. */
  montoUsd: number
  /** Bs por dolar. 0 = sin tasa cargada. */
  tasa: number
  estado: EstadoPabilo
  pedidoId?: number
  /** Dentro de un pago partido: lo que falte sigue en la misma pantalla. */
  enMixto?: boolean
  onListo: (pago: PagoVerificado) => void
  onCancelar: () => void
}) {
  const montoBs = tasa > 0 ? redondear(montoUsd * tasa) : null
  // A cual de las cuentas del local le pagaron. Arranca en la principal; si
  // el local tiene dos bancos, se pregunta.
  const [cuentaId, setCuentaId] = useState(estado.cuenta_id)
  const varias = estado.cuentas.length > 1
  const cuenta = estado.cuentas.find((c) => c.id === cuentaId)
  const nombreCuenta = cuenta ? cuenta.descripcion || cuenta.banco : estado.cuenta
  const [referencia, setReferencia] = useState('')
  // Lo que el cliente dice que mando. Arranca en la cuenta exacta.
  const [montoTexto, setMontoTexto] = useState(montoBs !== null ? enBs(montoBs) : '')
  const [telefono, setTelefono] = useState('')
  const [cedula, setCedula] = useState('')
  const [bancoOrigen, setBancoOrigen] = useState('')
  const [consultando, setConsultando] = useState(false)
  const [resultado, setResultado] = useState<VerificacionPago | null>(null)
  const [error, setError] = useState('')

  const pideTelefono = estado.campos.includes('PHONE_ORIGIN')
  const pideCedula = estado.campos.includes('DNI_ORIGIN')
  const pideBanco = estado.campos.includes('BANK_CODE_ORIGIN')
  const limpia = referencia.replace(/[^0-9a-zA-Z]/g, '')
  const montoEscrito = leerBs(montoTexto)
  const montoValido = montoBs === null || (Number.isFinite(montoEscrito) && montoEscrito > 0)
  const corregido = montoBs !== null && montoValido && Math.abs(montoEscrito - montoBs) > 0.005
  const puedeConsultar =
    limpia.length >= 4 &&
    !consultando &&
    montoValido &&
    (!pideTelefono || telefono.replace(/\D/g, '').length >= 10) &&
    (!pideCedula || cedula.replace(/\D/g, '').length >= 5) &&
    (!pideBanco || bancoOrigen.replace(/\D/g, '').length === 4)

  async function consultar() {
    if (!puedeConsultar) return
    setConsultando(true)
    setError('')
    try {
      const r = await api.verificarPago({
        referencia: limpia,
        monto_usd: montoUsd,
        monto_bs: corregido ? redondear(montoEscrito) : undefined,
        user_bank_id: varias ? cuentaId : undefined,
        metodo,
        pedido_id: pedidoId,
        telefono: pideTelefono ? telefono : undefined,
        cedula: pideCedula ? cedula : undefined,
        banco_origen: pideBanco ? bancoOrigen : undefined,
      })
      setResultado(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo consultar al banco.')
    } finally {
      setConsultando(false)
    }
  }

  function corregir() {
    setResultado(null)
    setError('')
  }

  const sinVerificar = () => onListo({ referencia: limpia })

  return (
    <div className="mt-3 mb-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{metodo}</span>
        <button type="button" onClick={onCancelar} className="text-sm text-neutral-500 hover:text-neutral-800">
          Cambiar forma de pago
        </button>
      </div>

      {!resultado ? (
        <>
          {/* Con dos bancos, lo primero es a cual le pagaron: contra ese se
              pregunta. Con uno solo no hay nada que elegir. */}
          {varias && (
            <div>
              <span className="block text-xs text-neutral-500 mb-1">¿A qué cuenta pagó?</span>
              <div className="vp-segmentado inline-flex w-full items-center gap-1 rounded-full p-1">
                {estado.cuentas.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCuentaId(c.id)}
                    aria-pressed={c.id === cuentaId}
                    className={`vp-seccion flex-1 min-w-0 truncate px-3 py-1.5 rounded-full text-sm ${
                      c.id === cuentaId
                        ? 'vp-segmento-elegido bg-neutral-900 text-white font-semibold'
                        : 'text-neutral-600 font-medium hover:text-neutral-900'
                    }`}
                  >
                    {c.descripcion || c.banco}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Lo que tiene que haber entrado al banco, en la moneda en que el
              cliente lo ve en su telefono. Es la cifra que se coteja, y se
              puede corregir con lo que el cliente diga que mando. */}
          {montoBs !== null ? (
            <label className="block text-xs text-neutral-500">
              {nombreCuenta ? `Monto que entró a ${nombreCuenta}` : 'Monto que mandó'}
              {/* Un campo que se ve como campo: borde, y el "Bs" dentro para
                  que no quede duda de la moneda. La cifra viene puesta con la
                  cuenta a la tasa, y se corrige encima si el cliente redondeo
                  (Leider, 29-sep: "no queda claro que ese numero es
                  editable"). Coma decimal, como se escribe aqui. */}
              <span className="relative block mt-1">
                <span
                  aria-hidden
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-neutral-500 select-none"
                >
                  Bs
                </span>
                <Numerico
                  value={montoTexto}
                  onChange={(e) => setMontoTexto(e.target.value)}
                  placeholder={enBs(montoBs)}
                  etiqueta="Monto en Bs"
                  className={`w-full border rounded-lg pl-10 pr-3 py-2.5 font-display text-xl font-semibold tabular-nums tracking-tight text-neutral-900 ${
                    !montoValido ? 'border-peligro-400' : 'border-neutral-300'
                  }`}
                />
              </span>
              <span className="block mt-1 text-[11px] text-neutral-400 tabular-nums">
                {corregido ? (
                  <>
                    La cuenta es {fmtBs(montoBs)}. Si entró más, lo que sobra se suma a la propina; si entró
                    menos, eliges cómo se cobra lo que falta.
                  </>
                ) : (
                  <>Es la cuenta a la tasa del día. Si el cliente mandó otra cantidad, tócalo y escribe lo que mandó.</>
                )}
              </span>
            </label>
          ) : (
            <>
              <div className="vp-control rounded-xl px-4 py-3 flex items-baseline justify-between gap-3">
                <span className="text-sm text-neutral-500">Debe haber entrado</span>
                <span className="font-display text-xl font-semibold tabular-nums tracking-tight">
                  ${montoUsd.toFixed(2)}
                </span>
              </div>
              <p className="text-xs text-aviso-700">
                Sin tasa de cambio cargada: el banco dirá cuánto entró, pero no se puede comparar solo.
              </p>
            </>
          )}
          <label className="block text-xs text-neutral-500">
            Referencia del pago
            <Numerico
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              entero
              autoFocus
              placeholder="Los dígitos que muestra el banco"
              etiqueta="Referencia"
              className="w-full border border-neutral-300 rounded-lg px-3 py-2.5 mt-1 text-lg font-semibold tracking-wide text-neutral-900"
            />
          </label>
          {pideTelefono && (
            <label className="block text-xs text-neutral-500">
              Teléfono del que pagó
              <Numerico
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                entero
                placeholder="04141234567"
                etiqueta="Teléfono"
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 mt-1 text-sm text-neutral-900"
              />
            </label>
          )}
          {pideCedula && (
            <label className="block text-xs text-neutral-500">
              Cédula del que pagó
              <input
                value={cedula}
                onChange={(e) => setCedula(e.target.value)}
                placeholder="V-12345678"
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 mt-1 text-sm text-neutral-900"
              />
            </label>
          )}
          {pideBanco && (
            <label className="block text-xs text-neutral-500">
              Banco del que pagó (código de 4 dígitos)
              <Numerico
                value={bancoOrigen}
                onChange={(e) => setBancoOrigen(e.target.value)}
                entero
                placeholder="0102"
                etiqueta="Banco"
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 mt-1 text-sm text-neutral-900"
              />
            </label>
          )}
          {error && <p className="text-sm text-peligro-600">{error}</p>}
          <button
            type="button"
            onClick={consultar}
            disabled={!puedeConsultar}
            className="vp-pulsable w-full rounded-xl bg-neutral-900 py-3.5 text-sm font-semibold text-white disabled:opacity-30"
          >
            {consultando ? 'Consultando al banco…' : 'Verificar con el banco'}
          </button>
          {/* Chico y abajo: existe para cuando el banco no responde, no
              para saltarse la verificacion por costumbre. */}
          <button
            type="button"
            onClick={sinVerificar}
            disabled={limpia.length < 4 || consultando}
            className="w-full text-xs text-neutral-500 hover:text-neutral-800 py-1 disabled:opacity-30"
          >
            Cobrar sin verificar
          </button>
        </>
      ) : (
        <Resultado
          r={resultado}
          metodo={metodo}
          cuentaUsd={montoUsd}
          tasa={tasa}
          enMixto={enMixto}
          onListo={(extra) => onListo({ referencia: limpia, verificacion_id: resultado.id, ...extra })}
          onSinVerificar={sinVerificar}
          onCorregir={corregir}
          onReintentar={() => {
            setResultado(null)
            void consultar()
          }}
        />
      )}
    </div>
  )
}

function Resultado({
  r,
  metodo,
  cuentaUsd,
  tasa,
  enMixto,
  onListo,
  onSinVerificar,
  onCorregir,
  onReintentar,
}: {
  r: VerificacionPago
  metodo: string
  cuentaUsd: number
  tasa: number
  enMixto: boolean
  onListo: (extra: Pick<PagoVerificado, 'monto_usd' | 'monto_bs' | 'decision'>) => void
  onSinVerificar: () => void
  onCorregir: () => void
  onReintentar: () => void
}) {
  // La comparacion que importa es contra LA CUENTA, no contra lo que la
  // cajera escribio: eso ultimo solo sirvio para encontrar el pago.
  const encontrado = r.resultado === 'verificado' || r.resultado === 'monto_distinto'
  const cuentaBs = tasa > 0 ? redondear(cuentaUsd * tasa) : null
  const entro = r.monto_bs
  const diferencia = encontrado && entro !== null && cuentaBs !== null ? redondear(entro - cuentaBs) : null
  // SIN margen: antes un bolivar o el 0,5 % pasaban solos como "exacto" y la
  // cajera no se enteraba de que faltaba plata. Ahora cualquier centimo de
  // diferencia se muestra y se decide.
  const entroUsd = entro !== null && tasa > 0 ? entro / tasa : undefined
  const falta = diferencia !== null ? Math.abs(diferencia) : 0
  const difUsd = diferencia !== null ? redondear(falta / tasa) : 0
  // Menos de un centavo de dolar: el sistema lleva las cuentas en dolares
  // con centavos, asi que esa diferencia no se puede cobrar con otra forma
  // (efectivo, punto) ni cambia la propina; si se puede pedir otro pago movil.
  const menosDeUnCentavo = difUsd < 0.01
  const usd = menosDeUnCentavo ? '' : ` ($${difUsd.toFixed(2)})`

  const caso: 'exacto' | 'sobra' | 'falta' | null =
    diferencia === null ? null : Math.abs(diferencia) < 0.005 ? 'exacto' : diferencia > 0 ? 'sobra' : 'falta'

  const tono =
    caso === 'exacto' || (caso === null && r.resultado === 'verificado')
      ? 'bg-exito-500/10 text-exito-800'
      : caso === 'sobra'
        ? 'bg-exito-500/10 text-exito-800'
        : caso === 'falta' || r.resultado === 'monto_distinto'
          ? 'bg-aviso-500/10 text-aviso-900'
          : r.resultado === 'ya_usado'
            ? 'bg-peligro-500/10 text-peligro-800'
            : 'bg-neutral-100 text-neutral-800'

  const titulo =
    caso === 'exacto'
      ? 'Pago confirmado'
      : caso === 'sobra'
        ? `Entró ${fmtBs(falta)} de más`
        : caso === 'falta'
          ? `Entró menos: faltan ${fmtBs(falta)}`
          : {
              verificado: 'Pago confirmado',
              monto_distinto: 'El banco lo encontró, pero el monto no cuadra',
              no_encontrado: 'El banco no lo encuentra',
              ya_usado: 'Esa referencia ya se usó',
              error: r.del_dueno ? 'No se puede verificar ahora' : 'No se pudo consultar',
            }[r.resultado]

  const detalle =
    caso === 'sobra'
      ? menosDeUnCentavo
        ? `El banco confirmó el pago. Sobran ${fmtBs(falta)}: es menos de un centavo de dólar, así que no es propina. Queda anotado en contabilidad, en «Redondeo de pagos».`
        : `El banco confirmó el pago. Lo que sobra, ${fmtBs(falta)}${usd}, se suma a la propina del equipo: no es venta.`
      : caso === 'falta'
        ? `El banco confirmó el pago, pero entró menos de la cuenta. Decide cómo se cobran los ${fmtBs(falta)}${usd} que faltan.`
        : r.mensaje

  return (
    <div className="space-y-2">
      <div className={`rounded-xl px-4 py-3 ${tono}`}>
        <p className="text-sm font-semibold">{titulo}</p>
        <p className="text-xs mt-0.5 leading-snug">{detalle}</p>
        {entro !== null && (
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <span>
              <span className="block text-[11px] opacity-70">Entró al banco</span>
              <span className="font-semibold tabular-nums text-sm">{fmtBs(entro)}</span>
            </span>
            {cuentaBs !== null && (
              <span>
                <span className="block text-[11px] opacity-70">{enMixto ? 'Esta parte' : 'La cuenta'}</span>
                <span className="font-semibold tabular-nums text-sm">{fmtBs(cuentaBs)}</span>
              </span>
            )}
          </div>
        )}
        <p className="text-[11px] opacity-70 mt-2 tabular-nums">Ref. {r.referencia}</p>
      </div>

      {caso === 'exacto' && (
        <button
          type="button"
          onClick={() => onListo({ monto_usd: cuentaUsd, monto_bs: entro ?? undefined, decision: 'exacto' })}
          className="vp-pulsable w-full rounded-xl border border-exito-300 bg-exito-50 text-exito-800 py-3.5 font-semibold"
        >
          {enMixto ? `Anotar $${cuentaUsd.toFixed(2)} por ${metodo}` : `Cobrar por ${metodo}`}
        </button>
      )}

      {caso === 'sobra' && (
        <>
          {/* Lo que sobra no es venta: es propina. Entra a la gaveta y se le
              debe al empleado, igual que si la hubieran dejado en efectivo.
              El boton lo dice con todas sus letras (Leider, 30-sep). */}
          <button
            type="button"
            onClick={() => onListo({ monto_usd: entroUsd, monto_bs: entro ?? undefined, decision: 'propina' })}
            className="vp-pulsable w-full rounded-xl border border-exito-300 bg-exito-50 text-exito-800 py-3.5 font-semibold"
          >
            {menosDeUnCentavo
              ? enMixto
                ? `Anotar por ${metodo}`
                : `Cobrar por ${metodo}`
              : `${enMixto ? 'Anotar' : 'Cobrar'} y sumar ${fmtBs(falta)} a la propina`}
          </button>
          <button type="button" onClick={onCorregir} className="w-full text-xs text-neutral-500 hover:text-neutral-800 py-1">
            Corregir la referencia
          </button>
        </>
      )}

      {caso === 'falta' && (
        <>
          {/* La cajera decide como se cobra lo que falta. Lo que entro queda
              anotado en los tres casos. */}
          <p className="text-xs font-semibold text-neutral-600 pt-1">¿Cómo se cobran los {fmtBs(falta)} que faltan?</p>
          <button
            type="button"
            onClick={() => onListo({ monto_usd: entroUsd, monto_bs: entro ?? undefined, decision: 'otro_pago' })}
            className="vp-pulsable w-full rounded-xl bg-neutral-900 py-3 text-sm font-semibold text-white"
          >
            Con otro {metodo.toLowerCase()} por {fmtBs(falta)}
          </button>
          {!menosDeUnCentavo && (
            <button
              type="button"
              onClick={() => onListo({ monto_usd: entroUsd, monto_bs: entro ?? undefined, decision: 'resto' })}
              className="vp-control vp-pulsable w-full rounded-xl py-2.5 text-sm font-medium"
            >
              Con otra forma de pago (efectivo, punto…)
            </button>
          )}
          <button
            type="button"
            onClick={() => onListo({ monto_usd: entroUsd, monto_bs: entro ?? undefined, decision: 'perdonar' })}
            className="vp-control vp-pulsable w-full rounded-xl py-2.5 text-sm font-medium"
          >
            {menosDeUnCentavo
              ? `No cobrarlo: los ${fmtBs(falta)} van a «Redondeo de pagos»`
              : `No cobrarlo: ${fmtBs(falta)} de descuento`}
          </button>
          {menosDeUnCentavo && (
            <p className="text-[11px] text-neutral-500 leading-snug">
              Es menos de un centavo de dólar: el sistema lleva las cuentas en dólares con centavos, así que no se puede
              cobrar con efectivo o punto. Con otro pago móvil sí.
            </p>
          )}
          <button type="button" onClick={onCorregir} className="w-full text-xs text-neutral-500 hover:text-neutral-800 py-1">
            Corregir la referencia
          </button>
        </>
      )}

      {caso === null && r.resultado === 'verificado' && (
        <button
          type="button"
          onClick={() => onListo({ decision: 'exacto' })}
          className="vp-pulsable w-full rounded-xl border border-exito-300 bg-exito-50 text-exito-800 py-3.5 font-semibold"
        >
          Cobrar por {metodo}
        </button>
      )}

      {caso === null && r.resultado === 'monto_distinto' && (
        <>
          {/* Sin tasa no se puede repartir la diferencia: la cajera decide
              con las cifras delante, como antes. */}
          <button
            type="button"
            onClick={() => onListo({ decision: 'exacto' })}
            className="vp-pulsable w-full rounded-xl bg-neutral-900 py-3 text-sm font-semibold text-white"
          >
            Aceptar y cobrar igual
          </button>
          <button type="button" onClick={onCorregir} className="vp-control vp-pulsable w-full rounded-xl py-2.5 text-sm font-medium">
            Corregir la referencia
          </button>
        </>
      )}

      {r.resultado === 'no_encontrado' && (
        <>
          <button type="button" onClick={onReintentar} className="vp-pulsable w-full rounded-xl bg-neutral-900 py-3 text-sm font-semibold text-white">
            Consultar otra vez
          </button>
          <button type="button" onClick={onCorregir} className="vp-control vp-pulsable w-full rounded-xl py-2.5 text-sm font-medium">
            Corregir la referencia
          </button>
          <button type="button" onClick={onSinVerificar} className="w-full text-xs text-neutral-500 hover:text-neutral-800 py-1">
            Cobrar sin verificar
          </button>
        </>
      )}

      {r.resultado === 'ya_usado' && (
        <button type="button" onClick={onCorregir} className="vp-pulsable w-full rounded-xl bg-neutral-900 py-3 text-sm font-semibold text-white">
          Pedir otro comprobante
        </button>
      )}

      {r.resultado === 'error' && (
        <>
          {r.reintentable && (
            <button type="button" onClick={onReintentar} className="vp-pulsable w-full rounded-xl bg-neutral-900 py-3 text-sm font-semibold text-white">
              Intentar de nuevo
            </button>
          )}
          <button type="button" onClick={onSinVerificar} className="vp-control vp-pulsable w-full rounded-xl py-3 text-sm font-medium">
            Cobrar sin verificar
          </button>
          <button type="button" onClick={onCorregir} className="w-full text-xs text-neutral-500 hover:text-neutral-800 py-1">
            Corregir la referencia
          </button>
        </>
      )}
    </div>
  )
}
