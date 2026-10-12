import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { etiquetaMetodo } from '../../../../frontend/src/lib/pagos'
import { apiCaja } from '../../lib/api-caja'
import { bolivares, dolares } from '../../lib/formato'
import { useMoneda } from '../../lib/moneda'
import { aNumero } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import type { CierreCaja, ResumenCaja } from '../../lib/tipos'
import { CampoNumero, HojaFormulario } from '../kit'
import { Aviso, Boton, Campo } from '../ui'
import { conteosDe, contadosIniciales, EN_BOLIVARES, fechaVE } from './logica'
import { Enlace, mensajeDe } from './piezas'

/**
 * 5. CONTAR. Un numero por forma de pago (CuadrarCaja de la web).
 *
 * CIEGO a proposito: quien cuenta no ve lo que el sistema espera. Si lo ve,
 * el numero esperado deja de ser una verificacion y pasa a ser la respuesta
 * que hay que teclear. Se puede destapar, porque a veces el dueño cuenta su
 * propia caja y solo quiere confirmar; al corregir viene destapado.
 *
 * Cada forma se teclea EN SU MONEDA, con la moneda grande en el nombre: el
 * punto y el pago movil se miran en bolivares, el Zelle en dolares, y
 * teclear uno en la moneda del otro es el descuadre mas comun (Leider,
 * 21-sep). Por eso aqui las cifras van en $ o en Bs fijos y no siguen la
 * moneda elegida arriba: es la moneda del billete o del lote, no una vista.
 *
 * Sin "¿estas seguro?" aparte, igual que la web: esta hoja ES la
 * confirmacion, y un cierre mal contado se corrige despues.
 */
export function CuadrarCaja({
  resumen,
  corregir,
  dia,
  alCerrar,
  alListo,
}: {
  resumen: ResumenCaja
  /** El id del cierre que se esta corrigiendo, o null si es uno nuevo. */
  corregir: number | null
  dia: string
  alCerrar: () => void
  alListo: (c: CierreCaja) => void
}) {
  const t = useTema()
  const { tasa } = useMoneda()
  const bcv = tasa?.bcv ?? 0
  const [contados, setContados] = useState<Record<string, string>>(() => contadosIniciales(resumen.desglose, bcv))
  const [verEsperado, setVerEsperado] = useState(Boolean(corregir))
  const [nota, setNota] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const aCuadrar = resumen.desglose.filter((l) => l.se_cuadra)
  const conteos = conteosDe(aCuadrar, contados, bcv)

  async function cerrar() {
    if (conteos.length === 0 || guardando) return
    setGuardando(true)
    setError('')
    try {
      alListo(
        corregir
          ? await apiCaja.corregirCierre(corregir, conteos, { fecha: dia, nota })
          : await apiCaja.cerrar(conteos, { fecha: dia, nota }),
      )
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo cerrar la caja'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <HojaFormulario
      visible
      alCerrar={alCerrar}
      titulo={corregir ? 'Corregir el conteo' : 'Contar la caja'}
      subtitulo={
        corregir
          ? 'Cambia lo que quedó mal tecleado. El cierre viejo queda anulado con su rastro y se guarda este.'
          : 'Escribe lo que hay DE VERDAD en cada sitio. Lo que dejes en blanco no se verifica.'
      }
      pie={
        <>
          <View style={{ flex: 1 }}>
            <Boton texto="Cancelar" tono="neutro" alTocar={alCerrar} />
          </View>
          <View style={{ flex: 1.3 }}>
            <Boton
              texto={corregir ? 'Guardar el conteo' : 'Cerrar y conciliar'}
              alTocar={cerrar}
              ocupado={guardando}
              deshabilitado={conteos.length === 0}
            />
          </View>
        </>
      }
    >
      {error ? <Aviso texto={error} tono="peligro" /> : null}
      {!resumen.es_hoy ? <Aviso texto={`Estás cuadrando el día ${fechaVE(dia)}, no hoy.`} tono="aviso" /> : null}

      {aCuadrar.map((l) => {
        const enBs = EN_BOLIVARES.has(l.metodo)
        const texto = (contados[l.metodo] ?? '').trim()
        const escrito = aNumero(texto)
        return (
          <View key={l.metodo} style={[c.forma, { borderColor: t.gris200, backgroundColor: t.superficie }]}>
            <View style={c.cabeza}>
              <Text style={[c.nombre, { color: t.tinta }]}>
                {etiquetaMetodo(l.metodo)}
                <Text style={[c.moneda, { color: enBs ? t.aviso : t.exito }]}>{enBs ? '  en Bs' : '  en $'}</Text>
              </Text>
              <Text style={[c.pista, { color: t.tenue }]}>{l.fisico ? 'cuenta los billetes' : 'mira el lote o el banco'}</Text>
            </View>
            <CampoNumero
              valor={contados[l.metodo] ?? ''}
              alCambiar={(v) => setContados((a) => ({ ...a, [l.metodo]: v }))}
              prefijo={enBs ? 'Bs' : '$'}
              placeholder={enBs ? 'Cuánto, en bolívares' : 'Cuánto, en dólares'}
              accessibilityLabel={`${etiquetaMetodo(l.metodo)}, ${enBs ? 'en bolívares' : 'en dólares'}`}
            />
            {enBs && bcv <= 0 ? <Text style={[c.pista, { color: t.peligro }]}>Sin tasa del día no se puede convertir.</Text> : null}
            {/* El equivalente en la otra moneda, para que se note de una si se
                teclearon dolares donde iban bolivares. */}
            {texto !== '' && Number.isFinite(escrito) && bcv > 0 ? (
              <Text style={[c.cifra, { color: t.suave }]}>{enBs ? `son ${dolares(escrito / bcv)}` : `son ${bolivares(escrito * bcv)}`}</Text>
            ) : null}
            {/* Destapado, queda DEBAJO del campo ya escrito: sirve para
                confirmar, no para copiar. En la moneda del campo. */}
            {verEsperado ? (
              <Text style={[c.pista, { color: t.suave }]}>
                El sistema dice{' '}
                <Text style={c.cifra}>{enBs && bcv > 0 ? bolivares(l.esperado * bcv) : dolares(l.esperado)}</Text>
              </Text>
            ) : null}
          </View>
        )
      })}

      <View style={{ alignSelf: 'flex-start', marginVertical: -6 }}>
        <Enlace
          tono="neutro"
          texto={verEsperado ? 'Ocultar lo que dice el sistema' : 'Ver lo que dice el sistema'}
          alTocar={() => setVerEsperado((v) => !v)}
        />
      </View>
      <Campo value={nota} onChangeText={setNota} placeholder="Nota (opcional): por qué faltó, quién contó…" />
    </HojaFormulario>
  )
}

const c = StyleSheet.create({
  forma: { borderWidth: 1, borderRadius: 20, padding: 14, gap: 8 },
  cabeza: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  nombre: { fontFamily: LETRA.textoFuerte, fontSize: 16 },
  moneda: { fontFamily: LETRA.textoFuerte, fontSize: 13 },
  pista: { fontFamily: LETRA.texto, fontSize: 13 },
  cifra: { fontFamily: LETRA.cifra, fontSize: 13.5 },
})
