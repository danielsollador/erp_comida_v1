import { Text, View } from 'react-native'
import { useTema } from '../../lib/tema'
import type { PuntoTasa } from '../../lib/tipos'
import { Pastilla } from '../kit'
import { Ficha } from '../ui'
import { num } from '../reportes/cuentas'
import { Variacion } from '../reportes/Grafico'
import { TablaDatos } from '../reportes/Tabla'
import { Cabeza, estilos } from './comunes'

/** "11/10/2026", como la web en es-VE. */
const fecha = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

/**
 * EL HISTORIAL, como la seccion de pages/Tasa.tsx: la tasa de cada dia del
 * periodo, con el cambio contra el dia con tasa anterior (no contra "ayer":
 * el BCV no publica fines de semana y el lunes se compara con el viernes).
 * Subir es rojo: para quien cobra al oficial y repone en divisas, un dolar
 * mas caro es malo. Se ordena tocando los titulos, como en la web.
 */
export default function Historial({ historial }: { historial: PuntoTasa[] }) {
  const t = useTema()
  // fecha -> % contra el dia con tasa inmediatamente anterior.
  const cambioDiario = new Map<string, number>()
  const enOrden = [...historial].sort((a, b) => a.fecha.localeCompare(b.fecha))
  enOrden.forEach((x, i) => {
    const previo = enOrden[i - 1]
    if (previo && previo.bcv) cambioDiario.set(x.fecha, (x.bcv / previo.bcv - 1) * 100)
  })

  return (
    <Ficha style={{ gap: 10 }}>
      <Cabeza
        titulo="Historial"
        texto="Cada pedido cobrado guarda la tasa de su día, así el reporte en bolívares de la semana pasada no cambia cuando la tasa se mueve."
      />
      {historial.length === 0 ? (
        <Text style={[estilos.texto, { color: t.tenue, textAlign: 'center', paddingVertical: 18 }]}>Todavía no hay tasas registradas.</Text>
      ) : (
        <TablaDatos<PuntoTasa>
          filas={historial}
          claveFila={(x) => x.fecha}
          ordenInicial="-fecha"
          columnas={[
            { clave: 'fecha', titulo: 'Fecha', ancho: 108, orden: (x) => x.fecha, celda: (x) => fecha(x.fecha) },
            { clave: 'oficial', titulo: 'Oficial', ancho: 92, derecha: true, fuerte: true, orden: (x) => x.bcv, celda: (x) => num(x.bcv) },
            {
              clave: 'variacion',
              titulo: 'Cambio',
              ancho: 84,
              derecha: true,
              orden: (x) => cambioDiario.get(x.fecha) ?? 0,
              celda: (x) => <Variacion pct={cambioDiario.get(x.fecha) ?? null} invertir />,
            },
            { clave: 'euro', titulo: 'Euro', ancho: 96, derecha: true, orden: (x) => x.eur, celda: (x) => (x.eur ? num(x.eur) : '—'), color: () => t.suave },
            {
              clave: 'paralelo',
              titulo: 'Paralelo',
              ancho: 100,
              derecha: true,
              orden: (x) => x.paralelo,
              celda: (x) => (x.paralelo ? num(x.paralelo) : '—'),
              color: () => t.suave,
            },
            {
              clave: 'origen',
              titulo: 'Origen',
              ancho: 92,
              derecha: true,
              orden: (x) => x.origen,
              celda: (x) => (<View style={{ alignSelf: 'flex-end' }}><Pastilla texto={x.origen === 'manual' ? 'manual' : 'auto'} tono={x.origen === 'manual' ? 'ojo' : 'neutro'} /></View>),
            },
          ]}
        />
      )}
    </Ficha>
  )
}
