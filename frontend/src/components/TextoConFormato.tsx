import { Fragment, type ReactNode } from 'react'

/**
 * Lo poco de formato que usa la respuesta: **negrita**, `codigo`, y listas
 * con "1." o "-". Sin una libreria de markdown para cuatro reglas.
 */
export function Respuesta({ texto }: { texto: string }) {
  const bloques: ReactNode[] = []
  let lista: { ordenada: boolean; items: string[] } | null = null
  const cerrarLista = () => {
    if (!lista) return
    const items = lista.items.map((it, i) => <li key={i}>{enLinea(it)}</li>)
    bloques.push(
      lista.ordenada ? (
        <ol key={bloques.length} className="list-decimal pl-5 space-y-1">{items}</ol>
      ) : (
        <ul key={bloques.length} className="list-disc pl-5 space-y-1">{items}</ul>
      ),
    )
    lista = null
  }
  for (const linea of texto.split('\n')) {
    const ordenada = linea.match(/^\s*\d+[.)]\s+(.*)$/)
    const vineta = linea.match(/^\s*[-*•]\s+(.*)$/)
    const item = ordenada ?? vineta
    if (item) {
      const esOrdenada = !!ordenada
      if (lista && lista.ordenada !== esOrdenada) cerrarLista()
      lista ??= { ordenada: esOrdenada, items: [] }
      lista.items.push(item[1])
      continue
    }
    cerrarLista()
    if (linea.trim()) bloques.push(<p key={bloques.length}>{enLinea(linea)}</p>)
  }
  cerrarLista()
  return <div className="flex flex-col gap-2">{bloques}</div>
}

function enLinea(texto: string): ReactNode {
  return texto.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((parte, i) => {
    if (parte.startsWith('**') && parte.endsWith('**') && parte.length > 4) return <strong key={i}>{parte.slice(2, -2)}</strong>
    if (parte.startsWith('`') && parte.endsWith('`') && parte.length > 2)
      return <code key={i} className="font-mono text-[12px] bg-white/70 rounded px-1">{parte.slice(1, -1)}</code>
    return <Fragment key={i}>{parte}</Fragment>
  })
}
