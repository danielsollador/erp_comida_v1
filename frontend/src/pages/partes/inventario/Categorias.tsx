import { useState, type ReactNode } from 'react'
import Agarre from '../../../components/Agarre'
import MenuAcciones from '../../../components/MenuAcciones'
import { useDeshacer } from '../../../components/Deshacer'
import { useDialogo } from '../../../components/dialogo'
import { Aviso, Seccion, Vacio } from '../../../components/ui'
import { api } from '../../../lib/api'
import { useArrastre } from '../../../lib/arrastre'
import { datosDe } from '../../../lib/inventario'
import { ALMACEN_DE } from '../../../lib/tiposArticulo'
import type { CategoriaInsumo, Ingrediente } from '../../../lib/types'

/**
 * SUBMODULO DE CATEGORIAS. Deliberadamente igual al de Menu.
 *
 * Misma forma: la columna de categorias a la izquierda --cada una con lo que
 * tiene dentro y su menu de "⋯"-- y a la derecha lo que hay en la elegida. El
 * boton de crear es el mismo rectangulo punteado al pie de la columna, y el
 * menu de acciones es literalmente el mismo componente
 * (`components/MenuAcciones`), no uno parecido.
 *
 * POR QUE ASI. Leider (24-sep): "no puede ser que el cliente tenga que
 * aprender de forma distinta como crear para cada modulo". Quien ya organizo
 * el menu sabe organizar el deposito sin que nadie le explique nada: se crea
 * igual, se renombra igual y se borra igual.
 *
 * LA DIFERENCIA CON EL MENU, y es de fondo: un producto SIEMPRE pertenece a
 * una categoria; una mercancia puede no tener ninguna, y eso es normal --se
 * carga una factura a las prisas y se clasifica despues--. Por eso la columna
 * tiene un cajon mas, "Sin categoría", que no se puede renombrar ni borrar
 * porque no es una categoria: es la ausencia de una.
 */
const SIN_CAJON = -1

export default function SeccionCategorias({
  categorias,
  ingredientes,
  onCambio,
}: {
  categorias: CategoriaInsumo[]
  ingredientes: Ingrediente[]
  onCambio: () => Promise<void>
}) {
  const dialogo = useDialogo()
  const [elegida, setElegida] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)

  /**
   * Arrastrar una mercancia hasta un cajon de la columna.
   *
   * La MISMA primitiva que el menu (`lib/arrastre`), que va por eventos de
   * puntero y no por el arrastre de HTML: el de HTML no existe en pantallas
   * tactiles, y esto se usa en tablets. Soltar sobre "Sin categoría" la saca
   * de donde estuviera, que es como se deshace sin tener que buscar un menu.
   */
  const arrastre = useArrastre<Ingrediente>(async (ing, destino) => {
    const id = Number(destino.replace('cajon-', ''))
    if (!Number.isFinite(id)) return
    const nuevo = id === SIN_CAJON ? null : id
    if ((ing.categoria_id ?? null) === nuevo) return
    await intentar(() => api.actualizarIngrediente(ing.id, { ...datosDe(ing), categoria_id: nuevo }))
  })

  const activos = ingredientes.filter((i) => i.activo !== false)
  const sinCajon = activos.filter((i) => !i.categoria_id)
  const actual = elegida ?? (categorias[0]?.id ?? (sinCajon.length ? SIN_CAJON : null))
  const dentro =
    actual === SIN_CAJON ? sinCajon : activos.filter((i) => i.categoria_id === actual)
  const nombreActual =
    actual === SIN_CAJON ? 'Sin categoría' : categorias.find((c) => c.id === actual)?.nombre ?? ''

  const { deshacible, oculto } = useDeshacer()

  async function intentar(accion: () => Promise<unknown>) {
    setOcupado(true)
    setError('')
    try {
      await accion()
      await onCambio()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo')
    }
    setOcupado(false)
  }

  async function crear() {
    const nombre = await dialogo.pedirTexto({
      titulo: 'Nueva categoría',
      texto: 'Un cajón del depósito: Carnes, Lácteos, Empaques…',
      etiqueta: 'Nombre',
    })
    if (!nombre?.trim()) return
    await intentar(async () => {
      const cat = await api.crearCategoriaInsumo(nombre)
      setElegida(cat.id)
    })
  }

  async function renombrar(c: CategoriaInsumo) {
    const nombre = await dialogo.pedirTexto({
      titulo: `Renombrar «${c.nombre}»`,
      texto: 'Se cambia en toda su mercancía. Si le pones el nombre de otra categoría, las dos se juntan en una.',
      etiqueta: 'Nombre',
      valor: c.nombre,
    })
    if (!nombre?.trim() || nombre.trim() === c.nombre) return
    await intentar(() => api.renombrarCategoriaInsumo(c.id, nombre))
  }

  function borrar(c: CategoriaInsumo) {
    // La mercancia no se borra (queda sin cajon), asi que basta con poder
    // deshacer unos segundos: la categoria se esconde ya y se borra despues.
    setElegida(null)
    deshacible({
      clave: `cajon:${c.id}`,
      texto: c.usos ? `Categoría «${c.nombre}» borrada · ${c.usos} sin categoría` : `Categoría «${c.nombre}» borrada`,
      ejecutar: () => api.borrarCategoriaInsumo(c.id),
      alTerminar: () => void onCambio(),
      alFallar: (e) => setError(e instanceof Error ? e.message : 'No se pudo'),
    })
  }

  /** Mover una mercancia de cajon: la misma accion que en su ficha. */
  async function mover(ing: Ingrediente) {
    const destino = await dialogo.elegir({
      titulo: `¿A qué categoría va «${ing.nombre}»?`,
      opciones: [
        ...categorias
          .filter((c) => c.id !== ing.categoria_id)
          .map((c) => ({ valor: String(c.id), texto: c.nombre })),
        ...(ing.categoria_id ? [{ valor: '', texto: 'Sin categoría' }] : []),
      ],
    })
    if (destino === null) return
    await intentar(() =>
      api.actualizarIngrediente(ing.id, {
        ...datosDe(ing),
        categoria_id: destino === '' ? null : Number(destino),
      }),
    )
  }

  const fila = (id: number, nombre: string, cuantos: number, acciones: ReactNode) => {
    const activa = id === actual
    const encima = arrastre.sobre === `cajon-${id}` && arrastre.carga !== null
    return (
      <div
        key={id}
        data-soltar={`cajon-${id}`}
        className={`group flex items-center gap-1 rounded-xl shrink-0 md:shrink transition ${
          encima ? 'bg-acento-50 ring-2 ring-acento-400' : activa ? 'bg-neutral-100' : 'hover:bg-neutral-50'
        }`}
      >
        <button
          onClick={() => setElegida(id)}
          aria-current={activa ? 'true' : undefined}
          className="flex-1 min-w-0 text-left px-2 py-2.5 min-h-[40px]"
        >
          <span className={`block truncate text-sm ${activa ? 'font-semibold' : ''}`}>{nombre}</span>
          <span className="block text-[11px] text-neutral-400">
            {cuantos} mercancía(s)
          </span>
        </button>
        {acciones}
      </div>
    )
  }

  return (
    <>
      {error && <Aviso>{error}</Aviso>}
      <div className="grid grid-cols-1 md:grid-cols-[15rem_1fr] lg:grid-cols-[17rem_1fr] gap-4 lg:gap-5 items-start">
        <div className="bg-white rounded-2xl border border-neutral-200 p-2 md:sticky md:top-[84px]">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400 px-2 pt-1.5 pb-2">
            Categorías
          </p>
          <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-1 md:pb-0">
            {categorias.filter((c) => !oculto(`cajon:${c.id}`)).map((c) =>
              fila(
                c.id,
                c.nombre,
                c.usos,
                <MenuAcciones
                  etiqueta={`Opciones de ${c.nombre}`}
                  opciones={[
                    { texto: 'Renombrar', onElegir: () => renombrar(c) },
                    { texto: 'Borrar la categoría', peligro: true, onElegir: () => borrar(c) },
                  ]}
                />,
              ),
            )}
            {sinCajon.length > 0 &&
              fila(SIN_CAJON, 'Sin categoría', sinCajon.length, <span className="w-9 shrink-0" />)}
          </div>

          <div className="p-2 pt-2.5 mt-1 border-t border-neutral-100">
            <button
              onClick={crear}
              disabled={ocupado}
              className="w-full rounded-lg border border-dashed border-neutral-300 py-2.5 text-sm font-medium text-neutral-500 hover:border-neutral-400 hover:text-neutral-900 disabled:opacity-40"
            >
              + Categoría
            </button>
          </div>
        </div>

        <Seccion
          titulo={nombreActual || 'Categorías del depósito'}
          ayuda={
            actual === SIN_CAJON
              ? 'Mercancía que todavía no está en ningún cajón. Es normal: se carga una factura a las prisas y se clasifica después. Arrástrala a una categoría de la izquierda.'
              : 'Lo que hay en este cajón del depósito. Arrastra un renglón a otra categoría para moverlo.'
          }
          plano
        >
          {dentro.length === 0 ? (
            <Vacio
              icono="inventario"
              titulo={categorias.length === 0 ? 'Todavía no hay categorías' : 'Esta categoría está vacía'}
              detalle={
                categorias.length === 0
                  ? 'Crea la primera con «+ Categoría» y después trae aquí la mercancía que le toca.'
                  : 'Arrastra mercancía hasta esta categoría desde otra, o usa «Mover a…» en cada renglón.'
              }
            />
          ) : (
            <ul className="divide-y divide-neutral-100">
              {dentro.map((i) => (
                <li key={i.id} className="flex items-center gap-2 px-2 py-2.5 sm:px-4 sm:gap-3">
                  {/* El agarre es suyo y no de toda la fila, igual que en el
                      menu: tocar la fila no puede empezar un arrastre sin
                      querer. */}
                  <button
                    aria-label={`Mover ${i.nombre} de categoría`}
                    onPointerDown={(e) => arrastre.empezar(e, i)}
                    className="hidden md:grid place-items-center w-7 h-10 shrink-0 text-neutral-300 hover:text-neutral-500 cursor-grab touch-none"
                  >
                    <Agarre />
                  </button>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium truncate">{i.nombre}</span>
                    <span className="block text-[11px] text-neutral-400">
                      {ALMACEN_DE[i.tipo].texto} · por {i.unidad}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => mover(i)}
                    disabled={ocupado}
                    className="shrink-0 text-xs font-medium text-neutral-600 hover:text-neutral-900 disabled:opacity-40"
                  >
                    Mover a…
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Seccion>
      </div>

      {/* Lo que va en el aire, pegado al dedo: sin esto, arrastrar no se ve
          hasta soltar y no se sabe si el gesto fue tomado. */}
      {arrastre.carga && arrastre.punto && (
        <div
          className="fixed z-50 pointer-events-none rounded-xl bg-neutral-900 text-white text-sm font-medium px-3 py-2 shadow-xl"
          style={{ left: arrastre.punto.x + 12, top: arrastre.punto.y - 14 }}
        >
          {arrastre.carga.nombre}
        </div>
      )}
    </>
  )
}
