import { useState } from 'react'
import { Text, View } from 'react-native'
import { unidadDe } from '../../../../frontend/src/lib/inventario'
import { apiCompras } from '../../lib/api-compras'
import { cant, num } from '../../lib/compras-app'
import { avisar } from '../../lib/dialogo'
import { LETRA, useTema } from '../../lib/tema'
import type { FacturaCompra } from '../../lib/tipos'
import { Hoja, OpcionHoja } from '../Hoja'
import { HojaFormulario } from '../kit'
import { Boton } from '../ui'
import { Casilla, CampoTexto, Dato, mensajeDe, NotaTono } from './piezas'

/**
 * NOTA DE CREDITO DE UN PROVEEDOR: el espejo de la devolucion de venta
 * (pages/Compras.tsx, `notaCredito`). Primero que paso --llego menos, llego
 * la nota por lo que falto, devolucion o descuento-- y despues lo que pide
 * cada caso, con los mismos textos de la web. Sin esto el unico camino era
 * un ajuste de inventario, que registra la diferencia como MERMA.
 */
type Tipo = 'faltante_anotar' | 'faltante' | 'devolucion' | 'descuento'

export default function NotaCredito({
  factura,
  alCerrar,
  alTerminar,
}: {
  factura: FacturaCompra | null
  alCerrar: () => void
  /** Se registro: la factura se vuelve a pedir. */
  alTerminar: (texto: string) => void
}) {
  const t = useTema()
  const [tipo, setTipo] = useState<Tipo | null>(null)
  // La lista de "que paso" se cierra antes de abrir el formulario: dos
  // ventanas a la vez no abren en el iPhone.
  const [eligiendo, setEligiendo] = useState(true)
  if (!factura) return null
  const f = factura
  const reclamos = f.reclamos ?? []
  const cerrar = () => {
    setTipo(null)
    setEligiendo(true)
    alCerrar()
  }
  const elegir = (x: Tipo) => {
    setEligiendo(false)
    setTimeout(() => setTipo(x), 300)
  }

  return (
    <>
      <Hoja visible={eligiendo} alCerrar={cerrar} titulo={`Nota de crédito de ${f.proveedor_nombre}`}>
        <Text style={{ fontFamily: LETRA.texto, fontSize: 14, paddingHorizontal: 12, paddingBottom: 6, color: t.suave }}>
          {`Sobre la factura ${f.numero_factura}. ¿Qué pasó?`}
        </Text>
        <OpcionHoja
          texto="Llegó menos de lo facturado"
          detalle="Todavía sin nota del proveedor: lo que falta sale del inventario y queda como reclamo, no como pérdida."
          alTocar={() => elegir('faltante_anotar')}
        />
        {reclamos.length > 0 ? (
          <OpcionHoja
            texto="Llegó la nota por lo que faltó"
            detalle={`Cierra lo reclamado: ${reclamos.map((r) => `${cant(r.cantidad)} ${unidadDe(r.cantidad, r.unidad)} de ${r.ingrediente_nombre}`).join(', ')}.`}
            alTocar={() => elegir('faltante')}
          />
        ) : null}
        <OpcionHoja texto="Devolución" detalle="La mercancía vuelve al proveedor y sale del inventario." alTocar={() => elegir('devolucion')} />
        <OpcionHoja texto="Descuento" detalle="Te quedas la mercancía y te rebajan el costo." alTocar={() => elegir('descuento')} />
      </Hoja>
      {tipo ? (
        <Formulario
          f={f}
          tipo={tipo}
          alCerrar={cerrar}
          alTerminar={(texto) => {
            setTipo(null)
            setEligiendo(true)
            alTerminar(texto)
          }}
        />
      ) : null}
    </>
  )
}

function Formulario({ f, tipo, alCerrar, alTerminar }: { f: FacturaCompra; tipo: Tipo; alCerrar: () => void; alTerminar: (texto: string) => void }) {
  const t = useTema()
  const [numero, setNumero] = useState('')
  const [motivo, setMotivo] = useState('')
  const [base, setBase] = useState('')
  const [cantidades, setCantidades] = useState<Record<number, string>>({})
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState('')

  const conRenglones = tipo === 'faltante_anotar' || tipo === 'devolucion'
  const titulo =
    tipo === 'faltante_anotar'
      ? 'Lo que no llegó'
      : tipo === 'faltante'
        ? 'Nota de crédito por lo que faltó'
        : tipo === 'descuento'
          ? 'Descuento del proveedor'
          : 'Devolución al proveedor'
  const ayuda =
    tipo === 'faltante_anotar'
      ? 'Cuánto faltó de cada renglón. Queda como reclamo al proveedor hasta que mande su nota de crédito.'
      : tipo === 'devolucion'
        ? 'Cuánto vuelve de cada renglón. Deja en 0 lo que se queda.'
        : undefined
  const aceptar = tipo === 'faltante_anotar' ? 'Anotar faltante' : tipo === 'devolucion' ? 'Registrar devolución' : 'Registrar'

  async function registrar() {
    setError('')
    if (tipo !== 'faltante_anotar' && !numero.trim()) return setError('Falta el número de la nota de crédito.')
    const items = f.items
      .map((it) => ({ ingrediente_id: it.ingrediente_id, cantidad: num(cantidades[it.ingrediente_id] ?? '') }))
      .filter((it) => it.cantidad > 0)
    for (const it of f.items) {
      const n = num(cantidades[it.ingrediente_id] ?? '')
      if (n > it.cantidad) return setError(`De ${it.ingrediente_nombre} la factura trae ${cant(it.cantidad)} ${unidadDe(it.cantidad, it.unidad)}.`)
    }
    setOcupado(true)
    try {
      if (tipo === 'faltante_anotar') {
        if (items.length === 0) return setError('Di qué mercancía no llegó y cuánto.')
        await apiCompras.anotarFaltantes(f.id, items, motivo.trim() || undefined)
        alTerminar('Faltante anotado: queda como reclamo al proveedor.')
      } else if (tipo === 'faltante') {
        await apiCompras.crearNotaCredito(f.id, { numero: numero.trim(), tipo: 'faltante' })
        alTerminar('Nota de crédito registrada.')
      } else if (tipo === 'descuento') {
        const n = num(base)
        if (!(n >= 0.01)) return setError('Escribe cuánto te acreditaron, sin IVA.')
        await apiCompras.crearNotaCredito(f.id, { numero: numero.trim(), tipo, motivo: motivo.trim() || undefined, base_imponible: n })
        alTerminar('Descuento registrado.')
      } else {
        if (items.length === 0) {
          await avisar('Nada que devolver', 'No se indicó ninguna cantidad a devolver.')
          return
        }
        await apiCompras.crearNotaCredito(f.id, { numero: numero.trim(), tipo, motivo: motivo.trim() || undefined, items })
        alTerminar('Devolución registrada.')
      }
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo registrar la nota de crédito'))
    } finally {
      setOcupado(false)
    }
  }

  return (
    <HojaFormulario
      visible
      alCerrar={alCerrar}
      titulo={titulo}
      subtitulo={ayuda}
      pie={
        <>
          <View style={{ flex: 1 }}>
            <Boton texto="Cancelar" tono="neutro" alTocar={alCerrar} />
          </View>
          <View style={{ flex: 1 }}>
            <Boton texto={aceptar} alTocar={() => void registrar()} ocupado={ocupado} />
          </View>
        </>
      }
    >
      {tipo !== 'faltante_anotar' ? (
        <Dato etiqueta="Número de la nota de crédito">
          <CampoTexto value={numero} onChangeText={setNumero} autoCapitalize="characters" autoCorrect={false} accessibilityLabel="Número de la nota de crédito" />
        </Dato>
      ) : null}
      {tipo === 'descuento' ? (
        <Dato etiqueta="Cuánto te acreditaron, sin IVA">
          <Casilla valor={base} alCambiar={setBase} prefijo="$" placeholder="0,00" etiqueta="Cuánto te acreditaron, sin IVA" />
        </Dato>
      ) : null}
      {tipo !== 'faltante' ? (
        <Dato etiqueta={tipo === 'faltante_anotar' ? 'Qué pasó (opcional)' : 'Motivo (opcional)'}>
          <CampoTexto
            value={motivo}
            onChangeText={setMotivo}
            placeholder={tipo === 'faltante_anotar' ? 'Llegaron 8 de 10' : tipo === 'descuento' ? 'Mandó menos, llegó dañado, descuento...' : 'Mandó menos, llegó dañado...'}
            accessibilityLabel="Motivo"
          />
        </Dato>
      ) : null}
      {conRenglones
        ? f.items.map((it) => (
            <Dato key={it.id} etiqueta={it.ingrediente_nombre} nota={`${it.unidad}, la factura trae ${cant(it.cantidad)}`}>
              <Casilla
                valor={cantidades[it.ingrediente_id] ?? ''}
                alCambiar={(v) => setCantidades((prev) => ({ ...prev, [it.ingrediente_id]: v }))}
                sufijo={it.unidad}
                placeholder="0"
                etiqueta={`Cuánto de ${it.ingrediente_nombre}`}
              />
            </Dato>
          ))
        : null}
      {conRenglones && f.items.length === 0 ? (
        <Text style={{ fontFamily: LETRA.texto, fontSize: 14, color: t.suave }}>Esta factura no trae mercancía: no hay renglones que devolver.</Text>
      ) : null}
      {error ? <NotaTono tono="mal">{error}</NotaTono> : null}
    </HojaFormulario>
  )
}
