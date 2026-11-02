import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { apiInventario } from '../../../lib/api-inventario'
import { useMoneda } from '../../../lib/moneda'
import { aNumero } from '../../../lib/numeros'
import { useTema } from '../../../lib/tema'
import type { Categoria, Ingrediente } from '../../../lib/tipos'
import { CampoNumero, HojaFormulario } from '../../kit'
import { Boton, Campo, Cargando, estilos } from '../../ui'
import { mensaje, Opciones } from '../comun'

/*
 * UNA MERCANCIA DE REVENTA (el refresco) PASA AL MENU de una vez: su
 * producto, su precio y su receta de 1 unidad (components/VenderEnMenu.tsx
 * de la web). Antes eran dos cosas que alguien tenia que unir a mano, nadie
 * lo hacia, y vender una Pepsi no descontaba la Pepsi.
 *
 * El margen que se muestra es la cuenta con el precio que se escribe; el
 * precio lo decide el dueño.
 */
export default function VenderEnMenu({
  mercancia,
  alHecho,
  alCerrar,
}: {
  mercancia: Ingrediente
  alHecho: () => void
  alCerrar: () => void
}) {
  const t = useTema()
  const { fmt } = useMoneda()
  const [categorias, setCategorias] = useState<Categoria[] | null>(null)
  const [categoriaId, setCategoriaId] = useState(0)
  const [nombre, setNombre] = useState(mercancia.nombre)
  const [precio, setPrecio] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    apiInventario
      .categoriasMenu()
      .then((cs) => {
        const activas = cs.filter((c) => c.activo !== false)
        setCategorias(activas)
        // Lo que se vende tal cual suele ir con las bebidas.
        setCategoriaId((activas.find((c) => c.bebida) ?? activas[0])?.id ?? 0)
      })
      .catch(() => {
        setCategorias([])
        setError('No se pudieron traer las categorías del menú.')
      })
  }, [])

  const precioNum = aNumero(precio)
  const costo = mercancia.costo_unitario || 0
  const margen = precioNum > 0 ? Math.round(((precioNum - costo) / precioNum) * 100) : null

  async function crear() {
    setError('')
    if (!categoriaId) return setError('Elige en qué categoría del menú va.')
    if (!(precioNum > 0)) return setError('Ponle precio de venta.')
    setGuardando(true)
    try {
      await apiInventario.alMenu(mercancia.id, { categoria_id: categoriaId, precio: precioNum, nombre: nombre.trim() })
      alHecho()
    } catch (e) {
      setError(mensaje(e, 'No se pudo crear'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <HojaFormulario
      visible
      alCerrar={alCerrar}
      titulo="Venderla en el menú"
      pie={
        <>
          <View style={{ flex: 1 }}>
            <Boton texto="Cancelar" tono="neutro" alTocar={alCerrar} />
          </View>
          <View style={{ flex: 1.4 }}>
            <Boton texto={guardando ? 'Creando…' : 'Agregar al menú'} alTocar={() => void crear()} deshabilitado={guardando} />
          </View>
        </>
      }
    >
      <Text style={[estilos.texto, { color: t.suave }]}>
        Se crea el producto con su receta de 1 {mercancia.unidad}: cada venta descuenta una del inventario.
      </Text>
      <Campo rotulo="Nombre en el menú" value={nombre} onChangeText={setNombre} />
      {categorias === null ? (
        <Cargando />
      ) : (
        <Opciones
          rotulo="Categoría"
          opciones={categorias.map((c) => ({ valor: String(c.id), texto: c.nombre }))}
          valor={String(categoriaId)}
          alCambiar={(v) => setCategoriaId(Number(v))}
        />
      )}
      <CampoNumero
        rotulo="Precio de venta ($)"
        prefijo="$"
        valor={precio}
        alCambiar={setPrecio}
        placeholder="0.00"
        // A perdida se lee en rojo, como en la web.
        error={margen !== null && margen < 0 ? `Cuesta ${fmt(costo)}: lo venderías a pérdida.` : undefined}
        ayuda={margen !== null ? `Cuesta ${fmt(costo)}: te deja ${margen} %.` : undefined}
      />
      {error ? <Text style={[estilos.nota, { color: t.peligro }]}>{error}</Text> : null}
    </HojaFormulario>
  )
}
