import { useEffect, useMemo, useState } from 'react'
import NavBar from '../components/NavBar'
import { useSeccion } from '../components/Secciones'
import { FiltroFechas } from '../components/Fechas'
import { useRango, nombreRango } from '../lib/fechas'
import { Tabla, Th, useOrden } from '../components/Tabla'
import { useDialogo } from '../components/dialogo'
import { Aviso, Boton, Campo, Cifra, Modal, Pagina, Pastilla, Seccion, Selector, Vacio } from '../components/ui'
import { api } from '../lib/api'
import type {
  CompraDeInsumo,
  DatosIngrediente,
  ImpactoDeCompra,
  InflacionInsumos,
  Ingrediente,
  Merma,
  ResultadoConteo,
  SobranteInventario,
  SugerenciaCompra,
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
  { id: 'insumos', texto: 'Insumos' },
  { id: 'comprar', texto: 'Qué comprar' },
  { id: 'perdidas', texto: 'Pérdidas' },
]

export default function Inventario() {
  const [seccion, irA] = useSeccion(SECCIONES)
  // Solo las perdidas tienen fecha; el stock y que comprar son "a hoy".
  const [rango, setRango] = useRango('30d')
  const dialogo = useDialogo()
  const [ingredientes, setIngredientes] = useState<Ingrediente[]>([])
  const [sugerencias, setSugerencias] = useState<SugerenciaCompra[]>([])
  const [mermas, setMermas] = useState<Merma[]>([])
  const [sobrantes, setSobrantes] = useState<SobranteInventario[]>([])
  const [inflacion, setInflacion] = useState<InflacionInsumos | null>(null)
  const [error, setError] = useState('')
  const [buscar, setBuscar] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  // Lo que hay que ponerle delante al dueno cuando un insumo pega un salto.
  const [impacto, setImpacto] = useState<ImpactoDeCompra | null>(null)
  // La ficha abierta: 'nuevo' o el id del insumo. Se guarda el id y no el
  // objeto para que la ficha vea el stock nuevo despues de cada movimiento.
  const [ficha, setFicha] = useState<'nuevo' | number | null>(null)
  const [contando, setContando] = useState(false)

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
    api.inflacionInsumos().then(setInflacion).catch(() => setInflacion(null))
  }

  async function accion(fn: () => Promise<unknown>) {
    setError('')
    try {
      await fn()
      cargar()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ocurrio un error')
      return false
    }
  }

  // ── Movimientos ──────────────────────────────────────────────────────────

  async function comprar(ing: Ingrediente) {
    const r = await dialogo.pedir({
      titulo: `Compra de ${ing.nombre}`,
      campos: [
        { nombre: 'cantidad', etiqueta: 'Cuánto entra', sufijo: ing.unidad, tipo: 'numero', min: 0.0001 },
        {
          nombre: 'costo',
          etiqueta: 'Cuánto pagaste en total, sin IVA',
          sufijo: '$',
          tipo: 'numero',
          opcional: true,
          ayuda: 'Vacío = se mantiene el costo actual. El IVA no es parte del costo del insumo.',
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
    await accion(async () => {
      const resultado = await api.registrarCompra(
        ing.id,
        Number(r.cantidad),
        r.costo ? Number(r.costo) : undefined,
        r.metodo,
      )
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
    if (activo === false) {
      const ok = await dialogo.confirmar({
        titulo: `¿Archivar ${ing.nombre}?`,
        texto:
          'Deja de aparecer en el inventario, en las compras y en las sugerencias. ' +
          'No se borra: sus recetas, compras y mermas siguen ahí, y se puede volver a activar.',
        aceptar: 'Archivar',
        peligro: true,
      })
      if (!ok) return
    }
    await guardarFicha({ ...datosDe(ing), activo }, ing.id)
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
          ? `Los ${r.sin_cambio} insumos contados coinciden con el sistema.`
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
  const perdidas = mermas.filter((m) => !m.revertida).reduce((s, m) => s + m.valor, 0)

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    return ingredientes.filter((i) => {
      if (filtro === 'archivados') {
        if (i.activo !== false) return false
      } else if (i.activo === false) return false
      if (filtro === 'bajo' && i.stock_actual > i.stock_minimo) return false
      if (filtro === 'sin-costo' && i.costo_unitario) return false
      if ((filtro === 'insumo' || filtro === 'reventa') && i.tipo !== filtro) return false
      return !q || i.nombre.toLowerCase().includes(q)
    })
  }, [ingredientes, filtro, buscar])

  const fichaIng = typeof ficha === 'number' ? ingredientes.find((i) => i.id === ficha) ?? null : null

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Inventario" secciones={SECCIONES} seccion={seccion} alCambiarSeccion={irA} filtro={<FiltroFechas rango={rango} alCambiar={setRango} />} />
      <Pagina ancho="ancha">
        {error && <Aviso>{error}</Aviso>}

        {seccion === 'insumos' && (
          <>
        {/* Las cuatro cifras que dicen como esta el deposito sin leer la tabla. */}
        <div className="vp-escalonado grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Cifra
            titulo="Insumos"
            ayuda="kpi.insumos"
            valor={String(activos.length)}
            detalle={`${activos.filter((i) => i.tipo !== 'reventa').length} materia prima · ${activos.filter((i) => i.tipo === 'reventa').length} reventa`}
          />
          <Cifra
            titulo="Bajo mínimo"
            ayuda="kpi.bajo_minimo"
            valor={String(bajoMinimo.length)}
            detalle={bajoMinimo.length ? 'Toca para verlos' : 'Todo por encima del mínimo'}
            tono={bajoMinimo.length ? 'alerta' : 'bien'}
          />
          <Cifra titulo="Valor en depósito" ayuda="kpi.valor_deposito" valor={dinero(valorDeposito)} detalle="Stock × costo promedio, sin IVA" />
          <Cifra
            titulo={`Pérdidas · ${nombreRango(rango).toLowerCase()}`}
            ayuda="kpi.perdidas_30"
            valor={dinero(perdidas)}
            detalle="Mermas y faltantes de conteo"
            tono={perdidas > 0 ? 'alerta' : 'normal'}
          />
        </div>

        {/* Buscar, filtrar y las dos acciones del modulo. */}
        <div className="bg-white rounded-2xl border border-neutral-200 p-3 flex flex-col lg:flex-row lg:items-center gap-3">
          <input
            type="search"
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            placeholder="Buscar insumo…"
            className="border border-neutral-300 rounded-lg px-3 py-2 text-sm w-full lg:w-64"
          />
          <div className="flex flex-wrap gap-1.5 lg:flex-1">
            {FILTROS.map((f) => {
              const n =
                f.valor === 'bajo'
                  ? bajoMinimo.length
                  : f.valor === 'sin-costo'
                    ? sinCosto.length
                    : f.valor === 'archivados'
                      ? ingredientes.length - activos.length
                      : null
              if (f.valor === 'archivados' && !n) return null
              return (
                <button
                  key={f.valor}
                  type="button"
                  onClick={() => setFiltro(f.valor)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-full border ${
                    filtro === f.valor
                      ? 'bg-neutral-900 text-white border-neutral-900'
                      : 'border-neutral-200 text-neutral-600 hover:border-neutral-400'
                  }`}
                >
                  {f.texto}
                  {n ? <span className="ml-1 opacity-70">{n}</span> : null}
                </button>
              )
            })}
          </div>
          <div className="flex gap-2 shrink-0">
            <Boton tono="suave" onClick={() => setContando(true)} disabled={activos.length === 0}>
              Conteo físico
            </Boton>
            <Boton onClick={() => setFicha('nuevo')}>+ Nuevo insumo</Boton>
          </div>
        </div>

        <Tabla orden={orden} glosario="inventario" className="bg-white rounded-2xl border border-neutral-200">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
              <tr>
                <Th clave="nombre">Insumo</Th>
                <Th clave="stock" alinear="derecha">Stock</Th>
                <Th clave="minimo" alinear="derecha">Mínimo</Th>
                <Th clave="costo" alinear="derecha">Costo compra</Th>
                {/* El promedio ponderado no dice cuanto cuesta comprar mas: esa
                    es la cuenta que importa para poner precios. */}
                <Th clave="reponer" alinear="derecha">Reponer</Th>
                <Th clave="rendimiento" alinear="derecha">Rendimiento</Th>
                <Th clave="real" alinear="derecha">Costo real</Th>
                <Th ayuda="inventario.acciones" alinear="derecha">Acciones</Th>
              </tr>
            </thead>
            <tbody>
              {visibles.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <Vacio
                      icono="inventario"
                      titulo={ingredientes.length === 0 ? 'Todavía no hay insumos' : 'Nada con ese filtro'}
                      detalle={
                        ingredientes.length === 0
                          ? 'Carga la materia prima y la mercancía de reventa; después las recetas dicen cuánto lleva cada producto.'
                          : undefined
                      }
                      accion={ingredientes.length === 0 ? <Boton onClick={() => setFicha('nuevo')}>+ Nuevo insumo</Boton> : undefined}
                    />
                  </td>
                </tr>
              )}
              {orden.ordenar(visibles).map((ing) => {
                const estado = estadoStock(ing)
                const archivado = ing.activo === false
                return (
                  <tr key={ing.id} className={`border-t border-neutral-100 ${archivado ? 'opacity-60' : ''}`}>
                    <td className="p-3">
                      <button
                        type="button"
                        onClick={() => setFicha(ing.id)}
                        className="text-left font-medium hover:text-acento-600"
                        title="Abrir la ficha"
                      >
                        {ing.nombre}
                      </button>
                      <span className="block text-[11px] text-neutral-400 mt-0.5">
                        {ing.tipo === 'reventa' ? 'Reventa' : 'Materia prima'} · por {ing.unidad}
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
                        <button type="button" onClick={() => setFicha(ing.id)} className="text-aviso-600 font-semibold">
                          cargar
                        </button>
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
                    <td className="p-3">
                      {archivado ? (
                        <div className="flex justify-end">
                          <AccionFila onClick={() => archivar(ing, true)}>Reactivar</AccionFila>
                        </div>
                      ) : (
                        <div className="flex gap-1.5 justify-end whitespace-nowrap">
                          <AccionFila onClick={() => comprar(ing)}>+ Compra</AccionFila>
                          <AccionFila onClick={() => merma(ing)} tono="peligro">
                            − Merma
                          </AccionFila>
                          <AccionFila onClick={() => setFicha(ing.id)} title="Ficha: editar, contar, historial">
                            Más
                          </AccionFila>
                        </div>
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
              Tus insumos subieron {inflacion.cambio_pct.toFixed(0)}% en {inflacion.dias} días
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

        {seccion === 'perdidas' && (
          <>
        {/* Sin esta lista el dueno no podia ver cuanto se perdia ni corregir
            una merma duplicada: era la unica perdida del sistema sin historial. */}
        <Seccion
          titulo="Pérdidas registradas"
          ayuda={`Todo lo que se botó, se dañó o faltó en un conteo (${nombreRango(rango).toLowerCase()}). Una merma por error se revierte: no se borra, queda el reverso asentado.`}
          accion={<span className="text-sm font-semibold tabular-nums">{dinero(perdidas)}</span>}
          plano
        >
          {mermas.length === 0 ? (
            <Vacio titulo="Sin pérdidas registradas" detalle="Bien ahí." />
          ) : (
            <Tabla orden={ordenMermas} glosario="perdidas">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
                  <tr>
                    <Th clave="fecha">Fecha</Th>
                    <Th clave="insumo">Insumo</Th>
                    <Th clave="cantidad" alinear="derecha">Cantidad</Th>
                    <Th clave="motivo">Motivo</Th>
                    <Th clave="valor" alinear="derecha">Valor</Th>
                    <Th alinear="derecha"></Th>
                  </tr>
                </thead>
                <tbody>
                  {ordenMermas.ordenar(mermas).map((m) => (
                    <tr key={m.id} className={`border-t border-neutral-100 ${m.revertida ? 'opacity-50' : ''}`}>
                      <td className="p-3 text-neutral-500 whitespace-nowrap">{new Date(m.fecha).toLocaleDateString('es-VE')}</td>
                      <td className="p-3 font-medium">{m.ingrediente_nombre}</td>
                      <td className="p-3 text-right tabular-nums whitespace-nowrap">
                        {cantidad(m.cantidad)} {m.unidad}
                      </td>
                      <td className="p-3 text-neutral-500">{m.motivo || '—'}</td>
                      <td className="p-3 text-right tabular-nums font-medium text-peligro-600">{dinero(m.valor)}</td>
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
          </>
        )}
      </Pagina>

      {(ficha === 'nuevo' || fichaIng) && (
        <FichaInsumo
          ing={fichaIng}
          mermas={fichaIng ? mermas.filter((m) => m.ingrediente_id === fichaIng.id && !m.revertida) : []}
          onCerrar={() => setFicha(null)}
          onGuardar={(datos) => guardarFicha(datos, fichaIng?.id ?? null)}
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
            <p className="mt-4 text-sm text-neutral-600">Ningún producto del menú usa este insumo todavía.</p>
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
    activo: ing.activo !== false,
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
  onCerrar,
  onGuardar,
  acciones,
}: {
  ing: Ingrediente | null
  mermas: Merma[]
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
  const [f, setF] = useState(() => ({
    nombre: ing?.nombre ?? '',
    tipo: (ing?.tipo ?? 'insumo') as 'insumo' | 'reventa',
    unidad: ing?.unidad ?? 'kg',
    stock_actual: '',
    stock_minimo: ing ? cantidad(ing.stock_minimo) : '',
    stock_objetivo: ing ? cantidad(ing.stock_objetivo) : '',
    costo_unitario: ing ? String(ing.costo_unitario) : '',
    rendimiento_pct: ing ? String(ing.rendimiento_pct) : '100',
  }))
  const [aviso, setAviso] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [historial, setHistorial] = useState<CompraDeInsumo[] | null>(null)
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
  }, [ing])

  const num = (v: string) => Number(v.trim().replace(',', '.'))
  const poner = (k: keyof typeof f, v: string) => setF((a) => ({ ...a, [k]: v }))

  async function guardar() {
    setAviso('')
    if (!f.nombre.trim()) return setAviso('El insumo necesita un nombre.')
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
      unidad: f.unidad,
      stock_minimo: minimo,
      stock_objetivo: objetivo,
      costo_unitario: costo,
      rendimiento_pct: rendimiento,
      activo: ing?.activo !== false,
      ...(nuevo ? { stock_actual: inicial } : {}),
    })
    setGuardando(false)
  }

  const perdidaTotal = mermas.reduce((s, m) => s + m.valor, 0)

  return (
    <Modal
      titulo={nuevo ? 'Nuevo insumo' : ing.nombre}
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
            {nuevo ? 'Crear insumo' : 'Guardar cambios'}
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
      </div>

      {!nuevo && (
        <div className="mt-6 space-y-4">
          {mermas.length > 0 && (
            <p className="text-sm text-neutral-600">
              Pérdidas en 30 días: <b className="text-peligro-600 tabular-nums">{dinero(perdidaTotal)}</b> en{' '}
              {mermas.length} registro(s).
            </p>
          )}
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
    const ok = await dialogo.confirmar({
      titulo: `¿Guardar el conteo de ${contados.length} insumo(s)?`,
      texto:
        `Faltante: ${dinero(faltante)} (queda como merma) · Sobrante: ${dinero(sobrante)}.\n\n` +
        'Lo que dice la balanza manda sobre lo que dice el sistema. Lo que dejaste en blanco no se toca.',
      aceptar: 'Guardar conteo',
    })
    if (!ok) return
    setGuardando(true)
    try {
      const r = await api.conteoFisico(contados.map((c) => ({ ingrediente_id: c.ing.id, stock_real: c.real })))
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
      ayuda="Anota lo que hay de verdad de cada insumo. Lo que dejes en blanco no cambia."
      onCerrar={onCerrar}
      ancho="lg"
      pie={
        <>
          <span className="mr-auto text-sm text-neutral-600 tabular-nums self-center">
            {contados.length} contado(s)
            {diferencias.length > 0 && (
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
      <input
        type="search"
        value={buscar}
        onChange={(e) => setBuscar(e.target.value)}
        placeholder="Buscar…"
        className="border border-neutral-300 rounded-lg px-3 py-2 text-sm w-full mb-3"
      />
      <table className="w-full text-sm">
        <thead className="text-neutral-500 text-xs uppercase">
          <tr>
            <th className="text-left p-2">Insumo</th>
            <th className="text-right p-2">Sistema</th>
            <th className="text-right p-2 w-32">Contado</th>
            <th className="text-right p-2">Diferencia</th>
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
                <td className="p-2 text-right tabular-nums text-neutral-500 whitespace-nowrap">
                  {cantidad(ing.stock_actual)}
                </td>
                <td className="p-2 text-right">
                  <input
                    inputMode="decimal"
                    value={texto}
                    onChange={(e) => setValores((v) => ({ ...v, [ing.id]: e.target.value }))}
                    placeholder="—"
                    aria-label={`Contado de ${ing.nombre}`}
                    className={`w-28 text-right border rounded-lg px-2 py-1.5 text-sm tabular-nums ${
                      texto && !valido ? 'border-peligro-400' : 'border-neutral-300'
                    }`}
                  />
                </td>
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
              </tr>
            )
          })}
        </tbody>
      </table>
    </Modal>
  )
}
