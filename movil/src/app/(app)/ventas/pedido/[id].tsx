import { useLocalSearchParams } from 'expo-router'
import { Barra } from '../../../../componentes/Encabezado'
import { Vacio } from '../../../../componentes/kit'
import { Cargando, Pantalla, Problema } from '../../../../componentes/ui'
import DetalleVenta from '../../../../componentes/ventas/DetalleVenta'
import { apiVentas } from '../../../../lib/api-ventas'
import { useCarga } from '../../../../lib/carga'

/**
 * /ventas/pedido/123?f=2026-10-11: una venta. No hay una ruta "una venta"
 * en el servidor: se piden las ventas de ESE dia y se toma la suya, que es
 * exactamente la fila que ve la lista (con su estado, lo que debe, el motivo
 * de la devolucion). Sin la fecha (un enlace suelto), se averigua primero
 * con el pedido.
 */
export default function PedidoVenta() {
  const { id, f } = useLocalSearchParams<{ id: string; f?: string }>()
  const numero = Number(id)
  const { datos, error, refrescando, refrescar } = useCarga(
    async () => {
      let dia = f && /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : ''
      if (!dia) {
        const p = await apiVentas.verPedido(numero)
        dia = (p.cerrado_en ?? p.creado_en).slice(0, 10)
      }
      const lista = await apiVentas.ventas(dia, dia)
      return { v: lista.filas.find((v) => v.id === numero) ?? null }
    },
    60,
    `${id}/${f ?? ''}`,
  )

  const v = datos?.v ?? null
  return (
    <Pantalla refrescando={refrescando} alRefrescar={refrescar} arriba={<Barra titulo={v ? `Venta #${v.numero}` : 'Venta'} />}>
      {error && !datos ? <Problema mensaje={error} alReintentar={refrescar} /> : null}
      {!datos && !error ? <Cargando /> : null}
      {v ? <DetalleVenta v={v} alCambio={refrescar} /> : null}
      {datos && !v ? <Vacio icono="ventas" titulo="No se encontró esa venta" /> : null}
    </Pantalla>
  )
}
