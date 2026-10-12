import { useState } from 'react'
import { View } from 'react-native'
import { miles } from '../../lib/formato'
import { BotonChico, bajar, mensajeDe } from '../contabilidad/piezas'
import { Boton, Problema } from '../ui'

/** Un monto en Bs para el libro: sin símbolo (el rótulo ya lo dice), o un guion. */
export function bs(monto: number | null | undefined): string {
  return monto === null || monto === undefined ? '-' : miles(monto, 2)
}

/**
 * Las dos descargas de un libro: la planilla del SENIAT (.xlsx, el boton
 * principal) y el CSV en dolares. En el telefono el archivo sale al menu de
 * compartir (WhatsApp, Drive, correo); en el navegador, la descarga de
 * siempre.
 */
export function Descargas({
  seniat,
  csv,
}: {
  seniat: { ruta: string; nombre: string }
  csv: { ruta: string; nombre: string }
}) {
  const [bajando, setBajando] = useState<'' | 'seniat' | 'csv'>('')
  const [error, setError] = useState('')

  async function bajarUno(cual: 'seniat' | 'csv') {
    const d = cual === 'seniat' ? seniat : csv
    setBajando(cual)
    setError('')
    try {
      await bajar(d.ruta, d.nombre)
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo descargar el libro'))
    } finally {
      setBajando('')
    }
  }

  return (
    <View style={{ gap: 6 }}>
      <Boton
        texto="Descargar libro (formato SENIAT)"
        icono="factura"
        alTocar={() => bajarUno('seniat')}
        ocupado={bajando === 'seniat'}
        deshabilitado={bajando !== ''}
      />
      <View style={{ alignItems: 'center' }}>
        <BotonChico texto="CSV en dólares" tono="enlace" alTocar={() => bajarUno('csv')} ocupado={bajando === 'csv'} deshabilitado={bajando !== ''} />
      </View>
      {error ? <Problema mensaje={error} /> : null}
    </View>
  )
}

/** "2026-10-01_2026-10-31": el periodo en el nombre del archivo, para no pisar el de otro mes. */
export function tramoDeArchivo(desde: string, hasta: string): string {
  return desde === hasta ? desde : `${desde}_${hasta}`
}
