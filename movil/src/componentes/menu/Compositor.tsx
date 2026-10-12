import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { unidadDe } from '../../../../frontend/src/lib/inventario'
import { vaEnReceta } from '../../../../frontend/src/lib/tiposArticulo'
import { dolares } from '../../lib/formato'
import { useMoneda } from '../../lib/moneda'
import { aNumero, sinRuido } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import type { Ingrediente } from '../../lib/tipos'
import Icono from '../Icono'
import { Buscador, CampoNumero, Selector, useDisposicion } from '../kit'
import { Ficha, Nota, Titulo } from '../ui'
import { CasillaConUnidad } from './Cantidad'
import { COLOR_ACEITE, franja } from './colores'
import { contiene, palabrasDe, type RenglonReceta } from './datos'
import { BotonTexto } from './piezas'
import Vaso, { ResumenVaso, type ParteVaso } from './Vaso'

/*
 * EL COMPOSITOR DE UNA RECETA (`Compositor` de pages/partes/Recetas.tsx): el
 * vaso que se llena con lo que lleva el producto, el precio y el margen como
 * una cuenta, y la mercancia para tocar lo que lleva. En el telefono va todo
 * en una columna, el vaso primero; en la tablet, el vaso a un lado y la
 * mercancia al otro, como la web.
 */

/** Un renglon de la receta mientras se arma. La cantidad SIEMPRE en la unidad de la mercancia. */
export type Fila = {
  ingrediente_id: number
  /** En la unidad de la mercancia, con punto ("0.05"): es lo que se guarda. */
  cantidad_por_unidad: string
  /** Se escribe en la unidad chica (g en vez de kg, ml en vez de lt). Solo como se ve. */
  enChica?: boolean
  /** Lo que se escribio tal cual ("0,5"): asi la coma no salta mientras se escribe. */
  vista?: string
}

/** Un producto del menu dentro de un combo, con cuantos lleva (como texto). */
export type FilaCombo = { variante_id: number; cantidad: string }

/** La unidad chica de una grande, y al reves: kg⇄g, lt⇄ml. */
const OTRA_UNIDAD: Record<string, string> = { kg: 'g', g: 'kg', lt: 'ml', ml: 'lt' }
export const esGrande = (u: string) => u === 'kg' || u === 'lt'

/** Lo que se cuenta y no se pesa: el vaso, la tapa, la caja. Tambien es costo, en su apartado. */
export const porUnidad = (ing: Ingrediente) => ing.unidad === 'unidad' || ing.unidad === 'paquete'

/** Solo lo que se guarda: mercancia y cantidad. Cambiar de kg a g no es un cambio de receta. */
export function huella(fs: Fila[]): string {
  return fs
    .filter((f) => f.ingrediente_id)
    .map((f) => `${f.ingrediente_id}:${Number(f.cantidad_por_unidad) || 0}`)
    .sort()
    .join('|')
}

export function huellaDeCombo(c: FilaCombo[] | null): string {
  return c === null ? '' : c.map((x) => `${x.variante_id}:${aNumero(x.cantidad) || 0}`).sort().join('|') || 'combo'
}

/**
 * Lo que va en el vaso y cuanto cuesta hacer uno: cada mercancia a su costo
 * real (descontada la merma de cocina), el aceite si se frie, o, si es
 * combo, lo que cuestan sus productos.
 */
export function armarVaso({
  filas,
  mapa,
  combo,
  productos,
  costoDeVariante,
  indirecto,
}: {
  filas: Fila[]
  mapa: Map<number, Ingrediente>
  combo: FilaCombo[] | null
  productos: RenglonReceta[]
  costoDeVariante: (id: number) => number
  indirecto: number
}) {
  const partes: ParteVaso[] = []
  const colorDe = new Map<number, string>()
  let costo = 0
  if (combo !== null) {
    combo.forEach((c, i) => {
      const valor = (aNumero(c.cantidad) || 0) * costoDeVariante(c.variante_id)
      costo += valor
      const nombre = productos.find((p) => p.variante.id === c.variante_id)?.nombre ?? 'Producto'
      if (valor > 0) partes.push({ id: `combo-${c.variante_id}`, nombre, valor, ...franja(i) })
    })
    return { partes, costo, colorDe }
  }
  filas.forEach((f, i) => {
    const ing = mapa.get(f.ingrediente_id)
    if (!ing) return
    colorDe.set(ing.id, franja(i).color)
    const valor = (Number(f.cantidad_por_unidad) || 0) * ing.costo_efectivo
    costo += valor
    if (valor > 0) partes.push({ id: ing.id, nombre: ing.nombre, valor, ...franja(i) })
  })
  if (indirecto > 0) {
    costo += indirecto
    partes.push({ id: 'aceite', nombre: 'Aceite de freír', valor: indirecto, color: COLOR_ACEITE, clara: true })
  }
  return { partes, costo, colorDe }
}

export default function Compositor({
  renglon,
  ingredientes,
  mapa,
  filas,
  setFilas,
  precio,
  setPrecio,
  combo,
  setCombo,
  productos,
  costoDeVariante,
  vaso,
  precioGuardado,
}: {
  renglon: RenglonReceta
  ingredientes: Ingrediente[]
  mapa: Map<number, Ingrediente>
  filas: Fila[]
  setFilas: Dispatch<SetStateAction<Fila[]>>
  /** El precio que se esta decidiendo, como texto. */
  precio: string
  setPrecio: (p: string) => void
  combo: FilaCombo[] | null
  setCombo: (c: FilaCombo[] | null) => void
  /** Los productos del menu que pueden ir en un combo. */
  productos: RenglonReceta[]
  costoDeVariante: (varianteId: number) => number
  /** Lo que va en el vaso y cuanto cuesta (con el aceite si se frie): lo arma quien llama. */
  vaso: ReturnType<typeof armarVaso>
  /** A cuanto se vende hoy (lo ultimo guardado). */
  precioGuardado: number
}) {
  const { fmt } = useMoneda()
  const { tablet } = useDisposicion()
  const [resaltado, setResaltado] = useState<number | string | null>(null)
  const precioNum = aNumero(precio) || 0

  function actualizar(id: number, cambios: Partial<Fila>) {
    setFilas((prev) => prev.map((f) => (f.ingrediente_id === id ? { ...f, ...cambios } : f)))
  }

  function agregar(ing: Ingrediente) {
    setFilas((prev) => [
      ...prev,
      {
        ingrediente_id: ing.id,
        // Un vaso es un vaso: lo que se cuenta por unidades entra con 1.
        cantidad_por_unidad: porUnidad(ing) ? '1' : '',
        // Gramos y mililitros por defecto (Leider, 1-oct).
        enChica: esGrande(ing.unidad),
      },
    ])
  }

  const vacio = combo === null ? filas.length === 0 : combo.length === 0

  const producto = (
    <Ficha style={{ gap: 14 }}>
      <View>
        <Nota>{renglon.categoria}</Nota>
        <NombreProducto texto={renglon.nombre} />
      </View>
      <Vaso
        tope={precioNum}
        topeTitulo="se vende a"
        partes={vaso.partes}
        restoNombre="margen"
        desbordeTexto="hasta aquí llega el precio"
        vacioTexto={tablet ? 'Toca a la derecha lo que lleva' : 'Toca abajo lo que lleva'}
        formato={fmt}
        resaltado={resaltado}
        alResaltar={setResaltado}
        anchoMaximo={tablet ? 300 : 250}
      />
      <Margen precio={precioNum} costo={vaso.costo} vacio={vacio} />
      <PrecioConMargen costo={vaso.costo} precio={precio} alPrecio={setPrecio} guardado={precioGuardado} />
    </Ficha>
  )

  const derecha =
    combo !== null ? (
      <EditorCombo combo={combo} setCombo={setCombo} productos={productos} costoDeVariante={costoDeVariante} />
    ) : (
      <Mercancia
        ingredientes={ingredientes}
        mapa={mapa}
        filas={filas}
        colorDe={vaso.colorDe}
        resaltado={resaltado}
        alResaltar={setResaltado}
        alCambiar={actualizar}
        alQuitar={(id) => setFilas((prev) => prev.filter((f) => f.ingrediente_id !== id))}
        alAgregar={agregar}
        alCombo={() => setCombo([])}
      />
    )

  if (tablet) {
    return (
      <View style={estilos.columnas}>
        <View style={{ flex: 5 }}>{producto}</View>
        <View style={{ flex: 7, gap: 12 }}>{derecha}</View>
      </View>
    )
  }
  return (
    <>
      {producto}
      {derecha}
    </>
  )
}

function NombreProducto({ texto }: { texto: string }) {
  const t = useTema()
  return <Text style={[estilos.nombre, { color: t.tinta }]}>{texto}</Text>
}

// ── La mercancia: lo que lleva y lo que se puede agregar ────────────────────

function Mercancia({
  ingredientes,
  mapa,
  filas,
  colorDe,
  resaltado,
  alResaltar,
  alCambiar,
  alQuitar,
  alAgregar,
  alCombo,
}: {
  ingredientes: Ingrediente[]
  mapa: Map<number, Ingrediente>
  filas: Fila[]
  colorDe: Map<number, string>
  resaltado: number | string | null
  alResaltar: (id: number | string | null) => void
  alCambiar: (id: number, cambios: Partial<Fila>) => void
  alQuitar: (id: number) => void
  alAgregar: (ing: Ingrediente) => void
  alCombo: () => void
}) {
  const t = useTema()
  const [busqueda, setBusqueda] = useState('')
  const [categoria, setCategoria] = useState('')

  const categorias = useMemo(() => {
    const cuenta = new Map<string, number>()
    for (const i of ingredientes) cuenta.set(i.categoria || '', (cuenta.get(i.categoria || '') ?? 0) + 1)
    return [...cuenta.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([nombre, n]) => ({ valor: nombre || '__sin__', texto: nombre || 'Sin categoría', contador: n }))
  }, [ingredientes])

  const enReceta = new Set(filas.map((f) => f.ingrediente_id))
  const palabras = palabrasDe(busqueda)
  const disponibles = ingredientes.filter((i) => {
    if (enReceta.has(i.id)) return false
    // Ni desechables (van a gasto) ni el aceite de freir (se reparte por
    // pieza). Las preparaciones si: el pastelito lleva "50 g de guiso".
    if (!vaEnReceta(i)) return false
    if (categoria && (i.categoria || '__sin__') !== categoria) return false
    return palabras.length === 0 || contiene(`${i.nombre} ${i.categoria}`, palabras)
  })

  const esPieza = (f: Fila) => {
    const ing = mapa.get(f.ingrediente_id)
    return Boolean(ing && porUnidad(ing))
  }
  const pesadas = filas.filter((f) => mapa.has(f.ingrediente_id) && !esPieza(f))
  const piezas = filas.filter(esPieza)
  const disponiblesPesadas = disponibles.filter((i) => !porUnidad(i))
  const disponiblesPiezas = disponibles.filter(porUnidad)

  const renglon = (f: Fila) => (
    <RenglonMercancia
      key={f.ingrediente_id}
      f={f}
      ing={mapa.get(f.ingrediente_id)!}
      color={colorDe.get(f.ingrediente_id) ?? t.tenue}
      resaltado={resaltado === f.ingrediente_id}
      alResaltar={() => alResaltar(resaltado === f.ingrediente_id ? null : f.ingrediente_id)}
      alCambiar={(c) => alCambiar(f.ingrediente_id, c)}
      alQuitar={() => alQuitar(f.ingrediente_id)}
    />
  )

  return (
    <>
      {filas.length === 0 ? (
        <Pressable onPress={alCombo} accessibilityRole="button" style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.985 : 1 }] }]}>
          <Ficha style={{ paddingVertical: 14 }}>
            <Text style={[estilos.texto, { color: t.suave }]}>
              <Text style={{ fontFamily: LETRA.textoFuerte, color: t.tinta }}>¿Es un combo?</Text> Ármalo con productos del menú
              (pastelito + jugo): su receta se suma sola y se actualiza si cambia la de ellos.
            </Text>
          </Ficha>
        </Pressable>
      ) : (
        <Ficha style={{ paddingHorizontal: 0, paddingVertical: 6 }}>
          {pesadas.length > 0 ? (
            <>
              <Titulo style={estilos.apartado}>Lleva</Titulo>
              {pesadas.map(renglon)}
            </>
          ) : null}
          {/* Lo que se cuenta por unidades va aparte: el vaso, la tapa, la
              caja. No se pesa, y es tan costo como la carne (Leider, 29-sep). */}
          {piezas.length > 0 ? (
            <>
              <Text
                style={[
                  estilos.apartado,
                  estilos.apartadoTexto,
                  { color: t.tinta },
                  pesadas.length > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.gris200, paddingTop: 12 },
                ]}
              >
                Por unidad <Text style={[estilos.nota, { color: t.suave }]}>· vaso, tapa, empaque</Text>
              </Text>
              {piezas.map(renglon)}
            </>
          ) : null}
        </Ficha>
      )}

      <Ficha style={{ paddingHorizontal: 0, paddingVertical: 10 }}>
        <View style={estilos.agregarCabeza}>
          <Titulo>{filas.length === 0 ? 'Toca lo que lleva' : 'Agregar'}</Titulo>
          <Buscador valor={busqueda} alCambiar={setBusqueda} placeholder="Buscar mercancía" />
          {categorias.length > 1 ? (
            <View style={{ flexDirection: 'row' }}>
              <Selector<string>
                etiqueta="Categoría"
                opciones={[{ valor: '', texto: 'Todas' }, ...categorias]}
                valor={categoria}
                alCambiar={setCategoria}
              />
            </View>
          ) : null}
        </View>
        {disponibles.length === 0 ? (
          <Nota style={{ paddingHorizontal: 16, paddingVertical: 8, color: t.tenue }}>
            {ingredientes.length === 0 ? 'No hay mercancía en el inventario todavía.' : 'Nada coincide.'}
          </Nota>
        ) : (
          <>
            {disponiblesPesadas.map((ing) => (
              <OpcionMercancia key={ing.id} ing={ing} alAgregar={() => alAgregar(ing)} />
            ))}
            {disponiblesPiezas.length > 0 ? (
              <>
                <Text
                  style={[
                    estilos.apartado,
                    estilos.apartadoTexto,
                    { color: t.tinta, paddingTop: 12 },
                    disponiblesPesadas.length > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.gris200 },
                  ]}
                >
                  Por unidad <Text style={[estilos.nota, { color: t.suave }]}>· vaso, tapa, empaque</Text>
                </Text>
                {disponiblesPiezas.map((ing) => (
                  <OpcionMercancia key={ing.id} ing={ing} alAgregar={() => alAgregar(ing)} />
                ))}
              </>
            ) : null}
          </>
        )}
      </Ficha>
    </>
  )
}

/**
 * Un renglon de "Lleva": la franja de su color, el nombre con lo que cuesta
 * por unidad, la cantidad (en g o en kg, a elegir) y lo que cuesta en uno.
 */
function RenglonMercancia({
  f,
  ing,
  color,
  resaltado,
  alResaltar,
  alCambiar,
  alQuitar,
}: {
  f: Fila
  ing: Ingrediente
  color: string
  resaltado: boolean
  alResaltar: () => void
  alCambiar: (c: Partial<Fila>) => void
  alQuitar: () => void
}) {
  const t = useTema()
  const { fmt } = useMoneda()
  const cantidad = Number(f.cantidad_por_unidad) || 0
  const pieza = porUnidad(ing)
  // MUCHOS MIDEN EN GRAMOS Y MILILITROS aunque compren por kilo y por litro
  // (Leider, 29-sep). Lo que se escribe en la chica se guarda convertido a la
  // de la mercancia: el costo y el inventario no se enteran del cambio.
  const otra = OTRA_UNIDAD[ing.unidad] ?? null
  const enChica = Boolean(otra && (f.enChica ?? esGrande(ing.unidad)))
  const factor = enChica ? (esGrande(ing.unidad) ? 1000 : 1 / 1000) : 1
  const unidadVista = enChica ? otra! : ing.unidad
  const valorVisto =
    f.vista ?? (f.cantidad_por_unidad === '' ? '' : sinRuido((Number(f.cantidad_por_unidad) || 0) * factor).replace('.', ','))

  function escribir(texto: string) {
    const n = aNumero(texto)
    alCambiar({ vista: texto, cantidad_por_unidad: texto === '' || !Number.isFinite(n) ? '' : sinRuido(n / factor) })
  }

  return (
    <View style={[estilos.renglon, resaltado && { backgroundColor: t.acentoSuave }]}>
      <View style={[estilos.franja, { backgroundColor: color }]} />
      <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Pressable onPress={alResaltar} style={{ flex: 1, minWidth: 0, minHeight: 40, justifyContent: 'center' }} accessibilityRole="button">
            <Text style={[estilos.mercancia, { color: t.tinta }]} numberOfLines={2}>
              {ing.nombre}
            </Text>
            <Text style={[estilos.nota, { color: t.tenue }]} numberOfLines={1}>
              {enChica ? `${fmt(ing.costo_efectivo / factor, 2)} por ${otra}` : `${fmt(ing.costo_efectivo, 2)} por ${ing.unidad}`}
              {ing.categoria ? ` · ${ing.categoria}` : ''}
            </Text>
          </Pressable>
          <Pressable
            onPress={alQuitar}
            accessibilityRole="button"
            accessibilityLabel={`Quitar ${ing.nombre}`}
            style={({ pressed }) => [estilos.quitar, { backgroundColor: pressed ? t.peligroSuave : 'transparent' }]}
          >
            <Icono nombre="quitar" size={15} color={t.tenue} />
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 168 }}>
            <CasillaConUnidad
              valor={valorVisto}
              alCambiar={escribir}
              vista={unidadVista}
              // La que sigue al tocar: la otra cara de la que se ve ahora.
              otra={otra ? (enChica ? ing.unidad : otra) : null}
              rotulo={pieza ? unidadDe(cantidad, 'unidad') : ing.unidad}
              entero={pieza}
              autoFocus={f.cantidad_por_unidad === '' && f.vista === undefined}
              etiqueta={`Cantidad de ${ing.nombre} por unidad, en ${unidadVista}`}
              alCambiarVista={() => alCambiar({ enChica: !enChica, vista: undefined })}
            />
          </View>
          <Text style={[estilos.costo, { color: t.tinta }]}>{cantidad > 0 ? fmt(cantidad * ing.costo_efectivo) : '—'}</Text>
        </View>
      </View>
    </View>
  )
}

/** Una mercancia para agregar: nombre, categoria, costo por unidad y el "+". */
function OpcionMercancia({ ing, alAgregar }: { ing: Ingrediente; alAgregar: () => void }) {
  const t = useTema()
  const { fmt } = useMoneda()
  return (
    <Pressable
      onPress={alAgregar}
      accessibilityRole="button"
      accessibilityLabel={`Agregar ${ing.nombre}`}
      style={({ pressed }) => [estilos.opcion, { backgroundColor: pressed ? t.gris100 : 'transparent' }]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[estilos.mercanciaSuave, { color: t.tinta }]} numberOfLines={1}>
          {ing.nombre}
        </Text>
        <Text style={[estilos.nota, { color: t.tenue }]}>{ing.categoria || 'Sin categoría'}</Text>
      </View>
      <Text style={[estilos.porUnidad, { color: t.suave }]}>
        {fmt(ing.costo_efectivo, 2)} / {ing.unidad}
      </Text>
      <View style={[estilos.mas, { backgroundColor: t.gris100 }]}>
        <Icono nombre="mas" size={15} color={t.suave} grosor={2.2} />
      </View>
    </Pressable>
  )
}

// ── El margen y el precio ───────────────────────────────────────────────────

function Margen({ precio, costo, vacio }: { precio: number; costo: number; vacio: boolean }) {
  const t = useTema()
  const { fmt } = useMoneda()
  if (vacio) {
    return (
      <Nota style={{ textAlign: 'center' }}>Ponle lo que lleva y verás cuánto del precio se va en mercancía y cuánto te queda.</Nota>
    )
  }
  return (
    <View style={{ gap: 10 }}>
      <ResumenVaso tope={precio} costo={costo} formato={fmt} queda="Tu margen es" pierde="Pierdes por unidad" de="de este producto" />
      <View style={[estilos.cuesta, { borderTopColor: t.gris200 }]}>
        <Text style={[estilos.nota, { color: t.suave }]}>Cuesta hacerlo</Text>
        <Text style={[estilos.costo, { color: t.fuerte }]}>{fmt(costo)}</Text>
      </View>
    </View>
  )
}

/** Un numero escrito por la app, con coma decimal como lo escribe la gente. */
const conComa = (n: number) => String(n).replace('.', ',')

/**
 * EL PRECIO ⇄ EL MARGEN, COMO UNA CUENTA: escribe el precio y ve el margen,
 * o escribe el margen y sale el precio. Margen sobre el PRECIO (de $10 te
 * quedan $7 = 70 %). Sin margenes "tipicos" ni precios sugeridos: el margen
 * lo decide el dueño (Leider, 8-oct), el sistema solo hace la cuenta.
 */
function PrecioConMargen({ costo, precio, alPrecio, guardado }: { costo: number; precio: string; alPrecio: (p: string) => void; guardado: number }) {
  const t = useTema()
  const precioNum = aNumero(precio) || 0
  const margenDe = (p: number) => (p > 0 ? ((p - costo) / p) * 100 : null)
  // Lo que se escribio en el margen se respeta mientras el precio y el costo
  // sigan siendo los que salieron de el; si cambian por fuera, el margen se
  // vuelve a calcular. Sin efectos que copien estado.
  const [escrito, setEscrito] = useState<{ texto: string; precio: string; costo: number } | null>(null)
  const calculado = margenDe(precioNum)
  const margen =
    escrito && escrito.precio === precio && escrito.costo === costo
      ? escrito.texto
      : calculado == null
        ? ''
        : conComa(Math.round(calculado * 10) / 10)

  function desdeMargen(texto: string) {
    const m = aNumero(texto)
    let nuevo = precio
    if (costo > 0 && Number.isFinite(m) && m < 100 && m >= 0) {
      // Redondeado a la decena de centavo: $3,47 queda en $3,50.
      nuevo = conComa(Math.ceil((costo / (1 - m / 100)) * 10) / 10)
      alPrecio(nuevo)
    }
    setEscrito({ texto, precio: nuevo, costo })
  }

  const m = margenDe(precioNum)
  const costoPct = precioNum > 0 ? (costo / precioNum) * 100 : null
  return (
    <View style={[estilos.cuenta, { backgroundColor: t.gris100 }]}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <CampoNumero rotulo="Precio de venta ($)" valor={precio} alCambiar={alPrecio} placeholder="0,00" style={{ flex: 1 }} />
        <CampoNumero
          rotulo="Margen (% del precio)"
          valor={margen}
          alCambiar={desdeMargen}
          placeholder="—"
          sufijo="%"
          editable={costo > 0}
          style={{ flex: 1 }}
        />
      </View>
      <Text style={[estilos.nota, { color: t.suave }]}>
        {!(costo > 0)
          ? 'Ponle primero lo que lleva: con el costo se calcula el precio para el margen que quieras.'
          : precioNum > 0 && m != null
            ? m < 0
              ? `A ese precio pierdes ${dolares(costo - precioNum)} por unidad.`
              : `La mercancía es el ${costoPct!.toFixed(0)} % del precio y te quedan ${dolares(precioNum - costo)} por unidad.`
            : 'Escribe el precio o el margen que quieres: el otro sale solo.'}
        {guardado > 0 && Math.abs(precioNum - guardado) > 0.0001
          ? ` Hoy se vende a ${dolares(guardado)}: el precio nuevo se guarda con la receta.`
          : ''}
      </Text>
    </View>
  )
}

// ── El combo ────────────────────────────────────────────────────────────────

/** Lo que lleva un combo: productos del menu, cada uno con su cantidad. */
function EditorCombo({
  combo,
  setCombo,
  productos,
  costoDeVariante,
}: {
  combo: FilaCombo[]
  setCombo: (c: FilaCombo[] | null) => void
  productos: RenglonReceta[]
  costoDeVariante: (varianteId: number) => number
}) {
  const t = useTema()
  const { fmt } = useMoneda()
  const [busqueda, setBusqueda] = useState('')
  const usados = new Set(combo.map((c) => c.variante_id))
  const palabras = palabrasDe(busqueda)
  const disponibles = productos.filter(
    (p) => !usados.has(p.variante.id) && (palabras.length === 0 || contiene(`${p.nombre} ${p.categoria}`, palabras)),
  )
  const cambiar = (vid: number, cantidad: string) => setCombo(combo.map((c) => (c.variante_id === vid ? { ...c, cantidad } : c)))

  return (
    <>
      <Ficha style={{ paddingHorizontal: 0, paddingVertical: 8 }}>
        <View style={[estilos.agregarCabeza, { flexDirection: 'row', alignItems: 'center' }]}>
          <Titulo style={{ flex: 1 }}>El combo lleva</Titulo>
          <BotonTexto texto="No es un combo" alTocar={() => setCombo(null)} />
        </View>
        {combo.length === 0 ? (
          <Nota style={{ paddingHorizontal: 16, paddingBottom: 8 }}>Agrega abajo los productos del menú que trae.</Nota>
        ) : (
          combo.map((c) => {
            const p = productos.find((x) => x.variante.id === c.variante_id)
            return (
              <View key={c.variante_id} style={[estilos.opcion, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.gris200 }]}>
                <Text style={[estilos.mercancia, { color: t.tinta, flex: 1 }]} numberOfLines={2}>
                  {p?.nombre ?? 'Producto'}
                </Text>
                <CampoNumero valor={c.cantidad} alCambiar={(v) => cambiar(c.variante_id, v)} accessibilityLabel="Cuántos lleva" style={{ width: 84 }} />
                <Text style={[estilos.costo, { color: t.suave, width: 76 }]}>{fmt((aNumero(c.cantidad) || 0) * costoDeVariante(c.variante_id))}</Text>
                <Pressable
                  onPress={() => setCombo(combo.filter((x) => x.variante_id !== c.variante_id))}
                  accessibilityRole="button"
                  accessibilityLabel="Quitar"
                  style={estilos.quitar}
                >
                  <Icono nombre="quitar" size={15} color={t.tenue} />
                </Pressable>
              </View>
            )
          })
        )}
      </Ficha>
      <Ficha style={{ paddingHorizontal: 0, paddingVertical: 10 }}>
        <View style={estilos.agregarCabeza}>
          <Titulo>Agregar producto</Titulo>
          <Buscador valor={busqueda} alCambiar={setBusqueda} placeholder="Buscar en el menú" />
        </View>
        {disponibles.map((p) => (
          <Pressable
            key={p.variante.id}
            onPress={() => setCombo([...combo, { variante_id: p.variante.id, cantidad: '1' }])}
            accessibilityRole="button"
            accessibilityLabel={`Agregar ${p.nombre}`}
            style={({ pressed }) => [estilos.opcion, { backgroundColor: pressed ? t.gris100 : 'transparent' }]}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[estilos.mercancia, { color: t.tinta }]} numberOfLines={1}>
                {p.nombre}
              </Text>
              <Text style={[estilos.nota, { color: t.tenue }]}>{p.categoria}</Text>
            </View>
            <Text style={[estilos.porUnidad, { color: t.suave }]}>
              {p.info?.sin_receta === false ? `cuesta ${fmt(costoDeVariante(p.variante.id))}` : 'sin receta'}
            </Text>
            <View style={[estilos.mas, { backgroundColor: t.gris100 }]}>
              <Icono nombre="mas" size={15} color={t.acento} grosor={2.2} />
            </View>
          </Pressable>
        ))}
        {disponibles.length === 0 ? <Nota style={{ paddingHorizontal: 16, color: t.tenue }}>Nada coincide.</Nota> : null}
      </Ficha>
    </>
  )
}

const estilos = StyleSheet.create({
  columnas: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  nombre: { fontFamily: LETRA.tituloFuerte, fontSize: 21, letterSpacing: -0.4, lineHeight: 26 },
  texto: { fontFamily: LETRA.texto, fontSize: 14.5, lineHeight: 21 },
  nota: { fontFamily: LETRA.texto, fontSize: 13, lineHeight: 18 },
  apartado: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  apartadoTexto: { fontFamily: LETRA.titulo, fontSize: 17, letterSpacing: -0.2 },
  renglon: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  franja: { width: 6, borderRadius: 3, alignSelf: 'stretch', minHeight: 28 },
  mercancia: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  mercanciaSuave: { fontFamily: LETRA.texto, fontSize: 15 },
  costo: { fontFamily: LETRA.cifraFuerte, fontSize: 15, textAlign: 'right', flex: 1 },
  quitar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  agregarCabeza: { paddingHorizontal: 16, gap: 10, paddingBottom: 8 },
  opcion: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, minHeight: 56 },
  porUnidad: { fontFamily: LETRA.cifra, fontSize: 13 },
  mas: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  cuesta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  cuenta: { borderRadius: 18, padding: 12, gap: 10 },
})
