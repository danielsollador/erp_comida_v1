import { useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { enMoneda, type Numero, type Pendiente } from '../../lib/compras-app'
import { LETRA, useModo, useTema } from '../../lib/tema'
import { Hoja, OpcionHoja } from '../Hoja'
import Icono from '../Icono'
import { useDisposicion } from '../kit'
import { Boton, Ficha } from '../ui'
import { Casilla, MarcaIA } from './piezas'

/*
 * Las piezas de la carga de una factura que no son renglones: el PASO
 * plegable, los TOTALES con el recargo y el descuento, y la BARRA de abajo
 * con lo que falta revisar y "Guardar factura" (pages/partes/compras/
 * CargarFactura.tsx: `Paso`, `Totales`, `BarraGuardar`).
 */

/**
 * Un paso de la carga. Abierto se llena; plegado es una linea con lo que ya
 * tiene, para que en el telefono no haya que bajar por lo que ya se lleno.
 * "Listo" lo pliega y abre el siguiente. Tocar el titulo o el chevron de la
 * esquina (con su propio toque de 44 px) lo abre o lo pliega.
 */
export function Paso({
  numero,
  titulo,
  detalle,
  accion,
  abierto,
  onAbrir,
  onListo,
  hecho,
  resumen,
  anclar,
  children,
}: {
  numero: Numero
  titulo: string
  detalle?: ReactNode
  accion?: ReactNode
  abierto: boolean
  onAbrir: () => void
  onListo: () => void
  /** Ya tiene lo que necesita: plegado lleva el visto en vez del numero. */
  hecho: boolean
  /** Lo que se ve plegado. */
  resumen: ReactNode
  anclar: (v: View | null) => void
  children: ReactNode
}) {
  const t = useTema()
  const visto = hecho && !abierto
  return (
    <View ref={anclar} collapsable={false}>
      <Ficha style={{ padding: 0 }}>
        <View style={c.cabeza}>
          <Pressable onPress={onAbrir} accessibilityRole="button" accessibilityState={{ expanded: abierto }} style={c.titular}>
            <View style={[c.numero, { backgroundColor: visto ? t.exito500 : abierto ? t.tinta : t.gris100 }]}>
              {visto ? (
                <Icono nombre="ok" size={14} color="#ffffff" grosor={2.4} />
              ) : (
                <Text style={[c.numeroTexto, { color: abierto ? t.papel : t.suave }]}>{numero}</Text>
              )}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[c.titulo, { color: t.tinta }]}>{titulo}</Text>
              {abierto ? (
                detalle ? <Text style={[c.detalle, { color: t.suave }]}>{detalle}</Text> : null
              ) : (
                <Text style={[c.detalle, { color: t.suave }]} numberOfLines={2}>
                  {resumen}
                </Text>
              )}
            </View>
          </Pressable>
          {abierto && accion ? <View>{accion}</View> : null}
          <Pressable
            onPress={onAbrir}
            accessibilityLabel={abierto ? `Plegar ${titulo}` : `Abrir ${titulo}`}
            hitSlop={4}
            style={({ pressed }) => [c.chevron, pressed && { backgroundColor: t.gris100 }]}
          >
            <View style={{ transform: [{ rotate: abierto ? '-90deg' : '90deg' }] }}>
              <Icono nombre="chevron" size={18} color={t.suave} grosor={2.2} />
            </View>
          </Pressable>
        </View>
        {abierto ? (
          <View style={c.cuerpo}>
            {children}
            <View style={{ alignItems: 'flex-end', marginTop: 16 }}>
              <Pressable onPress={onListo} accessibilityRole="button" style={({ pressed }) => [c.listo, { backgroundColor: t.tinta, opacity: pressed ? 0.85 : 1 }]}>
                <Text style={[c.listoTexto, { color: t.papel }]}>Listo</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </Ficha>
    </View>
  )
}

/**
 * El total de la factura, con lo que el proveedor suma o rebaja encima de los
 * renglones. El recargo y el descuento son de la factura entera: se reparten
 * entre los renglones. El flete NO va aqui: es un renglon, con su ISLR.
 * Con una factura leida, al lado va lo que dice el papel y si cuadra.
 */
export function Totales({
  moneda,
  recargo,
  descuento,
  onRecargo,
  onDescuento,
  iaRecargo,
  iaDescuento,
  papelAjustes,
  base,
  iva,
  total,
  tasaIva,
  papel,
  cuadra,
  anclar,
}: {
  moneda: string
  recargo: string
  descuento: string
  onRecargo: (v: string) => void
  onDescuento: (v: string) => void
  iaRecargo: boolean
  iaDescuento: boolean
  papelAjustes: { recargo: number; descuento: number } | null
  base: number
  iva: number
  total: number
  tasaIva: number
  papel: { subtotal: number | null; iva: number | null; total: number } | null
  cuadra: boolean
  anclar: (v: View | null) => void
}) {
  const t = useTema()
  const { tablet } = useDisposicion()
  const monto = (n: number) => enMoneda(n, moneda)
  // En la tablet lo del papel va en su columna; en el telefono, debajo de
  // la cifra propia: tres columnas no caben en 360 px.
  const delPapel = (n: number | null | undefined) =>
    papel ? (
      <Text style={[tablet ? c.papel : c.papelChico, { color: t.tenue }]}>{`${tablet ? '' : 'papel '}${n == null ? '—' : monto(n)}`}</Text>
    ) : null
  const fila = (rotulo: string, nuestro: number, papelN?: number | null, fuerte = false) => (
    <View style={c.fila}>
      <Text style={[fuerte ? c.rotuloFuerte : c.rotulo, { color: fuerte ? t.tinta : t.suave }]}>{rotulo}</Text>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[fuerte ? c.cifraFuerte : c.cifra, { color: t.tinta }]}>{monto(nuestro)}</Text>
        {!tablet ? delPapel(papelN) : null}
      </View>
      {tablet ? delPapel(papelN) : null}
    </View>
  )
  const casilla = (rotulo: string, valor: string, cambiar: (v: string) => void, ia: boolean, signo: string, papelN?: number) => (
    <View style={c.fila}>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Text style={[c.rotulo, { color: t.suave, flex: 0 }]}>{rotulo}</Text>
        {ia ? <MarcaIA /> : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Casilla valor={valor} alCambiar={cambiar} prefijo={signo} placeholder="0,00" etiqueta={rotulo} style={{ width: 128 }} />
        {!tablet ? delPapel(papelN) : null}
      </View>
      {tablet ? delPapel(papelN) : null}
    </View>
  )
  const fondo = papel ? (cuadra ? t.exitoSuave : t.avisoSuave) : undefined
  return (
    <View ref={anclar} collapsable={false}>
      <Ficha style={fondo ? { backgroundColor: fondo, borderColor: fondo } : undefined}>
        {papel && tablet ? (
          <View style={c.fila}>
            <View style={{ flex: 1 }} />
            <Text style={[c.columna, { color: t.tenue, width: 128 }]}>Formulario</Text>
            <View style={[c.papelCabeza]}>
              <Text style={[c.columna, { color: t.tenue }]}>Papel</Text>
              <MarcaIA />
            </View>
          </View>
        ) : null}
        {casilla('Recargo', recargo, onRecargo, iaRecargo, '+', papelAjustes?.recargo)}
        {casilla('Descuento', descuento, onDescuento, iaDescuento, '−', papelAjustes?.descuento)}
        {fila('Base', base, papel?.subtotal)}
        {fila(`IVA ${tasaIva}%`, iva, papel?.iva)}
        {fila('Total', total, papel?.total, true)}
        {papel ? (
          <Text style={[c.nota, { color: cuadra ? t.exito : t.aviso, marginTop: 6 }]}>
            {cuadra ? 'Cuadra con el papel.' : 'No cuadra con el papel: revisa renglones, IVA de cada uno, recargo y descuento.'}
          </Text>
        ) : null}
      </Ficha>
    </View>
  )
}

/** Fija abajo: lo que falta revisar, si cuadra, y guardar. */
export function BarraGuardar({
  pendientes,
  cuadre,
  total,
  guardando,
  onIrA,
  onGuardar,
}: {
  pendientes: Pendiente[]
  cuadre: string | null
  total: string
  guardando: boolean
  onIrA: (ancla: string) => void
  onGuardar: () => void
}) {
  const t = useTema()
  const { modo } = useModo()
  const { tablet } = useDisposicion()
  const [abierta, setAbierta] = useState(false)
  const graves = pendientes.filter((x) => x.tono === 'mal').length
  return (
    <View style={[c.barra, { backgroundColor: t.superficie, borderTopColor: modo === 'oscuro' ? 'rgba(255,255,255,0.06)' : t.gris200 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          {pendientes.length > 0 ? (
            <Pressable
              onPress={() => (pendientes.length === 1 ? onIrA(pendientes[0].ancla) : setAbierta(true))}
              accessibilityRole="button"
              hitSlop={6}
              style={c.pendientes}
            >
              <Icono nombre="alerta" size={16} color={graves ? t.peligro : t.aviso} />
              <Text style={[c.pendientesTexto, { color: graves ? t.peligro : t.aviso }]} numberOfLines={2}>
                {pendientes.length === 1 ? pendientes[0].texto : `${pendientes.length} cosas por revisar`}
              </Text>
            </Pressable>
          ) : (
            <View style={c.pendientes}>
              <Icono nombre="ok" size={16} color={t.exito} grosor={2.2} />
              <Text style={[c.pendientesTexto, { color: t.exito }]} numberOfLines={2}>
                {cuadre === 'cuadra' ? 'Todo en orden y cuadra con el papel' : 'Nada pendiente'}
              </Text>
            </View>
          )}
          {cuadre && cuadre !== 'cuadra' && pendientes.length > 0 ? (
            <Text style={[c.nota, { color: t.tenue }]} numberOfLines={1}>
              {cuadre}
            </Text>
          ) : null}
        </View>
        {tablet ? <Text style={[c.cifraFuerte, { color: t.tinta }]}>{total}</Text> : null}
        <View style={{ minWidth: 150 }}>
          <Boton texto={guardando ? 'Guardando…' : 'Guardar factura'} alTocar={onGuardar} ocupado={guardando} />
        </View>
      </View>
      <Hoja visible={abierta} alCerrar={() => setAbierta(false)} titulo="Por revisar">
        {pendientes.map((x, i) => (
          <OpcionHoja
            key={i}
            texto={x.texto}
            icono="alerta"
            peligro={x.tono === 'mal'}
            alTocar={() => {
              setAbierta(false)
              onIrA(x.ancla)
            }}
          />
        ))}
      </Hoja>
    </View>
  )
}

const c = StyleSheet.create({
  cabeza: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingLeft: 16, paddingRight: 8, paddingTop: 12, paddingBottom: 12 },
  titular: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingTop: 4 },
  numero: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  numeroTexto: { fontFamily: LETRA.cifraFuerte, fontSize: 13 },
  titulo: { fontFamily: LETRA.titulo, fontSize: 17, letterSpacing: -0.2 },
  detalle: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19, marginTop: 2 },
  chevron: { width: 44, height: 44, borderRadius: 12, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  cuerpo: { paddingHorizontal: 16, paddingBottom: 16 },
  listo: { minHeight: 44, borderRadius: 14, borderCurve: 'continuous', paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center' },
  listoTexto: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  rotulo: { flex: 1, fontFamily: LETRA.texto, fontSize: 15 },
  rotuloFuerte: { flex: 1, fontFamily: LETRA.textoFuerte, fontSize: 16 },
  cifra: { minWidth: 110, textAlign: 'right', fontFamily: LETRA.cifra, fontSize: 15 },
  cifraFuerte: { minWidth: 110, textAlign: 'right', fontFamily: LETRA.cifraFuerte, fontSize: 18 },
  papelChico: { fontFamily: LETRA.cifra, fontSize: 13 },
  papel: { width: 92, textAlign: 'right', fontFamily: LETRA.cifra, fontSize: 13.5 },
  papelCabeza: { width: 92, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  columna: { fontFamily: LETRA.textoFuerte, fontSize: 13, textAlign: 'right' },
  nota: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
  barra: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 12 },
  pendientes: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  pendientesTexto: { flexShrink: 1, fontFamily: LETRA.textoFuerte, fontSize: 14 },
})
