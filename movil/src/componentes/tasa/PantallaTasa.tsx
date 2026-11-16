import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiTasa } from '../../lib/api-tasa'
import { useMoneda } from '../../lib/moneda'
import { aNumero, periodoDe, type Periodo } from '../../lib/numeros'
import type { AnalisisTasa, EstadoTasa, PuntoTasa } from '../../lib/tipos'
import { ElegirPeriodo, FilaFiltros } from '../kit'
import { Cargando, Pantalla, Pestanas, Problema } from '../ui'
import Analisis from './Analisis'
import Calculadora from './Calculadora'
import Historial from './Historial'
import Hoy from './Hoy'

type IdSeccion = 'hoy' | 'calculadora' | 'analisis' | 'historial'

const SECCIONES: { id: IdSeccion; texto: string }[] = [
  { id: 'hoy', texto: 'Tasa de hoy' },
  { id: 'calculadora', texto: 'Calculadora' },
  { id: 'analisis', texto: 'Análisis' },
  { id: 'historial', texto: 'Historial' },
]

const seccionValida = (s: string | undefined): IdSeccion => (SECCIONES.some((x) => x.id === s) ? (s as IdSeccion) : 'hoy')

/** Una tasa escrita a mano, como numero: "145,80" o "145.80". */
const comoTexto = (n: number | null | undefined) => (n ? String(n).replace('.', ',') : '')

/**
 * TASA DE CAMBIO, como pages/Tasa.tsx de la web, en sus cuatro secciones:
 * la de hoy (y cargarla a mano), la calculadora, el analisis del periodo y
 * el historial. El periodo (30 dias al entrar, como la web) manda en
 * Analisis e Historial; la tasa de hoy no tiene periodo. La seccion va en la
 * ruta: /tasa/analisis.
 */
export default function PantallaTasa() {
  const { recargar } = useMoneda()
  const { seccion: pedida } = useLocalSearchParams<{ seccion?: string }>()
  const [seccion, setSeccion] = useState<IdSeccion>(() => seccionValida(pedida))
  const [pedidaAntes, setPedidaAntes] = useState(pedida)
  if (pedida !== pedidaAntes) {
    setPedidaAntes(pedida)
    setSeccion(seccionValida(pedida))
  }
  const irA = (id: IdSeccion) => {
    setSeccion(id)
    router.setParams({ seccion: id })
  }

  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDe('30d'))
  const [estado, setEstado] = useState<EstadoTasa | null>(null)
  // Los ultimos 30 dias con tasa, para la tendencia de "hoy": aparte del
  // historial porque ese sigue el periodo y la tendencia no.
  const [tendencia, setTendencia] = useState<PuntoTasa[]>([])
  const [historial, setHistorial] = useState<PuntoTasa[] | null>(null)
  const [analisis, setAnalisis] = useState<AnalisisTasa | null>(null)
  const [errorAnalisis, setErrorAnalisis] = useState('')
  const [errorCarga, setErrorCarga] = useState('')
  const [refrescando, setRefrescando] = useState(false)
  const [vuelta, setVuelta] = useState(0)

  const [manual, setManual] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')

  const montada = useRef(false)
  useFocusEffect(
    useCallback(() => {
      if (montada.current) setVuelta((v) => v + 1)
      montada.current = true
    }, []),
  )

  useEffect(() => {
    let vigente = true
    const rango = { desde: periodo.desde, hasta: periodo.hasta }
    Promise.all([
      apiTasa.estado().then((e) => {
        if (!vigente) return
        setEstado(e)
        setManual(comoTexto(e.bcv))
      }),
      apiTasa
        .historial()
        .then((h) => vigente && setTendencia([...h].sort((a, b) => a.fecha.localeCompare(b.fecha))))
        .catch(() => vigente && setTendencia([])),
      apiTasa.historial(rango).then((h) => vigente && setHistorial(h)),
      apiTasa
        .analisis(rango)
        .then((a) => {
          if (!vigente) return
          setAnalisis(a)
          setErrorAnalisis('')
        })
        .catch((e) => {
          if (!vigente) return
          setAnalisis(null)
          setErrorAnalisis(e instanceof Error ? e.message : 'No se pudo cargar el análisis')
        }),
    ])
      .then(() => vigente && setErrorCarga(''))
      .catch((e) => vigente && setErrorCarga(e instanceof Error ? e.message : 'No se pudo cargar la tasa'))
      .finally(() => vigente && setRefrescando(false))
    return () => {
      vigente = false
    }
  }, [periodo.desde, periodo.hasta, vuelta])

  async function accion(fn: () => Promise<EstadoTasa>, mensaje: string) {
    setOcupado(true)
    setError('')
    setAviso('')
    try {
      const e = await fn()
      setEstado(e)
      setManual(comoTexto(e.bcv))
      setAviso(mensaje)
      // La moneda de toda la app (el selector de arriba) se pone al dia.
      recargar()
      apiTasa
        .historial({ desde: periodo.desde, hasta: periodo.hasta })
        .then(setHistorial)
        .catch(() => undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo actualizar la tasa')
    } finally {
      setOcupado(false)
    }
  }

  function guardarManual() {
    const valor = aNumero(manual)
    if (!valor || valor <= 0) {
      setAviso('')
      setError('Escribe una tasa válida, por ejemplo 145,80')
      return
    }
    void accion(() => apiTasa.fijar(valor), 'Tasa fijada. Los cobros de hoy usan esta.')
  }

  return (
    <Pantalla
      refrescando={refrescando}
      alRefrescar={() => {
        setRefrescando(true)
        setVuelta((v) => v + 1)
      }}
      arriba={<Pestanas opciones={SECCIONES} valor={seccion} alCambiar={irA} />}
    >
      <Stack.Screen options={{ title: 'Tasa de cambio' }} />
      {seccion === 'analisis' || seccion === 'historial' ? (
        <FilaFiltros>
          <ElegirPeriodo periodo={periodo} alCambiar={setPeriodo} />
        </FilaFiltros>
      ) : null}

      {errorCarga && !estado ? <Problema mensaje={errorCarga} alReintentar={() => setVuelta((v) => v + 1)} /> : null}
      {!estado && !errorCarga ? <Cargando /> : null}

      {seccion === 'hoy' && estado ? (
        <Hoy
          estado={estado}
          tendencia={tendencia}
          manual={manual}
          alCambiarManual={setManual}
          ocupado={ocupado}
          error={error}
          aviso={aviso}
          alFijar={guardarManual}
          alConsultar={() => void accion(() => apiTasa.refrescar(false), 'Tasas actualizadas.')}
          alVolverAutomatica={() => void accion(() => apiTasa.refrescar(true), 'Volviste a la tasa automatica del BCV.')}
        />
      ) : null}
      {seccion === 'calculadora' && estado ? <Calculadora estado={estado} /> : null}
      {seccion === 'analisis' && estado ? (
        analisis ? (
          <Analisis analisis={analisis} />
        ) : errorAnalisis ? (
          <Problema mensaje={errorAnalisis} alReintentar={() => setVuelta((v) => v + 1)} />
        ) : (
          <Cargando />
        )
      ) : null}
      {seccion === 'historial' && estado ? historial ? <Historial historial={historial} /> : <Cargando /> : null}
    </Pantalla>
  )
}
