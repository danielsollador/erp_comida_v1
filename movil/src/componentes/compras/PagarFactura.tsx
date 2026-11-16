import { useState } from 'react'
import { Text, View } from 'react-native'
import { necesitaReferencia } from '../../../../frontend/src/lib/pagos'
import { apiCompras } from '../../lib/api-compras'
import { num, saldoDe } from '../../lib/compras-app'
import { confirmar } from '../../lib/dialogo'
import { useMoneda } from '../../lib/moneda'
import { fechaCorta } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import type { FacturaCompra } from '../../lib/tipos'
import { HojaFormulario } from '../kit'
import { Boton, Fila } from '../ui'
import { Casilla, CampoTexto, Dato, mensajeDe, NotaTono, Opciones } from './piezas'

/**
 * PAGARLE A UN PROVEEDOR una factura a credito: entera ("Marcar pagada" /
 * "Pagar el resto") o un abono a cuenta. Es lo que en la web son la fila de
 * "Cuentas por pagar" (el `<select>` de con que se paga y los dos botones) y
 * los dialogos de abono y referencia, juntos en una hoja: en el telefono no
 * caben cuatro controles en una fila.
 */
const FORMAS = [
  { valor: 'Efectivo', texto: 'Efectivo' },
  { valor: 'Banco', texto: 'Banco' },
]

export default function PagarFactura({
  factura,
  alCerrar,
  alPagar,
}: {
  factura: FacturaCompra | null
  alCerrar: () => void
  /** El servidor devolvio la factura al dia. */
  alPagar: (f: FacturaCompra, texto: string) => void
}) {
  if (!factura) return null
  return <Abierta f={factura} alCerrar={alCerrar} alPagar={alPagar} />
}

function Abierta({ f, alCerrar, alPagar }: { f: FacturaCompra; alCerrar: () => void; alPagar: (f: FacturaCompra, texto: string) => void }) {
  const t = useTema()
  const { fmt } = useMoneda()
  const [forma, setForma] = useState('Efectivo')
  const [referencia, setReferencia] = useState('')
  const [monto, setMonto] = useState('')
  const [ocupado, setOcupado] = useState<'' | 'pagar' | 'abonar'>('')
  const [error, setError] = useState('')
  const debe = saldoDe(f)
  const conReferencia = necesitaReferencia(forma)

  // El comprobante se pide ANTES de mandar el pago: el servidor lo exige y
  // rebotaria con el dialogo ya cerrado.
  function faltaReferencia(): boolean {
    if (conReferencia && !referencia.trim()) {
      setError(`Un pago por ${forma} necesita su número de referencia.`)
      return true
    }
    return false
  }

  async function pagar() {
    setError('')
    if (faltaReferencia()) return
    if (!(await confirmar({ titulo: `¿${f.abonado ? 'Pagar el resto' : 'Marcar pagada'}?`, texto: `${fmt(debe)} a ${f.proveedor_nombre}, factura ${f.numero_factura}.`, aceptar: 'Pagar' })))
      return
    setOcupado('pagar')
    try {
      const nueva = await apiCompras.pagarFactura(f.id, forma, referencia.trim() || undefined)
      alPagar(nueva, `Factura ${f.numero_factura} pagada.`)
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo registrar el pago'))
    } finally {
      setOcupado('')
    }
  }

  // Un pago a cuenta: lo que se le da hoy al proveedor, sin saldar la factura.
  async function abonar() {
    setError('')
    const n = num(monto)
    if (!(n > 0)) return setError('Escribe cuánto se le paga hoy.')
    if (faltaReferencia()) return
    setOcupado('abonar')
    try {
      const nueva = await apiCompras.abonarFactura(f.id, n, forma, referencia.trim() || undefined)
      alPagar(nueva, nueva.pagada ? `Factura ${f.numero_factura} pagada con ese abono.` : `Abono de ${fmt(n)} registrado.`)
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo registrar el abono'))
    } finally {
      setOcupado('')
    }
  }

  return (
    <HojaFormulario
      visible
      alCerrar={alCerrar}
      titulo={`Pagarle a ${f.proveedor_nombre}`}
      subtitulo={`Factura ${f.numero_factura}${f.fecha_vencimiento ? ` · vence ${fechaCorta(f.fecha_vencimiento, true)}` : ''}`}
      pie={
        <View style={{ flex: 1 }}>
          <Boton texto={f.abonado ? 'Pagar el resto' : 'Marcar pagada'} alTocar={() => void pagar()} ocupado={ocupado === 'pagar'} deshabilitado={!!ocupado} />
        </View>
      }
    >
      <View>
        <Fila nombre="Se debe" valor={fmt(debe)} fuerte />
        {f.abonado ? <Fila nombre="Ya abonado" valor={fmt(f.abonado)} /> : null}
        <Fila nombre="Total de la factura" valor={fmt(f.total)} ultima />
      </View>
      <Dato etiqueta="Con qué se paga">
        <Opciones opciones={FORMAS} valor={forma} alCambiar={setForma} />
      </Dato>
      {conReferencia ? (
        <Dato etiqueta="Referencia">
          <CampoTexto value={referencia} onChangeText={setReferencia} placeholder="Número de confirmación, ticket o comprobante" accessibilityLabel="Referencia" />
        </Dato>
      ) : null}
      <View style={{ gap: 8, marginTop: 6 }}>
        <Text style={{ fontFamily: LETRA.titulo, fontSize: 16, color: t.tinta }}>O un abono</Text>
        <Text style={{ fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19, color: t.suave }}>
          {`Factura ${f.numero_factura}: se deben ${fmt(debe)}${f.abonado ? ` (ya se abonaron ${fmt(f.abonado)})` : ''}.`}
        </Text>
        <Dato etiqueta="Cuánto se le paga hoy">
          <Casilla valor={monto} alCambiar={setMonto} prefijo="$" placeholder="0,00" etiqueta="Cuánto se le paga hoy" />
        </Dato>
        <Boton texto="Registrar abono" tono="neutro" alTocar={() => void abonar()} ocupado={ocupado === 'abonar'} deshabilitado={!!ocupado} />
      </View>
      {error ? <NotaTono tono="mal">{error}</NotaTono> : null}
    </HojaFormulario>
  )
}
