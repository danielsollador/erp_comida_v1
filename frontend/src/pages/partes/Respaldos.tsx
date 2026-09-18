import { useEffect, useRef, useState } from 'react'
import { useDialogo } from '../../components/dialogo'
import { Tabla, Th, useOrden } from '../../components/Tabla'
import { Boton, Modal } from '../../components/ui'
import { api } from '../../lib/api'
import type {
  EstadoRespaldos,
  PrevisualizacionRestauracion,
  Respaldo,
  Restauracion,
} from '../../lib/types'

/** Respaldo elegido para restaurar, con lo que se pierde ya calculado. */
type Candidato = { respaldo: Respaldo; previo: PrevisualizacionRestauracion }

/**
 * Los respaldos de la base: generarlos, bajarlos y restaurar.
 *
 * Vivian en el modulo "Sistema", que se quito. La copia automatica cada pocas
 * horas NO depende de esta pantalla --corre en el servidor-- pero restaurar
 * si: es la palanca de emergencia el dia que algo se rompe, y no puede quedar
 * sin ninguna puerta. Va en Contabilidad porque es el modulo del que
 * administra el negocio, que es justo quien restaura.
 */
export default function Respaldos() {
  const [respaldos, setRespaldos] = useState<Respaldo[]>([])
  // El mas reciente primero: es el que se restaura en el 99% de los casos.
  const orden = useOrden<Respaldo>(
    { fecha: (r) => new Date(r.creado_en), tamano: (r) => r.tamano_kb },
    '-fecha',
  )
  const [estado, setEstado] = useState<EstadoRespaldos | null>(null)
  const [creando, setCreando] = useState(false)
  const [candidato, setCandidato] = useState<Candidato | null>(null)
  const [restaurando, setRestaurando] = useState(false)
  const [hecho, setHecho] = useState<Restauracion | null>(null)
  const [error, setError] = useState('')
  const dialogo = useDialogo()
  const archivoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    cargar()
  }, [])

  function cargar() {
    api.listarRespaldos().then(setRespaldos).catch(() => {})
    api.estadoRespaldos().then(setEstado).catch(() => {})
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
    <>
        {/* Restaurar deja la caja del dia descuadrada: la plata fisica es la de
            ahora, la base volvio a hace unas horas. Hay que decirlo, no
            esconderlo detras de un "listo". */}
        {(hecho || estado?.restauracion_reciente) && (
          <div className="rounded-2xl border border-acento-200 bg-acento-50 p-4">
            <h2 className="font-semibold text-acento-900">Se restauró un respaldo</h2>
            {(() => {
              const r = hecho ?? estado!.restauracion_reciente!
              return (
                <>
                  <p className="text-sm text-acento-900 mt-1">
                    {new Date(r.fecha).toLocaleString('es-VE')} · desde {r.restaurado_desde}
                  </p>
                  <p className="text-sm text-acento-900 mt-1">
                    {r.pedidos_perdidos == null
                      ? 'No se pudo medir cuánto se perdió.'
                      : `Se perdieron ${r.pedidos_perdidos} pedido(s) por $${(r.monto_perdido ?? 0).toFixed(2)}.`}{' '}
                    Vuelve a cargar las ventas que se hicieron después, o el cierre de caja de
                    hoy va a dar un faltante que no es faltante.
                  </p>
                  <p className="text-xs text-acento-700 mt-1">
                    La base que había antes quedó guardada como {r.respaldo_previo}.
                  </p>
                </>
              )
            })()}
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-peligro-200 bg-peligro-50 p-4 text-sm text-peligro-800">
            {error}
          </div>
        )}

        <div
          className={`rounded-2xl border p-4 ${
            horasDesdeUltimo !== null && horasDesdeUltimo <= 8
              ? 'bg-exito-50 border-exito-200'
              : 'bg-aviso-50 border-aviso-200'
          }`}
        >
          <h2 className="font-semibold mb-1">Respaldo de la base de datos</h2>
          <p className="text-sm text-neutral-700">
            {ultimo
              ? `Último respaldo hace ${horasDesdeUltimo} hora(s), automático.`
              : 'Todavía no hay respaldos generados.'}
          </p>
          {estado?.dia_mas_viejo && (
            <p className="text-sm text-neutral-700">
              {estado.cantidad} copias guardadas. Puedes volver atras hasta el{' '}
              {new Date(estado.dia_mas_viejo).toLocaleDateString('es-VE')}.
            </p>
          )}
          <p className="text-xs text-neutral-500 mt-1">
            El sistema guarda una copia sola cada pocas horas y conserva la última de cada día
            del último mes. Eso protege contra corrupción o borrado accidental en esta misma
            máquina.
          </p>
        </div>

        {/* La copia dentro de la maquina no salva de perder la maquina. Esto
            es lo unico que si, y antes nadie llevaba la cuenta de si se hacia. */}
        <div
          className={`rounded-2xl border p-4 ${
            descargaVencida ? 'bg-peligro-50 border-peligro-200' : 'bg-white border-neutral-200'
          }`}
        >
          <h2 className="font-semibold mb-1">Copia fuera de esta maquina</h2>
          <p className="text-sm text-neutral-700">
            {estado?.dias_sin_descargar == null
              ? 'Nunca se ha bajado un respaldo de aqui.'
              : estado.dias_sin_descargar === 0
                ? 'Bajaste una copia hoy.'
                : `Hace ${estado.dias_sin_descargar} día(s) que no bajas una copia.`}
          </p>
          <p className="text-xs text-neutral-500 mt-1">
            Si la laptop se pierde, se moja o se la roban, los respaldos de arriba se pierden
            con ella. Baja el último respaldo una vez por semana y guárdalo en un USB, tu
            correo o tu teléfono.
            {estado?.copia_externa && ` Además se copia solo a ${estado.copia_externa}.`}
          </p>
        </div>

        <button
          onClick={crearAhora}
          disabled={creando}
          className="w-full bg-neutral-900 text-white rounded-2xl py-3 font-medium disabled:opacity-50"
        >
          {creando ? 'Generando...' : 'Generar respaldo ahora'}
        </button>

        <Tabla orden={orden} glosario="respaldos" className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
              <tr>
                <Th clave="fecha">Fecha</Th>
                <Th clave="tamano" alinear="derecha">Tamaño</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {orden.ordenar(respaldos).map((r) => (
                <tr key={r.nombre} className="border-t border-neutral-100">
                  <td className="p-3">{new Date(r.creado_en).toLocaleString('es-VE')}</td>
                  <td className="text-right p-3 tabular-nums">{r.tamano_kb} KB</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <a
                      href={`/api/respaldos/${r.nombre}/descargar`}
                      onClick={() => setTimeout(cargar, 1500)}
                      className="text-acento-600 font-medium"
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
                    Sin respaldos todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Tabla>

        {/* Si murio el disco, la lista de arriba esta vacia y el unico respaldo
            que existe es el que alguien se llevo en el telefono. */}
        <div className="bg-white rounded-2xl border border-neutral-200 p-4">
          <h2 className="font-semibold mb-1">Restaurar desde un archivo</h2>
          <p className="text-xs text-neutral-500 mb-3">
            Si esta máquina es nueva o se formateó, busca aquí el respaldo que tengas guardado
            en el USB, el correo o el teléfono.
          </p>
          <input
            ref={archivoRef}
            type="file"
            accept=".db"
            disabled={restaurando}
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (
                f &&
                (await dialogo.confirmar({
                  titulo: `¿Restaurar desde ${f.name}?`,
                  texto: 'La base actual se reemplaza. Lo vendido después de ese respaldo se pierde.',
                  aceptar: 'Restaurar',
                  peligro: true,
                }))
              ) {
                subir(f)
              } else if (archivoRef.current) {
                archivoRef.current.value = ''
              }
            }}
            className="text-sm w-full"
          />
        </div>

      {candidato && (
        <Modal
          titulo="Restaurar este respaldo"
          ayuda={`Del ${new Date(candidato.respaldo.creado_en).toLocaleString('es-VE')}`}
          onCerrar={() => (restaurando ? null : setCandidato(null))}
          ancho="sm"
          pie={
            <>
              <Boton tono="suave" onClick={() => setCandidato(null)} disabled={restaurando}>
                Cancelar
              </Boton>
              <Boton tono="peligro-fuerte" onClick={confirmar} disabled={restaurando}>
                {restaurando ? 'Restaurando...' : 'Si, restaurar'}
              </Boton>
            </>
          }
        >

          {/* El dueno no decide viendo un nombre de archivo: decide viendo
              cuantos pedidos y cuanta plata desaparecen. */}
          <div className="mt-4 rounded-xl bg-aviso-50 border border-aviso-200 p-3 text-sm">
            {candidato.previo.pedidos_que_se_pierden == null ? (
              <p className="font-medium text-aviso-900">
                No se pudo calcular cuánto se pierde. Puede ser mucho: revisa las ventas de
                hoy antes de restaurar.
              </p>
            ) : candidato.previo.pedidos_que_se_pierden > 0 ? (
              <>
                <p className="font-medium text-aviso-900">
                  Vas a perder {candidato.previo.pedidos_que_se_pierden} pedido(s) por $
                  {(candidato.previo.monto_que_se_pierde ?? 0).toFixed(2)}.
                </p>
                <p className="text-aviso-800 mt-1">
                  Es todo lo cobrado después de{' '}
                  {candidato.previo.corte
                    ? new Date(candidato.previo.corte).toLocaleString('es-VE')
                    : 'el inicio'}
                  . También se pierden las compras, gastos y mermas de ese rato.
                </p>
              </>
            ) : (
              <p className="text-aviso-900">
                No hay ventas posteriores a este respaldo: no se pierden pedidos.
              </p>
            )}
          </div>

          <p className="text-xs text-neutral-500 mt-3">
            Antes de reemplazar, el sistema guarda una copia de la base actual. Si restaurar
            fue el error, se puede volver desde esa copia.
          </p>

        </Modal>
      )}
    </>
  )
}
