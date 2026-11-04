/**
 * Un identificador unico, con o sin `crypto.randomUUID`.
 *
 * `crypto.randomUUID` solo existe en contexto seguro (HTTPS o localhost).
 * Abrir el punto de venta por http con la IP del servidor --que es lo que
 * pasa en una laptop dentro del local-- lo deja indefinido, y como la
 * comanda lo pedia ANTES del try, el error se tragaba en silencio: se tocaba
 * "Enviar" y no pasaba nada, ni mensaje ni peticion (Leider, 21-sep: "el
 * punto de venta no esta generando las comandas... no entiendo por que").
 */
export function uuid(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  // La version 4 a mano, con `getRandomValues` si lo hay y con Math.random
  // si ni eso: para una clave de idempotencia alcanza.
  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// La clave que hace que un reintento no se cuente dos veces: con mala senal la
// cajera no sabe si el pago entro y le da otra vez.
export function claveDeReintento() {
  let ultima: { firma: string; clave: string } | null = null
  return {
    /** La misma operacion (misma firma) conserva su clave hasta que entre. */
    para(firma: string): string {
      if (!ultima || ultima.firma !== firma) ultima = { firma, clave: uuid() }
      return ultima.clave
    },
    /** Ya entro: el proximo pago igual es otro pago, no un reintento. */
    olvidar() {
      ultima = null
    },
  }
}
