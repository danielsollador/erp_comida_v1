import { router } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { ivaRetenido } from '../../../../frontend/src/lib/compras'
import { etiquetaMetodo, METODOS_PAGO, necesitaReferencia } from '../../../../frontend/src/lib/pagos'
import { apiPos, type PagoCobro } from '../../lib/api-pos'
import { fmtBs, useMoneda } from '../../lib/moneda'
import {
  BILLETES_USD,
  METODOS_EFECTIVO,
  METODOS_VUELTO,
  monto,
  leerBs,
  redondear,
  resolverPago,
  usd,
  usdComa,
  type PagoVerificado,
  type Parte,
  type VueltoListo,
} from '../../lib/pos'
import { LETRA, useTema } from '../../lib/tema'
import type { EstadoPabilo, Pedido } from '../../lib/tipos'
import { CampoNumero, HojaFormulario } from '../kit'
import { Boton, Campo, Interruptor } from '../ui'
import { BotonChico } from './piezas'
import { usePregunta } from './Pregunta'
import { VerificarPago } from './VerificarPago'
import { VueltoPagoMovil } from './VueltoPagoMovil'

/*
 * COBRAR UN PEDIDO: el cuadro de cobro de pages/POS.tsx, entero.
 *
 * Un solo cuadro, un paso a la vez: las formas de pago; el efectivo con su
 * vuelto (exacto o con billete, y por donde sale el vuelto); el pago movil
 * verificado con el banco; el pago partido en varias formas; fiar con el
 * nombre del cliente; y abajo, plegado, lo de vez en cuando: el cliente, el
 * descuento y la propina. Arriba, la factura fiscal con su RIF.
 *
 * Se monta de cero cada vez que se abre: lo que dejo un cobro (una propina
 * de un pago movil, un descuento) no reaparece en el siguiente.
 */
export function Cobro({
  pedido,
  pabilo,
  puntoId,
  tasaIva,
  alCobrado,
  alFallar,
  alCerrar,
}: {
  pedido: Pedido
  pabilo: EstadoPabilo | null
  puntoId: number | null
  tasaIva: number
  alCobrado: (p: Pedido) => void
  alFallar: (mensaje: string) => void
  alCerrar: () => void
}) {
  const t = useTema()
  const { tasa, fmt } = useMoneda()
  const tasaBcv = tasa?.bcv ?? 0
  const pregunta = usePregunta()

  const [facturar, setFacturar] = useState(false)
  const [numeroFactura, setNumeroFactura] = useState('')
  const [numeroControl, setNumeroControl] = useState('')
  const [rifCliente, setRifCliente] = useState('')
  const [razonSocial, setRazonSocial] = useState('')
  // El cliente es contribuyente especial y retiene parte del IVA: '' = no.
  const [retencion, setRetencion] = useState<'' | '75' | '100'>('')
  const [descuento, setDescuento] = useState('')
  const [motivoDescuento, setMotivoDescuento] = useState('')
  const [propina, setPropina] = useState('')
  // Si se anoto al tomar la comanda, el cobro arranca con el nombre puesto.
  const [cliente, setCliente] = useState(pedido.cliente || '')
  const [efectivo, setEfectivo] = useState<{ metodo: string; conVuelto: boolean } | null>(null)
  const [billete, setBillete] = useState('')
  const [vueltoMovil, setVueltoMovil] = useState(false)
  // Descuento y propina van abajo y plegados: son la excepcion, no el cobro.
  const [conAjustes, setConAjustes] = useState(false)
  const [pagoMixto, setPagoMixto] = useState(false)
  const [partes, setPartes] = useState<Parte[]>([])
  const [verificando, setVerificando] = useState<{
    metodo: string
    monto: number
    resolver: (pago: PagoVerificado | null) => void
    vez: number
  } | null>(null)
  const [error, setError] = useState('')
  const [cobrando, setCobrando] = useState(false)
  const yaCobrando = useRef(false)

  // Si el cuadro se cierra con una verificacion abierta, quien la esperaba se entera.
  const verificandoRef = useRef(verificando)
  useEffect(() => {
    verificandoRef.current = verificando
  })
  useEffect(() => () => verificandoRef.current?.resolver(null), [])

  // Lo que de verdad se recibe: la comida menos el descuento, mas la propina.
  const subtotal = pedido.total
  const descuentoNum = Math.min(monto(descuento), subtotal)
  const propinaNum = monto(propina)
  // Lo que retiene un cliente contribuyente especial no entra a la gaveta.
  const retenidoIva = facturar && retencion ? ivaRetenido(subtotal - descuentoNum, Number(retencion), tasaIva) : 0
  const aCobrar = redondear(subtotal - descuentoNum + propinaNum - retenidoIva)
  // Lo que entrego el cliente, SIEMPRE en dolares: en la gaveta de bolivares
  // se teclean bolivares (lo que hay en la mano) y se pasa a la tasa del dia.
  const enBs = efectivo?.metodo === 'Efectivo Bs'
  const billeteNum = enBs ? leerBs(billete) || 0 : monto(billete)
  const entregado = enBs ? (tasaBcv > 0 ? redondear(billeteNum / tasaBcv) : 0) : billeteNum
  const vuelto = Math.max(redondear(entregado - aCobrar), 0)
  const faltaMixto = Math.max(redondear(aCobrar - partes.reduce((s, p) => s + p.monto, 0)), 0)

  /**
   * La referencia de un pago que no es efectivo y, si el local tiene Pabilo
   * y el metodo cae en su cuenta, la confirmacion del banco. `null` si la
   * cajera se echo atras.
   */
  function pedirPago(metodo: string, cuanto: number): Promise<PagoVerificado | null> {
    const verificable = Boolean(pabilo?.configurado && !pabilo.error && pabilo.metodos.includes(metodo))
    if (verificable) return new Promise((resolver) => setVerificando({ metodo, monto: cuanto, resolver, vez: Date.now() }))
    if (!necesitaReferencia(metodo)) return Promise.resolve({ referencia: '' })
    return pregunta
      .pedirTexto({
        titulo: `Referencia del pago por ${metodo}`,
        etiqueta: 'Referencia',
        placeholder: 'Número de confirmación, ticket o comprobante',
      })
      .then((r) => (r === null ? null : { referencia: r }))
  }

  async function cobrar(
    metodo: string,
    pagos?: PagoCobro[],
    referencia?: string,
    // El nombre recien escrito en un cuadro: el estado todavia no se aplico.
    clienteAhora?: string,
    // La propina y el descuento que acaba de fijar la verificacion del pago movil.
    ajustes?: { propina?: number; descuento?: number; motivo_descuento?: string },
    // La propina que se queda ademas de la escrita: el vuelto que el cliente no quiso.
    propinaExtra = 0,
  ) {
    if (yaCobrando.current) return
    yaCobrando.current = true
    setCobrando(true)
    setError('')
    try {
      const cobrado = await apiPos.cobrarPedido(pedido.id, metodo, facturar, numeroFactura, pagos, {
        descuento: ajustes?.descuento ?? descuentoNum,
        motivo_descuento: ajustes?.motivo_descuento ?? motivoDescuento,
        propina: redondear((ajustes?.propina ?? propinaNum) + propinaExtra),
        cliente: clienteAhora ?? cliente,
        punto_venta_id: puntoId,
        referencia,
        factura: { numero_control: numeroControl, rif_cliente: rifCliente, razon_social_cliente: razonSocial },
        retencion_iva_pct: retencion ? Number(retencion) : undefined,
      })
      alCobrado(cobrado)
    } catch (e) {
      // Todo el cuadro se vacia, no solo se cierra: la propina o el descuento
      // que dejo una verificacion no reaparecen como si se hubieran escrito.
      alFallar(e instanceof Error ? e.message : 'No se pudo cobrar')
    }
  }

  /**
   * Fiar. Lo unico que hace falta y no siempre esta es el nombre: se pide
   * aqui en vez de dejar el boton apagado (un boton gris se lee como "el
   * sistema no deja fiar").
   */
  async function cobrarACredito() {
    let nombre = cliente.trim()
    if (!nombre) {
      const escrito = await pregunta.pedirTexto({
        titulo: 'Vender a crédito',
        texto: 'Queda como cuenta por cobrar. Se salda después desde Caja.',
        etiqueta: '¿A nombre de quién queda la deuda?',
        aceptar: 'Fiar',
      })
      if (escrito === null) return
      nombre = escrito.trim()
      if (!nombre) {
        setError('Para fiar hace falta el nombre del cliente: si no, no hay a quién cobrarle.')
        return
      }
      setCliente(nombre)
    }
    // Fiar no lleva referencia ni vuelto: no entra plata por ninguna gaveta.
    void cobrar('Fiado', undefined, undefined, nombre)
  }

  async function confirmarCobro(metodo: string) {
    // El efectivo no se cobra de un toque: antes, exacto o con vuelto.
    if (METODOS_EFECTIVO.includes(metodo)) {
      setEfectivo({ metodo, conVuelto: false })
      setBillete('')
      return
    }
    const pago = await pedirPago(metodo, aCobrar)
    if (pago === null) return
    void cobrarVerificado(metodo, pago)
  }

  /** Cobrar con lo que el banco dijo que entro (y lo que decidio la cajera con la diferencia). */
  async function cobrarVerificado(metodo: string, pago: PagoVerificado) {
    const r = await resolverPago(metodo, aCobrar, pago, tasaBcv, pedirPago)
    const propinaTotal = redondear(propinaNum + r.propina)
    const descuentoTotal = redondear(descuentoNum + r.descuento)
    const motivo = r.descuento > 0 ? motivoDescuento.trim() || r.motivo || 'Diferencia del pago móvil' : motivoDescuento
    if (r.propina) setPropina(String(propinaTotal))
    if (r.descuento) {
      setDescuento(String(descuentoTotal))
      setMotivoDescuento(motivo)
    }
    if (r.pendiente) {
      // Lo que entro queda anotado y lo que falta se cobra aparte.
      setPagoMixto(true)
      setPartes(r.partes)
      return
    }
    void cobrar(metodo, r.partes, undefined, undefined, { propina: propinaTotal, descuento: descuentoTotal, motivo_descuento: motivo })
  }

  /** Efectivo con vuelto: entra el billete completo y sale la diferencia por donde diga la cajera. */
  function cobrarConVuelto(vueltoMetodo: string) {
    if (!efectivo) return
    if (vueltoMetodo === 'Pago movil') {
      setVueltoMovil(true)
      return
    }
    void cobrar(efectivo.metodo, [{ metodo: efectivo.metodo, monto: aCobrar, recibido: entregado, vuelto_metodo: vueltoMetodo }])
  }

  function cobrarConVueltoMovil(v: VueltoListo) {
    if (!efectivo) return
    void cobrar(efectivo.metodo, [
      {
        metodo: efectivo.metodo,
        monto: aCobrar,
        recibido: entregado,
        vuelto_metodo: 'Pago movil',
        vuelto_referencia: v.referencia,
        vuelto_id: v.vuelto_id,
      },
    ])
  }

  /**
   * "Quedate con eso": no sale nada de la gaveta y lo que sobra queda como
   * propina (Leider, 2-oct). No es venta: no infla lo vendido ni el IVA.
   */
  function cobrarSinVuelto() {
    if (!efectivo || vuelto <= 0) return
    const total = redondear(aCobrar + vuelto)
    void cobrar(efectivo.metodo, [{ metodo: efectivo.metodo, monto: total, recibido: entregado }], undefined, undefined, undefined, vuelto)
  }

  /**
   * Agregar una forma al pago mixto. El monto viene propuesto con lo que
   * falta; se puede bajar para partirlo en tres. Nunca mas de lo que falta.
   */
  async function agregarParte(metodo: string) {
    if (faltaMixto <= 0) return
    const cuanto = await pregunta.pedirNumero({
      titulo: `¿Cuánto paga con ${etiquetaMetodo(metodo)}?`,
      texto: `Faltan ${fmt(faltaMixto)} de ${fmt(aCobrar)}.`,
      etiqueta: 'Monto',
      sufijo: '$',
      valor: faltaMixto,
      min: 0.01,
    })
    if (cuanto === null) return
    if (cuanto > faltaMixto + 0.001) {
      setError(`Esa parte (${fmt(cuanto)}) pasa de lo que falta (${fmt(faltaMixto)}).`)
      return
    }
    // Cada parte lleva su propio comprobante: son pagos distintos.
    const pago = await pedirPago(metodo, cuanto)
    if (pago === null) return
    setError('')
    const r = await resolverPago(metodo, redondear(cuanto), pago, tasaBcv, pedirPago)
    if (r.propina) setPropina(String(redondear(propinaNum + r.propina)))
    if (r.descuento) {
      setDescuento(String(redondear(descuentoNum + r.descuento)))
      setMotivoDescuento((m) => m.trim() || r.motivo || 'Diferencia del pago móvil')
    }
    setPartes((p) => [...p, ...r.partes])
  }

  function cobrarMixto() {
    if (faltaMixto > 0.001 || partes.length === 0) return
    // El nombre recien escrito: si alguna parte es a credito, hace falta.
    void cobrar('Mixto', partes, undefined, cliente.trim())
  }

  const efectivoTexto = (n: number) => (enBs && tasaBcv > 0 ? fmtBs(n * tasaBcv) : usdComa(n))

  // ── El paso de pago que toca ──
  let paso
  if (verificando && pabilo) {
    paso = (
      <VerificarPago
        key={verificando.vez}
        metodo={verificando.metodo}
        montoUsd={verificando.monto}
        tasa={tasaBcv}
        estado={pabilo}
        pedidoId={pedido.id}
        enMixto={pagoMixto}
        alListo={(pago) => {
          verificando.resolver(pago)
          setVerificando(null)
        }}
        alCancelar={() => {
          verificando.resolver(null)
          setVerificando(null)
        }}
      />
    )
  } else if (vueltoMovil && efectivo) {
    paso = (
      <VueltoPagoMovil
        montoBs={vuelto * tasaBcv}
        montoUsd={vuelto}
        estado={pabilo}
        pedidoId={pedido.id}
        alListo={cobrarConVueltoMovil}
        alCancelar={() => setVueltoMovil(false)}
      />
    )
  } else if (!pagoMixto && efectivo) {
    // Efectivo paso a paso (Leider, 21-sep): exacto o con diferencia; si hay
    // diferencia, de cuanto es el billete y por donde sale el vuelto.
    paso = (
      <View style={{ gap: 10 }}>
        <View style={e.cabezaPaso}>
          <Text style={[e.metodoPaso, { color: t.tinta }]}>{efectivo.metodo}</Text>
          <BotonChico
            texto="Cambiar forma de pago"
            color={t.suave}
            alTocar={() => {
              setEfectivo(null)
              setBillete('')
            }}
          />
        </View>
        {!efectivo.conVuelto ? (
          <>
            <Pressable
              onPress={() => void cobrar(efectivo.metodo)}
              style={({ pressed }) => [e.verde, { backgroundColor: t.exitoSuave, borderColor: t.exito500, opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={[e.verdeTexto, { color: t.exito }]}>
                Paga exacto · <Text style={{ fontFamily: LETRA.cifraFuerte }}>{efectivoTexto(aCobrar)}</Text>
              </Text>
            </Pressable>
            <Boton
              texto="Paga con más: hay vuelto"
              tono="neutro"
              alTocar={() => setEfectivo({ ...efectivo, conVuelto: true })}
              deshabilitado={enBs && tasaBcv === 0}
            />
            {enBs && tasaBcv === 0 ? (
              <Text style={[e.nota, { color: t.aviso }]}>Sin tasa de cambio no se puede calcular el vuelto</Text>
            ) : null}
          </>
        ) : (
          <>
            <CampoNumero
              rotulo={enBs ? '¿Con cuántos bolívares paga?' : '¿De cuánto es el billete?'}
              valor={billete}
              alCambiar={setBillete}
              prefijo={enBs ? 'Bs' : '$'}
              placeholder={enBs ? '0,00' : '20.00'}
            />
            {/* Los billetes de siempre: tocar "20" es mas rapido y se equivoca menos. */}
            {!enBs ? (
              <View style={e.billetes}>
                {BILLETES_USD.filter((b) => b > aCobrar)
                  .slice(0, 5)
                  .map((b) => (
                    <Pressable
                      key={b}
                      onPress={() => setBillete(String(b))}
                      style={({ pressed }) => [e.billete, { backgroundColor: pressed ? t.gris200 : t.gris100 }]}
                    >
                      <Text style={[e.billeteTexto, { color: t.tinta }]}>${b}</Text>
                    </Pressable>
                  ))}
              </View>
            ) : null}
            {vuelto > 0 ? (
              <>
                <View style={e.vuelto}>
                  <Text style={[e.nota, { color: t.suave }]}>Vuelto · ¿por dónde sale?</Text>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[e.vueltoCifra, { color: t.exito }]}>{usd(vuelto)}</Text>
                    {tasaBcv > 0 ? <Text style={[e.nota, { color: t.suave }]}>{fmtBs(vuelto * tasaBcv)}</Text> : null}
                  </View>
                </View>
                <View style={e.rejilla}>
                  {METODOS_VUELTO.map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => cobrarConVuelto(m)}
                      style={({ pressed }) => [e.forma, { borderColor: t.gris200, backgroundColor: pressed ? t.gris100 : t.superficie }]}
                    >
                      <Text style={[e.formaTexto, { color: t.tinta }]}>{m}</Text>
                      {m !== 'Efectivo $' && tasaBcv > 0 ? (
                        <Text style={[e.formaDetalle, { color: t.suave }]}>{fmtBs(vuelto * tasaBcv)}</Text>
                      ) : null}
                    </Pressable>
                  ))}
                  {/* "Quedate con eso": no sale nada de la gaveta. */}
                  <Pressable
                    onPress={cobrarSinVuelto}
                    style={({ pressed }) => [e.forma, { borderColor: t.exito500, backgroundColor: pressed ? t.exitoSuave : t.exitoSuave }]}
                  >
                    <Text style={[e.formaTexto, { color: t.exito }]}>No quiere el vuelto</Text>
                    <Text style={[e.formaDetalle, { color: t.exito }]}>queda como propina {usd(vuelto)}</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <Text style={[e.nota, { color: t.suave }]}>Tiene que ser más de {efectivoTexto(aCobrar)}.</Text>
            )}
          </>
        )}
      </View>
    )
  } else if (!pagoMixto && aCobrar <= 0) {
    // Todo regalado: no entra plata. El costo lo reconoce el servidor como cortesia.
    paso = (
      <Pressable
        onPress={() => void confirmarCobro(METODOS_PAGO[0])}
        style={({ pressed }) => [e.verde, { backgroundColor: t.exitoSuave, borderColor: t.exito500, opacity: pressed ? 0.85 : 1 }]}
      >
        <Text style={[e.verdeTexto, { color: t.exito }]}>Cerrar como cortesía (no se cobra)</Text>
      </Pressable>
    )
  } else if (!pagoMixto) {
    paso = (
      <View style={{ gap: 8 }}>
        <View style={e.rejilla}>
          {METODOS_PAGO.map((m) => (
            <Pressable
              key={m}
              onPress={() => void confirmarCobro(m)}
              style={({ pressed }) => [e.forma, { borderColor: t.gris200, backgroundColor: pressed ? t.gris100 : t.superficie }]}
            >
              <Text style={[e.formaTexto, { color: t.tinta }]}>{m}</Text>
            </Pressable>
          ))}
          {/* No entra plata: nace una cuenta por cobrar. Se pulsa siempre; si
              falta el nombre, se pide en ese momento. */}
          <Pressable
            onPress={() => void cobrarACredito()}
            style={({ pressed }) => [e.forma, { borderColor: t.avisoLinea, backgroundColor: pressed ? t.avisoLinea : t.avisoSuave }]}
          >
            <Text style={[e.formaTexto, { color: t.avisoFuerte }]}>A crédito</Text>
          </Pressable>
        </View>
        <BotonChico texto="Paga con dos formas" color={t.acento} alTocar={() => setPagoMixto(true)} />
      </View>
    )
  } else {
    paso = (
      <View style={{ gap: 10 }}>
        {/* Lo que falta, GRANDE: es el numero que se le canta al cliente. */}
        <View style={[e.falta, { backgroundColor: faltaMixto > 0 ? t.avisoSuave : t.exitoSuave }]}>
          <Text style={[e.faltaTexto, { color: faltaMixto > 0 ? t.avisoFuerte : t.exito }]}>
            {faltaMixto > 0 ? 'Falta por pagar' : 'Cubierto completo'}
          </Text>
          <Text style={[e.faltaCifra, { color: faltaMixto > 0 ? t.avisoFuerte : t.exito }]}>{fmt(faltaMixto)}</Text>
        </View>
        {partes.map((p, i) => (
          <View key={`${p.metodo}-${i}`} style={[e.parte, { borderColor: t.gris200 }]}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[e.formaTexto, { color: t.tinta, textAlign: 'left' }]}>{etiquetaMetodo(p.metodo)}</Text>
              {p.referencia ? (
                <Text style={[e.formaDetalle, { color: t.tenue, textAlign: 'left' }]} numberOfLines={1}>
                  ref. {p.referencia}
                  {p.verificacion_id ? <Text style={{ color: t.exito }}> · verificada</Text> : null}
                </Text>
              ) : null}
            </View>
            <Text style={[e.parteCifra, { color: t.tinta }]}>{fmt(p.monto)}</Text>
            <Pressable
              onPress={() => setPartes((todas) => todas.filter((_, x) => x !== i))}
              hitSlop={6}
              accessibilityLabel={`Quitar el pago con ${etiquetaMetodo(p.metodo)}`}
              style={({ pressed }) => [e.quitar, { backgroundColor: pressed ? t.peligroSuave : 'transparent' }]}
            >
              <Text style={[e.quitarTexto, { color: t.tenue }]}>×</Text>
            </Pressable>
          </View>
        ))}
        {faltaMixto > 0 ? (
          <>
            <Text style={[e.nota, { color: t.suave }]}>{partes.length === 0 ? 'Con qué paga la primera parte:' : 'Y el resto con:'}</Text>
            <View style={e.rejilla}>
              {[...METODOS_PAGO, 'Fiado'].map((m) => {
                const sinNombre = m === 'Fiado' && !cliente.trim()
                return (
                  <Pressable
                    key={m}
                    onPress={() => (sinNombre ? setError('Escribe el nombre del cliente primero') : void agregarParte(m))}
                    style={({ pressed }) => [
                      e.forma,
                      { borderColor: t.gris200, backgroundColor: pressed ? t.gris100 : t.superficie, opacity: sinNombre ? 0.4 : 1 },
                    ]}
                  >
                    <Text style={[e.formaTexto, { color: t.tinta }]}>{etiquetaMetodo(m)}</Text>
                  </Pressable>
                )
              })}
            </View>
          </>
        ) : null}
        <Boton
          texto={`Cobrar ${fmt(aCobrar)} en ${partes.length} forma(s)`}
          alTocar={cobrarMixto}
          deshabilitado={faltaMixto > 0.001 || partes.length === 0}
          ocupado={cobrando}
        />
        <BotonChico
          texto="Volver a un solo pago"
          color={t.suave}
          alTocar={() => {
            setPagoMixto(false)
            setPartes([])
          }}
        />
      </View>
    )
  }

  const ajustesAbiertos = conAjustes || descuentoNum > 0 || propinaNum > 0

  return (
    <HojaFormulario
      visible
      alCerrar={alCerrar}
      titulo={`Cobrar pedido #${pedido.numero}`}
      subtitulo={pedido.cliente || undefined}
      pie={
        <View style={{ flex: 1 }}>
          <Boton texto="Cancelar" tono="neutro" alTocar={alCerrar} />
        </View>
      }
    >
      <View>
        <Text style={[e.grande, { color: t.tinta }]}>{usd(aCobrar)}</Text>
        {descuentoNum > 0 || propinaNum > 0 ? (
          <Text style={[e.nota, { color: t.suave }]}>
            {usd(subtotal)} de comida
            {descuentoNum > 0 ? ` - ${usdComa(descuentoNum)} de descuento` : ''}
            {propinaNum > 0 ? ` + ${usdComa(propinaNum)} de propina` : ''}
          </Text>
        ) : null}
        {tasaBcv > 0 ? (
          <Text style={[e.bs, { color: t.suave }]}>
            {fmtBs(aCobrar * tasaBcv)}{' '}
            <Text style={e.nota}>
              (tasa {tasaBcv}
              {tasa?.origen === 'manual' ? ', manual' : ''})
            </Text>
          </Text>
        ) : (
          <Text style={[e.nota, { color: t.aviso }]}>
            Sin tasa de cambio cargada -{' '}
            <Text
              style={{ fontFamily: LETRA.textoFuerte, textDecorationLine: 'underline' }}
              onPress={() => {
                alCerrar()
                router.push('/tasa')
              }}
            >
              configúrala aquí
            </Text>
            .
          </Text>
        )}
      </View>

      <Interruptor texto="Facturar esta venta" valor={facturar} alCambiar={setFacturar} />
      {facturar ? (
        <View style={{ gap: 10 }}>
          <View style={e.dos}>
            <View style={{ flex: 1 }}>
              <Campo value={numeroFactura} onChangeText={setNumeroFactura} placeholder="N.º de factura" />
            </View>
            <View style={{ flex: 1 }}>
              <Campo value={numeroControl} onChangeText={setNumeroControl} placeholder="N.º de control" />
            </View>
          </View>
          <View style={e.dos}>
            <View style={{ flex: 1 }}>
              <Campo value={rifCliente} onChangeText={setRifCliente} placeholder="RIF o cédula" autoCapitalize="characters" />
            </View>
            <View style={{ flex: 1 }}>
              <Campo value={razonSocial} onChangeText={setRazonSocial} placeholder="Nombre o razón social" />
            </View>
          </View>
          <Text style={[e.nota, { color: t.suave }]}>
            Todo opcional. Sin RIF ni nombre, va al Libro de Ventas como consumidor final. Siempre con IVA.
          </Text>
          <Interruptor
            texto="El cliente retiene IVA (contribuyente especial)"
            valor={!!retencion}
            alCambiar={(v) => setRetencion(v ? '75' : '')}
          />
          {retencion ? (
            <View style={e.dos}>
              {(['75', '100'] as const).map((pct) => (
                <Pressable
                  key={pct}
                  onPress={() => setRetencion(pct)}
                  accessibilityState={{ selected: retencion === pct }}
                  style={[e.pct, { borderColor: t.gris200, backgroundColor: retencion === pct ? t.tinta : t.superficie }]}
                >
                  <Text style={[e.formaTexto, { color: retencion === pct ? t.papel : t.tinta }]}>{pct} %</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {retenidoIva > 0 ? (
            <Text style={[e.nota, { color: t.suave }]}>
              Retiene {fmt(retenidoIva)} de IVA: se cobra el resto. Lo retenido no entra a la gaveta; su comprobante se carga en el
              Libro de Ventas cuando llegue.
            </Text>
          ) : null}
        </View>
      ) : null}

      {error ? <Text style={[e.nota, { color: t.peligro }]}>{error}</Text> : null}
      {cobrando && !pagoMixto ? (
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
          <ActivityIndicator color={t.acento} />
          <Text style={[e.nota, { color: t.suave }]}>Cobrando…</Text>
        </View>
      ) : null}
      {paso}

      {/* Lo de vez en cuando, abajo y plegado: el nombre del cliente (solo
          fiar lo exige) y el descuento o la propina. */}
      {!verificando && !vueltoMovil ? (
        <View style={[e.ajustes, { borderTopColor: t.gris200 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Campo value={cliente} onChangeText={setCliente} placeholder="Cliente (opcional)" autoCapitalize="words" />
            </View>
            <Pressable
              onPress={() => setConAjustes((v) => !v)}
              style={[e.botonAjustes, ajustesAbiertos ? { backgroundColor: t.tinta } : { backgroundColor: t.gris100 }]}
            >
              <Text style={[e.ajustesTexto, { color: ajustesAbiertos ? t.papel : t.suave }]}>Descuento · propina</Text>
            </Pressable>
          </View>
          {ajustesAbiertos ? (
            <>
              <View style={e.dos}>
                <CampoNumero rotulo="Descuento" valor={descuento} alCambiar={setDescuento} placeholder="0.00" style={{ flex: 1 }} />
                {/* La propina no es venta: entra a la gaveta y se le debe al empleado. */}
                <CampoNumero rotulo="Propina" valor={propina} alCambiar={setPropina} placeholder="0.00" style={{ flex: 1 }} />
              </View>
              {descuentoNum > 0 ? (
                <Campo value={motivoDescuento} onChangeText={setMotivoDescuento} placeholder="Motivo del descuento" />
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}
      {pregunta.elemento}
    </HojaFormulario>
  )
}

const e = StyleSheet.create({
  grande: { fontFamily: LETRA.tituloFuerte, fontSize: 40, letterSpacing: -1.2 },
  bs: { fontFamily: LETRA.cifra, fontSize: 15, marginTop: 2 },
  nota: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
  dos: { flexDirection: 'row', gap: 10 },
  pct: { flex: 1, minHeight: 44, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  cabezaPaso: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  metodoPaso: { fontFamily: LETRA.textoFuerte, fontSize: 16 },
  verde: { minHeight: 54, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  verdeTexto: { fontFamily: LETRA.textoFuerte, fontSize: 15.5, textAlign: 'center' },
  billetes: { flexDirection: 'row', gap: 6 },
  billete: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  billeteTexto: { fontFamily: LETRA.cifraFuerte, fontSize: 15 },
  vuelto: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 },
  vueltoCifra: { fontFamily: LETRA.cifraFuerte, fontSize: 20 },
  rejilla: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  forma: {
    flexGrow: 1,
    flexBasis: '45%',
    minHeight: 54,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  formaTexto: { fontFamily: LETRA.textoFuerte, fontSize: 15, textAlign: 'center' },
  formaDetalle: { fontFamily: LETRA.texto, fontSize: 13, textAlign: 'center', marginTop: 1 },
  falta: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  faltaTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14.5 },
  faltaCifra: { fontFamily: LETRA.tituloFuerte, fontSize: 22 },
  parte: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 14, paddingLeft: 14, paddingRight: 4, minHeight: 52 },
  parteCifra: { fontFamily: LETRA.cifraFuerte, fontSize: 15 },
  quitar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  quitarTexto: { fontSize: 22, lineHeight: 24 },
  ajustes: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 10 },
  botonAjustes: { minHeight: 50, borderRadius: 14, paddingHorizontal: 12, justifyContent: 'center' },
  ajustesTexto: { fontFamily: LETRA.textoFuerte, fontSize: 13.5 },
})
