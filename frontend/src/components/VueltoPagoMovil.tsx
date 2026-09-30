import { useState } from 'react'
import { api } from '../lib/api'
import { fmtBs } from '../lib/moneda'
import type { EstadoPabilo, VueltoEmitido } from '../lib/types'
import { Numerico } from './Teclado'

/**
 * Dar el vuelto por pago movil.
 *
 * Con una cuenta juridica conectada (C2P), el sistema MANDA el pago movil al
 * telefono del cliente desde la cuenta del local (Pabilo, docs/transaction-
 * change) y el cobro queda con la referencia del banco. Con una cuenta de
 * persona natural el banco no lo permite: la cajera lo manda desde su banco
 * y aqui anota la referencia, para que el vuelto quede en la venta igual.
 */
export type VueltoListo = { vuelto_id?: number; referencia: string }

export default function VueltoPagoMovil({
  montoBs,
  montoUsd,
  estado,
  pedidoId,
  onListo,
  onCancelar,
}: {
  montoBs: number
  montoUsd: number
  estado: EstadoPabilo | null
  pedidoId?: number
  onListo: (v: VueltoListo) => void
  onCancelar: () => void
}) {
  const automatico = Boolean(estado?.configurado && !estado.error && estado.emite_vueltos)
  const [telefono, setTelefono] = useState('')
  const [cedula, setCedula] = useState('')
  const [banco, setBanco] = useState('0102')
  const [referencia, setReferencia] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [resultado, setResultado] = useState<VueltoEmitido | null>(null)
  const [aMano, setAMano] = useState(!automatico)

  const telefonoLimpio = telefono.replace(/\D/g, '')
  const puedeMandar = telefonoLimpio.length === 11 && cedula.replace(/\D/g, '').length >= 6 && !enviando

  async function mandar() {
    setError('')
    setEnviando(true)
    try {
      const r = await api.emitirVuelto({
        telefono: telefonoLimpio,
        cedula,
        banco,
        monto_bs: Math.round(montoBs * 100) / 100,
        monto_usd: montoUsd,
        pedido_id: pedidoId,
        user_bank_id: estado?.cuenta_id || undefined,
      })
      setResultado(r)
      if (r.resultado === 'enviado') onListo({ vuelto_id: r.id, referencia: r.referencia })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo mandar el vuelto.')
    } finally {
      setEnviando(false)
    }
  }

  const campo = 'w-full border border-neutral-300 rounded-lg px-3 py-2.5 mt-1 text-sm text-neutral-900'

  return (
    <div className="mt-3 mb-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">
          Vuelto por pago móvil · <span className="tabular-nums">{fmtBs(montoBs)}</span>
        </span>
        <button type="button" onClick={onCancelar} className="text-sm text-neutral-500 hover:text-neutral-800">
          Volver
        </button>
      </div>

      {!aMano ? (
        <>
          <label className="block text-xs text-neutral-500">
            Teléfono del cliente
            <Numerico
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              entero
              autoFocus
              placeholder="04141234567"
              etiqueta="Teléfono"
              className={campo}
            />
          </label>
          <div className="grid grid-cols-[1fr_1.2fr] gap-2">
            <label className="block text-xs text-neutral-500">
              Cédula
              <input
                value={cedula}
                onChange={(e) => setCedula(e.target.value)}
                placeholder="V12345678"
                className={campo}
              />
            </label>
            <label className="block text-xs text-neutral-500">
              Banco del cliente
              <select value={banco} onChange={(e) => setBanco(e.target.value)} className={`${campo} bg-white`}>
                {(estado?.bancos_destino ?? []).map(([codigo, nombre]) => (
                  <option key={codigo} value={codigo}>
                    {codigo} · {nombre}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {(error || (resultado && resultado.resultado !== 'enviado')) && (
            <p className="text-sm text-peligro-600">{error || resultado?.mensaje}</p>
          )}
          <button
            type="button"
            onClick={mandar}
            disabled={!puedeMandar}
            className="vp-pulsable w-full rounded-xl bg-neutral-900 py-3.5 text-sm font-semibold text-white disabled:opacity-30"
          >
            {enviando ? 'Mandando al banco…' : `Mandar ${fmtBs(montoBs)} y cobrar`}
          </button>
          <button
            type="button"
            onClick={() => setAMano(true)}
            className="w-full text-xs text-neutral-500 hover:text-neutral-800 py-1"
          >
            Ya lo mandé desde el banco: anotar la referencia
          </button>
        </>
      ) : (
        <>
          {!automatico && (
            <p className="text-xs text-neutral-500 leading-snug">
              {estado?.configurado && !estado.error
                ? 'La cuenta conectada es de persona natural: el banco solo deja mandar vueltos automáticos desde cuentas jurídicas. Manda el pago móvil desde tu banco y anota aquí la referencia.'
                : 'Manda el pago móvil desde tu banco y anota aquí la referencia.'}
            </p>
          )}
          <label className="block text-xs text-neutral-500">
            Referencia del pago móvil que mandaste
            <Numerico
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              entero
              autoFocus
              placeholder="Los dígitos que muestra el banco"
              etiqueta="Referencia"
              className={`${campo} text-lg font-semibold tracking-wide`}
            />
          </label>
          <button
            type="button"
            onClick={() => onListo({ referencia: referencia.replace(/\D/g, '') })}
            disabled={referencia.replace(/\D/g, '').length < 4}
            className="vp-pulsable w-full rounded-xl bg-neutral-900 py-3.5 text-sm font-semibold text-white disabled:opacity-30"
          >
            Cobrar con ese vuelto
          </button>
          {automatico && (
            <button type="button" onClick={() => setAMano(false)} className="w-full text-xs text-neutral-500 hover:text-neutral-800 py-1">
              Mejor que lo mande el sistema
            </button>
          )}
        </>
      )}
    </div>
  )
}
