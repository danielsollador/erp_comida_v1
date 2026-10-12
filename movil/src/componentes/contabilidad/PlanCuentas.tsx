import { useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { apiContabilidad } from '../../lib/api-contabilidad'
import { useCarga } from '../../lib/carga'
import { useMoneda } from '../../lib/moneda'
import { LETRA, useTema } from '../../lib/tema'
import type { CuentaContable, FilaMayor } from '../../lib/tipos'
import Icono from '../Icono'
import { Buscador, FilaFiltros, HojaFormulario, ListaFicha, llano, Renglon, Selector } from '../kit'
import { Boton, Campo, Cargando, Nota, Problema } from '../ui'
import { BotonChico, Cabeza, fechaVE, mensajeDe, nombreTipo, p, TIPO_LABEL, useRefrescoDeSeccion, VerMas } from './piezas'

type OrdenPlan = 'codigo' | 'nombre' | 'tipo' | 'naturaleza'

const ORDENES: { valor: OrdenPlan; texto: string }[] = [
  { valor: 'codigo', texto: 'Código' },
  { valor: 'nombre', texto: 'Nombre' },
  { valor: 'tipo', texto: 'Tipo' },
  { valor: 'naturaleza', texto: 'Naturaleza' },
]

/**
 * EL PLAN DE CUENTAS, como la seccion de la web: abre por codigo, que es el
 * orden contable de toda la vida, pero se busca por codigo Y por nombre
 * (quien lleva la contabilidad busca "6020"; quien no, busca "merma"). Tocar
 * una cuenta abre su libro mayor encima, no debajo.
 */
export default function PlanCuentas() {
  const t = useTema()
  const { datos: cuentas, error, refrescando, refrescar } = useCarga(() => apiContabilidad.planCuentas(), 300)
  useRefrescoDeSeccion(refrescando, refrescar)
  const [busqueda, setBusqueda] = useState('')
  const [orden, setOrden] = useState<OrdenPlan>('codigo')
  const [creando, setCreando] = useState(false)
  const [mayor, setMayor] = useState<CuentaContable | null>(null)

  const visibles = useMemo(() => {
    const q = llano(busqueda.trim())
    const filtradas = (cuentas ?? []).filter((c) => !q || llano(`${c.codigo} ${c.nombre} ${nombreTipo(c.tipo)}`).includes(q))
    const clave = (c: CuentaContable) => (orden === 'tipo' ? nombreTipo(c.tipo) : c[orden])
    return [...filtradas].sort((a, b) => clave(a).localeCompare(clave(b)) || a.codigo.localeCompare(b.codigo))
  }, [cuentas, busqueda, orden])

  return (
    <>
      {/* El boton de crear, ARRIBA: con el plan entero delante, agregar una
          cuenta no puede pedir bajar veinticuatro renglones. */}
      <Cabeza
        titulo="Plan de cuentas"
        ayuda="Toca una cuenta para ver su libro mayor."
        accion={<BotonChico texto="Nueva cuenta" icono="mas" tono="acento" alTocar={() => setCreando(true)} />}
      />
      <FilaFiltros>
        <Selector<OrdenPlan>
          etiqueta="Ordenar"
          titulo="Ordenar el plan"
          opciones={ORDENES}
          valor={orden}
          alCambiar={setOrden}
        />
      </FilaFiltros>
      <Buscador valor={busqueda} alCambiar={setBusqueda} placeholder="Buscar por código o nombre" />

      {error && !cuentas ? <Problema mensaje={error} alReintentar={refrescar} /> : null}
      {!cuentas && !error ? <Cargando /> : null}
      {cuentas ? (
        <ListaFicha>
          {visibles.map((c, i) => (
            <Pressable
              key={c.id}
              onPress={() => setMayor(c)}
              accessibilityRole="button"
              accessibilityLabel={`${c.codigo} ${c.nombre}`}
              style={({ pressed }) => [
                estilos.cuenta,
                i < visibles.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.gris200 },
                { backgroundColor: pressed ? t.gris100 : 'transparent' },
              ]}
            >
              <Text style={[p.codigo, estilos.codigo, { color: t.tenue }]}>{c.codigo}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[estilos.nombre, { color: t.tinta }]} numberOfLines={2}>
                  {c.nombre}
                </Text>
                <Text style={[estilos.detalle, { color: t.suave }]}>
                  {nombreTipo(c.tipo)} · {c.naturaleza}
                </Text>
              </View>
              <Icono nombre="chevron" size={15} color={t.tenue} grosor={2.2} />
            </Pressable>
          ))}
          {visibles.length === 0 ? <Nota style={{ padding: 16 }}>Ninguna cuenta coincide con la búsqueda.</Nota> : null}
        </ListaFicha>
      ) : null}

      <NuevaCuenta
        visible={creando}
        alCerrar={() => setCreando(false)}
        alCrear={() => {
          setCreando(false)
          refrescar()
        }}
      />
      <LibroMayor cuenta={mayor} alCerrar={() => setMayor(null)} />
    </>
  )
}

/** El alta de una cuenta: codigo, nombre y tipo. La naturaleza la decide el tipo. */
function NuevaCuenta({ visible, alCerrar, alCrear }: { visible: boolean; alCerrar: () => void; alCrear: () => void }) {
  const t = useTema()
  const [codigo, setCodigo] = useState('')
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState<CuentaContable['tipo']>('gasto')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const cerrar = () => {
    setError('')
    alCerrar()
  }

  async function guardar() {
    setError('')
    if (!codigo.trim() || !nombre.trim()) {
      setError('Hacen falta el código y el nombre.')
      return
    }
    // La naturaleza no se pregunta: la decide el tipo, y equivocarse ahi deja
    // una cuenta que suma al reves para siempre.
    const naturaleza = tipo === 'activo' || tipo === 'costo' || tipo === 'gasto' ? 'deudora' : 'acreedora'
    setGuardando(true)
    try {
      await apiContabilidad.crearCuenta({ codigo: codigo.trim(), nombre: nombre.trim(), tipo, naturaleza, activa: true })
      setCodigo('')
      setNombre('')
      setTipo('gasto')
      alCrear()
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo crear la cuenta'))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <HojaFormulario
      visible={visible}
      alCerrar={cerrar}
      titulo="Nueva cuenta"
      subtitulo="El código decide dónde entra en los reportes: 1 activo, 2 pasivo, 3 patrimonio, 4 ingreso, 5 costo, 6 gasto."
      pie={
        <>
          <View style={{ flex: 1 }}>
            <Boton texto="Cancelar" tono="neutro" alTocar={cerrar} />
          </View>
          <View style={{ flex: 1 }}>
            <Boton texto={guardando ? 'Creando…' : 'Crear cuenta'} alTocar={guardar} ocupado={guardando} />
          </View>
        </>
      }
    >
      {error ? <Text style={[p.nota, { color: t.peligro }]}>{error}</Text> : null}
      <Campo rotulo="Código" value={codigo} onChangeText={setCodigo} placeholder="6030" keyboardType="number-pad" autoFocus />
      <Campo
        rotulo="Nombre de la cuenta"
        value={nombre}
        onChangeText={setNombre}
        placeholder="Faltante de caja"
        returnKeyType="done"
        onSubmitEditing={guardar}
      />
      <Selector<CuentaContable['tipo']>
        etiqueta="Tipo"
        forma="campo"
        opciones={Object.entries(TIPO_LABEL).map(([valor, texto]) => ({ valor: valor as CuentaContable['tipo'], texto }))}
        valor={tipo}
        alCambiar={setTipo}
      />
    </HojaFormulario>
  )
}

type OrdenMayor = 'fecha' | '-fecha' | 'descripcion' | 'debe' | 'haber' | 'saldo'

const ORDENES_MAYOR: { valor: OrdenMayor; texto: string }[] = [
  { valor: 'fecha', texto: 'Fecha, la más vieja primero' },
  { valor: '-fecha', texto: 'Fecha, la más nueva primero' },
  { valor: 'descripcion', texto: 'Descripción' },
  { valor: 'debe', texto: 'Debe, mayor primero' },
  { valor: 'haber', texto: 'Haber, mayor primero' },
  { valor: 'saldo', texto: 'Saldo, mayor primero' },
]

function ordenarMayor(filas: FilaMayor[], orden: OrdenMayor): FilaMayor[] {
  const copia = [...filas]
  switch (orden) {
    case 'fecha':
      return copia
    case '-fecha':
      return copia.reverse()
    case 'descripcion':
      return copia.sort((a, b) => a.descripcion.localeCompare(b.descripcion))
    default:
      return copia.sort((a, b) => b[orden] - a[orden])
  }
}

/**
 * El libro mayor de una cuenta, encima del plan. El saldo es el que queda
 * DESPUES de cada movimiento: solo se lee como acumulado en orden
 * cronologico, que es como abre (asi lo manda el servidor).
 */
function LibroMayor({ cuenta, alCerrar }: { cuenta: CuentaContable | null; alCerrar: () => void }) {
  const { fmt } = useMoneda()
  const [orden, setOrden] = useState<OrdenMayor>('fecha')
  const [ver, setVer] = useState(100)
  const { datos, error, refrescar } = useCarga(
    () => (cuenta ? apiContabilidad.libroMayor(cuenta.id).then((filas) => ({ id: cuenta.id, filas })) : Promise.resolve(null)),
    600,
    String(cuenta?.id ?? ''),
  )
  // Lo que llego es de ESTA cuenta (al cambiar de cuenta, lo anterior no se muestra).
  const filas = datos && cuenta && datos.id === cuenta.id ? datos.filas : null
  const ordenadas = filas ? ordenarMayor(filas, orden) : []

  return (
    <HojaFormulario
      visible={cuenta !== null}
      alCerrar={() => {
        setVer(100)
        alCerrar()
      }}
      titulo={cuenta ? `Libro mayor · ${cuenta.codigo} ${cuenta.nombre}` : 'Libro mayor'}
      subtitulo="El saldo es el que queda DESPUÉS de cada movimiento: solo se lee como acumulado en orden cronológico, que es como abre."
    >
      <FilaFiltros>
        <Selector<OrdenMayor> etiqueta="Ordenar" titulo="Ordenar el mayor" opciones={ORDENES_MAYOR} valor={orden} alCambiar={setOrden} />
      </FilaFiltros>
      {error && !filas ? <Problema mensaje={error} alReintentar={refrescar} /> : null}
      {!filas && !error ? <Cargando /> : null}
      {filas ? (
        <ListaFicha>
          {ordenadas.slice(0, ver).map((f, i) => (
            <Renglon
              key={`${f.asiento_id}-${i}`}
              titulo={f.descripcion}
              detalle={`${fechaVE(f.fecha)} · ${f.debe ? `debe ${fmt(f.debe)}` : `haber ${fmt(f.haber)}`}`}
              valor={fmt(f.saldo)}
              subvalor="saldo"
              ultima={i === Math.min(ver, ordenadas.length) - 1}
            />
          ))}
          {filas.length === 0 ? <Nota style={{ padding: 16 }}>Esta cuenta no tiene movimientos todavía.</Nota> : null}
        </ListaFicha>
      ) : null}
      {filas ? <VerMas quedan={ordenadas.length - ver} paso={100} alTocar={() => setVer((v) => v + 100)} /> : null}
    </HojaFormulario>
  )
}

const estilos = StyleSheet.create({
  cuenta: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 56 },
  codigo: { width: 42 },
  nombre: { fontFamily: LETRA.textoFuerte, fontSize: 15 },
  detalle: { fontFamily: LETRA.texto, fontSize: 13, marginTop: 2 },
})
