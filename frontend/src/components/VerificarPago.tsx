import { useState } from 'react'
import { api } from '../lib/api'
import { fmtBs } from '../lib/moneda'
import type { EstadoPabilo, VerificacionPago } from '../lib/types'
import { Numerico } from './Teclado'

/**
 * Lo que devuelve el paso de pago movil: la referencia y, si el banco la
 * confirmo, el id de esa consulta para que el cobro quede pegado a ella.
 * Sin `verificacion_id` es una referencia anotada a mano, como siempre.
 */
export type PagoVerificado = { referencia: string; verificacion_id?: number }

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
  onListo,
  onCancelar,
}: {
  metodo: string
  montoUsd: number
  /** Bs por dolar. 0 = sin tasa cargada. */
  tasa: number
  estado: EstadoPabilo
  pedidoId?: number
  onListo: (pago: PagoVerificado) => void
  onCancelar: () => void
}) {
  const [referencia, setReferencia] = useState('')
  const [telefono, setTelefono] = useState('')
  const [cedula, setCedula] = useState('')
  const [bancoOrigen, setBancoOrigen] = useState('')
  const [consultando, setConsultando] = useState(false)
  const [resultado, setResultado] = useState<VerificacionPago | null>(null)
  const [error, setError] = useState('')

  const pideTelefono = estado.campos.includes('PHONE_ORIGIN')
  const pideCedula = estado.campos.includes('DNI_ORIGIN')
  const pideBanco = estado.campos.includes('BANK_CODE_ORIGIN')
  const montoBs = tasa > 0 ? montoUsd * tasa : null
  const limpia = referencia.replace(/[^0-9a-zA-Z]/g, '')
  const puedeConsultar =
    limpia.length >= 4 &&
    !consultando &&
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

      {/* Lo que tiene que haber entrado al banco, en la moneda en que el
          cliente lo ve en su telefono. Es la cifra que se coteja. */}
      <div className="vp-control rounded-xl px-4 py-3 flex items-baseline justify-between gap-3">
        <span className="text-sm text-neutral-500">
          {estado.cuenta ? `A ${estado.cuenta}` : 'Debe haber entrado'}
        </span>
        <span className="font-display text-xl font-semibold tabular-nums tracking-tight">
          {montoBs !== null ? fmtBs(montoBs) : `$${montoUsd.toFixed(2)}`}
        </span>
      </div>
      {montoBs === null && (
        <p className="text-xs text-aviso-700">
          Sin tasa de cambio cargada: el banco dirá cuánto entró, pero no se puede comparar solo.
        </p>
      )}

      {!resultado ? (
        <>
          <label className="block text-xs text-neutral-500">
            Referencia del pago
            <Numerico
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              entero
              autoFocus
              placeholder="Los dígitos que muestra el banco"
              etiqueta="Referencia"
              className="w-full rounded-lg px-3 py-2.5 mt-1 text-lg font-semibold tracking-wide text-neutral-900"
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
                className="w-full rounded-lg px-3 py-2 mt-1 text-sm text-neutral-900"
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
                className="w-full rounded-lg px-3 py-2 mt-1 text-sm text-neutral-900"
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
                className="w-full rounded-lg px-3 py-2 mt-1 text-sm text-neutral-900"
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
          onCobrar={() => onListo({ referencia: limpia, verificacion_id: resultado.id })}
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
  onCobrar,
  onSinVerificar,
  onCorregir,
  onReintentar,
}: {
  r: VerificacionPago
  metodo: string
  onCobrar: () => void
  onSinVerificar: () => void
  onCorregir: () => void
  onReintentar: () => void
}) {
  const tono = {
    verificado: 'bg-exito-500/10 text-exito-800',
    monto_distinto: 'bg-aviso-500/10 text-aviso-900',
    no_encontrado: 'bg-neutral-100 text-neutral-800',
    ya_usado: 'bg-peligro-500/10 text-peligro-800',
    error: 'bg-neutral-100 text-neutral-800',
  }[r.resultado]
  const titulo = {
    verificado: 'Pago confirmado',
    monto_distinto: 'El banco lo encontró, pero el monto no cuadra',
    no_encontrado: 'El banco no lo encuentra',
    ya_usado: 'Esa referencia ya se usó',
    error: r.del_dueno ? 'Hay que avisarle al dueño' : 'No se pudo consultar',
  }[r.resultado]

  return (
    <div className="space-y-2">
      <div className={`rounded-xl px-4 py-3 ${tono}`}>
        <p className="text-sm font-semibold">{titulo}</p>
        <p className="text-xs mt-0.5 leading-snug">{r.mensaje}</p>
        {r.monto_bs !== null && (
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <span>
              <span className="block text-[11px] opacity-70">Entró al banco</span>
              <span className="font-semibold tabular-nums text-sm">{fmtBs(r.monto_bs)}</span>
            </span>
            {r.esperado_bs !== null && (
              <span>
                <span className="block text-[11px] opacity-70">La cuenta</span>
                <span className="font-semibold tabular-nums text-sm">{fmtBs(r.esperado_bs)}</span>
              </span>
            )}
          </div>
        )}
        <p className="text-[11px] opacity-70 mt-2 tabular-nums">Ref. {r.referencia}</p>
      </div>

      {r.resultado === 'verificado' && (
        <button
          type="button"
          onClick={onCobrar}
          className="vp-pulsable w-full rounded-xl border border-exito-300 bg-exito-50 text-exito-800 py-3.5 font-semibold"
        >
          Cobrar por {metodo}
        </button>
      )}

      {r.resultado === 'monto_distinto' && (
        <>
          {/* La cajera decide con las dos cifras delante: aceptar lo que
              entro, o corregir. Si falta plata, lo normal es pedir la
              diferencia en otra forma (pago partido), no aceptar igual. */}
          <button
            type="button"
            onClick={onCobrar}
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
