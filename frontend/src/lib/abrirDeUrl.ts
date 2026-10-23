import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * `?abrir=<id>` en la URL: la fila de ese documento se despliega y la
 * pantalla baja hasta ella. Es como llegan los resultados de "buscar
 * documentos hablando" (asistente): el enlace trae también el día del
 * documento (`d`/`h`), así que la lista ya lo incluye.
 *
 * Se escucha el parámetro (no solo al montar): si el dueño ya está en Compras
 * y abre otra factura desde el asistente, la pantalla no se vuelve a montar.
 * Usado, se quita de la URL para que el mismo enlace sirva otra vez.
 *
 * La fila se marca con `data-doc={id}`.
 */
export function useAbrirDeUrl(abrir: (id: number) => void) {
  const [params, setParams] = useSearchParams()
  const pedido = Number(params.get('abrir'))

  useEffect(() => {
    if (!Number.isInteger(pedido) || pedido <= 0) return
    abrir(pedido)
    const p = new URLSearchParams(params)
    p.delete('abrir')
    setParams(p, { replace: true })
    // La lista llega después del primer pintado, y lo que va arriba de ella
    // (cifras, gráfico) sigue creciendo un rato: se baja hasta la fila y se
    // vuelve a bajar mientras se salga de la vista, hasta que todo se asienta.
    const inicio = Date.now()
    let vista = 0
    const t = window.setInterval(() => {
      const fila = document.querySelector(`[data-doc="${pedido}"]`)
      if (fila) {
        const r = fila.getBoundingClientRect()
        if (r.top < 0 || r.bottom > window.innerHeight) {
          fila.scrollIntoView({ block: 'center' })
          vista = 0
        } else if (++vista >= 5) {
          window.clearInterval(t) // un segundo quieta en su sitio: listo
        }
      }
      if (Date.now() - inicio > 6000) window.clearInterval(t)
    }, 200)
    // Sin limpieza al cambiar `pedido`: quitar `abrir` de la URL (dos líneas
    // arriba) cambia `pedido` y cortaría la espera antes de llegar a la fila.
    // El intervalo se apaga solo a los 6 s como mucho.
    // Solo cuando cambia el documento pedido.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido])
}
