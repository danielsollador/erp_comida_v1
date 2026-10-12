import * as Haptics from 'expo-haptics'
import { AppState, Platform, type NativeEventSubscription } from 'react-native'
import { etiquetaMetodo } from '../../../frontend/src/lib/pagos'
import { etiquetaVariante, variantesParaVender } from '../../../frontend/src/lib/menu'
import { abrirCanalEnVivo } from './api'
import type { RenglonComanda } from './api-pos'
import { miles } from './formato'
import { fmtBs } from './moneda'
import { aNumero } from './numeros'
import type { Paleta } from './tema'
import type { Categoria, Pedido, Producto, Ticket, Variante } from './tipos'

/*
 * LA LOGICA DEL PUNTO DE VENTA, sin pantalla: la comanda, las huellas para
 * saber si una edicion cambio algo, como se resuelve un pago movil que entro
 * de mas o de menos, el canal en vivo y el ticket en texto. Es la misma de
 * pages/POS.tsx de la web, sacada de la pantalla para que las piezas de
 * componentes/pos la compartan sin pasarse veinte funciones.
 */

// ── Constantes de la web ────────────────────────────────────────────────────

/** Dos pantallas y no una (el cliente, 23-sep): tomar el pedido y lo ya tomado. */
export type IdSeccionPos = 'tomar' | 'pedidos'

/**
 * Las dos gavetas fisicas. Un cobro en efectivo no se resuelve de un toque:
 * hay que saber si el cliente paga exacto o hay vuelto, porque de eso depende
 * cuanta plata queda en la gaveta.
 */
export const METODOS_EFECTIVO = ['Efectivo Bs', 'Efectivo $']

/**
 * Por donde puede SALIR el vuelto: las dos gavetas o un pago movil, que es lo
 * que se hace cuando no hay sencillo (Leider, 30-sep: "solo tres opciones").
 */
export const METODOS_VUELTO = ['Efectivo $', 'Efectivo Bs', 'Pago movil']

/** Los billetes que de verdad andan en la calle, para tocar en vez de teclear. */
export const BILLETES_USD = [1, 5, 10, 20, 50, 100]

// ── Tipos de la comanda ─────────────────────────────────────────────────────

/**
 * Un renglon de la comanda. `cortesia`: el renglon entero se regala (Leider,
 * 22-sep: "le quiero regalar un cafe"); no se cobra, si descuenta
 * inventario. `precio`: el que ya se le dijo al cliente cuando se edita un
 * pedido tomado; el servidor lo conserva aunque el menu haya cambiado.
 */
export type LineaCarrito = {
  producto: Producto
  variante: Variante
  cantidad: number
  cortesia: boolean
  precio?: number
}
export type Carrito = Record<number, LineaCarrito>

/** Un renglon suelto: el envio (del menu, con el monto de este pedido) o la venta libre. */
export type Libre = { id: string; nombre: string; precio: number; variante_id?: number }

/** Una parte ya anotada de un pago mixto. */
export type Parte = { metodo: string; monto: number; referencia: string; verificacion_id?: number; monto_bs?: number }

/**
 * Lo que devuelve el paso de pago movil: la referencia y, si el banco la
 * confirmo, el id de esa consulta. `monto_usd` es lo que ENTRO, a la tasa del
 * cobro SIN redondear (Bs 0,18 son $0,0002), y `decision` que hacer con la
 * diferencia. Nunca se decide sola: la decide la cajera.
 *
 *   exacto    entro exactamente la cuenta: se cobra.
 *   propina   entro de mas: lo que sobra se suma a la propina.
 *   otro_pago entro de menos: lo que falta se cobra con OTRO pago movil.
 *   resto     entro de menos: lo que falta se cobra con otra forma.
 *   perdonar  entro de menos y el local lo deja pasar: descuento.
 */
export type PagoVerificado = {
  referencia: string
  verificacion_id?: number
  monto_usd?: number
  monto_bs?: number
  decision?: 'exacto' | 'propina' | 'otro_pago' | 'resto' | 'perdonar'
}

/** El vuelto por pago movil, ya mandado (o anotado a mano). */
export type VueltoListo = { vuelto_id?: number; referencia: string }

// ── Numeros ─────────────────────────────────────────────────────────────────

export const redondear = (n: number) => Math.round(n * 100) / 100

/**
 * Un monto tecleado, con coma o con punto: el teclado del telefono en español
 * escribe coma, y sin esto "20,50" era cero y el cobro se trancaba diciendo
 * que el billete no alcanza. Vacio o basura = 0, como en la web.
 */
export function monto(v: string): number {
  const n = aNumero(v)
  return Number.isFinite(n) ? n : 0
}

/** Bs como los escribe la cajera: "1650,50", "1.650,50" o "1650.50". */
export function leerBs(texto: string): number {
  const t = String(texto).trim()
  const limpio = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  return Number(limpio)
}

/** Bs con coma decimal, como se escribe en Venezuela: 1650,00. */
export const enBsTexto = (n: number) => n.toFixed(2).replace('.', ',')

/** "$12.50": los montos del cobro que la web escribe en dolares a proposito. */
export const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toFixed(2)}`

/** "$12,50": como `$${fmtNum(x)}` de la web. */
export const usdComa = (n: number) => `${n < 0 ? '−' : ''}$${miles(Math.abs(n))}`

/** El nombre sin tildes ni mayusculas: "Envíos" y "envios" son la misma. */
export function sinTildes(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
}

/**
 * Un identificador unico para la clave de cada intento de comanda (la de
 * frontend/src/lib/uuid.ts). Si la respuesta se pierde con la wifi y la
 * cajera le da otra vez, la misma clave devuelve el pedido que ya entro.
 */
export function uuid(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/**
 * La hora en 24 h ("21:35"): en la lista de ventas, "09:35 p. m." no cabe
 * en la columna. El backend guarda la hora LOCAL sin zona: se lee tal cual.
 */
export function hora24(iso: string | null | undefined): string {
  if (!iso) return ''
  if (/[zZ]$|[+-]\d\d:?\d\d$/.test(iso)) {
    const d = new Date(new Date(iso).getTime() - 4 * 3600_000)
    if (Number.isNaN(d.getTime())) return ''
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
  }
  const m = /T(\d{2}):(\d{2})/.exec(iso)
  return m ? `${m[1]}:${m[2]}` : ''
}

/** "1 venta" / "3 ventas". */
export const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

// ── El color de cada categoria ──────────────────────────────────────────────

/**
 * El tinte de una categoria en el mostrador, el mismo que elige el dueño en
 * Menu > Color (frontend/src/lib/theme.ts): cinco tintes de la paleta, y si
 * la categoria no tiene, el automatico por su `id`. Aqui salen de los
 * colores del tema, asi siguen al modo oscuro.
 */
type NombreColor = 'ambar' | 'cobre' | 'verde' | 'gris' | 'rojo'
const AUTOMATICO: NombreColor[] = ['ambar', 'cobre', 'verde', 'gris', 'rojo']

export type Tinte = { fondo: string; borde: string; texto: string; punto: string }

export function tinteCategoria(t: Paleta, categoriaId: number, color?: string | null): Tinte {
  const nombre = color && (AUTOMATICO as string[]).includes(color) ? (color as NombreColor) : AUTOMATICO[categoriaId % AUTOMATICO.length]
  switch (nombre) {
    case 'ambar':
      return { fondo: t.avisoSuave, borde: t.avisoLinea, texto: t.aviso, punto: t.aviso }
    case 'cobre':
      return { fondo: t.acentoSuave, borde: t.acento400, texto: t.acento, punto: t.acento400 }
    case 'verde':
      return { fondo: t.exitoSuave, borde: t.exito500, texto: t.exito, punto: t.exito500 }
    case 'gris':
      return { fondo: t.gris100, borde: t.barra, texto: t.fuerte, punto: t.tenue }
    case 'rojo':
      return { fondo: t.peligroSuave, borde: t.peligro, texto: t.peligro, punto: t.peligro }
  }
}

// ── Lo que se puede vender ──────────────────────────────────────────────────

export function esEnvios(c: Pick<Categoria, 'nombre'>) {
  return sinTildes(c.nombre) === 'envios'
}

export type Grupo = { categoria: Categoria; filas: { producto: Producto; variante: Variante }[] }

/**
 * Lo que se puede vender hoy, por categoria. Un producto recien creado sin
 * precio todavia no se vende (su precio se decide en Recetas); los envios si,
 * que cobran lo que se escriba.
 */
export function vendiblesDe(categorias: Categoria[]): Grupo[] {
  return categorias.map((c) => ({
    categoria: c,
    filas: c.productos
      .filter((p) => p.activo)
      .flatMap((p) =>
        variantesParaVender(p)
          .filter((v) => v.precio > 0 || esEnvios(c))
          .map((v) => ({ producto: p, variante: v })),
      ),
  }))
}

/** Las filas del menu juntas por producto, en el orden en que aparece cada uno. */
export function agruparPorProducto(filas: { producto: Producto; variante: Variante }[]) {
  const grupos: { producto: Producto; variantes: Variante[] }[] = []
  const porId = new Map<number, (typeof grupos)[number]>()
  for (const f of filas) {
    let g = porId.get(f.producto.id)
    if (!g) {
      g = { producto: f.producto, variantes: [] }
      porId.set(f.producto.id, g)
      grupos.push(g)
    }
    g.variantes.push(f.variante)
  }
  return grupos
}

// ── La comanda contra el pedido ─────────────────────────────────────────────

/** Lo que hace falta saber de cada renglon para decidir si va a cocina. */
export type Cocina = {
  /** Editando: si este renglon YA ESTABA en el pedido, si iba a cocina. */
  actualDe: (varianteId: number) => boolean | undefined
  /** Lo que sugiere su categoria. */
  porDefecto: (varianteId: number) => boolean
}

/** Editando: si este renglon ya estaba en el pedido, si iba a cocina. */
export function cocinaActualDe(enEdicion: Pedido | null, varianteId: number): boolean | undefined {
  const fila = enEdicion?.items.find((i) => i.variante_id === varianteId)
  return fila ? fila.a_cocina !== false : undefined
}

/** Editando: la cocina ya hizo este renglon, asi que su destino no se toca. */
export function cocinaLoTermino(enEdicion: Pedido | null, varianteId: number): boolean {
  const filas = enEdicion?.items.filter((i) => i.variante_id === varianteId) ?? []
  return filas.length > 0 && filas.every((i) => i.a_cocina !== false && i.preparado)
}

/** Los renglones de la comanda tal como los pide el servidor. */
export function renglonesDeLaComanda(
  carrito: Carrito,
  libres: Libre[],
  destinoDe: Record<number, boolean>,
  cocina: Cocina,
): RenglonComanda[] {
  return [
    ...Object.values(carrito).map((c) => ({
      variante_id: c.variante.id as number | null,
      cantidad: c.cantidad,
      cortesia: c.cortesia,
      // Sin decision en el cuadro: lo que ya tenia si estaba, si no lo que
      // sugiere su categoria.
      a_cocina: destinoDe[c.variante.id] ?? cocina.actualDe(c.variante.id) ?? cocina.porDefecto(c.variante.id),
    })),
    ...libres.map((l) =>
      l.variante_id !== undefined
        ? // El envio es del menu, con el monto de este pedido.
          { variante_id: l.variante_id as number | null, cantidad: 1, precio_libre: l.precio, a_cocina: false }
        : { variante_id: null, cantidad: 1, nombre_libre: l.nombre, precio_libre: l.precio, preparado: true },
    ),
  ]
}

/** Lo que tiene la comanda, contado igual que los renglones del pedido. */
export function huellaDeLaComanda(
  carrito: Carrito,
  libres: Libre[],
  destinoDe: Record<number, boolean>,
  cocina: Cocina,
): string {
  const partes: string[] = []
  for (const c of Object.values(carrito)) {
    const va = destinoDe[c.variante.id] ?? cocina.actualDe(c.variante.id) ?? cocina.porDefecto(c.variante.id)
    partes.push(`v${c.variante.id}:${c.cortesia ? 1 : 0}:${c.cantidad}:${va ? 1 : 0}`)
  }
  const sueltos = new Map<string, number>()
  for (const l of libres) {
    const k = l.variante_id !== undefined ? `e${l.variante_id}:${l.precio.toFixed(2)}` : `l${l.nombre}:${l.precio.toFixed(2)}`
    sueltos.set(k, (sueltos.get(k) ?? 0) + 1)
  }
  for (const [k, n] of sueltos) partes.push(`${k}:${n}`)
  return partes.sort().join('|')
}

export function huellaDelPedido(pedido: Pedido, envioId: number | null, categoriaDeVariante: Map<number, number>): string {
  const partes: string[] = []
  const sueltos = new Map<string, number>()
  const sumar = (k: string, n: number) => sueltos.set(k, (sueltos.get(k) ?? 0) + n)
  const menu = new Map<string, { n: number; cocina: boolean }>()
  for (const i of pedido.items) {
    if (i.variante_id === null) sumar(`l${i.nombre}:${i.precio_unitario.toFixed(2)}`, i.cantidad)
    else if (envioId !== null && categoriaDeVariante.get(i.variante_id) === envioId)
      sumar(`e${i.variante_id}:${i.precio_unitario.toFixed(2)}`, i.cantidad)
    else {
      // Lo hecho y lo agregado despues son dos renglones del mismo producto:
      // se cuentan juntos, igual que en la comanda.
      const k = `v${i.variante_id}:${i.cortesia ? 1 : 0}`
      const previo = menu.get(k)
      menu.set(k, { n: (previo?.n ?? 0) + i.cantidad, cocina: previo?.cocina ?? i.a_cocina !== false })
    }
  }
  for (const [k, { n, cocina }] of menu) partes.push(`${k}:${n}:${cocina ? 1 : 0}`)
  for (const [k, n] of sueltos) partes.push(`${k}:${n}`)
  return partes.sort().join('|')
}

/**
 * Pone los renglones de un pedido en la comanda, como si se tomara de cero
 * (el cliente, 23-sep). `null` = no se puede: un producto que ya salio del
 * menu, o el mismo producto cobrado y regalado a la vez. Eso se edita en el
 * cuadro de siempre.
 */
export function comandaDelPedido(
  pedido: Pedido,
  categorias: Categoria[],
  envioId: number | null,
): { carrito: Carrito; libres: Libre[] } | null {
  const delMenu = new Map<number, { producto: Producto; variante: Variante }>()
  for (const c of categorias)
    for (const p of c.productos) for (const v of p.variantes) delMenu.set(v.id, { producto: p, variante: v })
  const carrito: Carrito = {}
  const libres: Libre[] = []
  for (const i of pedido.items) {
    if (i.variante_id === null) {
      if (i.cortesia) return null
      for (let n = 0; n < i.cantidad; n++) libres.push({ id: uuid(), nombre: i.nombre, precio: i.precio_unitario })
      continue
    }
    const menu = delMenu.get(i.variante_id)
    if (!menu) return null
    if (envioId !== null && menu.producto.categoria_id === envioId) {
      if (i.cortesia) return null
      for (let n = 0; n < i.cantidad; n++)
        libres.push({ id: uuid(), nombre: i.nombre, precio: i.precio_unitario, variante_id: i.variante_id })
      continue
    }
    // El mismo producto puede venir en dos renglones: lo que la cocina ya
    // hizo y lo que se agrego despues. En la comanda es una sola linea.
    const ya = carrito[i.variante_id]
    if (ya) {
      if (ya.cortesia !== i.cortesia) return null
      ya.cantidad += i.cantidad
      continue
    }
    carrito[i.variante_id] = {
      ...menu,
      cantidad: i.cantidad,
      cortesia: i.cortesia,
      precio: i.cortesia ? i.precio_lista : i.precio_unitario,
    }
  }
  return { carrito, libres }
}

/** El nombre de un renglon del menu como sale en pantalla. */
export const nombreDe = (producto: Producto, variante: Variante) => etiquetaVariante(producto, variante)

// ── El pago movil que entro de mas o de menos ───────────────────────────────

export type ResultadoPago = { partes: Parte[]; propina: number; descuento: number; pendiente: boolean; motivo?: string }

/**
 * Lo que hay que anotar por un pago verificado, segun lo que decidio la
 * cajera con la diferencia. Con `otro_pago` se pide enseguida un SEGUNDO
 * pago movil por lo que falta, y lo que diga ese se resuelve igual: asi un
 * cliente que mando Bs 17,00 por una cuenta de Bs 17,18 manda los Bs 0,18 y
 * todo queda en la misma venta. Los montos van SIN redondear a centavos.
 */
export async function resolverPago(
  metodo: string,
  pedido: number,
  pago: PagoVerificado,
  tasaBcv: number,
  pedirPago: (metodo: string, monto: number) => Promise<PagoVerificado | null>,
): Promise<ResultadoPago> {
  // Los bolivares que dijo el banco viajan con el pago: con ellos el
  // servidor anota los centimos de mas o de menos en "Redondeo de pagos".
  const base = { metodo, referencia: pago.referencia, verificacion_id: pago.verificacion_id, monto_bs: pago.monto_bs }
  const entro = pago.monto_usd
  if (entro === undefined || !pago.decision || pago.decision === 'exacto') {
    return { partes: [{ ...base, monto: pedido }], propina: 0, descuento: 0, pendiente: false }
  }
  if (pago.decision === 'propina') {
    return { partes: [{ ...base, monto: entro }], propina: entro - pedido, descuento: 0, pendiente: false }
  }
  if (pago.decision === 'perdonar') {
    // En bolivares y exacto: en dolares una diferencia chica redondea a cero
    // y el motivo es lo unico que dice cuanto se dejo pasar.
    const faltoBs = pago.monto_bs !== undefined && tasaBcv > 0 ? pedido * tasaBcv - pago.monto_bs : null
    const motivo = faltoBs !== null ? `Faltaron ${fmtBs(faltoBs)} en el ${metodo.toLowerCase()}` : undefined
    return { partes: [{ ...base, monto: entro }], propina: 0, descuento: pedido - entro, pendiente: false, motivo }
  }
  if (pago.decision === 'resto') {
    return { partes: [{ ...base, monto: entro }], propina: 0, descuento: 0, pendiente: true }
  }
  // otro_pago: lo que falta, por el mismo metodo, verificado aparte.
  const primera = { ...base, monto: entro }
  const resto = pedido - entro
  const segundo = await pedirPago(metodo, resto)
  // Se echo atras con el segundo: lo que entro queda anotado y el cobro
  // sigue en pago partido para que cierre lo que falta como quiera.
  if (segundo === null) return { partes: [primera], propina: 0, descuento: 0, pendiente: true }
  const r = await resolverPago(metodo, resto, segundo, tasaBcv, pedirPago)
  return { ...r, partes: [primera, ...r.partes] }
}

// ── El ticket, en texto ─────────────────────────────────────────────────────

/**
 * El comprobante del cliente, en texto para compartir. En la web se abre una
 * ventana para imprimir (lib/ticket.ts); el telefono no tiene impresora, asi
 * que se manda por WhatsApp o se copia. Mismo contenido y mismo orden.
 */
export function textoDelTicket(t: Ticket, local: string): string {
  const l: string[] = []
  const d = (n: number) => `$${n.toFixed(2)}`
  if (local) l.push(local)
  l.push(`Pedido #${t.numero}`)
  if (t.cliente) l.push(t.cliente)
  const fecha = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(t.fecha)
  if (fecha) l.push(`${fecha[3]}/${fecha[2]}/${fecha[1]} ${fecha[4]}:${fecha[5]}`)
  if (t.operador) l.push(`Le atendió: ${t.operador}`)
  if (t.punto_venta) l.push(t.punto_venta)
  l.push('--------------------')
  for (const i of t.items) l.push(`${i.cantidad} x ${i.nombre}  ${d(i.subtotal)}`)
  l.push('--------------------')
  if (t.descuento) l.push(`Subtotal  ${d(t.subtotal)}`)
  if (t.descuento) l.push(`Descuento  -${d(t.descuento)}`)
  if (t.propina) l.push(`Propina  ${d(t.propina)}`)
  l.push(`TOTAL  ${d(t.a_cobrar)}`)
  if (t.total_bs) l.push(`En bolívares  ${fmtBs(t.total_bs)}`)
  if (t.tasa_bcv) l.push(`tasa ${t.tasa_bcv}`)
  if (t.facturado && t.base_imponible != null) {
    l.push('--------------------')
    l.push(`Base imponible  ${d(t.base_imponible)}`)
    if (t.iva != null) l.push(`IVA  ${d(t.iva)}`)
  }
  if (t.numero_factura) l.push(`Factura ${t.numero_factura}`)
  l.push('--------------------')
  for (const p of t.pagos) {
    l.push(`${etiquetaMetodo(p.metodo)}  ${d(p.monto)}`)
    if (p.referencia) l.push(`ref. ${p.referencia}`)
    if (p.vuelto_monto) l.push(`Vuelto  ${d(p.vuelto_monto)}`)
  }
  l.push('--------------------')
  l.push('Gracias por su compra')
  return l.join('\n')
}

// ── El toque que se siente ──────────────────────────────────────────────────

/**
 * Agregar un producto se SIENTE, no solo se ve: con la comanda fuera de la
 * vista (en el telefono va abajo, cerrada), la cajera tocaba dos o tres
 * veces por duda. En Android es el toque de tecla del sistema, que no pide
 * permiso de vibrar; en el navegador no hace nada.
 */
export function tocarSuave() {
  if (Platform.OS === 'android') {
    Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Virtual_Key).catch(() => undefined)
  } else if (Platform.OS === 'ios') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
  }
}

/** Cobrado o comanda enviada: el "listo" que se siente. */
export function tocarListo() {
  if (Platform.OS === 'android') {
    Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Confirm).catch(() =>
      Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Virtual_Key).catch(() => undefined),
    )
  } else if (Platform.OS === 'ios') {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined)
  }
}

// ── El canal en vivo ────────────────────────────────────────────────────────

export type EventoEnVivo = { event: string; data: unknown }
type Oyente = (evt: EventoEnVivo) => void

/*
 * UN SOLO SOCKET PARA EL MOSTRADOR, como la web (lib/api.ts, connectWs): el
 * punto de venta y el cuadro de pedir permiso se SUSCRIBEN a uno compartido,
 * que se abre con el primero y se cierra con el ultimo. Si se cae, la espera
 * se dobla hasta 30 s; con la app en segundo plano no se reintenta: se
 * reconecta al volver.
 */
const oyentes = new Set<Oyente>()
let canal: WebSocket | null = null
let espera = 1500
let reintento: ReturnType<typeof setTimeout> | null = null
let vigiaApp: NativeEventSubscription | null = null

function programarReconexion() {
  if (oyentes.size === 0 || reintento) return
  if (AppState.currentState !== 'active') return // al volver se reconecta
  reintento = setTimeout(() => {
    reintento = null
    abrirCanal()
  }, espera)
  espera = Math.min(espera * 2, 30000)
}

function abrirCanal() {
  if (oyentes.size === 0 || canal) return
  let ws: WebSocket
  try {
    ws = abrirCanalEnVivo()
  } catch {
    programarReconexion()
    return
  }
  canal = ws
  ws.onopen = () => {
    espera = 1500
  }
  ws.onmessage = (msg) => {
    let evt: EventoEnVivo
    try {
      evt = JSON.parse(String(msg.data))
    } catch {
      return
    }
    for (const oyente of [...oyentes]) {
      try {
        oyente(evt)
      } catch {
        // un oyente que falla no apaga el canal de los otros
      }
    }
  }
  ws.onclose = () => {
    if (canal !== ws) return
    canal = null
    programarReconexion()
  }
}

export function escucharEnVivo(oyente: Oyente): () => void {
  const propio: Oyente = (e) => oyente(e)
  oyentes.add(propio)
  if (!vigiaApp) {
    vigiaApp = AppState.addEventListener('change', (estado) => {
      if (estado === 'active' && oyentes.size > 0 && !canal && !reintento) {
        espera = 1500
        abrirCanal()
      }
    })
  }
  abrirCanal()
  return () => {
    oyentes.delete(propio)
    if (oyentes.size > 0) return
    vigiaApp?.remove()
    vigiaApp = null
    if (reintento) {
      clearTimeout(reintento)
      reintento = null
    }
    const ws = canal
    canal = null
    ws?.close()
  }
}
