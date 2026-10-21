import { useEffect, useState } from 'react'
import { useRecordado } from '../lib/memoria'
import { Link } from 'react-router-dom'
import { api, connectWs } from '../lib/api'
import type { Aviso } from '../lib/types'
import Icono from './Icono'

/**
 * "¿Sabías que…?": lo que el sistema le dice al dueño sin que lo pregunte.
 *
 * Los reportes hay que ir a leerlos. Esto es al reves: "la harina se te
 * acaba el jueves", "te deben $40", "el sabado es tu dia fuerte", en la
 * portada, y cada uno lleva a la pantalla donde se resuelve. Nunca mas de
 * cuatro (lo decide el servidor): cinco ya son una lista.
 */
const TONO: Record<Aviso['tono'], { caja: string; punto: string }> = {
  ojo: {
    caja: 'bg-aviso-50 text-aviso-900 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-aviso-400)_45%,transparent)]',
    punto: 'bg-aviso-500',
  },
  bien: {
    caja: 'bg-exito-50 text-exito-900 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-exito-400)_45%,transparent)]',
    punto: 'bg-exito-500',
  },
  info: { caja: 'vp-losa', punto: 'bg-acento-500' },
}

export default function Avisos({ quien = '' }: { quien?: string }) {
  // Lo ultimo que se mostro, para no aparecer de golpe al volver a la portada.
  const [lista, setLista] = useRecordado<Aviso[]>(`${quien}:avisos`, [])

  useEffect(() => {
    const cargar = () => api.avisos().then(setLista).catch(() => undefined)
    cargar()
    // Una venta o una compra pueden cambiar lo que hay que avisar.
    return connectWs(() => cargar())
  }, [setLista])

  if (lista.length === 0) return null
  const cols = lista.length >= 4 ? 'lg:grid-cols-4' : lista.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'

  return (
    <section>
      <p className="vp-etiqueta mb-2.5 apaisado:hidden">¿Sabías que…?</p>
      <div className={`grid gap-3 sm:grid-cols-2 ${cols}`}>
        {lista.map((a, i) => {
          const t = TONO[a.tono] ?? TONO.info
          if (a.por_que) return <Explicada key={a.id} a={a} caja={t.caja} punto={t.punto} oculto={i >= 2} />
          return (
            <Link
              key={a.id}
              to={a.a || '/'}
              className={`vp-pulsable group rounded-3xl p-4 sm:p-4.5 apaisado:px-3.5 apaisado:py-2.5 flex gap-3 apaisado:gap-2 items-start apaisado:items-center ${i >= 2 ? 'apaisado:hidden' : ''} ${t.caja}`}
            >
              <span className={`mt-1.5 shrink-0 w-2 h-2 rounded-full ${t.punto}`} />
              <span className="min-w-0 flex-1">
                <span className="block font-display font-semibold leading-snug text-[15px] apaisado:text-[14px]">{a.titulo}</span>
                {a.detalle && <span className="block mt-1 text-[13px] leading-snug opacity-75 apaisado:hidden">{a.detalle}</span>}
              </span>
              <span className="shrink-0 mt-0.5 w-7 h-7 rounded-full grid place-items-center bg-black/5 opacity-60 group-hover:opacity-100 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] group-hover:translate-x-0.5">
                <Icono nombre="chevron" size={14} />
              </span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

/**
 * Una alerta que se explica (merma rara, precio que sube, referencia
 * repetida): la tarjeta no es un enlace entero porque lleva su propio boton.
 * «¿Por qué?» abre los numeros que la prueban y lo que hay que hacer.
 */
function Explicada({ a, caja, punto, oculto }: { a: Aviso; caja: string; punto: string; oculto: boolean }) {
  const [abierta, setAbierta] = useState(false)
  return (
    <div className={`rounded-3xl p-4 sm:p-4.5 apaisado:px-3.5 apaisado:py-2.5 flex gap-3 apaisado:gap-2 items-start ${oculto ? 'apaisado:hidden' : ''} ${caja}`}>
      <span className={`mt-1.5 shrink-0 w-2 h-2 rounded-full ${punto}`} />
      <div className="min-w-0 flex-1">
        <p className="font-display font-semibold leading-snug text-[15px] apaisado:text-[14px]">{a.titulo}</p>
        {a.detalle && <p className="mt-1 text-[13px] leading-snug opacity-75 apaisado:hidden">{a.detalle}</p>}
        {abierta && (
          <div className="mt-2 flex flex-col gap-1.5 text-[13px] leading-snug">
            <p><span className="font-semibold">Por qué: </span>{a.por_que}</p>
            {a.que_hacer && <p><span className="font-semibold">Qué hacer: </span>{a.que_hacer}</p>}
          </div>
        )}
        <div className="mt-2 flex items-center gap-3 text-[13px] font-semibold apaisado:hidden">
          <button type="button" onClick={() => setAbierta((v) => !v)} aria-expanded={abierta} className="underline underline-offset-2">
            {abierta ? 'Ocultar' : '¿Por qué?'}
          </button>
          <Link to={a.a || '/'} className="inline-flex items-center gap-0.5 opacity-80 hover:opacity-100">
            Ir a revisar <Icono nombre="chevron" size={13} />
          </Link>
        </div>
      </div>
    </div>
  )
}
