import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { AlertaPrecio } from '../lib/types'
import { Boton, Modal, Pastilla, Vacio } from './ui'

/**
 * Alertas de precio: qué llegó más caro en una factura y qué le hace al menú.
 * Se ven al guardar la factura y quedan en la bandeja de Compras para quien
 * no estaba cuando se cargó.
 */

const dinero = (x: number) => `$${x.toFixed(2)}`

/** Una alerta, dicha en una frase y con lo que hay que hacer. */
function Detalle({ a }: { a: AlertaPrecio }) {
  if (a.tipo === 'unidad') {
    return (
      <div className="space-y-1">
        <p className="font-semibold text-peligro-700">
          {a.ingrediente_nombre}: posible error de unidad en la factura {a.numero_factura}
        </p>
        <p className="text-sm text-neutral-600">
          Entró a {dinero(a.costo_nuevo)} por {a.unidad} y se venía pagando {dinero(a.costo_anterior)}. Un salto así
          casi nunca es precio: suele ser la cantidad en bultos o cajas y el costo por {a.unidad}, o al revés. Si
          quedó mal, corrígelo con una nota de crédito o un ajuste de inventario.
        </p>
      </div>
    )
  }
  return (
    <div className="space-y-1">
      <p className="font-semibold">
        {a.ingrediente_nombre} subió {a.variacion_pct.toFixed(0)}% con {a.proveedor_nombre}{' '}
        <span className="font-normal text-neutral-500">
          ({dinero(a.costo_anterior)} → {dinero(a.costo_nuevo)} por {a.unidad})
        </span>
      </p>
      <p className="text-xs text-neutral-500">
        {a.base === 'proveedor'
          ? 'Contra lo que ese mismo proveedor cobraba.'
          : 'Es la primera compra a este proveedor: contra las últimas compras de esa mercancía.'}{' '}
        Factura {a.numero_factura}.
      </p>
      {a.productos.map((p) => (
        <p key={p.nombre} className={`text-sm ${p.a_perdida ? 'text-peligro-700' : 'text-aviso-700'}`}>
          {p.a_perdida ? 'A pérdida' : 'Queda flaco'}: {p.nombre}, margen{' '}
          {p.margen_antes_pct?.toFixed(0)}% → {p.margen_despues_pct?.toFixed(0)}% vendiéndolo a {dinero(p.precio)}.
        </p>
      ))}
      {a.alternativa_costo != null && (
        <p className="text-sm text-exito-700">
          {a.alternativa_proveedor} lo vendió a {dinero(a.alternativa_costo)}
          {a.alternativa_fecha ? ` el ${new Date(a.alternativa_fecha).toLocaleDateString('es-VE')}` : ''}.
        </p>
      )}
    </div>
  )
}

/** Lo que se ve apenas se guarda la factura, si llegó algo más caro. */
export function AlertasAlGuardar({ alertas, onCerrar }: { alertas: AlertaPrecio[]; onCerrar: () => void }) {
  return (
    <Modal
      titulo={alertas.length === 1 ? 'Llegó algo más caro' : `Llegaron ${alertas.length} cosas más caras`}
      ayuda="La factura ya quedó guardada. Esto queda también en Compras › Alertas para el dueño."
      onCerrar={onCerrar}
      pie={<Boton onClick={onCerrar}>Entendido</Boton>}
    >
      <div className="space-y-4">
        {alertas.map((a) => (
          <Detalle key={a.id} a={a} />
        ))}
      </div>
    </Modal>
  )
}

/** La bandeja de Compras. `onPendientes` avisa cuántas quedan sin ver. */
export function BandejaAlertas({ onPendientes }: { onPendientes: (n: number) => void }) {
  const [soloPendientes, setSoloPendientes] = useState(true)
  const [alertas, setAlertas] = useState<AlertaPrecio[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .listarAlertasPrecio(soloPendientes)
      .then((l) => {
        setAlertas(l)
        if (soloPendientes) onPendientes(l.length)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron cargar'))
  }, [soloPendientes, onPendientes])

  // Sin esto, mientras llegaba la otra lista se veia la anterior con el
  // titulo nuevo: "Todavia no hay alertas" parpadeaba al pasar a Todas.
  function filtrar(pendientes: boolean) {
    if (pendientes === soloPendientes) return
    setAlertas(null)
    setSoloPendientes(pendientes)
  }

  async function visto(a: AlertaPrecio) {
    setError('')
    try {
      const vista = await api.marcarAlertaVista(a.id)
      const lista = (alertas ?? []).map((x) => (x.id === a.id ? vista : x)).filter((x) => !soloPendientes || !x.visto)
      setAlertas(lista)
      if (soloPendientes) onPendientes(lista.length)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo marcar')
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1 basis-60">
          <h2 className="font-semibold">Alertas de precio</h2>
          <p className="text-xs text-neutral-500">
            Lo que llegó más caro en las facturas: contra lo que ese proveedor cobraba, qué platos quedan flacos y
            quién lo vendía más barato.
          </p>
        </div>
        <div className="flex gap-1 shrink-0">
          <Boton tono={soloPendientes ? 'principal' : 'suave'} onClick={() => filtrar(true)}>
            Sin ver
          </Boton>
          <Boton tono={soloPendientes ? 'suave' : 'principal'} onClick={() => filtrar(false)}>
            Todas
          </Boton>
        </div>
      </div>
      {error && <p className="text-peligro-600 text-sm mb-2">{error}</p>}
      {alertas !== null && alertas.length === 0 ? (
        <Vacio
          titulo={soloPendientes ? 'Nada pendiente' : 'Todavía no hay alertas'}
          detalle="Aparecen al guardar una factura con algo más caro que la última vez."
        />
      ) : (
        <div className="divide-y divide-neutral-100">
          {(alertas ?? []).map((a) => (
            <div key={a.id} className="py-3 flex flex-wrap gap-3 items-start">
              <div className="flex-1 min-w-0 basis-60">
                <p className="text-xs text-neutral-400 mb-0.5">{new Date(a.fecha).toLocaleDateString('es-VE')}</p>
                <Detalle a={a} />
              </div>
              <div className="shrink-0">
                {a.visto ? (
                  <Pastilla tono="neutro">Vista{a.visto_por ? ` por ${a.visto_por}` : ''}</Pastilla>
                ) : (
                  <Boton tono="suave" onClick={() => visto(a)}>
                    Visto
                  </Boton>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
