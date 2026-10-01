import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import NavBar from '../components/NavBar'
import { useSeccion } from '../components/Secciones'
import MenuAcciones from '../components/MenuAcciones'
import Agarre from '../components/Agarre'
import { useArrastre } from '../lib/arrastre'
import BarraFiltros from '../components/BarraFiltros'
import { useRango, nombreRango } from '../lib/fechas'
import { Tabla, Th, useBuscador, useOrden } from '../components/Tabla'
import { useDialogo } from '../components/dialogo'
import { useDeshacer } from '../components/Deshacer'
import { nombre } from '../lib/palabras'
import { Aviso, Boton, Campo, Cifra, FiltroDesplegable, Modal, Pagina, Pastilla, Seccion, Selector, Vacio } from '../components/ui'
import { Numerico } from '../components/Teclado'
import { api } from '../lib/api'
import { useMoneda } from '../lib/moneda'
import type {
  CompraDeInsumo,
  Configuracion,
  ConteoDetalle,
  ConteoResumen,
  DatosIngrediente,
  ImpactoDeCompra,
  InflacionInsumos,
  Ingrediente,
  Merma,
  ResultadoConteo,
  SobranteInventario,
  SugerenciaCompra,
  ExtractoInsumo,
  MovimientoInventario,
  PlanillaLeida,
  RenglonPorTipo,
  CategoriaInsumo,
} from '../lib/types'

/**
 * El inventario: todo lo que el local compra y guarda, y cuanto hay de cada
 * cosa.
 *
 * Antes era una tabla con cuatro enlaces por fila y ventanas del navegador.
 * No habia forma de dar de alta un insumo (nacian con la base de datos), ni
 * de contar el deposito completo: contar eran diez preguntas seguidas para
 * diez insumos. Leider (16-sep): "el inventario es para llenar todos los
 * productos y la materia y tambien llevar conteo".
 *
 * Como esta armado ahora:
 *   - arriba, cuatro cifras: cuantos insumos, cuantos bajo minimo, cuanto
 *     vale lo que hay y cuanto se perdio en 30 dias;
 *   - una barra para buscar y filtrar, y los dos botones que importan:
 *     "Nuevo insumo" y "Conteo fisico";
 *   - la tabla, con el nombre clicable: abre la FICHA del insumo, donde se
 *     edita todo, se ve el historial de costos y se registra cualquier
 *     movimiento;
 *   - debajo, lo que pide atencion (que comprar, que subio de precio) y el
 *     historial de perdidas y conteos.
 */

const UNIDADES = ['kg', 'g', 'lt', 'ml', 'unidad', 'paquete']
const METODOS_DE_PAGO = ['Efectivo Bs', 'Efectivo $', 'Banco']

type Filtro = 'todos' | 'bajo' | 'sin-costo' | 'insumo' | 'reventa' | 'archivados'

// "Sin categoria" es una opcion mas del filtro, asi que necesita un valor. Se
// usa uno con guiones bajos porque el servidor guarda las categorias sin
// espacios de sobra y nadie va a teclear esto como nombre de un cajon.
const SIN_CATEGORIA = '__sin_categoria__'

const FILTROS: { valor: Filtro; texto: string }[] = [
  { valor: 'todos', texto: 'Todos' },
  { valor: 'bajo', texto: 'Bajo mínimo' },
  { valor: 'sin-costo', texto: 'Sin costo' },
  { valor: 'insumo', texto: 'Materia prima' },
  { valor: 'reventa', texto: 'Reventa' },
  { valor: 'archivados', texto: 'Archivados' },
]

const cantidad = (n: number) => String(Number(n.toFixed(3)))
const dinero = (n: number) => `$${n.toFixed(2)}`

type CompraConVariacion = CompraDeInsumo & { cambio: number | null }

/**
 * Cuanto subio o bajo el costo respecto a la compra ANTERIOR EN EL TIEMPO.
 *
 * Antes se calculaba contra la fila de al lado en la pantalla, que solo era la
 * compra anterior mientras la tabla estuviera en orden de fecha. Ahora que se
 * puede ordenar por costo o por cantidad, esa cuenta habria dado porcentajes
 * inventados: el cambio pertenece a la compra, no a la posicion en la lista.
 */
function conVariacion(compras: CompraDeInsumo[]): CompraConVariacion[] {
  const cronologico = [...compras].sort(
    (a, b) => new Date(a.fecha).getTime() - new Date(b.fecha).getTime(),
  )
  const cambios = new Map<CompraDeInsumo, number | null>()
  for (const [i, c] of cronologico.entries()) {
    const previa = cronologico[i - 1]
    cambios.set(
      c,
      previa && previa.costo_unitario ? (c.costo_unitario / previa.costo_unitario - 1) * 100 : null,
    )
  }
  return compras.map((c) => ({ ...c, cambio: cambios.get(c) ?? null }))
}

function estadoStock(ing: Ingrediente): { texto: string; tono: 'mal' | 'ojo' } | null {
  if (ing.stock_actual <= 0) return { texto: 'Agotado', tono: 'mal' }
  if (ing.stock_actual <= ing.stock_minimo) return { texto: 'Bajo', tono: 'ojo' }
  return null
}

const SECCIONES = [
  { id: 'insumos', texto: 'Mercancía' },
  { id: 'comprar', texto: 'Qué comprar' },
  { id: 'perdidas', texto: 'Pérdidas' },
  { id: 'categorias', texto: 'Categorías' },
]
// Las que se ven arriba. "Categorias" sigue existiendo (`?s=categorias`) pero
// no es una pestaña: se administra desde el desplegable de categoria, que es
// donde se piensa en ellas (Leider, 1-oct, como "Lo que quitaste" del menu).
const PESTANAS = SECCIONES.filter((x) => x.id !== 'categorias')

// El renglon del desplegable de categoria que lleva a administrarlas.
const ADMINISTRAR = '__administrar__'

export default function Inventario() {
  const [seccion, irA] = useSeccion(SECCIONES)
  // Solo las perdidas tienen fecha; el stock y que comprar son "a hoy".
  const [rango, setRango] = useRango('30d')
  const dialogo = useDialogo()
  const { tasa } = useMoneda()
  const [ingredientes, setIngredientes] = useState<Ingrediente[]>([])
  const [sugerencias, setSugerencias] = useState<SugerenciaCompra[]>([])
  const [mermas, setMermas] = useState<Merma[]>([])
  const [sobrantes, setSobrantes] = useState<SobranteInventario[]>([])
  const [inflacion, setInflacion] = useState<InflacionInsumos | null>(null)
  const [error, setError] = useState('')
  const [buscar, setBuscar] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  // En que parte del deposito mirar. Vive aparte del filtro de arriba: se
  // puede pedir "lo que esta bajo minimo, de Carnes".
  const [categoria, setCategoria] = useState<string>('todas')
  // Los cajones del deposito. Vienen del servidor y no de la mercancia: una
  // categoria recien creada existe aunque todavia no tenga nada dentro.
  const [cats, setCats] = useState<CategoriaInsumo[]>([])
  const recargarCats = useCallback(
    () => api.listarCategoriasInsumo().then(setCats).catch(() => setCats([])),
    [],
  )
  useEffect(() => {
    void recargarCats()
  }, [recargarCats])

  /** Crear un cajon nuevo desde donde haga falta. Devuelve su id. */
  const crearCategoria = useCallback(
    async (nombre: string) => {
      const cat = await api.crearCategoriaInsumo(nombre)
      await recargarCats()
      return cat.id
    },
    [recargarCats],
  )
  // Lo que hay que ponerle delante al dueno cuando un insumo pega un salto.
  const [impacto, setImpacto] = useState<ImpactoDeCompra | null>(null)
  // La ficha abierta: 'nuevo' o el id del insumo. Se guarda el id y no el
  // objeto para que la ficha vea el stock nuevo despues de cada movimiento.
  const [ficha, setFicha] = useState<'nuevo' | number | null>(null)
  const [contando, setContando] = useState(false)
  const [conteos, setConteos] = useState<ConteoResumen[]>([])
  const [conteoAbierto, setConteoAbierto] = useState<number | null>(null)
  // Arranque de un local nuevo: todavia no hay insumos ni recetas cargadas,
  // y sin esto cada venta se traba en cuanto un producto tenga receta.
  const [config, setConfig] = useState<Configuracion | null>(null)
  const [cambiandoConfig, setCambiandoConfig] = useState(false)

  // Abre por nombre, que es como se busca un insumo; pero el dueno entra aqui
  // a ver que se esta acabando y que subio de precio, y eso son dos clics en
  // "Stock" y en "Reponer".
  const orden = useOrden<Ingrediente>(
    {
      nombre: (i) => i.nombre,
      stock: (i) => i.stock_actual,
      minimo: (i) => i.stock_minimo,
      costo: (i) => i.costo_unitario,
      reponer: (i) => i.costo_reposicion,
      rendimiento: (i) => i.rendimiento_pct,
      real: (i) => i.costo_efectivo,
    },
    'nombre',
  )
  // "Que se boto de queso este mes" sin leer la lista entera.
  const buscadorMermas = useBuscador<Merma>(
    (m) => [m.ingrediente_nombre, m.motivo],
    'Buscar por mercancía o motivo',
  )
  const ordenMermas = useOrden<Merma>(
    {
      fecha: (m) => new Date(m.fecha),
      insumo: (m) => m.ingrediente_nombre,
      cantidad: (m) => m.cantidad,
      motivo: (m) => m.motivo,
      valor: (m) => m.valor,
    },
    '-fecha',
  )

  useEffect(() => {
    cargar()
  }, [rango])

  function cargar() {
    api.listarIngredientes().then(setIngredientes)
    api.sugerenciasCompra().then(setSugerencias)
    api.listarMermas(rango).then(setMermas)
    api.listarSobrantes(rango).then(setSobrantes).catch(() => {})
    api.conteos(rango).then(setConteos).catch(() => setConteos([]))
    api.inflacionInsumos().then(setInflacion).catch(() => setInflacion(null))
    api.obtenerConfig().then(setConfig).catch(() => setConfig(null))
  }

  async function alternarVentaSinInventario() {
    if (!config) return
    setCambiandoConfig(true)
    try {
      setConfig(await api.venderSinInventario(!config.vender_sin_inventario))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cambiar')
    } finally {
      setCambiandoConfig(false)
    }
  }

  const { deshacible } = useDeshacer()

  async function accion(fn: () => Promise<unknown>) {
    setError('')
    try {
      await fn()
      cargar()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ocurrió un error')
      return false
    }
  }

  // ── Movimientos ──────────────────────────────────────────────────────────

  async function comprar(ing: Ingrediente) {
    const r = await dialogo.pedir({
      titulo: `Compra de ${ing.nombre}`,
      // LA DECISION FISCAL, A LA VISTA Y EN EL MOMENTO. Esta compra entra al
      // deposito y sale de la gaveta, pero NO genera credito de IVA: no hay
      // factura que lo respalde. Es correcto para lo que se compra en el
      // mercado, y un error caro si la compra si traia factura -- ese IVA se
      // pierde. Antes no habia forma de saberlo desde aqui (Leider, 24-sep).
      texto: (
        <>
          Compra <strong>sin factura</strong>: entra al depósito y sale de la gaveta, pero{' '}
          <strong>no descuenta IVA</strong>.{' '}
          <a href="/compras?s=nueva" className="underline font-medium">
            Si tienes la factura, cárgala en Compras
          </a>{' '}
          para aprovechar el crédito fiscal.
        </>
      ),
      campos: [
        { nombre: 'cantidad', etiqueta: 'Cuánto entra', sufijo: ing.unidad, tipo: 'numero', min: 0.0001 },
        {
          nombre: 'costo',
          etiqueta: 'Cuánto pagaste en total, sin IVA',
          tipo: 'numero',
          opcional: true,
          ayuda: 'Vacío = se mantiene el costo actual. El IVA no es parte del costo de la mercancía.',
        },
        {
          nombre: 'moneda',
          etiqueta: 'En qué moneda pagaste',
          tipo: 'opciones',
          valor: '$',
          opciones: [
            { valor: '$', texto: 'Dólares' },
            { valor: 'Bs', texto: `Bolívares${tasa?.bcv ? ` (a ${tasa.bcv.toFixed(2)})` : ''}` },
          ],
        },
        {
          nombre: 'metodo',
          etiqueta: 'De dónde salió la plata',
          tipo: 'opciones',
          opciones: METODOS_DE_PAGO.map((m) => ({ valor: m, texto: m })),
        },
      ],
      aceptar: 'Registrar compra',
    })
    if (!r) return
    if (r.moneda === 'Bs' && !tasa?.bcv) {
      setError('No se pudo obtener la tasa del día. Intenta de nuevo o registra en dólares.')
      return
    }
    const costoUsd =
      r.costo && r.moneda === 'Bs' ? Number(r.costo) / (tasa!.bcv as number) : r.costo ? Number(r.costo) : undefined
    await accion(async () => {
      const resultado = await api.registrarCompra(ing.id, Number(r.cantidad), costoUsd, r.metodo)
      // Si el proveedor pego un salto, se dice AHORA. El costo promedio tarda
      // semanas en reflejarlo, y para entonces ya vendiste con el margen viejo
      // en pantalla y el nuevo en la realidad.
      if (resultado.revisar_precios) setImpacto(resultado)
    })
  }

  async function merma(ing: Ingrediente) {
    const r = await dialogo.pedir({
      titulo: `Merma de ${ing.nombre}`,
      texto: 'Lo que se dañó, se quemó o se botó. Es plata perdida y así queda registrada.',
      campos: [
        { nombre: 'cantidad', etiqueta: 'Cuánto se perdió', sufijo: ing.unidad, tipo: 'numero', min: 0.0001 },
        { nombre: 'motivo', etiqueta: 'Motivo', placeholder: 'Se quemó, se dañó, se cayó...', opcional: true },
      ],
      aceptar: 'Registrar merma',
      peligro: true,
    })
    if (!r) return
    accion(() => api.registrarMerma(ing.id, Number(r.cantidad), r.motivo))
  }

  async function consumoPersonal(ing: Ingrediente) {
    // No es merma: una merma es plata perdida y sirve para detectar
    // desperdicio o robo. Esto es un costo laboral autorizado.
    const r = await dialogo.pedir({
      titulo: `Consumo del personal: ${ing.nombre}`,
      texto: 'Se lo comió un empleado. Es costo laboral, no pérdida: no ensucia el indicador de merma.',
      campos: [
        { nombre: 'cantidad', etiqueta: 'Cuánto', sufijo: ing.unidad, tipo: 'numero', min: 0.0001 },
        { nombre: 'motivo', etiqueta: 'Para quién / qué turno', opcional: true },
      ],
      aceptar: 'Registrar',
    })
    if (!r) return
    accion(() => api.consumoPersonal(ing.id, Number(r.cantidad), r.motivo))
  }

  async function contar(ing: Ingrediente) {
    const real = await dialogo.pedirNumero({
      titulo: `Contar ${ing.nombre}`,
      texto: `El sistema dice ${cantidad(ing.stock_actual)} ${ing.unidad}. Lo que diga la balanza manda: la diferencia queda como merma o como sobrante.`,
      etiqueta: 'Cuánto hay realmente',
      sufijo: ing.unidad,
      valor: cantidad(ing.stock_actual),
      aceptar: 'Guardar conteo',
    })
    if (real === null) return
    accion(() => api.ajustarStock(ing.id, real))
  }

  async function revertirMerma(m: Merma) {
    const ok = await dialogo.confirmar({
      titulo: '¿Revertir esta merma?',
      texto:
        `Vuelven ${cantidad(m.cantidad)} ${m.unidad} de ${m.ingrediente_nombre} al inventario.\n\n` +
        'La merma original no se borra: queda marcada como revertida con su asiento de reverso.',
      aceptar: 'Revertir',
    })
    if (ok) accion(() => api.revertirMerma(m.id))
  }

  async function revertirSobrante(sb: SobranteInventario) {
    const ok = await dialogo.confirmar({
      titulo: '¿Revertir este conteo?',
      texto:
        `Salen ${cantidad(sb.cantidad)} ${sb.unidad} de ${sb.ingrediente_nombre} que habían entrado por un conteo hacia arriba.\n\n` +
        'El sobrante no se borra: queda marcado como revertido con su contra-asiento.',
      aceptar: 'Revertir',
    })
    if (ok) accion(() => api.revertirSobrante(sb.id))
  }

  async function guardarFicha(datos: DatosIngrediente, id: number | null) {
    const ok = await accion(() => (id === null ? api.crearIngrediente(datos) : api.actualizarIngrediente(id, datos)))
    if (ok) setFicha(null)
    return ok
  }

  async function archivar(ing: Ingrediente, activo: boolean) {
    if (activo) {
      await guardarFicha({ ...datosDe(ing), activo }, ing.id)
      return
    }
    // Archivar no borra nada y tiene reverso: se hace de una, y el aviso de
    // abajo la devuelve si fue un dedo.
    setFicha(null)
    deshacible({
      clave: `mercancia:${ing.id}`,
      texto: `${ing.nombre} archivada`,
      ejecutar: () => api.actualizarIngrediente(ing.id, { ...datosDe(ing), activo: false }),
      revertir: () => api.actualizarIngrediente(ing.id, { ...datosDe(ing), activo: true }),
      alTerminar: cargar,
      alFallar: (e) => setError(e instanceof Error ? e.message : 'No se pudo archivar'),
    })
  }

  async function conteoGuardado(r: ResultadoConteo) {
    setContando(false)
    cargar()
    const lineas = r.ajustes
      .slice(0, 8)
      .map(
        (a) =>
          `${a.nombre}: ${a.diferencia > 0 ? '+' : ''}${cantidad(a.diferencia)} ${a.unidad} (${dinero(a.valor)})`,
      )
      .join('\n')
    await dialogo.avisar({
      titulo: r.ajustes.length === 0 ? 'El conteo cuadró' : 'Conteo guardado',
      tono: r.faltante_valor > 0 ? 'ojo' : 'bien',
      texto:
        r.ajustes.length === 0
          ? `Las ${r.sin_cambio} mercancías contadas coinciden con el sistema.`
          : `${r.ajustes.length} ajuste(s) · faltante ${dinero(r.faltante_valor)} (queda como merma) · sobrante ${dinero(r.sobrante_valor)}` +
            (r.sin_cambio ? ` · ${r.sin_cambio} cuadraron` : '') +
            `\n\n${lineas}${r.ajustes.length > 8 ? '\n…' : ''}`,
    })
  }

  // ── Lo que se ve ─────────────────────────────────────────────────────────

  const activos = useMemo(() => ingredientes.filter((i) => i.activo !== false), [ingredientes])
  const bajoMinimo = activos.filter((i) => i.stock_actual <= i.stock_minimo)
  const sinCosto = activos.filter((i) => !i.costo_unitario)
  const valorDeposito = activos.reduce((s, i) => s + Math.max(i.stock_actual, 0) * (i.costo_unitario || 0), 0)
  // Separadas a proposito. Un ajuste de conteo baja el stock igual que una
  // merma, pero dice "el sistema estaba mal", no "se boto comida". Sumados en
  // el mismo total sin distincion, el dueno cree que esta perdiendo el triple
  // de lo que pierde y el numero deja de servir para decidir nada. El KPI de
  // arriba muestra el combinado (con su detalle diciendolo), y esta seccion
  // desglosa: son las mismas `vivas`, dos lecturas distintas del mismo dato.
  const vivas = mermas.filter((m) => !m.revertida)
  const perdidas30 = vivas.filter((m) => !m.por_conteo).reduce((s, m) => s + m.valor, 0)
  const ajustes30 = vivas.filter((m) => m.por_conteo).reduce((s, m) => s + m.valor, 0)
  const perdidas = perdidas30 + ajustes30

  const haySinCategoria = ingredientes.some((i) => i.activo !== false && !i.categoria_id)

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    return ingredientes.filter((i) => {
      if (filtro === 'archivados') {
        if (i.activo !== false) return false
      } else if (i.activo === false) return false
      if (filtro === 'bajo' && i.stock_actual > i.stock_minimo) return false
      if (filtro === 'sin-costo' && i.costo_unitario) return false
      if ((filtro === 'insumo' || filtro === 'reventa') && i.tipo !== filtro) return false
      // La categoria filtra POR SEPARADO del resto: "Carnes" y "bajo minimo"
      // son dos preguntas distintas y se pueden hacer a la vez.
      if (categoria === SIN_CATEGORIA && i.categoria_id) return false
      if (categoria !== 'todas' && categoria !== SIN_CATEGORIA && String(i.categoria_id) !== categoria)
        return false
      return !q || i.nombre.toLowerCase().includes(q)
    })
  }, [ingredientes, filtro, buscar, categoria])

  const fichaIng = typeof ficha === 'number' ? ingredientes.find((i) => i.id === ficha) ?? null : null

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Inventario" secciones={PESTANAS} seccion={seccion} alCambiarSeccion={irA} />
      <Pagina ancho="ancha">
        <BarraFiltros rango={rango} alCambiar={setRango} />
        {error && <Aviso>{error}</Aviso>}

        {/* Arranque del local: mientras no haya insumos ni recetas cargadas,
            NO bloquea la venta. SOLO A LA VISTA CUANDO ESTA PRENDIDO: es un
            aviso ("ojo, no se controla el stock"), y apagado ocupaba la parte
            de arriba de las cuatro pestañas sin decir nada (Leider, 1-oct).
            Prenderlo se hace desde el "⋯" de la mercancia. */}
        {config?.vender_sin_inventario && (
          <div
            className={`rounded-2xl border p-4 flex items-center justify-between gap-4 ${
              config.vender_sin_inventario
                ? 'bg-aviso-50 border-aviso-300'
                : 'bg-white border-neutral-200'
            }`}
          >
            <div>
              <h2 className={`font-semibold ${config.vender_sin_inventario ? 'text-aviso-900' : ''}`}>
                Vender sin control de inventario
              </h2>
              <p className={`text-sm mt-0.5 ${config.vender_sin_inventario ? 'text-aviso-800' : 'text-neutral-500'}`}>
                {config.vender_sin_inventario
                  ? 'Prendido: ninguna venta se traba por falta de stock, aunque un producto tenga receta.'
                  : 'Para arrancar el local sin mercancía ni recetas cargadas todavía. Apágalo cuando el inventario esté al día.'}
              </p>
            </div>
            <button
              onClick={alternarVentaSinInventario}
              disabled={cambiandoConfig}
              className={`shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-40 ${
                config.vender_sin_inventario
                  ? 'bg-neutral-900 text-white'
                  : 'border border-neutral-300 text-neutral-700'
              }`}
            >
              {config.vender_sin_inventario ? 'Apagar' : 'Encender'}
            </button>
          </div>
        )}

        {seccion === 'insumos' && (
          <>
        {/* Las cuatro cifras que dicen como esta el deposito sin leer la tabla. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Cifra
            titulo="Mercancía"
            ayuda="kpi.insumos"
            valor={String(activos.length)}
            detalle={`${activos.filter((i) => i.tipo !== 'reventa').length} materia prima · ${activos.filter((i) => i.tipo === 'reventa').length} reventa`}
          />
          <Cifra
            titulo={nombre('kpi.bajo_minimo')}
            ayuda="kpi.bajo_minimo"
            valor={String(bajoMinimo.length)}
            detalle={bajoMinimo.length ? 'Toca para verlos' : 'Todo por encima del mínimo'}
            tono={bajoMinimo.length ? 'alerta' : 'bien'}
          />
          <Cifra titulo={nombre('kpi.valor_deposito')} ayuda="kpi.valor_deposito" valor={dinero(valorDeposito)} detalle="Stock × costo promedio, sin IVA" />
          <Cifra
            titulo={`Pérdidas · ${nombreRango(rango).toLowerCase()}`}
            ayuda="kpi.perdidas_30"
            valor={dinero(perdidas)}
            detalle="Mermas y faltantes de conteo"
            tono={perdidas > 0 ? 'alerta' : 'normal'}
          />
        </div>

        {/* UNA SOLA BARRA: buscar, los dos filtros y las dos acciones.
            Antes eran once pastillas repartidas en dos filas, y el numero de
            pastillas crecia con las categorias del local: con veinte, la fila
            se volvia un carrusel que hay que arrastrar para ver que hay
            (Leider, 24-sep: "tienes que pensar en escalabilidad"). Dos
            desplegables ocupan lo mismo con tres opciones que con doscientas,
            y ademas dicen QUE se esta filtrando en vez de dejarlo deducir.

            La cuenta de "bajo minimo" no se pierde por dejar las pastillas:
            esta arriba, en su cifra, que es donde se mira de todos modos. */}
        <div className="vp-losa p-3 flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Buscar mercancía…"
            className="border border-neutral-300 rounded-lg px-3 py-2 text-sm w-full sm:w-56 shrink-0"
          />
          <FiltroDesplegable
            etiqueta="Ver"
            valor={filtro}
            alCambiar={(v) => setFiltro(v as Filtro)}
            opciones={FILTROS.filter(
              (f) => f.valor !== 'archivados' || ingredientes.length - activos.length > 0,
            ).map((f) => ({
              valor: f.valor,
              texto: f.texto,
              contador:
                f.valor === 'bajo'
                  ? bajoMinimo.length
                  : f.valor === 'sin-costo'
                    ? sinCosto.length
                    : f.valor === 'archivados'
                      ? ingredientes.length - activos.length
                      : null,
            }))}
          />
          {/* Solo si hay algo que agrupar: un local que todavia no clasifico
              nada no gana nada con un desplegable que solo dice "Todo". */}
          {(cats.length > 0 || haySinCategoria) && (
            <FiltroDesplegable
              etiqueta="Categoría"
              valor={categoria}
              alCambiar={(v) => (v === ADMINISTRAR ? irA('categorias') : setCategoria(v))}
              opciones={[
                { valor: 'todas', texto: 'Todo el depósito' },
                ...cats.map((c) => ({ valor: String(c.id), texto: c.nombre, contador: c.usos })),
                ...(haySinCategoria
                  ? [
                      {
                        valor: SIN_CATEGORIA,
                        texto: 'Sin categoría',
                        contador: activos.filter((i) => !i.categoria_id).length,
                      },
                    ]
                  : []),
                { valor: ADMINISTRAR, texto: 'Administrar categorías…', detalle: 'crear, renombrar, mover mercancía' },
              ]}
            />
          )}
          {cats.length === 0 && !haySinCategoria && (
            <button
              type="button"
              onClick={() => irA('categorias')}
              className="h-9 px-3 rounded-full text-sm text-neutral-500 hover:text-neutral-900 hover:bg-neutral-500/10"
            >
              Categorías
            </button>
          )}
          <div className="flex items-center gap-2 shrink-0 ml-auto">
            <Boton tono="suave" onClick={() => setContando(true)} disabled={activos.length === 0}>
              Conteo físico
            </Boton>
            <Boton onClick={() => setFicha('nuevo')}>+ Nueva mercancía</Boton>
            {config && (
              <MenuAcciones
                etiqueta="Más opciones del inventario"
                opciones={[
                  {
                    texto: config.vender_sin_inventario
                      ? 'Apagar la venta sin control de inventario'
                      : 'Vender sin control de inventario',
                    ayuda: config.vender_sin_inventario
                      ? 'Las ventas vuelven a descontar y trabarse por stock'
                      : 'Para arrancar sin mercancía ni recetas: ninguna venta se traba por stock',
                    onElegir: () => void alternarVentaSinInventario(),
                  },
                  { texto: 'Administrar categorías', onElegir: () => irA('categorias') },
                ]}
              />
            )}
          </div>
        </div>

        <Tabla orden={orden} glosario="inventario" className="bg-white rounded-2xl border border-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-neutral-500/8 text-neutral-500 text-xs uppercase">
              <tr>
                <Th clave="nombre">Mercancía</Th>
                <Th clave="stock" alinear="derecha">{nombre('inventario.stock')}</Th>
                <Th clave="minimo" alinear="derecha">Mínimo</Th>
                <Th clave="costo" alinear="derecha">{nombre('inventario.costo')}</Th>
                {/* El promedio ponderado no dice cuanto cuesta comprar mas: esa
                    es la cuenta que importa para poner precios. */}
                <Th clave="reponer" alinear="derecha">{nombre('inventario.reponer')}</Th>
                <Th clave="rendimiento" alinear="derecha">{nombre('inventario.rendimiento')}</Th>
                <Th clave="real" alinear="derecha">Costo real</Th>
                <th aria-label="Abrir" className="w-8" />
              </tr>
            </thead>
            <tbody>
              {visibles.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <Vacio
                      icono="inventario"
                      titulo={ingredientes.length === 0 ? 'Todavía no hay mercancía' : 'Nada con ese filtro'}
                      detalle={
                        ingredientes.length === 0
                          ? 'Carga la materia prima y la mercancía de reventa; después las recetas dicen cuánto lleva cada producto.'
                          : undefined
                      }
                      accion={ingredientes.length === 0 ? <Boton onClick={() => setFicha('nuevo')}>+ Nueva mercancía</Boton> : undefined}
                    />
                  </td>
                </tr>
              )}
              {orden.ordenar(visibles).map((ing) => {
                const estado = estadoStock(ing)
                const archivado = ing.activo === false
                return (
                  // UN TOQUE ABRE LA FICHA, donde estan compra, merma, conteo e
                  // historial. Cada renglon traia tres botones (+ Compra,
                  // − Merma, Más): con cincuenta mercancias eran ciento
                  // cincuenta botones (Leider, 1-oct).
                  <tr
                    key={ing.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setFicha(ing.id)}
                    onKeyDown={(e) => e.key === 'Enter' && setFicha(ing.id)}
                    className={`vp-celda cursor-pointer border-t border-neutral-100 ${archivado ? 'opacity-60' : ''}`}
                  >
                    <td className="p-3">
                      <span className="block text-left font-medium">{ing.nombre}</span>
                      <span className="block text-[11px] text-neutral-400 mt-0.5">
                        {ing.categoria && (
                          <span className="text-neutral-500 font-medium">{ing.categoria} · </span>
                        )}
                        {ing.tipo === 'reventa' ? 'Reventa' : 'Materia prima'} · por {ing.unidad}
                        {!archivado && <span className="text-neutral-400"> · toca para comprar, mermar o editar</span>}
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
                      {ing.costo_unitario ? (
                        dinero(ing.costo_unitario)
                      ) : (
                        <span className="text-aviso-600 font-semibold">cargar</span>
                      )}
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
                    <td className="text-right p-3 tabular-nums">
                      {ing.tipo === 'reventa' ? (
                        <span className="text-neutral-300">—</span>
                      ) : (
                        <span className={ing.rendimiento_pct < 100 ? 'text-aviso-600 font-medium' : 'text-neutral-400'}>
                          {ing.rendimiento_pct}%
                        </span>
                      )}
                    </td>
                    <td className="text-right p-3 tabular-nums font-semibold">{dinero(ing.costo_efectivo)}</td>
                    <td className="p-3 pr-4 text-right">
                      {archivado ? (
                        <span onClick={(e) => e.stopPropagation()}>
                          <AccionFila onClick={() => archivar(ing, true)}>Reactivar</AccionFila>
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
          </>
        )}

        {seccion === 'comprar' && (
          <>
        {/* Sin nada que comprar la seccion quedaba en blanco y parecia un
            error (Leider, 1-oct, lo mismo que en Reportes): lo dice. */}
        {sugerencias.length === 0 && (
          <div className="bg-white rounded-2xl border border-neutral-200">
            <Vacio
              icono="ok"
              titulo="Nada por comprar ahora mismo"
              detalle="Todo está por encima del mínimo y alcanza más de una semana al ritmo de venta de las últimas dos semanas."
            />
          </div>
        )}
        {sugerencias.length > 0 && (
          <Seccion
            titulo="Qué comprar"
            ayuda="Lo que está bajo mínimo o, al ritmo de venta de las últimas dos semanas, no llega a la próxima."
          >
            <ul className="divide-y divide-neutral-100">
              {sugerencias.map((s) => (
                <li key={s.ingrediente_id} className="py-2.5 flex justify-between items-center gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">{s.ingrediente_nombre}</div>
                    <div className="text-xs text-neutral-500">{s.razon}</div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-semibold tabular-nums whitespace-nowrap">
                      +{s.cantidad_sugerida} {s.unidad}
                    </span>
                    {(() => {
                      const ing = ingredientes.find((i) => i.id === s.ingrediente_id)
                      return ing ? <AccionFila onClick={() => comprar(ing)}>+ Compra</AccionFila> : null
                    })()}
                  </div>
                </li>
              ))}
            </ul>
          </Seccion>
        )}

        {/* El numero que dice si tus precios se estan quedando atras. El costo
            promedio no lo muestra: mezcla lo caro nuevo con lo barato viejo. */}
        {inflacion && inflacion.cambio_pct >= 15 && (
          <Aviso tono="ojo">
            <p className="font-semibold">
              Tu mercancía subió {inflacion.cambio_pct.toFixed(0)}% en {inflacion.dias} días
            </p>
            <ul className="mt-2 space-y-1">
              {inflacion.insumos.slice(0, 5).map((i) => (
                <li key={i.ingrediente_id} className="flex justify-between gap-3">
                  <span>{i.nombre}</span>
                  <span className="tabular-nums whitespace-nowrap">
                    {dinero(i.costo_inicial)} → {dinero(i.costo_actual)} <b>+{i.cambio_pct.toFixed(0)}%</b>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs mt-2 opacity-80">
              Si tus precios no subieron parecido, cada venta te deja menos de lo que necesitas para reponer.
              En Menú está el precio sugerido de cada producto.
            </p>
          </Aviso>
        )}
          </>
        )}

        {seccion === 'categorias' && (
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-xl font-semibold tracking-tight">Categorías del depósito</h2>
            <button type="button" onClick={() => irA('insumos')} className="text-sm text-neutral-500 hover:text-neutral-900">
              ← Volver a la mercancía
            </button>
          </div>
        )}
        {seccion === 'categorias' && (
          <SeccionCategorias
            categorias={cats}
            ingredientes={ingredientes}
            onCambio={async () => {
              await recargarCats()
              await cargar()
            }}
          />
        )}

        {seccion === 'perdidas' && (
          <>
        {/* Sin esta lista el dueno no podia ver cuanto se perdia ni corregir
            una merma duplicada: era la unica perdida del sistema sin historial. */}
        <Seccion
          titulo="Pérdidas registradas"
          ayuda={`Lo que se botó o se dañó (${nombreRango(rango).toLowerCase()}). Los faltantes de un conteo se listan aparte: bajan el stock igual, pero dicen que el sistema estaba mal, no que se perdió comida. Una merma por error se revierte: no se borra, queda el reverso asentado.`}
          accion={
            <span className="text-right text-sm">
              <b className="block tabular-nums">{dinero(perdidas30)}</b>
              {ajustes30 > 0 && (
                <span className="block text-[11px] font-normal text-neutral-500 tabular-nums">
                  + {dinero(ajustes30)} en ajustes de conteo
                </span>
              )}
            </span>
          }
          plano
        >
          {mermas.length === 0 ? (
            <Vacio titulo="Sin pérdidas registradas" detalle="Bien ahí." />
          ) : (
            <Tabla orden={ordenMermas} buscador={buscadorMermas} glosario="perdidas">
              <table className="w-full text-sm">
                <thead className="bg-neutral-500/8 text-neutral-500 text-xs uppercase">
                  <tr>
                    <Th clave="fecha">Fecha</Th>
                    <Th clave="insumo">Mercancía</Th>
                    <Th clave="cantidad" alinear="derecha">Cantidad</Th>
                    <Th clave="motivo">Motivo</Th>
                    <Th clave="valor" alinear="derecha">Valor</Th>
                    <Th alinear="derecha"></Th>
                  </tr>
                </thead>
                <tbody>
                  {ordenMermas.ordenar(buscadorMermas.filtrar(mermas)).map((m) => (
                    <tr key={m.id} className={`border-t border-neutral-100 ${m.revertida ? 'opacity-50' : ''}`}>
                      <td className="p-3 text-neutral-500 whitespace-nowrap">{new Date(m.fecha).toLocaleDateString('es-VE')}</td>
                      <td className="p-3 font-medium">{m.ingrediente_nombre}</td>
                      <td className="p-3 text-right tabular-nums whitespace-nowrap">
                        {cantidad(m.cantidad)} {m.unidad}
                      </td>
                      <td className="p-3 text-neutral-500">
                        {m.por_conteo && <Pastilla tono="ojo">conteo</Pastilla>}{' '}
                        {m.motivo || '—'}
                      </td>
                      <td
                        className={`p-3 text-right tabular-nums font-medium ${
                          m.por_conteo ? 'text-neutral-500' : 'text-peligro-600'
                        }`}
                      >
                        {dinero(m.valor)}
                      </td>
                      <td className="p-3 text-right">
                        {m.revertida ? (
                          <span className="text-xs text-neutral-500">revertida</span>
                        ) : (
                          <AccionFila onClick={() => revertirMerma(m)}>Revertir</AccionFila>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Tabla>
          )}
        </Seccion>

        {/* El faltante siempre tuvo vuelta atras (queda como merma); el
            sobrante no, aunque es el mismo dedo en el mismo formulario. */}
        {sobrantes.length > 0 && (
          <Seccion
            titulo="Conteos que sumaron stock"
            ayuda="Entraron al inventario por un conteo físico hacia arriba. Si fue un error de tecleo, se puede revertir."
          >
            <ul className="divide-y divide-neutral-100 text-sm">
              {sobrantes.map((sb) => (
                <li key={sb.id} className="py-2 flex items-center justify-between gap-2">
                  <span className={sb.revertido ? 'text-neutral-400 line-through' : ''}>
                    {sb.ingrediente_nombre}
                    <span className="ml-1 text-xs text-neutral-400">
                      +{cantidad(sb.cantidad)} {sb.unidad} · {new Date(sb.fecha).toLocaleDateString('es-VE')}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="tabular-nums">{dinero(sb.valor)}</span>
                    {!sb.revertido && <AccionFila onClick={() => revertirSobrante(sb)}>Revertir</AccionFila>}
                  </span>
                </li>
              ))}
            </ul>
          </Seccion>
        )}

        {/* El historial de PLANILLAS, que es distinto del de diferencias. Las
            dos listas de arriba dicen qué faltó; esta dice cuándo se contó,
            quién contó y si fue a ciegas. Sin ella no había cómo responder
            "¿cuándo fue el último conteo?" ni comparar una semana con otra. */}
        <Seccion
          titulo="Conteos hechos"
          ayuda="Cada planilla de inventario físico que se cargó, con lo que encontró. Un conteo a ciegas -sin ver lo que el sistema esperaba- es el que de verdad prueba algo."
        >
          {conteos.length === 0 ? (
            <p className="text-sm text-neutral-500">
              Todavía no se ha hecho ningún conteo en este período.
            </p>
          ) : (
            <ul className="divide-y divide-neutral-100 text-sm">
              {conteos.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setConteoAbierto(c.id)}
                    className="w-full py-2 flex items-center justify-between gap-2 text-left hover:bg-neutral-50"
                  >
                    <span>
                      {new Date(c.fecha).toLocaleDateString('es-VE')}
                      {c.ciego && <> <Pastilla tono="bien">a ciegas</Pastilla></>}
                      <span className="block text-xs text-neutral-400">
                        {c.contados} mercancía(s) · {c.cuadraron} cuadraron
                        {c.operador && ` · ${c.operador}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-right tabular-nums">
                      <span
                        className={
                          c.neto < 0 ? 'text-peligro-600 font-medium' : 'text-neutral-600'
                        }
                      >
                        {c.neto < 0 ? '−' : c.neto > 0 ? '+' : ''}
                        {dinero(Math.abs(c.neto))}
                      </span>
                      <span className="block text-xs text-neutral-400">
                        faltó {dinero(c.faltante_valor)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Seccion>
          </>
        )}
      </Pagina>

      {conteoAbierto !== null && (
        <DetalleConteo id={conteoAbierto} onCerrar={() => setConteoAbierto(null)} />
      )}

      {(ficha === 'nuevo' || fichaIng) && (
        <FichaInsumo
          ing={fichaIng}
          mermas={fichaIng ? mermas.filter((m) => m.ingrediente_id === fichaIng.id && !m.revertida) : []}
          onCerrar={() => setFicha(null)}
          categorias={cats}
          onCrearCategoria={crearCategoria}
          onGuardar={async (datos) => {
            const ok = await guardarFicha(datos, fichaIng?.id ?? null)
            // Los conteos por categoria cambian al mover una mercancia.
            if (ok) void recargarCats()
            return ok
          }}
          acciones={{ comprar, merma, consumoPersonal, contar, archivar: (ing) => archivar(ing, false) }}
        />
      )}

      {contando && <ConteoFisico ingredientes={activos} onCerrar={() => setContando(false)} onGuardado={conteoGuardado} />}


      {/* El aviso llega en el momento de la compra, no cuando el promedio por
          fin se mueva - para entonces ya vendiste semanas al precio viejo. */}
      {impacto && (
        <Modal
          titulo={`${impacto.ingrediente.nombre} subió ${impacto.salto_pct?.toFixed(0)}%`}
          onCerrar={() => setImpacto(null)}
          pie={<Boton onClick={() => setImpacto(null)}>Entendido</Boton>}
        >
          <p className="text-sm text-neutral-600 mt-1">
            Pagaste {dinero(impacto.costo_pagado)} por {impacto.ingrediente.unidad}; la compra anterior fue a{' '}
            {dinero(impacto.costo_anterior)}.
          </p>
          {/* Un salto de 200% o mas casi nunca es inflacion: es un saco
              tecleado como 1, y deja el costo 50x inflado. */}
          {impacto.posible_error_de_unidad && (
            <div className="mt-3 rounded-xl border border-peligro-300 bg-peligro-50 p-3 text-sm text-peligro-800">
              <b>Revisa la cantidad.</b> {impacto.posible_error_de_unidad}
            </div>
          )}
          <p className="text-xs text-neutral-500 mt-2">
            El costo promedio quedó en {dinero(impacto.ingrediente.costo_unitario)} porque mezcla lo que ya tenías.
            Los márgenes de abajo son los de verdad: los que te quedan si tienes que reponer a este precio.
          </p>

          {impacto.productos.length > 0 ? (
            <div className="mt-4 space-y-2">
              {impacto.productos.map((p) => (
                <div
                  key={p.variante_id}
                  className={`rounded-xl border p-3 text-sm ${
                    p.a_perdida
                      ? 'bg-peligro-50 border-peligro-200'
                      : p.margen_flaco
                        ? 'bg-aviso-50 border-aviso-200'
                        : 'bg-neutral-50 border-neutral-200'
                  }`}
                >
                  <div className="flex justify-between gap-2 font-medium">
                    <span>{p.nombre}</span>
                    <span className="tabular-nums whitespace-nowrap">{dinero(p.precio)}</span>
                  </div>
                  <div className="text-neutral-600 mt-1">
                    margen {p.margen_antes_pct?.toFixed(0)}% →{' '}
                    <b className={p.a_perdida ? 'text-peligro-700' : ''}>{p.margen_despues_pct?.toFixed(0)}%</b>
                    {p.a_perdida && ' · lo vendes a pérdida'}
                  </div>
                  {p.precio_sugerido != null && (
                    <div className="text-neutral-700 mt-1">
                      Para mantener tu margen: <b className="tabular-nums">{dinero(p.precio_sugerido)}</b>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-neutral-600">Ningún producto del menú usa esta mercancía todavía.</p>
          )}
        </Modal>
      )}
    </div>
  )
}

/** Un boton chico de fila: cabe de a tres sin que la tabla se ensanche. */
function AccionFila({
  tono = 'normal',
  className = '',
  ...resto
}: { tono?: 'normal' | 'peligro' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...resto}
      className={`text-xs font-medium px-2.5 py-1 rounded-lg border whitespace-nowrap ${
        tono === 'peligro'
          ? 'border-peligro-200 text-peligro-600 hover:bg-peligro-50'
          : 'border-neutral-200 text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50'
      } ${className}`}
    />
  )
}

function datosDe(ing: Ingrediente): DatosIngrediente {
  return {
    nombre: ing.nombre,
    unidad: ing.unidad,
    stock_minimo: ing.stock_minimo,
    stock_objetivo: ing.stock_objetivo,
    costo_unitario: ing.costo_unitario,
    rendimiento_pct: ing.rendimiento_pct,
    tipo: ing.tipo ?? 'insumo',
    categoria_id: ing.categoria_id ?? null,
    activo: ing.activo !== false,
    exento: ing.exento ?? false,
  }
}

// ── La ficha ─────────────────────────────────────────────────────────────────

/**
 * Todo lo de un insumo en un sitio: sus datos, sus movimientos y su historial
 * de costos. Sirve para crear (sin `ing`) y para editar.
 */
function FichaInsumo({
  ing,
  mermas,
  categorias,
  onCrearCategoria,
  onCerrar,
  onGuardar,
  acciones,
}: {
  ing: Ingrediente | null
  mermas: Merma[]
  /** Los cajones del deposito, para elegir en cual va esta mercancia. */
  categorias: CategoriaInsumo[]
  /** Crear uno nuevo sin salir de la ficha. Devuelve su id. */
  onCrearCategoria: (nombre: string) => Promise<number>
  onCerrar: () => void
  onGuardar: (datos: DatosIngrediente) => Promise<boolean>
  acciones: {
    comprar: (i: Ingrediente) => void
    merma: (i: Ingrediente) => void
    consumoPersonal: (i: Ingrediente) => void
    contar: (i: Ingrediente) => void
    archivar: (i: Ingrediente) => void
  }
}) {
  const nuevo = ing === null
  const dialogo = useDialogo()
  const [f, setF] = useState(() => ({
    nombre: ing?.nombre ?? '',
    tipo: (ing?.tipo ?? 'insumo') as 'insumo' | 'reventa',
    categoria_id: ing?.categoria_id ?? null,
    unidad: ing?.unidad ?? 'kg',
    stock_actual: '',
    stock_minimo: ing ? cantidad(ing.stock_minimo) : '',
    stock_objetivo: ing ? cantidad(ing.stock_objetivo) : '',
    costo_unitario: ing ? String(ing.costo_unitario) : '',
    rendimiento_pct: ing ? String(ing.rendimiento_pct) : '100',
    exento: ing?.exento ?? false,
  }))
  const [aviso, setAviso] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [historial, setHistorial] = useState<CompraDeInsumo[] | null>(null)
  const [extracto, setExtracto] = useState<ExtractoInsumo | null>(null)
  // Desde cuándo se está auditando. Vacío = toda la vida del insumo, que es
  // como venía; con fecha, el extracto trae saldo de apertura y totales y se
  // puede comprobar que inicial + entradas − salidas da el final.
  const [desdeExtracto, setDesdeExtracto] = useState('')
  const ordenMovimientos = useOrden<MovimientoInventario>(
    {
      fecha: (m) => new Date(m.fecha),
      movimiento: (m) => m.etiqueta,
      quien: (m) => m.operador ?? '',
      cantidad: (m) => m.cantidad,
      saldo: (m) => m.saldo,
    },
    '-fecha',
  )

  const ordenHistorial = useOrden<CompraConVariacion>(
    {
      fecha: (c) => new Date(c.fecha),
      cantidad: (c) => c.cantidad,
      costo: (c) => c.costo_unitario,
      cambio: (c) => c.cambio,
    },
    '-fecha',
  )

  // Depende del objeto entero a proposito: la lista trae un objeto nuevo en
  // cada refresco, y un refresco con la ficha abierta es porque un movimiento
  // acaba de tocar este insumo -- justo cuando el historial tiene que cambiar.
  useEffect(() => {
    if (!ing) return
    api
      .historialCostos(ing.id)
      .then(setHistorial)
      .catch(() => setHistorial([]))
    api
      .movimientosDeInsumo(ing.id, 200, desdeExtracto ? { desde: `${desdeExtracto}T00:00:00` } : undefined)
      .then(setExtracto)
      .catch(() => setExtracto(null))
  }, [ing, desdeExtracto])

  const num = (v: string) => Number(v.trim().replace(',', '.'))
  const poner = (k: keyof typeof f, v: string | number | null | boolean) =>
    setF((a) => ({ ...a, [k]: v }))

  async function guardar() {
    setAviso('')
    if (!f.nombre.trim()) return setAviso('La mercancía necesita un nombre.')
    const minimo = f.stock_minimo === '' ? 0 : num(f.stock_minimo)
    const objetivo = f.stock_objetivo === '' ? 0 : num(f.stock_objetivo)
    const costo = f.costo_unitario === '' ? 0 : num(f.costo_unitario)
    const rendimiento = f.tipo === 'reventa' ? 100 : num(f.rendimiento_pct)
    const inicial = f.stock_actual === '' ? 0 : num(f.stock_actual)
    if ([minimo, objetivo, costo, inicial].some((n) => !Number.isFinite(n) || n < 0))
      return setAviso('Las cantidades y el costo tienen que ser números, y no negativos.')
    if (!Number.isFinite(rendimiento) || rendimiento <= 0 || rendimiento > 100)
      return setAviso('El rendimiento va de 1 a 100.')
    setGuardando(true)
    await onGuardar({
      nombre: f.nombre.trim(),
      tipo: f.tipo,
      categoria_id: f.categoria_id,
      unidad: f.unidad,
      stock_minimo: minimo,
      stock_objetivo: objetivo,
      costo_unitario: costo,
      rendimiento_pct: rendimiento,
      activo: ing?.activo !== false,
      exento: f.exento,
      ...(nuevo ? { stock_actual: inicial } : {}),
    })
    setGuardando(false)
  }

  const perdidaTotal = mermas.reduce((s, m) => s + m.valor, 0)

  return (
    <Modal
      titulo={nuevo ? 'Nueva mercancía' : ing.nombre}
      ayuda={
        nuevo
          ? 'Materia prima para las recetas, o mercancía que se compra y se vende tal cual.'
          : `${ing.tipo === 'reventa' ? 'Reventa' : 'Materia prima'} · hay ${cantidad(ing.stock_actual)} ${ing.unidad} · costo real ${dinero(ing.costo_efectivo)} por ${ing.unidad}`
      }
      onCerrar={onCerrar}
      ancho="lg"
      pie={
        <>
          {!nuevo && (
            <Boton tono="peligro" onClick={() => acciones.archivar(ing)} className="mr-auto">
              Archivar
            </Boton>
          )}
          <Boton tono="suave" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton onClick={guardar} disabled={guardando}>
            {nuevo ? 'Crear mercancía' : 'Guardar cambios'}
          </Boton>
        </>
      }
    >
      {aviso && (
        <div className="mb-3">
          <Aviso>{aviso}</Aviso>
        </div>
      )}

      {/* Los movimientos van ARRIBA en la ficha de un insumo existente: es a
          lo que se viene el 90 % de las veces; editar el minimo es raro. */}
      {!nuevo && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
          <Boton tono="suave" onClick={() => acciones.comprar(ing)}>
            + Compra
          </Boton>
          <Boton tono="suave" onClick={() => acciones.merma(ing)} className="text-peligro-600">
            − Merma
          </Boton>
          <Boton tono="suave" onClick={() => acciones.consumoPersonal(ing)}>
            Personal
          </Boton>
          <Boton tono="suave" onClick={() => acciones.contar(ing)}>
            Contar
          </Boton>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Campo etiqueta="Nombre" value={f.nombre} onChange={(e) => poner('nombre', e.target.value)} autoFocus={nuevo} className="sm:col-span-2" />
        <Selector etiqueta="Qué es" value={f.tipo} onChange={(e) => poner('tipo', e.target.value)}>
          <option value="insumo">Materia prima (entra en recetas)</option>
          <option value="reventa">Reventa (se vende tal cual)</option>
        </Selector>
        {/* AQUI se le pone cajon a una mercancia, y AQUI se le cambia: es la
            misma accion. La ultima opcion crea uno nuevo sin salir de la ficha,
            porque acordarse de la categoria suele pasar justo al cargar algo,
            y mandar al dueño a otra pantalla en ese momento es perder el hilo. */}
        <Selector
          etiqueta="Categoría"
          value={f.categoria_id === null ? '' : String(f.categoria_id)}
          onChange={async (e) => {
            const v = e.target.value
            if (v !== 'nueva') {
              poner('categoria_id', v === '' ? null : Number(v))
              return
            }
            const nombre = await dialogo.pedirTexto({
              titulo: 'Nueva categoría',
              texto: 'Un cajón del depósito: Carnes, Lácteos, Empaques…',
              etiqueta: 'Nombre',
            })
            if (!nombre?.trim()) return
            poner('categoria_id', await onCrearCategoria(nombre))
          }}
        >
          <option value="">Sin categoría</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
          <option value="nueva">+ Nueva categoría…</option>
        </Selector>
        <Selector etiqueta="Se mide en" value={f.unidad} onChange={(e) => poner('unidad', e.target.value)}>
          {UNIDADES.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </Selector>
        {nuevo && (
          <Campo
            etiqueta={`Stock inicial (${f.unidad})`}
            inputMode="decimal"
            value={f.stock_actual}
            onChange={(e) => poner('stock_actual', e.target.value)}
            placeholder="0"
            ayuda="Lo que hay hoy. Después el stock se mueve con compras, mermas y conteos."
          />
        )}
        <Campo
          etiqueta={`Mínimo (${f.unidad})`}
          inputMode="decimal"
          value={f.stock_minimo}
          onChange={(e) => poner('stock_minimo', e.target.value)}
          placeholder="0"
          ayuda="Por debajo de esto avisa que hay que comprar."
        />
        <Campo
          etiqueta={`Objetivo (${f.unidad})`}
          inputMode="decimal"
          value={f.stock_objetivo}
          onChange={(e) => poner('stock_objetivo', e.target.value)}
          placeholder="0"
          ayuda="Hasta dónde se repone al comprar."
        />
        <Campo
          etiqueta={`Costo por ${f.unidad}, sin IVA ($)`}
          inputMode="decimal"
          value={f.costo_unitario}
          onChange={(e) => poner('costo_unitario', e.target.value)}
          placeholder="0.00"
          ayuda={nuevo ? 'Lo que pagas hoy. Cada compra lo va promediando.' : 'Promedio de lo que hay. Las compras lo actualizan solas.'}
        />
        {f.tipo !== 'reventa' && (
          <Campo
            etiqueta="Rendimiento (%)"
            inputMode="decimal"
            value={f.rendimiento_pct}
            onChange={(e) => poner('rendimiento_pct', e.target.value)}
            ayuda="Cuánto queda utilizable después de limpiar o cocinar. 100 = no se pierde nada."
          />
        )}
        <label className="flex items-center gap-2 text-sm mt-1 sm:col-span-2">
          <input
            type="checkbox"
            checked={f.exento}
            onChange={(e) => setF((a) => ({ ...a, exento: e.target.checked }))}
          />
          <span>
            Exento de IVA
            <span className="block text-xs text-neutral-500">
              La mayoría de los alimentos básicos lo son. Cambia el IVA de las facturas donde aparezca esta mercancía.
            </span>
          </span>
        </label>
      </div>

      {!nuevo && (
        <div className="mt-6 space-y-4">
          {mermas.length > 0 && (
            <p className="text-sm text-neutral-600">
              Pérdidas en 30 días: <b className="text-peligro-600 tabular-nums">{dinero(perdidaTotal)}</b> en{' '}
              {mermas.length} registro(s).
            </p>
          )}
          {/* El extracto va primero: "que paso con mi queso" es la pregunta
              que trae al dueno aca. Antes habia que abrir cuatro pantallas y
              aun asi faltaban el consumo del personal y las compras sueltas. */}
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <p className="vp-etiqueta">Movimientos</p>
              <div className="ml-auto flex items-center gap-2">
                <label className="text-xs text-neutral-500">Desde</label>
                <input
                  type="date"
                  value={desdeExtracto}
                  onChange={(e) => setDesdeExtracto(e.target.value)}
                  className="border border-neutral-300 rounded-lg px-2 py-1 text-xs"
                />
                {desdeExtracto && (
                  <button
                    type="button"
                    onClick={() => setDesdeExtracto('')}
                    className="text-xs text-neutral-500 hover:text-neutral-800"
                  >
                    Todo
                  </button>
                )}
                <a
                  href={`/api/inventario/ingredientes/${ing.id}/movimientos/exportar${
                    desdeExtracto ? `?desde=${desdeExtracto}T00:00:00` : ''
                  }`}
                  className="text-xs font-medium text-acento-700 hover:underline"
                >
                  Descargar
                </a>
              </div>
            </div>
            {extracto === null ? (
              <p className="text-sm text-neutral-400">Cargando…</p>
            ) : extracto.movimientos.length === 0 ? (
              <p className="text-sm text-neutral-500">
                {desdeExtracto
                  ? 'No se movió nada en ese período.'
                  : 'Todavía no se ha movido nada.'}
              </p>
            ) : (
              <>
                <ResumenDelExtracto e={extracto} desde={desdeExtracto} />
                {!extracto.cuadra && (
                  <div className="mb-2">
                    <Aviso tono="mal">
                      El libro suma {cantidad(extracto.saldo_segun_libro)} {ing.unidad} y la
                      existencia dice {cantidad(extracto.stock_actual)}. Algo movió el stock sin
                      anotarlo: avísale a quien mantiene el sistema.
                    </Aviso>
                  </div>
                )}
                <Tabla orden={ordenMovimientos} glosario="movimientos" className="border border-neutral-200 rounded-xl">
                  <table className="w-full text-sm">
                    <thead className="bg-neutral-500/8 text-neutral-500 text-xs uppercase">
                      <tr>
                        <Th clave="fecha">Fecha</Th>
                        <Th clave="movimiento">Movimiento</Th>
                        <Th clave="quien">Quién</Th>
                        <Th clave="cantidad" alinear="derecha">Cantidad</Th>
                        <Th clave="valor" alinear="derecha">Costo</Th>
                        <Th clave="saldo" alinear="derecha">Saldo</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {ordenMovimientos.ordenar(extracto.movimientos).map((m) => (
                        <tr key={m.id} className="border-t border-neutral-100">
                          <td className="p-2 text-neutral-500 whitespace-nowrap">
                            {new Date(m.fecha).toLocaleDateString('es-VE')}
                          </td>
                          <td className="p-2">
                            <b className="font-medium">{m.etiqueta}</b>
                            {m.nota && (
                              <span className="block text-[11px] text-neutral-400">{m.nota}</span>
                            )}
                          </td>
                          <td className="p-2 text-neutral-500">{m.operador ?? '—'}</td>
                          <td
                            className={`p-2 text-right tabular-nums font-medium ${
                              m.cantidad < 0 ? 'text-peligro-600' : 'text-exito-700'
                            }`}
                          >
                            {m.cantidad > 0 ? '+' : ''}
                            {cantidad(m.cantidad)} {ing.unidad}
                          </td>
                          {/* El equivalente en plata: sin esto, "-0.025" no dice
                              si eso que salio costo un centavo o un dolar. */}
                          <td
                            className={`p-2 text-right tabular-nums ${
                              m.valor < 0 ? 'text-peligro-600' : 'text-neutral-500'
                            }`}
                          >
                            ${Math.abs(m.valor).toFixed(2)}
                          </td>
                          <td className="p-2 text-right tabular-nums text-neutral-500">
                            {cantidad(m.saldo)} {ing.unidad}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Tabla>
              </>
            )}
          </div>

          {/* La curva de inflacion de cada insumo estaba en las facturas desde
              el primer dia; no habia por donde verla. */}
          <div>
            <p className="vp-etiqueta mb-2">Historial de costos</p>
            {historial === null ? (
              <p className="text-sm text-neutral-400">Cargando…</p>
            ) : historial.length === 0 ? (
              <p className="text-sm text-neutral-500">Todavía no hay compras registradas.</p>
            ) : (
              <Tabla orden={ordenHistorial} glosario="costos" className="border border-neutral-200 rounded-xl">
                <table className="w-full text-sm">
                  <thead className="text-neutral-500 text-xs uppercase">
                    <tr>
                      <Th clave="fecha">Fecha</Th>
                      <Th clave="cantidad" alinear="derecha">Cantidad</Th>
                      <Th clave="costo" alinear="derecha">Costo</Th>
                      <Th clave="cambio" alinear="derecha">Cambio</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {ordenHistorial.ordenar(conVariacion(historial)).map((c, i) => (
                      <tr key={`${c.fecha}-${i}`} className="border-t border-neutral-100">
                        <td className="p-2">
                          {new Date(c.fecha).toLocaleDateString('es-VE')}
                          <span className="block text-[11px] text-neutral-400">{c.origen}</span>
                        </td>
                        <td className="p-2 text-right text-neutral-500 tabular-nums">
                          {cantidad(c.cantidad)} {ing.unidad}
                        </td>
                        <td className="p-2 text-right tabular-nums font-medium">{dinero(c.costo_unitario)}</td>
                        <td className="p-2 text-right tabular-nums">
                          {c.cambio != null && Math.abs(c.cambio) >= 1 && (
                            <span className={c.cambio > 0 ? 'text-aviso-600' : 'text-exito-600'}>
                              {c.cambio > 0 ? '+' : ''}
                              {c.cambio.toFixed(0)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Tabla>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

/**
 * De dónde salió y de dónde entró, agrupado por motivo.
 *
 * El listado línea por línea responde "qué pasó el martes". Esto responde
 * "de dónde salieron los 3 kg que faltan", que es la pregunta con la que se
 * abre esta pantalla, y que antes había que contestar sumando doscientas
 * filas a ojo. Con un "desde" puesto cierra con la cuenta completa
 * -apertura + entradas − salidas = final-, que es lo que hace que el
 * extracto sirva para auditar y no solo para mirar.
 */
function ResumenDelExtracto({ e, desde }: { e: ExtractoInsumo; desde: string }) {
  const Lado = ({
    titulo,
    filas,
    total,
    signo,
  }: {
    titulo: string
    filas: RenglonPorTipo[]
    total: number
    signo: '+' | '−'
  }) => (
    <div>
      <div className="flex justify-between text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1">
        <span>{titulo}</span>
        <span className="tabular-nums">
          {signo}
          {cantidad(total)} {e.unidad}
        </span>
      </div>
      {filas.length === 0 ? (
        <p className="text-xs text-neutral-400">Nada.</p>
      ) : (
        <ul className="space-y-0.5">
          {filas.map((f) => (
            <li key={f.tipo} className="flex justify-between text-sm gap-2">
              <span className="text-neutral-600 truncate">
                {f.etiqueta}
                <span className="text-neutral-400 text-xs"> ·{f.movimientos}</span>
              </span>
              <span className="tabular-nums whitespace-nowrap">
                {cantidad(f.cantidad)}{' '}
                <span className="text-neutral-400 text-xs">{dinero(Math.abs(f.valor))}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  return (
    <div className="mb-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Lado titulo="Entró" filas={e.entradas} total={e.total_entradas} signo="+" />
        <Lado titulo="Salió" filas={e.salidas} total={e.total_salidas} signo="−" />
      </div>
      {desde && (
        <p className="mt-3 pt-2 border-t border-neutral-200 text-xs text-neutral-500 tabular-nums">
          Había {cantidad(e.saldo_inicial)} {e.unidad} · entró {cantidad(e.total_entradas)} ·
          salió {cantidad(e.total_salidas)} · quedan{' '}
          <b className="text-neutral-800">
            {cantidad(e.saldo_final)} {e.unidad}
          </b>
        </p>
      )}
    </div>
  )
}

/**
 * Una planilla de conteo ya cargada, renglón por renglón.
 *
 * Es el documento que se compara contra el papel que trajo el trabajador.
 * Las diferencias van arriba -es lo que se viene a mirar- y lo que cuadró
 * queda abajo, pero se muestra: saber que 40 insumos dieron exacto es parte
 * de lo que hace creíble al conteo.
 */
function DetalleConteo({ id, onCerrar }: { id: number; onCerrar: () => void }) {
  const [d, setD] = useState<ConteoDetalle | null>(null)

  useEffect(() => {
    api.conteo(id).then(setD).catch(() => setD(null))
  }, [id])

  return (
    <Modal
      titulo={d ? `Conteo del ${new Date(d.fecha).toLocaleDateString('es-VE')}` : 'Conteo'}
      onCerrar={onCerrar}
      ancho="lg"
      pie={
        <>
          {d && (
            <a
              href={`/api/inventario/conteos/${d.id}/exportar`}
              className="mr-auto self-center text-sm font-medium text-acento-700 hover:underline"
            >
              Descargar
            </a>
          )}
          <Boton onClick={onCerrar}>Cerrar</Boton>
        </>
      }
    >
      {d === null ? (
        <p className="text-sm text-neutral-400">Cargando…</p>
      ) : (
        <>
          <p className="text-sm text-neutral-600 mb-3">
            {d.contados} mercancía(s) contada(s), {d.cuadraron} cuadraron.
            {d.operador && ` Lo hizo ${d.operador}.`}{' '}
            {d.ciego ? (
              <Pastilla tono="bien">a ciegas</Pastilla>
            ) : (
              <span className="text-neutral-400">
                Se contó viendo lo que el sistema esperaba.
              </span>
            )}
          </p>
          <div className="flex gap-4 text-sm mb-3 tabular-nums">
            <span>
              Faltó <b className="text-peligro-600">{dinero(d.faltante_valor)}</b>
            </span>
            <span>
              Sobró <b className="text-exito-600">{dinero(d.sobrante_valor)}</b>
            </span>
          </div>
          <table className="w-full text-sm">
            <thead className="text-neutral-500 text-xs uppercase">
              <tr>
                <th className="text-left p-2">Mercancía</th>
                <th className="text-right p-2">Sistema</th>
                <th className="text-right p-2">Contado</th>
                <th className="text-right p-2">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {d.lineas.map((l) => (
                <tr key={l.ingrediente_id} className="border-t border-neutral-100">
                  <td className="p-2">
                    {l.nombre}
                    <span className="block text-[11px] text-neutral-400">{l.unidad}</span>
                  </td>
                  <td className="p-2 text-right tabular-nums text-neutral-500">
                    {cantidad(l.sistema)}
                  </td>
                  <td className="p-2 text-right tabular-nums">{cantidad(l.contado)}</td>
                  <td className="p-2 text-right tabular-nums whitespace-nowrap">
                    {l.diferencia === 0 ? (
                      <span className="text-exito-600">cuadra</span>
                    ) : (
                      <span
                        className={
                          l.diferencia < 0
                            ? 'text-peligro-600 font-medium'
                            : 'text-aviso-600 font-medium'
                        }
                      >
                        {l.diferencia > 0 ? '+' : ''}
                        {cantidad(l.diferencia)}
                        <span className="block text-[11px] font-normal text-neutral-500">
                          {dinero(l.valor)}
                        </span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  )
}

// ── El conteo fisico ─────────────────────────────────────────────────────────

/**
 * Se recorre el deposito con la tablet y se anota lo que hay de cada cosa.
 * Lo que se deja en blanco no se toca. Se guarda una sola vez, y el sistema
 * registra cada diferencia como merma o sobrante con su asiento.
 */
function ConteoFisico({
  ingredientes,
  onCerrar,
  onGuardado,
}: {
  ingredientes: Ingrediente[]
  onCerrar: () => void
  onGuardado: (r: ResultadoConteo) => void
}) {
  const dialogo = useDialogo()
  const [valores, setValores] = useState<Record<number, string>>({})
  const [buscar, setBuscar] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  // Encendido por defecto: el conteo que sirve es el que se hace sin ver lo
  // que el sistema espera. Se puede apagar, pero hay que decidirlo.
  const [ciego, setCiego] = useState(true)
  const [leido, setLeido] = useState<PlanillaLeida | null>(null)

  async function cargarPlanilla(archivo: File) {
    setError('')
    try {
      const r = await api.leerPlanillaConteo(archivo)
      setLeido(r)
      // Se rellenan las casillas en vez de guardar: el archivo lo llenó
      // alguien en el depósito y nadie lo ha mirado todavía en pantalla.
      setValores((v) => ({
        ...v,
        ...Object.fromEntries(r.filas.map((f) => [f.ingrediente_id, String(f.contado)])),
      }))
    } catch (e) {
      setLeido(null)
      setError(e instanceof Error ? e.message : 'No se pudo leer la planilla')
    }
  }

  const num = (v: string) => Number(v.trim().replace(',', '.'))
  const lista = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    return [...ingredientes]
      .filter((i) => !q || i.nombre.toLowerCase().includes(q))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }, [ingredientes, buscar])

  const contados = ingredientes
    .map((i) => ({ ing: i, texto: valores[i.id] ?? '' }))
    .filter((x) => x.texto.trim() !== '')
    .map((x) => ({ ing: x.ing, real: num(x.texto) }))
  const invalidos = contados.filter((c) => !Number.isFinite(c.real) || c.real < 0)
  const diferencias = contados
    .filter((c) => Number.isFinite(c.real) && c.real >= 0)
    .map((c) => ({ ...c, dif: c.real - c.ing.stock_actual, valor: Math.abs(c.real - c.ing.stock_actual) * (c.ing.costo_unitario || 0) }))
  const faltante = diferencias.filter((d) => d.dif < 0).reduce((s, d) => s + d.valor, 0)
  const sobrante = diferencias.filter((d) => d.dif > 0).reduce((s, d) => s + d.valor, 0)

  async function guardar() {
    setError('')
    if (invalidos.length) return setError('Hay cantidades que no son números o son negativas.')
    if (contados.length === 0) return
    // A ciegas el resumen se revela aquí y no antes: si el total de faltante
    // se ve mientras se teclea, ya no es un conteo a ciegas.
    const ok = await dialogo.confirmar({
      titulo: `¿Guardar el conteo de ${contados.length} mercancía(s)?`,
      texto:
        `Faltante: ${dinero(faltante)} (queda como merma) · Sobrante: ${dinero(sobrante)}.\n\n` +
        'Lo que dice la balanza manda sobre lo que dice el sistema. Lo que dejaste en blanco no se toca.',
      aceptar: 'Guardar conteo',
    })
    if (!ok) return
    setGuardando(true)
    try {
      const r = await api.conteoFisico(
        contados.map((c) => ({ ingrediente_id: c.ing.id, stock_real: c.real })),
        'Conteo fisico',
        ciego,
      )
      onGuardado(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el conteo')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      titulo="Conteo físico"
      ayuda="Anota lo que hay de verdad de cada mercancía. Lo que dejes en blanco no cambia."
      onCerrar={onCerrar}
      ancho="lg"
      pie={
        <>
          <span className="mr-auto text-sm text-neutral-600 tabular-nums self-center">
            {contados.length} contado(s)
            {/* A ciegas tampoco se adelantan los totales: ver "faltante $40"
                mientras se teclea delata el resultado igual que la columna. */}
            {!ciego && diferencias.length > 0 && (
              <>
                {' · '}faltante <b className="text-peligro-600">{dinero(faltante)}</b>
                {' · '}sobrante <b className="text-exito-600">{dinero(sobrante)}</b>
              </>
            )}
          </span>
          <Boton tono="suave" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton onClick={guardar} disabled={guardando || contados.length === 0}>
            Guardar conteo
          </Boton>
        </>
      }
    >
      {error && (
        <div className="mb-3">
          <Aviso>{error}</Aviso>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="search"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          placeholder="Buscar…"
          className="border border-neutral-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-40"
        />
        <a
          href="/api/inventario/conteos/planilla"
          className="text-sm font-medium text-acento-700 hover:underline whitespace-nowrap"
        >
          Descargar planilla
        </a>
        {/* La vuelta del viaje: la planilla que el trabajador llenó en el
            depósito entra por aquí y rellena las casillas. No guarda nada
            todavía: se revisa en pantalla y se guarda con el mismo botón de
            siempre, que es el que sabe asentar cada diferencia. */}
        <label className="text-sm font-medium text-acento-700 hover:underline whitespace-nowrap cursor-pointer">
          Subir planilla llena
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const archivo = e.target.files?.[0]
              e.target.value = ''
              if (archivo) cargarPlanilla(archivo)
            }}
          />
        </label>
      </div>
      {leido && (
        <div className="mb-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm">
          <p>
            Se leyeron <b>{leido.filas.length}</b> renglón(es) de la planilla
            {leido.en_blanco > 0 && `, ${leido.en_blanco} en blanco que no se tocan`}.
            {leido.filas.length > 0 && ' Revísalos abajo y guarda.'}
          </p>
          {leido.errores.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-peligro-700 space-y-0.5">
              {leido.errores.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {/* El interruptor que hace que el conteo sirva para auditar. Contar
          teniendo delante el número que el sistema espera no prueba nada: el
          ojo acomoda la cifra al número que ya leyó, y una diferencia real se
          teclea como "cuadra" sin mala intención. Viene encendido. */}
      <label className="flex items-start gap-2 mb-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 cursor-pointer">
        <input
          type="checkbox"
          checked={ciego}
          onChange={(e) => setCiego(e.target.checked)}
          className="mt-0.5"
        />
        <span className="text-sm">
          <b className="font-medium">Contar a ciegas</b>
          <span className="block text-xs text-neutral-500">
            Esconde lo que el sistema espera mientras se cuenta. Las diferencias aparecen al
            guardar. Es la única forma de que el conteo pruebe algo.
          </span>
        </span>
      </label>
      <table className="w-full text-sm">
        <thead className="text-neutral-500 text-xs uppercase">
          <tr>
            <th className="text-left p-2">Mercancía</th>
            {!ciego && <th className="text-right p-2">Sistema</th>}
            <th className="text-right p-2 w-32">Contado</th>
            {!ciego && <th className="text-right p-2">Diferencia</th>}
          </tr>
        </thead>
        <tbody>
          {lista.map((ing) => {
            const texto = valores[ing.id] ?? ''
            const real = texto.trim() === '' ? null : num(texto)
            const valido = real !== null && Number.isFinite(real) && real >= 0
            const dif = valido ? real - ing.stock_actual : null
            return (
              <tr key={ing.id} className="border-t border-neutral-100">
                <td className="p-2">
                  <span className="font-medium">{ing.nombre}</span>
                  <span className="block text-[11px] text-neutral-400">{ing.unidad}</span>
                </td>
                {!ciego && (
                  <td className="p-2 text-right tabular-nums text-neutral-500 whitespace-nowrap">
                    {cantidad(ing.stock_actual)}
                  </td>
                )}
                <td className="p-2 text-right">
                  <Numerico
                    value={texto}
                    onChange={(e) => setValores((v) => ({ ...v, [ing.id]: e.target.value }))}
                    placeholder="—"
                    etiqueta={`Contado de ${ing.nombre}`}
                    aria-label={`Contado de ${ing.nombre}`}
                    className={`w-28 text-right border rounded-lg px-2 py-1.5 text-sm tabular-nums ${
                      texto && !valido ? 'border-peligro-400' : 'border-neutral-300'
                    }`}
                  />
                </td>
                {!ciego && (
                  <td className="p-2 text-right tabular-nums whitespace-nowrap">
                    {dif === null ? (
                      <span className="text-neutral-300">—</span>
                    ) : dif === 0 ? (
                      <span className="text-exito-600">cuadra</span>
                    ) : (
                      <span className={dif < 0 ? 'text-peligro-600 font-medium' : 'text-aviso-600 font-medium'}>
                        {dif > 0 ? '+' : ''}
                        {cantidad(dif)} {ing.unidad}
                        <span className="block text-[11px] font-normal text-neutral-500">
                          {dinero(Math.abs(dif) * (ing.costo_unitario || 0))}
                        </span>
                      </span>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </Modal>
  )
}


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

function SeccionCategorias({
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
                      {i.tipo === 'reventa' ? 'Reventa' : 'Materia prima'} · por {i.unidad}
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
