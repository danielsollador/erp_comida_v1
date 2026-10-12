import * as DocumentPicker from 'expo-document-picker'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { apiPreparaciones } from '../../lib/api-preparaciones'
import { descargar, formularioConArchivo } from '../../lib/archivos'
import { avisar } from '../../lib/dialogo'
import { LETRA, useTema } from '../../lib/tema'
import type { PlanillaLeida } from '../../lib/tipos'
import { Caja, Enlace, mensajeDe } from '../preparaciones/piezas'

/**
 * LA PLANILLA DE PAPEL, IDA Y VUELTA (como el conteo de la web): se descarga
 * en blanco (CSV, sin la columna de lo que el sistema espera, a proposito),
 * el trabajador la llena en el inventario, y vuelve por aqui. Subirla NO
 * guarda nada: rellena las casillas para revisarlas en pantalla y se guarda
 * con el mismo boton de siempre, que es el que sabe asentar cada diferencia.
 *
 * En el telefono, descargar abre el menu de compartir (WhatsApp, Drive,
 * Archivos); subir abre el selector de archivos del sistema.
 */
export function AccionesPlanilla({
  alLeer,
  alFallar,
}: {
  alLeer: (r: PlanillaLeida) => void
  alFallar: (mensaje: string) => void
}) {
  const [leyendo, setLeyendo] = useState(false)

  async function bajar() {
    try {
      await descargar(apiPreparaciones.rutaPlanilla, 'planilla-de-conteo.csv')
    } catch (e) {
      await avisar('No se pudo descargar el archivo', mensajeDe(e, 'Intenta otra vez.'))
    }
  }

  async function subir() {
    if (leyendo) return
    const elegido = await DocumentPicker.getDocumentAsync({
      // Un CSV llega con nombres distintos segun quien lo guardo (Excel, el
      // administrador de archivos de Android): se aceptan todos esos.
      type: ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel', 'application/octet-stream'],
      copyToCacheDirectory: true,
    })
    if (elegido.canceled || !elegido.assets[0]) return
    const archivo = elegido.assets[0]
    setLeyendo(true)
    try {
      const datos = await formularioConArchivo('archivo', {
        uri: archivo.uri,
        nombre: archivo.name || 'planilla.csv',
        tipo: archivo.mimeType || 'text/csv',
      })
      alLeer(await apiPreparaciones.leerPlanilla(datos))
    } catch (e) {
      alFallar(mensajeDe(e, 'No se pudo leer la planilla'))
    } finally {
      setLeyendo(false)
    }
  }

  return (
    <View style={s.acciones}>
      <Enlace texto="Descargar planilla" tono="acento" alTocar={() => void bajar()} />
      <Enlace texto={leyendo ? 'Leyendo la planilla…' : 'Subir planilla llena'} tono="acento" alTocar={() => void subir()} />
    </View>
  )
}

/** Lo que el sistema entendio de la planilla: cuantos renglones, los avisos y lo que no pudo leer. */
export function PlanillaLeidaCaja({ leido }: { leido: PlanillaLeida }) {
  const t = useTema()
  const conAviso = leido.filas.filter((f) => f.aviso)
  return (
    <Caja estilo={{ gap: 6 }}>
      <Text style={[s.texto, { color: t.tinta }]}>
        Se leyeron <Text style={{ fontFamily: LETRA.textoFuerte }}>{leido.filas.length}</Text> renglón(es) de la planilla
        {leido.en_blanco > 0 ? `, ${leido.en_blanco} en blanco que no se tocan` : ''}.
        {leido.filas.length > 0 ? ' Revísalos abajo y guarda.' : ''}
      </Text>
      {conAviso.map((f) => (
        <Text key={f.ingrediente_id} style={[s.texto, { color: t.avisoFuerte }]}>
          • {f.nombre}: {f.aviso}
        </Text>
      ))}
      {leido.errores.map((e) => (
        <Text key={e} style={[s.texto, { color: t.peligro }]}>
          • {e}
        </Text>
      ))}
    </Caja>
  )
}

const s = StyleSheet.create({
  acciones: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16 },
  texto: { fontFamily: LETRA.texto, fontSize: 14, lineHeight: 20 },
})
