/**
 * EL RECORRIDO DEL NEGOCIO, en la portada.
 *
 * Leider (1-oct): "los negocios tienen flujos, el mas claro de mi ERP es
 * compras > inventario > menu", y termina en el cierre de caja. Se dibuja como
 * el seguimiento de un pedido --una linea con cinco puntos, que todo el mundo
 * sabe leer-- y cada punto dice en UNA frase literal como esta: "Toca comprar
 * harina y queso", "Hay de todo", "Abierta, se cierra al final del dia". Solo
 * se enciende en ambar lo que pide algo. Sin cifras de plata sueltas (Leider:
 * "los numeros esos no estan fight complexity").
 *
 * La entrada cuenta el flujo: un punto recorre la linea de Compras a la caja y
 * cada estacion se enciende cuando pasa. ~1,3 s, una vez cada vez que se carga
 * la pagina (volver a la portada desde otro modulo no la repite), y nunca en el
 * modo ligero de la tablet ni con "reducir movimiento": ahi se pinta quieta.
 *
 * Debajo, Reportes en su propia fila con las ventas de los ultimos 7 dias en
 * barras sin cifras: se ve de un vistazo si la semana sube o baja.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import Icono from './Icono'
import { MODULOS, descripcionDe } from './Rail'
import { useMoneda } from '../lib/moneda'
import { segun } from '../lib/palabras'
import type { PasoRecorrido, Recorrido as DatosRecorrido } from '../lib/types'

/** Cada estacion y el modulo que la representa, en el orden del flujo. */
const ESTACIONES: { id: PasoRecorrido['id']; to: string }[] = [
  { id: 'compras', to: '/compras' },
  { id: 'inventario', to: '/inventario' },
  { id: 'menu', to: '/menu' },
  { id: 'ventas', to: '/ventas' },
  { id: 'caja', to: '/caja' },
]

// Una vez por carga de pagina. Era una vez por SESION (sessionStorage), y
// recargar no la volvia a mostrar: parecia que el efecto no existia (Leider,
// 1-oct). Con una variable del modulo, recargar la repite y volver a la
// portada desde otro modulo no.
let entradaContada = false

/** Sin movimiento: la tablet en modo ligero o quien pidio reducir movimiento. */
function sinMovimiento(): boolean {
  if (typeof window === 'undefined') return true
  if (document.documentElement.classList.contains('vp-ligero')) return true
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

/** Si esta portada se pinta quieta, ya en su estado final. */
function sinEntrada(): boolean {
  return entradaContada || sinMovimiento()
}

export default function Recorrido({
  datos,
  modulos,
  operar,
}: {
  /** null = cargando; undefined = este rol no ve las frases. */
  datos: DatosRecorrido | null | undefined
  /** Las rutas a las que este usuario puede entrar. */
  modulos: string[]
  /** Si puede abrir la caja en el punto de venta. */
  operar: boolean
}) {
  const { fmt } = useMoneda()
  // La animacion se decide al llegar los datos: animar el esqueleto vacio y
  // despues cambiar las frases seria contar el flujo dos veces.
  const [quieto] = useState(sinEntrada)
  const listo = datos !== null
  useEffect(() => {
    if (listo && !quieto) entradaContada = true
  }, [listo, quieto])

  // La pregunta de cada modulo vive en un globo sobre su icono (Leider,
  // 1-oct: "para que no solape con lo de abajo"). Con cursor sale al
  // posarlo; en la tablet, al mantener presionado. Un toque corto sigue
  // abriendo el modulo.
  const [globo, setGlobo] = useState<string | null>(null)
  const presion = useRef<{ t: number; larga: boolean }>({ t: 0, larga: false })
  useEffect(() => {
    if (!globo) return
    const cerrar = () => setGlobo(null)
    const t = window.setTimeout(cerrar, 2600)
    document.addEventListener('pointerdown', cerrar)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('pointerdown', cerrar)
    }
  }, [globo])

  const visibles = ESTACIONES.filter((e) => modulos.includes(e.to))
  if (visibles.length === 0) return null

  const pasoDe = (id: string) => datos?.pasos.find((p) => p.id === id)
  const pendientes = visibles.filter((e) => pasoDe(e.id)?.pendiente).length
  // A donde lleva: la pantalla que lo resuelve, si el usuario puede entrar.
  const destino = (e: (typeof ESTACIONES)[number], p?: PasoRecorrido) => {
    if (!p?.a) return e.to
    const ruta = p.a.split('?')[0]
    return modulos.includes(ruta) || (ruta === '/pos' && operar) ? p.a : e.to
  }

  return (
    <section
      aria-label="El recorrido de tu negocio"
      className={`vp-losa vp-recorrido px-3 sm:px-4 lg:px-6 pt-4 lg:pt-5 bajo:pt-3.5 pb-4 lg:pb-5 bajo:pb-3.5 ${
        listo ? (quieto ? 'vp-recorrido-quieto' : 'vp-recorrido-entra') : 'vp-recorrido-cargando'
      }`}
    >
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="font-display font-semibold tracking-[-0.015em] leading-tight text-[17px] lg:text-lg">
          {segun({ sencillo: 'Tu negocio hoy', tecnico: 'Flujo del negocio' })}
        </h2>
        {datos && (
          <p className={`text-[13px] font-medium ${pendientes ? 'text-aviso-700' : 'text-neutral-500'}`}>
            {pendientes ? `${pendientes} ${pendientes === 1 ? 'cosa' : 'cosas'} por hacer` : 'Todo al día'}
          </p>
        )}
      </div>

      <ol
        className="vp-recorrido-pista relative mt-4 lg:mt-5 bajo:mt-3 grid grid-cols-1 sm:grid-flow-col sm:auto-cols-fr gap-1 sm:gap-0"
        style={{ '--n': visibles.length } as CSSProperties}
      >
        {/* La via, el tramo que se va llenando y el punto que lo recorre.
            En el telefono la linea es vertical y sin viajero. */}
        <span aria-hidden className="vp-recorrido-via" />
        <span aria-hidden className="vp-recorrido-tramo">
          <span className="vp-recorrido-lleno" />
        </span>
        <span aria-hidden className="vp-recorrido-carro">
          <span className="vp-recorrido-viajero" />
        </span>

        {visibles.map((e, i) => {
          const m = MODULOS.find((x) => x.to === e.to)!
          const p = pasoDe(e.id)
          const ojo = Boolean(p?.pendiente)
          // La pregunta del modulo se queda SIEMPRE: es lo que dice para que
          // sirve (Leider, 1-oct: "eso no lo podemos quitar"). Debajo, como
          // esta hoy.
          const pregunta = descripcionDe(e.to)
          const frase = p ? p.frase.replace('{monto}', fmt(p.monto ?? 0)) : ''
          return (
            // `--d`: cuando pasa el viajero por esta estacion.
            <li
              key={e.id}
              className="relative"
              style={{ '--i': i, '--d': `${visibles.length > 1 ? Math.round((i * 1150) / (visibles.length - 1)) : 0}ms` } as CSSProperties}
            >
              <Link
                to={destino(e, p)}
                className={`vp-recorrido-estacion group ${ojo ? 'vp-recorrido-ojo' : ''}`}
                data-globo={globo === e.id ? '' : undefined}
                aria-label={`${m.titulo}. ${pregunta}${frase ? ` ${frase}` : ''}`}
                onPointerDown={(ev) => {
                  if (ev.pointerType === 'mouse') return
                  presion.current.larga = false
                  window.clearTimeout(presion.current.t)
                  presion.current.t = window.setTimeout(() => {
                    presion.current.larga = true
                    setGlobo(e.id)
                  }, 450)
                }}
                onPointerUp={() => window.clearTimeout(presion.current.t)}
                onPointerLeave={() => window.clearTimeout(presion.current.t)}
                onPointerCancel={() => window.clearTimeout(presion.current.t)}
                onContextMenu={(ev) => ev.preventDefault()}
                onClick={(ev) => {
                  // Se mantuvo presionado para leer la pregunta: no se navega.
                  if (presion.current.larga) {
                    ev.preventDefault()
                    presion.current.larga = false
                  }
                }}
              >
                <span className="vp-recorrido-entrada">
                  <span
                    className="vp-recorrido-globo"
                    data-lado={i === 0 ? 'inicio' : i === visibles.length - 1 ? 'fin' : undefined}
                    aria-hidden
                  >
                    {pregunta}
                  </span>
                  <span className="vp-recorrido-nodo">
                    <IconoEstacion id={e.id} />
                    {p && !ojo && (
                      <span className="vp-recorrido-marca" aria-hidden>
                        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m5 12.5 4.5 4.5L19 7.5" />
                        </svg>
                      </span>
                    )}
                  </span>
                </span>
                <span className="vp-recorrido-texto">
                  <span className="block font-display font-semibold leading-tight text-[14px] lg:text-[15px] text-neutral-900">
                    {m.titulo}
                  </span>
                  {/* En el telefono la fila es ancha y la pregunta cabe en linea. */}
                  <span className="sm:hidden block mt-0.5 text-[13px] leading-snug text-neutral-500">{pregunta}</span>
                  {frase && (
                    <span
                      className={`vp-recorrido-frase block mt-1.5 text-[13px] leading-snug ${
                        ojo ? 'text-aviso-700 font-semibold' : 'text-neutral-800 font-medium'
                      }`}
                    >
                      {frase}
                    </span>
                  )}
                  {p?.accion && (
                    <span className="vp-recorrido-accion block mt-1 text-xs font-semibold text-acento-600">
                      {p.accion} ›
                    </span>
                  )}
                </span>
              </Link>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/**
 * LOS ICONOS DEL RECORRIDO, dibujados para este tamaño. Los del sistema son
 * de 20 px y trazo fino para la barra lateral; a 24 px dentro de un circulo
 * se veian pobres (Leider, 1-oct: "no estan en HD"). Estos van a dos capas
 * --un relleno suave del mismo color y el trazo encima-- sobre la cuadricula
 * de 24, con trazo de 1,6 y puntas redondas.
 */
const DIBUJOS: Record<string, { relleno: string; trazo: string }> = {
  // Una bolsa de compras con su asa.
  compras: {
    relleno: 'M5.6 8.2h12.8l-.95 10.9a2 2 0 0 1-2 1.83H8.55a2 2 0 0 1-2-1.83Z',
    trazo: 'M5.6 8.2h12.8l-.95 10.9a2 2 0 0 1-2 1.83H8.55a2 2 0 0 1-2-1.83ZM9 10.6V7.2a3 3 0 0 1 6 0v3.4',
  },
  // La caja del deposito, con la tapa iluminada.
  inventario: {
    relleno: 'M12 3.2 20.3 7.6 12 12 3.7 7.6Z',
    trazo: 'M12 3.2 20.3 7.6v8.8L12 20.8l-8.3-4.4V7.6ZM3.7 7.6 12 12l8.3-4.4M12 12v8.8M7.9 5.4l8.3 4.4',
  },
  // La campana del plato: lo que se sirve.
  menu: {
    relleno: 'M4.6 16.2a7.4 7.4 0 0 1 14.8 0Z',
    trazo: 'M4.6 16.2a7.4 7.4 0 0 1 14.8 0M3 16.2h18M12 8.8V7M10.4 7h3.2M6 19.6h12',
  },
  // El recibo de la venta, con su borde de corte.
  ventas: {
    relleno: 'M6 3.4h12v17.2l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3Z',
    trazo: 'M6 3.4h12v17.2l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3ZM9 8.2h6M9 11.6h6M9 15h3.6',
  },
  // La caja registradora: pantalla, cuerpo y la gaveta.
  caja: {
    relleno: 'M3.6 13.6h16.8v5.9a1.5 1.5 0 0 1-1.5 1.5H5.1a1.5 1.5 0 0 1-1.5-1.5Z',
    trazo: 'M8.4 3.6h7.2v3.9H8.4ZM12 7.5v1.1M5.4 8.6h13.2l1.8 5H3.6ZM3.6 13.6h16.8v5.9a1.5 1.5 0 0 1-1.5 1.5H5.1a1.5 1.5 0 0 1-1.5-1.5ZM10 17.3h4',
  },
  // Las barras de la semana dentro de su marco.
  reportes: {
    relleno: 'M7 3.8h10a3.2 3.2 0 0 1 3.2 3.2v10a3.2 3.2 0 0 1-3.2 3.2H7A3.2 3.2 0 0 1 3.8 17V7A3.2 3.2 0 0 1 7 3.8Z',
    trazo: 'M8 16.4v-3.6M12 16.4V7.6M16 16.4v-6',
  },
}

export function IconoEstacion({ id, size = 24 }: { id: string; size?: number }): ReactNode {
  const d = DIBUJOS[id]
  if (!d) return null
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={id === 'reportes' ? 2 : 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      shapeRendering="geometricPrecision"
      aria-hidden
    >
      <path d={d.relleno} fill="currentColor" fillOpacity={0.16} stroke="none" />
      <path d={d.trazo} />
    </svg>
  )
}

const DIAS = ['D', 'L', 'M', 'M', 'J', 'V', 'S']

/** Reportes en su fila: la pregunta y la semana en barras, sin cifras. */
export function FilaReportes({ dias }: { dias: { fecha: string; ventas: number }[] | undefined }) {
  const { fmt } = useMoneda()
  // Las barras crecen la misma vez que se cuenta el recorrido.
  const [animar] = useState(() => !sinEntrada())
  const tope = Math.max(...(dias ?? []).map((d) => d.ventas), 0)
  return (
    <Link
      to="/reportes"
      className={`vp-losa vp-pulsable vp-fila-reportes ${animar ? 'vp-fila-reportes-entra' : ''} group flex items-center gap-3.5 lg:gap-4 px-4 lg:px-5 py-3.5 bajo:py-2.5 hover:shadow-[inset_0_0_0_1px_var(--vp-textura),0_2px_6px_-2px_rgb(23_24_27/0.06),0_14px_34px_-16px_rgb(23_24_27/0.20)]`}
    >
      <span className="shrink-0 w-11 h-11 rounded-[0.9rem] grid place-items-center bg-acento-50 text-acento-600">
        <IconoEstacion id="reportes" size={24} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display font-semibold leading-tight text-[15px] lg:text-base">Reportes</span>
        <span className="block text-[13px] text-neutral-500 leading-snug">{descripcionDe('/reportes')}</span>
      </span>
      {dias && dias.length > 0 && (
        <span className="shrink-0 hidden min-[420px]:block" aria-label="Ventas de los últimos 7 días">
          <span className="flex items-end gap-[5px] h-9 w-[10.5rem]">
            {dias.map((d, i) => {
              const alto = tope > 0 ? Math.max((d.ventas / tope) * 100, 4) : 4
              const esHoy = i === dias.length - 1
              return (
                <span
                  key={d.fecha}
                  title={`${esHoy ? 'Hoy' : new Date(`${d.fecha}T12:00:00`).toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric' })}: ${fmt(d.ventas)}`}
                  className={`vp-fila-reportes-barra flex-1 rounded-t-[3px] rounded-b-[1px] ${esHoy ? 'bg-acento-500' : 'bg-neutral-300'}`}
                  style={{ height: `${alto}%`, '--i': i } as CSSProperties}
                />
              )
            })}
          </span>
          <span className="flex gap-[5px] w-[10.5rem] mt-1 text-xs text-neutral-400">
            {dias.map((d, i) => (
              <span key={d.fecha} className="flex-1 text-center">
                {i === dias.length - 1 ? 'Hoy' : DIAS[new Date(`${d.fecha}T12:00:00`).getDay()]}
              </span>
            ))}
          </span>
        </span>
      )}
      <span className="shrink-0 w-7 h-7 rounded-full grid place-items-center bg-neutral-100 text-neutral-500 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5 group-hover:text-acento-600">
        <Icono nombre="chevron" size={14} />
      </span>
    </Link>
  )
}
