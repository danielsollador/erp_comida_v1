import { router, Stack, type Href } from 'expo-router'
import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { cuantoDura, datosDe, estadoStock } from '../../../../../frontend/src/lib/inventario'
import { ALMACEN_DE } from '../../../../../frontend/src/lib/tiposArticulo'
import { apiInventario } from '../../../lib/api-inventario'
import { useCarga } from '../../../lib/carga'
import { confirmar } from '../../../lib/dialogo'
import { useMoneda } from '../../../lib/moneda'
import { periodoDe } from '../../../lib/numeros'
import { LETRA, useTema } from '../../../lib/tema'
import type {
  CategoriaInsumo,
  CompraDeInsumo,
  DatosIngrediente,
  Equivalencia,
  ExtractoInsumo,
  Ingrediente,
  InsumoDelDeposito,
  Merma,
  TipoArticulo,
} from '../../../lib/tipos'
import { useDisposicion } from '../../kit'
import { Aviso, Boton, Cargando, Ficha, Nota, Pantalla, Problema, Pulsable } from '../../ui'
import { useAnotar } from '../acciones'
import { conUnidad, Enlace, legible, mensaje, pideConfirmar, Rotulo, unidadDe, useAvisoPasajero } from '../comun'
import { ExtractoCompleto, Ultimos } from './Extracto'
import Formulario, { estadoInicial, PieFormulario, validar, type Estado } from './Formulario'
import Fusionar from './Fusionar'
import VenderEnMenu from './VenderEnMenu'

/*
 * LA FICHA DE UNA MERCANCIA (pages/partes/inventario/FichaMercancia.tsx):
 * como esta, que se le anota y que le paso.
 *
 * Lo que se viene a mirar arriba, en tres cifras con palabras --cuanto hay,
 * para cuanto alcanza, cuanto cuesta--; despues lo que se viene a hacer, con
 * verbos ("Llegó mercancía", "Se dañó o se botó"); despues lo ultimo que le
 * paso, en frases, y el extracto completo detras de "Ver todo". Los datos de
 * la mercancia (que cambian una vez al año) quedan detras de "Cambiar los
 * datos", al pie y siempre a la vista (Leider, 2-oct).
 *
 * En la web es una ventana encima de la lista; en el telefono es su propia
 * pantalla (/inventario/mercancia/12), y volver regresa a la lista.
 */

type Datos = { ingredientes: Ingrediente[]; categorias: CategoriaInsumo[]; mermas: Merma[] }

async function cargarFicha(): Promise<Datos> {
  const { desde, hasta } = periodoDe('30d')
  const [ingredientes, categorias, mermas] = await Promise.all([
    apiInventario.ingredientes(),
    apiInventario.categorias().catch(() => [] as CategoriaInsumo[]),
    apiInventario.mermas(desde, hasta).catch(() => [] as Merma[]),
  ])
  return { ingredientes, categorias, mermas }
}

/** Crear una categoria sin salir de la ficha: la pide y devuelve su id. */
function useNuevaCategoria(pedirTexto: ReturnType<typeof useAnotar>['pedirTexto'], alError: (t: string) => void, alCreada: () => void) {
  return async (): Promise<number | null> => {
    const nombre = await pedirTexto({
      titulo: 'Nueva categoría',
      texto: 'Un cajón del inventario: Carnes, Lácteos, Empaques…',
      etiqueta: 'Nombre',
      aceptar: 'Crear',
    })
    if (!nombre?.trim()) return null
    try {
      const cat = await apiInventario.crearCategoria(nombre)
      alCreada()
      return cat.id
    } catch (e) {
      alError(mensaje(e))
      return null
    }
  }
}

// ── La ficha de una que ya existe ───────────────────────────────────────────

export function PantallaFicha({ id }: { id: number }) {
  const t = useTema()
  const { fmt } = useMoneda()
  const { tablet } = useDisposicion()
  const { datos, error, refrescando, refrescar } = useCarga(cargarFicha, 60, String(id))
  const avisos = useAvisoPasajero(5)
  // Cada movimiento anotado sube la version: el extracto, el historial y el
  // ritmo se vuelven a pedir justo cuando tienen que cambiar, no cada minuto.
  const [version, setVersion] = useState(0)
  const recargar = () => {
    refrescar()
    setVersion((v) => v + 1)
  }
  const anotar = useAnotar({ alCambio: recargar, alError: avisos.mal })
  const [editando, setEditando] = useState(false)
  const [f, setF] = useState<Estado | null>(null)
  const [errorForm, setErrorForm] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [fusionando, setFusionando] = useState(false)
  const [alMenu, setAlMenu] = useState(false)
  // El extracto completo, con filtro de fecha y descarga, detras de "Ver todo".
  const [todo, setTodo] = useState(false)
  const [desde, setDesde] = useState('')
  const [extracto, setExtracto] = useState<ExtractoInsumo | null>(null)
  const [historial, setHistorial] = useState<CompraDeInsumo[] | null>(null)
  // Para cuanto alcanza: el mismo calculo de Reportes > Inventario (consumo
  // real de los ultimos 30 dias), pedido solo para esta mercancia.
  const [ritmo, setRitmo] = useState<InsumoDelDeposito | null | undefined>(undefined)
  // Como llega del proveedor: "1 caja = 24". La mercancia es la malta; la
  // caja es como la vende cada proveedor.
  const [presentaciones, setPresentaciones] = useState<Equivalencia[]>([])

  const ing = datos?.ingredientes.find((i) => i.id === id) ?? null

  useEffect(() => {
    let vivo = true
    apiInventario
      .movimientos(id, 200, desde || undefined)
      .then((e) => vivo && setExtracto(e))
      .catch(() => vivo && setExtracto(null))
    return () => {
      vivo = false
    }
  }, [id, desde, version])

  useEffect(() => {
    let vivo = true
    apiInventario
      .historialCostos(id)
      .then((h) => vivo && setHistorial(h))
      .catch(() => vivo && setHistorial([]))
    const { desde: d, hasta: h } = periodoDe('30d')
    apiInventario
      .ritmo(id, d, h)
      .then((r) => vivo && setRitmo(r.por_insumo[0] ?? null))
      .catch(() => vivo && setRitmo(null))
    return () => {
      vivo = false
    }
  }, [id, version])

  useEffect(() => {
    apiInventario
      .equivalencias()
      .then((l) => setPresentaciones(l.filter((e) => e.ingrediente_id === id && Math.abs(e.factor - 1) > 1e-9)))
      .catch(() => setPresentaciones([]))
  }, [id])

  const nuevaCategoria = useNuevaCategoria(anotar.pedirTexto, setErrorForm, refrescar)

  if (!ing) {
    return (
      <Pantalla refrescando={refrescando} alRefrescar={refrescar}>
        <Stack.Screen options={{ title: 'Mercancía' }} />
        {error ? <Problema mensaje={error} alReintentar={refrescar} /> : datos ? <Problema mensaje="Esa mercancía no existe." /> : <Cargando />}
      </Pantalla>
    )
  }

  // Lo que el servidor pide confirmar (pasar a desechable con stock, archivar
  // algo que va en recetas) se pregunta aqui y se manda confirmado.
  async function actualizarConPregunta(d: DatosIngrediente): Promise<'ok' | 'no'> {
    try {
      await apiInventario.actualizar(ing!.id, d)
      return 'ok'
    } catch (e) {
      if (!pideConfirmar(e)) throw e
      const ok = await confirmar({ titulo: '¿Seguro?', texto: e.message.slice('Confirmar: '.length), aceptar: 'Sí, seguir', peligro: true })
      if (!ok) return 'no'
      await apiInventario.actualizar(ing!.id, d, true)
      return 'ok'
    }
  }

  async function guardar() {
    if (!f) return
    setErrorForm('')
    const v = validar(f, ing)
    if ('error' in v) return setErrorForm(v.error)
    setGuardando(true)
    try {
      if ((await actualizarConPregunta(v.datos)) === 'ok') {
        setEditando(false)
        avisos.bien('Cambios guardados.')
        recargar()
      }
    } catch (e) {
      setErrorForm(mensaje(e))
    } finally {
      setGuardando(false)
    }
  }

  // La web la archiva al instante y da unos segundos para deshacer; aqui no
  // hay "Deshacer", asi que se pregunta antes.
  async function archivar() {
    const ok = await confirmar({
      titulo: `¿Archivar ${ing!.nombre}?`,
      texto: 'Ya no aparece para comprar ni en las sugerencias. Su historia queda, y se puede reactivar desde la lista (Ver: Archivadas).',
      aceptar: 'Archivar',
      peligro: true,
    })
    if (!ok) return
    try {
      if ((await actualizarConPregunta({ ...datosDe(ing!), activo: false })) === 'ok') router.back()
    } catch (e) {
      setErrorForm(mensaje(e, 'No se pudo archivar'))
    }
  }

  async function reactivar() {
    try {
      if ((await actualizarConPregunta({ ...datosDe(ing!), activo: true })) === 'ok') {
        avisos.bien(`${ing!.nombre} volvió al inventario.`)
        recargar()
      }
    } catch (e) {
      avisos.mal(mensaje(e))
    }
  }

  // El aceite no va en recetas: se anota cuando se carga la freidora, y el
  // reporte lo reparte por pieza frita.
  async function cargarFreidora() {
    const cuanto = await anotar.pedirNumero({
      titulo: `Cargar ${ing!.nombre} a la freidora`,
      etiqueta: 'Cuánto se cargó',
      sufijo: ing!.unidad,
      ayuda: 'Sale del inventario y pasa a costo. Por unidad se reparte solo, con lo que se fríe en el mes.',
      min: 0.001,
    })
    if (!cuanto) return
    try {
      await apiInventario.cargarIndirecto(ing!.id, cuanto, 'Carga a la freidora')
      setEditando(false)
      avisos.bien(`Cargado: ${cuanto} ${unidadDe(cuanto, ing!.unidad)}.`)
      recargar()
    } catch (e) {
      setErrorForm(mensaje(e, 'No se pudo anotar'))
    }
  }

  // ── Cambiando los datos ──
  if (editando && f) {
    const extras = (
      <View style={s.enlaces}>
        {ing.tipo === 'reventa' ? <Enlace texto="Venderla en el menú" alTocar={() => setAlMenu(true)} /> : null}
        {ing.es_indirecto ? <Enlace texto="Cargar a la freidora" alTocar={() => void cargarFreidora()} /> : null}
        <Enlace texto="Es la misma que otra: fusionarlas" tono="tenue" alTocar={() => setFusionando(true)} />
        {ing.activo !== false ? <Enlace texto="Ya no la uso: archivarla" tono="peligro" alTocar={() => void archivar()} /> : null}
      </View>
    )
    return (
      <Pantalla
        abajo={
          <PieFormulario
            volver="Volver"
            alVolver={() => {
              setEditando(false)
              setErrorForm('')
            }}
            guardar="Guardar cambios"
            alGuardar={() => void guardar()}
            guardando={guardando}
          />
        }
      >
        <Stack.Screen options={{ title: ing.nombre }} />
        <Nota>Cambiar los datos de esta mercancía</Nota>
        {avisos.aviso ? <Aviso texto={avisos.aviso.texto} tono={avisos.aviso.tono} /> : null}
        <Formulario
          ing={ing}
          f={f}
          poner={(k, v) => setF((a) => (a ? { ...a, [k]: v } : a))}
          categorias={datos?.categorias ?? []}
          todas={datos?.ingredientes ?? []}
          alNuevaCategoria={nuevaCategoria}
          error={errorForm}
          extras={extras}
        />
        {alMenu ? (
          <VenderEnMenu
            mercancia={ing}
            alCerrar={() => setAlMenu(false)}
            alHecho={() => {
              setAlMenu(false)
              setEditando(false)
              avisos.bien(`${ing.nombre} ya está en el menú: venderla descuenta su existencia.`)
            }}
          />
        ) : null}
        {fusionando ? (
          <Fusionar
            origen={ing}
            ingredientes={datos?.ingredientes ?? []}
            alCerrar={() => setFusionando(false)}
            alHecho={(destino) => {
              setFusionando(false)
              // Se fundio en otra: se abre la que quedo.
              router.replace(`/inventario/mercancia/${destino.id}` as Href)
            }}
          />
        ) : null}
        {anotar.hojas}
      </Pantalla>
    )
  }

  // ── La ficha: como esta, que anotar, que le paso ──
  const u = ing.unidad
  const estado = estadoStock(ing)
  const dias = ritmo?.dias_de_stock
  const mermas = (datos?.mermas ?? []).filter((m) => m.ingrediente_id === ing.id && !m.revertida)
  const perdidaTotal = mermas.reduce((x, m) => x + m.valor, 0)
  const archivada = ing.activo === false

  const hay = (
    <CifraFicha
      titulo="Hay"
      valor={conUnidad(ing.stock_actual, u)}
      tono={estado?.tono}
      grande={!tablet}
      detalle={
        estado
          ? estado.tono === 'mal'
            ? 'Se acabó'
            : `Bajo el mínimo de ${conUnidad(ing.stock_minimo, u)}`
          : ing.stock_minimo > 0
            ? `Avisa por debajo de ${conUnidad(ing.stock_minimo, u)}`
            : 'Sin mínimo puesto'
      }
    />
  )
  const alcanza = (
    <CifraFicha
      titulo="Te alcanza para"
      valor={ritmo === undefined ? '…' : dias == null ? '—' : cuantoDura(dias)}
      detalle={
        ritmo === undefined ? ' ' : !ritmo || ritmo.por_dia <= 0 ? 'No se usó en los últimos 30 días' : `Se usan ${legible(ritmo.por_dia, u)} al día`
      }
    />
  )
  const cuesta = (
    <CifraFicha
      titulo="Te cuesta"
      valor={`${fmt(ing.costo_efectivo)} ${u === 'unidad' ? 'la unidad' : `el ${u}`}`}
      detalle={
        ing.tipo !== 'reventa' && ing.rendimiento_pct < 100
          ? `Pagas ${fmt(ing.costo_unitario)} y se aprovecha el ${ing.rendimiento_pct}%`
          : 'Lo que pagas, sin IVA'
      }
    />
  )

  return (
    <Pantalla
      refrescando={refrescando}
      alRefrescar={recargar}
      abajo={
        // AL PIE, SIEMPRE A LA VISTA. Al final de la ficha quedaba debajo de
        // cien movimientos y no se encontraba (Leider, 2-oct).
        <View style={[s.pie, { backgroundColor: t.superficie, borderTopColor: t.gris200 }]}>
          <Boton
            texto="Cambiar los datos"
            tono="neutro"
            alTocar={() => {
              setF(estadoInicial(ing))
              setErrorForm('')
              setEditando(true)
            }}
          />
        </View>
      }
    >
      <Stack.Screen options={{ title: ing.nombre }} />
      <Nota>
        {ing.categoria || 'Sin categoría'} · {ALMACEN_DE[ing.tipo].detalle}
      </Nota>
      {avisos.aviso ? <Aviso texto={avisos.aviso.texto} tono={avisos.aviso.tono} /> : null}
      {errorForm ? <Aviso texto={errorForm} tono="peligro" /> : null}
      {archivada ? (
        <Ficha tono="aviso" style={{ gap: 10 }}>
          <Text style={[s.texto, { color: t.aviso }]}>Archivada: no aparece para comprar ni en las sugerencias.</Text>
          <View style={{ alignSelf: 'flex-start', minWidth: 140 }}>
            <Boton texto="Reactivar" tono="neutro" alTocar={() => void reactivar()} />
          </View>
        </Ficha>
      ) : null}

      {/* Las tres preguntas, en cifras con palabras. */}
      {tablet ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>{hay}</View>
          <View style={{ flex: 1 }}>{alcanza}</View>
          <View style={{ flex: 1 }}>{cuesta}</View>
        </View>
      ) : (
        <>
          {hay}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>{alcanza}</View>
            <View style={{ flex: 1 }}>{cuesta}</View>
          </View>
        </>
      )}

      {perdidaTotal > 0 ? (
        <Text style={[s.texto, { color: t.suave }]}>
          Se perdieron <Text style={{ fontFamily: LETRA.cifraFuerte, color: t.peligro }}>{fmt(perdidaTotal)}</Text> en los últimos 30 días
          {mermas.length > 1 ? ` (${mermas.length} veces)` : ''}.
        </Text>
      ) : null}

      {presentaciones.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Rotulo>Cómo te llega</Rotulo>
          <View style={s.chips}>
            {presentaciones.map((e) => (
              <View key={e.id} style={[s.chip, { borderColor: t.gris200, backgroundColor: t.superficie }]}>
                <Text style={[s.chipFuerte, { color: t.tinta }]}>
                  1 {e.unidad_papel || 'paquete'} = {Number(e.factor.toFixed(4))} {unidadDe(e.factor, e.unidad)}
                </Text>
                <Text style={[s.chipTexto, { color: t.suave }]}> · {e.proveedor_nombre || e.proveedor_rif}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* Lo que se viene a hacer, con verbos. */}
      <View style={{ gap: 8 }}>
        <Rotulo>Anotar</Rotulo>
        <View style={s.anotar}>
          <BotonAnotar titulo="Llegó mercancía" detalle="Una compra sin factura" alTocar={() => void anotar.comprar(ing)} />
          <BotonAnotar titulo="Se dañó o se botó" detalle="Queda como pérdida" peligro alTocar={() => void anotar.merma(ing)} />
          <BotonAnotar titulo="La usó el personal" detalle="Comida de empleados: no es pérdida" alTocar={() => void anotar.consumoPersonal(ing)} />
          <BotonAnotar titulo="Contar lo que hay" detalle="Lo que diga la balanza manda" alTocar={() => void anotar.contar(ing)} />
        </View>
      </View>

      {/* Lo ultimo que le paso, en frases. El extracto entero, detras. */}
      <View style={{ gap: 8 }}>
        <Rotulo
          derecha={
            extracto && (todo || extracto.movimientos.length > 0) ? (
              <Enlace texto={todo ? 'Ver menos' : 'Ver todo'} alTocar={() => setTodo((v) => !v)} />
            ) : null
          }
        >
          {todo ? 'Todo lo que le pasó' : 'Lo último que le pasó'}
        </Rotulo>
        {extracto === null ? (
          <Text style={[s.texto, { color: t.tenue }]}>Cargando…</Text>
        ) : extracto.movimientos.length === 0 && !desde ? (
          <Text style={[s.texto, { color: t.suave }]}>Todavía no le ha pasado nada: no se ha comprado, vendido ni contado.</Text>
        ) : !todo ? (
          <Ultimos extracto={extracto} unidad={u} />
        ) : (
          <ExtractoCompleto
            extracto={extracto}
            historial={historial}
            unidad={u}
            nombre={ing.nombre}
            idMercancia={ing.id}
            rutaCsv={apiInventario.rutaExportarMovimientos(ing.id, desde || undefined)}
            desde={desde}
            alCambiarDesde={setDesde}
            alError={avisos.mal}
          />
        )}
      </View>
      {anotar.hojas}
    </Pantalla>
  )
}

/** Una de las tres cifras de arriba de la ficha. */
function CifraFicha({
  titulo,
  valor,
  detalle,
  tono,
  grande = false,
}: {
  titulo: string
  valor: string
  detalle: string
  tono?: 'mal' | 'ojo'
  grande?: boolean
}) {
  const t = useTema()
  return (
    <Ficha
      style={[
        { padding: 16, gap: 2 },
        tono === 'mal' && { backgroundColor: t.peligroSuave, borderColor: t.peligroSuave },
        tono === 'ojo' && { backgroundColor: t.avisoSuave, borderColor: t.avisoLinea },
      ]}
    >
      <Text style={[s.cifraTitulo, { color: t.tenue }]}>{titulo}</Text>
      <Text style={[grande ? s.cifraGrande : s.cifra, { color: t.tinta }]} numberOfLines={1} adjustsFontSizeToFit>
        {valor}
      </Text>
      <Text style={[s.cifraDetalle, { color: tono === 'mal' ? t.peligro : tono === 'ojo' ? t.aviso : t.suave }]}>{detalle}</Text>
    </Ficha>
  )
}

/** Un boton de "Anotar": el verbo grande, lo que significa debajo. */
function BotonAnotar({ titulo, detalle, peligro = false, alTocar }: { titulo: string; detalle: string; peligro?: boolean; alTocar: () => void }) {
  const t = useTema()
  return (
    <Pulsable alTocar={alTocar} etiqueta={titulo} style={[s.anotarBoton, { backgroundColor: t.superficie, borderColor: t.gris200 }]}>
      <Text style={[s.anotarTitulo, { color: peligro ? t.peligro : t.tinta }]}>{titulo}</Text>
      <Text style={[s.anotarDetalle, { color: t.suave }]}>{detalle}</Text>
    </Pulsable>
  )
}

// ── Una nueva ───────────────────────────────────────────────────────────────

/**
 * Crear una mercancia: solo el formulario, con el almacen desde el que se
 * abrio ya elegido. Al crearla se vuelve a donde se estaba (la lista la
 * muestra), como en la web.
 */
export function PantallaNueva({ tipo }: { tipo?: TipoArticulo }) {
  const { datos, refrescar } = useCarga(cargarFicha, 300)
  const [f, setF] = useState<Estado>(() => estadoInicial(null, tipo))
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const anotar = useAnotar({ alCambio: refrescar, alError: setError })
  const nuevaCategoria = useNuevaCategoria(anotar.pedirTexto, setError, refrescar)

  async function crear() {
    setError('')
    const v = validar(f, null)
    if ('error' in v) return setError(v.error)
    setGuardando(true)
    try {
      await apiInventario.crear(v.datos)
      if (router.canGoBack()) router.back()
      else router.replace('/inventario' as Href)
    } catch (e) {
      setError(mensaje(e))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Pantalla
      abajo={
        <PieFormulario
          volver="Cancelar"
          alVolver={() => (router.canGoBack() ? router.back() : router.replace('/inventario' as Href))}
          guardar="Crear mercancía"
          alGuardar={() => void crear()}
          guardando={guardando}
        />
      }
    >
      <Stack.Screen options={{ title: 'Nueva mercancía' }} />
      <Nota>Lo indispensable para empezar; lo demás se puede poner después.</Nota>
      <Formulario
        ing={null}
        f={f}
        poner={(k, v) => setF((a) => ({ ...a, [k]: v }))}
        categorias={datos?.categorias ?? []}
        todas={datos?.ingredientes ?? []}
        alNuevaCategoria={nuevaCategoria}
        error={error}
      />
      {anotar.hojas}
    </Pantalla>
  )
}

const s = StyleSheet.create({
  texto: { fontFamily: LETRA.texto, fontSize: 14.5, lineHeight: 20 },
  pie: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth },
  enlaces: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, paddingHorizontal: 4 },
  cifraTitulo: { fontFamily: LETRA.textoFuerte, fontSize: 13 },
  cifra: { fontFamily: LETRA.tituloFuerte, fontSize: 20, letterSpacing: -0.4 },
  cifraGrande: { fontFamily: LETRA.tituloFuerte, fontSize: 30, letterSpacing: -0.7 },
  cifraDetalle: { fontFamily: LETRA.texto, fontSize: 13, lineHeight: 17, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipFuerte: { fontFamily: LETRA.textoFuerte, fontSize: 13 },
  chipTexto: { fontFamily: LETRA.texto, fontSize: 13 },
  anotar: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  anotarBoton: { width: '48.6%', flexGrow: 1, borderRadius: 16, borderCurve: 'continuous', borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, minHeight: 64 },
  anotarTitulo: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  anotarDetalle: { fontFamily: LETRA.texto, fontSize: 13, lineHeight: 17, marginTop: 2 },
})
