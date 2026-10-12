import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Barra } from '../../componentes/Encabezado'
import Icono from '../../componentes/Icono'
import { useDisposicion, Vacio } from '../../componentes/kit'
import { Ficha, Pantalla } from '../../componentes/ui'
import { abrir, entraA, MODULOS } from '../../lib/modulos'
import { useSesion } from '../../lib/sesion'
import { LETRA, useTema } from '../../lib/tema'

/**
 * LA PUERTA A LO QUE SE ARMA SOLO (pages/Contador.tsx de la web).
 *
 * Contabilidad, impuestos y la tasa son el corazon de un ERP tradicional,
 * pero el dueño no los opera: cada venta y cada compra ya dejan su asiento,
 * su IVA y su tasa sin que nadie cargue nada. Lo que necesita de aqui es una
 * sola cosa: saber que esta listo cuando el contador lo pida.
 */
const QUE_HAY: Record<string, { que: string; para: string }> = {
  '/contabilidad': {
    que: 'Libro diario, balance y estado de resultados',
    para: 'Cada venta, compra, gasto y merma ya dejó su asiento. Aquí se leen; no hay que cargar nada.',
  },
  '/impuestos': {
    que: 'Libro de ventas, libro de compras y el IVA del mes',
    para: 'Se arman con lo facturado. Al cierre del mes, la declaración sale de aquí.',
  },
  '/tasa': {
    que: 'La tasa del BCV de cada día',
    para: 'Se actualiza sola varias veces al día. Cada venta guarda la de su día; aquí está el historial.',
  },
}

export default function Contador() {
  const t = useTema()
  const { tablet } = useDisposicion()
  const { acceso } = useSesion()
  const pantallas = MODULOS.filter((m) => m.to in QUE_HAY && entraA(acceso?.puede.modulos, m))

  return (
    <Pantalla arriba={<Barra titulo="Zona contable" />}>
      <View style={{ gap: 8, marginTop: 4, marginBottom: 4 }}>
        <Text style={[estilos.titulo, { color: t.tinta }]}>Esto se arma solo</Text>
        <Text style={[estilos.texto, { color: t.suave }]}>
          No hay nada que cargar aquí. Con cada venta y cada compra, el sistema ya escribe la contabilidad, los libros del
          IVA y la tasa del día. Entra cuando tu contador te lo pida, o para exportarle lo que necesite.
        </Text>
      </View>

      {pantallas.length === 0 ? (
        <Vacio icono="contabilidad" titulo="Tu rol no entra a la zona contable" detalle="Contabilidad, impuestos y la tasa los ve quien administra el local." />
      ) : null}

      <View style={tablet ? estilos.rejilla : { gap: 12 }}>
        {pantallas.map((m) => {
          const info = QUE_HAY[m.to]
          return (
            <Pressable
              key={m.to}
              onPress={() => abrir(m.to)}
              accessibilityRole="button"
              accessibilityLabel={m.titulo}
              style={({ pressed }) => [tablet && { flex: 1 }, { transform: [{ scale: pressed ? 0.985 : 1 }] }]}
            >
              <Ficha style={[estilos.tarjeta, tablet && { flex: 1 }]}>
                <View style={[estilos.icono, { backgroundColor: t.gris100 }]}>
                  <Icono nombre={m.icono} size={22} color={t.suave} />
                </View>
                <View style={{ gap: 4 }}>
                  <Text style={[estilos.nombre, { color: t.tinta }]}>{m.titulo}</Text>
                  <Text style={[estilos.que, { color: t.fuerte }]}>{info.que}</Text>
                  <Text style={[estilos.para, { color: t.suave }]}>{info.para}</Text>
                </View>
                <View style={estilos.abrir}>
                  <View style={[estilos.flecha, { backgroundColor: t.gris100 }]}>
                    <Icono nombre="chevron" size={14} color={t.suave} />
                  </View>
                  <Text style={[estilos.abrirTexto, { color: t.tenue }]}>Abrir</Text>
                </View>
              </Ficha>
            </Pressable>
          )
        })}
      </View>
    </Pantalla>
  )
}

const estilos = StyleSheet.create({
  titulo: { fontFamily: LETRA.tituloFuerte, fontSize: 24, letterSpacing: -0.5 },
  texto: { fontFamily: LETRA.texto, fontSize: 15, lineHeight: 22 },
  rejilla: { flexDirection: 'row', gap: 12, alignItems: 'stretch' },
  tarjeta: { gap: 12 },
  icono: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  nombre: { fontFamily: LETRA.titulo, fontSize: 18 },
  que: { fontFamily: LETRA.texto, fontSize: 14, lineHeight: 20 },
  para: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
  abrir: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 'auto' },
  flecha: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  abrirTexto: { fontFamily: LETRA.textoFuerte, fontSize: 13 },
})
