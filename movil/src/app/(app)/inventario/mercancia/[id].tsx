import { useLocalSearchParams } from 'expo-router'
import { PantallaFicha } from '../../../../componentes/inventario/ficha/FichaMercancia'

/** /inventario/mercancia/12: la ficha de una mercancia (como esta, que anotar, que le paso). */
export default function Mercancia() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <PantallaFicha key={id} id={Number(id)} />
}
