import { req } from './api'
import type { Categoria, Pedido } from './tipos'

/**
 * Cocina: las MISMAS llamadas de la web (frontend/src/lib/api.ts) que usa
 * pages/Cocina.tsx. El servidor no distingue si le habla la tablet o el
 * telefono: el candado de la caja, la marca de "Preparando" y anular
 * funcionan igual.
 */
export const apiCocina = {
  /** Lo que la cocina todavia tiene que preparar, cobrado o no. */
  enCocina: () => req<Pedido[]>('/pedidos?en_cocina=true'),
  /** El menu, solo para saber de que categoria (y de que color) es cada renglon. */
  categorias: () => req<Categoria[]>('/menu/categorias'),
  /** "Esta es mia": interruptor; le cierra la edicion a la caja. */
  marcarCocinando: (pedidoId: number) => req<Pedido>(`/pedidos/${pedidoId}/cocinando`, { method: 'POST' }),
  /** Marca o desmarca un renglon. Marcarlo tambien agarra la comanda. */
  marcarItemPreparado: (itemId: number) => req<Pedido>(`/pedidos/items/${itemId}/preparado`, { method: 'POST' }),
  marcarPedidoListo: (pedidoId: number) => req<Pedido>(`/pedidos/${pedidoId}/marcar-listo`, { method: 'POST' }),
  /** `comida_preparada`: lo que dice la cocina, no lo que adivina el sistema. */
  anularPedido: (pedidoId: number, comidaPreparada: boolean) =>
    req<Pedido>(`/pedidos/${pedidoId}/anular`, {
      method: 'POST',
      body: JSON.stringify({ comida_preparada: comidaPreparada, operador_id: null }),
    }),
}
