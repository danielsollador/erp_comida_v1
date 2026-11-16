import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { etiquetaMetodo, METODOS_CON_REFERENCIA, METODOS_PAGO } from '../../../../frontend/src/lib/pagos'
import { apiPos } from '../../lib/api-pos'
import { useMoneda } from '../../lib/moneda'
import { useSesion } from '../../lib/sesion'
import { LETRA, useTema } from '../../lib/tema'
import type { Autorizacion, Categoria, Pedido, Producto, Variante } from '../../lib/tipos'
import { Buscador, Contador, HojaFormulario, llano, Selector } from '../kit'
import { Boton, Campo } from '../ui'
import { Autorizar } from './Autorizar'
import { BotonChico, Caja, Renglon } from './piezas'

/*
 * EL CUADRO PARA CAMBIARLE LOS RENGLONES A UN PEDIDO YA TOMADO
 * (components/EditarPedido.tsx de la web). El punto de venta edita en la
 * comanda, como si se tomara de cero; este cuadro queda para lo que la
 * comanda no sabe mostrar: un producto que ya salio del menu, o el mismo
 * producto cobrado y regalado a la vez.
 *
 * Mientras esta abierto la cocina tiene la comanda bloqueada: cerrar sin
 * guardar suelta el candado (lo hace quien lo abre).
 */
type LineaEdicion = {
  clave: string
  variante_id: number | null
  nombre: string
  /** Lo que se cobra por unidad: 0 si es cortesia. */
  precio: number
  /** Lo que vale de lista: lo que se cobraria si dejara de ser cortesia. */
  precioLista: number
  cantidad: number
  cortesia: boolean
}

// Un cafe cobrado y un cafe regalado son dos renglones distintos, como en el servidor.
function claveDe(variante_id: number | null, nombre: string, precioLista: number, cortesia: boolean) {
  const base = variante_id !== null ? `v${variante_id}` : `libre:${nombre}:${precioLista}`
  return cortesia ? `${base}:c` : base
}

function lineasDePedido(pedido: Pedido): LineaEdicion[] {
  return pedido.items.map((i) => {
    const precioLista = i.cortesia ? i.precio_lista : i.precio_unitario
    return {
      clave: claveDe(i.variante_id, i.nombre, precioLista, i.cortesia),
      variante_id: i.variante_id,
      nombre: i.nombre,
      precio: i.cortesia ? 0 : i.precio_unitario,
      precioLista,
      cantidad: i.cantidad,
      cortesia: i.cortesia,
    }
  })
}

export function EditarPedido({
  pedido,
  categorias,
  alGuardado,
  alCerrar,
}: {
  /** El pedido tal como lo devolvio `abrirEdicion`: con el candado ya tomado. */
  pedido: Pedido
  categorias: Categoria[]
  alGuardado: () => void
  alCerrar: () => void
}) {
  const t = useTema()
  const { fmt } = useMoneda()
  const { acceso } = useSesion()
  // Quien autoriza no se pide permiso a si mismo: su sesion es la firma.
  const autorizoYo = acceso?.puede.autoriza ?? false
  const [lineas, setLineas] = useState<LineaEdicion[]>(() => lineasDePedido(pedido))
  const [motivo, setMotivo] = useState('')
  const [conNota, setConNota] = useState(false)
  const [buscar, setBuscar] = useState('')
  const [firma, setFirma] = useState<Autorizacion | null>(null)
  const [metodo, setMetodo] = useState(METODOS_PAGO[0])
  const [referencia, setReferencia] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const platos = useMemo(
    () =>
      categorias.flatMap((c) =>
        c.productos.filter((pr) => pr.activo).flatMap((pr) => pr.variantes.filter((v) => v.activo).map((v) => ({ producto: pr, variante: v }))),
      ),
    [categorias],
  )

  // Igual que el servidor: el descuento ya concedido se respeta.
  const subtotal = Math.round(lineas.reduce((s, l) => s + l.precio * l.cantidad, 0) * 100) / 100
  const total = Math.max(Math.round((subtotal - (pedido.descuento || 0)) * 100) / 100, 0)
  const diferencia = Math.round((total - pedido.total) * 100) / 100
  // Solo una venta YA COBRADA tiene plata que cuadrar.
  const mueveDinero = pedido.estado === 'pagado' && diferencia !== 0
  const pideClave = mueveDinero && !autorizoYo

  function cambiar(clave: string, delta: number) {
    setLineas((prev) => prev.map((l) => (l.clave === clave ? { ...l, cantidad: l.cantidad + delta } : l)).filter((l) => l.cantidad > 0))
  }

  function agregar(producto: Producto, variante: Variante) {
    const id = `v${variante.id}`
    setLineas((prev) => {
      if (prev.some((l) => l.clave === id)) return prev.map((l) => (l.clave === id ? { ...l, cantidad: l.cantidad + 1 } : l))
      const nombre =
        variante.nombre && variante.nombre.toLowerCase() !== 'regular' ? `${producto.nombre} - ${variante.nombre}` : producto.nombre
      return [...prev, { clave: id, variante_id: variante.id, nombre, precio: variante.precio, precioLista: variante.precio, cantidad: 1, cortesia: false }]
    })
  }

  /** Regalar (o dejar de regalar) un renglon entero; si existe el gemelo, se juntan. */
  function alternarCortesia(clave: string) {
    setLineas((prev) => {
      const l = prev.find((x) => x.clave === clave)
      if (!l) return prev
      const cortesia = !l.cortesia
      const nueva: LineaEdicion = {
        ...l,
        cortesia,
        precio: cortesia ? 0 : l.precioLista,
        clave: claveDe(l.variante_id, l.nombre, l.precioLista, cortesia),
      }
      const resto = prev.filter((x) => x.clave !== clave)
      if (resto.some((x) => x.clave === nueva.clave))
        return resto.map((x) => (x.clave === nueva.clave ? { ...x, cantidad: x.cantidad + l.cantidad } : x))
      return [...resto, nueva]
    })
  }

  async function guardar() {
    setError('')
    if (lineas.length === 0) {
      setError('Un pedido no puede quedar vacío. Si ya no va, anúlalo.')
      return
    }
    if (pideClave && !firma) {
      setError('La diferencia de dinero necesita el PIN de quien autoriza, o su aprobación desde la aplicación.')
      return
    }
    setGuardando(true)
    try {
      await apiPos.editarPedido(
        pedido.id,
        lineas.map((l) =>
          l.variante_id !== null
            ? { variante_id: l.variante_id, cantidad: l.cantidad, cortesia: l.cortesia }
            : { variante_id: null, cantidad: l.cantidad, nombre_libre: l.nombre, precio_libre: l.precioLista, cortesia: l.cortesia },
        ),
        {
          motivo,
          autorizacion: pideClave && firma ? firma : undefined,
          // En positivo: el signo lo pone la diferencia.
          pagos: mueveDinero ? [{ metodo, monto: Math.abs(diferencia), referencia }] : undefined,
        },
      )
      alGuardado()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setGuardando(false)
    }
  }

  const q = llano(buscar.trim())
  const que = diferencia > 0 ? 'El cliente paga de más' : 'Se le devuelve al cliente'

  return (
    <HojaFormulario
      visible
      alCerrar={alCerrar}
      titulo={`Editar pedido #${pedido.numero}`}
      subtitulo={
        pedido.estado === 'pagado'
          ? autorizoYo
            ? 'Esta venta ya está cobrada: si el monto cambia, la diferencia queda firmada a tu nombre y hay que decir por dónde entra o sale.'
            : 'Esta venta ya está cobrada: si el monto cambia hará falta el PIN de quien autoriza (o su aprobación desde la app) y decir por dónde entra o sale la diferencia.'
          : 'La cocina tiene esta comanda bloqueada mientras el cuadro esté abierto.'
      }
      pie={
        <>
          <View style={{ flex: 1 }}>
            <Boton texto="Cancelar" tono="neutro" alTocar={alCerrar} />
          </View>
          <View style={{ flex: 1 }}>
            <Boton
              texto={guardando ? 'Guardando…' : 'Guardar cambios'}
              alTocar={() => void guardar()}
              ocupado={guardando}
              deshabilitado={lineas.length === 0}
            />
          </View>
        </>
      }
    >
      {error ? <Text style={[e.nota, { color: t.peligro }]}>{error}</Text> : null}
      <View>
        {lineas.map((l) => (
          <View key={l.clave} style={[e.linea, { borderBottomColor: t.gris200 }]}>
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <Text style={[e.nombre, { color: t.tinta }]} numberOfLines={2}>
                {l.nombre}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                {l.cortesia ? (
                  <>
                    <Text style={[e.cifra, { color: t.tenue, textDecorationLine: 'line-through' }]}>{fmt(l.precioLista * l.cantidad)}</Text>
                    <Text style={[e.cifra, { color: t.exito }]}>{fmt(0)}</Text>
                  </>
                ) : (
                  <Text style={[e.cifra, { color: t.suave }]}>
                    {l.cantidad} x {fmt(l.precio)} = {fmt(l.precio * l.cantidad)}
                  </Text>
                )}
                <Pressable
                  onPress={() => alternarCortesia(l.clave)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Cortesía"
                  accessibilityState={{ selected: l.cortesia }}
                  style={[e.cortesia, l.cortesia ? { backgroundColor: t.exitoSuave, borderColor: t.exito500 } : { borderColor: t.gris200 }]}
                >
                  <Text style={[e.cortesiaTexto, { color: l.cortesia ? t.exito : t.tenue }]}>{l.cortesia ? '✓ Cortesía' : 'Cortesía'}</Text>
                </Pressable>
              </View>
            </View>
            <Contador valor={l.cantidad} alCambiar={(n) => cambiar(l.clave, n - l.cantidad)} minimo={0} />
          </View>
        ))}
        {lineas.length === 0 ? (
          <Text style={[e.nota, { color: t.peligro }]}>No queda ningún renglón. Un pedido vacío se anula, no se guarda.</Text>
        ) : null}
      </View>

      <Buscador valor={buscar} alCambiar={setBuscar} placeholder="Agregar del menú: escribe para buscar" />
      {q ? (
        <View style={e.resultados}>
          {platos
            .filter(({ producto, variante }) => llano(`${producto.nombre} ${variante.nombre}`).includes(q))
            .slice(0, 12)
            .map(({ producto, variante }) => (
              <Pressable
                key={variante.id}
                onPress={() => agregar(producto, variante)}
                accessibilityRole="button"
                accessibilityLabel={`Agregar ${producto.nombre}`}
                style={({ pressed }) => [e.plato, { backgroundColor: pressed ? t.gris200 : t.gris100 }]}
              >
                <Text style={[e.nombre, { color: t.tinta, fontSize: 14 }]} numberOfLines={2}>
                  {variante.nombre && variante.nombre.toLowerCase() !== 'regular' ? `${producto.nombre} - ${variante.nombre}` : producto.nombre}
                </Text>
                <Text style={[e.cifra, { color: t.suave }]}>{fmt(variante.precio)}</Text>
              </Pressable>
            ))}
        </View>
      ) : null}

      <View style={[e.cuentas, { borderTopColor: t.gris200 }]}>
        <Renglon nombre="Antes" cifra={fmt(pedido.total)} />
        <Renglon nombre="Queda en" cifra={fmt(total)} fuerte />
        {diferencia !== 0 ? <Renglon nombre={que} cifra={fmt(Math.abs(diferencia))} color={diferencia > 0 ? t.exito : t.aviso} fuerte /> : null}
      </View>

      {/* La clave no se pide por cambiar renglones: se pide por mover plata de
          una venta ya cobrada. Pedirla siempre la volveria un tramite. */}
      {mueveDinero ? (
        <Caja tono="ojo">
          <View style={{ gap: 12 }}>
            <Text style={[e.nombre, { color: t.avisoFuerte }]}>
              Esta venta ya está cobrada y el monto cambia en {fmt(Math.abs(diferencia))}.
            </Text>
            {autorizoYo ? (
              <Text style={[e.nota, { color: t.avisoFuerte }]}>
                Lo autorizas tú: queda firmado a nombre de{' '}
                <Text style={{ fontFamily: LETRA.textoFuerte }}>{acceso?.nombre_visible || acceso?.usuario}</Text>.
              </Text>
            ) : (
              <Autorizar
                accion="editar_venta"
                detalle={`${que} ${fmt(Math.abs(diferencia))}`}
                monto={Math.abs(diferencia)}
                pedidoId={pedido.id}
                alCambiar={setFirma}
              />
            )}
            <Selector
              etiqueta={diferencia > 0 ? 'Cómo se cobra la diferencia' : 'Cómo se devuelve'}
              forma="campo"
              opciones={METODOS_PAGO.map((m) => ({ valor: m, texto: etiquetaMetodo(m) }))}
              valor={metodo}
              alCambiar={setMetodo}
            />
            {METODOS_CON_REFERENCIA.has(metodo) ? (
              <Campo
                rotulo="Referencia"
                value={referencia}
                onChangeText={setReferencia}
                ayuda="El número del pago móvil, el ticket del punto o el comprobante."
              />
            ) : null}
          </View>
        </Caja>
      ) : null}

      {/* Opcional y discreta: una cuenta abierta a la que se le agrega un cafe no necesita explicacion. */}
      {conNota ? (
        <Campo rotulo="Nota" value={motivo} onChangeText={setMotivo} placeholder="Opcional: por qué se cambió" />
      ) : (
        <BotonChico texto="Agregar una nota" color={t.tenue} alTocar={() => setConNota(true)} />
      )}

      {pedido.ediciones.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={[e.etiqueta, { color: t.tenue }]}>YA SE EDITÓ ANTES</Text>
          {pedido.ediciones.map((ed) => (
            <Text key={ed.id} style={[e.nota, { color: t.suave }]}>
              {ed.detalle}
              {ed.diferencia !== 0 ? ` · ${fmt(ed.diferencia)}` : ''}
              {ed.autorizado_por ? ` · autorizó ${ed.autorizado_por}` : ''}
            </Text>
          ))}
        </View>
      ) : null}
    </HojaFormulario>
  )
}

const e = StyleSheet.create({
  nota: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
  linea: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  nombre: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  cifra: { fontFamily: LETRA.cifra, fontSize: 13.5 },
  cortesia: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  cortesiaTexto: { fontFamily: LETRA.textoFuerte, fontSize: 11.5, letterSpacing: 0.6, textTransform: 'uppercase' },
  resultados: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  plato: { flexBasis: '47%', flexGrow: 1, borderRadius: 14, borderCurve: 'continuous', paddingHorizontal: 12, paddingVertical: 10, minHeight: 52 },
  cuentas: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  etiqueta: { fontFamily: LETRA.textoFuerte, fontSize: 11, letterSpacing: 1.3 },
})
