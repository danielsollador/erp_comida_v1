import { useMemo, useState } from 'react'
import { api } from '../lib/api'
import { MUY_PARECIDO, parecidos } from '../lib/parecidos'
import { TIPOS_DE_COMPRA } from '../lib/tiposArticulo'
import type { Ingrediente, TipoArticulo } from '../lib/types'
import { Boton, Modal } from './ui'

/**
 * Crear una mercancía sin salir de donde se está (cargando una factura).
 *
 * LO PRIMERO ES NO DUPLICAR. Mientras se escribe el nombre aparecen las que
 * ya existen y se le parecen, cada una con "Usar esta": la mayoría de las
 * veces la mercancía ya estaba con otro nombre ("Crema de leche" para la
 * "CREMA DE LECHE LATA 250G" del papel). Si hay una casi igual, crear pide un
 * segundo toque ("Es otra, crearla"). El servidor rechaza los nombres iguales.
 *
 * Solo lo que hace falta para empezar: nombre, unidad, qué es y si paga
 * IVA. Qué es decide su camino: la materia prima y la reventa entran al
 * depósito, el desechable (servilletas) va directo a gasto sin stock. El resto (categoría, mínimos, rendimiento) se completa en Inventario.
 */

const UNIDADES = [
  { valor: 'kg', texto: 'kg' },
  { valor: 'lt', texto: 'litro' },
  { valor: 'unidad', texto: 'unidad' },
  { valor: 'paquete', texto: 'paquete' },
]

export default function NuevaMercancia({
  ingredientes,
  nombre: nombreInicial = '',
  unidad: unidadInicial = 'kg',
  exento: exentoInicial = false,
  delPapel,
  onUsar,
  onCreada,
  onCerrar,
}: {
  ingredientes: Ingrediente[]
  nombre?: string
  unidad?: string
  exento?: boolean
  /** Lo que dice la factura, para tenerlo a la vista mientras se nombra. */
  delPapel?: string
  onUsar: (ing: Ingrediente) => void
  onCreada: (ing: Ingrediente) => void
  onCerrar: () => void
}) {
  const [nombre, setNombre] = useState(nombreInicial)
  const [unidad, setUnidad] = useState(unidadInicial)
  const [tipo, setTipo] = useState<TipoArticulo>('insumo')
  const [exento, setExento] = useState(exentoInicial)
  const [confirmando, setConfirmando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const similares = useMemo(() => parecidos(nombre, ingredientes), [nombre, ingredientes])
  const casiIgual = similares.some((s) => s.puntos >= MUY_PARECIDO)

  async function crear() {
    setError('')
    if (!nombre.trim()) return setError('Ponle un nombre.')
    if (casiIgual && !confirmando) {
      setConfirmando(true)
      return
    }
    setGuardando(true)
    try {
      const creada = await api.crearIngrediente({
        nombre: nombre.trim(),
        unidad,
        tipo,
        exento,
        stock_actual: 0,
        stock_minimo: 0,
        stock_objetivo: 0,
        costo_unitario: 0,
        rendimiento_pct: 100,
        // Sin clasificar: nace de urgencia cargando una factura, y ese no es
        // el momento de pensar en qué cajón del depósito va.
        categoria_id: null,
        activo: true,
      })
      onCreada(creada)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear')
    } finally {
      setGuardando(false)
    }
  }

  const chip = (activo: boolean) =>
    `rounded-lg border px-3 py-2 text-sm text-left ${activo ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 bg-white'}`

  return (
    <Modal
      titulo="Mercancía nueva"
      onCerrar={onCerrar}
      ancho="sm"
      pie={
        <>
          <Boton tono="suave" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton onClick={() => void crear()} disabled={guardando}>
            {guardando ? 'Creando…' : confirmando ? 'Es otra, crearla' : 'Crear'}
          </Boton>
        </>
      }
    >
      <div className="space-y-4">
        {delPapel && (
          <p className="text-xs text-neutral-500">
            En la factura: <span className="font-medium text-neutral-700">{delPapel}</span>
          </p>
        )}
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">Nombre</span>
          <input
            value={nombre}
            onChange={(e) => {
              setNombre(e.target.value)
              setConfirmando(false)
            }}
            autoFocus
            placeholder="Ej. Crema de leche"
            className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm"
          />
          <span className="block text-xs text-neutral-500 mt-1">
            El nombre de la cosa, no del empaque: «Crema de leche», no «Crema de leche lata grande».
          </span>
        </label>

        {similares.length > 0 && (
          <div className={`rounded-xl border p-2 ${confirmando ? 'border-aviso-400 bg-aviso-50' : 'border-neutral-200 bg-neutral-50'}`}>
            <p className={`text-xs font-semibold px-1 pb-1.5 ${confirmando ? 'text-aviso-800' : 'text-neutral-600'}`}>
              {confirmando ? '¿Seguro que no es ninguna de estas?' : 'Ya tienes estas parecidas:'}
            </p>
            <ul className="space-y-1">
              {similares.map(({ ing }) => (
                <li key={ing.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5">
                  <span className="min-w-0 text-sm">
                    <span className="font-medium">{ing.nombre}</span>
                    <span className="text-xs text-neutral-500">
                      {' '}
                      · {ing.unidad} · hay {Number(ing.stock_actual || 0).toLocaleString('es-VE', { maximumFractionDigits: 2 })}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onUsar(ing)}
                    className="shrink-0 text-xs font-semibold border border-neutral-300 rounded-lg px-2.5 py-1"
                  >
                    Usar esta
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <span className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">Se lleva en</span>
          <div className="grid grid-cols-4 gap-1.5">
            {UNIDADES.map((u) => (
              <button key={u.valor} type="button" onClick={() => setUnidad(u.valor)} className={`${chip(unidad === u.valor)} text-center px-1`}>
                {u.texto}
              </button>
            ))}
          </div>
          <span className="block text-xs text-neutral-500 mt-1">Kilo y litro: los gramos y mililitros los maneja el sistema.</span>
        </div>

        <div>
          <span className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">Qué es</span>
          <div className="grid grid-cols-2 gap-1.5">
            {TIPOS_DE_COMPRA.map((o) => (
              <button key={o.valor} type="button" onClick={() => setTipo(o.valor)} className={chip(tipo === o.valor)}>
                <span className="block font-medium">{o.texto}</span>
                <span className={`block text-xs ${tipo === o.valor ? 'text-white/70' : 'text-neutral-500'}`}>{o.detalle}</span>
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={exento} onChange={(e) => setExento(e.target.checked)} className="h-4 w-4" />
          Exenta de IVA
        </label>

        {error && <p className="text-sm text-peligro-600">{error}</p>}
      </div>
    </Modal>
  )
}
