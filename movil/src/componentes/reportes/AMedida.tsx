import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { apiReportes } from '../../lib/api-reportes'
import { descargar } from '../../lib/archivos'
import { confirmar, avisar } from '../../lib/dialogo'
import { fmtBs } from '../../lib/moneda'
import { periodoDe, PERIODOS, type IdPeriodo, type Periodo } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import type { CampoDinamico, DefinicionReporte, FormatoMedida, FuenteDinamica, ReporteGuardado, ResultadoDinamico, ValorCampo } from '../../lib/tipos'
import { Hoja, OpcionHoja } from '../Hoja'
import Icono from '../Icono'
import { Buscador, ElegirPeriodo, FilaFiltros, HojaFormulario, llano, useDisposicion } from '../kit'
import { Boton, Campo, Cargando, Ficha, Problema } from '../ui'
import { c, Vacio } from './comunes'
import { ATAJOS, num, rangoDeAtajo } from './cuentas'
import { BarrasApiladas, GraficoBarras } from './Grafico'
import { colorSerie, usePaletaDatos } from './paleta'
import { TablaDatos, type Columna } from './Tabla'

/**
 * REPORTES A MEDIDA, como pages/partes/reportes/AMedida.tsx de la web: la
 * tabla dinamica del ERP (motor en backend/app/reporte_dinamico.py).
 *
 * La web ya estaba PENSADA PARA EL TELEFONO (el cliente, 6-oct: "no debo
 * scrollear para seleccionar filtros... la interfaz debe ser la mas
 * sencilla"): todo es una fila de pastillas --el periodo, que mirar, por que
 * agrupar, que medir, los filtros y el reporte guardado-- y el resultado va
 * al centro. Aqui es la misma fila, que se desliza de lado, y cada pastilla
 * abre su hoja desde abajo. El constructor esta completo.
 */

type Fila = ResultadoDinamico['filas'][number]

const INICIAL: DefinicionReporte = { fuente: 'ventas', filas: ['dia'], columna: null, medidas: ['ventas'], filtros: {} }
const TEMPORALES = new Set(['fecha', 'semana', 'mes', 'anio', 'hora', 'dia_semana'])
const ORDEN_GRUPOS = ['Cuándo', 'Qué', 'Quién', 'Cómo']

/** Las cifras de un resultado, como en la web: los dolares de la base, sin pasar por la vista. */
function formatear(formato: FormatoMedida, v: number | null | undefined, corto = false): string {
  if (v === null || v === undefined) return '—'
  const d = corto && (Math.abs(v) >= 100 || Number.isInteger(v)) ? 0 : 2
  switch (formato) {
    case 'dinero':
      return `${v < 0 ? '−' : ''}$${num(Math.abs(v), d)}`
    case 'bs':
      return fmtBs(v, d)
    case 'entero':
      return num(v, 0)
    case 'pct':
      return `${num(v, 1)}%`
    default:
      return num(v, Number.isInteger(v) ? 0 : corto ? 0 : 2)
  }
}

function completar(d: Partial<DefinicionReporte> & { fuente: string; medidas: string[] }): DefinicionReporte {
  return { filas: [], columna: null, filtros: {}, ...d }
}

/** Los campos en el orden en que se piensan: cuando, que, quien, como. */
function ordenados(campos: CampoDinamico[]): CampoDinamico[] {
  const puesto = (x: CampoDinamico) => {
    const i = ORDEN_GRUPOS.indexOf(x.grupo)
    return i < 0 ? ORDEN_GRUPOS.length : i
  }
  return [...campos].sort((a, b) => puesto(a) - puesto(b))
}

/** El periodo de un atajo de la web, aunque el selector de la app no lo tenga ("Esta semana"). */
function periodoDeAtajo(clave: string): Periodo | null {
  if (PERIODOS.some((x) => x.id === clave)) return periodoDe(clave as IdPeriodo)
  const r = rangoDeAtajo(clave)
  if (!r) return null
  return { id: clave as IdPeriodo, ...r, etiqueta: ATAJOS.find((a) => a.clave === clave)?.texto ?? '' }
}

export default function AMedida({ periodo, alCambiarPeriodo }: { periodo: Periodo; alCambiarPeriodo: (p: Periodo) => void }) {
  const t = useTema()
  const [catalogo, setCatalogo] = useState<FuenteDinamica[] | null>(null)
  const [guardados, setGuardados] = useState<ReporteGuardado[]>([])
  const [def, setDef] = useState<DefinicionReporte>(INICIAL)
  // El reporte guardado que esta abierto: "Guardar cambios" lo actualiza.
  const [abierto, setAbierto] = useState<ReporteGuardado | null>(null)
  const [resultado, setResultado] = useState<ResultadoDinamico | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [errorCatalogo, setErrorCatalogo] = useState('')
  const [vuelta, setVuelta] = useState(0)
  // Los valores de cada campo filtrado, para su lista.
  const [valores, setValores] = useState<Record<string, ValorCampo[]>>({})
  const [menu, setMenu] = useState(false)
  const [guardando, setGuardando] = useState<{ comoNuevo: boolean; nombre: string; ocupado: boolean } | null>(null)

  useEffect(() => {
    Promise.all([apiReportes.catalogo(), apiReportes.guardados()])
      .then(([cat, g]) => {
        setCatalogo(cat)
        setGuardados(g)
        setErrorCatalogo('')
        // Si este rol no entra a Ventas, abre en lo primero que si ve.
        if (cat.length && !cat.some((f) => f.id === INICIAL.fuente)) {
          setDef({ fuente: cat[0].id, filas: ['dia'], columna: null, medidas: [cat[0].medidas[0].id], filtros: {} })
        }
      })
      .catch((e) => setErrorCatalogo(e instanceof Error ? e.message : 'No se pudo cargar'))
  }, [vuelta])

  const fuente = catalogo?.find((f) => f.id === def.fuente) ?? null
  const campos = useMemo(() => ordenados(fuente?.campos ?? []), [fuente])
  const nombreCampo = (id: string) => campos.find((x) => x.id === id)?.nombre ?? id

  // Cada cambio vuelve a consultar, con una pausa corta: tocar dos pastillas
  // seguidas no dispara dos consultas.
  const turno = useRef(0)
  useEffect(() => {
    const mio = ++turno.current
    if (!catalogo || def.medidas.length === 0) return
    const espera = setTimeout(() => {
      setCargando(true)
      apiReportes
        .consultar(def, periodo)
        .then((r) => {
          if (mio !== turno.current) return
          setResultado(r)
          setError('')
        })
        .catch((e) => {
          if (mio !== turno.current) return
          setResultado(null)
          setError(e instanceof Error ? e.message : 'No se pudo armar el reporte')
        })
        .finally(() => mio === turno.current && setCargando(false))
    }, 200)
    return () => clearTimeout(espera)
  }, [def, periodo, catalogo])

  // Los valores de los campos filtrados: una vez por campo y periodo.
  const claveValores = (campo: string) => `${def.fuente}|${campo}|${periodo.desde}|${periodo.hasta}`
  const filtrados = Object.keys(def.filtros)
  const llaveFiltrados = filtrados.join('|')
  useEffect(() => {
    for (const campo of llaveFiltrados ? llaveFiltrados.split('|') : []) {
      const clave = `${def.fuente}|${campo}|${periodo.desde}|${periodo.hasta}`
      apiReportes
        .valores(def.fuente, campo, periodo)
        .then((v) => setValores((antes) => (antes[clave] ? antes : { ...antes, [clave]: v })))
        .catch(() => setValores((antes) => (antes[clave] ? antes : { ...antes, [clave]: [] })))
    }
  }, [def.fuente, llaveFiltrados, periodo])

  const cambiar = (parcial: Partial<DefinicionReporte>) => setDef((d) => ({ ...d, ...parcial }))

  const elegirFuente = (id: string) => {
    if (id === def.fuente) return
    const f = catalogo?.find((x) => x.id === id)
    if (!f) return
    setAbierto(null)
    setResultado(null)
    setDef({ fuente: id, filas: ['dia'], columna: null, medidas: [f.medidas[0].id], filtros: {} })
  }

  const abrirGuardado = (id: string) => {
    if (!id) {
      setAbierto(null)
      return
    }
    const g = guardados.find((x) => x.id === id)
    if (!g) return
    // Uno guardado por alguien con mas permisos puede traer costo o margen:
    // aqui solo se piden las medidas que este usuario puede ver.
    const f = catalogo?.find((x) => x.id === g.definicion.fuente)
    const visibles = new Set(f?.medidas.map((m) => m.id))
    const d = completar(g.definicion)
    const medidas = d.medidas.filter((m) => visibles.has(m))
    setDef({ ...d, medidas: medidas.length ? medidas : f ? [f.medidas[0].id] : [] })
    setAbierto(g)
    const p = g.periodo ? periodoDeAtajo(g.periodo) : null
    if (p) alCambiarPeriodo(p)
  }

  const periodoActual = periodo.id as string
  const propio = abierto && !abierto.de_fabrica ? abierto : null

  const guardar = async () => {
    if (!guardando) return
    const nombre = guardando.nombre.trim()
    if (!nombre) return
    const destino = propio && !guardando.comoNuevo ? propio : null
    setGuardando({ ...guardando, ocupado: true })
    try {
      const g = destino
        ? await apiReportes.actualizar(destino.id, nombre, def, periodoActual)
        : await apiReportes.guardar(nombre, def, periodoActual)
      setGuardados(await apiReportes.guardados())
      setAbierto(g)
      setGuardando(null)
    } catch (e) {
      setGuardando((x) => (x ? { ...x, ocupado: false } : x))
      await avisar('No se guardó', e instanceof Error ? e.message : '')
    }
  }

  const borrar = async () => {
    if (!propio) return
    const ok = await confirmar({
      titulo: `¿Borrar «${propio.nombre}»?`,
      texto: 'Se borra para todos los que lo usan. Los datos no se tocan.',
      aceptar: 'Borrar',
      peligro: true,
    })
    if (!ok) return
    try {
      await apiReportes.borrar(propio.id)
      setGuardados(await apiReportes.guardados())
      setAbierto(null)
    } catch (e) {
      await avisar('No se borró', e instanceof Error ? e.message : '')
    }
  }

  const bajar = async () => {
    try {
      await descargar(apiReportes.rutaExportar(def, periodo), `reporte-${def.fuente}-${periodo.desde}-${periodo.hasta}.csv`)
    } catch (e) {
      await avisar('No se descargó', e instanceof Error ? e.message : '')
    }
  }

  if (!catalogo) {
    return errorCatalogo ? <Problema mensaje={errorCatalogo} alReintentar={() => setVuelta((v) => v + 1)} /> : <Cargando />
  }

  // ── Las opciones de cada pastilla ──
  const opcionCampo = (x: CampoDinamico) => ({ valor: x.id, texto: x.nombre, detalle: x.ayuda || x.grupo })
  const libres = (excepto: (string | null | undefined)[]) => campos.filter((x) => !excepto.includes(x.id))
  const [por, yPor] = [def.filas[0] ?? '', def.filas[1] ?? '']
  const [medir, ademas] = [def.medidas[0] ?? '', def.medidas[1] ?? '']
  const medidasDe = fuente?.medidas ?? []
  const propios = guardados.filter((g) => !g.de_fabrica)
  const deFabrica = guardados.filter((g) => g.de_fabrica)
  const textoPeriodo = ATAJOS.find((a) => a.clave === periodoActual)?.texto

  return (
    <View style={{ gap: 12 }}>
      <FilaFiltros>
        <ElegirPeriodo periodo={periodo} alCambiar={alCambiarPeriodo} />
        <PastillaElegir
          etiqueta="Ver"
          valor={def.fuente}
          alCambiar={elegirFuente}
          opciones={catalogo.map((f) => ({ valor: f.id, texto: f.nombre, detalle: f.descripcion }))}
        />
        <PastillaElegir
          etiqueta="Por"
          valor={por}
          alCambiar={(v) => cambiar({ filas: v ? [v, ...(yPor && yPor !== v ? [yPor] : [])] : [], columna: def.columna === v ? null : def.columna })}
          opciones={[{ valor: '', texto: 'Todo junto', detalle: 'Un solo total' }, ...libres([def.columna]).map(opcionCampo)]}
        />
        {por ? (
          <PastillaElegir
            etiqueta="y por"
            valor={yPor}
            alCambiar={(v) => cambiar({ filas: v ? [por, v] : [por] })}
            opciones={[{ valor: '', texto: '—' }, ...libres([por, def.columna]).map(opcionCampo)]}
          />
        ) : null}
        <PastillaElegir
          etiqueta="Comparar"
          valor={def.columna ?? ''}
          alCambiar={(v) => cambiar({ columna: v || null })}
          opciones={[{ valor: '', texto: '—', detalle: 'Sin comparar' }, ...libres([por, yPor]).map(opcionCampo)]}
        />
        <PastillaElegir
          etiqueta="Medir"
          valor={medir}
          alCambiar={(v) => cambiar({ medidas: [v, ...(ademas && ademas !== v ? [ademas] : [])] })}
          opciones={medidasDe.map((m) => ({ valor: m.id, texto: m.nombre, detalle: m.ayuda || undefined }))}
        />
        <PastillaElegir
          etiqueta="y también"
          valor={ademas}
          alCambiar={(v) => cambiar({ medidas: v ? [medir, v] : [medir] })}
          opciones={[
            { valor: '', texto: '—' },
            ...medidasDe.filter((m) => m.id !== medir).map((m) => ({ valor: m.id, texto: m.nombre, detalle: m.ayuda || undefined })),
          ]}
        />
        {filtrados.map((campo) => {
          const elegido = def.filtros[campo]?.[0] ?? ''
          const lista = valores[claveValores(campo)]
          return (
            <PastillaElegir
              key={campo}
              etiqueta={nombreCampo(campo)}
              valor={elegido}
              alCambiar={(v) => {
                if (v === '__cargando__') return
                const filtros = { ...def.filtros }
                if (v === '__quitar__') delete filtros[campo]
                else filtros[campo] = v ? [v] : []
                cambiar({ filtros })
              }}
              opciones={[
                { valor: '', texto: 'Todos' },
                ...(lista ?? []).map((x) => ({ valor: x.valor, texto: x.etiqueta })),
                ...(lista === undefined ? [{ valor: '__cargando__', texto: 'Cargando…' }] : []),
                { valor: '__quitar__', texto: 'Quitar este filtro', peligro: true },
              ]}
            />
          )
        })}
        <PastillaElegir
          etiqueta="Filtrar"
          valor=""
          accion
          alCambiar={(v) => v && cambiar({ filtros: { ...def.filtros, [v]: [] } })}
          opciones={libres(filtrados).map(opcionCampo)}
        />
        {/* El reporte guardado y sus acciones, en la MISMA fila. */}
        <PastillaElegir
          etiqueta="Reporte"
          valor={abierto?.id ?? ''}
          alCambiar={abrirGuardado}
          opciones={[
            { valor: '', texto: 'Nuevo' },
            ...propios.map((g) => ({ valor: g.id, texto: g.nombre, detalle: g.creado_por ? `Lo guardó ${g.creado_por}` : 'Guardado' })),
            ...deFabrica.map((g) => ({ valor: g.id, texto: g.nombre, detalle: 'Listo para usar' })),
          ]}
        />
        <Pressable
          onPress={() => setMenu(true)}
          accessibilityLabel="Guardar o descargar"
          style={({ pressed }) => [ps.pastilla, { backgroundColor: t.superficie, borderColor: t.gris200, transform: [{ scale: pressed ? 0.97 : 1 }] }]}
        >
          <Text style={[ps.etiqueta, { color: t.tinta, fontFamily: LETRA.textoFuerte }]}>Guardar o descargar</Text>
          <Icono nombre="chevron" size={12} color={t.tenue} grosor={2.4} />
        </Pressable>
      </FilaFiltros>

      {error ? (
        <Vacio>{error}</Vacio>
      ) : resultado && resultado.fuente === def.fuente ? (
        <Resultado resultado={resultado} cargando={cargando} />
      ) : (
        <Text style={[c.texto, { color: t.tenue }]}>Armando el reporte...</Text>
      )}

      <Hoja visible={menu} alCerrar={() => setMenu(false)} titulo="Guardar o descargar">
        {propio ? (
          <OpcionHoja
            texto="Guardar cambios"
            alTocar={() => {
              setMenu(false)
              setGuardando({ comoNuevo: false, nombre: propio.nombre, ocupado: false })
            }}
          />
        ) : null}
        <OpcionHoja
          texto={propio ? 'Guardar como otro' : 'Guardar este reporte'}
          alTocar={() => {
            setMenu(false)
            setGuardando({ comoNuevo: true, nombre: '', ocupado: false })
          }}
        />
        <OpcionHoja
          texto="Descargar en Excel"
          detalle="Un CSV que abre Excel o Google Sheets"
          alTocar={() => {
            setMenu(false)
            void bajar()
          }}
        />
        {propio ? (
          <OpcionHoja
            texto="Borrar este reporte"
            peligro
            alTocar={() => {
              setMenu(false)
              void borrar()
            }}
          />
        ) : null}
      </Hoja>

      <HojaFormulario
        visible={guardando != null}
        alCerrar={() => setGuardando(null)}
        titulo={propio && guardando && !guardando.comoNuevo ? 'Guardar cambios' : 'Guardar este reporte'}
        pie={
          <>
            <View style={{ flex: 1 }}>
              <Boton texto="Cancelar" tono="neutro" alTocar={() => setGuardando(null)} />
            </View>
            <View style={{ flex: 1 }}>
              <Boton texto="Guardar" alTocar={() => void guardar()} ocupado={guardando?.ocupado} deshabilitado={!guardando?.nombre.trim()} />
            </View>
          </>
        }
      >
        <Campo
          rotulo="Nombre"
          value={guardando?.nombre ?? ''}
          onChangeText={(v) => setGuardando((x) => (x ? { ...x, nombre: v } : x))}
          placeholder="Ej.: Ventas de la semana por cajera"
          ayuda={textoPeriodo ? `Abrirá con el período «${textoPeriodo}».` : 'Abrirá con el período que esté elegido en ese momento.'}
          maxLength={80}
          returnKeyType="done"
          onSubmitEditing={() => void guardar()}
        />
      </HojaFormulario>
    </View>
  )
}

// ── La pastilla que elige ───────────────────────────────────────────────────

type OpcionPastilla = { valor: string; texto: string; detalle?: string; peligro?: boolean }

/**
 * Una pastilla de la fila que SIEMPRE dice lo que tiene puesto ("Ver ·
 * Ventas", "Por · Día"). Es el `Selector` del kit con una diferencia: ahi la
 * primera opcion es la neutra ("Todas") y no se escribe; aqui la primera es
 * una eleccion de verdad (Ventas, la primera medida) y tiene que verse.
 * `accion`: la pastilla no guarda nada, ofrece algo ("+ Filtrar").
 */
function PastillaElegir({
  etiqueta,
  valor,
  opciones,
  alCambiar,
  accion = false,
}: {
  etiqueta: string
  valor: string
  opciones: OpcionPastilla[]
  alCambiar: (v: string) => void
  accion?: boolean
}) {
  const t = useTema()
  const { alto } = useDisposicion()
  const [abierta, setAbierta] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const elegida = opciones.find((o) => o.valor === valor)
  const neutra = !elegida || elegida.texto === '—'
  const q = llano(busqueda.trim())
  const visibles = q ? opciones.filter((o) => llano(`${o.texto} ${o.detalle ?? ''}`).includes(q)) : opciones
  const cerrar = () => {
    setAbierta(false)
    setBusqueda('')
  }
  return (
    <>
      <Pressable
        onPress={() => setAbierta(true)}
        accessibilityLabel={elegida && !accion ? `${etiqueta}: ${elegida.texto}` : etiqueta}
        style={({ pressed }) => [ps.pastilla, { backgroundColor: t.superficie, borderColor: t.gris200, transform: [{ scale: pressed ? 0.97 : 1 }] }]}
      >
        {accion ? <Text style={[ps.etiqueta, { color: t.suave, fontFamily: LETRA.textoFuerte }]}>+</Text> : null}
        <Text style={[ps.etiqueta, { color: t.tenue }]}>{etiqueta}</Text>
        {!accion && !neutra && elegida ? (
          <>
            <View style={[ps.punto, { backgroundColor: t.acento }]} />
            <Text style={[ps.valor, { color: t.tinta }]} numberOfLines={1}>
              {elegida.texto}
            </Text>
          </>
        ) : null}
        <Icono nombre="chevron" size={12} color={t.tenue} grosor={2.4} />
      </Pressable>
      <Hoja visible={abierta} alCerrar={cerrar} titulo={etiqueta}>
        {opciones.length > 8 ? (
          <View style={{ paddingHorizontal: 4, paddingBottom: 8 }}>
            <Buscador valor={busqueda} alCambiar={setBusqueda} placeholder={`Buscar ${etiqueta.toLowerCase()}`} />
          </View>
        ) : null}
        <ScrollView style={{ maxHeight: alto * 0.58 }} keyboardShouldPersistTaps="handled">
          {visibles.map((o) => (
            <OpcionHoja
              key={o.valor || o.texto}
              texto={o.texto}
              detalle={o.detalle}
              peligro={o.peligro}
              marcada={!accion && o.valor === valor}
              alTocar={() => {
                alCambiar(o.valor)
                cerrar()
              }}
            />
          ))}
          {visibles.length === 0 ? <Text style={[c.nota, { color: t.tenue, padding: 12 }]}>Nada coincide.</Text> : null}
        </ScrollView>
      </Hoja>
    </>
  )
}

// ── El resultado ────────────────────────────────────────────────────────────

function Resultado({ resultado: r, cargando }: { resultado: ResultadoDinamico; cargando: boolean }) {
  const t = useTema()
  const titulo = [
    r.medidas.map((m) => m.nombre).join(' y '),
    r.campos_fila.length ? `por ${r.campos_fila.map((x) => x.nombre.toLowerCase()).join(' y ')}` : '',
    r.columna ? `· comparando ${r.columna.nombre.toLowerCase()}` : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <Ficha style={{ opacity: cargando ? 0.7 : 1 }}>
      <Text style={[c.seccionTitulo, { color: t.tinta }]}>{titulo}</Text>
      <Text style={[c.nota, { color: t.suave, marginTop: 3 }]}>
        {r.etiqueta}
        {r.medidas.some((m) => m.formato === 'dinero') ? ' · en dólares' : ''}
        {cargando ? ' · actualizando…' : ''}
      </Text>

      {/* La cifra que responde la pregunta, antes que cualquier grafico. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 22, rowGap: 6, marginTop: 14, marginBottom: 14 }}>
        {r.medidas.map((m, i) => (
          <View key={m.id}>
            <Text style={{ fontFamily: LETRA.tituloFuerte, fontSize: i === 0 ? 28 : 20, color: i === 0 ? t.tinta : t.suave, letterSpacing: -0.5 }}>
              {formatear(m.formato, r.totales.total[m.id])}
            </Text>
            <Text style={[c.nota, { color: t.suave }]}>
              {m.nombre}
              {m.sumable ? ' en total' : ''}
            </Text>
          </View>
        ))}
      </View>

      {r.truncado ? (
        <View style={{ backgroundColor: t.avisoSuave, borderRadius: 12, borderCurve: 'continuous', padding: 10, marginBottom: 12 }}>
          <Text style={[c.nota, { color: t.avisoFuerte }]}>Se muestran las primeras {r.filas.length} filas. El Excel las trae todas.</Text>
        </View>
      ) : null}
      {r.filas.length === 0 ? (
        <Text style={[c.texto, { color: t.suave, textAlign: 'center', paddingVertical: 18 }]}>No hay datos en este período con estos filtros.</Text>
      ) : (
        <View style={{ gap: 20 }}>
          <Grafica r={r} />
          {r.columna ? <TablaCruzada r={r} /> : r.campos_fila.length > 0 ? <TablaSimple r={r} /> : null}
        </View>
      )}
    </Ficha>
  )
}

function Grafica({ r }: { r: ResultadoDinamico }) {
  const p = usePaletaDatos()
  const m = r.medidas[0]
  if (r.campos_fila.length !== 1 || r.filas.length < 2 || !m) return null
  const campo = r.campos_fila[0]
  const fmt = (n: number) => formatear(m.formato, n, true)
  // Bajo las barras, las fechas sin el año cuando todas son del mismo.
  const anios = new Set(r.filas.map((f) => /\/(\d{4})$/.exec(f.etiquetas[0])?.[1] ?? '-'))
  const sinAnio = anios.size === 1 && !anios.has('-')
  const etiqueta = (f: Fila) => (sinAnio ? f.etiquetas[0].replace(/\/\d{4}$/, '') : f.etiquetas[0])

  // Comparando, y la medida se puede sumar: cada fila es una barra partida en sus partes.
  if (r.columna) {
    if (!m.sumable) return null
    const partes = r.columna.valores
    const filas = (campo.tipo === 'texto' ? r.filas.slice(0, 15) : r.filas).map((f) => ({
      nombre: etiqueta(f),
      partes: partes.map((x, i) => ({ nombre: x.etiqueta, valor: f.por_columna?.[x.valor]?.[m.id] ?? 0, color: colorSerie(p, i) })),
    }))
    return <BarrasApiladas filas={filas} formato={fmt} leyenda={partes.map((x, i) => ({ nombre: x.etiqueta, color: colorSerie(p, i) }))} />
  }

  // Un orden propio (dias, horas, semanas): barras verticales con su eje; la
  // segunda medida, si la hay, encima como linea.
  if (TEMPORALES.has(campo.tipo)) {
    const otra = r.medidas[1]
    return (
      <GraficoBarras
        alto={220}
        ejeY
        datos={r.filas.map((f) => ({ etiqueta: etiqueta(f), valor: f.total[m.id] ?? 0 }))}
        formato={(n) => formatear(m.formato, n)}
        formatoEje={fmt}
        nombres={{ actual: m.nombre, anterior: '' }}
        lineas={otra ? [{ nombre: otra.nombre, valores: r.filas.map((f) => f.total[otra.id] ?? null) }] : undefined}
        formatoDerecha={otra ? (n) => formatear(otra.formato, n, true) : undefined}
      />
    )
  }

  // Nombres (productos, cajeras, proveedores): barras acostadas, de mayor a menor.
  const filas = r.filas.slice(0, 15).map((f) => ({
    nombre: etiqueta(f),
    partes: [{ nombre: m.nombre, valor: Math.max(f.total[m.id] ?? 0, 0), color: colorSerie(p, 0) }],
  }))
  return <BarrasApiladas filas={filas} formato={fmt} />
}

function TablaSimple({ r }: { r: ResultadoDinamico }) {
  const columnas: Columna<Fila>[] = [
    ...r.campos_fila.map((cf, i) => ({
      clave: `f${i}`,
      titulo: cf.nombre,
      ancho: i === 0 ? 130 : 120,
      // Las fechas y horas se ordenan por su clave (2026-10-05, 8), no por el texto.
      orden: (f: Fila) => (cf.tipo === 'texto' ? f.etiquetas[i] : f.claves[i].padStart(12, '0')),
      celda: (f: Fila) => f.etiquetas[i],
    })),
    ...r.medidas.map((m) => ({
      clave: m.id,
      titulo: m.nombre,
      ancho: 120,
      derecha: true,
      orden: (f: Fila) => f.total[m.id] ?? null,
      celda: (f: Fila) => formatear(m.formato, f.total[m.id]),
    })),
  ]
  const pie = [
    'Total',
    ...r.campos_fila.slice(1).map(() => ''),
    ...r.medidas.map((m) => formatear(m.formato, r.totales.total[m.id])),
  ]
  return <TablaDatos<Fila> columnas={columnas} filas={r.filas} claveFila={(f) => f.claves.join('|')} pie={pie} />
}

/**
 * Una tabla cruzada no se puede apilar en fichas sin perder el cruce: se
 * desliza de lado dentro de su losa y la primera columna queda fija.
 */
function TablaCruzada({ r }: { r: ResultadoDinamico }) {
  const columna = r.columna!
  const varias = r.medidas.length > 1
  const columnas: Columna<Fila>[] = [
    ...r.campos_fila.map((cf, i) => ({ clave: `f${i}`, titulo: cf.nombre, ancho: i === 0 ? 120 : 110, celda: (f: Fila) => f.etiquetas[i] })),
    ...columna.valores.flatMap((v) =>
      r.medidas.map((m) => ({
        clave: `${v.valor}-${m.id}`,
        titulo: varias ? `${v.etiqueta} · ${m.nombre}` : v.etiqueta,
        ancho: varias ? 140 : 110,
        derecha: true,
        celda: (f: Fila) => formatear(m.formato, f.por_columna?.[v.valor]?.[m.id]),
      })),
    ),
    ...r.medidas.map((m) => ({
      clave: `total-${m.id}`,
      titulo: varias ? `Total · ${m.nombre}` : 'Total',
      ancho: varias ? 140 : 110,
      derecha: true,
      fuerte: true,
      celda: (f: Fila) => formatear(m.formato, f.total[m.id]),
    })),
  ]
  const pie = [
    'Total',
    ...r.campos_fila.slice(1).map(() => ''),
    ...columna.valores.flatMap((v) => r.medidas.map((m) => formatear(m.formato, r.totales.por_columna?.[v.valor]?.[m.id]))),
    ...r.medidas.map((m) => formatear(m.formato, r.totales.total[m.id])),
  ]
  // Sin "Por": una sola fila, la del total, con su rotulo.
  if (r.campos_fila.length === 0) columnas.unshift({ clave: 'todo', titulo: '', ancho: 110, celda: () => 'Todo junto' })
  return <TablaDatos<Fila> columnas={columnas} filas={r.filas} claveFila={(f, i) => f.claves.join('|') || String(i)} pie={pie} />
}

const ps = StyleSheet.create({
  pastilla: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    paddingHorizontal: 13,
    maxWidth: 260,
  },
  etiqueta: { fontFamily: LETRA.texto, fontSize: 14 },
  valor: { fontFamily: LETRA.textoFuerte, fontSize: 14, flexShrink: 1 },
  punto: { width: 6, height: 6, borderRadius: 3 },
})
