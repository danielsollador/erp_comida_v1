import { useEffect, useMemo, useState } from 'react'
import EnlaceDescarga from '../../../components/EnlaceDescarga'
import { CasillaConUnidad } from '../../../components/Cantidad'
import { useDialogo } from '../../../components/dialogo'
import { Aviso, Boton, Modal, Pastilla } from '../../../components/ui'
import { api } from '../../../lib/api'
import { cantidad } from '../../../lib/inventario'
import { useMoneda } from '../../../lib/moneda'
import { convertirTexto, factorEntre } from '../../../lib/unidades'
import type { ConteoDetalle, Ingrediente, PlanillaLeida, ResultadoConteo } from '../../../lib/types'

/**
 * Una planilla de conteo ya cargada, renglón por renglón.
 *
 * Es el documento que se compara contra el papel que trajo el trabajador.
 * Las diferencias van arriba -es lo que se viene a mirar- y lo que cuadró
 * queda abajo, pero se muestra: saber que 40 insumos dieron exacto es parte
 * de lo que hace creíble al conteo.
 */
export function DetalleConteo({ id, onCerrar }: { id: number; onCerrar: () => void }) {
  const { fmt: dinero } = useMoneda()
  const [d, setD] = useState<ConteoDetalle | null>(null)

  useEffect(() => {
    api.conteo(id).then(setD).catch(() => setD(null))
  }, [id])

  return (
    <Modal
      titulo={d ? `Conteo del ${new Date(d.fecha).toLocaleDateString('es-VE')}` : 'Conteo'}
      onCerrar={onCerrar}
      ancho="lg"
      pie={
        <>
          {d && (
            <EnlaceDescarga
              ruta={`/api/inventario/conteos/${d.id}/exportar`}
              nombre={`conteo-${d.id}.csv`}
              className="mr-auto self-center text-sm font-medium text-acento-700 hover:underline"
            >
              Descargar
            </EnlaceDescarga>
          )}
          <Boton onClick={onCerrar}>Cerrar</Boton>
        </>
      }
    >
      {d === null ? (
        <p className="text-sm text-neutral-400">Cargando…</p>
      ) : (
        <>
          <p className="text-sm text-neutral-600 mb-3">
            {d.contados} mercancía(s) contada(s), {d.cuadraron} cuadraron.
            {d.operador && ` Lo hizo ${d.operador}.`}{' '}
            {d.ciego ? (
              <Pastilla tono="bien">a ciegas</Pastilla>
            ) : (
              <span className="text-neutral-400">
                Se contó viendo lo que el sistema esperaba.
              </span>
            )}
          </p>
          <div className="flex gap-4 text-sm mb-3 tabular-nums">
            <span>
              Faltó <b className="text-peligro-600">{dinero(d.faltante_valor)}</b>
            </span>
            <span>
              Sobró <b className="text-exito-600">{dinero(d.sobrante_valor)}</b>
            </span>
          </div>
          <table className="w-full text-sm">
            <thead className="text-neutral-500 text-xs uppercase">
              <tr>
                <th className="text-left p-2">Mercancía</th>
                <th className="text-right p-2">Sistema</th>
                <th className="text-right p-2">Contado</th>
                <th className="text-right p-2">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {d.lineas.map((l) => (
                <tr key={l.ingrediente_id} className="border-t border-neutral-100">
                  <td className="p-2">
                    {l.nombre}
                    <span className="block text-[11px] text-neutral-400">{l.unidad}</span>
                  </td>
                  <td className="p-2 text-right tabular-nums text-neutral-500">
                    {cantidad(l.sistema)}
                  </td>
                  <td className="p-2 text-right tabular-nums">{cantidad(l.contado)}</td>
                  <td className="p-2 text-right tabular-nums whitespace-nowrap">
                    {l.diferencia === 0 ? (
                      <span className="text-exito-600">cuadra</span>
                    ) : (
                      <span
                        className={
                          l.diferencia < 0
                            ? 'text-peligro-600 font-medium'
                            : 'text-aviso-600 font-medium'
                        }
                      >
                        {l.diferencia > 0 ? '+' : ''}
                        {cantidad(l.diferencia)}
                        <span className="block text-[11px] font-normal text-neutral-500">
                          {dinero(l.valor)}
                        </span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  )
}

// ── El conteo fisico ─────────────────────────────────────────────────────────

/**
 * Se recorre el deposito con la tablet y se anota lo que hay de cada cosa.
 * Lo que se deja en blanco no se toca. Se guarda una sola vez, y el sistema
 * registra cada diferencia como merma o sobrante con su asiento.
 */
export default function ConteoFisico({
  ingredientes,
  onCerrar,
  onGuardado,
}: {
  ingredientes: Ingrediente[]
  onCerrar: () => void
  onGuardado: (r: ResultadoConteo) => void
}) {
  const { fmt: dinero } = useMoneda()
  const dialogo = useDialogo()
  const [valores, setValores] = useState<Record<number, string>>({})
  // En que unidad se escribe cada renglon (kg ⇄ g). Lo que se guarda va
  // siempre en la de la ficha.
  const [vistas, setVistas] = useState<Record<number, string>>({})
  const vistaDe = (i: Ingrediente) => vistas[i.id] ?? i.unidad
  const [buscar, setBuscar] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  // Encendido por defecto: el conteo que sirve es el que se hace sin ver lo
  // que el sistema espera. Se puede apagar, pero hay que decidirlo.
  const [ciego, setCiego] = useState(true)
  const [leido, setLeido] = useState<PlanillaLeida | null>(null)

  async function cargarPlanilla(archivo: File) {
    setError('')
    try {
      const r = await api.leerPlanillaConteo(archivo)
      setLeido(r)
      // Se rellenan las casillas en vez de guardar: el archivo lo llenó
      // alguien en el depósito y nadie lo ha mirado todavía en pantalla.
      setValores((v) => ({
        ...v,
        ...Object.fromEntries(r.filas.map((f) => [f.ingrediente_id, String(f.contado)])),
      }))
      // La planilla trae lo contado en la unidad de cada ficha.
      setVistas((v) => {
        const n = { ...v }
        for (const fila of r.filas) delete n[fila.ingrediente_id]
        return n
      })
    } catch (e) {
      setLeido(null)
      setError(e instanceof Error ? e.message : 'No se pudo leer la planilla')
    }
  }

  const num = (v: string) => Number(v.trim().replace(',', '.'))
  const lista = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    return [...ingredientes]
      .filter((i) => !q || i.nombre.toLowerCase().includes(q))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }, [ingredientes, buscar])

  const contados = ingredientes
    .map((i) => ({ ing: i, texto: valores[i.id] ?? '' }))
    .filter((x) => x.texto.trim() !== '')
    .map((x) => ({ ing: x.ing, real: num(x.texto) / factorEntre(x.ing.unidad, vistaDe(x.ing)) }))
  const invalidos = contados.filter((c) => !Number.isFinite(c.real) || c.real < 0)
  const diferencias = contados
    .filter((c) => Number.isFinite(c.real) && c.real >= 0)
    .map((c) => ({ ...c, dif: c.real - c.ing.stock_actual, valor: Math.abs(c.real - c.ing.stock_actual) * (c.ing.costo_unitario || 0) }))
  const faltante = diferencias.filter((d) => d.dif < 0).reduce((s, d) => s + d.valor, 0)
  const sobrante = diferencias.filter((d) => d.dif > 0).reduce((s, d) => s + d.valor, 0)

  async function guardar() {
    setError('')
    if (invalidos.length) return setError('Hay cantidades que no son números o son negativas.')
    if (contados.length === 0) return
    // A ciegas el resumen se revela aquí y no antes: si el total de faltante
    // se ve mientras se teclea, ya no es un conteo a ciegas.
    const ok = await dialogo.confirmar({
      titulo: `¿Guardar el conteo de ${contados.length} mercancía(s)?`,
      texto:
        `Faltante: ${dinero(faltante)} (queda como merma) · Sobrante: ${dinero(sobrante)}.\n\n` +
        'Lo que dice la balanza manda sobre lo que dice el sistema. Lo que dejaste en blanco no se toca.',
      aceptar: 'Guardar conteo',
    })
    if (!ok) return
    setGuardando(true)
    try {
      const r = await api.conteoFisico(
        contados.map((c) => ({ ingrediente_id: c.ing.id, stock_real: c.real })),
        'Conteo fisico',
        ciego,
      )
      onGuardado(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el conteo')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      titulo="Conteo físico"
      ayuda="Anota lo que hay de verdad de cada mercancía. Lo que dejes en blanco no cambia."
      onCerrar={onCerrar}
      ancho="lg"
      pie={
        <>
          <span className="mr-auto text-sm text-neutral-600 tabular-nums self-center">
            {contados.length} contado(s)
            {/* A ciegas tampoco se adelantan los totales: ver "faltante $40"
                mientras se teclea delata el resultado igual que la columna. */}
            {!ciego && diferencias.length > 0 && (
              <>
                {' · '}faltante <b className="text-peligro-600">{dinero(faltante)}</b>
                {' · '}sobrante <b className="text-exito-600">{dinero(sobrante)}</b>
              </>
            )}
          </span>
          <Boton tono="suave" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton onClick={guardar} disabled={guardando || contados.length === 0}>
            Guardar conteo
          </Boton>
        </>
      }
    >
      {error && (
        <div className="mb-3">
          <Aviso>{error}</Aviso>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="search"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          placeholder="Buscar…"
          className="border border-neutral-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-40"
        />
        <EnlaceDescarga
          ruta="/api/inventario/conteos/planilla"
          nombre="planilla-de-conteo.csv"
          className="text-sm font-medium text-acento-700 hover:underline whitespace-nowrap"
        >
          Descargar planilla
        </EnlaceDescarga>
        {/* La vuelta del viaje: la planilla que el trabajador llenó en el
            depósito entra por aquí y rellena las casillas. No guarda nada
            todavía: se revisa en pantalla y se guarda con el mismo botón de
            siempre, que es el que sabe asentar cada diferencia. */}
        <label className="text-sm font-medium text-acento-700 hover:underline whitespace-nowrap cursor-pointer">
          Subir planilla llena
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const archivo = e.target.files?.[0]
              e.target.value = ''
              if (archivo) cargarPlanilla(archivo)
            }}
          />
        </label>
      </div>
      {leido && (
        <div className="mb-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm">
          <p>
            Se leyeron <b>{leido.filas.length}</b> renglón(es) de la planilla
            {leido.en_blanco > 0 && `, ${leido.en_blanco} en blanco que no se tocan`}.
            {leido.filas.length > 0 && ' Revísalos abajo y guarda.'}
          </p>
          {leido.errores.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-peligro-700 space-y-0.5">
              {leido.errores.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {/* El interruptor que hace que el conteo sirva para auditar. Contar
          teniendo delante el número que el sistema espera no prueba nada: el
          ojo acomoda la cifra al número que ya leyó, y una diferencia real se
          teclea como "cuadra" sin mala intención. Viene encendido. */}
      <label className="flex items-start gap-2 mb-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 cursor-pointer">
        <input
          type="checkbox"
          checked={ciego}
          onChange={(e) => setCiego(e.target.checked)}
          className="mt-0.5"
        />
        <span className="text-sm">
          <b className="font-medium">Contar a ciegas</b>
          <span className="block text-xs text-neutral-500">
            Esconde lo que el sistema espera mientras se cuenta. Las diferencias aparecen al
            guardar. Es la única forma de que el conteo pruebe algo.
          </span>
        </span>
      </label>
      <table className="w-full text-sm">
        <thead className="text-neutral-500 text-xs uppercase">
          <tr>
            <th className="text-left p-2">Mercancía</th>
            {!ciego && <th className="text-right p-2">Sistema</th>}
            <th className="text-right p-2 w-32">Contado</th>
            {!ciego && <th className="text-right p-2">Diferencia</th>}
          </tr>
        </thead>
        <tbody>
          {lista.map((ing) => {
            const texto = valores[ing.id] ?? ''
            const vista = vistaDe(ing)
            const real = texto.trim() === '' ? null : num(texto) / factorEntre(ing.unidad, vista)
            const valido = real !== null && Number.isFinite(real) && real >= 0
            const dif = valido ? real - ing.stock_actual : null
            return (
              <tr key={ing.id} className="border-t border-neutral-100">
                <td className="p-2">
                  <span className="font-medium">{ing.nombre}</span>
                  <span className="block text-[11px] text-neutral-400">{ing.unidad}</span>
                </td>
                {!ciego && (
                  <td className="p-2 text-right tabular-nums text-neutral-500 whitespace-nowrap">
                    {cantidad(ing.stock_actual)}
                  </td>
                )}
                <td className="p-2 text-right">
                  <CasillaConUnidad
                    unidad={ing.unidad}
                    vista={vista}
                    alCambiarVista={(nueva) => {
                      setValores((v) => ({ ...v, [ing.id]: convertirTexto(v[ing.id] ?? '', ing.unidad, vista, nueva) }))
                      setVistas((v) => ({ ...v, [ing.id]: nueva }))
                    }}
                    value={texto}
                    onChange={(e) => setValores((v) => ({ ...v, [ing.id]: e.target.value }))}
                    placeholder="—"
                    etiqueta={`Contado de ${ing.nombre} (${vista})`}
                    aria-label={`Contado de ${ing.nombre}, en ${vista}`}
                    className="w-36 ml-auto"
                    claseCasilla={`text-right border rounded-lg px-2 py-1.5 text-sm tabular-nums ${
                      texto && !valido ? 'border-peligro-400' : 'border-neutral-300'
                    }`}
                  />
                </td>
                {!ciego && (
                  <td className="p-2 text-right tabular-nums whitespace-nowrap">
                    {dif === null ? (
                      <span className="text-neutral-300">—</span>
                    ) : dif === 0 ? (
                      <span className="text-exito-600">cuadra</span>
                    ) : (
                      <span className={dif < 0 ? 'text-peligro-600 font-medium' : 'text-aviso-600 font-medium'}>
                        {dif > 0 ? '+' : ''}
                        {cantidad(dif)} {ing.unidad}
                        <span className="block text-[11px] font-normal text-neutral-500">
                          {dinero(Math.abs(dif) * (ing.costo_unitario || 0))}
                        </span>
                      </span>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </Modal>
  )
}
