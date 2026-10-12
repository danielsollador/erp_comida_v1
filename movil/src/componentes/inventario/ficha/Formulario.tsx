import { useMemo, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { ejemploIdeal, ejemploRendimiento } from '../../../../../frontend/src/lib/inventario'
import { parecidos } from '../../../../../frontend/src/lib/parecidos'
import { ALMACEN_DE, ALMACENES } from '../../../../../frontend/src/lib/tiposArticulo'
import { aNumero } from '../../../lib/numeros'
import { LETRA, useTema } from '../../../lib/tema'
import type { CategoriaInsumo, DatosIngrediente, Ingrediente, TipoArticulo } from '../../../lib/tipos'
import Icono from '../../Icono'
import { CampoNumero, Selector, useDisposicion } from '../../kit'
import { Aviso, Boton, Campo, Ficha } from '../../ui'
import { CampoCantidad, Casilla, colorDe, Opciones, Rotulo } from '../comun'

/*
 * LOS DATOS DE UNA MERCANCIA: crearla, o cambiarlos (el formulario de
 * pages/partes/inventario/FichaMercancia.tsx). Las mismas casillas, en el
 * mismo orden, con las mismas ayudas y validaciones. Al crear, primero lo
 * indispensable y lo demas en "Más detalles", que se puede dejar para despues.
 */

// Las que se ofrecen al crear o cambiar una mercancia. El gramo y el
// mililitro son el kilo y el litro en chico, y eso lo maneja el sistema.
// "paquete" ya no se ofrece: lo que llega en caja se lleva en unidades y la
// caja es la presentacion del proveedor. Una ficha vieja en paquete lo conserva.
const UNIDADES_A_ELEGIR = ['kg', 'lt', 'unidad']

export type Estado = ReturnType<typeof estadoInicial>

export function estadoInicial(ing: Ingrediente | null, tipoInicial?: TipoArticulo) {
  const cantidad = (n: number) => String(Number(n.toFixed(2)))
  return {
    nombre: ing?.nombre ?? '',
    tipo: (ing?.tipo ?? tipoInicial ?? 'insumo') as TipoArticulo,
    es_indirecto: ing?.es_indirecto ?? false,
    categoria_id: ing?.categoria_id ?? null,
    unidad: ing?.unidad ?? 'kg',
    stock_actual: '',
    stock_minimo: ing ? cantidad(ing.stock_minimo) : '',
    stock_objetivo: ing ? cantidad(ing.stock_objetivo) : '',
    costo_unitario: ing ? String(ing.costo_unitario) : '',
    rendimiento_pct: ing ? String(ing.rendimiento_pct) : '100',
    exento: ing?.exento ?? false,
    // Viene en empaque de N: con esto cada factura la carga por empaques.
    empaque_trae: ing?.empaque_trae ? String(ing.empaque_trae) : '',
  }
}

/** Lo escrito, validado como en la web. Devuelve el error en palabras o los datos. */
export function validar(f: Estado, ing: Ingrediente | null): { error: string } | { datos: DatosIngrediente } {
  const nuevo = ing === null
  const num = (v: string) => aNumero(v.trim())
  if (!f.nombre.trim()) return { error: 'La mercancía necesita un nombre.' }
  const minimo = f.stock_minimo === '' ? 0 : num(f.stock_minimo)
  const objetivo = f.stock_objetivo === '' ? 0 : num(f.stock_objetivo)
  const costo = f.costo_unitario === '' ? 0 : num(f.costo_unitario)
  // Solo la materia prima tiene merma de cocina que medir.
  const rendimiento = f.tipo === 'insumo' ? num(f.rendimiento_pct) : 100
  const inicial = f.stock_actual === '' ? 0 : num(f.stock_actual)
  const empaque = f.empaque_trae === '' ? null : num(f.empaque_trae)
  if ([minimo, objetivo, costo, inicial].some((n) => !Number.isFinite(n) || n < 0))
    return { error: 'Las cantidades y el costo tienen que ser números, y no negativos.' }
  if (empaque !== null && !(empaque > 0)) return { error: 'El empaque trae una cantidad mayor que cero, o se deja vacío si viene suelta.' }
  if (!Number.isFinite(rendimiento) || rendimiento <= 0 || rendimiento > 100) return { error: 'Lo que se aprovecha va de 1 a 100 %.' }
  return {
    datos: {
      nombre: f.nombre.trim(),
      tipo: f.tipo,
      categoria_id: f.categoria_id,
      unidad: f.unidad,
      stock_minimo: minimo,
      stock_objetivo: objetivo,
      costo_unitario: costo,
      rendimiento_pct: rendimiento,
      activo: ing?.activo !== false,
      exento: f.exento,
      es_indirecto: f.tipo === 'insumo' && f.es_indirecto,
      empaque_trae: empaque,
      ...(nuevo ? { stock_actual: f.tipo === 'desechable' ? 0 : inicial } : {}),
    },
  }
}

export default function Formulario({
  ing,
  f,
  poner,
  categorias,
  todas,
  alNuevaCategoria,
  error,
  extras,
}: {
  ing: Ingrediente | null
  f: Estado
  poner: <K extends keyof Estado>(k: K, v: Estado[K]) => void
  categorias: CategoriaInsumo[]
  /** Todas las mercancias: para avisar de las parecidas al crear. */
  todas: Ingrediente[]
  /** "+ Nueva categoría…": la pide y devuelve su id (o null si se cancela). */
  alNuevaCategoria: () => Promise<number | null>
  error: string
  /** Las acciones de una ya creada (venderla en el menú, fusionar, archivar). */
  extras?: ReactNode
}) {
  const t = useTema()
  const { tablet } = useDisposicion()
  const nuevo = ing === null
  const [masDetalles, setMasDetalles] = useState(false)
  const num = (v: string) => aNumero(v.trim())
  // Al crear: las que ya existen y se le parecen. "Crema de leche lata
  // grande" junto a "Crema de Leche Lata" nacio por no verlas.
  const similares = useMemo(() => (nuevo ? parecidos(f.nombre, todas) : []), [nuevo, f.nombre, todas])

  async function elegirCategoria(v: string) {
    if (v !== 'nueva') {
      poner('categoria_id', v === '' ? null : Number(v))
      return
    }
    const id = await alNuevaCategoria()
    if (id !== null) poner('categoria_id', id)
  }

  // Dos columnas en la tablet, una en el telefono.
  const par = (a: ReactNode, b?: ReactNode) =>
    !a || !b ? (
      (a ?? b)
    ) : tablet ? (
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>{a}</View>
        <View style={{ flex: 1 }}>{b}</View>
      </View>
    ) : (
      <>
        {a}
        {b}
      </>
    )

  const opcionales = (
    <View style={{ gap: 14 }}>
      <Selector
        forma="campo"
        etiqueta="Categoría"
        opciones={[
          { valor: '', texto: 'Sin categoría' },
          ...categorias.map((c) => ({ valor: String(c.id), texto: c.nombre })),
          { valor: 'nueva', texto: '+ Nueva categoría…' },
        ]}
        valor={f.categoria_id === null ? '' : String(f.categoria_id)}
        alCambiar={(v) => void elegirCategoria(v)}
      />
      {f.tipo !== 'desechable' ? (
        <>
          {par(
            <CampoCantidad
              rotulo="Avísame cuando quede menos de"
              unidad={f.unidad}
              valor={f.stock_minimo}
              alCambiar={(v) => poner('stock_minimo', v)}
              ayuda="Por debajo de esto aparece en «Qué comprar»."
            />,
            <CampoCantidad
              rotulo="Lo ideal tener en el inventario"
              unidad={f.unidad}
              valor={f.stock_objetivo}
              alCambiar={(v) => poner('stock_objetivo', v)}
              ayuda={ejemploIdeal(num(f.stock_objetivo), ing?.stock_actual ?? (f.stock_actual === '' ? 0 : num(f.stock_actual)), f.unidad)}
            />,
          )}
          <CampoCantidad
            rotulo="Viene en empaque de"
            unidad={f.unidad}
            valor={f.empaque_trae}
            alCambiar={(v) => poner('empaque_trae', v)}
            ayuda={
              f.empaque_trae === ''
                ? 'Vacío: viene suelta. Si el proveedor la trae en caja, bulto o paquete, pon cuántas trae uno y cada factura se carga por empaques.'
                : `Cada factura pide cuántos empaques vinieron y el sistema los pasa a ${f.unidad === 'unidad' ? 'unidades' : f.unidad}.`
            }
          />
        </>
      ) : null}
      {f.tipo === 'insumo' ? (
        <CampoNumero
          rotulo="Lo que se aprovecha (%)"
          valor={f.rendimiento_pct}
          alCambiar={(v) => poner('rendimiento_pct', v)}
          sufijo="%"
          ayuda={ejemploRendimiento(f.unidad, num(f.rendimiento_pct)) || 'Lo que queda después de limpiar o cocinar.'}
        />
      ) : null}
      <Casilla
        texto="No paga IVA"
        detalle="Harina, arroz, carne y la mayoría de los alimentos básicos."
        marcada={f.exento}
        alCambiar={(v) => poner('exento', v)}
      />
      {f.tipo === 'insumo' ? (
        <Casilla
          texto="Costo indirecto, como el aceite de freír"
          detalle="No va en recetas: se anota cuando se carga la freidora y se reparte entre lo que se fríe."
          marcada={f.es_indirecto}
          alCambiar={(v) => poner('es_indirecto', v)}
        />
      ) : null}
    </View>
  )

  return (
    <>
      <Ficha style={{ gap: 14 }}>
        <Campo
          rotulo="Nombre"
          value={f.nombre}
          onChangeText={(v) => poner('nombre', v)}
          placeholder="Ej. Carne molida"
          autoCapitalize="sentences"
        />
        {similares.length > 0 ? (
          <Aviso
            tono="aviso"
            texto={`Ya tienes parecidas: ${similares.map((x) => `${x.ing.nombre} (${x.ing.unidad})`).join(', ')}. Si es la misma, no la crees: usa esa.`}
          />
        ) : null}

        <View style={{ gap: 8 }}>
          <Rotulo>Qué es</Rotulo>
          {f.tipo === 'preparacion' ? (
            <Text style={[s.texto, { color: t.suave }]}>Su receta y lo que rinde se editan en Materia prima → Preparado.</Text>
          ) : (
            <ElegirAlmacen valor={f.tipo} alElegir={(v) => poner('tipo', v)} />
          )}
        </View>

        <View style={{ gap: 8 }}>
          <Rotulo>Se mide en</Rotulo>
          <Opciones
            opciones={(UNIDADES_A_ELEGIR.includes(f.unidad) ? UNIDADES_A_ELEGIR : [...UNIDADES_A_ELEGIR, f.unidad]).map((x) => ({ valor: x, texto: x }))}
            valor={f.unidad}
            alCambiar={(v) => poner('unidad', v)}
          />
        </View>

        {par(
          nuevo && f.tipo !== 'desechable' ? (
            <CampoCantidad
              rotulo="Cuánto hay hoy"
              unidad={f.unidad}
              valor={f.stock_actual}
              alCambiar={(v) => poner('stock_actual', v)}
              ayuda="Después se mueve solo con las compras, las ventas y los conteos."
            />
          ) : null,
          <CampoNumero
            rotulo={`Lo que pagas por ${f.unidad}, sin IVA ($)`}
            prefijo="$"
            valor={f.costo_unitario}
            alCambiar={(v) => poner('costo_unitario', v)}
            placeholder="0.00"
            ayuda={nuevo ? 'Lo que pagaste la última vez. Cada compra lo va ajustando.' : 'Se ajusta solo con cada compra.'}
          />,
        )}
      </Ficha>

      {nuevo ? (
        <Ficha style={{ padding: 0 }}>
          <Pressable
            onPress={() => setMasDetalles((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: masDetalles }}
            style={({ pressed }) => [s.plegable, { opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[s.plegableTitulo, { color: t.tinta }]}>Más detalles</Text>
              <Text style={[s.nota, { color: t.suave }]}>Opcional: categoría, cuándo avisar, cuánto se aprovecha, IVA</Text>
            </View>
            <View style={{ transform: [{ rotate: masDetalles ? '-90deg' : '90deg' }] }}>
              <Icono nombre="chevron" size={15} color={t.tenue} grosor={2.2} />
            </View>
          </Pressable>
          {masDetalles ? <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>{opcionales}</View> : null}
        </Ficha>
      ) : (
        <Ficha>{opcionales}</Ficha>
      )}

      {extras}
      {/* El error va junto al boton de abajo: arriba, con el teclado abierto, no se ve. */}
      {error ? <Aviso texto={error} tono="peligro" /> : null}
    </>
  )
}

/**
 * "¿Qué es?": los cuatro almacenes como cuatro fichas (ElegirAlmacen de la
 * web, en su forma compacta): cada una dice en una linea que es y a donde va
 * la plata.
 */
function ElegirAlmacen({ valor, alElegir }: { valor: TipoArticulo; alElegir: (tipo: TipoArticulo) => void }) {
  const t = useTema()
  return (
    <View style={s.almacenes} accessibilityRole="radiogroup">
      {ALMACENES.map((a) => {
        const esta = valor === a.valor
        const k = colorDe(a.valor, t)
        return (
          <Pressable
            key={a.valor}
            onPress={() => alElegir(a.valor)}
            accessibilityRole="radio"
            accessibilityState={{ checked: esta }}
            style={({ pressed }) => [
              s.almacen,
              { backgroundColor: esta ? t.tinta : t.gris100, transform: [{ scale: pressed ? 0.98 : 1 }] },
            ]}
          >
            <View style={s.almacenCabeza}>
              <View style={[s.almacenIcono, { backgroundColor: esta ? 'rgba(255,255,255,0.12)' : k.fondo }]}>
                <Icono nombre={ALMACEN_DE[a.valor].icono} size={16} color={esta ? t.papel : k.tinta} />
              </View>
              <View style={[s.puntito, { backgroundColor: k.punto, opacity: esta ? 1 : 0.7 }]} />
            </View>
            <Text style={[s.almacenNombre, { color: esta ? t.papel : t.tinta }]}>{a.texto}</Text>
            <Text style={[s.almacenDetalle, { color: esta ? t.papel : t.suave, opacity: esta ? 0.75 : 1 }]}>{a.detalle}</Text>
            <Text
              style={[
                s.almacenDestino,
                { color: esta ? t.papel : a.destino === 'gasto' ? t.aviso : t.suave, opacity: esta ? 0.65 : 1 },
              ]}
            >
              {a.destino === 'gasto' ? '→ gasto del mes' : '→ inventario'}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/** El pie de un formulario: el de volver y el de guardar, siempre a la vista. */
export function PieFormulario({
  volver,
  alVolver,
  guardar,
  alGuardar,
  guardando,
}: {
  volver: string
  alVolver: () => void
  guardar: string
  alGuardar: () => void
  guardando: boolean
}) {
  const t = useTema()
  return (
    <View style={[s.pie, { backgroundColor: t.superficie, borderTopColor: t.gris200 }]}>
      <View style={{ flex: 1 }}>
        <Boton texto={volver} tono="neutro" alTocar={alVolver} />
      </View>
      <View style={{ flex: 1.4 }}>
        <Boton texto={guardar} alTocar={alGuardar} ocupado={guardando} />
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  texto: { fontFamily: LETRA.texto, fontSize: 14.5, lineHeight: 20 },
  nota: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19, marginTop: 2 },
  plegable: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18, minHeight: 64 },
  plegableTitulo: { fontFamily: LETRA.textoFuerte, fontSize: 15.5 },
  almacenes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  almacen: { width: '48.5%', flexGrow: 1, borderRadius: 18, padding: 12, gap: 3 },
  almacenCabeza: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  almacenIcono: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  puntito: { width: 8, height: 8, borderRadius: 4 },
  almacenNombre: { fontFamily: LETRA.textoFuerte, fontSize: 14.5 },
  almacenDetalle: { fontFamily: LETRA.texto, fontSize: 13, lineHeight: 17 },
  almacenDestino: { fontFamily: LETRA.textoFuerte, fontSize: 13, marginTop: 4 },
  pie: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth },
})
