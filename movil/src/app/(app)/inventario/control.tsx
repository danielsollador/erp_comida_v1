import { router, Stack, type Href } from 'expo-router'
import { useState } from 'react'
import { View } from 'react-native'
import { unidadDe } from '../../../../../frontend/src/lib/inventario'
import DetalleConteo from '../../../componentes/conteo/DetalleConteo'
import CambiosDeHoy from '../../../componentes/control/CambiosDeHoy'
import { Costos, ListaConteos, Perdidas, Teorico } from '../../../componentes/control/Vistas'
import { ElegirPeriodo, FilaFiltros } from '../../../componentes/kit'
import { fmtCant } from '../../../componentes/preparaciones/cuentas'
import { BotonChico, mensajeDe } from '../../../componentes/preparaciones/piezas'
import { Aviso, Cargando, Pantalla, Pestanas, Problema } from '../../../componentes/ui'
import { apiPreparaciones } from '../../../lib/api-preparaciones'
import { useCarga } from '../../../lib/carga'
import { confirmar } from '../../../lib/dialogo'
import { useMoneda } from '../../../lib/moneda'
import { periodoDe, type Periodo } from '../../../lib/numeros'
import type { CostoParaPrecios, Merma, SobranteInventario } from '../../../lib/tipos'

type Vista = 'teorico' | 'perdidas' | 'conteos' | 'costos'

/**
 * EL CONTROL DEL INVENTARIO (`Control` de la web): lo que no depende de que
 * la cocina anote nada.
 *
 *  - TEORICO vs REAL: lo que debio salir segun las recetas contra lo que
 *    encontro el conteo. Una diferencia grande en el pollo es porcion
 *    generosa, merma sin anotar o algo peor, y se ve en plata.
 *  - PERDIDAS: lo que se boto, y los faltantes de conteo, por separado.
 *  - CONTEOS: cuando se conto, quien y si fue a ciegas.
 *  - EL ACEITE POR UNIDAD y CON QUE COSTO SE FIJAN PRECIOS.
 *
 * Es la unica parte del inventario con periodo (Leider, 8-oct): aqui si se
 * revisa la historia. Por defecto, los ultimos 30 dias, como la web.
 */
export default function Control() {
  const { fmt: dinero } = useMoneda()
  const [vista, setVista] = useState<Vista>('teorico')
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoDe('30d'))
  const [conteoAbierto, setConteoAbierto] = useState<number | null>(null)
  const [error, setError] = useState('')
  // Lo elegido se ve al instante; el servidor lo confirma despues.
  const [metodo, setMetodo] = useState<CostoParaPrecios | null>(null)

  const { datos, error: errorCarga, refrescando, refrescar } = useCarga(
    async () => {
      const { desde, hasta } = periodo
      const [teorico, indirectos, config, categorias, mermas, sobrantes, conteos, ingredientes] = await Promise.all([
        apiPreparaciones.costoTeorico(desde, hasta),
        apiPreparaciones.indirectos(desde, hasta),
        apiPreparaciones.config(),
        apiPreparaciones.categoriasMenu(),
        apiPreparaciones.mermas(desde, hasta),
        apiPreparaciones.sobrantes(desde, hasta).catch(() => [] as SobranteInventario[]),
        apiPreparaciones.conteos(desde, hasta).catch(() => []),
        apiPreparaciones.ingredientes(),
      ])
      return { teorico, indirectos, config, categorias: categorias.filter((x) => x.activo !== false), mermas, sobrantes, conteos, ingredientes }
    },
    60,
    `${periodo.desde}-${periodo.hasta}`,
  )

  const contar = () => router.push('/inventario/conteo' as Href)

  async function accion(fn: () => Promise<unknown>) {
    setError('')
    try {
      await fn()
      refrescar()
    } catch (e) {
      setError(mensajeDe(e, 'Ocurrió un error'))
    }
  }

  async function revertirMerma(m: Merma) {
    const ok = await confirmar({
      titulo: '¿Revertir esta merma?',
      texto: `Vuelven ${fmtCant(m.cantidad)} ${unidadDe(m.cantidad, m.unidad)} de ${m.ingrediente_nombre} al inventario.\n\nLa merma original no se borra: queda marcada como revertida con su asiento de reverso.`,
      aceptar: 'Revertir',
    })
    if (ok) await accion(() => apiPreparaciones.revertirMerma(m.id))
  }

  async function revertirSobrante(sb: SobranteInventario) {
    const ok = await confirmar({
      titulo: '¿Revertir este conteo?',
      texto: `Salen ${fmtCant(sb.cantidad)} ${unidadDe(sb.cantidad, sb.unidad)} de ${sb.ingrediente_nombre} que habían entrado por un conteo hacia arriba.\n\nEl sobrante no se borra: queda marcado como revertido con su contra-asiento.`,
      aceptar: 'Revertir',
    })
    if (ok) await accion(() => apiPreparaciones.revertirSobrante(sb.id))
  }

  async function elegirMetodo(m: CostoParaPrecios) {
    setMetodo(m)
    try {
      await apiPreparaciones.fijarCostoParaPrecios(m)
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo guardar'))
    }
  }

  const vivas = (datos?.mermas ?? []).filter((m) => !m.revertida)
  const nPerdidas = vivas.filter((m) => !m.por_conteo).length
  const nConteos = datos?.conteos.length ?? 0
  const metodoVisto = metodo ?? datos?.config.costo_para_precios ?? 'reposicion'

  return (
    <Pantalla refrescando={refrescando} alRefrescar={refrescar}>
      <Stack.Screen options={{ title: 'Control' }} />
      <Pestanas
        opciones={[
          { id: 'teorico' as Vista, texto: 'Debió salir vs. hay' },
          { id: 'perdidas' as Vista, texto: nPerdidas > 0 ? `Pérdidas · ${nPerdidas}` : 'Pérdidas' },
          { id: 'conteos' as Vista, texto: nConteos > 0 ? `Conteos · ${nConteos}` : 'Conteos' },
          { id: 'costos' as Vista, texto: 'Aceite y precios' },
        ]}
        valor={vista}
        alCambiar={setVista}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <FilaFiltros>
            <ElegirPeriodo periodo={periodo} alCambiar={setPeriodo} />
          </FilaFiltros>
        </View>
        <BotonChico texto="Conteo físico" alTocar={contar} />
      </View>

      {error ? <Aviso texto={error} tono="peligro" /> : null}
      {errorCarga && !datos ? <Problema mensaje={errorCarga} alReintentar={refrescar} /> : null}
      {!datos && !errorCarga ? <Cargando /> : null}

      {datos ? (
        <>
          <CambiosDeHoy ingredientes={datos.ingredientes} />
          {vista === 'teorico' ? <Teorico filas={datos.teorico} nombreRango={periodo.etiqueta} dinero={dinero} alContar={contar} /> : null}
          {vista === 'perdidas' ? (
            <Perdidas
              mermas={datos.mermas}
              sobrantes={datos.sobrantes}
              nombreRango={periodo.etiqueta}
              dinero={dinero}
              alRevertirMerma={(m) => void revertirMerma(m)}
              alRevertirSobrante={(s) => void revertirSobrante(s)}
            />
          ) : null}
          {vista === 'conteos' ? <ListaConteos conteos={datos.conteos} dinero={dinero} alAbrir={setConteoAbierto} /> : null}
          {vista === 'costos' ? (
            <Costos
              indirectos={datos.indirectos}
              categorias={datos.categorias}
              metodo={metodoVisto}
              dinero={dinero}
              alElegirMetodo={(m) => void elegirMetodo(m)}
              alFreir={(v, se_frie) => void accion(() => apiPreparaciones.marcarFritura(v, se_frie))}
            />
          ) : null}
        </>
      ) : null}

      {conteoAbierto !== null ? <DetalleConteo id={conteoAbierto} alCerrar={() => setConteoAbierto(null)} /> : null}
    </Pantalla>
  )
}
