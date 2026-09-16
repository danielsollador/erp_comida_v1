import { useEffect, useState } from 'react'
import NavBar from '../components/NavBar'
import { Ayuda } from '../components/Ayuda'
import { explicar } from '../lib/glosario'
import { Tabla, Th, useOrden } from '../components/Tabla'
import { Pagina } from '../components/ui'
import { api } from '../lib/api'
import { fmtNum, useMoneda } from '../lib/moneda'
import type { EstadoTasa, PuntoTasa } from '../lib/types'

export default function Tasa() {
  const { recargar } = useMoneda()
  const [estado, setEstado] = useState<EstadoTasa | null>(null)
  const [historial, setHistorial] = useState<PuntoTasa[]>([])
  const orden = useOrden<PuntoTasa>(
    {
      fecha: (t) => t.fecha,
      oficial: (t) => t.bcv,
      paralelo: (t) => t.paralelo,
      origen: (t) => t.origen,
    },
    '-fecha',
  )
  const [manual, setManual] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  useEffect(() => {
    cargar()
  }, [])

  function cargar() {
    api.estadoTasa().then((e) => {
      setEstado(e)
      setManual(e.bcv ? String(e.bcv) : '')
    })
    api.historialTasa(30).then(setHistorial)
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
      api.historialTasa(30).then(setHistorial)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar la tasa')
    } finally {
      setOcupado(false)
    }
  }

  function guardarManual() {
    const valor = Number(manual.replace(',', '.'))
    if (!valor || valor <= 0) {
      setError('Escribe una tasa valida, por ejemplo 145,80')
      return
    }
    accion(() => api.fijarTasa(valor), 'Tasa fijada. Los cobros de hoy usan esta.')
  }

  const esManual = estado?.origen === 'manual'

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Tasa de cambio" />
      <Pagina ancho="media">
        {/* --------- tasa vigente --------- */}
        <div className="bg-white rounded-2xl border border-neutral-200 p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h2 className="font-semibold">Tasa con la que se cobra hoy</h2>
              <p className="text-xs text-neutral-500 mt-0.5">
                Es la que convierte a bolivares en el punto de venta.
              </p>
            </div>
            <span
              className={`text-xs px-2.5 py-1 rounded-full font-medium shrink-0 ${
                esManual ? 'bg-aviso-100 text-aviso-700' : 'bg-exito-100 text-exito-700'
              }`}
            >
              {esManual ? 'Cargada a mano' : 'Automatica'}
            </span>
          </div>

          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold tabular-nums">
              {estado?.bcv ? fmtNum(estado.bcv) : '—'}
            </span>
            <span className="text-neutral-500">Bs por dolar</span>
          </div>

          {estado?.desactualizada && (
            <p className="text-aviso-600 text-sm mt-2">
              Esta tasa es del {new Date(estado.fecha + 'T00:00:00').toLocaleDateString('es-VE')}, no
              de hoy. Refresca o cargala a mano.
            </p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4 pt-4 border-t border-neutral-100">
            <Dato
              titulo="Paralelo"
              ayuda="kpi.paralelo"
              valor={estado?.paralelo ? fmtNum(estado.paralelo) : '—'}
              nota="Binance P2P"
            />
            <Dato
              titulo="Brecha"
              ayuda="kpi.brecha"
              valor={estado?.brecha_pct != null ? `${estado.brecha_pct}%` : '—'}
              nota="paralelo vs oficial"
            />
            <Dato
              titulo="Ultima semana"
              ayuda="kpi.variacion_semana"
              valor={
                estado?.variacion_semana_pct != null
                  ? `${estado.variacion_semana_pct > 0 ? '+' : ''}${estado.variacion_semana_pct}%`
                  : '—'
              }
              nota="movimiento del oficial"
            />
          </div>

          <p className="text-xs text-neutral-400 mt-3">
            {estado?.en_vivo
              ? `Conectado a bcv.org.ve y Binance P2P${
                  estado.fuente_actualizada ? ` · fecha valor ${estado.fuente_actualizada}` : ''
                }`
              : 'Sin conexion a las fuentes ahora mismo. El local sigue cobrando con la ultima tasa conocida.'}
          </p>
        </div>

        {error && <p className="text-peligro-600 text-sm">{error}</p>}
        {aviso && <p className="text-exito-700 text-sm">{aviso}</p>}

        {/* --------- controles --------- */}
        <div className="bg-white rounded-2xl border border-neutral-200 p-5 space-y-4">
          <div>
            <h2 className="font-semibold mb-1">Cargar la tasa a mano</h2>
            <p className="text-xs text-neutral-500">
              Si cobras a una tasa propia -redondeada, la del proveedor, un punto medio- escribela
              aqui. Manda sobre la automatica y no se pisa hasta que la devuelvas a automatico.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              inputMode="decimal"
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
                Volver a la automatica
              </button>
            )}
          </div>
        </div>

        {/* --------- historial --------- */}
        <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
          <div className="px-5 pt-4 pb-2">
            <h2 className="font-semibold">Historial</h2>
            <p className="text-xs text-neutral-500">
              Cada pedido cobrado guarda la tasa de su dia, asi el reporte en bolivares de la semana
              pasada no cambia cuando la tasa se mueve.
            </p>
          </div>
          <Tabla orden={orden} glosario="tasas">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
              <tr>
                <Th clave="fecha">Fecha</Th>
                <Th clave="oficial" alinear="derecha">Oficial</Th>
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
                  <td colSpan={4} className="p-4 text-center text-neutral-400">
                    Todavia no hay tasas registradas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </Tabla>
        </div>
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
