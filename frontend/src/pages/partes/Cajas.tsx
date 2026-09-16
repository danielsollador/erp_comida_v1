import { useEffect, useState } from 'react'
import { useDialogo } from '../../components/dialogo'
import { Aviso, Seccion } from '../../components/ui'
import { api } from '../../lib/api'
import type { PuntoVenta } from '../../lib/types'

/**
 * Las cajas fisicas del local: una gaveta por piso.
 *
 * Vivia en el modulo "Sistema", que se quito por no significar nada para
 * quien atiende un restaurante. Su sitio natural es Cierre de caja: una caja
 * se crea para poder cerrarla aparte, y es ahi donde se echa de menos.
 *
 * Quien atiende ya no se carga aqui: cada persona entra con su usuario y el
 * sistema lo anota solo en cada pedido, anulacion, retiro y cierre.
 */
export default function Cajas() {
  const [puntos, setPuntos] = useState<PuntoVenta[]>([])
  const [error, setError] = useState('')
  const dialogo = useDialogo()

  useEffect(() => {
    cargar()
  }, [])

  function cargar() {
    api.listarPuntosVenta().then(setPuntos).catch(() => {})
  }

  async function agregar() {
    const nombre = await dialogo.pedirTexto({
      titulo: 'Nueva caja',
      etiqueta: 'Nombre de la caja',
      placeholder: 'Piso 2',
    })
    if (!nombre?.trim()) return
    setError('')
    try {
      await api.crearPuntoVenta(nombre.trim())
      cargar()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <>
      {error && <Aviso>{error}</Aviso>}
      <Seccion
        titulo="Cajas del local"
        ayuda="Con dos pisos hay dos gavetas y cada una cierra la suya. Quien cobra queda registrado solo, con el usuario con el que entró."
        accion={
          <button onClick={agregar} className="text-sm font-medium text-acento-600">
            + Agregar
          </button>
        }
      >
        <div className="flex flex-wrap gap-2">
          {puntos.map((pv) => (
            <span key={pv.id} className="rounded-full bg-neutral-100 px-3 py-1 text-sm">
              {pv.nombre}
            </span>
          ))}
          {puntos.length === 0 && <span className="text-sm text-neutral-400">Una sola caja.</span>}
        </div>
      </Seccion>
    </>
  )
}
