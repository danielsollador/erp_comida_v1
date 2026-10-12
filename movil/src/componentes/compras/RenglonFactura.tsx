import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { CONCEPTOS, sugerirMercancia, unidadDistinta } from '../../../../frontend/src/lib/compras'
import { unidadDe } from '../../../../frontend/src/lib/inventario'
import { ALMACEN_DE } from '../../../../frontend/src/lib/tiposArticulo'
import { aBase, convertirTexto, otraUnidad } from '../../../../frontend/src/lib/unidades'
import { aTexto, cant, cero, desdePaquete, enMoneda, lineaCompleta, nombrePaquete, num, type Linea, type Paquete, type Tono } from '../../lib/compras-app'
import { miles } from '../../lib/formato'
import { sinRuido } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import type { AvisoPrecio, Equivalencia, Ingrediente } from '../../lib/tipos'
import Icono from '../Icono'
import { Selector, useDisposicion } from '../kit'
import CampoSugerido from './CampoSugerido'
import { ElegirMercancia, ElegirQueEs } from './ElegirMercancia'
import { Casilla, CampoTexto, Chip, colorTipo, Dato, PuntoGasto, PuntoTipo } from './piezas'

/**
 * Un renglon de la factura: que es (una mercancia con su color, o flete,
 * servicio...), cuanto vino y cuanto costo (pages/partes/compras/
 * CargarFactura.tsx, `Renglon`).
 *
 * Plegado es UNA linea --nombre, "5 kg a $6,00 c/u" y el subtotal-- y se toca
 * para corregirlo: en el telefono una factura de 15 renglones cabe en una
 * pantalla. Se pliega con "Listo" (obligatorio antes de guardar).
 *
 * SE ESCRIBE LO QUE DICE EL PAPEL: el COSTO TOTAL del renglon, y el sistema
 * saca el costo por unidad ("48 unidades a $0,42 cada una"). Si la ficha dice
 * que la mercancia viene en empaque, el renglon arranca en empaque y lo unico
 * que se toca es "Esta vez vino suelta"; si no, ni se habla de empaques.
 */
export default function RenglonFactura({
  indice,
  linea: l,
  ingredientes,
  moneda,
  tasaIva,
  exento,
  aviso,
  avisoCantidad,
  problema,
  puedeQuitar,
  conocidos,
  servicios,
  anclar,
  onListo,
  onCambiar,
  onMercancia,
  onTipo,
  onCrear,
  onQuitar,
}: {
  indice: number
  linea: Linea
  ingredientes: Ingrediente[]
  moneda: string
  tasaIva: number
  /** Si paga IVA, ya resuelto con la ficha. */
  exento: boolean
  aviso?: AvisoPrecio
  /** La cantidad es muy distinta de lo que se suele comprar. */
  avisoCantidad?: string
  problema: { texto: string; tono: Tono } | null
  puedeQuitar: boolean
  /** Las presentaciones con que este proveedor ya trajo esa mercancia. */
  conocidos: Equivalencia[]
  /** Los servicios ya cargados alguna vez, para elegirlos de un toque. */
  servicios: string[]
  /** Para poder llevar la pantalla a este renglon. */
  anclar: (v: View | null) => void
  /** "Listo": plegar el renglon (y dejar el siguiente a la vista). */
  onListo: () => void
  onCambiar: (cambio: Partial<Linea>) => void
  onMercancia: (id: number) => void
  /** El primer selector: un tipo de mercancia o un concepto de gasto. */
  onTipo: (valor: string) => void
  /** Crear una mercancia nueva, con lo que se escribio en la busqueda. */
  onCrear: (texto: string) => void
  onQuitar: () => void
}) {
  const t = useTema()
  const { tablet } = useDisposicion()
  const ing = l.concepto ? undefined : ingredientes.find((x) => x.id === l.ingrediente_id)
  const unidad = ing?.unidad ?? ''

  // LA CANTIDAD SE ESCRIBE EN kg O EN g (la casilla con la unidad adentro).
  // La linea guarda la cantidad EN LA UNIDAD DE LA FICHA; lo que se ve puede
  // estar en la otra cara. Si cambia la mercancia o la cantidad llega de
  // fuera (el empaque, la foto), lo que se ve se pone al dia aqui mismo.
  const [vista, setVista] = useState(unidad)
  const [texto, setTexto] = useState(l.cantidad)
  const [previa, setPrevia] = useState({ unidad, cantidad: l.cantidad })
  if (previa.unidad !== unidad || previa.cantidad !== l.cantidad) {
    if (previa.unidad !== unidad) {
      setVista(unidad)
      setTexto(l.cantidad)
    } else {
      const enBase = !vista || vista === unidad ? texto : aBase(texto, unidad, vista)
      if (enBase !== l.cantidad) setTexto(vista && vista !== unidad ? convertirTexto(l.cantidad, unidad, unidad, vista).replace('.', ',') : l.cantidad)
    }
    setPrevia({ unidad, cantidad: l.cantidad })
  }
  const escribirCantidad = (v: string) => {
    setTexto(v)
    onCambiar({ cantidad: !vista || vista === unidad ? v : aBase(v, unidad, vista) })
  }
  const cambiarVista = (nueva: string) => {
    setTexto(convertirTexto(texto, unidad, vista || unidad, nueva).replace('.', ','))
    setVista(nueva)
  }

  const enPaquete = !!l.paquete
  // La ficha dice que viene en empaque: se da por hecho, no se pregunta.
  const empaqueDeFicha = !!ing?.empaque_trae
  function cambiarPaquete(cambio: Partial<Paquete>) {
    const p = { ...(l.paquete ?? { nombre: 'empaque', trae: '', paquetes: '' }), ...cambio }
    const calc = desdePaquete(p)
    onCambiar({ paquete: p, ...(calc ?? {}) })
  }
  function activarPaquete(desde?: Equivalencia) {
    cambiarPaquete({
      nombre: desde?.unidad_papel || 'empaque',
      trae: desde ? sinRuido(desde.factor) : ing?.empaque_trae ? sinRuido(ing.empaque_trae) : '',
      // Lo que ya estaba escrito pasa a ser "cuantos empaques": es lo que se
      // tecleo mirando el papel.
      paquetes: l.leido?.cantidad != null ? String(l.leido.cantidad) : l.cantidad,
    })
  }

  const subtotal = cero(l.cantidad) * cero(l.costo_unitario)
  const recordada = l.recordada?.ingrediente_id === l.ingrediente_id ? l.recordada : undefined
  const sugerida = !l.ingrediente_id && !l.concepto && l.leido ? sugerirMercancia(l.leido.descripcion, ingredientes) : null
  const papelNoCuadra =
    !l.concepto &&
    l.leido?.cantidad != null &&
    l.leido.precio_unitario != null &&
    l.leido.subtotal != null &&
    Math.abs(l.leido.cantidad * l.leido.precio_unitario - l.leido.subtotal) > Math.max(0.05, Math.abs(l.leido.subtotal) * 0.01)
  const unidadChoca = !!l.leido && !recordada && !enPaquete && !!ing && unidadDistinta(l.leido.unidad, ing.unidad)

  const color = problema?.tono === 'mal' ? t.peligro : problema || papelNoCuadra ? t.aviso : ing ? colorTipo(t, ing.tipo).punto : t.gris200
  const trae = cero(l.paquete?.trae)
  const completa = lineaCompleta(l)
  const anillo = problema?.tono === 'mal' ? t.peligro : problema ? t.aviso : 'transparent'
  const cadaUna = unidad === 'unidad' ? 'una' : unidad
  const tipoElegido = ing?.tipo ?? l.tipo
  const m = (n: number, d = 2) => enMoneda(n, moneda, d)

  // ── Plegado: una linea ──
  if (!l.abierta && completa) {
    const concepto = l.concepto ? CONCEPTOS.find((c) => c.valor === l.concepto) : undefined
    const detalle = problema
      ? problema.texto
      : l.concepto
        ? `${l.concepto === 'Equipo' ? 'a equipos' : 'a gasto'}${exento ? ' · exento' : ''}`
        : `${l.paquete ? `${l.paquete.paquetes} ${nombrePaquete(l.paquete)} · ` : ''}${cant(cero(l.cantidad))} ${unidadDe(cero(l.cantidad), unidad)} a ${m(cero(l.costo_unitario))} c/u${exento ? ' · exento' : ''}`
    return (
      <View ref={anclar} collapsable={false}>
        <Pressable
          onPress={() => onCambiar({ abierta: true })}
          accessibilityRole="button"
          accessibilityLabel={`Abrir el renglón ${indice + 1}`}
          style={({ pressed }) => [
            r.plegado,
            { backgroundColor: pressed ? t.gris200 : t.gris100, borderColor: anillo },
          ]}
        >
          {l.concepto ? <PuntoGasto tamano={10} /> : <View style={[r.punto, { backgroundColor: color }]} />}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[r.nombre, { color: t.tinta }]} numberOfLines={1}>
              {l.concepto ? concepto?.texto : ing?.nombre}
              {l.concepto && l.detalle && l.concepto !== 'Flete' ? <Text style={{ fontFamily: LETRA.texto, color: t.suave }}> · {l.detalle}</Text> : null}
            </Text>
            <Text
              style={[r.detalle, { color: problema ? (problema.tono === 'mal' ? t.peligro : t.aviso) : t.suave }]}
              numberOfLines={2}
            >
              {detalle}
            </Text>
          </View>
          <Text style={[r.subtotal, { color: t.tinta }]}>{m(subtotal)}</Text>
          <View style={{ transform: [{ rotate: '90deg' }] }}>
            <Icono nombre="chevron" size={15} color={t.tenue} grosor={2.2} />
          </View>
        </Pressable>
      </View>
    )
  }

  // La esquina: plegar (si ya esta completo) y quitar.
  const esquina = (
    <View style={r.esquina}>
      {completa ? (
        <Pressable onPress={onListo} hitSlop={4} accessibilityLabel={`Plegar el renglón ${indice + 1}`} style={({ pressed }) => [r.esquinaBoton, pressed && { backgroundColor: t.gris200 }]}>
          <View style={{ transform: [{ rotate: '-90deg' }] }}>
            <Icono nombre="chevron" size={16} color={t.suave} grosor={2.2} />
          </View>
        </Pressable>
      ) : null}
      {puedeQuitar ? (
        <Pressable onPress={onQuitar} hitSlop={4} accessibilityLabel={`Quitar el renglón ${indice + 1}`} style={({ pressed }) => [r.esquinaBoton, pressed && { backgroundColor: t.peligroSuave }]}>
          <Icono nombre="quitar" size={15} color={t.suave} />
        </Pressable>
      ) : null}
    </View>
  )
  const delPapel = l.leido ? (
    <Text style={[r.nota, { color: t.tenue }]}>
      Papel: {l.leido.descripcion || '(sin descripción)'} ·{' '}
      <Text style={{ fontFamily: LETRA.cifra }}>
        {l.leido.cantidad == null ? '?' : cant(l.leido.cantidad)} {l.leido.unidad} × {l.leido.precio_unitario == null ? '?' : m(l.leido.precio_unitario)}
      </Text>
      {l.leido.exento ? ' · exento' : ''}
    </Text>
  ) : null
  const pie = (
    <View style={r.pie}>
      <View style={{ flex: 1 }}>
        <Text style={[r.rotulo, { color: t.tenue }]}>Subtotal</Text>
        <Text style={[r.subtotalGrande, { color: t.tinta }]}>{m(subtotal)}</Text>
      </View>
      {completa ? (
        <Pressable onPress={onListo} accessibilityRole="button" style={({ pressed }) => [r.listo, { backgroundColor: t.tinta, opacity: pressed ? 0.85 : 1 }]}>
          <Icono nombre="ok" size={15} color={t.papel} grosor={2.2} />
          <Text style={[r.listoTexto, { color: t.papel }]}>Listo</Text>
        </Pressable>
      ) : null}
    </View>
  )
  const ivaOpciones = (ficha: boolean) => [
    ...(ficha ? [{ valor: 'ficha', texto: ing ? (ing.exento ? 'Exento' : `${tasaIva}%`) : 'Ficha', detalle: 'Lo que dice su ficha' }] : []),
    { valor: 'grava', texto: `${tasaIva}%`, detalle: 'Paga IVA' },
    { valor: 'exento', texto: 'Exento', detalle: 'No paga IVA' },
  ]

  // ── Abierto, y no es mercancia: flete, servicio, equipo ──
  if (l.concepto) {
    const concepto = CONCEPTOS.find((c) => c.valor === l.concepto)!
    return (
      <View ref={anclar} collapsable={false} style={[r.abierto, { backgroundColor: t.gris100, borderColor: anillo }]}>
        <View style={[r.barra, { backgroundColor: t.gris200 }]} />
        <View style={r.dentro}>
          <View style={r.cabeza}>
            <View style={{ flex: 1 }}>
              <ElegirQueEs valor={l.concepto} alElegir={onTipo} />
            </View>
            {esquina}
          </View>
          {l.concepto === 'Flete' ? (
            // El flete es el flete: no lleva nombre.
            <Text style={[r.nota, { color: t.suave }]}>{concepto.ayuda}</Text>
          ) : l.concepto === 'Servicio' ? (
            // Los servicios son fijos (internet, luz): se eligen de la lista
            // de los ya cargados, o se escribe uno nuevo.
            <CampoSugerido
              valor={l.detalle ?? ''}
              alCambiar={(v) => onCambiar({ detalle: v })}
              opciones={servicios}
              placeholder="Ej. Internet, Luz"
              vacio="Escribe cuál: queda en la lista para la próxima"
              titulo="Los servicios ya cargados"
              etiqueta="Qué servicio"
            />
          ) : (
            <CampoTexto value={l.detalle ?? ''} onChangeText={(v) => onCambiar({ detalle: v })} placeholder={`Ej. ${concepto.ejemplo}`} accessibilityLabel="Qué es" />
          )}
          {delPapel}
          <View style={[r.grilla, tablet && r.grillaTablet]}>
            <Dato etiqueta={`Monto sin IVA (${moneda})`} style={r.celda}>
              <Casilla valor={l.costo_unitario} alCambiar={(v) => onCambiar({ costo_unitario: v, costo_total: v, cantidad: '1' })} placeholder="0,00" />
            </Dato>
            <View style={r.celda}>
              <Selector
                etiqueta="IVA"
                forma="campo"
                opciones={ivaOpciones(false)}
                valor={exento ? 'exento' : 'grava'}
                alCambiar={(v) => onCambiar({ exento: v === 'exento' })}
              />
            </View>
            {l.concepto === 'Equipo' ? (
              <Dato etiqueta="Dura (meses)" style={r.celda}>
                <Casilla valor={l.vidaUtil ?? '60'} alCambiar={(v) => onCambiar({ vidaUtil: v })} entero />
              </Dato>
            ) : null}
          </View>
          <Text style={[r.nota, { color: t.suave }]}>
            {l.concepto === 'Flete'
              ? 'Va a la cuenta de fletes, aparte de la mercancía: el flete lleva su propia retención de ISLR.'
              : l.concepto === 'Equipo'
                ? 'Entra como equipo y se deprecia solo con los meses.'
                : `${concepto.ayuda} Va a gasto, no al inventario.`}
          </Text>
          {pie}
        </View>
      </View>
    )
  }

  // ── Abierto, mercancia ──
  const elegirMercancia = (
    <ElegirMercancia
      ingredientes={ingredientes}
      valor={l.ingrediente_id}
      alElegir={onMercancia}
      alCrear={onCrear}
      tipo={l.ingrediente_id ? undefined : tipoElegido}
      tono={problema?.tono === 'mal' && !l.ingrediente_id ? 'mal' : undefined}
      sugerencia={l.leido?.descripcion}
      placeholder={tipoElegido ? `¿Cuál ${ALMACEN_DE[tipoElegido].texto.toLowerCase()}?` : '¿Cuál mercancía?'}
    />
  )
  const otra = ing ? otraUnidad(ing.unidad) : null
  const siguiente = vista === unidad ? otra : unidad
  return (
    <View ref={anclar} collapsable={false} style={[r.abierto, { backgroundColor: t.gris100, borderColor: anillo }]}>
      <View style={[r.barra, { backgroundColor: color }]} />
      <View style={r.dentro}>
        {/* En el telefono la mercancia va debajo, a todo lo ancho: la esquina
            (plegar, quitar) acompaña solo al "que es". */}
        <View style={r.cabeza}>
          <View style={[{ flex: 1, gap: 8 }, tablet && { flexDirection: 'row' }]}>
            <View style={tablet ? { flex: 2 } : undefined}>
              <ElegirQueEs valor={l.concepto ?? tipoElegido ?? ''} alElegir={onTipo} tono={problema?.tono === 'mal' && !l.ingrediente_id ? 'mal' : undefined} />
            </View>
            {tablet ? <View style={{ flex: 3 }}>{elegirMercancia}</View> : null}
          </View>
          {esquina}
        </View>
        {!tablet ? elegirMercancia : null}
        {delPapel}

        {/* Como vino. Solo si la ficha dice que viene en empaque (o el papel
            lo trajo asi): se da por hecho y se avisa; lo unico que se toca es
            "Esta vez vino suelta". Sin empaque en su ficha, ni se ofrece. */}
        {ing && (enPaquete || empaqueDeFicha) ? (
          <View style={r.empaque}>
            {enPaquete ? (
              <>
                <View style={r.empaqueTexto}>
                  <Icono nombre="paquete" size={15} color={t.suave} />
                  <Text style={[r.nota, { color: t.fuerte, flexShrink: 1 }]}>
                    Viene en {l.paquete!.nombre || 'empaque'}
                    {empaqueDeFicha && num(l.paquete!.trae) === ing.empaque_trae ? ` de ${miles(ing.empaque_trae!, ing.empaque_trae! % 1 ? 2 : 0)}, como dice su ficha` : ''}
                  </Text>
                </View>
                <Chip texto="Esta vez vino suelta" alTocar={() => onCambiar({ paquete: undefined })} />
              </>
            ) : (
              <Chip texto={`Vino en empaque de ${miles(ing.empaque_trae!, ing.empaque_trae! % 1 ? 2 : 0)}`} icono="paquete" alTocar={() => activarPaquete()} />
            )}
            {!enPaquete
              ? conocidos.map((c) => (
                  <Chip key={c.id} texto={`${c.unidad_papel || 'empaque'} × ${miles(c.factor, c.factor % 1 ? 2 : 0)}`} alTocar={() => activarPaquete(c)} />
                ))
              : null}
          </View>
        ) : null}

        {enPaquete ? (
          <View style={{ gap: 8 }}>
            <View style={[r.grilla, tablet && r.grillaTablet]}>
              <Dato etiqueta="Cuántos" style={r.celda}>
                <Casilla valor={l.paquete!.paquetes} alCambiar={(v) => cambiarPaquete({ paquetes: v })} placeholder="2" />
              </Dato>
              <Dato etiqueta={`Cada uno trae (${unidad})`} style={r.celda}>
                <Casilla valor={l.paquete!.trae} alCambiar={(v) => cambiarPaquete({ trae: v })} placeholder="24" />
              </Dato>
              <Dato etiqueta={`Costo total (${moneda})`} style={r.celda}>
                <Casilla valor={l.costo_total} alCambiar={(v) => onCambiar({ costo_total: v })} placeholder="0,00" tono={aviso ? 'ojo' : undefined} />
              </Dato>
            </View>
            <View style={r.entra}>
              <Icono nombre="inventario" size={15} color={t.tenue} />
              <Text style={[r.nota, { color: t.suave, flex: 1 }]}>
                Entra al inventario:{' '}
                {trae > 0 && num(l.cantidad) > 0 ? (
                  <Text style={{ fontFamily: LETRA.textoFuerte, color: t.tinta }}>
                    {cant(num(l.cantidad))} {unidadDe(num(l.cantidad), unidad)}
                    {num(l.costo_unitario) > 0 ? (
                      <Text style={{ fontFamily: LETRA.texto, color: t.suave }}>
                        {' '}
                        a {m(num(l.costo_unitario))} cada {cadaUna}
                      </Text>
                    ) : null}
                  </Text>
                ) : (
                  'escribe cuántos vinieron y cuánto trae cada uno'
                )}
              </Text>
            </View>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            <View style={[r.grilla, tablet && r.grillaTablet]}>
              <Dato etiqueta={`Cantidad${ing ? ` (${ing.unidad})` : ''}`} style={r.celda}>
                {ing && otra && siguiente ? (
                  <Casilla
                    valor={texto}
                    alCambiar={escribirCantidad}
                    placeholder="0"
                    accion={{ texto: `${vista || ing.unidad} ⇄`, alTocar: () => cambiarVista(siguiente), etiqueta: `Escribir en ${siguiente}` }}
                  />
                ) : (
                  <Casilla valor={l.cantidad} alCambiar={(v) => onCambiar({ cantidad: v })} placeholder="0" sufijo={ing ? unidadDe(2, ing.unidad) : undefined} />
                )}
              </Dato>
              <Dato etiqueta={`Costo total (${moneda})`} style={r.celda}>
                <Casilla valor={l.costo_total} alCambiar={(v) => onCambiar({ costo_total: v })} placeholder="0,00" tono={aviso ? 'ojo' : undefined} />
              </Dato>
              <View style={r.celda}>
                <Selector
                  etiqueta="IVA"
                  forma="campo"
                  opciones={ivaOpciones(true)}
                  valor={l.exento === null ? 'ficha' : l.exento ? 'exento' : 'grava'}
                  alCambiar={(v) => onCambiar({ exento: v === 'ficha' ? null : v === 'exento' })}
                />
              </View>
            </View>
            {/* El costo por unidad lo saca el sistema: el papel trae el total. */}
            {ing && num(l.cantidad) > 0 && num(l.costo_unitario) > 0 ? (
              <Text style={[r.nota, { color: t.suave }]}>
                Sale a <Text style={{ fontFamily: LETRA.cifra }}>{m(num(l.costo_unitario), 4)}</Text> cada {cadaUna}.
              </Text>
            ) : null}
          </View>
        )}

        {sugerida || recordada || unidadChoca || papelNoCuadra || aviso || avisoCantidad ? (
          <View style={{ gap: 4 }}>
            {sugerida ? (
              <Pressable onPress={() => onMercancia(sugerida.id)} accessibilityRole="button" style={r.sugerida} hitSlop={4}>
                <PuntoTipo tipo={sugerida.tipo} tamano={8} />
                <Text style={[r.nota, { color: t.acento, fontFamily: LETRA.textoFuerte, flexShrink: 1 }]}>
                  ¿Es {sugerida.nombre} ({sugerida.unidad})? Usarla
                </Text>
              </Pressable>
            ) : null}
            {recordada ? (
              <Text style={[r.nota, { color: t.exito }]}>
                Recordado de este proveedor · {recordada.veces === 1 ? '1 factura' : `${recordada.veces} facturas`}
                {!recordada.exacta ? <Text style={{ color: t.aviso }}> · parecido a «{recordada.descripcion_recordada}», revísalo</Text> : null}
              </Text>
            ) : null}
            {unidadChoca ? (
              <Text style={[r.nota, { color: t.aviso }]}>
                La factura dice {l.leido!.unidad} y {ing!.nombre} se lleva en {ing!.unidad}: si viene en empaque, márcalo arriba y el sistema convierte.
              </Text>
            ) : null}
            {papelNoCuadra ? <Text style={[r.nota, { color: t.aviso }]}>En el papel, cantidad × costo no da el total del renglón: revisa esos números.</Text> : null}
            {avisoCantidad ? <Text style={[r.nota, { color: t.aviso }]}>{avisoCantidad}</Text> : null}
            {aviso ? (
              <Text style={[r.nota, { color: t.aviso }]}>
                {aviso.mensaje}{' '}
                {aviso.base === 'compras'
                  ? `Se venía pagando ${enMoneda(aviso.referencia, '$')} (últimas ${aviso.muestras} compras).`
                  : `Costo promedio: ${enMoneda(aviso.referencia, '$')}.`}
              </Text>
            ) : null}
          </View>
        ) : null}
        {pie}
      </View>
    </View>
  )
}

/** Para mostrar un numero que se pone en una casilla desde fuera (la foto, el empaque). */
export const textoDe = aTexto

const r = StyleSheet.create({
  plegado: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, minHeight: 60 },
  punto: { width: 10, height: 10, borderRadius: 5 },
  nombre: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  detalle: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 2 },
  subtotal: { fontFamily: LETRA.cifraFuerte, fontSize: 15 },
  abierto: { flexDirection: 'row', borderRadius: 20, borderWidth: 1, overflow: 'hidden' },
  barra: { width: 4, marginVertical: 14, marginLeft: 6, borderRadius: 2 },
  dentro: { flex: 1, minWidth: 0, padding: 12, paddingLeft: 10, gap: 10 },
  cabeza: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  esquina: { flexDirection: 'row', alignItems: 'center' },
  esquinaBoton: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  nota: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 19 },
  rotulo: { fontFamily: LETRA.textoFuerte, fontSize: 12.5 },
  grilla: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  grillaTablet: { flexWrap: 'nowrap' },
  celda: { flexGrow: 1, flexShrink: 1, flexBasis: 130, minWidth: 0 },
  empaque: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  empaqueTexto: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  entra: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  sugerida: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  pie: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  subtotalGrande: { fontFamily: LETRA.cifraFuerte, fontSize: 16, marginTop: 1 },
  listo: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, borderRadius: 14, paddingHorizontal: 18 },
  listoTexto: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
})
