import { router, Stack, useLocalSearchParams, useNavigation } from 'expo-router'
import { usePreventRemove } from 'expo-router/react-navigation'
import { useEffect, useMemo, useState } from 'react'
import { Text, View } from 'react-native'
import Compositor, { armarVaso, huella, huellaDeCombo, type Fila, type FilaCombo } from '../../../../componentes/menu/Compositor'
import { paraPrecio, renglonesDe, type DatosMenu } from '../../../../componentes/menu/datos'
import { BarraAccion } from '../../../../componentes/kit'
import { Cargando, Pantalla, Problema } from '../../../../componentes/ui'
import { apiMenu } from '../../../../lib/api-menu'
import { confirmar } from '../../../../lib/dialogo'
import { useMoneda } from '../../../../lib/moneda'
import { aNumero } from '../../../../lib/numeros'
import { LETRA, useTema } from '../../../../lib/tema'
import type { Ingrediente } from '../../../../lib/tipos'

/**
 * LA RECETA DE UNA VARIANTE (/menu/recetas/<variante>): lo que en la web se
 * abre encima de la lista de Recetas con `state.receta`. Aqui es su propia
 * pantalla: el "atras" del telefono la cierra y vuelve a donde se estaba (la
 * lista, o el menu).
 *
 * Primero el costo, despues el precio: asi se hace en cualquier cocina. El
 * precio se decide aqui con el costo a la vista y se guarda con la receta.
 * Salir con cambios sin guardar pregunta antes (Leider, 29-sep).
 */
type Cargado = {
  datos: DatosMenu
  ingredientes: Ingrediente[]
  indirecto: number
}

export default function EditorReceta() {
  const t = useTema()
  const { fmt } = useMoneda()
  const navegacion = useNavigation()
  const { variante: param } = useLocalSearchParams<{ variante: string }>()
  const varianteId = Number(param)

  const [cargado, setCargado] = useState<Cargado | null>(null)
  const [errorCarga, setErrorCarga] = useState('')
  const [intento, setIntento] = useState(0)
  const [filas, setFilas] = useState<Fila[]>([])
  const [huellaGuardada, setHuellaGuardada] = useState('')
  // Si es COMBO: los productos del menu que lleva. null = se arma con mercancia.
  const [combo, setCombo] = useState<FilaCombo[] | null>(null)
  const [huellaCombo, setHuellaCombo] = useState('')
  const [precio, setPrecio] = useState('')
  const [precioGuardado, setPrecioGuardado] = useState(0)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [salir, setSalir] = useState(false)

  // Todo de una vez: el menu con sus costos, la mercancia al costo con que se
  // deciden los precios, el aceite por pieza, la receta y el combo.
  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const [categorias, costos, lista, cp, receta, comboGuardado] = await Promise.all([
          apiMenu.listarCategorias(),
          apiMenu.costosVariantes(),
          apiMenu.listarIngredientes(),
          apiMenu.costosParaPrecios().catch(() => null),
          apiMenu.verReceta(varianteId),
          apiMenu.verCombo(varianteId).catch(() => []),
        ])
        if (!vivo) return
        // Cada mercancia, a lo que cuesta con el metodo de precios: asi el
        // costo de cada renglon y el total cuadran con la lista.
        const ingredientes = lista
          .filter((i) => i.activo !== false)
          .map((i) => (cp && cp.por_ingrediente[i.id] != null ? { ...i, costo_efectivo: cp.por_ingrediente[i.id] } : i))
        const iniciales: Fila[] = receta.map((x) => ({ ingrediente_id: x.ingrediente_id, cantidad_por_unidad: String(x.cantidad_por_unidad) }))
        const filasCombo = comboGuardado.length
          ? comboGuardado.map((x) => ({ variante_id: x.variante_id, cantidad: String(x.cantidad).replace('.', ',') }))
          : null
        const datos: DatosMenu = { categorias, costos: new Map(costos.map((c) => [c.variante_id, c])) }
        const v = renglonesDe(datos).find((r) => r.variante.id === varianteId)?.variante
        setFilas(iniciales)
        setHuellaGuardada(huella(iniciales))
        setCombo(filasCombo)
        setHuellaCombo(huellaDeCombo(filasCombo))
        setPrecio(v && v.precio > 0 ? String(v.precio).replace('.', ',') : '')
        setPrecioGuardado(v?.precio ?? 0)
        setCargado({ datos, ingredientes, indirecto: cp?.indirecto_por_pieza ?? 0 })
        setErrorCarga('')
      } catch (e) {
        if (vivo) setErrorCarga(e instanceof Error ? e.message : 'No se pudo abrir la receta.')
      }
    })()
    return () => {
      vivo = false
    }
  }, [varianteId, intento])

  const renglones = useMemo(() => (cargado ? renglonesDe(cargado.datos) : []), [cargado])
  const renglon = renglones.find((r) => r.variante.id === varianteId)
  const productos = useMemo(() => renglones.filter((x) => x.variante.id !== varianteId), [renglones, varianteId])
  const mapa = useMemo(() => new Map((cargado?.ingredientes ?? []).map((i) => [i.id, i])), [cargado])
  const costoDeVariante = (vid: number) => paraPrecio(cargado?.datos.costos.get(vid))?.costo ?? 0

  const vaso = armarVaso({
    filas,
    mapa,
    combo,
    productos,
    costoDeVariante,
    indirecto: renglon?.variante.se_frie ? (cargado?.indirecto ?? 0) : 0,
  })

  const precioNum = aNumero(precio)
  const cambioPrecio = renglon !== undefined && precio.trim() !== '' && Number.isFinite(precioNum) && Math.abs(precioNum - precioGuardado) > 0.0001
  const hayCambios =
    renglon !== undefined && ((combo === null ? huella(filas) !== huellaGuardada : huellaDeCombo(combo) !== huellaCombo) || cambioPrecio)

  // La flecha de volver, el atras del telefono y el gesto preguntan mientras
  // haya cambios sin guardar.
  usePreventRemove(hayCambios, ({ data }) => {
    void confirmar({
      titulo: `¿Salir sin guardar la receta de ${renglon?.nombre ?? 'este producto'}?`,
      texto: 'Lo que cambiaste se pierde. Si quieres conservarlo, vuelve y toca «Guardar receta».',
      aceptar: 'Salir sin guardar',
      peligro: true,
    }).then((si) => {
      if (si) navegacion.dispatch(data.action)
    })
  })

  // Guardado: se sale cuando ya no hay cambios (si no, la guardia preguntaria).
  // Abierta por un enlace directo no hay a donde volver: se va a la lista.
  useEffect(() => {
    if (!salir || hayCambios) return
    if (router.canGoBack()) router.back()
    else router.replace('/menu/recetas')
  }, [salir, hayCambios])

  async function guardar() {
    if (!renglon || guardando) return
    setError('')
    const v = renglon.variante
    const precioValido = precio.trim() === '' || precioNum > 0
    if (combo !== null) {
      const partes = combo
        .filter((c) => aNumero(c.cantidad) > 0)
        .map((c) => ({ variante_id: c.variante_id, cantidad: aNumero(c.cantidad) }))
      if (partes.length === 0) return setError('Un combo lleva al menos un producto del menú.')
      if (!precioValido) return setError('El precio tiene que ser mayor que cero.')
      setGuardando(true)
      try {
        await apiMenu.guardarCombo(v.id, partes)
        if (cambioPrecio) await apiMenu.actualizarVariante(v.id, v.nombre, Math.round(precioNum * 100) / 100, true)
        setHuellaCombo(huellaDeCombo(combo))
        if (cambioPrecio) setPrecioGuardado(precioNum)
        setSalir(true)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo guardar el combo')
      } finally {
        setGuardando(false)
      }
      return
    }
    const items = filas
      .filter((f) => f.ingrediente_id && Number(f.cantidad_por_unidad) > 0)
      .map((f) => ({ ingrediente_id: f.ingrediente_id, cantidad_por_unidad: Number(f.cantidad_por_unidad) }))
    if (items.length === 0) return setError('Ponle al menos una mercancía con su cantidad.')
    if (!precioValido) return setError('El precio tiene que ser mayor que cero.')
    setGuardando(true)
    try {
      await apiMenu.actualizarReceta(v.id, items)
      if (cambioPrecio) await apiMenu.actualizarVariante(v.id, v.nombre, Math.round(precioNum * 100) / 100, true)
      setHuellaGuardada(huella(filas))
      // Lo escrito, sin redondear: asi deja de contar como cambio y se sale.
      if (cambioPrecio) setPrecioGuardado(precioNum)
      setSalir(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la receta')
    } finally {
      setGuardando(false)
    }
  }

  const titulo = <Stack.Screen options={{ title: 'Receta' }} />

  if (!cargado) {
    return (
      <Pantalla>
        {titulo}
        {errorCarga ? <Problema mensaje={errorCarga} alReintentar={() => setIntento((n) => n + 1)} /> : <Cargando />}
      </Pantalla>
    )
  }

  // Lo retirado del menu (o un envio, que no se cocina) no lleva receta.
  if (!renglon) {
    return (
      <Pantalla>
        {titulo}
        <Problema mensaje="Ese producto ya no está en el menú: lo retirado no lleva receta." />
      </Pantalla>
    )
  }

  return (
    <Pantalla
      abajo={
        <BarraAccion
          izquierda={
            <View>
              <Text style={{ fontFamily: LETRA.texto, fontSize: 13, color: t.suave }}>Cuesta hacerlo</Text>
              <Text style={{ fontFamily: LETRA.cifraFuerte, fontSize: 17, color: t.tinta }} numberOfLines={1} adjustsFontSizeToFit>
                {fmt(vaso.costo)}
              </Text>
            </View>
          }
          texto={guardando ? 'Guardando…' : 'Guardar receta'}
          alTocar={() => void guardar()}
          ocupado={guardando}
          aviso={error || undefined}
        />
      }
    >
      {titulo}
      <Compositor
        renglon={renglon}
        ingredientes={cargado.ingredientes}
        mapa={mapa}
        filas={filas}
        setFilas={setFilas}
        precio={precio}
        setPrecio={setPrecio}
        combo={combo}
        setCombo={setCombo}
        productos={productos}
        costoDeVariante={costoDeVariante}
        vaso={vaso}
        precioGuardado={precioGuardado}
      />
    </Pantalla>
  )
}
