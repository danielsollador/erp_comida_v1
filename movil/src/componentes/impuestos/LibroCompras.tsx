import { useMemo, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { apiImpuestos, descargasImpuestos } from '../../lib/api-impuestos'
import { useCarga } from '../../lib/carga'
import { avisar } from '../../lib/dialogo'
import { miles } from '../../lib/formato'
import { useTema } from '../../lib/tema'
import type { FilaLibroCompras } from '../../lib/tipos'
import { usePedir } from '../contabilidad/dialogos'
import type { PeriodoContable } from '../contabilidad/periodo'
import { fechaVE, mensajeDe, useRefrescoDeSeccion, VerMas } from '../contabilidad/piezas'
import { Hoja, OpcionHoja } from '../Hoja'
import { Buscador, FilaFiltros, ListaFicha, llano, Renglon, Selector, useDisposicion } from '../kit'
import { Aviso, Cargando, Ficha, Fila, Nota, Problema } from '../ui'
import { bs, Descargas, tramoDeArchivo } from './piezas'

type Orden = 'fecha' | 'emision' | 'factura' | 'proveedor' | 'rif' | 'exento' | 'base' | 'iva' | 'total'

const ORDENES: { valor: Orden; texto: string }[] = [
  { valor: 'fecha', texto: 'Registro' },
  { valor: 'emision', texto: 'Fecha del documento' },
  { valor: 'factura', texto: 'Documento' },
  { valor: 'proveedor', texto: 'Proveedor' },
  { valor: 'rif', texto: 'RIF' },
  { valor: 'exento', texto: 'Exento Bs, mayor primero' },
  { valor: 'base', texto: 'Base Bs, mayor primero' },
  { valor: 'iva', texto: 'IVA Bs, mayor primero' },
  { valor: 'total', texto: 'Total Bs, mayor primero' },
]

function ordenar(filas: FilaLibroCompras[], orden: Orden): FilaLibroCompras[] {
  const n = (x: number | null) => x ?? -Infinity
  const copia = [...filas]
  switch (orden) {
    case 'fecha':
      return copia.sort((a, b) => a.fecha.localeCompare(b.fecha))
    case 'emision':
      return copia.sort((a, b) => a.fecha_emision.localeCompare(b.fecha_emision))
    case 'factura':
      return copia.sort((a, b) => a.numero_factura.localeCompare(b.numero_factura))
    case 'proveedor':
      return copia.sort((a, b) => a.proveedor_nombre.localeCompare(b.proveedor_nombre))
    case 'rif':
      return copia.sort((a, b) => (a.proveedor_rif ?? '').localeCompare(b.proveedor_rif ?? ''))
    case 'exento':
      return copia.sort((a, b) => n(b.exento_bs) - n(a.exento_bs))
    case 'base':
      return copia.sort((a, b) => n(b.gravado_bs) - n(a.gravado_bs))
    case 'iva':
      return copia.sort((a, b) => n(b.iva_bs) - n(a.iva_bs))
    default:
      return copia.sort((a, b) => n(b.total_bs) - n(a.total_bs))
  }
}

function documento(f: FilaLibroCompras): string {
  if (f.tipo === 'NC') return `NC ${f.numero_nota} · afecta ${f.factura_afectada}`
  return f.numero_control ? `${f.numero_factura} · control ${f.numero_control}` : f.numero_factura
}

/** Una factura en Bs con su tasa del papel no se toca: van al libro los Bs del papel. */
const tasaEditable = (f: FilaLibroCompras) => !(f.moneda === 'Bs' && !f.tasa_estimada)

const luego = (fn: () => void) => setTimeout(fn, 380)

/**
 * EL LIBRO DE COMPRAS DEL PERIODO, en bolivares: las facturas en Bs tal cual
 * el papel, y las de dolares a la tasa BCV de su fecha (o la que imprime la
 * factura). Cada factura es un renglon; al tocarla, las demas columnas de la
 * web y cargar o cambiar su tasa.
 */
export default function LibroCompras({ periodo, alCambiar }: { periodo: PeriodoContable; alCambiar: () => void }) {
  const t = useTema()
  const { tablet } = useDisposicion()
  const clave = `${periodo.desde}|${periodo.hasta}`
  const { datos, error, refrescando, refrescar } = useCarga(
    () => apiImpuestos.libroCompras(periodo.desde, periodo.hasta).then((libro) => ({ libro, clave })),
    300,
    clave,
  )
  useRefrescoDeSeccion(refrescando, refrescar)
  const { pedir, hoja } = usePedir()
  const [buscar, setBuscar] = useState('')
  const [orden, setOrden] = useState<Orden>('fecha')
  const [ver, setVer] = useState(50)
  const [elegida, setElegida] = useState<FilaLibroCompras | null>(null)

  const libro = datos?.libro ?? null
  const visibles = useMemo(() => {
    const q = llano(buscar.trim())
    const filas = (libro?.filas ?? []).filter((f) => !q || llano(`${f.numero_factura} ${f.proveedor_nombre}`).includes(q))
    return ordenar(filas, orden)
  }, [libro, buscar, orden])

  async function editarTasa(f: FilaLibroCompras) {
    let propuesta = f.tasa_bcv
    if (propuesta === null) propuesta = (await apiImpuestos.tasaDeFecha(f.fecha_emision).catch(() => null))?.bcv ?? null
    const r = await pedir({
      titulo: 'Tasa de cambio del documento',
      texto: `Bs por dólar con que pasa al libro. Por defecto, la BCV del ${fechaVE(f.fecha_emision)}; cámbiala si el papel dice otra.`,
      campos: [{ nombre: 'tasa', etiqueta: 'Tasa (Bs por $)', tipo: 'numero', valor: propuesta === null ? '' : String(propuesta) }],
      aceptar: 'Guardar',
    })
    if (!r) return
    try {
      await apiImpuestos.cambiarTasaCompra(f.factura_id, Number(r.tasa))
      refrescar()
      alCambiar()
    } catch (e) {
      await avisar('No se pudo cambiar la tasa', mensajeDe(e, 'Intenta de nuevo.'))
    }
  }

  const tramo = tramoDeArchivo(periodo.desde, periodo.hasta)

  return (
    <>
      <Descargas
        seniat={{ ruta: descargasImpuestos.libroComprasSeniat(periodo.desde, periodo.hasta), nombre: `libro-de-compras-seniat-${tramo}.xlsx` }}
        csv={{ ruta: descargasImpuestos.libroComprasCsv(periodo.desde, periodo.hasta), nombre: `libro-de-compras-${tramo}.csv` }}
      />
      <Nota>
        Montos en bolívares, como se declaran: los de las facturas en Bs tal cual el papel, y los de las facturas en dólares a
        la tasa BCV de su fecha (o la que imprime la factura).
      </Nota>
      {libro && libro.sin_tasa > 0 ? (
        <Aviso
          tono="aviso"
          texto={`${libro.sin_tasa === 1 ? 'Una factura no tiene' : `${libro.sin_tasa} facturas no tienen`} monto en bolívares: no hay tasa guardada para su fecha. Cárgala con «cargar tasa» en su renglón: hasta entonces salen vacías y el mes no se puede declarar.`}
        />
      ) : null}
      <FilaFiltros>
        <Selector<Orden> etiqueta="Ordenar" titulo="Ordenar el libro" opciones={ORDENES} valor={orden} alCambiar={setOrden} />
      </FilaFiltros>
      <Buscador valor={buscar} alCambiar={setBuscar} placeholder="Buscar por número de factura o proveedor…" />

      {error && !libro ? <Problema mensaje={error} alReintentar={refrescar} /> : null}
      {!libro && !error ? <Cargando /> : null}
      {libro ? (
        <View style={{ opacity: datos?.clave === clave ? 1 : 0.55 }}>
          <ListaFicha titulo={libro.etiqueta}>
            {visibles.slice(0, ver).map((f, i) => (
              <Renglon
                key={`${f.tipo}-${f.factura_id}-${f.numero_nota}`}
                titulo={f.proveedor_nombre}
                detalle={`${documento(f)} · ${fechaVE(f.fecha_emision)}`}
                valor={f.total_bs === null ? 'sin tasa' : `Bs ${bs(f.total_bs)}`}
                colorValor={f.total_bs === null ? t.aviso : undefined}
                subvalor={f.moneda === 'Bs' ? 'factura en Bs' : `$${miles(f.total)}`}
                alTocar={() => setElegida(f)}
                ultima={i === Math.min(ver, visibles.length) - 1}
              />
            ))}
            {libro.filas.length === 0 ? <Nota style={{ padding: 16 }}>Sin facturas de compra en este período.</Nota> : null}
            {libro.filas.length > 0 && visibles.length === 0 ? <Nota style={{ padding: 16 }}>Nada coincide con la búsqueda.</Nota> : null}
          </ListaFicha>
        </View>
      ) : null}
      <VerMas quedan={visibles.length - ver} alTocar={() => setVer((v) => v + 50)} />

      {libro && libro.filas.length > 0 ? (
        <Ficha style={tablet ? { flexDirection: 'row', gap: 24 } : undefined}>
          <View style={{ flex: 1 }}>
            <Fila nombre="Exento Bs" valor={bs(libro.total_exento_bs)} />
            <Fila nombre="Base Bs" valor={bs(libro.total_gravado_bs)} />
            <Fila nombre="IVA Bs" valor={bs(libro.total_iva_bs)} />
          </View>
          <View style={{ flex: 1 }}>
            <Fila nombre="Total Bs" valor={bs(libro.total_bs)} fuerte />
            <Fila nombre="Total en dólares" valor={`$${miles(libro.total_general)}`} ultima />
          </View>
        </Ficha>
      ) : null}

      <DetalleCompra
        fila={elegida}
        alCerrar={() => setElegida(null)}
        alTasa={(f) => {
          setElegida(null)
          luego(() => void editarTasa(f))
        }}
      />
      {hoja}
    </>
  )
}

function DetalleCompra({
  fila: f,
  alCerrar,
  alTasa,
}: {
  fila: FilaLibroCompras | null
  alCerrar: () => void
  alTasa: (f: FilaLibroCompras) => void
}) {
  const { alto } = useDisposicion()
  return (
    <Hoja visible={f !== null} alCerrar={alCerrar} titulo={f ? (f.tipo === 'NC' ? `NC ${f.numero_nota}` : `Factura ${f.numero_factura}`) : undefined}>
      {f ? (
        <ScrollView style={{ maxHeight: alto * 0.7 }}>
          <View style={{ paddingHorizontal: 12 }}>
            <Fila nombre="Fecha doc." valor={fechaVE(f.fecha_emision)} texto />
            <Fila nombre="Registro" valor={fechaVE(f.fecha)} texto />
            <Fila nombre="Documento" valor={documento(f)} texto />
            <Fila nombre="Proveedor" valor={f.proveedor_nombre} texto />
            <Fila nombre="RIF" valor={f.proveedor_rif || '-'} texto />
            <Fila nombre="Exento Bs" valor={bs(f.exento_bs)} />
            <Fila nombre="Base Bs" valor={bs(f.gravado_bs)} />
            <Fila nombre="IVA Bs" valor={bs(f.iva_bs)} />
            <Fila nombre="Total Bs" valor={f.total_bs === null ? 'sin tasa' : bs(f.total_bs)} fuerte />
            <Fila
              nombre="Tasa"
              valor={`${f.tasa_bcv === null ? 'sin tasa' : miles(f.tasa_bcv)}${f.tasa_estimada && f.tasa_bcv !== null ? ' · de su fecha' : ''}`}
            />
            <Fila nombre={f.moneda === 'Bs' ? 'Moneda' : 'Total en dólares'} valor={f.moneda === 'Bs' ? 'factura en Bs' : `$${miles(f.total)}`} ultima />
          </View>
          {tasaEditable(f) ? (
            <OpcionHoja texto={f.tasa_bcv === null ? 'Cargar tasa' : 'Cambiar la tasa'} detalle="La BCV de su fecha, o la que diga el papel." alTocar={() => alTasa(f)} />
          ) : null}
        </ScrollView>
      ) : null}
    </Hoja>
  )
}
