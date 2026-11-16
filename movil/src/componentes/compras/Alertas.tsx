import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { apiCompras } from '../../lib/api-compras'
import { enMoneda, fechaDe } from '../../lib/compras-app'
import { LETRA, useTema } from '../../lib/tema'
import type { AlertaPrecio } from '../../lib/tipos'
import { HojaFormulario, Pastilla, Vacio } from '../kit'
import { Boton, Cargando, Ficha, Pantalla } from '../ui'
import { BotonTexto, Cabecera, mensajeDe, NotaTono, Opciones } from './piezas'

/*
 * ALERTAS DE PRECIO (components/AlertasPrecio.tsx de la web): que llego mas
 * caro en una factura y que le hace al menu. Se ven al guardar la factura y
 * quedan en la bandeja de Compras para quien no estaba cuando se cargo.
 * Los montos van en dolares, como los guarda el sistema y como la web.
 */

const dinero = (x: number) => enMoneda(x, '$')

/** Una alerta, dicha en una frase y con lo que hay que hacer. */
function Detalle({ a, onVerFactura }: { a: AlertaPrecio; onVerFactura?: (a: AlertaPrecio) => void }) {
  const t = useTema()
  const factura = onVerFactura ? (
    <Text style={{ color: t.acento, fontFamily: LETRA.textoFuerte, textDecorationLine: 'underline' }} onPress={() => onVerFactura(a)}>
      {a.numero_factura}
    </Text>
  ) : (
    a.numero_factura
  )
  if (a.tipo === 'unidad') {
    return (
      <View style={{ gap: 4 }}>
        <Text style={[d.titulo, { color: t.peligro }]}>
          {a.ingrediente_nombre}: posible error de unidad en la Factura {factura}
        </Text>
        <Text style={[d.texto, { color: t.suave }]}>
          Entró a {dinero(a.costo_nuevo)} por {a.unidad} y se venía pagando {dinero(a.costo_anterior)}. Un salto así casi nunca es precio: suele ser
          la cantidad en bultos o cajas y el costo por {a.unidad}, o al revés. Si quedó mal, corrígelo con una nota de crédito o un ajuste de
          inventario.
        </Text>
      </View>
    )
  }
  return (
    <View style={{ gap: 4 }}>
      <Text style={[d.titulo, { color: t.tinta }]}>
        {a.ingrediente_nombre} subió {a.variacion_pct.toFixed(0)}% con {a.proveedor_nombre}{' '}
        <Text style={{ fontFamily: LETRA.texto, color: t.tenue }}>
          ({dinero(a.costo_anterior)} → {dinero(a.costo_nuevo)} por {a.unidad})
        </Text>
      </Text>
      <Text style={[d.texto, { color: t.tenue }]}>
        {a.base === 'proveedor'
          ? 'Contra lo que ese mismo proveedor cobraba.'
          : 'Es la primera compra a este proveedor: contra las últimas compras de esa mercancía.'}{' '}
        Factura {factura}.
      </Text>
      {a.productos.map((p) => (
        <Text key={p.nombre} style={[d.texto, { color: p.a_perdida ? t.peligro : t.aviso }]}>
          {p.a_perdida ? 'A pérdida' : 'Queda flaco'}: {p.nombre}, margen {p.margen_antes_pct?.toFixed(0)}% → {p.margen_despues_pct?.toFixed(0)}% vendiéndolo a{' '}
          {dinero(p.precio)}.
        </Text>
      ))}
      {a.alternativa_costo != null ? (
        <Text style={[d.texto, { color: t.exito }]}>
          {a.alternativa_proveedor} lo vendió a {dinero(a.alternativa_costo)}
          {a.alternativa_fecha ? ` el ${fechaDe(a.alternativa_fecha)}` : ''}.
        </Text>
      ) : null}
    </View>
  )
}

/** Lo que se ve apenas se guarda la factura, si llego algo mas caro. */
export function AlertasAlGuardar({ alertas, onCerrar }: { alertas: AlertaPrecio[]; onCerrar: () => void }) {
  if (alertas.length === 0) return null
  return (
    <HojaFormulario
      visible
      alCerrar={onCerrar}
      titulo={alertas.length === 1 ? 'Llegó algo más caro' : `Llegaron ${alertas.length} cosas más caras`}
      subtitulo="La factura ya quedó guardada. Esto queda también en Compras › Alertas para el dueño."
      pie={
        <View style={{ flex: 1 }}>
          <Boton texto="Entendido" alTocar={onCerrar} />
        </View>
      }
    >
      {alertas.map((a) => (
        <Ficha key={a.id}>
          <Detalle a={a} />
        </Ficha>
      ))}
    </HojaFormulario>
  )
}

/** La bandeja de Compras. `onPendientes` avisa cuantas quedan sin ver. */
export default function Alertas({
  pestanas,
  onPendientes,
  onVerFactura,
}: {
  /** Las pestañas de Compras: van al principio de lo que se desplaza. */
  pestanas: ReactNode
  onPendientes: (n: number) => void
  onVerFactura: (a: AlertaPrecio) => void
}) {
  const t = useTema()
  const [soloPendientes, setSoloPendientes] = useState(true)
  const [alertas, setAlertas] = useState<AlertaPrecio[] | null>(null)
  const [error, setError] = useState('')
  const [marcando, setMarcando] = useState(false)
  const [refrescando, setRefrescando] = useState(false)

  const cargar = useCallback(
    (pendientes: boolean) =>
      apiCompras
        .alertas(pendientes)
        .then((l) => {
          setAlertas(l)
          setError('')
          if (pendientes) onPendientes(l.length)
        })
        .catch((e: unknown) => setError(mensajeDe(e, 'No se pudieron cargar')))
        .finally(() => setRefrescando(false)),
    [onPendientes],
  )

  useEffect(() => {
    void cargar(soloPendientes)
  }, [soloPendientes, cargar])

  // Sin esto, mientras llegaba la otra lista se veia la anterior con el
  // titulo nuevo: "Todavia no hay alertas" parpadeaba al pasar a Todas.
  function filtrar(pendientes: boolean) {
    if (pendientes === soloPendientes) return
    setAlertas(null)
    setSoloPendientes(pendientes)
  }

  async function visto(a: AlertaPrecio) {
    setError('')
    try {
      const vista = await apiCompras.marcarAlertaVista(a.id)
      const lista = (alertas ?? []).map((x) => (x.id === a.id ? vista : x)).filter((x) => !soloPendientes || !x.visto)
      setAlertas(lista)
      if (soloPendientes) onPendientes(lista.length)
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo marcar'))
    }
  }

  // Las que quedan sin ver, de una: el dueño que ya las leyo no tiene por que
  // tocar "Visto" diez veces.
  async function verTodas() {
    const sinVer = (alertas ?? []).filter((a) => !a.visto)
    if (sinVer.length === 0) return
    setError('')
    setMarcando(true)
    try {
      const vistas = await Promise.all(sinVer.map((a) => apiCompras.marcarAlertaVista(a.id)))
      const porId = new Map(vistas.map((v) => [v.id, v]))
      const lista = (alertas ?? []).map((x) => porId.get(x.id) ?? x).filter((x) => !soloPendientes || !x.visto)
      setAlertas(lista)
      if (soloPendientes) onPendientes(lista.length)
    } catch (e) {
      setError(mensajeDe(e, 'No se pudieron marcar'))
    } finally {
      setMarcando(false)
    }
  }
  const sinVer = (alertas ?? []).filter((a) => !a.visto).length

  return (
    <Pantalla
      refrescando={refrescando}
      alRefrescar={() => {
        setRefrescando(true)
        void cargar(soloPendientes)
      }}
      arriba={pestanas}
    >
      <Ficha>
        <Cabecera
          titulo="Alertas de precio"
          ayuda="Lo que llegó más caro en las facturas: contra lo que ese proveedor cobraba, qué platos quedan flacos y quién lo vendía más barato."
        />
        <View style={d.controles}>
          <Opciones
            opciones={[
              { valor: 'pendientes', texto: 'Sin ver' },
              { valor: 'todas', texto: 'Todas' },
            ]}
            valor={soloPendientes ? 'pendientes' : 'todas'}
            alCambiar={(v) => filtrar(v === 'pendientes')}
          />
          {sinVer > 0 ? (
            <BotonTexto
              texto={marcando ? 'Marcando…' : `Marcar ${sinVer === 1 ? 'la' : `las ${sinVer}`} como vistas`}
              tono="neutro"
              deshabilitado={marcando}
              alTocar={() => void verTodas()}
            />
          ) : null}
        </View>
      </Ficha>
      {error ? <NotaTono tono="mal">{error}</NotaTono> : null}
      {alertas === null ? (
        <Cargando />
      ) : alertas.length === 0 ? (
        <Vacio
          icono="alerta"
          titulo={soloPendientes ? 'Nada pendiente' : 'Todavía no hay alertas'}
          detalle="Aparecen al guardar una factura con algo más caro que la última vez."
        />
      ) : (
        alertas.map((a) => (
          <Ficha key={a.id}>
            <Text style={[d.fecha, { color: t.tenue }]}>{fechaDe(a.fecha)}</Text>
            <Detalle a={a} onVerFactura={onVerFactura} />
            <View style={{ marginTop: 10, alignItems: 'flex-start' }}>
              {a.visto ? (
                <Pastilla texto={`Vista${a.visto_por ? ` por ${a.visto_por}` : ''}`} />
              ) : (
                <Pressable
                  onPress={() => void visto(a)}
                  accessibilityRole="button"
                  style={({ pressed }) => [d.visto, { borderColor: t.gris200, backgroundColor: pressed ? t.gris100 : t.superficie }]}
                >
                  <Text style={[d.vistoTexto, { color: t.tinta }]}>Visto</Text>
                </Pressable>
              )}
            </View>
          </Ficha>
        ))
      )}
    </Pantalla>
  )
}

const d = StyleSheet.create({
  titulo: { fontFamily: LETRA.textoFuerte, fontSize: 15, lineHeight: 21 },
  texto: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
  fecha: { fontFamily: LETRA.texto, fontSize: 13, marginBottom: 4 },
  controles: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  visto: { minHeight: 44, borderRadius: 14, borderCurve: 'continuous', borderWidth: 1, paddingHorizontal: 20, justifyContent: 'center' },
  vistoTexto: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
})
