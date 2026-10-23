import { router, Stack, useLocalSearchParams, type Href } from 'expo-router'
import { useState } from 'react'
import { Ancla } from '../../lib/guia'
import { useSesion } from '../../lib/sesion'
import { Boton, Cargando, Pantalla, Pestanas, Problema } from '../ui'
import CambiarPrecios from './CambiarPrecios'
import { useDatosMenu } from './datos'
import ElMenu from './ElMenu'
import { useTostada } from './piezas'
import Recetas from './Recetas'

/**
 * MENU (pages/Menu.tsx): dos secciones, "El menú" y "Recetas", en la ruta
 * como la web (/menu y /menu/recetas): el inicio y los avisos enlazan a las
 * dos. Las recetas son una seccion de aqui y no un modulo aparte: que lleva
 * un producto es parte de que es ese producto.
 *
 * Fuera del menu ("Lo que quitaste") no es una pestaña: es un enlace al pie
 * de las categorias, como en la web (Leider, 1-oct).
 */
type IdSeccion = 'menu' | 'recetas'

const SECCIONES: { id: IdSeccion; texto: string }[] = [
  { id: 'menu', texto: 'El menú' },
  { id: 'recetas', texto: 'Recetas' },
]

export default function PantallaMenu() {
  const { seccion: pedida } = useLocalSearchParams<{ seccion?: string }>()
  const seccion: IdSeccion = pedida === 'recetas' ? 'recetas' : 'menu'
  const { datos, error, refrescando, recargar, refrescar } = useDatosMenu()
  const tostada = useTostada()
  const { acceso } = useSesion()
  // Cambiar varios precios diciéndolo (CambiarPrecios.tsx): solo para quien
  // entra al menú, como el botón junto al buscador de la web.
  const puedePrecios = acceso?.puede.modulos.includes('menu') ?? false
  const [cambiandoPrecios, setCambiandoPrecios] = useState(false)

  return (
    <Pantalla
      refrescando={refrescando}
      alRefrescar={() => void refrescar()}
      abajo={tostada.nodo}
      arriba={<Pestanas opciones={SECCIONES} valor={seccion} alCambiar={(id) => router.setParams({ seccion: id })} />}
    >
      <Stack.Screen options={{ title: 'Menú' }} />
      {error && !datos ? <Problema mensaje={error} alReintentar={() => void refrescar()} /> : null}
      {!datos && !error ? <Cargando /> : null}
      {datos && seccion === 'menu' && puedePrecios ? (
        <>
          {/* Ancla de la guía: el mismo `data-guia` que el botón de la web. */}
          <Ancla nombre="menu.cambiar-precios">
            <Boton texto="Cambiar precios" tono="neutro" icono="chispa" alTocar={() => setCambiandoPrecios(true)} />
          </Ancla>
          <CambiarPrecios visible={cambiandoPrecios} alCerrar={() => setCambiandoPrecios(false)} onCambio={refrescar} />
        </>
      ) : null}
      {datos && seccion === 'menu' ? (
        <ElMenu
          datos={datos}
          recargar={recargar}
          tostada={tostada}
          alCrearProducto={(varianteId) => {
            // Como la web: el producto nuevo abre su receta encima de la
            // lista de Recetas, y al cerrarla se vuelve ahi.
            router.setParams({ seccion: 'recetas' })
            router.push(`/menu/recetas/${varianteId}` as Href)
          }}
        />
      ) : null}
      {datos && seccion === 'recetas' ? <Recetas datos={datos} /> : null}
    </Pantalla>
  )
}
