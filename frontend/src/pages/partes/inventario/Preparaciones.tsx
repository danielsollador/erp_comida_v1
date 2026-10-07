import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDialogo } from '../../../components/dialogo'
import { Boton, Modal, Pastilla, Seccion, Vacio } from '../../../components/ui'
import { api } from '../../../lib/api'
import { useMoneda } from '../../../lib/moneda'
import { TEXTO_TIPO, vaEnPreparacion } from '../../../lib/tiposArticulo'
import type { DatosPreparacion, Disponibilidad, Ingrediente, Preparacion, Produccion } from '../../../lib/types'

/**
 * Las preparaciones de la cocina: el guiso de pollo, la carne mechada, la
 * salsa. Ver docs/plan-compras-inventario-produccion.md (fases 2 y 3).
 *
 * Cada una tiene su receta POR TANDA tal como la dice la cocina ("con 1 kg de
 * pollo, 100 g de cebolla... rindió 800 g") y el sistema escala. El pastelito
 * lleva "50 g de guiso" en su receta del menú, y al venderlo baja hasta el
 * pollo crudo.
 *
 * Producir es OPCIONAL: por defecto la preparación se descuenta del crudo al
 * vender y nadie anota nada. Si la cocina quiere medir el rendimiento real,
 * se pasa a "se produce" y se anota cada tanda con un número: cuánto salió.
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
  const dialogo = useDialogo()
  const [preps, setPreps] = useState<Preparacion[] | null>(null)
  const [disp, setDisp] = useState<Disponibilidad[]>([])
  const [vencidas, setVencidas] = useState<Preparacion[]>([])
  const [tandas, setTandas] = useState<Produccion[]>([])
  const [editando, setEditando] = useState<Preparacion | 'nueva' | null>(null)
  const [anotando, setAnotando] = useState<Preparacion | null>(null)
  const [error, setError] = useState('')

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

  async function botar(p: Preparacion) {
    const ok = await dialogo.confirmar({
      titulo: `Botar lo que sobró de ${p.nombre}`,
      texto: `Se anotan ${p.stock_actual} ${p.unidad} como merma: ya pasó su tiempo de vida.`,
      aceptar: 'Botar',
      peligro: true,
    })
    if (!ok) return
    try {
      await api.registrarMerma(p.id, p.stock_actual, 'Sobró: se venció')
      recargarTodo()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo anotar')
    }
  }

  async function usarRendimientoReal(p: Preparacion) {
    if (!p.rendimiento_real) return
    const nuevo = Math.round(p.rinde * p.rendimiento_real * 1000) / 1000
    const ok = await dialogo.confirmar({
      titulo: 'Corregir lo que rinde',
      texto: `Las últimas ${p.tandas} tandas rindieron ${Math.round(p.rendimiento_real * 100)} % de lo que dice la receta. La tanda pasa a rendir ${nuevo} ${p.unidad} en vez de ${p.rinde}.`,
      aceptar: 'Corregir',
    })
    if (!ok) return
    try {
      await api.actualizarPreparacion(p.id, { ...datosDe(p), rinde: nuevo })
      recargarTodo()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    }
  }

  const producibles = (preps ?? []).filter((p) => p.modo_produccion === 'producir')

  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-peligro-50 px-3 py-2 text-sm text-peligro-700">{error}</p>}

      {vencidas.length > 0 && (
        <div className="rounded-2xl border border-aviso-300 bg-aviso-50 p-3 space-y-2">
          <p className="text-sm font-semibold text-aviso-800">Sobró de antes y ya pasó su tiempo</p>
          {vencidas.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
              <span>
                {p.nombre}: <b className="tabular-nums">{p.stock_actual} {p.unidad}</b>
              </span>
              <button type="button" onClick={() => void botar(p)} className="text-sm font-semibold text-peligro-700 underline">
                Botar
              </button>
            </div>
          ))}
        </div>
      )}

      <Seccion
        titulo="Preparaciones"
        ayuda="Lo que la cocina hace con materia prima. La receta va por tanda, como la dice la cocina; el sistema escala."
        accion={
          <div className="flex gap-2">
            {producibles.length > 0 && (
              <Boton tono="suave" onClick={() => setAnotando(producibles[0])}>
                Anotar tanda
              </Boton>
            )}
            <Boton onClick={() => setEditando('nueva')}>+ Nueva</Boton>
          </div>
        }
      >
        {preps === null ? (
          <p className="text-sm text-neutral-500 py-6 text-center">Cargando…</p>
        ) : preps.length === 0 ? (
          <Vacio
            titulo="Todavía no hay preparaciones"
            detalle="Ej.: guiso de pollo. Con 1 kg de pollo, 100 g de cebolla y 50 g de pimentón, rinde 800 g. Después el pastelito lleva «50 g de guiso»."
            accion={<Boton onClick={() => setEditando('nueva')}>Crear la primera</Boton>}
          />
        ) : (
          <ul className="divide-y divide-neutral-100">
            {preps.map((p) => (
              <li key={p.id} className="py-3 flex items-start justify-between gap-3">
                <button type="button" onClick={() => setEditando(p)} className="min-w-0 text-left flex-1">
                  <span className="block font-semibold">{p.nombre}</span>
                  <span className="block text-xs text-neutral-500">
                    Rinde {p.rinde} {p.unidad} por tanda · {p.lineas.length} ingrediente{p.lineas.length === 1 ? '' : 's'} ·{' '}
                    {dinero(p.costo_unitario)} el {p.unidad}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    <Pastilla tono={p.modo_produccion === 'producir' ? 'acento' : 'neutro'}>
                      {p.modo_produccion === 'producir' ? `Se produce · hay ${p.stock_actual} ${p.unidad}` : 'Se descuenta del crudo'}
                    </Pastilla>
                    {p.rendimiento_real != null && (
                      <Pastilla tono={Math.abs(p.rendimiento_real - 1) > 0.05 ? 'ojo' : 'bien'}>
                        Rinde {Math.round(p.rendimiento_real * 100)} % de lo esperado
                      </Pastilla>
                    )}
                  </span>
                </button>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {p.modo_produccion === 'producir' && (
                    <button type="button" onClick={() => setAnotando(p)} className="text-xs font-semibold border border-neutral-300 rounded-lg px-2.5 py-1">
                      Anotar tanda
                    </button>
                  )}
                  {p.rendimiento_real != null && Math.abs(p.rendimiento_real - 1) > 0.05 && (
                    <button type="button" onClick={() => void usarRendimientoReal(p)} className="text-xs text-acento-700 underline">
                      Usar el real
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Seccion>

      {disp.length > 0 && (
        <Seccion
          titulo="Cuánto podrías hacer hoy"
          ayuda="Con la materia prima que hay. Las que comparten un ingrediente compiten por él: no se suman."
        >
          <ul className="divide-y divide-neutral-100 text-sm">
            {disp.map((d) => (
              <li key={d.preparacion_id} className="py-2.5 flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block font-medium">{d.nombre}</span>
                  {d.limita && (
                    <span className="block text-xs text-neutral-500">
                      Lo limita {d.limita}
                      {d.comparte_con.length > 0 && <> · compite con {d.comparte_con.join(', ')}</>}
                    </span>
                  )}
                </span>
                <span className="font-semibold tabular-nums shrink-0">
                  {d.potencial == null ? '—' : `${d.potencial.toLocaleString('es-VE', { maximumFractionDigits: 2 })} ${d.unidad}`}
                </span>
              </li>
            ))}
          </ul>
        </Seccion>
      )}

      {tandas.length > 0 && (
        <Seccion titulo="Tandas de esta semana">
          <ul className="divide-y divide-neutral-100 text-sm">
            {tandas.map((t) => (
              <li key={t.id} className="py-2 flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block font-medium">{t.preparacion}</span>
                  <span className="block text-xs text-neutral-500">
                    {new Date(t.fecha).toLocaleString('es-VE', { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · costó{' '}
                    {dinero(t.costo_total)}
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

      {editando && (
        <EditorPreparacion
          prep={editando === 'nueva' ? null : editando}
          ingredientes={ingredientes}
          onCerrar={() => setEditando(null)}
          onGuardada={() => {
            setEditando(null)
            recargarTodo()
          }}
        />
      )}
      {anotando && (
        <AnotarTanda
          inicial={anotando}
          producibles={producibles}
          ingredientes={ingredientes}
          onCerrar={() => setAnotando(null)}
          onHecho={() => {
            setAnotando(null)
            recargarTodo()
          }}
        />
      )}
    </div>
  )
}

function datosDe(p: Preparacion): DatosPreparacion {
  return {
    nombre: p.nombre,
    unidad: p.unidad,
    rinde: p.rinde,
    modo_produccion: p.modo_produccion,
    vida_util_horas: p.vida_util_horas,
    lineas: p.lineas.map((l) => ({ ingrediente_id: l.ingrediente_id, cantidad: l.cantidad })),
  }
}

const aNum = (t: string) => Number(String(t).replace(',', '.'))
const fmtCant = (n: number) => n.toLocaleString('es-VE', { maximumFractionDigits: 3 })
const clase = 'w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white'
const rotulo = 'block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1'

type Linea = { ingrediente_id: number; cantidad: string }

/** Crear o cambiar una preparación: su receta por tanda y lo que rinde. */
function EditorPreparacion({
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
  const [rinde, setRinde] = useState(prep ? String(prep.rinde) : '')
  const [modo, setModo] = useState<'descontar' | 'producir'>(prep?.modo_produccion ?? 'descontar')
  const [vida, setVida] = useState(prep?.vida_util_horas ? String(prep.vida_util_horas) : '')
  const [lineas, setLineas] = useState<Linea[]>(
    prep ? prep.lineas.map((l) => ({ ingrediente_id: l.ingrediente_id, cantidad: String(l.cantidad) })) : [{ ingrediente_id: 0, cantidad: '' }],
  )
  const [escala, setEscala] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const opciones = useMemo(
    () => ingredientes.filter((i) => vaEnPreparacion(i) && i.id !== prep?.id).sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [ingredientes, prep?.id],
  )
  const porId = useMemo(() => new Map(ingredientes.map((i) => [i.id, i])), [ingredientes])
  const rindeNum = aNum(rinde)
  // Estimado con los costos de la lista; el exacto lo da el servidor al guardar.
  const costoTanda = lineas.reduce((s, l) => s + (aNum(l.cantidad) || 0) * (porId.get(l.ingrediente_id)?.costo_unitario || 0), 0)
  const escalaNum = aNum(escala)
  const factor = rindeNum > 0 && escalaNum > 0 ? escalaNum / rindeNum : null

  async function guardar() {
    setError('')
    const limpias = lineas.filter((l) => l.ingrediente_id && aNum(l.cantidad) > 0)
    if (!nombre.trim()) return setError('Ponle nombre.')
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

  return (
    <Modal
      titulo={prep ? prep.nombre : 'Nueva preparación'}
      onCerrar={onCerrar}
      ancho="md"
      pie={
        <>
          <Boton tono="suave" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton onClick={() => void guardar()} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Boton>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-3 gap-2">
          <label className="block col-span-2">
            <span className={rotulo}>Nombre</span>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Guiso de pollo" className={clase} />
          </label>
          <label className="block">
            <span className={rotulo}>Se mide en</span>
            <select value={unidad} onChange={(e) => setUnidad(e.target.value)} className={clase}>
              <option value="kg">kg</option>
              <option value="lt">litro</option>
              <option value="unidad">unidad</option>
            </select>
          </label>
        </div>

        <div>
          <span className={rotulo}>Lo que lleva una tanda</span>
          <p className="text-xs text-neutral-500 mb-2">
            Tal como sale del depósito: el pollo crudo, como se compró. La merma de cocinar va en «rinde».
          </p>
          <div className="space-y-2">
            {lineas.map((l, i) => {
              const ing = porId.get(l.ingrediente_id)
              return (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={l.ingrediente_id}
                    onChange={(e) => setLineas((prev) => prev.map((x, j) => (j === i ? { ...x, ingrediente_id: Number(e.target.value) } : x)))}
                    className={`${clase} flex-1 min-w-0`}
                  >
                    <option value={0}>Ingrediente…</option>
                    {opciones.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.nombre} ({o.unidad}){o.tipo !== 'insumo' ? ` · ${TEXTO_TIPO[o.tipo]}` : ''}
                      </option>
                    ))}
                  </select>
                  <input
                    value={l.cantidad}
                    onChange={(e) => setLineas((prev) => prev.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)))}
                    inputMode="decimal"
                    placeholder={ing ? ing.unidad : 'cant.'}
                    className={`${clase} w-24`}
                  />
                  <button
                    type="button"
                    onClick={() => setLineas((prev) => prev.filter((_, j) => j !== i))}
                    aria-label="Quitar"
                    className="text-neutral-400 hover:text-peligro-600 px-1"
                  >
                    ✕
                  </button>
                </div>
              )
            })}
            <button type="button" onClick={() => setLineas((prev) => [...prev, { ingrediente_id: 0, cantidad: '' }])} className="text-sm font-medium text-neutral-600">
              + ingrediente
            </button>
          </div>
        </div>

        <label className="block">
          <span className={rotulo}>Rinde ({unidad})</span>
          <input value={rinde} onChange={(e) => setRinde(e.target.value)} inputMode="decimal" placeholder="Ej. 0,8" className={clase} />
          <span className="block text-xs text-neutral-500 mt-1">
            Cuánto sale de esa tanda ya preparado.
            {costoTanda > 0 && rindeNum > 0 && <> Sale a unos {dinero(costoTanda / rindeNum)} el {unidad}.</>}
          </span>
        </label>

        {lineas.some((l) => l.ingrediente_id && aNum(l.cantidad) > 0) && rindeNum > 0 && (
          <div className="rounded-xl bg-neutral-50 p-3">
            <label className="flex items-center gap-2">
              <span className="text-xs font-semibold text-neutral-600 shrink-0">Para hacer</span>
              <input value={escala} onChange={(e) => setEscala(e.target.value)} inputMode="decimal" placeholder={String(rindeNum * 2)} className={`${clase} w-24`} />
              <span className="text-xs text-neutral-600">{unidad} hace falta:</span>
            </label>
            {factor && (
              <ul className="mt-2 space-y-0.5 text-xs text-neutral-700">
                {lineas
                  .filter((l) => l.ingrediente_id && aNum(l.cantidad) > 0)
                  .map((l) => {
                    const ing = porId.get(l.ingrediente_id)
                    return (
                      <li key={l.ingrediente_id} className="flex justify-between">
                        <span>{ing?.nombre}</span>
                        <span className="tabular-nums">
                          {fmtCant(aNum(l.cantidad) * factor)} {ing?.unidad}
                        </span>
                      </li>
                    )
                  })}
              </ul>
            )}
          </div>
        )}

        <div>
          <span className={rotulo}>Cómo se lleva</span>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { v: 'descontar', t: 'Se descuenta del crudo', d: 'Al vender, sale la materia prima. Nadie anota nada.' },
                { v: 'producir', t: 'Se produce', d: 'La cocina anota cada tanda: se mide el rendimiento real.' },
              ] as const
            ).map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setModo(o.v)}
                className={`rounded-lg border px-3 py-2 text-left ${modo === o.v ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 bg-white'}`}
              >
                <span className="block font-medium">{o.t}</span>
                <span className={`block text-xs ${modo === o.v ? 'text-white/70' : 'text-neutral-500'}`}>{o.d}</span>
              </button>
            ))}
          </div>
        </div>
        {modo === 'producir' && (
          <label className="block">
            <span className={rotulo}>Dura hecha (horas)</span>
            <input value={vida} onChange={(e) => setVida(e.target.value)} inputMode="numeric" placeholder="Ej. 24" className={clase} />
            <span className="block text-xs text-neutral-500 mt-1">Pasado ese tiempo, lo que sobre se ofrece para botar.</span>
          </label>
        )}
        {error && <p className="text-peligro-600">{error}</p>}
      </div>
    </Modal>
  )
}

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

  // El ingrediente que más pesa en el costo manda la comparación (el pollo, no la sal).
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
          <input value={salio} onChange={(e) => setSalio(e.target.value)} inputMode="decimal" autoFocus className={`${clase} text-lg font-semibold`} />
        </label>
        <div>
          <span className={rotulo}>Lo que se usó</span>
          <ul className="space-y-1.5">
            {prep.lineas.map((l) => (
              <li key={l.ingrediente_id} className="flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate">{l.nombre}</span>
                <input
                  value={usado[l.ingrediente_id] ?? ''}
                  onChange={(e) => setUsado((u) => ({ ...u, [l.ingrediente_id]: e.target.value }))}
                  inputMode="decimal"
                  className={`${clase} w-24`}
                />
                <span className="w-12 text-xs text-neutral-500">{porId.get(l.ingrediente_id)?.unidad ?? l.unidad}</span>
              </li>
            ))}
          </ul>
        </div>
        {rendimiento != null && (
          <p className={`rounded-lg px-3 py-2 ${Math.abs(rendimiento - 1) > 0.05 ? 'bg-aviso-50 text-aviso-800' : 'bg-neutral-50 text-neutral-700'}`}>
            Con eso la receta esperaba {fmtCant(esperado)} {prep.unidad}: rindió {Math.round(rendimiento * 100)} %.
          </p>
        )}
        {error && <p className="text-peligro-600">{error}</p>}
      </div>
    </Modal>
  )
}
