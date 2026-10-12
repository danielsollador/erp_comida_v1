import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { apiPos } from '../../lib/api-pos'
import { fmtBs } from '../../lib/moneda'
import type { VueltoListo } from '../../lib/pos'
import { LETRA, useTema } from '../../lib/tema'
import type { EstadoPabilo, VueltoEmitido } from '../../lib/tipos'
import { CampoNumero, Selector } from '../kit'
import { Boton, Campo } from '../ui'
import { BotonChico } from './piezas'

/*
 * DAR EL VUELTO POR PAGO MOVIL (components/VueltoPagoMovil.tsx de la web).
 *
 * Con una cuenta juridica conectada, el sistema MANDA el pago movil al
 * telefono del cliente desde la cuenta del local y el cobro queda con la
 * referencia del banco. Con una cuenta de persona natural el banco no lo
 * permite: la cajera lo manda desde su banco y aqui anota la referencia.
 */
export function VueltoPagoMovil({
  montoBs,
  montoUsd,
  estado,
  pedidoId,
  alListo,
  alCancelar,
}: {
  montoBs: number
  montoUsd: number
  estado: EstadoPabilo | null
  pedidoId?: number
  alListo: (v: VueltoListo) => void
  alCancelar: () => void
}) {
  const t = useTema()
  const automatico = Boolean(estado?.configurado && !estado.error && estado.emite_vueltos)
  const [telefono, setTelefono] = useState('')
  const [cedula, setCedula] = useState('')
  const [banco, setBanco] = useState('0102')
  const [referencia, setReferencia] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [resultado, setResultado] = useState<VueltoEmitido | null>(null)
  const [aMano, setAMano] = useState(!automatico)

  const telefonoLimpio = telefono.replace(/\D/g, '')
  const puedeMandar = telefonoLimpio.length === 11 && cedula.replace(/\D/g, '').length >= 6 && !enviando
  const refLimpia = referencia.replace(/\D/g, '')

  async function mandar() {
    setError('')
    setEnviando(true)
    try {
      const r = await apiPos.emitirVuelto({
        telefono: telefonoLimpio,
        cedula,
        banco,
        monto_bs: Math.round(montoBs * 100) / 100,
        monto_usd: montoUsd,
        pedido_id: pedidoId,
        user_bank_id: estado?.cuenta_id || undefined,
      })
      setResultado(r)
      if (r.resultado === 'enviado') alListo({ vuelto_id: r.id, referencia: r.referencia })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo mandar el vuelto.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <View style={{ gap: 12 }}>
      <View style={e.cabeza}>
        <Text style={[e.titulo, { color: t.tinta }]}>
          Vuelto por pago móvil · <Text style={{ fontFamily: LETRA.cifraFuerte }}>{fmtBs(montoBs)}</Text>
        </Text>
        <BotonChico texto="Volver" color={t.suave} alTocar={alCancelar} />
      </View>

      {!aMano ? (
        <>
          <CampoNumero rotulo="Teléfono del cliente" valor={telefono} alCambiar={setTelefono} entero autoFocus placeholder="04141234567" />
          <Campo rotulo="Cédula" value={cedula} onChangeText={setCedula} placeholder="V12345678" autoCapitalize="characters" />
          <Selector
            etiqueta="Banco del cliente"
            forma="campo"
            opciones={(estado?.bancos_destino ?? []).map(([codigo, nombre]) => ({ valor: codigo, texto: `${codigo} · ${nombre}` }))}
            valor={banco}
            alCambiar={setBanco}
          />
          {error || (resultado && resultado.resultado !== 'enviado') ? (
            <Text style={[e.nota, { color: t.peligro }]}>{error || resultado?.mensaje}</Text>
          ) : null}
          <Boton
            texto={enviando ? 'Mandando al banco…' : `Mandar ${fmtBs(montoBs)} y cobrar`}
            alTocar={() => void mandar()}
            ocupado={enviando}
            deshabilitado={!puedeMandar}
          />
          <BotonChico texto="Ya lo mandé desde el banco: anotar la referencia" color={t.suave} alTocar={() => setAMano(true)} />
        </>
      ) : (
        <>
          {!automatico ? (
            <Text style={[e.nota, { color: t.suave }]}>
              {estado?.configurado && !estado.error
                ? 'La cuenta conectada es de persona natural: el banco solo deja mandar vueltos automáticos desde cuentas jurídicas. Manda el pago móvil desde tu banco y anota aquí la referencia.'
                : 'Manda el pago móvil desde tu banco y anota aquí la referencia.'}
            </Text>
          ) : null}
          <CampoNumero
            rotulo="Referencia del pago móvil que mandaste"
            valor={referencia}
            alCambiar={setReferencia}
            entero
            autoFocus
            placeholder="Los dígitos que muestra el banco"
          />
          <Boton texto="Cobrar con ese vuelto" alTocar={() => alListo({ referencia: refLimpia })} deshabilitado={refLimpia.length < 4} />
          {automatico ? <BotonChico texto="Mejor que lo mande el sistema" color={t.suave} alTocar={() => setAMano(false)} /> : null}
        </>
      )}
    </View>
  )
}

const e = StyleSheet.create({
  cabeza: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  titulo: { flex: 1, fontFamily: LETRA.textoFuerte, fontSize: 15.5 },
  nota: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
})
