import { useEffect, useMemo, useRef, useState } from 'react'
import { Aviso, Boton, Modal, Seccion } from '../../../components/ui'
import { useDialogo } from '../../../components/dialogo'
import { api } from '../../../lib/api'
import { fmtBs } from '../../../lib/moneda'
import type { DetalleExtracto, EstadoConciliacion, LineaConciliacion, SugerenciaRegla } from '../../../lib/types'

/**
 * Conciliación bancaria (Contabilidad, 23-oct), al estilo de Odoo.
 *
 * Se sube el estado de cuenta y cada movimiento queda explicado: los cobros
 * del sistema se reconocen solos; lo que se repite (comisiones, el ITF) lo
 * explica una REGLA; «Registrar en contabilidad» asienta lo que proponen las
 * reglas, y lo demás se resuelve a mano. Nada se asienta solo
 * (ver backend/app/conciliacion_bancaria.py).
 */

const ESTADOS: Record<string, { texto: string; clase: string }> = {
  cobro: { texto: 'Cobro del sistema', clase: 'bg-exito-50 text-exito-700' },
  registrado: { texto: 'Registrado', clase: 'bg-exito-50 text-exito-700' },
  propuesta: { texto: 'Por registrar', clase: 'bg-acento-50 text-acento-700' },
  pendiente: { texto: 'Pendiente', clase: 'bg-aviso-50 text-aviso-700' },
  ignorado: { texto: 'Ignorado', clase: 'bg-neutral-100 text-neutral-600' },
}
const SENTIDOS: Record<string, string> = { cargo: 'un cargo', abono: 'un abono', ambos: 'cargo o abono' }
const POR_PAGINA = 80

type Borrador = { id?: number; nombre: string; contiene: string; sentido: 'cargo' | 'abono' | 'ambos'; cuenta: string }

function dia(iso: string | null | undefined) {
  if (!iso) return ''
  const [a, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${a.slice(2)}`
}

export default function ConciliacionBancaria() {
  const dialogo = useDialogo()
  const entrada = useRef<HTMLInputElement>(null)
  const [estado, setEstado] = useState<EstadoConciliacion | null>(null)
  const [detalle, setDetalle] = useState<DetalleExtracto | null>(null)
  const [filtro, setFiltro] = useState<string>('pendiente')
  const [ver, setVer] = useState(POR_PAGINA)
  const [ocupado, setOcupado] = useState('')
  const [error, setError] = useState('')
  const [regla, setRegla] = useState<Borrador | null>(null)

  const cargar = async (abrir?: number) => {
    const e = await api.conciliacion()
    setEstado(e)
    // El que se estaba viendo, si sigue existiendo; si no, el mas reciente.
    const vivo = (x?: number) => (x && e.extractos.some((z) => z.id === x) ? x : undefined)
    const id = vivo(abrir) ?? vivo(detalle?.id) ?? e.extractos[0]?.id
    setDetalle(id ? await api.extracto(id) : null)
  }

  useEffect(() => {
    void cargar().catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo abrir la conciliación.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hacer = async (que: string, accion: () => Promise<DetalleExtracto | void>) => {
    setOcupado(que)
    setError('')
    try {
      const d = await accion()
      if (d) setDetalle(d)
      await cargar(d ? d.id : undefined)
    } catch (e) {
      // En una ventana: el boton que fallo puede estar muy abajo, lejos del
      // aviso de arriba.
      void dialogo.avisar({ titulo: 'No se pudo', texto: e instanceof Error ? e.message : 'No se pudo.', tono: 'mal' })
    } finally {
      setOcupado('')
    }
  }

  const subir = (archivo: File | undefined) => {
    if (!archivo) return
    void hacer('subir', async () => {
      const d = await api.subirExtracto(archivo)
      setFiltro('pendiente')
      return d
    })
    if (entrada.current) entrada.current.value = ''
  }

  const cuentas = useMemo(
    () => Object.entries(detalle?.cuentas ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    [detalle?.cuentas],
  )
  const lineas = useMemo(
    () => (detalle?.lineas ?? []).filter((l) => filtro === 'todos' || l.estado === filtro),
    [detalle, filtro],
  )
  const propuestas = detalle?.resumen.find((r) => r.estado === 'propuesta')?.movimientos ?? 0

  const registrarTodo = async () => {
    if (!detalle) return
    const ok = await dialogo.confirmar({
      titulo: `¿Registrar ${propuestas} movimiento(s) en contabilidad?`,
      texto: 'Cada uno lleva su asiento contra la cuenta del banco, en dólares a la tasa BCV de su día. Se pueden ver en Asientos.',
    })
    if (ok) void hacer('registrar', () => api.registrarExtracto(detalle.id))
  }

  const guardarRegla = () => {
    if (!regla) return
    const datos = { nombre: regla.nombre, contiene: regla.contiene, sentido: regla.sentido, cuenta: regla.cuenta }
    void hacer('regla', async () => {
      if (regla.id) await api.editarReglaBanco(regla.id, datos)
      else await api.crearReglaBanco(datos)
      setRegla(null)
    })
  }

  const desdeSugerencia = (s: SugerenciaRegla) =>
    setRegla({ nombre: '', contiene: s.contiene, sentido: s.sentido as Borrador['sentido'], cuenta: s.cuenta || '6070' })
  const desdeLinea = (l: LineaConciliacion) =>
    setRegla({
      nombre: '',
      contiene: l.concepto.split(/\s+/).slice(0, 2).join(' '),
      sentido: l.monto < 0 ? 'cargo' : 'abono',
      cuenta: l.monto < 0 ? '6070' : '4040',
    })

  return (
    <div className="flex flex-col gap-4">
      <Seccion
        titulo="Conciliación bancaria"
        ayuda="Sube el estado de cuenta (PDF o Excel de tu banco). Los cobros del sistema se reconocen solos; lo que se repite cada mes, como las comisiones, lo explica una regla; y lo demás lo resuelves aquí."
      >
        <div className="flex flex-wrap items-center gap-3">
          <input ref={entrada} type="file" accept=".pdf,.csv,.xlsx,.txt" className="hidden" onChange={(e) => subir(e.target.files?.[0])} />
          <Boton onClick={() => entrada.current?.click()} disabled={!!ocupado}>
            {ocupado === 'subir' ? 'Leyendo…' : 'Subir estado de cuenta'}
          </Boton>
          {estado && estado.extractos.length > 0 && (
            <select
              value={detalle?.id ?? ''}
              onChange={(e) => void hacer('abrir', () => api.extracto(Number(e.target.value)))}
              className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm min-w-0 max-w-full"
            >
              {estado.extractos.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.banco} · {dia(x.desde)} al {dia(x.hasta)} · {x.pendientes ? `${x.pendientes} por resolver` : 'conciliado'}
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Lee el PDF del Provincial, Banesco, Venezolano y Mercantil, y el Excel o CSV de cualquier banco. Subir el mismo estado dos veces no duplica nada.
        </p>
        {error && (
          <div className="mt-3">
            <Aviso tono="mal">{error}</Aviso>
          </div>
        )}
      </Seccion>

      {detalle && (
        <>
          <Seccion titulo={`${detalle.banco} · ${dia(detalle.desde)} al ${dia(detalle.hasta)}`}>
            <div className="flex flex-col gap-3">
              <div>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="font-semibold">{detalle.conciliado_pct.toLocaleString('es-VE')} % conciliado</span>
                  <span className="text-neutral-500">
                    {detalle.movimientos} movimientos{detalle.saldo_final != null && ` · saldo final ${fmtBs(detalle.saldo_final)}`}
                  </span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-neutral-100 overflow-hidden">
                  <div className="h-full bg-exito-500 rounded-full" style={{ width: `${detalle.conciliado_pct}%` }} />
                </div>
              </div>
              {!detalle.resumen.some((r) => r.estado === 'registrado' && r.movimientos > 0) && (
                <button
                  type="button"
                  className="self-start text-xs text-peligro-700 underline underline-offset-2"
                  onClick={() =>
                    void dialogo
                      .confirmar({
                        titulo: '¿Quitar este estado de cuenta?',
                        texto: 'Se borran sus movimientos de la conciliación. No tiene nada registrado en contabilidad.',
                        peligro: true,
                      })
                      .then((ok) => {
                        if (!ok) return
                        setDetalle(null)
                        void hacer('quitar', async () => {
                          await api.borrarExtracto(detalle.id)
                        })
                      })
                  }
                >
                  Quitar este estado de cuenta
                </button>
              )}
              {detalle.descuadres > 0 && (
                <Aviso tono="ojo">
                  {detalle.descuadres} renglón(es) del PDF no cuadran con el saldo del banco: puede faltar alguno. Si los números no te
                  cierran, súbelo en Excel.
                </Aviso>
              )}
              <div className="flex flex-wrap gap-2">
                {detalle.resumen
                  .filter((r) => r.movimientos > 0)
                  .map((r) => (
                    <button
                      key={r.estado}
                      type="button"
                      onClick={() => {
                        setFiltro(r.estado)
                        setVer(POR_PAGINA)
                      }}
                      aria-pressed={filtro === r.estado}
                      className={`rounded-xl px-3 py-2 text-left text-sm border ${
                        filtro === r.estado ? 'border-neutral-900' : 'border-transparent'
                      } ${ESTADOS[r.estado]?.clase ?? ''}`}
                    >
                      <span className="block font-semibold">
                        {r.movimientos} · {ESTADOS[r.estado]?.texto}
                      </span>
                      <span className="block text-xs tabular-nums opacity-80">{fmtBs(r.total_bs)}</span>
                    </button>
                  ))}
                <button
                  type="button"
                  onClick={() => setFiltro('todos')}
                  aria-pressed={filtro === 'todos'}
                  className={`rounded-xl px-3 py-2 text-sm border ${filtro === 'todos' ? 'border-neutral-900' : 'border-neutral-200'}`}
                >
                  Todos
                </button>
              </div>
              {propuestas > 0 && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl bg-acento-50 px-3 py-2.5">
                  <span className="text-sm flex-1 min-w-[12rem]">
                    {propuestas} movimiento(s) ya saben a qué cuenta van. Falta registrarlos en contabilidad.
                  </span>
                  <Boton onClick={() => void registrarTodo()} disabled={!!ocupado}>
                    {ocupado === 'registrar' ? 'Registrando…' : 'Registrar en contabilidad'}
                  </Boton>
                </div>
              )}
            </div>
          </Seccion>

          {detalle.sugerencias.length > 0 && (
            <Seccion titulo="Se repite mucho" ayuda="Lo que más aparece entre lo pendiente. Una regla lo explica este mes y todos los que vengan.">
              <ul className="flex flex-col divide-y divide-neutral-500/10">
                {detalle.sugerencias.map((s) => (
                  <li key={s.contiene + s.sentido} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="min-w-0 flex-1 text-sm">
                      <span className="font-semibold">«{s.contiene}»</span> · {s.veces} {s.sentido === 'cargo' ? 'cargos' : 'abonos'} ·{' '}
                      <span className="tabular-nums">{fmtBs(s.total_bs)}</span>
                      <span className="block text-xs text-neutral-500 truncate">Ej.: {s.ejemplo}</span>
                    </span>
                    <Boton tono="suave" onClick={() => desdeSugerencia(s)}>
                      Crear regla
                    </Boton>
                  </li>
                ))}
              </ul>
            </Seccion>
          )}

          <Seccion titulo="Movimientos">
            {lineas.length === 0 ? (
              <p className="text-sm text-neutral-500">Nada en este grupo.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-neutral-500/10">
                {lineas.slice(0, ver).map((l) => (
                  <Movimiento
                    key={l.id}
                    l={l}
                    cuentas={cuentas}
                    nombreCuenta={detalle.cuentas[l.cuenta]}
                    ocupado={!!ocupado}
                    onCuenta={(cuenta) => void hacer('linea', () => api.accionLinea(l.id, 'cuenta', cuenta))}
                    onIgnorar={() => void hacer('linea', () => api.accionLinea(l.id, 'ignorar'))}
                    onPendiente={() => void hacer('linea', () => api.accionLinea(l.id, 'pendiente'))}
                    onRegla={() => desdeLinea(l)}
                  />
                ))}
              </ul>
            )}
            {lineas.length > ver && (
              <button type="button" className="mt-2 text-sm underline underline-offset-2" onClick={() => setVer((v) => v + POR_PAGINA)}>
                Ver {Math.min(POR_PAGINA, lineas.length - ver)} más (de {lineas.length})
              </button>
            )}
          </Seccion>
        </>
      )}

      <Seccion
        titulo="Reglas"
        ayuda="«Si el concepto dice esto y es un cargo (o abono), va a esta cuenta.» Se aplican a todo lo pendiente apenas se guardan; registrar sigue siendo tu decisión."
      >
        <div className="flex flex-col gap-2">
          {estado?.reglas.length === 0 && <p className="text-sm text-neutral-500">Todavía no hay reglas.</p>}
          {estado?.reglas.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm py-1.5">
              <span className="min-w-0 flex-1">
                Si dice <b>«{r.contiene}»</b> y es {SENTIDOS[r.sentido]} → <b>{r.cuenta}</b> {detalle?.cuentas[r.cuenta] ?? ''}
              </span>
              <button
                type="button"
                className="text-xs underline underline-offset-2"
                onClick={() => setRegla({ id: r.id, nombre: r.nombre, contiene: r.contiene, sentido: r.sentido as Borrador['sentido'], cuenta: r.cuenta })}
              >
                Editar
              </button>
              <button
                type="button"
                className="text-xs text-peligro-700 underline underline-offset-2"
                onClick={() =>
                  void dialogo
                    .confirmar({ titulo: `¿Borrar la regla «${r.contiene}»?`, texto: 'Lo que proponía vuelve a pendiente; lo ya registrado se queda.', peligro: true })
                    .then((ok) => {
                      if (ok) void hacer('regla', () => api.borrarReglaBanco(r.id).then(() => undefined))
                    })
                }
              >
                Borrar
              </button>
            </div>
          ))}
          {!regla && (
            <div>
              <Boton tono="suave" icono="mas" onClick={() => setRegla({ nombre: '', contiene: '', sentido: 'cargo', cuenta: '6070' })}>
                Nueva regla
              </Boton>
            </div>
          )}
          {/* En una ventana y no al fondo de la pagina: «Crear regla» se toca
              desde un movimiento que puede estar quinientos renglones arriba. */}
          {regla && (
            <Modal
              titulo={regla.id ? 'Editar regla' : 'Nueva regla'}
              onCerrar={() => setRegla(null)}
              pie={
                <div className="flex gap-2 w-full">
                  <Boton tono="suave" onClick={() => setRegla(null)}>
                    Cancelar
                  </Boton>
                  <Boton onClick={guardarRegla} disabled={regla.contiene.trim().length < 2 || !!ocupado} ancho>
                    {ocupado === 'regla' ? 'Guardando…' : 'Guardar y aplicar'}
                  </Boton>
                </div>
              }
            >
            <div className="flex flex-col gap-3 text-sm">
              <div className="grid gap-2 ">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-neutral-500">Si el concepto dice</span>
                  <input
                    value={regla.contiene}
                    onChange={(e) => setRegla({ ...regla, contiene: e.target.value })}
                    placeholder="COMIS"
                    className="rounded-lg border border-neutral-200 bg-white px-3 py-2"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-neutral-500">y es</span>
                  <select
                    value={regla.sentido}
                    onChange={(e) => setRegla({ ...regla, sentido: e.target.value as Borrador['sentido'] })}
                    className="rounded-lg border border-neutral-200 bg-white px-2 py-2"
                  >
                    <option value="cargo">un cargo</option>
                    <option value="abono">un abono</option>
                    <option value="ambos">cargo o abono</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-neutral-500">va a la cuenta</span>
                  <select
                    value={regla.cuenta}
                    onChange={(e) => setRegla({ ...regla, cuenta: e.target.value })}
                    className="rounded-lg border border-neutral-200 bg-white px-2 py-2 min-w-0"
                  >
                    {(cuentas.length ? cuentas : [['6070', 'Comisiones y gastos bancarios'] as [string, string]]).map(([c, n]) => (
                      <option key={c} value={c}>
                        {c} {n}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
              <p className="text-xs text-neutral-500">
                Se aplica de una vez a todo lo pendiente. Registrar en contabilidad sigue siendo tu decisión.
              </p>
            </Modal>
          )}
        </div>
      </Seccion>
    </div>
  )
}

function Movimiento({
  l,
  cuentas,
  nombreCuenta,
  ocupado,
  onCuenta,
  onIgnorar,
  onPendiente,
  onRegla,
}: {
  l: LineaConciliacion
  cuentas: [string, string][]
  nombreCuenta?: string
  ocupado: boolean
  onCuenta: (cuenta: string) => void
  onIgnorar: () => void
  onPendiente: () => void
  onRegla: () => void
}) {
  const e = ESTADOS[l.estado] ?? ESTADOS.pendiente
  const abierto = l.estado === 'pendiente' || l.estado === 'propuesta'
  return (
    <li className="py-2.5 flex flex-col gap-1.5">
      <div className="flex items-baseline gap-3">
        <span className="text-xs text-neutral-500 tabular-nums shrink-0 w-[4.2rem]">{dia(l.fecha)}</span>
        <span className="min-w-0 flex-1 text-sm break-words">{l.concepto || '(sin concepto)'}</span>
        <span className={`tabular-nums whitespace-nowrap font-semibold text-sm ${l.monto < 0 ? 'text-peligro-700' : 'text-exito-700'}`}>
          {fmtBs(l.monto)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-0 sm:pl-[5rem]">
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${e.clase}`}>{e.texto}</span>
        {l.detalle && <span className="text-xs text-neutral-500">{l.detalle}</span>}
        {l.cuenta && (l.estado === 'propuesta' || l.estado === 'registrado') && (
          <span className="text-xs text-neutral-600">
            → {l.cuenta} {nombreCuenta}
            {l.monto_usd != null && ` · $${l.monto_usd.toFixed(2)}`}
          </span>
        )}
        {abierto && (
          <span className="flex flex-wrap items-center gap-2 ml-auto">
            <select
              value=""
              disabled={ocupado}
              onChange={(ev) => ev.target.value && onCuenta(ev.target.value)}
              className="rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs max-w-[11rem]"
              aria-label="Mandar a una cuenta"
            >
              <option value="">A una cuenta…</option>
              {cuentas.map(([c, n]) => (
                <option key={c} value={c}>
                  {c} {n}
                </option>
              ))}
            </select>
            <button type="button" className="text-xs underline underline-offset-2" onClick={onRegla} disabled={ocupado}>
              Crear regla
            </button>
            <button type="button" className="text-xs text-neutral-500 underline underline-offset-2" onClick={onIgnorar} disabled={ocupado}>
              Ignorar
            </button>
          </span>
        )}
        {l.estado === 'ignorado' && (
          <button type="button" className="text-xs underline underline-offset-2 ml-auto" onClick={onPendiente} disabled={ocupado}>
            Volver a pendiente
          </button>
        )}
      </div>
    </li>
  )
}
