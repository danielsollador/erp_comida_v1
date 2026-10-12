import { useState, type ReactNode } from 'react'
import { View } from 'react-native'
import { METODOS_PAGO, necesitaReferencia } from '../../../../frontend/src/lib/pagos'
import { apiVentas } from '../../lib/api-ventas'
import { avisar } from '../../lib/dialogo'
import { aNumero } from '../../lib/numeros'
import type { VentaFila } from '../../lib/tipos'
import { CampoNumero, HojaFormulario, Selector } from '../kit'
import { Aviso, Boton, Campo } from '../ui'
import { enDolares } from './logica'

/*
 * LOS TRES CUADROS DEL DETALLE DE UNA VENTA, con los textos de pages/Ventas.tsx
 * de la web: facturar tarde, devolver y cobrar lo que quedo a credito. En la
 * web son ventanas de pregunta seguidas (`dialogo.pedir`, `pedirNumero`,
 * `elegir`); aqui cada uno es un formulario que sube desde abajo, con sus
 * campos juntos, las mismas validaciones y el error del servidor tal cual.
 */

type Base = { v: VentaFila; visible: boolean; alCerrar: () => void; alListo: () => void }

/** El pie de siempre: Cancelar y la accion. */
function Pie({ texto, ocupado, peligro, alTocar, alCerrar }: { texto: string; ocupado: boolean; peligro?: boolean; alTocar: () => void; alCerrar: () => void }) {
  return (
    <>
      <View style={{ flex: 1 }}>
        <Boton texto="Cancelar" tono="neutro" alTocar={alCerrar} />
      </View>
      <View style={{ flex: 1 }}>
        <Boton texto={texto} tono={peligro ? 'peligro' : 'acento'} ocupado={ocupado} alTocar={alTocar} />
      </View>
    </>
  )
}

const FALTA = 'Falta este dato'

// ── Facturar ────────────────────────────────────────────────────────────────

/**
 * El dueño no siempre sabe al cobrar si va a facturar: a veces lo decide al
 * final de la semana, con el talonario en la mano. Solo el numero es
 * obligatorio: sin RIF ni nombre va como consumidor final (asi lo dice el
 * texto, y asi lo acepta el servidor).
 */
export function FormFacturar({ v, visible, alCerrar, alListo }: Base) {
  const [numero, setNumero] = useState('')
  const [control, setControl] = useState('')
  const [rif, setRif] = useState('')
  const [razon, setRazon] = useState('')
  const [falta, setFalta] = useState(false)
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function facturar() {
    setError('')
    if (!numero.trim()) {
      setFalta(true)
      return
    }
    setOcupado(true)
    try {
      await apiVentas.facturar(v.id, numero.trim(), {
        numero_control: control.trim(),
        rif_cliente: rif.trim(),
        razon_social_cliente: razon.trim(),
      })
      alListo()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Intenta de nuevo.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <HojaFormulario
      visible={visible}
      alCerrar={alCerrar}
      titulo={`Facturar la venta #${v.numero}`}
      subtitulo="El número sale del talonario o de la máquina fiscal. El resto es opcional: sin RIF ni nombre va como consumidor final."
      pie={<Pie texto="Facturar" ocupado={ocupado} alTocar={() => void facturar()} alCerrar={alCerrar} />}
    >
      {error ? <Aviso tono="peligro" texto={`No se pudo facturar. ${error}`} /> : null}
      <Campo
        rotulo="Número de factura"
        value={numero}
        onChangeText={(x) => {
          setNumero(x)
          setFalta(false)
        }}
        error={falta ? FALTA : undefined}
        autoFocus
      />
      <Campo rotulo="Número de control" value={control} onChangeText={setControl} />
      <Campo rotulo="RIF o cédula del cliente" value={rif} onChangeText={setRif} placeholder="J-12345678-9 o V-12345678" autoCapitalize="characters" />
      <Campo rotulo="Nombre o razón social" value={razon} onChangeText={setRazon} />
    </HojaFormulario>
  )
}

// ── Devolver ────────────────────────────────────────────────────────────────

/**
 * El cliente trajo la comida de vuelta. Distinto de anular: aqui ya hubo
 * venta, asi que se deshace entera (el ingreso, el IVA y la plata).
 */
export function FormDevolver({ v, visible, alCerrar, alListo, total }: Base & { total: string }) {
  const [motivo, setMotivo] = useState('La comida estaba mala')
  const [recuperable, setRecuperable] = useState<'no' | 'si'>('no')
  const [nc, setNc] = useState('')
  const [faltan, setFaltan] = useState<{ motivo?: boolean; nc?: boolean }>({})
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)

  async function devolver() {
    setError('')
    const f = { motivo: !motivo.trim(), nc: v.facturado && !nc.trim() }
    setFaltan(f)
    if (f.motivo || f.nc) return
    setOcupado(true)
    try {
      await apiVentas.devolver(v.id, {
        recuperable: recuperable === 'si',
        nota_credito: v.facturado ? nc.trim() : undefined,
        motivo: motivo.trim(),
      })
      alListo()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Intenta de nuevo.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <HojaFormulario
      visible={visible}
      alCerrar={alCerrar}
      titulo={`Devolver la venta #${v.numero}`}
      subtitulo={`Se le regresan ${total} al cliente y la venta se revierte entera: deja de contar como ingreso y deja de deber IVA.`}
      pie={<Pie texto="Devolver" peligro ocupado={ocupado} alTocar={() => void devolver()} alCerrar={alCerrar} />}
    >
      {error ? <Aviso tono="peligro" texto={`No se pudo devolver. ${error}`} /> : null}
      <Campo rotulo="Qué pasó" value={motivo} onChangeText={setMotivo} error={faltan.motivo ? FALTA : undefined} />
      {/* Define si el costo vuelve al inventario o se reconoce como merma. */}
      <Selector<'no' | 'si'>
        forma="campo"
        etiqueta="La comida se puede volver a vender"
        opciones={[
          { valor: 'no', texto: 'No, se bota (se registra como merma)' },
          { valor: 'si', texto: 'Sí, vuelve al inventario' },
        ]}
        valor={recuperable}
        alCambiar={setRecuperable}
      />
      {/* Sin la nota de credito la factura no puede salir del Libro de Ventas. */}
      {v.facturado ? (
        <Campo
          rotulo={`Número de la nota de crédito (factura ${v.numero_factura})`}
          value={nc}
          onChangeText={setNc}
          error={faltan.nc ? FALTA : undefined}
        />
      ) : null}
    </HojaFormulario>
  )
}

// ── Cobrar lo fiado ─────────────────────────────────────────────────────────

/**
 * Una venta a credito no se queda asi para siempre: el cliente vuelve a
 * pagar, todo o en abonos, y se cierra desde aqui sin ir hasta Caja. Si el
 * pago no entra por la gaveta, lleva comprobante, igual que en el mostrador.
 */
export function FormCobrarFiado({ v, visible, alCerrar, alListo, debe }: Base & { debe: string }) {
  const [monto, setMonto] = useState(String(v.fiado_pendiente).replace('.', ','))
  const [metodo, setMetodo] = useState('')
  const [referencia, setReferencia] = useState('')
  const [errores, setErrores] = useState<{ monto?: string; metodo?: string; referencia?: string }>({})
  const [error, setError] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const quien = `Cobrar a ${v.cliente || 'cliente'}`
  const conReferencia = metodo !== '' && necesitaReferencia(metodo)

  async function cobrar() {
    setError('')
    const n = aNumero(monto)
    const malos: typeof errores = {}
    if (!monto.trim()) malos.monto = FALTA
    else if (!Number.isFinite(n)) malos.monto = 'Tiene que ser un número'
    else if (n < 0.01) malos.monto = 'Mínimo 0,01'
    if (!metodo) malos.metodo = FALTA
    if (conReferencia && !referencia.trim()) malos.referencia = FALTA
    setErrores(malos)
    if (Object.keys(malos).length) return
    setOcupado(true)
    try {
      const r = await apiVentas.cobrarFiado(v.id, metodo, Math.round(n * 100) / 100, conReferencia ? referencia.trim() : '')
      if (!r.saldado) await avisar('Abono registrado', `Entregó ${enDolares(r.cobrado)} y queda debiendo ${enDolares(r.queda)}.`)
      alListo()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Intenta de nuevo.')
    } finally {
      setOcupado(false)
    }
  }

  const pie: ReactNode = <Pie texto="Cobrar" ocupado={ocupado} alTocar={() => void cobrar()} alCerrar={alCerrar} />
  return (
    <HojaFormulario visible={visible} alCerrar={alCerrar} titulo={quien} pie={pie}>
      {error ? <Aviso tono="peligro" texto={`No se pudo cobrar. ${error}`} /> : null}
      <CampoNumero
        rotulo="Cuánto entrega ($)"
        prefijo="$"
        valor={monto}
        alCambiar={setMonto}
        ayuda={`Debe ${debe}. Si entrega menos, queda abonado.`}
        error={errores.monto}
      />
      <Selector
        forma="campo"
        etiqueta="¿Cómo paga?"
        titulo={`${enDolares(Number.isFinite(aNumero(monto)) ? aNumero(monto) : 0)}. ¿Cómo paga?`}
        opciones={METODOS_PAGO.map((m) => ({ valor: m, texto: m }))}
        valor={metodo || undefined}
        alCambiar={setMetodo}
        error={errores.metodo}
      />
      {conReferencia ? (
        <Campo
          rotulo={`Referencia del pago por ${metodo}`}
          value={referencia}
          onChangeText={setReferencia}
          placeholder="Número de confirmación, ticket o comprobante"
          error={errores.referencia}
        />
      ) : null}
    </HojaFormulario>
  )
}
