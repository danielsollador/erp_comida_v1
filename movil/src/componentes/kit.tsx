import { BottomSheet, RNHostView } from '@expo/ui'
import { imePadding } from '@expo/ui/jetpack-compose/modifiers'
import { useMemo, useState, type ReactElement, type ReactNode } from 'react'
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type ListRenderItem,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { periodoDe, PERIODOS, type IdPeriodo, type Periodo } from '../lib/numeros'
import { LETRA, useModo, useTema } from '../lib/tema'
import Fondo from './Fondo'
import { Hoja, OpcionHoja } from './Hoja'
import Icono, { type NombreIcono } from './Icono'
import { Boton, Ficha } from './ui'

/*
 * EL KIT DE PIEZAS que repiten todos los modulos de la app: lo que en la web
 * son FiltroDesplegable, CampoNumero, la barra de buscar, la fila de una
 * tabla, el selector de periodo, la barra de "Guardar" de abajo y los
 * dialogos con formulario. Estan aqui para que Punto de venta, Compras,
 * Inventario y los demas se vean y se toquen igual. Una pieza que solo usa
 * un modulo va en la carpeta de ese modulo, no aqui.
 */

/** Ancho de tablet: dos columnas (el punto de venta con el carrito al lado). */
export function useDisposicion() {
  const { width, height } = useWindowDimensions()
  return { ancho: width, alto: height, tablet: width >= 700, apaisado: width > height }
}

// ── Pastilla ────────────────────────────────────────────────────────────────

/** Un estado en una palabra: pagada, por pagar, anulado, vencida (como `Pastilla` de la web). */
export function Pastilla({
  texto,
  tono = 'neutro',
}: {
  texto: string
  tono?: 'neutro' | 'bien' | 'ojo' | 'mal' | 'acento'
}) {
  const t = useTema()
  const fondo =
    tono === 'bien' ? t.exitoSuave : tono === 'ojo' ? t.avisoSuave : tono === 'mal' ? t.peligroSuave : tono === 'acento' ? t.acentoSuave : t.gris100
  const color = tono === 'bien' ? t.exito : tono === 'ojo' ? t.aviso : tono === 'mal' ? t.peligro : tono === 'acento' ? t.acento : t.suave
  return (
    <View style={[k.pastilla, { backgroundColor: fondo }]}>
      <Text style={[k.pastillaTexto, { color }]} numberOfLines={1}>
        {texto}
      </Text>
    </View>
  )
}

// ── Vacio ───────────────────────────────────────────────────────────────────

/** Cuando no hay nada que mostrar: que paso y que hacer (nunca una pantalla en blanco). */
export function Vacio({
  icono = 'inventario',
  titulo,
  detalle,
  accion,
}: {
  icono?: NombreIcono
  titulo: string
  detalle?: string
  accion?: { texto: string; alTocar: () => void }
}) {
  const t = useTema()
  return (
    <Ficha style={{ alignItems: 'center', paddingVertical: 32, gap: 10 }}>
      <View style={[k.vacioIcono, { backgroundColor: t.gris100 }]}>
        <Icono nombre={icono} size={22} color={t.tenue} />
      </View>
      <Text style={[k.vacioTitulo, { color: t.tinta }]}>{titulo}</Text>
      {detalle ? <Text style={[k.vacioDetalle, { color: t.suave }]}>{detalle}</Text> : null}
      {accion ? (
        <View style={{ marginTop: 6, alignSelf: 'stretch' }}>
          <Boton texto={accion.texto} alTocar={accion.alTocar} tono="neutro" />
        </View>
      ) : null}
    </Ficha>
  )
}

// ── Buscador ────────────────────────────────────────────────────────────────

export function Buscador({
  valor,
  alCambiar,
  placeholder = 'Buscar',
  autoFocus = false,
}: {
  valor: string
  alCambiar: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  const t = useTema()
  return (
    <View style={[k.buscador, { backgroundColor: t.superficie, borderColor: t.gris200 }]}>
      <Icono nombre="buscar" size={17} color={t.tenue} />
      <TextInput
        value={valor}
        onChangeText={alCambiar}
        placeholder={placeholder}
        placeholderTextColor={t.tenue}
        autoFocus={autoFocus}
        autoCorrect={false}
        returnKeyType="search"
        style={[k.buscadorTexto, { color: t.tinta }]}
      />
      {valor ? (
        <Pressable onPress={() => alCambiar('')} hitSlop={10} accessibilityLabel="Borrar la búsqueda">
          <Icono nombre="quitar" size={16} color={t.tenue} />
        </Pressable>
      ) : null}
    </View>
  )
}

/** Para buscar sin que importen las tildes ni las mayusculas ("cafe" encuentra "Café"). */
export function llano(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

// ── CampoNumero ─────────────────────────────────────────────────────────────

/**
 * Un campo para cifras: teclado numerico, coma o punto, y la unidad o la
 * moneda pegada ("$", "kg"). El valor viaja como texto (lo que se ve); se
 * pasa a numero con `aNumero` de lib/numeros.
 */
export function CampoNumero({
  rotulo,
  valor,
  alCambiar,
  prefijo,
  sufijo,
  ayuda,
  error,
  placeholder = '0',
  autoFocus = false,
  entero = false,
  style,
  ...resto
}: {
  rotulo?: string
  valor: string
  alCambiar: (texto: string) => void
  prefijo?: string
  sufijo?: string
  ayuda?: string
  error?: string
  placeholder?: string
  autoFocus?: boolean
  /** Solo numeros enteros (unidades, cantidades de empaques). */
  entero?: boolean
  style?: StyleProp<ViewStyle>
} & Omit<TextInputProps, 'value' | 'onChangeText' | 'style'>) {
  const t = useTema()
  return (
    <View style={[{ gap: 6 }, style]}>
      {rotulo ? <Text style={[k.rotulo, { color: t.suave }]}>{rotulo}</Text> : null}
      <View
        style={[
          k.campoNumero,
          { backgroundColor: t.superficie, borderColor: error ? t.peligro : t.gris200 },
          resto.editable === false && { opacity: 0.6 },
        ]}
      >
        {prefijo ? <Text style={[k.afijo, { color: t.tenue }]}>{prefijo}</Text> : null}
        <TextInput
          value={valor}
          onChangeText={(v) => alCambiar(entero ? v.replace(/[^\d]/g, '') : v.replace(/[^\d.,-]/g, ''))}
          keyboardType={entero ? 'number-pad' : 'decimal-pad'}
          placeholder={placeholder}
          placeholderTextColor={t.tenue}
          autoFocus={autoFocus}
          selectTextOnFocus
          {...resto}
          style={[k.campoNumeroTexto, { color: t.tinta }]}
        />
        {sufijo ? <Text style={[k.afijo, { color: t.tenue }]}>{sufijo}</Text> : null}
      </View>
      {error ? (
        <Text style={[k.nota, { color: t.peligro }]}>{error}</Text>
      ) : ayuda ? (
        <Text style={[k.nota, { color: t.tenue }]}>{ayuda}</Text>
      ) : null}
    </View>
  )
}

// ── Contador (− 1 +) ────────────────────────────────────────────────────────

/** Sumar y restar de a uno, con botones de 44 px: la cantidad de un renglon del carrito. */
export function Contador({
  valor,
  alCambiar,
  minimo = 0,
  maximo,
}: {
  valor: number
  alCambiar: (n: number) => void
  minimo?: number
  maximo?: number
}) {
  const t = useTema()
  const boton = (signo: '−' | '+', delta: number, deshabilitado: boolean) => (
    <Pressable
      onPress={() => alCambiar(valor + delta)}
      disabled={deshabilitado}
      hitSlop={4}
      accessibilityLabel={delta > 0 ? 'Uno más' : 'Uno menos'}
      style={({ pressed }) => [
        k.contadorBoton,
        { backgroundColor: pressed ? t.gris200 : t.gris100, opacity: deshabilitado ? 0.4 : 1 },
      ]}
    >
      <Text style={[k.contadorSigno, { color: t.tinta }]}>{signo}</Text>
    </Pressable>
  )
  return (
    <View style={k.contador}>
      {boton('−', -1, valor <= minimo)}
      <Text style={[k.contadorValor, { color: t.tinta }]}>{valor}</Text>
      {boton('+', 1, maximo !== undefined && valor >= maximo)}
    </View>
  )
}

// ── Renglon ─────────────────────────────────────────────────────────────────

/**
 * Una fila tocable de una lista (lo que en la web es la fila de una Tabla):
 * a la izquierda un punto de color o un icono, el titulo y su detalle; a la
 * derecha la cifra y su nota. Va dentro de una `ListaFicha`.
 */
export function Renglon({
  titulo,
  detalle,
  valor,
  subvalor,
  colorValor,
  punto,
  icono,
  derecha,
  alTocar,
  ultima = false,
  apagado = false,
}: {
  titulo: string
  detalle?: ReactNode
  valor?: string
  subvalor?: ReactNode
  colorValor?: string
  /** Un punto de color: el tipo de mercancia, el estado. */
  punto?: string
  icono?: NombreIcono
  /** Algo propio a la derecha (una pastilla, un contador) en vez de la cifra. */
  derecha?: ReactNode
  alTocar?: () => void
  ultima?: boolean
  /** Archivado, retirado: se ve, pero en gris. */
  apagado?: boolean
}) {
  const t = useTema()
  const contenido = (
    <View
      style={[
        k.renglon,
        !ultima && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 },
        apagado && { opacity: 0.55 },
      ]}
    >
      {punto ? <View style={[k.punto, { backgroundColor: punto }]} /> : null}
      {icono ? <Icono nombre={icono} size={19} color={t.tenue} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[k.renglonTitulo, { color: t.tinta }]} numberOfLines={2}>
          {titulo}
        </Text>
        {detalle ? (
          typeof detalle === 'string' ? (
            <Text style={[k.renglonDetalle, { color: t.suave }]} numberOfLines={2}>
              {detalle}
            </Text>
          ) : (
            detalle
          )
        ) : null}
      </View>
      {derecha ??
        (valor !== undefined ? (
          <View style={{ alignItems: 'flex-end', maxWidth: '45%' }}>
            <Text style={[k.renglonValor, { color: colorValor ?? t.tinta }]} numberOfLines={1}>
              {valor}
            </Text>
            {subvalor ? (
              typeof subvalor === 'string' ? (
                <Text style={[k.renglonDetalle, { color: t.tenue }]} numberOfLines={1}>
                  {subvalor}
                </Text>
              ) : (
                subvalor
              )
            ) : null}
          </View>
        ) : null)}
      {alTocar ? <Icono nombre="chevron" size={15} color={t.tenue} grosor={2.2} /> : null}
    </View>
  )
  if (!alTocar) return contenido
  return (
    <Pressable
      onPress={alTocar}
      accessibilityRole="button"
      accessibilityLabel={titulo}
      style={({ pressed }) => ({ backgroundColor: pressed ? t.gris100 : 'transparent' })}
    >
      {contenido}
    </Pressable>
  )
}

/** La losa de una lista de renglones: sin relleno a los lados, los renglones lo traen. */
export function ListaFicha({ children, titulo, accion }: { children: ReactNode; titulo?: string; accion?: ReactNode }) {
  const t = useTema()
  return (
    <Ficha style={{ paddingHorizontal: 0, paddingVertical: titulo ? 14 : 4 }}>
      {titulo || accion ? (
        <View style={k.listaCabeza}>
          {titulo ? <Text style={[k.listaTitulo, { color: t.tinta }]}>{titulo}</Text> : <View />}
          {accion}
        </View>
      ) : null}
      {children}
    </Ficha>
  )
}

// ── Kpi ─────────────────────────────────────────────────────────────────────

/** Una cifra con su rotulo y su lectura, como los `Kpi` de la web. */
export function Kpi({
  etiqueta,
  cifra,
  nota,
  color,
  tono,
  style,
}: {
  etiqueta: string
  cifra: string
  nota?: ReactNode
  color?: string
  tono?: 'aviso' | 'acento'
  style?: StyleProp<ViewStyle>
}) {
  const t = useTema()
  return (
    <Ficha tono={tono} style={[{ padding: 16, flex: 1, minWidth: 140 }, style]}>
      <Text style={[k.kpiEtiqueta, { color: t.tenue }]} numberOfLines={1}>
        {etiqueta}
      </Text>
      <Text style={[k.kpiCifra, { color: color ?? t.tinta }]} numberOfLines={1} adjustsFontSizeToFit>
        {cifra}
      </Text>
      {nota ? (
        typeof nota === 'string' ? (
          <Text style={[k.nota, { color: t.suave }]} numberOfLines={2}>
            {nota}
          </Text>
        ) : (
          nota
        )
      ) : null}
    </Ficha>
  )
}

// ── Selector (uno o varios) ─────────────────────────────────────────────────

export type OpcionSelector<T extends string = string> = {
  valor: T
  texto: string
  detalle?: string
  contador?: number | null
}

/**
 * ELEGIR DE UNA LISTA: lo que en la web es `FiltroDesplegable` o un
 * `<select>`. Se abre una hoja desde abajo; con mas de 8 opciones trae
 * buscador. Con `varios`, se marcan varias (la primera opcion, la neutra
 * "Todas", las quita) y la hoja no se cierra hasta "Listo".
 *
 * Dos formas: `pastilla` para filtros (fila de pastillas arriba de una lista)
 * y `campo` para formularios (con su rotulo, como un campo de texto).
 */
export function Selector<T extends string>({
  etiqueta,
  opciones,
  valor,
  alCambiar,
  varios = false,
  valores = [],
  alCambiarVarios,
  plural,
  forma = 'pastilla',
  placeholder = 'Elegir',
  titulo,
  error,
  deshabilitado = false,
}: {
  etiqueta: string
  opciones: OpcionSelector<T>[]
  valor?: T
  alCambiar?: (v: T) => void
  varios?: boolean
  valores?: T[]
  alCambiarVarios?: (v: T[]) => void
  /** "categorías": lo que dice la pastilla con varias marcadas ("3 categorías"). */
  plural?: string
  forma?: 'pastilla' | 'campo'
  placeholder?: string
  titulo?: string
  error?: string
  deshabilitado?: boolean
}) {
  const t = useTema()
  const { alto } = useDisposicion()
  const [abierto, setAbierto] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const buscable = opciones.length > 8
  const q = llano(busqueda.trim())
  const visibles = useMemo(
    () => (q ? opciones.filter((o, i) => (varios && i === 0) || llano(`${o.texto} ${o.detalle ?? ''}`).includes(q)) : opciones),
    [opciones, q, varios],
  )
  const elegida = varios ? (valores.length === 1 ? opciones.find((o) => o.valor === valores[0]) : undefined) : opciones.find((o) => o.valor === valor)
  const sinFiltrar = varios ? valores.length === 0 : !elegida || (forma === 'pastilla' && opciones[0]?.valor === valor)
  const texto = varios && valores.length > 1 ? `${valores.length} ${plural ?? etiqueta.toLowerCase()}` : elegida?.texto ?? ''

  const cerrar = () => {
    setAbierto(false)
    setBusqueda('')
  }
  const tocar = (o: OpcionSelector<T>, i: number) => {
    if (!varios) {
      alCambiar?.(o.valor)
      cerrar()
      return
    }
    if (i === 0) alCambiarVarios?.([])
    else alCambiarVarios?.(valores.includes(o.valor) ? valores.filter((v) => v !== o.valor) : [...valores, o.valor])
  }

  const disparador =
    forma === 'pastilla' ? (
      <Pressable
        onPress={() => setAbierto(true)}
        disabled={deshabilitado}
        accessibilityLabel={texto ? `${etiqueta}: ${texto}` : etiqueta}
        style={({ pressed }) => [
          k.pastillaFiltro,
          { backgroundColor: t.superficie, borderColor: t.gris200, transform: [{ scale: pressed ? 0.97 : 1 }] },
        ]}
      >
        <Text style={[k.pastillaFiltroEtiqueta, { color: t.tenue }]}>{etiqueta}</Text>
        {!sinFiltrar ? <View style={[k.puntoFiltro, { backgroundColor: t.acento }]} /> : null}
        {!sinFiltrar && texto ? (
          <Text style={[k.pastillaFiltroValor, { color: t.tinta }]} numberOfLines={1}>
            {texto}
          </Text>
        ) : null}
        <Icono nombre="chevron" size={12} color={t.tenue} grosor={2.4} />
      </Pressable>
    ) : (
      <View style={{ gap: 6 }}>
        <Text style={[k.rotulo, { color: t.suave }]}>{etiqueta}</Text>
        <Pressable
          onPress={() => setAbierto(true)}
          disabled={deshabilitado}
          accessibilityLabel={etiqueta}
          style={({ pressed }) => [
            k.campoSelector,
            {
              backgroundColor: t.superficie,
              borderColor: error ? t.peligro : t.gris200,
              opacity: deshabilitado ? 0.6 : pressed ? 0.85 : 1,
            },
          ]}
        >
          <Text style={[k.campoSelectorTexto, { color: texto ? t.tinta : t.tenue }]} numberOfLines={1}>
            {texto || placeholder}
          </Text>
          <View style={{ transform: [{ rotate: '90deg' }] }}>
            <Icono nombre="chevron" size={14} color={t.tenue} grosor={2.4} />
          </View>
        </Pressable>
        {error ? <Text style={[k.nota, { color: t.peligro }]}>{error}</Text> : null}
      </View>
    )

  return (
    <>
      {disparador}
      <Hoja visible={abierto} alCerrar={cerrar} titulo={titulo ?? etiqueta}>
        {buscable ? (
          <View style={{ paddingHorizontal: 4, paddingBottom: 8 }}>
            <Buscador valor={busqueda} alCambiar={setBusqueda} placeholder={`Buscar ${etiqueta.toLowerCase()}`} />
          </View>
        ) : null}
        <ScrollView style={{ maxHeight: alto * 0.58 }} keyboardShouldPersistTaps="handled">
          {visibles.map((o) => {
            const i = opciones.indexOf(o)
            const marcada = varios ? (i === 0 ? valores.length === 0 : valores.includes(o.valor)) : o.valor === valor
            const con = o.contador != null && o.contador > 0 ? ` · ${o.contador}` : ''
            return <OpcionHoja key={`${o.valor}-${i}`} texto={`${o.texto}${con}`} detalle={o.detalle} marcada={marcada} alTocar={() => tocar(o, i)} />
          })}
          {visibles.length === 0 ? <Text style={[k.nota, { color: t.tenue, padding: 12 }]}>Nada coincide.</Text> : null}
        </ScrollView>
        {varios ? (
          <View style={{ paddingTop: 10, paddingHorizontal: 4 }}>
            <Boton texto="Listo" alTocar={cerrar} />
          </View>
        ) : null}
      </Hoja>
    </>
  )
}

/** Una fila de filtros (pastillas) que se desliza de lado. */
export function FilaFiltros({ children }: { children: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
      {children}
    </ScrollView>
  )
}

// ── Periodo ─────────────────────────────────────────────────────────────────

/** El periodo de un reporte o una lista: Hoy, Ayer, 7 días, Este mes... */
export function ElegirPeriodo({
  periodo,
  alCambiar,
  opciones = PERIODOS.map((p) => p.id),
}: {
  periodo: Periodo
  alCambiar: (p: Periodo) => void
  opciones?: IdPeriodo[]
}) {
  return (
    <Selector<IdPeriodo>
      etiqueta="Periodo"
      titulo="Ver el periodo"
      forma="pastilla"
      opciones={PERIODOS.filter((p) => opciones.includes(p.id)).map((p) => {
        const r = periodoDe(p.id)
        return { valor: p.id, texto: p.texto, detalle: r.desde === r.hasta ? r.desde : `${r.desde} → ${r.hasta}` }
      })}
      valor={periodo.id}
      alCambiar={(id) => alCambiar(periodoDe(id))}
    />
  )
}

// ── Barra de abajo ──────────────────────────────────────────────────────────

/**
 * Lo que queda fijo abajo: el total a la izquierda y la accion principal
 * ("Cobrar", "Guardar factura"). Va en el `abajo` de `Pantalla`.
 */
export function BarraAccion({
  izquierda,
  texto,
  alTocar,
  ocupado = false,
  deshabilitado = false,
  aviso,
}: {
  izquierda?: ReactNode
  texto: string
  alTocar: () => void
  ocupado?: boolean
  deshabilitado?: boolean
  /** Lo que falta, en una linea ("Falta la referencia"): ambar sobre el boton. */
  aviso?: string
}) {
  const t = useTema()
  const { modo } = useModo()
  return (
    <View
      style={[
        k.barra,
        { backgroundColor: t.superficie, borderTopColor: modo === 'oscuro' ? 'rgba(255,255,255,0.06)' : t.gris200 },
      ]}
    >
      {aviso ? <Text style={[k.nota, { color: t.aviso, marginBottom: 8 }]}>{aviso}</Text> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {izquierda ? <View style={{ flex: 1, minWidth: 0 }}>{izquierda}</View> : null}
        <View style={izquierda ? { minWidth: 150 } : { flex: 1 }}>
          <Boton texto={texto} alTocar={alTocar} ocupado={ocupado} deshabilitado={deshabilitado} />
        </View>
      </View>
    </View>
  )
}

// ── HojaFormulario ──────────────────────────────────────────────────────────

/**
 * Un formulario que sube desde abajo y ocupa casi toda la pantalla (lo que en
 * la web es un `Modal` con su pie de botones): "Nueva mercancía", "Cobrar",
 * "Registrar gasto".
 *
 * En el telefono es la hoja nativa de @expo/ui a toda altura. El contenido
 * (React Native) va en un `RNHostView` sin `matchContents`: toma el tamaño
 * que le da la hoja, y cuando sale el teclado es la propia hoja la que se
 * encoge (SwiftUI lo hace solo; en Android se lo pedimos con `imePadding`),
 * asi que el pie con "Guardar" queda siempre a la vista sin un
 * `KeyboardAvoidingView` que, dentro de una hoja presentada aparte, no sabe
 * medir donde esta. En la web sigue el Modal de siempre.
 */
type PropsHojaFormulario = {
  visible: boolean
  alCerrar: () => void
  titulo: string
  subtitulo?: string
  children: ReactNode
  /** Los botones de abajo (Cancelar / Guardar). */
  pie?: ReactNode
}

export function HojaFormulario(props: PropsHojaFormulario) {
  // La hoja propia (pageSheet) en todas partes. La de SwiftUI no quedo bien
  // en el iPhone, y la de Compose en Android no deja desplazar el formulario
  // largo (Abrir caja no llegaba al boton, 23-oct). La nativa queda para
  // cuando se pruebe bien en los dos.
  return <HojaFormularioWeb {...props} />
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- se vuelve a usar cuando la hoja nativa este probada en los dos sistemas
function HojaFormularioNativa({ visible, alCerrar, titulo, subtitulo, children, pie }: PropsHojaFormulario) {
  const t = useTema()
  return (
    <BottomSheet
      isPresented={visible}
      onDismiss={alCerrar}
      snapPoints={['full']}
      contentPadding={0}
      containerColor={t.papel}
      // Solo Android: la hoja de Material no se aparta del teclado si no se lo piden.
      modifiers={process.env.EXPO_OS === 'android' ? [imePadding()] : undefined}
    >
      <RNHostView>
        <View style={{ flex: 1 }}>
          {/* En iOS el agarre flota sobre el contenido; en Android tiene su propio renglon. */}
          <CabezaFormulario titulo={titulo} subtitulo={subtitulo} alCerrar={alCerrar} arriba={process.env.EXPO_OS === 'ios' ? 22 : 4} />
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {pie ? <View style={[k.hojaPie, { paddingBottom: 12, borderTopColor: t.gris200, backgroundColor: t.superficie }]}>{pie}</View> : null}
        </View>
      </RNHostView>
    </BottomSheet>
  )
}

function HojaFormularioWeb({ visible, alCerrar, titulo, subtitulo, children, pie }: PropsHojaFormulario) {
  const t = useTema()
  const borde = useSafeAreaInsets()
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={alCerrar} presentationStyle="pageSheet" statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: t.papel }}>
        {/* Sin `behavior` iOS no hace nada: el teclado tapaba el campo del
            nombre y el boton de enviar (Leider, 23-oct). `padding` encoge la
            hoja y el pie queda justo encima del teclado. */}
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}>
          <CabezaFormulario titulo={titulo} subtitulo={subtitulo} alCerrar={alCerrar} arriba={18} />
          <ScrollView contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {pie ? (
            <View style={[k.hojaPie, { paddingBottom: 12 + borde.bottom, borderTopColor: t.gris200, backgroundColor: t.superficie }]}>{pie}</View>
          ) : null}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

/** El titulo del formulario y la "X" para cerrarlo. */
function CabezaFormulario({ titulo, subtitulo, alCerrar, arriba }: { titulo: string; subtitulo?: string; alCerrar: () => void; arriba: number }) {
  const t = useTema()
  return (
    <View style={[k.hojaCabeza, { paddingTop: arriba, borderBottomColor: t.gris200 }]}>
      <View style={{ flex: 1 }}>
        <Text style={[k.hojaTitulo, { color: t.tinta }]} numberOfLines={2}>
          {titulo}
        </Text>
        {subtitulo ? <Text style={[k.nota, { color: t.suave, marginTop: 2 }]}>{subtitulo}</Text> : null}
      </View>
      <Pressable
        onPress={alCerrar}
        hitSlop={10}
        accessibilityLabel="Cerrar"
        style={({ pressed }) => [k.cerrar, { backgroundColor: pressed ? t.gris200 : t.gris100 }]}
      >
        <Icono nombre="quitar" size={16} color={t.suave} />
      </Pressable>
    </View>
  )
}

// ── PantallaLista ───────────────────────────────────────────────────────────

/**
 * Una pantalla cuya parte principal es una lista larga (las ventas del mes,
 * las mercancías): la misma `Pantalla` de siempre, pero con FlatList, que
 * solo dibuja lo que se ve. Lo de arriba de la lista va en `cabecera`.
 *
 * La lista es lo primero de la pantalla y ajusta sola su borde de arriba
 * (`contentInsetAdjustmentBehavior`): asi el encabezado nativo del Stack
 * sabe que desplazarla encoge el titulo grande de iOS, y tocar la hora
 * vuelve al principio. El borde de abajo (la barra del telefono) sigue
 * siendo nuestro.
 */
export function PantallaLista<T>({
  datos,
  renglon,
  clave,
  arriba,
  cabecera,
  vacio,
  abajo,
  refrescando = false,
  alRefrescar,
  alFinal,
}: {
  datos: readonly T[]
  renglon: ListRenderItem<T>
  clave: (item: T, i: number) => string
  /** Lo que va fijo arriba, fuera del desplazamiento: las pestañas del modulo. */
  arriba?: ReactNode
  cabecera?: ReactElement
  vacio?: ReactElement
  abajo?: ReactNode
  refrescando?: boolean
  alRefrescar?: () => void
  /** Pedir mas al llegar al final (paginas). */
  alFinal?: () => void
}) {
  const t = useTema()
  const borde = useSafeAreaInsets()
  return (
    <View style={{ flex: 1, backgroundColor: t.papel }}>
      <Fondo />
      {arriba ? <View style={{ paddingHorizontal: 16 }}>{arriba}</View> : null}
      <FlatList
        data={datos}
        renderItem={renglon}
        keyExtractor={clave}
        ListHeaderComponent={cabecera}
        ListHeaderComponentStyle={{ gap: 12, marginBottom: 12 }}
        ListEmptyComponent={vacio}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: abajo ? 24 : 48 + borde.bottom }}
        keyboardShouldPersistTaps="handled"
        onEndReached={alFinal}
        onEndReachedThreshold={0.4}
        refreshControl={
          alRefrescar ? (
            <RefreshControl refreshing={refrescando} onRefresh={alRefrescar} tintColor={t.acento} colors={[t.acento]} />
          ) : undefined
        }
      />
      {/* El mismo fondo que la barra: si no, bajo ella asoma el papel y la barra parece cortada. */}
      {abajo ? <View style={{ paddingBottom: borde.bottom, backgroundColor: t.superficie }}>{abajo}</View> : null}
    </View>
  )
}

const k = StyleSheet.create({
  pastilla: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  pastillaTexto: { fontFamily: LETRA.textoFuerte, fontSize: 12.5 },
  vacioIcono: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  vacioTitulo: { fontFamily: LETRA.titulo, fontSize: 17, textAlign: 'center' },
  vacioDetalle: { fontFamily: LETRA.texto, fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 320 },
  // Las esquinas "continuas" son las de iOS (la curva de los iconos); en los demas no cambian nada.
  buscador: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    borderCurve: 'continuous',
    paddingHorizontal: 14,
    minHeight: 46,
  },
  buscadorTexto: { flex: 1, fontFamily: LETRA.texto, fontSize: 16, paddingVertical: 10 },
  rotulo: { fontFamily: LETRA.textoFuerte, fontSize: 13 },
  nota: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
  campoNumero: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    borderCurve: 'continuous',
    paddingHorizontal: 15,
    minHeight: 50,
    gap: 8,
  },
  campoNumeroTexto: { flex: 1, fontFamily: LETRA.cifra, fontSize: 17, paddingVertical: 11 },
  afijo: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  contador: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  contadorBoton: { width: 40, height: 40, borderRadius: 12, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center' },
  contadorSigno: { fontFamily: LETRA.textoFuerte, fontSize: 20, lineHeight: 22 },
  contadorValor: { fontFamily: LETRA.cifraFuerte, fontSize: 16, minWidth: 28, textAlign: 'center' },
  renglon: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13, minHeight: 56 },
  punto: { width: 9, height: 9, borderRadius: 5 },
  renglonTitulo: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  renglonDetalle: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 2 },
  renglonValor: { fontFamily: LETRA.cifra, fontSize: 15 },
  listaCabeza: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 6 },
  listaTitulo: { fontFamily: LETRA.titulo, fontSize: 17, letterSpacing: -0.2 },
  kpiEtiqueta: { fontFamily: LETRA.textoFuerte, fontSize: 12.5 },
  kpiCifra: { fontFamily: LETRA.tituloFuerte, fontSize: 26, letterSpacing: -0.6, marginTop: 4 },
  pastillaFiltro: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    paddingHorizontal: 13,
    maxWidth: 260,
  },
  pastillaFiltroEtiqueta: { fontFamily: LETRA.texto, fontSize: 14 },
  pastillaFiltroValor: { fontFamily: LETRA.textoFuerte, fontSize: 14, flexShrink: 1 },
  puntoFiltro: { width: 6, height: 6, borderRadius: 3 },
  campoSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    borderCurve: 'continuous',
    paddingHorizontal: 15,
    minHeight: 50,
  },
  campoSelectorTexto: { flex: 1, fontFamily: LETRA.texto, fontSize: 16 },
  barra: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  hojaCabeza: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 18,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  hojaTitulo: { fontFamily: LETRA.tituloFuerte, fontSize: 20, letterSpacing: -0.4 },
  cerrar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  hojaPie: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
})
