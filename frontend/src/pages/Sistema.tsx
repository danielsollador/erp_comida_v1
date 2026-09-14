import { useEffect, useRef, useState } from 'react'
import NavBar from '../components/NavBar'
import { api } from '../lib/api'
import type {
  EstadoRespaldos,
  Operador,
  PuntoVenta,
  PrevisualizacionRestauracion,
  Respaldo,
  Restauracion,
} from '../lib/types'

/** Respaldo elegido para restaurar, con lo que se pierde ya calculado. */
type Candidato = { respaldo: Respaldo; previo: PrevisualizacionRestauracion }

export default function Sistema() {
  const [respaldos, setRespaldos] = useState<Respaldo[]>([])
  const [estado, setEstado] = useState<EstadoRespaldos | null>(null)
  const [creando, setCreando] = useState(false)
  const [candidato, setCandidato] = useState<Candidato | null>(null)
  const [restaurando, setRestaurando] = useState(false)
  const [hecho, setHecho] = useState<Restauracion | null>(null)
  const [operadores, setOperadores] = useState<Operador[]>([])
  const [puntos, setPuntos] = useState<PuntoVenta[]>([])
  const [error, setError] = useState('')
  const archivoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    cargar()
  }, [])

  function cargar() {
    api.listarRespaldos().then(setRespaldos).catch(() => {})
    api.estadoRespaldos().then(setEstado).catch(() => {})
    api.listarOperadores().then(setOperadores).catch(() => {})
    api.listarPuntosVenta().then(setPuntos).catch(() => {})
  }

  async function agregarOperador() {
    const nombre = window.prompt('Nombre de quien atiende la caja')
    if (!nombre?.trim()) return
    setError('')
    try {
      await api.crearOperador(nombre.trim())
      cargar()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function quitarOperador(o: Operador) {
    if (!window.confirm(`Quitar a ${o.nombre}?

Sus pedidos y cierres siguen registrados a su nombre.`))
      return
    setError('')
    try {
      await api.desactivarOperador(o.id)
      cargar()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function agregarPunto() {
    const nombre = window.prompt('Nombre de la caja (ej. Piso 2)')
    if (!nombre?.trim()) return
    setError('')
    try {
      await api.crearPuntoVenta(nombre.trim())
      cargar()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function crearAhora() {
    setCreando(true)
    setError('')
    try {
      await api.crearRespaldo()
      cargar()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCreando(false)
    }
  }

  async function elegir(respaldo: Respaldo) {
    setError('')
    try {
      const previo = await api.previsualizarRestauracion(respaldo.nombre)
      setCandidato({ respaldo, previo })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function confirmar() {
    if (!candidato) return
    setRestaurando(true)
    setError('')
    try {
      const resultado = await api.restaurarRespaldo(candidato.respaldo.nombre)
      setCandidato(null)
      setHecho(resultado)
      cargar()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRestaurando(false)
    }
  }

  async function subir(archivo: File) {
    setRestaurando(true)
    setError('')
    try {
      const resultado = await api.restaurarDesdeArchivo(archivo)
      setHecho(resultado)
      cargar()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRestaurando(false)
      if (archivoRef.current) archivoRef.current.value = ''
    }
  }

  const ultimo = respaldos[0]
  const horasDesdeUltimo = ultimo
    ? Math.floor((Date.now() - new Date(ultimo.creado_en).getTime()) / 3600000)
    : null
  const descargaVencida =
    estado != null && (estado.dias_sin_descargar == null || estado.dias_sin_descargar >= 7)

  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Sistema" />
      <div className="p-4 max-w-2xl mx-auto space-y-5">
        {/* Restaurar deja la caja del dia descuadrada: la plata fisica es la de
            ahora, la base volvio a hace unas horas. Hay que decirlo, no
            esconderlo detras de un "listo". */}
        {(hecho || estado?.restauracion_reciente) && (
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
            <h2 className="font-semibold text-blue-900">Se restauro un respaldo</h2>
            {(() => {
              const r = hecho ?? estado!.restauracion_reciente!
              return (
                <>
                  <p className="text-sm text-blue-900 mt-1">
                    {new Date(r.fecha).toLocaleString('es-VE')} · desde {r.restaurado_desde}
                  </p>
                  <p className="text-sm text-blue-900 mt-1">
                    {r.pedidos_perdidos == null
                      ? 'No se pudo medir cuanto se perdio.'
                      : `Se perdieron ${r.pedidos_perdidos} pedido(s) por $${(r.monto_perdido ?? 0).toFixed(2)}.`}{' '}
                    Vuelve a cargar las ventas que se hicieron despues, o el cierre de caja de
                    hoy va a dar un faltante que no es faltante.
                  </p>
                  <p className="text-xs text-blue-700 mt-1">
                    La base que habia antes quedo guardada como {r.respaldo_previo}.
                  </p>
                </>
              )
            })()}
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* Quien atiende la caja. No es seguridad -no hay contrasenas- sino
            trazabilidad: antes el sistema era completamente anonimo y un
            pedido anulado o una gaveta mal contada no tenian nombre detras. */}
        <div className="rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">Quien atiende</h2>
            <button onClick={agregarOperador} className="text-sm font-medium text-blue-600">
              + Agregar
            </button>
          </div>
          <p className="text-xs text-neutral-500 mt-1">
            Se elige el turno una vez en el POS y queda registrado en cada pedido, anulacion,
            retiro y cierre de caja.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {operadores.map((o) => (
              <span
                key={o.id}
                className="flex items-center gap-2 rounded-full bg-neutral-100 px-3 py-1 text-sm"
              >
                {o.nombre}
                <button onClick={() => quitarOperador(o)} className="text-red-400 text-xs">
                  x
                </button>
              </span>
            ))}
            {operadores.length === 0 && (
              <span className="text-sm text-neutral-400">
                Nadie cargado todavia: los pedidos quedan sin nombre.
              </span>
            )}
          </div>

          <div className="mt-4 flex items-baseline justify-between">
            <h3 className="font-medium text-sm">Cajas</h3>
            <button onClick={agregarPunto} className="text-sm font-medium text-blue-600">
              + Agregar
            </button>
          </div>
          <p className="text-xs text-neutral-500 mt-1">
            Si el local tiene dos pisos, cada caja cuenta y cierra su propia gaveta.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {puntos.map((pv) => (
              <span key={pv.id} className="rounded-full bg-neutral-100 px-3 py-1 text-sm">
                {pv.nombre}
              </span>
            ))}
            {puntos.length === 0 && (
              <span className="text-sm text-neutral-400">Una sola caja.</span>
            )}
          </div>
        </div>

        <div
          className={`rounded-2xl border p-4 ${
            horasDesdeUltimo !== null && horasDesdeUltimo <= 8
              ? 'bg-emerald-50 border-emerald-200'
              : 'bg-amber-50 border-amber-200'
          }`}
        >
          <h2 className="font-semibold mb-1">Respaldo de la base de datos</h2>
          <p className="text-sm text-neutral-700">
            {ultimo
              ? `Ultimo respaldo hace ${horasDesdeUltimo} hora(s), automatico.`
              : 'Todavia no hay respaldos generados.'}
          </p>
          {estado?.dia_mas_viejo && (
            <p className="text-sm text-neutral-700">
              {estado.cantidad} copias guardadas. Puedes volver atras hasta el{' '}
              {new Date(estado.dia_mas_viejo).toLocaleDateString('es-VE')}.
            </p>
          )}
          <p className="text-xs text-neutral-500 mt-1">
            El sistema guarda una copia sola cada pocas horas y conserva la ultima de cada dia
            del ultimo mes. Eso protege contra corrupcion o borrado accidental en esta misma
            maquina.
          </p>
        </div>

        {/* La copia dentro de la maquina no salva de perder la maquina. Esto
            es lo unico que si, y antes nadie llevaba la cuenta de si se hacia. */}
        <div
          className={`rounded-2xl border p-4 ${
            descargaVencida ? 'bg-red-50 border-red-200' : 'bg-white border-neutral-200'
          }`}
        >
          <h2 className="font-semibold mb-1">Copia fuera de esta maquina</h2>
          <p className="text-sm text-neutral-700">
            {estado?.dias_sin_descargar == null
              ? 'Nunca se ha bajado un respaldo de aqui.'
              : estado.dias_sin_descargar === 0
                ? 'Bajaste una copia hoy.'
                : `Hace ${estado.dias_sin_descargar} dia(s) que no bajas una copia.`}
          </p>
          <p className="text-xs text-neutral-500 mt-1">
            Si la laptop se pierde, se moja o se la roban, los respaldos de arriba se pierden
            con ella. Baja el ultimo respaldo una vez por semana y guardalo en un USB, tu
            correo o tu telefono.
            {estado?.copia_externa && ` Ademas se copia solo a ${estado.copia_externa}.`}
          </p>
        </div>

        <button
          onClick={crearAhora}
          disabled={creando}
          className="w-full bg-neutral-900 text-white rounded-2xl py-3 font-medium disabled:opacity-50"
        >
          {creando ? 'Generando...' : 'Generar respaldo ahora'}
        </button>

        <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
              <tr>
                <th className="text-left p-3">Fecha</th>
                <th className="text-right p-3">Tamano</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {respaldos.map((r) => (
                <tr key={r.nombre} className="border-t border-neutral-100">
                  <td className="p-3">{new Date(r.creado_en).toLocaleString('es-VE')}</td>
                  <td className="text-right p-3 tabular-nums">{r.tamano_kb} KB</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <a
                      href={`/api/respaldos/${r.nombre}/descargar`}
                      onClick={() => setTimeout(cargar, 1500)}
                      className="text-blue-600 font-medium"
                    >
                      Descargar
                    </a>
                    <button
                      onClick={() => elegir(r)}
                      className="ml-3 text-neutral-600 font-medium"
                    >
                      Restaurar
                    </button>
                  </td>
                </tr>
              ))}
              {respaldos.length === 0 && (
                <tr>
                  <td colSpan={3} className="p-4 text-center text-neutral-400">
                    Sin respaldos todavia.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Si murio el disco, la lista de arriba esta vacia y el unico respaldo
            que existe es el que alguien se llevo en el telefono. */}
        <div className="bg-white rounded-2xl border border-neutral-200 p-4">
          <h2 className="font-semibold mb-1">Restaurar desde un archivo</h2>
          <p className="text-xs text-neutral-500 mb-3">
            Si esta maquina es nueva o se formateo, busca aqui el respaldo que tengas guardado
            en el USB, el correo o el telefono.
          </p>
          <input
            ref={archivoRef}
            type="file"
            accept=".db"
            disabled={restaurando}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f && confirm(`Restaurar desde ${f.name}? La base actual se reemplaza.`)) {
                subir(f)
              } else if (archivoRef.current) {
                archivoRef.current.value = ''
              }
            }}
            className="text-sm w-full"
          />
        </div>
      </div>

      {candidato && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-md p-5">
            <h3 className="font-semibold text-lg">Restaurar este respaldo</h3>
            <p className="text-sm text-neutral-600 mt-1">
              Del {new Date(candidato.respaldo.creado_en).toLocaleString('es-VE')}
            </p>

            {/* El dueno no decide viendo un nombre de archivo: decide viendo
                cuantos pedidos y cuanta plata desaparecen. */}
            <div className="mt-4 rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm">
              {candidato.previo.pedidos_que_se_pierden == null ? (
                <p className="font-medium text-amber-900">
                  No se pudo calcular cuanto se pierde. Puede ser mucho: revisa las ventas de
                  hoy antes de restaurar.
                </p>
              ) : candidato.previo.pedidos_que_se_pierden > 0 ? (
                <>
                  <p className="font-medium text-amber-900">
                    Vas a perder {candidato.previo.pedidos_que_se_pierden} pedido(s) por $
                    {(candidato.previo.monto_que_se_pierde ?? 0).toFixed(2)}.
                  </p>
                  <p className="text-amber-800 mt-1">
                    Es todo lo cobrado despues de{' '}
                    {candidato.previo.corte
                      ? new Date(candidato.previo.corte).toLocaleString('es-VE')
                      : 'el inicio'}
                    . Tambien se pierden las compras, gastos y mermas de ese rato.
                  </p>
                </>
              ) : (
                <p className="text-amber-900">
                  No hay ventas posteriores a este respaldo: no se pierden pedidos.
                </p>
              )}
            </div>

            <p className="text-xs text-neutral-500 mt-3">
              Antes de reemplazar, el sistema guarda una copia de la base actual. Si restaurar
              fue el error, se puede volver desde esa copia.
            </p>

            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setCandidato(null)}
                disabled={restaurando}
                className="flex-1 border border-neutral-300 rounded-xl py-3 font-medium disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmar}
                disabled={restaurando}
                className="flex-1 bg-red-600 text-white rounded-xl py-3 font-medium disabled:opacity-50"
              >
                {restaurando ? 'Restaurando...' : 'Si, restaurar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
