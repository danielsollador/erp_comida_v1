import { Fragment, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * Piezas comunes de la IA (asistente, guías, cambiar precios, reportes con
 * palabras): el mismo ícono, el mismo "pensando" y el mismo texto con formato,
 * para que todo lo que hace la IA se reconozca de un vistazo en cualquier
 * pantalla. Las animaciones viven en index.css (`vp-ia-*`) y se apagan con el
 * modo ligero y con "menos movimiento".
 */

export function Chispa({ tam = 18, className = '' }: { tam?: number; className?: string }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
    </svg>
  )
}

/** El sello redondo de la IA: la chispa sobre el lavado del acento. */
export function SelloIA({ tam = 32 }: { tam?: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-[var(--vp-acento-suave)] text-[var(--vp-acento)]"
      style={{ width: tam, height: tam }}
      aria-hidden="true"
    >
      <Chispa tam={Math.round(tam * 0.55)} />
    </span>
  )
}

/**
 * "Pensando": tres puntos y una frase que cambia mientras se espera, para que
 * los 4-8 s de una consulta se lean como trabajo y no como cuelgue.
 */
export function Pensando({ frases, className = '' }: { frases: string[]; className?: string }) {
  const [i, setI] = useState(0)
  useEffect(() => {
    if (frases.length < 2) return
    const t = window.setInterval(() => setI((x) => (x + 1) % frases.length), 1800)
    return () => window.clearInterval(t)
  }, [frases])
  return (
    <span role="status" aria-live="polite" className={`inline-flex items-center gap-2.5 ${className}`}>
      <span className="vp-ia-puntos inline-flex items-center gap-1 text-[var(--vp-acento)]">
        <i />
        <i />
        <i />
      </span>
      <span key={i} className="vp-ia-aparecer text-[14px] text-neutral-500">
        {frases[i]}
      </span>
    </span>
  )
}

/**
 * Lo que el modelo escribe: párrafos, **negrita** y listas con viñeta o
 * número. Nada más de Markdown (no hace falta y así no se rompe nada).
 */
export function TextoRico({ texto }: { texto: string }) {
  const bloques: ReactNode[] = []
  let lista: { tipo: 'ul' | 'ol'; items: string[] } | null = null
  let parrafo: string[] = []
  const cerrarParrafo = () => {
    if (parrafo.length) bloques.push(<p key={bloques.length}>{enLinea(parrafo.join(' '))}</p>)
    parrafo = []
  }
  const cerrarLista = () => {
    if (!lista) return
    const items = lista.items.map((t, i) => <li key={i}>{enLinea(t)}</li>)
    bloques.push(
      lista.tipo === 'ul' ? (
        <ul key={bloques.length} className="space-y-1 pl-1">
          {lista.items.map((t, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden="true" className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--vp-acento)]" />
              <span>{enLinea(t)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <ol key={bloques.length} className="list-decimal space-y-1 pl-5 marker:text-neutral-500 marker:tabular-nums">
          {items}
        </ol>
      ),
    )
    lista = null
  }
  for (const linea of texto.split('\n')) {
    const l = linea.trim()
    const vineta = l.match(/^[-*•]\s+(.*)$/)
    const numero = l.match(/^\d+[.)]\s+(.*)$/)
    if (vineta || numero) {
      cerrarParrafo()
      const tipo = vineta ? 'ul' : 'ol'
      if (lista && lista.tipo !== tipo) cerrarLista()
      lista ??= { tipo, items: [] }
      lista.items.push((vineta ?? numero)![1])
    } else if (!l) {
      cerrarLista()
      cerrarParrafo()
    } else {
      cerrarLista()
      parrafo.push(l)
    }
  }
  cerrarLista()
  cerrarParrafo()
  return <div className="space-y-2.5">{bloques}</div>
}

function enLinea(t: string): ReactNode {
  return t.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? (
      <b key={i} className="font-semibold text-neutral-900">
        {p.slice(2, -2)}
      </b>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    ),
  )
}
