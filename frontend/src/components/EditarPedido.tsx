/**
 * El cuadro para cambiarle los renglones a un pedido ya tomado.
 *
 * Vive aparte porque hacen falta dos puertas de entrada y no puede haber dos
 * versiones: desde el punto de venta, mientras el pedido sigue en el piso, y
 * desde Ventas, cuando ya salió de la pantalla del mostrador y lo único que
 * queda es el historial. Duplicarlo sería garantizar que una de las dos copias
 * termine pidiendo la clave cuando la otra no.
 *
 * Mientras está abierto, el servidor tiene la comanda marcada como "en
 * edición" y la cocina no la puede tocar. Por eso cerrar avisa: un candado que
 * solo se suelta al guardar dejaría la comanda trancada cada vez que alguien
 * se arrepiente.
 */
import { useEffect, useMemo, useState } from 'react'
import { Boton, Campo, Modal, Selector } from './ui'
import Autorizar from './Autorizar'
import { api } from '../lib/api'
import { useMoneda } from '../lib/moneda'
import { METODOS_CON_REFERENCIA, METODOS_PAGO } from '../lib/pagos'
import { etiquetaMetodo } from '../lib/pagos'
import type { Autorizacion, Categoria, Pedido, Producto, Variante } from '../lib/types'

// La lista sale de lib/pagos y no de aquí: cada pantalla que aplicaba pagos
// tenía su propia copia, y fue así como el cobro a crédito terminó aceptando
// un pago móvil sin comprobante. Ninguna de las dos incluye "Fiado", que para
// este cuadro además sería un error aparte: la diferencia de una edición no se
// puede fiar, porque abriría una cuenta por cobrar dentro de una venta que ya
// figura cobrada.

/**
 * Un renglón dentro del cuadro.
 *
 * `precio` viaja en la línea en vez de leerse del menú cada vez, y es lo que
 * hace que el total que ve el cajero sea el mismo que va a calcular el
 * servidor: un renglón que ya estaba conserva el precio al que se le dijo al
 * cliente, aunque el menú haya subido mientras el pedido estaba abierto.
 */
type LineaEdicion = {
  clave: string
  variante_id: number | null
  nombre: string
  precio: number
  cantidad: number
}

function lineasDePedido(pedido: Pedido): LineaEdicion[] {
  return pedido.items.map((i) => ({
    clave: i.variante_id !== null ? `v${i.variante_id}` : `libre:${i.nombre}:${i.precio_unitario}`,
    variante_id: i.variante_id,
    nombre: i.nombre,
    precio: i.precio_unitario,
    cantidad: i.cantidad,
  }))
}

export default function EditarPedido({
  pedido,
  onGuardado,
  onCerrar,
}: {
  /** El pedido tal como lo devolvió `abrirEdicion`: con el candado ya tomado. */
  pedido: Pedido
  onGuardado: () => void
  onCerrar: () => void
}) {
  const { fmt } = useMoneda()
  const [lineas, setLineas] = useState<LineaEdicion[]>(() => lineasDePedido(pedido))
  const [motivo, setMotivo] = useState('')
  const [buscar, setBuscar] = useState('')
  // La firma de quien autoriza la diferencia: su PIN, o la solicitud que
  // aprobo desde su aplicacion (ver `Autorizar`).
  const [firma, setFirma] = useState<Autorizacion | null>(null)
  const [metodo, setMetodo] = useState(METODOS_PAGO[0])
  const [referencia, setReferencia] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [categorias, setCategorias] = useState<Categoria[]>([])

  useEffect(() => {
    api.listarCategorias().then((todas) => setCategorias(todas.filter((c) => c.activo)))
  }, [])

  // Todo el menú en una lista: aquí no hay sitio para las pestañas de
  // categoría, y lo que se necesita es teclear tres letras y tocar.
  const platos = useMemo(
    () =>
      categorias.flatMap((c) =>
        c.productos
          .filter((pr) => pr.activo)
          .flatMap((pr) =>
            pr.variantes.filter((v) => v.activo).map((v) => ({ producto: pr, variante: v })),
          ),
      ),
    [categorias],
  )

  // Se calcula igual que en el servidor -- el descuento ya concedido se
  // respeta -- para que el número que el cajero le dice al cliente sea el que
  // se va a cobrar.
  const subtotal = Math.round(lineas.reduce((t, l) => t + l.precio * l.cantidad, 0) * 100) / 100
  const total = Math.max(Math.round((subtotal - (pedido.descuento || 0)) * 100) / 100, 0)
  const diferencia = Math.round((total - pedido.total) * 100) / 100
  // Solo una venta YA COBRADA tiene plata que cuadrar. Si todavía no se ha
  // cobrado, cambiar renglones es simplemente tomar bien el pedido.
  const pideClave = pedido.estado === 'pagado' && diferencia !== 0

  function cambiar(clave: string, delta: number) {
    setLineas((prev) =>
      prev
        .map((l) => (l.clave === clave ? { ...l, cantidad: l.cantidad + delta } : l))
        .filter((l) => l.cantidad > 0),
    )
  }

  function agregar(producto: Producto, variante: Variante) {
    const id = `v${variante.id}`
    setLineas((prev) => {
      const ya = prev.find((l) => l.clave === id)
      if (ya) return prev.map((l) => (l.clave === id ? { ...l, cantidad: l.cantidad + 1 } : l))
      const nombre =
        variante.nombre && variante.nombre.toLowerCase() !== 'regular'
          ? `${producto.nombre} - ${variante.nombre}`
          : producto.nombre
      return [...prev, { clave: id, variante_id: variante.id, nombre, precio: variante.precio, cantidad: 1 }]
    })
  }

  async function guardar() {
    setError('')
    if (lineas.length === 0) {
      setError('Un pedido no puede quedar vacío. Si ya no va, anúlalo.')
      return
    }
    if (pideClave && !firma) {
      setError('La diferencia de dinero necesita el PIN de quien autoriza, o su aprobación desde la aplicación.')
      return
    }
    setGuardando(true)
    try {
      await api.editarPedido(
        pedido.id,
        lineas.map((l) =>
          l.variante_id !== null
            ? { variante_id: l.variante_id, cantidad: l.cantidad }
            : { variante_id: null, cantidad: l.cantidad, nombre_libre: l.nombre, precio_libre: l.precio },
        ),
        {
          motivo,
          autorizacion: pideClave && firma ? firma : undefined,
          // El monto va en positivo: el signo lo pone la diferencia. Pedirle al
          // cajero que escriba -3.00 para una devolución es pedirle que se
          // equivoque.
          pagos: pideClave
            ? [{ metodo, monto: Math.abs(diferencia), referencia }]
            : undefined,
        },
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
      titulo={`Editar pedido #${pedido.numero}`}
      ayuda={
        pedido.estado === 'pagado'
          ? 'Esta venta ya está cobrada: si el monto cambia hará falta el PIN de quien autoriza (o su aprobación desde la app) y decir por dónde entra o sale la diferencia.'
          : 'La cocina tiene esta comanda bloqueada mientras el cuadro esté abierto.'
      }
      onCerrar={onCerrar}
      ancho="lg"
      pie={
        <div className="flex items-center justify-between w-full gap-3">
          <Boton tono="fantasma" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton onClick={guardar} disabled={guardando || lineas.length === 0}>
            {guardando ? 'Guardando…' : 'Guardar cambios'}
          </Boton>
        </div>
      }
    >
      {error && <p className="text-peligro-600 text-sm mb-3">{error}</p>}

      <div className="space-y-2 mb-4">
        {lineas.map((l) => (
          <div key={l.clave} className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{l.nombre}</div>
              <div className="text-xs text-neutral-500">
                {l.cantidad} x {fmt(l.precio)} ={' '}
                <span className="font-semibold text-neutral-700">{fmt(l.precio * l.cantidad)}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => cambiar(l.clave, -1)}
                className="w-9 h-9 rounded-full bg-neutral-100 hover:bg-neutral-200 font-semibold text-lg"
              >
                -
              </button>
              <span className="w-6 text-center font-semibold tabular-nums">{l.cantidad}</span>
              <button
                onClick={() => cambiar(l.clave, 1)}
                className="w-9 h-9 rounded-full bg-neutral-100 hover:bg-neutral-200 font-semibold text-lg"
              >
                +
              </button>
            </div>
          </div>
        ))}
        {lineas.length === 0 && (
          <p className="text-sm text-peligro-600">
            No queda ningún renglón. Un pedido vacío se anula, no se guarda.
          </p>
        )}
      </div>

      <input
        value={buscar}
        onChange={(e) => setBuscar(e.target.value)}
        placeholder="Agregar del menú: escribe para buscar"
        className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mb-2"
      />
      {buscar.trim().length > 0 && (
        <div className="grid grid-cols-2 gap-2 mb-4 max-h-44 overflow-y-auto">
          {platos
            .filter(({ producto, variante }) =>
              `${producto.nombre} ${variante.nombre}`.toLowerCase().includes(buscar.trim().toLowerCase()),
            )
            .slice(0, 12)
            .map(({ producto, variante }) => (
              <button
                key={variante.id}
                onClick={() => agregar(producto, variante)}
                className="text-left bg-neutral-100 hover:bg-neutral-200 rounded-xl px-3 py-2 text-sm"
              >
                <span className="font-medium">
                  {variante.nombre && variante.nombre.toLowerCase() !== 'regular'
                    ? `${producto.nombre} - ${variante.nombre}`
                    : producto.nombre}
                </span>
                <span className="block text-xs text-neutral-500">{fmt(variante.precio)}</span>
              </button>
            ))}
        </div>
      )}

      <div className="border-t border-neutral-200 pt-3 text-sm space-y-1">
        <div className="flex justify-between text-neutral-500">
          <span>Antes</span>
          <span className="tabular-nums">{fmt(pedido.total)}</span>
        </div>
        <div className="flex justify-between font-semibold">
          <span>Queda en</span>
          <span className="tabular-nums">{fmt(total)}</span>
        </div>
        {diferencia !== 0 && (
          <div
            className={`flex justify-between font-semibold ${
              diferencia > 0 ? 'text-exito-700' : 'text-aviso-700'
            }`}
          >
            <span>{diferencia > 0 ? 'El cliente paga de más' : 'Se le devuelve al cliente'}</span>
            <span className="tabular-nums">{fmt(Math.abs(diferencia))}</span>
          </div>
        )}
      </div>

      {/* La clave no se pide por cambiar renglones: se pide por mover plata de
          una venta ya cobrada. Un pedido sin cobrar no pide nada, y una edición
          que da exacta tampoco -- pedir clave siempre entrena a la gente para
          que la clave no signifique nada. */}
      {pideClave && (
        <div className="mt-4 rounded-xl bg-aviso-500/10 ring-1 ring-aviso-500/30 p-3 space-y-3">
          <p className="text-sm font-semibold text-aviso-900">
            Esta venta ya está cobrada y el monto cambia en {fmt(Math.abs(diferencia))}.
          </p>
          <Autorizar
            accion="editar_venta"
            detalle={`${diferencia > 0 ? 'El cliente paga de más' : 'Se le devuelve al cliente'} ${fmt(Math.abs(diferencia))}`}
            monto={Math.abs(diferencia)}
            pedidoId={pedido.id}
            onCambio={setFirma}
          />
          <Selector
            etiqueta={diferencia > 0 ? 'Cómo se cobra la diferencia' : 'Cómo se devuelve'}
            value={metodo}
            onChange={(e) => setMetodo(e.target.value)}
          >
            {METODOS_PAGO.map((m) => (
              <option key={m} value={m}>
                {etiquetaMetodo(m)}
              </option>
            ))}
          </Selector>
          {METODOS_CON_REFERENCIA.has(metodo) && (
            <Campo
              etiqueta="Referencia"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              ayuda="El número del pago móvil, el ticket del punto o el comprobante."
            />
          )}
        </div>
      )}

      <Campo
        etiqueta="Por qué se edita"
        className="mt-4"
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="El cliente cambió de idea"
      />

      {pedido.ediciones.length > 0 && (
        <div className="mt-4 text-xs text-neutral-500 space-y-1">
          <p className="font-semibold uppercase tracking-wide">Ya se editó antes</p>
          {pedido.ediciones.map((e) => (
            <p key={e.id}>
              {e.detalle}
              {e.diferencia !== 0 && ` · ${fmt(e.diferencia)}`}
              {e.autorizado_por && ` · autorizó ${e.autorizado_por}`}
            </p>
          ))}
        </div>
      )}
    </Modal>
  )
}
