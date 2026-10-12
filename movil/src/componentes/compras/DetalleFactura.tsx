import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { TEXTO_CONCEPTO } from '../../../../frontend/src/lib/compras'
import { unidadDe } from '../../../../frontend/src/lib/inventario'
import { ALMACEN_DE } from '../../../../frontend/src/lib/tiposArticulo'
import { apiCompras } from '../../lib/api-compras'
import { bajarSoporte, cant, diasVencida, facturaRecordada, fechaDe, olvidarFactura, recordarFactura, saldoDe, textoForma } from '../../lib/compras-app'
import { useCarga } from '../../lib/carga'
import { avisar, confirmar } from '../../lib/dialogo'
import { useMoneda } from '../../lib/moneda'
import { LETRA, useTema } from '../../lib/tema'
import type { FacturaCompra, NotaCreditoCompra } from '../../lib/tipos'
import { Barra } from '../Encabezado'
import { ListaFicha, Pastilla, Renglon, useDisposicion } from '../kit'
import { Aviso, Boton, Cargando, Cifra, Ficha, Fila, Nota, Pantalla, Problema, Titulo } from '../ui'
import { VistaDocumento, type DocumentoLeido } from './FacturaDesdeFoto'
import NotaCredito from './NotaCredito'
import PagarFactura from './PagarFactura'
import { mensajeDe, PuntoGasto, PuntoTipo } from './piezas'

/**
 * UNA FACTURA DE PROVEEDOR: lo que en la web es la fila desplegada de la
 * lista de Compras. Los renglones (de que almacen es cada uno y a donde fue
 * la plata), los datos del papel, como se pago, la foto o el PDF original, y
 * lo que se le puede hacer: pagarla si quedo a credito (entera o con
 * abonos), registrarle una nota de credito o anotar lo que no llego, y
 * borrarla con las mismas reglas de la web.
 *
 * El servidor no tiene "una factura por id": se pide la lista del dia de la
 * factura (o, si se llego sin ella, la de los ultimos cinco años) y se toma
 * la que es.
 */
export default function DetalleFactura() {
  const t = useTema()
  const { fmt } = useMoneda()
  const { tablet, alto } = useDisposicion()
  const { id: crudo } = useLocalSearchParams<{ id: string }>()
  const id = Number(crudo)
  const [pagando, setPagando] = useState(false)
  const [nota, setNota] = useState(false)
  const [aviso, setAviso] = useState('')
  const [soporte, setSoporte] = useState<DocumentoLeido | null>(null)
  const [bajando, setBajando] = useState(false)
  const [errorSoporte, setErrorSoporte] = useState('')

  const { datos, error, refrescando, refrescar } = useCarga(
    async () => {
      const conocida = facturaRecordada(id)
      const dia = conocida?.fecha.slice(0, 10)
      const lista = dia ? await apiCompras.facturas(dia, dia) : await apiCompras.facturasDeLosUltimos(1830)
      const f = lista.find((x) => x.id === id) ?? null
      if (f) recordarFactura(f)
      const notas = f ? await apiCompras.notasCredito(id).catch(() => [] as NotaCreditoCompra[]) : []
      return { f, notas }
    },
    120,
    String(id),
  )
  const f: FacturaCompra | null = datos?.f ?? facturaRecordada(id) ?? null
  const notas = datos?.notas ?? []

  async function verOriginal() {
    if (!f) return
    setErrorSoporte('')
    setBajando(true)
    try {
      setSoporte(await bajarSoporte(f.id))
    } catch (e) {
      setErrorSoporte(mensajeDe(e, 'No se pudo abrir'))
    } finally {
      setBajando(false)
    }
  }

  async function borrar() {
    if (!f) return
    if (f.items.length > 0) {
      await avisar('Esta factura no se puede borrar', 'Ya actualizó el stock de su mercancía. Si hubo un error, regístrale una nota de crédito.')
      return
    }
    // En la web se borra con unos segundos para deshacer; aqui se pregunta antes.
    if (!(await confirmar({ titulo: '¿Borrar la factura?', texto: `${f.numero_factura} de ${f.proveedor_nombre}, por ${fmt(f.total)}.`, aceptar: 'Borrar', peligro: true })))
      return
    try {
      await apiCompras.eliminarFactura(f.id)
      olvidarFactura(f.id)
      if (router.canGoBack()) router.back()
      else router.replace({ pathname: '/compras/[seccion]', params: { seccion: 'facturas' } })
    } catch (e) {
      await avisar('No se pudo borrar', mensajeDe(e, ''))
    }
  }

  const barra = <Barra titulo={f ? `Factura ${f.numero_factura}` : 'Factura'} />
  if (!f) {
    return (
      <Pantalla arriba={barra} refrescando={refrescando} alRefrescar={refrescar}>
        {error ? <Problema mensaje={error} alReintentar={refrescar} /> : datos ? <Problema mensaje="Esa factura no está: puede que la hayan borrado." /> : <Cargando />}
      </Pantalla>
    )
  }

  const gastos = f.gastos ?? []
  const aCredito = f.forma_pago === 'Credito'
  const dias = diasVencida(f)
  const vencida = aCredito && !f.pagada && dias !== null && dias > 0
  const reclamos = f.reclamos ?? []

  const cabeza = (
    <Ficha tono={vencida ? 'aviso' : undefined}>
      <Text style={[s.proveedor, { color: t.tinta }]}>{f.proveedor_nombre}</Text>
      <Nota>
        {fechaDe(f.fecha)} · <Text style={{ fontFamily: LETRA.cifra }}>{f.numero_factura}</Text>
      </Nota>
      <View style={{ marginTop: 10 }}>
        <Cifra tamano="media">{fmt(f.total)}</Cifra>
      </View>
      <Nota>
        base {fmt(f.base_imponible)} · IVA {fmt(f.iva)}
      </Nota>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {aCredito ? (
          <Pastilla texto={f.pagada ? 'Pagada' : vencida ? `Vencida hace ${dias} ${dias === 1 ? 'día' : 'días'}` : 'Por pagar'} tono={f.pagada ? 'bien' : vencida ? 'mal' : 'ojo'} />
        ) : (
          <Pastilla texto={f.forma_pago === 'Mixto' && f.pagos?.length ? f.pagos.map((p) => textoForma(p.forma_pago)).join(' + ') : textoForma(f.forma_pago)} />
        )}
        {f.tiene_soporte ? <Pastilla texto="Con foto" tono="acento" /> : null}
      </View>
      {aCredito && !f.pagada ? (
        <View style={{ marginTop: 14, gap: 8 }}>
          <Fila nombre="Se debe" valor={fmt(saldoDe(f))} fuerte />
          <Fila nombre="Vence" valor={f.fecha_vencimiento ? fechaDe(f.fecha_vencimiento) : 'Sin fecha de vencimiento'} texto ultima />
          <Boton texto={f.abonado ? 'Pagar el resto o abonar' : 'Pagar o abonar'} alTocar={() => setPagando(true)} />
        </View>
      ) : null}
    </Ficha>
  )

  const renglones = (
    <ListaFicha titulo="Qué trajo">
      {f.items.length === 0 && gastos.length === 0 ? (
        <Text style={[s.nota, { color: t.suave, paddingHorizontal: 16, paddingBottom: 10 }]}>{f.descripcion || 'Sin detalle.'}</Text>
      ) : null}
      {f.items.map((it, i) => (
        <Renglon
          key={it.id}
          titulo={it.ingrediente_nombre}
          detalle={
            <View style={s.linea}>
              <PuntoTipo tipo={it.tipo} tamano={8} />
              <Text style={[s.detalle, { color: t.suave, flexShrink: 1 }]}>
                {ALMACEN_DE[it.tipo].destino === 'gasto' ? 'a gasto' : 'al inventario'} · {cant(it.cantidad)} {unidadDe(it.cantidad, it.unidad)} × {fmt(it.costo_unitario)}
                {it.exento ? ' · exento' : ''}
              </Text>
            </View>
          }
          valor={fmt(it.subtotal)}
          ultima={i === f.items.length - 1 && gastos.length === 0}
        />
      ))}
      {gastos.map((g, i) => (
        <Renglon
          key={`g-${g.id}`}
          titulo={`${TEXTO_CONCEPTO[g.concepto]}${g.descripcion ? ` · ${g.descripcion}` : ''}`}
          detalle={
            <View style={s.linea}>
              <PuntoGasto tamano={8} />
              <Text style={[s.detalle, { color: t.suave }]}>
                {g.concepto === 'Equipo' ? 'a equipos' : 'a gasto'}
                {g.exento ? ' · exento' : ''}
              </Text>
            </View>
          }
          valor={fmt(g.monto)}
          ultima={i === gastos.length - 1}
        />
      ))}
      {f.recargo > 0 || f.descuento > 0 ? (
        <Text style={[s.nota, { color: t.tenue, paddingHorizontal: 16, paddingTop: 8 }]}>
          {f.recargo > 0 ? `+${fmt(f.recargo)} de recargo` : ''}
          {f.recargo > 0 && f.descuento > 0 ? ' · ' : ''}
          {f.descuento > 0 ? `−${fmt(f.descuento)} de descuento` : ''}
        </Text>
      ) : null}
    </ListaFicha>
  )

  const datosPapel = (
    <Ficha>
      <Titulo>Datos de la factura</Titulo>
      <View style={{ marginTop: 6 }}>
        <Fila nombre="RIF" valor={f.proveedor_rif || '—'} texto />
        {f.fecha_emision ? <Fila nombre="Emitida" valor={fechaDe(f.fecha_emision)} texto /> : null}
        {f.numero_control ? <Fila nombre="N.º de control" valor={f.numero_control} texto /> : null}
        <Fila nombre="Montos del papel en" valor={f.moneda === 'Bs' ? 'Bolívares' : 'Dólares'} texto />
        {f.tasa_bcv ? <Fila nombre="Tasa" valor={`${f.tasa_bcv.toFixed(2).replace('.', ',')} Bs por $`} texto /> : null}
        <Fila nombre="Pago" valor={aCredito ? 'A crédito' : textoForma(f.forma_pago)} texto />
        {f.pagos?.map((p) => <Fila key={p.id} nombre={`· ${textoForma(p.forma_pago)}${p.referencia ? ` (ref. ${p.referencia})` : ''}`} valor={fmt(p.monto)} />)}
        {f.referencia_pago ? <Fila nombre="Referencia" valor={f.referencia_pago} texto /> : null}
        {f.iva_retenido > 0 ? <Fila nombre={`IVA retenido (${f.retencion_pct} %)`} valor={fmt(f.iva_retenido)} /> : null}
        {f.iva_retenido > 0 ? <Fila nombre="Al proveedor" valor={fmt(f.a_pagar)} /> : null}
        {f.abonado ? <Fila nombre="Abonado" valor={fmt(f.abonado)} /> : null}
        {f.descripcion && (f.items.length > 0 || gastos.length > 0) ? <Fila nombre="Nota" valor={f.descripcion} texto /> : null}
        <Fila nombre="Total" valor={fmt(f.total)} fuerte ultima />
      </View>
      {f.abonos && f.abonos.length > 0 ? (
        <View style={{ marginTop: 12 }}>
          <Text style={[s.etiqueta, { color: t.tenue }]}>Abonos</Text>
          {f.abonos.map((a, i) => (
            <Fila
              key={a.id}
              nombre={`${fechaDe(a.fecha)} · ${textoForma(a.forma_pago)}${a.referencia ? ` · ref. ${a.referencia}` : ''}`}
              valor={fmt(a.monto)}
              ultima={i === f.abonos!.length - 1}
            />
          ))}
        </View>
      ) : null}
    </Ficha>
  )

  const extras = (
    <>
      {reclamos.length > 0 ? (
        <Ficha tono="aviso">
          <Titulo>Lo que no llegó</Titulo>
          <Nota>El proveedor lo debe hasta que mande su nota de crédito.</Nota>
          {reclamos.map((r, i) => (
            <Fila key={r.id} nombre={`${cant(r.cantidad)} ${unidadDe(r.cantidad, r.unidad)} de ${r.ingrediente_nombre}${r.motivo ? ` · ${r.motivo}` : ''}`} valor={fmt(r.valor)} ultima={i === reclamos.length - 1} />
          ))}
        </Ficha>
      ) : null}
      {notas.length > 0 ? (
        <ListaFicha titulo="Notas de crédito">
          {notas.map((n, i) => (
            <Renglon
              key={n.id}
              titulo={`N.º ${n.numero}`}
              detalle={`${fechaDe(n.fecha)} · ${n.tipo === 'devolucion' ? 'Devolución' : n.tipo === 'descuento' ? 'Descuento' : 'Por lo que faltó'}${n.motivo ? ` · ${n.motivo}` : ''}`}
              valor={`−${fmt(n.total)}`}
              ultima={i === notas.length - 1}
            />
          ))}
        </ListaFicha>
      ) : null}
      {f.tiene_soporte ? (
        soporte ? (
          <VistaDocumento doc={soporte} altoMaximo={alto * 0.7} titulo="Factura del proveedor" />
        ) : (
          <View style={{ gap: 8 }}>
            <Boton texto="Ver el original" icono="imagen" tono="neutro" alTocar={() => void verOriginal()} ocupado={bajando} />
            {errorSoporte ? <Problema mensaje={errorSoporte} /> : null}
          </View>
        )
      ) : null}
      <Boton texto="Nota de crédito" icono="factura" tono="neutro" alTocar={() => setNota(true)} />
      <Nota style={{ textAlign: 'center' }}>El proveedor mandó menos, o te dio un descuento.</Nota>
      {/* Lo que destruye va aparte y se ve distinto. */}
      <View style={{ marginTop: 18 }}>
        <Boton texto="Borrar" icono="quitar" tono="peligro" alTocar={() => void borrar()} />
      </View>
    </>
  )

  return (
    <Pantalla arriba={barra} refrescando={refrescando} alRefrescar={refrescar}>
      {aviso ? <Aviso texto={aviso} /> : null}
      {tablet ? (
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
          <View style={{ flex: 1, gap: 12 }}>
            {cabeza}
            {renglones}
            {datosPapel}
          </View>
          <View style={{ flex: 1, gap: 12 }}>{extras}</View>
        </View>
      ) : (
        <>
          {cabeza}
          {renglones}
          {datosPapel}
          {extras}
        </>
      )}
      <PagarFactura
        factura={pagando ? f : null}
        alCerrar={() => setPagando(false)}
        alPagar={(nueva, texto) => {
          recordarFactura(nueva)
          setPagando(false)
          setAviso(texto)
          refrescar()
        }}
      />
      <NotaCredito
        factura={nota ? f : null}
        alCerrar={() => setNota(false)}
        alTerminar={(texto) => {
          setNota(false)
          setAviso(texto)
          refrescar()
        }}
      />
    </Pantalla>
  )
}

const s = StyleSheet.create({
  proveedor: { fontFamily: LETRA.tituloFuerte, fontSize: 21, letterSpacing: -0.4 },
  nota: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
  detalle: { fontFamily: LETRA.texto, fontSize: 13 },
  linea: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  etiqueta: { fontFamily: LETRA.textoFuerte, fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase', marginBottom: 4 },
})
