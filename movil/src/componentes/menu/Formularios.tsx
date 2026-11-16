import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Ancla } from '../../lib/guia'
import { aNumero } from '../../lib/numeros'
import { LETRA, useModo, useTema } from '../../lib/tema'
import type { Categoria } from '../../lib/tipos'
import { CampoNumero, HojaFormulario, Selector } from '../kit'
import { Boton, Campo, Nota } from '../ui'
import { NOMBRE_COLOR, NOMBRES_COLOR, puntoColor, type NombreColor } from './colores'
import { mensajeDe } from './datos'
import { Rotulo } from './piezas'

/*
 * LOS CUADROS DEL MENU, como los `Modal` de pages/Menu.tsx: crear una
 * categoria, crear un producto CON su precio, agregar una variante y cambiar
 * un precio con el costo a la vista. En el telefono suben desde abajo y
 * ocupan la pantalla: el teclado no tapa el campo.
 *
 * Cada uno se monta de nuevo al abrirse (quien lo usa le pone `key`): asi
 * nace limpio, sin efectos que copien valores.
 */

/** Cancelar a la izquierda, la accion a la derecha: el pie de todos los cuadros. */
function Pie({ texto, alCancelar, alAceptar, ocupado, deshabilitado, ancla }: {
  texto: string
  alCancelar: () => void
  alAceptar: () => void
  ocupado: boolean
  deshabilitado?: boolean
  /** El nombre con que la guía señala el botón de aceptar (el `data-guia` de la web), si lo tiene. */
  ancla?: string
}) {
  const aceptar = <Boton texto={texto} alTocar={alAceptar} ocupado={ocupado} deshabilitado={deshabilitado} />
  return (
    <>
      <View style={{ flex: 1 }}>
        <Boton texto="Cancelar" tono="neutro" alTocar={alCancelar} />
      </View>
      {/* El Ancla toma el flex del hueco: envuelve sin cambiar el reparto del pie. */}
      {ancla ? (
        <Ancla nombre={ancla} style={{ flex: 1.4 }}>
          {aceptar}
        </Ancla>
      ) : (
        <View style={{ flex: 1.4 }}>{aceptar}</View>
      )}
    </>
  )
}

/**
 * Los cinco tintes, de un toque. Cinco y no una rueda de color: la paleta
 * del sistema tiene cinco y con mas se pierde (lib/theme.ts de la web).
 */
export function Colores({ elegido, alElegir, grande = false }: { elegido: string; alElegir: (c: NombreColor) => void; grande?: boolean }) {
  const t = useTema()
  const { modo } = useModo()
  return (
    <View style={estilos.colores}>
      {NOMBRES_COLOR.map((c) => {
        const activo = elegido === c
        return (
          <Pressable
            key={c}
            onPress={() => alElegir(c)}
            accessibilityRole="button"
            accessibilityLabel={NOMBRE_COLOR[c]}
            accessibilityState={{ selected: activo }}
            style={[estilos.color, grande && estilos.colorGrande, { borderColor: activo ? t.tinta : 'transparent' }]}
          >
            <View style={[estilos.colorMuestra, grande && estilos.colorMuestraGrande, { backgroundColor: puntoColor(c, modo) }]} />
          </Pressable>
        )
      })}
    </View>
  )
}

/** Una de dos, con borde marcado: "Va a cocina" / "No va a cocina". */
function Opcion({ texto, activa, alTocar }: { texto: string; activa: boolean; alTocar: () => void }) {
  const t = useTema()
  return (
    <Pressable
      onPress={alTocar}
      accessibilityRole="radio"
      accessibilityState={{ checked: activa }}
      style={({ pressed }) => [
        estilos.opcion,
        { borderColor: activa ? t.tinta : t.gris200, backgroundColor: activa ? t.gris100 : t.superficie, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      <Text style={[estilos.opcionTexto, { color: t.tinta }]}>{texto}</Text>
    </Pressable>
  )
}

// ── Nueva categoria ─────────────────────────────────────────────────────────

/**
 * Crear una categoria: nombre, color y si va a cocina, de una vez. Es como
 * se piensa una categoria nueva; antes el color y lo de cocina quedaban para
 * despues, en un menu que habia que descubrir.
 */
export function CrearCategoria({
  visible,
  alCerrar,
  alCrear,
}: {
  visible: boolean
  alCerrar: () => void
  alCrear: (nombre: string, color: string, vaACocina: boolean) => Promise<void>
}) {
  const t = useTema()
  const [nombre, setNombre] = useState('')
  const [color, setColor] = useState('')
  const [vaACocina, setVaACocina] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  async function guardar() {
    if (!nombre.trim() || guardando) return
    setGuardando(true)
    setError('')
    try {
      await alCrear(nombre.trim(), color, vaACocina)
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo crear la categoría.'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <HojaFormulario
      visible={visible}
      alCerrar={alCerrar}
      titulo="Nueva categoría"
      subtitulo="Así se agrupa el menú en el mostrador: Comida, Bebidas, Postres."
      pie={
        <Pie
          texto={guardando ? 'Creando…' : 'Crear categoría'}
          alCancelar={alCerrar}
          alAceptar={() => void guardar()}
          ocupado={guardando}
          deshabilitado={!nombre.trim()}
        />
      }
    >
      <Campo rotulo="Nombre" value={nombre} onChangeText={setNombre} placeholder="Ej. Comida" returnKeyType="done" />
      <View>
        <Rotulo>Color en el mostrador</Rotulo>
        <Colores elegido={color} alElegir={setColor} grande />
      </View>
      <View>
        <Rotulo>Al comandar</Rotulo>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Opcion texto="Va a cocina" activa={vaACocina} alTocar={() => setVaACocina(true)} />
          <Opcion texto="No va a cocina" activa={!vaACocina} alTocar={() => setVaACocina(false)} />
        </View>
        <Nota style={{ color: t.tenue, marginTop: 8 }}>Es lo que se sugiere; la cajera lo puede cambiar en cada pedido.</Nota>
      </View>
      {error ? <Nota style={{ color: t.peligro }}>{error}</Nota> : null}
    </HojaFormulario>
  )
}

// ── Nuevo producto ──────────────────────────────────────────────────────────

/**
 * Crear un producto, CON su precio (opcional). Antes nacia a $0,00 y se
 * vendia en cero hasta que alguien se acordara. Al crearlo se va derecho a
 * su receta: eso lo hace quien llama.
 */
export function CrearProducto({
  visible,
  categorias,
  categoriaId,
  alCerrar,
  alCrear,
}: {
  visible: boolean
  categorias: Categoria[]
  categoriaId: number
  alCerrar: () => void
  alCrear: (categoriaId: number, nombre: string, precio: number) => Promise<void>
}) {
  const t = useTema()
  const [nombre, setNombre] = useState('')
  const [precio, setPrecio] = useState('')
  const [donde, setDonde] = useState(categoriaId)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const monto = precio.trim() === '' ? 0 : aNumero(precio)
  const precioMalo = !Number.isFinite(monto) || monto < 0
  const listo = nombre.trim().length > 0 && !precioMalo

  async function guardar() {
    if (!listo || guardando) return
    setGuardando(true)
    setError('')
    try {
      await alCrear(donde, nombre.trim(), monto)
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo crear el producto.'))
      setGuardando(false)
    }
  }

  return (
    <HojaFormulario
      visible={visible}
      alCerrar={alCerrar}
      titulo="Nuevo producto"
      subtitulo="Si ya sabes el precio, ponlo. Si no, déjalo vacío: arma la receta y el sistema te lo calcula con el margen que quieras."
      pie={
        <Pie
          texto={guardando ? 'Creando…' : precio.trim() === '' ? 'Crear y armar la receta' : 'Crear producto'}
          alCancelar={alCerrar}
          alAceptar={() => void guardar()}
          ocupado={guardando}
          deshabilitado={!listo}
          ancla="producto.crear"
        />
      }
    >
      {/* Las anclas de la guía, con los nombres de la web (`producto.nombre`, `producto.precio`). */}
      <Ancla nombre="producto.nombre">
        <Campo rotulo="Nombre" value={nombre} onChangeText={setNombre} placeholder="Ej. Empanada" />
      </Ancla>
      <Ancla nombre="producto.precio">
        <CampoNumero
          rotulo="Precio (opcional)"
          valor={precio}
          alCambiar={setPrecio}
          prefijo="$"
          placeholder="0,00"
          error={precio.trim() !== '' && precioMalo ? 'Tiene que ser un número, y no negativo' : undefined}
        />
      </Ancla>
      <Selector<string>
        etiqueta="Categoría"
        forma="campo"
        opciones={categorias.map((c) => ({ valor: String(c.id), texto: c.nombre }))}
        valor={String(donde)}
        alCambiar={(v) => setDonde(Number(v))}
      />
      <Nota style={{ color: t.tenue }}>
        Si viene en varias variantes (Grande y Pequeño, Carne y Queso), se agregan después con «+ Variante», cada una con su
        precio.
      </Nota>
      {error ? <Nota style={{ color: t.peligro }}>{error}</Nota> : null}
    </HojaFormulario>
  )
}

// ── Nueva variante ──────────────────────────────────────────────────────────

/** "+ Variante": nombre y precio, que se pide y no estorba en cada producto. */
export function NuevaVariante({
  visible,
  producto,
  alCerrar,
  alCrear,
}: {
  visible: boolean
  producto: string
  alCerrar: () => void
  alCrear: (nombre: string, precio: number) => Promise<void>
}) {
  const t = useTema()
  const [nombre, setNombre] = useState('')
  const [precio, setPrecio] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const monto = aNumero(precio)
  const listo = nombre.trim().length > 0 && Number.isFinite(monto) && monto >= 0

  async function guardar() {
    if (!listo || guardando) return
    setGuardando(true)
    setError('')
    try {
      await alCrear(nombre.trim(), monto)
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo agregar la variante.'))
      setGuardando(false)
    }
  }

  return (
    <HojaFormulario
      visible={visible}
      alCerrar={alCerrar}
      titulo={`Variante de ${producto}`}
      pie={<Pie texto="Agregar" alCancelar={alCerrar} alAceptar={() => void guardar()} ocupado={guardando} deshabilitado={!listo} />}
    >
      <Campo rotulo="Nombre de la variante" value={nombre} onChangeText={setNombre} placeholder="Ej. Grande" />
      <CampoNumero rotulo="Precio de la variante" valor={precio} alCambiar={setPrecio} prefijo="$" placeholder="Precio" />
      {error ? <Nota style={{ color: t.peligro }}>{error}</Nota> : null}
    </HojaFormulario>
  )
}

// ── Cambiar un precio ───────────────────────────────────────────────────────

/**
 * El precio de una variante, con el costo EN la pregunta y no despues: es el
 * dato que decide si el precio tiene sentido (`cambiarPrecio` de la web).
 */
export function CambiarPrecio({
  visible,
  titulo,
  texto,
  valor,
  alCerrar,
  alAceptar,
}: {
  visible: boolean
  titulo: string
  texto: string
  valor: number
  alCerrar: () => void
  alAceptar: (precio: number) => Promise<void>
}) {
  const t = useTema()
  const [precio, setPrecio] = useState(String(valor).replace('.', ','))
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function guardar() {
    if (guardando) return
    if (precio.trim() === '') return setError('Falta este dato')
    const n = aNumero(precio)
    if (!Number.isFinite(n)) return setError('Tiene que ser un número')
    if (n < 0) return setError('No puede ser negativo')
    setGuardando(true)
    setError('')
    try {
      await alAceptar(Math.round(n * 1e6) / 1e6)
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo cambiar el precio.'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <HojaFormulario
      visible={visible}
      alCerrar={alCerrar}
      titulo={titulo}
      pie={<Pie texto="Aceptar" alCancelar={alCerrar} alAceptar={() => void guardar()} ocupado={guardando} />}
    >
      {texto ? <Text style={[estilos.contexto, { color: t.suave }]}>{texto}</Text> : null}
      <CampoNumero
        rotulo="Nuevo precio"
        valor={precio}
        alCambiar={(v) => {
          setPrecio(v)
          setError('')
        }}
        prefijo="$"
        error={error || undefined}
        returnKeyType="done"
        onSubmitEditing={() => void guardar()}
      />
    </HojaFormulario>
  )
}

const estilos = StyleSheet.create({
  colores: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  color: { width: 44, height: 44, borderRadius: 12, borderCurve: 'continuous', borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  colorGrande: { width: 48, height: 48, borderRadius: 14, borderCurve: 'continuous' },
  colorMuestra: { width: 26, height: 26, borderRadius: 8, borderCurve: 'continuous' },
  colorMuestraGrande: { width: 30, height: 30, borderRadius: 9, borderCurve: 'continuous' },
  opcion: { flex: 1, minHeight: 48, borderWidth: 2, borderRadius: 14, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  opcionTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14.5 },
  contexto: { fontFamily: LETRA.texto, fontSize: 14.5, lineHeight: 21 },
})
