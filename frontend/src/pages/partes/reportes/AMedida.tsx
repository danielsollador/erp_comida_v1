import { useEffect, useMemo, useRef, useState } from 'react'
import BarraFiltros from '../../../components/BarraFiltros'
import MenuAcciones from '../../../components/MenuAcciones'
import { useDialogo } from '../../../components/dialogo'
import { BarrasApiladas, GraficoBarras } from '../../../components/Grafico'
import { Tabla, Th, useOrden } from '../../../components/Tabla'
import { FiltroDesplegable, Seccion } from '../../../components/ui'
import { api } from '../../../lib/api'
import { ATAJOS, rangoDe, type ClaveRango, type Rango } from '../../../lib/fechas'
import { fmtBs, fmtNum } from '../../../lib/moneda'
import { colorSerie } from '../../../lib/paleta'
import type {
  CampoDinamico,
  DefinicionReporte,
  FormatoMedida,
  FuenteDinamica,
  ReporteGuardado,
  ResultadoDinamico,
  ValorCampo,
} from '../../../lib/types'
import { Vacio } from './comunes'

/**
 * Reportes a medida: la tabla dinamica del ERP (motor en
 * backend/app/reporte_dinamico.py).
 *
 * PENSADA PARA EL TELEFONO (el cliente, 6-oct): "no debo scrollear para
 * seleccionar filtros ni nada... todo se ve demasiado tecnico... la interfaz
 * debe ser la mas sencilla y completa que exista". Por eso:
 *
 *  - TODO ES UNA FILA DE PASTILLAS, la misma `BarraFiltros` de los demas
 *    modulos: el periodo, que mirar (Ventas, Compras, Inventario... los
 *    modulos del ERP), por que agrupar, que medir y los filtros. Cada pastilla
 *    dice lo que tiene puesto ("Por Día", "Medir Total vendido") y se toca
 *    para cambiarlo. No hay un formulario que recorrer antes de ver algo.
 *  - LAS PALABRAS SON LAS DEL NEGOCIO: "Por", "Comparar", "Medir", y una
 *    sola lista de conceptos para todos los modulos (Persona, Producto,
 *    Forma de pago...). Nada de "dimension", "fila", "columna" ni "medida".
 *  - EL RESULTADO VA AL CENTRO: la cifra grande, el grafico y la tabla.
 *
 * Todo se agrupa en el servidor: la tablet recibe solo el resultado.
 */

const INICIAL: DefinicionReporte = { fuente: 'ventas', filas: ['dia'], columna: null, medidas: ['ventas'], filtros: {} }
const TEMPORALES = new Set(['fecha', 'semana', 'mes', 'anio', 'hora', 'dia_semana'])
const ORDEN_GRUPOS = ['Cuándo', 'Qué', 'Quién', 'Cómo']

function formatear(formato: FormatoMedida, v: number | null | undefined, corto = false): string {
  if (v === null || v === undefined) return '—'
  const d = corto && Math.abs(v) >= 100 ? 0 : 2
  switch (formato) {
    case 'dinero':
      return `${v < 0 ? '-' : ''}$${fmtNum(Math.abs(v), d)}`
    case 'bs':
      return fmtBs(v, d)
    case 'entero':
      return fmtNum(v, 0)
    case 'pct':
      return `${fmtNum(v, 1)}%`
    default:
      return fmtNum(v, Number.isInteger(v) ? 0 : corto ? 0 : 2)
  }
}

function completar(d: Partial<DefinicionReporte> & { fuente: string; medidas: string[] }): DefinicionReporte {
  return { filas: [], columna: null, filtros: {}, ...d }
}

/** Los campos en el orden en que se piensan: cuando, que, quien, como. */
function ordenados(campos: CampoDinamico[]): CampoDinamico[] {
  const puesto = (c: CampoDinamico) => {
    const i = ORDEN_GRUPOS.indexOf(c.grupo)
    return i < 0 ? ORDEN_GRUPOS.length : i
  }
  return [...campos].sort((a, b) => puesto(a) - puesto(b))
}

export default function AMedida({ rango, alCambiarRango }: { rango: Rango; alCambiarRango: (r: Rango) => void }) {
  const dialogo = useDialogo()
  const [catalogo, setCatalogo] = useState<FuenteDinamica[] | null>(null)
  const [guardados, setGuardados] = useState<ReporteGuardado[]>([])
  const [def, setDef] = useState<DefinicionReporte>(INICIAL)
  // El reporte guardado que esta abierto: "Guardar" lo actualiza.
  const [abierto, setAbierto] = useState<ReporteGuardado | null>(null)
  const [resultado, setResultado] = useState<ResultadoDinamico | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  // Los valores de cada campo filtrado, para su desplegable.
  const [valores, setValores] = useState<Record<string, ValorCampo[]>>({})

  useEffect(() => {
    Promise.all([api.catalogoReportes(), api.reportesGuardados()])
      .then(([c, g]) => {
        setCatalogo(c)
        setGuardados(g)
        // Si este rol no entra a Ventas, abre en lo primero que si ve.
        if (c.length && !c.some((f) => f.id === INICIAL.fuente)) {
          setDef({ fuente: c[0].id, filas: ['dia'], columna: null, medidas: [c[0].medidas[0].id], filtros: {} })
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar'))
  }, [])

  const fuente = catalogo?.find((f) => f.id === def.fuente) ?? null
  const campos = useMemo(() => ordenados(fuente?.campos ?? []), [fuente])
  const nombreCampo = (id: string) => campos.find((c) => c.id === id)?.nombre ?? id

  // Cada cambio vuelve a consultar, con una pausa corta: cambiar dos
  // pastillas seguidas no tiene por que disparar dos consultas.
  const turno = useRef(0)
  useEffect(() => {
    const mio = ++turno.current
    if (!catalogo || def.medidas.length === 0) return
    setCargando(true)
    const t = setTimeout(() => {
      api
        .consultarReporte(def, rango)
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
    return () => clearTimeout(t)
  }, [def, rango, catalogo])

  // Los valores de los campos filtrados: una vez por campo y periodo.
  const claveValores = (campo: string) => `${def.fuente}|${campo}|${rango.desde}|${rango.hasta}`
  const filtrados = Object.keys(def.filtros)
  useEffect(() => {
    for (const campo of filtrados) {
      const clave = claveValores(campo)
      if (valores[clave]) continue
      api
        .valoresDeCampo(def.fuente, campo, rango)
        .then((v) => setValores((antes) => ({ ...antes, [clave]: v })))
        .catch(() => setValores((antes) => ({ ...antes, [clave]: [] })))
    }
    // `claveValores` y `valores` cambian con lo de abajo; pedir de nuevo lo
    // que ya se tiene es justo lo que este efecto evita.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [def.fuente, filtrados.join('|'), rango.desde, rango.hasta])

  const cambiar = (parcial: Partial<DefinicionReporte>) => setDef((d) => ({ ...d, ...parcial }))

  const elegirFuente = (id: string) => {
    if (id === def.fuente) return
    const f = catalogo?.find((x) => x.id === id)
    if (!f) return
    setAbierto(null)
    setResultado(null)
    setDef({ fuente: id, filas: ['dia'], columna: null, medidas: [f.medidas[0].id], filtros: {} })
  }

  const abrir = (id: string) => {
    if (!id) {
      setAbierto(null)
      return
    }
    const g = guardados.find((x) => x.id === id)
    if (!g) return
    // Un reporte guardado por alguien con mas permisos puede traer costo o
    // ganancia: aqui solo se piden las medidas que este usuario puede ver.
    const f = catalogo?.find((x) => x.id === g.definicion.fuente)
    const visibles = new Set(f?.medidas.map((m) => m.id))
    const d = completar(g.definicion)
    const medidas = d.medidas.filter((m) => visibles.has(m))
    setDef({ ...d, medidas: medidas.length ? medidas : f ? [f.medidas[0].id] : [] })
    setAbierto(g)
    if (g.periodo && ATAJOS.some((a) => a.clave === g.periodo)) alCambiarRango(rangoDe(g.periodo as ClaveRango))
  }

  const periodoActual = rango.clave === 'personal' ? null : rango.clave

  const guardar = async (comoNuevo: boolean) => {
    const propio = abierto && !abierto.de_fabrica && !comoNuevo ? abierto : null
    const nombre = await dialogo.pedirTexto({
      titulo: propio ? 'Guardar cambios' : 'Guardar este reporte',
      etiqueta: 'Nombre',
      valor: propio?.nombre ?? '',
      placeholder: 'Ej.: Ventas de la semana por cajera',
      ayuda: periodoActual
        ? `Abrirá con el período «${ATAJOS.find((a) => a.clave === periodoActual)?.texto}».`
        : 'Abrirá con el período que esté elegido en ese momento.',
      aceptar: 'Guardar',
    })
    if (!nombre) return
    try {
      const g = propio
        ? await api.actualizarReporte(propio.id, nombre, def, periodoActual)
        : await api.guardarReporte(nombre, def, periodoActual)
      setGuardados(await api.reportesGuardados())
      setAbierto(g)
    } catch (e) {
      await dialogo.avisar({ titulo: 'No se guardó', texto: e instanceof Error ? e.message : '', tono: 'mal' })
    }
  }

  const borrar = async () => {
    if (!abierto || abierto.de_fabrica) return
    const ok = await dialogo.confirmar({
      titulo: `¿Borrar «${abierto.nombre}»?`,
      texto: 'Se borra para todos los que lo usan. Los datos no se tocan.',
      aceptar: 'Borrar',
      peligro: true,
    })
    if (!ok) return
    try {
      await api.borrarReporte(abierto.id)
      setGuardados(await api.reportesGuardados())
      setAbierto(null)
    } catch (e) {
      await dialogo.avisar({ titulo: 'No se borró', texto: e instanceof Error ? e.message : '', tono: 'mal' })
    }
  }

  if (!catalogo) {
    return error ? <p className="text-peligro-600 text-sm">{error}</p> : <p className="text-neutral-400 text-sm">Cargando...</p>
  }

  // ── Las opciones de cada pastilla ─────────────────────────────────────────
  const opcionCampo = (c: CampoDinamico) => ({ valor: c.id, texto: c.nombre, detalle: c.ayuda || c.grupo })
  const libres = (excepto: (string | null | undefined)[]) => campos.filter((c) => !excepto.includes(c.id))
  const [por, yPor] = [def.filas[0] ?? '', def.filas[1] ?? '']
  const [medir, ademas] = [def.medidas[0] ?? '', def.medidas[1] ?? '']
  const medidasDe = fuente?.medidas ?? []

  const propios = guardados.filter((g) => !g.de_fabrica)
  const deFabrica = guardados.filter((g) => g.de_fabrica)

  return (
    <div className="space-y-4">
      <BarraFiltros rango={rango} alCambiar={alCambiarRango}>
        <FiltroDesplegable
          etiqueta="Ver"
          valor={def.fuente}
          alCambiar={elegirFuente}
          opciones={catalogo.map((f) => ({ valor: f.id, texto: f.nombre, detalle: f.descripcion }))}
        />
        <FiltroDesplegable
          etiqueta="Por"
          valor={por}
          alCambiar={(v) => cambiar({ filas: v ? [v, ...(yPor && yPor !== v ? [yPor] : [])] : [], columna: def.columna === v ? null : def.columna })}
          opciones={[{ valor: '', texto: 'Todo junto', detalle: 'Un solo total' }, ...libres([def.columna]).map(opcionCampo)]}
        />
        {por && (
          <FiltroDesplegable
            etiqueta="y por"
            valor={yPor}
            alCambiar={(v) => cambiar({ filas: v ? [por, v] : [por] })}
            opciones={[{ valor: '', texto: '—' }, ...libres([por, def.columna]).map(opcionCampo)]}
          />
        )}
        <FiltroDesplegable
          etiqueta="Comparar"
          valor={def.columna ?? ''}
          alCambiar={(v) => cambiar({ columna: v || null })}
          opciones={[{ valor: '', texto: '—', detalle: 'Sin comparar' }, ...libres([por, yPor]).map(opcionCampo)]}
        />
        <FiltroDesplegable
          etiqueta="Medir"
          valor={medir}
          alCambiar={(v) => cambiar({ medidas: [v, ...(ademas && ademas !== v ? [ademas] : [])] })}
          opciones={medidasDe.map((m) => ({ valor: m.id, texto: m.nombre, detalle: m.ayuda || undefined }))}
        />
        <FiltroDesplegable
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
            <FiltroDesplegable
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
                { valor: '__quitar__', texto: 'Quitar este filtro' },
              ]}
            />
          )
        })}
        <FiltroDesplegable
          etiqueta="Filtrar"
          valor=""
          alCambiar={(v) => v && cambiar({ filtros: { ...def.filtros, [v]: [] } })}
          opciones={[{ valor: '', texto: 'por…' }, ...libres(filtrados).map(opcionCampo)]}
        />
      </BarraFiltros>

      <div className="flex flex-wrap items-center gap-2">
        <FiltroDesplegable
          etiqueta="Reporte"
          valor={abierto?.id ?? ''}
          alCambiar={abrir}
          opciones={[
            { valor: '', texto: 'Nuevo' },
            ...propios.map((g) => ({ valor: g.id, texto: g.nombre, detalle: g.creado_por ? `Lo guardó ${g.creado_por}` : 'Guardado' })),
            ...deFabrica.map((g) => ({ valor: g.id, texto: g.nombre, detalle: 'Listo para usar' })),
          ]}
        />
        <MenuAcciones
          etiqueta="Guardar o descargar"
          opciones={[
            ...(abierto && !abierto.de_fabrica ? [{ texto: 'Guardar cambios', onElegir: () => void guardar(false) }] : []),
            { texto: abierto && !abierto.de_fabrica ? 'Guardar como otro' : 'Guardar este reporte', onElegir: () => void guardar(true) },
            { texto: 'Descargar en Excel', onElegir: () => window.location.assign(api.urlExportarReporte(def, rango)) },
            ...(abierto && !abierto.de_fabrica ? [{ texto: 'Borrar este reporte', peligro: true, onElegir: () => void borrar() }] : []),
          ]}
        />
      </div>

      {error ? (
        <Vacio>{error}</Vacio>
      ) : resultado && resultado.fuente === def.fuente ? (
        <Resultado resultado={resultado} cargando={cargando} />
      ) : (
        <p className="text-neutral-400 text-sm">Armando el reporte...</p>
      )}
    </div>
  )
}

// ── El resultado ────────────────────────────────────────────────────────────

function Resultado({ resultado: r, cargando }: { resultado: ResultadoDinamico; cargando: boolean }) {
  const principal = r.medidas[0]
  const titulo = [
    r.medidas.map((m) => m.nombre).join(' y '),
    r.campos_fila.length ? `por ${r.campos_fila.map((c) => c.nombre.toLowerCase()).join(' y ')}` : '',
    r.columna ? `· comparando ${r.columna.nombre.toLowerCase()}` : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <Seccion
      titulo={titulo}
      ayuda={
        <>
          {r.etiqueta}
          {r.medidas.some((m) => m.formato === 'dinero') && ' · en dólares'}
          {cargando && ' · actualizando…'}
        </>
      }
    >
      {/* La cifra que responde la pregunta, antes que cualquier grafico. */}
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 mb-4">
        {r.medidas.map((m, i) => (
          <div key={m.id}>
            <p className={`tabular-nums font-semibold ${i === 0 ? 'text-3xl' : 'text-xl text-neutral-600'}`}>
              {formatear(m.formato, r.totales.total[m.id])}
            </p>
            <p className="text-xs text-neutral-500">{m.nombre}{m.sumable ? ' en total' : ''}</p>
          </div>
        ))}
      </div>

      {r.truncado && (
        <p className="mb-3 text-xs text-aviso-700 bg-aviso-50 rounded-lg px-3 py-2">
          Se muestran las primeras {r.filas.length} filas. El Excel las trae todas.
        </p>
      )}
      {r.filas.length === 0 ? (
        <p className="text-sm text-neutral-500 py-6 text-center">No hay datos en este período con estos filtros.</p>
      ) : (
        <div className="space-y-5">
          <Grafica r={r} principal={principal} />
          {r.columna ? <TablaCruzada r={r} /> : r.campos_fila.length > 0 && <TablaSimple r={r} />}
        </div>
      )}
    </Seccion>
  )
}

function Grafica({ r, principal: m }: { r: ResultadoDinamico; principal: ResultadoDinamico['medidas'][number] }) {
  if (r.campos_fila.length !== 1 || r.filas.length < 2) return null
  const campo = r.campos_fila[0]
  const fmt = (n: number) => formatear(m.formato, n, true)
  const etiqueta = (f: ResultadoDinamico['filas'][number]) => f.etiquetas[0]

  // Comparando, y la medida se puede sumar: cada fila es una barra partida
  // en sus partes (dia por cajera, categoria por mes).
  if (r.columna) {
    if (!m.sumable) return null
    const partes = r.columna.valores
    const filas = (campo.tipo === 'texto' ? r.filas.slice(0, 15) : r.filas).map((f) => ({
      nombre: etiqueta(f),
      partes: partes.map((p, i) => ({
        nombre: p.etiqueta,
        valor: f.por_columna?.[p.valor]?.[m.id] ?? 0,
        color: colorSerie(i),
      })),
    }))
    return (
      <BarrasApiladas filas={filas} formato={fmt} leyenda={partes.map((p, i) => ({ nombre: p.etiqueta, color: colorSerie(i) }))} />
    )
  }

  // Un orden propio (dias, horas, semanas): barras verticales con su eje.
  // La segunda medida, si la hay, va encima como linea.
  if (TEMPORALES.has(campo.tipo)) {
    const otra = r.medidas[1]
    return (
      <GraficoBarras
        alto={220}
        ejeY
        datos={r.filas.map((f) => ({ etiqueta: etiqueta(f), valor: f.total[m.id] ?? 0 }))}
        formato={fmt}
        lineas={otra ? [{ nombre: otra.nombre, valores: r.filas.map((f) => f.total[otra.id] ?? null) }] : undefined}
        formatoDerecha={otra ? (n) => formatear(otra.formato, n, true) : undefined}
      />
    )
  }

  // Nombres (productos, cajeras, proveedores): barras acostadas, de mayor a
  // menor, que se leen en un telefono sin girar la cabeza.
  const filas = r.filas.slice(0, 15).map((f) => ({
    nombre: etiqueta(f),
    partes: [{ nombre: m.nombre, valor: Math.max(f.total[m.id] ?? 0, 0), color: colorSerie(0) }],
  }))
  return <BarrasApiladas filas={filas} formato={fmt} />
}

function TablaSimple({ r }: { r: ResultadoDinamico }) {
  type F = ResultadoDinamico['filas'][number]
  const campos = useMemo(() => {
    const c: Record<string, (f: F) => string | number | null> = {}
    r.campos_fila.forEach((cf, i) => {
      // Las fechas y horas se ordenan por su clave (2026-10-05, 8), no por
      // el texto ("Lun 05/10").
      c[`f${i}`] = (f) => (cf.tipo === 'texto' ? f.etiquetas[i] : f.claves[i].padStart(12, '0'))
    })
    r.medidas.forEach((m) => {
      c[m.id] = (f) => f.total[m.id] ?? null
    })
    return c
  }, [r])
  const orden = useOrden<F>(campos)

  return (
    <Tabla orden={orden}>
      <table className="w-full text-sm">
        <thead className="text-neutral-500 text-xs uppercase">
          <tr>
            {r.campos_fila.map((cf, i) => (
              <Th key={cf.id} clave={`f${i}`} className="py-2 px-0">
                {cf.nombre}
              </Th>
            ))}
            {r.medidas.map((m) => (
              <Th key={m.id} clave={m.id} alinear="derecha" className="py-2 px-0 pl-4">
                {m.nombre}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orden.ordenar(r.filas).map((f) => (
            <tr key={f.claves.join('|')} className="border-t border-neutral-100">
              {f.etiquetas.map((e, i) => (
                <td key={i} className="py-2 pr-3 font-medium">
                  {e}
                </td>
              ))}
              {r.medidas.map((m) => (
                <td key={m.id} className="text-right py-2 pl-4 tabular-nums">
                  {formatear(m.formato, f.total[m.id])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-neutral-300 font-semibold">
            <td colSpan={r.campos_fila.length} className="py-2">
              Total
            </td>
            {r.medidas.map((m) => (
              <td key={m.id} className="text-right py-2 pl-4 tabular-nums">
                {formatear(m.formato, r.totales.total[m.id])}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </Tabla>
  )
}

function TablaCruzada({ r }: { r: ResultadoDinamico }) {
  const columna = r.columna!
  const varias = r.medidas.length > 1
  const celda = 'text-right py-2 pl-4 tabular-nums whitespace-nowrap'
  const fija = 'sticky left-0 bg-[var(--vp-superficie)]'
  return (
    // Una tabla cruzada no se puede apilar en fichas sin perder el cruce: en
    // pantallas angostas se desliza de lado, y la primera columna queda fija.
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full text-sm">
        <thead className="text-neutral-500 text-xs uppercase">
          <tr>
            {r.campos_fila.map((cf) => (
              <th key={cf.id} rowSpan={varias ? 2 : 1} className={`text-left py-2 pr-3 ${fija}`}>
                {cf.nombre}
              </th>
            ))}
            {columna.valores.map((v) => (
              <th key={v.valor} colSpan={r.medidas.length} className="text-right py-2 pl-4 normal-case whitespace-nowrap">
                {v.etiqueta}
              </th>
            ))}
            <th colSpan={r.medidas.length} className="text-right py-2 pl-4 text-neutral-700">
              Total
            </th>
          </tr>
          {varias && (
            <tr>
              {[...columna.valores, { valor: '__total__' }].flatMap((v) =>
                r.medidas.map((m) => (
                  <th key={`${v.valor}-${m.id}`} className="text-right pb-2 pl-4 font-medium normal-case whitespace-nowrap">
                    {m.nombre}
                  </th>
                )),
              )}
            </tr>
          )}
        </thead>
        <tbody>
          {r.filas.map((f) => (
            <tr key={f.claves.join('|')} className="border-t border-neutral-100">
              {f.etiquetas.map((e, i) => (
                <td key={i} className={`py-2 pr-3 font-medium whitespace-nowrap ${fija}`}>
                  {e}
                </td>
              ))}
              {columna.valores.flatMap((v) =>
                r.medidas.map((m) => (
                  <td key={`${v.valor}-${m.id}`} className={celda}>
                    {formatear(m.formato, f.por_columna?.[v.valor]?.[m.id])}
                  </td>
                )),
              )}
              {r.medidas.map((m) => (
                <td key={m.id} className={`${celda} font-semibold`}>
                  {formatear(m.formato, f.total[m.id])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-neutral-300 font-semibold">
            {r.campos_fila.length > 0 && (
              <td colSpan={r.campos_fila.length} className={`py-2 ${fija}`}>
                Total
              </td>
            )}
            {columna.valores.flatMap((v) =>
              r.medidas.map((m) => (
                <td key={`${v.valor}-${m.id}`} className={celda}>
                  {formatear(m.formato, r.totales.por_columna?.[v.valor]?.[m.id])}
                </td>
              )),
            )}
            {r.medidas.map((m) => (
              <td key={m.id} className={celda}>
                {formatear(m.formato, r.totales.total[m.id])}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
