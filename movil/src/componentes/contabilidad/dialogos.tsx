import { useCallback, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { aNumero, sinRuido } from '../../lib/numeros'
import { LETRA, useTema } from '../../lib/tema'
import { Hoja, OpcionHoja } from '../Hoja'
import { CampoNumero, HojaFormulario } from '../kit'
import { Boton, Campo } from '../ui'
import { fechaValida } from './piezas'

/*
 * LAS PREGUNTAS CON DATOS de la web (`dialogo.pedir`, `pedirNumero`,
 * `pedirTexto` y `elegir` de components/dialogo.tsx), para el telefono. La
 * web abre una ventana flotante y espera con `await`; aqui sube una hoja
 * desde abajo y se espera igual:
 *
 *   const { pedir, hoja } = usePedir()
 *   const r = await pedir({ titulo: 'Vida útil', campos: [...] })   // {meses: '60'} | null
 *   ...
 *   return <>{...}{hoja}</>
 *
 * Las mismas validaciones y los mismos mensajes que la web: "Falta este
 * dato", "Tiene que ser un número", "No puede ser negativo", "Mínimo 1".
 * (Las preguntas de si o no van por `confirmar` de lib/dialogo.)
 */

export type CampoPedido = {
  nombre: string
  etiqueta: string
  /** `entero`: meses, cantidades. `fecha`: AAAA-MM-DD (el telefono no trae calendario aqui). */
  tipo?: 'texto' | 'numero' | 'entero' | 'fecha'
  valor?: string | number
  /** La unidad, pegada a la etiqueta: "Cuánto vale hoy ($)". */
  sufijo?: string
  ayuda?: string
  placeholder?: string
  /** Se puede dejar vacio. Por defecto todo campo es obligatorio. */
  opcional?: boolean
  min?: number
  max?: number
  /** Solo cifras (un comprobante de 14 digitos): teclado numerico aunque sea texto. */
  soloCifras?: boolean
}

export type Pedido = {
  titulo: string
  texto?: string
  campos: CampoPedido[]
  aceptar?: string
  peligro?: boolean
}

type Abierto = { datos: Pedido; resolver: (v: Record<string, string> | null) => void; vez: number }

export function usePedir() {
  const [abierto, setAbierto] = useState<Abierto | null>(null)
  const [visible, setVisible] = useState(false)

  const pedir = useCallback(
    (datos: Pedido) =>
      new Promise<Record<string, string> | null>((resolver) => {
        setAbierto((a) => ({ datos, resolver, vez: (a?.vez ?? 0) + 1 }))
        setVisible(true)
      }),
    [],
  )

  // Resolver y cerrar van juntos: una promesa sin resolver dejaria a quien
  // pregunto esperando para siempre.
  const terminar = (v: Record<string, string> | null) => {
    abierto?.resolver(v)
    setVisible(false)
  }

  const hoja = abierto ? (
    <FormularioPedido key={abierto.vez} datos={abierto.datos} visible={visible} alTerminar={terminar} />
  ) : null
  return { pedir, hoja }
}

function FormularioPedido({
  datos,
  visible,
  alTerminar,
}: {
  datos: Pedido
  visible: boolean
  alTerminar: (v: Record<string, string> | null) => void
}) {
  const t = useTema()
  const { titulo, texto, campos, aceptar = 'Aceptar', peligro = false } = datos
  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(campos.map((c) => [c.nombre, c.valor == null ? '' : String(c.valor)])),
  )
  const [errores, setErrores] = useState<Record<string, string>>({})

  function validar(): Record<string, string> | null {
    const malos: Record<string, string> = {}
    const limpios: Record<string, string> = {}
    for (const c of campos) {
      const crudo = (valores[c.nombre] ?? '').trim()
      if (crudo === '') {
        if (c.opcional) limpios[c.nombre] = ''
        else malos[c.nombre] = 'Falta este dato'
        continue
      }
      if (c.tipo === 'numero' || c.tipo === 'entero') {
        const n = aNumero(crudo)
        if (!Number.isFinite(n)) {
          malos[c.nombre] = 'Tiene que ser un número'
          continue
        }
        const min = c.min ?? 0
        if (n < min) {
          malos[c.nombre] = min === 0 ? 'No puede ser negativo' : `Mínimo ${sinRuido(min)}`
          continue
        }
        if (c.max != null && n > c.max) {
          malos[c.nombre] = `Máximo ${sinRuido(c.max)}`
          continue
        }
        limpios[c.nombre] = sinRuido(n)
        continue
      }
      if (c.tipo === 'fecha' && !fechaValida(crudo)) {
        malos[c.nombre] = 'Escribe la fecha como AAAA-MM-DD'
        continue
      }
      limpios[c.nombre] = crudo
    }
    setErrores(malos)
    return Object.keys(malos).length ? null : limpios
  }

  const poner = (nombre: string, v: string) => setValores((a) => ({ ...a, [nombre]: v }))
  const enviar = () => {
    const v = validar()
    if (v) alTerminar(v)
  }

  return (
    <HojaFormulario
      visible={visible}
      alCerrar={() => alTerminar(null)}
      titulo={titulo}
      pie={
        <>
          <View style={{ flex: 1 }}>
            <Boton texto="Cancelar" tono="neutro" alTocar={() => alTerminar(null)} />
          </View>
          <View style={{ flex: 1 }}>
            <Boton texto={aceptar} tono={peligro ? 'peligro' : 'acento'} alTocar={enviar} />
          </View>
        </>
      }
    >
      {texto ? <Text style={[estilos.texto, { color: t.suave }]}>{texto}</Text> : null}
      {campos.map((c, i) => {
        const etiqueta = c.sufijo ? `${c.etiqueta} (${c.sufijo})` : c.etiqueta
        const error = errores[c.nombre]
        if (c.tipo === 'numero' || c.tipo === 'entero') {
          return (
            <CampoNumero
              key={c.nombre}
              rotulo={etiqueta}
              valor={valores[c.nombre] ?? ''}
              alCambiar={(v) => poner(c.nombre, v)}
              entero={c.tipo === 'entero'}
              placeholder={c.placeholder ?? '0'}
              autoFocus={i === 0}
              error={error}
              ayuda={c.ayuda}
              returnKeyType="done"
              onSubmitEditing={enviar}
            />
          )
        }
        return (
          <Campo
            key={c.nombre}
            rotulo={etiqueta}
            value={valores[c.nombre] ?? ''}
            onChangeText={(v) => poner(c.nombre, v)}
            placeholder={c.placeholder ?? (c.tipo === 'fecha' ? 'AAAA-MM-DD' : undefined)}
            autoFocus={i === 0}
            autoCapitalize={c.tipo === 'fecha' || c.soloCifras ? 'none' : 'sentences'}
            autoCorrect={c.tipo !== 'fecha' && !c.soloCifras}
            keyboardType={c.soloCifras ? 'number-pad' : 'default'}
            maxLength={c.tipo === 'fecha' ? 10 : undefined}
            error={error}
            ayuda={c.ayuda ?? (c.opcional ? 'Opcional.' : undefined)}
            returnKeyType="done"
            onSubmitEditing={enviar}
          />
        )
      })}
    </HojaFormulario>
  )
}

// ── Elegir ──────────────────────────────────────────────────────────────────

export type OpcionElegir = { valor: string; texto: string; detalle?: string; peligro?: boolean }

type Eleccion = { titulo: string; texto?: string; opciones: OpcionElegir[]; resolver: (v: string | null) => void }

/**
 * Elegir entre unas pocas opciones con su explicacion ("Por banco" / "En
 * efectivo · Sale de la gaveta."), como `dialogo.elegir` de la web: cada
 * opcion es un renglon grande que se toca sin apuntar. El dialogo del
 * sistema no deja poner la explicacion debajo, por eso va en una hoja.
 */
export function useElegir() {
  const t = useTema()
  const [abierto, setAbierto] = useState<Eleccion | null>(null)

  const elegir = useCallback(
    (titulo: string, opciones: OpcionElegir[], texto?: string) =>
      new Promise<string | null>((resolver) => setAbierto({ titulo, texto, opciones, resolver })),
    [],
  )

  const cerrar = (v: string | null) => {
    abierto?.resolver(v)
    setAbierto(null)
  }

  const hoja = (
    <Hoja visible={abierto !== null} alCerrar={() => cerrar(null)} titulo={abierto?.titulo}>
      {abierto?.texto ? <Text style={[estilos.elegirTexto, { color: t.tinta }]}>{abierto.texto}</Text> : null}
      {abierto?.opciones.map((o) => (
        <OpcionHoja key={o.valor} texto={o.texto} detalle={o.detalle} peligro={o.peligro} alTocar={() => cerrar(o.valor)} />
      ))}
      <View style={[estilos.separador, { backgroundColor: t.gris200 }]} />
      <OpcionHoja texto="Cancelar" alTocar={() => cerrar(null)} />
    </Hoja>
  )
  return { elegir, hoja }
}

const estilos = StyleSheet.create({
  texto: { fontFamily: LETRA.texto, fontSize: 15, lineHeight: 21 },
  elegirTexto: { fontFamily: LETRA.texto, fontSize: 15, lineHeight: 21, paddingHorizontal: 12, marginBottom: 8 },
  separador: { height: StyleSheet.hairlineWidth, marginHorizontal: 12, marginVertical: 4 },
})
