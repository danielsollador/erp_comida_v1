import { useMemo, useState } from 'react'
import { api } from '../lib/api'
import { MUY_PARECIDO, parecidos } from '../lib/parecidos'
import { ALMACEN_DE } from '../lib/tiposArticulo'
import type { Ingrediente, TipoArticulo } from '../lib/types'
import { Numerico } from './Teclado'
import { ElegirAlmacen, PuntoTipo } from './compras/Almacenes'
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
 * Tres preguntas: cómo se llama, qué es (el almacén) y en qué se lleva. Y una
 * cuarta, opcional, que es la que evita los duplicados por presentación:
 * ¿cómo te llega? Si llega en caja o paquete, la ficha se lleva en unidades
 * y la caja queda como la presentación del proveedor: "1 caja = 24". La
 * mercancía es la malta; la caja es cómo la vende ese proveedor.
 */

const UNIDADES = [
  { valor: 'kg', texto: 'Kilos', nota: 'y gramos' },
  { valor: 'lt', texto: 'Litros', nota: 'y mililitros' },
  { valor: 'unidad', texto: 'Unidades', nota: 'de una en una' },
]

/** Cómo llega del proveedor: en un envase que trae varias unidades nuestras. */
export type Presentacion = { nombre: string; trae: number }

export default function NuevaMercancia({
  ingredientes,
  nombre: nombreInicial = '',
  unidad: unidadInicial = 'kg',
  exento: exentoInicial = false,
  tipo: tipoInicial = null,
  delPapel,
  onUsar,
  onCreada,
  onCerrar,
}: {
  ingredientes: Ingrediente[]
  nombre?: string
  unidad?: string
  exento?: boolean
  /** Si ya se dijo qué es (el renglón de la factura lo eligió antes). */
  tipo?: TipoArticulo | null
  /** Lo que dice la factura, para tenerlo a la vista mientras se nombra. */
  delPapel?: string
  onUsar: (ing: Ingrediente) => void
  onCreada: (ing: Ingrediente, presentacion: Presentacion | null) => void
  onCerrar: () => void
}) {
  const [nombre, setNombre] = useState(nombreInicial)
  const [unidad, setUnidad] = useState(unidadInicial === 'paquete' ? 'unidad' : unidadInicial)
  const [tipo, setTipo] = useState<TipoArticulo | null>(tipoInicial)
  const [exento, setExento] = useState(exentoInicial)
  const [enPaquete, setEnPaquete] = useState(false)
  const [paqueteTrae, setPaqueteTrae] = useState('')
  const [confirmando, setConfirmando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const similares = useMemo(() => parecidos(nombre, ingredientes), [nombre, ingredientes])
  const casiIgual = similares.some((s) => s.puntos >= MUY_PARECIDO)

  async function crear() {
    setError('')
    if (!nombre.trim()) return setError('Ponle un nombre.')
    if (!tipo) return setError('Di qué es: a eso le dice el sistema a dónde va.')
    const trae = Number(paqueteTrae)
    if (enPaquete && (!Number.isFinite(trae) || trae <= 0)) return setError('¿Cuántas trae cada empaque?')
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
        // el momento de pensar en qué cajón del inventario va.
        categoria_id: null,
        activo: true,
      })
      // "empaque" a secas: caja, bulto o paquete da igual, lo que importa es
      // cuántas trae (Leider, 8-oct).
      onCreada(creada, enPaquete ? { nombre: 'empaque', trae } : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear')
    } finally {
      setGuardando(false)
    }
  }

  const chip = (activo: boolean) =>
    `vp-pulsable rounded-xl px-3 py-2.5 text-sm text-left transition-colors ${
      activo ? 'bg-neutral-900 text-white' : 'bg-neutral-500/6 hover:bg-neutral-500/10 text-neutral-900'
    }`

  const almacen = tipo ? ALMACEN_DE[tipo] : null

  return (
    <Modal
      titulo="Mercancía nueva"
      ayuda="Solo lo que hace falta para empezar. El resto se completa en Inventario."
      onCerrar={onCerrar}
      ancho="md"
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
      <div className="space-y-5">
        <div>
          {delPapel && (
            <p className="text-xs text-neutral-500 mb-2">
              En la factura: <span className="font-medium text-neutral-700">{delPapel}</span>
            </p>
          )}
          <input
            value={nombre}
            onChange={(e) => {
              setNombre(e.target.value)
              setConfirmando(false)
            }}
            autoFocus
            placeholder="¿Cómo se llama? Ej. Crema de leche"
            aria-label="Nombre de la mercancía"
            className="w-full border border-neutral-300 rounded-xl px-3.5 py-2.5 text-base font-medium"
          />
          <p className="text-xs text-neutral-500 mt-1.5">
            El nombre de la cosa, no del empaque: «Crema de leche», no «Crema de leche lata grande».
          </p>
        </div>

        {similares.length > 0 && (
          <div className={`rounded-2xl p-3 ${confirmando ? 'bg-aviso-50' : 'bg-neutral-500/6'}`}>
            <p className={`text-xs font-semibold mb-2 ${confirmando ? 'text-aviso-800' : 'text-neutral-600'}`}>
              {confirmando ? '¿Seguro que no es ninguna de estas?' : 'Ya tienes estas parecidas:'}
            </p>
            <ul className="space-y-1.5">
              {similares.map(({ ing }) => (
                <li key={ing.id} className="flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2">
                  <span className="min-w-0 flex items-center gap-2 text-sm">
                    <PuntoTipo tipo={ing.tipo} />
                    <span className="font-medium truncate">{ing.nombre}</span>
                    <span className="text-xs text-neutral-500 shrink-0">
                      · {ing.unidad} · hay {Number(ing.stock_actual || 0).toLocaleString('es-VE', { maximumFractionDigits: 2 })}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onUsar(ing)}
                    className="vp-control shrink-0 text-xs font-semibold rounded-full px-3 py-1.5"
                  >
                    Usar esta
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <p className="vp-etiqueta mb-2">Qué es</p>
          <ElegirAlmacen valor={tipo} alElegir={setTipo} compacto />
          {almacen && (
            <p className="text-xs text-neutral-500 mt-2">
              {almacen.detalle}{' '}
              {almacen.destino === 'gasto'
                ? 'No se lleva stock: cada factura va entera al gasto del mes.'
                : 'Entra al inventario y se descuenta al venderse o usarse en una receta.'}
            </p>
          )}
        </div>

        <div>
          <p className="vp-etiqueta mb-2">Se lleva en</p>
          <div className="grid grid-cols-3 gap-2">
            {UNIDADES.map((u) => (
              <button key={u.valor} type="button" onClick={() => setUnidad(u.valor)} className={chip(unidad === u.valor)}>
                <span className="block font-semibold">{u.texto}</span>
                <span className={`block text-xs ${unidad === u.valor ? 'text-white/70' : 'text-neutral-500'}`}>{u.nota}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="vp-etiqueta mb-2">Cómo te llega</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setEnPaquete(false)} className={chip(!enPaquete)}>
              <span className="block font-semibold">Suelta</span>
              <span className={`block text-xs ${!enPaquete ? 'text-white/70' : 'text-neutral-500'}`}>
                por {unidad === 'kg' ? 'kilo' : unidad === 'lt' ? 'litro' : 'unidad'}, tal cual
              </span>
            </button>
            <button type="button" onClick={() => setEnPaquete(true)} className={chip(enPaquete)}>
              <span className="block font-semibold">En empaque</span>
              <span className={`block text-xs ${enPaquete ? 'text-white/70' : 'text-neutral-500'}`}>
                trae varias; se cuentan de una en una
              </span>
            </button>
          </div>
          {enPaquete && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-neutral-600">1 empaque trae</span>
              <Numerico
                value={paqueteTrae}
                onChange={(e) => setPaqueteTrae(e.target.value)}
                etiqueta="Cuántas trae"
                placeholder="24"
                className="w-24 border border-neutral-300 rounded-xl px-3 py-2 text-sm"
              />
              <span className="text-neutral-600">{unidad === 'unidad' ? 'unidades' : unidad}</span>
              <p className="basis-full text-xs text-neutral-500">
                Se recuerda para este proveedor: la próxima factura ya viene convertida.
              </p>
            </div>
          )}
        </div>

        <label className="flex items-center gap-2.5 text-sm cursor-pointer">
          <input type="checkbox" checked={exento} onChange={(e) => setExento(e.target.checked)} className="h-4 w-4" />
          Exenta de IVA
          <span className="text-xs text-neutral-500">(la mayoría de los alimentos básicos)</span>
        </label>

        {error && <p className="text-sm text-peligro-600">{error}</p>}
      </div>
    </Modal>
  )
}
