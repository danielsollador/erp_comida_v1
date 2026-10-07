import { useEffect, useMemo, useState } from 'react'
import EnlaceDescarga from '../../../components/EnlaceDescarga'
import FusionarMercancia from '../../../components/FusionarMercancia'
import VenderEnMenu from '../../../components/VenderEnMenu'
import { CampoCantidad } from '../../../components/Cantidad'
import { ElegirAlmacen, SelloTipo } from '../../../components/compras/Almacenes'
import { Tabla, Th, useOrden } from '../../../components/Tabla'
import { useDialogo } from '../../../components/dialogo'
import { Aviso, Boton, Campo, FiltroDesplegable, Modal, Selector } from '../../../components/ui'
import { api } from '../../../lib/api'
import { rangoDe } from '../../../lib/fechas'
import {
  cantidad,
  conVariacion,
  cuantoDura,
  ejemploIdeal,
  ejemploRendimiento,
  estadoStock,
  fechaCorta,
  legible,
  queLePaso,
  type CompraConVariacion,
} from '../../../lib/inventario'
import { useMoneda } from '../../../lib/moneda'
import { parecidos } from '../../../lib/parecidos'
import { ALMACEN_DE } from '../../../lib/tiposArticulo'
import type {
  CategoriaInsumo,
  CompraDeInsumo,
  DatosIngrediente,
  Equivalencia,
  ExtractoInsumo,
  Ingrediente,
  InsumoDelDeposito,
  Merma,
  MovimientoInventario,
  RenglonPorTipo,
  TipoArticulo,
} from '../../../lib/types'

// Las que se ofrecen al crear o cambiar una mercancia. El gramo y el
// mililitro son el kilo y el litro en chico, y eso lo maneja el sistema.
// "paquete" ya no se ofrece: lo que llega en caja se lleva en unidades y la
// caja es la presentacion del proveedor (ver Compras). Una ficha vieja que ya
// se mide en paquete lo conserva.
const UNIDADES_A_ELEGIR = ['kg', 'lt', 'unidad']

// ── La ficha ─────────────────────────────────────────────────────────────────

/**
 * La ficha de una mercancia: como esta, que se le anota y que le paso.
 *
 * COMO ERA. Abria directo en un formulario de diez casillas (que es, se mide
 * en, minimo, objetivo, costo sin IVA, rendimiento, exento...) con cuatro
 * botones encima que no decian nada ("Personal", "Contar"), y debajo un
 * extracto contable con doscientos renglones. Leider (2-oct): "no se
 * entiende un carajo, lo abro y no entiendo para que es cada cosa".
 *
 * COMO ES. Lo que se viene a mirar arriba, en tres cifras con palabras
 * --cuanto hay, para cuanto alcanza, cuanto cuesta--; despues lo que se
 * viene a hacer, con verbos ("Llegó mercancía", "Se dañó o se botó"); despues
 * lo ultimo que le paso, en frases. Los datos de la mercancia (que cambian
 * una vez al año) quedan en un renglon cerrado, y el extracto completo detras
 * de "Ver todo".
 *
 * Para crear una (sin `ing`), solo el formulario: primero lo indispensable y
 * lo demas en "Más detalles", que se puede dejar para despues.
 */
export default function FichaMercancia({
  ing,
  tipoInicial,
  mermas,
  categorias,
  onCrearCategoria,
  onCerrar,
  onGuardar,
  acciones,
  todas,
  onRecargar,
}: {
  ing: Ingrediente | null
  /** Al crear: el almacén desde el que se abrió la ficha. */
  tipoInicial?: TipoArticulo
  mermas: Merma[]
  /** Todas las mercancías: para avisar de las parecidas y para fusionar. */
  todas: Ingrediente[]
  /** Se fundió en otra: se abre la que quedó. */
  onRecargar: (destino: Ingrediente) => void
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
  const { fmt: dinero } = useMoneda()
  const nuevo = ing === null
  const dialogo = useDialogo()
  const [f, setF] = useState(() => ({
    nombre: ing?.nombre ?? '',
    tipo: (ing?.tipo ?? tipoInicial ?? 'insumo') as TipoArticulo,
    es_indirecto: ing?.es_indirecto ?? false,
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
  const [fusionando, setFusionando] = useState(false)
  const [alMenu, setAlMenu] = useState(false)

  // El aceite no va en recetas: se anota cuando se carga la freidora, y el
  // reporte lo reparte por pieza frita.
  async function cargarFreidora() {
    if (!ing) return
    const cantidadCargada = await dialogo.pedirNumero({
      titulo: `Cargar ${ing.nombre} a la freidora`,
      etiqueta: 'Cuánto se cargó',
      sufijo: ing.unidad,
      ayuda: 'Sale del depósito y pasa a costo. Por pieza se reparte solo, con lo que se fríe en el mes.',
      min: 0.001,
    })
    if (!cantidadCargada) return
    try {
      await api.cargarIndirecto(ing.id, cantidadCargada, 'Carga a la freidora')
      setAviso(`Cargado: ${cantidadCargada} ${ing.unidad}.`)
      onRecargar(ing)
    } catch (e) {
      setAviso(e instanceof Error ? e.message : 'No se pudo anotar')
    }
  }
  // Al crear: las que ya existen y se le parecen. "Crema de leche lata
  // grande" junto a "Crema de Leche Lata" nacio por no verlas.
  const similares = useMemo(
    () => (nuevo ? parecidos(f.nombre, todas) : []),
    [nuevo, f.nombre, todas],
  )
  // Viendo la ficha o cambiando los datos. Una nueva nace en el formulario.
  const [editando, setEditando] = useState(nuevo)
  // Al crear, lo que no hace falta para empezar va plegado.
  const [masDetalles, setMasDetalles] = useState(false)
  // El extracto completo, con filtro de fecha y descarga, detras de "Ver todo".
  const [todo, setTodo] = useState(false)
  const [historial, setHistorial] = useState<CompraDeInsumo[] | null>(null)
  const [extracto, setExtracto] = useState<ExtractoInsumo | null>(null)
  // Para cuanto alcanza: el mismo calculo de Reportes > Inventario (consumo
  // real de los ultimos 30 dias), pedido solo para esta mercancia.
  const [ritmo, setRitmo] = useState<InsumoDelDeposito | null | undefined>(undefined)
  // Como llega del proveedor: "1 caja = 24", "1 bulto = 20 kg". Es la memoria
  // de Compras (equivalencias): la mercancia es la malta; la caja es como la
  // vende cada proveedor, y aqui se ve para entender por que hay 48 y no 2.
  const [presentaciones, setPresentaciones] = useState<Equivalencia[]>([])
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

  useEffect(() => {
    if (!ing) return
    api
      .listarEquivalencias()
      .then((l) => setPresentaciones(l.filter((e) => e.ingrediente_id === ing.id && Math.abs(e.factor - 1) > 1e-9)))
      .catch(() => setPresentaciones([]))
    // Solo cuando cambia DE mercancía: la memoria del proveedor no se mueve con el stock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ing?.id])

  useEffect(() => {
    if (!ing) return
    api
      .reporteInventario(rangoDe('30d'), { ingrediente_id: ing.id })
      .then((r) => setRitmo(r.por_insumo[0] ?? null))
      .catch(() => setRitmo(null))
  }, [ing])

  const num = (v: string) => Number(v.trim().replace(',', '.'))
  const poner = (k: keyof typeof f, v: string | number | null | boolean) =>
    setF((a) => ({ ...a, [k]: v }))

  async function guardar() {
    setAviso('')
    if (!f.nombre.trim()) return setAviso('La mercancía necesita un nombre.')
    const minimo = f.stock_minimo === '' ? 0 : num(f.stock_minimo)
    const objetivo = f.stock_objetivo === '' ? 0 : num(f.stock_objetivo)
    const costo = f.costo_unitario === '' ? 0 : num(f.costo_unitario)
    // Solo la materia prima tiene merma de cocina que medir.
    const rendimiento = f.tipo === 'insumo' ? num(f.rendimiento_pct) : 100
    const inicial = f.stock_actual === '' ? 0 : num(f.stock_actual)
    if ([minimo, objetivo, costo, inicial].some((n) => !Number.isFinite(n) || n < 0))
      return setAviso('Las cantidades y el costo tienen que ser números, y no negativos.')
    if (!Number.isFinite(rendimiento) || rendimiento <= 0 || rendimiento > 100)
      return setAviso('Lo que se aprovecha va de 1 a 100 %.')
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
      es_indirecto: f.tipo === 'insumo' && f.es_indirecto,
      ...(nuevo ? { stock_actual: f.tipo === 'desechable' ? 0 : inicial } : {}),
    })
    setGuardando(false)
  }

  async function elegirCategoria(v: string) {
    if (v !== 'nueva') {
      poner('categoria_id', v === '' ? null : Number(v))
      return
    }
    const nombreCat = await dialogo.pedirTexto({
      titulo: 'Nueva categoría',
      texto: 'Un cajón del depósito: Carnes, Lácteos, Empaques…',
      etiqueta: 'Nombre',
    })
    if (!nombreCat?.trim()) return
    poner('categoria_id', await onCrearCategoria(nombreCat))
  }

  const perdidaTotal = mermas.reduce((s, m) => s + m.valor, 0)
  const u = ing?.unidad ?? f.unidad

  // ── El formulario: crear, o cambiar los datos ──────────────────────────────
  const opcionales = (
    <>
      <Selector
        etiqueta="Categoría"
        value={f.categoria_id === null ? '' : String(f.categoria_id)}
        onChange={(e) => void elegirCategoria(e.target.value)}
      >
        <option value="">Sin categoría</option>
        {categorias.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
        <option value="nueva">+ Nueva categoría…</option>
      </Selector>
      {f.tipo !== 'desechable' && (<>
      <CampoCantidad
        etiqueta="Avísame cuando quede menos de"
        unidad={f.unidad}
        valor={f.stock_minimo}
        alCambiar={(v) => poner('stock_minimo', v)}
        ayuda="Por debajo de esto aparece en «Qué comprar»."
      />
      <CampoCantidad
        etiqueta="Lo ideal tener en el depósito"
        unidad={f.unidad}
        valor={f.stock_objetivo}
        alCambiar={(v) => poner('stock_objetivo', v)}
        ayuda={ejemploIdeal(num(f.stock_objetivo), ing?.stock_actual ?? (f.stock_actual === '' ? 0 : num(f.stock_actual)), f.unidad)}
      />
      </>)}
      {f.tipo === 'insumo' && (
        <Campo
          etiqueta="Lo que se aprovecha (%)"
          inputMode="decimal"
          value={f.rendimiento_pct}
          onChange={(e) => poner('rendimiento_pct', e.target.value)}
          ayuda={ejemploRendimiento(f.unidad, num(f.rendimiento_pct)) || 'Lo que queda después de limpiar o cocinar.'}
        />
      )}
      <label className="flex items-start gap-2.5 text-sm sm:col-span-2 cursor-pointer">
        <input
          type="checkbox"
          checked={f.exento}
          onChange={(e) => setF((a) => ({ ...a, exento: e.target.checked }))}
          className="mt-0.5"
        />
        <span>
          No paga IVA
          <span className="block text-xs text-neutral-500">Harina, arroz, carne y la mayoría de los alimentos básicos.</span>
        </span>
      </label>
      {f.tipo === 'insumo' && (
        <label className="flex items-start gap-2.5 text-sm sm:col-span-2 cursor-pointer">
          <input
            type="checkbox"
            checked={f.es_indirecto}
            onChange={(e) => setF((a) => ({ ...a, es_indirecto: e.target.checked }))}
            className="mt-0.5"
          />
          <span>
            Costo indirecto, como el aceite de freír
            <span className="block text-xs text-neutral-500">
              No va en recetas: se anota cuando se carga la freidora y se reparte entre lo que se fríe.
            </span>
          </span>
        </label>
      )}
    </>
  )

  const formulario = (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Campo
          etiqueta="Nombre"
          value={f.nombre}
          onChange={(e) => poner('nombre', e.target.value)}
          autoFocus={nuevo}
          placeholder="Ej. Carne molida"
          className="sm:col-span-2"
        />
        {similares.length > 0 && (
          <p className="sm:col-span-2 -mt-1 rounded-lg bg-aviso-50 px-3 py-2 text-xs text-aviso-800">
            Ya tienes parecidas: {similares.map((x) => `${x.ing.nombre} (${x.ing.unidad})`).join(', ')}. Si es la misma,
            no la crees: usa esa.
          </p>
        )}
        <div className="sm:col-span-2">
          <span className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">Qué es</span>
          {f.tipo === 'preparacion' ? (
            <p className="text-sm text-neutral-600">
              <SelloTipo tipo="preparacion" icono /> Su receta y lo que rinde se editan en Materia prima → Preparado.
            </p>
          ) : (
            <ElegirAlmacen valor={f.tipo} alElegir={(t) => poner('tipo', t)} compacto />
          )}
        </div>
        <div className="sm:col-span-2">
          <span className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">Se mide en</span>
          <div className="flex flex-wrap gap-1.5">
            {(UNIDADES_A_ELEGIR.includes(f.unidad) ? UNIDADES_A_ELEGIR : [...UNIDADES_A_ELEGIR, f.unidad]).map((x) => (
              <button
                key={x}
                type="button"
                onClick={() => poner('unidad', x)}
                aria-pressed={f.unidad === x}
                className={`min-w-12 rounded-lg border-2 px-3 py-1.5 text-sm font-semibold ${
                  f.unidad === x ? 'border-acento-500 bg-acento-500/8' : 'border-neutral-200 hover:border-neutral-300'
                }`}
              >
                {x}
              </button>
            ))}
          </div>
        </div>
        {nuevo && f.tipo !== 'desechable' && (
          <CampoCantidad
            etiqueta="Cuánto hay hoy"
            unidad={f.unidad}
            valor={f.stock_actual}
            alCambiar={(v) => poner('stock_actual', v)}
            ayuda="Después se mueve solo con las compras, las ventas y los conteos."
          />
        )}
        <Campo
          etiqueta={`Lo que pagas por ${f.unidad}, sin IVA ($)`}
          inputMode="decimal"
          value={f.costo_unitario}
          onChange={(e) => poner('costo_unitario', e.target.value)}
          placeholder="0.00"
          ayuda={nuevo ? 'Lo que pagaste la última vez. Cada compra lo va ajustando.' : 'Se ajusta solo con cada compra.'}
        />
      </div>

      {nuevo ? (
        <div className="rounded-xl border border-neutral-200">
          <button
            type="button"
            onClick={() => setMasDetalles((v) => !v)}
            aria-expanded={masDetalles}
            className="vp-celda w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left rounded-xl"
          >
            <span>
              <span className="block text-sm font-semibold">Más detalles</span>
              <span className="block text-xs text-neutral-500">Opcional: categoría, cuándo avisar, cuánto se aprovecha, IVA</span>
            </span>
            <span aria-hidden className={`vp-flecha shrink-0 opacity-60 transition-transform ${masDetalles ? 'rotate-180' : ''}`} />
          </button>
          {masDetalles && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-3 pb-3">{opcionales}</div>}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{opcionales}</div>
      )}

      {!nuevo && (
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {ing.tipo === 'reventa' && (
            <button type="button" onClick={() => setAlMenu(true)} className="text-sm text-acento-700 font-medium hover:underline">
              Venderla en el menú
            </button>
          )}
          {ing.es_indirecto && (
            <button type="button" onClick={() => void cargarFreidora()} className="text-sm text-acento-700 font-medium hover:underline">
              Cargar a la freidora
            </button>
          )}
          <button type="button" onClick={() => setFusionando(true)} className="text-sm text-neutral-600 hover:underline">
            Es la misma que otra: fusionarlas
          </button>
          <button
            type="button"
            onClick={() => acciones.archivar(ing)}
            className="text-sm text-peligro-600 hover:underline"
          >
            Ya no la uso: archivarla
          </button>
        </div>
      )}
      {alMenu && ing && (
        <VenderEnMenu
          mercancia={ing}
          onCerrar={() => setAlMenu(false)}
          onHecho={() => {
            setAlMenu(false)
            setAviso(`${ing.nombre} ya está en el menú: venderla descuenta su existencia.`)
          }}
        />
      )}
      {fusionando && ing && (
        <FusionarMercancia
          origen={ing}
          ingredientes={todas}
          onCerrar={() => setFusionando(false)}
          onHecho={(destino) => {
            setFusionando(false)
            onRecargar(destino)
          }}
        />
      )}
    </div>
  )

  // ── La ficha: como esta, que anotar, que le paso ──────────────────────────
  const estado = ing ? estadoStock(ing) : null
  const dias = ritmo?.dias_de_stock
  const ultimos = (extracto?.movimientos ?? [])
    .slice()
    .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
    .slice(0, 6)

  const vista = ing && (
    <div className="space-y-5">
      {/* Las tres preguntas, en cifras con palabras. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <CifraFicha
          titulo="Hay"
          valor={`${cantidad(ing.stock_actual)} ${u}`}
          tono={estado?.tono}
          detalle={
            estado
              ? estado.tono === 'mal'
                ? 'Se acabó'
                : `Bajo el mínimo de ${cantidad(ing.stock_minimo)} ${u}`
              : ing.stock_minimo > 0
                ? `Avisa por debajo de ${cantidad(ing.stock_minimo)} ${u}`
                : 'Sin mínimo puesto'
          }
        />
        <CifraFicha
          titulo="Te alcanza para"
          valor={
            ritmo === undefined
              ? '…'
              : dias == null
                ? '—'
                : cuantoDura(dias)
          }
          detalle={
            ritmo === undefined
              ? ' '
              : !ritmo || ritmo.por_dia <= 0
                ? 'No se usó en los últimos 30 días'
                : `Se usan ${legible(ritmo.por_dia, u)} al día`
          }
        />
        <CifraFicha
          titulo="Te cuesta"
          valor={`${dinero(ing.costo_efectivo)} el ${u}`}
          detalle={
            ing.tipo !== 'reventa' && ing.rendimiento_pct < 100
              ? `Pagas ${dinero(ing.costo_unitario)} y se aprovecha el ${ing.rendimiento_pct}%`
              : 'Lo que pagas, sin IVA'
          }
        />
      </div>

      {perdidaTotal > 0 && (
        <p className="text-sm text-neutral-600">
          Se perdieron <b className="text-peligro-600 tabular-nums">{dinero(perdidaTotal)}</b> en los últimos 30 días
          {mermas.length > 1 ? ` (${mermas.length} veces)` : ''}.
        </p>
      )}

      {presentaciones.length > 0 && (
        <div>
          <p className="vp-etiqueta mb-2">Cómo te llega</p>
          <ul className="flex flex-wrap gap-1.5">
            {presentaciones.map((e) => (
              <li key={e.id} className="vp-control inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs">
                <span className="font-semibold">
                  1 {e.unidad_papel || 'paquete'} = {Number(e.factor.toFixed(4))} {e.unidad}
                </span>
                <span className="text-neutral-500">· {e.proveedor_nombre || e.proveedor_rif}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Lo que se viene a hacer, con verbos. */}
      <div>
        <p className="vp-etiqueta mb-2">Anotar</p>
        <div className="grid grid-cols-2 gap-2">
          <BotonAnotar titulo="Llegó mercancía" detalle="Una compra sin factura" onClick={() => acciones.comprar(ing)} />
          <BotonAnotar titulo="Se dañó o se botó" detalle="Queda como pérdida" peligro onClick={() => acciones.merma(ing)} />
          <BotonAnotar titulo="La usó el personal" detalle="Comida de empleados: no es pérdida" onClick={() => acciones.consumoPersonal(ing)} />
          <BotonAnotar titulo="Contar lo que hay" detalle="Lo que diga la balanza manda" onClick={() => acciones.contar(ing)} />
        </div>
      </div>

      {/* Lo ultimo que le paso, en frases. El extracto entero, detras. */}
      <div>
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <p className="vp-etiqueta">{todo ? 'Todo lo que le pasó' : 'Lo último que le pasó'}</p>
          {extracto && (todo || extracto.movimientos.length > 0) && (
            <button type="button" onClick={() => setTodo((v) => !v)} className="text-sm font-medium text-acento-700 hover:underline">
              {todo ? 'Ver menos' : 'Ver todo'}
            </button>
          )}
        </div>
        {extracto === null ? (
          <p className="text-sm text-neutral-400">Cargando…</p>
        ) : extracto.movimientos.length === 0 && !desdeExtracto ? (
          <p className="text-sm text-neutral-500">Todavía no le ha pasado nada: no se ha comprado, vendido ni contado.</p>
        ) : !todo ? (
          <ul className="divide-y divide-neutral-100 rounded-xl border border-neutral-200">
            {ultimos.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <span className="w-14 shrink-0 text-xs text-neutral-500 tabular-nums whitespace-nowrap">{fechaCorta(m.fecha)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium truncate">{queLePaso(m)}</span>
                  {(m.nota || m.operador) && (
                    <span className="block text-[11px] text-neutral-400 truncate">
                      {[m.nota, m.operador].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-right tabular-nums">
                  <span className={`block font-semibold ${m.cantidad < 0 ? 'text-peligro-600' : 'text-exito-700'}`}>
                    {m.cantidad > 0 ? '+' : '−'}
                    {legible(m.cantidad, u)}
                  </span>
                  <span className="block text-[11px] text-neutral-400">quedó {cantidad(m.saldo)} {u}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <FiltroDesplegable
                etiqueta="Período"
                valor={desdeExtracto}
                alCambiar={setDesdeExtracto}
                opciones={[
                  { valor: '', texto: 'Desde el principio' },
                  { valor: rangoDe('7d').desde, texto: 'Últimos 7 días' },
                  { valor: rangoDe('30d').desde, texto: 'Últimos 30 días' },
                  { valor: rangoDe('mes').desde, texto: 'Este mes' },
                  { valor: rangoDe('90d').desde, texto: 'Últimos 90 días' },
                ].filter((o, k, todas) => todas.findIndex((x) => x.valor === o.valor) === k)}
              />
              <EnlaceDescarga
                ruta={`/api/inventario/ingredientes/${ing.id}/movimientos/exportar${desdeExtracto ? `?desde=${desdeExtracto}T00:00:00` : ''}`}
                nombre={`movimientos-${ing.nombre}.csv`}
                className="ml-auto text-xs font-medium text-acento-700 hover:underline"
              >
                Descargar la lista
              </EnlaceDescarga>
            </div>
            {extracto.movimientos.length === 0 ? (
              <p className="text-sm text-neutral-500">No se movió nada en ese período.</p>
            ) : (
              <>
                <ResumenDelExtracto e={extracto} desde={desdeExtracto} />
                {!extracto.cuadra && (
                  <Aviso tono="mal">
                    El libro suma {cantidad(extracto.saldo_segun_libro)} {u} y la existencia dice{' '}
                    {cantidad(extracto.stock_actual)}. Algo movió el stock sin anotarlo: avísale a quien mantiene el sistema.
                  </Aviso>
                )}
                <Tabla orden={ordenMovimientos} glosario="movimientos" className="border border-neutral-200 rounded-xl">
                  <table className="w-full text-sm">
                    <thead className="text-neutral-500 text-xs uppercase">
                      <tr>
                        <Th clave="fecha">Fecha</Th>
                        <Th clave="movimiento">Qué pasó</Th>
                        <Th clave="quien">Quién</Th>
                        <Th clave="cantidad" alinear="derecha">Cantidad</Th>
                        <Th clave="valor" alinear="derecha">Vale</Th>
                        <Th clave="saldo" alinear="derecha">Quedó</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {ordenMovimientos.ordenar(extracto.movimientos).map((m) => (
                        <tr key={m.id} className="border-t border-neutral-100">
                          <td className="p-2 text-neutral-500 whitespace-nowrap">{new Date(m.fecha).toLocaleDateString('es-VE')}</td>
                          <td className="p-2">
                            <b className="font-medium">{queLePaso(m)}</b>
                            {m.nota && <span className="block text-[11px] text-neutral-400">{m.nota}</span>}
                          </td>
                          <td className="p-2 text-neutral-500">{m.operador ?? '—'}</td>
                          <td className={`p-2 text-right tabular-nums font-medium ${m.cantidad < 0 ? 'text-peligro-600' : 'text-exito-700'}`}>
                            {m.cantidad > 0 ? '+' : ''}
                            {cantidad(m.cantidad)} {u}
                          </td>
                          {/* El equivalente en plata: sin esto, "-0.025" no dice
                              si eso que salio costo un centavo o un dolar. */}
                          <td className={`p-2 text-right tabular-nums ${m.valor < 0 ? 'text-peligro-600' : 'text-neutral-500'}`}>
                            {dinero(Math.abs(m.valor))}
                          </td>
                          <td className="p-2 text-right tabular-nums text-neutral-500">
                            {cantidad(m.saldo)} {u}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Tabla>
              </>
            )}

            {/* Lo que se ha pagado por ella, compra a compra. */}
            <div>
              <p className="vp-etiqueta mb-2">Lo que has pagado</p>
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
                            {cantidad(c.cantidad)} {u}
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
      </div>

    </div>
  )

  return (
    <Modal
      titulo={nuevo ? 'Nueva mercancía' : ing.nombre}
      ayuda={
        nuevo
          ? 'Lo indispensable para empezar; lo demás se puede poner después.'
          : editando
            ? 'Cambiar los datos de esta mercancía'
            : `${ing.categoria || 'Sin categoría'} · ${ALMACEN_DE[ing.tipo].detalle}`
      }
      onCerrar={onCerrar}
      ancho="lg"
      pie={
        editando ? (
          <>
            <Boton tono="suave" onClick={() => (nuevo ? onCerrar() : setEditando(false))}>
              {nuevo ? 'Cancelar' : 'Volver'}
            </Boton>
            <Boton onClick={guardar} disabled={guardando}>
              {nuevo ? 'Crear mercancía' : 'Guardar cambios'}
            </Boton>
          </>
        ) : (
          <>
            {/* AL PIE, SIEMPRE A LA VISTA. Al final de la ficha quedaba
                debajo de cien movimientos y no se encontraba (Leider, 2-oct). */}
            <Boton tono="suave" onClick={() => setEditando(true)} className="mr-auto">
              Cambiar los datos
            </Boton>
            <Boton tono="suave" onClick={onCerrar}>
              Cerrar
            </Boton>
          </>
        )
      }
    >
      {aviso && (
        <div className="mb-3">
          <Aviso>{aviso}</Aviso>
        </div>
      )}
      {editando ? formulario : vista}
    </Modal>
  )
}

/** Una de las tres cifras de arriba de la ficha. */
function CifraFicha({
  titulo,
  valor,
  detalle,
  tono,
}: {
  titulo: string
  valor: string
  detalle: string
  tono?: 'mal' | 'ojo'
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 ${
        tono === 'mal' ? 'border-peligro-200 bg-peligro-50' : tono === 'ojo' ? 'border-aviso-200 bg-aviso-50' : 'border-neutral-200'
      }`}
    >
      <span className="block text-xs text-neutral-500">{titulo}</span>
      <span className="block font-display text-xl font-semibold tracking-tight tabular-nums leading-tight mt-0.5">{valor}</span>
      <span className={`block text-[11px] leading-snug mt-0.5 ${tono === 'mal' ? 'text-peligro-700' : tono === 'ojo' ? 'text-aviso-700' : 'text-neutral-500'}`}>
        {detalle}
      </span>
    </div>
  )
}

/** Un boton de "Anotar": el verbo grande, lo que significa debajo. */
function BotonAnotar({
  titulo,
  detalle,
  peligro = false,
  onClick,
}: {
  titulo: string
  detalle: string
  peligro?: boolean
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className="vp-control vp-pulsable rounded-xl px-3 py-2.5 text-left">
      <span className={`block text-sm font-semibold ${peligro ? 'text-peligro-600' : ''}`}>{titulo}</span>
      <span className="block text-xs text-neutral-500">{detalle}</span>
    </button>
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
// Los grupos del resumen, dichos como en la lista de movimientos.
const GRUPO: Record<string, string> = {
  compra: 'Compras',
  venta: 'Ventas',
  merma: 'Se dañó o se botó',
  consumo_personal: 'La usó el personal',
  ajuste: 'Conteos',
  reverso: 'Movimientos deshechos',
}

/** Un grupo del resumen del historial (lo que entro, o lo que salio), con su total arriba. */
function GrupoDelExtracto({
  titulo,
  filas,
  total,
  signo,
  tono,
  unidad,
}: {
  titulo: string
  filas: RenglonPorTipo[]
  total: number
  signo: '+' | '−'
  tono: string
  unidad: string
}) {
  const { fmt: dinero } = useMoneda()
  const valor = filas.reduce((t, x) => t + Math.abs(x.valor), 0)
  return (
    <>
      <tr className="border-t border-neutral-200">
        <th scope="rowgroup" className="py-2 pl-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {titulo}
        </th>
        <td />
        <td className={`py-2 text-right tabular-nums font-semibold ${tono}`}>
          {signo}
          {legible(total, unidad)}
        </td>
        <td className="py-2 pr-3 text-right tabular-nums text-neutral-500">{dinero(valor)}</td>
      </tr>
      {filas.length === 0 ? (
        <tr>
          <td colSpan={4} className="pb-2 pl-6 text-xs text-neutral-400">
            Nada en este período.
          </td>
        </tr>
      ) : (
        filas.map((x) => (
          <tr key={x.tipo}>
            <td className="py-1.5 pl-6 text-neutral-700">{GRUPO[x.tipo] ?? x.etiqueta}</td>
            <td className="py-1.5 text-right tabular-nums text-neutral-500">{x.movimientos}</td>
            <td className="py-1.5 text-right tabular-nums">{legible(x.cantidad, unidad)}</td>
            <td className="py-1.5 pr-3 text-right tabular-nums text-neutral-500">{dinero(Math.abs(x.valor))}</td>
          </tr>
        ))
      )}
    </>
  )
}

function ResumenDelExtracto({ e, desde }: { e: ExtractoInsumo; desde: string }) {
  // UNA TABLA CON SUS CAMPOS: que paso, cuantas veces, cuanto y cuanto vale,
  // con lo que entro y lo que salio como dos grupos y lo que queda al pie.
  // Eran dos columnas de numeros sueltos sin rotulo (Leider, 2-oct: "hay
  // muchos numeros juntos, no hay campos claros").

  return (
    <div className="rounded-xl border border-neutral-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="py-2 pl-3 text-left font-semibold">Qué pasó</th>
            <th className="py-2 text-right font-semibold">Veces</th>
            <th className="py-2 text-right font-semibold">Cantidad</th>
            <th className="py-2 pr-3 text-right font-semibold">Vale</th>
          </tr>
        </thead>
        <tbody>
          {desde && (
            <tr className="border-t border-neutral-200">
              <th scope="row" className="py-2 pl-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                Había al empezar
              </th>
              <td />
              <td className="py-2 text-right tabular-nums font-semibold">{legible(e.saldo_inicial, e.unidad)}</td>
              <td />
            </tr>
          )}
          <GrupoDelExtracto titulo="Entró" filas={e.entradas} total={e.total_entradas} signo="+" tono="text-exito-700" unidad={e.unidad} />
          <GrupoDelExtracto titulo="Salió" filas={e.salidas} total={e.total_salidas} signo="−" tono="text-peligro-600" unidad={e.unidad} />
          <tr className="border-t border-neutral-200">
            <th scope="row" className="py-2 pl-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-700">
              Quedan
            </th>
            <td />
            <td className="py-2 text-right tabular-nums font-bold">{legible(desde ? e.saldo_final : e.stock_actual, e.unidad)}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  )
}
