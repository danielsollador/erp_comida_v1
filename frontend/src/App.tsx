import { BrowserRouter, Route, Routes, Link } from 'react-router-dom'
import POS from './pages/POS'
import Cocina from './pages/Cocina'
import Inventario from './pages/Inventario'
import Menu from './pages/Menu'
import Caja from './pages/Caja'
import Reportes from './pages/Reportes'
import Sistema from './pages/Sistema'

const ACCESOS = [
  { to: '/pos', icono: '🛒', titulo: 'Punto de venta', desc: 'Armar y cobrar pedidos' },
  { to: '/cocina', icono: '🍳', titulo: 'Cocina', desc: 'Comandas en tiempo real' },
  { to: '/reportes', icono: '📊', titulo: 'Reportes', desc: 'Dia, semana y mes' },
  { to: '/menu', icono: '📋', titulo: 'Menu', desc: 'Productos y precios' },
  { to: '/inventario', icono: '📦', titulo: 'Inventario', desc: 'Insumos y compras' },
  { to: '/caja', icono: '💵', titulo: 'Cierre de caja', desc: 'Cuadre y gastos' },
  { to: '/sistema', icono: '🛡️', titulo: 'Sistema', desc: 'Respaldo de datos' },
]

function Inicio() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50">
      <div className="max-w-3xl w-full p-6">
        <h1 className="text-2xl font-bold text-center mb-1">Punto de venta</h1>
        <p className="text-center text-neutral-500 mb-8">Elige una seccion</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {ACCESOS.map((a) => (
            <Link
              key={a.to}
              to={a.to}
              className="bg-white border border-neutral-200 shadow-sm rounded-2xl p-6 flex flex-col items-center text-center gap-2 hover:shadow-md hover:-translate-y-0.5 transition"
            >
              <span className="text-4xl">{a.icono}</span>
              <span className="font-semibold">{a.titulo}</span>
              <span className="text-xs text-neutral-500">{a.desc}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Inicio />} />
        <Route path="/pos" element={<POS />} />
        <Route path="/cocina" element={<Cocina />} />
        <Route path="/inventario" element={<Inventario />} />
        <Route path="/menu" element={<Menu />} />
        <Route path="/caja" element={<Caja />} />
        <Route path="/reportes" element={<Reportes />} />
        <Route path="/sistema" element={<Sistema />} />
      </Routes>
    </BrowserRouter>
  )
}
