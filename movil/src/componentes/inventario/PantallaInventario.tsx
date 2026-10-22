import { router, Stack, useLocalSearchParams, type Href } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { datosDe } from '../../../../frontend/src/lib/inventario'
import { ALMACEN_DE } from '../../../../frontend/src/lib/tiposArticulo'
import * as almacen from '../../lib/almacen'
import { apiInventario } from '../../lib/api-inventario'
import { useCarga } from '../../lib/carga'
import { confirmar } from '../../lib/dialogo'
import { LETRA, useTema } from '../../lib/tema'
import type { Configuracion, Ingrediente } from '../../lib/tipos'
import { Hoja, OpcionHoja } from '../Hoja'
import { BarraAccion } from '../kit'
import { Aviso, Boton, Cargando, Ficha, Pantalla, Pestanas, Problema } from '../ui'
import { ir, mensaje, pideConfirmar, TIPO_DE, useAvisoPasajero } from './comun'
import { useAnotar } from './acciones'
import Categorias from './Categorias'
import { cargarInventario, resumenes, SECCIONES, type Seccion } from './datos'
import Desechables from './Desechables'
import ListaMercancia, { CabezaAlmacen } from './ListaMercancia'
import Portada from './Portada'
import QueComprar from './QueComprar'

/*
 * EL INVENTARIO (pages/Inventario.tsx de la web): los cuatro almacenes de la
 * pizarra (7-oct-2026).
 *
 *   Reventa        compra → inventario → menú → venta
 *   Materia prima  compra → crudo → preparado → menú
 *   Consumible     compra → inventario → receta
 *   Desechable     compra → gasto (sin stock)
 *
 * La portada son los cuatro; se entra a uno y se ve su mercancia. Arriba,
 * las mismas tres pestañas de la web: Almacenes, Qué comprar y Control.
 * La seccion vive en la ruta (/inventario/reventa), como en la web; entrar a
 * un almacen es una pantalla nueva, asi el gesto de volver regresa a la
 * portada. La cara "Preparado" de la materia prima, el Control y el Conteo
 * fisico son pantallas propias (inventario/preparaciones, /control, /conteo).
 */

const PESTANAS = [
  { id: 'almacenes', texto: 'Almacenes' },
  { id: 'comprar', texto: 'Qué comprar' },
  { id: 'control', texto: 'Control' },
] as const

// La cara de la materia prima que se eligio la ultima vez (Leider, 8-oct:
// "que se guarde dónde estuviste"). La misma clave de la web.
const CLAVE_CARA = 'vp-inventario-cara'

export default function PantallaInventario() {
  const t = useTema()
  const params = useLocalSearchParams<{ seccion?: string; ver?: string }>()
  const seccion: Seccion = SECCIONES.includes(params.seccion as Seccion) ? (params.seccion as Seccion) : 'almacenes'
  const tipo = TIPO_DE[seccion]
  const { datos, error, refrescando, refrescar } = useCarga(() => cargarInventario(seccion), 60, seccion)
  const avisos = useAvisoPasajero()
  const anotar = useAnotar({ alCambio: refrescar, alError: avisos.mal })
  const [config, setConfig] = useState<Configuracion | null>(null)
  const [cambiandoConfig, setCambiandoConfig] = useState(false)
  const [masOpciones, setMasOpciones] = useState(false)
  const conf = config ?? datos?.config ?? null

  // Los avisos de la portada llegan con ?ver=preparado: van directo a las
  // preparaciones. Ya NO se salta solo por la cara recordada: entrar a
  // Materia prima y aparecer en Preparado desconcertaba (Leider, 22-oct);
  // la cara se recuerda solo para marcar cual estaba.
  const yaSalto = useRef(false)
  useEffect(() => {
    if (seccion !== 'materia-prima' || yaSalto.current) return
    yaSalto.current = true
    if (params.ver === 'preparado') router.replace('/inventario/preparaciones' as Href)
  }, [seccion, params.ver])

  function elegirCara(cara: 'crudo' | 'preparado') {
    almacen.guardar(CLAVE_CARA, cara).catch(() => undefined)
    if (cara === 'preparado') ir('/inventario/preparaciones')
  }

  async function alternarVentaSinInventario() {
    if (!conf) return
    setCambiandoConfig(true)
    try {
      setConfig(await apiInventario.venderSinInventario(!conf.vender_sin_inventario))
    } catch (e) {
      avisos.mal(mensaje(e, 'No se pudo cambiar'))
    } finally {
      setCambiandoConfig(false)
    }
  }

  // Lo que el servidor pide confirmar (reactivar una que choca con otra no;
  // eso es un error) se pregunta aqui y se manda confirmado.
  async function reactivar(ing: Ingrediente) {
    try {
      await apiInventario.actualizar(ing.id, { ...datosDe(ing), activo: true }).catch(async (e) => {
        if (!pideConfirmar(e)) throw e
        const ok = await confirmar({
          titulo: '¿Seguro?',
          texto: e.message.slice('Confirmar: '.length),
          aceptar: 'Sí, seguir',
          peligro: true,
        })
        if (!ok) return
        await apiInventario.actualizar(ing.id, { ...datosDe(ing), activo: true }, true)
      })
      avisos.bien(`${ing.nombre} volvió al inventario.`)
      refrescar()
    } catch (e) {
      avisos.mal(mensaje(e))
    }
  }

  // Arranque del local: mientras no haya mercancia ni recetas, NO bloquea la
  // venta. Solo a la vista cuando esta prendido.
  const sinControl = conf?.vender_sin_inventario ? (
    <Ficha tono="aviso" style={{ gap: 10 }}>
      <View>
        <Text style={[s.sinControlTitulo, { color: t.avisoFuerte }]}>Vender sin control de inventario</Text>
        <Text style={[s.sinControlTexto, { color: t.aviso }]}>
          Prendido: ninguna venta se traba por falta de stock, aunque un producto tenga receta.
        </Text>
      </View>
      <View style={{ alignSelf: 'flex-start', minWidth: 120 }}>
        <Boton texto="Apagar" tono="neutro" alTocar={() => void alternarVentaSinInventario()} ocupado={cambiandoConfig} />
      </View>
    </Ficha>
  ) : null

  const aviso = avisos.aviso ? <Aviso texto={avisos.aviso.texto} tono={avisos.aviso.tono} /> : null
  const cargando = !datos && !error
  const problema = error && !datos ? <Problema mensaje={error} alReintentar={refrescar} /> : null

  // ── Dentro de un almacen con lista (materia prima, reventa, consumibles) ──
  if (tipo && tipo !== 'desechable') {
    const delAlmacen = (datos?.ingredientes ?? []).filter((i) => i.tipo === tipo)
    const r = datos ? resumenes(datos.ingredientes, 0).find((x) => x.tipo === tipo) : undefined
    return (
      <>
        <ListaMercancia
          tipo={tipo}
          ingredientes={delAlmacen}
          categorias={datos?.categorias ?? []}
          resumen={r}
          cargando={cargando}
          error={error}
          refrescando={refrescando}
          alRefrescar={refrescar}
          alReactivar={(ing) => void reactivar(ing)}
          cabeceraExtra={
            <View style={{ gap: 12 }}>
              {aviso}
              {sinControl}
              <CabezaAlmacen
                tipo={tipo}
                mercancias={delAlmacen.filter((i) => i.activo !== false).length}
                preparaciones={r?.preparaciones ?? 0}
                alCrudo={() => elegirCara('crudo')}
                alPreparado={() => elegirCara('preparado')}
              />
            </View>
          }
        />
        {anotar.hojas}
      </>
    )
  }

  // ── Desechables: sin stock, hay plata ──
  if (tipo === 'desechable') {
    return (
      <Pantalla
        refrescando={refrescando}
        alRefrescar={refrescar}
        abajo={<BarraAccion texto="Nueva mercancía" alTocar={() => ir('/inventario/mercancia/nueva?tipo=desechable')} />}
      >
        <Stack.Screen options={{ title: ALMACEN_DE.desechable.texto }} />
        {aviso}
        {sinControl}
        <CabezaAlmacen tipo="desechable" mercancias={0} preparaciones={0} alCrudo={() => undefined} alPreparado={() => undefined} />
        {problema}
        {cargando ? <Cargando /> : null}
        {datos ? <Desechables ingredientes={datos.ingredientes.filter((i) => i.tipo === 'desechable')} facturas={datos.facturas} /> : null}
      </Pantalla>
    )
  }

  // ── Categorias ──
  if (seccion === 'categorias') {
    return (
      <Pantalla refrescando={refrescando} alRefrescar={refrescar}>
        <Stack.Screen options={{ title: 'Categorías del inventario' }} />
        {problema}
        {cargando ? <Cargando /> : null}
        {datos ? <Categorias categorias={datos.categorias} ingredientes={datos.ingredientes} alCambio={refrescar} /> : null}
      </Pantalla>
    )
  }

  // ── La portada y Qué comprar ──
  const activos = (datos?.ingredientes ?? []).filter((i) => i.activo !== false)
  return (
    <Pantalla
      refrescando={refrescando}
      alRefrescar={refrescar}
      abajo={
        // Las dos acciones de la web, abajo al alcance del pulgar (como en
        // cada almacen): contar a la izquierda, crear como boton principal.
        seccion === 'almacenes' ? (
          <BarraAccion
            izquierda={
              <Pressable
                onPress={() => ir('/inventario/conteo')}
                disabled={!datos || activos.length === 0}
                accessibilityRole="button"
                style={({ pressed }) => [
                  s.conteo,
                  {
                    opacity: !datos || activos.length === 0 ? 0.4 : pressed ? 0.6 : 1,
                  },
                ]}
              >
                <Text style={[s.conteoTexto, { color: t.tinta }]}>Conteo físico</Text>
              </Pressable>
            }
            texto="Nueva mercancía"
            alTocar={() => ir('/inventario/mercancia/nueva?tipo=insumo')}
          />
        ) : undefined
      }
      arriba={
        <View style={s.acciones}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Pestanas
              opciones={PESTANAS.map((p) => ({ id: p.id, texto: p.texto }))}
              valor={seccion === 'comprar' ? 'comprar' : 'almacenes'}
              alCambiar={(id) => (id === 'control' ? ir('/inventario/control') : router.setParams({ seccion: id }))}
            />
          </View>
          {conf ? (
            <Pressable
              onPress={() => setMasOpciones(true)}
              accessibilityLabel="Más opciones del inventario"
              style={({ pressed }) => [
                s.mas,
                {
                  borderColor: t.gris200,
                  backgroundColor: pressed ? t.gris100 : t.superficie,
                },
              ]}
            >
              <Text style={[s.masTexto, { color: t.suave }]}>⋯</Text>
            </Pressable>
          ) : null}
        </View>
      }
    >
      <Stack.Screen options={{ title: 'Inventario' }} />
      {aviso}
      {sinControl}
      {problema}

      {seccion === 'almacenes' ? (
        <>
          <Portada datos={datos} alComprar={(ing) => void anotar.comprar(ing)} alVerComprar={() => router.setParams({ seccion: 'comprar' })} />
        </>
      ) : null}

      {seccion === 'comprar' ? (
        cargando ? (
          <Cargando />
        ) : datos ? (
          <QueComprar
            sugerencias={datos.sugerencias}
            ingredientes={datos.ingredientes}
            inflacion={datos.inflacion}
            alComprar={(ing) => void anotar.comprar(ing)}
          />
        ) : null
      ) : null}

      <Hoja visible={masOpciones} alCerrar={() => setMasOpciones(false)} titulo="Más opciones del inventario">
        {conf ? (
          <OpcionHoja
            texto={conf.vender_sin_inventario ? 'Apagar la venta sin control de inventario' : 'Vender sin control de inventario'}
            detalle={
              conf.vender_sin_inventario
                ? 'Las ventas vuelven a descontar y trabarse por stock'
                : 'Para arrancar sin mercancía ni recetas: ninguna venta se traba por stock'
            }
            alTocar={() => {
              setMasOpciones(false)
              void alternarVentaSinInventario()
            }}
          />
        ) : null}
        <OpcionHoja
          texto="Administrar categorías"
          detalle="crear, renombrar, mover mercancía"
          alTocar={() => {
            setMasOpciones(false)
            ir('/inventario/categorias')
          }}
        />
      </Hoja>
      {anotar.hojas}
    </Pantalla>
  )
}

const s = StyleSheet.create({
  sinControlTitulo: { fontFamily: LETRA.titulo, fontSize: 16 },
  sinControlTexto: {
    fontFamily: LETRA.texto,
    fontSize: 13.5,
    lineHeight: 19,
    marginTop: 2,
  },
  acciones: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  conteo: { minHeight: 50, justifyContent: 'center' },
  conteoTexto: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  mas: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  masTexto: { fontFamily: LETRA.textoFuerte, fontSize: 20, lineHeight: 22 },
})
