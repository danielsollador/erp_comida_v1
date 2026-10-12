import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { unidadDe } from '../../../../frontend/src/lib/inventario'
import { LETRA, useTema } from '../../lib/tema'
import type { Categoria, ConteoResumen, CostoIndirecto, CostoParaPrecios, CostoTeoricoFila, Merma, SobranteInventario } from '../../lib/tipos'
import Icono from '../Icono'
import { Buscador, llano, Pastilla, useDisposicion, Vacio } from '../kit'
import { Ficha } from '../ui'
import { fechaNumerica, fmtCant } from '../preparaciones/cuentas'
import { Cabecera, Caja, Enlace } from '../preparaciones/piezas'

/*
 * LAS CUATRO VISTAS DEL CONTROL (`Control` de la web): debio salir contra
 * hay, perdidas, conteos, y el aceite con el costo para precios. En la web
 * son tablas; en el telefono cada fila es un renglon con su nombre a la
 * izquierda y sus cifras a la derecha.
 */

const borde = (t: ReturnType<typeof useTema>, ultima: boolean) =>
  ultima ? null : { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 }

// ── Debio salir vs. hay ─────────────────────────────────────────────────────

export function Teorico({
  filas,
  nombreRango,
  dinero,
  alContar,
}: {
  filas: CostoTeoricoFila[]
  nombreRango: string
  dinero: (n: number) => string
  alContar: () => void
}) {
  const t = useTema()
  const perdido = filas.reduce((s, f) => s + Math.min(f.valor_diferencia, 0), 0)
  const conConteo = filas.some((f) => f.diferencia_conteo !== 0)
  return (
    <Ficha>
      <Cabecera
        titulo="Lo que debió salir contra lo que hay"
        ayuda={`Según las recetas y lo vendido (${nombreRango.toLowerCase()}), contra lo que encontró el conteo. La diferencia es lo que se fue sin explicación.`}
      />
      {filas.length === 0 ? (
        <Vacio titulo="Sin movimientos en el período" detalle="Aparece en cuanto haya ventas con receta." />
      ) : (
        <>
          <Caja tono={conConteo ? (perdido < -0.005 ? 'peligro' : 'exito') : 'neutro'} estilo={{ marginBottom: 6 }}>
            {conConteo ? (
              perdido < -0.005 ? (
                <Text style={[v.texto, { color: t.peligro }]}>
                  Se fueron <Text style={[v.grande, { color: t.peligro }]}>{dinero(-perdido)}</Text> que las recetas no explican.
                </Text>
              ) : (
                <Text style={[v.texto, { color: t.exito }]}>Los conteos cuadran con lo que dicen las recetas.</Text>
              )
            ) : (
              <View>
                <Text style={[v.texto, { color: t.suave }]}>Para ver la diferencia hace falta contar el inventario. Aquí está lo que debió salir.</Text>
                <View style={{ flexDirection: 'row' }}>
                  <Enlace texto="Contar ahora" subrayado alTocar={alContar} />
                </View>
              </View>
            )}
          </Caja>
          {filas.map((f, i) => (
            <View key={f.ingrediente_id} style={[v.fila, borde(t, i === filas.length - 1)]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[v.nombre, { color: t.tinta }]}>{f.nombre}</Text>
                <Text style={[v.sub, { color: t.suave }]}>
                  Debió salir {fmtCant(f.teorico)} {unidadDe(f.teorico, f.unidad)}
                  {' · '}Mermas {f.mermas ? `${fmtCant(f.mermas)} ${unidadDe(f.mermas, f.unidad)}` : '—'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                {f.diferencia_conteo ? (
                  <>
                    <Text style={[v.cifra, { color: f.diferencia_conteo < 0 ? t.peligro : t.exito }]}>
                      {f.diferencia_conteo > 0 ? '+' : ''}
                      {fmtCant(f.diferencia_conteo)} {unidadDe(f.diferencia_conteo, f.unidad)}
                    </Text>
                    <Text style={[v.sub, { color: f.diferencia_conteo < 0 ? t.peligro : t.exito }]}>
                      {dinero(f.valor_diferencia)}
                      {f.pct_desvio != null ? ` · ${fmtCant(Math.abs(f.pct_desvio))} %` : ''}
                    </Text>
                  </>
                ) : (
                  <Text style={[v.cifra, { color: t.tenue }]}>—</Text>
                )}
              </View>
            </View>
          ))}
        </>
      )}
    </Ficha>
  )
}

// ── Perdidas ────────────────────────────────────────────────────────────────

export function Perdidas({
  mermas,
  sobrantes,
  nombreRango,
  dinero,
  alRevertirMerma,
  alRevertirSobrante,
}: {
  mermas: Merma[]
  sobrantes: SobranteInventario[]
  nombreRango: string
  dinero: (n: number) => string
  alRevertirMerma: (m: Merma) => void
  alRevertirSobrante: (s: SobranteInventario) => void
}) {
  const t = useTema()
  const [busqueda, setBusqueda] = useState('')
  const vivas = mermas.filter((m) => !m.revertida)
  const perdidas = vivas.filter((m) => !m.por_conteo).reduce((s, m) => s + m.valor, 0)
  const ajustes = vivas.filter((m) => m.por_conteo).reduce((s, m) => s + m.valor, 0)
  const q = llano(busqueda.trim())
  // Lo mas nuevo arriba, como el orden por fecha de la tabla de la web.
  const visibles = mermas
    .filter((m) => !q || llano(`${m.ingrediente_nombre} ${m.motivo}`).includes(q))
    .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : b.id - a.id))
  return (
    <View style={{ gap: 12 }}>
      <Ficha>
        <Cabecera
          titulo="Pérdidas registradas"
          ayuda={`Lo que se botó o se dañó (${nombreRango.toLowerCase()}). Los faltantes de un conteo se marcan aparte: bajan el stock igual, pero dicen que el sistema estaba mal, no que se perdió comida. Una merma por error se revierte: no se borra, queda el reverso asentado.`}
          accion={
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[v.grande, { color: t.peligro }]}>{dinero(perdidas)}</Text>
              {ajustes > 0 ? <Text style={[v.sub, { color: t.suave }]}>+ {dinero(ajustes)} en ajustes de conteo</Text> : null}
            </View>
          }
        />
        {mermas.length === 0 ? (
          <Vacio titulo="Sin pérdidas registradas" detalle="Bien ahí." />
        ) : (
          <>
            <Buscador valor={busqueda} alCambiar={setBusqueda} placeholder="Buscar por mercancía o motivo" />
            {visibles.map((m, i) => (
              <View key={m.id} style={[v.fila, borde(t, i === visibles.length - 1), m.revertida && { opacity: 0.5 }]}>
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <Text style={[v.nombre, { color: t.tinta }]}>{m.ingrediente_nombre}</Text>
                  <Text style={[v.sub, { color: t.suave }]}>
                    {fechaNumerica(m.fecha)} · {fmtCant(m.cantidad)} {unidadDe(m.cantidad, m.unidad)}
                  </Text>
                  <View style={v.motivo}>
                    {m.por_conteo ? <Pastilla texto="conteo" tono="ojo" /> : null}
                    <Text style={[v.sub, { color: t.suave, marginTop: 0 }]}>{m.motivo || '—'}</Text>
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[v.cifra, { color: m.por_conteo ? t.suave : t.peligro }]}>{dinero(m.valor)}</Text>
                  {m.revertida ? (
                    <Text style={[v.sub, { color: t.suave }]}>revertida</Text>
                  ) : (
                    <Enlace texto="Revertir" tono="tenue" alTocar={() => alRevertirMerma(m)} />
                  )}
                </View>
              </View>
            ))}
            {visibles.length === 0 ? <Text style={[v.sub, { color: t.tenue, paddingVertical: 10 }]}>Nada coincide.</Text> : null}
          </>
        )}
      </Ficha>

      <Ficha>
        <Cabecera titulo="Conteos que sumaron stock" ayuda="Entraron al inventario por un conteo físico hacia arriba. Si fue un error de tecleo, se puede revertir." />
        {sobrantes.length === 0 ? (
          <Text style={[v.texto, { color: t.suave }]}>Ninguno en el período.</Text>
        ) : (
          sobrantes.map((s, i) => (
            <View key={s.id} style={[v.fila, borde(t, i === sobrantes.length - 1)]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[v.nombre, { color: s.revertido ? t.tenue : t.tinta }, s.revertido && { textDecorationLine: 'line-through' }]}>
                  {s.ingrediente_nombre}
                </Text>
                <Text style={[v.sub, { color: t.tenue }]}>
                  +{fmtCant(s.cantidad)} {unidadDe(s.cantidad, s.unidad)} · {fechaNumerica(s.fecha)}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[v.cifra, { color: t.tinta }]}>{dinero(s.valor)}</Text>
                {!s.revertido ? <Enlace texto="Revertir" tono="tenue" alTocar={() => alRevertirSobrante(s)} /> : null}
              </View>
            </View>
          ))
        )}
      </Ficha>
    </View>
  )
}

// ── Conteos ─────────────────────────────────────────────────────────────────

export function ListaConteos({ conteos, dinero, alAbrir }: { conteos: ConteoResumen[]; dinero: (n: number) => string; alAbrir: (id: number) => void }) {
  const t = useTema()
  return (
    <Ficha style={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: 20 }}>
        <Cabecera
          titulo="Conteos hechos"
          ayuda="Cada planilla de inventario físico que se cargó, con lo que encontró. Un conteo a ciegas, sin ver lo que el sistema esperaba, es el que de verdad prueba algo. El preparado también se cuenta: «hay 1 kg de guiso» se traduce a crudo."
        />
      </View>
      {conteos.length === 0 ? (
        <View style={{ paddingHorizontal: 20 }}>
          <Vacio titulo="Todavía no se ha contado en este período" detalle="Un conteo semanal del crudo es lo que hace honesto todo lo demás." />
        </View>
      ) : (
        conteos.map((c, i) => (
          <Pressable
            key={c.id}
            onPress={() => alAbrir(c.id)}
            accessibilityRole="button"
            style={({ pressed }) => [v.fila, { paddingHorizontal: 20 }, borde(t, i === conteos.length - 1), pressed && { backgroundColor: t.gris100 }]}
          >
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <View style={v.motivo}>
                <Text style={[v.nombre, { color: t.tinta }]}>{fechaNumerica(c.fecha)}</Text>
                {c.ciego ? <Pastilla texto="a ciegas" tono="bien" /> : null}
              </View>
              <Text style={[v.sub, { color: t.tenue }]}>
                {c.contados} mercancía(s) · {c.cuadraron} cuadraron
                {c.operador ? ` · ${c.operador}` : ''}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[v.cifra, { color: c.neto < 0 ? t.peligro : t.suave }]}>
                {c.neto < 0 ? '−' : c.neto > 0 ? '+' : ''}
                {dinero(Math.abs(c.neto))}
              </Text>
              <Text style={[v.sub, { color: t.tenue }]}>faltó {dinero(c.faltante_valor)}</Text>
            </View>
            <Icono nombre="chevron" size={15} color={t.tenue} grosor={2.2} />
          </Pressable>
        ))
      )}
    </Ficha>
  )
}

// ── Aceite y precios ────────────────────────────────────────────────────────

const METODOS: { valor: CostoParaPrecios; texto: string; detalle: string }[] = [
  { valor: 'reposicion', texto: 'Último costo', detalle: 'lo que cuesta reponerlo hoy' },
  { valor: 'promedio', texto: 'Promedio', detalle: 'lo que costó lo que hay' },
  { valor: 'mayor', texto: 'El mayor', detalle: 'el más alto de los dos' },
]

type VarianteFrita = { id: number; nombre: string; precio: number; activo: boolean; se_frie?: boolean | null }

export function Costos({
  indirectos,
  categorias,
  metodo,
  dinero,
  alElegirMetodo,
  alFreir,
}: {
  indirectos: CostoIndirecto[]
  categorias: Categoria[]
  metodo: CostoParaPrecios
  dinero: (n: number) => string
  alElegirMetodo: (m: CostoParaPrecios) => void
  alFreir: (v: VarianteFrita, se_frie: boolean) => void
}) {
  const t = useTema()
  // En la tablet, las dos losas lado a lado (`lg:grid-cols-2` de la web).
  const { tablet } = useDisposicion()
  const lado = tablet ? { flex: 1 } : undefined
  const [abierto, setAbierto] = useState(false)
  const variantes = categorias.flatMap((c) =>
    (c.productos ?? [])
      .filter((p) => p.activo !== false)
      .flatMap((p) =>
        (p.variantes ?? []).filter((x) => x.activo !== false).map((x) => ({ v: x, nombre: p.variantes.length > 1 ? `${p.nombre} ${x.nombre}` : p.nombre })),
      ),
  )
  return (
    <View style={[{ gap: 12 }, tablet && { flexDirection: 'row', alignItems: 'flex-start' }]}>
      <Ficha style={lado}>
        <Cabecera
          titulo="Aceite de freír por unidad"
          ayuda="Lo cargado a la freidora, repartido entre las unidades fritas que se vendieron. Se suma al costo de lo que se fríe."
        />
        {indirectos.length === 0 ? (
          <Text style={[v.texto, { color: t.suave }]}>
            Marca el aceite como «costo indirecto» en su ficha (Materia prima) y anota cada vez que cargas la freidora.
          </Text>
        ) : (
          indirectos.map((i, n) => (
            <View key={i.ingrediente_id} style={[v.fila, borde(t, n === indirectos.length - 1)]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[v.nombre, { color: t.tinta }]}>{i.nombre}</Text>
                <Text style={[v.sub, { color: t.suave }]}>
                  Cargado {fmtCant(i.cargado)} {unidadDe(i.cargado, i.unidad)} ({dinero(i.valor)}) · {fmtCant(i.piezas)} unidades fritas
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[v.cifra, { color: t.tinta }]}>{i.por_pieza != null ? dinero(i.por_pieza) : '—'}</Text>
                <Text style={[v.sub, { color: t.suave }]}>por unidad</Text>
              </View>
            </View>
          ))
        )}
        {variantes.length > 0 ? (
          <View style={{ marginTop: 10 }}>
            <Pressable onPress={() => setAbierto((a) => !a)} accessibilityRole="button" style={v.desplegar}>
              <View style={{ transform: [{ rotate: abierto ? '90deg' : '0deg' }] }}>
                <Icono nombre="chevron" size={13} color={t.suave} grosor={2.4} />
              </View>
              <Text style={[v.nombre, { color: t.fuerte }]}>Qué se fríe ({variantes.filter((x) => x.v.se_frie).length})</Text>
            </Pressable>
            {abierto
              ? variantes.map(({ v: x, nombre }) => (
                  <Pressable
                    key={x.id}
                    onPress={() => alFreir(x, !x.se_frie)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: !!x.se_frie }}
                    style={v.casilla}
                  >
                    <View style={[v.cuadro, { borderColor: x.se_frie ? t.tinta : t.barra, backgroundColor: x.se_frie ? t.tinta : 'transparent' }]}>
                      {x.se_frie ? <Icono nombre="ok" size={13} color={t.papel} grosor={2.6} /> : null}
                    </View>
                    <Text style={[v.texto, { color: t.tinta }]}>{nombre}</Text>
                  </Pressable>
                ))
              : null}
          </View>
        ) : null}
      </Ficha>

      <Ficha style={lado}>
        {/* La web dice "márgenes y precios sugeridos"; en la app no se habla de
            precio sugerido (regla de Leider): el margen lo decide el dueño. */}
        <Cabecera
          titulo="Con qué costo fijar precios"
          ayuda="Solo para los márgenes del menú. La contabilidad sigue a costo promedio, que es lo que pide la norma."
        />
        <View style={v.metodos}>
          {METODOS.map((m) => {
            const esta = metodo === m.valor
            return (
              <Pressable
                key={m.valor}
                onPress={() => alElegirMetodo(m.valor)}
                accessibilityRole="button"
                accessibilityState={{ selected: esta }}
                style={({ pressed }) => [
                  v.metodo,
                  { backgroundColor: esta ? t.fichaPrincipal : t.gris100, transform: [{ scale: pressed ? 0.98 : 1 }] },
                ]}
              >
                <Text style={[v.nombre, { color: esta ? t.fichaPrincipalTinta : t.tinta }]}>{m.texto}</Text>
                <Text style={[v.sub, { color: esta ? t.fichaPrincipalTinta : t.suave, opacity: esta ? 0.75 : 1 }]}>{m.detalle}</Text>
              </Pressable>
            )
          })}
        </View>
        {metodo === 'reposicion' ? (
          <View style={{ marginTop: 10 }}>
            <Pastilla texto="Recomendado con inflación" tono="acento" />
          </View>
        ) : null}
      </Ficha>
    </View>
  )
}

const v = StyleSheet.create({
  texto: { fontFamily: LETRA.texto, fontSize: 14, lineHeight: 20 },
  grande: { fontFamily: LETRA.tituloFuerte, fontSize: 19, letterSpacing: -0.3 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  nombre: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  sub: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 2 },
  cifra: { fontFamily: LETRA.cifraFuerte, fontSize: 15 },
  motivo: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  desplegar: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  casilla: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  cuadro: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  metodos: { flexDirection: 'row', gap: 8 },
  metodo: { flex: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 11, minHeight: 64 },
})
