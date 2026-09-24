/**
 * Corregir COMO se pagó una venta ya cobrada: la forma de pago, el reparto de
 * un pago mixto o la referencia (el cliente, 23-sep: "por si agregué mal el
 * monto, la referencia u otra cosa").
 *
 * Lo cobrado no cambia --eso es editar los renglones--: los pagos tienen que
 * sumar lo mismo que antes. Si la plata cambia de gaveta o de cuenta, pide la
 * misma firma que editar una venta cobrada: mover un pago de efectivo al punto
 * es justo como se tapa un faltante. Corregir solo la referencia no pide nada.
 *
 * El servidor pone el resto de las reglas (caja del día ya cerrada, fiado,
 * pagos con vuelto) y las dice en palabras; aquí se muestran tal cual.
 */
import { useEffect, useMemo, useState } from 'react'
import { Boton, Campo, Modal } from './ui'
import Autorizar from './Autorizar'
import { api } from '../lib/api'
import { useAcceso } from '../lib/acceso'
import { useMoneda } from '../lib/moneda'
import { uuid } from '../lib/uuid'
import { METODOS_CON_REFERENCIA, METODOS_PAGO, etiquetaMetodo } from '../lib/pagos'
import type { Autorizacion, Pedido } from '../lib/types'

type Fila = {
  clave: string
  id: number | null
  metodo: string
  monto: string
  referencia: string
  /** Tuvo vuelto, o es la devolución de una edición: movió dos gavetas. */
  fija: boolean
}

const redondo = (x: number) => Math.round(x * 100) / 100

export default function CorregirPago({
  pedidoId,
  onGuardado,
  onCerrar,
}: {
  pedidoId: number
  onGuardado: () => void
  onCerrar: () => void
}) {
  const { fmt } = useMoneda()
  const { estado } = useAcceso()
  const autorizoYo = estado.puede.autoriza
  const [pedido, setPedido] = useState<Pedido | null>(null)
  const [filas, setFilas] = useState<Fila[]>([])
  const [motivo, setMotivo] = useState('')
  const [firma, setFirma] = useState<Autorizacion | null>(null)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    api
      .verPedido(pedidoId)
      .then((p) => {
        setPedido(p)
        setFilas(
          p.pagos.map((g) => ({
            clave: uuid(),
            id: g.id ?? null,
            metodo: g.metodo,
            monto: String(g.monto),
            referencia: g.referencia || '',
            fija: (g.vuelto_monto || 0) > 0 || g.monto < 0,
          })),
        )
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo abrir la venta'))
  }, [pedidoId])

  const cobrado = useMemo(() => redondo((pedido?.pagos ?? []).reduce((t, g) => t + g.monto, 0)), [pedido])
  const suma = redondo(filas.reduce((t, f) => t + (Number(f.monto.replace(',', '.')) || 0), 0))
  const falta = redondo(cobrado - suma)
  // Si solo cambian referencias, la plata no se movió de ningún lado.
  const muevePlata = useMemo(() => {
    if (!pedido) return false
    const firmaDe = (xs: { metodo: string; monto: number }[]) =>
      xs.map((x) => `${x.metodo}:${redondo(x.monto)}`).sort().join('|')
    return (
      firmaDe(pedido.pagos) !==
      firmaDe(filas.map((f) => ({ metodo: f.metodo, monto: Number(f.monto.replace(',', '.')) || 0 })))
    )
  }, [pedido, filas])

  function cambiar(clave: string, cambios: Partial<Fila>) {
    setFilas((fs) => fs.map((f) => (f.clave === clave ? { ...f, ...cambios } : f)))
  }

  async function guardar() {
    setError('')
    if (Math.abs(falta) > 0.009) {
      setError(
        `Los pagos tienen que sumar ${fmt(cobrado)}, lo que se cobró. ` +
          'Para cambiar lo cobrado se editan los renglones.',
      )
      return
    }
    if (muevePlata && !autorizoYo && !firma) {
      setError('Mover la plata de gaveta necesita el PIN de quien autoriza, o su aprobación desde la aplicación.')
      return
    }
    setGuardando(true)
    try {
      await api.corregirPagos(
        pedidoId,
        filas.map((f) => ({
          id: f.id,
          metodo: f.metodo,
          monto: redondo(Number(f.monto.replace(',', '.')) || 0),
          referencia: f.referencia.trim(),
        })),
        { motivo, autorizacion: muevePlata && !autorizoYo && firma ? firma : undefined },
      )
      onGuardado()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      titulo={pedido ? `Corregir el pago del pedido #${pedido.numero}` : 'Corregir el pago'}
      ayuda="Cambia la forma de pago, el reparto o la referencia. Lo cobrado no cambia."
      onCerrar={onCerrar}
      pie={
        <div className="flex items-center justify-between w-full gap-3">
          <Boton tono="fantasma" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton onClick={guardar} disabled={guardando || !pedido}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Boton>
        </div>
      }
    >
      {error && <p className="text-peligro-600 text-sm mb-3">{error}</p>}
      {!pedido ? (
        !error && <p className="text-sm text-neutral-400">Cargando…</p>
      ) : (
        <>
          <div className="space-y-3">
            {filas.map((f) => (
              <div key={f.clave} className="rounded-xl border border-neutral-200 p-3 space-y-2">
                <div className="flex gap-2">
                  <select
                    value={f.metodo}
                    disabled={f.fija}
                    onChange={(e) => cambiar(f.clave, { metodo: e.target.value })}
                    aria-label="Forma de pago"
                    className="flex-1 min-w-0 border border-neutral-300 rounded-lg px-2 py-2 text-sm disabled:bg-neutral-50"
                  >
                    {[...new Set([f.metodo, ...METODOS_PAGO])].map((m) => (
                      <option key={m} value={m}>
                        {etiquetaMetodo(m)}
                      </option>
                    ))}
                  </select>
                  <input
                    value={f.monto}
                    disabled={f.fija}
                    inputMode="decimal"
                    onChange={(e) => cambiar(f.clave, { monto: e.target.value })}
                    aria-label="Monto en dólares"
                    className="w-28 border border-neutral-300 rounded-lg px-2 py-2 text-sm text-right tabular-nums disabled:bg-neutral-50"
                  />
                  {!f.fija && filas.length > 1 && (
                    <button
                      onClick={() => setFilas((fs) => fs.filter((x) => x.clave !== f.clave))}
                      aria-label="Quitar este pago"
                      className="w-9 shrink-0 rounded-lg text-neutral-400 hover:text-peligro-600 hover:bg-neutral-100"
                    >
                      ×
                    </button>
                  )}
                </div>
                {METODOS_CON_REFERENCIA.has(f.metodo) && (
                  <input
                    value={f.referencia}
                    onChange={(e) => cambiar(f.clave, { referencia: e.target.value })}
                    placeholder="Referencia: número del pago móvil, ticket del punto o comprobante"
                    className="w-full border border-neutral-300 rounded-lg px-2 py-2 text-sm"
                  />
                )}
                {f.fija && (
                  <p className="text-xs text-neutral-500">
                    Este pago tuvo vuelto (o es una devolución): movió dos gavetas y solo se le corrige la
                    referencia.
                  </p>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() =>
              setFilas((fs) => [
                ...fs,
                {
                  clave: uuid(),
                  id: null,
                  metodo: METODOS_PAGO[0],
                  monto: falta > 0 ? String(falta) : '',
                  referencia: '',
                  fija: false,
                },
              ])
            }
            className="mt-3 w-full text-sm font-medium text-acento-600 hover:text-acento-700 border border-dashed border-acento-300 rounded-xl py-2"
          >
            + Otra forma de pago
          </button>

          <div className="mt-4 border-t border-neutral-200 pt-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-neutral-500">Se cobró</span>
              <span className="tabular-nums font-semibold">{fmt(cobrado)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Suman los pagos</span>
              <span className={`tabular-nums font-semibold ${Math.abs(falta) > 0.009 ? 'text-peligro-600' : 'text-exito-700'}`}>
                {fmt(suma)}
              </span>
            </div>
            {Math.abs(falta) > 0.009 && (
              <p className="text-xs text-peligro-600">
                {falta > 0 ? `Faltan ${fmt(falta)}` : `Sobran ${fmt(-falta)}`} para que cuadre.
              </p>
            )}
          </div>

          {muevePlata && (
            <div className="mt-4 rounded-xl bg-aviso-500/10 ring-1 ring-aviso-500/30 p-3 space-y-2">
              <p className="text-sm font-semibold text-aviso-900">La plata cambia de gaveta o de cuenta.</p>
              {autorizoYo ? (
                <p className="text-sm text-aviso-900/80">
                  Lo autorizas tú: queda firmado a nombre de{' '}
                  <span className="font-semibold">{estado.nombre_visible || estado.usuario}</span>.
                </p>
              ) : (
                <Autorizar
                  accion="corregir_pago"
                  detalle={`Corregir el pago del pedido #${pedido.numero}`}
                  monto={cobrado}
                  pedidoId={pedido.id}
                  onCambio={setFirma}
                />
              )}
            </div>
          )}

          <Campo
            etiqueta="Nota"
            className="mt-4"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Opcional: qué se había anotado mal"
          />
        </>
      )}
    </Modal>
  )
}
