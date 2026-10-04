/**
 * EL ACABADO DE APP, solo cuando corre como app nativa (Android / iOS).
 *
 * Leider (4-oct): "no quiero que se vea como un sitio web dentro de una app".
 * Lo que delata a una web metida en una app no es el contenido sino los
 * bordes: la barra de estado de otro color, el rebote al final de la pagina,
 * el texto que se selecciona al mantener el dedo, el boton atras de Android
 * que cierra la app de golpe, la pantalla en blanco al abrir. Esto los cuida.
 * En el navegador no hace nada.
 */
import { esApp, plataforma } from './plataforma'

export async function prepararApp() {
  if (!esApp) return
  const raiz = document.documentElement
  raiz.classList.add('vp-app', `vp-app-${plataforma}`)

  const [{ StatusBar, Style }, { SplashScreen }, { App }, { Keyboard }] = await Promise.all([
    import('@capacitor/status-bar'),
    import('@capacitor/splash-screen'),
    import('@capacitor/app'),
    import('@capacitor/keyboard'),
  ])

  // La barra de estado del color del fondo, con iconos que se lean sobre el.
  const pintarBarra = () => {
    const oscuro = raiz.getAttribute('data-tema') === 'oscuro'
    const fondo = getComputedStyle(raiz).getPropertyValue('--vp-papel').trim() || (oscuro ? '#0e1014' : '#f6f4ef')
    StatusBar.setStyle({ style: oscuro ? Style.Dark : Style.Light }).catch(() => undefined)
    if (plataforma === 'android') {
      StatusBar.setOverlaysWebView({ overlay: false }).catch(() => undefined)
      StatusBar.setBackgroundColor({ color: fondo }).catch(() => undefined)
    }
  }
  pintarBarra()
  // Al cambiar de tema (`data-tema`), la barra cambia con el.
  new MutationObserver(pintarBarra).observe(raiz, { attributes: true, attributeFilter: ['data-tema'] })

  // EL BOTON ATRAS DE ANDROID hace lo que hace en cualquier app: vuelve a la
  // pantalla anterior; en la portada (o en el login) sale de la app.
  App.addListener('backButton', ({ canGoBack }) => {
    const enInicio = location.pathname === '/' || location.pathname.endsWith('/login.html')
    if (canGoBack && !enInicio) window.history.back()
    else App.exitApp()
  }).catch(() => undefined)

  // Con el teclado abierto, la pantalla se acomoda en vez de taparse.
  Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => undefined)

  // La pantalla de arranque se quita cuando ya hay algo que ver, con un
  // fundido: sin el destello blanco de una pagina que carga.
  requestAnimationFrame(() => {
    SplashScreen.hide({ fadeOutDuration: 250 }).catch(() => undefined)
  })
}
