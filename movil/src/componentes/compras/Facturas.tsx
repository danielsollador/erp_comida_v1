import { router } from 'expo-router'
import { useMemo, useState, type ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { TEXTO_CATEGORIA, TEXTO_CONCEPTO } from '../../../../frontend/src/lib/compras'
import { palabrasDe } from '../../../../frontend/src/lib/parecidos'
import { unidadDe } from '../../../../frontend/src/lib/inventario'
import { ALMACEN_DE } from '../../../../frontend/src/lib/tiposArticulo'
import { apiCompras } from '../../lib/api-compras'
import { cant, diasVencida, fechaDe, recordarFactura, recordarFacturas, saldoDe } from '../../lib/compras-app'
import { useCarga } from '../../lib/carga'
import { confirmar, avisar } from '../../lib/dialogo'
import { useMoneda } from '../../lib/moneda'
import { periodoDe, type Periodo } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import type { FacturaCompra, Reclamo, TipoArticulo } from '../../lib/tipos'
import { Buscador, ElegirPeriodo, FilaFiltros, Kpi, ListaFicha, Pastilla, PantallaLista, Renglon, Selector, useDisposicion, Vacio } from '../kit'
import { Aviso, Cargando, Ficha, Problema } from '../ui'
import PagarFactura from './PagarFactura'
import { BotonTexto, Cabecera, DestinoPlata, mensajeDe, type ParteDeLaPlata } from './piezas'

/*
 * COMPRAS > FACTURAS (pages/Compras.tsx, seccion "facturas"): lo que entra al
 * negocio y a donde va la plata. Las facturas son las protagonistas: la lista
 * entera, con su buscador y su orden; arriba, las cifras del periodo como
 * complemento, lo que se debe (lo mas urgente primero) y lo que los
 * proveedores deben. Tocar una factura abre su detalle.
 */

type Orden = 'reciente' | 'vieja' | 'total' | 'proveedor' | 'estado'
const ORDENES: { valor: Orden; texto: string }[] = [
  { valor: 'reciente', texto: 'Más recientes' },
  { valor: 'vieja', texto: 'Más viejas' },
  { valor: 'total', texto: 'Mayor total' },
  { valor: 'proveedor', texto: 'Proveedor' },
  { valor: 'estado', texto: 'Por pagar primero' },
]

/** Sin tildes ni mayusculas, para que "cafe" encuentre "Café". */
function contiene(texto: string, palabras: string[]) {
  const t = palabrasDe(texto).join(' ')
  return palabras.every((p) => t.includes(p))
}

export default function Facturas({
  pestanas,
  version,
  buscar,
  onCargar,
}: {
  /** Las pestañas de Compras: van al principio de la lista. */
  pestanas: ReactNode
  /** Sube cuando otra seccion cambio algo (una factura nueva): se vuelve a pedir. */
  version: number
  /** Lo que llega buscado desde otra parte (una alerta). */
  buscar?: string
  onCargar: () => void
}) {
  const t = useTema()
  const { fmt } = useMoneda()
  const { tablet } = useDisposicion()
  // Tres meses: una factura a credito se paga a 30 o 60 dias, y hay que verla.
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDe('90d'))
  const [texto, setTexto] = useState(buscar ?? '')
  const [previoBuscar, setPrevioBuscar] = useState(buscar)
  if (previoBuscar !== buscar) {
    setPrevioBuscar(buscar)
    if (buscar) setTexto(buscar)
  }
  const [orden, setOrden] = useState<Orden>('reciente')
  const [pagando, setPagando] = useState<FacturaCompra | null>(null)
  const [aviso, setAviso] = useState('')
  const [error, setError] = useState('')

  const { datos, error: errorCarga, refrescando, refrescar } = useCarga(
    async () => {
      const [facturas, reclamos] = await Promise.all([
        apiCompras.facturas(periodo.desde, periodo.hasta),
        apiCompras.reclamos().catch(() => [] as Reclamo[]),
      ])
      recordarFacturas(facturas)
      return { facturas, reclamos }
    },
    120,
    `${periodo.id}-${version}`,
  )
  const facturas = useMemo(() => datos?.facturas ?? [], [datos])
  const reclamos = datos?.reclamos ?? []

  const pendientes = facturas
    .filter((f) => f.forma_pago === 'Credito' && !f.pagada)
    .sort((a, b) => (a.fecha_vencimiento ?? '9999').localeCompare(b.fecha_vencimiento ?? '9999'))
  // Lo que se le debe al proveedor: sin el IVA retenido, que es del SENIAT.
  const totalPendiente = pendientes.reduce((s, f) => s + saldoDe(f), 0)
  const vencidas = pendientes.filter((f) => (diasVencida(f) ?? -1) > 0)

  // A donde fue la plata del periodo: por tipo de mercancia, y lo que no es
  // mercancia (servicios, equipos) aparte, sin IVA.
  const resumen = useMemo(() => {
    const por = new Map<TipoArticulo, number>()
    let otros = 0
    let base = 0
    for (const f of facturas) {
      base += f.base_imponible
      const gastos = f.gastos ?? []
      if (f.items.length === 0 && gastos.length === 0) {
        otros += f.base_imponible
        continue
      }
      // El recargo y el descuento caen parejo sobre la mercancia y lo demas.
      const suma = f.items.reduce((s, i) => s + i.subtotal, 0) + gastos.reduce((s, g) => s + g.monto, 0)
      const factor = suma > 0 ? f.base_imponible / suma : 1
      for (const i of f.items) por.set(i.tipo, (por.get(i.tipo) ?? 0) + i.subtotal * factor)
      for (const g of gastos) otros += g.monto * factor
    }
    const partes: ParteDeLaPlata[] = [...por].map(([tipo, monto]) => ({ tipo, monto }))
    const deposito = partes.filter((p) => ALMACEN_DE[p.tipo].destino === 'deposito').reduce((s, p) => s + p.monto, 0)
    return { partes, otros, base, deposito, gasto: Math.max(0, Math.round((base - deposito) * 100) / 100) }
  }, [facturas])

  // Es la lista que mas crece del ERP: se busca por factura, proveedor, RIF o mercancia.
  const visibles = useMemo(() => {
    const palabras = palabrasDe(texto)
    const filtradas = palabras.length
      ? facturas.filter((f) =>
          contiene([f.numero_factura, f.proveedor_nombre, f.proveedor_rif, f.descripcion, ...f.items.map((i) => i.ingrediente_nombre)].join(' '), palabras),
        )
      : facturas
    const lista = [...filtradas]
    switch (orden) {
      case 'vieja':
        return lista.sort((a, b) => a.fecha.localeCompare(b.fecha))
      case 'total':
        return lista.sort((a, b) => b.total - a.total)
      case 'proveedor':
        return lista.sort((a, b) => a.proveedor_nombre.localeCompare(b.proveedor_nombre))
      case 'estado':
        return lista.sort((a, b) => Number(a.pagada) - Number(b.pagada) || b.fecha.localeCompare(a.fecha))
      default:
        return lista.sort((a, b) => b.fecha.localeCompare(a.fecha))
    }
  }, [facturas, texto, orden])

  function abrir(f: FacturaCompra) {
    recordarFactura(f)
    router.push({ pathname: '/compras/factura/[id]', params: { id: String(f.id) } })
  }

  async function darPorPerdido(r: Reclamo) {
    const ok = await confirmar({
      titulo: '¿Dar por perdido?',
      texto: `El proveedor no va a acreditar ${cant(r.cantidad)} ${unidadDe(r.cantidad, r.unidad)} de ${r.ingrediente_nombre}: pasa a pérdida (${fmt(r.valor)}).`,
      aceptar: 'Dar por perdido',
      peligro: true,
    })
    if (!ok) return
    try {
      await apiCompras.darReclamoPorPerdido(r.id)
      refrescar()
    } catch (e) {
      await avisar('No se pudo registrar la nota de crédito', mensajeDe(e, ''))
    }
  }

  const cabecera = (
    <View style={{ gap: 12 }}>
      <FilaFiltros>
        <ElegirPeriodo periodo={periodo} alCambiar={setPeriodo} />
        <Selector etiqueta="Orden" titulo="Ordenar las facturas" opciones={ORDENES} valor={orden} alCambiar={setOrden} />
      </FilaFiltros>
      <Buscador valor={texto} alCambiar={setTexto} placeholder="Buscar por factura, proveedor, RIF o mercancía" />
      {error ? <Problema mensaje={error} /> : null}
      {aviso ? <Aviso texto={aviso} /> : null}
      {errorCarga && !datos ? <Problema mensaje={errorCarga} alReintentar={refrescar} /> : null}
      {!datos && !errorCarga ? <Cargando /> : null}

      {datos ? (
        <View style={[s.kpis, tablet && { flexWrap: 'nowrap' }]}>
          <Kpi etiqueta="Comprado" cifra={fmt(resumen.base)} nota={`${facturas.length} factura${facturas.length === 1 ? '' : 's'} · sin IVA`} style={s.kpi} />
          <Kpi etiqueta="Al inventario" cifra={fmt(resumen.deposito)} nota="Mercancía que entró al stock" style={s.kpi} />
          <Kpi etiqueta="A gasto" cifra={fmt(resumen.gasto)} nota="Desechables, servicios, equipos" style={s.kpi} />
          <Kpi
            etiqueta="Por pagar"
            cifra={fmt(totalPendiente)}
            nota={
              vencidas.length > 0
                ? `${vencidas.length} vencida${vencidas.length === 1 ? '' : 's'}`
                : pendientes.length > 0
                  ? `${pendientes.length} a crédito`
                  : 'Nada pendiente'
            }
            tono={vencidas.length > 0 ? 'aviso' : undefined}
            color={vencidas.length > 0 ? t.avisoFuerte : undefined}
            style={s.kpi}
          />
        </View>
      ) : null}

      {pendientes.length > 0 ? (
        <ListaFicha titulo="Cuentas por pagar" accion={<Text style={[s.nota, { color: t.suave }]}>Debemos <Text style={[s.cifra, { color: t.tinta }]}>{fmt(totalPendiente)}</Text></Text>}>
          <Text style={[s.nota, { color: t.suave, paddingHorizontal: 16, paddingBottom: 4 }]}>
            Lo que se compró a crédito y todavía no se ha pagado, lo más urgente primero.
          </Text>
          {pendientes.map((f, i) => {
            const dias = diasVencida(f)
            const vencida = dias !== null && dias > 0
            return (
              <Renglon
                key={f.id}
                titulo={f.proveedor_nombre}
                detalle={
                  <Text style={[s.detalle, { color: vencida ? t.peligro : t.suave }]}>
                    {f.numero_factura} ·{' '}
                    {f.fecha_vencimiento ? (vencida ? `Vencida hace ${dias} ${dias === 1 ? 'día' : 'días'}` : `Vence ${fechaDe(f.fecha_vencimiento)}`) : 'Sin fecha de vencimiento'}
                  </Text>
                }
                valor={fmt(saldoDe(f))}
                subvalor={f.abonado ? `abonado ${fmt(f.abonado)}` : 'Pagar'}
                colorValor={vencida ? t.peligro : undefined}
                alTocar={() => setPagando(f)}
                ultima={i === pendientes.length - 1}
              />
            )
          })}
        </ListaFicha>
      ) : null}

      {reclamos.length > 0 ? (
        <Ficha>
          <Cabecera
            titulo="Lo que los proveedores deben"
            ayuda="Mercancía facturada que no llegó. Cuando llegue la nota de crédito, regístrala en la factura; si nunca llega, dala por perdida."
            accion={<Text style={[s.cifra, { color: t.tinta }]}>{fmt(reclamos.reduce((x, r) => x + r.valor, 0))}</Text>}
          />
          {reclamos.map((r, i) => (
            <View key={r.id} style={[s.reclamo, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.gris200 }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[s.titulo, { color: t.tinta }]}>
                  {cant(r.cantidad)} {unidadDe(r.cantidad, r.unidad)} de {r.ingrediente_nombre}
                </Text>
                <Text style={[s.detalle, { color: t.suave }]}>
                  {r.proveedor_nombre} · fact. {r.numero_factura} · {fechaDe(r.fecha)}
                  {(r.dias ?? 0) > 0 ? (
                    <Text style={(r.dias ?? 0) > 7 ? { color: t.peligro, fontFamily: LETRA.textoFuerte } : undefined}>
                      {` · hace ${r.dias} ${r.dias === 1 ? 'día' : 'días'}`}
                    </Text>
                  ) : null}
                  {r.motivo ? ` · ${r.motivo}` : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[s.cifra, { color: t.tinta }]}>{fmt(r.valor)}</Text>
                <BotonTexto texto="Dar por perdido" tono="peligro" alTocar={() => void darPorPerdido(r)} />
              </View>
            </View>
          ))}
        </Ficha>
      ) : null}

      {datos && facturas.length > 0 ? (
        <Text style={[s.etiqueta, { color: t.tenue, marginTop: 4 }]}>
          {visibles.length === facturas.length ? `${facturas.length} ${facturas.length === 1 ? 'factura' : 'facturas'}` : `${visibles.length} de ${facturas.length} facturas`}
        </Text>
      ) : null}
    </View>
  )

  const pie =
    datos && (resumen.partes.length > 0 || resumen.otros > 0) ? (
      <Ficha style={{ marginTop: 12 }}>
        <Cabecera titulo="A dónde fue la plata" ayuda="Lo comprado en el período, repartido por lo que es. Cada color es un almacén." />
        <DestinoPlata
          partes={resumen.partes}
          monto={fmt}
          pie={
            resumen.otros > 0 ? (
              <Text style={[s.nota, { color: t.suave, marginTop: 4 }]}>
                Sin renglones (servicios, equipos, otros gastos) <Text style={[s.cifra, { color: t.tinta }]}>{fmt(resumen.otros)}</Text>
              </Text>
            ) : undefined
          }
        />
      </Ficha>
    ) : null

  return (
    <>
      <PantallaLista
        datos={datos ? visibles : []}
        clave={(f) => String(f.id)}
        arriba={pestanas}
        cabecera={cabecera}
        refrescando={refrescando}
        alRefrescar={refrescar}
        vacio={
          datos ? (
            facturas.length === 0 ? (
              <Vacio
                icono="compras"
                titulo="Todavía no hay facturas"
                detalle="Carga la primera desde «Cargar factura»: de ahí salen el costo de la mercancía y el IVA que se puede descontar."
                accion={{ texto: 'Cargar factura', alTocar: onCargar }}
              />
            ) : (
              <Vacio icono="buscar" titulo="Ninguna factura coincide" detalle="Prueba con otra palabra, o con otro período." />
            )
          ) : undefined
        }
        renglon={({ item: f, index }) => (
          <View>
            <FilaFactura f={f} primera={index === 0} ultima={index === visibles.length - 1} alTocar={() => abrir(f)} />
            {index === visibles.length - 1 ? pie : null}
          </View>
        )}
      />
      <PagarFactura
        factura={pagando}
        alCerrar={() => setPagando(null)}
        alPagar={(nueva, textoAviso) => {
          recordarFactura(nueva)
          setPagando(null)
          setError('')
          setAviso(textoAviso)
          refrescar()
        }}
      />
    </>
  )
}

/**
 * Una factura en la lista: de quien, que trajo (los puntos de sus almacenes
 * y una linea en palabras) y cuanto. Va dentro de una losa continua: la
 * primera y la ultima redondean sus esquinas.
 */
function FilaFactura({ f, primera, ultima, alTocar }: { f: FacturaCompra; primera: boolean; ultima: boolean; alTocar: () => void }) {
  const t = useTema()
  const { fmt } = useMoneda()
  // "3 materia prima · 1 desechable": lo que trajo, contado por almacen.
  const porTipo = new Map<TipoArticulo, number>()
  for (const it of f.items) porTipo.set(it.tipo, (porTipo.get(it.tipo) ?? 0) + 1)
  const gastos = f.gastos ?? []
  const trajo =
    f.items.length > 0 || gastos.length > 0
      ? [...[...porTipo].map(([tipo, n]) => `${n} ${ALMACEN_DE[tipo].texto.toLowerCase()}`), ...gastos.map((g) => TEXTO_CONCEPTO[g.concepto].toLowerCase())].join(' · ')
      : `${TEXTO_CATEGORIA[f.categoria] ?? f.categoria}${f.descripcion ? ` · ${f.descripcion}` : ''}`
  const estado =
    f.forma_pago === 'Credito' ? (
      <Pastilla texto={f.pagada ? 'Pagada' : 'Por pagar'} tono={f.pagada ? 'bien' : 'ojo'} />
    ) : (
      <Text style={[s.detalle, { color: t.tenue }]} numberOfLines={1}>
        {f.forma_pago === 'Mixto' && f.pagos?.length ? f.pagos.map((p) => p.forma_pago).join(' + ') : f.forma_pago === 'Efectivo' ? 'Efectivo Bs' : f.forma_pago}
      </Text>
    )
  return (
    <View
      style={[
        s.losa,
        { backgroundColor: t.superficie, borderColor: t.gris200 },
        primera && s.losaArriba,
        ultima && s.losaAbajo,
        !primera && { borderTopWidth: 0 },
      ]}
    >
      <Renglon
        titulo={f.proveedor_nombre}
        detalle={
          <View style={{ gap: 3, marginTop: 2 }}>
            <Text style={[s.detalle, { color: t.suave }]} numberOfLines={1}>
              {fechaDe(f.fecha)} · <Text style={{ fontFamily: LETRA.cifra }}>{f.numero_factura}</Text>
            </Text>
            <View style={s.trajo}>
              {[...porTipo.keys()].map((tipo) => (
                <View key={tipo} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colorDe(t, tipo) }} />
              ))}
              <Text style={[s.detalle, { color: t.tenue, flexShrink: 1 }]} numberOfLines={1}>
                {trajo}
              </Text>
            </View>
          </View>
        }
        valor={fmt(f.total)}
        subvalor={estado}
        alTocar={alTocar}
        ultima
      />
    </View>
  )
}

function colorDe(t: ReturnType<typeof useTema>, tipo: TipoArticulo) {
  return tipo === 'insumo' ? t.acento : tipo === 'reventa' ? t.exito500 : tipo === 'consumible' ? t.suave : tipo === 'desechable' ? t.aviso : t.acentoFuerte
}

const s = StyleSheet.create({
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpi: { flexBasis: '46%', flexGrow: 1 },
  nota: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
  cifra: { fontFamily: LETRA.cifraFuerte, fontSize: 14.5 },
  titulo: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  detalle: { fontFamily: LETRA.texto, fontSize: 13 },
  etiqueta: { fontFamily: LETRA.textoFuerte, fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase' },
  reclamo: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  trajo: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  losa: { borderLeftWidth: 1, borderRightWidth: 1, borderTopWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  losaArriba: { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, paddingTop: 4 },
  losaAbajo: { borderBottomLeftRadius: 22, borderBottomRightRadius: 22, borderBottomWidth: 1, paddingBottom: 4 },
})
