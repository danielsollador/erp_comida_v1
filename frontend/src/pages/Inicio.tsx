import { useEffect, useState, type PointerEvent as EventoPuntero, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import Icono, { type NombreIcono } from '../components/Icono'
import Marca from '../components/Marca'
import { Ayuda } from '../components/Ayuda'
import { explicar } from '../lib/glosario'
import { CONTADOR, descripcionDe, modulosDe } from '../components/Rail'
import Arranque from '../components/Arranque'
import Avisos from '../components/Avisos'
import Recorrido, { FilaReportes } from '../components/Recorrido'
import AjustarAPantalla from '../components/AjustarAPantalla'
import UsuarioMenu from '../components/UsuarioMenu'
import Notificaciones from '../components/Notificaciones'
import { useAcceso } from '../lib/acceso'
import { recordado, useRecordado } from '../lib/memoria'
import { api, connectWs } from '../lib/api'
import { rangoDe } from '../lib/fechas'
import { MonedaToggle, useMoneda } from '../lib/moneda'
import { PantallaCompletaToggle } from '../lib/pantallaCompleta'
import { TemaToggle } from '../lib/tema'
import { segun } from '../lib/palabras'
import type { Recorrido as DatosRecorrido, ReporteResumen } from '../lib/types'

function saludo(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Buenos días'
  if (h < 19) return 'Buenas tardes'
  return 'Buenas noches'
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
  // Todo arranca con LO ULTIMO QUE SE MOSTRO (ver lib/memoria.ts): al volver
  // del punto de venta la portada vuelve tal cual y se refresca por detras,
  // en vez de armarse de cero y saltar con cada respuesta. La clave lleva el
  // usuario: otra persona en la misma pestaña no ve lo del anterior.
  const quien = estado.usuario || ''
  const [hoy, setHoy] = useRecordado<ReporteResumen | null>(`${quien}:inicio:hoy`, null)
  const [pedidosHoy, setPedidosHoy] = useRecordado<number | null>(`${quien}:inicio:pedidos`, null)
  const [enCocina, setEnCocina] = useRecordado(`${quien}:inicio:cocina`, 0)
  const [porCobrar, setPorCobrar] = useRecordado(`${quien}:inicio:por-cobrar`, 0)
  // null = cargando; undefined = este rol no ve las cifras (o no respondio):
  // el recorrido se pinta igual, con la pregunta de cada modulo.
  const [recorrido, setRecorrido] = useRecordado<DatosRecorrido | null | undefined>(
    `${quien}:inicio:recorrido`,
    estado.puede.ve_kpis ? null : undefined,
  )
  const { fmt } = useMoneda()

  // LA PORTADA APARECE ENTERA, DE UNA VEZ (Leider, 1-oct: "primero se queda
  // chiquito, luego se expande y luego carga la linea"). Si ya hay lo ultimo
  // que se mostro (lib/memoria.ts), se pinta en el acto. Si no --la primera
  // vez de la pestaña--, se espera a lo que cambia el alto (avisos, misiones,
  // recorrido) y entra completa con un fundido corto, en vez de armarse a
  // pedazos y reescalarse con cada respuesta. Nunca mas de 1,5 s.
  // Se decide UNA vez, al entrar: despues la memoria ya tiene todo y, leida
  // en cada vuelta, le quitaba el fundido a la portada a mitad de camino.
  const [yaHabia] = useState(() => !estado.puede.ve_kpis || recordado.tiene(`${quien}:inicio:recorrido`))
  const [previos, setPrevios] = useState(yaHabia)
  const [tope, setTope] = useState(false)
  const lista = yaHabia || tope || (previos && recorrido !== null)
  useEffect(() => {
    if (yaHabia) return
    const t = window.setTimeout(() => setTope(true), 1500)
    Promise.allSettled([
      api.avisos().then((v) => recordado.set(`${quien}:avisos`, v)),
      estado.puede.administrar ? api.arranque().then((v) => recordado.set(`${quien}:arranque`, v)) : Promise.resolve(),
    ]).then(() => setPrevios(true))
    return () => window.clearTimeout(t)
    // Solo al entrar: lo demas lo refresca `cargar`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cuatro puertas (ver Rail.tsx): hoy (el panel de arriba), vender, mi
  // negocio y numeros; y aparte, atenuado, lo del contador. Cada modulo
  // conserva su nombre y debajo lleva la pregunta que responde.
  const operacion = modulosDe(estado.puede, 'vender')
  // Configuracion no es "mi negocio": vive en el avatar de la barra y en el
  // menu de usuario, como siempre.
  const negocio = modulosDe(estado.puede, 'negocio')
  const numeros = modulosDe(estado.puede, 'numeros')
  const contador = modulosDe(estado.puede, 'contador')

  useEffect(() => {
    cargar()
    const disconnect = connectWs(() => cargar())
    return disconnect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function cargar() {
    // Los reportes son de caja para arriba; a cocina le responden 403 y no se
    // pintan. Los pedidos si los ve todo el mundo.
    // Y solo a quien el rol le deja ver las cifras: al resto se le pinta un
    // guion, no un "no tienes permiso" (Leider, 25-sep).
    if (estado.puede.ve_kpis) api.reporte(rangoDe('hoy')).then(setHoy).catch(() => undefined)
    if (estado.puede.ve_kpis)
      api
        .recorrido()
        .then(setRecorrido)
        .catch(() => setRecorrido((r) => r ?? undefined))
    // "Pedidos" lo ve todo el mundo: sale del listado de ventas del dia, que
    // caja y cocina si pueden leer (los reportes, no).
    api
      .ventasDelDia()
      .then((ps) => setPedidosHoy(ps.length))
      .catch(() => undefined)
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

  // Las rutas a las que este usuario entra: el recorrido solo pinta esas.
  const rutas = [...negocio, ...numeros].map((m) => m.to)

  return (
    // En la TABLET la pantalla se llena, en vertical y en horizontal: es una
    // pantalla de arranque que se mira de pie y de lejos, y no tiene que
    // "terminar" donde se acaba el contenido sino donde se acaba la pantalla.
    // El tamaño de letra y de las fichas crece con el ancho (`clamp`) y el
    // mosaico de administracion se queda con todo el alto que sobre
    // (`flex-1`). En PC (`pc:`) nada de eso: ancho tope, margenes y letra de
    // escritorio, como cualquier tablero. En un telefono la pagina se
    // desplaza como siempre.
    // Si no cabe, se reduce parejo hasta caber (ver AjustarAPantalla): la
    // portada no se desplaza en laptop ni en tablet (Leider, 30-sep).
    !lista ? (
      // Un instante en blanco (el fondo de siempre) y no una pantalla a medio
      // armar que salta.
      <div className="min-h-screen" aria-busy="true" />
    ) : (
    <AjustarAPantalla>
    <div className={`min-h-screen flex flex-col ${yaHabia ? '' : 'vp-aparece'}`}>
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

        {/* Las misiones de arranque: solo mientras el local se arma. */}
        {estado.puede.administrar && <Arranque quien={quien} />}

        {/* ── Hoy ─────────────────────────────────────────────────────────
            Un panel ancho con la unica cifra que se pregunta al entrar, y a
            su lado las dos cosas que ESPERAN algo. No es un mosaico de
            cuatro cifras iguales: dos son resultados y dos son trabajo
            pendiente, y mirarlas no cuesta lo mismo. */}
        <p className="vp-etiqueta -mb-1 lg:-mb-2">{segun({ sencillo: 'Hoy', tecnico: 'Resumen del día' })}</p>
        <div className="grid grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr] gap-3 lg:gap-4">
          <section className="col-span-2 lg:col-span-1 vp-losa relative overflow-hidden p-5 sm:p-7 lg:p-8 bajo:p-4 pc:p-7 flex flex-col justify-center">
            {/* Sin el permiso del rol, un guion y nada mas: ni "no tienes
                permiso" ni un panel distinto (Leider, 25-sep). "Pedidos" si lo
                ve todo el mundo: sale del listado de ventas del dia. */}
            <p className="font-display font-bold tabular-nums leading-[0.95] tracking-[-0.03em] text-[clamp(2.6rem,6.5vw,4.6rem)] bajo:text-[clamp(2rem,4.2vw,3rem)] pc:text-[3.4rem]">
              {estado.puede.ve_kpis && hoy ? fmt(hoy.ventas) : '—'}
            </p>
                {/* Una sola linea de apoyo en vez de etiqueta arriba y nota
                    abajo: dice lo mismo, ocupa la mitad y no hace falta
                    gritar en mayusculas para nombrar la cifra. */}
            <p className="mt-2 sm:mt-2.5 bajo:mt-1.5 text-neutral-500 text-[clamp(0.9rem,1.2vw,1.1rem)] pc:text-[0.95rem]">
              <Ayuda explica={explicar('kpi.vendido_hoy')} titulo="Vendido hoy">
                Vendido hoy
              </Ayuda>
              {pedidosHoy !== null && (
                <>
                  <span aria-hidden className="mx-1.5 text-neutral-400">·</span>
                  <span className="tabular-nums text-neutral-700 font-semibold">{pedidosHoy}</span>{' '}
                  {pedidosHoy === 1 ? 'pedido' : 'pedidos'}
                </>
              )}
            </p>
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

        {/* Lo que el sistema avisa solo. Solo a quien ve las cifras. */}
        {estado.puede.ve_kpis && <Avisos quien={quien} />}

        {/* ── Vender: lo que se toca cien veces al dia. Las fichas miden una
            fraccion fija de la pantalla (21 % del alto, con tope), asi que en
            una tablet en vertical son grandes sin quedarse vacias y en una
            apaisada dejan sitio a las bandejas de abajo. */}
        {operacion.length > 0 && (
          <div>
            <p className="vp-etiqueta mb-2.5">{segun({ sencillo: 'Vender', tecnico: 'Operación' })}</p>
            <div className={`grid grid-cols-1 gap-3 lg:gap-4 ${operacion.length > 2 ? 'sm:grid-cols-3' : operacion.length === 2 ? 'sm:grid-cols-2' : ''}`}>
              {operacion.map((m, i) => (
                <Tarjeta
                  key={m.to}
                  to={m.to}
                  icono={m.icono}
                  titulo={m.titulo}
                  desc={descripcionDe(m.to)}
                  principal={i === 0 && estado.puede.operar}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── El recorrido del negocio y Reportes. Antes eran dos bandejas
            (Mi negocio | Numeros) con los mismos seis modulos; ahora los cinco
            del flujo van en el orden en que se mueve la mercancia y la plata
            --Compras, Inventario, Menu, Ventas, Cierre de caja-- y Reportes,
            que mira todo eso en el tiempo, en su propia fila (Leider, 1-oct). */}
        <Recorrido datos={recorrido} modulos={rutas} operar={estado.puede.operar} />
        {rutas.includes('/reportes') && <FilaReportes dias={recorrido?.ultimos_7_dias} />}

        {/* ── Zona contable (antes "Para el contador"; Leider, 1-oct): sin lamina ni fichas. Una linea de enlaces
            con su icono, en gris: se ve que esta y se ve que es otra cosa
            (Leider, 30-sep: secundario, no escondido, y no con el mismo
            estilo). El titulo lleva a la pagina que explica que se arma solo. */}
        {contador.length > 0 && (
          <div className="pt-3 border-t border-[var(--vp-textura)]">
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <Link to={CONTADOR.to} className="vp-etiqueta hover:text-neutral-700">
                {segun({ sencillo: 'Zona contable', tecnico: 'Contabilidad y fiscal' })}
              </Link>
              <span className="text-xs text-neutral-400">
                {segun({ sencillo: 'Se arma solo con lo de arriba', tecnico: 'Asientos automáticos desde las operaciones' })}
              </span>
            </div>
            {/* TRES BOTONES LIVIANOS, no tres enlaces grises. Sueltos en gris
                parecian la letra pequeña de la politica de privacidad, no algo
                que se toca (Leider, 1-oct). Siguen siendo secundarios --sin
                sombra ni color, el gris del sistema-- pero con su cuadrito, su
                borde y la flecha que se mueve, se ve que se pueden tocar. */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 mt-1.5">
              {contador.map((m) => (
                <Link
                  key={m.to}
                  to={m.to}
                  className="vp-pulsable group flex items-center gap-3 rounded-2xl px-3 py-2.5 bajo:py-2 min-h-[3.25rem] bg-neutral-500/[0.05] shadow-[inset_0_0_0_1px_var(--vp-textura)] hover:bg-neutral-500/10"
                >
                  <span className="vp-contador-icono shrink-0 w-9 h-9 rounded-[0.7rem] grid place-items-center bg-neutral-100 text-neutral-600 shadow-[inset_0_0_0_1px_var(--color-neutral-200)] group-hover:text-neutral-900">
                    <Icono nombre={m.icono} size={17} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-display font-semibold leading-tight text-[14px] text-neutral-800">{m.titulo}</span>
                    <span className="block text-[12.5px] leading-snug text-neutral-500 truncate">{descripcionDe(m.to)}</span>
                  </span>
                  <span className="shrink-0 w-6 h-6 rounded-full grid place-items-center text-neutral-400 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:text-neutral-700">
                    <Icono nombre="chevron" size={14} />
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
    </AjustarAPantalla>
    )
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
  // LA LUZ SIGUE AL CURSOR (Leider, 1-oct: "jugar con el circulo naranja").
  // Se mueve hacia donde esta el raton, con un tope para no salirse de su
  // esquina, y al salir vuelve sola. Va por variables CSS escritas en el
  // propio elemento: mover el raton no repinta React. Solo con raton: en la
  // tablet no hay cursor y la luz se queda donde siempre.
  const seguir = (e: EventoPuntero<HTMLAnchorElement>) => {
    if (e.pointerType !== 'mouse') return
    const caja = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - caja.left) / caja.width - 0.5
    const y = (e.clientY - caja.top) / caja.height - 0.5
    e.currentTarget.style.setProperty('--luz-x', `${Math.round(x * caja.width * 0.45)}px`)
    e.currentTarget.style.setProperty('--luz-y', `${Math.round(y * caja.height * 0.55)}px`)
  }
  const soltar = (e: EventoPuntero<HTMLAnchorElement>) => {
    e.currentTarget.style.removeProperty('--luz-x')
    e.currentTarget.style.removeProperty('--luz-y')
  }
  return (
    <Link
      to={to}
      // La de Cocina tambien: su luz nace con el cursor (Leider, 1-oct).
      onPointerMove={principal || icono === 'cocina' ? seguir : undefined}
      onPointerLeave={principal || icono === 'cocina' ? soltar : undefined}
      className={`vp-pulsable group relative overflow-hidden rounded-3xl p-5 lg:p-6 bajo:p-4 pc:p-6 min-h-[8rem] sm:min-h-[clamp(8.5rem,19vh,17rem)] bajo:min-h-[clamp(6.5rem,16vh,20rem)] pc:min-h-[9.5rem] h-full flex flex-col gap-3 lg:gap-4 bajo:gap-3 pc:gap-3 ${
        principal
          ? 'bg-neutral-900 text-white shadow-[0_2px_6px_-2px_rgb(23_24_27/0.16),0_18px_40px_-18px_rgb(23_24_27/0.45)]'
          : 'vp-losa hover:shadow-[inset_0_0_0_1px_var(--vp-textura),0_2px_6px_-2px_rgb(23_24_27/0.06),0_18px_44px_-18px_rgb(23_24_27/0.20)]'
      }`}
    >
      {principal && (
        <span
          aria-hidden
          className="vp-luz absolute -right-12 -top-12 w-44 h-44 lg:w-60 lg:h-60 rounded-full opacity-45 blur-2xl"
          style={{ background: 'var(--vp-acento)' }}
        />
      )}
      {/* Cocina: una luz calida que en reposo no esta y aparece detras del
          fuego con el cursor encima, siguiendolo. Mas discreta que la del
          punto de venta, que es la ficha principal. */}
      {!principal && icono === 'cocina' && (
        <span aria-hidden className="vp-luz vp-luz-cocina absolute -left-10 -top-10 w-40 h-40 lg:w-52 lg:h-52 rounded-full blur-2xl" />
      )}
      <span
        className={`vp-tarjeta-icono ${principal ? 'vp-tarjeta-icono-principal' : ''} relative w-11 h-11 lg:w-13 lg:h-13 bajo:w-11 bajo:h-11 pc:w-12 pc:h-12 rounded-[0.9rem] grid place-items-center ${
          principal
            ? 'bg-white/10 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18)]'
            : 'bg-acento-50 text-acento-600'
        }`}
      >
        <Icono
          nombre={icono}
          size={22}
          className={`lg:w-7 lg:h-7 bajo:w-6 bajo:h-6 pc:w-6 pc:h-6 ${icono === 'cocina' ? 'vp-llama' : ''}`}
        />
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
