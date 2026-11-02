import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { METODOS_CON_REFERENCIA, METODOS_PAGO, etiquetaMetodo } from '../../../../frontend/src/lib/pagos'
import { apiVentas } from '../../lib/api-ventas'
import { useMoneda } from '../../lib/moneda'
import { aNumero } from '../../lib/numeros'
import { useSesion } from '../../lib/sesion'
import { LETRA, useTema } from '../../lib/tema'
import type { Autorizacion, Pedido } from '../../lib/tipos'
import Icono from '../Icono'
import { CampoNumero, HojaFormulario, Selector } from '../kit'
import { Aviso, Boton, Campo, Cargando, Fila, Nota } from '../ui'
import Autorizar from './Autorizar'

type FilaPago = { clave: string; id: number | null; metodo: string; monto: string; referencia: string; fija: boolean }

const redondo = (x: number) => Math.round(x * 100) / 100
const montoDe = (texto: string) => {
  const n = aNumero(texto)
  return Number.isFinite(n) ? n : 0
}

/**
 * CORREGIR COMO SE PAGÓ una venta ya cobrada, como components/CorregirPago.tsx
 * de la web: la forma de pago, el reparto de un pago mixto o la referencia.
 * Lo cobrado no cambia: los pagos tienen que sumar lo mismo. Si la plata
 * cambia de gaveta o de cuenta pide la firma de quien autoriza; corregir solo
 * la referencia no pide nada. El resto de las reglas (caja del dia cerrada,
 * fiado, pagos con vuelto) las dice el servidor, tal cual.
 */
export default function CorregirPago({
  pedidoId,
  visible,
  alCerrar,
  alGuardado,
}: {
  pedidoId: number
  visible: boolean
  alCerrar: () => void
  alGuardado: () => void
}) {
  const t = useTema()
  const { fmt } = useMoneda()
  const { acceso } = useSesion()
  const autorizoYo = acceso?.puede.autoriza ?? false
  const [pedido, setPedido] = useState<Pedido | null>(null)
  const [filas, setFilas] = useState<FilaPago[]>([])
  const [motivo, setMotivo] = useState('')
  const [firma, setFirma] = useState<Autorizacion | null>(null)
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const contador = useRef(0)
  const nuevaClave = () => `f${++contador.current}`

  useEffect(() => {
    if (!visible) return
    let vivo = true
    apiVentas
      .verPedido(pedidoId)
      .then((p) => {
        if (!vivo) return
        setPedido(p)
        setError('')
        setMotivo('')
        setFirma(null)
        setFilas(
          p.pagos.map((g, i) => ({
            clave: `p${i}`,
            id: g.id ?? null,
            metodo: g.metodo,
            monto: String(g.monto).replace('.', ','),
            referencia: g.referencia || '',
            fija: (g.vuelto_monto || 0) > 0 || g.monto < 0,
          })),
        )
      })
      .catch((e) => vivo && setError(e instanceof Error ? e.message : 'No se pudo abrir la venta'))
    return () => {
      vivo = false
    }
  }, [pedidoId, visible])

  const cobrado = useMemo(() => redondo((pedido?.pagos ?? []).reduce((s, g) => s + g.monto, 0)), [pedido])
  const suma = redondo(filas.reduce((s, f) => s + montoDe(f.monto), 0))
  const falta = redondo(cobrado - suma)
  // Si solo cambian referencias, la plata no se movio de ningun lado.
  const muevePlata = useMemo(() => {
    if (!pedido) return false
    const firmaDe = (xs: { metodo: string; monto: number }[]) => xs.map((x) => `${x.metodo}:${redondo(x.monto)}`).sort().join('|')
    return firmaDe(pedido.pagos) !== firmaDe(filas.map((f) => ({ metodo: f.metodo, monto: montoDe(f.monto) })))
  }, [pedido, filas])

  const cambiar = (clave: string, c: Partial<FilaPago>) => setFilas((fs) => fs.map((f) => (f.clave === clave ? { ...f, ...c } : f)))

  async function guardar() {
    setError('')
    if (Math.abs(falta) > 0.009) {
      setError(`Los pagos tienen que sumar ${fmt(cobrado)}, lo que se cobró. Para cambiar lo cobrado se editan los renglones.`)
      return
    }
    if (muevePlata && !autorizoYo && !firma) {
      setError('Mover la plata de gaveta necesita el PIN de quien autoriza, o su aprobación desde la aplicación.')
      return
    }
    setGuardando(true)
    try {
      await apiVentas.corregirPagos(
        pedidoId,
        filas.map((f) => ({ id: f.id, metodo: f.metodo, monto: redondo(montoDe(f.monto)), referencia: f.referencia.trim() })),
        { motivo, autorizacion: muevePlata && !autorizoYo && firma ? firma : undefined },
      )
      alGuardado()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <HojaFormulario
      visible={visible}
      alCerrar={alCerrar}
      titulo={pedido ? `Corregir el pago del pedido #${pedido.numero}` : 'Corregir el pago'}
      subtitulo="Cambia la forma de pago, el reparto o la referencia. Lo cobrado no cambia."
      pie={
        <>
          <View style={{ flex: 1 }}>
            <Boton texto="Cancelar" tono="neutro" alTocar={alCerrar} />
          </View>
          <View style={{ flex: 1 }}>
            <Boton texto={guardando ? 'Guardando…' : 'Guardar'} ocupado={guardando} deshabilitado={!pedido} alTocar={() => void guardar()} />
          </View>
        </>
      }
    >
      {error ? <Aviso tono="peligro" texto={error} /> : null}
      {!pedido ? (
        !error ? <Cargando /> : null
      ) : (
        <>
          {filas.map((f) => (
            <View key={f.clave} style={[e.pago, { borderColor: t.gris200, backgroundColor: t.superficie }]}>
              <View style={e.fila}>
                <View style={{ flex: 1 }}>
                  <Selector
                    forma="campo"
                    etiqueta="Forma de pago"
                    opciones={[...new Set([f.metodo, ...METODOS_PAGO])].map((m) => ({ valor: m, texto: etiquetaMetodo(m) }))}
                    valor={f.metodo}
                    alCambiar={(m) => cambiar(f.clave, { metodo: m })}
                    deshabilitado={f.fija}
                  />
                </View>
                {!f.fija && filas.length > 1 ? (
                  <Pressable
                    onPress={() => setFilas((fs) => fs.filter((x) => x.clave !== f.clave))}
                    accessibilityLabel="Quitar este pago"
                    hitSlop={6}
                    style={({ pressed }) => [e.quitar, { backgroundColor: pressed ? t.gris200 : t.gris100 }]}
                  >
                    <Icono nombre="quitar" size={16} color={t.suave} />
                  </Pressable>
                ) : null}
              </View>
              <CampoNumero rotulo="Monto en dólares" prefijo="$" valor={f.monto} alCambiar={(v) => cambiar(f.clave, { monto: v })} editable={!f.fija} />
              {METODOS_CON_REFERENCIA.has(f.metodo) ? (
                <Campo
                  rotulo="Referencia"
                  value={f.referencia}
                  onChangeText={(v) => cambiar(f.clave, { referencia: v })}
                  placeholder="Referencia: número del pago móvil, ticket del punto o comprobante"
                />
              ) : null}
              {f.fija ? (
                <Nota style={{ color: t.tenue }}>
                  Este pago tuvo vuelto (o es una devolución): movió dos gavetas y solo se le corrige la referencia.
                </Nota>
              ) : null}
            </View>
          ))}

          <Pressable
            onPress={() =>
              setFilas((fs) => [
                ...fs,
                { clave: nuevaClave(), id: null, metodo: METODOS_PAGO[0], monto: falta > 0 ? String(falta).replace('.', ',') : '', referencia: '', fija: false },
              ])
            }
            style={({ pressed }) => [e.otra, { borderColor: t.acento400, opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={[e.otraTexto, { color: t.acento }]}>+ Otra forma de pago</Text>
          </Pressable>

          <View>
            <Fila nombre="Se cobró" valor={fmt(cobrado)} fuerte />
            <Fila nombre="Suman los pagos" valor={fmt(suma)} fuerte color={Math.abs(falta) > 0.009 ? t.peligro : t.exito} ultima />
            {Math.abs(falta) > 0.009 ? (
              <Nota style={{ color: t.peligro }}>{falta > 0 ? `Faltan ${fmt(falta)}` : `Sobran ${fmt(-falta)}`} para que cuadre.</Nota>
            ) : null}
          </View>

          {muevePlata ? (
            <View style={[e.firma, { backgroundColor: t.avisoSuave, borderColor: t.avisoLinea }]}>
              <Text style={[e.firmaTitulo, { color: t.avisoFuerte }]}>La plata cambia de gaveta o de cuenta.</Text>
              {autorizoYo ? (
                <Nota style={{ color: t.aviso }}>
                  Lo autorizas tú: queda firmado a nombre de {acceso?.nombre_visible || acceso?.usuario}.
                </Nota>
              ) : (
                <Autorizar
                  accion="corregir_pago"
                  detalle={`Corregir el pago del pedido #${pedido.numero}`}
                  monto={cobrado}
                  pedidoId={pedido.id}
                  alCambiar={setFirma}
                />
              )}
            </View>
          ) : null}

          <Campo rotulo="Nota" value={motivo} onChangeText={setMotivo} placeholder="Opcional: qué se había anotado mal" />
        </>
      )}
    </HojaFormulario>
  )
}

const e = StyleSheet.create({
  pago: { borderWidth: 1, borderRadius: 18, borderCurve: 'continuous', padding: 12, gap: 10 },
  fila: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  quitar: { width: 44, height: 50, borderRadius: 14, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  otra: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 16, borderCurve: 'continuous', minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  otraTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14.5 },
  firma: { borderWidth: 1, borderRadius: 18, borderCurve: 'continuous', padding: 14, gap: 10 },
  firmaTitulo: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
})
