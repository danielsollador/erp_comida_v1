import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Barra } from '../Encabezado'
import { Pantalla, Pestanas } from '../ui'
import { BalanceComprobacion, BalanceGeneralVista, EstadoResultados } from './Balances'
import Diario from './Diario'
import Equipos from './Equipos'
import { periodoContable, type PeriodoContable } from './periodo'
import { AvisoInfo, RefrescoContexto, useRefrescoDePantalla } from './piezas'
import PlanCuentas from './PlanCuentas'
import Respaldos from './Respaldos'

/*
 * CONTABILIDAD, como pages/Contabilidad.tsx de la web: las mismas siete
 * secciones, en el mismo orden. La seccion va en la ruta
 * (/contabilidad/diario), igual que en la web, asi un aviso o un enlace
 * abre directo la que hace falta. Los respaldos viven aqui porque este es
 * el modulo de quien administra el negocio, que es justo quien restaura.
 */
type IdSeccion = 'plan' | 'diario' | 'comprobacion' | 'resultados' | 'general' | 'activos' | 'respaldos'

const SECCIONES: { id: IdSeccion; texto: string }[] = [
  { id: 'plan', texto: 'Plan de cuentas' },
  { id: 'diario', texto: 'Asientos' },
  { id: 'comprobacion', texto: 'Balance de comprobación' },
  { id: 'resultados', texto: 'Estado de resultados' },
  { id: 'general', texto: 'Balance general' },
  { id: 'activos', texto: 'Equipos' },
  { id: 'respaldos', texto: 'Respaldos' },
]

export default function PantallaContabilidad() {
  const { seccion: pedida } = useLocalSearchParams<{ seccion?: string }>()
  const seccion: IdSeccion = SECCIONES.some((s) => s.id === pedida) ? (pedida as IdSeccion) : 'plan'
  // El diario y el estado de resultados son "de un periodo" (este mes al
  // entrar, como la web); el plan, los balances y los equipos son "a hoy".
  const [periodo, setPeriodo] = useState<PeriodoContable>(() => periodoContable('mes'))

  // Un solo "tirar para refrescar" para la seccion que se esta viendo.
  const { valor: refresco, refrescando, refrescar: refrescarSeccion } = useRefrescoDePantalla()

  return (
    <RefrescoContexto.Provider value={refresco}>
      <Pantalla refrescando={refrescando} alRefrescar={() => refrescarSeccion()} arriba={<Barra titulo="Contabilidad" />}>
        <Pestanas opciones={SECCIONES} valor={seccion} alCambiar={(id) => router.setParams({ seccion: id })} />
        {/* El dueño no opera esto: cada venta y compra ya dejo su asiento. */}
        <AvisoInfo>Esto se arma solo con cada venta, compra, gasto y merma. No hay que cargar nada: es para tu contador.</AvisoInfo>
        {seccion === 'plan' && <PlanCuentas />}
        {seccion === 'diario' && <Diario periodo={periodo} alCambiarPeriodo={setPeriodo} />}
        {seccion === 'comprobacion' && <BalanceComprobacion />}
        {seccion === 'resultados' && <EstadoResultados periodo={periodo} alCambiarPeriodo={setPeriodo} />}
        {seccion === 'general' && <BalanceGeneralVista />}
        {seccion === 'activos' && <Equipos />}
        {seccion === 'respaldos' && <Respaldos />}
      </Pantalla>
    </RefrescoContexto.Provider>
  )
}
