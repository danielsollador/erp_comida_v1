import { useEffect, useState, type CSSProperties } from 'react'
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
      <div className="max-w-[100rem] pc:max-w-[84rem] mx-auto w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-7 lg:py-9 bajo:py-5 pc:py-8 flex-1 flex flex-col">
        {/* Cabecera: la marca del local, quien, que dia. */}
        <div className="flex items-start justify-between gap-4 mb-5 sm:mb-6 lg:mb-8 bajo:mb-4 pc:mb-6">
          <div className="min-w-0">
            <Marca className="h-8 sm:h-10 lg:h-12 bajo:h-10 pc:h-9 mb-3 sm:mb-4 bajo:mb-3 pc:mb-3" />
            <h1 className="font-bold leading-[1.05] text-[clamp(1.9rem,3.6vw,3.4rem)] pc:text-[2.25rem]">
              {/* Por su nombre, no por su usuario: "Buenos dias, Daniel". */}
              {saludo()}, {estado.nombre || estado.nombre_visible || estado.usuario}
            </h1>
            <p className="text-neutral-500 first-letter:uppercase mt-1.5 text-[clamp(0.9rem,1.3vw,1.2rem)] pc:text-base">
              {fecha}
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

        {/* La franja de hoy: cuatro cifras, sin adornos. */}
        <div className="vp-escalonado grid grid-cols-2 sm:grid-cols-4 gap-3 lg:gap-4 mb-5 sm:mb-6 lg:mb-8 bajo:mb-4 pc:mb-6">
          {estado.puede.operar && (
            <>
              <Dato titulo="Vendido hoy" ayuda="kpi.vendido_hoy" valor={hoy ? fmt(hoy.ventas) : '—'} destacado />
              <Dato titulo="Pedidos" ayuda="kpi.pedidos_hoy" valor={hoy ? String(hoy.pedidos) : '—'} />
            </>
          )}
          <Dato titulo="En cocina" ayuda="kpi.en_cocina" valor={String(enCocina)} alerta={enCocina > 0} enlace="/cocina" />
          <Dato
            titulo="Por cobrar"
            ayuda="kpi.por_cobrar"
            valor={String(porCobrar)}
            alerta={porCobrar > 0}
            enlace={estado.puede.operar ? '/pos' : undefined}
          />
        </div>

        {/* Operacion: lo que se toca cien veces al dia. Las tres fichas miden
            una fraccion fija de la pantalla (24 % del alto, con tope), asi
            que en una tablet en vertical son grandes sin quedarse vacias y
            en una apaisada dejan sitio al mosaico de abajo. */}
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

        {/* Administracion: el mosaico se queda con TODO el alto que sobre y
            lo reparte entre sus filas. Las fichas van en columna (icono
            arriba, titulo abajo) porque asi crecen bien; en una pantalla
            corta (`bajo:`) vuelven a fila, que es lo que cabe en 768 px sin
            desplazar la pagina. */}
        {administracion.length > 0 && (
          <div className="flex-1 pc:flex-none flex flex-col min-h-0 mt-5 sm:mt-6 lg:mt-8 bajo:mt-4 pc:mt-6">
            <p className="vp-etiqueta mb-3">Administración</p>
            <div className="vp-mosaico flex-1 pc:flex-none" style={columnas}>
              {administracion.map((m) => (
                <Link
                  key={m.to}
                  to={m.to}
                  className="group bg-white border border-neutral-200 rounded-2xl p-3.5 sm:p-4 lg:p-5 bajo:p-4 pc:p-4 flex items-center gap-3 sm:flex-col sm:items-start sm:justify-between sm:gap-4 alto:flex-row alto:items-center alto:justify-start alto:gap-4 bajo:flex-row bajo:items-center bajo:justify-start bajo:gap-3 pc:flex-row pc:items-center pc:justify-start pc:gap-3 min-h-[4.25rem] sm:min-h-[7.5rem] alto:min-h-0 bajo:min-h-0 pc:min-h-0 hover:border-neutral-300 hover:shadow-md hover:-translate-y-px"
                >
                  <span className="w-10 h-10 sm:w-12 sm:h-12 lg:w-14 lg:h-14 bajo:w-12 bajo:h-12 pc:w-11 pc:h-11 shrink-0 rounded-xl bg-neutral-100 text-neutral-600 grid place-items-center group-hover:bg-acento-50 group-hover:text-acento-600">
                    <Icono nombre={m.icono} size={20} className="sm:w-6 sm:h-6 lg:w-7 lg:h-7 bajo:w-6 bajo:h-6 pc:w-6 pc:h-6" />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-display font-semibold leading-tight text-[15px] sm:text-base lg:text-lg bajo:text-base pc:text-base">
                      {m.titulo}
                    </span>
                    <span className="hidden alto:block pc:hidden text-sm text-neutral-500 mt-1 leading-snug">
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
  )
}

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
      className={`group relative overflow-hidden border rounded-2xl p-5 lg:p-7 bajo:p-5 pc:p-6 min-h-[8.5rem] sm:min-h-[clamp(9rem,21vh,19rem)] bajo:min-h-[clamp(8rem,20vh,22rem)] pc:min-h-[10.5rem] h-full flex flex-col gap-3 lg:gap-4 bajo:gap-3 pc:gap-3 shadow-sm hover:shadow-lg hover:-translate-y-0.5 ${
        principal ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-white border-neutral-200'
      }`}
    >
      {principal && (
        // La luz de la marca en la tarjeta principal: es la que se toca cien
        // veces al dia y tiene que encontrarse sin mirar.
        <span
          aria-hidden
          className="absolute -right-10 -top-10 w-40 h-40 lg:w-56 lg:h-56 rounded-full opacity-40 blur-2xl"
          style={{ background: 'var(--vp-acento)' }}
        />
      )}
      <span
        className={`relative w-11 h-11 lg:w-14 lg:h-14 bajo:w-12 bajo:h-12 pc:w-12 pc:h-12 rounded-xl grid place-items-center ${
          principal ? 'bg-white/10 text-white' : 'bg-acento-50 text-acento-600'
        }`}
      >
        <Icono nombre={icono} size={22} className="lg:w-7 lg:h-7 bajo:w-6 bajo:h-6 pc:w-6 pc:h-6" />
      </span>
      <span className="relative">
        <span className="block font-display font-semibold leading-tight text-lg lg:text-[clamp(1.25rem,1.7vw,1.6rem)] pc:text-xl">
          {titulo}
        </span>
        <span className={`block mt-1 text-sm lg:text-base pc:text-sm ${principal ? 'text-neutral-300' : 'text-neutral-500'}`}>
          {desc}
        </span>
      </span>
      <span
        className={`relative mt-auto inline-flex items-center gap-1 text-xs lg:text-sm pc:text-xs font-semibold ${
          principal ? 'text-neutral-300' : 'text-neutral-400 group-hover:text-acento-600'
        }`}
      >
        Abrir <Icono nombre="chevron" size={14} className="transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  )
}

function Dato({
  titulo,
  valor,
  ayuda,
  destacado = false,
  alerta = false,
  enlace,
}: {
  titulo: string
  valor: string
  /** Clave del glosario: la explicacion al posar el cursor en el titulo. */
  ayuda?: string
  destacado?: boolean
  alerta?: boolean
  enlace?: string
}) {
  const contenido = (
    <div
      className={`rounded-2xl border p-4 lg:p-6 bajo:p-4 pc:p-5 h-full shadow-sm ${
        alerta ? 'bg-aviso-50 border-aviso-300' : 'bg-white border-neutral-200'
      } ${enlace ? 'hover:shadow-md hover:-translate-y-px' : ''}`}
    >
      <div className={`text-xs lg:text-sm pc:text-xs font-medium ${alerta ? 'text-aviso-700' : 'text-neutral-500'}`}>
        <Ayuda explica={explicar(ayuda)} titulo={titulo}>
          {titulo}
        </Ayuda>
      </div>
      <div
        className={`font-semibold tabular-nums mt-1 ${
          destacado ? 'text-[clamp(1.6rem,3vw,2.75rem)] pc:text-[1.75rem]' : 'text-[clamp(1.35rem,2.5vw,2.3rem)] pc:text-2xl'
        } ${alerta ? 'text-aviso-900' : ''}`}
      >
        {valor}
      </div>
    </div>
  )
  return enlace ? (
    <Link to={enlace} className="block h-full">
      {contenido}
    </Link>
  ) : (
    contenido
  )
}
