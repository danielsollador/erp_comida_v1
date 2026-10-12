import { router } from 'expo-router'
import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { Barra } from '../../../../componentes/Encabezado'
import { useDisposicion, Vacio } from '../../../../componentes/kit'
import AnotarTanda from '../../../../componentes/preparaciones/AnotarTanda'
import { RindeDistinto, TandasDeLaSemana, Vencidas } from '../../../../componentes/preparaciones/Avisos'
import { colorFranja } from '../../../../componentes/preparaciones/colores'
import Mapa from '../../../../componentes/preparaciones/Mapa'
import { Cabecera, Enlace, mensajeDe } from '../../../../componentes/preparaciones/piezas'
import SobroHoy from '../../../../componentes/preparaciones/SobroHoy'
import { TarjetaNueva, TarjetaPreparacion } from '../../../../componentes/preparaciones/Tarjeta'
import { Aviso, Cargando, Ficha, Pantalla, Problema } from '../../../../componentes/ui'
import { apiPreparaciones, type RendimientoReal } from '../../../../lib/api-preparaciones'
import { useCarga } from '../../../../lib/carga'
import { useMoneda } from '../../../../lib/moneda'
import type { Preparacion } from '../../../../lib/tipos'

/**
 * PREPARADO: la segunda cara de la materia prima (`Preparaciones` de la web).
 * El guiso, la mechada, la salsa: lo que la cocina hace con el crudo.
 *
 * Es un almacen IMAGINARIO (pizarra del 7-oct): no dice cuanto guiso hay en
 * la nevera, dice cuanto se PODRIA hacer con el crudo que hay. Al vender un
 * pastelito se baja por la receta hasta el pollo, y nadie pesa nada. Lo que
 * si se anota es al cierre: "sobro guiso, lo boto o lo guardo".
 *
 * Tres piezas, como en la web: EL MAPA (que crudo usa cada preparacion y que
 * comparten dos), LAS TARJETAS (cuanto podrias hacer hoy, "Sobró hoy",
 * "Anotar tanda") y LA OLLA, el editor de la receta, que aqui es su propia
 * pantalla (/inventario/preparaciones/[id]).
 */
export default function Preparado() {
  const { fmt: dinero } = useMoneda()
  const { tablet, ancho } = useDisposicion()
  const { datos, error, refrescando, refrescar } = useCarga(async () => {
    const [ingredientes, preps, disp, vencidas, tandas, rinde] = await Promise.all([
      apiPreparaciones.ingredientes(),
      apiPreparaciones.preparaciones(),
      apiPreparaciones.disponibilidad(),
      apiPreparaciones.vencidas(),
      apiPreparaciones.tandas(),
      // Las que rinden distinto de su receta (8-oct): si no llega, no estorba.
      apiPreparaciones.rendimientos().catch(() => [] as RendimientoReal[]),
    ])
    return { ingredientes, preps, disp, vencidas, tandas, rinde }
  })
  // La elegida en el mapa se queda elegida hasta soltarla.
  const [seleccion, setSeleccion] = useState<number | null>(null)
  const [anotando, setAnotando] = useState<Preparacion | null>(null)
  const [sobro, setSobro] = useState<Preparacion | null>(null)
  const [aviso, setAviso] = useState('')
  const [errorAccion, setErrorAccion] = useState('')

  const preps = useMemo(() => datos?.preps ?? [], [datos])
  // Un color por preparacion, el mismo en el mapa y en su tarjeta.
  const colorDe = useMemo(() => new Map(preps.map((p, i) => [p.id, colorFranja(i)])), [preps])
  const dispDe = (p: Preparacion) => datos?.disp.find((d) => d.preparacion_id === p.id)

  const editar = (p: Preparacion | 'nueva') =>
    router.push({ pathname: '/inventario/preparaciones/[id]', params: { id: p === 'nueva' ? 'nueva' : String(p.id) } })

  // La receta (por uno) a lo que de verdad rinde: el crudo que mas pesa pasa
  // a la cantidad que las tandas dicen que hace falta.
  async function ajustarReceta(r: RendimientoReal) {
    const p = preps.find((x) => x.id === r.preparacion_id)
    if (!p || r.crudo_id == null || r.sugerida_cantidad == null) return
    const sugerida = r.sugerida_cantidad
    setErrorAccion('')
    try {
      await apiPreparaciones.actualizar(p.id, {
        nombre: p.nombre,
        unidad: p.unidad,
        rinde: 1,
        modo_produccion: p.modo_produccion,
        vida_util_horas: p.vida_util_horas,
        lineas: p.lineas.map((l) => ({ ingrediente_id: l.ingrediente_id, cantidad: l.ingrediente_id === r.crudo_id ? sugerida : l.cantidad })),
      })
      refrescar()
    } catch (e) {
      setErrorAccion(mensajeDe(e, 'No se pudo ajustar la receta'))
    }
  }

  // Las tarjetas: una columna en el telefono, dos en la tablet parada y tres
  // en la acostada (como `md:grid-cols-2 xl:grid-cols-3` de la web).
  const columnas = ancho >= 1100 ? 3 : tablet ? 2 : 1
  // Con el ancho de verdad de la fila (onLayout), no el de la ventana: la
  // barra de desplazamiento del navegador o un redondeo mandarian la segunda
  // tarjeta a otra fila.
  const [anchoFila, setAnchoFila] = useState(0)
  // Mientras llega la medida, la de la ventana (sin los 16 px de cada lado).
  const fila = anchoFila || ancho - 32
  const anchoTarjeta = columnas === 1 ? undefined : Math.floor((fila - 12 * (columnas - 1)) / columnas) - (anchoFila ? 0 : 1)

  return (
    <Pantalla refrescando={refrescando} alRefrescar={refrescar} arriba={<Barra titulo="Preparado" />}>
      {error && !datos ? <Problema mensaje={error} alReintentar={refrescar} /> : null}
      {!datos && !error ? <Cargando /> : null}
      {errorAccion ? <Aviso texto={errorAccion} tono="peligro" /> : null}
      {aviso ? (
        <View style={{ gap: 0 }}>
          <Aviso texto={aviso} tono="exito" />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
            <Enlace texto="Cerrar" tono="tenue" alTocar={() => setAviso('')} />
          </View>
        </View>
      ) : null}

      {datos ? (
        <>
          {datos.rinde.map((r) => (
            <RindeDistinto key={r.preparacion_id} r={r} alAjustar={() => void ajustarReceta(r)} />
          ))}
          {datos.vencidas.length > 0 ? <Vencidas lista={datos.vencidas} alDecidir={setSobro} /> : null}

          {preps.length === 0 ? (
            <Vacio
              icono="cocina"
              titulo="Todavía no hay preparaciones"
              detalle="Ej.: guiso de pollo. Para 1 kg lleva 1,4 kg de pollo, 140 g de cebolla y 70 g de pimentón. Después el pastelito lleva «50 g de guiso»."
              accion={{ texto: 'Crear la primera', alTocar: () => editar('nueva') }}
            />
          ) : (
            <>
              <Ficha>
                <Cabecera
                  titulo="Qué crudo usa cada preparación"
                  ayuda="Elige una preparación y el mapa se queda en ella: qué crudo lleva y quién más lo usa. Lo que comparten dos preparaciones va en ámbar: compiten por ello. Tócala otra vez para soltarla."
                />
                <Mapa
                  preps={preps}
                  ingredientes={datos.ingredientes}
                  disp={datos.disp}
                  colorDe={colorDe}
                  seleccion={seleccion}
                  alSeleccionar={setSeleccion}
                  alEditar={editar}
                  dinero={(n) => dinero(n)}
                />
              </Ficha>

              <View
                onLayout={(e) => setAnchoFila(e.nativeEvent.layout.width)}
                style={{ flexDirection: columnas > 1 ? 'row' : 'column', flexWrap: 'wrap', gap: 12 }}
              >
                {preps.map((p) => (
                  <View key={p.id} style={anchoTarjeta ? { width: anchoTarjeta } : undefined}>
                    <TarjetaPreparacion
                      p={p}
                      d={dispDe(p)}
                      color={colorDe.get(p.id) ?? colorFranja(0)}
                      elegida={seleccion === p.id}
                      alSeleccionar={() => setSeleccion(seleccion === p.id ? null : p.id)}
                      dinero={(n) => dinero(n)}
                      alEditar={() => editar(p)}
                      alTanda={() => setAnotando(p)}
                      alSobro={() => setSobro(p)}
                    />
                  </View>
                ))}
                <View style={anchoTarjeta ? { width: anchoTarjeta } : undefined}>
                  <TarjetaNueva alTocar={() => editar('nueva')} />
                </View>
              </View>
            </>
          )}

          {datos.tandas.length > 0 ? <TandasDeLaSemana tandas={datos.tandas} dinero={(n) => dinero(n)} /> : null}
        </>
      ) : null}

      {anotando && datos ? (
        <AnotarTanda
          inicial={anotando}
          producibles={preps.filter((p) => p.modo_produccion === 'producir')}
          ingredientes={datos.ingredientes}
          alCerrar={() => setAnotando(null)}
          alHecho={() => {
            setAnotando(null)
            refrescar()
          }}
        />
      ) : null}
      {sobro ? (
        <SobroHoy
          p={sobro}
          alCerrar={() => setSobro(null)}
          alHecho={(mensaje) => {
            setSobro(null)
            setAviso(mensaje)
            refrescar()
          }}
        />
      ) : null}
    </Pantalla>
  )
}
