import { useEffect, useState } from 'react'

/**
 * La barra que aparece cuando se cae el internet.
 *
 * Sin esto, un corte de wifi se veia como una pantalla que "no hace nada":
 * los botones responden, los numeros siguen ahi, pero nada se guarda. La
 * cajera no tiene forma de distinguir eso de un sistema lento, y sigue
 * despachando creyendo que todo entro.
 *
 * `navigator.onLine` no es confiable por si solo -dice que si con solo estar
 * conectado al router, aunque el router no tenga internet-, asi que ademas se
 * confirma preguntandole al propio servidor. Mientras no conteste, se muestra
 * el aviso: equivocarse hacia "avisa de mas" hace que alguien revise el wifi;
 * equivocarse hacia "no avisa" hace que se pierdan ventas.
 */
export default function Conexion() {
  const [caida, setCaida] = useState(false)

  useEffect(() => {
    let vivo = true
    let timer: number | undefined

    async function revisar() {
      if (!navigator.onLine) {
        if (vivo) setCaida(true)
        return
      }
      try {
        // Barata y siempre disponible: solo interesa que el servidor conteste.
        const r = await fetch('/api/acceso/check', { method: 'GET', cache: 'no-store' })
        if (vivo) setCaida(!r.ok && r.status !== 401)
      } catch {
        if (vivo) setCaida(true)
      }
    }

    revisar()
    timer = window.setInterval(revisar, 20000)
    window.addEventListener('online', revisar)
    window.addEventListener('offline', revisar)
    return () => {
      vivo = false
      if (timer) window.clearInterval(timer)
      window.removeEventListener('online', revisar)
      window.removeEventListener('offline', revisar)
    }
  }, [])

  if (!caida) return null
  return (
    <div
      role="status"
      className="sticky top-0 z-50 bg-peligro-600 px-3 py-2 text-center text-sm font-medium text-white"
    >
      Sin conexión. Lo que hagas ahora no se está guardando.
    </div>
  )
}
