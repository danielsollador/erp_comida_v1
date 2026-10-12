import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { apiImpuestos } from '../../lib/api-impuestos'
import { aNumero, sinRuido } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import type { ConfiguracionFiscal } from '../../lib/tipos'
import { mensajeDe, p } from '../contabilidad/piezas'
import Icono from '../Icono'
import { CampoNumero, HojaFormulario } from '../kit'
import { Aviso, Boton, Campo, Etiqueta, Ficha, Interruptor, Nota } from '../ui'

/**
 * LOS DATOS FISCALES de quien lleva los libros: la cabecera de los libros
 * del SENIAT, la alicuota del IVA y si el negocio es agente de retencion. En
 * la web es un formulario fijo arriba de cada seccion; en el telefono se ve
 * en un renglon (razon social · RIF · IVA) y se edita en una hoja, para que
 * los libros, que son lo que se viene a ver, queden a la vista.
 */
export default function DatosFiscales({
  config,
  alGuardar,
}: {
  config: ConfiguracionFiscal | null
  alGuardar: (c: ConfiguracionFiscal) => void
}) {
  const t = useTema()
  const [abierto, setAbierto] = useState(false)
  const [guardado, setGuardado] = useState(false)

  const resumen = config
    ? [config.razon_social || 'Sin razón social', config.rif || 'sin RIF', `IVA ${sinRuido(config.tasa_iva)} %`].join(' · ')
    : '…'

  return (
    <>
      <Pressable
        onPress={() => config && setAbierto(true)}
        accessibilityRole="button"
        accessibilityLabel="Datos fiscales"
        style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.985 : 1 }] }]}
      >
        <Ficha style={estilos.ficha}>
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <Etiqueta>Datos fiscales</Etiqueta>
            <Text style={[estilos.resumen, { color: t.tinta }]} numberOfLines={2}>
              {resumen}
            </Text>
            {config?.agente_retencion ? <Nota>Agente de retención de IVA</Nota> : null}
          </View>
          <Icono nombre="chevron" size={15} color={t.tenue} grosor={2.2} />
        </Ficha>
      </Pressable>
      {guardado ? <Aviso texto="Guardado" /> : null}
      {config ? (
        <Formulario
          key={abierto ? 'abierto' : 'cerrado'}
          visible={abierto}
          config={config}
          alCerrar={() => setAbierto(false)}
          alGuardar={(c) => {
            setAbierto(false)
            alGuardar(c)
            setGuardado(true)
            setTimeout(() => setGuardado(false), 2000)
          }}
        />
      ) : null}
    </>
  )
}

function Formulario({
  visible,
  config,
  alCerrar,
  alGuardar,
}: {
  visible: boolean
  config: ConfiguracionFiscal
  alCerrar: () => void
  alGuardar: (c: ConfiguracionFiscal) => void
}) {
  const t = useTema()
  const [razonSocial, setRazonSocial] = useState(config.razon_social ?? '')
  const [rif, setRif] = useState(config.rif ?? '')
  const [tasa, setTasa] = useState(sinRuido(config.tasa_iva))
  const [direccion, setDireccion] = useState(config.direccion ?? '')
  const [agente, setAgente] = useState(Boolean(config.agente_retencion))
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    const valor = aNumero(tasa)
    if (!Number.isFinite(valor) || valor < 0) return setError('La alícuota no es válida.')
    setError('')
    setGuardando(true)
    try {
      const c = await apiImpuestos.actualizarConfigFiscal({
        tasa_iva: valor,
        razon_social: razonSocial,
        rif,
        direccion,
        agente_retencion: agente,
      })
      alGuardar(c)
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo guardar'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <HojaFormulario
      visible={visible}
      alCerrar={alCerrar}
      titulo="Datos fiscales"
      subtitulo="La razón social, el RIF y la dirección van en la cabecera de los libros de Compras y de Ventas. La alícuota se congela en cada venta facturada al cobrar: cambiarla no altera meses ya cerrados."
      pie={
        <>
          <View style={{ flex: 1 }}>
            <Boton texto="Cancelar" tono="neutro" alTocar={alCerrar} />
          </View>
          <View style={{ flex: 1 }}>
            <Boton texto="Guardar" alTocar={guardar} ocupado={guardando} />
          </View>
        </>
      }
    >
      {error ? <Text style={[p.nota, { color: t.peligro }]}>{error}</Text> : null}
      <Campo rotulo="Razón social" value={razonSocial} onChangeText={setRazonSocial} placeholder="Inversiones Ejemplo, C.A." />
      <Campo rotulo="RIF" value={rif} onChangeText={setRif} placeholder="J-12345678-9" autoCapitalize="characters" autoCorrect={false} />
      <CampoNumero rotulo="Alícuota IVA (%)" valor={tasa} alCambiar={setTasa} sufijo="%" />
      <Campo rotulo="Dirección fiscal" value={direccion} onChangeText={setDireccion} multiline />
      <Interruptor
        texto="Somos agente de retención de IVA (contribuyente especial)"
        detalle="Al cargar una factura de compra se retiene el 75 % o el 100 % de su IVA, con su comprobante, y cada quincena sale el TXT para el portal del SENIAT."
        valor={agente}
        alCambiar={setAgente}
      />
    </HojaFormulario>
  )
}

const estilos = StyleSheet.create({
  ficha: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 18 },
  resumen: { fontFamily: LETRA.textoFuerte, fontSize: 14.5, lineHeight: 20 },
})
