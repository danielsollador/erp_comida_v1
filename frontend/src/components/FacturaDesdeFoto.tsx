import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { achicarFoto } from '../lib/foto'
import type {
  AvisoPrecio,
  Equivalencia,
  LecturaFactura,
  Proveedor,
  RenglonLeido,
  RevisionFactura,
  SugerenciaRenglon,
} from '../lib/types'
import { Aviso, Boton, Modal, Vacio } from './ui'

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
/** "1 BULTO = 20 kg", o nada si es uno a uno. */
function conversion(factor: number, unidadPapel: string, unidad: string): string {
  if (Math.abs(factor - 1) < 1e-9) return ''
  return `1 ${unidadPapel || 'unidad del papel'} = ${Number(factor.toFixed(4))} ${unidad}`
}

export function RenglonDelPapel({
  leido,
  moneda,
  unidadNuestra,
  aviso,
  recordada,
}: {
  leido?: RenglonLeido
  moneda: string
  unidadNuestra?: string
  aviso?: AvisoPrecio
  /** Solo si sigue elegida la mercancía que se recordó. */
  recordada?: SugerenciaRenglon
}) {
  if (!leido && !aviso) return null
  const conv = recordada ? conversion(recordada.factor, recordada.unidad_papel, recordada.unidad) : ''
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
      {recordada && (
        <p className="text-exito-700">
          Recordado de este proveedor{conv ? `: ${conv}, ya convertido` : ''} ·{' '}
          {recordada.veces === 1 ? '1 factura' : `${recordada.veces} facturas`}
          {!recordada.exacta && (
            <span className="text-aviso-700"> · parecido a «{recordada.descripcion_recordada}», revísalo</span>
          )}
        </p>
      )}
      {leido && !recordada && unidadDistinta(leido.unidad, unidadNuestra) && (
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

/**
 * Lo que el sistema recuerda de las facturas de cada proveedor. Olvidar una
 * asociación mal aprendida es seguro: la próxima factura la vuelve a aprender
 * de lo que quede guardado.
 */
export function MemoriaProveedores({ proveedores }: { proveedores: Proveedor[] }) {
  const [filas, setFilas] = useState<Equivalencia[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api
      .listarEquivalencias()
      .then(setFilas)
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudo cargar'))
  }, [])

  const soloRif = (x: string) => x.toUpperCase().replace(/[^0-9A-Z]/g, '')
  // La ficha manda; sin ficha, como venia en la ultima factura.
  const nombreDe = (e: Equivalencia) =>
    proveedores.find((p) => p.rif && soloRif(p.rif) === e.proveedor_rif)?.nombre || e.proveedor_nombre || e.proveedor_rif

  async function olvidar(e: Equivalencia) {
    setError('')
    try {
      await api.olvidarEquivalencia(e.id)
      setFilas((prev) => (prev ?? []).filter((x) => x.id !== e.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo olvidar')
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 mt-4">
      <h2 className="font-semibold">Lo que se recuerda de sus facturas</h2>
      <p className="text-xs text-neutral-500 mb-3">
        Se aprende al guardar una factura cargada desde foto: qué mercancía es cada renglón y cómo se convierte su
        unidad. La próxima factura de ese proveedor llega con esos renglones ya asociados.
      </p>
      {error && <p className="text-peligro-600 text-sm mb-2">{error}</p>}
      {filas !== null && filas.length === 0 ? (
        <Vacio titulo="Todavía no se recuerda nada" detalle="Carga una factura desde foto y guárdala." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
              <tr>
                <th className="p-2 text-left">Proveedor</th>
                <th className="p-2 text-left">En su factura</th>
                <th className="p-2 text-left">Es</th>
                <th className="p-2 text-left">Conversión</th>
                <th className="p-2 text-right">Facturas</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {(filas ?? []).map((e) => (
                <tr key={e.id} className="border-t border-neutral-100">
                  <td className="p-2">{nombreDe(e)}</td>
                  <td className="p-2 font-mono text-xs">{e.descripcion}</td>
                  <td className="p-2">
                    {e.ingrediente_nombre} <span className="text-neutral-400">({e.unidad})</span>
                  </td>
                  <td className="p-2 text-neutral-500">{conversion(e.factor, e.unidad_papel, e.unidad) || '—'}</td>
                  <td className="p-2 text-right tabular-nums">{e.veces}</td>
                  <td className="p-2 text-right">
                    <button onClick={() => olvidar(e)} className="text-xs text-neutral-500 font-medium">
                      Olvidar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
