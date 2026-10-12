import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { parecidos } from '../../../../../frontend/src/lib/parecidos'
import { apiInventario } from '../../../lib/api-inventario'
import { miles } from '../../../lib/formato'
import { aNumero } from '../../../lib/numeros'
import { LETRA, useTema } from '../../../lib/tema'
import type { Ingrediente } from '../../../lib/tipos'
import Icono from '../../Icono'
import { Buscador, CampoNumero, HojaFormulario, llano } from '../../kit'
import { Boton, estilos } from '../../ui'
import { mensaje, PuntoTipo, unidadDe } from '../comun'

/*
 * FUNDIR UNA MERCANCIA DUPLICADA en la que se queda
 * (components/FusionarMercancia.tsx de la web).
 *
 * Pasa a la que queda lo vivo: el stock (al costo de la que se va, asi que
 * el inventario vale lo mismo), las recetas y lo aprendido de los
 * proveedores. La que se va queda archivada con su historia intacta.
 *
 * Primero salen las parecidas: casi siempre la gemela esta ahi. En la web es
 * un desplegable; aqui la lista esta a la vista, con buscador, porque un
 * desplegable dentro de una hoja es un toque de mas y tapa lo que se elige.
 */
export default function Fusionar({
  origen,
  ingredientes,
  alHecho,
  alCerrar,
}: {
  origen: Ingrediente
  ingredientes: Ingrediente[]
  alHecho: (destino: Ingrediente) => void
  alCerrar: () => void
}) {
  const t = useTema()
  const otras = useMemo(() => ingredientes.filter((i) => i.activo && i.id !== origen.id), [ingredientes, origen.id])
  const sugeridas = useMemo(() => parecidos(origen.nombre, otras).map((x) => x.ing), [origen.nombre, otras])
  const resto = useMemo(
    () => otras.filter((i) => !sugeridas.some((s) => s.id === i.id)).sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [otras, sugeridas],
  )
  const [destinoId, setDestinoId] = useState<number>(sugeridas[0]?.id ?? 0)
  const [buscar, setBuscar] = useState('')
  const [factor, setFactor] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const destino = otras.find((i) => i.id === destinoId)
  const otraUnidad = !!destino && destino.unidad !== origen.unidad
  const factorNum = otraUnidad ? aNumero(factor) : 1
  const stock = origen.stock_actual || 0
  const fmt = (n: number) => miles(n, 2).replace(/,00$/, '')
  const q = llano(buscar.trim())
  const filtra = (l: Ingrediente[]) => (q ? l.filter((i) => llano(i.nombre).includes(q)) : l)

  async function fundir() {
    setError('')
    if (!destino) return setError('Elige con cuál se queda.')
    if (!(factorNum > 0)) return setError(`Di cuántos ${destino.unidad} trae 1 ${origen.unidad}.`)
    setGuardando(true)
    try {
      alHecho(await apiInventario.fusionar(origen.id, destino.id, factorNum))
    } catch (e) {
      setError(mensaje(e, 'No se pudo fusionar'))
    } finally {
      setGuardando(false)
    }
  }

  const opcion = (i: Ingrediente) => {
    const esta = i.id === destinoId
    return (
      <Pressable
        key={i.id}
        onPress={() => {
          setDestinoId(i.id)
          setFactor('')
        }}
        accessibilityRole="radio"
        accessibilityState={{ checked: esta }}
        style={({ pressed }) => [s.opcion, { backgroundColor: esta ? t.gris100 : pressed ? t.gris100 : 'transparent', borderColor: esta ? t.tinta : t.gris200 }]}
      >
        <PuntoTipo tipo={i.tipo} />
        <Text style={[s.opcionTexto, { color: t.tinta }]} numberOfLines={2}>
          {i.nombre} <Text style={{ color: t.tenue, fontFamily: LETRA.texto }}>({i.unidad})</Text>
        </Text>
        {esta ? <Icono nombre="ok" size={18} color={t.acento} grosor={2.2} /> : null}
      </Pressable>
    )
  }

  return (
    <HojaFormulario
      visible
      alCerrar={alCerrar}
      titulo={`Fusionar «${origen.nombre}»`}
      pie={
        <>
          <View style={{ flex: 1 }}>
            <Boton texto="Cancelar" tono="neutro" alTocar={alCerrar} />
          </View>
          <View style={{ flex: 1.4 }}>
            <Boton texto={guardando ? 'Fusionando…' : 'Fusionar'} alTocar={() => void fundir()} deshabilitado={guardando || !destino} />
          </View>
        </>
      }
    >
      <Text style={[estilos.texto, { color: t.suave }]}>
        Para cuando dos fichas son la misma mercancía. Esta se archiva y la otra se queda con su stock, sus recetas y lo que se aprendió de los
        proveedores. Las compras y movimientos viejos no cambian.
      </Text>

      {destino && factorNum > 0 ? (
        <View style={[s.resumen, { backgroundColor: t.gris100 }]}>
          <Text style={[estilos.nota, { color: t.fuerte }]}>
            {stock
              ? `Pasan ${fmt(stock)} ${unidadDe(stock, origen.unidad)}${otraUnidad ? ` (= ${fmt(stock * factorNum)} ${unidadDe(stock * factorNum, destino.unidad)})` : ''} a ${destino.nombre}.`
              : `${origen.nombre} no tiene stock: solo pasan sus recetas y la memoria de proveedores.`}
          </Text>
        </View>
      ) : null}

      {otraUnidad && destino ? (
        <CampoNumero
          rotulo={`¿Cuántos ${destino.unidad} trae 1 ${origen.unidad}?`}
          valor={factor}
          alCambiar={setFactor}
          placeholder={destino.unidad === 'kg' ? 'Ej. 0,25 (una lata de 250 g)' : 'Ej. 1'}
          sufijo={destino.unidad}
        />
      ) : null}
      {error ? <Text style={[estilos.nota, { color: t.peligro }]}>{error}</Text> : null}

      <Text style={[s.rotulo, { color: t.tenue }]}>Se queda</Text>
      {otras.length > 8 ? <Buscador valor={buscar} alCambiar={setBuscar} placeholder="Buscar la mercancía" /> : null}
      {filtra(sugeridas).length > 0 ? (
        <View style={{ gap: 6 }}>
          <Text style={[s.grupo, { color: t.suave }]}>Parecidas</Text>
          {filtra(sugeridas).map(opcion)}
        </View>
      ) : null}
      <View style={{ gap: 6 }}>
        <Text style={[s.grupo, { color: t.suave }]}>Todas</Text>
        {filtra(resto).map(opcion)}
        {filtra(resto).length === 0 ? <Text style={[estilos.nota, { color: t.tenue }]}>Nada coincide.</Text> : null}
      </View>
    </HojaFormulario>
  )
}

const s = StyleSheet.create({
  resumen: { borderRadius: 14, padding: 12 },
  rotulo: { fontFamily: LETRA.textoFuerte, fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase', marginTop: 4 },
  grupo: { fontFamily: LETRA.textoFuerte, fontSize: 13 },
  opcion: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  opcionTexto: { flex: 1, fontFamily: LETRA.textoFuerte, fontSize: 15 },
})
