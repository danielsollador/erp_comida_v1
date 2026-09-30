import { Link } from 'react-router-dom'
import NavBar from '../components/NavBar'
import Icono from '../components/Icono'
import { Pagina } from '../components/ui'
import { modulosDe } from '../components/Rail'
import { useAcceso } from '../lib/acceso'

/**
 * La puerta a lo que se arma solo.
 *
 * Contabilidad, impuestos y la tasa son el corazon de un ERP tradicional y
 * por eso estaban en la barra, al lado del mostrador. Pero el dueño no los
 * opera: cada venta y cada compra ya dejan su asiento, su IVA y su tasa sin
 * que nadie cargue nada. Lo que el dueño necesita de aqui es una sola cosa:
 * saber que esta listo cuando el contador lo pida.
 */
const QUE_HAY: Record<string, { que: string; para: string }> = {
  '/contabilidad': {
    que: 'Libro diario, balance y estado de resultados',
    para: 'Cada venta, compra, gasto y merma ya dejó su asiento. Aquí se leen; no hay que cargar nada.',
  },
  '/impuestos': {
    que: 'Libro de ventas, libro de compras y el IVA del mes',
    para: 'Se arman con lo facturado. Al cierre del mes, la declaración sale de aquí.',
  },
  '/tasa': {
    que: 'La tasa del BCV de cada día',
    para: 'Se actualiza sola varias veces al día. Cada venta guarda la de su día; aquí está el historial.',
  },
}

export default function Contador() {
  const { estado } = useAcceso()
  const pantallas = modulosDe(estado.puede, 'contador')
  return (
    <div className="min-h-screen bg-neutral-50">
      <NavBar titulo="Para el contador" moneda={false} />
      <Pagina ancho="media">
        <div className="max-w-2xl">
          <h2 className="font-display text-2xl font-semibold tracking-tight">Esto se arma solo</h2>
          <p className="mt-2 text-neutral-600 leading-relaxed">
            No hay nada que cargar aquí. Con cada venta y cada compra, el sistema ya escribe la contabilidad, los
            libros del IVA y la tasa del día. Entra cuando tu contador te lo pida, o para exportarle lo que necesite.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {pantallas.map((m) => {
            const info = QUE_HAY[m.to]
            return (
              <Link
                key={m.to}
                to={m.to}
                className="vp-losa vp-pulsable group p-5 flex flex-col gap-3 hover:shadow-[inset_0_0_0_1px_var(--vp-textura),0_2px_6px_-2px_rgb(23_24_27/0.06),0_18px_44px_-18px_rgb(23_24_27/0.20)]"
              >
                <span className="w-11 h-11 rounded-[0.9rem] grid place-items-center bg-neutral-100 text-neutral-600 group-hover:bg-acento-50 group-hover:text-acento-600 transition-colors">
                  <Icono nombre={m.icono} size={22} />
                </span>
                <span>
                  <span className="block font-display font-semibold text-lg leading-tight">{m.titulo}</span>
                  {info && <span className="block mt-1 text-sm text-neutral-700">{info.que}</span>}
                  {info && <span className="block mt-1.5 text-sm text-neutral-500 leading-snug">{info.para}</span>}
                </span>
                <span className="mt-auto flex items-center gap-2 text-xs font-semibold text-neutral-400">
                  <span className="w-7 h-7 rounded-full grid place-items-center bg-neutral-100 text-neutral-500 group-hover:text-acento-600 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5">
                    <Icono nombre="chevron" size={14} />
                  </span>
                  Abrir
                </span>
              </Link>
            )
          })}
        </div>
      </Pagina>
    </div>
  )
}
