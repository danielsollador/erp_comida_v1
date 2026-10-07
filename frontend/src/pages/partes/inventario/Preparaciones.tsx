import { useCallback, useEffect, useMemo, useState } from 'react'
import { PuntoTipo } from '../../../components/compras/Almacenes'
import ElegirMercancia from '../../../components/compras/ElegirMercancia'
import Icono from '../../../components/Icono'
import { Numerico } from '../../../components/Teclado'
import { useDialogo } from '../../../components/dialogo'
import { Boton, Modal, Pastilla, Seccion, Vacio } from '../../../components/ui'
import { api } from '../../../lib/api'
import { useMoneda } from '../../../lib/moneda'
import { vaEnPreparacion } from '../../../lib/tiposArticulo'
import type { DatosPreparacion, Disponibilidad, Ingrediente, Preparacion, Produccion } from '../../../lib/types'

/**
 * PREPARADO: la segunda cara de la materia prima. El guiso, la mechada, la
 * salsa: lo que la cocina hace con el crudo.
 *
 * Es un almacén IMAGINARIO (pizarra del 7-oct): no dice cuánto guiso hay en
 * la nevera, dice cuánto se PODRÍA hacer con el crudo que hay. Al vender un
 * pastelito se baja por la receta hasta el pollo, y nadie pesa nada. Las dos
 * cosas que sí se anotan son al cierre: "sobró guiso, lo boto o lo guardo".
 * Si lo guarda, no pasa nada; si lo bota, sale el crudo por la receta como
 * pérdida.
 *
 * Quien quiera precisión pasa una preparación a "se produce" y anota cada
 * tanda; ahí sí hay stock real y rendimiento medido.
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

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold tracking-tight">Lo que la cocina hace con el crudo</h2>
          <p className="text-xs text-neutral-500 mt-0.5 max-w-xl leading-relaxed">
            Cada preparación dice qué lleva una tanda y cuánto rinde. No se pesa nada: lo que se ve es cuánto podrías hacer hoy con
            la materia prima que hay. Al cierre, si sobró, se decide: se guarda o se bota.
          </p>
        </div>
        <Boton onClick={() => setEditando('nueva')} icono="mas">
          Nueva preparación
        </Boton>
      </div>

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
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
          {preps.map((p) => (
            <TarjetaPreparacion
              key={p.id}
              p={p}
              d={dispDe(p)}
              dinero={dinero}
              onEditar={() => setEditando(p)}
              onTanda={() => setAnotando(p)}
              onSobro={() => setSobro(p)}
            />
          ))}
        </div>
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

/** Una preparación: cuánto podrías hacer hoy, qué la limita, qué lleva. */
function TarjetaPreparacion({
  p,
  d,
  dinero,
  onEditar,
  onTanda,
  onSobro,
}: {
  p: Preparacion
  d?: Disponibilidad
  dinero: (n: number) => string
  onEditar: () => void
  onTanda: () => void
  onSobro: () => void
}) {
  const produce = p.modo_produccion === 'producir'
  const potencial = d?.potencial ?? null
  const desvio = p.rendimiento_real != null && Math.abs(p.rendimiento_real - 1) > 0.05
  return (
    <div className="vp-losa p-4 sm:p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display font-semibold tracking-tight leading-tight truncate">{p.nombre}</h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            Rinde {fmtCant(p.rinde)} {p.unidad} por tanda · {dinero(p.costo_unitario)} el {p.unidad}
          </p>
        </div>
        <Pastilla tono={produce ? 'acento' : 'neutro'}>{produce ? 'Se produce' : 'Del crudo'}</Pastilla>
      </div>

      <div className="rounded-2xl bg-neutral-500/6 p-3.5">
        {produce ? (
          <>
            <p className="text-xs text-neutral-500">Hay hecho</p>
            <p className="font-display text-2xl font-semibold tracking-tight tabular-nums leading-none mt-1">
              {fmtCant(p.stock_actual)} {p.unidad}
            </p>
            <p className="text-[11px] text-neutral-500 mt-1.5">
              {potencial != null ? `y podrías hacer ${fmtCant(potencial)} ${p.unidad} más con el crudo` : 'la cocina anota cada tanda'}
            </p>
          </>
        ) : (
          <>
            <p className="text-xs text-neutral-500">Podrías hacer hoy</p>
            <p className="font-display text-2xl font-semibold tracking-tight tabular-nums leading-none mt-1">
              {potencial == null ? '—' : `${fmtCant(potencial)} ${p.unidad}`}
            </p>
            <p className="text-[11px] text-neutral-500 mt-1.5">
              {d?.limita ? (
                <>
                  Lo limita <span className="font-semibold text-neutral-700">{d.limita}</span>
                  {d.comparte_con.length > 0 && <> · compite con {d.comparte_con.join(', ')}</>}
                </>
              ) : (
                'con la materia prima que hay'
              )}
            </p>
          </>
        )}
      </div>

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
        {p.lineas.length > 4 && <li className="text-neutral-400">y {p.lineas.length - 4} más</li>}
      </ul>

      {desvio && (
        <p className="text-xs text-aviso-800 rounded-xl bg-aviso-500/10 px-3 py-2">
          Las últimas {p.tandas} tandas rindieron {Math.round(p.rendimiento_real! * 100)} % de lo que dice la receta.
        </p>
      )}

      <div className="mt-auto flex flex-wrap gap-1.5">
        <button type="button" onClick={onSobro} className="vp-control vp-pulsable rounded-full px-3 py-1.5 text-xs font-semibold">
          Sobró hoy
        </button>
        {produce && (
          <button type="button" onClick={onTanda} className="vp-control vp-pulsable rounded-full px-3 py-1.5 text-xs font-semibold">
            Anotar tanda
          </button>
        )}
        <button type="button" onClick={onEditar} className="ml-auto text-xs font-medium text-neutral-500 hover:text-neutral-900 px-1">
          Receta
        </button>
      </div>
    </div>
  )
}

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
          <button
            type="button"
            disabled={ocupado}
            onClick={() => void decidir('guardar')}
            className="vp-pulsable rounded-2xl bg-neutral-900 text-white p-3.5 text-left disabled:opacity-50"
          >
            <span className="block font-semibold">Lo guardo</span>
            <span className="block text-xs text-white/70 mt-0.5">para mañana · no se mueve nada</span>
          </button>
          <button
            type="button"
            disabled={ocupado}
            onClick={() => void decidir('botar')}
            className="vp-pulsable rounded-2xl bg-peligro-500/10 text-peligro-700 p-3.5 text-left disabled:opacity-50"
          >
            <span className="block font-semibold">Lo boto</span>
            <span className="block text-xs opacity-80 mt-0.5">queda como pérdida · sale el crudo</span>
          </button>
        </div>
        {error && <p className="text-peligro-600">{error}</p>}
      </div>
    </Modal>
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
void datosDe

const aNum = (t: string) => Number(String(t).replace(',', '.'))
const fmtCant = (n: number) => n.toLocaleString('es-VE', { maximumFractionDigits: 3 })
const clase = 'w-full border border-neutral-300 rounded-xl px-3 py-2 text-sm bg-white'
const rotulo = 'block text-xs font-medium text-neutral-600 mb-1'

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
  const dialogo = useDialogo()
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
  const bruto = lineas.reduce((s, l) => {
    const ing = porId.get(l.ingrediente_id)
    return ing && ing.unidad === unidad ? s + (aNum(l.cantidad) || 0) : s
  }, 0)
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
    `vp-pulsable rounded-xl px-3 py-2.5 text-left transition-colors ${activo ? 'bg-neutral-900 text-white' : 'bg-neutral-500/6 hover:bg-neutral-500/10'}`

  return (
    <Modal
      titulo={prep ? prep.nombre : 'Nueva preparación'}
      ayuda="La receta de UNA tanda, tal como la dice la cocina. El sistema escala."
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
      <div className="space-y-5 text-sm">
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
          <p className="text-xs text-neutral-500 mb-2">Tal como sale del depósito: el pollo crudo, como se compró. La merma de cocinar va en «rinde».</p>
          <div className="space-y-2">
            {lineas.map((l, i) => {
              const ing = porId.get(l.ingrediente_id)
              return (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <ElegirMercancia
                      ingredientes={opciones}
                      valor={l.ingrediente_id}
                      alElegir={(id) => setLineas((prev) => prev.map((x, j) => (j === i ? { ...x, ingrediente_id: id } : x)))}
                      alCrear={() => undefined}
                      permitirPreparaciones
                      placeholder="Ingrediente…"
                    />
                  </div>
                  <Numerico
                    value={l.cantidad}
                    onChange={(e) => setLineas((prev) => prev.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)))}
                    placeholder={ing ? ing.unidad : 'cant.'}
                    className={`${clase} w-24`}
                  />
                  <button
                    type="button"
                    onClick={() => setLineas((prev) => prev.filter((_, j) => j !== i))}
                    aria-label="Quitar"
                    className="w-8 h-8 grid place-items-center rounded-lg text-neutral-400 hover:text-peligro-600 hover:bg-peligro-500/10"
                  >
                    <Icono nombre="quitar" size={14} />
                  </button>
                </div>
              )
            })}
            <button
              type="button"
              onClick={() => setLineas((prev) => [...prev, { ingrediente_id: 0, cantidad: '' }])}
              className="vp-control inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium"
            >
              <Icono nombre="mas" size={13} />
              Otro ingrediente
            </button>
          </div>
        </div>

        <label className="block">
          <span className={rotulo}>Rinde ({unidad})</span>
          <Numerico value={rinde} onChange={(e) => setRinde(e.target.value)} placeholder={bruto > 0 ? `menos de ${fmtCant(bruto)}` : 'Ej. 0,8'} className={clase} />
          <span className="block text-xs text-neutral-500 mt-1">
            Cuánto sale de esa tanda ya preparado: ahí va la merma de cocinar.
            {costoTanda > 0 && rindeNum > 0 && <> Sale a unos <b className="text-neutral-700">{dinero(costoTanda / rindeNum)}</b> el {unidad}.</>}
            {bruto > 0 && rindeNum > 0 && rindeNum < bruto && <> Rinde el {Math.round((rindeNum / bruto) * 100)} % del crudo.</>}
          </span>
          {prep?.rendimiento_real != null && Math.abs(prep.rendimiento_real - 1) > 0.05 && (
            <button type="button" onClick={() => void usarRendimientoReal()} className="mt-1 text-xs font-semibold text-acento-700 underline">
              Las tandas reales rindieron {Math.round(prep.rendimiento_real * 100)} %: usar ese
            </button>
          )}
        </label>

        {lineas.some((l) => l.ingrediente_id && aNum(l.cantidad) > 0) && rindeNum > 0 && (
          <div className="rounded-2xl bg-neutral-500/6 p-3.5">
            <label className="flex items-center gap-2">
              <span className="text-xs font-semibold text-neutral-600 shrink-0">Para hacer</span>
              <Numerico value={escala} onChange={(e) => setEscala(e.target.value)} placeholder={String(rindeNum * 2)} className={`${clase} w-24`} />
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
                { v: 'descontar', t: 'Del crudo', d: 'Al vender sale la materia prima. Nadie anota nada.' },
                { v: 'producir', t: 'Se produce', d: 'La cocina anota cada tanda: se mide el rendimiento real.' },
              ] as const
            ).map((o) => (
              <button key={o.v} type="button" onClick={() => setModo(o.v)} className={chip(modo === o.v)}>
                <span className="block font-semibold">{o.t}</span>
                <span className={`block text-xs ${modo === o.v ? 'text-white/70' : 'text-neutral-500'}`}>{o.d}</span>
              </button>
            ))}
          </div>
        </div>
        {modo === 'producir' && (
          <label className="block">
            <span className={rotulo}>Dura hecha (horas)</span>
            <Numerico value={vida} onChange={(e) => setVida(e.target.value)} entero placeholder="Ej. 24" className={clase} />
            <span className="block text-xs text-neutral-500 mt-1">Pasado ese tiempo, lo que sobre se ofrece para decidir.</span>
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
          <Numerico value={salio} onChange={(e) => setSalio(e.target.value)} autoFocus className={`${clase} text-lg font-semibold`} />
        </label>
        <div>
          <span className={rotulo}>Lo que se usó</span>
          <ul className="space-y-1.5">
            {prep.lineas.map((l) => (
              <li key={l.ingrediente_id} className="flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate">{l.nombre}</span>
                <Numerico
                  value={usado[l.ingrediente_id] ?? ''}
                  onChange={(e) => setUsado((u) => ({ ...u, [l.ingrediente_id]: e.target.value }))}
                  className={`${clase} w-24`}
                />
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
