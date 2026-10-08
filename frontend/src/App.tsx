import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import RecordarScroll from './components/RecordarScroll'
import { Component, Suspense, lazy } from 'react'
// EAGER, a proposito: son las dos pantallas que viven montadas en la tablet
// del mostrador. Tienen que abrir sin esperar nada, y sobre todo tienen que
// seguir abriendo cuando el wifi del local parpadea -- un trozo que no
// descarga dejaria al cajero con la pantalla en blanco y un cliente enfrente.
import POS from './pages/POS'
import Cocina from './pages/Cocina'
// El inicio tambien: es lo primero que se ve al entrar.
import Inicio from './pages/Inicio'
import Rail, { entraA, sinBarraLateral } from './components/Rail'
import Conexion from './components/Conexion'
import Solicitudes from './components/Solicitudes'
import { DialogoProvider } from './components/dialogo'
import { DeshacerProvider } from './components/Deshacer'
import { TecladoProvider } from './components/Teclado'
import { MonedaProvider } from './lib/moneda'
import { AccesoProvider, useAcceso } from './lib/acceso'
import { usePalabras } from './lib/palabras'
import type { ComponentType, ReactNode } from 'react'

const CLAVE_RECARGA = 'erp-recargado-por-modulo'

/**
 * `lazy` que aguanta las dos formas en que esto falla de verdad.
 *
 * 1. EL WIFI PARPADEO. React no reintenta solo: la pantalla se queda rota
 *    hasta que alguien recargue. En un local donde la conexion se cae a media
 *    cuadra del router eso no es hipotetico, y un segundo intento no cuesta
 *    nada cuando el primero funciona.
 *
 * 2. SE DESPLEGO CON LA TABLET ABIERTA. Al construir, cada modulo lleva un
 *    hash en el nombre; despues de un despliegue los archivos viejos ya no
 *    existen. La tablet que lleva horas abierta en el mostrador tiene en
 *    memoria el index viejo y pide un trozo que ya nadie sirve: reintentar no
 *    sirve de nada porque el archivo no va a volver. Lo que hace falta es
 *    recargar la pagina, que trae el index nuevo.
 *
 *    La marca en `sessionStorage` evita el bucle: si despues de recargar
 *    vuelve a fallar, el problema es otro y hay que dejarlo fallar a la vista
 *    en vez de recargar para siempre.
 */
function perezoso(carga: () => Promise<{ default: ComponentType }>) {
  return lazy(() =>
    carga()
      .then((modulo) => {
        try {
          sessionStorage.removeItem(CLAVE_RECARGA)
        } catch {
          // navegador sin almacenamiento: el reintento de abajo sigue valiendo
        }
        return modulo
      })
      .catch(
        () =>
          new Promise<{ default: ComponentType }>((resolver, rechazar) => {
            setTimeout(() => {
              carga().then(resolver, (error) => {
                let yaRecargo = false
                try {
                  yaRecargo = sessionStorage.getItem(CLAVE_RECARGA) === '1'
                  sessionStorage.setItem(CLAVE_RECARGA, '1')
                } catch {
                  // sin almacenamiento no se puede distinguir: no se recarga,
                  // que es lo seguro (mejor un error visible que un bucle).
                  yaRecargo = true
                }
                if (!yaRecargo) window.location.reload()
                else rechazar(error)
              })
            }, 800)
          }),
      ),
  )
}

// El resto se descarga cuando se abre. Son modulos de administracion: se
// entran a proposito y de vez en cuando, no en medio de una venta. Asi el
// paquete que carga la tablet al abrir el mostrador baja a menos de la mitad.
const Inventario = perezoso(() => import('./pages/Inventario'))
const Menu = perezoso(() => import('./pages/Menu'))
const Caja = perezoso(() => import('./pages/Caja'))
const Reportes = perezoso(() => import('./pages/Reportes'))
const Ventas = perezoso(() => import('./pages/Ventas'))
const Tasa = perezoso(() => import('./pages/Tasa'))
const Contabilidad = perezoso(() => import('./pages/Contabilidad'))
const Compras = perezoso(() => import('./pages/Compras'))
const Impuestos = perezoso(() => import('./pages/Impuestos'))
const Configuracion = perezoso(() => import('./pages/Configuracion'))
const Contador = perezoso(() => import('./pages/Contador'))

/** Lo que se ve el instante que tarda en llegar el modulo. */
function Cargando() {
  return (
    <div className="min-h-screen bg-neutral-50 grid place-items-center">
      <span className="text-sm text-neutral-400">Abriendo…</span>
    </div>
  )
}

/**
 * La red de seguridad de todo lo anterior.
 *
 * Si un modulo no llega ni con el reintento ni con la recarga, React descarta
 * el arbol entero y la pantalla se queda EN BLANCO -- sin un mensaje, sin un
 * boton, nada. En un mostrador con un cliente delante eso es lo peor que
 * puede pasar: el cajero no sabe si fue el wifi, si rompio algo, ni a quien
 * llamar.
 *
 * Con esto, lo peor que pasa es un cartel que dice que no cargo y un boton
 * para volver a intentar. La barra lateral sigue viva, asi que el mostrador
 * queda a un toque de distancia.
 */
class SiNoCarga extends Component<{ children: ReactNode }, { fallo: boolean }> {
  state = { fallo: false }

  static getDerivedStateFromError() {
    return { fallo: true }
  }

  render() {
    if (!this.state.fallo) return this.props.children
    return (
      <div className="min-h-screen bg-neutral-50 grid place-items-center p-6">
        <div className="max-w-sm text-center">
          <h1 className="font-semibold text-lg">No se pudo abrir esta pantalla</h1>
          <p className="text-sm text-neutral-500 mt-2">
            Suele ser la conexión. El punto de venta y la cocina siguen funcionando.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white"
          >
            Reintentar
          </button>
        </div>
      </div>
    )
  }
}

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
 * Igual que `Requiere`, pero para una pantalla que junta dos módulos (Menú y
 * recetas). Entra con CUALQUIERA de los dos: un rol a medida que solo tenga
 * "recetas" no debería quedarse afuera de la pantalla, aunque dentro de ella
 * solo vea su propia pestaña (eso lo decide la pantalla, no esta guarda).
 */
function RequiereAlguno({ modulos, children }: { modulos: string[]; children: ReactNode }) {
  const { estado } = useAcceso()
  if (!modulos.some((m) => entraA(estado.puede, m))) return <Navigate to="/" replace />
  return <>{children}</>
}

/**
 * El marco: la barra lateral y, a su derecha, la pantalla. Cocina y el
 * mostrador van solos a pantalla completa (ver `sinBarraLateral`): ni se
 * muestra la barra ni se deja su hueco.
 */
function Marco({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const conRail = !sinBarraLateral(pathname)
  // Las palabras (sencillas o tecnicas) se leen al pintar: al cambiar de
  // modo en Configuracion › Lenguaje, la pantalla se vuelve a montar para
  // que TODO cambie de una, no solo lo que casualmente se repinte.
  const { modo } = usePalabras()
  return (
    <>
      <Rail />
      {/* Cada pantalla abre arriba la primera vez y donde se dejó al volver. */}
      <RecordarScroll />
      <div className={conRail ? 'md:pl-[68px]' : ''}>
        <Conexion />
        <div key={modo} className="contents">
          {children}
        </div>
        {/* Los avisos de "fulano pide autorizacion", solo para quien autoriza. */}
        <Solicitudes />
      </div>
    </>
  )
}

export default function App() {
  return (
    <AccesoProvider>
      <MonedaProvider>
        {/* El teclado va por FUERA de los dialogos: los cuadros de "pedir un
            numero" tambien lo usan y tienen que verlo. */}
        <TecladoProvider>
        <DialogoProvider>
        <DeshacerProvider>
        <BrowserRouter>
          <Marco>
            {/* Dentro del <Marco>: la barra lateral y el aviso de conexion no
                parpadean mientras llega el modulo. */}
            <SiNoCarga>
            <Suspense fallback={<Cargando />}>
            <Routes>
              <Route path="/" element={<Inicio />} />
              <Route path="/cocina" element={<Cocina />} />
              {/* Configuracion es de todos; dentro, las pestañas de administrar
                  solo se ofrecen a quien administra (y el backend responde 403
                  al resto). Las rutas viejas siguen llegando a su pestaña. */}
              <Route path="/configuracion/:seccion?" element={<Configuracion />} />
              <Route path="/mi-usuario" element={<Navigate to="/configuracion/cuenta" replace />} />
              {/* La pantalla se llamaba "Mi cuenta": el enlace viejo sigue llevando. */}
              <Route path="/mi-cuenta" element={<Navigate to="/configuracion/cuenta" replace />} />

              <Route path="/pos/:seccion?" element={<Requiere modulo="pos"><POS /></Requiere>} />
              <Route path="/inventario/:seccion?" element={<Requiere modulo="inventario"><Inventario /></Requiere>} />
              <Route path="/menu/:seccion?" element={<RequiereAlguno modulos={['menu', 'recetas']}><Menu /></RequiereAlguno>} />
              <Route path="/recetas" element={<Navigate to="/menu/recetas" replace />} />
              <Route path="/caja/:seccion?" element={<Requiere modulo="caja"><Caja /></Requiere>} />
              <Route path="/ventas/:seccion?" element={<Requiere modulo="ventas"><Ventas /></Requiere>} />
              <Route path="/reportes/:seccion?" element={<Requiere modulo="reportes"><Reportes /></Requiere>} />
              <Route path="/tasa/:seccion?" element={<Requiere modulo="tasa"><Tasa /></Requiere>} />
              <Route path="/compras/:seccion?" element={<Requiere modulo="compras"><Compras /></Requiere>} />

              {/* La puerta unica a lo que se arma solo: contabilidad, impuestos, tasa. */}
              <Route path="/contador" element={<RequiereAlguno modulos={['contabilidad', 'impuestos', 'tasa']}><Contador /></RequiereAlguno>} />
              <Route path="/contabilidad/:seccion?" element={<Requiere modulo="contabilidad"><Contabilidad /></Requiere>} />
              <Route path="/impuestos/:seccion?" element={<Requiere modulo="impuestos"><Impuestos /></Requiere>} />
              <Route path="/usuarios" element={<Navigate to="/configuracion/usuarios" replace />} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </Suspense>
            </SiNoCarga>
          </Marco>
        </BrowserRouter>
        </DeshacerProvider>
        </DialogoProvider>
        </TecladoProvider>
      </MonedaProvider>
    </AccesoProvider>
  )
}
