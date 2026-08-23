import { BrowserRouter, Route, Routes, Link } from 'react-router-dom'
import POS from './pages/POS'
import Cocina from './pages/Cocina'
import Inventario from './pages/Inventario'
import Menu from './pages/Menu'
import Caja from './pages/Caja'

function Inicio() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-100">
      <div className="flex flex-wrap justify-center gap-6 max-w-3xl p-6">
        <Link
          to="/pos"
          className="bg-white shadow rounded-2xl p-10 text-xl font-medium hover:scale-105 transition"
        >
          Punto de venta
        </Link>
        <Link
          to="/cocina"
          className="bg-neutral-900 text-white shadow rounded-2xl p-10 text-xl font-medium hover:scale-105 transition"
        >
          Cocina
        </Link>
        <Link
          to="/inventario"
          className="bg-indigo-600 text-white shadow rounded-2xl p-10 text-xl font-medium hover:scale-105 transition"
        >
          Inventario
        </Link>
        <Link
          to="/menu"
          className="bg-amber-500 text-white shadow rounded-2xl p-10 text-xl font-medium hover:scale-105 transition"
        >
          Menu
        </Link>
        <Link
          to="/caja"
          className="bg-blue-600 text-white shadow rounded-2xl p-10 text-xl font-medium hover:scale-105 transition"
        >
          Cierre de caja
        </Link>
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
      </Routes>
    </BrowserRouter>
  )
}
