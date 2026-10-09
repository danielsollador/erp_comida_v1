import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { CasillaConUnidad } from '../../../components/Cantidad'
import { PuntoTipo } from '../../../components/compras/Almacenes'
import Icono from '../../../components/Icono'
import { Numerico } from '../../../components/Teclado'
import { contiene, palabrasDe } from '../../../components/Tabla'
import { Boton, FiltroDesplegable, Modal, Seccion, Vacio } from '../../../components/ui'
import { api, ErrorApi } from '../../../lib/api'
import { useMoneda } from '../../../lib/moneda'
import { colorFranja } from '../../../lib/paleta'
import { datosDe, unidadDe } from '../../../lib/inventario'
import { ALMACEN_DE, vaEnPreparacion } from '../../../lib/tiposArticulo'
import type { DatosPreparacion, Disponibilidad, Ingrediente, Preparacion, Produccion } from '../../../lib/types'

/**
 * PREPARADO: la segunda cara de la materia prima. El guiso, la mechada, la
 * salsa: lo que la cocina hace con el crudo.
 *
 * Es un almacén IMAGINARIO (pizarra del 7-oct): no dice cuánto guiso hay en
 * la nevera, dice cuánto se PODRÍA hacer con el crudo que hay. Al vender un
 * pastelito se baja por la receta hasta el pollo, y nadie pesa nada. Lo que
 * sí se anota es al cierre: "sobró guiso, lo boto o lo guardo".
 *
 * Tres piezas:
 *  - EL MAPA: cada materia prima a la izquierda, cada preparación a la
 *    derecha, y una línea por cada "lleva". Se ve de un vistazo qué crudo
 *    comparten dos preparaciones (compiten por él).
 *  - LAS TARJETAS: por preparación, cuánto podrías hacer hoy y "Sobró hoy".
 *  - LA OLLA: el editor de la receta, con la misma forma que la receta del
 *    menú (el vaso), pero apuntando solo a la materia prima y sin margen: la
 *    olla se llena con lo que lleva 1 kg (o 1 lt, o 1 unidad) y dice cuánto
 *    cuesta. LA RECETA ES POR UNO (Leider, 8-oct): así el costo del kilo es
 *    la suma de lo que lleva, y para hacer 2 kg el sistema multiplica.
 */
export default function Preparaciones({
  ingredientes,
  onCambio,
  onEditando,
}: {
  ingredientes: Ingrediente[]
  /** Algo movió el inventario (una tanda, una merma): que se recargue. */
  onCambio: () => void
  /** Se abrió (o cerró) la receta: la pantalla de arriba esconde lo que no va. */
  onEditando?: (abierta: boolean) => void
}) {
  const { fmt: dinero } = useMoneda()
  const [preps, setPreps] = useState<Preparacion[] | null>(null)
  const [disp, setDisp] = useState<Disponibilidad[]>([])
  const [vencidas, setVencidas] = useState<Preparacion[]>([])
  // Las que rinden distinto de su ficha en las últimas tandas (8-oct).
  const [rindeDistinto, setRindeDistinto] = useState<Awaited<ReturnType<typeof api.rendimientosReales>>>([])
  const [tandas, setTandas] = useState<Produccion[]>([])
  const [editando, setEditando] = useState<Preparacion | 'nueva' | null>(null)
  const [anotando, setAnotando] = useState<Preparacion | null>(null)
  const [sobro, setSobro] = useState<Preparacion | null>(null)
  // La que se eligió con un toque se queda; el cursor solo adelanta.
  const [seleccion, setSeleccion] = useState<number | null>(null)
  const [resaltada, setResaltada] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    onEditando?.(editando !== null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editando])

  const cargar = useCallback(() => {
    Promise.all([api.listarPreparaciones(), api.disponibilidad(), api.preparacionesVencidas(), api.listarProduccion()])
      .then(([p, d, v, t]) => {
        setPreps(p)
        setDisp(d)
        setVencidas(v)
        setTandas(t)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron traer las preparaciones'))
    api.rendimientosReales().then(setRindeDistinto).catch(() => undefined)
  }, [])
  // El % del crudo en su ficha, a lo que de verdad rinde.
  async function ajustarFicha(r: (typeof rindeDistinto)[number]) {
    const ing = ingredientes.find((i) => i.id === r.crudo_id)
    if (!ing || r.sugerido_pct == null) return
    try {
      await api.actualizarIngrediente(ing.id, { ...datosDe(ing), rendimiento_pct: r.sugerido_pct })
      recargarTodo()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo ajustar la ficha')
    }
  }
  useEffect(cargar, [cargar])

  function recargarTodo() {
    cargar()
    onCambio()
  }

  const dispDe = (p: Preparacion) => disp.find((d) => d.preparacion_id === p.id)
  // Un color por preparación, el mismo en el mapa y en su tarjeta.
  const colorDe = useMemo(() => new Map((preps ?? []).map((p, i) => [p.id, colorFranja(i)])), [preps])

  if (editando) {
    return (
      <Olla
        prep={editando === 'nueva' ? null : editando}
        ingredientes={ingredientes}
        onCerrar={() => setEditando(null)}
        onGuardada={() => {
          setEditando(null)
          recargarTodo()
        }}
      />
    )
  }

  return (
    <div className="space-y-4">
      {error && <p className="rounded-2xl bg-peligro-500/10 px-4 py-3 text-sm text-peligro-700">{error}</p>}
      {aviso && (
        <p className="rounded-2xl bg-exito-500/10 px-4 py-3 text-sm text-exito-800 flex items-center justify-between gap-3">
          <span>{aviso}</span>
          <button type="button" onClick={() => setAviso('')} className="text-xs font-semibold underline">
            Cerrar
          </button>
        </p>
      )}

      {rindeDistinto.map((r) => (
        <div key={r.preparacion_id} className="rounded-2xl bg-aviso-500/10 p-4 text-sm flex flex-wrap items-center gap-3">
          <span className="flex-1 min-w-[220px] text-aviso-900">
            <b>{r.nombre}</b>: las últimas {r.tandas} tandas salieron al <b className="tabular-nums">{r.real_pct} %</b> de lo esperado.
            {r.sugerido_pct != null && (
              <>
                {' '}La ficha de {r.crudo} dice {r.ficha_pct} %; con <b className="tabular-nums">{r.sugerido_pct} %</b> el costo diría la verdad.
              </>
            )}
          </span>
          {r.sugerido_pct != null && (
            <button type="button" onClick={() => void ajustarFicha(r)} className="font-semibold text-aviso-900 underline">
              Ajustar {r.crudo} a {r.sugerido_pct} %
            </button>
          )}
        </div>
      ))}

      {vencidas.length > 0 && (
        <div className="rounded-2xl bg-aviso-500/10 p-4 space-y-2">
          <p className="text-sm font-semibold text-aviso-800">Sobró de antes y ya pasó su tiempo</p>
          {vencidas.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
              <span>
                {p.nombre}: <b className="tabular-nums">{p.stock_actual} {unidadDe(p.stock_actual, p.unidad)}</b>
              </span>
              <button type="button" onClick={() => setSobro(p)} className="text-sm font-semibold text-aviso-800 underline">
                Decidir
              </button>
            </div>
          ))}
        </div>
      )}

      {preps === null ? (
        <p className="text-sm text-neutral-500 py-6 text-center">Cargando…</p>
      ) : preps.length === 0 ? (
        <div className="vp-losa">
          <Vacio
            icono="cocina"
            titulo="Todavía no hay preparaciones"
            detalle="Ej.: guiso de pollo. Para 1 kg lleva 1,4 kg de pollo, 140 g de cebolla y 70 g de pimentón. Después el pastelito lleva «50 g de guiso»."
            accion={<Boton onClick={() => setEditando('nueva')}>Crear la primera</Boton>}
          />
        </div>
      ) : (
        <>
          <Seccion
            titulo="Qué crudo usa cada preparación"
            ayuda="Elige una preparación y el mapa se queda en ella: qué crudo lleva y quién más lo usa. Lo que comparten dos preparaciones va en ámbar: compiten por ello. Tócala otra vez para soltarla."
          >
            <Mapa
              preps={preps}
              ingredientes={ingredientes}
              disp={disp}
              colorDe={colorDe}
              seleccion={seleccion}
              onSeleccionar={setSeleccion}
              resaltada={resaltada}
              onResaltar={setResaltada}
              onEditar={setEditando}
              dinero={dinero}
            />
          </Seccion>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
            {preps.map((p) => (
              <TarjetaPreparacion
                key={p.id}
                p={p}
                d={dispDe(p)}
                color={colorDe.get(p.id) ?? 'var(--color-neutral-400)'}
                resaltada={seleccion === p.id || (seleccion === null && resaltada === p.id)}
                onResaltar={setResaltada}
                onSeleccionar={() => setSeleccion(seleccion === p.id ? null : p.id)}
                dinero={dinero}
                onEditar={() => setEditando(p)}
                onTanda={() => setAnotando(p)}
                onSobro={() => setSobro(p)}
              />
            ))}
            {/* Una tarjeta más, al final: no le quita sitio a Crudo/Preparado
                ni ocupa una fila propia arriba (Leider, 8-oct). */}
            <button
              type="button"
              onClick={() => setEditando('nueva')}
              className="vp-pulsable rounded-2xl border-2 border-dashed border-neutral-500/25 hover:border-neutral-500/45 hover:bg-neutral-500/4 p-3.5 min-h-[140px] flex flex-col items-center justify-center gap-2 text-center text-neutral-600 transition-colors"
            >
              <span className="inline-grid place-items-center w-10 h-10 rounded-full bg-neutral-900 text-white">
                <Icono nombre="mas" size={18} />
              </span>
              <span className="font-display font-semibold text-neutral-900">Nueva preparación</span>
              <span className="text-xs text-neutral-500 max-w-[16rem]">Qué crudo lleva 1 kilo (o 1 litro, o 1 unidad), como una receta.</span>
            </button>
          </div>
        </>
      )}

      {tandas.length > 0 && (
        <Seccion titulo="Tandas de esta semana" ayuda="Lo que la cocina anotó, con lo que rindió contra la receta.">
          <ul className="divide-y divide-neutral-500/10 text-sm">
            {tandas.map((t) => (
              <li key={t.id} className="py-2 flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block font-medium">{t.preparacion}</span>
                  <span className="block text-xs text-neutral-500">
                    {new Date(t.fecha).toLocaleString('es-VE', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · costó {dinero(t.costo_total)}
                  </span>
                </span>
                <span className="text-right shrink-0">
                  <span className="block font-semibold tabular-nums">
                    {t.cantidad} {unidadDe(t.cantidad, t.unidad)}
                  </span>
                  {t.rendimiento_real != null && (
                    <span className={`block text-xs ${Math.abs(t.rendimiento_real - 1) > 0.05 ? 'text-aviso-700' : 'text-neutral-500'}`}>
                      {Math.round(t.rendimiento_real * 100)} % de lo esperado
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Seccion>
      )}

      {anotando && (
        <AnotarTanda
          inicial={anotando}
          producibles={(preps ?? []).filter((p) => p.modo_produccion === 'producir')}
          ingredientes={ingredientes}
          onCerrar={() => setAnotando(null)}
          onHecho={() => {
            setAnotando(null)
            recargarTodo()
          }}
        />
      )}
      {sobro && (
        <SobroHoy
          p={sobro}
          onCerrar={() => setSobro(null)}
          onHecho={(mensaje) => {
            setSobro(null)
            setAviso(mensaje)
            recargarTodo()
          }}
        />
      )}
    </div>
  )
}

// ── El mapa: materia prima ↔ preparaciones ──────────────────────────────────

const FILA = 50
const ANCHO_LINEAS = 160
// Con mas preparaciones que esto, el mapa completo se vuelve una maraña de
// lineas que se cruzan: se pide elegir una, y el mapa muestra solo la suya.
const MAXIMO_MAPA_COMPLETO = 6

/**
 * Pensado para MUCHAS preparaciones (Leider, 7-oct): la elegida se queda
 * elegida (un desplegable, como todo filtro del ERP), y el mapa se enfoca en
 * ella: su crudo a la izquierda, ella sola a la derecha, y en cada crudo
 * quiénes más lo usan.
 *
 * Pocos números, y cada uno con su frase: cuánto hay de cada crudo, cuánto
 * lleva la tanda y cuánto podrías hacer hoy. La merma es del crudo, no de aquí.
 */
function Mapa({
  preps,
  ingredientes,
  disp,
  colorDe,
  seleccion,
  onSeleccionar,
  resaltada,
  onResaltar,
  onEditar,
  dinero,
}: {
  preps: Preparacion[]
  ingredientes: Ingrediente[]
  disp: Disponibilidad[]
  colorDe: Map<number, string>
  seleccion: number | null
  onSeleccionar: (id: number | null) => void
  resaltada: number | null
  onResaltar: (id: number | null) => void
  onEditar: (p: Preparacion) => void
  dinero: (n: number) => string
}) {
  const porId = useMemo(() => new Map(ingredientes.map((i) => [i.id, i])), [ingredientes])
  // Que preparaciones usan cada crudo.
  const usosDe = useMemo(() => {
    const m = new Map<number, { nombre: string; unidad: string; tipo: Ingrediente['tipo']; preps: { p: Preparacion; cantidad: number; costo: number }[] }>()
    for (const p of preps)
      for (const l of p.lineas) {
        const u = m.get(l.ingrediente_id) ?? { nombre: l.nombre, unidad: l.unidad, tipo: l.tipo, preps: [] }
        u.preps.push({ p, cantidad: l.cantidad, costo: l.costo })
        m.set(l.ingrediente_id, u)
      }
    return m
  }, [preps])
  const elegida = seleccion !== null ? (preps.find((p) => p.id === seleccion) ?? null) : null

  const filtro = (
    <div className="mb-4">
      <FiltroDesplegable
        etiqueta="Preparación"
        valor={seleccion === null ? '' : String(seleccion)}
        alCambiar={(v) => onSeleccionar(v === '' ? null : Number(v))}
        opciones={[
          { valor: '', texto: 'Todas' },
          ...preps.map((p) => ({ valor: String(p.id), texto: p.nombre, detalle: `receta por ${p.unidad === 'kg' ? 'kilo' : p.unidad === 'lt' ? 'litro' : 'unidad'}` })),
        ]}
      />
    </div>
  )

  /** Lo que se pierde al limpiar o cocinar ese crudo, según su ficha (el pollo, el pernil). */
  const pierdeAlCocinar = (ing?: Ingrediente) => (ing && ing.rendimiento_pct < 100 ? `pierde ${Math.round(100 - ing.rendimiento_pct)} % al limpiar o cocinar` : null)

  // ── Una preparación elegida: su crudo, y quién más lo usa ──
  if (elegida) {
    const lineas = [...elegida.lineas].sort((a, b) => b.costo - a.costo)
    const alto = Math.max(lineas.length, 1) * FILA
    const yCentro = alto / 2
    const d = disp.find((x) => x.preparacion_id === elegida.id)
    const color = colorDe.get(elegida.id) ?? '#999'
    const pastilla = (l: (typeof lineas)[number]) => {
      const ing = porId.get(l.ingrediente_id)
      const otras = (usosDe.get(l.ingrediente_id)?.preps ?? []).filter((x) => x.p.id !== elegida.id)
      const pierde = pierdeAlCocinar(ing)
      return (
        <div className={`min-w-0 rounded-2xl px-3 py-1.5 ${otras.length > 0 ? 'bg-aviso-500/10' : 'bg-neutral-500/6'}`}>
          <span className="flex items-center gap-2">
            <PuntoTipo tipo={l.tipo} />
            <span className="font-medium truncate flex-1">{l.nombre}</span>
            <span className="text-sm font-semibold tabular-nums shrink-0">
              {fmtCant(l.cantidad)} {unidadDe(l.cantidad, l.unidad)}
            </span>
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-neutral-500 leading-tight pl-4">
            {ing && <span className="tabular-nums">hay {fmtCant(ing.stock_actual)} {unidadDe(ing.stock_actual, ing.unidad)}</span>}
            {pierde && <span className="text-aviso-700">{pierde}</span>}
            {otras.length > 0 && (
              <span className="inline-flex items-center gap-1 text-aviso-700">
                también en
                {otras.map((o) => (
                  <button key={o.p.id} type="button" onClick={() => onSeleccionar(o.p.id)} className="inline-flex items-center gap-1 font-semibold hover:underline">
                    <span aria-hidden className="w-1.5 h-1.5 rounded-full" style={{ background: colorDe.get(o.p.id) }} />
                    {o.p.nombre}
                  </button>
                ))}
              </span>
            )}
          </span>
        </div>
      )
    }
    // Tocar la tarjeta la suelta (como en la cuadrícula); el botón de la
    // receta va adentro y no la suelta.
    const tarjeta = (
      <div
        onClick={() => onSeleccionar(null)}
        title="Soltar"
        className="vp-pulsable cursor-pointer w-full text-left rounded-2xl bg-neutral-900 text-white p-4 flex items-start gap-3"
      >
        <span aria-hidden className="w-1.5 self-stretch min-h-[36px] rounded-full shrink-0" style={{ background: color }} />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-start gap-2">
            <p className="font-display text-lg font-semibold tracking-tight leading-tight flex-1 min-w-0">{elegida.nombre}</p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onSeleccionar(null)
              }}
              aria-label="Soltar la preparación"
              className="shrink-0 -mt-1 -mr-1 w-7 h-7 rounded-full grid place-items-center text-white/60 hover:text-white hover:bg-white/10"
            >
              <Icono nombre="quitar" size={14} />
            </button>
          </div>
          <div>
            <p className="font-display text-2xl font-semibold tabular-nums leading-none">
              {elegida.modo_produccion === 'producir'
                ? `${fmtCant(elegida.stock_actual)} ${unidadDe(elegida.stock_actual, elegida.unidad)}`
                : d?.potencial != null
                  ? `${fmtCant(d.potencial)} ${unidadDe(d.potencial, elegida.unidad)}`
                  : '—'}
            </p>
            <p className="text-xs text-white/70 mt-1">
              {elegida.modo_produccion === 'producir'
                ? 'hay hecho ahora mismo'
                : d?.limita
                  ? `podrías hacer hoy con el crudo que hay · lo que se acaba primero: ${d.limita}`
                  : 'podrías hacer hoy con el crudo que hay'}
            </p>
            {elegida.modo_produccion !== 'producir' && d?.reparto_pct != null && d.limita && (
              <p className="text-xs text-white/70 mt-1">
                {/* El crudo compartido se reparte: los potenciales no se suman. */}
                Le toca el {fmtCant(d.reparto_pct)} % del {d.limita.toLowerCase()}{' '}
                {d.reparto_segun === 'ventas' ? 'según lo vendido en 14 días' : 'en partes iguales'} con {d.comparte_con.join(', ')}.
                {d.potencial_solo != null && ` Si fuera todo para este: ${fmtCant(d.potencial_solo)} ${unidadDe(d.potencial_solo, elegida.unidad)}.`}
              </p>
            )}
          </div>
          <p className="text-xs text-white/70">
            Cada {elegida.unidad === 'kg' ? 'kilo' : elegida.unidad === 'lt' ? 'litro' : 'unidad'} ya preparado cuesta{' '}
            <b className="text-white tabular-nums">{dinero(elegida.costo_unitario)}</b>
          </p>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onEditar(elegida)
            }}
            className="vp-pulsable inline-flex items-center gap-2 rounded-xl bg-white text-neutral-900 px-3 py-1.5 text-sm font-semibold"
          >
            <Icono nombre="recetas" size={15} />
            Ver la receta
          </button>
        </div>
      </div>
    )
    return (
      <div>
        {filtro}
        <Arbol
          className="lg:hidden"
          color={color}
          filas={lineas.map((l) => ({ clave: l.ingrediente_id, contenido: pastilla(l) }))}
          final={tarjeta}
        />
        <div className="hidden lg:grid lg:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)] items-start">
          <div>
            <p className="vp-etiqueta mb-2 flex items-center gap-1.5">
              <Icono nombre="paquete" size={12} /> Lo que lleva una tanda
            </p>
            <ul>
              {lineas.map((l) => (
                <li key={l.ingrediente_id} style={{ height: FILA }} className="flex items-center">
                  <div className="flex-1 min-w-0">{pastilla(l)}</div>
                </li>
              ))}
            </ul>
          </div>

          <svg width={ANCHO_LINEAS} height={alto + 28} className="hidden lg:block mt-[1.65rem]" aria-hidden>
            {lineas.map((l, i) => {
              const y1 = i * FILA + FILA / 2
              const peso = elegida.costo_tanda > 0 ? l.costo / elegida.costo_tanda : 1 / lineas.length
              const c = ANCHO_LINEAS * 0.45
              return (
                <path
                  key={l.ingrediente_id}
                  d={`M0 ${y1} C ${c} ${y1}, ${ANCHO_LINEAS - c} ${yCentro}, ${ANCHO_LINEAS} ${yCentro}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={Math.max(2, Math.min(14, 2 + peso * 14))}
                  strokeLinecap="round"
                  opacity={0.85}
                />
              )
            })}
          </svg>

          <div className="hidden lg:flex flex-col" style={{ minHeight: alto + 28 }}>
            <p className="vp-etiqueta mb-2 flex items-center gap-1.5">
              <Icono nombre="cocina" size={12} /> Lo que sale
            </p>
            <div className="flex-1 flex items-center">{tarjeta}</div>
          </div>
        </div>
      </div>
    )
  }

  // ── Muchas preparaciones sin elegir: cada crudo con quiénes lo llevan ──
  if (preps.length > MAXIMO_MAPA_COMPLETO) {
    const crudos = [...usosDe.entries()].map(([id, u]) => ({ id, ...u })).sort((a, b) => b.preps.length - a.preps.length || a.nombre.localeCompare(b.nombre))
    return (
      <div>
        {filtro}
        <p className="text-xs text-neutral-500 mb-2">Elige una preparación arriba para ver su crudo. Aquí, cada materia prima con las preparaciones que la llevan.</p>
        <ul className="divide-y divide-neutral-500/10">
          {crudos.map((c) => {
            const ing = porId.get(c.id)
            return (
              <li key={c.id} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="flex items-center gap-2 min-w-[12rem]">
                  <PuntoTipo tipo={c.tipo} />
                  <span className="font-medium truncate">{c.nombre}</span>
                  {c.preps.length > 1 && <span className="text-[11px] font-semibold text-aviso-700">la comparten {c.preps.length}</span>}
                </span>
                <span className="text-xs text-neutral-500 tabular-nums">{ing ? `hay ${fmtCant(ing.stock_actual)} ${unidadDe(ing.stock_actual, ing.unidad)}` : ''}</span>
                <span className="flex flex-wrap gap-1 ml-auto">
                  {c.preps.map((x) => (
                    <button key={x.p.id} type="button" onClick={() => onSeleccionar(x.p.id)} className="vp-control inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs">
                      <span aria-hidden className="w-2 h-2 rounded-full" style={{ background: colorDe.get(x.p.id) }} />
                      {x.p.nombre}
                      <span className="text-neutral-500 tabular-nums">
                        {fmtCant(x.cantidad)} {unidadDe(x.cantidad, c.unidad)}
                      </span>
                    </button>
                  ))}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    )
  }

  // ── Pocas preparaciones: el mapa completo ──
  const crudos = [...usosDe.entries()]
    .map(([id, u]) => ({ id, ...u, ing: porId.get(id) }))
    .sort((a, b) => b.preps.length - a.preps.length || a.nombre.localeCompare(b.nombre))
  const filaDe = new Map(crudos.map((c, i) => [c.id, i]))
  const alto = Math.max(crudos.length, preps.length) * FILA
  const yDe = (i: number) => i * FILA + FILA / 2
  const lineas = preps.flatMap((p, j) =>
    p.lineas.map((l) => {
      const i = filaDe.get(l.ingrediente_id) ?? 0
      const peso = p.costo_tanda > 0 ? l.costo / p.costo_tanda : 1 / p.lineas.length
      return { clave: `${p.id}-${l.ingrediente_id}`, prep: p.id, y1: yDe(i), y2: yDe(j), peso, color: colorDe.get(p.id) ?? '#999' }
    }),
  )
  const enResaltada = (ingId: number) => resaltada !== null && preps.find((p) => p.id === resaltada)?.lineas.some((l) => l.ingrediente_id === ingId)

  return (
    <div>
      {filtro}
      {/* Teléfono y tablet: un árbol por preparación, su crudo arriba y ella abajo. */}
      <div className="lg:hidden grid gap-x-6 gap-y-5 sm:grid-cols-2">
        {preps.map((p) => {
          const d = disp.find((x) => x.preparacion_id === p.id)
          const color = colorDe.get(p.id) ?? '#999'
          return (
            <Arbol
              key={p.id}
              color={color}
              filas={[...p.lineas]
                .sort((a, b) => b.costo - a.costo)
                .map((l) => {
                  const compartida = (usosDe.get(l.ingrediente_id)?.preps.length ?? 0) > 1
                  return {
                    clave: l.ingrediente_id,
                    contenido: (
                      <div className={`min-w-0 rounded-xl px-3 py-1.5 flex items-center gap-2 text-sm ${compartida ? 'bg-aviso-500/10' : 'bg-neutral-500/6'}`}>
                        <PuntoTipo tipo={l.tipo} />
                        <span className="font-medium truncate flex-1">{l.nombre}</span>
                        <span className="tabular-nums text-neutral-600 shrink-0">
                          {fmtCant(l.cantidad)} {unidadDe(l.cantidad, l.unidad)}
                        </span>
                      </div>
                    ),
                  }
                })}
              final={
                <button
                  type="button"
                  onClick={() => onSeleccionar(p.id)}
                  className="vp-pulsable w-full min-w-0 text-left rounded-xl px-3 py-2 bg-neutral-500/10 flex items-center gap-3"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-display font-semibold truncate">{p.nombre}</span>
                    <span className="block text-xs text-neutral-500 tabular-nums">
                      {p.modo_produccion === 'producir'
                        ? `hay ${fmtCant(p.stock_actual)} ${unidadDe(p.stock_actual, p.unidad)} hecho`
                        : d?.potencial != null
                          ? `podrías hacer ${fmtCant(d.potencial)} ${unidadDe(d.potencial, p.unidad)} hoy`
                          : `receta por ${p.unidad === 'kg' ? 'kilo' : p.unidad === 'lt' ? 'litro' : 'unidad'}`}
                    </span>
                  </span>
                  <span aria-hidden className="text-neutral-400 text-lg leading-none shrink-0">›</span>
                </button>
              }
            />
          )
        })}
      </div>
      <div className="hidden lg:grid lg:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)] gap-0 items-start" onMouseLeave={() => onResaltar(null)}>
        <div>
          <p className="vp-etiqueta mb-2 flex items-center gap-1.5">
            <Icono nombre="paquete" size={12} /> Crudo
          </p>
          <ul>
            {crudos.map((c) => {
              const apagada = resaltada !== null && !enResaltada(c.id)
              const pierde = pierdeAlCocinar(c.ing)
              return (
                <li key={c.id} style={{ height: FILA }} className={`flex items-center transition-opacity ${apagada ? 'opacity-30' : ''}`}>
                  <div className={`flex-1 min-w-0 rounded-2xl px-3 py-1.5 ${c.preps.length > 1 ? 'bg-aviso-500/10' : 'bg-neutral-500/6'}`}>
                    <span className="flex items-center gap-2">
                      <PuntoTipo tipo={c.tipo} />
                      <span className="font-medium truncate flex-1">{c.nombre}</span>
                      {c.preps.length > 1 && <span className="text-[11px] font-semibold text-aviso-700 shrink-0">la comparten {c.preps.length}</span>}
                    </span>
                    <span className="block text-xs text-neutral-500 pl-4 tabular-nums truncate">
                      {c.ing ? `hay ${fmtCant(c.ing.stock_actual)} ${unidadDe(c.ing.stock_actual, c.ing.unidad)}` : '—'}
                      {pierde && <span className="text-aviso-700"> · {pierde}</span>}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>

        <svg width={ANCHO_LINEAS} height={alto + 28} className="hidden lg:block mt-[1.65rem]" aria-hidden>
          {lineas.map((l) => {
            const apagada = resaltada !== null && l.prep !== resaltada
            const c = ANCHO_LINEAS * 0.45
            return (
              <path
                key={l.clave}
                d={`M0 ${l.y1} C ${c} ${l.y1}, ${ANCHO_LINEAS - c} ${l.y2}, ${ANCHO_LINEAS} ${l.y2}`}
                fill="none"
                stroke={l.color}
                strokeWidth={Math.max(2, Math.min(12, 2 + l.peso * 12))}
                strokeLinecap="round"
                opacity={apagada ? 0.12 : resaltada !== null ? 0.95 : 0.6}
                className="transition-opacity duration-200"
              />
            )
          })}
        </svg>

        <div>
          <p className="vp-etiqueta mb-2 flex items-center gap-1.5">
            <Icono nombre="cocina" size={12} /> Preparado
          </p>
          <ul>
            {preps.map((p) => {
              const d = disp.find((x) => x.preparacion_id === p.id)
              const apagada = resaltada !== null && resaltada !== p.id
              return (
                <li key={p.id} style={{ height: FILA }} className={`flex items-center transition-opacity ${apagada ? 'opacity-30' : ''}`}>
                  <button
                    type="button"
                    onMouseEnter={() => onResaltar(p.id)}
                    onClick={() => onSeleccionar(seleccion === p.id ? null : p.id)}
                    className="vp-pulsable flex-1 min-w-0 text-left rounded-2xl px-3 py-1.5 bg-neutral-500/6 flex items-center gap-3"
                  >
                    <span aria-hidden className="w-1.5 self-stretch min-h-[28px] rounded-full shrink-0" style={{ background: colorDe.get(p.id) }} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium truncate">{p.nombre}</span>
                      <span className="block text-xs text-neutral-500 tabular-nums truncate">
                        {p.modo_produccion === 'producir'
                          ? `hay ${fmtCant(p.stock_actual)} ${unidadDe(p.stock_actual, p.unidad)} hecho`
                          : d?.potencial != null
                            ? `podrías hacer ${fmtCant(d.potencial)} ${unidadDe(d.potencial, p.unidad)} hoy`
                            : `receta por ${p.unidad === 'kg' ? 'kilo' : p.unidad === 'lt' ? 'litro' : 'unidad'}`}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}

/**
 * El flujo en pantalla angosta (teléfono, tablet parada), donde no caben las
 * tres columnas con las curvas: el crudo arriba, una línea del color de la
 * preparación que lo junta, y abajo, con su flecha, lo que sale. Sin SVG de
 * alto fijo: cada renglón dibuja su tramo, así aguanta textos de dos líneas.
 */
function Arbol({
  color,
  filas,
  final,
  className = '',
}: {
  color: string
  filas: { clave: number; contenido: ReactNode }[]
  final: ReactNode
  className?: string
}) {
  // El riel va a 9 px del borde; los renglones empiezan a 28 px (pl-7).
  const riel = 'absolute left-[9px] w-[3px] rounded-full'
  return (
    <ul className={`space-y-1.5 ${className}`}>
      {filas.map((f, i) => (
        <li key={f.clave} className="relative pl-7">
          <span aria-hidden className={riel} style={{ background: color, top: i === 0 ? '50%' : -6, bottom: -6 }} />
          <span aria-hidden className="absolute left-[9px] top-1/2 -mt-[1.5px] w-[19px] h-[3px] rounded-full" style={{ background: color }} />
          {f.contenido}
        </li>
      ))}
      <li className="relative pl-7">
        {filas.length > 0 && <span aria-hidden className={riel} style={{ background: color, top: -6, height: 'calc(50% + 6px)' }} />}
        <svg aria-hidden width="19" height="14" viewBox="0 0 19 14" className="absolute left-[9px] top-1/2 -mt-[7px]">
          <path d="M1.5 7H15M10.5 2.5 15.5 7l-5 4.5" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {final}
      </li>
    </ul>
  )
}

// ── Las tarjetas ────────────────────────────────────────────────────────────

/**
 * Una preparación en una tarjeta: UN número grande (cuánto podrías hacer
 * hoy), con su frase; lo que lleva,
 * sin cifras de plata; y el botón de la receta a la vista.
 */
function TarjetaPreparacion({
  p,
  d,
  color,
  resaltada,
  onResaltar,
  onSeleccionar,
  dinero,
  onEditar,
  onTanda,
  onSobro,
}: {
  p: Preparacion
  d?: Disponibilidad
  color: string
  resaltada: boolean
  onResaltar: (id: number | null) => void
  onSeleccionar: () => void
  dinero: (n: number) => string
  onEditar: () => void
  onTanda: () => void
  onSobro: () => void
}) {
  const produce = p.modo_produccion === 'producir'
  const potencial = d?.potencial ?? null
  const desvio = p.rendimiento_real != null && Math.abs(p.rendimiento_real - 1) > 0.05
  const unidadLarga = p.unidad === 'kg' ? 'kilo' : p.unidad === 'lt' ? 'litro' : 'unidad'
  return (
    <div
      onMouseEnter={() => onResaltar(p.id)}
      onMouseLeave={() => onResaltar(null)}
      className={`vp-losa p-3.5 flex flex-col gap-3 transition-shadow ${resaltada ? 'ring-2' : ''}`}
      style={resaltada ? { ['--tw-ring-color' as string]: color } : undefined}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden className="w-1.5 self-stretch min-h-[36px] rounded-full shrink-0" style={{ background: color }} />
        <button type="button" onClick={onSeleccionar} className="min-w-0 flex-1 text-left" title="Verla en el mapa">
          <h3 className="font-display text-lg font-semibold tracking-tight leading-tight truncate">{p.nombre}</h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            {produce ? 'La cocina anota cada tanda' : 'Se descuenta del crudo al vender'} · cada {unidadLarga} cuesta {dinero(p.costo_unitario)}
          </p>
        </button>
      </div>

      <div className="rounded-2xl bg-neutral-500/6 px-3.5 py-2.5">
        <p className="font-display text-2xl font-semibold tracking-tight tabular-nums leading-none">
          {produce ? `${fmtCant(p.stock_actual)} ${unidadDe(p.stock_actual, p.unidad)}` : potencial == null ? '—' : `${fmtCant(potencial)} ${unidadDe(potencial, p.unidad)}`}
        </p>
        <p className="text-xs text-neutral-600 mt-1 leading-snug">
          {produce
            ? potencial != null
              ? `hay hecho ahora mismo; con el crudo se podrían hacer ${fmtCant(potencial)} ${unidadDe(potencial, p.unidad)} más`
              : 'hay hecho ahora mismo'
            : d?.limita
              ? `podrías hacer hoy con el crudo que hay. Lo que se acaba primero: ${d.limita}${d.comparte_con.length > 0 ? `, que también usa ${d.comparte_con.join(' y ')}` : ''}`
              : 'podrías hacer hoy con el crudo que hay'}
        </p>
      </div>

      <ul className="text-xs text-neutral-600 space-y-1">
        {p.lineas.slice(0, 3).map((l) => (
          <li key={l.ingrediente_id} className="flex items-center gap-2">
            <PuntoTipo tipo={l.tipo} />
            <span className="truncate flex-1">{l.nombre}</span>
            <span className="tabular-nums text-neutral-500 shrink-0">
              {fmtCant(l.cantidad)} {unidadDe(l.cantidad, l.unidad)}
            </span>
          </li>
        ))}
        {p.lineas.length > 3 && <li className="text-neutral-400 pl-4">y {p.lineas.length - 3} más</li>}
      </ul>

      {desvio && (
        <p className="text-xs text-aviso-800 rounded-xl bg-aviso-500/10 px-3 py-2">
          Las últimas {p.tandas} tandas rindieron {Math.round(p.rendimiento_real! * 100)} % de lo que dice la receta.
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2">
        <button type="button" onClick={onEditar} className="vp-pulsable inline-flex items-center gap-2 rounded-xl bg-neutral-900 text-white px-3 py-1.5 text-sm font-semibold">
          <Icono nombre="recetas" size={15} />
          Ver la receta
        </button>
        <button type="button" onClick={onSobro} className="vp-control vp-pulsable rounded-xl px-3 py-1.5 text-sm font-medium">
          Sobró hoy
        </button>
        {produce && (
          <button type="button" onClick={onTanda} className="vp-control vp-pulsable rounded-xl px-3 py-1.5 text-sm font-medium">
            Anotar tanda
          </button>
        )}
      </div>
    </div>
  )
}

// ── Sobró hoy ───────────────────────────────────────────────────────────────

/**
 * El cierre del preparado: sobró guiso. Guardarlo no mueve nada (mañana se
 * vende y se descuenta el crudo ahí). Botarlo saca el crudo por la receta y
 * queda como pérdida: si no, la carne de ese guiso nunca sale del sistema.
 */
function SobroHoy({ p, onCerrar, onHecho }: { p: Preparacion; onCerrar: () => void; onHecho: (mensaje: string) => void }) {
  const { fmt: dinero } = useMoneda()
  const [cantidad, setCantidad] = useState(p.modo_produccion === 'producir' && p.stock_actual > 0 ? String(p.stock_actual) : '')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const n = aNum(cantidad)
  const valor = n > 0 ? n * p.costo_unitario : 0

  async function decidir(accion: 'botar' | 'guardar') {
    setError('')
    if (!(n > 0)) return setError('¿Cuánto sobró?')
    setOcupado(true)
    try {
      const r = await api.sobrantePreparacion(p.id, { cantidad: n, accion })
      onHecho(
        accion === 'guardar'
          ? `${fmtCant(n)} ${unidadDe(n, p.unidad)} de ${p.nombre} se guardan para mañana. No se mueve nada: al venderse se descuenta el crudo.`
          : `Se botaron ${fmtCant(n)} ${unidadDe(n, p.unidad)} de ${p.nombre}: ${dinero(r.valor ?? valor)} de pérdida, descontados del crudo.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo anotar')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <Modal titulo={`Sobró ${p.nombre}`} ayuda="Al cierre. Lo que diga la olla manda." onCerrar={onCerrar} ancho="sm">
      <div className="space-y-4 text-sm">
        <label className="block">
          <span className={rotulo}>Cuánto sobró ({p.unidad})</span>
          <Numerico value={cantidad} onChange={(e) => setCantidad(e.target.value)} autoFocus placeholder="0" className={`${clase} text-lg font-semibold`} />
          {valor > 0 && <span className="block text-xs text-neutral-500 mt-1">Vale unos {dinero(valor)} en materia prima.</span>}
        </label>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={ocupado} onClick={() => void decidir('guardar')} className="vp-pulsable rounded-2xl bg-neutral-900 text-white p-3.5 text-left disabled:opacity-50">
            <span className="block font-semibold">Lo guardo</span>
            <span className="block text-xs text-white/70 mt-0.5">para mañana · no se mueve nada</span>
          </button>
          <button type="button" disabled={ocupado} onClick={() => void decidir('botar')} className="vp-pulsable rounded-2xl bg-peligro-500/10 text-peligro-700 p-3.5 text-left disabled:opacity-50">
            <span className="block font-semibold">Lo boto</span>
            <span className="block text-xs opacity-80 mt-0.5">queda como pérdida · sale el crudo</span>
          </button>
        </div>
        {error && <p className="text-peligro-600">{error}</p>}
      </div>
    </Modal>
  )
}

// ── La olla: el editor de la receta ─────────────────────────────────────────

const aNum = (t: string) => Number(String(t).replace(',', '.'))
const fmtCant = (n: number) => n.toLocaleString('es-VE', { maximumFractionDigits: 2 })
const sinRuido = (n: number) => String(Math.round(n * 1e6) / 1e6)
const clase = 'w-full border border-neutral-300 rounded-xl px-3 py-2 text-sm bg-white'
const rotulo = 'block text-xs font-medium text-neutral-600 mb-1'
const OTRA_UNIDAD: Record<string, string> = { kg: 'g', g: 'kg', lt: 'ml', ml: 'lt' }
const esGrande = (u: string) => u === 'kg' || u === 'lt'
/** "1 kg", "500 g", "2 unidades": lo que entra, en la medida que mejor se lee. */
const cantidadLegible = (n: number, u: string) =>
  esGrande(u) && n > 0 && n < 1 ? `${fmtCant(n * 1000)} ${OTRA_UNIDAD[u]}` : `${fmtCant(n)} ${unidadDe(n, u)}`

type Fila = {
  ingrediente_id: number
  /** Lo que entra, crudo, en la unidad de la ficha. */
  cantidad: string
  /** Lo que se aprovecha de ese crudo al cocinarlo (%). Es de la FICHA del
      crudo (el pollo pierde lo mismo en cualquier guiso) y se guarda ahí. */
  aprovechable: string
  enChica?: boolean
}

// Que mide cada unidad y cuanto vale en la grande (1 g = 0,001 kg). Igual
// que `_MEDIDA` en models.py: lo que se ve aquí es lo que guarda el servidor.
const MEDIDA: Record<string, [string, number]> = { kg: ['peso', 1], g: ['peso', 0.001], lt: ['volumen', 1], ml: ['volumen', 0.001] }
const mismaMedida = (a: string, b: string) => a === b || (!!MEDIDA[a] && !!MEDIDA[b] && MEDIDA[a][0] === MEDIDA[b][0])
const aLaGrande = (u: string) => MEDIDA[u]?.[1] ?? 1

/**
 * Misma forma que la receta del menú: a la izquierda el recipiente que se
 * llena con lo que lleva; a la derecha "Lleva" y "Agregar". Cabe en la
 * pantalla sin desplazar la página, como la receta.
 *
 * LA RECETA ES POR UNO (Leider, 8-oct): lo que lleva 1 kg de guiso (o 1 lt
 * de jugo, o 1 unidad). Así lo que cuesta el kilo es la suma de lo que
 * lleva, sin tandas de por medio, y para hacer 2 kg el sistema multiplica.
 *
 * LA MERMA VA EN EL CRUDO, NO EN LO PREPARADO (Leider, 7-oct): a cada
 * ingrediente se le dice cuánto entra y cuánto se aprovecha al cocinarlo
 * ("1 kg de pollo, queda el 70 %"). Con eso la olla comprueba que lo que
 * queda sume el kilo: si la cocina escribió su tanda de siempre (1 kg de
 * pollo y una crema, que dan 0,7 kg), un toque la ajusta al kilo. El
 * porcentaje es de la ficha del crudo y se guarda ahí.
 */
function Olla({
  prep,
  ingredientes,
  onCerrar,
  onGuardada,
}: {
  prep: Preparacion | null
  ingredientes: Ingrediente[]
  onCerrar: () => void
  onGuardada: () => void
}) {
  const { fmt: dinero } = useMoneda()
  const [nombre, setNombre] = useState(prep?.nombre ?? '')
  const [unidad, setUnidad] = useState(prep?.unidad ?? 'kg')
  const porId = useMemo(() => new Map(ingredientes.map((i) => [i.id, i])), [ingredientes])
  const [filas, setFilas] = useState<Fila[]>(() =>
    prep
      ? prep.lineas.map((l) => ({
          ingrediente_id: l.ingrediente_id,
          cantidad: String(l.cantidad),
          aprovechable: String(porId.get(l.ingrediente_id)?.rendimiento_pct ?? 100),
        }))
      : [],
  )
  const [busqueda, setBusqueda] = useState('')
  const [categoria, setCategoria] = useState('')
  const [resaltado, setResaltado] = useState<number | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const enReceta = new Set(filas.map((f) => f.ingrediente_id))
  const palabras = palabrasDe(busqueda)
  const disponibles = ingredientes
    .filter((i) => vaEnPreparacion(i) && i.id !== prep?.id && !enReceta.has(i.id))
    .filter((i) => !categoria || (i.categoria || '__sin__') === categoria)
    .filter((i) => palabras.length === 0 || contiene(`${i.nombre} ${i.categoria}`, palabras))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
  const categoriasDeposito = useMemo(() => {
    const cuenta = new Map<string, number>()
    for (const i of ingredientes) if (vaEnPreparacion(i)) cuenta.set(i.categoria || '', (cuenta.get(i.categoria || '') ?? 0) + 1)
    return [...cuenta.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([n, c]) => ({ valor: n || '__sin__', texto: n || 'Sin categoría', contador: c }))
  }, [ingredientes])

  // Lo que pesa cada cosa en la olla, por costo; y lo que queda de cada una.
  const partes = filas
    .map((f, i) => {
      const ing = porId.get(f.ingrediente_id)
      if (!ing) return null
      const cantidad = aNum(f.cantidad) || 0
      const pct = Math.min(Math.max(aNum(f.aprovechable) || 0, 0), 100)
      return {
        id: ing.id,
        nombre: ing.nombre,
        cantidad,
        unidad: ing.unidad,
        // En la medida de la preparacion: 500 g suman 0,5 kg a un guiso en kg.
        enSuMedida: mismaMedida(ing.unidad, unidad) ? cantidad * aLaGrande(ing.unidad) / aLaGrande(unidad) : null,
        queda: (mismaMedida(ing.unidad, unidad) ? cantidad * aLaGrande(ing.unidad) / aLaGrande(unidad) : 0) * (pct / 100),
        costo: cantidad * (ing.costo_unitario || 0),
        color: colorFranja(i),
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
  // Lo que cuesta 1 kg (o 1 lt, o 1 unidad): la receta es por uno.
  const costoTanda = partes.reduce((s, p) => s + p.costo, 0)
  const unidadLarga = unidad === 'kg' ? 'kilo' : unidad === 'lt' ? 'litro' : 'unidad'
  // Lo que queda de cada crudo medido como la preparación (kg con g, lt con
  // ml) debería sumar ese 1. Si suma 0,7 es que la cocina escribió su tanda
  // y no el kilo: se le ofrece ajustarla. Lo que se mide distinto (la leche
  // en un guiso) no se puede sumar y no estorba: cuenta en el costo igual.
  const enSuUnidad = partes.filter((p) => p.enSuMedida !== null)
  const queda = enSuUnidad.reduce((s, p) => s + p.queda, 0)
  const desajuste = enSuUnidad.length > 0 && queda > 0 && Math.abs(queda - 1) > 0.02

  function actualizar(id: number, cambios: Partial<Fila>) {
    setFilas((prev) => prev.map((f) => (f.ingrediente_id === id ? { ...f, ...cambios } : f)))
  }

  /** Todas las cantidades entre lo que queda: la tanda pasa a ser el kilo. */
  function ajustarAUno() {
    if (!(queda > 0)) return
    // A tres decimales: 1,429 kg se lee; 1,428571 no, y el costo no se entera.
    setFilas((prev) => prev.map((f) => ({ ...f, cantidad: f.cantidad === '' ? '' : sinRuido(Math.round(((aNum(f.cantidad) || 0) / queda) * 1000) / 1000) })))
  }

  async function guardar() {
    setError('')
    const limpias = filas.filter((f) => f.ingrediente_id && aNum(f.cantidad) > 0)
    if (!nombre.trim()) return setError('Ponle nombre a la preparación.')
    if (limpias.length === 0) return setError('Agrega al menos un ingrediente con su cantidad.')
    setGuardando(true)
    try {
      // El % que se aprovecha es del crudo: si cambió, se guarda en su ficha.
      for (const f of limpias) {
        const ing = porId.get(f.ingrediente_id)
        const pct = Math.min(Math.max(aNum(f.aprovechable) || 100, 1), 100)
        if (ing && ing.tipo !== 'preparacion' && Math.abs(pct - ing.rendimiento_pct) > 0.001) {
          await api.actualizarIngrediente(ing.id, { ...datosDe(ing), rendimiento_pct: pct })
        }
      }
      const datos: DatosPreparacion = {
        nombre: nombre.trim(),
        unidad,
        // La receta es por uno: lo que rinde es, por definición, 1.
        rinde: 1,
        modo_produccion: prep?.modo_produccion ?? 'descontar',
        vida_util_horas: prep?.vida_util_horas ?? null,
        lineas: limpias.map((l) => ({ ingrediente_id: l.ingrediente_id, cantidad: aNum(l.cantidad) })),
      }
      if (prep) await api.actualizarPreparacion(prep.id, datos)
      else await api.crearPreparacion(datos)
      onGuardada()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="space-y-3 lg:h-[calc(100dvh-15.5rem)] lg:flex lg:flex-col">
      <div className="flex items-center justify-between gap-3 flex-wrap shrink-0">
        <button type="button" onClick={onCerrar} className="text-sm text-neutral-500 hover:text-neutral-900">
          ← Preparado
        </button>
        <div className="flex items-center gap-2">
          <Boton tono="fantasma" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton onClick={() => void guardar()} disabled={guardando}>
            {guardando ? 'Guardando…' : prep ? 'Guardar receta' : 'Crear preparación'}
          </Boton>
        </div>
      </div>
      {error && <p className="text-peligro-600 text-sm shrink-0">{error}</p>}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start lg:items-stretch lg:flex-1 lg:min-h-0">
        {/* ── La olla ──────────────────────────────────────────────── */}
        <section className="vp-losa p-4 sm:p-5 lg:flex lg:flex-col lg:min-h-0">
          <div className="flex items-start gap-2 shrink-0">
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="¿Cómo se llama? Ej. Guiso de pollo"
              aria-label="Nombre de la preparación"
              autoFocus={!prep}
              className="flex-1 min-w-0 !border-0 !bg-transparent !rounded-none !px-0 !py-0 font-display text-xl font-semibold tracking-tight placeholder:font-normal placeholder:text-neutral-400 outline-none"
            />
            <select value={unidad} onChange={(e) => setUnidad(e.target.value)} aria-label="Se mide en" className="shrink-0 border border-neutral-300 rounded-xl px-2.5 py-1.5 text-sm">
              <option value="kg">kg</option>
              <option value="lt">litro</option>
              <option value="unidad">unidad</option>
            </select>
          </div>
          <p className="text-xs text-neutral-500 mt-1 shrink-0">Lo que lleva 1 {unidadLarga} ya hecho. Para hacer más, el sistema multiplica.</p>

          <div className="lg:flex-1 lg:min-h-0 flex justify-center mt-3">
            <DibujoOlla
              partes={partes.map((p) => ({ id: p.id, nombre: p.nombre, detalle: p.cantidad > 0 ? cantidadLegible(p.cantidad, p.unidad) : '', valor: p.costo, color: p.color }))}
              total={costoTanda}
              unidad={unidad}
              formato={dinero}
              resaltado={resaltado}
              onResaltar={setResaltado}
              className="w-full max-w-[230px] sm:max-w-[250px] lg:w-auto lg:max-w-none lg:h-full lg:min-h-0"
            />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 shrink-0">
            {/* Lo que queda ya cocido tiene que dar el kilo. Si no, un toque
                pasa la tanda que escribió la cocina a la receta por kilo. */}
            <div className={`rounded-xl px-3 py-2 ${desajuste ? 'bg-aviso-500/10' : 'bg-neutral-500/6'}`}>
              <span className={`text-[11px] ${desajuste ? 'text-aviso-800 font-medium' : 'text-neutral-500'}`}>Queda cocido</span>
              <span className="block font-display text-lg font-semibold tabular-nums leading-tight">
                {enSuUnidad.length > 0 && queda > 0 ? `${fmtCant(queda)} ${unidadDe(queda, unidad)}` : '—'}
              </span>
              {desajuste ? (
                <button type="button" onClick={ajustarAUno} className="block text-[11px] font-semibold text-aviso-800 underline leading-tight">
                  Ajustar al {unidadLarga}
                </button>
              ) : (
                <span className="block text-[11px] text-neutral-500 leading-tight">
                  {enSuUnidad.length === 0 ? `nada se mide en ${unidad === 'unidad' ? 'unidades' : unidad}` : `debe dar 1 ${unidadLarga}`}
                </span>
              )}
            </div>
            <div className="rounded-xl bg-neutral-500/6 px-3 py-2">
              <span className="text-[11px] text-neutral-500">Cuesta</span>
              <span className="block font-display text-lg font-semibold tabular-nums leading-tight">
                {costoTanda > 0 ? dinero(costoTanda) : '—'}
                <span className="text-xs font-normal text-neutral-500"> el {unidad}</span>
              </span>
              <span className="block text-[11px] text-neutral-500 leading-tight">cada {unidadLarga} ya preparado</span>
            </div>
          </div>
        </section>

        {/* ── Lleva y Agregar ──────────────────────────────────────── */}
        <section className="space-y-3 lg:flex lg:flex-col lg:min-h-0">
          {filas.length > 0 && (
            <div className="vp-losa overflow-hidden lg:shrink lg:min-h-0 lg:max-h-[50%] lg:overflow-y-auto">
              <h3 className="px-4 pt-3 pb-2 font-display font-semibold tracking-tight">
                Lleva 1 {unidadLarga} <span className="hidden sm:inline text-sm font-normal text-neutral-500">· crudo, y lo que queda de cada uno</span>
              </h3>
              <div className="hidden sm:flex px-4 pb-1.5 items-center gap-3 border-b border-neutral-100 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                <span className="w-1.5 shrink-0" />
                <span className="min-w-0 flex-1">Mercancía</span>
                <span className="w-[8.75rem] shrink-0 text-right">Entra</span>
                <span className="w-[4.5rem] shrink-0 text-right">Queda</span>
                <span className="w-16 text-right">Costo</span>
                <span className="w-8 shrink-0" />
              </div>
              <ul className="divide-y divide-neutral-100">
                {filas.map((f, i) => {
                  const ing = porId.get(f.ingrediente_id)
                  if (!ing) return null
                  return (
                    <RenglonOlla
                      key={f.ingrediente_id}
                      f={f}
                      ing={ing}
                      color={colorFranja(i)}
                      resaltado={resaltado === ing.id}
                      onResaltar={setResaltado}
                      onCambio={(c) => actualizar(ing.id, c)}
                      onQuitar={() => setFilas((prev) => prev.filter((x) => x.ingrediente_id !== ing.id))}
                      dinero={dinero}
                    />
                  )
                })}
              </ul>
            </div>
          )}

          <div className="vp-losa overflow-hidden lg:flex-1 lg:min-h-0 lg:flex lg:flex-col">
            <div className="px-4 pt-3 pb-2 flex flex-wrap items-center gap-2 shrink-0">
              <h3 className="font-display font-semibold tracking-tight mr-auto">{filas.length === 0 ? 'Toca lo que lleva' : 'Agregar'}</h3>
              <div className="relative basis-full sm:basis-auto order-last sm:order-none">
                <input
                  type="search"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setBusqueda('')}
                  placeholder="Buscar materia prima"
                  aria-label="Buscar materia prima"
                  className="w-full sm:w-48 bg-white border border-neutral-300 rounded-xl pl-8 pr-3 py-1.5 text-sm"
                />
                <Icono nombre="buscar" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
              </div>
              {categoriasDeposito.length > 1 && (
                <FiltroDesplegable etiqueta="Categoría" valor={categoria} alCambiar={setCategoria} opciones={[{ valor: '', texto: 'Todas' }, ...categoriasDeposito]} />
              )}
            </div>
            {disponibles.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-neutral-400">{ingredientes.length === 0 ? 'No hay materia prima en el inventario todavía.' : 'Nada coincide.'}</p>
            ) : (
              <div className="max-h-[26rem] lg:max-h-none lg:flex-1 lg:min-h-0 overflow-y-auto">
                <div className="px-4 pb-1.5 flex items-center gap-3 border-b border-neutral-100 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  <span className="min-w-0 flex-1">Mercancía</span>
                  <span className="text-right">Hay · costo</span>
                  <span className="w-7 shrink-0" />
                </div>
                <ul className="divide-y divide-neutral-100">
                  {disponibles.map((ing) => (
                    <li key={ing.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setFilas((prev) => [
                            ...prev,
                            { ingrediente_id: ing.id, cantidad: '', aprovechable: String(ing.tipo === 'preparacion' ? 100 : ing.rendimiento_pct), enChica: esGrande(ing.unidad) },
                          ])
                        }
                        className="vp-celda w-full flex items-center gap-3 px-4 py-2.5 text-left"
                      >
                        <PuntoTipo tipo={ing.tipo} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm truncate">{ing.nombre}</span>
                          <span className="block text-[11px] text-neutral-400">
                            {ing.tipo === 'preparacion' ? 'preparación' : ing.categoria || ALMACEN_DE[ing.tipo].texto}
                            {ing.tipo !== 'preparacion' && ing.rendimiento_pct < 100 && ` · se aprovecha el ${Math.round(ing.rendimiento_pct)} %`}
                          </span>
                        </span>
                        <span className="text-xs text-neutral-500 tabular-nums text-right">
                          {fmtCant(ing.stock_actual)} {unidadDe(ing.stock_actual, ing.unidad)}
                          <span className="block">{dinero(ing.costo_unitario)} / {ing.unidad}</span>
                        </span>
                        <span className="w-7 h-7 grid place-items-center rounded-full bg-neutral-500/10 text-neutral-600 shrink-0">
                          <Icono nombre="mas" size={14} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

/** Un crudo de la receta: cuánto entra, qué % se aprovecha y cuánto queda. */
function RenglonOlla({
  f,
  ing,
  color,
  resaltado,
  onResaltar,
  onCambio,
  onQuitar,
  dinero,
}: {
  f: Fila
  ing: Ingrediente
  color: string
  resaltado: boolean
  onResaltar: (id: number | null) => void
  onCambio: (c: Partial<Fila>) => void
  onQuitar: () => void
  dinero: (n: number, d?: number) => string
}) {
  const otra = OTRA_UNIDAD[ing.unidad]
  const enChica = Boolean(otra && (f.enChica ?? esGrande(ing.unidad)))
  const factor = enChica ? (esGrande(ing.unidad) ? 1000 : 1 / 1000) : 1
  const unidadVista = enChica ? otra : ing.unidad
  const cantidad = aNum(f.cantidad) || 0
  const pct = Math.min(Math.max(aNum(f.aprovechable) || 0, 0), 100)
  const queda = cantidad * (pct / 100)
  const valorVisto = f.cantidad === '' ? '' : sinRuido(cantidad * factor)
  const costoU = ing.costo_unitario || 0
  const esPrep = ing.tipo === 'preparacion'
  const escribir = (texto: string) => {
    if (!enChica) return onCambio({ cantidad: texto })
    const n = aNum(texto)
    onCambio({ cantidad: texto === '' || !Number.isFinite(n) ? texto : sinRuido(n / factor) })
  }
  return (
    <li onMouseEnter={() => onResaltar(ing.id)} onMouseLeave={() => onResaltar(null)} className={`px-4 py-2.5 transition-colors ${resaltado ? 'bg-acento-500/10' : ''}`}>
      <div className="flex items-center gap-3">
        <span aria-hidden className="w-1.5 self-stretch min-h-[28px] rounded-full shrink-0" style={{ background: color }} />
        {/* Teléfono: el nombre arriba y, debajo, cuánto entra, cuánto queda y
            cuánto cuesta. Desde tablet, todo en una línea con sus columnas. */}
        <div className="min-w-0 flex-1 flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 basis-full sm:basis-auto sm:flex-1">
          <span className="block text-sm font-medium truncate">{ing.nombre}</span>
          <span className="block text-[11px] text-neutral-400">
            {dinero(costoU, 2)} por {ing.unidad} · hay {fmtCant(ing.stock_actual)} {unidadDe(ing.stock_actual, ing.unidad)}
          </span>
        </span>
        <CasillaConUnidad
          unidad={ing.unidad}
          vista={unidadVista}
          alCambiarVista={() => onCambio({ enChica: !enChica })}
          value={valorVisto}
          onChange={(e) => escribir(e.target.value)}
          placeholder="0"
          etiqueta={`${ing.nombre} (${unidadVista})`}
          aria-label={`Cantidad de ${ing.nombre} que entra, en ${unidadVista}`}
          autoFocus={f.cantidad === ''}
          className="flex-1 min-w-0 sm:flex-none sm:w-[8.75rem] sm:shrink-0"
          claseCasilla="border border-neutral-300 rounded-lg px-2 py-1.5 text-sm text-right tabular-nums"
        />
        <span className="w-16 sm:w-[4.5rem] shrink-0 text-right text-sm tabular-nums">
          {cantidad > 0 ? (
            <>
              <span className="block font-semibold">{enChica ? `${fmtCant(queda * factor)} ${otra}` : `${fmtCant(queda)} ${unidadDe(queda, ing.unidad)}`}</span>
              {!esPrep && (
                <span className="inline-flex items-center justify-end gap-0.5 text-[11px] text-neutral-500">
                  <Numerico
                    value={f.aprovechable}
                    onChange={(e) => onCambio({ aprovechable: e.target.value })}
                    aria-label={`Porcentaje de ${ing.nombre} que queda al cocinar`}
                    className="w-10 border-b border-neutral-300 bg-transparent !rounded-none !px-0 !py-0 text-right text-[11px] tabular-nums"
                  />
                  %
                </span>
              )}
            </>
          ) : (
            '—'
          )}
        </span>
        {/* En el teléfono el costo de cada cosa ya está en la olla: aquí no cabe. */}
        <span className="hidden sm:block w-16 shrink-0 text-right text-sm tabular-nums font-semibold">{cantidad > 0 ? dinero(cantidad * costoU) : '—'}</span>
        </div>
        <button type="button" onClick={onQuitar} aria-label={`Quitar ${ing.nombre}`} className="w-8 h-8 shrink-0 grid place-items-center rounded-lg text-neutral-400 hover:bg-peligro-500/10 hover:text-peligro-600">
          <Icono nombre="quitar" size={14} />
        </button>
      </div>
    </li>
  )
}

/**
 * La olla dibujada: una franja por ingrediente, proporcional a lo que pesa
 * en el costo de 1 kg (o 1 lt, o 1 unidad); arriba, ese "1". Sin margen,
 * porque una preparación no se vende: solo cuesta.
 */
function DibujoOlla({
  partes,
  total,
  unidad,
  formato,
  resaltado,
  onResaltar,
  className = '',
}: {
  /** `detalle`: cuánto entra de cada cosa ("1 kg", "500 g", "2 unidades"). */
  partes: { id: number; nombre: string; detalle: string; valor: number; color: string }[]
  total: number
  unidad: string
  formato: (n: number) => string
  resaltado: number | null
  onResaltar: (id: number | null) => void
  className?: string
}) {
  // Geometria (viewBox 260 x 400): boca en y=90, fondo en y=360.
  const BOCA = 90
  const FONDO = 360
  const ALTO = FONDO - BOCA
  const MINIMO = 30
  let alturas = partes.map((p) => (total > 0 ? Math.max((p.valor / total) * ALTO, MINIMO) : 0))
  const suma = alturas.reduce((t, h) => t + h, 0)
  if (suma > ALTO) alturas = alturas.map((h) => (h * ALTO) / suma)
  // De abajo hacia arriba: cada franja empieza donde termina la anterior.
  const franjas = partes.map((p, i) => {
    const h = alturas[i]
    const y = FONDO - alturas.slice(0, i + 1).reduce((t, x) => t + x, 0)
    return { ...p, y, h }
  })
  const vacia = partes.length === 0 || total <= 0
  const mostrada = franjas.find((f) => f.id === resaltado)
  return (
    <svg viewBox="0 0 260 400" className={className} role="img" aria-label={`Lo que lleva 1 ${unidad}, por lo que cuesta cada ingrediente`}>
      <defs>
        <clipPath id="olla-cuerpo">
          <path d="M40 90H220Q228 90 228 98V330Q228 360 198 360H62Q32 360 32 330V98Q32 90 40 90Z" />
        </clipPath>
      </defs>
      {/* Las asas */}
      <path d="M32 150H14Q6 150 6 158V190Q6 198 14 198H32" fill="none" stroke="var(--color-neutral-300)" strokeWidth="6" strokeLinecap="round" />
      <path d="M228 150H246Q254 150 254 158V190Q254 198 246 198H228" fill="none" stroke="var(--color-neutral-300)" strokeWidth="6" strokeLinecap="round" />
      {/* El cuerpo */}
      <path d="M40 90H220Q228 90 228 98V330Q228 360 198 360H62Q32 360 32 330V98Q32 90 40 90Z" fill="var(--color-neutral-100)" />
      <g clipPath="url(#olla-cuerpo)">
        {franjas.map((f) => (
          <g key={f.id} onMouseEnter={() => onResaltar(f.id)} onMouseLeave={() => onResaltar(null)} style={{ cursor: 'default' }}>
            <rect x="32" y={f.y} width="196" height={f.h} fill={f.color} opacity={resaltado !== null && resaltado !== f.id ? 0.45 : 1} />
            {/* El nombre y, debajo, cuánto entra; si la franja es baja, en
                una sola línea. El precio va a la derecha. */}
            {f.h >= 40 ? (
              <text x="44" y={f.y + f.h / 2 - 3} fontSize="11" fontWeight="600" fill="#fff" style={{ paintOrder: 'stroke', stroke: 'rgb(0 0 0 / 0.25)', strokeWidth: 2 }}>
                {f.nombre.length > 22 ? `${f.nombre.slice(0, 21)}…` : f.nombre}
                {f.detalle && (
                  <tspan x="44" dy="14" fontSize="10" fontWeight="500" opacity={0.9}>
                    {f.detalle}
                  </tspan>
                )}
              </text>
            ) : (
              f.h >= 26 && (
                <text x="44" y={f.y + f.h / 2 + 4} fontSize="11" fontWeight="600" fill="#fff" style={{ paintOrder: 'stroke', stroke: 'rgb(0 0 0 / 0.25)', strokeWidth: 2 }}>
                  {(() => {
                    const t = f.detalle ? `${f.nombre} · ${f.detalle}` : f.nombre
                    return t.length > 24 ? `${t.slice(0, 23)}…` : t
                  })()}
                </text>
              )
            )}
            {f.h >= 26 && (
              <text x="216" y={f.y + f.h / 2 + 4} fontSize="11" fontWeight="600" fill="#fff" textAnchor="end" style={{ paintOrder: 'stroke', stroke: 'rgb(0 0 0 / 0.25)', strokeWidth: 2 }}>
                {formato(f.valor)}
              </text>
            )}
          </g>
        ))}
      </g>
      <path d="M40 90H220Q228 90 228 98V330Q228 360 198 360H62Q32 360 32 330V98Q32 90 40 90Z" fill="none" stroke="var(--color-neutral-300)" strokeWidth="2" />
      {/* La tapa: la receta es para 1 */}
      <rect x="26" y="78" width="208" height="12" rx="6" fill="var(--color-neutral-300)" />
      <text x="130" y="40" textAnchor="middle" fontSize="12" fill="var(--color-neutral-500)">
        para
      </text>
      <text x="130" y="68" textAnchor="middle" fontSize="24" fontWeight="700" fill="var(--color-neutral-900)" style={{ fontFamily: 'var(--font-display)' }}>
        {`1 ${unidad}`}
      </text>
      {vacia && (
        <text x="130" y="230" textAnchor="middle" fontSize="12" fill="var(--color-neutral-400)">
          Toca a la derecha lo que lleva
        </text>
      )}
      {!vacia && (
        <text x="130" y="385" textAnchor="middle" fontSize="12" fill="var(--color-neutral-500)">
          {mostrada ? `${mostrada.nombre}: el ${total > 0 ? Math.round((mostrada.valor / total) * 100) : 0} % del costo` : `1 ${unidad} cuesta ${formato(total)}`}
        </text>
      )}
    </svg>
  )
}

// ── Anotar tanda ────────────────────────────────────────────────────────────

/**
 * Una tanda: lo que salió, y (opcional) lo que se usó. Lo usado viene
 * propuesto con la receta (que es por 1) multiplicada por lo que salió; si la
 * cocina usó otra cantidad la corrige, y de ahí sale el rendimiento real.
 */
function AnotarTanda({
  inicial,
  producibles,
  ingredientes,
  onCerrar,
  onHecho,
}: {
  inicial: Preparacion
  producibles: Preparacion[]
  ingredientes: Ingrediente[]
  onCerrar: () => void
  onHecho: () => void
}) {
  const [prepId, setPrepId] = useState(inicial.id)
  const prep = producibles.find((p) => p.id === prepId) ?? inicial
  const [salio, setSalio] = useState('')
  // Solo lo que la cocina corrigió; lo demás se propone desde la receta.
  const [usado, setUsado] = useState<Record<number, string>>({})
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const porId = useMemo(() => new Map(ingredientes.map((i) => [i.id, i])), [ingredientes])

  function elegir(id: number) {
    const p = producibles.find((x) => x.id === id)
    if (!p) return
    setPrepId(id)
    setSalio('')
    setUsado({})
  }

  const salioNum = aNum(salio)
  const usadoDe = (l: Preparacion['lineas'][number]) => usado[l.ingrediente_id] ?? (salioNum > 0 ? sinRuido(l.cantidad * salioNum) : '')
  const principal = [...prep.lineas].sort((a, b) => b.costo - a.costo)[0]
  const esperado = principal && principal.cantidad > 0 ? aNum(usadoDe(principal) || '0') / principal.cantidad : 0
  const rendimiento = esperado > 0 && salioNum > 0 ? salioNum / esperado : null

  // Si no alcanza el crudo, el servidor avisa; la segunda vez va confirmada.
  const [confirmarFalta, setConfirmarFalta] = useState('')
  async function guardar() {
    setError('')
    if (!(salioNum > 0)) return setError('Di cuánto salió.')
    setGuardando(true)
    try {
      await api.registrarProduccion({
        preparacion_id: prep.id,
        cantidad: salioNum,
        usado: prep.lineas.map((l) => ({ ingrediente_id: l.ingrediente_id, cantidad: aNum(usadoDe(l) || '0') || 0 })),
        forzar: !!confirmarFalta,
      })
      onHecho()
    } catch (e) {
      if (e instanceof ErrorApi && e.status === 409 && e.message.startsWith('No alcanza')) {
        setConfirmarFalta(e.message)
        setError(`${e.message} Si de verdad se usó eso, vuelve a tocar «Anotar» y queda en negativo hasta el próximo conteo.`)
        return
      }
      setError(e instanceof Error ? e.message : 'No se pudo anotar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      titulo="Anotar tanda"
      onCerrar={onCerrar}
      ancho="sm"
      pie={
        <>
          <Boton tono="suave" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton onClick={() => void guardar()} disabled={guardando}>
            {guardando ? 'Anotando…' : 'Anotar'}
          </Boton>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {producibles.length > 1 && (
          <label className="block">
            <span className={rotulo}>Qué se hizo</span>
            <select value={prepId} onChange={(e) => elegir(Number(e.target.value))} className={clase}>
              {producibles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className={rotulo}>Cuánto salió ({prep.unidad})</span>
          <Numerico value={salio} onChange={(e) => setSalio(e.target.value)} autoFocus className={`${clase} text-lg font-semibold`} />
        </label>
        <div>
          <span className={rotulo}>Lo que se usó</span>
          <ul className="space-y-1.5">
            {prep.lineas.map((l) => (
              <li key={l.ingrediente_id} className="flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate">{l.nombre}</span>
                <Numerico value={usadoDe(l)} onChange={(e) => setUsado((u) => ({ ...u, [l.ingrediente_id]: e.target.value }))} className={`${clase} w-24`} />
                <span className="w-12 text-xs text-neutral-500">{porId.get(l.ingrediente_id)?.unidad ?? l.unidad}</span>
              </li>
            ))}
          </ul>
        </div>
        {rendimiento != null && (
          <p className={`rounded-xl px-3 py-2 ${Math.abs(rendimiento - 1) > 0.05 ? 'bg-aviso-500/10 text-aviso-800' : 'bg-neutral-500/6 text-neutral-700'}`}>
            Con eso la receta esperaba {fmtCant(esperado)} {unidadDe(esperado, prep.unidad)}: rindió {Math.round(rendimiento * 100)} %.
          </p>
        )}
        {error && <p className="text-peligro-600">{error}</p>}
      </div>
    </Modal>
  )
}
