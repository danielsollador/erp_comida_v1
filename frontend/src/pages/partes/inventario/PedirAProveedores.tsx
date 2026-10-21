import { useEffect, useState } from 'react'
import { Aviso, Boton, Modal } from '../../../components/ui'
import { api } from '../../../lib/api'
import { useMoneda } from '../../../lib/moneda'
import type { PedidoProveedor } from '../../../lib/types'

/**
 * «Qué comprar», repartido por proveedor y escrito como mensaje (21-oct).
 *
 * El sistema sabe a quién se le compró cada cosa la última vez y cómo la
 * vende (la caja de 24, el bulto de 20 kg): arma el mensaje y la persona lo
 * revisa, lo cambia si quiere y lo manda. No envía nada solo: «Abrir
 * WhatsApp» abre el chat con el texto puesto.
 */
export default function PedirAProveedores({ onCerrar }: { onCerrar: () => void }) {
  const { fmt } = useMoneda()
  const [pedidos, setPedidos] = useState<PedidoProveedor[] | null>(null)
  const [error, setError] = useState('')
  const [textos, setTextos] = useState<Record<string, string>>({})
  const [copiado, setCopiado] = useState('')

  useEffect(() => {
    api
      .pedidoProveedor()
      .then((lista) => {
        setPedidos(lista)
        setTextos(Object.fromEntries(lista.map((p) => [p.proveedor, p.mensaje])))
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo armar el pedido.'))
  }, [])

  const copiar = async (p: PedidoProveedor) => {
    try {
      await navigator.clipboard.writeText(textos[p.proveedor] ?? p.mensaje)
      setCopiado(p.proveedor)
      window.setTimeout(() => setCopiado(''), 2000)
    } catch {
      // sin portapapeles: el texto sigue a la vista para copiarlo a mano
    }
  }

  const enlace = (p: PedidoProveedor) =>
    `https://wa.me/${p.whatsapp}?text=${encodeURIComponent(textos[p.proveedor] ?? p.mensaje)}`

  return (
    <Modal titulo="Pedir a proveedores" ancho="lg" onCerrar={onCerrar} pie={<Boton tono="suave" onClick={onCerrar}>Cerrar</Boton>}>
      {error && <Aviso tono="mal">{error}</Aviso>}
      {!pedidos && !error && <p className="text-sm text-neutral-500">Armando el pedido…</p>}
      {pedidos && pedidos.length === 0 && <p className="text-sm text-neutral-500">No hay nada por comprar ahora mismo.</p>}
      {pedidos && pedidos.length > 0 && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-neutral-600 text-pretty">
            Va al proveedor de la última factura de cada cosa, en la presentación en que él la vende. Revisa el mensaje antes de mandarlo.
          </p>
          {pedidos.map((p) => (
            <section key={p.proveedor} className="rounded-2xl border border-neutral-200 p-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h3 className="font-display font-semibold">{p.proveedor}</h3>
                <span className="text-sm text-neutral-500">
                  {p.lineas.length} {p.lineas.length === 1 ? 'cosa' : 'cosas'}
                  {p.estimado > 0 && <> · cerca de {fmt(p.estimado)} a precio de la última compra</>}
                </span>
              </div>
              {p.conocido ? (
                <>
                  <textarea
                    value={textos[p.proveedor] ?? p.mensaje}
                    onChange={(e) => setTextos((t) => ({ ...t, [p.proveedor]: e.target.value }))}
                    rows={Math.min(3 + p.lineas.length, 12)}
                    className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm leading-relaxed focus:outline-none focus:border-acento-400"
                  />
                  <div className="flex flex-wrap gap-2">
                    {p.whatsapp ? (
                      <a
                        href={enlace(p)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium bg-neutral-900 text-white"
                      >
                        Abrir WhatsApp
                      </a>
                    ) : (
                      <span className="text-xs text-neutral-500 self-center">
                        Sin teléfono en su ficha (Compras › Proveedores): copia el mensaje.
                      </span>
                    )}
                    <Boton tono="suave" onClick={() => void copiar(p)}>
                      {copiado === p.proveedor ? 'Copiado' : 'Copiar'}
                    </Boton>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-neutral-600">
                    Nunca se han comprado con factura, así que el sistema no sabe a quién pedírselas:
                  </p>
                  <ul className="text-sm list-disc pl-5">
                    {p.lineas.map((l) => (
                      <li key={l.ingrediente_id}>
                        {l.nombre}: {l.cantidad.toLocaleString('es-VE')} {l.unidad}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          ))}
        </div>
      )}
    </Modal>
  )
}
