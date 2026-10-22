import { useRef, useState } from 'react'
import { Aviso, Boton, Seccion } from '../../../components/ui'
import { api } from '../../../lib/api'
import { fmtBs } from '../../../lib/moneda'
import type { ResultadoConciliacion } from '../../../lib/types'

/**
 * Conciliar el banco (22-oct): se sube el estado de cuenta y el sistema lo
 * cruza con los cobros de pago móvil, transferencia y punto de venta.
 *
 * Lo que importa son dos listas: lo cobrado que no entró, y lo que entró y
 * no es ningún cobro. Lo que cuadra se resume en una línea. El archivo no se
 * guarda: se lee, se cruza y se muestra (ver backend/app/conciliacion.py).
 */
export default function ConciliarBanco() {
  const entrada = useRef<HTMLInputElement>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [error, setError] = useState('')
  const [r, setR] = useState<ResultadoConciliacion | null>(null)
  const [verCuadrados, setVerCuadrados] = useState(false)

  const subir = async (archivo: File | undefined) => {
    if (!archivo) return
    setLeyendo(true)
    setError('')
    try {
      setR(await api.conciliarBanco(archivo))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer el estado de cuenta.')
    } finally {
      setLeyendo(false)
      if (entrada.current) entrada.current.value = ''
    }
  }

  // "2026-04-03" -> "03/04": el año ya lo dice el período de arriba.
  const dia = (iso: string) => {
    const [, m, d] = iso.slice(0, 10).split('-')
    return d && m ? `${d}/${m}` : ''
  }
  const difPunto = r ? r.puntos.filter((p) => Math.abs(p.diferencia_bs) >= 1) : []

  return (
    <div className="flex flex-col gap-4">
      <Seccion
        titulo="Conciliar el banco"
        ayuda="Sube el estado de cuenta (PDF del Provincial, o Excel o CSV de cualquier banco) y se cruza con los cobros de pago móvil, transferencia y punto de venta. Solo se lee: el archivo no se guarda."
      >
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={entrada}
            type="file"
            accept=".pdf,.csv,.xlsx,.txt"
            className="hidden"
            onChange={(e) => void subir(e.target.files?.[0])}
          />
          <Boton onClick={() => entrada.current?.click()} disabled={leyendo}>
            {leyendo ? 'Leyendo…' : r ? 'Subir otro estado de cuenta' : 'Subir estado de cuenta'}
          </Boton>
          {r && (
            <span className="text-sm text-neutral-500">
              {r.banco} · del {dia(r.desde)} al {dia(r.hasta)} · {r.movimientos} movimientos
            </span>
          )}
        </div>
        {error && (
          <div className="mt-3">
            <Aviso tono="mal">{error}</Aviso>
          </div>
        )}
      </Seccion>

      {r && (
        <>
          {r.descuadres_lectura > 0 && (
            <Aviso tono="ojo">
              {r.descuadres_lectura} renglón(es) no cuadran con el saldo del banco: puede que el archivo no se haya leído
              completo. Revisa con cuidado o súbelo en Excel.
            </Aviso>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <Cifra titulo="Cobrado y no entró" valor={r.sin_banco.length} tono={r.sin_banco.length ? 'ojo' : 'bien'} />
            <Cifra titulo="Entró y no es un cobro" valor={r.sin_sistema.length} tono={r.sin_sistema.length ? 'info' : 'bien'} />
            <Cifra titulo="Días del punto con diferencia" valor={difPunto.length} tono={difPunto.length ? 'ojo' : 'bien'} />
          </div>

          <Seccion
            titulo="Cobrado en el sistema y no está en el banco"
            ayuda="Cobros de pago móvil o transferencia sin un abono del mismo monto ese día o el siguiente. Lo primero a revisar: puede ser un pago que nunca llegó."
          >
            {r.sin_banco.length === 0 ? (
              <p className="text-sm text-neutral-500">Todo lo cobrado aparece en el banco.</p>
            ) : (
              <Lista
                filas={r.sin_banco.map((c) => [
                  `#${c.numero}${c.tipo === 'abono' ? ' (abono)' : ''}`,
                  `${dia(c.fecha ?? '')} · ${c.metodo}${c.referencia ? ` · ref. ${c.referencia}` : ' · sin referencia'}${c.cliente ? ` · ${c.cliente}` : ''}`,
                  fmtBs(c.bs),
                ])}
              />
            )}
          </Seccion>

          <Seccion
            titulo="Entró al banco y no es ningún cobro"
            ayuda="Abonos que no corresponden a ningún cobro del sistema: un pago que nadie registró, o plata que no es venta (un préstamo, un aporte, un reintegro)."
          >
            {r.sin_sistema.length === 0 ? (
              <p className="text-sm text-neutral-500">Cada abono corresponde a un cobro.</p>
            ) : (
              <Lista filas={r.sin_sistema.map((m) => [dia(m.fecha), m.concepto || '(sin concepto)', fmtBs(m.monto)])} />
            )}
          </Seccion>

          <Seccion
            titulo="Punto de venta, día por día"
            ayuda="Lo cobrado por el punto cada día contra los lotes (TD/TC POS) que abonó el banco ese día o el siguiente."
          >
            {r.puntos.length === 0 ? (
              <p className="text-sm text-neutral-500">No hay cobros por punto de venta en esas fechas.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-neutral-500">
                      <th className="py-1.5 pr-3 font-medium">Día</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Sistema</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Banco</th>
                      <th className="py-1.5 font-medium text-right">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.puntos.map((p) => (
                      <tr key={p.fecha} className="border-t border-neutral-100">
                        <td className="py-1.5 pr-3">
                          {dia(p.fecha)}
                          {p.fecha_banco && p.fecha_banco !== p.fecha && (
                            <span className="text-xs text-neutral-500"> · abonado el {dia(p.fecha_banco)}</span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{fmtBs(p.sistema_bs)}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{p.lotes ? fmtBs(p.banco_bs) : 'sin lote'}</td>
                        <td
                          className={`py-1.5 text-right tabular-nums ${Math.abs(p.diferencia_bs) >= 1 ? 'text-aviso-700 font-semibold' : 'text-neutral-500'}`}
                        >
                          {fmtBs(p.diferencia_bs)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {r.lotes_sin_ventas.length > 0 && (
              <p className="mt-2 text-xs text-neutral-500">
                {r.lotes_sin_ventas.length} lote(s) del banco sin cobros por punto en el sistema ese día ni el anterior.
              </p>
            )}
          </Seccion>

          <p className="text-sm text-neutral-600">
            {r.conciliados.length} cobro(s) cuadran con su abono
            {r.conciliados.some((p) => p.por_referencia) && ` (${r.conciliados.filter((p) => p.por_referencia).length} también por referencia)`}.
            {r.comisiones_bs > 0 && ` Comisiones del banco: ${fmtBs(r.comisiones_bs)}.`}{' '}
            {r.conciliados.length > 0 && (
              <button type="button" className="underline underline-offset-2" onClick={() => setVerCuadrados((v) => !v)}>
                {verCuadrados ? 'Ocultar' : 'Verlos'}
              </button>
            )}
          </p>
          {verCuadrados && (
            <Lista
              filas={r.conciliados.map((p) => [
                `#${p.cobro.numero}`,
                `${dia(p.cobro.fecha ?? '')} · ${p.cobro.metodo} ↔ ${p.movimiento.concepto}`,
                fmtBs(p.movimiento.monto),
              ])}
            />
          )}
        </>
      )}
    </div>
  )
}

function Cifra({ titulo, valor, tono }: { titulo: string; valor: number; tono: 'ojo' | 'bien' | 'info' }) {
  const color = tono === 'ojo' ? 'text-aviso-700' : tono === 'bien' ? 'text-exito-700' : 'text-neutral-900'
  return (
    <div className="vp-losa rounded-2xl p-4">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{titulo}</p>
      <p className={`mt-1 font-display text-2xl font-semibold tabular-nums ${color}`}>{valor}</p>
    </div>
  )
}

function Lista({ filas }: { filas: string[][] }) {
  return (
    <ul className="divide-y divide-neutral-500/10 text-sm">
      {filas.map(([titulo, detalle, monto], i) => (
        <li key={i} className="py-2 flex items-baseline gap-3">
          <span className="font-medium shrink-0">{titulo}</span>
          <span className="min-w-0 flex-1 text-neutral-600 break-words">{detalle}</span>
          <span className="tabular-nums whitespace-nowrap font-semibold">{monto}</span>
        </li>
      ))}
    </ul>
  )
}
