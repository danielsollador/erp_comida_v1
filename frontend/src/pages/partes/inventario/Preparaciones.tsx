import { useCallback, useEffect, useMemo, useState } from 'react'
import { CasillaConUnidad } from '../../../components/Cantidad'
import { PuntoTipo } from '../../../components/compras/Almacenes'
import Icono from '../../../components/Icono'
import { Numerico } from '../../../components/Teclado'
import { contiene, palabrasDe } from '../../../components/Tabla'
import { useDialogo } from '../../../components/dialogo'
import { Boton, FiltroDesplegable, Modal, Seccion, Vacio } from '../../../components/ui'
import { api } from '../../../lib/api'
import { useMoneda } from '../../../lib/moneda'
import { colorFranja } from '../../../lib/paleta'
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
 *    olla se llena con lo que lleva la tanda y arriba dice cuánto rinde.
 */
export default function Preparaciones({
  ingredientes,
  onCambio,
}: {
  ingredientes: Ingrediente[]
  /** Algo movió el depósito (una tanda, una merma): que se recargue. */
  onCambio: () => void
}) {
  const { fmt: dinero } = useMoneda()
  const [preps, setPreps] = useState<Preparacion[] | null>(null)
  const [disp, setDisp] = useState<Disponibilidad[]>([])
  const [vencidas, setVencidas] = useState<Preparacion[]>([])
  const [tandas, setTandas] = useState<Produccion[]>([])
  const [editando, setEditando] = useState<Preparacion | 'nueva' | null>(null)
  const [anotando, setAnotando] = useState<Preparacion | null>(null)
  const [sobro, setSobro] = useState<Preparacion | null>(null)
  // La que se eligió con un toque se queda; el cursor solo adelanta.
  const [seleccion, setSeleccion] = useState<number | null>(null)
  const [resaltada, setResaltada] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  const cargar = useCallback(() => {
    Promise.all([api.listarPreparaciones(), api.disponibilidad(), api.preparacionesVencidas(), api.listarProduccion()])
      .then(([p, d, v, t]) => {
        setPreps(p)
        setDisp(d)
        setVencidas(v)
        setTandas(t)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron traer las preparaciones'))
  }, [])
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

      {vencidas.length > 0 && (
        <div className="rounded-2xl bg-aviso-500/10 p-4 space-y-2">
          <p className="text-sm font-semibold text-aviso-800">Sobró de antes y ya pasó su tiempo</p>
          {vencidas.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
              <span>
                {p.nombre}: <b className="tabular-nums">{p.stock_actual} {p.unidad}</b>
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
            detalle="Ej.: guiso de pollo. Con 1 kg de pollo, 100 g de cebolla y 50 g de pimentón, rinde 800 g. Después el pastelito lleva «50 g de guiso»."
            accion={<Boton onClick={() => setEditando('nueva')}>Crear la primera</Boton>}
          />
        </div>
      ) : (
        <>
          <ResumenCocina preps={preps} />

          <Seccion
            titulo="Qué crudo usa cada preparación"
            ayuda="Elige una preparación y el mapa se queda en ella: qué crudo lleva y quién más lo usa. Lo que comparten dos preparaciones va en ámbar: compiten por ello."
            accion={
              <Boton onClick={() => setEditando('nueva')} icono="mas">
                Nueva preparación
              </Boton>
            }
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
              dinero={dinero}
            />
          </Seccion>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
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
                    {t.cantidad} {t.unidad}
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

// ── Lo que se lleva la cocina ───────────────────────────────────────────────

/**
 * El número que importa de todo el preparado, arriba y explicado: de cada
 * kilo crudo que entra a la cocina, cuánto sale. Es la merma de cocinar de
 * todas las preparaciones juntas, pesada por lo que entra a cada una.
 */
function ResumenCocina({ preps }: { preps: Preparacion[] }) {
  const porUnidad = new Map<string, { entra: number; sale: number; n: number }>()
  for (const p of preps) {
    const m = mermaDeCocina(p)
    if (!m) continue
    const u = porUnidad.get(p.unidad) ?? { entra: 0, sale: 0, n: 0 }
    u.entra += m.entra
    u.sale += m.sale
    u.n += 1
    porUnidad.set(p.unidad, u)
  }
  const kg = porUnidad.get('kg') ?? porUnidad.get('lt')
  if (!kg || kg.entra <= 0) return null
  const unidad = porUnidad.has('kg') ? 'kg' : 'lt'
  const pct = 1 - kg.sale / kg.entra
  const chica = unidad === 'kg' ? 'g' : 'ml'
  const salen = Math.round((kg.sale / kg.entra) * 1000)
  return (
    <div className="vp-losa p-4 sm:p-5 flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="min-w-[14rem]">
        <p className="vp-etiqueta">Lo que se lleva la cocina</p>
        <p className="font-display text-3xl font-semibold tracking-tight tabular-nums leading-none mt-1.5">
          {salen} {chica} <span className="text-base font-normal text-neutral-500">de cada {unidad === 'kg' ? 'kilo' : 'litro'} crudo</span>
        </p>
      </div>
      <div className="flex-1 min-w-[16rem]">
        <span className="flex w-full h-2.5 overflow-hidden rounded-full bg-aviso-500/25" aria-hidden>
          <span className="h-full rounded-full bg-neutral-900" style={{ width: `${(1 - pct) * 100}%` }} />
        </span>
        <p className="text-xs text-neutral-600 mt-2 leading-snug">
          Es lo que sale ya preparado; el resto ({Math.round(pct * 100)} %) se queda en la cocina: agua, grasa, hueso. Sale de las recetas de{' '}
          {kg.n === 1 ? 'la preparación' : `las ${kg.n} preparaciones`}: entra tanto crudo, rinde tanto. Si una tanda real rinde distinto, se corrige en su receta.
        </p>
      </div>
    </div>
  )
}

/**
 * La merma de cocinar de una preparación: entra tanto crudo (lo que se mide
 * en la misma unidad que ella), sale lo que rinde. La diferencia se la lleva
 * la cocina: agua que se evapora, grasa, hueso. Null si no se puede comparar
 * (la tanda se mide en unidades y el crudo en kilos, por ejemplo).
 */
function mermaDeCocina(p: Preparacion): { entra: number; sale: number; pierde: number; pct: number } | null {
  const entra = p.lineas.filter((l) => l.unidad === p.unidad).reduce((s, l) => s + l.cantidad, 0)
  if (!(entra > 0) || !(p.rinde > 0) || p.rinde > entra) return null
  const pierde = entra - p.rinde
  return { entra, sale: p.rinde, pierde, pct: pierde / entra }
}

/** La barra: lo que entra es el ancho; lo que sale, lleno; lo que se pierde, en ámbar. */
function BarraMerma({ m, color, chica = false }: { m: ReturnType<typeof mermaDeCocina>; color: string; chica?: boolean }) {
  if (!m) return null
  return (
    <span className={`flex w-full overflow-hidden rounded-full bg-aviso-500/25 ${chica ? 'h-1.5' : 'h-2'}`} aria-hidden>
      <span className="h-full rounded-full" style={{ width: `${(1 - m.pct) * 100}%`, background: color }} />
    </span>
  )
}

/** "La cocina se lleva 200 g de cada kilo (20 %)", en una frase. */
function fraseMerma(m: NonNullable<ReturnType<typeof mermaDeCocina>>, unidad: string): string {
  const porUno = m.pct
  const chica = unidad === 'kg' ? 'g' : unidad === 'lt' ? 'ml' : null
  const parte = chica ? `${Math.round(porUno * 1000)} ${chica}` : `${fmtCant(porUno)} ${unidad}`
  const uno = unidad === 'kg' ? 'de cada kilo' : unidad === 'lt' ? 'de cada litro' : 'de cada unidad'
  return `La cocina se lleva ${parte} ${uno} (${Math.round(porUno * 100)} %)`
}

// ── El mapa: materia prima ↔ preparaciones ──────────────────────────────────

const FILA = 60
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
 * lleva la tanda, cuánto podrías hacer hoy y cuánto se lleva la cocina.
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
          ...preps.map((p) => ({ valor: String(p.id), texto: p.nombre, detalle: `rinde ${fmtCant(p.rinde)} ${p.unidad} por tanda` })),
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
    const merma = mermaDeCocina(elegida)
    return (
      <div>
        {filtro}
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)] items-start">
          <div>
            <p className="vp-etiqueta mb-2 flex items-center gap-1.5">
              <Icono nombre="paquete" size={12} /> Lo que lleva una tanda
            </p>
            <ul>
              {lineas.map((l) => {
                const ing = porId.get(l.ingrediente_id)
                const otras = (usosDe.get(l.ingrediente_id)?.preps ?? []).filter((x) => x.p.id !== elegida.id)
                const pierde = pierdeAlCocinar(ing)
                return (
                  <li key={l.ingrediente_id} style={{ height: FILA }} className="flex items-center">
                    <div className={`flex-1 min-w-0 rounded-2xl px-3.5 py-2 ${otras.length > 0 ? 'bg-aviso-500/10' : 'bg-neutral-500/6'}`}>
                      <span className="flex items-center gap-2">
                        <PuntoTipo tipo={l.tipo} />
                        <span className="font-medium truncate flex-1">{l.nombre}</span>
                        <span className="text-sm font-semibold tabular-nums shrink-0">
                          {fmtCant(l.cantidad)} {l.unidad}
                        </span>
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-neutral-500 leading-tight pl-4">
                        {ing && <span className="tabular-nums">hay {fmtCant(ing.stock_actual)} {ing.unidad}</span>}
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
                  </li>
                )
              })}
            </ul>
          </div>

          <svg width={ANCHO_LINEAS} height={alto + 28} className="hidden md:block mt-[1.65rem]" aria-hidden>
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

          <div className="hidden md:flex flex-col" style={{ minHeight: alto + 28 }}>
            <p className="vp-etiqueta mb-2 flex items-center gap-1.5">
              <Icono nombre="cocina" size={12} /> Lo que sale
            </p>
            <div className="flex-1 flex items-center">
              <div className="w-full rounded-2xl bg-neutral-900 text-white p-4 flex items-start gap-3">
                <span aria-hidden className="w-1.5 self-stretch min-h-[36px] rounded-full shrink-0" style={{ background: color }} />
                <div className="min-w-0 flex-1 space-y-3">
                  <p className="font-display text-lg font-semibold tracking-tight leading-tight">{elegida.nombre}</p>
                  <div>
                    <p className="font-display text-2xl font-semibold tabular-nums leading-none">
                      {elegida.modo_produccion === 'producir'
                        ? `${fmtCant(elegida.stock_actual)} ${elegida.unidad}`
                        : d?.potencial != null
                          ? `${fmtCant(d.potencial)} ${elegida.unidad}`
                          : '—'}
                    </p>
                    <p className="text-xs text-white/70 mt-1">
                      {elegida.modo_produccion === 'producir'
                        ? 'hay hecho ahora mismo'
                        : d?.limita
                          ? `podrías hacer hoy con el crudo que hay · lo que se acaba primero: ${d.limita}`
                          : 'podrías hacer hoy con el crudo que hay'}
                    </p>
                  </div>
                  {merma && (
                    <div>
                      <BarraMerma m={merma} color={color} />
                      <p className="text-xs text-white/70 mt-1.5">
                        Entra {fmtCant(merma.entra)} {elegida.unidad} de crudo, sale {fmtCant(merma.sale)} {elegida.unidad}. {fraseMerma(merma, elegida.unidad)}.
                      </p>
                    </div>
                  )}
                  <p className="text-xs text-white/70">
                    Cada {elegida.unidad === 'kg' ? 'kilo' : elegida.unidad === 'lt' ? 'litro' : 'unidad'} ya preparado cuesta{' '}
                    <b className="text-white tabular-nums">{dinero(elegida.costo_unitario)}</b>
                  </p>
                </div>
              </div>
            </div>
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
                <span className="text-xs text-neutral-500 tabular-nums">{ing ? `hay ${fmtCant(ing.stock_actual)} ${ing.unidad}` : ''}</span>
                <span className="flex flex-wrap gap-1 ml-auto">
                  {c.preps.map((x) => (
                    <button key={x.p.id} type="button" onClick={() => onSeleccionar(x.p.id)} className="vp-control inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs">
                      <span aria-hidden className="w-2 h-2 rounded-full" style={{ background: colorDe.get(x.p.id) }} />
                      {x.p.nombre}
                      <span className="text-neutral-500 tabular-nums">
                        {fmtCant(x.cantidad)} {c.unidad}
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
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_160px_minmax(0,1fr)] gap-0 items-start" onMouseLeave={() => onResaltar(null)}>
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
                  <div className={`flex-1 min-w-0 rounded-2xl px-3.5 py-2 ${c.preps.length > 1 ? 'bg-aviso-500/10' : 'bg-neutral-500/6'}`}>
                    <span className="flex items-center gap-2">
                      <PuntoTipo tipo={c.tipo} />
                      <span className="font-medium truncate flex-1">{c.nombre}</span>
                      {c.preps.length > 1 && <span className="text-[11px] font-semibold text-aviso-700 shrink-0">la comparten {c.preps.length}</span>}
                    </span>
                    <span className="block text-xs text-neutral-500 pl-4 tabular-nums truncate">
                      {c.ing ? `hay ${fmtCant(c.ing.stock_actual)} ${c.ing.unidad}` : '—'}
                      {pierde && <span className="text-aviso-700"> · {pierde}</span>}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>

        <svg width={ANCHO_LINEAS} height={alto + 28} className="hidden md:block mt-[1.65rem]" aria-hidden>
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
              const merma = mermaDeCocina(p)
              return (
                <li key={p.id} style={{ height: FILA }} className={`flex items-center transition-opacity ${apagada ? 'opacity-30' : ''}`}>
                  <button
                    type="button"
                    onMouseEnter={() => onResaltar(p.id)}
                    onClick={() => onSeleccionar(p.id)}
                    className="vp-pulsable flex-1 min-w-0 text-left rounded-2xl px-3.5 py-2 bg-neutral-500/6 flex items-center gap-3"
                  >
                    <span aria-hidden className="w-1.5 self-stretch min-h-[28px] rounded-full shrink-0" style={{ background: colorDe.get(p.id) }} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium truncate">{p.nombre}</span>
                      <span className="block text-xs text-neutral-500 tabular-nums truncate">
                        {p.modo_produccion === 'producir'
                          ? `hay ${fmtCant(p.stock_actual)} ${p.unidad} hecho`
                          : d?.potencial != null
                            ? `podrías hacer ${fmtCant(d.potencial)} ${p.unidad} hoy`
                            : `rinde ${fmtCant(p.rinde)} ${p.unidad} por tanda`}
                        {merma && <span className="text-aviso-700"> · la cocina se lleva el {Math.round(merma.pct * 100)} %</span>}
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

// ── Las tarjetas ────────────────────────────────────────────────────────────

/**
 * Una preparación en una tarjeta: UN número grande (cuánto podrías hacer
 * hoy), con su frase; lo que se lleva la cocina, con su barra; lo que lleva,
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
  const merma = mermaDeCocina(p)
  const unidadLarga = p.unidad === 'kg' ? 'kilo' : p.unidad === 'lt' ? 'litro' : 'unidad'
  return (
    <div
      onMouseEnter={() => onResaltar(p.id)}
      onMouseLeave={() => onResaltar(null)}
      className={`vp-losa p-4 sm:p-5 flex flex-col gap-4 transition-shadow ${resaltada ? 'ring-2' : ''}`}
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

      <div className="rounded-2xl bg-neutral-500/6 p-3.5">
        <p className="font-display text-3xl font-semibold tracking-tight tabular-nums leading-none">
          {produce ? `${fmtCant(p.stock_actual)} ${p.unidad}` : potencial == null ? '—' : `${fmtCant(potencial)} ${p.unidad}`}
        </p>
        <p className="text-xs text-neutral-600 mt-1.5 leading-snug">
          {produce
            ? potencial != null
              ? `hay hecho ahora mismo; con el crudo se podrían hacer ${fmtCant(potencial)} ${p.unidad} más`
              : 'hay hecho ahora mismo'
            : d?.limita
              ? `podrías hacer hoy con el crudo que hay. Lo que se acaba primero: ${d.limita}${d.comparte_con.length > 0 ? `, que también usa ${d.comparte_con.join(' y ')}` : ''}`
              : 'podrías hacer hoy con el crudo que hay'}
        </p>
      </div>

      {merma && (
        <div>
          <BarraMerma m={merma} color={color} />
          <p className="text-xs text-neutral-600 mt-1.5 leading-snug">
            Entra {fmtCant(merma.entra)} {p.unidad} de crudo y sale {fmtCant(merma.sale)} {p.unidad}. {fraseMerma(merma, p.unidad)}.
          </p>
        </div>
      )}

      <ul className="text-xs text-neutral-600 space-y-1">
        {p.lineas.slice(0, 4).map((l) => (
          <li key={l.ingrediente_id} className="flex items-center gap-2">
            <PuntoTipo tipo={l.tipo} />
            <span className="truncate flex-1">{l.nombre}</span>
            <span className="tabular-nums text-neutral-500 shrink-0">
              {fmtCant(l.cantidad)} {l.unidad}
            </span>
          </li>
        ))}
        {p.lineas.length > 4 && <li className="text-neutral-400 pl-4">y {p.lineas.length - 4} más</li>}
      </ul>

      {desvio && (
        <p className="text-xs text-aviso-800 rounded-xl bg-aviso-500/10 px-3 py-2">
          Las últimas {p.tandas} tandas rindieron {Math.round(p.rendimiento_real! * 100)} % de lo que dice la receta.
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <button type="button" onClick={onEditar} className="vp-pulsable inline-flex items-center gap-2 rounded-xl bg-neutral-900 text-white px-3.5 py-2 text-sm font-semibold">
          <Icono nombre="recetas" size={15} />
          Ver la receta
        </button>
        <button type="button" onClick={onSobro} className="vp-control vp-pulsable rounded-xl px-3.5 py-2 text-sm font-medium">
          Sobró hoy
        </button>
        {produce && (
          <button type="button" onClick={onTanda} className="vp-control vp-pulsable rounded-xl px-3.5 py-2 text-sm font-medium">
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
          ? `${fmtCant(n)} ${p.unidad} de ${p.nombre} se guardan para mañana. No se mueve nada: al venderse se descuenta el crudo.`
          : `Se botaron ${fmtCant(n)} ${p.unidad} de ${p.nombre}: ${dinero(r.valor ?? valor)} de pérdida, descontados del crudo.`,
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
const fmtCant = (n: number) => n.toLocaleString('es-VE', { maximumFractionDigits: 3 })
const sinRuido = (n: number) => String(Math.round(n * 1e6) / 1e6)
const clase = 'w-full border border-neutral-300 rounded-xl px-3 py-2 text-sm bg-white'
const rotulo = 'block text-xs font-medium text-neutral-600 mb-1'
const OTRA_UNIDAD: Record<string, string> = { kg: 'g', g: 'kg', lt: 'ml', ml: 'lt' }
const esGrande = (u: string) => u === 'kg' || u === 'lt'

type Fila = { ingrediente_id: number; cantidad: string; enChica?: boolean }

/**
 * Misma forma que la receta del menú: a la izquierda el recipiente que se
 * llena con lo que lleva; a la derecha "Lleva" y "Agregar". Dos diferencias
 * a propósito: solo se ofrece materia prima (y otras preparaciones), y no
 * hay precio ni margen. Lo que la olla dice arriba es cuánto RINDE la tanda
 * y a cuánto sale el kilo.
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
  const dialogo = useDialogo()
  const [nombre, setNombre] = useState(prep?.nombre ?? '')
  const [unidad, setUnidad] = useState(prep?.unidad ?? 'kg')
  const [rinde, setRinde] = useState(prep ? String(prep.rinde) : '')
  const [modo, setModo] = useState<'descontar' | 'producir'>(prep?.modo_produccion ?? 'descontar')
  const [vida, setVida] = useState(prep?.vida_util_horas ? String(prep.vida_util_horas) : '')
  const [filas, setFilas] = useState<Fila[]>(prep ? prep.lineas.map((l) => ({ ingrediente_id: l.ingrediente_id, cantidad: String(l.cantidad) })) : [])
  const [busqueda, setBusqueda] = useState('')
  const [categoria, setCategoria] = useState('')
  const [resaltado, setResaltado] = useState<number | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const porId = useMemo(() => new Map(ingredientes.map((i) => [i.id, i])), [ingredientes])
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

  // Lo que pesa cada cosa en la olla, por costo. Un color por ingrediente.
  const partes = filas
    .map((f, i) => {
      const ing = porId.get(f.ingrediente_id)
      const cantidad = aNum(f.cantidad) || 0
      return ing ? { id: ing.id, nombre: ing.nombre, cantidad, unidad: ing.unidad, costo: cantidad * (ing.costo_efectivo || ing.costo_unitario || 0), color: colorFranja(i) } : null
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
  const costoTanda = partes.reduce((s, p) => s + p.costo, 0)
  const rindeNum = aNum(rinde)
  // Lo que entra en la misma unidad en que se mide la preparación: para
  // decir "rinde el 80 % del crudo".
  const bruto = partes.filter((p) => p.unidad === unidad).reduce((s, p) => s + p.cantidad, 0)

  function actualizar(id: number, cambios: Partial<Fila>) {
    setFilas((prev) => prev.map((f) => (f.ingrediente_id === id ? { ...f, ...cambios } : f)))
  }

  async function guardar() {
    setError('')
    const limpias = filas.filter((f) => f.ingrediente_id && aNum(f.cantidad) > 0)
    if (!nombre.trim()) return setError('Ponle nombre a la preparación.')
    if (limpias.length === 0) return setError('Agrega al menos un ingrediente con su cantidad.')
    if (!(rindeNum > 0)) return setError('Di cuánto rinde la tanda.')
    const datos: DatosPreparacion = {
      nombre: nombre.trim(),
      unidad,
      rinde: rindeNum,
      modo_produccion: modo,
      vida_util_horas: modo === 'producir' && aNum(vida) > 0 ? Math.round(aNum(vida)) : null,
      lineas: limpias.map((l) => ({ ingrediente_id: l.ingrediente_id, cantidad: aNum(l.cantidad) })),
    }
    setGuardando(true)
    try {
      if (prep) await api.actualizarPreparacion(prep.id, datos)
      else await api.crearPreparacion(datos)
      onGuardada()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  async function usarRendimientoReal() {
    if (!prep?.rendimiento_real) return
    const nuevo = Math.round(prep.rinde * prep.rendimiento_real * 1000) / 1000
    const ok = await dialogo.confirmar({
      titulo: 'Corregir lo que rinde',
      texto: `Las últimas ${prep.tandas} tandas rindieron ${Math.round(prep.rendimiento_real * 100)} % de lo que dice la receta. La tanda pasa a rendir ${nuevo} ${prep.unidad} en vez de ${prep.rinde}.`,
      aceptar: 'Corregir',
    })
    if (ok) setRinde(String(nuevo))
  }

  const chip = (activo: boolean) =>
    `vp-pulsable rounded-xl px-3 py-2 text-left text-sm transition-colors ${activo ? 'bg-neutral-900 text-white' : 'bg-neutral-500/6 hover:bg-neutral-500/10'}`

  return (
    <div className="space-y-3">
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
      {error && <p className="text-peligro-600 text-sm">{error}</p>}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start">
        {/* ── La olla ──────────────────────────────────────────────── */}
        <section className="vp-losa p-4 sm:p-5">
          <div className="flex items-start gap-2">
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
          <p className="text-xs text-neutral-500 mt-1">Una tanda, tal como la hace la cocina. El sistema escala.</p>

          <div className="flex justify-center mt-3">
            <DibujoOlla
              partes={partes.map((p) => ({ id: p.id, nombre: p.nombre, valor: p.costo, color: p.color }))}
              total={costoTanda}
              rinde={rindeNum}
              unidad={unidad}
              formato={dinero}
              resaltado={resaltado}
              onResaltar={setResaltado}
              className="w-full max-w-[250px]"
            />
          </div>

          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-2 items-stretch">
              <label className="block">
                <span className={rotulo}>Rinde, ya preparado</span>
                <CasillaConUnidad
                  unidad={unidad}
                  vista={unidad}
                  alCambiarVista={() => undefined}
                  value={rinde}
                  onChange={(e) => setRinde(e.target.value)}
                  placeholder={bruto > 0 ? `menos de ${fmtCant(bruto)}` : '0,8'}
                  etiqueta={`Rinde (${unidad})`}
                  claseCasilla={`${clase} text-right text-lg font-semibold tabular-nums`}
                />
              </label>
              <div className="rounded-xl bg-neutral-500/6 px-3 py-2 flex flex-col justify-center">
                <span className="text-[11px] text-neutral-500">Sale a</span>
                <span className="font-display text-lg font-semibold tabular-nums leading-tight">
                  {costoTanda > 0 && rindeNum > 0 ? dinero(costoTanda / rindeNum) : '—'}
                  <span className="text-xs font-normal text-neutral-500"> el {unidad}</span>
                </span>
              </div>
            </div>
            <p className="text-xs text-neutral-500">
              Aquí va la merma de cocinar: entra crudo, sale menos.
              {bruto > 0 && rindeNum > 0 && rindeNum < bruto && <> Esta tanda rinde el {Math.round((rindeNum / bruto) * 100)} % del crudo.</>}
              {bruto > 0 && rindeNum > bruto && <span className="text-aviso-700"> Rinde más de lo que entra: revisa el número.</span>}
            </p>
            {prep?.rendimiento_real != null && Math.abs(prep.rendimiento_real - 1) > 0.05 && (
              <button type="button" onClick={() => void usarRendimientoReal()} className="text-xs font-semibold text-acento-700 underline">
                Las tandas reales rindieron {Math.round(prep.rendimiento_real * 100)} %: usar ese
              </button>
            )}
            <div className="grid grid-cols-2 gap-2 pt-1">
              {(
                [
                  { v: 'descontar', t: 'Del crudo', d: 'Al vender sale la materia prima. Nadie anota nada.' },
                  { v: 'producir', t: 'Se produce', d: 'La cocina anota cada tanda: se mide lo real.' },
                ] as const
              ).map((o) => (
                <button key={o.v} type="button" onClick={() => setModo(o.v)} className={chip(modo === o.v)}>
                  <span className="block font-semibold">{o.t}</span>
                  <span className={`block text-xs ${modo === o.v ? 'text-white/70' : 'text-neutral-500'}`}>{o.d}</span>
                </button>
              ))}
            </div>
            {modo === 'producir' && (
              <label className="block">
                <span className={rotulo}>Dura hecha (horas)</span>
                <Numerico value={vida} onChange={(e) => setVida(e.target.value)} entero placeholder="Ej. 24" className={clase} />
              </label>
            )}
          </div>
        </section>

        {/* ── Lleva y Agregar ──────────────────────────────────────── */}
        <section className="space-y-3">
          {filas.length > 0 && (
            <div className="vp-losa overflow-hidden max-h-[22rem] overflow-y-auto">
              <h3 className="px-4 pt-3 pb-2 font-display font-semibold tracking-tight">
                Lleva una tanda <span className="text-sm font-normal text-neutral-500">· crudo, tal como se compró</span>
              </h3>
              <div className="px-4 pb-1.5 flex items-center gap-3 border-b border-neutral-100 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                <span className="w-1.5 shrink-0" />
                <span className="min-w-0 flex-1">Mercancía</span>
                <span className="w-[8.75rem] shrink-0 text-right">Cantidad</span>
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

          <div className="vp-losa overflow-hidden">
            <div className="px-4 pt-3 pb-2 flex flex-wrap items-center gap-2 shrink-0">
              <h3 className="font-display font-semibold tracking-tight mr-auto">{filas.length === 0 ? 'Toca lo que lleva' : 'Agregar'}</h3>
              <div className="relative">
                <input
                  type="search"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setBusqueda('')}
                  placeholder="Buscar materia prima"
                  aria-label="Buscar materia prima"
                  className="w-48 bg-white border border-neutral-300 rounded-xl pl-8 pr-3 py-1.5 text-sm"
                />
                <Icono nombre="buscar" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
              </div>
              {categoriasDeposito.length > 1 && (
                <FiltroDesplegable etiqueta="Categoría" valor={categoria} alCambiar={setCategoria} opciones={[{ valor: '', texto: 'Todas' }, ...categoriasDeposito]} />
              )}
            </div>
            {disponibles.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-neutral-400">{ingredientes.length === 0 ? 'No hay materia prima en el depósito todavía.' : 'Nada coincide.'}</p>
            ) : (
              <div className="max-h-[26rem] overflow-y-auto">
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
                        onClick={() => setFilas((prev) => [...prev, { ingrediente_id: ing.id, cantidad: '', enChica: esGrande(ing.unidad) }])}
                        className="vp-celda w-full flex items-center gap-3 px-4 py-2.5 text-left"
                      >
                        <PuntoTipo tipo={ing.tipo} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm truncate">{ing.nombre}</span>
                          <span className="block text-[11px] text-neutral-400">
                            {ing.tipo === 'preparacion' ? 'preparación' : ing.categoria || ALMACEN_DE[ing.tipo].texto}
                          </span>
                        </span>
                        <span className="text-xs text-neutral-500 tabular-nums text-right">
                          {fmtCant(ing.stock_actual)} {ing.unidad}
                          <span className="block">{dinero(ing.costo_efectivo || ing.costo_unitario)} / {ing.unidad}</span>
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
  const valorVisto = f.cantidad === '' ? '' : sinRuido(cantidad * factor)
  const costoU = ing.costo_efectivo || ing.costo_unitario || 0
  const escribir = (texto: string) => {
    if (!enChica) return onCambio({ cantidad: texto })
    const n = aNum(texto)
    onCambio({ cantidad: texto === '' || !Number.isFinite(n) ? texto : sinRuido(n / factor) })
  }
  return (
    <li onMouseEnter={() => onResaltar(ing.id)} onMouseLeave={() => onResaltar(null)} className={`px-4 py-2.5 transition-colors ${resaltado ? 'bg-acento-500/10' : ''}`}>
      <div className="flex items-center gap-3">
        <span aria-hidden className="w-1.5 self-stretch min-h-[28px] rounded-full shrink-0" style={{ background: color }} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium truncate">{ing.nombre}</span>
          <span className="block text-[11px] text-neutral-400">
            {enChica ? `${dinero(costoU / factor, 4)} por ${otra}` : `${dinero(costoU, 3)} por ${ing.unidad}`} · hay {fmtCant(ing.stock_actual)} {ing.unidad}
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
          aria-label={`Cantidad de ${ing.nombre} por tanda, en ${unidadVista}`}
          autoFocus={f.cantidad === ''}
          className="w-[8.75rem] shrink-0"
          claseCasilla="border border-neutral-300 rounded-lg px-2 py-1.5 text-sm text-right tabular-nums"
        />
        <span className="w-16 text-right text-sm tabular-nums font-semibold">{cantidad > 0 ? dinero(cantidad * costoU) : '—'}</span>
        <button type="button" onClick={onQuitar} aria-label={`Quitar ${ing.nombre}`} className="w-8 h-8 shrink-0 grid place-items-center rounded-lg text-neutral-400 hover:bg-peligro-500/10 hover:text-peligro-600">
          <Icono nombre="quitar" size={14} />
        </button>
      </div>
    </li>
  )
}

/**
 * La olla dibujada: una franja por ingrediente, proporcional a lo que pesa
 * en el costo de la tanda; arriba, cuánto rinde. Sin margen, porque una
 * preparación no se vende: solo cuesta.
 */
function DibujoOlla({
  partes,
  total,
  rinde,
  unidad,
  formato,
  resaltado,
  onResaltar,
  className = '',
}: {
  partes: { id: number; nombre: string; valor: number; color: string }[]
  total: number
  rinde: number
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
    <svg viewBox="0 0 260 400" className={className} role="img" aria-label="La tanda, por lo que cuesta cada ingrediente">
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
            {f.h >= 26 && (
              <text x="44" y={f.y + f.h / 2 + 4} fontSize="11" fontWeight="600" fill="#fff" style={{ paintOrder: 'stroke', stroke: 'rgb(0 0 0 / 0.25)', strokeWidth: 2 }}>
                {f.nombre.length > 22 ? `${f.nombre.slice(0, 21)}…` : f.nombre}
              </text>
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
      {/* La tapa: lo que rinde */}
      <rect x="26" y="78" width="208" height="12" rx="6" fill="var(--color-neutral-300)" />
      <text x="130" y="40" textAnchor="middle" fontSize="12" fill="var(--color-neutral-500)">
        {rinde > 0 ? 'rinde' : 'cuánto rinde la tanda'}
      </text>
      <text x="130" y="68" textAnchor="middle" fontSize="24" fontWeight="700" fill="var(--color-neutral-900)" style={{ fontFamily: 'var(--font-display)' }}>
        {rinde > 0 ? `${fmtCant(rinde)} ${unidad}` : '—'}
      </text>
      {vacia && (
        <text x="130" y="230" textAnchor="middle" fontSize="12" fill="var(--color-neutral-400)">
          Toca a la derecha lo que lleva
        </text>
      )}
      {!vacia && (
        <text x="130" y="385" textAnchor="middle" fontSize="12" fill="var(--color-neutral-500)">
          {mostrada ? `${mostrada.nombre}: el ${total > 0 ? Math.round((mostrada.valor / total) * 100) : 0} % del costo` : `la tanda cuesta ${formato(total)}`}
        </text>
      )}
    </svg>
  )
}

// ── Anotar tanda ────────────────────────────────────────────────────────────

/**
 * Una tanda: lo que salió, y (opcional) lo que se usó. Lo usado viene
 * propuesto con la receta escalada; si la cocina usó otra cantidad la corrige,
 * y de ahí sale el rendimiento real.
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
  const [salio, setSalio] = useState(String(prep.rinde))
  const [usado, setUsado] = useState<Record<number, string>>(() => Object.fromEntries(prep.lineas.map((l) => [l.ingrediente_id, String(l.cantidad)])))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const porId = useMemo(() => new Map(ingredientes.map((i) => [i.id, i])), [ingredientes])

  function elegir(id: number) {
    const p = producibles.find((x) => x.id === id)
    if (!p) return
    setPrepId(id)
    setSalio(String(p.rinde))
    setUsado(Object.fromEntries(p.lineas.map((l) => [l.ingrediente_id, String(l.cantidad)])))
  }

  const principal = [...prep.lineas].sort((a, b) => b.costo - a.costo)[0]
  const esperado = principal ? (aNum(usado[principal.ingrediente_id] ?? '0') / principal.cantidad) * prep.rinde : 0
  const salioNum = aNum(salio)
  const rendimiento = esperado > 0 && salioNum > 0 ? salioNum / esperado : null

  async function guardar() {
    setError('')
    if (!(salioNum > 0)) return setError('Di cuánto salió.')
    setGuardando(true)
    try {
      await api.registrarProduccion({
        preparacion_id: prep.id,
        cantidad: salioNum,
        usado: prep.lineas.map((l) => ({ ingrediente_id: l.ingrediente_id, cantidad: aNum(usado[l.ingrediente_id] ?? '0') || 0 })),
      })
      onHecho()
    } catch (e) {
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
                <Numerico value={usado[l.ingrediente_id] ?? ''} onChange={(e) => setUsado((u) => ({ ...u, [l.ingrediente_id]: e.target.value }))} className={`${clase} w-24`} />
                <span className="w-12 text-xs text-neutral-500">{porId.get(l.ingrediente_id)?.unidad ?? l.unidad}</span>
              </li>
            ))}
          </ul>
        </div>
        {rendimiento != null && (
          <p className={`rounded-xl px-3 py-2 ${Math.abs(rendimiento - 1) > 0.05 ? 'bg-aviso-500/10 text-aviso-800' : 'bg-neutral-500/6 text-neutral-700'}`}>
            Con eso la receta esperaba {fmtCant(esperado)} {prep.unidad}: rindió {Math.round(rendimiento * 100)} %.
          </p>
        )}
        {error && <p className="text-peligro-600">{error}</p>}
      </div>
    </Modal>
  )
}
