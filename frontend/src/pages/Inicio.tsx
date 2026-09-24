import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import Icono, { type NombreIcono } from '../components/Icono'
import Marca from '../components/Marca'
import { Ayuda } from '../components/Ayuda'
import { explicar } from '../lib/glosario'
import { MODULOS, entraAModulo } from '../components/Rail'
import UsuarioMenu from '../components/UsuarioMenu'
import Notificaciones from '../components/Notificaciones'
import { useAcceso } from '../lib/acceso'
import { api, connectWs } from '../lib/api'
import { rangoDe } from '../lib/fechas'
import { MonedaToggle, useMoneda } from '../lib/moneda'
import { PantallaCompletaToggle } from '../lib/pantallaCompleta'
import { TemaToggle } from '../lib/tema'
import type { ReporteResumen } from '../lib/types'

// Lo que se toca todos los dias va grande y arriba; la administracion, que se
// mira una vez a la semana o al mes, va abajo y mas chica. Un menu donde todo
// pesa igual obliga a leerlo entero cada vez.
const DESCRIPCION: Record<string, string> = {
  '/pos': 'Armar la comanda y cobrar',
  '/cocina': 'Comandas que llegan arriba',
  '/ventas': 'Cada venta y qué pasó con ella',
  '/reportes': 'Cómo va el negocio',
  // Las de administracion solo se ven en pantallas altas (tablet en
  // vertical), donde las fichas crecen y una sola palabra las deja vacias.
  '/menu': 'Productos, precios y recetas',
  '/inventario': 'Mercancía, stock y costos',
  '/compras': 'Lo que entra y lo que cuesta',
  '/caja': 'Cuadrar el día',
  '/tasa': 'Bolívares por dólar de hoy',
  '/contabilidad': 'Libro, gastos y resultados',
  '/impuestos': 'IVA y libros fiscales',
  '/usuarios': 'Quién entra y qué puede hacer',
}

function saludo(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Buenos días'
  if (h < 19) return 'Buenas tardes'
  return 'Buenas noches'
}

/**
 * Cuantas columnas para que `n` fichas no dejen huecos: el mayor divisor
 * exacto entre los candidatos. Diez modulos van en 5 (dos filas llenas), seis
 * en 3; si ninguno divide (siete), se usa el primero y el mosaico ensancha
 * las ultimas fichas para completar la fila (ver `.vp-mosaico`).
 */
function columnasSinHuecos(n: number, candidatas: number[]): number {
  return candidatas.find((c) => c <= n && n % c === 0) ?? candidatas[0]
}

/**
 * La portada.
 *
 * UNA SOLA COSA GRANDE. Antes eran dieciseis rectangulos blancos del mismo
 * tamaño y el mismo borde --cuatro cifras, tres accesos, nueve modulos-- y lo
 * mas destacado de la pantalla era el saludo, que no es informacion. Ahora la
 * jerarquia sigue a lo que se pregunta al entrar: cuanto se ha vendido hoy
 * (el panel grande), que esta esperando (las dos fichas de accion, que solo
 * se encienden si hay algo), a donde voy (operacion), y el resto recogido en
 * una bandeja para que nueve modulos pesen como un bloque y no como nueve.
 */
export default function Inicio() {
  const { estado } = useAcceso()
  const [hoy, setHoy] = useState<ReporteResumen | null>(null)
  const [enCocina, setEnCocina] = useState(0)
  const [porCobrar, setPorCobrar] = useState(0)
  const { fmt } = useMoneda()

  const entra = (m: (typeof MODULOS)[number]) => entraAModulo(estado.puede, m.modulo)
  const operacion = MODULOS.filter((m) => m.grupo === 'operacion' && entra(m))
  const administracion = MODULOS.filter((m) => m.grupo === 'administracion' && entra(m))

  useEffect(() => {
    cargar()
    const disconnect = connectWs(() => cargar())
    return disconnect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function cargar() {
    // Los reportes son de caja para arriba; a cocina le responden 403 y no se
    // pintan. Los pedidos si los ve todo el mundo.
    if (estado.puede.operar) api.reporte(rangoDe('hoy')).then(setHoy).catch(() => undefined)
    // El MISMO listado que pinta la pantalla de cocina, no `estado='pendiente'`.
    // Eran dos definiciones distintas de lo mismo: cobrar deja el pedido en
    // 'pagado' aunque la comida no se haya tocado, asi que el KPI decia "2"
    // mientras cocina tenia cientos de comandas sin preparar. Un numero en la
    // portada que no coincide con la pantalla a la que lleva no sirve de nada.
    api
      .listarPedidosEnCocina()
      .then((ps) => setEnCocina(ps.length))
      .catch(() => undefined)
    api
      .listarPedidos('listo')
      .then((ps) => setPorCobrar(ps.length))
      .catch(() => undefined)
  }

  const fecha = new Date().toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'long' })
  const nombre = estado.nombre || estado.nombre_visible || estado.usuario

  // El mosaico de administracion elige sus columnas segun cuantos modulos ve
  // este rol, para no dejar celdas vacias (ver `columnasSinHuecos`).
  const columnas = {
    '--cols-sm': columnasSinHuecos(administracion.length, [3, 2]),
    '--cols-lg': columnasSinHuecos(administracion.length, [5, 4, 3, 2]),
    // En vertical, pocas y anchas: la ficha va en fila y le cabe la descripcion.
    '--cols-alto': columnasSinHuecos(administracion.length, [2, 3]),
  } as CSSProperties

  return (
    // En la TABLET la pantalla se llena, en vertical y en horizontal: es una
    // pantalla de arranque que se mira de pie y de lejos, y no tiene que
    // "terminar" donde se acaba el contenido sino donde se acaba la pantalla.
    // El tamaño de letra y de las fichas crece con el ancho (`clamp`) y el
    // mosaico de administracion se queda con todo el alto que sobre
    // (`flex-1`). En PC (`pc:`) nada de eso: ancho tope, margenes y letra de
    // escritorio, como cualquier tablero. En un telefono la pagina se
    // desplaza como siempre.
    <div className="min-h-screen flex flex-col">
      <div className="max-w-[100rem] pc:max-w-[84rem] mx-auto w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-7 lg:py-9 bajo:py-4 pc:py-8 flex-1 flex flex-col">
        {/* Cabecera: marca, a quien y que dia, y los controles. El saludo vive
            aqui --pequeño, al lado de la marca-- y no dentro del panel: de
            titular gigante no informaba nada, y en el panel le robaba una
            linea a la cifra. De paso esta franja deja de ser una barra vacia
            con dos cosas en los extremos. */}
        <div className="flex items-center justify-between gap-4 mb-4 sm:mb-5 lg:mb-6 bajo:mb-3">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <Marca className="h-8 sm:h-9 lg:h-10 bajo:h-8 pc:h-8 shrink-0" />
            <span aria-hidden className="hidden lg:block w-px h-8 bg-[var(--vp-textura)] shrink-0" />
            <p className="hidden lg:block min-w-0 truncate text-[15px] lg:text-base text-neutral-500">
              {saludo()}, <span className="text-neutral-800 font-semibold">{nombre}</span>
              <span aria-hidden className="mx-1.5 text-neutral-400">·</span>
              <span className="first-letter:uppercase inline-block">{fecha}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {estado.puede.operar && <MonedaToggle />}
            <Notificaciones />
            {/* El inicio no usa <NavBar>, tiene su propio encabezado: sin
                esto seria la unica pantalla del ERP sin pantalla completa,
                y es justo la primera que se ve al entrar. */}
            <PantallaCompletaToggle />
            <TemaToggle />
            <UsuarioMenu />
          </div>
        </div>

        {/* Lo que queda de pantalla se reparte ARRIBA Y ABAJO del contenido,
            no todo al final. Con `safe center` el navegador vuelve a alinear
            arriba cuando el contenido no cabe --en un telefono apaisado--, de
            modo que centrar nunca recorta la primera fila. */}
        <div className="flex-1 flex flex-col gap-3 lg:gap-4 [justify-content:safe_center] min-h-0">
        {/* En el telefono y en la tablet en vertical el saludo no cabe al lado
            de la marca --se cortaba en "Buenas tardes, re..."--, asi que va
            aqui, en su propio renglon. A partir de 1024 px vive arriba y esta
            linea desaparece. */}
        <p className="lg:hidden text-[15px] text-neutral-500 -mt-1 mb-3">
          {saludo()}, <span className="text-neutral-800 font-semibold">{nombre}</span>
          <span aria-hidden className="mx-1.5 text-neutral-400">·</span>
          <span className="first-letter:uppercase inline-block">{fecha}</span>
        </p>

        {/* ── El dia ──────────────────────────────────────────────────────
            Un panel ancho con la unica cifra que se pregunta al entrar, y a
            su lado las dos cosas que ESPERAN algo. No es un mosaico de
            cuatro cifras iguales: dos son resultados y dos son trabajo
            pendiente, y mirarlas no cuesta lo mismo. */}
        <div className="grid grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr] gap-3 lg:gap-4">
          <section className="col-span-2 lg:col-span-1 vp-losa relative overflow-hidden p-5 sm:p-7 lg:p-8 bajo:p-4 pc:p-7 flex flex-col justify-center">
            {estado.puede.operar ? (
              <>
                <p className="font-display font-bold tabular-nums leading-[0.95] tracking-[-0.03em] text-[clamp(2.6rem,6.5vw,4.6rem)] bajo:text-[clamp(2rem,4.2vw,3rem)] pc:text-[3.4rem]">
                  {hoy ? fmt(hoy.ventas) : '—'}
                </p>
                {/* Una sola linea de apoyo en vez de etiqueta arriba y nota
                    abajo: dice lo mismo, ocupa la mitad y no hace falta
                    gritar en mayusculas para nombrar la cifra. */}
                <p className="mt-2 sm:mt-2.5 bajo:mt-1.5 text-neutral-500 text-[clamp(0.9rem,1.2vw,1.1rem)] pc:text-[0.95rem]">
                  <Ayuda explica={explicar('kpi.vendido_hoy')} titulo="Vendido hoy">
                    Vendido hoy
                  </Ayuda>
                  {hoy && (
                    <>
                      <span aria-hidden className="mx-1.5 text-neutral-400">·</span>
                      <span className="tabular-nums text-neutral-700 font-semibold">{hoy.pedidos}</span>{' '}
                      {hoy.pedidos === 1 ? 'pedido' : 'pedidos'}
                    </>
                  )}
                </p>
              </>
            ) : (
              // Sin permiso de reportes no hay cifra: el panel saluda y ya.
              <p className="font-display font-bold leading-[1.05] tracking-[-0.02em] text-[clamp(1.7rem,3.2vw,2.8rem)] pc:text-[2rem]">
                {saludo()}, {nombre}
              </p>
            )}
          </section>

          {/* Lo que espera. En cero se quedan calladas (neutras); con algo
              dentro se encienden en ambar. Un numero que nunca cambia de
              aspecto no avisa de nada. */}
          {/* Las dos fichas son celdas de la MISMA fila que el panel, no una
              columna aparte: apiladas median mas que el panel y estiraban el
              bloque cien pixeles, que es justo lo que obligaba a desplazar la
              pagina en un portatil. */}
          <Espera
            titulo="En cocina"
            ayuda="kpi.en_cocina"
            valor={enCocina}
            nota="comandas preparándose"
            to="/cocina"
          />
          <Espera
            titulo="Por cobrar"
            ayuda="kpi.por_cobrar"
            valor={porCobrar}
            nota="listas, falta cobrar"
            to={estado.puede.operar ? '/pos' : undefined}
          />
        </div>

        {/* Operacion: lo que se toca cien veces al dia. Las fichas miden una
            fraccion fija de la pantalla (21 % del alto, con tope), asi que en
            una tablet en vertical son grandes sin quedarse vacias y en una
            apaisada dejan sitio al mosaico de abajo. */}
        <div
          className={`grid grid-cols-1 gap-3 lg:gap-4 ${operacion.length > 1 ? 'sm:grid-cols-3' : ''}`}
        >
          {operacion.map((m, i) => (
            <Tarjeta
              key={m.to}
              to={m.to}
              icono={m.icono}
              titulo={m.titulo}
              desc={DESCRIPCION[m.to] ?? ''}
              principal={i === 0 && estado.puede.operar}
            />
          ))}
        </div>

        {/* Administracion: UNA bandeja, no nueve cajas. Se usa una vez a la
            semana; agrupada pesa lo que tiene que pesar y deja el primer
            golpe de vista para lo de arriba. La bandeja se queda con todo el
            alto que sobre y lo reparte entre sus filas. */}
        {administracion.length > 0 && (
          <div className="flex flex-col min-h-0">
            <p className="vp-etiqueta mb-2.5">Administración</p>
            <div className="vp-lista" style={columnas}>
              {administracion.map((m) => (
                <Link
                  key={m.to}
                  to={m.to}
                  className="group flex items-center gap-3 px-4 py-3 lg:px-5 lg:py-3.5 bajo:px-4 bajo:py-2.5 min-h-[3.25rem] alto:min-h-0 transition-colors duration-200"
                >
                  <span className="shrink-0 text-neutral-400 group-hover:text-acento-600 transition-colors duration-200">
                    <Icono nombre={m.icono} size={19} className="lg:w-5 lg:h-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-display font-semibold leading-tight text-[15px] lg:text-base">
                      {m.titulo}
                    </span>
                    <span className="hidden alto:block pc:hidden text-sm text-neutral-500 mt-0.5 leading-snug">
                      {DESCRIPCION[m.to] ?? ''}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  )
}

/**
 * Ficha de operacion. La primera --el punto de venta-- va en tinta llena con
 * la luz de la marca detras: es la que se toca cien veces al dia y tiene que
 * encontrarse sin mirar. La flecha de "Abrir" vive dentro de su propio
 * circulo, no suelta al lado del texto.
 */
function Tarjeta({
  to,
  icono,
  titulo,
  desc,
  principal,
}: {
  to: string
  icono: NombreIcono
  titulo: string
  desc: string
  principal: boolean
}) {
  return (
    <Link
      to={to}
      className={`vp-pulsable group relative overflow-hidden rounded-3xl p-5 lg:p-6 bajo:p-4 pc:p-6 min-h-[8rem] sm:min-h-[clamp(8.5rem,19vh,17rem)] bajo:min-h-[clamp(6.5rem,16vh,20rem)] pc:min-h-[9.5rem] h-full flex flex-col gap-3 lg:gap-4 bajo:gap-3 pc:gap-3 ${
        principal
          ? 'bg-neutral-900 text-white shadow-[0_2px_6px_-2px_rgb(23_24_27/0.16),0_18px_40px_-18px_rgb(23_24_27/0.45)]'
          : 'vp-losa hover:shadow-[inset_0_0_0_1px_var(--vp-textura),0_2px_6px_-2px_rgb(23_24_27/0.06),0_18px_44px_-18px_rgb(23_24_27/0.20)]'
      }`}
    >
      {principal && (
        <span
          aria-hidden
          className="absolute -right-12 -top-12 w-44 h-44 lg:w-60 lg:h-60 rounded-full opacity-45 blur-2xl"
          style={{ background: 'var(--vp-acento)' }}
        />
      )}
      <span
        className={`relative w-11 h-11 lg:w-13 lg:h-13 bajo:w-11 bajo:h-11 pc:w-12 pc:h-12 rounded-[0.9rem] grid place-items-center ${
          principal
            ? 'bg-white/10 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18)]'
            : 'bg-acento-50 text-acento-600'
        }`}
      >
        <Icono nombre={icono} size={22} className="lg:w-7 lg:h-7 bajo:w-6 bajo:h-6 pc:w-6 pc:h-6" />
      </span>
      <span className="relative">
        <span className="block font-display font-semibold leading-tight tracking-[-0.015em] text-lg lg:text-[clamp(1.25rem,1.6vw,1.55rem)] pc:text-xl">
          {titulo}
        </span>
        <span className={`block mt-1 text-sm lg:text-[0.95rem] pc:text-sm ${principal ? 'text-white/65' : 'text-neutral-500'}`}>
          {desc}
        </span>
      </span>
      <span className="relative mt-auto flex items-center gap-2">
        <span
          className={`w-7 h-7 rounded-full grid place-items-center transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 ${
            principal ? 'bg-white/12 text-white' : 'bg-neutral-100 text-neutral-500 group-hover:text-acento-600'
          }`}
        >
          <Icono nombre="chevron" size={14} />
        </span>
        <span className={`text-xs font-semibold ${principal ? 'text-white/65' : 'text-neutral-400'}`}>Abrir</span>
      </span>
    </Link>
  )
}

/**
 * Lo que espera a alguien: comandas en cocina, cuentas por cobrar.
 *
 * En cero es una ficha callada; con algo dentro se enciende. Es la diferencia
 * entre un tablero que informa y uno que avisa.
 */
function Espera({
  titulo,
  valor,
  ayuda,
  nota,
  to,
}: {
  titulo: string
  valor: number
  /** Clave del glosario: la explicacion al posar el cursor en el titulo. */
  ayuda?: string
  nota: string
  to?: string
}) {
  const hay = valor > 0
  const cuerpo = (
    <div
      className={`vp-pulsable rounded-3xl p-4 sm:p-5 bajo:p-4 pc:p-5 h-full flex flex-col justify-center ${
        hay
          ? 'bg-aviso-50 text-aviso-900 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-aviso-400)_45%,transparent),0_10px_28px_-14px_color-mix(in_oklab,var(--color-aviso-500)_55%,transparent)]'
          : 'vp-losa'
      } ${to ? 'hover:shadow-[inset_0_0_0_1px_var(--vp-textura),0_2px_6px_-2px_rgb(23_24_27/0.06),0_14px_34px_-16px_rgb(23_24_27/0.20)]' : ''}`}
    >
      <div className={`text-[13px] font-semibold ${hay ? 'text-aviso-700' : 'text-neutral-500'}`}>
        <Ayuda explica={explicar(ayuda)} titulo={titulo}>
          {titulo}
        </Ayuda>
      </div>
      <div className="mt-1.5">
        <span className="font-display font-bold tabular-nums leading-none tracking-[-0.02em] text-[clamp(1.9rem,3.4vw,2.9rem)] bajo:text-[1.9rem] pc:text-[2.1rem]">
          {valor}
        </span>
      </div>
      <p className={`mt-1.5 text-[13px] leading-snug ${hay ? 'text-aviso-600' : 'text-neutral-400'}`}>{nota}</p>
    </div>
  )
  return to ? (
    <Link to={to} className="block h-full">
      {cuerpo}
    </Link>
  ) : (
    (cuerpo as ReactNode)
  )
}
