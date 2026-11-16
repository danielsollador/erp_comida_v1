import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { MUY_PARECIDO, parecidos } from '../../../../frontend/src/lib/parecidos'
import { ALMACEN_DE, ALMACENES } from '../../../../frontend/src/lib/tiposArticulo'
import { apiCompras } from '../../lib/api-compras'
import { num } from '../../lib/compras-app'
import { miles } from '../../lib/formato'
import { LETRA, useTema } from '../../lib/tema'
import type { Ingrediente, TipoArticulo } from '../../lib/tipos'
import Icono from '../Icono'
import { HojaFormulario } from '../kit'
import { Boton, Campo, Interruptor } from '../ui'
import { Casilla, colorTipo, mensajeDe, NotaTono, PuntoTipo } from './piezas'

/**
 * Crear una mercancia sin salir de la factura (components/NuevaMercancia.tsx
 * de la web).
 *
 * LO PRIMERO ES NO DUPLICAR. Mientras se escribe el nombre aparecen las que
 * ya existen y se le parecen, cada una con "Usar esta". Si hay una casi
 * igual, crear pide un segundo toque ("Es otra, crearla"). El servidor
 * rechaza los nombres iguales.
 *
 * Tres preguntas: como se llama, que es (el almacen) y en que se lleva. Y una
 * cuarta, opcional: ¿como te llega? Si llega en empaque, la ficha se lleva en
 * unidades y el empaque queda anotado: "1 empaque = 24".
 */

const UNIDADES = [
  { valor: 'kg', texto: 'Kilos', nota: 'y gramos' },
  { valor: 'lt', texto: 'Litros', nota: 'y mililitros' },
  { valor: 'unidad', texto: 'Unidades', nota: 'de una en una' },
]

/** Como llega del proveedor: en un envase que trae varias unidades nuestras. */
export type Presentacion = { nombre: string; trae: number }

export default function NuevaMercancia(props: {
  visible: boolean
  ingredientes: Ingrediente[]
  nombreInicial?: string
  unidadInicial?: string
  exentoInicial?: boolean
  /** Si ya se dijo que es (el renglon de la factura lo eligio antes). */
  tipoInicial?: TipoArticulo | null
  /** Lo que dice la factura, para tenerlo a la vista mientras se nombra. */
  delPapel?: string
  onUsar: (ing: Ingrediente) => void
  onCreada: (ing: Ingrediente, presentacion: Presentacion | null) => void
  onCerrar: () => void
}) {
  // El formulario nace cada vez que se abre: arranca con lo del renglon.
  if (!props.visible) return null
  return (
    <Formulario
      {...props}
      nombreInicial={props.nombreInicial ?? ''}
      unidadInicial={props.unidadInicial ?? 'kg'}
      exentoInicial={props.exentoInicial ?? false}
      tipoInicial={props.tipoInicial ?? null}
    />
  )
}

function Formulario({
  ingredientes,
  nombreInicial,
  unidadInicial,
  exentoInicial,
  tipoInicial,
  delPapel,
  onUsar,
  onCreada,
  onCerrar,
}: {
  visible: boolean
  ingredientes: Ingrediente[]
  nombreInicial: string
  unidadInicial: string
  exentoInicial: boolean
  tipoInicial: TipoArticulo | null
  delPapel?: string
  onUsar: (ing: Ingrediente) => void
  onCreada: (ing: Ingrediente, presentacion: Presentacion | null) => void
  onCerrar: () => void
}) {
  const t = useTema()
  const [nombre, setNombre] = useState(nombreInicial)
  const [unidad, setUnidad] = useState(unidadInicial === 'paquete' ? 'unidad' : unidadInicial)
  const [tipo, setTipo] = useState<TipoArticulo | null>(tipoInicial)
  const [exento, setExento] = useState(exentoInicial)
  const [enPaquete, setEnPaquete] = useState(false)
  const [paqueteTrae, setPaqueteTrae] = useState('')
  const [confirmando, setConfirmando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const similares = useMemo(() => parecidos(nombre, ingredientes), [nombre, ingredientes])
  const casiIgual = similares.some((s) => s.puntos >= MUY_PARECIDO)
  const almacen = tipo ? ALMACEN_DE[tipo] : null

  async function crear() {
    setError('')
    if (!nombre.trim()) return setError('Ponle un nombre.')
    if (!tipo) return setError('Di qué es: a eso le dice el sistema a dónde va.')
    const trae = num(paqueteTrae)
    if (enPaquete && (!Number.isFinite(trae) || trae <= 0)) return setError('¿Cuántas trae cada empaque?')
    if (casiIgual && !confirmando) {
      setConfirmando(true)
      return
    }
    setGuardando(true)
    try {
      const creada = await apiCompras.crearIngrediente({
        nombre: nombre.trim(),
        unidad,
        tipo,
        exento,
        stock_actual: 0,
        stock_minimo: 0,
        stock_objetivo: 0,
        costo_unitario: 0,
        rendimiento_pct: 100,
        // Sin clasificar: nace de urgencia cargando una factura, y ese no es
        // el momento de pensar en que cajon del inventario va.
        categoria_id: null,
        activo: true,
        // Queda en la ficha: la proxima factura ya la da por empacada.
        empaque_trae: enPaquete ? trae : null,
      })
      // "empaque" a secas: caja, bulto o paquete da igual, lo que importa es
      // cuantas trae (Leider, 8-oct).
      onCreada(creada, enPaquete ? { nombre: 'empaque', trae } : null)
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo crear'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <HojaFormulario
      visible
      alCerrar={onCerrar}
      titulo="Mercancía nueva"
      subtitulo="Solo lo que hace falta para empezar. El resto se completa en Inventario."
      pie={
        <>
          <View style={{ flex: 1 }}>
            <Boton texto="Cancelar" tono="neutro" alTocar={onCerrar} />
          </View>
          <View style={{ flex: 1 }}>
            <Boton texto={confirmando ? 'Es otra, crearla' : 'Crear'} alTocar={() => void crear()} ocupado={guardando} />
          </View>
        </>
      }
    >
    <View style={{ gap: 18 }}>
      <View style={{ gap: 8 }}>
        {delPapel ? (
          <Text style={[n.nota, { color: t.tenue }]}>
            En la factura: <Text style={{ fontFamily: LETRA.textoFuerte, color: t.fuerte }}>{delPapel}</Text>
          </Text>
        ) : null}
        <Campo
          value={nombre}
          onChangeText={(v) => {
            setNombre(v)
            setConfirmando(false)
          }}
          placeholder="¿Cómo se llama? Ej. Crema de leche"
          accessibilityLabel="Nombre de la mercancía"
          ayuda="El nombre de la cosa, no del empaque: «Crema de leche», no «Crema de leche lata grande»."
        />
      </View>

      {similares.length > 0 ? (
        <View style={[n.parecidas, { backgroundColor: confirmando ? t.avisoSuave : t.gris100 }]}>
          <Text style={[n.parecidasTitulo, { color: confirmando ? t.aviso : t.suave }]}>
            {confirmando ? '¿Seguro que no es ninguna de estas?' : 'Ya tienes estas parecidas:'}
          </Text>
          {similares.map(({ ing }) => (
            <View key={ing.id} style={[n.parecida, { backgroundColor: t.superficie }]}>
              <PuntoTipo tipo={ing.tipo} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[n.parecidaNombre, { color: t.tinta }]} numberOfLines={2}>
                  {ing.nombre}
                </Text>
                <Text style={[n.nota, { color: t.tenue }]}>
                  {ing.unidad} · hay {miles(Number(ing.stock_actual || 0), Number(ing.stock_actual || 0) % 1 ? 2 : 0)}
                </Text>
              </View>
              <Pressable
                onPress={() => onUsar(ing)}
                accessibilityRole="button"
                style={({ pressed }) => [n.usar, { borderColor: t.gris200, backgroundColor: pressed ? t.gris100 : t.superficie }]}
              >
                <Text style={[n.usarTexto, { color: t.tinta }]}>Usar esta</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={{ gap: 8 }}>
        <Text style={[n.etiqueta, { color: t.tenue }]}>Qué es</Text>
        <View style={n.almacenes}>
          {ALMACENES.map((a) => {
            const esta = tipo === a.valor
            const c = colorTipo(t, a.valor)
            return (
              <Pressable
                key={a.valor}
                onPress={() => setTipo(a.valor)}
                accessibilityRole="radio"
                accessibilityState={{ checked: esta }}
                style={({ pressed }) => [
                  n.almacen,
                  { backgroundColor: esta ? t.tinta : t.gris100, transform: [{ scale: pressed ? 0.98 : 1 }] },
                ]}
              >
                <View style={n.almacenCabeza}>
                  <View style={[n.almacenIcono, { backgroundColor: esta ? 'rgba(255,255,255,0.12)' : c.fondo }]}>
                    <Icono nombre={a.icono} size={16} color={esta ? t.papel : c.tinta} />
                  </View>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.punto }} />
                </View>
                <Text style={[n.almacenNombre, { color: esta ? t.papel : t.tinta }]}>{a.texto}</Text>
                <Text style={[n.almacenDetalle, { color: esta ? t.gris200 : t.suave }]}>{a.detalle}</Text>
                <Text style={[n.almacenDestino, { color: esta ? t.gris200 : a.destino === 'gasto' ? t.aviso : t.tenue }]}>
                  {a.destino === 'gasto' ? '→ gasto del mes' : '→ inventario'}
                </Text>
              </Pressable>
            )
          })}
        </View>
        {almacen ? (
          <Text style={[n.nota, { color: t.suave }]}>
            {almacen.detalle}{' '}
            {almacen.destino === 'gasto'
              ? 'No se lleva stock: cada factura va entera al gasto del mes.'
              : 'Entra al inventario y se descuenta al venderse o usarse en una receta.'}
          </Text>
        ) : null}
      </View>

      <View style={{ gap: 8 }}>
        <Text style={[n.etiqueta, { color: t.tenue }]}>Se lleva en</Text>
        <View style={n.fila}>
          {UNIDADES.map((u) => {
            const esta = unidad === u.valor
            return (
              <Pressable
                key={u.valor}
                onPress={() => setUnidad(u.valor)}
                accessibilityRole="radio"
                accessibilityState={{ checked: esta }}
                style={[n.chip, { backgroundColor: esta ? t.tinta : t.gris100 }]}
              >
                <Text style={[n.chipTitulo, { color: esta ? t.papel : t.tinta }]}>{u.texto}</Text>
                <Text style={[n.chipNota, { color: esta ? t.gris200 : t.tenue }]}>{u.nota}</Text>
              </Pressable>
            )
          })}
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Text style={[n.etiqueta, { color: t.tenue }]}>Cómo te llega</Text>
        <View style={n.fila}>
          <Pressable onPress={() => setEnPaquete(false)} accessibilityRole="radio" accessibilityState={{ checked: !enPaquete }} style={[n.chip, { backgroundColor: !enPaquete ? t.tinta : t.gris100 }]}>
            <Text style={[n.chipTitulo, { color: !enPaquete ? t.papel : t.tinta }]}>Suelta</Text>
            <Text style={[n.chipNota, { color: !enPaquete ? t.gris200 : t.tenue }]}>
              por {unidad === 'kg' ? 'kilo' : unidad === 'lt' ? 'litro' : 'unidad'}, tal cual
            </Text>
          </Pressable>
          <Pressable onPress={() => setEnPaquete(true)} accessibilityRole="radio" accessibilityState={{ checked: enPaquete }} style={[n.chip, { backgroundColor: enPaquete ? t.tinta : t.gris100 }]}>
            <Text style={[n.chipTitulo, { color: enPaquete ? t.papel : t.tinta }]}>En empaque</Text>
            <Text style={[n.chipNota, { color: enPaquete ? t.gris200 : t.tenue }]}>trae varias; se cuentan de una en una</Text>
          </Pressable>
        </View>
        {enPaquete ? (
          <View style={{ gap: 6 }}>
            <View style={n.trae}>
              <Text style={[n.texto, { color: t.suave }]}>1 empaque trae</Text>
              <Casilla valor={paqueteTrae} alCambiar={setPaqueteTrae} placeholder="24" etiqueta="Cuántas trae" style={{ width: 110 }} />
              <Text style={[n.texto, { color: t.suave }]}>{unidad === 'unidad' ? 'unidades' : unidad}</Text>
            </View>
            <Text style={[n.nota, { color: t.tenue }]}>Se recuerda para este proveedor: la próxima factura ya viene convertida.</Text>
          </View>
        ) : null}
      </View>

      <Interruptor texto="Exenta de IVA" detalle="La mayoría de los alimentos básicos." valor={exento} alCambiar={setExento} />

      {error ? <NotaTono tono="mal">{error}</NotaTono> : null}
    </View>
    </HojaFormulario>
  )
}

const n = StyleSheet.create({
  nota: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
  texto: { fontFamily: LETRA.texto, fontSize: 15 },
  etiqueta: { fontFamily: LETRA.textoFuerte, fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase' },
  parecidas: { borderRadius: 18, borderCurve: 'continuous', padding: 12, gap: 8 },
  parecidasTitulo: { fontFamily: LETRA.textoFuerte, fontSize: 13.5 },
  parecida: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderCurve: 'continuous', paddingHorizontal: 12, paddingVertical: 8 },
  parecidaNombre: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  usar: { borderWidth: 1, borderRadius: 18, borderCurve: 'continuous', paddingHorizontal: 12, minHeight: 38, justifyContent: 'center' },
  usarTexto: { fontFamily: LETRA.textoFuerte, fontSize: 13.5 },
  almacenes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  almacen: { width: '48.5%', flexGrow: 1, borderRadius: 18, borderCurve: 'continuous', padding: 12, gap: 4 },
  almacenCabeza: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  almacenIcono: { width: 32, height: 32, borderRadius: 11, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  almacenNombre: { fontFamily: LETRA.textoFuerte, fontSize: 15, marginTop: 6 },
  almacenDetalle: { fontFamily: LETRA.texto, fontSize: 13, lineHeight: 17 },
  almacenDestino: { fontFamily: LETRA.textoFuerte, fontSize: 13, marginTop: 4 },
  fila: { flexDirection: 'row', gap: 8 },
  chip: { flex: 1, borderRadius: 14, borderCurve: 'continuous', paddingHorizontal: 12, paddingVertical: 10, minHeight: 56 },
  chipTitulo: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  chipNota: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 2 },
  trae: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
})
