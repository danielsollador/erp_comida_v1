import { useState } from 'react'
import { View } from 'react-native'
import { apiContabilidad } from '../../lib/api-contabilidad'
import { useCarga } from '../../lib/carga'
import { useMoneda } from '../../lib/moneda'
import { useTema } from '../../lib/tema'
import { FilaFiltros, Selector } from '../kit'
import { Aviso, Cargando, Cifra, Etiqueta, Ficha, Fila, Nota, Problema, Titulo } from '../ui'
import { ElegirPeriodoContable, type PeriodoContable } from './periodo'
import { useRefrescoDeSeccion } from './piezas'
import TablaCuentas, { ORDENES_CUENTAS, type OrdenCuentas } from './TablaCuentas'

/*
 * LOS TRES REPORTES DE LA CONTABILIDAD, como en la web: el balance de
 * comprobacion y el balance general son "a hoy"; el estado de resultados es
 * de un periodo. Solo se leen: cada venta, compra, gasto y merma ya dejo su
 * asiento.
 */

/** Todas las cuentas con movimiento, su debe, su haber y su saldo. */
export function BalanceComprobacion() {
  const { datos: filas, error, refrescando, refrescar } = useCarga(() => apiContabilidad.balanceComprobacion(), 300)
  useRefrescoDeSeccion(refrescando, refrescar)
  const [orden, setOrden] = useState<OrdenCuentas>('cuenta')

  return (
    <>
      <FilaFiltros>
        <Selector<OrdenCuentas> etiqueta="Ordenar" titulo="Ordenar las cuentas" opciones={ORDENES_CUENTAS} valor={orden} alCambiar={setOrden} />
      </FilaFiltros>
      {error && !filas ? <Problema mensaje={error} alReintentar={refrescar} /> : null}
      {!filas && !error ? <Cargando /> : null}
      {filas ? (
        <Ficha style={{ paddingVertical: 8 }}>
          {filas.length === 0 ? <Nota style={{ paddingVertical: 8 }}>Todavía no hay cuentas con movimientos.</Nota> : <TablaCuentas filas={filas} orden={orden} />}
        </Ficha>
      ) : null}
    </>
  )
}

/** Cuanto entro, cuanto costo lo vendido, cuanto se gasto y cuanto quedo, en un periodo. */
export function EstadoResultados({ periodo, alCambiarPeriodo }: { periodo: PeriodoContable; alCambiarPeriodo: (p: PeriodoContable) => void }) {
  const t = useTema()
  const { fmt } = useMoneda()
  const { datos, error, refrescando, refrescar } = useCarga(
    () => apiContabilidad.estadoResultados(periodo.desde, periodo.hasta),
    300,
    `${periodo.desde}|${periodo.hasta}`,
  )
  useRefrescoDeSeccion(refrescando, refrescar)

  return (
    <>
      <FilaFiltros>
        <ElegirPeriodoContable periodo={periodo} alCambiar={alCambiarPeriodo} />
      </FilaFiltros>
      {error && !datos ? <Problema mensaje={error} alReintentar={refrescar} /> : null}
      {!datos && !error ? <Cargando /> : null}
      {datos ? (
        <Ficha>
          <Etiqueta>{datos.etiqueta}</Etiqueta>
          <View style={{ marginTop: 8 }}>
            <Cifra tamano="grande" color={datos.utilidad_neta < 0 ? t.peligro : t.tinta}>
              {fmt(datos.utilidad_neta)}
            </Cifra>
          </View>
          <Nota>Utilidad neta</Nota>
          <View style={{ marginTop: 12 }}>
            <Fila nombre="Ingresos por ventas" valor={fmt(datos.ingresos)} />
            <Fila nombre="Costo de ventas" valor={fmt(-datos.costos)} />
            <Fila nombre="Utilidad bruta" valor={fmt(datos.utilidad_bruta)} fuerte />
            <Fila nombre="Gastos operativos" valor={fmt(-datos.gastos)} />
            <Fila
              nombre="Utilidad neta"
              valor={fmt(datos.utilidad_neta)}
              fuerte
              color={datos.utilidad_neta < 0 ? t.peligro : t.exito}
              ultima
            />
          </View>
        </Ficha>
      ) : null}
    </>
  )
}

/** Lo que se tiene, lo que se debe y lo que es del dueño, a hoy: y si cuadra. */
export function BalanceGeneralVista() {
  const { fmt } = useMoneda()
  const { datos, error, refrescando, refrescar } = useCarga(() => apiContabilidad.balanceGeneral(), 300)
  useRefrescoDeSeccion(refrescando, refrescar)

  if (error && !datos) return <Problema mensaje={error} alReintentar={refrescar} />
  if (!datos) return <Cargando />

  return (
    <>
      <Aviso
        tono={datos.cuadra ? 'exito' : 'peligro'}
        texto={datos.cuadra ? 'Activos = Pasivos + Patrimonio. Los libros cuadran.' : 'Los libros no cuadran - revisa los asientos manuales.'}
      />

      <Ficha style={{ gap: 6 }}>
        <Titulo>Activos</Titulo>
        <TablaCuentas filas={datos.activos} />
        <Fila nombre="Total activos" valor={fmt(datos.total_activos)} fuerte ultima />
      </Ficha>

      <Ficha style={{ gap: 6 }}>
        <Titulo>Pasivos</Titulo>
        {datos.pasivos.length > 0 ? <TablaCuentas filas={datos.pasivos} /> : <Nota>Sin deudas registradas.</Nota>}
        <Fila nombre="Total pasivos" valor={fmt(datos.total_pasivos)} fuerte ultima />
      </Ficha>

      <Ficha style={{ gap: 6 }}>
        <Titulo>Patrimonio</Titulo>
        {datos.patrimonio.length > 0 ? <TablaCuentas filas={datos.patrimonio} /> : null}
        <Fila nombre="Utilidad acumulada (no distribuida)" valor={fmt(datos.utilidad_acumulada)} />
        <Fila nombre="Total patrimonio" valor={fmt(datos.total_patrimonio)} fuerte ultima />
      </Ficha>
    </>
  )
}
