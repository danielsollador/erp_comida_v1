import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, connectWs } from '../lib/api'
import { MonedaToggle, useMoneda } from '../lib/moneda'
import type { ReporteResumen } from '../lib/types'

// Lo que se toca todos los dias va grande y arriba; la administracion, que se
// mira una vez a la semana o al mes, va abajo y mas chica. Un menu donde todo
// pesa igual obliga a leerlo entero cada vez.
const PRINCIPALES = [
  {
    to: '/pos',
    icono: '🛒',
    titulo: 'Punto de venta',
    desc: 'Armar la comanda y cobrar',
    clase: 'bg-neutral-900 text-white border-neutral-900',
    descClase: 'text-neutral-300',
  },
  {
    to: '/cocina',
    icono: '🍳',
    titulo: 'Cocina',
    desc: 'Comandas que llegan arriba',
    clase: 'bg-white border-neutral-200',
    descClase: 'text-neutral-500',
  },
  {
    to: '/reportes',
    icono: '📊',
    titulo: 'Reportes',
    desc: 'Como va el negocio',
    clase: 'bg-white border-neutral-200',
    descClase: 'text-neutral-500',
  },
]

const SECUNDARIAS = [
  { to: '/menu', icono: '📋', titulo: 'Menu' },
  { to: '/recetas', icono: '🧑‍🍳', titulo: 'Recetas' },
  { to: '/inventario', icono: '📦', titulo: 'Inventario' },
  { to: '/compras', icono: '🧾', titulo: 'Compras' },
  { to: '/caja', icono: '💵', titulo: 'Cierre de caja' },
  { to: '/tasa', icono: '💱', titulo: 'Tasa de cambio' },
  { to: '/contabilidad', icono: '🧮', titulo: 'Contabilidad' },
  { to: '/impuestos', icono: '🏛️', titulo: 'Impuestos' },
  { to: '/sistema', icono: '🛡️', titulo: 'Sistema' },
]

export default function Inicio() {
  const [hoy, setHoy] = useState<ReporteResumen | null>(null)
  const [enCocina, setEnCocina] = useState(0)
  const [porCobrar, setPorCobrar] = useState(0)
  const { fmt } = useMoneda()

  useEffect(() => {
    cargar()
    const disconnect = connectWs(() => cargar())
    return disconnect
  }, [])

  function cargar() {
    api.reporte('dia').then(setHoy).catch(() => undefined)
    api
      .listarPedidos('pendiente')
      .then((ps) => setEnCocina(ps.length))
      .catch(() => undefined)
    api
      .listarPedidos('listo')
      .then((ps) => setPorCobrar(ps.length))
      .catch(() => undefined)
  }

  const fecha = new Date().toLocaleDateString('es-VE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="max-w-3xl mx-auto p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold leading-tight">Hoy</h1>
            <p className="text-neutral-500 first-letter:uppercase">{fecha}</p>
          </div>
          <MonedaToggle />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <Dato titulo="Vendido hoy" valor={hoy ? fmt(hoy.ventas) : '—'} destacado />
          <Dato titulo="Pedidos" valor={hoy ? String(hoy.pedidos) : '—'} />
          <Dato
            titulo="En cocina"
            valor={String(enCocina)}
            alerta={enCocina > 0}
            enlace="/cocina"
          />
          <Dato
            titulo="Por cobrar"
            valor={String(porCobrar)}
            alerta={porCobrar > 0}
            enlace="/pos"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {PRINCIPALES.map((a) => (
            <Link
              key={a.to}
              to={a.to}
              className={`border shadow-sm rounded-2xl p-6 flex flex-col gap-1 hover:shadow-md hover:-translate-y-0.5 transition ${a.clase}`}
            >
              <span className="text-3xl mb-1">{a.icono}</span>
              <span className="font-semibold text-lg leading-tight">{a.titulo}</span>
              <span className={`text-sm ${a.descClase}`}>{a.desc}</span>
            </Link>
          ))}
        </div>

        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400 mb-3">
          Administracion
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {SECUNDARIAS.map((a) => (
            <Link
              key={a.to}
              to={a.to}
              className="bg-white border border-neutral-200 rounded-xl px-3 py-3 flex items-center gap-2.5 hover:border-neutral-300 hover:shadow-sm transition"
            >
              <span className="text-xl">{a.icono}</span>
              <span className="text-sm font-medium leading-tight">{a.titulo}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

function Dato({
  titulo,
  valor,
  destacado = false,
  alerta = false,
  enlace,
}: {
  titulo: string
  valor: string
  destacado?: boolean
  alerta?: boolean
  enlace?: string
}) {
  const contenido = (
    <div
      className={`rounded-2xl border p-4 h-full ${
        alerta ? 'bg-amber-50 border-amber-300' : 'bg-white border-neutral-200'
      }`}
    >
      <div className={`text-xs ${alerta ? 'text-amber-700' : 'text-neutral-500'}`}>{titulo}</div>
      <div
        className={`font-bold tabular-nums ${destacado ? 'text-2xl' : 'text-xl'} ${
          alerta ? 'text-amber-900' : ''
        }`}
      >
        {valor}
      </div>
    </div>
  )
  return enlace ? (
    <Link to={enlace} className="block">
      {contenido}
    </Link>
  ) : (
    contenido
  )
}
