import { useEffect, useState } from 'react'
import { useRecordado } from '../lib/memoria'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import type { ArranqueLocal } from '../lib/types'
import Icono from './Icono'

/**
 * Las misiones de arranque: por donde empezar cuando el local esta vacio.
 *
 * Antes, quien entraba por primera vez encontraba doce modulos y ninguna
 * pista (Leider, 30-sep: "no hay un camino de arranque"). Esto es lo que se
 * siente como un juego sin serlo: sabes que toca, ves cuanto llevas, y cada
 * paso te deja algo que antes no tenias --al ponerle receta a un producto
 * descubres cuanto te deja--. Se va solo cuando todo esta hecho.
 */
const CLAVE_OCULTO = 'vp-arranque-oculto'

export type Paso = { id: string; titulo: string; detalle: string; a: string; hecho: boolean }

export function pasos(a: ArranqueLocal): Paso[] {
  return [
    {
      id: 'productos',
      titulo: 'Carga lo que vendes',
      detalle: a.productos >= 5 ? `${a.productos} productos en el menú` : `${a.productos} de 5 productos para empezar`,
      a: '/menu',
      hecho: a.productos >= 5,
    },
    {
      id: 'mercancia',
      titulo: 'Anota tu mercancía',
      detalle: a.mercancias ? `${a.mercancias} en el depósito` : 'Harina, queso, vasos: con lo que cocinas',
      a: '/inventario',
      hecho: a.mercancias >= 1,
    },
    {
      id: 'receta',
      titulo: 'Ponle receta a un producto',
      detalle: a.con_receta ? `${a.con_receta} con receta` : 'Y descubre cuánto te deja cada uno',
      a: '/menu/recetas',
      hecho: a.con_receta >= 1,
    },
    {
      id: 'venta',
      titulo: 'Haz tu primera venta',
      detalle: a.ventas ? `${a.ventas} vendidas` : 'Desde el punto de venta',
      a: '/pos',
      hecho: a.ventas >= 1,
    },
    {
      id: 'caja',
      titulo: 'Cierra tu primera caja',
      detalle: a.cierres ? `${a.cierres} cierres` : 'Cuenta la gaveta y cuadra el día',
      a: '/caja',
      hecho: a.cierres >= 1,
    },
  ]
}

function leerOculto(): boolean {
  try {
    return localStorage.getItem(CLAVE_OCULTO) === '1'
  } catch {
    return false
  }
}

export default function Arranque({ quien = '' }: { quien?: string }) {
  // Lo ultimo que se mostro, para no aparecer de golpe al volver a la portada.
  const [datos, setDatos] = useRecordado<ArranqueLocal | null>(`${quien}:arranque`, null)
  const [oculto, setOculto] = useState(leerOculto)

  useEffect(() => {
    api.arranque().then(setDatos).catch(() => undefined)
  }, [setDatos])

  if (!datos || oculto) return null
  const lista = pasos(datos)
  const hechos = lista.filter((p) => p.hecho).length
  // Todo hecho: la mision cumplio y se va sola.
  if (hechos === lista.length) return null
  const siguiente = lista.find((p) => !p.hecho)

  function esconder() {
    try {
      localStorage.setItem(CLAVE_OCULTO, '1')
    } catch {
      // sin almacenamiento se esconde igual hasta recargar
    }
    setOculto(true)
  }

  return (
    <section className="vp-losa p-5 sm:p-6 bajo:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="vp-etiqueta">Para arrancar</p>
          <h2 className="mt-1 font-display text-xl sm:text-2xl font-semibold tracking-tight leading-tight">
            {siguiente ? siguiente.titulo : 'Listo'}
          </h2>
          <p className="mt-1 text-sm text-neutral-500">
            {hechos} de {lista.length} pasos · {siguiente?.detalle}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {siguiente && (
            <Link
              to={siguiente.a}
              className="vp-pulsable inline-flex items-center gap-2 rounded-full bg-neutral-900 text-white pl-4 pr-1.5 py-1.5 text-sm font-semibold"
            >
              Ir
              <span className="w-7 h-7 rounded-full bg-white/12 grid place-items-center">
                <Icono nombre="chevron" size={14} />
              </span>
            </Link>
          )}
          <button
            type="button"
            onClick={esconder}
            className="vp-pulsable rounded-full px-3 py-2 text-sm text-neutral-500 hover:text-neutral-800"
            title="Ya sé por dónde voy"
          >
            Ocultar
          </button>
        </div>
      </div>

      {/* La barra: cuanto del negocio esta armado. */}
      <div className="mt-4 h-2 rounded-full bg-neutral-100 overflow-hidden">
        <div
          className="vp-barra-h h-full rounded-full bg-exito-500"
          style={{ width: `${(hechos / lista.length) * 100}%` }}
        />
      </div>

      <ol className="mt-4 grid gap-2 sm:grid-cols-5">
        {lista.map((p, i) => (
          <li key={p.id}>
            <Link
              to={p.a}
              className={`flex sm:flex-col items-center sm:items-start gap-2.5 sm:gap-2 rounded-2xl px-3 py-2.5 text-sm transition-colors ${
                p.hecho
                  ? 'text-neutral-400'
                  : p === siguiente
                    ? 'bg-acento-50 text-acento-900'
                    : 'text-neutral-600 hover:bg-neutral-100'
              }`}
            >
              <span
                className={`shrink-0 w-6 h-6 rounded-full grid place-items-center text-xs font-bold ${
                  p.hecho ? 'bg-exito-500 text-white' : p === siguiente ? 'bg-acento-600 text-white' : 'bg-neutral-100 text-neutral-500'
                }`}
              >
                {p.hecho ? <Icono nombre="ok" size={13} /> : i + 1}
              </span>
              <span className={`leading-snug ${p.hecho ? 'line-through decoration-neutral-300' : 'font-medium'}`}>{p.titulo}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
