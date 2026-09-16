import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
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
import Recetas from './pages/Recetas'
import Usuarios from './pages/Usuarios'
import MiCuenta from './pages/MiCuenta'
import Rail from './components/Rail'
import { MonedaProvider } from './lib/moneda'
import { AccesoProvider, useAcceso } from './lib/acceso'
import type { ReactNode } from 'react'

/**
 * Lo que cada rol puede abrir. Es comodidad --que un cocinero no aterrice en
 * una pantalla que le va a responder 403 en cada llamada--; la cerradura de
 * verdad esta en el middleware del backend.
 */
function Requiere({ que, children }: { que: 'operar' | 'administrar'; children: ReactNode }) {
  const { estado } = useAcceso()
  if (!estado.puede[que]) return <Navigate to="/" replace />
  return <>{children}</>
}

/**
 * El marco: la barra lateral y, a su derecha, la pantalla. La cocina va sola a
 * pantalla completa (la barra no se muestra y no se deja hueco).
 */
function Marco({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const conRail = !pathname.startsWith('/cocina')
  return (
    <>
      <Rail />
      <div className={conRail ? 'md:pl-[68px]' : ''}>{children}</div>
    </>
  )
}

export default function App() {
  return (
    <AccesoProvider>
      <MonedaProvider>
        <BrowserRouter>
          <Marco>
            <Routes>
              <Route path="/" element={<Inicio />} />
              <Route path="/cocina" element={<Cocina />} />
              <Route path="/mi-cuenta" element={<MiCuenta />} />

              <Route path="/pos" element={<Requiere que="operar"><POS /></Requiere>} />
              <Route path="/inventario" element={<Requiere que="operar"><Inventario /></Requiere>} />
              <Route path="/menu" element={<Requiere que="operar"><Menu /></Requiere>} />
              <Route path="/caja" element={<Requiere que="operar"><Caja /></Requiere>} />
              <Route path="/reportes" element={<Requiere que="operar"><Reportes /></Requiere>} />
              <Route path="/tasa" element={<Requiere que="operar"><Tasa /></Requiere>} />
              <Route path="/compras" element={<Requiere que="operar"><Compras /></Requiere>} />
              <Route path="/recetas" element={<Requiere que="operar"><Recetas /></Requiere>} />

              <Route path="/sistema" element={<Requiere que="administrar"><Sistema /></Requiere>} />
              <Route path="/contabilidad" element={<Requiere que="administrar"><Contabilidad /></Requiere>} />
              <Route path="/impuestos" element={<Requiere que="administrar"><Impuestos /></Requiere>} />
              <Route path="/usuarios" element={<Requiere que="administrar"><Usuarios /></Requiere>} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Marco>
        </BrowserRouter>
      </MonedaProvider>
    </AccesoProvider>
  )
}
