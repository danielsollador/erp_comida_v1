import { Redirect, router, Stack, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { apiCaja } from '../../lib/api-caja'
import { useCarga } from '../../lib/carga'
import { hoyEnCaracas } from '../../lib/formato'
import { periodoDe, type Periodo } from '../../lib/numeros'
import { useSesion } from '../../lib/sesion'
import type { CierreCaja, Gasto, RetiroPropietario } from '../../lib/tipos'
import { BarraAccion } from '../kit'
import { Aviso, Pantalla, Pestanas } from '../ui'
import { AbrirCaja } from './AbrirCaja'
import { SeccionCierre } from './Cierre'
import { CuadrarCaja } from './CuadrarCaja'
import { AvisoDeshacer, useDeshacer } from './Deshacer'
import { Historial } from './Historial'
import { etiquetaRango, SECCIONES, type IdSeccion } from './logica'
import { Movimientos } from './Movimientos'
import { mensajeDe } from './piezas'

/**
 * CIERRE DE CAJA, como pages/Caja.tsx de la web: las mismas tres secciones
 * (Cierre de caja, Gastos y retiros, Historial), en la ruta igual que alla
 * (/caja, /caja/movimientos, /caja/historial). Sin el modulo `caja` se
 * vuelve al inicio, como la guarda `Requiere` de la web.
 *
 * "Cajas del local" (pages/partes/Cajas.tsx) NO esta: la web la quito del
 * cierre el 21-sep (Savora tiene una sola gaveta por forma de pago y
 * preguntar "¿cual caja cierras?" era hacerle decidir al cajero algo que no
 * existe); el archivo quedo sin usar.
 */
export default function PantallaCaja() {
  const { acceso } = useSesion()
  if (acceso && !acceso.puede.modulos.includes('caja')) return <Redirect href="/" />
  return <Caja />
}

function Caja() {
  const borde = useSafeAreaInsets()
  const { seccion: pedida } = useLocalSearchParams<{ seccion?: string }>()
  const seccion: IdSeccion = SECCIONES.some((s) => s.id === pedida) ? (pedida as IdSeccion) : 'cierre'

  // El dia que se esta cuadrando. NO es un rango: cuadrar es de un dia.
  const [dia, setDia] = useState(hoyEnCaracas)
  // Solo el historial mira periodos (y las listas de gastos y retiros).
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDe('30d'))
  const [abriendo, setAbriendo] = useState(false)
  const [contando, setContando] = useState(false)
  const [errorBorrar, setErrorBorrar] = useState('')
  const { deshacible, deshacer, oculto, visible } = useDeshacer()

  // Si la apertura falla (un rol que no la ve), la ficha simplemente no sale.
  const delDia = useCarga(
    async () => {
      const [resumen, apertura] = await Promise.all([apiCaja.resumen(dia), apiCaja.estadoDeApertura(dia).catch(() => null)])
      return { resumen, apertura }
    },
    60,
    dia,
  )
  const delPeriodo = useCarga(
    async () => {
      const [gastos, retiros, cierres] = await Promise.all([
        apiCaja.listarGastos(periodo.desde, periodo.hasta).catch((): Gasto[] => []),
        apiCaja.listarRetiros(periodo.desde, periodo.hasta).catch((): RetiroPropietario[] => []),
        apiCaja.listarCierres(periodo.desde, periodo.hasta).catch((): CierreCaja[] => []),
      ])
      return { gastos, retiros, cierres }
    },
    120,
    `${periodo.desde}|${periodo.hasta}`,
  )

  // Mientras llega otro dia no se muestra el de antes con la fecha nueva.
  const vigente = delDia.datos && delDia.datos.resumen.fecha === dia ? delDia.datos : null
  const listas = delPeriodo.datos ?? { gastos: [], retiros: [], cierres: [] }
  const etiqueta = etiquetaRango(periodo.desde, periodo.hasta, hoyEnCaracas())

  const recargar = () => {
    delDia.refrescar()
    delPeriodo.refrescar()
  }
  const irA = (id: IdSeccion) => router.setParams({ seccion: id })

  const borrar = (tipo: 'gasto' | 'retiro', id: number) => {
    setErrorBorrar('')
    deshacible({
      clave: `${tipo}:${id}`,
      texto: tipo === 'gasto' ? 'Gasto borrado' : 'Retiro borrado',
      ejecutar: () => (tipo === 'gasto' ? apiCaja.eliminarGasto(id) : apiCaja.eliminarRetiro(id)),
      alTerminar: recargar,
      alFallar: (e) => setErrorBorrar(mensajeDe(e, 'No se pudo borrar')),
    })
  }

  // El cuadre es la accion de la pantalla: siempre a mano, abajo.
  const abajo =
    seccion === 'cierre' && vigente ? (
      <BarraAccion texto={vigente.resumen.cerrada ? 'Corregir el conteo' : 'Hacer cierre de caja'} alTocar={() => setContando(true)} />
    ) : undefined

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: 'Cierre de caja' }} />
      <Pantalla refrescando={delDia.refrescando || delPeriodo.refrescando} alRefrescar={recargar} abajo={abajo}>
        <Pestanas opciones={SECCIONES} valor={seccion} alCambiar={irA} />
        {errorBorrar ? <Aviso texto={errorBorrar} tono="peligro" /> : null}

        {seccion === 'cierre' ? (
          <SeccionCierre
            dia={dia}
            alCambiarDia={setDia}
            datos={vigente}
            error={delDia.error}
            alReintentar={delDia.refrescar}
            alAbrir={() => setAbriendo(true)}
            irAMovimientos={() => irA('movimientos')}
          />
        ) : null}

        {seccion === 'movimientos' ? (
          <Movimientos
            gastos={listas.gastos}
            retiros={listas.retiros}
            etiqueta={etiqueta}
            alCambiar={recargar}
            alBorrar={borrar}
            oculto={oculto}
          />
        ) : null}

        {seccion === 'historial' ? (
          <Historial
            gastos={listas.gastos}
            retiros={listas.retiros}
            cierres={listas.cierres}
            periodo={periodo}
            alCambiarPeriodo={setPeriodo}
            etiqueta={etiqueta}
            oculto={oculto}
          />
        ) : null}
      </Pantalla>

      {visible ? (
        <AvisoDeshacer texto={visible.texto} alDeshacer={() => deshacer(visible.clave)} abajo={(abajo ? 88 : 16) + borde.bottom} />
      ) : null}

      {abriendo && vigente?.apertura ? (
        <AbrirCaja
          estado={vigente.apertura}
          fecha={dia}
          alCerrar={() => setAbriendo(false)}
          alAbrir={() => {
            setAbriendo(false)
            recargar()
          }}
        />
      ) : null}

      {contando && vigente ? (
        <CuadrarCaja
          resumen={vigente.resumen}
          corregir={vigente.resumen.cerrada ? vigente.resumen.cierre_id : null}
          dia={dia}
          alCerrar={() => setContando(false)}
          alListo={() => {
            setContando(false)
            recargar()
          }}
        />
      ) : null}
    </View>
  )
}
