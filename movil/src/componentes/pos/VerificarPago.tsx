import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { apiPos } from '../../lib/api-pos'
import { fmtBs } from '../../lib/moneda'
import { enBsTexto, leerBs, redondear, usd, usdComa, type PagoVerificado } from '../../lib/pos'
import { LETRA, useTema } from '../../lib/tema'
import type { EstadoPabilo, VerificacionPago } from '../../lib/tipos'
import { CampoNumero } from '../kit'
import { Boton, Campo } from '../ui'
import { BotonChico, Caja, useColorDeCaja } from './piezas'

/*
 * COBRAR POR PAGO MOVIL O TRANSFERENCIA CON EL BANCO DELANTE (Pabilo), como
 * components/VerificarPago.tsx de la web: se escribe la referencia, se le
 * pregunta al banco y se cobra con la respuesta a la vista.
 *
 * NUNCA BLOQUEA EL COBRO. Si el banco no responde o la referencia no aparece
 * todavia, "Cobrar sin verificar" anota la referencia y cobra, como siempre.
 * Lo unico que se cierra es una referencia que YA cobro otro pedido.
 *
 * EL MONTO SE PUEDE CORREGIR: la gente redondea al escribir en su banco (Bs
 * 1.700 por una cuenta de Bs 1.650). La cajera escribe lo que mando el
 * cliente y, con las dos cifras delante, decide que pasa con la diferencia.
 *
 * Vive dentro del cuadro de cobro, en el lugar de las formas de pago: un
 * solo cuadro, un paso a la vez.
 */
export function VerificarPago({
  metodo,
  montoUsd,
  tasa,
  estado,
  pedidoId,
  enMixto = false,
  alListo,
  alCancelar,
}: {
  metodo: string
  /** Lo que la cuenta pide (o esta parte, en pago partido), en dolares. */
  montoUsd: number
  /** Bs por dolar. 0 = sin tasa cargada. */
  tasa: number
  estado: EstadoPabilo
  pedidoId?: number
  enMixto?: boolean
  alListo: (pago: PagoVerificado) => void
  alCancelar: () => void
}) {
  const t = useTema()
  const montoBs = tasa > 0 ? redondear(montoUsd * tasa) : null
  // A cual de las cuentas del local le pagaron: arranca en la principal.
  const [cuentaId, setCuentaId] = useState(estado.cuenta_id)
  const varias = estado.cuentas.length > 1
  const cuenta = estado.cuentas.find((c) => c.id === cuentaId)
  const nombreCuenta = cuenta ? cuenta.descripcion || cuenta.banco : estado.cuenta
  const [referencia, setReferencia] = useState('')
  const [montoTexto, setMontoTexto] = useState(montoBs !== null ? enBsTexto(montoBs) : '')
  const [telefono, setTelefono] = useState('')
  const [cedula, setCedula] = useState('')
  const [bancoOrigen, setBancoOrigen] = useState('')
  const [consultando, setConsultando] = useState(false)
  const [resultado, setResultado] = useState<VerificacionPago | null>(null)
  const [error, setError] = useState('')

  const pideTelefono = estado.campos.includes('PHONE_ORIGIN')
  const pideCedula = estado.campos.includes('DNI_ORIGIN')
  const pideBanco = estado.campos.includes('BANK_CODE_ORIGIN')
  const limpia = referencia.replace(/[^0-9a-zA-Z]/g, '')
  const montoEscrito = leerBs(montoTexto)
  const montoValido = montoBs === null || (Number.isFinite(montoEscrito) && montoEscrito > 0)
  const corregido = montoBs !== null && montoValido && Math.abs(montoEscrito - montoBs) > 0.005
  const puedeConsultar =
    limpia.length >= 4 &&
    !consultando &&
    montoValido &&
    (!pideTelefono || telefono.replace(/\D/g, '').length >= 10) &&
    (!pideCedula || cedula.replace(/\D/g, '').length >= 5) &&
    (!pideBanco || bancoOrigen.replace(/\D/g, '').length === 4)

  async function consultar() {
    if (!puedeConsultar) return
    setConsultando(true)
    setError('')
    try {
      const r = await apiPos.verificarPago({
        referencia: limpia,
        monto_usd: montoUsd,
        monto_bs: corregido ? redondear(montoEscrito) : undefined,
        user_bank_id: varias ? cuentaId : undefined,
        metodo,
        pedido_id: pedidoId,
        telefono: pideTelefono ? telefono : undefined,
        cedula: pideCedula ? cedula : undefined,
        banco_origen: pideBanco ? bancoOrigen : undefined,
      })
      setResultado(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo consultar al banco.')
    } finally {
      setConsultando(false)
    }
  }

  const sinVerificar = () => alListo({ referencia: limpia })

  return (
    <View style={{ gap: 12 }}>
      <View style={e.cabeza}>
        <Text style={[e.metodo, { color: t.tinta }]}>{metodo}</Text>
        <BotonChico texto="Cambiar forma de pago" color={t.suave} alTocar={alCancelar} />
      </View>

      {!resultado ? (
        <>
          {/* Con dos bancos, lo primero es a cual le pagaron. */}
          {varias ? (
            <View style={{ gap: 6 }}>
              <Text style={[e.rotulo, { color: t.suave }]}>¿A qué cuenta pagó?</Text>
              <View style={[e.carril, { backgroundColor: t.gris100, borderColor: t.gris200 }]}>
                {estado.cuentas.map((c) => (
                  <Pressable
                    key={c.id}
                    onPress={() => setCuentaId(c.id)}
                    accessibilityState={{ selected: c.id === cuentaId }}
                    style={[e.segmento, c.id === cuentaId && { backgroundColor: t.tinta }]}
                  >
                    <Text style={[e.segmentoTexto, { color: c.id === cuentaId ? t.papel : t.suave }]} numberOfLines={1}>
                      {c.descripcion || c.banco}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {montoBs !== null ? (
            <CampoNumero
              rotulo={nombreCuenta ? `Monto que entró a ${nombreCuenta}` : 'Monto que mandó'}
              valor={montoTexto}
              alCambiar={setMontoTexto}
              prefijo="Bs"
              placeholder={enBsTexto(montoBs)}
              error={!montoValido ? 'Tiene que ser un número' : undefined}
              ayuda={
                corregido
                  ? `La cuenta es ${fmtBs(montoBs)}. Si entró más, lo que sobra se suma a la propina; si entró menos, eliges cómo se cobra lo que falta.`
                  : 'Es la cuenta a la tasa del día. Si el cliente mandó otra cantidad, tócalo y escribe lo que mandó.'
              }
            />
          ) : (
            <>
              <View style={[e.debe, { borderColor: t.gris200 }]}>
                <Text style={[e.rotulo, { color: t.suave }]}>Debe haber entrado</Text>
                <Text style={[e.cifra, { color: t.tinta }]}>{usd(montoUsd)}</Text>
              </View>
              <Text style={[e.nota, { color: t.aviso }]}>
                Sin tasa de cambio cargada: el banco dirá cuánto entró, pero no se puede comparar solo.
              </Text>
            </>
          )}
          <CampoNumero
            rotulo="Referencia del pago"
            valor={referencia}
            alCambiar={setReferencia}
            entero
            placeholder="Los dígitos que muestra el banco"
          />
          {pideTelefono ? (
            <CampoNumero rotulo="Teléfono del que pagó" valor={telefono} alCambiar={setTelefono} entero placeholder="04141234567" />
          ) : null}
          {pideCedula ? (
            <Campo rotulo="Cédula del que pagó" value={cedula} onChangeText={setCedula} placeholder="V-12345678" autoCapitalize="characters" />
          ) : null}
          {pideBanco ? (
            <CampoNumero
              rotulo="Banco del que pagó (código de 4 dígitos)"
              valor={bancoOrigen}
              alCambiar={setBancoOrigen}
              entero
              placeholder="0102"
            />
          ) : null}
          {error ? <Text style={[e.nota, { color: t.peligro }]}>{error}</Text> : null}
          <Boton
            texto={consultando ? 'Consultando al banco…' : 'Verificar con el banco'}
            alTocar={() => void consultar()}
            ocupado={consultando}
            deshabilitado={!puedeConsultar}
          />
          {/* Chico y abajo: existe para cuando el banco no responde, no para
              saltarse la verificacion por costumbre. */}
          <BotonChico texto="Cobrar sin verificar" color={t.suave} alTocar={sinVerificar} deshabilitado={limpia.length < 4 || consultando} />
        </>
      ) : (
        <Resultado
          r={resultado}
          metodo={metodo}
          cuentaUsd={montoUsd}
          tasa={tasa}
          enMixto={enMixto}
          alListo={(extra) => alListo({ referencia: limpia, verificacion_id: resultado.id, ...extra })}
          alSinVerificar={sinVerificar}
          alCorregir={() => {
            setResultado(null)
            setError('')
          }}
          alReintentar={() => {
            setResultado(null)
            void consultar()
          }}
        />
      )}
    </View>
  )
}

function Resultado({
  r,
  metodo,
  cuentaUsd,
  tasa,
  enMixto,
  alListo,
  alSinVerificar,
  alCorregir,
  alReintentar,
}: {
  r: VerificacionPago
  metodo: string
  cuentaUsd: number
  tasa: number
  enMixto: boolean
  alListo: (extra: Pick<PagoVerificado, 'monto_usd' | 'monto_bs' | 'decision'>) => void
  alSinVerificar: () => void
  alCorregir: () => void
  alReintentar: () => void
}) {
  const t = useTema()
  const colorDe = useColorDeCaja()
  // La comparacion que importa es contra LA CUENTA, no contra lo escrito.
  const encontrado = r.resultado === 'verificado' || r.resultado === 'monto_distinto'
  const cuentaBs = tasa > 0 ? redondear(cuentaUsd * tasa) : null
  const entro = r.monto_bs
  const diferencia = encontrado && entro !== null && cuentaBs !== null ? redondear(entro - cuentaBs) : null
  // SIN margen: cualquier centimo de diferencia se muestra y se decide.
  const entroUsd = entro !== null && tasa > 0 ? entro / tasa : undefined
  const falta = diferencia !== null ? Math.abs(diferencia) : 0
  const difUsd = diferencia !== null ? redondear(falta / tasa) : 0
  // Menos de un centavo de dolar: no se puede cobrar con otra forma ni cambia la propina.
  const menosDeUnCentavo = difUsd < 0.01
  const enUsd = menosDeUnCentavo ? '' : ` (${usdComa(difUsd)})`

  const caso: 'exacto' | 'sobra' | 'falta' | null =
    diferencia === null ? null : Math.abs(diferencia) < 0.005 ? 'exacto' : diferencia > 0 ? 'sobra' : 'falta'

  const tono: 'bien' | 'ojo' | 'mal' | 'neutro' =
    caso === 'exacto' || caso === 'sobra' || (caso === null && r.resultado === 'verificado')
      ? 'bien'
      : caso === 'falta' || r.resultado === 'monto_distinto'
        ? 'ojo'
        : r.resultado === 'ya_usado'
          ? 'mal'
          : 'neutro'

  const titulo =
    caso === 'exacto'
      ? 'Pago confirmado'
      : caso === 'sobra'
        ? `Entró ${fmtBs(falta)} de más`
        : caso === 'falta'
          ? `Entró menos: faltan ${fmtBs(falta)}`
          : {
              verificado: 'Pago confirmado',
              monto_distinto: 'El banco lo encontró, pero el monto no cuadra',
              no_encontrado: 'El banco no lo encuentra',
              ya_usado: 'Esa referencia ya se usó',
              error: r.del_dueno ? 'No se puede verificar ahora' : 'No se pudo consultar',
            }[r.resultado]

  const detalle =
    caso === 'sobra'
      ? menosDeUnCentavo
        ? `El banco confirmó el pago. Sobran ${fmtBs(falta)}: es menos de un centavo de dólar, así que no es propina. Queda anotado en contabilidad, en «Redondeo de pagos».`
        : `El banco confirmó el pago. Lo que sobra, ${fmtBs(falta)}${enUsd}, se suma a la propina del equipo: no es venta.`
      : caso === 'falta'
        ? `El banco confirmó el pago, pero entró menos de la cuenta. Decide cómo se cobran los ${fmtBs(falta)}${enUsd} que faltan.`
        : r.mensaje

  const color = colorDe(tono)
  const verde = (texto: string, alTocar: () => void) => (
    <Pressable onPress={alTocar} style={({ pressed }) => [e.verde, { backgroundColor: t.exitoSuave, borderColor: t.exito500, opacity: pressed ? 0.85 : 1 }]}>
      <Text style={[e.verdeTexto, { color: t.exito }]}>{texto}</Text>
    </Pressable>
  )

  return (
    <View style={{ gap: 10 }}>
      <Caja tono={tono}>
        <Text style={[e.resTitulo, { color }]}>{titulo}</Text>
        {detalle ? <Text style={[e.nota, { color }]}>{detalle}</Text> : null}
        {entro !== null ? (
          <View style={{ flexDirection: 'row', gap: 16, marginTop: 6 }}>
            <View style={{ flex: 1 }}>
              <Text style={[e.mini, { color }]}>Entró al banco</Text>
              <Text style={[e.cifraChica, { color }]}>{fmtBs(entro)}</Text>
            </View>
            {cuentaBs !== null ? (
              <View style={{ flex: 1 }}>
                <Text style={[e.mini, { color }]}>{enMixto ? 'Esta parte' : 'La cuenta'}</Text>
                <Text style={[e.cifraChica, { color }]}>{fmtBs(cuentaBs)}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
        <Text style={[e.mini, { color, marginTop: 4 }]}>Ref. {r.referencia}</Text>
      </Caja>

      {caso === 'exacto'
        ? verde(enMixto ? `Anotar ${usdComa(cuentaUsd)} por ${metodo}` : `Cobrar por ${metodo}`, () =>
            alListo({ monto_usd: cuentaUsd, monto_bs: entro ?? undefined, decision: 'exacto' }),
          )
        : null}

      {caso === 'sobra' ? (
        <>
          {verde(
            menosDeUnCentavo
              ? enMixto
                ? `Anotar por ${metodo}`
                : `Cobrar por ${metodo}`
              : `${enMixto ? 'Anotar' : 'Cobrar'} y sumar ${fmtBs(falta)} a la propina`,
            () => alListo({ monto_usd: entroUsd, monto_bs: entro ?? undefined, decision: 'propina' }),
          )}
          <BotonChico texto="Corregir la referencia" color={t.suave} alTocar={alCorregir} />
        </>
      ) : null}

      {caso === 'falta' ? (
        <>
          <Text style={[e.rotulo, { color: t.suave }]}>¿Cómo se cobran los {fmtBs(falta)} que faltan?</Text>
          <Boton
            texto={`Con otro ${metodo.toLowerCase()} por ${fmtBs(falta)}`}
            alTocar={() => alListo({ monto_usd: entroUsd, monto_bs: entro ?? undefined, decision: 'otro_pago' })}
          />
          {!menosDeUnCentavo ? (
            <Boton
              texto="Con otra forma de pago (efectivo, punto…)"
              tono="neutro"
              alTocar={() => alListo({ monto_usd: entroUsd, monto_bs: entro ?? undefined, decision: 'resto' })}
            />
          ) : null}
          <Boton
            texto={
              menosDeUnCentavo ? `No cobrarlo: los ${fmtBs(falta)} van a «Redondeo de pagos»` : `No cobrarlo: ${fmtBs(falta)} de descuento`
            }
            tono="neutro"
            alTocar={() => alListo({ monto_usd: entroUsd, monto_bs: entro ?? undefined, decision: 'perdonar' })}
          />
          {menosDeUnCentavo ? (
            <Text style={[e.nota, { color: t.suave }]}>
              Es menos de un centavo de dólar: el sistema lleva las cuentas en dólares con centavos, así que no se puede cobrar con
              efectivo o punto. Con otro pago móvil sí.
            </Text>
          ) : null}
          <BotonChico texto="Corregir la referencia" color={t.suave} alTocar={alCorregir} />
        </>
      ) : null}

      {caso === null && r.resultado === 'verificado' ? verde(`Cobrar por ${metodo}`, () => alListo({ decision: 'exacto' })) : null}

      {caso === null && r.resultado === 'monto_distinto' ? (
        <>
          <Boton texto="Aceptar y cobrar igual" alTocar={() => alListo({ decision: 'exacto' })} />
          <Boton texto="Corregir la referencia" tono="neutro" alTocar={alCorregir} />
        </>
      ) : null}

      {r.resultado === 'no_encontrado' ? (
        <>
          <Boton texto="Consultar otra vez" alTocar={alReintentar} />
          <Boton texto="Corregir la referencia" tono="neutro" alTocar={alCorregir} />
          <BotonChico texto="Cobrar sin verificar" color={t.suave} alTocar={alSinVerificar} />
        </>
      ) : null}

      {r.resultado === 'ya_usado' ? <Boton texto="Pedir otro comprobante" alTocar={alCorregir} /> : null}

      {r.resultado === 'error' ? (
        <>
          {r.reintentable ? <Boton texto="Intentar de nuevo" alTocar={alReintentar} /> : null}
          <Boton texto="Cobrar sin verificar" tono="neutro" alTocar={alSinVerificar} />
          <BotonChico texto="Corregir la referencia" color={t.suave} alTocar={alCorregir} />
        </>
      ) : null}
    </View>
  )
}

const e = StyleSheet.create({
  cabeza: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  metodo: { fontFamily: LETRA.textoFuerte, fontSize: 16 },
  rotulo: { fontFamily: LETRA.textoFuerte, fontSize: 13 },
  carril: { flexDirection: 'row', borderRadius: 999, padding: 4, borderWidth: 1, gap: 2 },
  segmento: { flex: 1, minHeight: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  segmentoTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14 },
  debe: { borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  cifra: { fontFamily: LETRA.tituloFuerte, fontSize: 22 },
  nota: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
  resTitulo: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  mini: { fontFamily: LETRA.texto, fontSize: 13 },
  cifraChica: { fontFamily: LETRA.cifraFuerte, fontSize: 15 },
  verde: { minHeight: 52, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  verdeTexto: { fontFamily: LETRA.textoFuerte, fontSize: 15.5, textAlign: 'center' },
})
