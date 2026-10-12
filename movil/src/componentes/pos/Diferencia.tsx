import { Text, View } from 'react-native'
import { etiquetaMetodo, METODOS_CON_REFERENCIA, METODOS_PAGO } from '../../../../frontend/src/lib/pagos'
import { useMoneda } from '../../lib/moneda'
import { LETRA, useTema } from '../../lib/tema'
import type { Autorizacion } from '../../lib/tipos'
import { HojaFormulario, Selector } from '../kit'
import { Boton, Campo } from '../ui'
import { Autorizar } from './Autorizar'

/*
 * GUARDAR UNA EDICION QUE MUEVE PLATA DE UNA VENTA YA COBRADA (el cuadro
 * "cambia lo cobrado" de pages/POS.tsx): falta la firma de quien autoriza y
 * decir por donde entra o sale la diferencia. La firma no se pide por
 * cambiar renglones: se pide por mover plata cobrada.
 *
 * Fiar la diferencia no esta en la lista: abriria una cuenta por cobrar
 * dentro de una venta que ya figura cobrada.
 */
export function Diferencia({
  numero,
  pedidoId,
  monto,
  autorizoYo,
  quien,
  metodo,
  referencia,
  firma,
  alCambiarMetodo,
  alCambiarReferencia,
  alFirmar,
  alGuardar,
  alCerrar,
  guardando,
}: {
  numero: number
  pedidoId: number
  /** Positivo: el cliente paga de mas. Negativo: se le devuelve. */
  monto: number
  autorizoYo: boolean
  quien: string
  metodo: string
  referencia: string
  firma: Autorizacion | null
  alCambiarMetodo: (m: string) => void
  alCambiarReferencia: (r: string) => void
  alFirmar: (a: Autorizacion | null) => void
  alGuardar: () => void
  alCerrar: () => void
  guardando: boolean
}) {
  const t = useTema()
  const { fmt } = useMoneda()
  const que = monto > 0 ? 'El cliente paga de más' : 'Se le devuelve al cliente'
  return (
    <HojaFormulario
      visible
      alCerrar={alCerrar}
      titulo={`Pedido #${numero}: cambia lo cobrado`}
      subtitulo="Esta venta ya está cobrada. Di por dónde entra o sale la diferencia."
      pie={
        <>
          <View style={{ flex: 1 }}>
            <Boton texto="Volver" tono="neutro" alTocar={alCerrar} />
          </View>
          <View style={{ flex: 1 }}>
            <Boton texto="Guardar cambios" alTocar={alGuardar} ocupado={guardando} deshabilitado={!autorizoYo && !firma} />
          </View>
        </>
      }
    >
      <Text style={{ fontFamily: LETRA.textoFuerte, fontSize: 16, color: monto > 0 ? t.exito : t.aviso }}>
        {que} {fmt(Math.abs(monto))}
      </Text>
      {autorizoYo ? (
        <Text style={{ fontFamily: LETRA.texto, fontSize: 14.5, lineHeight: 20, color: t.suave }}>
          Lo autorizas tú: queda firmado a nombre de <Text style={{ fontFamily: LETRA.textoFuerte, color: t.tinta }}>{quien}</Text>.
        </Text>
      ) : (
        <Autorizar
          accion="editar_venta"
          detalle={`${que} ${fmt(Math.abs(monto))}`}
          monto={Math.abs(monto)}
          pedidoId={pedidoId}
          alCambiar={alFirmar}
        />
      )}
      <Selector
        etiqueta={monto > 0 ? 'Cómo se cobra la diferencia' : 'Cómo se devuelve'}
        forma="campo"
        opciones={METODOS_PAGO.map((m) => ({ valor: m, texto: etiquetaMetodo(m) }))}
        valor={metodo}
        alCambiar={alCambiarMetodo}
      />
      {METODOS_CON_REFERENCIA.has(metodo) ? (
        <Campo
          rotulo="Referencia"
          value={referencia}
          onChangeText={alCambiarReferencia}
          ayuda="El número del pago móvil, el ticket del punto o el comprobante."
        />
      ) : null}
    </HojaFormulario>
  )
}
