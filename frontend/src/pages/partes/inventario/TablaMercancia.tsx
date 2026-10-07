import { useMemo, useState } from 'react'
import AccionFila from '../../../components/AccionFila'
import { Tabla, Th, useOrden } from '../../../components/Tabla'
import { FiltroDesplegable, Pastilla, Vacio, Boton } from '../../../components/ui'
import { useAltoRestante } from '../../../lib/altoRestante'
import { cantidad, estadoStock } from '../../../lib/inventario'
import { useMoneda } from '../../../lib/moneda'
import { nombre } from '../../../lib/palabras'
import { ALMACEN_DE } from '../../../lib/tiposArticulo'
import type { CategoriaInsumo, Ingrediente, TipoArticulo } from '../../../lib/types'
import type { ResumenAlmacen } from './Almacenes'

/**
 * La mercancía de UN almacén, en una tabla que cabe en la pantalla. Un toque
 * en la fila abre la ficha. Las columnas dependen de lo que es: solo la
 * materia prima tiene merma de cocina ("aprovechable") y costo real.
 */

type Filtro = 'todos' | 'bajo' | 'sin-costo' | 'archivados'
const SIN_CATEGORIA = '__sin_categoria__'
const ADMINISTRAR = '__administrar__'

export default function TablaMercancia({
  tipo,
  resumen,
  ingredientes,
  categorias,
  onAbrir,
  onReactivar,
  onNueva,
  onCategorias,
}: {
  tipo: TipoArticulo
  /** Las cifras del almacén: van chicas en la barra, son complemento de la tabla. */
  resumen?: ResumenAlmacen
  /** Todas las de este tipo, activas y archivadas. */
  ingredientes: Ingrediente[]
  categorias: CategoriaInsumo[]
  onAbrir: (id: number) => void
  onReactivar: (ing: Ingrediente) => void
  onNueva: () => void
  onCategorias: () => void
}) {
  const { fmt: dinero } = useMoneda()
  const lista = useAltoRestante<HTMLDivElement>()
  const [buscar, setBuscar] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [categoria, setCategoria] = useState('todas')
  const esMateria = tipo === 'insumo'

  const orden = useOrden<Ingrediente>(
    {
      nombre: (i) => i.nombre,
      stock: (i) => i.stock_actual,
      minimo: (i) => i.stock_minimo,
      costo: (i) => i.costo_unitario,
      reponer: (i) => i.costo_reposicion,
      rendimiento: (i) => i.rendimiento_pct,
      real: (i) => i.costo_efectivo,
      vale: (i) => Math.max(i.stock_actual, 0) * (i.costo_unitario || 0),
    },
    'nombre',
  )

  const activos = ingredientes.filter((i) => i.activo !== false)
  const archivados = ingredientes.length - activos.length
  const bajo = activos.filter((i) => i.stock_actual <= i.stock_minimo).length
  const sinCosto = activos.filter((i) => !i.costo_unitario).length
  const haySinCategoria = activos.some((i) => !i.categoria_id)
  // Solo los cajones que tienen algo de ESTE almacén.
  const cats = categorias.filter((c) => ingredientes.some((i) => i.categoria_id === c.id))

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    return ingredientes.filter((i) => {
      if (filtro === 'archivados') {
        if (i.activo !== false) return false
      } else if (i.activo === false) return false
      if (filtro === 'bajo' && i.stock_actual > i.stock_minimo) return false
      if (filtro === 'sin-costo' && i.costo_unitario) return false
      if (categoria === SIN_CATEGORIA && i.categoria_id) return false
      if (categoria !== 'todas' && categoria !== SIN_CATEGORIA && String(i.categoria_id) !== categoria) return false
      return !q || i.nombre.toLowerCase().includes(q)
    })
  }, [ingredientes, filtro, buscar, categoria])

  const a = ALMACEN_DE[tipo]
  const columnas = esMateria ? 8 : 7

  return (
    <div className="space-y-3">
      <div className="vp-losa p-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          placeholder={`Buscar en ${a.texto.toLowerCase()}…`}
          className="border border-neutral-300 rounded-lg px-3 py-2 text-sm w-full sm:w-56 shrink-0"
        />
        <FiltroDesplegable
          etiqueta="Ver"
          valor={filtro}
          alCambiar={(v) => setFiltro(v as Filtro)}
          opciones={[
            { valor: 'todos', texto: 'Todas' },
            { valor: 'bajo', texto: 'Bajo mínimo', contador: bajo },
            { valor: 'sin-costo', texto: 'Sin costo', contador: sinCosto },
            ...(archivados > 0 ? [{ valor: 'archivados', texto: 'Archivadas', contador: archivados }] : []),
          ]}
        />
        {(cats.length > 0 || haySinCategoria) && (
          <FiltroDesplegable
            etiqueta="Categoría"
            valor={categoria}
            alCambiar={(v) => (v === ADMINISTRAR ? onCategorias() : setCategoria(v))}
            opciones={[
              { valor: 'todas', texto: 'Todas' },
              ...cats.map((c) => ({ valor: String(c.id), texto: c.nombre, contador: ingredientes.filter((i) => i.categoria_id === c.id && i.activo !== false).length })),
              ...(haySinCategoria ? [{ valor: SIN_CATEGORIA, texto: 'Sin categoría', contador: activos.filter((i) => !i.categoria_id).length }] : []),
              { valor: ADMINISTRAR, texto: 'Administrar categorías…', detalle: 'crear, renombrar, mover mercancía' },
            ]}
          />
        )}
        {/* Las cifras del almacén, chicas y a la derecha: complementan la
            tabla, no la tapan (Leider, 7-oct). Bajo mínimo filtra al tocar. */}
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500 tabular-nums">
          {resumen && (
            <>
              <span>
                <b className="text-neutral-900 text-sm">{dinero(resumen.plata)}</b> en el depósito
              </span>
              <button
                type="button"
                onClick={() => setFiltro(filtro === 'bajo' ? 'todos' : 'bajo')}
                className={`${resumen.bajoMinimo > 0 ? 'text-aviso-700 font-semibold' : 'text-exito-700'} hover:underline`}
              >
                {resumen.bajoMinimo > 0 ? `${resumen.bajoMinimo} bajo mínimo` : 'nada bajo mínimo'}
              </button>
              {resumen.sinCosto > 0 && (
                <button type="button" onClick={() => setFiltro(filtro === 'sin-costo' ? 'todos' : 'sin-costo')} className="text-aviso-700 hover:underline">
                  {resumen.sinCosto} sin costo
                </button>
              )}
            </>
          )}
          <span>
            {visibles.length} de {activos.length}
          </span>
        </div>
      </div>

      <div ref={lista.ref} style={lista.alto ? { height: lista.alto } : undefined}>
        <Tabla orden={orden} glosario="inventario" className={`vp-losa overflow-hidden ${lista.alto ? 'h-full overflow-auto' : ''}`}>
          <table className="w-full text-sm">
            <thead
              className="sticky top-0 z-[1] text-neutral-500 text-xs"
              style={{ background: 'color-mix(in oklab, var(--vp-tinta) 4%, var(--vp-superficie))' }}
            >
              <tr>
                <Th clave="nombre">Mercancía</Th>
                <Th clave="stock" alinear="derecha">{nombre('inventario.stock')}</Th>
                <Th clave="minimo" alinear="derecha">Mínimo</Th>
                <Th clave="costo" alinear="derecha">{nombre('inventario.costo')}</Th>
                <Th clave="reponer" alinear="derecha">{nombre('inventario.reponer')}</Th>
                {esMateria ? (
                  <>
                    <Th clave="rendimiento" alinear="derecha">{nombre('inventario.rendimiento')}</Th>
                    <Th clave="real" alinear="derecha">Costo real</Th>
                  </>
                ) : (
                  <Th clave="vale" alinear="derecha">Vale</Th>
                )}
                <th aria-label="Abrir" className="w-8" />
              </tr>
            </thead>
            <tbody>
              {visibles.length === 0 && (
                <tr>
                  <td colSpan={columnas}>
                    <Vacio
                      icono={a.icono}
                      titulo={ingredientes.length === 0 ? `Todavía no hay ${a.texto.toLowerCase()}` : 'Nada con ese filtro'}
                      detalle={ingredientes.length === 0 ? `${a.detalle} Ej.: ${a.ejemplo}.` : undefined}
                      accion={ingredientes.length === 0 ? <Boton onClick={onNueva}>+ Nueva mercancía</Boton> : undefined}
                    />
                  </td>
                </tr>
              )}
              {orden.ordenar(visibles).map((ing) => {
                const estado = estadoStock(ing)
                const archivado = ing.activo === false
                return (
                  <tr
                    key={ing.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onAbrir(ing.id)}
                    onKeyDown={(e) => e.key === 'Enter' && onAbrir(ing.id)}
                    className={`vp-celda cursor-pointer border-t border-neutral-100 ${archivado ? 'opacity-60' : ''}`}
                  >
                    <td className="p-3">
                      <span className="block font-medium">{ing.nombre}</span>
                      <span className="block text-[11px] text-neutral-400 mt-0.5">
                        {ing.categoria && <span className="text-neutral-500 font-medium">{ing.categoria} · </span>}
                        por {ing.unidad}
                        {ing.es_indirecto && ' · costo indirecto'}
                      </span>
                    </td>
                    <td className="text-right p-3 tabular-nums whitespace-nowrap">
                      <span className={estado ? 'font-semibold' : ''}>
                        {cantidad(ing.stock_actual)} {ing.unidad}
                      </span>
                      {estado && (
                        <span className="ml-2 align-middle">
                          <Pastilla tono={estado.tono}>{estado.texto}</Pastilla>
                        </span>
                      )}
                    </td>
                    <td className="text-right p-3 text-neutral-500 tabular-nums">
                      {cantidad(ing.stock_minimo)} {ing.unidad}
                    </td>
                    <td className="text-right p-3 tabular-nums">
                      {ing.costo_unitario ? dinero(ing.costo_unitario) : <span className="text-aviso-600 font-semibold">cargar</span>}
                    </td>
                    <td className="text-right p-3 tabular-nums">
                      {ing.costo_reposicion != null ? (
                        <>
                          <span className={ing.variacion_pct != null && ing.variacion_pct >= 15 ? 'text-aviso-600 font-semibold' : ''}>
                            {dinero(ing.costo_reposicion)}
                          </span>
                          {ing.variacion_pct != null && ing.variacion_pct >= 15 && (
                            <span className="block text-[11px] text-aviso-600">+{ing.variacion_pct.toFixed(0)}%</span>
                          )}
                        </>
                      ) : (
                        <span className="text-neutral-300">—</span>
                      )}
                    </td>
                    {esMateria ? (
                      <>
                        <td className="text-right p-3 tabular-nums">
                          <span className={ing.rendimiento_pct < 100 ? 'text-aviso-600 font-medium' : 'text-neutral-400'}>{ing.rendimiento_pct}%</span>
                        </td>
                        <td className="text-right p-3 tabular-nums font-semibold">{dinero(ing.costo_efectivo)}</td>
                      </>
                    ) : (
                      <td className="text-right p-3 tabular-nums font-semibold">
                        {dinero(Math.max(ing.stock_actual, 0) * (ing.costo_unitario || 0))}
                      </td>
                    )}
                    <td className="p-3 pr-4 text-right">
                      {archivado ? (
                        <span onClick={(e) => e.stopPropagation()}>
                          <AccionFila onClick={() => onReactivar(ing)}>Reactivar</AccionFila>
                        </span>
                      ) : (
                        <span aria-hidden className="text-neutral-300 text-lg leading-none">›</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Tabla>
      </div>
    </div>
  )
}
