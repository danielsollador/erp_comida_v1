import { useMemo, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { apiImpuestos, descargasImpuestos } from '../../lib/api-impuestos'
import { useCarga } from '../../lib/carga'
import { avisar, confirmar } from '../../lib/dialogo'
import { miles } from '../../lib/formato'
import { useTema } from '../../lib/tema'
import type { FilaLibroVentas } from '../../lib/tipos'
import { usePedir } from '../contabilidad/dialogos'
import type { PeriodoContable } from '../contabilidad/periodo'
import { fechaVE, hoyISO, mensajeDe, useRefrescoDeSeccion, VerMas } from '../contabilidad/piezas'
import { Hoja, OpcionHoja } from '../Hoja'
import { Buscador, FilaFiltros, ListaFicha, llano, Renglon, Selector, useDisposicion } from '../kit'
import { Aviso, Cargando, Ficha, Fila, Nota, Problema } from '../ui'
import { bs, Descargas, tramoDeArchivo } from './piezas'

type Orden = 'fecha' | 'factura' | 'cliente' | 'base' | 'iva' | 'total'

const ORDENES: { valor: Orden; texto: string }[] = [
  { valor: 'fecha', texto: 'Fecha' },
  { valor: 'factura', texto: 'Documento' },
  { valor: 'cliente', texto: 'Cliente' },
  { valor: 'base', texto: 'Base Bs, mayor primero' },
  { valor: 'iva', texto: 'IVA Bs, mayor primero' },
  { valor: 'total', texto: 'Total Bs, mayor primero' },
]

function ordenar(filas: FilaLibroVentas[], orden: Orden): FilaLibroVentas[] {
  const n = (x: number | null) => x ?? -Infinity
  const copia = [...filas]
  switch (orden) {
    case 'fecha':
      return copia.sort((a, b) => a.fecha.localeCompare(b.fecha))
    case 'factura':
      return copia.sort((a, b) => a.numero_factura.localeCompare(b.numero_factura))
    case 'cliente':
      return copia.sort((a, b) => a.cliente.localeCompare(b.cliente))
    case 'base':
      return copia.sort((a, b) => n(b.gravado_bs) - n(a.gravado_bs))
    case 'iva':
      return copia.sort((a, b) => n(b.iva_bs) - n(a.iva_bs))
    default:
      return copia.sort((a, b) => n(b.total_bs) - n(a.total_bs))
  }
}

/** Como se nombra el documento de una fila: la factura, la nota de credito o la retencion. */
function documento(f: FilaLibroVentas): string {
  if (f.tipo === 'NC') return `NC ${f.numero_nota} · afecta ${f.factura_afectada}`
  if (f.tipo === 'RET') return `Retención · factura ${f.factura_afectada}`
  return f.numero_factura
}

/** Esperar a que una hoja termine de bajar antes de subir otra (en iPhone, dos a la vez se pisan). */
const luego = (fn: () => void) => setTimeout(fn, 380)

/**
 * EL LIBRO DE VENTAS DEL PERIODO, en bolivares, como se declara. En el
 * telefono cada factura es un renglon (cliente, documento y total en Bs); al
 * tocarlo se ve el resto de las columnas de la web y lo que se puede hacer:
 * cargar o cambiar la tasa, y la retencion que entrego el cliente.
 */
export default function LibroVentas({ periodo, alCambiar }: { periodo: PeriodoContable; alCambiar: () => void }) {
  const t = useTema()
  const { tablet } = useDisposicion()
  const clave = `${periodo.desde}|${periodo.hasta}`
  const { datos, error, refrescando, refrescar } = useCarga(
    () => apiImpuestos.libroVentas(periodo.desde, periodo.hasta).then((libro) => ({ libro, clave })),
    300,
    clave,
  )
  useRefrescoDeSeccion(refrescando, refrescar)
  const { pedir, hoja } = usePedir()
  const [buscar, setBuscar] = useState('')
  const [orden, setOrden] = useState<Orden>('fecha')
  const [ver, setVer] = useState(50)
  const [elegida, setElegida] = useState<FilaLibroVentas | null>(null)

  const libro = datos?.libro ?? null
  const visibles = useMemo(() => {
    const q = llano(buscar.trim())
    const filas = (libro?.filas ?? []).filter((f) => !q || llano(`${f.numero_factura} ${f.cliente}`).includes(q))
    return ordenar(filas, orden)
  }, [libro, buscar, orden])

  function recargar() {
    refrescar()
    alCambiar()
  }

  // La tasa de un documento del libro: propone la que tiene, o la BCV del dia
  // del documento si no tiene; se puede cambiar por la que diga el papel.
  async function editarTasa(f: FilaLibroVentas) {
    const fecha = f.fecha.slice(0, 10)
    let propuesta = f.tasa_bcv
    if (propuesta === null) propuesta = (await apiImpuestos.tasaDeFecha(fecha).catch(() => null))?.bcv ?? null
    const r = await pedir({
      titulo: 'Tasa de cambio del documento',
      texto: `Bs por dólar con que pasa al libro. Por defecto, la BCV del ${fechaVE(fecha)}; cámbiala si el papel dice otra.`,
      campos: [{ nombre: 'tasa', etiqueta: 'Tasa (Bs por $)', tipo: 'numero', valor: propuesta === null ? '' : String(propuesta) }],
      aceptar: 'Guardar',
    })
    if (!r) return
    try {
      await apiImpuestos.cambiarTasaVenta(f.pedido_id, Number(r.tasa))
      recargar()
    } catch (e) {
      await avisar('No se pudo cambiar la tasa', mensajeDe(e, 'Intenta de nuevo.'))
    }
  }

  // El comprobante de retencion que entrega un cliente contribuyente
  // especial: casi siempre el 75 % del IVA, a veces dias despues de la factura.
  async function registrarRetencion(f: FilaLibroVentas) {
    const r = await pedir({
      titulo: `Retención de IVA de la factura ${f.numero_factura}`,
      texto: `${f.cliente}${f.rif ? ` (${f.rif})` : ''}. Los datos salen del comprobante que entregó el cliente.`,
      campos: [
        { nombre: 'comprobante', etiqueta: 'N.º de comprobante (14 dígitos)', placeholder: 'AAAAMM00000000', soloCifras: true },
        { nombre: 'fecha', etiqueta: 'Fecha del comprobante (AAAA-MM-DD)', tipo: 'fecha', valor: hoyISO() },
        {
          nombre: 'monto',
          etiqueta: 'IVA retenido (Bs)',
          tipo: 'numero',
          valor:
            f.retencion_pendiente_bs !== null
              ? f.retencion_pendiente_bs.toFixed(2)
              : f.iva_bs === null
                ? ''
                : (f.iva_bs * 0.75).toFixed(2),
        },
      ],
      aceptar: 'Registrar',
    })
    if (!r) return
    try {
      await apiImpuestos.registrarRetencionRecibida(f.pedido_id, { comprobante: r.comprobante, fecha: r.fecha, monto_bs: Number(r.monto) })
      recargar()
    } catch (e) {
      await avisar('No se pudo registrar', mensajeDe(e, 'Intenta de nuevo.'))
    }
  }

  async function quitarRetencion(f: FilaLibroVentas) {
    if (!(await confirmar({ titulo: '¿Quitar la retención?', texto: 'Deja de descontarse en la declaración.', aceptar: 'Quitar', peligro: true })))
      return
    try {
      await apiImpuestos.quitarRetencionRecibida(f.pedido_id)
      recargar()
    } catch (e) {
      await avisar('No se pudo quitar', mensajeDe(e, 'Intenta de nuevo.'))
    }
  }

  const tramo = tramoDeArchivo(periodo.desde, periodo.hasta)

  return (
    <>
      <Descargas
        seniat={{ ruta: descargasImpuestos.libroVentasSeniat(periodo.desde, periodo.hasta), nombre: `libro-de-ventas-seniat-${tramo}.xlsx` }}
        csv={{ ruta: descargasImpuestos.libroVentasCsv(periodo.desde, periodo.hasta), nombre: `libro-de-ventas-${tramo}.csv` }}
      />
      <Nota>Montos en bolívares, como se declaran: cada venta a la tasa BCV del momento en que se cobró.</Nota>
      {libro && libro.sin_tasa > 0 ? (
        <Aviso
          tono="aviso"
          texto={`${libro.sin_tasa === 1 ? 'Una venta no tiene' : `${libro.sin_tasa} ventas no tienen`} monto en bolívares: no hay tasa guardada para su fecha. Cárgala con «cargar tasa» en su renglón: hasta entonces salen vacías y el mes no se puede declarar.`}
        />
      ) : null}
      <FilaFiltros>
        <Selector<Orden> etiqueta="Ordenar" titulo="Ordenar el libro" opciones={ORDENES} valor={orden} alCambiar={setOrden} />
      </FilaFiltros>
      <Buscador valor={buscar} alCambiar={setBuscar} placeholder="Buscar por número de factura o cliente…" />

      {error && !libro ? <Problema mensaje={error} alReintentar={refrescar} /> : null}
      {!libro && !error ? <Cargando /> : null}
      {libro ? (
        <View style={{ opacity: datos?.clave === clave ? 1 : 0.55 }}>
          <ListaFicha titulo={libro.etiqueta}>
            {visibles.slice(0, ver).map((f, i) => (
              <Renglon
                key={`${f.tipo}-${f.pedido_id}-${f.numero_nota}`}
                titulo={f.cliente || 'Sin nombre'}
                detalle={`${documento(f)} · ${fechaVE(f.fecha)}`}
                valor={f.total_bs === null ? 'sin tasa' : `Bs ${bs(f.total_bs)}`}
                colorValor={f.total_bs === null ? t.aviso : undefined}
                subvalor={
                  f.iva_retenido_bs !== null
                    ? `retenido ${bs(f.iva_retenido_bs)}`
                    : f.retencion_pendiente_bs !== null
                      ? 'falta comprobante'
                      : `IVA ${bs(f.iva_bs)}`
                }
                alTocar={() => setElegida(f)}
                ultima={i === Math.min(ver, visibles.length) - 1}
              />
            ))}
            {libro.filas.length === 0 ? <Nota style={{ padding: 16 }}>Sin ventas facturadas en este período.</Nota> : null}
            {libro.filas.length > 0 && visibles.length === 0 ? <Nota style={{ padding: 16 }}>Nada coincide con la búsqueda.</Nota> : null}
          </ListaFicha>
        </View>
      ) : null}
      <VerMas quedan={visibles.length - ver} alTocar={() => setVer((v) => v + 50)} />

      {libro && libro.filas.length > 0 ? (
        <Ficha style={tablet ? { flexDirection: 'row', gap: 24 } : undefined}>
          <View style={{ flex: 1 }}>
            <Fila nombre="Base Bs" valor={bs(libro.total_gravado_bs)} />
            <Fila nombre="IVA Bs" valor={bs(libro.total_iva_bs)} />
            <Fila nombre="Total Bs" valor={bs(libro.total_bs)} fuerte />
          </View>
          <View style={{ flex: 1 }}>
            <Fila nombre="Total en dólares" valor={`$${miles(libro.total_general)}`} />
            <Fila nombre="Retenido Bs" valor={bs(libro.total_retenido_bs)} ultima />
          </View>
        </Ficha>
      ) : null}

      <DetalleVenta
        fila={elegida}
        alCerrar={() => setElegida(null)}
        alTasa={(f) => {
          setElegida(null)
          luego(() => void editarTasa(f))
        }}
        alRetencion={(f) => {
          setElegida(null)
          luego(() => void registrarRetencion(f))
        }}
        alQuitar={(f) => {
          setElegida(null)
          luego(() => void quitarRetencion(f))
        }}
      />
      {hoja}
    </>
  )
}

/** Las columnas de la web que no caben en el renglon, y lo que se hace con esa venta. */
function DetalleVenta({
  fila: f,
  alCerrar,
  alTasa,
  alRetencion,
  alQuitar,
}: {
  fila: FilaLibroVentas | null
  alCerrar: () => void
  alTasa: (f: FilaLibroVentas) => void
  alRetencion: (f: FilaLibroVentas) => void
  alQuitar: (f: FilaLibroVentas) => void
}) {
  const { alto } = useDisposicion()
  return (
    <Hoja visible={f !== null} alCerrar={alCerrar} titulo={f ? (f.tipo === 'FAC' ? `Factura ${f.numero_factura}` : documento(f)) : undefined}>
      {f ? (
        <ScrollView style={{ maxHeight: alto * 0.7 }}>
          <View style={{ paddingHorizontal: 12 }}>
            <Fila nombre="Fecha" valor={fechaVE(f.fecha)} texto />
            <Fila nombre="Cliente" valor={`${f.cliente}${f.rif ? ` (${f.rif})` : ''}`} texto />
            <Fila nombre="Base Bs" valor={bs(f.gravado_bs)} />
            <Fila nombre="IVA Bs" valor={bs(f.iva_bs)} />
            <Fila nombre="Total Bs" valor={f.total_bs === null ? 'sin tasa' : bs(f.total_bs)} fuerte />
            <Fila nombre="Tasa" valor={f.tasa_bcv === null ? 'sin tasa' : miles(f.tasa_bcv)} />
            <Fila nombre="Total en dólares" valor={`$${miles(f.total)}`} />
            {f.iva_retenido_bs !== null ? (
              <>
                <Fila nombre="Retenido Bs" valor={bs(f.iva_retenido_bs)} fuerte />
                <Fila nombre="Comprobante" valor={f.comprobante_retencion || '-'} />
              </>
            ) : f.retencion_pendiente_bs !== null ? (
              <Fila nombre="Retenido en caja" valor={bs(f.retencion_pendiente_bs)} />
            ) : null}
          </View>
          <OpcionHoja texto={f.tasa_bcv === null ? 'Cargar tasa' : 'Cambiar la tasa'} detalle="La BCV de su fecha, o la que diga el papel." alTocar={() => alTasa(f)} />
          {f.iva_retenido_bs !== null ? (
            <OpcionHoja texto="Quitar la retención" detalle="Deja de descontarse en la declaración." peligro alTocar={() => alQuitar(f)} />
          ) : f.retencion_pendiente_bs !== null ? (
            <OpcionHoja texto="Cargar comprobante" detalle="Se retuvo al cobrar; falta el comprobante del cliente." alTocar={() => alRetencion(f)} />
          ) : f.tipo === 'FAC' && f.iva_bs !== null ? (
            <OpcionHoja texto="+ retención" detalle="El comprobante de un cliente contribuyente especial." alTocar={() => alRetencion(f)} />
          ) : null}
        </ScrollView>
      ) : null}
    </Hoja>
  )
}
