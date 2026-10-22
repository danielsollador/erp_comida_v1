import { useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { METODOS_CON_REFERENCIA, METODOS_PAGO, etiquetaMetodo } from '../../../../frontend/src/lib/pagos'
import { apiVentas } from '../../lib/api-ventas'
import { useMoneda } from '../../lib/moneda'
import { useSesion } from '../../lib/sesion'
import { LETRA, useTema } from '../../lib/tema'
import type { Autorizacion, Categoria, Pedido, Producto, Variante } from '../../lib/tipos'
import { Buscador, Contador, HojaFormulario, llano, Selector } from '../kit'
import { Aviso, Boton, Campo, Fila, Nota } from '../ui'
import Autorizar from './Autorizar'

/**
 * EDITAR LOS RENGLONES de un pedido ya tomado, como components/EditarPedido.tsx
 * de la web (el mismo cuadro del punto de venta: una sola regla sobre cuando
 * se pide la firma). Mientras esta abierto, el servidor tiene la comanda
 * "en edicion" y la cocina no la toca; por eso cerrar sin guardar suelta el
 * candado (lo hace quien lo abre).
 *
 * `precio` viaja en la linea: un renglon que ya estaba conserva el precio al
 * que se le dijo al cliente aunque el menu haya subido.
 */
type Linea = {
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

// Un cafe cobrado y un cafe regalado son dos renglones distintos, igual que en el servidor.
function claveDe(varianteId: number | null, nombre: string, precioLista: number, cortesia: boolean) {
  const base = varianteId !== null ? `v${varianteId}` : `libre:${nombre}:${precioLista}`
  return cortesia ? `${base}:c` : base
}

function lineasDe(p: Pedido): Linea[] {
  return p.items.map((i) => {
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

const nombrePlato = (pr: Producto, v: Variante) =>
  v.nombre && v.nombre.toLowerCase() !== 'regular' ? `${pr.nombre} - ${v.nombre}` : pr.nombre

export default function EditarPedido({
  pedido,
  alCerrar,
  alGuardado,
}: {
  /** El pedido tal como lo devolvio `abrirEdicion`: con el candado ya tomado. */
  pedido: Pedido | null
  alCerrar: () => void
  alGuardado: () => void
}) {
  return pedido ? <Cuadro key={pedido.id} pedido={pedido} alCerrar={alCerrar} alGuardado={alGuardado} /> : null
}

function Cuadro({ pedido, alCerrar, alGuardado }: { pedido: Pedido; alCerrar: () => void; alGuardado: () => void }) {
  const t = useTema()
  const { fmt } = useMoneda()
  // Quien ya autoriza no se pide permiso a si mismo: su sesion es la firma.
  const { acceso } = useSesion()
  const autorizoYo = acceso?.puede.autoriza ?? false
  const [lineas, setLineas] = useState<Linea[]>(() => lineasDe(pedido))
  const [motivo, setMotivo] = useState('')
  const [conNota, setConNota] = useState(false)
  const [buscar, setBuscar] = useState('')
  const [firma, setFirma] = useState<Autorizacion | null>(null)
  const [metodo, setMetodo] = useState(METODOS_PAGO[0])
  const [referencia, setReferencia] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [categorias, setCategorias] = useState<Categoria[]>([])

  useEffect(() => {
    apiVentas
      .categorias()
      .then((todas) => setCategorias(todas.filter((c) => c.activo)))
      .catch(() => setCategorias([]))
  }, [])

  // Todo el menu en una lista: se teclean tres letras y se toca.
  const platos = useMemo(
    () =>
      categorias.flatMap((c) =>
        c.productos.filter((pr) => pr.activo).flatMap((pr) => pr.variantes.filter((v) => v.activo).map((v) => ({ producto: pr, variante: v }))),
      ),
    [categorias],
  )
  const q = llano(buscar.trim())
  const encontrados = q ? platos.filter(({ producto, variante }) => llano(`${producto.nombre} ${variante.nombre}`).includes(q)).slice(0, 12) : []

  // Igual que en el servidor: el descuento ya concedido se respeta.
  const subtotal = Math.round(lineas.reduce((s, l) => s + l.precio * l.cantidad, 0) * 100) / 100
  const total = Math.max(Math.round((subtotal - (pedido.descuento || 0)) * 100) / 100, 0)
  const diferencia = Math.round((total - pedido.total) * 100) / 100
  // Solo una venta YA COBRADA tiene plata que cuadrar.
  const mueveDinero = pedido.estado === 'pagado' && diferencia !== 0
  const pideClave = mueveDinero && !autorizoYo

  const cambiar = (clave: string, cantidad: number) =>
    setLineas((prev) => prev.map((l) => (l.clave === clave ? { ...l, cantidad } : l)).filter((l) => l.cantidad > 0))

  function agregar(pr: Producto, v: Variante) {
    const id = `v${v.id}`
    setLineas((prev) => {
      if (prev.some((l) => l.clave === id)) return prev.map((l) => (l.clave === id ? { ...l, cantidad: l.cantidad + 1 } : l))
      return [...prev, { clave: id, variante_id: v.id, nombre: nombrePlato(pr, v), precio: v.precio, precioLista: v.precio, cantidad: 1, cortesia: false }]
    })
  }

  /** Regalar (o dejar de regalar) un renglon entero; si ya existe su gemelo, se juntan. */
  function alternarCortesia(clave: string) {
    setLineas((prev) => {
      const l = prev.find((x) => x.clave === clave)
      if (!l) return prev
      const cortesia = !l.cortesia
      const nueva: Linea = { ...l, cortesia, precio: cortesia ? 0 : l.precioLista, clave: claveDe(l.variante_id, l.nombre, l.precioLista, cortesia) }
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
      await apiVentas.editarPedido(
        pedido.id,
        lineas.map((l) =>
          l.variante_id !== null
            ? { variante_id: l.variante_id, cantidad: l.cantidad, cortesia: l.cortesia }
            : { variante_id: null, cantidad: l.cantidad, nombre_libre: l.nombre, precio_libre: l.precioLista, cortesia: l.cortesia },
        ),
        {
          motivo,
          autorizacion: pideClave && firma ? firma : undefined,
          // El monto va en positivo: el signo lo pone la diferencia.
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
          <View style={{ flex: 1.3 }}>
            <Boton
              texto={guardando ? 'Guardando…' : 'Guardar cambios'}
              ocupado={guardando}
              deshabilitado={lineas.length === 0}
              alTocar={() => void guardar()}
            />
          </View>
        </>
      }
    >
      {error ? <Aviso tono="peligro" texto={error} /> : null}

      <View style={{ gap: 12 }}>
        {lineas.map((l) => (
          <View key={l.clave} style={e.linea}>
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <Text style={[e.nombre, { color: t.tinta }]} numberOfLines={2}>
                {l.nombre}
              </Text>
              <View style={e.precios}>
                {l.cortesia ? (
                  <>
                    <Text style={[e.precio, { color: t.tenue, textDecorationLine: 'line-through' }]}>{fmt(l.precioLista * l.cantidad)}</Text>
                    <Text style={[e.precio, { color: t.exito, fontFamily: LETRA.cifraFuerte }]}>{fmt(0)}</Text>
                  </>
                ) : (
                  <Text style={[e.precio, { color: t.suave }]}>
                    {l.cantidad} x {fmt(l.precio)} = <Text style={{ color: t.tinta, fontFamily: LETRA.cifraFuerte }}>{fmt(l.precio * l.cantidad)}</Text>
                  </Text>
                )}
                <Pressable
                  onPress={() => alternarCortesia(l.clave)}
                  hitSlop={8}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: l.cortesia }}
                  style={[
                    e.cortesia,
                    l.cortesia ? { backgroundColor: t.exitoSuave, borderColor: `${t.exito500}66` } : { borderColor: t.gris200 },
                  ]}
                >
                  <Text style={[e.cortesiaTexto, { color: l.cortesia ? t.exito : t.tenue }]}>{l.cortesia ? '✓ Cortesía' : 'Cortesía'}</Text>
                </Pressable>
              </View>
            </View>
            <Contador valor={l.cantidad} alCambiar={(n) => cambiar(l.clave, n)} />
          </View>
        ))}
        {lineas.length === 0 ? <Nota style={{ color: t.peligro }}>No queda ningún renglón. Un pedido vacío se anula, no se guarda.</Nota> : null}
      </View>

      <Buscador valor={buscar} alCambiar={setBuscar} placeholder="Agregar del menú: escribe para buscar" />
      {encontrados.length > 0 ? (
        <View style={e.resultados}>
          {encontrados.map(({ producto, variante }) => (
            <Pressable
              key={variante.id}
              onPress={() => agregar(producto, variante)}
              style={({ pressed }) => [e.plato, { backgroundColor: pressed ? t.gris200 : t.gris100 }]}
            >
              <Text style={[e.platoNombre, { color: t.tinta }]} numberOfLines={2}>
                {nombrePlato(producto, variante)}
              </Text>
              <Text style={[e.precio, { color: t.suave }]}>{fmt(variante.precio)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View>
        <Fila nombre="Antes" valor={fmt(pedido.total)} />
        <Fila nombre="Queda en" valor={fmt(total)} fuerte ultima={diferencia === 0} />
        {diferencia !== 0 ? (
          <Fila
            nombre={diferencia > 0 ? 'El cliente paga de más' : 'Se le devuelve al cliente'}
            valor={fmt(Math.abs(diferencia))}
            fuerte
            color={diferencia > 0 ? t.exito : t.aviso}
            ultima
          />
        ) : null}
      </View>

      {/* La firma no se pide por cambiar renglones: se pide por mover plata de una venta ya cobrada. */}
      {mueveDinero ? (
        <View style={[e.firma, { backgroundColor: t.avisoSuave, borderColor: t.avisoLinea }]}>
          <Text style={[e.firmaTitulo, { color: t.avisoFuerte }]}>
            Esta venta ya está cobrada y el monto cambia en {fmt(Math.abs(diferencia))}.
          </Text>
          {autorizoYo ? (
            <Nota style={{ color: t.aviso }}>Lo autorizas tú: queda firmado a nombre de {acceso?.nombre_visible || acceso?.usuario}.</Nota>
          ) : (
            <Autorizar
              accion="editar_venta"
              detalle={`${diferencia > 0 ? 'El cliente paga de más' : 'Se le devuelve al cliente'} ${fmt(Math.abs(diferencia))}`}
              monto={Math.abs(diferencia)}
              pedidoId={pedido.id}
              alCambiar={setFirma}
            />
          )}
          <Selector
            forma="campo"
            etiqueta={diferencia > 0 ? 'Cómo se cobra la diferencia' : 'Cómo se devuelve'}
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
      ) : null}

      {/* Opcional y discreta: una cuenta abierta a la que se le agrega un cafe no necesita explicacion. */}
      {conNota ? (
        <Campo rotulo="Nota" value={motivo} onChangeText={setMotivo} placeholder="Opcional: por qué se cambió" />
      ) : (
        <Pressable onPress={() => setConNota(true)} hitSlop={8} style={{ minHeight: 40, justifyContent: 'center' }}>
          <Text style={[e.enlace, { color: t.tenue }]}>Agregar una nota</Text>
        </Pressable>
      )}

      {pedido.ediciones.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={[e.etiqueta, { color: t.tenue }]}>YA SE EDITÓ ANTES</Text>
          {pedido.ediciones.map((ed) => (
            <Nota key={ed.id}>
              {ed.detalle}
              {ed.diferencia !== 0 ? ` · ${fmt(ed.diferencia)}` : ''}
              {ed.autorizado_por ? ` · autorizó ${ed.autorizado_por}` : ''}
            </Nota>
          ))}
        </View>
      ) : null}
    </HojaFormulario>
  )
}

const e = StyleSheet.create({
  linea: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nombre: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  precios: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  precio: { fontFamily: LETRA.cifra, fontSize: 13.5 },
  cortesia: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  cortesiaTexto: { fontFamily: LETRA.textoFuerte, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase' },
  resultados: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  plato: { flexBasis: '47%', flexGrow: 1, borderRadius: 14, borderCurve: 'continuous', paddingHorizontal: 12, paddingVertical: 10, minHeight: 56, gap: 2 },
  platoNombre: { fontFamily: LETRA.textoFuerte, fontSize: 14 },
  firma: { borderWidth: 1, borderRadius: 18, borderCurve: 'continuous', padding: 14, gap: 10 },
  firmaTitulo: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  enlace: { fontFamily: LETRA.textoFuerte, fontSize: 13.5, textDecorationLine: 'underline' },
  etiqueta: { fontFamily: LETRA.textoFuerte, fontSize: 11, letterSpacing: 1.2 },
})
