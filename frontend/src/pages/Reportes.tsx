import { useEffect, useMemo, useState } from 'react'
import { nombre } from '../lib/palabras'
import Icono from '../components/Icono'
import NavBar from '../components/NavBar'
import BarraFiltros from '../components/BarraFiltros'
import { useSeccion } from '../components/Secciones'
import { useRango } from '../lib/fechas'
import { idDe, useFiltrosUrl } from '../lib/filtros'
import { FiltroDesplegable, Lecturas, Pagina, Seccion } from '../components/ui'
import { BarrasDeCuenta, GraficoDona, Variacion, type FilaCuenta } from '../components/Grafico'
import { api } from '../lib/api'
import { PALETA } from '../lib/paleta'
import { fmtBs, useMoneda } from '../lib/moneda'
import { etiquetaMetodo } from '../lib/pagos'
import type {
  Categoria,
  CategoriaInsumo,
  Ingrediente,
  ReporteCombos,
  ReporteInventario,
  ReportePerdidas,
  ReporteResumen,
} from '../lib/types'
import { Bloque, Kpi, SerieTiempo, capitalizar, enteros, recortarSerie, type Dinero } from './partes/reportes/comunes'
import Ventas, { type CambioFiltro } from './partes/reportes/Ventas'
import Perdidas from './partes/reportes/Perdidas'
import Inventario from './partes/reportes/Inventario'

/**
 * Reportes, en cuatro secciones (Leider, 22-sep):
 *
 *   Resumen    lo basico que hay que mirar: las cuatro cifras, la serie de
 *              ventas, cuanto se facturo, como pagaron, el resultado.
 *   Ventas     cuando se vende (serie, mapa de calor, dias y horas), que se
 *              vendio y que se vende junto.
 *   Perdidas   analisis de merma: que se pierde mas y menos, por que, cuanto
 *              pesa sobre la venta, y las ventas que no llegaron.
 *   Inventario donde esta la plata, para cuantos dias alcanza, que comprar.
 *
 * LOS FILTROS VAN EN UNA FILA, ARRIBA DEL CONTENIDO (`BarraFiltros`), no en
 * el encabezado: el periodo y, al lado, de que parte del negocio se habla.
 * Resumen y Ventas se filtran por el menu (categoria, producto); Perdidas e
 * Inventario por el deposito (cajon, mercancia), que es de lo que hablan.
 * Leider (30-sep): "que la gente pueda filtrar por la categoria de su
 * producto y hasta por su producto... listas desplegables, porque pueden
 * haber muchos productos". Todo vive en la URL: `?s=ventas&r=mes&c=3&p=12`.
 */
// El grano de la serie. El primero es el automatico: `useSeccion` devuelve ese
// cuando no hay nada en la URL, y entonces no se le manda `paso` al servidor.
const PASOS = [
  { id: 'auto', texto: 'Automático' },
  { id: 'dia', texto: 'Por día' },
  { id: 'semana', texto: 'Por semana' },
  { id: 'mes', texto: 'Por mes' },
]

const SECCIONES = [
  { id: 'resumen', texto: 'Resumen' },
  { id: 'ventas', texto: 'Ventas' },
  { id: 'perdidas', texto: 'Pérdidas' },
  { id: 'inventario', texto: 'Inventario' },
]

export default function Reportes() {
  const [seccion, irA] = useSeccion(SECCIONES)
  // EL MES EN CURSO, no el dia. Reportes es donde se mira como va el negocio,
  // y "hoy" a las nueve de la manana son dos pedidos: ni el mapa de calor ni la
  // comparacion contra el periodo anterior tienen de que hablar. Ademas deja
  // este modulo en el mismo periodo que Ventas, Contabilidad e Impuestos, que
  // ya arrancaban en el mes (Leider, 24-sep).
  const [rango, setRango] = useRango('mes')
  /**
   * Con que grano se dibuja la serie de ventas: por dia, por semana o por mes.
   *
   * EN LA URL y no en un `useState`, igual que la seccion: asi volver con el
   * boton del navegador hace lo que se espera y el enlace se puede compartir
   * ya puesto en lo que uno queria enseñar.
   *
   * Vacio = lo elige el servidor por el largo del rango, que acierta casi
   * siempre. El selector existe para el "casi" (Leider, 24-sep).
   */
  const [paso, irAPaso] = useSeccion(PASOS, 'g')
  // Los filtros, en la URL: `c`/`p` categoria y producto del menu (Resumen y
  // Ventas); `ci`/`m` cajon y mercancia del deposito (Perdidas e Inventario).
  const [filtros, fijarFiltros] = useFiltrosUrl(['c', 'p', 'ci', 'm'] as const)
  const delMenu = seccion === 'resumen' || seccion === 'ventas'
  const filtroMenu = useMemo(
    () => ({ categoria_id: idDe(filtros.c), producto_id: idDe(filtros.p) }),
    [filtros.c, filtros.p],
  )
  const filtroDeposito = useMemo(
    () => ({ categoria_id: idDe(filtros.ci), ingrediente_id: idDe(filtros.m) }),
    [filtros.ci, filtros.m],
  )
  const hayFiltro = delMenu
    ? filtroMenu.categoria_id != null || filtroMenu.producto_id != null
    : filtroDeposito.categoria_id != null || filtroDeposito.ingrediente_id != null

  const [datos, setDatos] = useState<ReporteResumen | null>(null)
  const [combos, setCombos] = useState<ReporteCombos | null>(null)
  const [perdidas, setPerdidas] = useState<ReportePerdidas | null>(null)
  const [inventario, setInventario] = useState<ReporteInventario | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const { fmt, fmtCongelado, sufijo } = useMoneda()

  // Las listas de los desplegables: una vez cada una, cuando toca.
  const [categorias, setCategorias] = useState<Categoria[] | null>(null)
  const [cajones, setCajones] = useState<CategoriaInsumo[] | null>(null)
  const [mercancias, setMercancias] = useState<Ingrediente[] | null>(null)
  useEffect(() => {
    if (delMenu && categorias === null) {
      api.listarCategorias().then(setCategorias).catch(() => setCategorias([]))
    }
    if (!delMenu && cajones === null) {
      api.listarCategoriasInsumo().then(setCajones).catch(() => setCajones([]))
      api.listarIngredientes().then(setMercancias).catch(() => setMercancias([]))
    }
  }, [delMenu, categorias, cajones])

  // Cada seccion trae lo suyo y nada mas: Perdidas e Inventario no hacen
  // esperar al Resumen, y el Resumen no calcula la canasta de combos.
  useEffect(() => {
    let vigente = true
    setCargando(true)
    setError('')
    const necesitaResumen = seccion === 'resumen' || seccion === 'ventas'
    const pedidos: Promise<unknown>[] = []
    if (necesitaResumen)
      pedidos.push(
        api.reporte(rango, paso === 'auto' ? undefined : paso, filtroMenu).then((r) => vigente && setDatos(r)),
      )
    if (seccion === 'ventas')
      pedidos.push(
        api
          .reporteCombos(rango, filtroMenu)
          .then((c) => vigente && setCombos(c))
          .catch(() => vigente && setCombos(null)),
      )
    if (seccion === 'perdidas')
      pedidos.push(api.reportePerdidas(rango, filtroDeposito).then((p) => vigente && setPerdidas(p)))
    if (seccion === 'inventario')
      pedidos.push(api.reporteInventario(rango, filtroDeposito).then((i) => vigente && setInventario(i)))
    Promise.all(pedidos)
      .catch((e) => vigente && setError(e instanceof Error ? e.message : 'No se pudo cargar el reporte'))
      .finally(() => vigente && setCargando(false))
    return () => {
      vigente = false
    }
  }, [rango, seccion, paso, filtroMenu, filtroDeposito])

  // La tasa MEDIA del periodo, sacada de los bolivares que de verdad entraron.
  // En la vista en bolivares manda esta y no la de hoy: si no, el resumen del
  // mes pasado cambiaria solo cada vez que se mueve el dolar.
  const tasaPeriodo = datos && datos.ventas > 0 ? datos.ventas_bs / datos.ventas || null : null
  const dinero: Dinero = (x, d) => fmtCongelado(x, tasaPeriodo, d)
  const corto = (x: number) => dinero(x, 0)

  /**
   * Si YA hay algo que mostrar de esta seccion.
   *
   * Cambiar de periodo no vacia la pantalla: se siguen viendo los numeros del
   * periodo anterior hasta que llegan los nuevos. Antes se desmontaba todo y
   * se ponia "Cargando...", asi que la pagina se encogia a una linea y volvia
   * a crecer -- un parpadeo en cada toque del filtro (Leider, 24-sep).
   */
  const hayDatos =
    seccion === 'perdidas' ? perdidas !== null : seccion === 'inventario' ? inventario !== null : datos !== null
  const refrescando = cargando && hayDatos

  // ── Los desplegables ──────────────────────────────────────────────────────
  // La categoria elegida acota la lista de productos; elegir otra categoria
  // suelta el producto que no es de ella. Las retiradas tambien se listan:
  // lo que se vendio de algo que ya no esta sigue siendo su venta.
  const productos = useMemo(
    () =>
      (categorias ?? []).flatMap((c) =>
        c.productos.map((p) => ({ ...p, categoria: c.nombre, categoriaActiva: c.activo !== false })),
      ),
    [categorias],
  )
  const opcionesCategoria = [
    { valor: '', texto: 'Todas' },
    ...(categorias ?? []).map((c) => ({
      valor: String(c.id),
      texto: c.nombre,
      detalle: c.activo === false ? 'retirada' : undefined,
    })),
  ]
  const opcionesProducto = [
    { valor: '', texto: 'Todos' },
    ...productos
      .filter((p) => filtroMenu.categoria_id == null || p.categoria_id === filtroMenu.categoria_id)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      .map((p) => ({
        valor: String(p.id),
        texto: p.nombre,
        detalle:
          [filtroMenu.categoria_id == null ? p.categoria : '', p.activo === false ? 'retirado' : '']
            .filter(Boolean)
            .join(' · ') || undefined,
      })),
  ]
  const opcionesCajon = [
    { valor: '', texto: 'Todos' },
    ...(cajones ?? []).map((c) => ({ valor: String(c.id), texto: c.nombre, contador: c.usos })),
  ]
  const opcionesMercancia = [
    { valor: '', texto: 'Todas' },
    ...(mercancias ?? [])
      .filter((m) => filtroDeposito.categoria_id == null || m.categoria_id === filtroDeposito.categoria_id)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      .map((m) => ({
        valor: String(m.id),
        texto: m.nombre,
        detalle: filtroDeposito.categoria_id == null && m.categoria ? m.categoria : undefined,
      })),
  ]

  const elegirCategoria = (valor: string) => {
    const sigue = productos.find((p) => String(p.id) === filtros.p && String(p.categoria_id) === valor)
    fijarFiltros({ c: valor, p: sigue ? filtros.p : '' })
  }
  const elegirCajon = (valor: string) => {
    const sigue = (mercancias ?? []).find((m) => String(m.id) === filtros.m && String(m.categoria_id) === valor)
    fijarFiltros({ ci: valor, m: sigue ? filtros.m : '' })
  }
  const alFiltrar = (cambios: CambioFiltro) => fijarFiltros(cambios)
  const limpiar = () => (delMenu ? fijarFiltros({ c: '', p: '' }) : fijarFiltros({ ci: '', m: '' }))

  // Lo que resulta del filtro, a la derecha de la fila: el periodo y cuanto.
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
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Reportes" secciones={SECCIONES} seccion={seccion} alCambiarSeccion={irA} />

      <Pagina ocupada={refrescando}>
        <BarraFiltros rango={rango} alCambiar={setRango} resumen={resumenFiltro} alLimpiar={hayFiltro ? limpiar : undefined}>
          {delMenu ? (
            <>
              <FiltroDesplegable etiqueta="Categoría" valor={filtros.c} alCambiar={elegirCategoria} opciones={opcionesCategoria} />
              <FiltroDesplegable etiqueta="Producto" valor={filtros.p} alCambiar={(v) => fijarFiltros({ p: v })} opciones={opcionesProducto} />
            </>
          ) : (
            <>
              <FiltroDesplegable etiqueta="Cajón" valor={filtros.ci} alCambiar={elegirCajon} opciones={opcionesCajon} />
              <FiltroDesplegable etiqueta="Mercancía" valor={filtros.m} alCambiar={(v) => fijarFiltros({ m: v })} opciones={opcionesMercancia} />
            </>
          )}
        </BarraFiltros>

        {cargando && !hayDatos && <p className="text-neutral-400 text-sm">Cargando...</p>}
        {error && !cargando && <p className="text-peligro-600 text-sm">{error}</p>}

        {hayDatos && !error && (
          <>
            {seccion === 'resumen' && datos && <Resumen datos={datos} dinero={dinero} corto={corto} sufijo={sufijo} />}
            {seccion === 'ventas' && datos && (
              <Ventas
                datos={datos}
                combos={combos}
                dinero={dinero}
                corto={corto}
                fmt={fmt}
                paso={paso}
                alCambiarPaso={irAPaso}
                alFiltrar={alFiltrar}
              />
            )}
            {seccion === 'perdidas' && perdidas && <Perdidas datos={perdidas} dinero={dinero} corto={corto} />}
            {seccion === 'inventario' && inventario && <Inventario datos={inventario} dinero={dinero} corto={corto} />}

            {/* Lo que explica de donde salen los numeros, al pie: es
                informacion de respaldo, no la noticia. Antes iba arriba,
                bajo el encabezado, delante de las cifras. */}
            <PieDeDatos seccion={seccion} datos={datos} />
          </>
        )}
      </Pagina>
    </div>
  )
}

function PieDeDatos({ seccion, datos }: { seccion: string; datos: ReporteResumen | null }) {
  const partes: string[] = []
  if ((seccion === 'resumen' || seccion === 'ventas') && datos) {
    // Los bolivares del periodo salen de sumar cada venta a la tasa de SU dia.
    if (datos.ventas_bs > 0) partes.push(`Equivalen a ${fmtBs(datos.ventas_bs)} cobrados, cada venta a la tasa de su día.`)
    if (datos.consolidado_en) {
      const cuando = new Date(datos.consolidado_en.replace(/(\.\d{3})\d+$/, '$1')).toLocaleString('es-VE', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
      partes.push(`Días anteriores consolidados el ${cuando}; hoy se calcula al momento.`)
    }
    if (datos.filtro) partes.push('Con un filtro puesto, todo se calcula al momento sobre los pedidos.')
  }
  if (seccion === 'inventario') partes.push('El stock es el de hoy; el consumo con que se lee, el del período elegido.')
  if (partes.length === 0) return null
  return <p className="text-[11px] leading-relaxed text-neutral-400">{partes.join(' ')}</p>
}

// ── Resumen ──────────────────────────────────────────────────────────────────

/**
 * Lo basico que el dueño necesita mirar, y nada mas. Lo que aqui se dibuja
 * en chico (la serie de ventas) esta entero en Ventas; lo que aqui es una
 * cifra (la merma dentro de "gastos") tiene su seccion en Perdidas.
 *
 * CON UN FILTRO (una categoria, un producto) el resumen es el de ESA parte:
 * lo vendido, lo que deja despues de su mercancia, en cuantos pedidos salio
 * y cuantas unidades. Lo que es del pedido entero --como pagaron, cuanto se
 * facturo, los gastos del local-- no se reparte y no se muestra.
 */
function Resumen({
  datos,
  dinero,
  corto,
  sufijo,
}: {
  datos: ReporteResumen
  dinero: Dinero
  corto: (x: number) => string
  sufijo: string
}) {
  const ant = datos.anterior
  const vs = ant ? `vs ${ant.etiqueta}` : undefined
  const filtro = datos.filtro
  const de = filtro ? filtro.producto || filtro.categoria : ''
  // EXACTAMENTE EL MISMO RECORTE QUE EN VENTAS, y por eso sale del mismo sitio
  // (`comunes.recortarSerie`): fuera los tramos vacios de los extremos.
  const { serie, anterior: serieAnterior } = useMemo(
    () => recortarSerie(datos.serie, datos.serie_anterior),
    [datos.serie, datos.serie_anterior],
  )

  return (
    <>
      {/* ── 1. Las cifras ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi
          titulo={de ? `Ventas de ${de}` : 'Ventas'}
          ayuda="kpi.ventas"
          valor={dinero(datos.ventas)}
          destacado
          delta={ant && <Variacion pct={ant.cambio_ventas_pct} texto={vs} />}
        />
        {filtro ? (
          <Kpi
            titulo="Deja"
            ayuda="kpi.deja"
            valor={dinero(datos.ganancia_bruta)}
            tono={datos.ganancia_bruta >= 0 ? 'bueno' : 'malo'}
            destacado
            delta={ant && <Variacion pct={ant.cambio_ganancia_pct} texto={vs} />}
            nota={datos.ventas > 0 ? `${datos.margen_pct.toFixed(0)}% de margen después de la mercancía` : undefined}
          />
        ) : (
          <Kpi
            titulo={nombre('kpi.ganancia_neta')}
            ayuda="kpi.ganancia_neta"
            valor={dinero(datos.ganancia_neta)}
            tono={datos.ganancia_neta >= 0 ? 'bueno' : 'malo'}
            destacado
            delta={ant && <Variacion pct={ant.cambio_ganancia_pct} texto={vs} />}
          />
        )}
        <Kpi
          titulo={filtro ? 'Pedidos que lo llevan' : 'Pedidos'}
          ayuda="kpi.pedidos"
          valor={String(datos.pedidos)}
          delta={ant && <Variacion pct={ant.cambio_pedidos_pct} texto={vs} />}
          nota={!filtro && datos.unidades > 0 ? `${enteros(datos.unidades)} unidades vendidas` : undefined}
        />
        {filtro ? (
          <Kpi titulo="Unidades" ayuda="kpi.unidades" valor={String(datos.unidades)} />
        ) : (
          <Kpi
            titulo={nombre('kpi.ticket_promedio')}
            ayuda="kpi.ticket_promedio"
            valor={dinero(datos.ticket_promedio)}
            delta={ant && <Variacion pct={ant.cambio_ticket_pct} texto={vs} />}
            nota={
              Math.abs(datos.ticket_mediano - datos.ticket_promedio) > 0.01
                ? `el cliente típico gastó ${dinero(datos.ticket_mediano)}`
                : undefined
            }
          />
        )}
      </div>

      {/* ── 2. Las ventas: la plata en barras, las unidades en linea ─────── */}
      {serie.length > 0 && (
        <Bloque titulo="Ventas" descripcion="El detalle por hora, día y producto está en la pestaña Ventas.">
          {/* UNA tarjeta con las dos medidas y dos ejes: las barras son las
              unidades (eje izquierdo) y la linea la plata (eje derecho).
              Son dos preguntas distintas --cuantas cosas salieron y cuanto
              entro-- y se leen juntas: un dia con muchas unidades y poca
              plata es un dia de cosas baratas (Leider, 30-sep: "un mismo
              grafico de doble eje"; 1-oct: "que unidades sean las barras y
              la linea ventas"). */}
          <Seccion
            titulo={`Unidades y ventas por ${datos.granularidad}`}
            ayuda={`Barras: las unidades vendidas, eje izquierdo. Línea: la plata en ${sufijo}, eje derecho.${
              ant ? ` En gris, ${ant.etiqueta}, tramo a tramo.` : ''
            } La punteada es el promedio de unidades por ${datos.granularidad}.`}
          >
            <SerieTiempo
              alto={220}
              formato={enteros}
              formatoDetalle={enteros}
              puntos={serie.map((p) => ({
                etiqueta: p.etiqueta,
                valor: p.unidades,
                detalle: `${p.pedidos} ${p.pedidos === 1 ? 'pedido' : 'pedidos'}`,
              }))}
              anterior={ant && serieAnterior.length === serie.length ? serieAnterior.map((p) => p.unidades) : undefined}
              nombres={{ actual: 'Unidades', anterior: ant ? capitalizar(ant.etiqueta) : 'Período anterior' }}
              referencia={serie.length > 1 ? { valor: datos.unidades / serie.length, texto: 'promedio' } : undefined}
              lineas={[{ nombre: 'Ventas', valores: serie.map((p) => p.ventas) }]}
              formatoDerecha={corto}
            />
          </Seccion>
        </Bloque>
      )}

      {/* ── 3. Facturacion y cobros (del negocio entero, no de un producto) ── */}
      {!filtro && datos.ventas > 0 && (
        <Bloque titulo="Facturación y cobros">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Facturacion datos={datos} dinero={dinero} />
            <Seccion titulo="Cómo te pagaron" ayuda="Por pago, no por pedido: una venta mixta se reparte.">
              <GraficoDona
                formato={dinero}
                centro={{ valor: corto(datos.ventas), texto: 'cobrado' }}
                partes={Object.entries(datos.por_metodo_pago)
                  .sort(([, a], [, b]) => b - a)
                  .map(([metodo, monto]) => ({ nombre: etiquetaMetodo(metodo), valor: monto }))}
              />
            </Seccion>
          </div>
        </Bloque>
      )}

      {/* ── 4. El resultado ───────────────────────────────────────────── */}
      <Bloque
        titulo={filtro ? `Qué deja ${de}` : 'Resultado'}
        descripcion={filtro ? 'Lo vendido menos su mercancía. Los gastos del local no son de un producto.' : 'Los mismos números del Estado de Resultados en Contabilidad.'}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="bg-white rounded-2xl border border-neutral-200 p-4">
            <h2 className="font-semibold">De dónde sale la ganancia</h2>
            <p className="text-xs text-neutral-500 mt-0.5 mb-3">
              Lo vendido arriba; cada renglón se lleva un pedazo; lo que queda, abajo. La barra más larga es lo que más
              pesa.
            </p>
            {/* LA CUENTA CON UNA BARRA EN CADA RENGLON. Se lee como una
                factura y se ve como un grafico. La cascada que hubo antes no
                se entendia (Leider, 30-sep). */}
            <BarrasDeCuenta formato={dinero} filas={filasDeLaCuenta(datos)} />
            {ant && (
              <p className="text-xs text-neutral-500 mt-3">
                {capitalizar(ant.etiqueta)}: {dinero(ant.ventas)} en ventas y {dinero(ant.ganancia_neta)}{' '}
                {filtro ? 'de ganancia' : 'de ganancia neta'}.
              </p>
            )}
            {!filtro && (datos.pedidos_anulados > 0 || datos.devoluciones > 0) && (
              <p className="text-xs text-aviso-700 mt-3 bg-aviso-50 rounded-lg px-3 py-2">
                {datos.pedidos_anulados > 0 && (
                  <>Se anularon {datos.pedidos_anulados} pedido(s) por {dinero(datos.valor_anulado)}. </>
                )}
                {datos.devoluciones > 0 && (
                  <>{datos.devoluciones} venta(s) por {dinero(datos.valor_devuelto)} fueron devueltas y ya no cuentan arriba. </>
                )}
                El detalle está en Pérdidas.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <h2 className="font-semibold flex items-center gap-2">
              <Icono nombre="chispa" size={17} className="text-acento-600" /> Análisis {de ? `de ${de}` : 'del negocio'}
              {/* Los avisos los redacta el servidor con cifras en dolares. */}
              {sufijo !== 'USD' && <span className="text-xs font-normal text-neutral-400">· cifras en dólares</span>}
            </h2>
            {datos.insights.length > 0 ? (
              <Lecturas items={datos.insights} />
            ) : (
              <p className="text-sm text-neutral-500">Nada que señalar en este período.</p>
            )}
          </div>
        </div>
      </Bloque>
    </>
  )
}

/** Los renglones de la cuenta: de las ventas a lo que queda. */
function filasDeLaCuenta(datos: ReporteResumen): FilaCuenta[] {
  const filtro = datos.filtro
  const de = filtro ? filtro.producto || filtro.categoria : ''
  const filas: FilaCuenta[] = [{ nombre: filtro ? `Ventas de ${de}` : 'Ventas cobradas', valor: datos.ventas, tipo: 'base' }]
  if (datos.iva_cobrado > 0) {
    filas.push({ nombre: 'IVA cobrado', nota: 'se le debe al SENIAT', valor: -datos.iva_cobrado })
    filas.push({ nombre: 'Ingreso del negocio', valor: datos.ingresos_netos, tipo: 'subtotal' })
  }
  filas.push({ nombre: 'Costo de la mercancía', valor: -datos.costo_insumos, color: PALETA.neutro })
  const margen = datos.ventas > 0 ? `${datos.margen_pct.toFixed(0)}% de margen` : undefined
  if (filtro) {
    filas.push({ nombre: 'Deja', valor: datos.ganancia_bruta, tipo: 'resultado', nota: margen })
    return filas
  }
  filas.push({ nombre: 'Ganancia bruta', valor: datos.ganancia_bruta, tipo: 'subtotal', nota: margen })
  // CUANDO LOS GASTOS SON NEGATIVOS, EL RENGLON CAMBIA DE NOMBRE. Un reverso
  // de merma o un sobrante de conteo restan gasto; con el rotulo fijo la
  // cuenta se leia al reves (Leider, 24-sep). Diciendo que ese renglon SUMA,
  // la columna vuelve a cuadrar a la vista.
  if (datos.gastos >= 0) filas.push({ nombre: 'Gastos, mermas y faltantes', valor: -datos.gastos, color: PALETA.ojo })
  else filas.push({ nombre: 'Sobrantes y reversos', nota: 'suman', valor: -datos.gastos })
  filas.push({ nombre: nombre('kpi.ganancia_neta'), valor: datos.ganancia_neta, tipo: 'resultado' })
  return filas
}

/**
 * Cuánto de lo que se vendió llegó a tener factura, como pastel: dos partes
 * y lo que importa es la proporción de un vistazo (Leider, 22-sep). El
 * porcentaje grande es la respuesta; la leyenda da las ventas y la plata.
 */
function Facturacion({ datos, dinero }: { datos: ReporteResumen; dinero: Dinero }) {
  const sinFacturar = Math.max(Math.round((datos.ventas - datos.valor_facturado) * 100) / 100, 0)
  const pct = (datos.valor_facturado / datos.ventas) * 100
  const ventasSinFactura = Math.max(datos.pedidos - datos.facturadas, 0)

  return (
    <Seccion
      titulo="Cuánto se facturó"
      ayuda="No todo se factura al momento: se puede decidir después, desde el histórico de Ventas."
      accion={
        <div className="text-right">
          <div className="text-3xl font-bold tabular-nums leading-none">{pct.toFixed(0)}%</div>
          <div className="text-[11px] text-neutral-500">facturado</div>
        </div>
      }
    >
      <GraficoDona
        pastel
        alto={140}
        formato={dinero}
        partes={[
          {
            nombre: 'Con factura',
            valor: datos.valor_facturado,
            detalle: `${datos.facturadas} ${datos.facturadas === 1 ? 'venta' : 'ventas'}`,
            color: PALETA.bien,
          },
          {
            nombre: 'Sin factura',
            valor: sinFacturar,
            detalle: `${ventasSinFactura} ${ventasSinFactura === 1 ? 'venta' : 'ventas'}`,
            color: PALETA.neutro,
          },
        ]}
      />
      {datos.iva_cobrado > 0 && (
        <p className="mt-3 text-xs text-neutral-500">
          De la parte facturada salen {dinero(datos.iva_cobrado)} de IVA que se le deben al SENIAT. Lo que no se
          facturó no genera IVA.
        </p>
      )}
    </Seccion>
  )
}
