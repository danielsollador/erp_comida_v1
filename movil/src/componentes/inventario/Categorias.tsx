import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { datosDe } from '../../../../frontend/src/lib/inventario'
import { ALMACEN_DE } from '../../../../frontend/src/lib/tiposArticulo'
import { apiInventario } from '../../lib/api-inventario'
import { confirmar } from '../../lib/dialogo'
import { LETRA, useTema } from '../../lib/tema'
import type { CategoriaInsumo, Ingrediente } from '../../lib/tipos'
import { Hoja, OpcionHoja } from '../Hoja'
import { ListaFicha, useDisposicion, Vacio } from '../kit'
import { Aviso } from '../ui'
import { Enlace, mensaje, PuntoTipo } from './comun'
import { usePedir } from './Pedir'

/*
 * LAS CATEGORIAS DEL INVENTARIO (pages/partes/inventario/Categorias.tsx):
 * los cajones donde vive la mercancia. Se crean, se renombran y se borran
 * igual que las del menu; la mercancia se mueve de cajon con "Mover a…".
 *
 * Una mercancia puede no tener categoria, y eso es normal (se carga una
 * factura a las prisas y se clasifica despues): por eso hay un cajon mas,
 * "Sin categoría", que no se renombra ni se borra porque no es una
 * categoria, es la ausencia de una.
 *
 * En la web la mercancia tambien se arrastra hasta un cajon; en el telefono
 * arrastrar dentro de una lista que se desliza es fragil, asi que se mueve
 * con "Mover a…", que la web tambien tiene en cada renglon.
 *
 * En la tablet, la columna de categorias a la izquierda y lo que hay en la
 * elegida a la derecha, como la web; en el telefono, una debajo de la otra.
 */
const SIN_CAJON = -1

export default function Categorias({
  categorias,
  ingredientes,
  alCambio,
}: {
  categorias: CategoriaInsumo[]
  ingredientes: Ingrediente[]
  alCambio: () => void
}) {
  const t = useTema()
  const { tablet } = useDisposicion()
  const { pedirTexto, hoja } = usePedir()
  const [elegida, setElegida] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [hecho, setHecho] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [menu, setMenu] = useState<CategoriaInsumo | null>(null)
  const [moviendo, setMoviendo] = useState<Ingrediente | null>(null)

  const activos = ingredientes.filter((i) => i.activo !== false)
  const sinCajon = activos.filter((i) => !i.categoria_id)
  const existe = (id: number | null) => id !== null && (id === SIN_CAJON ? sinCajon.length > 0 : categorias.some((c) => c.id === id))
  const actual = existe(elegida) ? elegida : (categorias[0]?.id ?? (sinCajon.length ? SIN_CAJON : null))
  const dentro = actual === SIN_CAJON ? sinCajon : activos.filter((i) => i.categoria_id === actual)
  const nombreActual = actual === SIN_CAJON ? 'Sin categoría' : (categorias.find((c) => c.id === actual)?.nombre ?? '')

  async function intentar(accion: () => Promise<unknown>, listo?: string) {
    setOcupado(true)
    setError('')
    setHecho('')
    try {
      await accion()
      if (listo) setHecho(listo)
      alCambio()
    } catch (e) {
      setError(mensaje(e, 'No se pudo'))
    }
    setOcupado(false)
  }

  async function crear() {
    const nombre = await pedirTexto({
      titulo: 'Nueva categoría',
      texto: 'Un cajón del inventario: Carnes, Lácteos, Empaques…',
      etiqueta: 'Nombre',
      aceptar: 'Crear',
    })
    if (!nombre?.trim()) return
    await intentar(async () => {
      const cat = await apiInventario.crearCategoria(nombre)
      setElegida(cat.id)
    })
  }

  async function renombrar(cat: CategoriaInsumo) {
    const nombre = await pedirTexto({
      titulo: `Renombrar «${cat.nombre}»`,
      texto: 'Se cambia en toda su mercancía. Si le pones el nombre de otra categoría, las dos se juntan en una.',
      etiqueta: 'Nombre',
      valor: cat.nombre,
      aceptar: 'Renombrar',
    })
    if (!nombre?.trim() || nombre.trim() === cat.nombre) return
    await intentar(async () => {
      const queda = await apiInventario.renombrarCategoria(cat.id, nombre)
      setElegida(queda.id)
    })
  }

  // La web la esconde ya y da unos segundos para deshacer; aqui no hay
  // "Deshacer", asi que se pregunta antes. La mercancia no se borra: queda
  // sin categoria.
  async function borrar(cat: CategoriaInsumo) {
    const ok = await confirmar({
      titulo: `¿Borrar la categoría «${cat.nombre}»?`,
      texto: cat.usos
        ? `Su mercancía (${cat.usos}) no se borra: queda sin categoría.`
        : 'Está vacía: no se mueve ninguna mercancía.',
      aceptar: 'Borrar',
      peligro: true,
    })
    if (!ok) return
    await intentar(async () => {
      await apiInventario.borrarCategoria(cat.id)
      setElegida(null)
    }, cat.usos ? `Categoría «${cat.nombre}» borrada · ${cat.usos} sin categoría` : `Categoría «${cat.nombre}» borrada`)
  }

  /** Mover una mercancia de cajon: la misma accion que en su ficha. */
  async function mover(ing: Ingrediente, destino: number | null) {
    setMoviendo(null)
    await intentar(() => apiInventario.actualizar(ing.id, { ...datosDe(ing), categoria_id: destino }))
  }

  const fila = (id: number, nombre: string, cuantos: number, conMenu?: CategoriaInsumo, ultima = false) => {
    const activa = id === actual
    return (
      <View
        key={id}
        style={[
          s.cajon,
          { backgroundColor: activa ? t.gris100 : 'transparent' },
          !ultima && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 },
        ]}
      >
        <Pressable
          onPress={() => setElegida(id)}
          accessibilityRole="button"
          accessibilityState={{ selected: activa }}
          style={({ pressed }) => [s.cajonBoton, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={[s.cajonNombre, { color: t.tinta, fontFamily: activa ? LETRA.textoFuerte : LETRA.texto }]} numberOfLines={1}>
            {nombre}
          </Text>
          <Text style={[s.cajonCuenta, { color: t.tenue }]}>
            {cuantos} {cuantos === 1 ? 'mercancía' : 'mercancías'}
          </Text>
        </Pressable>
        {conMenu ? (
          <Pressable
            onPress={() => setMenu(conMenu)}
            accessibilityLabel={`Opciones de ${conMenu.nombre}`}
            hitSlop={4}
            style={({ pressed }) => [s.mas, { backgroundColor: pressed ? t.gris200 : 'transparent' }]}
          >
            <Text style={[s.masTexto, { color: t.suave }]}>⋯</Text>
          </Pressable>
        ) : (
          <View style={s.mas} />
        )}
      </View>
    )
  }

  const columna = (
    <ListaFicha titulo="Categorías">
      {categorias.map((cat, i) => fila(cat.id, cat.nombre, cat.usos, cat, i === categorias.length - 1 && sinCajon.length === 0))}
      {sinCajon.length > 0 ? fila(SIN_CAJON, 'Sin categoría', sinCajon.length, undefined, true) : null}
      <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 }}>
        <Pressable
          onPress={() => void crear()}
          disabled={ocupado}
          accessibilityRole="button"
          style={({ pressed }) => [s.nueva, { borderColor: t.barra, opacity: ocupado ? 0.4 : pressed ? 0.6 : 1 }]}
        >
          <Text style={[s.nuevaTexto, { color: t.suave }]}>+ Categoría</Text>
        </Pressable>
      </View>
    </ListaFicha>
  )

  const contenido =
    dentro.length === 0 ? (
      <Vacio
        icono="inventario"
        titulo={categorias.length === 0 ? 'Todavía no hay categorías' : 'Esta categoría está vacía'}
        detalle={
          categorias.length === 0
            ? 'Crea la primera con «+ Categoría» y después trae aquí la mercancía que le toca.'
            : 'Trae mercancía hasta esta categoría con «Mover a…» desde otra.'
        }
      />
    ) : (
      <ListaFicha titulo={nombreActual || 'Categorías del inventario'}>
        <Text style={[s.ayuda, { color: t.suave }]}>
          {actual === SIN_CAJON
            ? 'Mercancía que todavía no está en ningún cajón. Es normal: se carga una factura a las prisas y se clasifica después. Muévela a una categoría con «Mover a…».'
            : 'Lo que hay en este cajón del inventario. Con «Mover a…» la pasas a otra categoría.'}
        </Text>
        {dentro.map((i, n) => (
          <View
            key={i.id}
            style={[s.renglon, n < dentro.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 }]}
          >
            <PuntoTipo tipo={i.tipo} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[s.nombre, { color: t.tinta }]} numberOfLines={2}>
                {i.nombre}
              </Text>
              <Text style={[s.cajonCuenta, { color: t.tenue }]}>
                {ALMACEN_DE[i.tipo].texto} · por {i.unidad}
              </Text>
            </View>
            <Enlace texto="Mover a…" tono="neutro" alTocar={() => setMoviendo(i)} deshabilitado={ocupado} />
          </View>
        ))}
      </ListaFicha>
    )

  return (
    <>
      {error ? <Aviso texto={error} tono="peligro" /> : null}
      {hecho ? <Aviso texto={hecho} /> : null}
      {tablet ? (
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
          <View style={{ width: 290 }}>{columna}</View>
          <View style={{ flex: 1 }}>{contenido}</View>
        </View>
      ) : (
        <>
          {columna}
          {contenido}
        </>
      )}

      <Hoja visible={menu !== null} alCerrar={() => setMenu(null)} titulo={menu ? `Opciones de ${menu.nombre}` : undefined}>
        {menu ? (
          <>
            <OpcionHoja
              texto="Renombrar"
              alTocar={() => {
                const cat = menu
                setMenu(null)
                void renombrar(cat)
              }}
            />
            <OpcionHoja
              texto="Borrar la categoría"
              peligro
              alTocar={() => {
                const cat = menu
                setMenu(null)
                void borrar(cat)
              }}
            />
          </>
        ) : null}
      </Hoja>

      <Hoja visible={moviendo !== null} alCerrar={() => setMoviendo(null)} titulo={moviendo ? `¿A qué categoría va «${moviendo.nombre}»?` : undefined}>
        {moviendo ? (
          <>
            {categorias
              .filter((cat) => cat.id !== moviendo.categoria_id)
              .map((cat) => (
                <OpcionHoja key={cat.id} texto={cat.nombre} alTocar={() => void mover(moviendo, cat.id)} />
              ))}
            {moviendo.categoria_id ? <OpcionHoja texto="Sin categoría" alTocar={() => void mover(moviendo, null)} /> : null}
          </>
        ) : null}
      </Hoja>
      {hoja}
    </>
  )
}

const s = StyleSheet.create({
  cajon: { flexDirection: 'row', alignItems: 'center', paddingLeft: 16, paddingRight: 6 },
  cajonBoton: { flex: 1, minHeight: 52, justifyContent: 'center', paddingVertical: 8 },
  cajonNombre: { fontSize: 15 },
  cajonCuenta: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 1 },
  mas: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  masTexto: { fontFamily: LETRA.textoFuerte, fontSize: 20, lineHeight: 22 },
  nueva: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  nuevaTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14.5 },
  ayuda: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19, paddingHorizontal: 16, paddingBottom: 6 },
  renglon: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingRight: 12, minHeight: 56 },
  nombre: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
})
