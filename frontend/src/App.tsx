import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import POS from './pages/POS'
import Cocina from './pages/Cocina'
import Inventario from './pages/Inventario'
import Menu from './pages/Menu'
import Caja from './pages/Caja'
import Reportes from './pages/Reportes'
import Ventas from './pages/Ventas'
import Tasa from './pages/Tasa'
import Contabilidad from './pages/Contabilidad'
import Compras from './pages/Compras'
import Impuestos from './pages/Impuestos'
import Inicio from './pages/Inicio'
import Recetas from './pages/Recetas'
import Usuarios from './pages/Usuarios'
import MiUsuario from './pages/MiUsuario'
import Rail, { entraA } from './components/Rail'
import { DialogoProvider } from './components/dialogo'
import { MonedaProvider } from './lib/moneda'
import { AccesoProvider, useAcceso } from './lib/acceso'
import type { ReactNode } from 'react'

/**
 * Lo que cada rol puede abrir, modulo por modulo. Es comodidad --que un
 * cocinero no aterrice en una pantalla que le va a responder 403 en cada
 * llamada--; la cerradura de verdad esta en el middleware del backend.
 *
 * Se pregunta por el MODULO y no por "operar"/"administrar" porque con roles a
 * medida esas dos categorias ya no alcanzan: un mesonero opera el punto de
 * venta y no tiene por que entrar a compras.
 */
function Requiere({ modulo, children }: { modulo: string; children: ReactNode }) {
  const { estado } = useAcceso()
  if (!entraA(estado.puede, modulo)) return <Navigate to="/" replace />
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
        <DialogoProvider>
        <BrowserRouter>
          <Marco>
            <Routes>
              <Route path="/" element={<Inicio />} />
              <Route path="/cocina" element={<Cocina />} />
              <Route path="/mi-usuario" element={<MiUsuario />} />
              {/* La pantalla se llamaba "Mi cuenta": el enlace viejo sigue llevando. */}
              <Route path="/mi-cuenta" element={<Navigate to="/mi-usuario" replace />} />

              <Route path="/pos" element={<Requiere modulo="pos"><POS /></Requiere>} />
              <Route path="/inventario" element={<Requiere modulo="inventario"><Inventario /></Requiere>} />
              <Route path="/menu" element={<Requiere modulo="menu"><Menu /></Requiere>} />
              <Route path="/caja" element={<Requiere modulo="caja"><Caja /></Requiere>} />
              <Route path="/ventas" element={<Requiere modulo="ventas"><Ventas /></Requiere>} />
              <Route path="/reportes" element={<Requiere modulo="reportes"><Reportes /></Requiere>} />
              <Route path="/tasa" element={<Requiere modulo="tasa"><Tasa /></Requiere>} />
              <Route path="/compras" element={<Requiere modulo="compras"><Compras /></Requiere>} />
              <Route path="/recetas" element={<Requiere modulo="recetas"><Recetas /></Requiere>} />

              <Route path="/contabilidad" element={<Requiere modulo="contabilidad"><Contabilidad /></Requiere>} />
              <Route path="/impuestos" element={<Requiere modulo="impuestos"><Impuestos /></Requiere>} />
              <Route path="/usuarios" element={<Requiere modulo="usuarios"><Usuarios /></Requiere>} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Marco>
        </BrowserRouter>
        </DialogoProvider>
      </MonedaProvider>
    </AccesoProvider>
  )
}
