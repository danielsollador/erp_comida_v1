import { useMemo, useState, type ReactElement } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { estadoStock } from '../../../../frontend/src/lib/inventario'
import { ALMACEN_DE } from '../../../../frontend/src/lib/tiposArticulo'
import { useMoneda } from '../../lib/moneda'
import { LETRA, useTema } from '../../lib/tema'
import type { CategoriaInsumo, Ingrediente, TipoArticulo } from '../../lib/tipos'
import { Barra } from '../Encabezado'
import Icono from '../Icono'
import { BarraAccion, Buscador, FilaFiltros, llano, PantallaLista, Pastilla, Selector, useDisposicion, Vacio } from '../kit'
import { Boton, Cargando, Ficha, Problema, Pulsable } from '../ui'
import { cantidad, colorDe, ir, SelloAlmacen, unidadDe, usePalabra } from './comun'
import type { ResumenAlmacen } from './datos'

/*
 * LA MERCANCIA DE UN ALMACEN (pages/partes/inventario/TablaMercancia.tsx).
 *
 * En la web es una tabla; en el telefono una tabla se sale de la pantalla,
 * asi que cada mercancia es un renglon con lo mismo que la fila: el nombre,
 * cuanto hay (con su unidad en plural) y el aviso de bajo minimo a la
 * derecha; debajo los costos (promedio, "Costo última compra" y, en la
 * materia prima, lo aprovechable y el costo real). Los registros son los
 * protagonistas: buscar y filtrar arriba, las cifras del almacen en una
 * franja chica, y las acciones abajo al alcance del pulgar.
 */

type Filtro = 'todos' | 'bajo' | 'sin-costo' | 'archivados'
type Orden = 'nombre' | 'stock' | 'minimo' | 'costo' | 'reponer' | 'rendimiento' | 'real' | 'vale'
const SIN_CATEGORIA = '__sin_categoria__'
const ADMINISTRAR = '__administrar__'

const vale = (i: Ingrediente) => Math.max(i.stock_actual, 0) * (i.costo_unitario || 0)

export default function ListaMercancia({
  tipo,
  ingredientes,
  categorias,
  resumen,
  cargando,
  error,
  refrescando,
  alRefrescar,
  arriba,
  cabeceraExtra,
  alReactivar,
}: {
  tipo: TipoArticulo
  /** Todas las de este tipo, activas y archivadas. */
  ingredientes: Ingrediente[]
  categorias: CategoriaInsumo[]
  resumen?: ResumenAlmacen
  cargando: boolean
  error: string
  refrescando: boolean
  alRefrescar: () => void
  /** Lo que va arriba, antes de los filtros: el aviso de vender sin inventario, Crudo / Preparado. */
  cabeceraExtra?: ReactElement | null
  arriba?: ReactElement
  alReactivar: (ing: Ingrediente) => void
}) {
  const t = useTema()
  const { fmt } = useMoneda()
  const palabra = usePalabra()
  const { tablet } = useDisposicion()
  const [buscar, setBuscar] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [categoria, setCategoria] = useState('todas')
  const [orden, setOrden] = useState<Orden>('nombre')
  const esMateria = tipo === 'insumo'
  const a = ALMACEN_DE[tipo]

  const activos = ingredientes.filter((i) => i.activo !== false)
  const archivados = ingredientes.length - activos.length
  const bajo = activos.filter((i) => i.stock_actual <= i.stock_minimo).length
  const sinCosto = activos.filter((i) => !i.costo_unitario).length
  const haySinCategoria = activos.some((i) => !i.categoria_id)
  // Solo los cajones que tienen algo de ESTE almacen.
  const cats = categorias.filter((c) => ingredientes.some((i) => i.categoria_id === c.id))

  const visibles = useMemo(() => {
    const q = llano(buscar.trim())
    const lista = ingredientes.filter((i) => {
      if (filtro === 'archivados') {
        if (i.activo !== false) return false
      } else if (i.activo === false) return false
      if (filtro === 'bajo' && i.stock_actual > i.stock_minimo) return false
      if (filtro === 'sin-costo' && i.costo_unitario) return false
      if (categoria === SIN_CATEGORIA && i.categoria_id) return false
      if (categoria !== 'todas' && categoria !== SIN_CATEGORIA && String(i.categoria_id) !== categoria) return false
      return !q || llano(i.nombre).includes(q)
    })
    const clave: Record<Orden, (i: Ingrediente) => number> = {
      nombre: () => 0,
      stock: (i) => i.stock_actual,
      minimo: (i) => -i.stock_minimo,
      costo: (i) => -i.costo_unitario,
      reponer: (i) => -(i.costo_reposicion ?? -1),
      rendimiento: (i) => i.rendimiento_pct,
      real: (i) => -i.costo_efectivo,
      vale: (i) => -vale(i),
    }
    return [...lista].sort((x, y) => clave[orden](x) - clave[orden](y) || x.nombre.localeCompare(y.nombre))
  }, [ingredientes, filtro, buscar, categoria, orden])

  // En la tablet, dos columnas: la lista se arma por pares.
  const filas: Ingrediente[][] = useMemo(() => {
    if (!tablet) return visibles.map((i) => [i])
    const pares: Ingrediente[][] = []
    for (let i = 0; i < visibles.length; i += 2) pares.push(visibles.slice(i, i + 2))
    return pares
  }, [visibles, tablet])

  const opcionesOrden: { valor: Orden; texto: string }[] = [
    { valor: 'nombre', texto: 'Nombre' },
    { valor: 'stock', texto: `${palabra('stock')} (menos primero)` },
    { valor: 'minimo', texto: 'Mínimo' },
    { valor: 'costo', texto: palabra('costo') },
    { valor: 'reponer', texto: palabra('reponer') },
    ...(esMateria
      ? [
          { valor: 'rendimiento' as const, texto: `${palabra('rendimiento')} (menos primero)` },
          { valor: 'real' as const, texto: 'Costo real' },
        ]
      : [{ valor: 'vale' as const, texto: 'Vale' }]),
  ]

  const cabecera = (
    <View style={{ gap: 12 }}>
      {cabeceraExtra}
      <Buscador valor={buscar} alCambiar={setBuscar} placeholder={`Buscar en ${a.texto.toLowerCase()}…`} />
      <FilaFiltros>
        <Selector<Filtro>
          etiqueta="Ver"
          opciones={[
            { valor: 'todos', texto: 'Todas' },
            { valor: 'bajo', texto: 'Bajo mínimo', contador: bajo },
            { valor: 'sin-costo', texto: 'Sin costo', contador: sinCosto },
            ...(archivados > 0 ? [{ valor: 'archivados' as const, texto: 'Archivadas', contador: archivados }] : []),
          ]}
          valor={filtro}
          alCambiar={setFiltro}
        />
        {cats.length > 0 || haySinCategoria ? (
          <Selector
            etiqueta="Categoría"
            opciones={[
              { valor: 'todas', texto: 'Todas' },
              ...cats.map((c) => ({
                valor: String(c.id),
                texto: c.nombre,
                contador: ingredientes.filter((i) => i.categoria_id === c.id && i.activo !== false).length,
              })),
              ...(haySinCategoria
                ? [{ valor: SIN_CATEGORIA, texto: 'Sin categoría', contador: activos.filter((i) => !i.categoria_id).length }]
                : []),
              { valor: ADMINISTRAR, texto: 'Administrar categorías…', detalle: 'crear, renombrar, mover mercancía' },
            ]}
            valor={categoria}
            alCambiar={(v) => (v === ADMINISTRAR ? ir('/inventario/categorias') : setCategoria(v))}
          />
        ) : null}
        <Selector<Orden> etiqueta="Orden" titulo="Ordenar por" opciones={opcionesOrden} valor={orden} alCambiar={setOrden} />
      </FilaFiltros>

      {/* Las cifras del almacen: una franja chica, complemento de la lista
          (Leider, 8-oct: "el protagonista siempre son los registros"). Las
          que filtran se tocan. */}
      {resumen ? (
        <View style={s.franja}>
          <Cuadrito
            valor={String(visibles.length === activos.length || filtro === 'archivados' ? activos.length : `${visibles.length} de ${activos.length}`)}
            titulo={activos.length === 1 ? 'mercancía' : 'mercancías'}
          />
          <Cuadrito valor={fmt(resumen.plata)} titulo="en el inventario" />
          <Cuadrito
            valor={String(resumen.bajoMinimo)}
            titulo="bajo mínimo"
            color={resumen.bajoMinimo > 0 ? t.aviso : t.exito}
            activo={filtro === 'bajo'}
            alTocar={() => setFiltro(filtro === 'bajo' ? 'todos' : 'bajo')}
          />
          <Cuadrito
            valor={String(resumen.sinCosto)}
            titulo="sin costo"
            color={resumen.sinCosto > 0 ? t.aviso : undefined}
            activo={filtro === 'sin-costo'}
            alTocar={() => setFiltro(filtro === 'sin-costo' ? 'todos' : 'sin-costo')}
          />
        </View>
      ) : null}
      {error && ingredientes.length === 0 ? <Problema mensaje={error} alReintentar={alRefrescar} /> : null}
    </View>
  )

  const vacio = cargando ? (
    <Cargando />
  ) : error && ingredientes.length === 0 ? (
    <View />
  ) : (
    <Vacio
      icono={a.icono}
      titulo={ingredientes.length === 0 ? `Todavía no hay ${a.texto.toLowerCase()}` : 'Nada con ese filtro'}
      detalle={ingredientes.length === 0 ? `${a.detalle} Ej.: ${a.ejemplo}.` : undefined}
      accion={ingredientes.length === 0 ? { texto: '+ Nueva mercancía', alTocar: () => ir(`/inventario/mercancia/nueva?tipo=${tipo}`) } : undefined}
    />
  )

  return (
    <PantallaLista
      arriba={arriba}
      datos={filas}
      clave={(par) => par.map((i) => i.id).join('-')}
      cabecera={cabecera}
      vacio={vacio}
      refrescando={refrescando}
      alRefrescar={alRefrescar}
      renglon={({ item: par }) => (
        <View style={[s.par, { marginBottom: 10 }]}>
          {par.map((ing) => (
            <View key={ing.id} style={{ flex: 1 }}>
              <RenglonMercancia ing={ing} esMateria={esMateria} alReactivar={() => alReactivar(ing)} />
            </View>
          ))}
          {par.length === 1 && tablet ? <View style={{ flex: 1 }} /> : null}
        </View>
      )}
      abajo={
        <BarraAccion
          izquierda={
            tipo === 'desechable' ? undefined : (
              <Pressable
                onPress={() => ir('/inventario/conteo')}
                disabled={activos.length === 0}
                accessibilityRole="button"
                style={({ pressed }) => [s.conteo, { opacity: activos.length === 0 ? 0.4 : pressed ? 0.6 : 1 }]}
              >
                <Text style={[s.conteoTexto, { color: t.tinta }]}>Conteo físico</Text>
              </Pressable>
            )
          }
          texto="Nueva mercancía"
          alTocar={() => ir(`/inventario/mercancia/nueva?tipo=${tipo}`)}
        />
      }
    />
  )
}

/** Una mercancia de la lista: se toca y abre su ficha. */
function RenglonMercancia({ ing, esMateria, alReactivar }: { ing: Ingrediente; esMateria: boolean; alReactivar: () => void }) {
  const t = useTema()
  const { fmt } = useMoneda()
  const palabra = usePalabra()
  const estado = estadoStock(ing)
  const archivado = ing.activo === false
  const sube = ing.variacion_pct != null && ing.variacion_pct >= 15
  const dato = (rotulo: string, valor: string, color?: string, fuerte = false) => (
    <Text style={[s.dato, { color: t.tenue }]}>
      {rotulo} <Text style={[fuerte ? s.datoCifraFuerte : s.datoCifra, { color: color ?? t.fuerte }]}>{valor}</Text>
    </Text>
  )
  return (
    <Pulsable alTocar={() => ir(`/inventario/mercancia/${ing.id}`)} etiqueta={ing.nombre}>
      <Ficha style={[s.renglon, archivado && { opacity: 0.6 }]}>
        <View style={s.renglonCabeza}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.nombre, { color: t.tinta }]} numberOfLines={2}>
              {ing.nombre}
            </Text>
            <Text style={[s.dato, { color: t.tenue, marginTop: 2 }]} numberOfLines={1}>
              {ing.categoria ? <Text style={{ color: t.suave, fontFamily: LETRA.textoFuerte }}>{ing.categoria} · </Text> : null}
              por {ing.unidad}
              {ing.es_indirecto ? ' · costo indirecto' : ''}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text style={[s.hay, { color: t.tinta }, estado && { fontFamily: LETRA.cifraFuerte }]}>
              {cantidad(ing.stock_actual)} {unidadDe(ing.stock_actual, ing.unidad)}
            </Text>
            {estado ? <Pastilla texto={estado.texto} tono={estado.tono === 'mal' ? 'mal' : 'ojo'} /> : null}
          </View>
        </View>
        <View style={s.datos}>
          {ing.costo_unitario ? dato(palabra('costo'), fmt(ing.costo_unitario)) : dato(palabra('costo'), 'cargar', t.aviso, true)}
          {ing.costo_reposicion != null
            ? dato(palabra('reponer'), `${fmt(ing.costo_reposicion)}${sube ? ` +${ing.variacion_pct!.toFixed(0)}%` : ''}`, sube ? t.aviso : undefined, sube)
            : null}
          {esMateria ? (
            <>
              {dato(palabra('rendimiento'), `${ing.rendimiento_pct}%`, ing.rendimiento_pct < 100 ? t.aviso : t.tenue)}
              {dato('Costo real', fmt(ing.costo_efectivo), t.tinta, true)}
            </>
          ) : (
            dato('Vale', fmt(vale(ing)), t.tinta, true)
          )}
          {/* El minimo: en la web es su columna; aqui una linea mas, si lo tiene. */}
          {ing.stock_minimo > 0 ? dato('Mínimo', `${cantidad(ing.stock_minimo)} ${unidadDe(ing.stock_minimo, ing.unidad)}`) : null}
        </View>
        {archivado ? (
          <View style={{ marginTop: 10 }}>
            <Boton texto="Reactivar" tono="neutro" alTocar={alReactivar} />
          </View>
        ) : null}
      </Ficha>
    </Pulsable>
  )
}

/** Una cifra chica de la franja del almacen: "5 bajo mínimo". Las que filtran se tocan. */
function Cuadrito({
  valor,
  titulo,
  color,
  activo = false,
  alTocar,
}: {
  valor: string
  titulo: string
  color?: string
  activo?: boolean
  alTocar?: () => void
}) {
  const t = useTema()
  const cuerpo = (
    <View
      style={[
        s.cuadrito,
        { backgroundColor: activo ? t.gris200 : t.gris100, borderColor: activo ? t.tinta : 'transparent' },
      ]}
    >
      <Text style={[s.cuadritoValor, { color: color ?? t.tinta }]}>{valor}</Text>
      <Text style={[s.cuadritoTitulo, { color: t.suave }]}>{titulo}</Text>
    </View>
  )
  if (!alTocar) return cuerpo
  return (
    <Pressable onPress={alTocar} accessibilityRole="button" accessibilityState={{ selected: activo }} hitSlop={4}>
      {({ pressed }) => <View style={{ opacity: pressed ? 0.7 : 1 }}>{cuerpo}</View>}
    </Pressable>
  )
}

/**
 * La cabeza del almacen dentro de la lista: su sello, que es, y en la
 * materia prima las dos caras (Crudo / Preparado).
 */
export function CabezaAlmacen({
  tipo,
  mercancias,
  preparaciones,
  alCrudo,
  alPreparado,
}: {
  tipo: TipoArticulo
  mercancias: number
  preparaciones: number
  /** Ya se esta en el crudo: tocarlo solo lo deja recordado. */
  alCrudo: () => void
  /** El preparado es otra pantalla (Preparaciones): se va alla. */
  alPreparado: () => void
}) {
  const t = useTema()
  const a = ALMACEN_DE[tipo]
  return (
    <View style={{ gap: 12 }}>
      <View style={s.cabeza}>
        <SelloAlmacen tipo={tipo} tamano={36} />
        <Text style={[s.cabezaDetalle, { color: t.suave }]}>{a.detalle}</Text>
      </View>
      {tipo === 'insumo' ? (
        <View style={s.caras} accessibilityRole="tablist">
          {(
            [
              { v: 'crudo', t: 'Crudo', n: `${mercancias} ${mercancias === 1 ? 'mercancía' : 'mercancías'}`, icono: 'paquete' },
              { v: 'preparado', t: 'Preparado', n: `${preparaciones} ${preparaciones === 1 ? 'preparación' : 'preparaciones'}`, icono: 'cocina' },
            ] as const
          ).map((c) => {
            const esta = c.v === 'crudo'
            const k = colorDe(tipo, t)
            return (
              <Pressable
                key={c.v}
                onPress={esta ? alCrudo : alPreparado}
                accessibilityRole="tab"
                accessibilityState={{ selected: esta }}
                style={({ pressed }) => [
                  s.cara,
                  esta ? { backgroundColor: t.tinta } : { backgroundColor: t.superficie, borderColor: t.gris200, borderWidth: 1 },
                  { transform: [{ scale: pressed ? 0.98 : 1 }] },
                ]}
              >
                <View style={[s.caraIcono, { backgroundColor: esta ? 'rgba(255,255,255,0.12)' : k.fondo }]}>
                  <Icono nombre={c.icono} size={16} color={esta ? t.papel : k.tinta} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[s.caraTitulo, { color: esta ? t.papel : t.tinta }]}>{c.t}</Text>
                  <Text style={[s.caraDetalle, { color: esta ? t.papel : t.suave, opacity: esta ? 0.7 : 1 }]} numberOfLines={1}>
                    {c.n}
                  </Text>
                </View>
                {!esta ? <Icono nombre="chevron" size={14} color={t.tenue} grosor={2.2} /> : null}
              </Pressable>
            )
          })}
        </View>
      ) : null}
    </View>
  )
}

/** La barra de arriba de un almacen: volver y su nombre. */
export function BarraAlmacen({ tipo }: { tipo: TipoArticulo }) {
  return <Barra titulo={ALMACEN_DE[tipo].texto} />
}

const s = StyleSheet.create({
  par: { flexDirection: 'row', gap: 10 },
  renglon: { padding: 16, borderRadius: 20 },
  renglonCabeza: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  nombre: { fontFamily: LETRA.textoFuerte, fontSize: 16 },
  hay: { fontFamily: LETRA.cifra, fontSize: 16 },
  datos: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 4, marginTop: 10 },
  dato: { fontFamily: LETRA.texto, fontSize: 13 },
  datoCifra: { fontFamily: LETRA.cifra, fontSize: 13 },
  datoCifraFuerte: { fontFamily: LETRA.cifraFuerte, fontSize: 13 },
  franja: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cuadrito: { flexDirection: 'row', alignItems: 'baseline', gap: 5, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1 },
  cuadritoValor: { fontFamily: LETRA.cifraFuerte, fontSize: 14 },
  cuadritoTitulo: { fontFamily: LETRA.texto, fontSize: 13 },
  conteo: { minHeight: 50, justifyContent: 'center' },
  conteoTexto: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  cabeza: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cabezaDetalle: { flex: 1, fontFamily: LETRA.texto, fontSize: 14, lineHeight: 19 },
  caras: { flexDirection: 'row', gap: 8 },
  cara: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 10, minHeight: 56 },
  caraIcono: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  caraTitulo: { fontFamily: LETRA.titulo, fontSize: 15 },
  caraDetalle: { fontFamily: LETRA.texto, fontSize: 13 },
})
