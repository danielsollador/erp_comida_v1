import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { apiInventario } from '../../lib/api-inventario'
import { confirmar } from '../../lib/dialogo'
import { useMoneda } from '../../lib/moneda'
import { LETRA, useTema } from '../../lib/tema'
import type { ImpactoDeCompra, Ingrediente } from '../../lib/tipos'
import { HojaFormulario } from '../kit'
import { Boton, estilos } from '../ui'
import { cantidad, esMasDeLoQueHay, mensaje, unidadDe } from './comun'
import { usePedir } from './Pedir'

/*
 * LO QUE SE LE ANOTA A UNA MERCANCIA: que llego (compra sin factura), que se
 * dano, que la uso el personal y cuanto hay de verdad. Las mismas preguntas,
 * textos y validaciones de pages/Inventario.tsx de la web. Se usa desde la
 * ficha, desde "Qué comprar" y desde la portada ("Llegó").
 */

const METODOS_DE_PAGO = ['Efectivo Bs', 'Efectivo $', 'Banco']

export function useAnotar({ alCambio, alError }: { alCambio: () => void; alError: (texto: string) => void }) {
  const { tasa } = useMoneda()
  const { pedir, pedirNumero, pedirTexto, hoja } = usePedir()
  const [impacto, setImpacto] = useState<ImpactoDeCompra | null>(null)

  async function accion(fn: () => Promise<unknown>) {
    try {
      await fn()
      alCambio()
      return true
    } catch (e) {
      alError(mensaje(e))
      return false
    }
  }

  async function comprar(ing: Ingrediente) {
    const t = await pedir({
      titulo: `Compra de ${ing.nombre}`,
      // LA DECISION FISCAL, A LA VISTA Y EN EL MOMENTO: esta compra no trae
      // factura, asi que no genera credito de IVA.
      texto: <TextoCompra />,
      campos: [
        { nombre: 'cantidad', etiqueta: 'Cuánto entra', sufijo: ing.unidad, tipo: 'numero', min: 0.0001 },
        {
          nombre: 'costo',
          etiqueta: 'Cuánto pagaste en total, sin IVA',
          tipo: 'numero',
          opcional: true,
          ayuda: 'Vacío = se mantiene el costo actual. El IVA no es parte del costo de la mercancía.',
        },
        {
          nombre: 'moneda',
          etiqueta: 'En qué moneda pagaste',
          tipo: 'opciones',
          valor: '$',
          opciones: [
            { valor: '$', texto: 'Dólares' },
            { valor: 'Bs', texto: `Bolívares${tasa?.bcv ? ` (a ${tasa.bcv.toFixed(2)})` : ''}` },
          ],
        },
        { nombre: 'metodo', etiqueta: 'De dónde salió la plata', tipo: 'opciones', opciones: METODOS_DE_PAGO.map((m) => ({ valor: m, texto: m })) },
      ],
      aceptar: 'Registrar compra',
    })
    if (!t) return
    if (t.moneda === 'Bs' && !tasa?.bcv) {
      alError('No se pudo obtener la tasa del día. Intenta de nuevo o registra en dólares.')
      return
    }
    const costo = t.costo ? Number(t.costo) : undefined
    const costoUsd = costo !== undefined && t.moneda === 'Bs' ? costo / (tasa!.bcv as number) : costo
    await accion(async () => {
      const r = await apiInventario.comprar(ing.id, Number(t.cantidad), costoUsd, t.metodo)
      if (r.revisar_precios) setImpacto(r)
    })
  }

  // Mas de lo que hay casi siempre es la unidad equivocada: el servidor la
  // frena y aqui se pregunta antes de anotarla igual.
  async function sacarConConfirmacion(fn: (forzar: boolean) => Promise<unknown>) {
    try {
      await fn(false)
      alCambio()
    } catch (e) {
      if (esMasDeLoQueHay(e)) {
        const ok = await confirmar({
          titulo: '¿Seguro que es esa cantidad?',
          texto: `${e.message} Revisa la unidad antes de anotarla.`,
          aceptar: 'Anotar igual',
          peligro: true,
        })
        if (ok) await accion(() => fn(true))
        return
      }
      alError(mensaje(e))
    }
  }

  async function merma(ing: Ingrediente) {
    const t = await pedir({
      titulo: `Merma de ${ing.nombre}`,
      texto: 'Lo que se dañó, se quemó o se botó. Es plata perdida y así queda registrada.',
      campos: [
        {
          nombre: 'cantidad',
          etiqueta: 'Cuánto se perdió',
          sufijo: ing.unidad,
          tipo: 'numero',
          min: 0.0001,
          ayuda: `Hay ${cantidad(ing.stock_actual)} ${unidadDe(ing.stock_actual, ing.unidad)}.`,
        },
        { nombre: 'motivo', etiqueta: 'Motivo', placeholder: 'Se quemó, se dañó, se cayó...', opcional: true },
      ],
      aceptar: 'Registrar merma',
      peligro: true,
    })
    if (!t) return
    await sacarConConfirmacion((forzar) => apiInventario.merma(ing.id, Number(t.cantidad), t.motivo, forzar))
  }

  async function consumoPersonal(ing: Ingrediente) {
    const t = await pedir({
      titulo: `Consumo del personal: ${ing.nombre}`,
      texto: 'Se lo comió un empleado. Es costo laboral, no pérdida: no ensucia el indicador de merma.',
      campos: [
        {
          nombre: 'cantidad',
          etiqueta: 'Cuánto',
          sufijo: ing.unidad,
          tipo: 'numero',
          min: 0.0001,
          ayuda: `Hay ${cantidad(ing.stock_actual)} ${unidadDe(ing.stock_actual, ing.unidad)}.`,
        },
        { nombre: 'motivo', etiqueta: 'Para quién / qué turno', opcional: true },
      ],
      aceptar: 'Registrar',
    })
    if (!t) return
    await sacarConConfirmacion((forzar) => apiInventario.consumoPersonal(ing.id, Number(t.cantidad), t.motivo, forzar))
  }

  async function contar(ing: Ingrediente) {
    const real = await pedirNumero({
      titulo: `Contar ${ing.nombre}`,
      texto: `El sistema dice ${cantidad(ing.stock_actual)} ${unidadDe(ing.stock_actual, ing.unidad)}. Lo que diga la balanza manda: la diferencia queda como merma o como sobrante.`,
      etiqueta: 'Cuánto hay realmente',
      sufijo: ing.unidad,
      valor: cantidad(ing.stock_actual),
      aceptar: 'Guardar conteo',
    })
    if (real === null) return
    await accion(() => apiInventario.ajustar(ing.id, real))
  }

  const hojas = (
    <>
      {hoja}
      {impacto ? <HojaImpacto impacto={impacto} alCerrar={() => setImpacto(null)} /> : null}
    </>
  )
  return { comprar, merma, consumoPersonal, contar, pedir, pedirNumero, pedirTexto, hojas }
}

function TextoCompra() {
  const t = useTema()
  const fuerte = { fontFamily: LETRA.textoFuerte, color: t.tinta }
  return (
    <Text style={[estilos.texto, { color: t.suave }]}>
      Compra <Text style={fuerte}>sin factura</Text>: entra al inventario y sale de la gaveta, pero{' '}
      <Text style={fuerte}>no descuenta IVA</Text>. Si tienes la factura, cárgala en Compras para aprovechar el crédito fiscal.
    </Text>
  )
}

/**
 * Despues de una compra que subio mucho: lo que paso con el costo y con el
 * margen de cada producto que la usa. Es la cuenta, no una recomendacion: el
 * precio lo decide el dueño.
 */
function HojaImpacto({ impacto, alCerrar }: { impacto: ImpactoDeCompra; alCerrar: () => void }) {
  const t = useTema()
  const { fmt } = useMoneda()
  const u = impacto.ingrediente.unidad
  return (
    <HojaFormulario
      visible
      alCerrar={alCerrar}
      titulo={`${impacto.ingrediente.nombre} subió ${impacto.salto_pct?.toFixed(0)}%`}
      pie={
        <View style={{ flex: 1 }}>
          <Boton texto="Entendido" alTocar={alCerrar} />
        </View>
      }
    >
      <Text style={[estilos.texto, { color: t.suave }]}>
        Pagaste {fmt(impacto.costo_pagado)} por {u}; la compra anterior fue a {fmt(impacto.costo_anterior)}.
      </Text>
      {impacto.posible_error_de_unidad ? (
        <View style={[s.caja, { backgroundColor: t.peligroSuave }]}>
          <Text style={[estilos.nota, { color: t.peligro }]}>
            <Text style={{ fontFamily: LETRA.textoFuerte }}>Revisa la cantidad. </Text>
            {impacto.posible_error_de_unidad}
          </Text>
        </View>
      ) : null}
      <Text style={[estilos.nota, { color: t.tenue }]}>
        El costo promedio quedó en {fmt(impacto.ingrediente.costo_unitario)} porque mezcla lo que ya tenías. Los márgenes de abajo son los de
        verdad: los que te quedan si tienes que reponer a este precio.
      </Text>
      {impacto.productos.length > 0 ? (
        <View style={{ gap: 8 }}>
          {impacto.productos.map((p) => (
            <View
              key={p.variante_id}
              style={[s.caja, { backgroundColor: p.a_perdida ? t.peligroSuave : p.margen_flaco ? t.avisoSuave : t.gris100 }]}
            >
              <View style={s.fila}>
                <Text style={[s.nombre, { color: t.tinta }]}>{p.nombre}</Text>
                <Text style={[s.cifra, { color: t.tinta }]}>{fmt(p.precio)}</Text>
              </View>
              <Text style={[estilos.nota, { color: t.suave, marginTop: 4 }]}>
                margen {p.margen_antes_pct?.toFixed(0)}% →{' '}
                <Text style={{ fontFamily: LETRA.textoFuerte, color: p.a_perdida ? t.peligro : t.tinta }}>{p.margen_despues_pct?.toFixed(0)}%</Text>
                {p.a_perdida ? ' · lo vendes a pérdida' : ''}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={[estilos.nota, { color: t.suave }]}>Ningún producto del menú usa esta mercancía todavía.</Text>
      )}
    </HojaFormulario>
  )
}

const s = StyleSheet.create({
  caja: { borderRadius: 14, padding: 12 },
  fila: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  nombre: { fontFamily: LETRA.textoFuerte, fontSize: 15, flexShrink: 1 },
  cifra: { fontFamily: LETRA.cifra, fontSize: 15 },
})
