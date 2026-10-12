import { useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { unidadDe } from '../../../../frontend/src/lib/inventario'
import { ErrorApi } from '../../lib/api'
import { apiPreparaciones } from '../../lib/api-preparaciones'
import { aNumero, sinRuido } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import type { Ingrediente, Preparacion } from '../../lib/tipos'
import { CampoNumero, HojaFormulario, Selector } from '../kit'
import { Boton } from '../ui'
import { fmtCant } from './cuentas'
import { Caja, mensajeDe } from './piezas'

/**
 * UNA TANDA (`AnotarTanda` de la web): lo que salio y, si se quiere, lo que
 * se uso. Lo usado viene propuesto con la receta (que es por 1) multiplicada
 * por lo que salio; si la cocina uso otra cantidad la corrige, y de ahi sale
 * el rendimiento real.
 *
 * Si el crudo no alcanza, el servidor avisa (casi siempre es un numero mal
 * escrito); tocando «Anotar» otra vez se registra igual y queda en negativo
 * hasta el proximo conteo: la cocina no se traba.
 */
export default function AnotarTanda({
  inicial,
  producibles,
  ingredientes,
  alCerrar,
  alHecho,
}: {
  inicial: Preparacion
  producibles: Preparacion[]
  ingredientes: Ingrediente[]
  alCerrar: () => void
  alHecho: () => void
}) {
  const t = useTema()
  const [prepId, setPrepId] = useState(inicial.id)
  const prep = producibles.find((p) => p.id === prepId) ?? inicial
  const [salio, setSalio] = useState('')
  // Solo lo que la cocina corrigio; lo demas se propone desde la receta.
  const [usado, setUsado] = useState<Record<number, string>>({})
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  // Si no alcanza el crudo, el servidor avisa; la segunda vez va confirmada.
  const [confirmarFalta, setConfirmarFalta] = useState('')
  const porId = useMemo(() => new Map(ingredientes.map((i) => [i.id, i])), [ingredientes])

  function elegir(id: number) {
    if (!producibles.some((x) => x.id === id)) return
    setPrepId(id)
    setSalio('')
    setUsado({})
    setConfirmarFalta('')
  }

  const salioNum = aNumero(salio)
  const usadoDe = (l: Preparacion['lineas'][number]) =>
    usado[l.ingrediente_id] ?? (salioNum > 0 ? sinRuido(l.cantidad * salioNum) : '')
  const principal = [...prep.lineas].sort((a, b) => b.costo - a.costo)[0]
  const usadoPrincipal = principal ? aNumero(usadoDe(principal) || '0') : 0
  const esperado = principal && principal.cantidad > 0 && Number.isFinite(usadoPrincipal) ? usadoPrincipal / principal.cantidad : 0
  const rendimiento = esperado > 0 && salioNum > 0 ? salioNum / esperado : null

  async function guardar() {
    setError('')
    if (!(salioNum > 0)) return setError('Di cuánto salió.')
    setGuardando(true)
    try {
      await apiPreparaciones.anotarTanda({
        preparacion_id: prep.id,
        cantidad: salioNum,
        usado: prep.lineas.map((l) => {
          const n = aNumero(usadoDe(l) || '0')
          return { ingrediente_id: l.ingrediente_id, cantidad: Number.isFinite(n) ? n : 0 }
        }),
        forzar: !!confirmarFalta,
      })
      alHecho()
    } catch (e) {
      if (e instanceof ErrorApi && e.estado === 409 && e.message.startsWith('No alcanza')) {
        setConfirmarFalta(e.message)
        setError(`${e.message} Si de verdad se usó eso, vuelve a tocar «Anotar» y queda en negativo hasta el próximo conteo.`)
        return
      }
      setError(mensajeDe(e, 'No se pudo anotar'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <HojaFormulario
      visible
      alCerrar={alCerrar}
      titulo="Anotar tanda"
      pie={
        <>
          <View style={{ flex: 1 }}>
            <Boton texto="Cancelar" tono="neutro" alTocar={alCerrar} />
          </View>
          <View style={{ flex: 1 }}>
            <Boton texto={guardando ? 'Anotando…' : 'Anotar'} alTocar={() => void guardar()} ocupado={guardando} />
          </View>
        </>
      }
    >
      {producibles.length > 1 ? (
        <Selector
          etiqueta="Qué se hizo"
          forma="campo"
          opciones={producibles.map((p) => ({ valor: String(p.id), texto: p.nombre }))}
          valor={String(prepId)}
          alCambiar={(v) => elegir(Number(v))}
        />
      ) : null}
      <CampoNumero rotulo={`Cuánto salió (${prep.unidad})`} valor={salio} alCambiar={setSalio} sufijo={prep.unidad} autoFocus />
      <View style={{ gap: 8 }}>
        <Text style={[e.rotulo, { color: t.suave }]}>Lo que se usó</Text>
        {prep.lineas.map((l) => (
          <View key={l.ingrediente_id} style={e.linea}>
            <Text style={[e.nombre, { color: t.tinta }]} numberOfLines={2}>
              {l.nombre}
            </Text>
            <CampoNumero
              valor={usadoDe(l)}
              alCambiar={(v) => setUsado((u) => ({ ...u, [l.ingrediente_id]: v }))}
              sufijo={porId.get(l.ingrediente_id)?.unidad ?? l.unidad}
              accessibilityLabel={`Cuánto ${l.nombre} se usó`}
              style={{ width: 150 }}
            />
          </View>
        ))}
      </View>
      {rendimiento != null ? (
        <Caja tono={Math.abs(rendimiento - 1) > 0.05 ? 'aviso' : 'neutro'}>
          <Text style={[e.nota, { color: Math.abs(rendimiento - 1) > 0.05 ? t.avisoFuerte : t.fuerte }]}>
            Con eso la receta esperaba {fmtCant(esperado)} {unidadDe(esperado, prep.unidad)}: rindió {Math.round(rendimiento * 100)} %.
          </Text>
        </Caja>
      ) : null}
      {error ? <Text style={[e.nota, { color: t.peligro }]}>{error}</Text> : null}
    </HojaFormulario>
  )
}

const e = StyleSheet.create({
  rotulo: { fontFamily: LETRA.textoFuerte, fontSize: 13 },
  linea: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nombre: { flex: 1, minWidth: 0, fontFamily: LETRA.texto, fontSize: 15 },
  nota: { fontFamily: LETRA.texto, fontSize: 14, lineHeight: 20 },
})
