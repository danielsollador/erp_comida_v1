import { View } from 'react-native'
import type { Pedido } from '../../lib/tipos'
import { Hoja, OpcionHoja } from '../Hoja'
import { Nota, Titulo } from '../ui'

/**
 * ¿Se llego a preparar? La pregunta de Anular de la web (pages/Cocina.tsx),
 * con sus dos opciones y la explicacion de cada una debajo. Va en una hoja
 * y no en el dialogo del sistema: el `Alert` solo deja botones de una linea y
 * aqui la explicacion es la que decide.
 *
 * La cocina es quien sabe de verdad si la comida alcanzo a hacerse: el
 * sistema solo adivina por si algun renglon quedo marcado, y lo dice.
 */
export default function ElegirAnulacion({
  pedido,
  alCerrar,
  alElegir,
}: {
  pedido: Pedido | null
  alCerrar: () => void
  alElegir: (perdida: boolean) => void
}) {
  // Lo de vitrina nace "preparado" sin que la cocina lo tocara: no cuenta.
  const yaHecha = pedido ? pedido.items.some((i) => i.preparado && i.a_cocina !== false) : false
  return (
    <Hoja visible={pedido !== null} alCerrar={alCerrar}>
      {pedido ? (
        <>
          <View style={{ paddingHorizontal: 12, paddingBottom: 10, gap: 4 }}>
            <Titulo>{`¿Anular la comanda #${pedido.numero}?`}</Titulo>
            <Nota>{`El sistema cree que ${yaHecha ? 'ya se preparó algo' : 'todavía no se preparó nada'}. Confirma o corrige:`}</Nota>
          </View>
          <OpcionHoja
            icono="alerta"
            texto="Se preparó: es pérdida"
            detalle="La comida se botó. Queda como merma y no vuelve al inventario."
            peligro={!yaHecha}
            alTocar={() => alElegir(true)}
          />
          <OpcionHoja
            icono="inventario"
            texto="No se preparó: vuelve al inventario"
            detalle="La mercancía que se iba a usar vuelve al stock."
            peligro={yaHecha}
            alTocar={() => alElegir(false)}
          />
          <OpcionHoja icono="quitar" texto="Cancelar" alTocar={alCerrar} />
        </>
      ) : null}
    </Hoja>
  )
}
