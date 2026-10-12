import { useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { apiContabilidad } from '../../lib/api-contabilidad'
import { useCarga } from '../../lib/carga'
import { confirmar } from '../../lib/dialogo'
import { useMoneda } from '../../lib/moneda'
import { LETRA, useTema } from '../../lib/tema'
import type { AsientoContable, CuentaContable } from '../../lib/tipos'
import { Buscador, FilaFiltros, Pastilla, Selector, useDisposicion } from '../kit'
import { Aviso, Cargando, Ficha, Nota, Problema } from '../ui'
import AsientoManual from './AsientoManual'
import { ElegirPeriodoContable, type PeriodoContable } from './periodo'
import { BotonChico, fechaHoraVE, mensajeDe, Monto, nombreOrigen, p, useRefrescoDeSeccion, VerMas } from './piezas'

/**
 * LOS ASIENTOS DEL PERIODO, para buscar uno y ver como aterrizo: por cuenta
 * (todo lo que movio la 6060), por origen (solo las ventas), por numero o
 * por lo que diga ("#495", "Zelle", "Distribuidora"). Cada asiento se lee
 * como en papel: sus cuentas con el debe y el haber, y el total que cuadra.
 * El asiento a mano, que casi nunca hace falta, queda detras de un boton.
 */
export default function Diario({ periodo, alCambiarPeriodo }: { periodo: PeriodoContable; alCambiarPeriodo: (p: PeriodoContable) => void }) {
  const t = useTema()
  const { fmt } = useMoneda()
  const { datos, error, refrescando, refrescar } = useCarga(
    async () => {
      const [asientos, cuentas] = await Promise.all([
        apiContabilidad.listarAsientos(periodo.desde, periodo.hasta),
        apiContabilidad.planCuentas(),
      ])
      return { asientos, cuentas, clave: `${periodo.desde}|${periodo.hasta}` }
    },
    300,
    `${periodo.desde}|${periodo.hasta}`,
  )
  useRefrescoDeSeccion(refrescando, refrescar)
  const [cuenta, setCuenta] = useState('')
  const [origen, setOrigen] = useState('')
  const [texto, setTexto] = useState('')
  const [ver, setVer] = useState(50)
  const [creando, setCreando] = useState(false)
  const [errorAccion, setErrorAccion] = useState('')
  // Lo que acaba de pasar, en una linea: el asiento nuevo puede no caer en el
  // periodo que se esta mirando, y sin esto pareceria que no se guardo.
  const [hecho, setHecho] = useState('')

  // Mientras llega el periodo nuevo, lo del anterior se queda a la vista
  // (atenuado): nada de parpadear a "cargando".
  const vigente = datos?.clave === `${periodo.desde}|${periodo.hasta}`
  const asientos = useMemo(() => datos?.asientos ?? [], [datos])
  const cuentas: CuentaContable[] = datos?.cuentas ?? []

  // Los origenes que de verdad hay en el periodo, con cuantos de cada uno.
  const origenes = useMemo(() => {
    const n = new Map<string, number>()
    for (const a of asientos) n.set(a.origen, (n.get(a.origen) ?? 0) + 1)
    return [...n.entries()].sort((a, b) => nombreOrigen(a[0]).localeCompare(nombreOrigen(b[0])))
  }, [asientos])

  const filtrados = useMemo(() => {
    const q = texto.trim().toLowerCase().replace(/^#/, '')
    return asientos
      .filter((a) => !origen || a.origen === origen)
      .filter((a) => !cuenta || a.movimientos.some((m) => m.cuenta_codigo === cuenta))
      .filter(
        (a) =>
          !q ||
          String(a.id) === q ||
          String(a.referencia_id ?? '') === q ||
          a.descripcion.toLowerCase().includes(q) ||
          a.movimientos.some((m) => `${m.cuenta_codigo} ${m.cuenta_nombre}`.toLowerCase().includes(q)),
      )
      .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id)
  }, [asientos, origen, cuenta, texto])

  // Con una cuenta elegida: lo que se movio en ella en lo filtrado.
  const deLaCuenta = useMemo(() => {
    if (!cuenta) return null
    let debe = 0
    let haber = 0
    for (const a of filtrados)
      for (const m of a.movimientos)
        if (m.cuenta_codigo === cuenta) {
          debe += m.debe
          haber += m.haber
        }
    return { debe, haber }
  }, [filtrados, cuenta])

  async function borrar(a: AsientoContable) {
    // En la web es un enlace chico; en el telefono un toque de mas lo borraria
    // sin querer, asi que se pregunta antes.
    if (!(await confirmar({ titulo: `¿Borrar el asiento #${a.id}?`, texto: a.descripcion, aceptar: 'Borrar', peligro: true }))) return
    setErrorAccion('')
    setHecho('')
    try {
      await apiContabilidad.eliminarAsiento(a.id)
      setHecho(`Asiento #${a.id} borrado.`)
      refrescar()
    } catch (e) {
      setErrorAccion(mensajeDe(e, 'No se pudo borrar'))
    }
  }

  const hayFiltro = !!(cuenta || origen || texto)
  const nombreCuenta = cuentas.find((c) => c.codigo === cuenta)?.nombre

  return (
    <>
      <FilaFiltros>
        <ElegirPeriodoContable
          periodo={periodo}
          alCambiar={(nuevo) => {
            setVer(50)
            alCambiarPeriodo(nuevo)
          }}
        />
        <Selector
          etiqueta="Cuenta"
          titulo="Ver una cuenta"
          opciones={[{ valor: '', texto: 'Todas las cuentas' }, ...cuentas.map((c) => ({ valor: c.codigo, texto: `${c.codigo} · ${c.nombre}` }))]}
          valor={cuenta}
          alCambiar={(v) => {
            setVer(50)
            setCuenta(v)
          }}
        />
        <Selector
          etiqueta="Origen"
          titulo="Ver un origen"
          opciones={[{ valor: '', texto: 'Todo origen' }, ...origenes.map(([o, n]) => ({ valor: o, texto: nombreOrigen(o), contador: n }))]}
          valor={origen}
          alCambiar={(v) => {
            setVer(50)
            setOrigen(v)
          }}
        />
      </FilaFiltros>
      <Buscador valor={texto} alCambiar={setTexto} placeholder="Buscar: #495, Zelle, proveedor…" />

      <View style={estilos.resumen}>
        <Text style={[estilos.cuenta, { color: t.suave }]}>
          <Text style={{ color: t.tinta, fontFamily: LETRA.cifraFuerte }}>{filtrados.length}</Text>{' '}
          {filtrados.length === 1 ? 'asiento' : 'asientos'}
          {hayFiltro ? ` de ${asientos.length}` : ''}
        </Text>
        {hayFiltro ? (
          <BotonChico
            texto="Quitar filtros"
            tono="enlace"
            alTocar={() => {
              setCuenta('')
              setOrigen('')
              setTexto('')
            }}
          />
        ) : null}
        <View style={{ flex: 1 }} />
        <BotonChico texto="Asiento manual" alTocar={() => setCreando(true)} />
      </View>
      {deLaCuenta ? (
        <Nota>
          {cuenta} {nombreCuenta}: debe {fmt(deLaCuenta.debe)} · haber {fmt(deLaCuenta.haber)} · neto{' '}
          <Text style={{ color: t.tinta, fontFamily: LETRA.cifraFuerte }}>{fmt(deLaCuenta.debe - deLaCuenta.haber)}</Text>
        </Nota>
      ) : null}
      {errorAccion ? <Problema mensaje={errorAccion} /> : null}
      {hecho ? <Aviso texto={hecho} /> : null}

      {error && !datos ? <Problema mensaje={error} alReintentar={refrescar} /> : null}
      {!datos && !error ? <Cargando /> : null}
      {datos && filtrados.length === 0 ? (
        <Ficha style={{ alignItems: 'center', paddingVertical: 28 }}>
          <Nota style={{ textAlign: 'center' }}>
            {asientos.length === 0 ? 'No hay asientos en este periodo.' : 'Ningún asiento coincide con el filtro.'}
          </Nota>
        </Ficha>
      ) : null}
      <View style={{ gap: 10, opacity: datos && !vigente ? 0.55 : 1 }}>
        {filtrados.slice(0, ver).map((a) => (
          <TarjetaAsiento key={a.id} asiento={a} cuenta={cuenta} alBorrar={() => void borrar(a)} />
        ))}
      </View>
      <VerMas quedan={filtrados.length - ver} alTocar={() => setVer((v) => v + 50)} />

      <AsientoManual
        visible={creando}
        cuentas={cuentas}
        alCerrar={() => setCreando(false)}
        alCrear={(nuevo) => {
          setCreando(false)
          setErrorAccion('')
          setHecho(`Asiento #${nuevo.id} guardado: ${nuevo.descripcion}`)
          refrescar()
        }}
      />
    </>
  )
}

/** Un asiento como en papel: sus cuentas con el debe y el haber, y el total que cuadra. */
function TarjetaAsiento({ asiento: a, cuenta, alBorrar }: { asiento: AsientoContable; cuenta: string; alBorrar: () => void }) {
  const t = useTema()
  const { fmt } = useMoneda()
  const { tablet } = useDisposicion()
  const ancho = tablet ? 120 : 92
  const debe = a.movimientos.reduce((x, m) => x + m.debe, 0)
  const haber = a.movimientos.reduce((x, m) => x + m.haber, 0)
  const linea = { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.gris200 }
  return (
    <Ficha style={{ padding: 16, gap: 8 }}>
      <View style={estilos.cabeza}>
        <Text style={[p.codigo, { color: t.tenue }]}>#{a.id}</Text>
        <Text style={[estilos.fecha, { color: t.suave }]} numberOfLines={1}>
          {fechaHoraVE(a.fecha)}
        </Text>
        <View style={{ flexShrink: 1 }}>
          <Pastilla texto={nombreOrigen(a.origen)} />
        </View>
        <View style={{ flex: 1 }} />
        {a.origen === 'manual' ? <BotonChico texto="Borrar" tono="enlacePeligro" alTocar={alBorrar} /> : null}
      </View>
      <Text style={[estilos.descripcion, { color: t.tinta }]}>{a.descripcion}</Text>
      <View>
        <View style={estilos.fila}>
          <Text style={[p.columna, { color: t.tenue, flex: 1 }]}>Cuenta</Text>
          <Text style={[p.columna, { color: t.tenue, width: ancho, textAlign: 'right' }]}>Debe</Text>
          <Text style={[p.columna, { color: t.tenue, width: ancho, textAlign: 'right' }]}>Haber</Text>
        </View>
        {a.movimientos.map((m) => {
          const marcada = m.cuenta_codigo === cuenta
          return (
            <View key={m.id} style={[estilos.fila, linea, marcada && { backgroundColor: t.acentoSuave }]}>
              {/* El haber va corrido a la derecha, como en el libro de papel. */}
              <Text
                style={[estilos.movimiento, { color: t.tinta, flex: 1, paddingLeft: m.haber && !m.debe ? 14 : 0 }, marcada && { fontFamily: LETRA.textoFuerte }]}
                numberOfLines={2}
              >
                <Text style={[p.codigo, { color: t.tenue }]}>{m.cuenta_codigo} </Text>
                {m.cuenta_nombre}
              </Text>
              <Monto ancho={ancho} fuerte={marcada}>
                {m.debe ? fmt(m.debe) : ''}
              </Monto>
              <Monto ancho={ancho} fuerte={marcada}>
                {m.haber ? fmt(m.haber) : ''}
              </Monto>
            </View>
          )
        })}
        <View style={[estilos.fila, { borderTopWidth: 1, borderTopColor: t.gris200 }]}>
          <Text style={[estilos.movimiento, { color: t.suave, flex: 1 }]}>Total</Text>
          <Monto ancho={ancho} color={t.suave}>
            {fmt(debe)}
          </Monto>
          <Monto ancho={ancho} color={t.suave}>
            {fmt(haber)}
          </Monto>
        </View>
      </View>
    </Ficha>
  )
}

const estilos = StyleSheet.create({
  resumen: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cuenta: { fontFamily: LETRA.texto, fontSize: 14 },
  cabeza: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28 },
  fecha: { fontFamily: LETRA.texto, fontSize: 13, flexShrink: 1 },
  descripcion: { fontFamily: LETRA.textoFuerte, fontSize: 15, lineHeight: 21 },
  fila: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7 },
  movimiento: { fontFamily: LETRA.texto, fontSize: 13.5, lineHeight: 18 },
})
