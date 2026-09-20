import { createPortal } from 'react-dom'
import { useEffect, useRef, type ButtonHTMLAttributes, type ChangeEvent, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { Ayuda } from './Ayuda'
import { explicar } from '../lib/glosario'
import Icono, { type NombreIcono } from './Icono'
import { Numerico } from './Teclado'

/**
 * Las piezas del sistema de diseño de Vertigo Pro.
 *
 * POR QUE EXISTE ESTE ARCHIVO. Las trece pantallas se escribieron sueltas y
 * cada una eligio sus formas: tarjetas con sombra en unas y con borde en
 * otras, campos en tres radios distintos, botones en cuatro. La capa de
 * homologacion de `index.css` empareja lo que ya estaba escrito; esto es para
 * que lo que se escriba de aqui en adelante nazca homologado y no haya que
 * volver a emparejarlo.
 *
 * La regla: una pantalla nueva no inventa clases de tarjeta, boton ni campo.
 * Usa esto. Si hace falta algo que no esta aqui, se agrega aqui.
 */

// ── La pagina ──────────────────────────────────────────────────────────────

/**
 * El contenedor de una pantalla completa.
 *
 * POR QUE NO UN `max-w-2xl` A MANO EN CADA UNA. Cada pantalla eligio su tope
 * de ancho --2xl, 3xl, 4xl-- y en una tablet el resultado eran dos franjas en
 * blanco a los lados mientras la tabla de inventario, estrujada en el centro,
 * se cortaba y pedia scroll horizontal. Un tope de ancho existe para que un
 * parrafo no se lea de borde a borde; no para apretar ocho columnas.
 *
 * Asi que el ancho lo decide el CONTENIDO, no la pantalla:
 *   - `ancha`   (tablas, tableros): crece con la pantalla hasta 100 rem.
 *   - `media`   (formulario mas listado): hasta 69 rem.
 *   - `angosta` (un formulario y ya): 42 rem, que es lo que se lee comodo.
 */
export function Pagina({
  ancho = 'ancha',
  children,
  className = '',
}: {
  ancho?: 'ancha' | 'media' | 'angosta'
  children: ReactNode
  className?: string
}) {
  const topes = { ancha: 'max-w-[90rem]', media: 'max-w-[69rem]', angosta: 'max-w-[42rem]' }
  return (
    <div
      className={`${topes[ancho]} mx-auto w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-7 lg:py-9 space-y-5 lg:space-y-6 ${className}`}
    >
      {children}
    </div>
  )
}

// ── Tarjeta ────────────────────────────────────────────────────────────────

export function Tarjeta({
  children,
  className = '',
  plano = false,
}: {
  children: ReactNode
  className?: string
  /** Sin relleno propio: para tablas, que ponen el suyo en cada celda. */
  plano?: boolean
}) {
  return (
    <div
      className={`bg-white rounded-2xl border border-neutral-200 ${plano ? 'overflow-hidden' : 'p-4'} ${className}`}
    >
      {children}
    </div>
  )
}

/**
 * Una tarjeta con su titulo y, opcionalmente, una accion a la derecha.
 *
 * El titulo va en `h2` a proposito: es lo que da el esqueleto de la pagina a
 * un lector de pantalla, y lo que hace que la tipografia de titulos se aplique
 * sola (ver `index.css`).
 */
export function Seccion({
  titulo,
  ayuda,
  accion,
  children,
  className = '',
  plano = false,
}: {
  titulo: string
  /** Una linea que explica de que va la seccion, bajo el titulo. */
  ayuda?: ReactNode
  accion?: ReactNode
  children: ReactNode
  className?: string
  plano?: boolean
}) {
  return (
    <Tarjeta className={className} plano={plano}>
      <div className={`flex items-start justify-between gap-3 ${plano ? 'px-4 pt-4' : ''}`}>
        <div className="min-w-0">
          <h2 className="font-semibold">{titulo}</h2>
          {ayuda && <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">{ayuda}</p>}
        </div>
        {accion && <div className="shrink-0">{accion}</div>}
      </div>
      <div className={plano ? '' : 'mt-3'}>{children}</div>
    </Tarjeta>
  )
}

// ── Boton ──────────────────────────────────────────────────────────────────

type TonoBoton = 'principal' | 'suave' | 'fantasma' | 'peligro' | 'peligro-fuerte'

const TONOS: Record<TonoBoton, string> = {
  principal: 'bg-neutral-900 text-white',
  suave: 'bg-white border border-neutral-200 text-neutral-900 hover:border-neutral-400',
  fantasma: 'text-neutral-600 hover:bg-neutral-100',
  peligro: 'text-peligro-600 hover:bg-peligro-50',
  // Para la accion que destruye datos y aun asi es la principal del dialogo
  // (restaurar un respaldo pisa las ventas de hoy): tiene que verse desde
  // lejos que NO es el boton seguro.
  'peligro-fuerte': 'bg-peligro-600 text-white',
}

export function Boton({
  tono = 'principal',
  icono,
  ancho = false,
  className = '',
  children,
  ...resto
}: {
  tono?: TonoBoton
  icono?: NombreIcono
  /** Ocupa todo el ancho: es lo que se espera de la accion final de un formulario. */
  ancho?: boolean
  children: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...resto}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${
        TONOS[tono]
      } ${ancho ? 'w-full' : ''} ${className}`}
    >
      {icono && <Icono nombre={icono} size={16} />}
      {children}
    </button>
  )
}

// ── Campos ─────────────────────────────────────────────────────────────────

/**
 * Un campo con su etiqueta encima.
 *
 * La etiqueta va en un `<label>` de verdad y no en un `<div>`: en una tablet de
 * mostrador, tocar la palabra "Monto" tiene que poner el cursor en el campo.
 */
export function Campo({
  etiqueta,
  ayuda,
  className = '',
  ...resto
}: { etiqueta: string; ayuda?: string; className?: string } & InputHTMLAttributes<HTMLInputElement>) {
  // Un campo de numero (`type="number"` o `inputMode="decimal"/"numeric"`)
  // usa el teclado propio del ERP en las tablets (ver Teclado.tsx).
  const esNumero = resto.type === 'number' || resto.inputMode === 'decimal' || resto.inputMode === 'numeric'
  const clase = 'w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm'
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">
        {etiqueta}
      </span>
      {esNumero ? (
        <Numerico
          {...(resto as Omit<typeof resto, 'onChange' | 'value' | 'type'>)}
          etiqueta={etiqueta}
          entero={resto.inputMode === 'numeric'}
          value={resto.value as string | number | undefined}
          onChange={(e) => resto.onChange?.(e as unknown as ChangeEvent<HTMLInputElement>)}
          className={clase}
        />
      ) : (
        <input {...resto} className={clase} />
      )}
      {ayuda && <span className="block text-xs text-neutral-500 mt-1">{ayuda}</span>}
    </label>
  )
}

export function Selector({
  etiqueta,
  children,
  className = '',
  ...resto
}: { etiqueta: string; children: ReactNode; className?: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">
        {etiqueta}
      </span>
      <select {...resto} className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm">
        {children}
      </select>
    </label>
  )
}

// ── Piezas de lectura ──────────────────────────────────────────────────────

/** El rotulo de un grupo, fuera de una tarjeta. */
export function Etiqueta({ children }: { children: ReactNode }) {
  return <p className="vp-etiqueta mb-2">{children}</p>}

/**
 * Una cifra con su rotulo. Es la unidad de las franjas de resumen (lo vendido
 * hoy, lo que hay en la gaveta, lo que se debe).
 */
export function Cifra({
  titulo,
  valor,
  detalle,
  ayuda,
  tono = 'normal',
}: {
  titulo: string
  valor: string
  detalle?: string
  /** Clave del glosario: al posar el cursor sobre el titulo, la explicacion. */
  ayuda?: string
  tono?: 'normal' | 'alerta' | 'bien'
}) {
  const fondo =
    tono === 'alerta'
      ? 'bg-aviso-50 border-aviso-300'
      : tono === 'bien'
        ? 'bg-exito-50 border-exito-200'
        : 'bg-white border-neutral-200'
  const texto = tono === 'alerta' ? 'text-aviso-700' : tono === 'bien' ? 'text-exito-700' : 'text-neutral-500'
  return (
    <div className={`rounded-2xl border p-4 ${fondo}`}>
      <div className={`text-xs font-medium ${texto}`}>
        <Ayuda explica={explicar(ayuda)} titulo={titulo}>
          {titulo}
        </Ayuda>
      </div>
      <div className="text-xl font-semibold tabular-nums mt-1">{valor}</div>
      {detalle && <div className="text-xs text-neutral-500 mt-0.5">{detalle}</div>}
    </div>
  )
}

/** Una pastilla de estado: pagado, anulado, a credito, vencida. */
export function Pastilla({
  children,
  tono = 'neutro',
}: {
  children: ReactNode
  tono?: 'neutro' | 'bien' | 'ojo' | 'mal' | 'acento'
}) {
  const tonos = {
    neutro: 'bg-neutral-100 text-neutral-600',
    bien: 'bg-exito-50 text-exito-700',
    ojo: 'bg-aviso-50 text-aviso-700',
    mal: 'bg-peligro-50 text-peligro-700',
    acento: 'bg-acento-50 text-acento-600',
  }
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${tonos[tono]}`}>
      {children}
    </span>
  )
}

/**
 * Lo que se ve cuando todavia no hay nada.
 *
 * Nunca una tabla vacia a secas: una pantalla en blanco no dice si el sistema
 * esta cargando, si fallo, o si de verdad no hay nada -- y la primera vez que
 * alguien abre Compras no hay nada.
 */
export function Vacio({
  icono,
  titulo,
  detalle,
  accion,
}: {
  icono?: NombreIcono
  titulo: string
  detalle?: string
  accion?: ReactNode
}) {
  return (
    <div className="text-center py-10 px-6">
      {icono && (
        <span className="inline-grid place-items-center w-12 h-12 rounded-2xl bg-neutral-100 text-neutral-400 mb-3">
          <Icono nombre={icono} size={22} />
        </span>
      )}
      <p className="font-semibold">{titulo}</p>
      {detalle && <p className="text-sm text-neutral-500 mt-1 max-w-sm mx-auto">{detalle}</p>}
      {accion && <div className="mt-4">{accion}</div>}
    </div>
  )
}

/** Un aviso dentro de una pantalla: error de la ultima accion, o una nota. */
export function Aviso({
  tono = 'mal',
  children,
}: {
  tono?: 'mal' | 'ojo' | 'bien' | 'info'
  children: ReactNode
}) {
  const tonos = {
    mal: 'bg-peligro-50 border-peligro-200 text-peligro-700',
    ojo: 'bg-aviso-50 border-aviso-200 text-aviso-800',
    bien: 'bg-exito-50 border-exito-200 text-exito-800',
    info: 'bg-acento-50 border-acento-200 text-acento-700',
  }
  return (
    <div role="status" className={`rounded-xl border px-4 py-3 text-sm ${tonos[tono]}`}>
      {children}
    </div>
  )
}

// ── Lecturas ───────────────────────────────────────────────────────────────

/**
 * Lo que el sistema LEE en los numeros, en una frase por tarjeta.
 *
 * Estaba escrito dentro de Reportes; con el analisis de la tasa habia que
 * repetirlo, y dos copias del mismo bloque se separan al primer retoque. El
 * tono no es decorativo: verde es "asi esta bien", ambar es "esto te cuesta
 * plata" y neutro es contexto.
 */
export type Lectura = { tipo: 'bueno' | 'alerta' | 'info'; titulo: string; detalle: string }

const TONO_LECTURA: Record<Lectura['tipo'], { caja: string; icono: string }> = {
  bueno: { caja: 'bg-exito-50 border-exito-200 text-exito-900', icono: '✓' },
  alerta: { caja: 'bg-aviso-50 border-aviso-200 text-aviso-900', icono: '!' },
  info: { caja: 'bg-acento-50 border-acento-200 text-acento-900', icono: 'i' },
}

export function Lecturas({ items }: { items: Lectura[] }) {
  if (items.length === 0) return null
  return (
    <div className="space-y-2">
      {items.map((l, i) => {
        const tono = TONO_LECTURA[l.tipo]
        return (
          <div key={i} className={`border rounded-xl p-3 flex gap-3 ${tono.caja}`}>
            <span className="font-bold shrink-0 w-5 h-5 rounded-full bg-white/70 flex items-center justify-center text-xs">
              {tono.icono}
            </span>
            <div>
              <div className="font-semibold text-sm">{l.titulo}</div>
              <div className="text-sm opacity-80">{l.detalle}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Modal ──────────────────────────────────────────────────────────────────

/**
 * Una ventana sobre la pantalla: cobrar, editar una receta, confirmar algo.
 *
 * POR QUE ESTA AQUI Y NO EN CADA PANTALLA. Los cinco modales del ERP se
 * escribieron sueltos y cada uno resolvia la salida a su manera: el de cobro
 * del POS tenia el "Cancelar" como texto gris al final y --lo grave-- ni
 * `max-height` ni scroll, asi que con pago mixto, descuento y propina el
 * contenido crecia mas que la pantalla del telefono y los botones quedaban
 * fuera, sin forma de llegar a ellos. Quedarse encerrado en una ventana es la
 * peor version de "no hay boton para volver atras".
 *
 * Lo que garantiza, siempre:
 *   - una X de verdad, con area tactil de 40 px, arriba a la derecha;
 *   - cuerpo con scroll propio y tope de altura, nunca mas alto que la
 *     pantalla;
 *   - en el telefono entra como hoja desde abajo --donde llega el pulgar-- y
 *     en escritorio queda centrada;
 *   - se cierra con Escape y tocando fuera, que es lo que todo el mundo
 *     intenta antes de buscar el boton.
 */
export function Modal({
  titulo,
  ayuda,
  onCerrar,
  children,
  pie,
  ancho = 'md',
}: {
  titulo: string
  ayuda?: ReactNode
  onCerrar: () => void
  children: ReactNode
  /** Acciones fijas al pie: no se van con el scroll del cuerpo. */
  pie?: ReactNode
  ancho?: 'sm' | 'md' | 'lg'
}) {
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar()
    }
    document.addEventListener('keydown', alPulsar)
    // Mientras la ventana esta abierta, lo de atras no se desplaza: en un
    // telefono, el scroll se "escapaba" a la pagina de abajo al llegar al
    // final del modal.
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', alPulsar)
      document.body.style.overflow = overflow
    }
  }, [onCerrar])

  const anchos = { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' }

  // Tocar el fondo cierra SOLO si el toque empezo Y termino en el fondo. Sin
  // esto, al tocar un campo se abria el teclado propio, el cuadro se corria
  // para dejarle sitio, y el `click` --que llega despues del corrimiento--
  // caia en el fondo y cerraba el cuadro con el teclado abierto y solo.
  const bajoEnFondo = useRef(false)

  // Al `body` y no donde se escribio: si algun ancestro tiene `transform`,
  // `filter` o `contain`, pasa a ser el bloque contenedor de lo `fixed` y el
  // modal se posiciona contra la pagina en vez de contra la pantalla. Ya paso
  // una vez con la animacion de entrada de cada pantalla; asi no vuelve a
  // pasar aunque manana alguien anime otra cosa.
  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] flex items-end sm:items-center justify-center sm:p-4"
      // Si el teclado propio esta abierto (Teclado.tsx), el cuadro se centra
      // en lo que queda de pantalla en vez de quedar debajo de el.
      style={{ paddingBottom: 'var(--vp-teclado-abajo, 0px)' }}
      onPointerDown={(e) => {
        bajoEnFondo.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && bajoEnFondo.current) onCerrar()
        bajoEnFondo.current = false
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        // El clic dentro no cierra: si no, arrastrar para seleccionar un texto
        // y soltar fuera cerraba la ventana con todo a medio llenar.
        onClick={(e) => e.stopPropagation()}
        className={`bg-white w-full ${anchos[ancho]} rounded-t-2xl sm:rounded-2xl border border-neutral-200 shadow-lg flex flex-col max-h-[92vh] sm:max-h-[85vh] pb-[env(safe-area-inset-bottom)] sm:pb-0`}
        style={{ animation: 'vp-entrar .22s cubic-bezier(.2,.7,.2,1) backwards' }}
      >
        <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-neutral-100 shrink-0">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-lg leading-tight">{titulo}</h3>
            {ayuda && <p className="text-xs text-neutral-500 mt-0.5">{ayuda}</p>}
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            title="Cerrar (Esc)"
            className="shrink-0 -mr-1 -mt-1 w-10 h-10 grid place-items-center rounded-xl text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto grow">{children}</div>

        {pie && (
          <div className="px-5 py-3 border-t border-neutral-100 shrink-0 flex flex-wrap gap-2 justify-end">
            {pie}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
