import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { apiImpuestos } from '../../lib/api-impuestos'
import { useCarga } from '../../lib/carga'
import { avisar, confirmar } from '../../lib/dialogo'
import { bolivares, dolares } from '../../lib/formato'
import { LETRA, useTema } from '../../lib/tema'
import type { DeclaracionIva, PeriodoPendiente } from '../../lib/tipos'
import { useElegir } from '../contabilidad/dialogos'
import { BotonChico, Caja, Cabeza, mensajeDe, useRefrescoDeSeccion, useTintaDe } from '../contabilidad/piezas'
import { Pastilla } from '../kit'
import { Cargando, Ficha, Nota, Problema } from '../ui'

/** Lo declarado en Bs; si la declaracion es de antes de existir los Bs, en $. */
function monto(bs: number | null, usd: number) {
  return bs === null ? dolares(usd) : bolivares(bs)
}

// Lo declarado va en Bs; las declaraciones de antes de existir los Bs se
// muestran en dolares, como se hicieron.
const aPagar = (d: DeclaracionIva) => d.iva_a_pagar_bs ?? d.iva_a_pagar

/**
 * LAS DECLARACIONES MENSUALES DE IVA. Declarar un mes lo cierra contra el
 * credito fiscal y deja la diferencia como deuda real hasta que se paga.
 * Las mismas acciones y preguntas de la web: declarar un mes cerrado, pagar
 * lo declarado (por banco o de la gaveta) y anular la ultima si quedo mal.
 */
export default function Declaraciones({ alCambiar }: { alCambiar: () => void }) {
  const t = useTema()
  const tintaExito = useTintaDe('exito')
  const { datos, error, refrescando, refrescar } = useCarga(async () => {
    const [declaraciones, pendientes] = await Promise.all([
      apiImpuestos.listarDeclaraciones().catch(() => [] as DeclaracionIva[]),
      apiImpuestos.periodosPendientes().catch(() => [] as PeriodoPendiente[]),
    ])
    return { declaraciones, pendientes }
  }, 300)
  useRefrescoDeSeccion(refrescando, refrescar)
  const { elegir, hoja } = useElegir()
  const [errorAccion, setErrorAccion] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function accion(fn: () => Promise<unknown>) {
    setErrorAccion('')
    setOcupado(true)
    try {
      await fn()
      refrescar()
      alCambiar()
    } catch (e) {
      setErrorAccion(mensajeDe(e, 'Ocurrió un error'))
    } finally {
      setOcupado(false)
    }
  }

  async function declarar(p: PeriodoPendiente) {
    if (p.sin_tasa > 0) {
      await avisar(
        `Falta la tasa en ${p.etiqueta}`,
        `${p.sin_tasa} documento(s) de ese mes no tienen tasa de cambio, y sin ella no hay bolívares que declarar. Cárgales la tasa desde el libro y vuelve a declarar.`,
      )
      return
    }
    const neto = p.iva_debito_bs - p.iva_credito_bs - p.retenciones_bs
    const resumen =
      neto > 0
        ? `Quedaría por pagar hasta ${bolivares(neto)} (menos el crédito que venga arrastrado).`
        : `El crédito fiscal cubre el débito: no se paga nada y sobran ${bolivares(Math.abs(neto))} para el mes siguiente.`
    if (
      !(await confirmar({
        titulo: `¿Declarar ${p.etiqueta}?`,
        texto: `IVA cobrado en ventas: ${bolivares(p.iva_debito_bs)}\nIVA pagado en compras: ${bolivares(p.iva_credito_bs)}${p.retenciones_bs ? `\nRetenido por clientes: ${bolivares(p.retenciones_bs)}` : ''}\n\n${resumen}`,
        aceptar: 'Declarar',
      }))
    )
      return
    void accion(() => apiImpuestos.declararIva(p.anio, p.mes))
  }

  async function anular(d: DeclaracionIva) {
    if (
      !(await confirmar({
        titulo: `¿Anular la declaración de ${d.etiqueta}?`,
        texto: 'Se revierten sus asientos (y el del pago, si lo hubo) y el período vuelve a quedar pendiente para declararlo bien.',
        aceptar: 'Anular',
        peligro: true,
      }))
    )
      return
    void accion(() => apiImpuestos.anularDeclaracion(d.id))
  }

  async function pagar(d: DeclaracionIva) {
    const forma = await elegir(
      `Pagar el IVA de ${d.etiqueta}`,
      [
        { valor: 'Banco', texto: 'Por banco' },
        { valor: 'Efectivo', texto: 'En efectivo', detalle: 'Sale de la gaveta.' },
      ],
      `Son ${monto(d.iva_a_pagar_bs, d.iva_a_pagar)}. ¿De dónde sale?`,
    )
    if (!forma) return
    void accion(() => apiImpuestos.pagarDeclaracion(d.id, forma))
  }

  if (error && !datos) return <Problema mensaje={error} alReintentar={refrescar} />
  if (!datos) return <Cargando />

  const { declaraciones, pendientes } = datos
  const porPagar = declaraciones.filter((d) => !d.pagada && aPagar(d) > 0)
  const porPagarBs = porPagar.filter((d) => d.iva_a_pagar_bs !== null)
  const porPagarUsd = porPagar.filter((d) => d.iva_a_pagar_bs === null)
  const ultima = declaraciones[0]

  return (
    <>
      {errorAccion ? <Problema mensaje={errorAccion} /> : null}

      {pendientes.length > 0 ? (
        <Ficha tono="aviso" style={{ gap: 10 }}>
          <Cabeza
            titulo="Meses cerrados sin declarar"
            ayuda="Solo aparecen meses que ya terminaron: el mes en curso todavía puede recibir ventas."
          />
          {pendientes.map((p) => (
            <View key={`${p.anio}-${p.mes}`} style={[estilos.pendiente, { backgroundColor: t.superficie }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[estilos.nombre, { color: t.tinta }]}>{p.etiqueta}</Text>
                <Text style={[estilos.detalle, { color: t.suave }]}>
                  débito {bolivares(p.iva_debito_bs)} · crédito {bolivares(p.iva_credito_bs)}
                  {p.sin_tasa > 0 ? <Text style={{ color: t.aviso }}> · {p.sin_tasa} sin tasa</Text> : null}
                </Text>
              </View>
              <BotonChico texto="Declarar" tono="acento" alTocar={() => declarar(p)} deshabilitado={ocupado} />
            </View>
          ))}
        </Ficha>
      ) : null}

      {ultima && (ultima.credito_excedente_bs ?? ultima.credito_excedente) > 0 ? (
        <Caja tono="exito">
          <Text style={[estilos.detalleLargo, { color: tintaExito }]}>
            Tienes {monto(ultima.credito_excedente_bs, ultima.credito_excedente)} de crédito fiscal a favor de {ultima.etiqueta}: se
            descuentan del IVA del mes siguiente.
          </Text>
        </Caja>
      ) : null}

      <Ficha style={{ gap: 10 }}>
        <Cabeza titulo="Declaraciones presentadas" />
        {porPagar.length > 0 ? (
          <Text style={[estilos.porPagar, { color: t.peligro }]}>
            {porPagar.length} sin pagar por{' '}
            {[
              porPagarBs.length ? bolivares(porPagarBs.reduce((s, d) => s + (d.iva_a_pagar_bs ?? 0), 0)) : '',
              porPagarUsd.length ? dolares(porPagarUsd.reduce((s, d) => s + d.iva_a_pagar, 0)) : '',
            ]
              .filter(Boolean)
              .join(' + ')}
          </Text>
        ) : null}
        {declaraciones.length === 0 ? <Nota>Sin declaraciones todavía. Se declara cada mes una vez cerrado.</Nota> : null}

        {declaraciones.map((d) => (
          <View key={d.id} style={[estilos.declaracion, { borderColor: t.gris200 }]}>
            <View style={estilos.cabeza}>
              <Text style={[estilos.nombre, { color: t.tinta }]}>{d.etiqueta}</Text>
              <View style={{ flex: 1 }} />
              {aPagar(d) > 0 ? (
                d.pagada ? (
                  <Pastilla texto={`pagada · ${d.forma_pago ?? ''}`} tono="bien" />
                ) : (
                  <Text style={[estilos.monto, { color: t.peligro }]}>{monto(d.iva_a_pagar_bs, d.iva_a_pagar)}</Text>
                )
              ) : (
                <Text style={[estilos.detalle, { color: t.suave }]}>sin IVA por pagar</Text>
              )}
            </View>
            <Text style={[estilos.detalle, { color: t.suave }]}>
              débito {monto(d.iva_debito_bs, d.iva_debito)} · crédito {monto(d.iva_credito_bs, d.iva_credito)}
              {(d.credito_arrastrado_bs ?? d.credito_arrastrado) > 0
                ? ` (+ ${monto(d.credito_arrastrado_bs, d.credito_arrastrado)} arrastrado)`
                : ''}
              {(d.credito_excedente_bs ?? d.credito_excedente) > 0 ? ` · sobran ${monto(d.credito_excedente_bs, d.credito_excedente)}` : ''}
              {(d.retenciones_usadas_bs ?? 0) > 0 ? ` · retenciones descontadas ${bolivares(d.retenciones_usadas_bs ?? 0)}` : ''}
              {(d.retenciones_excedente_bs ?? 0) > 0 ? ` · retenciones por descontar ${bolivares(d.retenciones_excedente_bs ?? 0)}` : ''}
            </Text>
            <View style={estilos.acciones}>
              {/* Una declaracion mal hecha se quedaba mal para siempre: no existia borrar. */}
              <BotonChico texto="Anular" tono="enlacePeligro" alTocar={() => anular(d)} deshabilitado={ocupado} />
              {aPagar(d) > 0 && !d.pagada ? (
                <BotonChico texto="Registrar pago" alTocar={() => pagar(d)} deshabilitado={ocupado} />
              ) : null}
            </View>
          </View>
        ))}
      </Ficha>
      {hoja}
    </>
  )
}

const estilos = StyleSheet.create({
  pendiente: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, padding: 12 },
  nombre: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  detalle: { fontFamily: LETRA.texto, fontSize: 13, lineHeight: 18, marginTop: 2 },
  detalleLargo: { fontFamily: LETRA.texto, fontSize: 14, lineHeight: 20 },
  porPagar: { fontFamily: LETRA.textoFuerte, fontSize: 14 },
  declaracion: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 4 },
  cabeza: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  monto: { fontFamily: LETRA.cifraFuerte, fontSize: 15 },
  acciones: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
})
