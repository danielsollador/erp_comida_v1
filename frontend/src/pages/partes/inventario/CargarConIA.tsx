import { useEffect, useRef, useState } from 'react'
import { Aviso, Boton, Modal, Pastilla } from '../../../components/ui'
import { api } from '../../../lib/api'
import { achicarFoto } from '../../../lib/foto'
import type {
  LineaPropuesta,
  LineaRevisada,
  PropuestaCarga,
  PropuestaRevisada,
  ResultadoCarga,
  TipoCarga,
  UnidadDicha,
  UnidadFicha,
} from '../../../lib/types'

/**
 * Cargar el inventario hablando o con fotos (IA, 20-oct).
 *
 * El dueño arranca de cero: escribe (o dicta con el micrófono del teclado) o
 * manda fotos del cuaderno, y la IA PROPONE la mercancía, las preparaciones
 * y lo que lleva cada producto. Aquí se revisa y se corrige; nada se guarda
 * hasta «Guardar», y entonces entra todo junto o nada.
 *
 * Cada cambio se vuelve a cruzar con lo que ya existe (la revisión del
 * servidor), así que los avisos de cada renglón siempre dicen la verdad.
 */

const TIPOS: { valor: TipoCarga; texto: string }[] = [
  { valor: 'insumo', texto: 'Materia prima' },
  { valor: 'reventa', texto: 'Reventa' },
  { valor: 'consumible', texto: 'Empaque' },
  { valor: 'desechable', texto: 'Desechable' },
]
const UNIDADES_FICHA: UnidadFicha[] = ['kg', 'lt', 'unidad']
const UNIDADES_DICHAS: UnidadDicha[] = ['kg', 'g', 'lt', 'ml', 'unidad']
const EJEMPLO =
  'Ej.: El pastelito de carne lleva un disco de masa y 50 g de guiso de carne. ' +
  'El guiso: 1 kg de carne molida, 200 g de cebolla y 100 g de pimentón; rinde 900 g. ' +
  'La carne la compro a $8 el kilo.'

type Incluir = { mercancias: boolean[]; preparaciones: boolean[]; recetas: boolean[] }

function desdeRevision(r: PropuestaRevisada): PropuestaCarga {
  const linea = (l: LineaRevisada): LineaPropuesta => ({ mercancia: l.mercancia, cantidad: l.cantidad, unidad: l.unidad })
  return {
    mercancias: r.mercancias.map(({ nombre, tipo, unidad, costo_unitario, exento }) => ({ nombre, tipo, unidad, costo_unitario, exento })),
    preparaciones: r.preparaciones.map((p) => ({ nombre: p.nombre, unidad: p.unidad, rinde: p.rinde, lineas: p.lineas.map(linea) })),
    recetas: r.recetas.map((x) => ({ producto: x.producto, variante_id: x.variante_id, lineas: x.lineas.map(linea) })),
    dudas: r.dudas,
  }
}

export default function CargarConIA({ onCerrar, onGuardado }: { onCerrar: () => void; onGuardado: () => void }) {
  const [texto, setTexto] = useState('')
  const [fotos, setFotos] = useState<File[]>([])
  const [leyendo, setLeyendo] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState<PropuestaRevisada | null>(null)
  const [borrador, setBorrador] = useState<PropuestaCarga | null>(null)
  const [incluir, setIncluir] = useState<Incluir>({ mercancias: [], preparaciones: [], recetas: [] })
  const [guardando, setGuardando] = useState(false)
  const [hecho, setHecho] = useState<ResultadoCarga | null>(null)

  async function leer() {
    setLeyendo(true)
    setError('')
    try {
      const chicas = await Promise.all(fotos.map((f) => achicarFoto(f)))
      const r = await api.leerCargaInventario(texto, chicas)
      setRevision(r)
      setBorrador(desdeRevision(r))
      setIncluir({
        // Lo que ya existe no se crea otra vez: se usa esa.
        mercancias: r.mercancias.map((m) => !m.ya_existe),
        preparaciones: r.preparaciones.map((p) => !p.ya_existe),
        recetas: r.recetas.map(() => true),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer')
    } finally {
      setLeyendo(false)
    }
  }

  // Cada cambio se vuelve a revisar, medio segundo después de dejar de teclear.
  const vuelta = useRef(0)
  useEffect(() => {
    if (!borrador || !revision) return
    const yo = ++vuelta.current
    const t = setTimeout(() => {
      api
        .revisarCargaInventario(borrador)
        .then((r) => yo === vuelta.current && setRevision((v) => ({ ...r, lector: v?.lector ?? r.lector })))
        .catch(() => {})
    }, 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [borrador])

  function cambiar(f: (b: PropuestaCarga) => void) {
    setBorrador((b) => {
      if (!b) return b
      const copia: PropuestaCarga = JSON.parse(JSON.stringify(b))
      f(copia)
      return copia
    })
  }

  function marcar(grupo: keyof Incluir, i: number, valor: boolean) {
    setIncluir((x) => ({ ...x, [grupo]: x[grupo].map((v, j) => (j === i ? valor : v)) }))
  }

  const problemas = revision
    ? [
        ...revision.preparaciones.flatMap((p, i) => (incluir.preparaciones[i] ? p.lineas.filter((l) => l.problema) : [])),
        ...revision.recetas.flatMap((r, i) => (incluir.recetas[i] ? r.lineas.filter((l) => l.problema) : [])),
      ].length +
      revision.recetas.filter((r, i) => incluir.recetas[i] && !r.variante_id).length
    : 0
  const cuantos = incluir.mercancias.filter(Boolean).length + incluir.preparaciones.filter(Boolean).length + incluir.recetas.filter(Boolean).length

  async function guardar() {
    if (!borrador) return
    setGuardando(true)
    setError('')
    try {
      const r = await api.guardarCargaInventario({
        mercancias: borrador.mercancias.filter((_, i) => incluir.mercancias[i]),
        preparaciones: borrador.preparaciones.filter((_, i) => incluir.preparaciones[i]),
        recetas: borrador.recetas.filter((_, i) => incluir.recetas[i]),
        dudas: [],
      })
      setHecho(r)
      onGuardado()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  // ── Listo ──
  if (hecho) {
    const lista = (titulo: string, xs: string[]) =>
      xs.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{titulo}</p>
          <p className="text-sm">{xs.join(', ')}</p>
        </div>
      )
    return (
      <Modal titulo="Cargado" onCerrar={onCerrar} pie={<Boton onClick={onCerrar}>Listo</Boton>}>
        <div className="space-y-3">
          {lista(`Mercancía nueva (${hecho.mercancias.length})`, hecho.mercancias)}
          {lista(`Preparaciones (${hecho.preparaciones.length})`, hecho.preparaciones)}
          {lista(`Recetas del menú (${hecho.recetas.length})`, hecho.recetas)}
          {hecho.omitidas.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-neutral-500 space-y-0.5">
              {hecho.omitidas.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          )}
          <p className="text-xs text-neutral-500">
            Todo nace sin stock: lo que hay se carga con el conteo físico o entra con la compra.
          </p>
        </div>
      </Modal>
    )
  }

  // ── Escribir ──
  if (!revision || !borrador) {
    return (
      <Modal
        titulo="Cargar con IA"
        ayuda="Escribe o dicta lo que usas, lo que preparas y lo que lleva cada producto, o manda fotos del cuaderno. La IA lo ordena y tú lo revisas antes de guardar."
        onCerrar={onCerrar}
        ancho="lg"
        pie={
          <div className="flex justify-end gap-2">
            <Boton tono="suave" onClick={onCerrar}>
              Cancelar
            </Boton>
            <Boton onClick={() => void leer()} disabled={leyendo || (!texto.trim() && fotos.length === 0)}>
              {leyendo ? 'Leyendo…' : 'Leer'}
            </Boton>
          </div>
        }
      >
        {error && <Aviso>{error}</Aviso>}
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={8}
          placeholder={EJEMPLO}
          className="w-full rounded-xl border border-neutral-300 p-3 text-sm"
        />
        <p className="mt-1 text-xs text-neutral-500">En el teléfono, el micrófono del teclado sirve para dictarlo.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="vp-control inline-flex cursor-pointer items-center rounded-lg border px-3 py-2 text-sm font-medium">
            Agregar fotos
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              onChange={(e) => {
                const nuevas = Array.from(e.target.files ?? [])
                setFotos((f) => [...f, ...nuevas].slice(0, 6))
                e.target.value = ''
              }}
            />
          </label>
          {fotos.map((f, i) => (
            <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-xs">
              Hoja {i + 1}
              <button
                type="button"
                aria-label={`Quitar la hoja ${i + 1}`}
                onClick={() => setFotos((xs) => xs.filter((_, j) => j !== i))}
                className="text-neutral-500"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </Modal>
    )
  }

  // ── Revisar ──
  const conocidas = revision.mercancias_conocidas
  const filasDeLineas = (
    lineas: LineaRevisada[],
    alCambiar: (j: number, l: LineaPropuesta | null) => void,
    alAgregar: () => void,
  ) => (
    <div className="mt-2 space-y-1.5">
      {lineas.map((l, j) => (
        <div key={j}>
          <div className="grid grid-cols-[4.25rem_4.75rem_minmax(0,1fr)_2rem] items-center gap-1.5">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={l.cantidad}
              onChange={(e) => alCambiar(j, { ...l, cantidad: Number(e.target.value) })}
              className="w-full min-w-0 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm tabular-nums"
              aria-label="Cantidad"
            />
            <select
              value={l.unidad}
              onChange={(e) => alCambiar(j, { ...l, unidad: e.target.value as UnidadDicha })}
              className="w-full min-w-0 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
              aria-label="Unidad"
            >
              {UNIDADES_DICHAS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
            <select
              value={l.mercancia}
              onChange={(e) => alCambiar(j, { ...l, mercancia: e.target.value })}
              className="w-full min-w-0 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
              aria-label="Mercancía"
            >
              {!conocidas.includes(l.mercancia) && <option value={l.mercancia}>{l.mercancia} (no está)</option>}
              {conocidas.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => alCambiar(j, null)}
              aria-label="Quitar el renglón"
              className="h-8 w-8 rounded-lg text-neutral-400 hover:bg-neutral-100"
            >
              ×
            </button>
          </div>
          {l.problema ? (
            <p className="mt-0.5 text-xs text-peligro-600">{l.problema}</p>
          ) : (
            l.cantidad_ficha !== null &&
            l.unidad !== l.unidad_ficha && (
              <p className="mt-0.5 text-xs text-neutral-400">
                = {Number(l.cantidad_ficha.toFixed(4))} {l.unidad_ficha}
              </p>
            )
          )}
        </div>
      ))}
      <button type="button" onClick={alAgregar} className="text-xs font-medium text-acento-700">
        + Renglón
      </button>
    </div>
  )

  const lineaNueva = (): LineaPropuesta => ({ mercancia: conocidas[0] ?? '', cantidad: 1, unidad: 'kg' })

  return (
    <Modal
      titulo="Revisa antes de guardar"
      ayuda="Esto es lo que entendió la IA. Corrige lo que haga falta y desmarca lo que no quieras cargar."
      onCerrar={onCerrar}
      ancho="lg"
      pie={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {problemas > 0 && <span className="text-xs text-peligro-600">{problemas} cosa(s) por corregir</span>}
          <Boton tono="suave" onClick={() => setRevision(null)}>
            Volver a escribir
          </Boton>
          <Boton onClick={() => void guardar()} disabled={guardando || problemas > 0 || cuantos === 0}>
            {guardando ? 'Guardando…' : `Guardar ${cuantos}`}
          </Boton>
        </div>
      }
    >
      {error && <Aviso>{error}</Aviso>}
      <div className="space-y-5">
        {revision.dudas.length > 0 && (
          <div className="rounded-xl bg-aviso-50 p-3 text-sm text-aviso-800">
            <p className="font-semibold">La IA pregunta</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {revision.dudas.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>
        )}

        {revision.mercancias.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Mercancía</h3>
            <div className="space-y-2">
              {revision.mercancias.map((m, i) => (
                <div key={i} className="rounded-xl border border-neutral-200 p-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={incluir.mercancias[i] ?? false}
                      disabled={Boolean(m.ya_existe)}
                      onChange={(e) => marcar('mercancias', i, e.target.checked)}
                      aria-label={`Cargar ${m.nombre}`}
                      className="h-5 w-5 shrink-0"
                    />
                    <input
                      value={borrador.mercancias[i]?.nombre ?? ''}
                      onChange={(e) => cambiar((b) => (b.mercancias[i].nombre = e.target.value))}
                      className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm font-medium"
                      aria-label="Nombre"
                    />
                  </div>
                  <div className="mt-1.5 grid grid-cols-[1fr_auto_5.5rem] gap-1.5 pl-6">
                    <select
                      value={borrador.mercancias[i]?.tipo}
                      onChange={(e) => cambiar((b) => (b.mercancias[i].tipo = e.target.value as TipoCarga))}
                      className="min-w-0 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
                      aria-label="Tipo"
                    >
                      {TIPOS.map((t) => (
                        <option key={t.valor} value={t.valor}>
                          {t.texto}
                        </option>
                      ))}
                    </select>
                    <select
                      value={borrador.mercancias[i]?.unidad}
                      onChange={(e) => cambiar((b) => (b.mercancias[i].unidad = e.target.value as UnidadFicha))}
                      className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
                      aria-label="Unidad"
                    >
                      {UNIDADES_FICHA.map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      placeholder="$ costo"
                      value={borrador.mercancias[i]?.costo_unitario ?? ''}
                      onChange={(e) =>
                        cambiar((b) => (b.mercancias[i].costo_unitario = e.target.value === '' ? null : Number(e.target.value)))
                      }
                      className="w-full min-w-0 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm tabular-nums"
                      aria-label="Costo por unidad en dólares"
                    />
                  </div>
                  {m.ya_existe && <p className="mt-1 text-xs text-neutral-500">Ya existe como «{m.ya_existe}»: se usa esa.</p>}
                  {!m.ya_existe && m.parecidas.length > 0 && (
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-aviso-700">
                      Se parece a:
                      {m.parecidas.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => cambiar((b) => (b.mercancias[i].nombre = p))}
                          className="rounded-full bg-aviso-50 px-2 py-0.5 font-medium"
                        >
                          ¿Es «{p}»?
                        </button>
                      ))}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {revision.preparaciones.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Preparaciones</h3>
            <div className="space-y-2">
              {revision.preparaciones.map((p, i) => (
                <div key={i} className="rounded-xl border border-neutral-200 p-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={incluir.preparaciones[i] ?? false}
                      disabled={Boolean(p.ya_existe)}
                      onChange={(e) => marcar('preparaciones', i, e.target.checked)}
                      aria-label={`Cargar ${p.nombre}`}
                      className="h-5 w-5 shrink-0"
                    />
                    <input
                      value={borrador.preparaciones[i]?.nombre ?? ''}
                      onChange={(e) => cambiar((b) => (b.preparaciones[i].nombre = e.target.value))}
                      className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm font-medium"
                      aria-label="Nombre"
                    />
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 pl-6">
                    <span className="text-xs text-neutral-500">rinde</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      value={borrador.preparaciones[i]?.rinde ?? ''}
                      onChange={(e) => cambiar((b) => (b.preparaciones[i].rinde = Number(e.target.value)))}
                      className="w-20 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm tabular-nums"
                      aria-label="Cuánto rinde la tanda"
                    />
                    <select
                      value={borrador.preparaciones[i]?.unidad}
                      onChange={(e) => cambiar((b) => (b.preparaciones[i].unidad = e.target.value as UnidadFicha))}
                      className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
                      aria-label="Unidad"
                    >
                      {UNIDADES_FICHA.map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </div>
                  {p.ya_existe && <p className="mt-1 text-xs text-neutral-500">Ya existe como «{p.ya_existe}»: no se cambia.</p>}
                  <p className="mt-1 text-xs text-neutral-500">Lo que lleva la tanda:</p>
                  {filasDeLineas(
                    p.lineas,
                    (j, l) =>
                      cambiar((b) => {
                        if (l) b.preparaciones[i].lineas[j] = l
                        else b.preparaciones[i].lineas.splice(j, 1)
                      }),
                    () => cambiar((b) => b.preparaciones[i].lineas.push(lineaNueva())),
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {revision.recetas.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Recetas del menú</h3>
            <div className="space-y-2">
              {revision.recetas.map((r, i) => (
                <div key={i} className="rounded-xl border border-neutral-200 p-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={incluir.recetas[i] ?? false}
                      onChange={(e) => marcar('recetas', i, e.target.checked)}
                      aria-label={`Cargar la receta de ${r.producto}`}
                      className="h-5 w-5 shrink-0"
                    />
                    <select
                      value={r.variante_id ?? ''}
                      onChange={(e) =>
                        cambiar((b) => (b.recetas[i].variante_id = e.target.value ? Number(e.target.value) : null))
                      }
                      className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm font-medium"
                      aria-label="Producto del menú"
                    >
                      <option value="">— ¿A qué producto del menú va «{r.producto}»? —</option>
                      {revision.variantes.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.nombre}
                        </option>
                      ))}
                    </select>
                    {r.tiene_receta && <Pastilla tono="ojo">ya tiene receta: se reemplaza</Pastilla>}
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">Lo que lleva uno:</p>
                  {filasDeLineas(
                    r.lineas,
                    (j, l) =>
                      cambiar((b) => {
                        if (l) b.recetas[i].lineas[j] = l
                        else b.recetas[i].lineas.splice(j, 1)
                      }),
                    () => cambiar((b) => b.recetas[i].lineas.push(lineaNueva())),
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
        <p className="text-xs text-neutral-400">
          Todo nace sin stock: lo que hay se carga con el conteo físico o entra con la compra.
          {revision.lector === 'prueba' && ' (Lector de prueba: siempre devuelve el mismo ejemplo.)'}
        </p>
      </div>
    </Modal>
  )
}
