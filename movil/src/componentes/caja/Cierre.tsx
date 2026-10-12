import { StyleSheet, Text, View } from 'react-native'
import { etiquetaMetodo } from '../../../../frontend/src/lib/pagos'
import { useMoneda } from '../../lib/moneda'
import { LETRA, useTema } from '../../lib/tema'
import type { EstadoApertura, ResumenCaja } from '../../lib/tipos'
import { useDisposicion } from '../kit'
import { Aviso, Boton, Cargando, Ficha, Nota, Problema, Titulo } from '../ui'
import { Desglose } from './Desglose'
import { cuadra, plural, redondear2 } from './logica'
import { Cabecera, Cuadros, Enlace } from './piezas'
import { SelectorDia } from './SelectorDia'

/**
 * LA SECCION "CIERRE DE CAJA". El orden es el de la cabeza del dueño, no el
 * del modelo de datos (pages/Caja.tsx):
 *
 *   0. Abrir.                (lo primero del dia, arriba del todo)
 *   1. Que vendi.            (y que se anulo, que es la otra mitad)
 *   2. Que salio.            (gastos y retiros)
 *   3. Por donde entro.      (desglose por forma de pago)
 *   4. ¿Cuadra?              (el dia en cuatro cifras)
 *   5. Contar.               (el boton de abajo, siempre a mano)
 *
 * Y se cuadra UN DIA, no "hoy": si anoche no dio tiempo, se elige la fecha.
 */
export type DatosDelDia = { resumen: ResumenCaja; apertura: EstadoApertura | null }

export function SeccionCierre({
  dia,
  alCambiarDia,
  datos,
  error,
  alReintentar,
  alAbrir,
  irAMovimientos,
}: {
  dia: string
  alCambiarDia: (d: string) => void
  /** Lo del dia elegido, o null mientras llega (no se muestra lo de otro dia). */
  datos: DatosDelDia | null
  error: string
  alReintentar: () => void
  alAbrir: () => void
  irAMovimientos: () => void
}) {
  const t = useTema()
  const { tablet } = useDisposicion()
  const columnas = tablet ? 4 : 2
  const r = datos?.resumen

  return (
    <>
      {datos ? <Apertura estado={datos.apertura} alAbrir={alAbrir} /> : null}
      <SelectorDia dia={dia} alCambiar={alCambiarDia} cerrada={r?.cerrada ?? false} />
      {error ? datos ? <Aviso texto={error} tono="peligro" /> : <Problema mensaje={error} alReintentar={alReintentar} /> : null}
      {!datos && !error ? <Cargando /> : null}
      {r ? (
        <>
          <Ventas r={r} columnas={columnas} />
          <Salidas r={r} irAMovimientos={irAMovimientos} />
          <Desglose r={r} />
          <ResumenDelDia r={r} columnas={columnas} />
          {/* Cerrado no es intocable: el boton de abajo pasa a "Corregir el
              conteo", que por dentro anula y rehace (los libros no se reescriben). */}
          {r.cerrada ? (
            <Text style={[estilos.cerrada, { color: t.suave }]}>Esta caja ya se cerró. Lo reportado se ve en la tabla de arriba.</Text>
          ) : null}
        </>
      ) : null}
    </>
  )
}

/**
 * Abrir la caja: el primer gesto del dia. No bloquea la venta --nadie deja
 * de vender por un formulario-- pero dice que se pierde: sin apertura, el
 * cierre de esta noche parte del saldo contable, que arrastra cualquier
 * descuadre viejo.
 */
function Apertura({ estado, alAbrir }: { estado: EstadoApertura | null; alAbrir: () => void }) {
  const t = useTema()
  const { fmt } = useMoneda()
  if (!estado) return null

  if (estado.abierta) {
    const total = estado.fondos.reduce((s, f) => s + f.fondo, 0)
    const descuadre = estado.fondos.reduce((s, f) => s + f.diferencia, 0)
    return (
      <Ficha style={{ paddingVertical: 16 }}>
        <View style={estilos.abiertaCabeza}>
          <Titulo>Caja abierta</Titulo>
          <Text style={[estilos.fondo, { color: t.suave }]}>fondo {fmt(total)}</Text>
        </View>
        <Nota style={{ marginTop: 4 }}>
          {estado.fondos.map((f) => `${etiquetaMetodo(f.metodo)} ${fmt(f.fondo)}`).join(' · ')}
          {estado.operador ? ` · abrió ${estado.operador}` : ''}
        </Nota>
        {/* Una diferencia al abrir paso ANTES del turno. Decirlo aqui es lo que
            impide que esta noche se le cargue al cajero de hoy. */}
        {!cuadra(descuadre) ? (
          <Nota style={{ color: t.aviso, marginTop: 6 }}>
            Al abrir {descuadre > 0 ? 'había' : 'faltaban'} {fmt(Math.abs(descuadre))} respecto a lo que decían los libros. Ya
            quedó asentado: no se le cuenta a este turno.
          </Nota>
        ) : null}
      </Ficha>
    )
  }

  if (!estado.puede_abrir) return null

  return (
    <Ficha tono="aviso" style={{ gap: 8 }}>
      <Text style={[estilos.avisoTitulo, { color: t.avisoFuerte }]}>La caja de este día no se ha abierto</Text>
      <Nota style={{ color: t.aviso }}>
        Cuenta el fondo con el que arrancas y el cierre de esta noche será la resta de un solo día. Sin eso parte del saldo
        contable, que arrastra cualquier descuadre viejo.
      </Nota>
      <View style={{ marginTop: 4 }}>
        <Boton texto="Abrir caja" tono="neutro" icono="caja" alTocar={alAbrir} />
      </View>
    </Ficha>
  )
}

/** 1. Que se vendio, y que no llego a venderse. */
function Ventas({ r, columnas }: { r: ResumenCaja; columnas: number }) {
  const { fmt } = useMoneda()
  return (
    <Ficha style={{ gap: 12 }}>
      <Titulo>Ventas</Titulo>
      <Cuadros
        columnas={columnas}
        cuadros={[
          { titulo: 'Vendido', valor: r.vendido, detalle: plural(r.cantidad_pedidos, 'pedido', 'pedidos'), fuerte: true },
          { titulo: 'Descuentos', valor: r.descuentos, detalle: 'rebajas a clientes', tono: r.descuentos > 0 ? 'neutro' : 'apagado' },
          {
            titulo: 'Anuladas',
            valor: r.anulado_monto_hoy,
            detalle: plural(r.anulados_hoy, 'comanda botada', 'comandas botadas'),
            tono: r.anulados_hoy > 0 ? 'malo' : 'apagado',
          },
          { titulo: 'Propinas', valor: r.propinas, detalle: 'del empleado, no del negocio', tono: r.propinas > 0 ? 'neutro' : 'apagado' },
        ]}
      />
      {/* Devolver no es anular: ahi la plata entro y volvio a salir, asi que
          el desglose de abajo si se entero. */}
      {r.devueltos_hoy > 0 ? (
        <Nota>
          Además se devolvieron {plural(r.devueltos_hoy, 'venta', 'ventas')} por {fmt(r.devuelto_monto_hoy)}: esa plata entró
          y volvió a salir.
        </Nota>
      ) : null}
    </Ficha>
  )
}

/** 2. Que salio de la caja que no fue una venta. */
function Salidas({ r, irAMovimientos }: { r: ResumenCaja; irAMovimientos: () => void }) {
  const t = useTema()
  const { fmt } = useMoneda()
  const hay = r.gastos > 0 || r.retiros > 0 || r.otros_movimientos.length > 0
  return (
    <Ficha style={{ gap: 10 }}>
      <Cabecera titulo="Gastos y retiros" derecha={<Enlace texto="Registrar uno" alTocar={irAMovimientos} />} />
      <Cuadros
        columnas={2}
        cuadros={[
          { titulo: 'Gastos', valor: r.gastos, detalle: 'bombona, vasos, pitillos…', tono: r.gastos > 0 ? 'malo' : 'apagado' },
          {
            titulo: 'Retiros del dueño',
            valor: r.retiros,
            detalle: 'no es gasto: sale del patrimonio',
            tono: r.retiros > 0 ? 'malo' : 'apagado',
          },
        ]}
      />
      {/* Pagarle a un proveedor tambien mueve la caja, y no es ninguno de los
          dos. Si no se dijera, al contar apareceria como un descuadre. */}
      {r.otros_movimientos.map((o) => (
        <Nota key={o.cuenta}>
          En {o.etiqueta.toLowerCase()} hubo {fmt(o.monto)} de otros movimientos (pagos a proveedores, compras sueltas,
          impuestos). No salieron de aquí, pero cuentan al cotejar.
        </Nota>
      ))}
      {!hay ? <Nota style={{ color: t.tenue }}>No salió nada de la caja este día.</Nota> : null}
    </Ficha>
  )
}

/**
 * 4. El dia en cuatro cifras. Breve a proposito: lo unico que no esta arriba
 * es el resultado (que quedo despues de los gastos) y la comprobacion de que
 * el desglose explica las ventas, que es la que dice si vale la pena contar.
 */
function ResumenDelDia({ r, columnas }: { r: ResumenCaja; columnas: number }) {
  const t = useTema()
  const { fmt } = useMoneda()
  // Las propinas no son del negocio y los retiros no son gasto.
  const resultado = redondear2(r.vendido - r.gastos)
  return (
    <Ficha style={{ gap: 12 }}>
      <Cuadros
        columnas={columnas}
        cuadros={[
          { titulo: 'Ventas', valor: r.vendido, detalle: plural(r.cantidad_pedidos, 'pedido', 'pedidos') },
          { titulo: 'Gastos', valor: r.gastos, detalle: 'bombona, vasos, pitillos…', tono: r.gastos > 0 ? 'malo' : 'apagado' },
          { titulo: 'Retiros', valor: r.retiros, detalle: 'del dueño: no es gasto', tono: r.retiros > 0 ? 'malo' : 'apagado' },
          { titulo: 'Resultado', valor: resultado, detalle: 'ventas − gastos', fuerte: true, tono: resultado < 0 ? 'malo' : 'neutro' },
        ]}
      />
      {/* LA comprobacion: si el desglose no suma las ventas, hay un pago mal
          registrado y contar la caja no va a servir de nada. */}
      {!r.cuadra_ventas ? (
        <View style={[estilos.alarma, { backgroundColor: t.peligroSuave }]}>
          <Text style={[estilos.alarmaTexto, { color: t.peligro }]}>
            <Text style={{ fontFamily: LETRA.textoFuerte }}>
              Las formas de pago no suman las ventas: faltan {fmt(Math.abs(r.a_cobrar - r.cobrado))}.
            </Text>{' '}
            Hay una venta cobrada sin pago registrado. Revísala antes de contar.
          </Text>
        </View>
      ) : null}
      {r.propinas > 0 ? (
        <Nota style={{ color: t.tenue }}>
          Además hay {fmt(r.propinas)} de propinas en la gaveta: son del empleado, no del negocio, y no cuentan en el resultado.
        </Nota>
      ) : null}
    </Ficha>
  )
}

const estilos = StyleSheet.create({
  abiertaCabeza: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  fondo: { fontFamily: LETRA.cifra, fontSize: 14 },
  avisoTitulo: { fontFamily: LETRA.titulo, fontSize: 17, letterSpacing: -0.2 },
  alarma: { borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  alarmaTexto: { fontFamily: LETRA.texto, fontSize: 14, lineHeight: 20 },
  cerrada: { fontFamily: LETRA.texto, fontSize: 13.5, textAlign: 'center', paddingHorizontal: 12 },
})
