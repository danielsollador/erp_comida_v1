import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { req } from '../../lib/api'
import { descargar } from '../../lib/archivos'
import { horaCorta } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import Icono, { type NombreIcono } from '../Icono'
import { Nota, Titulo } from '../ui'

/*
 * LAS PIEZAS DE LA ZONA CONTABLE (Contabilidad e Impuestos): los nombres en
 * castellano de lo que la API manda en snake_case, las fechas como las
 * escribe la web con es-VE, el boton chico de las filas, las cajas de color
 * de los avisos y el "tirar para refrescar" de cada seccion.
 */

// ── Palabras ────────────────────────────────────────────────────────────────

/** El `origen` de un asiento viene en snake_case; en pantalla se lee en castellano (igual que la web). */
export const ORIGEN_LABEL: Record<string, string> = {
  manual: 'Manual',
  venta: 'Venta',
  gasto: 'Gasto',
  merma: 'Merma',
  compra_insumo: 'Compra de mercancía',
  factura_compra: 'Factura de compra',
  pago_factura: 'Pago a proveedor',
  cierre_caja: 'Cierre de caja',
  apertura: 'Apertura',
  reverso_merma: 'Reverso de merma',
  ajuste_inventario: 'Ajuste de inventario',
  sobrante_inventario: 'Sobrante de inventario',
  reverso_sobrante: 'Reverso de sobrante',
  reverso_cierre_caja: 'Anulación de cierre de caja',
  reverso_baja_activo: 'Anulación de baja de activo',
  reverso_declaracion_iva: 'Anulación de declaración de IVA',
  nota_credito_compra: 'Nota de crédito del proveedor',
  depreciacion: 'Depreciación',
  baja_activo: 'Baja de equipo',
  alta_activo: 'Alta de equipo',
  alta_insumo: 'Alta de mercancía',
  apertura_kardex: 'Apertura de inventario',
  carga_indirecto: 'Carga de aceite / indirecto',
  cierre_ejercicio: 'Cierre del año',
  cobro_fiado: 'Cobro de fiado',
  compra_suelta: 'Compra suelta',
  consumo_personal: 'Consumo del personal',
  conteo: 'Conteo físico',
  correccion_pago: 'Corrección de pago',
  declaracion_iva: 'Declaración de IVA',
  devolucion: 'Devolución de venta',
  edicion_pedido: 'Pedido editado',
  entrega_propinas: 'Entrega de propinas',
  factura_tardia: 'Factura tardía',
  fusion: 'Fusión de mercancía',
  merma_revertida: 'Merma revertida',
  nota_credito: 'Nota de crédito',
  pago_iva: 'Pago de IVA',
  pedido_anulado: 'Pedido anulado',
  pedido_editado: 'Pedido editado',
  produccion: 'Producción',
  redondeo: 'Redondeo',
  retenciones_iva: 'Retenciones de IVA',
  retiro: 'Retiro del dueño',
  sobrante_revertido: 'Sobrante revertido',
  apertura_dia: 'Apertura del día',
  reclamo_proveedor: 'Faltante reclamado al proveedor',
  reclamo_perdido: 'Faltante no acreditado',
}

export const TIPO_LABEL: Record<string, string> = {
  activo: 'Activo',
  pasivo: 'Pasivo',
  patrimonio: 'Patrimonio',
  ingreso: 'Ingreso',
  costo: 'Costo',
  gasto: 'Gasto',
}

export const nombreOrigen = (o: string) => ORIGEN_LABEL[o] ?? o
export const nombreTipo = (t: string) => TIPO_LABEL[t] ?? t

/** El mensaje de un error, en palabras (el de la API ya viene asi). */
export function mensajeDe(e: unknown, porDefecto: string): string {
  return e instanceof Error && e.message ? e.message : porDefecto
}

// ── Fechas ──────────────────────────────────────────────────────────────────
//
// Sin Intl, como lib/formato: el motor del telefono no siempre trae los datos
// de idioma. El backend guarda la hora LOCAL del negocio sin zona, asi que se
// lee tal cual (ver horaCorta en lib/numeros).

/** "09/10/2026": una fecha AAAA-MM-DD (o ISO con hora), como la escribe la web. */
export function fechaVE(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [a, m, d] = iso.slice(0, 10).split('-')
  if (!a || !m || !d) return iso
  return `${d}/${m}/${a}`
}

/** "09/10/2026, 12:36 a. m.": una fecha con su hora. */
export function fechaHoraVE(iso: string | null | undefined): string {
  if (!iso) return '—'
  const hora = horaCorta(iso)
  return hora ? `${fechaVE(iso)}, ${hora}` : fechaVE(iso)
}

/**
 * Horas enteras desde un momento local del negocio (sin zona) hasta ahora.
 * Venezuela esta en UTC−4 todo el año: se lee con esa zona, no con la del
 * telefono, que puede estar en otra.
 */
export function horasDesde(iso: string): number {
  const ms = Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso.slice(0, 19)}-04:00`)
  return Number.isNaN(ms) ? 0 : Math.max(0, Math.floor((Date.now() - ms) / 3600_000))
}

/** El AAAA-MM-DD de hoy en Caracas (para proponer la fecha de un comprobante). */
export function hoyISO(): string {
  return new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10)
}

/** El año en curso en Caracas. */
export function anioActual(): number {
  return Number(hoyISO().slice(0, 4))
}

export const ES_FECHA = /^\d{4}-\d{2}-\d{2}$/

/** Si "AAAA-MM-DD" es una fecha que existe (no un 31 de febrero). */
export function fechaValida(texto: string): boolean {
  if (!ES_FECHA.test(texto)) return false
  const d = new Date(`${texto}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto
}

// ── Descargas ───────────────────────────────────────────────────────────────

/**
 * `descargar()` de lib/archivos, pero diciendo POR QUE fallo. Una descarga
 * fallida solo trae el codigo ("No se pudo descargar (400)"), y el TXT de
 * retenciones sin RIF de la empresa contesta con su motivo en palabras: se
 * vuelve a pedir con `req` para leerlo y mostrarlo tal cual lo dice el
 * servidor.
 */
export async function bajar(ruta: string, nombre: string): Promise<void> {
  try {
    await descargar(ruta, nombre)
  } catch (e) {
    let motivo = ''
    try {
      await req<unknown>(ruta)
    } catch (detalle) {
      motivo = mensajeDe(detalle, '')
    }
    throw motivo ? new Error(motivo) : e
  }
}

// ── Refrescar tirando hacia abajo ───────────────────────────────────────────

/**
 * La pantalla (Contabilidad, Impuestos) tiene UN solo "tirar para
 * refrescar", pero lo que hay que recargar es lo de la seccion que se esta
 * viendo. Cada seccion deja aqui su `refrescar` y avisa cuando esta
 * refrescando; la pantalla lo llama al tirar.
 */
export type Refresco = {
  /** La seccion deja aqui su `refrescar` (la pantalla lo guarda en una ref). */
  registrar: (fn: () => void) => void
  setRefrescando: (v: boolean) => void
}

export const RefrescoContexto = createContext<Refresco | null>(null)

/** Lo que monta la pantalla: el valor del contexto y lo que va en `Pantalla`. */
export function useRefrescoDePantalla() {
  const refrescarRef = useRef<(() => void) | null>(null)
  const [refrescando, setRefrescando] = useState(false)
  const valor = useMemo<Refresco>(
    () => ({
      registrar: (fn) => {
        refrescarRef.current = fn
      },
      setRefrescando,
    }),
    [],
  )
  return { valor, refrescando, refrescar: () => refrescarRef.current?.() }
}

export function useRefrescoDeSeccion(refrescando: boolean, refrescar: () => void) {
  const ctx = useContext(RefrescoContexto)
  useEffect(() => {
    ctx?.registrar(refrescar)
  })
  useEffect(() => {
    ctx?.setRefrescando(refrescando)
  }, [ctx, refrescando])
}

// ── Piezas de pantalla ──────────────────────────────────────────────────────

/** El aviso informativo de la web (`Aviso tono="info"`): gris, sin alarma. */
export function AvisoInfo({ children }: { children: ReactNode }) {
  const t = useTema()
  return (
    <View style={[p.caja, { backgroundColor: t.gris100, borderColor: t.gris200 }]}>
      <Text style={[p.nota, { color: t.suave }]}>{children}</Text>
    </View>
  )
}

/** Una caja de color: verde si va bien, ambar si hay que mirar, roja si falla, acento si algo paso. */
export function Caja({
  tono,
  children,
  style,
}: {
  tono: 'exito' | 'aviso' | 'peligro' | 'acento' | 'neutro'
  children: ReactNode
  style?: StyleProp<ViewStyle>
}) {
  const t = useTema()
  const fondo =
    tono === 'exito' ? t.exitoSuave : tono === 'aviso' ? t.avisoSuave : tono === 'peligro' ? t.peligroSuave : tono === 'acento' ? t.acentoSuave : t.superficie
  const borde = tono === 'aviso' ? t.avisoLinea : tono === 'neutro' ? t.gris200 : 'transparent'
  return <View style={[p.caja, { backgroundColor: fondo, borderColor: borde }, style]}>{children}</View>
}

/** El color del texto dentro de una `Caja` de ese tono. */
export function useTintaDe(tono: 'exito' | 'aviso' | 'peligro' | 'acento' | 'neutro'): string {
  const t = useTema()
  return tono === 'exito' ? t.exito : tono === 'aviso' ? t.aviso : tono === 'peligro' ? t.peligro : tono === 'acento' ? t.acentoFuerte : t.tinta
}

/**
 * El boton chico de una fila ("Declarar", "Dar de baja", "Restaurar"): 44 px
 * de alto para el pulgar aunque se vea chico. `enlace` es el texto de color
 * de la web (sin fondo).
 */
export function BotonChico({
  texto,
  alTocar,
  tono = 'neutro',
  icono,
  ocupado = false,
  deshabilitado = false,
}: {
  texto: string
  alTocar: () => void
  tono?: 'neutro' | 'acento' | 'peligro' | 'enlace' | 'enlacePeligro'
  icono?: NombreIcono
  ocupado?: boolean
  deshabilitado?: boolean
}) {
  const t = useTema()
  const enlace = tono === 'enlace' || tono === 'enlacePeligro'
  const fondo = tono === 'acento' ? t.acento : tono === 'peligro' ? t.peligroSuave : enlace ? 'transparent' : t.gris100
  const tinta =
    tono === 'acento' ? t.acentoTinta : tono === 'peligro' || tono === 'enlacePeligro' ? t.peligro : tono === 'enlace' ? t.acento : t.tinta
  return (
    <Pressable
      onPress={alTocar}
      disabled={ocupado || deshabilitado}
      accessibilityRole="button"
      accessibilityLabel={texto}
      hitSlop={4}
      style={({ pressed }) => [
        p.chico,
        enlace && p.chicoEnlace,
        { backgroundColor: fondo, opacity: ocupado || deshabilitado ? 0.45 : pressed ? 0.7 : 1 },
      ]}
    >
      {ocupado ? (
        <ActivityIndicator color={tinta} size="small" />
      ) : (
        <>
          {icono ? <Icono nombre={icono} size={15} color={tinta} grosor={2} /> : null}
          <Text style={[p.chicoTexto, { color: tinta }]} numberOfLines={1}>
            {texto}
          </Text>
        </>
      )}
    </Pressable>
  )
}

/** El titulo de un bloque con su ayuda debajo y, a la derecha, su accion. */
export function Cabeza({ titulo, ayuda, accion }: { titulo: string; ayuda?: ReactNode; accion?: ReactNode }) {
  return (
    <View style={p.cabeza}>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Titulo>{titulo}</Titulo>
        {ayuda ? <Nota>{ayuda}</Nota> : null}
      </View>
      {accion}
    </View>
  )
}

/** "Ver 50 más (120 quedan)": las listas largas se dibujan de a poco, como el diario de la web. */
export function VerMas({ quedan, alTocar, paso = 50 }: { quedan: number; alTocar: () => void; paso?: number }) {
  if (quedan <= 0) return null
  return (
    <View style={{ alignItems: 'center' }}>
      <BotonChico texto={`Ver ${Math.min(paso, quedan)} más (${quedan} quedan)`} alTocar={alTocar} />
    </View>
  )
}

/** Una cifra pequeña en la letra de las cifras, para las columnas de una tabla. */
export function Monto({
  children,
  fuerte = false,
  color,
  ancho,
  alinear = 'right',
}: {
  children: ReactNode
  fuerte?: boolean
  color?: string
  ancho?: number
  alinear?: 'left' | 'right'
}) {
  const t = useTema()
  return (
    <Text
      style={[fuerte ? p.montoFuerte : p.monto, { color: color ?? t.tinta, textAlign: alinear }, ancho ? { width: ancho } : null]}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.7}
    >
      {children}
    </Text>
  )
}

export const p = StyleSheet.create({
  caja: { borderRadius: 20, padding: 16, borderWidth: 1, gap: 4 },
  nota: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
  texto: { fontFamily: LETRA.texto, fontSize: 14.5, lineHeight: 20 },
  textoFuerte: { fontFamily: LETRA.textoFuerte, fontSize: 15, lineHeight: 21 },
  chico: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  chicoEnlace: { paddingHorizontal: 6 },
  chicoTexto: { fontFamily: LETRA.textoFuerte, fontSize: 14 },
  cabeza: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  monto: { fontFamily: LETRA.cifra, fontSize: 13.5 },
  montoFuerte: { fontFamily: LETRA.cifraFuerte, fontSize: 13.5 },
  codigo: { fontFamily: LETRA.cifra, fontSize: 13 },
  columna: { fontFamily: LETRA.textoFuerte, fontSize: 11, letterSpacing: 1.1, textTransform: 'uppercase' },
})
