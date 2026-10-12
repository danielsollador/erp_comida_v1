import { router, type Href } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { datosDe, unidadDe } from '../../../../frontend/src/lib/inventario'
import { apiPreparaciones } from '../../lib/api-preparaciones'
import { useMoneda } from '../../lib/moneda'
import { LETRA, useTema } from '../../lib/tema'
import type { DatosPreparacion, Ingrediente, Preparacion } from '../../lib/tipos'
import { Barra } from '../Encabezado'
import { BarraAccion, useDisposicion } from '../kit'
import { Aviso, Ficha, Pantalla, Pestanas } from '../ui'
import Agregar from './Agregar'
import { colorFranja } from './colores'
import {
  ajustarAUno,
  aNum,
  cantidadLegible,
  cuentasDeOlla,
  errorSePasa,
  esGrande,
  fmtCant,
  porQueElKilo,
  queHacer,
  unidadLarga,
  type FilaOlla,
} from './cuentas'
import DibujoOlla from './DibujoOlla'
import { Caja, mensajeDe } from './piezas'
import RenglonOlla from './RenglonOlla'

const UNIDADES: { id: string; texto: string }[] = [
  { id: 'kg', texto: 'kg' },
  { id: 'lt', texto: 'litro' },
  { id: 'unidad', texto: 'unidad' },
]

/**
 * LA OLLA: el editor de la receta de una preparacion, igual que la web
 * (`Olla` en pages/partes/inventario/Preparaciones.tsx). A la izquierda (en
 * el telefono, arriba) el recipiente que se llena con lo que lleva; a la
 * derecha (abajo) "Lleva" y "Agregar".
 *
 * LA RECETA ES POR UNO (Leider, 8-oct): lo que lleva 1 kg de guiso (o 1 lt de
 * jugo, o 1 unidad). Asi lo que cuesta el kilo es la suma de lo que lleva, y
 * para hacer 2 kg el sistema multiplica.
 *
 * LA MERMA VA EN EL CRUDO, NO EN LO PREPARADO (7-oct): a cada ingrediente se
 * le dice cuanto entra y cuanto se aprovecha al cocinarlo ("1 kg de pollo,
 * queda el 70 %"). Con eso la olla comprueba que lo que queda sume el kilo.
 * Si se pasa, no se guarda (11-oct); si no llega, se avisa en ambar y se
 * deja guardar. "Ajustar al kilo" reparte en proporcion.
 */
export default function Olla({ prep, ingredientes }: { prep: Preparacion | null; ingredientes: Ingrediente[] }) {
  const t = useTema()
  const { fmt: dinero } = useMoneda()
  const { tablet, ancho } = useDisposicion()
  const [nombre, setNombre] = useState(prep?.nombre ?? '')
  const [unidad, setUnidad] = useState(prep?.unidad ?? 'kg')
  const porId = useMemo(() => new Map(ingredientes.map((i) => [i.id, i])), [ingredientes])
  const [filas, setFilas] = useState<FilaOlla[]>(() =>
    prep
      ? prep.lineas.map((l) => ({
          ingrediente_id: l.ingrediente_id,
          cantidad: String(l.cantidad),
          aprovechable: String(porId.get(l.ingrediente_id)?.rendimiento_pct ?? 100),
        }))
      : [],
  )
  const [resaltado, setResaltado] = useState<number | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const { partes, costoTanda, enSuUnidad, queda, desajuste, sePasa, falta, sinMedir } = cuentasDeOlla(filas, porId, unidad)
  const larga = unidadLarga(unidad)
  const enReceta = new Set(filas.map((f) => f.ingrediente_id))
  // El renglon de la receta en una sola linea (con su costo) solo cuando la
  // columna da: en la tablet parada (768) son ~410 px y no caben las columnas.
  const renglonAncho = tablet && ancho >= 1000

  function actualizar(id: number, cambios: Partial<FilaOlla>) {
    setFilas((prev) => prev.map((f) => (f.ingrediente_id === id ? { ...f, ...cambios } : f)))
  }

  function agregar(ing: Ingrediente) {
    setFilas((prev) => [
      ...prev,
      {
        ingrediente_id: ing.id,
        cantidad: '',
        aprovechable: String(ing.tipo === 'preparacion' ? 100 : ing.rendimiento_pct),
        enChica: esGrande(ing.unidad),
      },
    ])
  }

  function volver() {
    if (router.canGoBack()) router.back()
    // `as Href`: las rutas tipadas que genera Metro todavia la escriben con su
    // /index; la ruta de verdad es esta.
    else router.replace('/inventario/preparaciones' as Href)
  }

  async function guardar() {
    setError('')
    const limpias = filas.filter((f) => f.ingrediente_id && aNum(f.cantidad) > 0)
    if (!nombre.trim()) return setError('Ponle nombre a la preparación.')
    if (limpias.length === 0) return setError('Agrega al menos un ingrediente con su cantidad.')
    // La olla es 1 kg: una receta que se pasa no se guarda (Leider, 11-oct).
    // Una que se queda corta se avisa (en pantalla) pero se deja guardar.
    if (sePasa) return setError(errorSePasa(queda, unidad))
    setGuardando(true)
    try {
      // El % que se aprovecha es del crudo: si cambio, se guarda en su ficha.
      for (const f of limpias) {
        const ing = porId.get(f.ingrediente_id)
        const pct = Math.min(Math.max(aNum(f.aprovechable) || 100, 1), 100)
        if (ing && ing.tipo !== 'preparacion' && Math.abs(pct - ing.rendimiento_pct) > 0.001) {
          await apiPreparaciones.actualizarIngrediente(ing.id, { ...datosDe(ing), rendimiento_pct: pct })
        }
      }
      const datos: DatosPreparacion = {
        nombre: nombre.trim(),
        unidad,
        // La receta es por uno: lo que rinde es, por definicion, 1.
        rinde: 1,
        modo_produccion: prep?.modo_produccion ?? 'descontar',
        vida_util_horas: prep?.vida_util_horas ?? null,
        lineas: limpias.map((l) => ({ ingrediente_id: l.ingrediente_id, cantidad: aNum(l.cantidad) })),
      }
      if (prep) await apiPreparaciones.actualizar(prep.id, datos)
      else await apiPreparaciones.crear(datos)
      volver()
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo guardar'))
    } finally {
      setGuardando(false)
    }
  }

  // El ancho de la olla: lo que deja la losa, sin pasar de 280 (telefono) o
  // 300 (tablet, en su columna de 5 de 12 como la web).
  const anchoOlla = tablet ? Math.min(((ancho - 44) * 5) / 12 - 40, 300) : Math.min(ancho - 72, 280)

  const losaOlla = (
    <Ficha style={{ gap: 12 }}>
      <View>
        <TextInput
          value={nombre}
          onChangeText={setNombre}
          placeholder="¿Cómo se llama? Ej. Guiso de pollo"
          placeholderTextColor={t.tenue}
          accessibilityLabel="Nombre de la preparación"
          autoFocus={!prep}
          style={[o.nombre, { color: t.tinta }]}
        />
        <View style={o.mide}>
          <Text style={[o.mideTexto, { color: t.suave }]}>Se mide en</Text>
          <Pestanas opciones={UNIDADES} valor={unidad} alCambiar={setUnidad} />
        </View>
        <Text style={[o.ayuda, { color: t.suave }]}>Lo que lleva 1 {larga} ya hecho. Para hacer más, el sistema multiplica.</Text>
      </View>

      <DibujoOlla
        partes={partes.map((x) => ({
          id: x.id,
          nombre: x.nombre,
          detalle: x.cantidad > 0 ? cantidadLegible(x.cantidad, x.unidad) : '',
          valor: x.costo,
          medida: x.enSuMedida !== null ? x.queda : null,
          color: x.color,
        }))}
        total={costoTanda}
        unidad={unidad}
        formato={(n) => dinero(n)}
        resaltado={resaltado}
        alResaltar={setResaltado}
        ancho={anchoOlla}
        agregarAbajo={!tablet}
      />

      {/* Lo que queda ya cocido tiene que dar el kilo. Si no, un toque pasa
          la tanda que escribio la cocina a la receta por kilo. */}
      <View style={o.par}>
        <Caja tono={desajuste ? 'aviso' : 'neutro'} estilo={{ flex: 1, paddingVertical: 10 }}>
          <Text style={[o.parRotulo, { color: desajuste ? t.avisoFuerte : t.tenue }]}>Queda cocido</Text>
          <Text style={[o.parCifra, { color: t.tinta }]} numberOfLines={1} adjustsFontSizeToFit>
            {enSuUnidad.length > 0 && queda > 0 ? `${fmtCant(queda)} ${unidadDe(queda, unidad)}` : '—'}
          </Text>
          {desajuste ? (
            <Pressable onPress={() => setFilas((prev) => ajustarAUno(prev, queda))} hitSlop={10} accessibilityRole="button">
              <Text style={[o.ajustar, { color: t.avisoFuerte }]}>Ajustar al {larga}</Text>
            </Pressable>
          ) : (
            <Text style={[o.parNota, { color: t.tenue }]}>
              {enSuUnidad.length === 0 ? `nada se mide en ${unidad === 'unidad' ? 'unidades' : unidad}` : `debe dar 1 ${larga}`}
            </Text>
          )}
        </Caja>
        <Caja estilo={{ flex: 1, paddingVertical: 10 }}>
          <Text style={[o.parRotulo, { color: t.tenue }]}>Cuesta</Text>
          <Text style={[o.parCifra, { color: t.tinta }]} numberOfLines={1} adjustsFontSizeToFit>
            {costoTanda > 0 ? dinero(costoTanda) : '—'}
            <Text style={[o.parNota, { color: t.tenue }]}> el {unidad}</Text>
          </Text>
          <Text style={[o.parNota, { color: t.tenue }]}>cada {larga} ya preparado</Text>
        </Caja>
      </View>
    </Ficha>
  )

  const [negrita, resto] = porQueElKilo(unidad)
  const derecha = (
    <View style={{ gap: 12 }}>
      {/* Por que la olla es 1 kg y que hacer si no da. Siempre que no de, no
          solo al intentar guardar (Leider, 11-oct). */}
      {sePasa || falta ? (
        <Caja tono={sePasa ? 'peligro' : 'aviso'}>
          <Text style={[o.aviso, { color: sePasa ? t.peligro : t.avisoFuerte }]}>
            <Text style={{ fontFamily: LETRA.textoFuerte }}>{negrita}</Text>
            {resto}
          </Text>
          <Text style={[o.aviso, { color: sePasa ? t.peligro : t.avisoFuerte, marginTop: 6 }]}>{queHacer(sePasa, queda, unidad, sinMedir)}</Text>
        </Caja>
      ) : null}

      {filas.length > 0 ? (
        <Ficha style={{ paddingHorizontal: 0, paddingVertical: 14 }}>
          <Text style={[o.llevaTitulo, { color: t.tinta }]}>
            Lleva 1 {larga}
            {tablet ? <Text style={[o.llevaNota, { color: t.tenue }]}> · crudo, y lo que queda de cada uno</Text> : null}
          </Text>
          {renglonAncho ? (
            <View style={[o.columnas, { borderBottomColor: t.gris200 }]}>
              <Text style={[o.columna, { color: t.tenue, flex: 1, marginLeft: 18 }]}>Mercancía</Text>
              <Text style={[o.columna, { color: t.tenue, width: 150, textAlign: 'right' }]}>Entra</Text>
              <Text style={[o.columna, { color: t.tenue, width: 92, textAlign: 'right' }]}>Queda</Text>
              <Text style={[o.columna, { color: t.tenue, width: 72, textAlign: 'right' }]}>Costo</Text>
              <View style={{ width: 36 }} />
            </View>
          ) : null}
          {filas.map((f, i) => {
            const ing = porId.get(f.ingrediente_id)
            if (!ing) return null
            return (
              <RenglonOlla
                key={f.ingrediente_id}
                f={f}
                ing={ing}
                color={colorFranja(i)}
                resaltado={resaltado === ing.id}
                alResaltar={setResaltado}
                alCambiar={(c) => actualizar(ing.id, c)}
                alQuitar={() => setFilas((prev) => prev.filter((x) => x.ingrediente_id !== ing.id))}
                dinero={dinero}
                ancha={renglonAncho}
                ultima={i === filas.length - 1}
              />
            )
          })}
        </Ficha>
      ) : null}

      <Agregar
        ingredientes={ingredientes}
        enReceta={enReceta}
        prepId={prep?.id ?? null}
        vacia={filas.length === 0}
        alAgregar={agregar}
        dinero={(n) => dinero(n)}
      />
    </View>
  )

  return (
    <Pantalla
      arriba={<Barra titulo={prep ? 'Receta' : 'Nueva preparación'} />}
      abajo={
        <View>
          {error ? (
            <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
              <Aviso texto={error} tono="peligro" />
            </View>
          ) : null}
          <BarraAccion
            izquierda={
              <View>
                <Text style={[o.pieRotulo, { color: t.tenue }]}>1 {unidad} cuesta</Text>
                <Text style={[o.pieCifra, { color: t.tinta }]} numberOfLines={1} adjustsFontSizeToFit>
                  {costoTanda > 0 ? dinero(costoTanda) : '—'}
                </Text>
              </View>
            }
            texto={guardando ? 'Guardando…' : prep ? 'Guardar receta' : 'Crear preparación'}
            alTocar={() => void guardar()}
            ocupado={guardando}
          />
        </View>
      }
    >
      {tablet ? (
        <View style={o.dos}>
          <View style={{ flex: 5, minWidth: 0 }}>{losaOlla}</View>
          <View style={{ flex: 7, minWidth: 0 }}>{derecha}</View>
        </View>
      ) : (
        <>
          {losaOlla}
          {derecha}
        </>
      )}
    </Pantalla>
  )
}

const o = StyleSheet.create({
  nombre: { fontFamily: LETRA.tituloFuerte, fontSize: 21, letterSpacing: -0.4, paddingVertical: 4 },
  mide: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  mideTexto: { fontFamily: LETRA.textoFuerte, fontSize: 13 },
  ayuda: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19, marginTop: 6 },
  par: { flexDirection: 'row', gap: 10 },
  parRotulo: { fontFamily: LETRA.textoFuerte, fontSize: 12.5 },
  parCifra: { fontFamily: LETRA.tituloFuerte, fontSize: 19, letterSpacing: -0.3, marginTop: 2 },
  parNota: { fontFamily: LETRA.texto, fontSize: 13 },
  ajustar: { fontFamily: LETRA.textoFuerte, fontSize: 13.5, textDecorationLine: 'underline', marginTop: 2 },
  aviso: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 20 },
  llevaTitulo: { fontFamily: LETRA.titulo, fontSize: 17, letterSpacing: -0.2, paddingHorizontal: 16, paddingBottom: 6 },
  llevaNota: { fontFamily: LETRA.texto, fontSize: 13.5, letterSpacing: 0 },
  columnas: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  columna: { fontFamily: LETRA.textoFuerte, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' },
  dos: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  pieRotulo: { fontFamily: LETRA.textoFuerte, fontSize: 12.5 },
  pieCifra: { fontFamily: LETRA.tituloFuerte, fontSize: 20, letterSpacing: -0.4 },
})
