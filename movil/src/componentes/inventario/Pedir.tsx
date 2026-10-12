import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Text, View } from 'react-native'
import { factorEntre, otraUnidad, sinRuido } from '../../../../frontend/src/lib/unidades'
import { aNumero } from '../../lib/numeros'
import { useTema } from '../../lib/tema'
import { HojaFormulario } from '../kit'
import { Boton, Campo, estilos } from '../ui'
import { CasillaCantidad, Opciones } from './comun'

/*
 * PEDIR DATOS EN UNA HOJA, como `dialogo.pedir` de la web
 * (components/dialogo.tsx): un titulo, una explicacion, unos campos, y la
 * respuesta con `await`. Las mismas reglas: todo campo es obligatorio salvo
 * `opcional`; una cifra tiene que ser un numero y no menos de `min`; una
 * cantidad en kg o lt lleva su interruptor (kg ⇄ g) y vuelve SIEMPRE en la
 * unidad de la ficha, se haya escrito en la que se haya escrito.
 *
 * En el telefono es una hoja que sube desde abajo y ocupa casi toda la
 * pantalla: con el teclado abierto se sigue viendo que se escribe.
 */

export type CampoPedido = {
  nombre: string
  etiqueta: string
  tipo?: 'texto' | 'numero' | 'opciones'
  valor?: string | number
  opciones?: { valor: string; texto: string }[]
  /** La unidad. Si es kg o lt, la casilla lleva su interruptor (kg ⇄ g). */
  sufijo?: string
  ayuda?: string
  placeholder?: string
  opcional?: boolean
  min?: number
  max?: number
}

export type Pedido = {
  titulo: string
  texto?: ReactNode
  campos: CampoPedido[]
  aceptar?: string
  peligro?: boolean
}

type Pendiente = { datos: Pedido; resolver: (v: Record<string, string> | null) => void; n: number }

/**
 * `pedir(datos)` abre la hoja y devuelve lo escrito (ya validado y en la
 * unidad de la ficha) o null si se cancela. `hoja` va dibujada en la pantalla.
 */
export function usePedir() {
  const [pendiente, setPendiente] = useState<Pendiente | null>(null)
  const contador = useRef(0)
  const pedir = useCallback(
    (datos: Pedido) =>
      new Promise<Record<string, string> | null>((resolver) => {
        contador.current += 1
        setPendiente({ datos, resolver, n: contador.current })
      }),
    [],
  )
  /** Un solo numero: null si se cancela. */
  const pedirNumero = useCallback(
    async (d: { titulo: string; texto?: ReactNode; etiqueta?: string; valor?: string; sufijo?: string; ayuda?: string; min?: number; aceptar?: string }) => {
      const r = await pedir({
        titulo: d.titulo,
        texto: d.texto,
        aceptar: d.aceptar,
        campos: [{ nombre: 'v', etiqueta: d.etiqueta ?? 'Cantidad', tipo: 'numero', valor: d.valor, sufijo: d.sufijo, ayuda: d.ayuda, min: d.min }],
      })
      return r ? Number(r.v) : null
    },
    [pedir],
  )
  /** Un solo texto: null si se cancela. */
  const pedirTexto = useCallback(
    async (d: { titulo: string; texto?: ReactNode; etiqueta?: string; valor?: string; placeholder?: string; aceptar?: string }) => {
      const r = await pedir({
        titulo: d.titulo,
        texto: d.texto,
        aceptar: d.aceptar,
        campos: [{ nombre: 'v', etiqueta: d.etiqueta ?? 'Nombre', valor: d.valor, placeholder: d.placeholder }],
      })
      return r ? r.v : null
    },
    [pedir],
  )
  const hoja = pendiente ? (
    <Formulario
      key={pendiente.n}
      datos={pendiente.datos}
      alTerminar={(v) => {
        pendiente.resolver(v)
        setPendiente(null)
      }}
    />
  ) : null
  return { pedir, pedirNumero, pedirTexto, hoja }
}

function Formulario({ datos, alTerminar }: { datos: Pedido; alTerminar: (v: Record<string, string> | null) => void }) {
  const t = useTema()
  const { titulo, texto, campos, aceptar = 'Aceptar', peligro = false } = datos
  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      campos.map((c) => [c.nombre, c.valor == null ? (c.tipo === 'opciones' ? c.opciones?.[0]?.valor ?? '' : '') : String(c.valor)]),
    ),
  )
  const [errores, setErrores] = useState<Record<string, string>>({})
  // En que unidad se esta escribiendo cada cantidad (kg ⇄ g, lt ⇄ ml).
  const [vistas, setVistas] = useState<Record<string, string>>({})
  const conUnidad = (c: CampoPedido) => c.tipo === 'numero' && !!c.sufijo && otraUnidad(c.sufijo) !== null
  const vistaDe = (c: CampoPedido) => vistas[c.nombre] ?? c.sufijo ?? ''
  const poner = (nombre: string, v: string) => setValores((a) => ({ ...a, [nombre]: v }))

  function validar(): Record<string, string> | null {
    const malos: Record<string, string> = {}
    const limpios: Record<string, string> = {}
    for (const c of campos) {
      const crudo = (valores[c.nombre] ?? '').trim()
      if (crudo === '') {
        if (c.opcional) {
          limpios[c.nombre] = ''
          continue
        }
        malos[c.nombre] = 'Falta este dato'
        continue
      }
      if (c.tipo === 'numero') {
        const escrito = aNumero(crudo)
        if (!Number.isFinite(escrito)) {
          malos[c.nombre] = 'Tiene que ser un número'
          continue
        }
        // Lo escrito en gramos se devuelve en kilos (o lo que diga la ficha).
        const factor = conUnidad(c) ? factorEntre(c.sufijo!, vistaDe(c)) : 1
        const n = escrito / factor
        const min = c.min ?? 0
        const enVista = (x: number) => `${sinRuido(x * factor)}${conUnidad(c) ? ` ${vistaDe(c)}` : ''}`
        if (n < min) {
          malos[c.nombre] = min === 0 ? 'No puede ser negativo' : `Mínimo ${enVista(min)}`
          continue
        }
        if (c.max != null && n > c.max) {
          malos[c.nombre] = `Máximo ${enVista(c.max)}`
          continue
        }
        limpios[c.nombre] = sinRuido(n)
        continue
      }
      limpios[c.nombre] = crudo
    }
    setErrores(malos)
    return Object.keys(malos).length ? null : limpios
  }

  return (
    <HojaFormulario
      visible
      alCerrar={() => alTerminar(null)}
      titulo={titulo}
      pie={
        <>
          <View style={{ flex: 1 }}>
            <Boton texto="Cancelar" tono="neutro" alTocar={() => alTerminar(null)} />
          </View>
          <View style={{ flex: 1.4 }}>
            <Boton
              texto={aceptar}
              tono={peligro ? 'peligro' : 'acento'}
              alTocar={() => {
                const v = validar()
                if (v) alTerminar(v)
              }}
            />
          </View>
        </>
      }
    >
      {texto ? typeof texto === 'string' ? <Text style={[estilos.texto, { color: t.suave }]}>{texto}</Text> : texto : null}
      {campos.map((c, i) => {
        const error = errores[c.nombre]
        if (conUnidad(c)) {
          const vista = vistaDe(c)
          return (
            <CasillaCantidad
              key={c.nombre}
              rotulo={c.etiqueta}
              unidad={c.sufijo!}
              vista={vista}
              alCambiarVista={(nueva) => {
                const x = aNumero(valores[c.nombre] ?? '')
                if (Number.isFinite(x)) poner(c.nombre, sinRuido((x / factorEntre(c.sufijo!, vista)) * factorEntre(c.sufijo!, nueva)))
                setVistas((v) => ({ ...v, [c.nombre]: nueva }))
              }}
              texto={valores[c.nombre] ?? ''}
              alCambiarTexto={(v) => poner(c.nombre, v)}
              ayuda={c.ayuda}
              error={error}
              placeholder={c.placeholder}
            />
          )
        }
        if (c.tipo === 'numero') {
          return (
            <CasillaCantidad
              key={c.nombre}
              rotulo={c.etiqueta}
              unidad={c.sufijo ?? ''}
              vista={c.sufijo ?? ''}
              alCambiarVista={() => undefined}
              texto={valores[c.nombre] ?? ''}
              alCambiarTexto={(v) => poner(c.nombre, v)}
              ayuda={c.ayuda}
              error={error}
              placeholder={c.placeholder}
            />
          )
        }
        if (c.tipo === 'opciones') {
          return (
            <View key={c.nombre} style={{ gap: 4 }}>
              <Opciones rotulo={c.etiqueta} opciones={c.opciones ?? []} valor={valores[c.nombre] ?? ''} alCambiar={(v) => poner(c.nombre, v)} />
              {c.ayuda ? <Text style={[estilos.nota, { color: t.tenue }]}>{c.ayuda}</Text> : null}
            </View>
          )
        }
        return (
          <Campo
            key={c.nombre}
            rotulo={c.etiqueta}
            value={valores[c.nombre]}
            onChangeText={(v) => poner(c.nombre, v)}
            placeholder={c.placeholder}
            ayuda={c.ayuda}
            error={error}
          />
        )
      })}
    </HojaFormulario>
  )
}
