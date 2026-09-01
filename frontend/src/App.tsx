import { BrowserRouter, Route, Routes } from 'react-router-dom'
import POS from './pages/POS'
import Cocina from './pages/Cocina'
import Inventario from './pages/Inventario'
import Menu from './pages/Menu'
import Caja from './pages/Caja'
import Reportes from './pages/Reportes'
import Sistema from './pages/Sistema'
import Tasa from './pages/Tasa'
import Contabilidad from './pages/Contabilidad'
import Compras from './pages/Compras'
import Impuestos from './pages/Impuestos'
import Inicio from './pages/Inicio'
import { MonedaProvider } from './lib/moneda'

export default function App() {
  return (
    <MonedaProvider>
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
          <Route path="/tasa" element={<Tasa />} />
          <Route path="/contabilidad" element={<Contabilidad />} />
          <Route path="/compras" element={<Compras />} />
          <Route path="/impuestos" element={<Impuestos />} />
        </Routes>
      </BrowserRouter>
    </MonedaProvider>
  )
}
