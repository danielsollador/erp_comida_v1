import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { apiReportes, type FiltroDepositoQuery, type FiltroMenuQuery, type RangoFechas } from '../../lib/api-reportes'
import { horaCorta, periodoDe, type Periodo } from '../../lib/numeros'
import { fmtBs } from '../../lib/moneda'
import { LETRA, useTema } from '../../lib/tema'
import type { Categoria, CategoriaInsumo, Ingrediente, ReporteCombos, ReporteInventario, ReportePerdidas, ReporteResumen } from '../../lib/tipos'
import { ElegirPeriodo, FilaFiltros, Selector, type OpcionSelector } from '../kit'
import { Cargando, Pantalla, Pestanas, Problema } from '../ui'
import AMedida from './AMedida'
import { c } from './comunes'
import { capitalizar, useDinero } from './cuentas'
import Inventario from './Inventario'
import Perdidas from './Perdidas'
import Resumen from './Resumen'
import Ventas, { type CambioFiltro } from './Ventas'

/**
 * REPORTES, como pages/Reportes.tsx de la web, en cinco secciones (Leider,
 * 22-sep y oct):
 *
 *   Resumen     lo basico: las cuatro cifras, la serie, la facturacion,
 *               como pagaron, el resultado y su analisis.
 *   Ventas      cuando se vende (serie, mapa de calor, dias y horas), que se
 *               vendio y que se vende junto.
 *   Perdidas    que se pierde, por que y cuanto pesa sobre la venta.
 *   Inventario  donde esta la plata, para cuantos dias alcanza, que comprar.
 *   A medida    la tabla dinamica y los reportes guardados.
 *
 * LOS FILTROS VAN EN UNA FILA DE PASTILLAS arriba del contenido: el periodo
 * (el mes en curso al entrar, como la web), el grano del grafico y de que
 * parte del negocio se habla --categoria y producto en Resumen y Ventas,
 * cajon y mercancia en Perdidas e Inventario--, con VARIOS A LA VEZ (Leider,
 * 11-oct). La seccion va en la ruta: /reportes/ventas, como en la web.
 */
type IdSeccion = 'resumen' | 'ventas' | 'perdidas' | 'inventario' | 'a_medida'

const SECCIONES: { id: IdSeccion; texto: string }[] = [
  { id: 'resumen', texto: 'Resumen' },
  { id: 'ventas', texto: 'Ventas' },
  { id: 'perdidas', texto: 'Pérdidas' },
  { id: 'inventario', texto: 'Inventario' },
  { id: 'a_medida', texto: 'A medida' },
]

// El grano de la serie. El automatico no se manda: lo elige el servidor por
// el largo del rango, que acierta casi siempre. Esto es para el "casi".
type IdPaso = 'auto' | 'dia' | 'semana' | 'mes'
const PASOS: OpcionSelector<IdPaso>[] = [
  { valor: 'auto', texto: 'Automático', detalle: 'Según el largo del período' },
  { valor: 'dia', texto: 'Por día' },
  { valor: 'semana', texto: 'Por semana' },
  { valor: 'mes', texto: 'Por mes' },
]

type Filtros = { c: string[]; p: string[]; ci: string[]; m: string[] }
const SIN_FILTROS: Filtros = { c: [], p: [], ci: [], m: [] }

/**
 * LO YA VISTO SALE AL INSTANTE (Leider, 1-oct: "primero se queda pegado y
 * luego carga"): cada respuesta se guarda mientras la app esta abierta;
 * volver a una vista la pinta en el acto y se refresca por detras. Y al
 * terminar, se piden en silencio las otras secciones del mismo periodo.
 */
const VISTOS = new Map<string, unknown>()
const claveDe = (tipo: string, r: RangoFechas, paso: string | undefined, filtro: unknown) =>
  `${tipo}|${r.desde}|${r.hasta}|${paso ?? 'auto'}|${JSON.stringify(filtro ?? {})}`

const seccionValida = (s: string | undefined): IdSeccion => (SECCIONES.some((x) => x.id === s) ? (s as IdSeccion) : 'resumen')

export default function PantallaReportes() {
  const t = useTema()
  const { seccion: pedida } = useLocalSearchParams<{ seccion?: string }>()
  // La pestaña se marca en el acto con su propio estado; la ruta va detras.
  // Si la ruta cambia por otro lado (un aviso que abre /reportes/ventas), se
  // pone al dia al dibujar.
  const [seccion, setSeccion] = useState<IdSeccion>(() => seccionValida(pedida))
  const [pedidaAntes, setPedidaAntes] = useState(pedida)
  if (pedida !== pedidaAntes) {
    setPedidaAntes(pedida)
    setSeccion(seccionValida(pedida))
  }
  const irA = (id: IdSeccion) => {
    setSeccion(id)
    router.setParams({ seccion: id })
  }

  // EL MES EN CURSO, no el dia: "hoy" a las nueve de la mañana son dos
  // pedidos y no hay de que hablar (Leider, 24-sep).
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDe('mes'))
  const [paso, setPaso] = useState<IdPaso>('auto')
  const [filtros, setFiltros] = useState<Filtros>(SIN_FILTROS)
  const delMenu = seccion === 'resumen' || seccion === 'ventas'
  const aMedida = seccion === 'a_medida'
  const filtroMenu = useMemo<FiltroMenuQuery>(() => ({ categoria_id: filtros.c.map(Number), producto_id: filtros.p.map(Number) }), [filtros.c, filtros.p])
  const filtroDeposito = useMemo<FiltroDepositoQuery>(
    () => ({ categoria_id: filtros.ci.map(Number), ingrediente_id: filtros.m.map(Number) }),
    [filtros.ci, filtros.m],
  )
  const hayFiltro = delMenu ? filtros.c.length > 0 || filtros.p.length > 0 : filtros.ci.length > 0 || filtros.m.length > 0

  const [datos, setDatos] = useState<ReporteResumen | null>(null)
  const [combos, setCombos] = useState<ReporteCombos | null>(null)
  const [perdidas, setPerdidas] = useState<ReportePerdidas | null>(null)
  const [inventario, setInventario] = useState<ReporteInventario | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [refrescando, setRefrescando] = useState(false)
  // Sube con "tirar para refrescar" y al volver a la pantalla: se pide de nuevo.
  const [vuelta, setVuelta] = useState(0)

  // Las listas de los filtros: una vez cada una, cuando toca.
  const [categorias, setCategorias] = useState<Categoria[] | null>(null)
  const [cajones, setCajones] = useState<CategoriaInsumo[] | null>(null)
  const [mercancias, setMercancias] = useState<Ingrediente[] | null>(null)
  useEffect(() => {
    if (aMedida) return
    if (delMenu && categorias === null) apiReportes.categorias().then(setCategorias).catch(() => setCategorias([]))
    if (!delMenu && cajones === null) {
      apiReportes.cajones().then(setCajones).catch(() => setCajones([]))
      apiReportes.mercancias().then(setMercancias).catch(() => setMercancias([]))
    }
  }, [aMedida, delMenu, categorias, cajones])

  const montada = useRef(false)
  useFocusEffect(
    useCallback(() => {
      if (montada.current) setVuelta((v) => v + 1)
      montada.current = true
    }, []),
  )

  const precargado = useRef('')
  useEffect(() => {
    if (aMedida) return
    let vigente = true
    // Un instante despues, no en el mismo paso: el cambio de pestaña o de
    // filtro se pinta primero y lo guardado entra detras.
    const arranque = setTimeout(() => {
      setError('')
      const rango = { desde: periodo.desde, hasta: periodo.hasta }
      const pasoPedido = paso === 'auto' ? undefined : paso
      const tareas: { clave: string; traer: () => Promise<unknown>; poner: (v: unknown) => void }[] = []
      if (delMenu)
        tareas.push({
          clave: claveDe('resumen', rango, pasoPedido, filtroMenu),
          traer: () => apiReportes.resumen(rango, pasoPedido, filtroMenu),
          poner: (v) => setDatos(v as ReporteResumen),
        })
      if (seccion === 'ventas')
        tareas.push({
          clave: claveDe('combos', rango, undefined, filtroMenu),
          traer: () => apiReportes.combos(rango, filtroMenu).catch(() => null),
          poner: (v) => setCombos(v as ReporteCombos | null),
        })
      if (seccion === 'perdidas')
        tareas.push({
          clave: claveDe('perdidas', rango, undefined, filtroDeposito),
          traer: () => apiReportes.perdidas(rango, filtroDeposito),
          poner: (v) => setPerdidas(v as ReportePerdidas),
        })
      if (seccion === 'inventario')
        tareas.push({
          clave: claveDe('inventario', rango, undefined, filtroDeposito),
          traer: () => apiReportes.inventario(rango, filtroDeposito),
          poner: (v) => setInventario(v as ReporteInventario),
        })
      // Lo guardado, ya: sin espera ni "cargando".
      const todoGuardado = tareas.every((x) => VISTOS.has(x.clave))
      for (const x of tareas) if (VISTOS.has(x.clave)) x.poner(VISTOS.get(x.clave))
      setCargando(!todoGuardado)
      Promise.all(
        tareas.map((x) =>
          x.traer().then((v) => {
            VISTOS.set(x.clave, v)
            if (vigente) x.poner(v)
          }),
        ),
      )
        .catch((e) => vigente && setError(e instanceof Error ? e.message : 'No se pudo cargar el reporte'))
        .finally(() => {
          if (!vigente) return
          setCargando(false)
          setRefrescando(false)
          // Lo que probablemente se toque despues, en silencio y de a uno.
          const huella = `${rango.desde}|${rango.hasta}|${pasoPedido}|${JSON.stringify(filtroMenu)}|${JSON.stringify(filtroDeposito)}`
          if (precargado.current === huella) return
          precargado.current = huella
          const sueltas: [string, () => Promise<unknown>][] = [
            [claveDe('resumen', rango, pasoPedido, filtroMenu), () => apiReportes.resumen(rango, pasoPedido, filtroMenu)],
            [claveDe('combos', rango, undefined, filtroMenu), () => apiReportes.combos(rango, filtroMenu)],
            [claveDe('perdidas', rango, undefined, filtroDeposito), () => apiReportes.perdidas(rango, filtroDeposito)],
            [claveDe('inventario', rango, undefined, filtroDeposito), () => apiReportes.inventario(rango, filtroDeposito)],
          ]
          void (async () => {
            for (const [clave, traer] of sueltas) {
              if (VISTOS.has(clave)) continue
              await new Promise((r) => setTimeout(r, 120))
              await traer()
                .then((v) => VISTOS.set(clave, v))
                .catch(() => undefined)
            }
          })()
        })
    }, 0)
    return () => {
      vigente = false
      clearTimeout(arranque)
    }
  }, [aMedida, delMenu, seccion, periodo.desde, periodo.hasta, paso, filtroMenu, filtroDeposito, vuelta])

  // La tasa MEDIA del periodo, sacada de los bolivares que de verdad entraron.
  const tasaPeriodo = datos && datos.ventas > 0 ? datos.ventas_bs / datos.ventas || null : null
  const { dinero, corto, fmt, sufijo } = useDinero(tasaPeriodo)

  // Si YA hay algo que mostrar de esta seccion: cambiar de periodo no vacia
  // la pantalla; se siguen viendo los numeros de antes hasta que llegan los
  // nuevos (Leider, 24-sep: nada de parpadear).
  const hayDatos = seccion === 'perdidas' ? perdidas !== null : seccion === 'inventario' ? inventario !== null : datos !== null

  // ── Los filtros ──
  // La categoria elegida acota la lista de productos; las retiradas tambien
  // se listan: lo que se vendio de algo que ya no esta sigue siendo su venta.
  const productos = useMemo(
    () => (categorias ?? []).flatMap((cat) => cat.productos.map((x) => ({ ...x, categoria: cat.nombre }))),
    [categorias],
  )
  const catsMenu = new Set(filtros.c.map(Number))
  const catsDeposito = new Set(filtros.ci.map(Number))
  const opcionesCategoria: OpcionSelector[] = [
    { valor: '', texto: 'Todas' },
    ...(categorias ?? []).map((cat) => ({ valor: String(cat.id), texto: cat.nombre, detalle: cat.activo === false ? 'retirada' : undefined })),
  ]
  const opcionesProducto: OpcionSelector[] = [
    { valor: '', texto: 'Todos' },
    ...productos
      .filter((x) => catsMenu.size === 0 || catsMenu.has(x.categoria_id))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map((x) => ({
        valor: String(x.id),
        texto: x.nombre,
        detalle: [catsMenu.size !== 1 ? x.categoria : '', x.activo === false ? 'retirado' : ''].filter(Boolean).join(' · ') || undefined,
      })),
  ]
  const opcionesCajon: OpcionSelector[] = [
    { valor: '', texto: 'Todos' },
    ...(cajones ?? []).map((x) => ({ valor: String(x.id), texto: x.nombre, contador: x.usos })),
  ]
  const opcionesMercancia: OpcionSelector[] = [
    { valor: '', texto: 'Todas' },
    ...(mercancias ?? [])
      .filter((x) => catsDeposito.size === 0 || (x.categoria_id != null && catsDeposito.has(x.categoria_id)))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map((x) => ({ valor: String(x.id), texto: x.nombre, detalle: catsDeposito.size !== 1 && x.categoria ? x.categoria : undefined })),
  ]
  // Al cambiar las categorias, los productos elegidos que ya no entran se sueltan.
  const elegirCategoria = (valores: string[]) => {
    const cats = new Set(valores)
    setFiltros((f) => ({
      ...f,
      c: valores,
      p: f.p.filter((id) => cats.size === 0 || productos.some((x) => String(x.id) === id && cats.has(String(x.categoria_id)))),
    }))
  }
  const elegirCajon = (valores: string[]) => {
    const cats = new Set(valores)
    setFiltros((f) => ({
      ...f,
      ci: valores,
      m: f.m.filter((id) => cats.size === 0 || (mercancias ?? []).some((x) => String(x.id) === id && cats.has(String(x.categoria_id)))),
    }))
  }
  const limpiar = () => setFiltros((f) => (delMenu ? { ...f, c: [], p: [] } : { ...f, ci: [], m: [] }))
  const alFiltrar = (cambios: CambioFiltro) =>
    setFiltros((f) => ({ ...f, ...(cambios.c !== undefined ? { c: cambios.c } : {}), ...(cambios.p !== undefined ? { p: cambios.p } : {}) }))

  // Lo que resulta del filtro: el periodo y cuanto.
  const etiqueta = seccion === 'perdidas' ? perdidas?.etiqueta : seccion === 'inventario' ? inventario?.etiqueta : datos?.etiqueta
  const cuanto =
    seccion === 'perdidas' && perdidas
      ? `${perdidas.registros} ${perdidas.registros === 1 ? 'registro' : 'registros'}`
      : seccion === 'inventario' && inventario
        ? `${inventario.activos} ${inventario.activos === 1 ? 'mercancía' : 'mercancías'}`
        : datos
          ? `${datos.pedidos} ${datos.pedidos === 1 ? 'pedido' : 'pedidos'}`
          : ''
  const resumenFiltro = etiqueta ? `${capitalizar(etiqueta)}${cuanto ? ` · ${cuanto}` : ''}` : undefined

  return (
    <Pantalla
      refrescando={refrescando}
      alRefrescar={() => {
        // En A medida cada cambio ya consulta solo; ahi no hay nada que esperar.
        if (!aMedida) setRefrescando(true)
        setVuelta((v) => v + 1)
      }}
      arriba={<Pestanas opciones={SECCIONES} valor={seccion} alCambiar={irA} />}
    >
      <Stack.Screen options={{ title: 'Reportes' }} />

      {aMedida ? (
        // A medida dibuja su propia fila: el periodo y, al lado, que mirar y como.
        <AMedida periodo={periodo} alCambiarPeriodo={setPeriodo} />
      ) : (
        <>
          <View style={{ gap: 8 }}>
            <FilaFiltros>
              <ElegirPeriodo periodo={periodo} alCambiar={setPeriodo} />
              {delMenu ? <Selector<IdPaso> etiqueta="Gráfico" titulo="Agrupar el gráfico" opciones={PASOS} valor={paso} alCambiar={setPaso} /> : null}
              {delMenu ? (
                <>
                  <Selector
                    etiqueta="Categoría"
                    plural="categorías"
                    varios
                    valores={filtros.c}
                    alCambiarVarios={elegirCategoria}
                    opciones={opcionesCategoria}
                  />
                  <Selector
                    etiqueta="Producto"
                    plural="productos"
                    varios
                    valores={filtros.p}
                    alCambiarVarios={(vs) => setFiltros((f) => ({ ...f, p: vs }))}
                    opciones={opcionesProducto}
                  />
                </>
              ) : (
                <>
                  <Selector etiqueta="Cajón" plural="cajones" varios valores={filtros.ci} alCambiarVarios={elegirCajon} opciones={opcionesCajon} />
                  <Selector
                    etiqueta="Mercancía"
                    plural="mercancías"
                    varios
                    valores={filtros.m}
                    alCambiarVarios={(vs) => setFiltros((f) => ({ ...f, m: vs }))}
                    opciones={opcionesMercancia}
                  />
                </>
              )}
              {hayFiltro ? (
                <Pressable
                  onPress={limpiar}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel="Quitar filtros"
                  style={{ height: 38, justifyContent: 'center', paddingHorizontal: 8 }}
                >
                  <Text style={[c.texto, { color: t.suave, fontFamily: LETRA.textoFuerte }]}>Quitar filtros</Text>
                </Pressable>
              ) : null}
            </FilaFiltros>
            {resumenFiltro ? <Text style={[c.nota, { color: t.suave, paddingHorizontal: 2 }]}>{resumenFiltro}</Text> : null}
          </View>

          {cargando && !hayDatos ? <Cargando /> : null}
          {error && !cargando ? <Problema mensaje={error} alReintentar={() => setVuelta((v) => v + 1)} /> : null}

          {hayDatos && !error ? (
            <View style={{ gap: 12, opacity: cargando ? 0.55 : 1 }}>
              {seccion === 'resumen' && datos ? <Resumen datos={datos} dinero={dinero} corto={corto} sufijo={sufijo} /> : null}
              {seccion === 'ventas' && datos ? (
                <Ventas datos={datos} combos={combos} dinero={dinero} corto={corto} fmt={fmt} alFiltrar={alFiltrar} />
              ) : null}
              {seccion === 'perdidas' && perdidas ? <Perdidas datos={perdidas} dinero={dinero} corto={corto} /> : null}
              {seccion === 'inventario' && inventario ? <Inventario datos={inventario} dinero={dinero} corto={corto} /> : null}
              <PieDeDatos seccion={seccion} datos={datos} />
            </View>
          ) : null}
        </>
      )}
    </Pantalla>
  )
}

/** De donde salen los numeros, al pie: informacion de respaldo, no la noticia. */
function PieDeDatos({ seccion, datos }: { seccion: IdSeccion; datos: ReporteResumen | null }) {
  const t = useTema()
  const partes: string[] = []
  if ((seccion === 'resumen' || seccion === 'ventas') && datos) {
    // Los bolivares del periodo salen de sumar cada venta a la tasa de SU dia.
    if (datos.ventas_bs > 0) partes.push(`Equivalen a ${fmtBs(datos.ventas_bs)} cobrados, cada venta a la tasa de su día.`)
    if (datos.consolidado_en) {
      const [a, m, d] = datos.consolidado_en.slice(0, 10).split('-')
      if (a && m && d) partes.push(`Días anteriores consolidados el ${d}/${m}, ${horaCorta(datos.consolidado_en)}; hoy se calcula al momento.`)
    }
    if (datos.filtro) partes.push('Con un filtro puesto, todo se calcula al momento sobre los pedidos.')
  }
  if (seccion === 'inventario') partes.push('El stock es el de hoy; el consumo con que se lee, el del período elegido.')
  if (partes.length === 0) return null
  return <Text style={[c.nota, { color: t.tenue, marginTop: 4 }]}>{partes.join(' ')}</Text>
}
