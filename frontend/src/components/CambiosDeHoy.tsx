import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { Ingrediente, Sustitucion } from '../lib/types'
import { Boton, Seccion } from './ui'

/**
 * "Hoy no hay pollo, se usa pavo" (8-oct, caso 2).
 *
 * Mientras el cambio esté vigente --hasta el cierre del día, salvo que se
 * quite antes--, lo vendido descuenta el sustituto en vez del original, sin
 * tocar ninguna receta. Antes la única salida era editar la receta del guiso
 * (y acordarse de devolverla) o vender con el pollo en negativo.
 */
export default function CambiosDeHoy() {
  const [ingredientes, setIngredientes] = useState<Ingrediente[]>([])
  const [cambios, setCambios] = useState<Sustitucion[]>([])
  const [original, setOriginal] = useState(0)
  const [sustituto, setSustituto] = useState(0)
  const [factor, setFactor] = useState('1')
  const [nota, setNota] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [error, setError] = useState('')

  function cargar() {
    api.listarSustituciones().then(setCambios).catch(() => undefined)
  }
  useEffect(() => {
    cargar()
    api
      .listarIngredientes()
      .then((l) => setIngredientes(l.filter((i) => i.activo !== false && i.tipo !== 'preparacion' && i.tipo !== 'desechable' && !i.es_indirecto)))
      .catch(() => undefined)
  }, [])

  const orden = [...ingredientes].sort((a, b) => a.nombre.localeCompare(b.nombre))
  const elegido = ingredientes.find((i) => i.id === original)
  const reemplazo = ingredientes.find((i) => i.id === sustituto)

  async function guardar() {
    setError('')
    if (!original || !sustituto) return setError('Elige qué falta y con qué se reemplaza.')
    const f = Number(factor.replace(',', '.'))
    if (!(f > 0)) return setError('La proporción tiene que ser mayor que cero.')
    try {
      await api.crearSustitucion({ original_id: original, sustituto_id: sustituto, factor: f, nota: nota.trim() })
      setOriginal(0)
      setSustituto(0)
      setFactor('1')
      setNota('')
      setAbierto(false)
      cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el cambio')
    }
  }

  async function quitar(id: number) {
    await api.terminarSustitucion(id).catch(() => undefined)
    cargar()
  }

  const campo = 'border border-neutral-300 rounded-xl px-3 py-2 text-sm bg-white min-w-0'
  return (
    <Seccion
      titulo="Cambios de hoy"
      ayuda="Cuando falta algo y la cocina usa otra cosa: lo vendido descuenta el reemplazo sin tocar las recetas. Dura hasta el cierre del día."
      accion={
        !abierto && (
          <Boton tono="suave" onClick={() => setAbierto(true)} className="!py-1.5 !px-3 !text-xs">
            Anotar un cambio
          </Boton>
        )
      }
    >
      {cambios.length === 0 && !abierto && <p className="text-sm text-neutral-500">Hoy todo sale con sus recetas de siempre.</p>}
      {cambios.length > 0 && (
        <ul className="space-y-2 mb-3">
          {cambios.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-aviso-500/10 px-3 py-2.5 text-sm">
              <span className="flex-1 min-w-[180px]">
                <span className="font-semibold">{c.original}</span> se reemplaza por <span className="font-semibold">{c.sustituto}</span>
                {c.factor !== 1 && ` (${c.factor} ${c.unidad_sustituto} por cada ${c.unidad_original})`}
                <span className="block text-xs text-neutral-600">
                  hasta {new Date(c.hasta).toLocaleString('es-VE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  {c.nota && ` · ${c.nota}`}
                </span>
              </span>
              <button type="button" onClick={() => void quitar(c.id)} className="text-xs font-semibold underline text-neutral-700">
                Ya llegó: volver a la receta
              </button>
            </li>
          ))}
        </ul>
      )}
      {abierto && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-xs text-neutral-600 mb-0.5">Falta</span>
              <select value={original} onChange={(e) => setOriginal(Number(e.target.value))} className={`${campo} w-full`}>
                <option value={0}>Elige la mercancía…</option>
                {orden.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.nombre} ({i.unidad})
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs text-neutral-600 mb-0.5">Se usa en su lugar</span>
              <select value={sustituto} onChange={(e) => setSustituto(Number(e.target.value))} className={`${campo} w-full`}>
                <option value={0}>Elige el reemplazo…</option>
                {orden
                  .filter((i) => i.id !== original)
                  .map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.nombre} ({i.unidad}) · hay {i.stock_actual}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block">
              <span className="block text-xs text-neutral-600 mb-0.5">
                Cuánto {reemplazo?.unidad ?? 'del reemplazo'} por cada {elegido?.unidad ?? 'unidad'} que se usaba
              </span>
              <input value={factor} onChange={(e) => setFactor(e.target.value)} inputMode="decimal" className={`${campo} w-full`} />
            </label>
            <label className="block">
              <span className="block text-xs text-neutral-600 mb-0.5">Por qué (opcional)</span>
              <input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="No llegó el pollo" className={`${campo} w-full`} />
            </label>
          </div>
          {error && <p className="text-sm text-peligro-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Boton tono="fantasma" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton onClick={() => void guardar()}>Anotar hasta el cierre</Boton>
          </div>
        </div>
      )}
    </Seccion>
  )
}
