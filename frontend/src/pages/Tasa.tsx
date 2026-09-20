import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import { useSeccion } from '../components/Secciones'
import { FiltroFechas } from '../components/Fechas'
import { useRango } from '../lib/fechas'
import { Ayuda } from '../components/Ayuda'
import { explicar } from '../lib/glosario'
import { Tabla, Th, useOrden } from '../components/Tabla'
import { Lecturas, Pagina } from '../components/ui'
import { Numerico } from '../components/Teclado'
import { GraficoDona, GraficoLineas, Sparkline, Variacion } from '../components/Grafico'
import { api } from '../lib/api'
import { fmtBs, fmtNum, useMoneda } from '../lib/moneda'
import { etiquetaMetodo } from '../lib/pagos'
import type { AnalisisTasa, EstadoTasa, PuntoTasa } from '../lib/types'

// Los billetes con los que se cobra en el mostrador. La tasa a secas no le
// dice nada a nadie; "20 dolares son 17.000" si.
const BILLETES = [1, 5, 10, 20, 50, 100]

const SECCIONES = [
  { id: 'hoy', texto: 'Tasa de hoy' },
  { id: 'calculadora', texto: 'Calculadora' },
  { id: 'analisis', texto: 'Análisis' },
  { id: 'historial', texto: 'Historial' },
]

/**
 * Las tasas con las que se puede medir un mismo monto.
 *
 * POR QUE EXISTEN VARIAS. En Venezuela el precio se piensa en dolares pero se
 * cobra en bolivares, y no hay UN dolar: hay el del BCV --al que la ley obliga
 * a facturar-- y el del mercado, que es al que de verdad se repone la
 * mercancia. El euro entra porque muchos mayoristas cotizan en euros cuando el
 * cliente no tiene divisas.
 *
 * El dueño hace esta cuenta todos los dias de cabeza y con la calculadora del
 * telefono: "vendi $10 al BCV, eso fueron tantos bolivares, y esos bolivares
 * ¿cuanto son en Binance?". Aqui se hace sola y con las tasas del dia.
 */
const TASAS: { id: string; nombre: string; ayuda: string }[] = [
  { id: 'bcv', nombre: 'BCV (oficial)', ayuda: 'Al que hay que facturar' },
  { id: 'paralelo', nombre: 'Paralelo / Binance', ayuda: 'Al que se repone' },
  { id: 'eur', nombre: 'Euro BCV', ayuda: 'Al que cotizan algunos mayoristas' },
]

export default function Tasa() {
  const [seccion, irA] = useSeccion(SECCIONES)
  const [rango, setRango] = useRango('30d')
  const { recargar } = useMoneda()
  const [estado, setEstado] = useState<EstadoTasa | null>(null)
  const [historial, setHistorial] = useState<PuntoTasa[]>([])
  const [analisis, setAnalisis] = useState<AnalisisTasa | null>(null)
  // fecha -> % contra el dia con tasa inmediatamente anterior del historial.
  const cambioDiario = new Map<string, number>()
  {
    const enOrden = [...historial].sort((a, b) => a.fecha.localeCompare(b.fecha))
    enOrden.forEach((t, i) => {
      const previo = enOrden[i - 1]
      if (previo && previo.bcv) cambioDiario.set(t.fecha, (t.bcv / previo.bcv - 1) * 100)
    })
  }
  const orden = useOrden<PuntoTasa>(
    {
      fecha: (t) => t.fecha,
      oficial: (t) => t.bcv,
      euro: (t) => t.eur,
      paralelo: (t) => t.paralelo,
      origen: (t) => t.origen,
      variacion: (t) => cambioDiario.get(t.fecha) ?? 0,
    },
    '-fecha',
  )
  const [manual, setManual] = useState('')
  // La calculadora: cuanto, y en que se escribio. "bs" = bolivares; lo demas
  // es un monto en divisa medido a ESA tasa.
  const [montoCalc, setMontoCalc] = useState('10')
  const [enCalc, setEnCalc] = useState('bcv')
  // Los ultimos 30 dias con tasa, en orden, para la tendencia de "hoy". Se
  // piden aparte del historial porque ese sigue el filtro de fechas y la
  // tendencia no: siempre es "el ultimo mes".
  const [tendencia, setTendencia] = useState<PuntoTasa[]>([])
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    cargar()
  }, [rango])

  function cargar() {
    api.estadoTasa().then((e) => {
      setEstado(e)
      setManual(e.bcv ? String(e.bcv) : '')
    })
    api
      .historialTasa()
      .then((h) => setTendencia([...h].sort((a, b) => a.fecha.localeCompare(b.fecha))))
      .catch(() => setTendencia([]))
    api.historialTasa(rango).then(setHistorial)
    api.analisisTasa(rango).then(setAnalisis).catch(() => setAnalisis(null))
  }

  async function accion(fn: () => Promise<EstadoTasa>, mensaje: string) {
    setOcupado(true)
    setError('')
    setAviso('')
    try {
      const e = await fn()
      setEstado(e)
      setManual(e.bcv ? String(e.bcv) : '')
      setAviso(mensaje)
      recargar()
      api.historialTasa(rango).then(setHistorial)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar la tasa')
    } finally {
      setOcupado(false)
    }
  }

  function guardarManual() {
    const valor = Number(manual.replace(',', '.'))
    if (!valor || valor <= 0) {
      setError('Escribe una tasa válida, por ejemplo 145,80')
      return
    }
    accion(() => api.fijarTasa(valor), 'Tasa fijada. Los cobros de hoy usan esta.')
  }

  const esManual = estado?.origen === 'manual'
  // La tasa de hoy como numero suelto: dentro de un `map` TypeScript ya no
  // sabe que `estado.bcv` no es null aunque el bloque entero dependa de eso.
  const bcvHoy = estado?.bcv ?? 0

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Tasa de cambio" secciones={SECCIONES} seccion={seccion} alCambiarSeccion={irA} filtro={seccion === 'hoy' ? undefined : <FiltroFechas rango={rango} alCambiar={setRango} />} />
      <Pagina ancho="media">
        {error && <p className="text-peligro-600 text-sm">{error}</p>}
        {aviso && <p className="text-exito-700 text-sm">{aviso}</p>}

        {seccion === 'hoy' && (
          <>
        {/* --------- tasa vigente --------- */}
        <div className="bg-white rounded-2xl border border-neutral-200 p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h2 className="font-semibold">Tasa con la que se cobra hoy</h2>
              <p className="text-xs text-neutral-500 mt-0.5">
                Es la que convierte a bolívares en el punto de venta.
              </p>
            </div>
            <span
              className={`text-xs px-2.5 py-1 rounded-full font-medium shrink-0 ${
                esManual ? 'bg-aviso-100 text-aviso-700' : 'bg-exito-100 text-exito-700'
              }`}
            >
              {esManual ? 'Cargada a mano' : 'Automática'}
            </span>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold tabular-nums">
              {estado?.bcv ? fmtNum(estado.bcv) : '—'}
            </span>
            <span className="text-neutral-500">Bs por dólar</span>
          </div>

          {estado?.desactualizada && (
            <p className="text-aviso-600 text-sm mt-2">
              Esta tasa es del {new Date(estado.fecha + 'T00:00:00').toLocaleDateString('es-VE')}, no
              de hoy. Refresca o cárgala a mano.
            </p>
          )}

          <div className="vp-escalonado grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-neutral-100">
            <Dato
              titulo="Paralelo"
              ayuda="kpi.paralelo"
              valor={estado?.paralelo ? fmtNum(estado.paralelo) : '—'}
              nota="Binance P2P"
            />
            <Dato
              titulo="Euro BCV"
              ayuda="kpi.euro"
              valor={estado?.eur ? fmtNum(estado.eur) : '—'}
              nota="Bs por euro"
            />
            <Dato
              titulo="Brecha"
              ayuda="kpi.brecha"
              valor={estado?.brecha_pct != null ? `${estado.brecha_pct}%` : '—'}
              nota="paralelo vs oficial"
            />
            <Dato
              titulo="Última semana"
              ayuda="kpi.variacion_semana"
              valor={
                estado?.variacion_semana_pct != null
                  ? `${estado.variacion_semana_pct > 0 ? '+' : ''}${estado.variacion_semana_pct}%`
                  : '—'
              }
              nota="movimiento del oficial"
            />
          </div>

          {/* La tendencia debajo de la cifra: "va subiendo" o "va quieta" se
              ve sin abrir el analisis. Solo el oficial, que es con el que se
              cobra; lo demas esta en la pestaña de al lado. */}
          {tendencia.length >= 2 && (
            <div className="mt-4 pt-3 border-t border-neutral-100">
              <div className="flex items-baseline justify-between text-[11px] text-neutral-400 mb-1">
                <span>Últimos {tendencia.length} días con tasa</span>
                <span className="tabular-nums">
                  {fmtNum(tendencia[0].bcv)} → {fmtNum(tendencia[tendencia.length - 1].bcv)}
                </span>
              </div>
              <Sparkline valores={tendencia.map((t) => t.bcv)} color="var(--color-acento-500)" alto={44} />
            </div>
          )}

          <p className="text-xs text-neutral-400 mt-3">
            {estado?.en_vivo
              ? `Conectado a bcv.org.ve y Binance P2P${
                  estado.fuente_actualizada ? ` · fecha valor ${estado.fuente_actualizada}` : ''
                }`
              : 'Sin conexión a las fuentes ahora mismo. El local sigue cobrando con la última tasa conocida.'}
          </p>
        </div>

        {/* --------- billetes --------- */}
        {bcvHoy > 0 && estado && (
          <div className="bg-white rounded-2xl border border-neutral-200 p-5">
            <h2 className="font-semibold mb-1">Para cobrar rápido</h2>
            <p className="text-xs text-neutral-500 mb-3">
              Cuánto es cada billete a la tasa de hoy. El punto de venta ya convierte solo; esto es
              para el que pregunta "¿cuánto es en bolívares?" antes de pedir.
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {BILLETES.map((usd) => (
                <div key={usd} className="rounded-xl bg-neutral-50 border border-neutral-100 px-3 py-2 text-center">
                  <div className="text-xs text-neutral-500">${usd}</div>
                  <div className="text-sm font-semibold tabular-nums leading-tight">
                    {fmtNum(usd * bcvHoy, usd >= 20 ? 0 : 2)}
                  </div>
                </div>
              ))}
            </div>
            {estado.paralelo && estado.brecha_pct != null && (
              <p className="text-[11px] text-neutral-400 mt-3">
                Al paralelo, $20 serían {fmtNum(20 * estado.paralelo, 0)}: la brecha de {estado.brecha_pct}% es lo
                que se pierde al reponer comprando divisas con lo cobrado al oficial.
              </p>
            )}
          </div>
        )}

        {/* --------- controles --------- */}
        <div className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-4">
          <div>
            <h2 className="font-semibold mb-1">Cargar la tasa a mano</h2>
            <p className="text-xs text-neutral-500">
              Si cobras a una tasa propia -redondeada, la del proveedor, un punto medio- escríbela
              aquí. Manda sobre la automática y no se pisa hasta que la devuelvas a automático.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Numerico
              etiqueta="Tasa manual (Bs por $)"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="145,80"
              className="flex-1 border border-neutral-300 rounded-xl px-3 py-3 text-lg tabular-nums"
            />
            <button
              onClick={guardarManual}
              disabled={ocupado}
              className="bg-neutral-900 text-white rounded-xl px-5 font-medium disabled:opacity-50"
            >
              Fijar
            </button>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              onClick={() => accion(() => api.refrescarTasa(false), 'Tasas actualizadas.')}
              disabled={ocupado}
              className="bg-neutral-100 hover:bg-neutral-200 rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-50"
            >
              {ocupado ? 'Consultando...' : 'Consultar BCV ahora'}
            </button>
            {esManual && (
              <button
                onClick={() =>
                  accion(() => api.refrescarTasa(true), 'Volviste a la tasa automatica del BCV.')
                }
                disabled={ocupado}
                className="bg-neutral-100 hover:bg-neutral-200 rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-50"
              >
                Volver a la automática
              </button>
            )}
          </div>
        </div>
          </>
        )}

        {seccion === 'calculadora' && (
          <>
            {/* --------- el mismo dinero, medido con cada tasa ---------

                Es la cuenta que el dueño hace a diario con la calculadora del
                telefono: cobro en bolivares a la tasa que la ley me obliga a
                facturar, y repongo comprando divisas a otra. Mientras haya
                brecha, ese viaje de ida y vuelta pierde plata, y perderla sin
                verla es lo que termina descapitalizando el negocio.

                Se hace en el navegador y no en el servidor: son tres
                divisiones con tasas que ya estan en pantalla, y asi el
                resultado cambia mientras se teclea. */}
            {(() => {
              const tasas: Record<string, number | null | undefined> = {
                bcv: estado?.bcv,
                paralelo: estado?.paralelo,
                eur: estado?.eur,
              }
              const monto = Number(montoCalc.replace(',', '.'))
              const valido = Number.isFinite(monto) && monto > 0
              // Todo pasa por bolivares, que es la unica moneda en la que un
              // monto significa lo mismo mire quien lo mire.
              const bs = !valido
                ? 0
                : enCalc === 'bs'
                  ? monto
                  : monto * (tasas[enCalc] || 0)
              const disponibles = TASAS.filter((t) => (tasas[t.id] ?? 0) > 0)
              const bcv = estado?.bcv ?? 0
              const paralelo = estado?.paralelo ?? 0
              // Lo que se pierde en el viaje: cobrar al oficial y reponer al
              // de la calle. Solo tiene sentido con las dos tasas y con
              // brecha a favor del paralelo.
              const hayBrecha = bcv > 0 && paralelo > bcv
              const enBcv = bcv > 0 ? bs / bcv : 0
              const enParalelo = paralelo > 0 ? bs / paralelo : 0
              const perdida = hayBrecha ? enBcv - enParalelo : 0
              const perdidaPct = hayBrecha && enBcv > 0 ? (perdida / enBcv) * 100 : 0

              return (
                <>
                  <div className="bg-white rounded-2xl border border-neutral-200 p-5">
                    <h2 className="font-semibold mb-1">Pasar un monto de una tasa a otra</h2>
                    <p className="text-xs text-neutral-500 mb-4">
                      Escribe cuánto y con qué tasa lo estás midiendo. Abajo sale lo mismo medido
                      con las demás.
                    </p>
                    <div className="flex flex-wrap gap-2 mb-4">
                      <Numerico
                        etiqueta="Monto"
                        value={montoCalc}
                        onChange={(e) => setMontoCalc(e.target.value)}
                        placeholder="10"
                        className="flex-1 min-w-[120px] border border-neutral-300 rounded-xl px-3 py-3 text-lg tabular-nums"
                      />
                      <label className="flex-1 min-w-[160px]">
                        <span className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">
                          Medido en
                        </span>
                        <select
                          value={enCalc}
                          onChange={(e) => setEnCalc(e.target.value)}
                          className="w-full border border-neutral-300 rounded-xl px-3 py-3 text-sm"
                        >
                          <option value="bs">Bolívares</option>
                          {disponibles.map((t) => (
                            <option key={t.id} value={t.id}>
                              Dólares a {t.nombre}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {!valido || disponibles.length === 0 ? (
                      <p className="text-neutral-400 text-sm">
                        {disponibles.length === 0
                          ? 'Todavía no hay tasas cargadas. Consulta el BCV en "Tasa de hoy".'
                          : 'Escribe un monto para ver las equivalencias.'}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {/* Bolivares primero: es el pivote de todas las demas
                            y lo que de verdad pasa por la gaveta. */}
                        <div className="flex items-baseline justify-between gap-3 rounded-xl bg-neutral-900 text-neutral-50 px-4 py-3">
                          <span className="text-sm font-medium">En bolívares</span>
                          <span className="text-xl font-bold tabular-nums">{fmtBs(bs)}</span>
                        </div>
                        {disponibles.map((t) => {
                          const tasa = tasas[t.id] as number
                          const esEscrito = t.id === enCalc
                          return (
                            <div
                              key={t.id}
                              className={`flex items-baseline justify-between gap-3 rounded-xl px-4 py-3 ${
                                esEscrito
                                  ? 'bg-neutral-100 text-neutral-400'
                                  : 'bg-neutral-50'
                              }`}
                            >
                              <span className="min-w-0">
                                <span className="block text-sm font-medium truncate">
                                  {t.nombre}
                                </span>
                                <span className="block text-[11px] text-neutral-400 tabular-nums">
                                  {esEscrito ? 'lo que escribiste' : `${t.ayuda} · ${fmtNum(tasa, 2)} Bs`}
                                </span>
                              </span>
                              <span className="text-xl font-bold tabular-nums shrink-0">
                                ${fmtNum(bs / tasa, 2)}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* --------- lo que cuesta el viaje ---------
                      La cifra que el conversor de arriba deja implicita y
                      nadie calcula: cobrar al oficial y reponer al paralelo
                      no es neutro. */}
                  {valido && hayBrecha && (
                    <div className="bg-white rounded-2xl border border-neutral-200 p-5">
                      <h2 className="font-semibold mb-1">Si cobras esto al oficial y repones al paralelo</h2>
                      <p className="text-xs text-neutral-500 mb-4">
                        La ley te obliga a facturar a la tasa del BCV, pero la mercancía se repone
                        comprando divisas a la del mercado. Esa diferencia sale de tu margen, no del
                        de nadie más.
                      </p>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-neutral-600">Le cobras al cliente</span>
                          <span className="font-medium tabular-nums">
                            {fmtBs(bs)} (${fmtNum(enBcv, 2)} al BCV)
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-neutral-600">Con esos bolívares repones</span>
                          <span className="font-medium tabular-nums">${fmtNum(enParalelo, 2)}</span>
                        </div>
                        <div className="flex justify-between border-t border-neutral-200 pt-2 font-semibold">
                          <span>Se queda en la brecha</span>
                          <span className="tabular-nums text-peligro-600">
                            −${fmtNum(perdida, 2)} ({fmtNum(perdidaPct, 1)}%)
                          </span>
                        </div>
                      </div>
                      {/* El numero accionable: no "estas perdiendo", sino "a
                          cuanto tendrias que venderlo". Es lo que el dueño
                          puede hacer manana por la mañana. */}
                      <div className="mt-4 rounded-xl bg-acento-50 border border-acento-200 p-4">
                        <div className="text-xs font-semibold uppercase tracking-wide text-acento-700 mb-1">
                          Para que te queden ${fmtNum(enBcv, 2)} de verdad
                        </div>
                        <div className="text-2xl font-bold tabular-nums text-acento-900">
                          ${fmtNum(enBcv * (paralelo / bcv), 2)}
                        </div>
                        <p className="text-xs text-acento-800 mt-1.5">
                          Es lo mismo que multiplicar tu precio en dólares por{' '}
                          <strong className="tabular-nums">{fmtNum(paralelo / bcv, 3)}</strong> antes
                          de convertirlo a bolívares al BCV. Así, después de reponer, te queda el
                          margen que dice tu carta.
                        </p>
                      </div>
                      <p className="text-[11px] text-neutral-400 mt-3">
                        Lo cobrado en efectivo en dólares no pasa por aquí: esas divisas ya son
                        divisas y no pierden nada con la brecha. Por eso conviene tener precio en
                        divisas y cobrar en ellas cuando se pueda.
                      </p>
                    </div>
                  )}
                </>
              )
            })()}
          </>
        )}

        {seccion === 'analisis' && analisis && (
          <>
            {/* Las cuatro cifras del periodo. Las dos ultimas son la razon de
                ser de esta pantalla: convierten la brecha en plata. Van en
                dolares aunque arriba se este viendo en otra moneda, y se dice:
                la brecha ES cuanto valen en dolares los bolivares que cobras,
                asi que expresarla en bolivares seria dar la vuelta completa. */}
            <div className="vp-escalonado grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Dato
                titulo="Movimiento"
                ayuda="kpi.variacion_periodo"
                valor={
                  analisis.variacion_pct != null
                    ? `${analisis.variacion_pct > 0 ? '+' : ''}${analisis.variacion_pct}%`
                    : '—'
                }
                nota={
                  analisis.bcv_inicio && analisis.bcv_fin
                    ? `${fmtNum(analisis.bcv_inicio)} → ${fmtNum(analisis.bcv_fin)}`
                    : 'del oficial en el período'
                }
              />
              <Dato
                titulo="Brecha media"
                ayuda="kpi.brecha_media"
                valor={analisis.brecha_media_pct != null ? `${analisis.brecha_media_pct}%` : '—'}
                nota={
                  analisis.brecha_fin_pct != null ? `hoy ${analisis.brecha_fin_pct}%` : 'paralelo vs oficial'
                }
              />
              <Dato
                titulo="Cobrado en bolívares"
                ayuda="kpi.cobrado_bs"
                valor={`$${analisis.cobrado_bs_usd.toFixed(2)}`}
                nota="efectivo Bs, pago móvil, tarjeta · en $"
              />
              <Dato
                titulo="Se llevó la brecha"
                ayuda="kpi.costo_brecha"
                valor={`$${analisis.costo_brecha_usd.toFixed(2)}`}
                nota="al reponer comprando divisas · en $"
              />
              <Dato
                titulo="Expuesto a la brecha"
                ayuda="kpi.exposicion"
                valor={analisis.exposicion_pct != null ? `${analisis.exposicion_pct}%` : '—'}
                nota={
                  analisis.cobrado_total_usd > 0
                    ? `de $${analisis.cobrado_total_usd.toFixed(2)} cobrados entró en Bs`
                    : 'de lo cobrado entró en Bs'
                }
              />
              <Dato
                titulo="En 30 días, si sigue así"
                ayuda="kpi.proyeccion_30d"
                valor={analisis.proyeccion_30d != null ? fmtNum(analisis.proyeccion_30d) : '—'}
                nota={
                  analisis.proyeccion_30d_pct != null
                    ? `${analisis.proyeccion_30d_pct > 0 ? '+' : ''}${analisis.proyeccion_30d_pct}% · extrapolación`
                    : 'hacen falta 7 días de tasa'
                }
              />
            </div>

            <div className="bg-white rounded-2xl border border-neutral-200 p-5">
              <h2 className="font-semibold mb-1">Cómo se movió</h2>
              <p className="text-xs text-neutral-500 mb-4">
                {analisis.etiqueta} · {analisis.dias} día(s) con tasa guardada. Posa el cursor
                sobre el gráfico para ver un día concreto.
              </p>
              <GraficoLineas
                alto={220}
                etiquetas={analisis.puntos.map((p) =>
                  new Date(p.fecha + 'T00:00:00').toLocaleDateString('es-VE', {
                    day: '2-digit',
                    month: '2-digit',
                  }),
                )}
                formato={(n) => fmtNum(n, 0)}
                formatoDetalle={(n) => fmtNum(n, 2)}
                series={[
                  {
                    nombre: 'Dólar BCV',
                    color: 'var(--color-neutral-900)',
                    valores: analisis.puntos.map((p) => p.bcv),
                    relleno: true,
                  },
                  {
                    nombre: 'Paralelo',
                    color: 'var(--color-acento-500)',
                    valores: analisis.puntos.map((p) => p.paralelo),
                  },
                  {
                    nombre: 'Euro BCV',
                    color: 'var(--color-aviso-500)',
                    valores: analisis.puntos.map((p) => p.eur),
                    punteada: true,
                  },
                ]}
                pie={
                  analisis.bcv_min && analisis.bcv_max
                    ? `mínimo ${fmtNum(analisis.bcv_min)} · máximo ${fmtNum(analisis.bcv_max)}`
                    : undefined
                }
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {analisis.puntos.some((p) => p.brecha_pct != null) && (
                <div className="bg-white rounded-2xl border border-neutral-200 p-5">
                  <h2 className="font-semibold mb-1">La brecha, día a día</h2>
                  <p className="text-xs text-neutral-500 mb-4">
                    Cuánto más caro está el paralelo que el oficial. Es el porcentaje que se pierde de
                    cada bolívar cobrado al oficial.
                  </p>
                  <GraficoLineas
                    alto={160}
                    etiquetas={analisis.puntos.map((p) =>
                      new Date(p.fecha + 'T00:00:00').toLocaleDateString('es-VE', {
                        day: '2-digit',
                        month: '2-digit',
                      }),
                    )}
                    formato={(n) => `${n.toFixed(0)}%`}
                    formatoDetalle={(n) => `${n.toFixed(1)}%`}
                    series={[
                      {
                        nombre: 'Brecha',
                        color: 'var(--color-aviso-500)',
                        valores: analisis.puntos.map((p) => p.brecha_pct),
                        relleno: true,
                      },
                    ]}
                    pie={
                      analisis.brecha_media_pct != null ? `media del período ${analisis.brecha_media_pct}%` : undefined
                    }
                  />
                </div>
              )}

              {analisis.por_metodo_bs.length > 0 && (
                <div className="bg-white rounded-2xl border border-neutral-200 p-5">
                  <h2 className="font-semibold mb-1">Por dónde entran los bolívares</h2>
                  <p className="text-xs text-neutral-500 mb-3">
                    Lo cobrado en métodos en bolívares, en dólares. Lo que entró en divisas (
                    ${analisis.cobrado_divisas_usd.toFixed(2)}) no aparece: no lo toca la brecha.
                  </p>
                  <GraficoDona
                    formato={(n) => `$${n.toFixed(2)}`}
                    centro={{ valor: `$${analisis.cobrado_bs_usd.toFixed(0)}`, texto: 'en bolívares' }}
                    partes={analisis.por_metodo_bs.map((g) => ({ nombre: etiquetaMetodo(g.nombre), valor: g.monto }))}
                  />
                </div>
              )}
            </div>

            {analisis.equivalencias.length > 0 && analisis.bcv_inicio !== analisis.bcv_fin && (
              <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
                <div className="px-5 pt-4 pb-2">
                  <h2 className="font-semibold">Lo mismo, en billetes</h2>
                  <p className="text-xs text-neutral-500">
                    Cuántos bolívares eran al empezar el período y cuántos son hoy. Es la subida que el
                    cliente siente en la caja aunque el menú esté en dólares.
                  </p>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
                    <tr>
                      <th className="text-left p-3 font-medium">Billete</th>
                      <th className="text-right p-3 font-medium">Al empezar</th>
                      <th className="text-right p-3 font-medium">Hoy</th>
                      <th className="text-right p-3 font-medium">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analisis.equivalencias.map((e) => (
                      <tr key={e.usd} className="border-t border-neutral-100">
                        <td className="p-3 font-medium">${e.usd}</td>
                        <td className="text-right p-3 tabular-nums text-neutral-500">{fmtBs(e.bs_inicio, 0)}</td>
                        <td className="text-right p-3 tabular-nums font-medium">{fmtBs(e.bs_fin, 0)}</td>
                        <td className="text-right p-3 tabular-nums">
                          <Variacion pct={e.bs_inicio ? ((e.bs_fin / e.bs_inicio) - 1) * 100 : null} invertir />
                          <span className="text-xs text-neutral-400 ml-1">
                            {e.bs_fin - e.bs_inicio >= 0 ? '+' : ''}
                            {fmtNum(e.bs_fin - e.bs_inicio, 0)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div>
              <h2 className="font-semibold mb-2">Qué dice esto</h2>
              <Lecturas items={analisis.lecturas} />
            </div>
          </>
        )}

        {seccion === 'historial' && (
          <>
        {/* --------- historial --------- */}
        <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
          <div className="px-5 pt-4 pb-2">
            <h2 className="font-semibold">Historial</h2>
            <p className="text-xs text-neutral-500">
              Cada pedido cobrado guarda la tasa de su día, así el reporte en bolívares de la semana
              pasada no cambia cuando la tasa se mueve.
            </p>
          </div>
          <Tabla orden={orden} glosario="tasas">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
              <tr>
                <Th clave="fecha">Fecha</Th>
                <Th clave="oficial" alinear="derecha">Oficial</Th>
                <Th clave="variacion" alinear="derecha">Cambio</Th>
                <Th clave="euro" alinear="derecha">Euro</Th>
                <Th clave="paralelo" alinear="derecha">Paralelo</Th>
                <Th clave="origen" alinear="derecha">Origen</Th>
              </tr>
            </thead>
            <tbody>
              {orden.ordenar(historial).map((t) => (
                <tr key={t.fecha} className="border-t border-neutral-100">
                  <td className="p-3">
                    {new Date(t.fecha + 'T00:00:00').toLocaleDateString('es-VE')}
                  </td>
                  <td className="text-right p-3 tabular-nums font-medium">{fmtNum(t.bcv)}</td>
                  {/* Contra el dia con tasa anterior, no contra "ayer": el
                      BCV no publica fines de semana y el lunes se compara
                      con el viernes. Subir es rojo: para el que cobra al
                      oficial y repone en divisas, un dolar mas caro es malo. */}
                  <td className="text-right p-3">
                    <Variacion pct={cambioDiario.get(t.fecha) ?? null} invertir />
                  </td>
                  <td className="text-right p-3 tabular-nums text-neutral-500">
                    {t.eur ? fmtNum(t.eur) : '—'}
                  </td>
                  <td className="text-right p-3 tabular-nums text-neutral-500">
                    {t.paralelo ? fmtNum(t.paralelo) : '—'}
                  </td>
                  <td className="text-right p-3">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        t.origen === 'manual'
                          ? 'bg-aviso-100 text-aviso-700'
                          : 'bg-neutral-100 text-neutral-500'
                      }`}
                    >
                      {t.origen === 'manual' ? 'manual' : 'auto'}
                    </span>
                  </td>
                </tr>
              ))}
              {historial.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-neutral-400">
                    Todavía no hay tasas registradas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </Tabla>
        </div>
          </>
        )}
      </Pagina>
    </div>
  )
}

function Dato({ titulo, valor, nota, ayuda }: { titulo: string; valor: string; nota: string; ayuda?: string }) {
  return (
    <div>
      <div className="text-xs text-neutral-500">
        <Ayuda explica={explicar(ayuda)} titulo={titulo}>
          {titulo}
        </Ayuda>
      </div>
      <div className="text-lg font-semibold tabular-nums">{valor}</div>
      <div className="text-[11px] text-neutral-400">{nota}</div>
    </div>
  )
}
