import { router, Stack } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Text, View } from 'react-native'
import { unidadDe } from '../../../../../frontend/src/lib/inventario'
import { convertirTexto, factorEntre } from '../../../../../frontend/src/lib/unidades'
import { AccionesPlanilla, PlanillaLeidaCaja } from '../../../componentes/conteo/Planilla'
import RenglonConteo from '../../../componentes/conteo/RenglonConteo'
import { BarraAccion, Buscador, llano, PantallaLista } from '../../../componentes/kit'
import { fmtCant } from '../../../componentes/preparaciones/cuentas'
import { mensajeDe } from '../../../componentes/preparaciones/piezas'
import { Aviso, Cargando, Ficha, Interruptor, Nota, Problema } from '../../../componentes/ui'
import { apiPreparaciones } from '../../../lib/api-preparaciones'
import { avisar, confirmar } from '../../../lib/dialogo'
import { useMoneda } from '../../../lib/moneda'
import { aNumero } from '../../../lib/numeros'
import { LETRA, useTema } from '../../../lib/tema'
import type { Ingrediente, PlanillaLeida, ResultadoConteo } from '../../../lib/tipos'

/**
 * EL CONTEO FISICO (`ConteoFisico` de la web): se recorre el inventario y se
 * anota lo que hay de cada cosa, crudo y preparado, TODO de una vez. Lo que
 * se deja en blanco no se toca. Se guarda una sola vez, y el sistema
 * registra cada diferencia como merma o sobrante con su asiento. El
 * preparado que se descuenta del crudo ("hay 1 kg de guiso") se traduce a
 * crudo por la receta.
 *
 * En la web es un dialogo grande; aqui, su pantalla, con la lista larga en
 * FlatList y "Guardar conteo" fijo abajo.
 */
export default function ConteoFisico() {
  const t = useTema()
  const { fmt: dinero } = useMoneda()
  const [ingredientes, setIngredientes] = useState<Ingrediente[] | null>(null)
  const [errorCarga, setErrorCarga] = useState('')
  const [valores, setValores] = useState<Record<number, string>>({})
  // En que unidad se escribe cada renglon (kg ⇄ g). Lo que se guarda va
  // siempre en la de la ficha.
  const [vistas, setVistas] = useState<Record<number, string>>({})
  const [buscar, setBuscar] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  // Encendido por defecto: el conteo que sirve es el que se hace sin ver lo
  // que el sistema espera. Se puede apagar, pero hay que decidirlo.
  const [ciego, setCiego] = useState(true)
  const [leido, setLeido] = useState<PlanillaLeida | null>(null)

  const pedir = useCallback(() => {
    apiPreparaciones
      .ingredientes()
      .then((l) => {
        setErrorCarga('')
        setIngredientes(l.filter((i) => i.activo !== false))
      })
      .catch((e: unknown) => setErrorCarga(mensajeDe(e, 'No se pudo traer la mercancía')))
  }, [])
  useEffect(() => {
    pedir()
  }, [pedir])

  const vistaDe = useCallback((i: Ingrediente) => vistas[i.id] ?? i.unidad, [vistas])
  const todos = useMemo(() => ingredientes ?? [], [ingredientes])

  const lista = useMemo(() => {
    const q = llano(buscar.trim())
    return [...todos].filter((i) => !q || llano(i.nombre).includes(q)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }, [todos, buscar])

  const contados = todos
    .map((i) => ({ ing: i, texto: valores[i.id] ?? '' }))
    .filter((x) => x.texto.trim() !== '')
    .map((x) => ({ ing: x.ing, real: aNumero(x.texto) / factorEntre(x.ing.unidad, vistaDe(x.ing)) }))
  const invalidos = contados.filter((c) => !Number.isFinite(c.real) || c.real < 0)
  const diferencias = contados
    .filter((c) => Number.isFinite(c.real) && c.real >= 0)
    .map((c) => ({ ...c, dif: c.real - c.ing.stock_actual, valor: Math.abs(c.real - c.ing.stock_actual) * (c.ing.costo_unitario || 0) }))
  const faltante = diferencias.filter((d) => d.dif < 0).reduce((s, d) => s + d.valor, 0)
  const sobrante = diferencias.filter((d) => d.dif > 0).reduce((s, d) => s + d.valor, 0)

  const escribir = useCallback((id: number, texto: string) => setValores((v) => ({ ...v, [id]: texto })), [])
  const cambiarVista = useCallback(
    (ing: Ingrediente, nueva: string) => {
      const vista = vistas[ing.id] ?? ing.unidad
      setValores((v) => ({ ...v, [ing.id]: convertirTexto(v[ing.id] ?? '', ing.unidad, vista, nueva) }))
      setVistas((v) => ({ ...v, [ing.id]: nueva }))
    },
    [vistas],
  )

  function planillaLeida(r: PlanillaLeida) {
    setError('')
    setLeido(r)
    // Se rellenan las casillas en vez de guardar: el archivo lo lleno alguien
    // en el inventario y nadie lo ha mirado todavia en pantalla. Vienen en la
    // unidad de cada ficha.
    setValores((v) => ({ ...v, ...Object.fromEntries(r.filas.map((f) => [f.ingrediente_id, String(f.contado)])) }))
    setVistas((v) => {
      const n = { ...v }
      for (const fila of r.filas) delete n[fila.ingrediente_id]
      return n
    })
  }

  function volver() {
    if (router.canGoBack()) router.back()
    else router.replace('/')
  }

  /** Lo que la web dice al guardar (`conteoGuardado` de pages/Inventario.tsx). */
  async function guardado(r: ResultadoConteo) {
    const lineas = r.ajustes
      .slice(0, 8)
      .map((a) => `${a.nombre}: ${a.diferencia > 0 ? '+' : ''}${fmtCant(a.diferencia)} ${unidadDe(a.diferencia, a.unidad)} (${dinero(a.valor)})`)
      .join('\n')
    const noContadas = r.no_contadas?.length
      ? `\n\nOjo: el preparado contado llevaba ${r.no_contadas.join(', ')}, que no se contó: esa parte no se tradujo.`
      : ''
    await avisar(
      r.ajustes.length === 0 ? 'El conteo cuadró' : 'Conteo guardado',
      (r.ajustes.length === 0
        ? `Las ${r.sin_cambio} mercancías contadas coinciden con el sistema.`
        : `${r.ajustes.length} ajuste(s) · faltante ${dinero(r.faltante_valor)} (queda como merma) · sobrante ${dinero(r.sobrante_valor)}` +
          (r.sin_cambio ? ` · ${r.sin_cambio} cuadraron` : '') +
          `\n\n${lineas}${r.ajustes.length > 8 ? '\n…' : ''}`) + noContadas,
    )
    volver()
  }

  async function guardar() {
    setError('')
    if (invalidos.length) return setError('Hay cantidades que no son números o son negativas.')
    if (contados.length === 0) return
    // A ciegas el resumen se revela aqui y no antes: si el total de faltante
    // se ve mientras se teclea, ya no es un conteo a ciegas.
    const ok = await confirmar({
      titulo: `¿Guardar el conteo de ${contados.length} mercancía(s)?`,
      texto:
        `Faltante: ${dinero(faltante)} (queda como merma) · Sobrante: ${dinero(sobrante)}.\n\n` +
        'Lo que dice la balanza manda sobre lo que dice el sistema. Lo que dejaste en blanco no se toca.',
      aceptar: 'Guardar conteo',
    })
    if (!ok) return
    setGuardando(true)
    try {
      const r = await apiPreparaciones.contar(
        contados.map((c) => ({ ingrediente_id: c.ing.id, stock_real: c.real })),
        ciego,
      )
      setGuardando(false)
      await guardado(r)
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo guardar el conteo'))
      setGuardando(false)
    }
  }

  const cabecera = (
    <View style={{ gap: 12 }}>
      <Nota>Anota lo que hay de verdad de cada mercancía. Lo que dejes en blanco no cambia.</Nota>
      {error ? <Aviso texto={error} tono="peligro" /> : null}
      <Buscador valor={buscar} alCambiar={setBuscar} placeholder="Buscar…" />
      <AccionesPlanilla alLeer={planillaLeida} alFallar={(m) => {
          setLeido(null)
          setError(m)
        }}
      />
      {leido ? <PlanillaLeidaCaja leido={leido} /> : null}
      {/* El interruptor que hace que el conteo sirva para auditar. Contar
          teniendo delante el numero que el sistema espera no prueba nada: el
          ojo acomoda la cifra al numero que ya leyo. Viene encendido. */}
      <Ficha style={{ paddingVertical: 8 }}>
        <Interruptor
          texto="Contar a ciegas"
          detalle="Esconde lo que el sistema espera mientras se cuenta. Las diferencias aparecen al guardar. Es la única forma de que el conteo pruebe algo."
          valor={ciego}
          alCambiar={setCiego}
        />
      </Ficha>
      {!ingredientes ? errorCarga ? <Problema mensaje={errorCarga} alReintentar={pedir} /> : <Cargando /> : null}
    </View>
  )

  return (
    <>
    <Stack.Screen options={{ title: 'Conteo físico' }} />
    <PantallaLista
      cabecera={cabecera}
      datos={lista}
      clave={(i) => String(i.id)}
      renglon={({ item }) => (
        <View style={{ backgroundColor: t.superficie }}>
          <RenglonConteo
            ing={item}
            texto={valores[item.id] ?? ''}
            vista={vistaDe(item)}
            ciego={ciego}
            alEscribir={escribir}
            alCambiarVista={cambiarVista}
            dinero={dinero}
          />
        </View>
      )}
      vacio={ingredientes ? <Nota style={{ textAlign: 'center', paddingVertical: 20 }}>Nada coincide.</Nota> : undefined}
      abajo={
        <BarraAccion
          izquierda={
            <Text style={{ fontFamily: LETRA.texto, fontSize: 13.5, color: t.suave }}>
              <Text style={{ fontFamily: LETRA.cifraFuerte, color: t.tinta }}>{contados.length}</Text> contado(s)
              {/* A ciegas tampoco se adelantan los totales: ver "faltante $40"
                  mientras se teclea delata el resultado igual que la columna. */}
              {!ciego && diferencias.length > 0 ? (
                <>
                  {' · '}faltante <Text style={{ fontFamily: LETRA.cifraFuerte, color: t.peligro }}>{dinero(faltante)}</Text>
                  {' · '}sobrante <Text style={{ fontFamily: LETRA.cifraFuerte, color: t.exito }}>{dinero(sobrante)}</Text>
                </>
              ) : null}
            </Text>
          }
          texto="Guardar conteo"
          alTocar={() => void guardar()}
          ocupado={guardando}
          deshabilitado={contados.length === 0}
        />
      }
    />
    </>
  )
}
