import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { achicarFoto } from '../lib/foto'
import type { AvisoPrecio, LecturaFactura, RenglonLeido, RevisionFactura } from '../lib/types'
import { Aviso, Boton, Modal } from './ui'

/**
 * Factura de compra desde una foto: las piezas que se enganchan al formulario
 * de Compras. La IA solo PROPONE: prellena el formulario de siempre, una
 * persona lo revisa y guarda por el camino de siempre.
 */

/** El botón. No aparece si la lectura no está activada en el servidor. */
export function BotonFoto({ alLeer }: { alLeer: (lectura: LecturaFactura, foto: string) => void }) {
  const [activo, setActivo] = useState(false)
  const [leyendo, setLeyendo] = useState(false)
  const [error, setError] = useState('')
  const entrada = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api
      .estadoLectorFacturas()
      .then((e) => setActivo(e.activo))
      .catch(() => setActivo(false))
  }, [])

  async function elegida(archivo: File | undefined) {
    if (!archivo) return
    setError('')
    setLeyendo(true)
    try {
      const foto = await achicarFoto(archivo)
      const lectura = await api.leerFacturaCompra(foto)
      alLeer(lectura, URL.createObjectURL(foto))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo leer la foto')
    } finally {
      setLeyendo(false)
      // Poder elegir la misma foto otra vez si se reintenta.
      if (entrada.current) entrada.current.value = ''
    }
  }

  if (!activo) return null
  return (
    <div className="mb-3">
      {/* Sin `capture`: en el teléfono deja elegir entre la cámara y una foto
          que ya estaba en la galería (la que mandó el proveedor por WhatsApp). */}
      <input
        ref={entrada}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => elegida(e.target.files?.[0])}
      />
      <Boton tono="suave" onClick={() => entrada.current?.click()} disabled={leyendo}>
        {leyendo ? 'Leyendo la factura…' : 'Cargar desde foto'}
      </Boton>
      {error && <p className="text-peligro-600 text-sm mt-2">{error}</p>}
    </div>
  )
}

/**
 * Dice lo que el sistema entiende por la unidad del papel, para compararla con
 * la de la mercancía. "UND" y "unidad" son lo mismo; "UND" y "kg" no.
 */
const UNIDADES: Record<string, string> = {
  KG: 'kg', KGS: 'kg', KILO: 'kg', KILOS: 'kg',
  G: 'g', GR: 'g', GRS: 'g',
  L: 'lt', LT: 'lt', LTS: 'lt', LITRO: 'lt', LITROS: 'lt',
  ML: 'ml',
  UND: 'unidad', UNID: 'unidad', UN: 'unidad', U: 'unidad', UNIDAD: 'unidad', UNIDADES: 'unidad',
  PAQ: 'paquete', PAQUETE: 'paquete',
}

function unidadDistinta(unidadPapel: string, unidadNuestra: string | undefined): boolean {
  const papel = unidadPapel.trim().toUpperCase().replace(/\.$/, '')
  if (!papel || !unidadNuestra) return false
  return (UNIDADES[papel] ?? papel.toLowerCase()) !== unidadNuestra
}

/** Lo que dice el papel sobre un renglón, encima del renglón del formulario. */
export function RenglonDelPapel({
  leido,
  moneda,
  unidadNuestra,
  aviso,
}: {
  leido?: RenglonLeido
  moneda: string
  unidadNuestra?: string
  aviso?: AvisoPrecio
}) {
  if (!leido && !aviso) return null
  return (
    <div className="w-full text-xs space-y-0.5">
      {leido && (
        <p className="text-neutral-500">
          <span className="font-medium text-neutral-700">Factura:</span> {leido.descripcion || '(sin descripción)'}
          {' — '}
          {leido.cantidad ?? '?'} {leido.unidad} × {moneda}
          {leido.precio_unitario ?? '?'}
          {leido.exento ? ' (exento)' : ''}
        </p>
      )}
      {leido && unidadDistinta(leido.unidad, unidadNuestra) && (
        <p className="text-aviso-700">
          La factura dice {leido.unidad} y esta mercancía se lleva en {unidadNuestra}: ajusta cantidad y costo
          si no es uno a uno.
        </p>
      )}
      {aviso && aviso.nivel !== 'normal' && (
        <p className={aviso.nivel === 'unidad' ? 'text-peligro-600' : 'text-aviso-700'}>
          {aviso.mensaje}{' '}
          {aviso.base === 'compras'
            ? `Se venía pagando $${aviso.referencia.toFixed(2)} (últimas ${aviso.muestras} compras).`
            : `Costo promedio: $${aviso.referencia.toFixed(2)}; todavía no hay compras con qué comparar.`}
        </p>
      )}
    </div>
  )
}

/**
 * Lo que conviene mirar antes de Guardar. Avisa, no bloquea: quien tiene el
 * papel delante decide.
 */
export function PanelRevision({
  lectura,
  foto,
  monedaFormulario,
  totalFormulario,
  baseFormulario,
  ivaFormulario,
  revision,
}: {
  lectura: LecturaFactura | null
  foto: string
  monedaFormulario: string
  totalFormulario: number
  baseFormulario: number
  ivaFormulario: number
  revision: RevisionFactura | null
}) {
  const [ampliada, setAmpliada] = useState(false)
  const borrador = lectura?.borrador ?? null
  const duplicadas = revision?.duplicadas ?? []

  // El cuadre solo tiene sentido en la misma moneda del papel.
  const mismaMoneda = !borrador?.moneda || borrador.moneda === monedaFormulario
  const totalPapel = borrador?.total ?? null
  const diferencia = totalPapel === null ? null : Math.round((totalFormulario - totalPapel) * 100) / 100
  // El IVA se redondea renglón por renglón en unas facturas y al final en
  // otras: unos centavos no son un error.
  const tolerancia = totalPapel === null ? 0 : Math.max(0.05, Math.abs(totalPapel) * 0.001)
  const cuadra = diferencia !== null && Math.abs(diferencia) <= tolerancia

  if (!lectura && duplicadas.length === 0) return null
  return (
    <div className="space-y-2 mb-3">
      {duplicadas.length > 0 && (
        <Aviso tono="mal">
          <p className="font-semibold">Esta factura parece ya cargada</p>
          {duplicadas.map((d) => (
            <p key={d.id}>
              {d.numero_factura} de {d.proveedor_nombre}, del {new Date(d.fecha).toLocaleDateString('es-VE')}, por $
              {d.total.toFixed(2)}.
            </p>
          ))}
        </Aviso>
      )}

      {lectura && (
        <div className="flex gap-3 rounded-xl border border-acento-200 bg-acento-50 p-3 text-sm">
          {foto && (
            <button onClick={() => setAmpliada(true)} className="shrink-0" title="Ver la foto">
              <img src={foto} alt="Foto de la factura" className="h-24 w-20 object-cover rounded-lg border" />
            </button>
          )}
          <div className="min-w-0 space-y-1 text-acento-900">
            {borrador ? (
              <>
                <p className="font-semibold">Formulario prellenado desde la foto</p>
                <p className="text-xs">
                  Revisa cada campo contra el papel y elige la mercancía de cada renglón antes de guardar.
                </p>
                {borrador.advertencias.map((a) => (
                  <p key={a} className="text-xs text-aviso-800">
                    {a}
                  </p>
                ))}
              </>
            ) : (
              <>
                <p className="font-semibold">No se pudo leer la foto</p>
                <p className="text-xs">
                  {lectura.error} Puedes cargar la factura a mano: la foto se adjunta igual al guardar.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {borrador && totalPapel !== null && mismaMoneda && (
        <Aviso tono={cuadra ? 'bien' : 'ojo'}>
          <p className="font-semibold">
            {cuadra
              ? 'Cuadra con el papel'
              : `No cuadra: el formulario da ${monedaFormulario}${totalFormulario.toFixed(2)} y el papel ${monedaFormulario}${totalPapel.toFixed(2)}`}
          </p>
          <p className="text-xs">
            Papel: base {borrador.subtotal?.toFixed(2) ?? '?'} + IVA {borrador.iva?.toFixed(2) ?? '?'} ={' '}
            {totalPapel.toFixed(2)}. Formulario: base {baseFormulario.toFixed(2)} + IVA {ivaFormulario.toFixed(2)} ={' '}
            {totalFormulario.toFixed(2)}.
          </p>
        </Aviso>
      )}

      {ampliada && (
        <Modal titulo="Foto de la factura" onCerrar={() => setAmpliada(false)} ancho="lg">
          <img src={foto} alt="Foto de la factura" className="w-full rounded-lg" />
        </Modal>
      )}
    </div>
  )
}

/** Muestra la foto guardada de una factura ya cargada. */
export function VerSoporte({ facturaId, onCerrar }: { facturaId: number; onCerrar: () => void }) {
  return (
    <Modal titulo="Foto de la factura" onCerrar={onCerrar} ancho="lg">
      <img src={api.urlSoporteFactura(facturaId)} alt="Foto de la factura" className="w-full rounded-lg" />
    </Modal>
  )
}
