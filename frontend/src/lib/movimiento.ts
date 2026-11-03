/** ¿Hay que saltarse las animaciones? (tablet del mostrador o "menos movimiento"). */
export function sinMovimiento(): boolean {
  if (typeof window === 'undefined') return true
  return (
    document.documentElement.classList.contains('vp-ligero') ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}
