import { useEffect, useRef, useState } from 'react'
import { registrarSalvaguardas, type PideFirma } from '../lib/api'
import type { Autorizacion } from '../lib/types'
import Autorizar from './Autorizar'
import { useDialogo } from './dialogo'
import { Boton, Modal } from './ui'

/**
 * Lo que el servidor pide antes de guardar algo que mueve plata, mostrado en
 * la misma pantalla donde se estaba (ver lib/api.ts y backend/salvaguardas.py):
 * una pregunta ("¿seguro? es cinco veces lo normal") o la firma de quien
 * autoriza, con PIN o pidiendo permiso a su aplicacion. Se monta una vez.
 */
export default function Salvaguardas() {
  const { confirmar } = useDialogo()
  const [pedida, setPedida] = useState<PideFirma | null>(null)
  const [firma, setFirma] = useState<Autorizacion | null>(null)
  const resolver = useRef<((a: Autorizacion | null) => void) | null>(null)

  useEffect(() => {
    registrarSalvaguardas({
      confirmar: (p) =>
        confirmar({
          titulo: p.clave === 'repetido' ? '¿Registrarlo otra vez?' : '¿Seguro?',
          texto: p.mensaje,
          aceptar: p.clave === 'repetido' ? 'Sí, es otro' : 'Sí, guardar',
          cancelar: p.clave === 'repetido' ? 'No, fue un doble toque' : 'Revisar',
          peligro: true,
        }),
      firma: (p) =>
        new Promise((r) => {
          resolver.current = r
          setFirma(null)
          setPedida(p)
        }),
    })
    return () => registrarSalvaguardas({})
  }, [confirmar])

  function cerrar(a: Autorizacion | null) {
    resolver.current?.(a)
    resolver.current = null
    setPedida(null)
  }

  if (!pedida) return null
  return (
    <Modal
      titulo="Hace falta una firma"
      onCerrar={() => cerrar(null)}
      ancho="sm"
      pie={
        <div className="flex justify-end gap-2">
          <Boton tono="suave" onClick={() => cerrar(null)}>
            Cancelar
          </Boton>
          <Boton disabled={!firma} onClick={() => cerrar(firma)}>
            Firmar y seguir
          </Boton>
        </div>
      }
    >
      <p className="text-sm text-neutral-700 mb-3">{pedida.detalle}</p>
      {pedida.error && <p className="text-sm text-peligro-600 mb-3">{pedida.error} Prueba otra vez.</p>}
      <Autorizar key={pedida.error ?? 'primera'} accion={pedida.accion} detalle={pedida.detalle} monto={pedida.monto} onCambio={setFirma} />
    </Modal>
  )
}
