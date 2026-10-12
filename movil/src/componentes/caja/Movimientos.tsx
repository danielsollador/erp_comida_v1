import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { METODOS_PAGO } from '../../../../frontend/src/lib/pagos'
import { apiCaja } from '../../lib/api-caja'
import { useMoneda } from '../../lib/moneda'
import { aNumero } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import type { Gasto, RetiroPropietario } from '../../lib/tipos'
import Icono from '../Icono'
import { CampoNumero, Selector } from '../kit'
import { Aviso, Boton, Campo, Ficha, Nota, Titulo } from '../ui'
import { CATEGORIAS_GASTO, diaMes } from './logica'
import { Cabecera, mensajeDe, Segmentado } from './piezas'

/**
 * GASTOS Y RETIROS (la seccion `movimientos` de pages/Caja.tsx).
 *
 * Los dos salen de la caja, y por eso hay que decir POR DONDE: si se cobro
 * 100 en efectivo y salieron 50 para una bombona, al contar tienen que
 * aparecer 50. Sin esa pregunta, el cierre siempre iba a dar faltante.
 *
 * NADA DE MERCANCIA. Un gasto no mueve inventario: para eso estan Compras e
 * Inventario.
 *
 * Borrar no pregunta: la fila se va y durante unos segundos se puede
 * deshacer (ver Deshacer.tsx). Lo maneja la pantalla, para que la orden siga
 * esperando aunque se cambie de seccion.
 */
export function Movimientos({
  gastos,
  retiros,
  etiqueta,
  alCambiar,
  alBorrar,
  oculto,
}: {
  gastos: Gasto[]
  retiros: RetiroPropietario[]
  /** El periodo de las listas, rotulado ("12 sep – 11 oct"). */
  etiqueta: string
  alCambiar: () => void
  alBorrar: (tipo: 'gasto' | 'retiro', id: number) => void
  oculto: (clave: string) => boolean
}) {
  const t = useTema()
  const [tipo, setTipo] = useState<'gasto' | 'retiro'>('gasto')
  const [descripcion, setDescripcion] = useState('')
  const [categoria, setCategoria] = useState(CATEGORIAS_GASTO[0])
  const [monto, setMonto] = useState('')
  const [metodo, setMetodo] = useState(METODOS_PAGO[0])
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const esGasto = tipo === 'gasto'
  const n = aNumero(monto)
  // Las mismas condiciones de la web (que no registra sin monto, ni un gasto
  // sin decir que fue); aqui el boton se apaga en vez de no hacer nada.
  const listo = Number.isFinite(n) && n > 0 && (!esGasto || descripcion.trim() !== '')

  async function registrar() {
    if (!listo || guardando) return
    setError('')
    setGuardando(true)
    try {
      if (esGasto) await apiCaja.crearGasto(descripcion.trim(), categoria, n, metodo)
      else await apiCaja.crearRetiro(n, metodo, descripcion.trim())
      setDescripcion('')
      setMonto('')
      alCambiar()
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo registrar'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <>
      <Ficha style={{ gap: 12 }}>
        <View style={{ gap: 4 }}>
          <Titulo>Registrar</Titulo>
          <Nota>
            Un <Text style={{ fontFamily: LETRA.textoFuerte, color: t.tinta }}>gasto</Text> es algo que el negocio pagó (bombona,
            vasos, pitillos). Un <Text style={{ fontFamily: LETRA.textoFuerte, color: t.tinta }}>retiro</Text> es plata que se
            lleva el dueño. Ninguno de los dos es mercancía: eso va por Compras, que sí mueve el inventario.
          </Nota>
        </View>
        <Segmentado
          opciones={[
            { id: 'gasto', texto: 'Gasto' },
            { id: 'retiro', texto: 'Retiro del dueño' },
          ]}
          valor={tipo}
          alCambiar={setTipo}
        />
        <Campo
          rotulo={esGasto ? 'Descripción' : 'Nota (opcional)'}
          value={descripcion}
          onChangeText={setDescripcion}
          placeholder={esGasto ? 'Ej. Bombona de gas' : undefined}
        />
        {esGasto ? (
          <Selector
            forma="campo"
            etiqueta="Categoría"
            opciones={CATEGORIAS_GASTO.map((c) => ({ valor: c, texto: c }))}
            valor={categoria}
            alCambiar={setCategoria}
          />
        ) : null}
        {/* POR DONDE sale la plata. Es lo que hace que el cierre cuadre: sin
            esto, un sueldo pagado por transferencia bajaba igual el efectivo. */}
        <Selector
          forma="campo"
          etiqueta="De dónde sale la plata"
          opciones={METODOS_PAGO.map((m) => ({ valor: m, texto: `De ${m}` }))}
          valor={metodo}
          alCambiar={setMetodo}
        />
        <CampoNumero rotulo="Monto" prefijo="$" valor={monto} alCambiar={setMonto} placeholder="0,00" />
        {error ? <Aviso texto={error} tono="peligro" /> : null}
        <Boton texto="Registrar" alTocar={registrar} ocupado={guardando} deshabilitado={!listo} />
      </Ficha>

      <ListaMovimientos
        titulo="Gastos"
        etiqueta={etiqueta}
        filas={gastos
          .filter((g) => !oculto(`gasto:${g.id}`))
          .map((g) => ({
            id: g.id,
            fecha: g.fecha,
            texto: g.descripcion,
            detalle: `${g.categoria} · de ${g.metodo_pago}`,
            monto: g.monto,
            borrar: () => alBorrar('gasto', g.id),
          }))}
      />
      <ListaMovimientos
        titulo="Retiros del dueño"
        etiqueta={etiqueta}
        filas={retiros
          .filter((r) => !oculto(`retiro:${r.id}`))
          .map((r) => ({
            id: r.id,
            fecha: r.fecha,
            texto: r.nota || 'Retiro',
            detalle: `de ${r.metodo_pago}`,
            monto: r.monto,
            borrar: () => alBorrar('retiro', r.id),
          }))}
      />
    </>
  )
}

type FilaMovimiento = { id: number; fecha: string; texto: string; detalle: string; monto: number; borrar: () => void }

function ListaMovimientos({ titulo, etiqueta, filas }: { titulo: string; etiqueta: string; filas: FilaMovimiento[] }) {
  const t = useTema()
  const { fmt } = useMoneda()
  const total = filas.reduce((s, f) => s + f.monto, 0)
  return (
    <Ficha style={{ paddingHorizontal: 0, paddingVertical: 14 }}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 4 }}>
        <Cabecera titulo={titulo} detalle={etiqueta} derecha={<Text style={[l.total, { color: t.tinta }]}>{fmt(total)}</Text>} />
      </View>
      {filas.map((f, i) => (
        <View
          key={f.id}
          style={[l.fila, i < filas.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 }]}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[l.texto, { color: t.tinta }]} numberOfLines={2}>
              {f.texto}
            </Text>
            <Text style={[l.detalle, { color: t.suave }]} numberOfLines={1}>
              {diaMes(f.fecha)} · {f.detalle}
            </Text>
          </View>
          <Text style={[l.monto, { color: t.tinta }]}>{fmt(f.monto)}</Text>
          <Pressable
            onPress={f.borrar}
            accessibilityRole="button"
            accessibilityLabel={`Borrar ${f.texto}`}
            hitSlop={4}
            style={({ pressed }) => [l.borrar, { backgroundColor: pressed ? t.peligroSuave : 'transparent' }]}
          >
            <Icono nombre="quitar" size={15} color={t.peligro} grosor={2} />
          </Pressable>
        </View>
      ))}
      {filas.length === 0 ? <Nota style={{ color: t.tenue, paddingHorizontal: 20, paddingTop: 6 }}>Nada en este período.</Nota> : null}
    </Ficha>
  )
}

const l = StyleSheet.create({
  total: { fontFamily: LETRA.cifraFuerte, fontSize: 16 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 20, paddingRight: 10, paddingVertical: 10, minHeight: 56 },
  texto: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  detalle: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 2 },
  monto: { fontFamily: LETRA.cifra, fontSize: 15 },
  borrar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
})
