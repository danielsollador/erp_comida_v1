import { useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { etiquetaMetodo } from '../../../../frontend/src/lib/pagos'
import { apiVentas } from '../../lib/api-ventas'
import { avisar } from '../../lib/dialogo'
import { fmtBs } from '../../lib/moneda'
import { fechaCorta, horaCorta } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import type { Pedido, VentaFila } from '../../lib/tipos'
import { Pastilla, useDisposicion } from '../kit'
import { Boton, Etiqueta, Ficha, Fila, Titulo } from '../ui'
import CorregirPago from './CorregirPago'
import EditarPedido from './EditarPedido'
import { FormCobrarFiado, FormDevolver, FormFacturar } from './Formularios'
import { apagada as estaApagada, estadoDe, useDinero } from './logica'
import { sacarTicket, TEXTO_BOTON_TICKET } from './ticket'

type Cuadro = 'pago' | 'facturar' | 'devolver' | 'fiado' | null

/**
 * EL DETALLE DE UNA VENTA, lo que en la web se despliega al tocar la fila
 * (DetalleVenta de pages/Ventas.tsx): los renglones con el total, que paso,
 * como se pago, quien, la factura, lo fiado, las ediciones con quien firmo, y
 * lo que se le puede hacer, cada cosa junto al dato que cambia: "Editar pago"
 * junto a como se pago, "Facturar ahora" junto a la factura, "Cobrar /
 * abonar" junto a lo que debe. Corregir los renglones y devolver van abajo.
 *
 * En la tablet, los renglones a la izquierda y los datos a la derecha, como
 * las dos columnas de la web.
 */
export default function DetalleVenta({ v, alCambio }: { v: VentaFila; alCambio: () => void }) {
  const t = useTema()
  const { tablet } = useDisposicion()
  const dineroDe = useDinero()
  const dinero = (x: number) => dineroDe(x, v.tasa_bcv)
  const [cuadro, setCuadro] = useState<Cuadro>(null)
  const [editando, setEditando] = useState<Pedido | null>(null)
  const [abriendo, setAbriendo] = useState(false)
  const apagada = estaApagada(v)
  const estado = estadoDe(v)
  const vendida = v.estado === 'cobrada' || v.estado === 'fiada'

  const listo = () => {
    setCuadro(null)
    alCambio()
  }

  async function abrirEdicion() {
    setAbriendo(true)
    try {
      // Abrir toma el candado: mientras se edita, la cocina ve la comanda bloqueada.
      setEditando(await apiVentas.abrirEdicion(v.id))
    } catch (e) {
      await avisar('No se puede corregir', e instanceof Error ? e.message : 'Intenta de nuevo.')
    } finally {
      setAbriendo(false)
    }
  }

  function cerrarEdicion() {
    if (editando) apiVentas.soltarEdicion(editando.id).catch(() => undefined)
    setEditando(null)
    alCambio()
  }

  async function ticket() {
    try {
      await sacarTicket(v.id)
    } catch (e) {
      await avisar('No se pudo imprimir', e instanceof Error ? e.message : 'Intenta de nuevo.')
    }
  }

  const renglones = (
    <Ficha style={{ flex: tablet ? 1.4 : undefined }}>
      <Etiqueta>Renglones</Etiqueta>
      <View style={{ marginTop: 6 }}>
        {v.items.map((i, n) => (
          <View key={i.id} style={[e.renglon, n < v.items.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 }]}>
            <Text style={[e.renglonTexto, { color: t.tinta }]}>
              <Text style={{ fontFamily: LETRA.cifra, color: t.suave }}>{i.cantidad}× </Text>
              {i.nombre}
              {i.nota ? <Text style={{ color: t.tenue, fontSize: 13 }}> · {i.nota}</Text> : null}
            </Text>
            <Text style={[e.cifra, { color: t.tinta }]}>{dinero(i.precio_unitario * i.cantidad)}</Text>
          </View>
        ))}
      </View>
      <View style={[e.totales, { borderTopColor: t.gris200 }]}>
        {v.descuento > 0 ? <Fila nombre="Precio de lista" valor={dinero(v.subtotal)} /> : null}
        {v.descuento > 0 ? <Fila nombre="Descuento" valor={`−${dinero(v.descuento)}`} color={t.aviso} /> : null}
        <Fila nombre="Total" valor={dinero(v.total)} fuerte ultima={!v.propina && !(v.total_bs != null && v.tasa_bcv)} />
        {v.propina > 0 ? <Fila nombre="Propina (del empleado, no es venta)" valor={dinero(v.propina)} ultima={!(v.total_bs != null && v.tasa_bcv)} /> : null}
        {v.total_bs != null && v.tasa_bcv ? (
          <Fila nombre={`A la tasa de ese día (${v.tasa_bcv.toFixed(2).replace('.', ',')} Bs/$)`} valor={fmtBs(v.total_bs)} ultima />
        ) : null}
      </View>
    </Ficha>
  )

  const datos = (
    <Ficha style={{ flex: tablet ? 1 : undefined, paddingVertical: 8 }}>
      <Dato titulo="Qué pasó">
        <Pastilla texto={estado.texto} tono={estado.tono} />
      </Dato>
      <Dato
        titulo="Cómo se pagó"
        valor={etiquetaMetodo(v.pago) || '—'}
        accion={v.estado === 'cobrada' ? { texto: 'Editar pago', alTocar: () => setCuadro('pago') } : undefined}
      />
      <Dato titulo="Quién cobró" valor={v.operador || '—'} />
      <Dato titulo="Caja" valor={v.punto_venta || '—'} />
      {v.cliente ? <Dato titulo="Cliente" valor={v.cliente} /> : null}
      {v.estado === 'fiada' ? (
        <Dato
          titulo="Debe todavía"
          valor={dinero(v.fiado_pendiente)}
          cifra
          accion={{ texto: 'Cobrar / abonar', alTocar: () => setCuadro('fiado') }}
        />
      ) : null}
      {v.fiado_saldado ? <Dato titulo="A crédito" valor="Ya saldado" /> : null}
      {v.facturado ? <Dato titulo="Factura" valor={v.numero_factura || 'sí'} /> : null}
      {!v.facturado && vendida ? <Dato titulo="Factura" accion={{ texto: 'Facturar ahora', alTocar: () => setCuadro('facturar') }} /> : null}
      {v.estado === 'anulada' ? <Dato titulo="Anulada por" valor={v.anulado_por || '—'} /> : null}
      {v.estado === 'anulada' ? (
        // La señal que importa para auditar: anular DESPUES de cocinar es comida que se hizo y no se cobro.
        <Dato
          titulo="Comida"
          valor={
            v.anulado_es_perdida === true ? 'Se preparó (pérdida real)' : v.anulado_es_perdida === false ? 'No se llegó a preparar' : 'Sin registrar'
          }
          color={v.anulado_es_perdida === true ? t.peligro : t.suave}
        />
      ) : null}
      {v.estado === 'devuelta' ? (
        <Dato titulo="Devolución" valor={v.motivo_devolucion || 'sin motivo'} nota={v.nota_credito ? `nota de crédito ${v.nota_credito}` : undefined} />
      ) : null}
      {v.nota ? <Dato titulo="Nota" valor={v.nota} /> : null}
      <View style={{ height: 4 }} />
    </Ficha>
  )

  return (
    <>
      <Ficha style={{ gap: 6 }}>
        <Etiqueta>{`${fechaCorta(v.fecha, true)} · ${horaCorta(v.fecha)}`}</Etiqueta>
        <Text
          style={[e.total, { color: apagada ? t.tenue : t.tinta }, apagada && { textDecorationLine: 'line-through' }]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {dinero(v.total)}
        </Text>
        <View style={e.pastillas}>
          <Pastilla texto={estado.texto} tono={estado.tono} />
          {v.editado ? <Pastilla texto="Editada" tono="ojo" /> : null}
          {v.facturado ? <Pastilla texto={`Factura ${v.numero_factura ?? ''}`} /> : null}
        </View>
        {v.cliente ? <Text style={[e.cliente, { color: t.suave }]}>{v.cliente}</Text> : null}
      </Ficha>

      <View style={[{ gap: 12 }, tablet && { flexDirection: 'row', alignItems: 'flex-start' }]}>
        {renglones}
        {datos}
      </View>

      {v.ediciones.length > 0 ? (
        <Ficha style={{ gap: 10 }}>
          <Titulo>Ediciones</Titulo>
          {/* Lo que el dueño necesita: que se cambio, cuanta plata se movio y quien firmo. */}
          {v.ediciones.map((ed) => (
            <View key={ed.id} style={{ gap: 2 }}>
              <Text style={[e.edicion, { color: t.tinta }]}>
                {ed.detalle}
                {ed.diferencia !== 0 ? (
                  <Text style={{ color: ed.diferencia > 0 ? t.exito : t.aviso }}>
                    {` (${ed.diferencia > 0 ? '+' : ''}${dinero(ed.diferencia)}${ed.metodo_pago ? ` en ${etiquetaMetodo(ed.metodo_pago)}` : ''})`}
                  </Text>
                ) : null}
              </Text>
              <Text style={[e.edicionQuien, { color: t.suave }]}>
                {ed.operador || 'sin operador'}
                {ed.autorizado_por ? ` · autorizó ${ed.autorizado_por}` : ''}
                {ed.motivo ? ` · ${ed.motivo}` : ''}
              </Text>
            </View>
          ))}
        </Ficha>
      ) : null}

      {vendida ? (
        <Ficha style={{ gap: 10 }}>
          <Etiqueta>Corregir</Etiqueta>
          <View style={[{ gap: 10 }, tablet && { flexDirection: 'row' }]}>
            <View style={{ flex: tablet ? 1 : undefined }}>
              <Boton texto="Editar renglones" tono="neutro" icono="recetas" ocupado={abriendo} alTocar={() => void abrirEdicion()} />
            </View>
            <View style={{ flex: tablet ? 1 : undefined }}>
              <Boton texto="Devolver" tono="peligro" icono="atras" alTocar={() => setCuadro('devolver')} />
            </View>
          </View>
          <Text style={[e.ayuda, { color: t.tenue }]}>
            Editar cambia los renglones: si el monto cambia, pide clave. Devolver es cuando el cliente trajo la comida de vuelta.
          </Text>
        </Ficha>
      ) : null}

      {/* El ticket, cuando el cliente lo pide despues. */}
      {v.estado !== 'anulada' ? <Boton texto={TEXTO_BOTON_TICKET} tono="neutro" icono="factura" alTocar={() => void ticket()} /> : null}

      {cuadro === 'pago' ? <CorregirPago pedidoId={v.id} visible alCerrar={() => setCuadro(null)} alGuardado={listo} /> : null}
      {cuadro === 'facturar' ? <FormFacturar v={v} visible alCerrar={() => setCuadro(null)} alListo={listo} /> : null}
      {cuadro === 'devolver' ? <FormDevolver v={v} visible total={dinero(v.total)} alCerrar={() => setCuadro(null)} alListo={listo} /> : null}
      {cuadro === 'fiado' ? <FormCobrarFiado v={v} visible debe={dinero(v.fiado_pendiente)} alCerrar={() => setCuadro(null)} alListo={listo} /> : null}
      <EditarPedido
        pedido={editando}
        alCerrar={cerrarEdicion}
        alGuardado={() => {
          setEditando(null)
          alCambio()
        }}
      />
    </>
  )
}

/** Un dato del detalle: el rotulo a la izquierda, el valor a la derecha y, debajo, lo que se le puede hacer. */
function Dato({
  titulo,
  valor,
  nota,
  cifra = false,
  color,
  accion,
  children,
}: {
  titulo: string
  valor?: string
  nota?: string
  cifra?: boolean
  color?: string
  accion?: { texto: string; alTocar: () => void }
  children?: ReactNode
}) {
  const t = useTema()
  return (
    <View style={[e.dato, { borderBottomColor: t.gris200 }]}>
      <Text style={[e.datoTitulo, { color: t.suave }]}>{titulo}</Text>
      <View style={e.datoValor}>
        {children}
        {valor ? (
          <Text style={[cifra ? e.cifra : e.datoTexto, { color: color ?? t.tinta, textAlign: 'right' }]}>{valor}</Text>
        ) : null}
        {nota ? <Text style={[e.datoNota, { color: t.tenue }]}>{nota}</Text> : null}
        {accion ? (
          <Pressable onPress={accion.alTocar} hitSlop={8} accessibilityRole="button" style={({ pressed }) => [e.enlace, { opacity: pressed ? 0.6 : 1 }]}>
            <Text style={[e.enlaceTexto, { color: t.acento }]}>{accion.texto}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

const e = StyleSheet.create({
  total: { fontFamily: LETRA.tituloFuerte, fontSize: 40, letterSpacing: -1.2, lineHeight: 46 },
  pastillas: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cliente: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  renglon: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, paddingVertical: 9 },
  renglonTexto: { flex: 1, fontFamily: LETRA.texto, fontSize: 15, lineHeight: 20 },
  cifra: { fontFamily: LETRA.cifra, fontSize: 15 },
  totales: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 6 },
  dato: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  datoTitulo: { fontFamily: LETRA.texto, fontSize: 15, paddingTop: 1 },
  datoValor: { flex: 1, alignItems: 'flex-end', gap: 2 },
  datoTexto: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  datoNota: { fontFamily: LETRA.texto, fontSize: 13, textAlign: 'right' },
  enlace: { minHeight: 32, justifyContent: 'center' },
  enlaceTexto: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  edicion: { fontFamily: LETRA.texto, fontSize: 14.5, lineHeight: 20 },
  edicionQuien: { fontFamily: LETRA.texto, fontSize: 13 },
  ayuda: { fontFamily: LETRA.texto, fontSize: 13, lineHeight: 18 },
})
