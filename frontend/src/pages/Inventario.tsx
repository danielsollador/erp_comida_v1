import { useCallback, useEffect, useMemo, useState } from 'react'
import NavBar from '../components/NavBar'
import { useSeccion } from '../components/Secciones'
import MenuAcciones from '../components/MenuAcciones'
import BarraFiltros from '../components/BarraFiltros'
import Icono from '../components/Icono'
import { PuntoTipo } from '../components/compras/Almacenes'
import { useRango, nombreRango } from '../lib/fechas'
import { useDialogo } from '../components/dialogo'
import { useDeshacer } from '../components/Deshacer'
import { Aviso, Boton, Modal, Pagina, Seccion, Vacio } from '../components/ui'
import { api } from '../lib/api'
import { cantidad, datosDe } from '../lib/inventario'
import { useMoneda } from '../lib/moneda'
import { ALMACENES, ALMACEN_DE } from '../lib/tiposArticulo'
import Almacenes, { type ResumenAlmacen } from './partes/inventario/Almacenes'
import TablaMercancia from './partes/inventario/TablaMercancia'
import Desechables from './partes/inventario/Desechables'
import Preparaciones from './partes/inventario/Preparaciones'
import Control from './partes/inventario/Control'
import FichaMercancia from './partes/inventario/FichaMercancia'
import ConteoFisico, { DetalleConteo } from './partes/inventario/ConteoFisico'
import SeccionCategorias from './partes/inventario/Categorias'
import AccionFila from '../components/AccionFila'
import type {
  Configuracion,
  ConteoResumen,
  DatosIngrediente,
  FacturaCompra,
  ImpactoDeCompra,
  InflacionInsumos,
  Ingrediente,
  Merma,
  ResultadoConteo,
  SobranteInventario,
  SugerenciaCompra,
  CategoriaInsumo,
  TipoArticulo,
} from '../lib/types'

/**
 * El inventario: los cuatro almacenes de la pizarra (7-oct-2026).
 *
 *   Reventa        compra → depósito → menú → venta
 *   Materia prima  compra → crudo → preparado → menú
 *   Consumible     compra → depósito → receta
 *   Desechable     compra → gasto (sin stock)
 *
 * La portada son los cuatro; se entra a uno y se ve su mercancía. La materia
 * prima tiene dos caras: el CRUDO (lo comprado, tal cual) y el PREPARADO (el
 * guiso, la mechada: un almacén imaginario que dice cuánto se podría hacer
 * con el crudo, y al cierre pregunta qué se hace con lo que sobró).
 *
 * Transversal a los cuatro: "Qué comprar" y "Control" (lo que debió salir
 * contra lo que hay, pérdidas, conteos, aceite, costo para precios). La ficha
 * de una mercancía es la misma desde cualquier almacén.
 */

const SECCIONES = [
  { id: 'almacenes', texto: 'Almacenes' },
  { id: 'comprar', texto: 'Qué comprar' },
  { id: 'control', texto: 'Control' },
  // Los almacenes y las categorias viven en la ruta, pero no en las pestañas:
  // se entra desde la portada, y arriba se cambia de almacen con el carril.
  { id: 'materia-prima', texto: 'Materia prima' },
  { id: 'reventa', texto: 'Reventa' },
  { id: 'consumibles', texto: 'Consumibles' },
  { id: 'desechables', texto: 'Desechables' },
  { id: 'categorias', texto: 'Categorías' },
]
const PESTANAS = SECCIONES.slice(0, 3)

const RUTA_DE: Record<TipoArticulo, string> = {
  insumo: 'materia-prima',
  reventa: 'reventa',
  consumible: 'consumibles',
  desechable: 'desechables',
  preparacion: 'materia-prima',
}
const TIPO_DE: Record<string, TipoArticulo> = {
  'materia-prima': 'insumo',
  reventa: 'reventa',
  consumibles: 'consumible',
  desechables: 'desechable',
}

const METODOS_DE_PAGO = ['Efectivo Bs', 'Efectivo $', 'Banco']

export default function Inventario() {
  const [seccion, irA] = useSeccion(SECCIONES)
  // Pérdidas, compras de desechables y control tienen fecha; el stock es "a hoy".
  const [rango, setRango] = useRango('30d')
  const dialogo = useDialogo()
  const { tasa, fmt: dinero } = useMoneda()
  const [ingredientes, setIngredientes] = useState<Ingrediente[]>([])
  // Hasta que llegue la mercancia, la portada muestra "…" y no ceros.
  const [cargado, setCargado] = useState(false)
  const [sugerencias, setSugerencias] = useState<SugerenciaCompra[]>([])
  const [mermas, setMermas] = useState<Merma[]>([])
  const [sobrantes, setSobrantes] = useState<SobranteInventario[]>([])
  const [conteos, setConteos] = useState<ConteoResumen[]>([])
  const [facturas, setFacturas] = useState<FacturaCompra[]>([])
  const [inflacion, setInflacion] = useState<InflacionInsumos | null>(null)
  const [error, setError] = useState('')
  const [cats, setCats] = useState<CategoriaInsumo[]>([])
  const recargarCats = useCallback(() => api.listarCategoriasInsumo().then(setCats).catch(() => setCats([])), [])
  useEffect(() => {
    void recargarCats()
  }, [recargarCats])
  const crearCategoria = useCallback(
    async (nombre: string) => {
      const cat = await api.crearCategoriaInsumo(nombre)
      await recargarCats()
      return cat.id
    },
    [recargarCats],
  )
  const [impacto, setImpacto] = useState<ImpactoDeCompra | null>(null)
  // La ficha abierta: 'nuevo' (con el tipo del almacén en que se está) o el id.
  const [ficha, setFicha] = useState<{ nuevo: TipoArticulo } | number | null>(null)
  const [contando, setContando] = useState(false)
  const [conteoAbierto, setConteoAbierto] = useState<number | null>(null)
  const [config, setConfig] = useState<Configuracion | null>(null)
  const [cambiandoConfig, setCambiandoConfig] = useState(false)
  // La materia prima tiene dos caras.
  const [cara, setCara] = useState<'crudo' | 'preparado'>('crudo')
  // Con la receta de una preparación abierta, la franja Crudo/Preparado y
  // las acciones no tienen sentido: para salir se vuelve atrás.
  const [editandoPrep, setEditandoPrep] = useState(false)

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rango])

  function cargar() {
    api.listarIngredientes().then((l) => {
      setIngredientes(l)
      setCargado(true)
    })
    api.sugerenciasCompra().then(setSugerencias)
    api.listarMermas(rango).then(setMermas)
    api.listarSobrantes(rango).then(setSobrantes).catch(() => {})
    api.conteos(rango).then(setConteos).catch(() => setConteos([]))
    api.listarFacturasCompra(rango).then(setFacturas).catch(() => setFacturas([]))
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
      // LA DECISION FISCAL, A LA VISTA Y EN EL MOMENTO: esta compra no trae
      // factura, asi que no genera credito de IVA.
      texto: (
        <>
          Compra <strong>sin factura</strong>: entra al depósito y sale de la gaveta, pero <strong>no descuenta IVA</strong>.{' '}
          <a href="/compras/nueva" className="underline font-medium">
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
        { nombre: 'metodo', etiqueta: 'De dónde salió la plata', tipo: 'opciones', opciones: METODOS_DE_PAGO.map((m) => ({ valor: m, texto: m })) },
      ],
      aceptar: 'Registrar compra',
    })
    if (!r) return
    if (r.moneda === 'Bs' && !tasa?.bcv) {
      setError('No se pudo obtener la tasa del día. Intenta de nuevo o registra en dólares.')
      return
    }
    const costoUsd = r.costo && r.moneda === 'Bs' ? Number(r.costo) / (tasa!.bcv as number) : r.costo ? Number(r.costo) : undefined
    await accion(async () => {
      const resultado = await api.registrarCompra(ing.id, Number(r.cantidad), costoUsd, r.metodo)
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
      texto: `Vuelven ${cantidad(m.cantidad)} ${m.unidad} de ${m.ingrediente_nombre} al inventario.\n\nLa merma original no se borra: queda marcada como revertida con su asiento de reverso.`,
      aceptar: 'Revertir',
    })
    if (ok) accion(() => api.revertirMerma(m.id))
  }

  async function revertirSobrante(sb: SobranteInventario) {
    const ok = await dialogo.confirmar({
      titulo: '¿Revertir este conteo?',
      texto: `Salen ${cantidad(sb.cantidad)} ${sb.unidad} de ${sb.ingrediente_nombre} que habían entrado por un conteo hacia arriba.\n\nEl sobrante no se borra: queda marcado como revertido con su contra-asiento.`,
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
      .map((a) => `${a.nombre}: ${a.diferencia > 0 ? '+' : ''}${cantidad(a.diferencia)} ${a.unidad} (${dinero(a.valor)})`)
      .join('\n')
    const noContadas = r.no_contadas?.length ? `\n\nOjo: el preparado contado llevaba ${r.no_contadas.join(', ')}, que no se contó: esa parte no se tradujo.` : ''
    await dialogo.avisar({
      titulo: r.ajustes.length === 0 ? 'El conteo cuadró' : 'Conteo guardado',
      tono: r.faltante_valor > 0 ? 'ojo' : 'bien',
      texto:
        (r.ajustes.length === 0
          ? `Las ${r.sin_cambio} mercancías contadas coinciden con el sistema.`
          : `${r.ajustes.length} ajuste(s) · faltante ${dinero(r.faltante_valor)} (queda como merma) · sobrante ${dinero(r.sobrante_valor)}` +
            (r.sin_cambio ? ` · ${r.sin_cambio} cuadraron` : '') +
            `\n\n${lineas}${r.ajustes.length > 8 ? '\n…' : ''}`) + noContadas,
    })
  }

  // ── Lo que se ve ─────────────────────────────────────────────────────────

  const activos = useMemo(() => ingredientes.filter((i) => i.activo !== false), [ingredientes])
  const vivas = mermas.filter((m) => !m.revertida)
  const perdidas = vivas.reduce((s, m) => s + m.valor, 0)
  const gastoDesechables = useMemo(
    () => facturas.reduce((s, f) => s + f.items.filter((i) => i.tipo === 'desechable').reduce((t, i) => t + i.subtotal, 0), 0),
    [facturas],
  )
  const resumenes: ResumenAlmacen[] = useMemo(
    () =>
      ALMACENES.map((a) => {
        const propios = activos.filter((i) => i.tipo === a.valor)
        return {
          tipo: a.valor,
          mercancias: propios.length,
          bajoMinimo: a.destino === 'gasto' ? 0 : propios.filter((i) => i.stock_actual <= i.stock_minimo).length,
          sinCosto: propios.filter((i) => !i.costo_unitario).length,
          plata: a.destino === 'gasto' ? gastoDesechables : propios.reduce((s, i) => s + Math.max(i.stock_actual, 0) * (i.costo_unitario || 0), 0),
          preparaciones: a.valor === 'insumo' ? activos.filter((i) => i.tipo === 'preparacion').length : undefined,
        }
      }),
    [activos, gastoDesechables],
  )

  const fichaIng = typeof ficha === 'number' ? (ingredientes.find((i) => i.id === ficha) ?? null) : null
  const tipoActual = TIPO_DE[seccion]
  const almacen = tipoActual ? ALMACEN_DE[tipoActual] : null
  const delAlmacen = tipoActual ? ingredientes.filter((i) => i.tipo === tipoActual) : []
  const resumenActual = resumenes.find((r) => r.tipo === tipoActual)
  const periodo = nombreRango(rango)

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Inventario" secciones={PESTANAS} seccion={almacen ? 'almacenes' : seccion} alCambiarSeccion={irA} />
      <Pagina ancho="ancha">
        {error && <Aviso>{error}</Aviso>}

        {/* Arranque del local: mientras no haya mercancía ni recetas, NO
            bloquea la venta. Solo a la vista cuando está prendido. */}
        {config?.vender_sin_inventario && (
          <div className="rounded-2xl bg-aviso-500/10 p-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold text-aviso-900">Vender sin control de inventario</h2>
              <p className="text-sm mt-0.5 text-aviso-800">Prendido: ninguna venta se traba por falta de stock, aunque un producto tenga receta.</p>
            </div>
            <button
              onClick={alternarVentaSinInventario}
              disabled={cambiandoConfig}
              className="shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold bg-neutral-900 text-white disabled:opacity-40"
            >
              Apagar
            </button>
          </div>
        )}

        {/* ── La portada: los cuatro almacenes ── */}
        {seccion === 'almacenes' && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <BarraFiltros rango={rango} alCambiar={setRango} />
              <div className="flex items-center gap-2">
                <Boton tono="suave" onClick={() => setContando(true)} disabled={activos.length === 0}>
                  Conteo físico
                </Boton>
                <Boton onClick={() => setFicha({ nuevo: 'insumo' })} icono="mas">
                  Nueva mercancía
                </Boton>
                {config && (
                  <MenuAcciones
                    etiqueta="Más opciones del inventario"
                    opciones={[
                      {
                        texto: config.vender_sin_inventario ? 'Apagar la venta sin control de inventario' : 'Vender sin control de inventario',
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
            <Almacenes
              resumenes={cargado ? resumenes : []}
              nombreRango={periodo}
              sugerencias={sugerencias}
              ingredientes={ingredientes}
              perdidas={perdidas}
              ultimoConteo={conteos[0] ?? null}
              onEntrar={(tipo) => irA(RUTA_DE[tipo])}
              onComprar={comprar}
              onVerComprar={() => irA('comprar')}
              onVerControl={() => irA('control')}
            />
          </>
        )}

        {/* ── Dentro de un almacén ── */}
        {almacen && tipoActual && (
          <>
            {/* Una sola fila: volver, el titulo y, cuando la pantalla no
                es una tabla, las acciones. Los de la tabla van dentro de su
                barra (Leider, 7-oct: "administrar bien el espacio"). */}
            {!editandoPrep && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => irA('almacenes')}
                className="vp-control inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium"
              >
                <Icono nombre="atras" size={14} />
                Almacenes
              </button>
              <span className={`inline-grid place-items-center w-9 h-9 rounded-xl ${almacen.sello}`}>
                <Icono nombre={almacen.icono} size={18} />
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-xl font-semibold tracking-tight leading-tight">{almacen.texto}</h2>
                <p className="text-xs text-neutral-500 leading-tight">{almacen.detalle}</p>
              </div>
              {tipoActual === 'desechable' && (
                <div className="ml-auto flex items-center gap-2">
                  <Boton onClick={() => setFicha({ nuevo: tipoActual })} icono="mas">
                    Nueva mercancía
                  </Boton>
                </div>
              )}
            </div>
            )}

            {tipoActual === 'insumo' && !editandoPrep && (
              <div role="tablist" className="grid grid-cols-2 gap-2">
                {(
                  [
                    { v: 'crudo' as const, t: 'Crudo', d: 'lo que llegó, tal cual', n: `${delAlmacen.filter((i) => i.activo !== false).length} mercancías`, icono: 'paquete' as const },
                    { v: 'preparado' as const, t: 'Preparado', d: 'lo que la cocina hace con el crudo', n: `${resumenActual?.preparaciones ?? 0} preparaciones`, icono: 'cocina' as const },
                  ] as const
                ).map((c) => {
                  const esta = cara === c.v
                  return (
                    <button
                      key={c.v}
                      type="button"
                      role="tab"
                      aria-selected={esta}
                      onClick={() => setCara(c.v)}
                      className={`vp-pulsable text-left rounded-2xl px-3.5 py-2.5 transition-colors flex items-center gap-3 ${
                        esta ? 'bg-neutral-900 text-white' : 'vp-losa hover:bg-neutral-500/5'
                      }`}
                    >
                      <span className={`inline-grid place-items-center w-8 h-8 rounded-xl shrink-0 ${esta ? 'bg-white/12' : almacen.sello}`}>
                        <Icono nombre={c.icono} size={16} />
                      </span>
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="font-display font-semibold">{c.t}</span>
                        <span className={`text-xs ml-2 ${esta ? 'text-white/60' : 'text-neutral-500'}`}>{c.d}</span>
                      </span>
                      <span className={`text-xs tabular-nums shrink-0 ${esta ? 'text-white/60' : 'text-neutral-500'}`}>{c.n}</span>
                    </button>
                  )
                })}
              </div>
            )}

            {tipoActual === 'desechable' ? (
              <>
                <BarraFiltros rango={rango} alCambiar={setRango} />
                <Desechables
                  ingredientes={delAlmacen}
                  facturas={facturas}
                  nombreRango={periodo}
                  onAbrir={(id) => setFicha(id)}
                  onNueva={() => setFicha({ nuevo: 'desechable' })}
                />
              </>
            ) : tipoActual === 'insumo' && cara === 'preparado' ? (
              <Preparaciones ingredientes={ingredientes} onCambio={cargar} onEditando={setEditandoPrep} />
            ) : (
              <>
                <TablaMercancia
                  tipo={tipoActual}
                  resumen={resumenActual}
                  acciones={
                    <>
                      <Boton tono="suave" onClick={() => setContando(true)} disabled={activos.length === 0}>
                        Conteo físico
                      </Boton>
                      <Boton onClick={() => setFicha({ nuevo: tipoActual })} icono="mas">
                        Nueva mercancía
                      </Boton>
                    </>
                  }
                  ingredientes={delAlmacen}
                  categorias={cats}
                  onAbrir={(id) => setFicha(id)}
                  onReactivar={(ing) => archivar(ing, true)}
                  onNueva={() => setFicha({ nuevo: tipoActual })}
                  onCategorias={() => irA('categorias')}
                />
              </>
            )}
          </>
        )}

        {/* ── Qué comprar ── */}
        {seccion === 'comprar' && (
          <>
            {sugerencias.length === 0 ? (
              <div className="vp-losa">
                <Vacio
                  icono="ok"
                  titulo="Nada por comprar ahora mismo"
                  detalle="Todo está por encima del mínimo y alcanza más de una semana al ritmo de venta de las últimas dos semanas."
                />
              </div>
            ) : (
              <Seccion titulo="Qué comprar" ayuda="Lo que está bajo mínimo o, al ritmo de venta de las últimas dos semanas, no llega a la próxima.">
                <ul className="divide-y divide-neutral-500/10">
                  {sugerencias.map((s) => {
                    const ing = ingredientes.find((i) => i.id === s.ingrediente_id)
                    return (
                      <li key={s.ingrediente_id} className="py-2.5 flex items-center gap-3">
                        {ing && <PuntoTipo tipo={ing.tipo} />}
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{s.ingrediente_nombre}</div>
                          <div className="text-xs text-neutral-500">
                            {ing && <span className="text-neutral-400">{ALMACEN_DE[ing.tipo].texto} · </span>}
                            {s.razon}
                          </div>
                        </div>
                        <span className="font-semibold tabular-nums whitespace-nowrap">
                          +{cantidad(s.cantidad_sugerida)} {s.unidad}
                        </span>
                        {ing && <AccionFila onClick={() => comprar(ing)}>Llegó</AccionFila>}
                      </li>
                    )
                  })}
                </ul>
              </Seccion>
            )}

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
                  Si tus precios no subieron parecido, cada venta te deja menos de lo que necesitas para reponer. En Menú está el precio sugerido de
                  cada producto.
                </p>
              </Aviso>
            )}
          </>
        )}

        {/* ── Control ── */}
        {seccion === 'control' && (
          <>
            <BarraFiltros rango={rango} alCambiar={setRango} />
            <Control
              rango={rango}
              nombreRango={periodo}
              mermas={mermas}
              sobrantes={sobrantes}
              conteos={conteos}
              onRevertirMerma={revertirMerma}
              onRevertirSobrante={revertirSobrante}
              onAbrirConteo={setConteoAbierto}
              onContar={() => setContando(true)}
            />
          </>
        )}

        {/* ── Categorías ── */}
        {seccion === 'categorias' && (
          <>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-xl font-semibold tracking-tight">Categorías del depósito</h2>
              <button type="button" onClick={() => irA('almacenes')} className="text-sm text-neutral-500 hover:text-neutral-900">
                ← Volver a los almacenes
              </button>
            </div>
            <SeccionCategorias
              categorias={cats}
              ingredientes={ingredientes}
              onCambio={async () => {
                await recargarCats()
                await cargar()
              }}
            />
          </>
        )}
      </Pagina>

      {conteoAbierto !== null && <DetalleConteo id={conteoAbierto} onCerrar={() => setConteoAbierto(null)} />}

      {(ficha !== null && typeof ficha !== 'number') || fichaIng ? (
        <FichaMercancia
          ing={fichaIng}
          tipoInicial={typeof ficha === 'object' && ficha ? ficha.nuevo : undefined}
          mermas={fichaIng ? mermas.filter((m) => m.ingrediente_id === fichaIng.id && !m.revertida) : []}
          onCerrar={() => setFicha(null)}
          categorias={cats}
          onCrearCategoria={crearCategoria}
          onGuardar={async (datos) => {
            const ok = await guardarFicha(datos, fichaIng?.id ?? null)
            if (ok) void recargarCats()
            return ok
          }}
          acciones={{ comprar, merma, consumoPersonal, contar, archivar: (ing) => archivar(ing, false) }}
          todas={ingredientes}
          onRecargar={(destino) => {
            cargar()
            setFicha(destino.id)
          }}
        />
      ) : null}

      {contando && <ConteoFisico ingredientes={activos} onCerrar={() => setContando(false)} onGuardado={conteoGuardado} />}

      {impacto && (
        <Modal
          titulo={`${impacto.ingrediente.nombre} subió ${impacto.salto_pct?.toFixed(0)}%`}
          onCerrar={() => setImpacto(null)}
          pie={<Boton onClick={() => setImpacto(null)}>Entendido</Boton>}
        >
          <p className="text-sm text-neutral-600 mt-1">
            Pagaste {dinero(impacto.costo_pagado)} por {impacto.ingrediente.unidad}; la compra anterior fue a {dinero(impacto.costo_anterior)}.
          </p>
          {impacto.posible_error_de_unidad && (
            <div className="mt-3 rounded-xl bg-peligro-500/10 p-3 text-sm text-peligro-800">
              <b>Revisa la cantidad.</b> {impacto.posible_error_de_unidad}
            </div>
          )}
          <p className="text-xs text-neutral-500 mt-2">
            El costo promedio quedó en {dinero(impacto.ingrediente.costo_unitario)} porque mezcla lo que ya tenías. Los márgenes de abajo son los de
            verdad: los que te quedan si tienes que reponer a este precio.
          </p>
          {impacto.productos.length > 0 ? (
            <div className="mt-4 space-y-2">
              {impacto.productos.map((p) => (
                <div
                  key={p.variante_id}
                  className={`rounded-xl p-3 text-sm ${p.a_perdida ? 'bg-peligro-500/10' : p.margen_flaco ? 'bg-aviso-500/10' : 'bg-neutral-500/6'}`}
                >
                  <div className="flex justify-between gap-2 font-medium">
                    <span>{p.nombre}</span>
                    <span className="tabular-nums whitespace-nowrap">{dinero(p.precio)}</span>
                  </div>
                  <div className="text-neutral-600 mt-1">
                    margen {p.margen_antes_pct?.toFixed(0)}% → <b className={p.a_perdida ? 'text-peligro-700' : ''}>{p.margen_despues_pct?.toFixed(0)}%</b>
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
