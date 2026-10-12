import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import { apiCompras } from '../../lib/api-compras'
import type { AlertaPrecio, ConfiguracionFiscal, Ingrediente, Proveedor } from '../../lib/tipos'
import { Barra } from '../Encabezado'
import { Pestanas } from '../ui'
import Alertas, { AlertasAlGuardar } from './Alertas'
import CargarFactura from './CargarFactura'
import Facturas from './Facturas'
import Proveedores from './Proveedores'

/**
 * COMPRAS, como pages/Compras.tsx de la web: las mismas cuatro secciones
 * (Facturas, Cargar factura, Alertas, Proveedores), en el mismo orden, y la
 * seccion en la ruta (/compras/nueva). Las alertas sin ver van en el nombre
 * de la pestaña: asi el dueño se entera aunque la factura la haya cargado
 * otro.
 *
 * Las secciones que ya se abrieron SE QUEDAN montadas (solo se esconden): una
 * factura a medio cargar no se pierde por ir a mirar la lista y volver.
 */
type IdSeccion = 'facturas' | 'nueva' | 'alertas' | 'proveedores'

const SECCIONES: { id: IdSeccion; texto: string }[] = [
  { id: 'facturas', texto: 'Facturas' },
  { id: 'nueva', texto: 'Cargar factura' },
  { id: 'alertas', texto: 'Alertas' },
  { id: 'proveedores', texto: 'Proveedores' },
]

export default function PantallaCompras() {
  const { seccion: pedida, buscar } = useLocalSearchParams<{ seccion?: string; buscar?: string }>()
  const seccion: IdSeccion = SECCIONES.some((s) => s.id === pedida) ? (pedida as IdSeccion) : 'facturas'
  const [abiertas, setAbiertas] = useState<IdSeccion[]>([seccion])
  if (!abiertas.includes(seccion)) setAbiertas([...abiertas, seccion])

  const [alertasPendientes, setAlertasPendientes] = useState(0)
  const [alertasAlGuardar, setAlertasAlGuardar] = useState<AlertaPrecio[]>([])
  // Sube cuando entra una factura: la lista se vuelve a pedir.
  const [version, setVersion] = useState(0)
  const [ingredientes, setIngredientes] = useState<Ingrediente[]>([])
  const [proveedores, setProveedores] = useState<Proveedor[] | null>(null)
  const [fiscal, setFiscal] = useState<ConfiguracionFiscal>({ tasa_iva: 16 })
  const [refrescandoProveedores, setRefrescandoProveedores] = useState(false)

  const contarAlertas = useCallback(() => {
    apiCompras
      .alertas(true)
      .then((l) => setAlertasPendientes(l.length))
      .catch(() => undefined)
  }, [])
  const cargarProveedores = useCallback(
    () =>
      apiCompras
        .proveedores()
        .then(setProveedores)
        .catch(() => setProveedores((p) => p ?? []))
        .finally(() => setRefrescandoProveedores(false)),
    [],
  )

  useEffect(() => {
    apiCompras
      .ingredientes()
      .then((l) => setIngredientes(l.filter((i) => i.activo !== false)))
      .catch(() => undefined)
    apiCompras
      .configFiscal()
      .then(setFiscal)
      .catch(() => undefined)
    void cargarProveedores()
    contarAlertas()
    // Lo que quedo a medias despues de guardar (la foto, la memoria, las
    // alertas), de este telefono o de cualquier otro: lo termina el servidor.
    apiCompras
      .reconciliar()
      .then((r) => {
        if (r.completadas > 0) contarAlertas()
      })
      .catch(() => undefined)
  }, [cargarProveedores, contarAlertas])

  const irA = (id: IdSeccion) => router.setParams({ seccion: id, buscar: undefined })
  const opciones = SECCIONES.map((s) => (s.id === 'alertas' && alertasPendientes > 0 ? { ...s, texto: `Alertas · ${alertasPendientes}` } : s))
  const arriba = (
    <View style={{ gap: 4, paddingBottom: 6 }}>
      <Barra titulo="Compras" />
      <Pestanas opciones={opciones} valor={seccion} alCambiar={irA} />
    </View>
  )
  const capa = (id: IdSeccion) => [{ flex: 1 }, seccion !== id && { display: 'none' as const }]

  return (
    <View style={{ flex: 1 }}>
      {abiertas.includes('facturas') ? (
        <View style={capa('facturas')}>
          <Facturas arriba={arriba} version={version} buscar={buscar} onCargar={() => irA('nueva')} />
        </View>
      ) : null}
      {abiertas.includes('nueva') ? (
        <View style={capa('nueva')}>
          <CargarFactura
            arriba={arriba}
            ingredientes={ingredientes}
            setIngredientes={setIngredientes}
            proveedores={proveedores ?? []}
            fiscal={fiscal}
            onGuardada={(alertas) => {
              if (alertas.length > 0) setAlertasAlGuardar(alertas)
              setVersion((v) => v + 1)
              contarAlertas()
              void cargarProveedores()
            }}
            onVerFacturas={() => irA('facturas')}
          />
        </View>
      ) : null}
      {abiertas.includes('alertas') ? (
        <View style={capa('alertas')}>
          <Alertas
            arriba={arriba}
            onPendientes={setAlertasPendientes}
            onVerFactura={(a) => router.push({ pathname: '/compras/factura/[id]', params: { id: String(a.factura_id) } })}
          />
        </View>
      ) : null}
      {abiertas.includes('proveedores') ? (
        <View style={capa('proveedores')}>
          <Proveedores
            arriba={arriba}
            proveedores={proveedores}
            alCambiar={() => void cargarProveedores()}
            refrescando={refrescandoProveedores}
            alRefrescar={() => {
              setRefrescandoProveedores(true)
              void cargarProveedores()
            }}
          />
        </View>
      ) : null}
      <AlertasAlGuardar alertas={alertasAlGuardar} onCerrar={() => setAlertasAlGuardar([])} />
    </View>
  )
}

