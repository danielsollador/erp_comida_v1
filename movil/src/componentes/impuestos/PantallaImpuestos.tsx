import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'
import { apiImpuestos } from '../../lib/api-impuestos'
import { useCarga } from '../../lib/carga'
import { bolivares } from '../../lib/formato'
import { useTema } from '../../lib/tema'
import type { ConfiguracionFiscal } from '../../lib/tipos'
import { ElegirPeriodoContable, periodoContable, type PeriodoContable } from '../contabilidad/periodo'
import { RefrescoContexto, useRefrescoDePantalla } from '../contabilidad/piezas'
import { Barra } from '../Encabezado'
import { FilaFiltros, useDisposicion } from '../kit'
import { Cifra, Etiqueta, Ficha, Fila, Nota, Pantalla, Pestanas } from '../ui'
import DatosFiscales from './DatosFiscales'
import Declaraciones from './Declaraciones'
import LibroCompras from './LibroCompras'
import LibroVentas from './LibroVentas'
import Retenciones from './Retenciones'

/*
 * IMPUESTOS, como pages/Impuestos.tsx de la web: las mismas cuatro
 * secciones, el periodo (el SENIAT pide los libros por mes: abre en el mes
 * en curso), los datos fiscales y el IVA del periodo en bolivares, que es lo
 * que se declara. La seccion va en la ruta (/impuestos/declaraciones), asi
 * el aviso del servidor abre directo la que hace falta.
 */
type IdSeccion = 'ventas' | 'compras' | 'retenciones' | 'declaraciones'

const SECCIONES: { id: IdSeccion; texto: string }[] = [
  { id: 'ventas', texto: 'Libro de ventas' },
  { id: 'compras', texto: 'Libro de compras' },
  { id: 'retenciones', texto: 'Retenciones IVA' },
  { id: 'declaraciones', texto: 'Declaraciones' },
]

export default function PantallaImpuestos() {
  const t = useTema()
  const { tablet } = useDisposicion()
  const { seccion: pedida } = useLocalSearchParams<{ seccion?: string }>()
  const seccion: IdSeccion = SECCIONES.some((s) => s.id === pedida) ? (pedida as IdSeccion) : 'ventas'
  const [periodo, setPeriodo] = useState<PeriodoContable>(() => periodoContable('mes'))
  const clave = `${periodo.desde}|${periodo.hasta}`

  const { datos: config, refrescar: refrescarConfig } = useCarga(() => apiImpuestos.configFiscal(), 600)
  // Lo recien guardado manda hasta que el servidor lo vuelva a contar.
  const [guardada, setGuardada] = useState<ConfiguracionFiscal | null>(null)
  const fiscal = guardada ?? config
  const { datos: resumen, refrescar: refrescarResumen } = useCarga(
    () => apiImpuestos.resumenIva(periodo.desde, periodo.hasta),
    300,
    clave,
  )

  // Un solo "tirar para refrescar": la seccion que se ve, el IVA y los datos fiscales.
  const { valor: refresco, refrescando, refrescar: refrescarSeccion } = useRefrescoDePantalla()

  const aPagar = resumen?.iva_a_pagar_bs ?? 0

  return (
    <RefrescoContexto.Provider value={refresco}>
      <Pantalla
        refrescando={refrescando}
        alRefrescar={() => {
          refrescarSeccion()
          refrescarResumen()
          refrescarConfig()
        }}
        arriba={<Barra titulo="Impuestos" />}
      >
        <Pestanas opciones={SECCIONES} valor={seccion} alCambiar={(id) => router.setParams({ seccion: id })} />
        {seccion !== 'declaraciones' ? (
          <FilaFiltros>
            <ElegirPeriodoContable periodo={periodo} alCambiar={setPeriodo} />
          </FilaFiltros>
        ) : null}

        <View style={tablet ? { flexDirection: 'row', gap: 12, alignItems: 'stretch' } : { gap: 12 }}>
          <View style={tablet ? { flex: 1 } : undefined}>
            <DatosFiscales config={fiscal} alGuardar={setGuardada} />
          </View>
          {resumen ? (
            <Ficha style={tablet ? { flex: 1 } : undefined}>
              {/* En Bs: es lo que se declara al SENIAT. */}
              <Etiqueta>{aPagar >= 0 ? 'IVA a pagar' : 'IVA a favor'} · {resumen.etiqueta}</Etiqueta>
              <View style={{ marginTop: 6 }}>
                <Cifra tamano="media" color={aPagar > 0 ? t.tinta : t.exito}>
                  {bolivares(Math.abs(aPagar))}
                </Cifra>
              </View>
              <Nota>Lo que le queda debiendo al SENIAT este período, o lo que te queda a favor.</Nota>
              <View style={{ marginTop: 8 }}>
                <Fila nombre="IVA débito (ventas)" valor={bolivares(resumen.iva_debito_bs)} />
                <Fila nombre="IVA crédito (compras)" valor={bolivares(resumen.iva_credito_bs)} ultima />
              </View>
            </Ficha>
          ) : null}
        </View>

        {seccion === 'ventas' && <LibroVentas periodo={periodo} alCambiar={refrescarResumen} />}
        {seccion === 'compras' && <LibroCompras periodo={periodo} alCambiar={refrescarResumen} />}
        {seccion === 'retenciones' && <Retenciones agente={Boolean(fiscal?.agente_retencion)} />}
        {seccion === 'declaraciones' && <Declaraciones alCambiar={refrescarResumen} />}
      </Pantalla>
    </RefrescoContexto.Provider>
  )
}
