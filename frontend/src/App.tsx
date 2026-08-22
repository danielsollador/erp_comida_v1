import { BrowserRouter, Route, Routes, Link } from 'react-router-dom'
import POS from './pages/POS'
import Cocina from './pages/Cocina'

function Inicio() {
  return (
    <div className="min-h-screen flex items-center justify-center gap-6 bg-neutral-100">
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
      </Routes>
    </BrowserRouter>
  )
}
