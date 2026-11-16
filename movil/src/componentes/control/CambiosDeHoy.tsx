import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { apiPreparaciones } from '../../lib/api-preparaciones'
import { LETRA, useTema } from '../../lib/tema'
import type { Ingrediente, Sustitucion } from '../../lib/tipos'
import { CampoNumero, Selector } from '../kit'
import { Boton, Campo, Ficha } from '../ui'
import { BotonChico, Cabecera, Caja, Enlace, mensajeDe } from '../preparaciones/piezas'

const dos = (n: number) => String(n).padStart(2, '0')

/** "12/10, 12:00 a. m.": hasta cuando dura el cambio (la hora del local, se lee tal cual). */
function hastaCuando(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso)
  if (!m) return iso
  const h = Number(m[4])
  return `${m[3]}/${m[2]}, ${dos(h % 12 === 0 ? 12 : h % 12)}:${m[5]} ${h < 12 ? 'a. m.' : 'p. m.'}`
}

/**
 * "HOY NO HAY POLLO, SE USA PAVO" (8-oct, caso 2; `CambiosDeHoy` de la web).
 * Mientras el cambio este vigente (hasta el cierre del dia, salvo que se
 * quite antes), lo vendido descuenta el sustituto en vez del original, sin
 * tocar ninguna receta.
 */
export default function CambiosDeHoy({ ingredientes }: { ingredientes: Ingrediente[] }) {
  const t = useTema()
  const [cambios, setCambios] = useState<Sustitucion[]>([])
  const [original, setOriginal] = useState('')
  const [sustituto, setSustituto] = useState('')
  const [factor, setFactor] = useState('1')
  const [nota, setNota] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [error, setError] = useState('')

  const cargar = useCallback(() => {
    apiPreparaciones.sustituciones().then(setCambios).catch(() => undefined)
  }, [])
  useEffect(() => {
    cargar()
  }, [cargar])

  const orden = ingredientes
    .filter((i) => i.activo !== false && i.tipo !== 'preparacion' && i.tipo !== 'desechable' && !i.es_indirecto)
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
  const elegido = orden.find((i) => String(i.id) === original)
  const reemplazo = orden.find((i) => String(i.id) === sustituto)

  async function guardar() {
    setError('')
    if (!original || !sustituto) return setError('Elige qué falta y con qué se reemplaza.')
    const f = Number(factor.replace(',', '.'))
    if (!(f > 0)) return setError('La proporción tiene que ser mayor que cero.')
    try {
      await apiPreparaciones.crearSustitucion({ original_id: Number(original), sustituto_id: Number(sustituto), factor: f, nota: nota.trim() })
      setOriginal('')
      setSustituto('')
      setFactor('1')
      setNota('')
      setAbierto(false)
      cargar()
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo guardar el cambio'))
    }
  }

  async function quitar(id: number) {
    await apiPreparaciones.terminarSustitucion(id).catch(() => undefined)
    cargar()
  }

  return (
    <Ficha>
      <Cabecera
        titulo="Cambios de hoy"
        ayuda="Cuando falta algo y la cocina usa otra cosa: lo vendido descuenta el reemplazo sin tocar las recetas. Dura hasta el cierre del día."
        accion={!abierto ? <BotonChico texto="Anotar un cambio" alTocar={() => setAbierto(true)} /> : undefined}
      />
      {cambios.length === 0 && !abierto ? <Text style={[c.texto, { color: t.suave }]}>Hoy todo sale con sus recetas de siempre.</Text> : null}
      {cambios.length > 0 ? (
        <View style={{ gap: 8, marginBottom: abierto ? 12 : 0 }}>
          {cambios.map((x) => (
            <Caja key={x.id} tono="aviso" estilo={{ gap: 2 }}>
              <Text style={[c.texto, { color: t.tinta }]}>
                <Text style={c.fuerte}>{x.original}</Text> se reemplaza por <Text style={c.fuerte}>{x.sustituto}</Text>
                {x.factor !== 1 ? ` (${x.factor} ${x.unidad_sustituto} por cada ${x.unidad_original})` : ''}
              </Text>
              <Text style={[c.nota, { color: t.suave }]}>
                hasta {hastaCuando(x.hasta)}
                {x.nota ? ` · ${x.nota}` : ''}
              </Text>
              <View style={{ flexDirection: 'row' }}>
                <Enlace texto="Ya llegó: volver a la receta" subrayado alTocar={() => void quitar(x.id)} />
              </View>
            </Caja>
          ))}
        </View>
      ) : null}
      {abierto ? (
        <View style={{ gap: 12 }}>
          <Selector
            etiqueta="Falta"
            forma="campo"
            placeholder="Elige la mercancía…"
            opciones={orden.map((i) => ({ valor: String(i.id), texto: `${i.nombre} (${i.unidad})` }))}
            valor={original}
            alCambiar={setOriginal}
          />
          <Selector
            etiqueta="Se usa en su lugar"
            forma="campo"
            placeholder="Elige el reemplazo…"
            opciones={orden
              .filter((i) => String(i.id) !== original)
              .map((i) => ({ valor: String(i.id), texto: `${i.nombre} (${i.unidad}) · hay ${i.stock_actual}` }))}
            valor={sustituto}
            alCambiar={setSustituto}
          />
          <CampoNumero
            rotulo={`Cuánto ${reemplazo?.unidad ?? 'del reemplazo'} por cada ${elegido?.unidad ?? 'unidad'} que se usaba`}
            valor={factor}
            alCambiar={setFactor}
          />
          <Campo rotulo="Por qué (opcional)" value={nota} onChangeText={setNota} placeholder="No llegó el pollo" />
          {error ? <Text style={[c.texto, { color: t.peligro }]}>{error}</Text> : null}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Boton texto="Cancelar" tono="neutro" alTocar={() => setAbierto(false)} />
            </View>
            <View style={{ flex: 1.4 }}>
              <Boton texto="Anotar hasta el cierre" tono="neutro" alTocar={() => void guardar()} />
            </View>
          </View>
        </View>
      ) : null}
    </Ficha>
  )
}

const c = StyleSheet.create({
  texto: { fontFamily: LETRA.texto, fontSize: 14, lineHeight: 20 },
  fuerte: { fontFamily: LETRA.textoFuerte },
  nota: { fontFamily: LETRA.texto, fontSize: 13 },
})
