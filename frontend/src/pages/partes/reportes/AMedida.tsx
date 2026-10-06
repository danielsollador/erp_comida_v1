import { useEffect, useMemo, useRef, useState } from 'react'
import { useDialogo } from '../../../components/dialogo'
import { GraficoBarras, GraficoLineas } from '../../../components/Grafico'
import { Tabla, Th, useOrden } from '../../../components/Tabla'
import { Boton, Modal, Seccion } from '../../../components/ui'
import { api } from '../../../lib/api'
import { ATAJOS, rangoDe, type ClaveRango, type Rango } from '../../../lib/fechas'
import { fmtBs, fmtNum } from '../../../lib/moneda'
import type {
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
 * POR QUE. Cada "¿y como vemos esto?" del cliente terminaba en una pantalla
 * nueva. Aqui se elige QUE mirar (una fuente: ventas, productos, cobros,
 * compras, mermas), POR QUE agruparlo (filas y, si se quiere, columnas), QUE
 * sumar y QUE filtrar, y el resultado se arma solo. Lo que sirve se guarda
 * con nombre y queda a un clic para la proxima vez.
 *
 * Todo se agrupa en el servidor: la tablet recibe solo el resultado.
 */

const VACIA: DefinicionReporte = { fuente: 'ventas', filas: ['dia'], columna: null, medidas: ['ventas', 'pedidos'], filtros: {} }
const TEMPORALES = new Set(['fecha', 'semana', 'mes', 'anio'])

function formatear(formato: FormatoMedida, v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  switch (formato) {
    case 'dinero':
      return `${v < 0 ? '-' : ''}$${fmtNum(Math.abs(v), 2)}`
    case 'bs':
      return fmtBs(v)
    case 'entero':
      return fmtNum(v, 0)
    case 'pct':
      return `${fmtNum(v, 1)}%`
    default:
      return fmtNum(v, Number.isInteger(v) ? 0 : 2)
  }
}

function completar(d: Partial<DefinicionReporte> & { fuente: string; medidas: string[] }): DefinicionReporte {
  return { filas: [], columna: null, filtros: {}, ...d }
}

export default function AMedida({ rango, alCambiarRango }: { rango: Rango; alCambiarRango: (r: Rango) => void }) {
  const dialogo = useDialogo()
  const [catalogo, setCatalogo] = useState<FuenteDinamica[] | null>(null)
  const [guardados, setGuardados] = useState<ReporteGuardado[]>([])
  const [def, setDef] = useState<DefinicionReporte>(VACIA)
  // El reporte guardado que esta abierto: "Guardar" lo actualiza.
  const [abierto, setAbierto] = useState<ReporteGuardado | null>(null)
  const [resultado, setResultado] = useState<ResultadoDinamico | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState('')
  const [filtrando, setFiltrando] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.catalogoReportes(), api.reportesGuardados()])
      .then(([c, g]) => {
        setCatalogo(c)
        setGuardados(g)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar el catálogo'))
  }, [])

  const fuente = catalogo?.find((f) => f.id === def.fuente) ?? null
  const nombreCampo = (id: string) => fuente?.campos.find((c) => c.id === id)?.nombre ?? id

  // Cada cambio vuelve a consultar, con una pausa corta: elegir tres medidas
  // seguidas no tiene por que disparar tres consultas.
  const turno = useRef(0)
  useEffect(() => {
    if (!catalogo || def.medidas.length === 0) {
      turno.current++
      setResultado(null)
      setCargando(false)
      return
    }
    const mio = ++turno.current
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
    }, 250)
    return () => clearTimeout(t)
  }, [def, rango, catalogo])

  const cambiar = (parcial: Partial<DefinicionReporte>) => setDef((d) => ({ ...d, ...parcial }))

  const elegirFuente = (id: string) => {
    if (id === def.fuente) return
    const f = catalogo?.find((x) => x.id === id)
    if (!f) return
    setAbierto(null)
    setDef({ fuente: id, filas: ['dia'], columna: null, medidas: [f.medidas[0].id], filtros: {} })
  }

  const abrir = (id: string) => {
    const g = guardados.find((x) => x.id === id)
    if (!g) return
    // Un reporte guardado por alguien con mas permisos puede traer costo o
    // margen; aqui solo se piden las medidas que este usuario puede ver.
    const f = catalogo?.find((x) => x.id === g.definicion.fuente)
    const visibles = new Set(f?.medidas.map((m) => m.id))
    const d = completar(g.definicion)
    setDef({ ...d, medidas: d.medidas.filter((m) => visibles.has(m)) })
    setAbierto(g)
    if (g.periodo && ATAJOS.some((a) => a.clave === g.periodo)) alCambiarRango(rangoDe(g.periodo as ClaveRango))
  }

  const periodoActual = rango.clave === 'personal' ? null : rango.clave

  const guardar = async (comoNuevo: boolean) => {
    const propio = abierto && !abierto.de_fabrica && !comoNuevo ? abierto : null
    const nombre = await dialogo.pedirTexto({
      titulo: propio ? 'Guardar cambios' : 'Guardar reporte',
      etiqueta: 'Nombre',
      valor: propio?.nombre ?? '',
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

  const propios = guardados.filter((g) => !g.de_fabrica)
  const deFabrica = guardados.filter((g) => g.de_fabrica)
  const libres = fuente?.campos.filter((c) => !def.filas.includes(c.id) && c.id !== def.columna) ?? []

  return (
    <div className="space-y-5">
      <Seccion
        titulo="Armar reporte"
        ayuda="Elige qué mirar, cómo agruparlo y qué sumar. El resultado se actualiza solo; si sirve, guárdalo con nombre."
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="block min-w-[14rem] flex-1">
              <span className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">
                Reportes guardados
              </span>
              <select
                value={abierto?.id ?? ''}
                onChange={(e) => (e.target.value ? abrir(e.target.value) : setAbierto(null))}
                className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="">— Reporte nuevo —</option>
                {propios.length > 0 && (
                  <optgroup label="Guardados">
                    {propios.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.nombre}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Del sistema">
                  {deFabrica.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.nombre}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            {abierto && !abierto.de_fabrica ? (
              <>
                <Boton tono="suave" onClick={() => void guardar(false)}>
                  Guardar
                </Boton>
                <Boton tono="suave" onClick={() => void guardar(true)}>
                  Guardar como…
                </Boton>
                <Boton tono="peligro" onClick={() => void borrar()}>
                  Borrar
                </Boton>
              </>
            ) : (
              <Boton tono="suave" onClick={() => void guardar(true)} disabled={def.medidas.length === 0}>
                Guardar como…
              </Boton>
            )}
          </div>

          <Grupo titulo="Qué mirar">
            {catalogo.map((f) => (
              <Ficha key={f.id} activa={f.id === def.fuente} onClick={() => elegirFuente(f.id)}>
                {f.nombre}
              </Ficha>
            ))}
          </Grupo>
          {fuente && <p className="-mt-2 text-xs text-neutral-500">{fuente.descripcion}</p>}

          {fuente && (
            <>
              <Grupo titulo="Agrupar por" ayuda="En este orden. Toca uno para quitarlo.">
                {def.filas.map((id, i) => (
                  <Ficha key={id} activa onClick={() => cambiar({ filas: def.filas.filter((x) => x !== id) })}>
                    {i > 0 && <span className="opacity-60">›</span>}
                    {nombreCampo(id)}
                    <span aria-hidden className="opacity-60">
                      ×
                    </span>
                  </Ficha>
                ))}
                <Agregar
                  texto="+ Agregar"
                  opciones={libres.map((c) => ({ id: c.id, nombre: c.nombre }))}
                  alElegir={(id) => cambiar({ filas: [...def.filas, id] })}
                />
              </Grupo>

              <Grupo titulo="En columnas" ayuda="Opcional: cruza las filas con otro campo, como una tabla dinámica.">
                {def.columna ? (
                  <Ficha activa onClick={() => cambiar({ columna: null })}>
                    {nombreCampo(def.columna)}
                    <span aria-hidden className="opacity-60">
                      ×
                    </span>
                  </Ficha>
                ) : (
                  <Agregar
                    texto="+ Elegir campo"
                    opciones={libres.map((c) => ({ id: c.id, nombre: c.nombre }))}
                    alElegir={(id) => cambiar({ columna: id })}
                  />
                )}
              </Grupo>

              <Grupo titulo="Medir">
                {fuente.medidas.map((m) => {
                  const activa = def.medidas.includes(m.id)
                  return (
                    <Ficha
                      key={m.id}
                      activa={activa}
                      titulo={m.ayuda || undefined}
                      onClick={() =>
                        cambiar({
                          medidas: activa ? def.medidas.filter((x) => x !== m.id) : [...def.medidas, m.id],
                        })
                      }
                    >
                      {m.nombre}
                    </Ficha>
                  )
                })}
              </Grupo>

              <Grupo titulo="Filtros" ayuda="Solo lo que cumple todos los filtros.">
                {Object.entries(def.filtros)
                  .filter(([, v]) => v.length > 0)
                  .map(([campo, valores]) => (
                    <Ficha key={campo} activa onClick={() => setFiltrando(campo)}>
                      {nombreCampo(campo)}: {valores.length === 1 ? '1 valor' : `${valores.length} valores`}
                    </Ficha>
                  ))}
                <Agregar
                  texto="+ Filtrar por"
                  opciones={fuente.campos
                    .filter((c) => !(def.filtros[c.id]?.length))
                    .map((c) => ({ id: c.id, nombre: c.nombre }))}
                  alElegir={(id) => setFiltrando(id)}
                />
              </Grupo>
            </>
          )}
        </div>
      </Seccion>

      {def.medidas.length === 0 ? (
        <Vacio>Elige al menos una medida para ver el reporte.</Vacio>
      ) : error ? (
        <p className="text-peligro-600 text-sm">{error}</p>
      ) : resultado ? (
        <Resultado resultado={resultado} cargando={cargando} url={api.urlExportarReporte(def, rango)} />
      ) : (
        <p className="text-neutral-400 text-sm">Armando el reporte...</p>
      )}

      {filtrando && fuente && (
        <FiltroValores
          fuente={fuente.id}
          campo={filtrando}
          nombre={nombreCampo(filtrando)}
          rango={rango}
          elegidos={def.filtros[filtrando] ?? []}
          alCerrar={() => setFiltrando(null)}
          alAplicar={(valores) => {
            const filtros = { ...def.filtros }
            if (valores.length) filtros[filtrando] = valores
            else delete filtros[filtrando]
            cambiar({ filtros })
            setFiltrando(null)
          }}
        />
      )}
    </div>
  )
}

// ── Piezas del armador ──────────────────────────────────────────────────────

function Grupo({ titulo, ayuda, children }: { titulo: string; ayuda?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1.5">
        {titulo}
        {ayuda && <span className="ml-2 normal-case tracking-normal font-normal text-neutral-400">{ayuda}</span>}
      </p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

function Ficha({
  activa,
  titulo,
  onClick,
  children,
}: {
  activa: boolean
  titulo?: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      aria-pressed={activa}
      className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium ${
        activa ? 'bg-neutral-900 text-white' : 'bg-white border border-neutral-200 text-neutral-700 hover:border-neutral-400'
      }`}
    >
      {children}
    </button>
  )
}

/** Un desplegable que parece ficha: elegir agrega, y vuelve a "+ Agregar". */
function Agregar({
  texto,
  opciones,
  alElegir,
}: {
  texto: string
  opciones: { id: string; nombre: string }[]
  alElegir: (id: string) => void
}) {
  if (opciones.length === 0) return null
  return (
    <select
      value=""
      aria-label={texto.replace('+ ', '')}
      onChange={(e) => e.target.value && alElegir(e.target.value)}
      className="rounded-full px-3.5 py-1.5 text-sm font-medium border border-dashed border-neutral-300 bg-white text-neutral-600"
    >
      <option value="">{texto}</option>
      {opciones.map((o) => (
        <option key={o.id} value={o.id}>
          {o.nombre}
        </option>
      ))}
    </select>
  )
}

function FiltroValores({
  fuente,
  campo,
  nombre,
  rango,
  elegidos,
  alCerrar,
  alAplicar,
}: {
  fuente: string
  campo: string
  nombre: string
  rango: Rango
  elegidos: string[]
  alCerrar: () => void
  alAplicar: (valores: string[]) => void
}) {
  const [valores, setValores] = useState<ValorCampo[] | null>(null)
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set(elegidos))
  // Lo que ya estaba filtrado al abrir. En una ref y no como dependencia:
  // `elegidos` llega como un arreglo nuevo en cada pintada de la pantalla,
  // y cada resultado que llegaba volvia a pedir los valores al servidor.
  const yaElegidos = useRef(elegidos)
  const [busqueda, setBusqueda] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .valoresDeCampo(fuente, campo, rango)
      .then((v) => {
        // Lo que ya estaba filtrado y en este periodo no aparece igual se
        // muestra: si no, no habria forma de desmarcarlo.
        const vistos = new Set(v.map((x) => x.valor))
        const sueltos = yaElegidos.current.filter((e) => !vistos.has(e))
        setValores([...v, ...sueltos.map((e) => ({ valor: e, etiqueta: e }))])
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron cargar los valores'))
  }, [fuente, campo, rango])

  const q = busqueda.trim().toLowerCase()
  const visibles = (valores ?? []).filter((v) => !q || v.etiqueta.toLowerCase().includes(q))
  const alternar = (v: string) =>
    setMarcados((m) => {
      const n = new Set(m)
      if (n.has(v)) n.delete(v)
      else n.add(v)
      return n
    })

  return (
    <Modal
      titulo={`Filtrar por ${nombre.toLowerCase()}`}
      ayuda="Marca lo que quieres ver. Sin nada marcado no se filtra."
      onCerrar={alCerrar}
      ancho="sm"
      pie={
        <>
          <Boton tono="fantasma" onClick={() => alAplicar([])}>
            Quitar filtro
          </Boton>
          <Boton onClick={() => alAplicar([...marcados])}>Aplicar</Boton>
        </>
      }
    >
      {error && <p className="text-peligro-600 text-sm">{error}</p>}
      {!valores && !error && <p className="text-neutral-400 text-sm">Cargando...</p>}
      {valores && (
        <div className="space-y-2">
          {valores.length > 8 && (
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar"
              className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
            />
          )}
          {valores.length === 0 && <p className="text-sm text-neutral-500">No hay datos en este período.</p>}
          <ul className="max-h-[50vh] overflow-y-auto divide-y divide-neutral-100">
            {visibles.map((v) => (
              <li key={v.valor}>
                <label className="flex items-center gap-3 py-2.5 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={marcados.has(v.valor)}
                    onChange={() => alternar(v.valor)}
                    className="h-4 w-4"
                  />
                  {v.etiqueta}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  )
}

// ── El resultado ────────────────────────────────────────────────────────────

function Resultado({ resultado: r, cargando, url }: { resultado: ResultadoDinamico; cargando: boolean; url: string }) {
  const titulo = [
    r.medidas.map((m) => m.nombre).join(', '),
    r.campos_fila.length ? `por ${r.campos_fila.map((c) => c.nombre.toLowerCase()).join(' y ')}` : '',
    r.columna ? `y ${r.columna.nombre.toLowerCase()}` : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <Seccion
      titulo={titulo}
      ayuda={
        <>
          {r.etiqueta} · {r.filas.length} {r.filas.length === 1 ? 'fila' : 'filas'}
          {r.medidas.some((m) => m.formato === 'dinero') && ' · montos en dólares'}
          {cargando && ' · actualizando…'}
        </>
      }
      accion={
        <a
          href={url}
          className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium bg-white border border-neutral-200 hover:border-neutral-400"
        >
          Exportar a Excel
        </a>
      }
    >
      {r.truncado && (
        <p className="mb-3 text-xs text-aviso-700 bg-aviso-50 rounded-lg px-3 py-2">
          Se muestran las primeras {r.filas.length} filas. El Excel las trae todas; para verlas aquí, filtra o
          agrupa por menos campos.
        </p>
      )}
      {r.filas.length === 0 ? (
        <p className="text-sm text-neutral-500 py-6 text-center">No hay datos en este período con estos filtros.</p>
      ) : (
        <div className="space-y-5">
          <Grafica r={r} />
          {r.columna ? <TablaCruzada r={r} /> : <TablaSimple r={r} />}
        </div>
      )}
    </Seccion>
  )
}

function Grafica({ r }: { r: ResultadoDinamico }) {
  // Solo cuando se lee de un vistazo: un campo, sin columnas, una medida de
  // referencia (la primera).
  if (r.campos_fila.length !== 1 || r.columna || r.filas.length < 2) return null
  const campo = r.campos_fila[0]
  const m = r.medidas[0]
  const fmt = (n: number) => formatear(m.formato, n)
  if (TEMPORALES.has(campo.tipo)) {
    return (
      <GraficoLineas
        etiquetas={r.filas.map((f) => f.etiquetas[0])}
        series={[{ nombre: m.nombre, color: 'var(--color-acento-500)', valores: r.filas.map((f) => f.total[m.id] ?? null), relleno: true }]}
        formato={fmt}
      />
    )
  }
  // Los textos van de mayor a menor; con muchos, los primeros 20.
  const filas = campo.tipo === 'texto' ? r.filas.slice(0, 20) : r.filas
  return (
    <GraficoBarras
      datos={filas.map((f) => ({ etiqueta: f.etiquetas[0], valor: f.total[m.id] ?? 0 }))}
      formato={fmt}
    />
  )
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
            {r.campos_fila.length > 0 && (
              <td colSpan={r.campos_fila.length} className="py-2">
                Total
              </td>
            )}
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
  return (
    // Una tabla cruzada no se puede apilar en fichas sin perder el cruce: en
    // pantallas angostas se desliza de lado, y la primera columna queda fija.
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full text-sm">
        <thead className="text-neutral-500 text-xs uppercase">
          <tr>
            {r.campos_fila.map((cf) => (
              <th key={cf.id} rowSpan={varias ? 2 : 1} className="text-left py-2 pr-3 sticky left-0 bg-white">
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
                <td key={i} className="py-2 pr-3 font-medium whitespace-nowrap sticky left-0 bg-white">
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
              <td colSpan={r.campos_fila.length} className="py-2 sticky left-0 bg-white">
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
