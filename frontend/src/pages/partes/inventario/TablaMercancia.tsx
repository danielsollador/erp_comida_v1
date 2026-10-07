import { useMemo, useState, type ReactNode } from 'react'
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
  acciones,
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
  /** Contar y crear: viven en la barra de la tabla. */
  acciones?: ReactNode
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
      {/* TRES CUADROS EN UNA LINEA, cada uno con lo suyo: filtrar, las
          cifras del almacén, y las acciones. Nada comparte cuadro con nada
          (Leider, 7-oct). */}
      <div className="flex flex-wrap xl:flex-nowrap items-stretch gap-3">
        <div className="vp-losa p-2.5 flex flex-wrap items-center gap-2 flex-1 min-w-[18rem]">
          <input
            type="search"
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder={`Buscar en ${a.texto.toLowerCase()}…`}
            className="border border-neutral-300 rounded-lg px-3 py-2 text-sm w-full sm:w-44 shrink-0"
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
        </div>
        {resumen && (
          <div className="vp-losa p-2.5 grid grid-cols-4 gap-2 flex-1 min-w-[22rem]">
            <Cuadrito titulo="Mercancías" valor={String(visibles.length === activos.length ? activos.length : `${visibles.length} de ${activos.length}`)} />
            <Cuadrito titulo="En el depósito" valor={dinero(resumen.plata)} />
            <Cuadrito
              titulo="Bajo mínimo"
              valor={String(resumen.bajoMinimo)}
              tono={resumen.bajoMinimo > 0 ? 'ojo' : 'bien'}
              alTocar={() => setFiltro(filtro === 'bajo' ? 'todos' : 'bajo')}
              activo={filtro === 'bajo'}
            />
            <Cuadrito
              titulo="Sin costo"
              valor={String(resumen.sinCosto)}
              tono={resumen.sinCosto > 0 ? 'ojo' : undefined}
              alTocar={() => setFiltro(filtro === 'sin-costo' ? 'todos' : 'sin-costo')}
              activo={filtro === 'sin-costo'}
            />
          </div>
        )}
        {acciones && <div className="vp-losa p-2.5 flex items-center gap-2 shrink-0">{acciones}</div>}
      </div>

      <div ref={lista.ref} style={lista.alto ? { height: lista.alto } : undefined}>
        <Tabla orden={orden} glosario="inventario" className={`vp-losa ${lista.alto ? 'h-full overflow-auto' : 'overflow-hidden'}`}>
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

/** Una cifra chica del almacén, en la barra. Las que filtran se tocan. */
function Cuadrito({
  titulo,
  valor,
  tono,
  alTocar,
  activo = false,
}: {
  titulo: string
  valor: string
  tono?: 'ojo' | 'bien'
  alTocar?: () => void
  activo?: boolean
}) {
  const color = tono === 'ojo' ? 'text-aviso-700' : tono === 'bien' ? 'text-exito-700' : 'text-neutral-900'
  const cuerpo = (
    <>
      <span className="block text-[11px] text-neutral-500 leading-tight truncate">{titulo}</span>
      <span className={`block font-display text-base font-semibold tabular-nums leading-tight mt-0.5 truncate ${color}`}>{valor}</span>
    </>
  )
  const clase = `rounded-xl px-2.5 py-1.5 text-left min-w-0 ${activo ? 'bg-neutral-900/8 ring-1 ring-neutral-900/20' : 'bg-neutral-500/6'}`
  return alTocar ? (
    <button type="button" onClick={alTocar} aria-pressed={activo} className={`${clase} vp-pulsable hover:bg-neutral-500/10`}>
      {cuerpo}
    </button>
  ) : (
    <div className={clase}>{cuerpo}</div>
  )
}
